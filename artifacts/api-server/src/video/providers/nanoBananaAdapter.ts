/**
 * Reference-frame adapter for the AI Video Studio's "visual bible" stage
 * (character / location / opening plates).
 *
 * Backend: Magnific Nano Banana Pro (`nano-banana-pro-flash` =
 * Gemini 3.1 Flash Image, or `nano-banana-pro` = Gemini 3 Pro Image
 * via env). The shared `generateImageBest` integration now routes to
 * Magnific's REST endpoint internally, so the entire app uses a single
 * `FREEPIK_API_KEY` for all image + video generation.
 *
 * Pipeline-fix doc additions:
 *   1. Prompt is ALWAYS a JSON-formatted string (≤ 4500 chars). The
 *      adapter accepts either a legacy `prompt: string` (already
 *      JSON-shaped or plain) OR a structured `spec` object that gets
 *      serialized via `buildJsonPrompt`.
 *   2. Every successful image is shown to Gemini 2.5 Flash for
 *      visual-fidelity validation. On `passed=false`, we re-generate
 *      up to `qcMaxRetries` times, feeding the reported `issues` back
 *      into the prompt so the next attempt can self-correct.
 *
 * Returns both the saved Object Storage path AND the inline base64 +
 * mime type so the caller can immediately hand the bytes to the next
 * stage (Veo / Seedance / Claude vision context) without a re-download
 * round trip. Also returns the QC verdict so the caller can log /
 * surface scores to the user.
 */

import { generateImageBest } from "@workspace/integrations-gemini-ai";
import { saveBufferToObjectStorage } from "../../lib/videoStorage";
import { logger } from "../../lib/logger";
import {
  buildJsonPrompt,
  type BuildJsonPromptOpts,
} from "../lib/promptEnvelope";
import {
  validateImageWithGemini,
  type ValidateImageResult,
} from "../lib/imageQcValidator";

export interface NanoBananaResult {
  objectPath: string;
  b64: string;
  mimeType: string;
  /** QC verdict (Gemini vision). `null` if QC was disabled. */
  qc: ValidateImageResult | null;
  /** The final prompt string actually sent to NB Pro (post-cap, post-retry). */
  finalPrompt: string;
}

export interface NanoBananaOpts {
  /** Aspect ratio passed straight through to Nano Banana 2. */
  aspectRatio: string;
  /**
   * Up to 3 reference images sent to Nano Banana Pro as
   * `reference_images` in the Magnific request body. NB Pro uses these
   * to lock identity / style / location pixels so a generated frame
   * actually looks like the previously-locked characters and place.
   *
   * Excess refs (>3) are dropped silently. Each ref is base64 bytes
   * (no data-URL prefix) + the original mime type.
   *
   * NOTE: this is the GENERATION reference set. Vision-QC may use a
   * separate set via `qc.references` — they are independent on
   * purpose because QC sometimes needs a tighter likeness check than
   * what we hand to NB Pro.
   */
  referenceImages?: Array<{ b64: string; mimeType: string }>;
}

/**
 * QC config for the vision-retry loop. Defaults match the
 * `routes/images/index.ts` /qc-frame-image route so behaviour is
 * consistent across the app.
 */
export interface NanoBananaQcOpts {
  /** Disable vision validation entirely (returns qc: null). */
  disabled?: boolean;
  /** Pass score threshold (0-10). Default 7. */
  threshold?: number;
  /**
   * How many times we re-generate when QC says the image misses spec.
   * Total NB Pro calls = 1 + qcMaxRetries. Default 2.
   */
  qcMaxRetries?: number;
  /**
   * Optional reference images for likeness checks (e.g. character
   * sheets when validating per-shot frames).
   */
  references?: Array<{ b64: string; mimeType: string }>;
  /**
   * Plain-language description of what this image MUST depict. Passed
   * to Gemini AS-IS for comparison. If omitted, the adapter uses the
   * stringified `spec` (or the `prompt` itself) as the expected spec.
   */
  expectedSpec?: string;
  /** Label for log lines + QC. */
  label?: string;
}

/**
 * Per-call hard timeout. NB2 normally responds in 8-25 s; anything past
 * 90 s is almost certainly a hung upstream and would otherwise freeze
 * the entire visual-bible stage (the user's `Designing characters...`
 * complaint). We race against this timeout so a stuck call surfaces a
 * retryable error instead of hanging forever.
 */
const NB2_CALL_TIMEOUT_MS = 90_000;

/**
 * Generate a single high-quality reference frame with Nano Banana Pro
 * via Magnific. Caller may pass either:
 *   - `{ prompt: "..." }` — legacy plain-string path (string is still
 *      capped at 4500 chars before being sent).
 *   - `{ spec: {...} }`   — structured object that gets serialized as
 *      compact JSON ≤ 4500 chars via the prompt envelope.
 *
 * The function internally retries up to 3 times on transient NB Pro
 * failures (network / 5xx) AND, on top of that, runs a Gemini vision
 * validator after every successful image. If validation fails, it
 * appends "AVOID:" hints from the QC issues and re-generates up to
 * `qcMaxRetries` more times.
 */
export async function generateNanoBananaFrame(
  args: (
    | { prompt: string }
    | {
        spec: Record<string, unknown>;
        envelopeOpts?: BuildJsonPromptOpts;
      }
  ) &
    NanoBananaOpts & { qc?: NanoBananaQcOpts },
): Promise<NanoBananaResult> {
  const { aspectRatio, qc: qcOpts, referenceImages } = args;
  const label = qcOpts?.label ?? "nanoBananaAdapter";

  // Cap reference images at 3 (Magnific NB Pro hard limit) and drop
  // any malformed entries. Mime type is normalized so a bad/empty
  // value never hits the Magnific data-URL builder (which would emit
  // `data:;base64,…` and 4xx). We log when we trim so the engine
  // layer can audit which refs actually reached NB Pro.
  const capped = (referenceImages ?? [])
    .filter((r) => r && typeof r.b64 === "string" && r.b64.length > 0)
    .slice(0, 3)
    .map((r) => ({
      b64: r.b64,
      mimeType:
        typeof r.mimeType === "string" && /^image\/[a-z0-9+.-]+$/i.test(r.mimeType)
          ? r.mimeType
          : "image/png",
    }));
  if ((referenceImages?.length ?? 0) > capped.length) {
    logger.info(
      {
        label,
        provided: referenceImages?.length ?? 0,
        used: capped.length,
      },
      "nanoBananaAdapter: trimmed reference_images to NB Pro 3-image cap",
    );
  }

  // 1. Build the prompt string. Either a structured spec → compact
  //    JSON envelope, or a passthrough string (still capped).
  //
  // We hold on to the original spec object so QC retries can inject
  // an `avoid_issues` field into it and re-serialize via the
  // envelope (preserving the JSON-formatted-string invariant). The
  // legacy plain-string path wraps the input in a tiny JSON envelope
  // so the same retry path can still inject `avoid_issues` and emit
  // valid JSON.
  const envelopeOpts: BuildJsonPromptOpts =
    "spec" in args ? (args.envelopeOpts ?? {}) : {};
  const baseSpec: Record<string, unknown> =
    "spec" in args ? { ...args.spec } : { prompt: args.prompt };

  const basePrompt = buildJsonPrompt(baseSpec, { ...envelopeOpts, label });
  const expectedSpecText =
    qcOpts?.expectedSpec ?? JSON.stringify(baseSpec, null, 2);

  // 2. Outer QC-retry loop. The first attempt uses the base prompt.
  //    Subsequent attempts inject AVOID hints as a structured field
  //    inside the spec, then re-run the envelope to keep it valid
  //    JSON ≤ 4500 chars.
  const qcMaxRetries = qcOpts?.disabled ? 0 : (qcOpts?.qcMaxRetries ?? 2);
  let qcAttempt = 0;
  let lastResult: {
    objectPath: string;
    b64: string;
    mimeType: string;
    qc: ValidateImageResult | null;
    finalPrompt: string;
  } | null = null;
  let qcIssues: string[] = [];
  let qcSuggestion = "";

  while (qcAttempt <= qcMaxRetries) {
    // Build this attempt's prompt. On retry we mutate a COPY of the
    // baseSpec to add the `avoid_issues` block, then run the JSON
    // envelope again so the output is still valid JSON ≤ cap.
    let attemptPrompt: string;
    if (qcAttempt === 0) {
      attemptPrompt = basePrompt;
    } else {
      const retrySpec: Record<string, unknown> = {
        ...baseSpec,
        avoid_issues: qcIssues,
      };
      if (qcSuggestion) retrySpec.qc_hint = qcSuggestion;
      attemptPrompt = buildJsonPrompt(retrySpec, {
        ...envelopeOpts,
        label: `${label}:retry${qcAttempt}`,
      });
    }

    // 3. Inner NB Pro generation with up-to-3 transient retries +
    //    per-attempt timeout.
    const nbOut = await callNanoBananaWithRetries({
      prompt: attemptPrompt,
      aspectRatio,
      referenceImages: capped,
      label,
    });

    // 4. Vision-validate the result (unless disabled). In-pipeline we
    //    use strict mode so a validator outage triggers the QC retry
    //    loop instead of silently passing the image.
    let qcVerdict: ValidateImageResult | null = null;
    if (!qcOpts?.disabled) {
      qcVerdict = await validateImageWithGemini({
        b64: nbOut.b64,
        mimeType: nbOut.mimeType,
        expectedSpec: expectedSpecText,
        references: qcOpts?.references,
        threshold: qcOpts?.threshold,
        strict: true,
        label,
      });
    }

    lastResult = {
      objectPath: nbOut.objectPath,
      b64: nbOut.b64,
      mimeType: nbOut.mimeType,
      qc: qcVerdict,
      finalPrompt: attemptPrompt,
    };

    // 5. Decide whether to retry. We retry if:
    //    - QC ran AND said the image fails AND
    //    - we have retries left.
    //
    // We DO retry on validatorErrored (transient Gemini failures
    // often clear on the second call). After retries are exhausted
    // the loop exits and we ship the last image with its qc verdict
    // attached so the caller can log / surface to the user.
    if (qcVerdict && !qcVerdict.passed && qcAttempt < qcMaxRetries) {
      qcIssues = qcVerdict.issues;
      qcSuggestion = qcVerdict.suggestion;
      logger.info(
        {
          label,
          qcAttempt,
          score: qcVerdict.score,
          issuesCount: qcIssues.length,
        },
        "nanoBananaAdapter: QC failed, regenerating with AVOID hints",
      );
      qcAttempt++;
      continue;
    }
    break;
  }

  if (!lastResult) {
    // Defensive — the inner caller always throws on full failure,
    // so we can only get here on a coding error.
    throw new Error("nanoBananaAdapter: no result produced");
  }
  return lastResult;
}

/**
 * Inner generation loop — handles transient NB Pro failures (network,
 * 5xx) with linear backoff + per-call timeout. This is separate from
 * the QC retry loop so a transient infra failure doesn't burn through
 * the QC retry budget.
 */
async function callNanoBananaWithRetries(args: {
  prompt: string;
  aspectRatio: string;
  referenceImages?: Array<{ b64: string; mimeType: string }>;
  label: string;
}): Promise<{ objectPath: string; b64: string; mimeType: string }> {
  const { prompt, aspectRatio, referenceImages, label } = args;
  // Map the adapter's `{b64, mimeType}` shape onto the gemini-ai
  // helper's `ReferenceImageInput` (`{b64Json, mimeType}`). Same
  // bytes, just a different field name.
  const refsForHelper =
    referenceImages && referenceImages.length > 0
      ? referenceImages.map((r) => ({ b64Json: r.b64, mimeType: r.mimeType }))
      : undefined;
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const result = await withTimeout(
        generateImageBest(prompt, {
          aspectRatio: aspectRatio as never,
          ...(refsForHelper ? { referenceImages: refsForHelper } : {}),
        }),
        NB2_CALL_TIMEOUT_MS,
        "Image generation timed out",
      );
      const b64 = result.b64_json;
      const mimeType = result.mimeType || "image/png";
      const buf = Buffer.from(b64, "base64");
      const { objectPath } = await saveBufferToObjectStorage(buf, mimeType);
      logger.info(
        {
          label,
          objectPath,
          model:
            process.env.MAGNIFIC_IMAGE_MODEL ?? "nano-banana-pro-flash",
          aspectRatio,
          promptChars: prompt.length,
          referenceImagesUsed: refsForHelper?.length ?? 0,
        },
        "Visual bible frame saved (Magnific Nano Banana Pro)",
      );
      return { objectPath, b64, mimeType };
    } catch (err) {
      lastErr = err;
      logger.warn(
        {
          label,
          err: err instanceof Error ? err.message : String(err),
          attempt,
          aspectRatio,
        },
        `nanoBananaAdapter: attempt ${attempt + 1} failed, retrying`,
      );
      await sleep(1500 * (attempt + 1));
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error("Visual bible frame generation failed after retries");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} after ${ms / 1000}s`)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}
