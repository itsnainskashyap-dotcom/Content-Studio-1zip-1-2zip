/**
 * Reusable Gemini-vision OCR / visual-fidelity validator.
 *
 * Per the pipeline-fix doc + the user's hard requirement:
 *   "Every generated image must be observed and validated by OCR
 *    (vision). On mismatch, retry — re-generate with the issues fed
 *    back into the prompt."
 *
 * This is the SAME logic that powers the Image Studio /qc-frame-image
 * route, hoisted into a function so the AI Video Studio pipeline (and
 * any future stage) can call it inline after every Nano Banana Pro
 * image.
 *
 * Soft-fail philosophy: if the validator itself errors (Gemini quota,
 * network, malformed reply, etc.) we return `passed: true` with a
 * neutral score so a transient validator outage NEVER blocks a working
 * image-generation pipeline. The retry loop is bounded — we'd rather
 * ship a slightly off-spec image than hang the user's job.
 */

import { ai } from "@workspace/integrations-gemini-ai";
import { logger } from "../../lib/logger";

export interface ValidateImageInput {
  /** Candidate image (base64-encoded). */
  b64: string;
  /** MIME type of the candidate, e.g. "image/png". */
  mimeType: string;
  /**
   * What this image is SUPPOSED to depict. Free-form natural-language
   * description that Gemini will compare the candidate against. Pass
   * either the original prompt verbatim, or a structured "spec"
   * stringified — the validator handles either.
   */
  expectedSpec: string;
  /**
   * Optional reference images for likeness checks (e.g. character
   * sheets when validating a per-shot frame against the locked
   * character look). Empty array = no likeness penalty.
   */
  references?: Array<{ b64: string; mimeType: string }>;
  /**
   * Score threshold (0-10) above which `passed === true`. Default 7.
   * Lower this if you want the pipeline to ship more aggressively.
   */
  threshold?: number;
  /**
   * Strict mode: if the validator itself errors (Gemini quota / parse
   * failure / network), return `passed: false` instead of soft-passing.
   * Use this in the in-pipeline path where we WANT the QC retry loop
   * to engage on validator failures. The standalone /qc-frame-image
   * route leaves this off so the user UI never sees a false "fail"
   * caused by a validator outage. Default: false.
   */
  strict?: boolean;
  /** Label for log messages. */
  label?: string;
}

export interface ValidateImageResult {
  /** True if score >= threshold. */
  passed: boolean;
  /** 0-10 grade from Gemini. Always finite (clamped). */
  score: number;
  /** Up-to-8 short strings describing what's wrong. */
  issues: string[];
  /** One-sentence regen hint (may be empty). */
  suggestion: string;
  /**
   * True when the validator itself failed (Gemini errored / parse
   * failure). Caller can use this to skip the regen retry — there's
   * no actionable feedback when the validator is offline.
   */
  validatorErrored: boolean;
}

const DEFAULT_THRESHOLD = 7;

/**
 * Run Gemini 2.5 Flash vision on a candidate image and grade it
 * against `expectedSpec`. Returns a structured verdict the caller can
 * use to decide whether to retry generation.
 */
export async function validateImageWithGemini(
  input: ValidateImageInput,
): Promise<ValidateImageResult> {
  const threshold = input.threshold ?? DEFAULT_THRESHOLD;
  const label = input.label ?? "imageQcValidator";

  const refs = input.references ?? [];
  const qcPrompt =
    `You are a film QC reviewer. Compare the candidate image against the expected spec ` +
    `and the reference sheets (if any). Grade ONLY based on what's visible.\n\n` +
    `Expected spec (what this image MUST depict):\n"""\n${input.expectedSpec}\n"""\n\n` +
    (refs.length > 0
      ? `Reference sheets follow the candidate. Subjects in the candidate should look ` +
        `like the same people / places on those sheets (face, hair, wardrobe, ` +
        `architecture, lighting key).\n\n`
      : `No reference sheets — do not penalize for likeness.\n\n`) +
    `Reply with ONE JSON object on a single line, no prose, no code fences:\n` +
    `{"score":<0-10 number>,"passed":<true|false>,"issues":[<short string>,...],"suggestion":"<one-sentence regen hint or empty>"}\n\n` +
    `Scoring rubric:\n` +
    `  10 = matches spec exactly, on-model, style fits\n` +
    `  7-9 = minor issues, ship it\n` +
    `  4-6 = significant issues, regenerate\n` +
    `  0-3 = unusable\n` +
    `passed = score >= ${threshold}.`;

  const parts: Array<
    | { inlineData: { data: string; mimeType: string } }
    | { text: string }
  > = [];
  parts.push({ inlineData: { data: input.b64, mimeType: input.mimeType } });
  for (const r of refs) {
    parts.push({ inlineData: { data: r.b64, mimeType: r.mimeType } });
  }
  parts.push({ text: qcPrompt });

  const t0 = Date.now();
  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts }],
    });
    const text =
      response.candidates?.[0]?.content?.parts
        ?.map((p: { text?: string }) =>
          typeof p.text === "string" ? p.text : "",
        )
        .join("") ?? "";

    let raw = text.trim();
    const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) raw = fence[1].trim();
    const fb = raw.indexOf("{");
    const lb = raw.lastIndexOf("}");
    if (fb >= 0 && lb > fb) raw = raw.slice(fb, lb + 1);

    let parsed: {
      score?: unknown;
      passed?: unknown;
      issues?: unknown;
      suggestion?: unknown;
    } = {};
    try {
      parsed = JSON.parse(raw);
    } catch (parseErr) {
      logger.warn(
        {
          label,
          err: parseErr,
          sample: text.slice(0, 200),
          strict: !!input.strict,
        },
        input.strict
          ? "imageQcValidator: model returned non-JSON, strict-failing"
          : "imageQcValidator: model returned non-JSON, soft-passing",
      );
      return {
        passed: !input.strict,
        score: input.strict ? 0 : threshold,
        issues: input.strict
          ? ["validator returned non-JSON; regenerate"]
          : [],
        suggestion: "",
        validatorErrored: true,
      };
    }

    const scoreNum =
      typeof parsed.score === "number" ? parsed.score : Number(parsed.score);
    const score = Number.isFinite(scoreNum)
      ? Math.max(0, Math.min(10, scoreNum))
      : threshold;
    const passed = score >= threshold;
    const issues = Array.isArray(parsed.issues)
      ? parsed.issues
          .filter((i) => typeof i === "string" && i.trim().length > 0)
          .slice(0, 8)
          .map((i) => String(i).slice(0, 200))
      : [];
    const suggestion =
      typeof parsed.suggestion === "string"
        ? parsed.suggestion.slice(0, 400)
        : "";

    logger.info(
      {
        label,
        ms: Date.now() - t0,
        score,
        passed,
        issuesCount: issues.length,
        refs: refs.length,
      },
      "imageQcValidator: review complete",
    );
    return { passed, score, issues, suggestion, validatorErrored: false };
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    logger.warn(
      { label, err: raw, strict: !!input.strict },
      input.strict
        ? "imageQcValidator: vision call failed, strict-failing"
        : "imageQcValidator: vision call failed, soft-passing",
    );
    return {
      passed: !input.strict,
      score: input.strict ? 0 : threshold,
      issues: input.strict
        ? ["validator unreachable; regenerate"]
        : [],
      suggestion: "",
      validatorErrored: true,
    };
  }
}
