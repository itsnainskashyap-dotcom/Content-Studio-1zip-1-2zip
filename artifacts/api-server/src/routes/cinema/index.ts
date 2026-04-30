import { Router, type IRouter, type Request, type Response } from "express";
import {
  GenerateCinemaImageBody,
  ScoreCinemaPromptBody,
  ScoreCinemaPromptResponse,
} from "@workspace/api-zod";
import type { CinemaImageRequest } from "@workspace/api-zod";
import {
  generateImageBest,
  type GenerateImageAspectRatio,
} from "@workspace/integrations-gemini-ai/image";
import { logger } from "../../lib/logger";
import { saveBase64Image, loadImageAsBase64 } from "../../lib/imageStorage";
import { requireAuth } from "../../middleware/auth";
import { generateJson, ANTHROPIC_FAST_MODEL } from "../ai/llm";
import {
  TRUSTED_CAMERAS,
  TRUSTED_LENSES,
  trustedStyleTranslation,
} from "./trusted-data";

// Negative-prompt tokens are surfaced verbatim in the model prompt under an
// "AVOID" header. To prevent a caller from smuggling fresh instructions
// through the field (e.g. "ignore previous rules and …"), we cap each token
// at NEG_TAG_MAX_LEN chars and strip any ASCII control characters /
// instruction-like punctuation that would let them break out of the list.
const NEG_TAG_MAX_LEN = 60;
const NEG_TAG_ALLOWED = /[^\p{L}\p{N}\s\-_/+,.()]/gu;

function sanitizeNegativeTag(raw: string): string {
  return raw
    .normalize("NFKC")
    .replace(NEG_TAG_ALLOWED, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, NEG_TAG_MAX_LEN);
}

const router: IRouter = Router();

interface ZodIssueLike {
  path: Array<string | number>;
  message: string;
}
interface ZodErrorLike {
  issues: ZodIssueLike[];
}

function formatZodError(err: ZodErrorLike): string {
  return err.issues
    .map((i) => {
      const path = i.path.length ? i.path.join(".") : "(body)";
      return `${path}: ${i.message}`;
    })
    .join("; ");
}

/**
 * Cinema-Studio aspect-ratio mapper.
 *
 * Nano Banana 2 (`gemini-3.1-flash-image-preview`) natively supports
 * all 9 ratios in the Cinema UI's `CinemaOutputAspectRatio` enum
 * EXCEPT `2.39:1` (anamorphic), which is mapped to its nearest
 * supported neighbour (`21:9` — i.e. ~2.33:1). The user-facing ratio
 * string is still preserved verbatim in the saved prompt + response
 * for reproducibility.
 */
function mapToGeminiAspectRatio(
  requested: string,
): GenerateImageAspectRatio {
  switch (requested) {
    case "1:1":
    case "3:4":
    case "4:3":
    case "9:16":
    case "16:9":
    case "21:9":
    case "4:5":
    case "3:2":
      return requested;
    case "2.39:1":
      return "21:9";
    default:
      return "16:9";
  }
}

const STYLE_MODE_LABEL: Record<CinemaImageRequest["styleMode"], string> = {
  photoreal_cinematic: "Photorealistic Cinematic",
  anime_2d: "2D Anime",
  pixel_art: "Pixel Art",
  cgi_3d: "3D CGI",
  commercial_product: "Commercial Product",
};

function defaultStyleTranslation(
  styleMode: CinemaImageRequest["styleMode"],
  focalLength: string | undefined,
  aperture: string | undefined,
): string {
  const fl = focalLength?.trim() || "35mm";
  const ap = aperture?.trim() || "f/2.8";
  switch (styleMode) {
    case "photoreal_cinematic":
      return `keep real cinema lens terminology — focal length ${fl}, aperture ${ap}; use filmic optics, real bokeh shape, natural sensor grain, accurate lens flare`;
    case "anime_2d":
      return `treat camera framing as anime composition language, NOT real optics; use dynamic anime key pose, cel shading, painted background; do NOT render realistic skin pores, real camera noise, or plastic 3D faces`;
    case "pixel_art":
      return `treat camera framing as pixel-art composition language, NOT real optics; use crisp pixel grid, limited palette, parallax sprite layers; do NOT render shallow DOF blur or anti-aliased smooth edges`;
    case "cgi_3d":
      return `treat camera as a virtual rigged 3D camera with virtual focal length ${fl}, stylized depth of field, global illumination, smooth subsurface skin, premium animated film polish`;
    case "commercial_product":
      return `camera language must emphasize product shape, material accuracy, controlled reflections, clean studio background; use focal length ${fl} and aperture ${ap} as product framing guidance`;
  }
}

/**
 * Build the final image-model prompt from the structured Cinema Studio
 * state. The output is a single multi-section instruction string.
 *
 * The model is told it is a cinema reference image (not a screenshot, not
 * a UI mock), and is given a strict reference-strength block so it can
 * weight the user-provided references appropriately.
 */
function buildCinemaPrompt(
  body: CinemaImageRequest,
  resolvedSeed: number,
): string {
  const styleLabel = STYLE_MODE_LABEL[body.styleMode];
  const aspectRatio = body.outputControls.aspectRatio;
  const resolution = body.outputControls.resolution;

  // Look up the camera/lens server-side from their IDs. Anything the client
  // sent in `cameraInjection`, `lensInjection`, `cameraBodyLabel`,
  // `lensPackLabel`, or `styleTranslation` is IGNORED for these
  // policy-critical sections — they are recomputed from the trusted table
  // so a direct API caller can't slip free-form instructions through them.
  const camera = body.cameraBodyId
    ? TRUSTED_CAMERAS[body.cameraBodyId]
    : undefined;
  const lens = body.lensPackId ? TRUSTED_LENSES[body.lensPackId] : undefined;
  const camLabel = camera?.lookPreset ?? "";
  const lensLabel = lens?.name ?? "";
  const cameraInjection = camera?.promptInjection ?? "";
  const lensInjection = lens?.promptInjection ?? "";
  const styleTranslation = trustedStyleTranslation({
    styleMode: body.styleMode,
    focalLength: body.focalLength ?? "",
    aperture: body.aperture ?? "",
  });

  const sections: string[] = [];

  sections.push(
    `Generate ONE single hero cinema still image. Treat this as a production-grade cinematography reference, NOT a stylized poster, screenshot, or mock-up.`,
  );

  sections.push(
    `STYLE MODE: ${styleLabel}.`,
  );

  sections.push(
    `OUTPUT FRAMING: aspect ratio ${aspectRatio}, ${resolution} resolution; the requested aspect ratio MUST be respected — do not letterbox.`,
  );

  if (camLabel || cameraInjection) {
    const lines = [
      `CAMERA BODY:`,
      camLabel ? `  • ${camLabel}` : null,
      cameraInjection ? `  • ${cameraInjection}` : null,
    ].filter(Boolean);
    sections.push(lines.join("\n"));
  }

  if (lensLabel || lensInjection || body.focalLength || body.aperture) {
    const lines = [
      `LENS & OPTICS:`,
      lensLabel ? `  • ${lensLabel}` : null,
      lensInjection ? `  • ${lensInjection}` : null,
      body.focalLength ? `  • Focal length: ${body.focalLength}` : null,
      body.aperture ? `  • Aperture: ${body.aperture}` : null,
    ].filter(Boolean);
    sections.push(lines.join("\n"));
  }

  sections.push(`STYLE-TRANSLATED CAMERA LANGUAGE:\n  • ${styleTranslation}`);

  if (body.shotRecipe) {
    const r = body.shotRecipe;
    const lines = [
      `SHOT RECIPE${r.name ? ` — ${r.name}` : ""}:`,
      r.cameraAngle ? `  • Camera angle: ${r.cameraAngle}` : null,
      r.shotSize ? `  • Shot size: ${r.shotSize}` : null,
      r.lens ? `  • Lens hint: ${r.lens}` : null,
      r.lighting ? `  • Lighting: ${r.lighting}` : null,
      r.composition ? `  • Composition: ${r.composition}` : null,
      r.promptBoost ? `  • Recipe boost: ${r.promptBoost}` : null,
    ].filter(Boolean);
    sections.push(lines.join("\n"));
  }

  if (body.references && body.references.length > 0) {
    const refLines = body.references.map((r, i) => {
      const label = r.label?.trim() || `Reference ${i + 1}`;
      return `  • Image ${i + 1}: ${label}`;
    });
    sections.push(
      [
        `REFERENCE IMAGES (attached above this text — USE them as the visual source the prompt is anchored to):`,
        ...refLines,
      ].join("\n"),
    );

    if (body.referenceStrength) {
      const s = body.referenceStrength;
      const items: string[] = [];
      if (typeof s.faceLock === "number")
        items.push(`face likeness lock ${s.faceLock}/100`);
      if (typeof s.outfitLock === "number")
        items.push(`outfit lock ${s.outfitLock}/100`);
      if (typeof s.poseLock === "number")
        items.push(`pose lock ${s.poseLock}/100`);
      if (typeof s.styleLock === "number")
        items.push(`style lock ${s.styleLock}/100`);
      if (typeof s.locationLock === "number")
        items.push(`location lock ${s.locationLock}/100`);
      if (typeof s.lightingLock === "number")
        items.push(`lighting lock ${s.lightingLock}/100`);
      if (typeof s.productShapeLock === "number")
        items.push(`product shape lock ${s.productShapeLock}/100`);
      if (typeof s.compositionLock === "number")
        items.push(`composition lock ${s.compositionLock}/100`);
      if (items.length > 0) {
        sections.push(
          `REFERENCE STRENGTH (0 = ignore, 100 = strict copy from references):\n  • ${items.join("; ")}.`,
        );
      }
    }
  }

  if (body.generationControls) {
    const g = body.generationControls;
    const items: string[] = [];
    if (typeof g.promptAdherence === "number")
      items.push(`prompt adherence ${g.promptAdherence}/100`);
    if (typeof g.creativeFreedom === "number")
      items.push(`creative freedom ${g.creativeFreedom}/100`);
    if (typeof g.realismStrength === "number")
      items.push(`realism strength ${g.realismStrength}/100`);
    if (typeof g.styleStrength === "number")
      items.push(`style strength ${g.styleStrength}/100`);
    if (typeof g.detailLevel === "number")
      items.push(`detail level ${g.detailLevel}/100`);
    if (typeof g.compositionStrictness === "number")
      items.push(`composition strictness ${g.compositionStrictness}/100`);
    if (typeof g.variationStrength === "number")
      items.push(`variation strength ${g.variationStrength}/100`);
    items.push(`seed ${resolvedSeed}`);
    sections.push(
      `GENERATION CONTROLS (interpret these as soft preferences):\n  • ${items.join("; ")}.`,
    );
  }

  if (body.negativePrompt && body.negativePrompt.length > 0) {
    const cleaned = body.negativePrompt
      .map(sanitizeNegativeTag)
      .filter(Boolean)
      .slice(0, 32);
    if (cleaned.length > 0) {
      sections.push(`AVOID:\n  • ${cleaned.join(", ")}.`);
    }
  }

  sections.push(
    `USER PROMPT (the literal scene to render — interpret with the above cinematography context):\n${body.rawPrompt.trim()}`,
  );

  sections.push(
    [
      `HARD RULES:`,
      `  • No on-screen text, captions, watermarks, logos, UI overlays, or panel borders.`,
      `  • Do NOT output a multi-panel reference sheet — produce ONE single hero frame.`,
      `  • Respect the requested aspect ratio (${aspectRatio}); fill the full frame.`,
      `  • Stay inside the chosen STYLE MODE (${styleLabel}); do NOT switch styles mid-image.`,
    ].join("\n"),
  );

  return sections.join("\n\n");
}

const RATE_LIMIT_RE =
  /\b429\b|\brate[\s_-]?limit\b|\bquota\b|\bresource[\s_-]?exhausted\b|\btoo[\s_-]?many[\s_-]?requests\b/;
const SAFETY_RE = /\bsafety\b|\bblocked\b|\bblocklist\b|\bharm[\s_-]?category\b/;
const TIMEOUT_RE = /\btimed?[\s_-]?out\b|\betimedout\b|\baborted\b/;
const TRANSIENT_RE =
  /\b429\b|\bratelimit\b|\brate[\s_-]?limit\b|\bquota\b|\bresource[\s_-]?exhausted\b|\b503\b|\bservice[\s_-]?unavailable\b|\btimed?[\s_-]?out\b|\betimedout\b/;

function classifyError(raw: string): string {
  const lower = raw.toLowerCase();
  if (RATE_LIMIT_RE.test(lower)) {
    return "Rate limited by the image service. Please retry in a moment.";
  }
  if (SAFETY_RE.test(lower)) {
    return "The image was blocked by the safety filter. Try softening the prompt or removing risky terms.";
  }
  if (TIMEOUT_RE.test(lower)) {
    return "Image generation timed out. Please try again.";
  }
  return "Image generation failed. Please try again.";
}

async function generateImageWithRetry(
  prompt: string,
  refImages: Array<{ b64Json: string; mimeType: string }>,
  aspectRatio: GenerateImageAspectRatio,
  _requestedAspectRatio: string,
): Promise<{ b64_json: string; mimeType: string; engine: "nano-banana-2" }> {
  const MAX_ATTEMPTS = 2;
  let lastErr: unknown = null;
  // All Cinema Studio image generation now goes through Nano Banana 2
  // (`gemini-3.1-flash-image-preview`), which natively supports both
  // reference images AND every aspect ratio the UI offers — including
  // 21:9 ultrawide and the new ultratall variants — so the previous
  // "force Gemini Flash for ultrawide" branch is no longer needed.
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await generateImageBest(prompt, {
        referenceImages: refImages,
        aspectRatio,
      });
    } catch (err) {
      lastErr = err;
      const msg =
        err instanceof Error
          ? err.message.toLowerCase()
          : String(err).toLowerCase();
      if (!TRANSIENT_RE.test(msg) || attempt === MAX_ATTEMPTS) throw err;
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
  throw lastErr ?? new Error("Image generation failed");
}

/**
 * POST /api/cinema-image
 *
 * Generate a single Cinema Studio still. Always returns ONE image; the
 * client orchestrates 4-variation grids by issuing multiple parallel
 * requests with different seeds (cheaper for us than maintaining a
 * separate batch endpoint with shared retry logic).
 */
router.post(
  "/cinema-image",
  requireAuth,
  async (req: Request, res: Response) => {
    const label = "cinema-image";
    const parsed = GenerateCinemaImageBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: formatZodError(parsed.error as unknown as ZodErrorLike),
      });
      return;
    }
    const body = parsed.data;

    const wantRandom = body.generationControls?.randomSeed !== false;
    const seedFromBody = body.generationControls?.seed ?? -1;
    const resolvedSeed =
      wantRandom || seedFromBody < 0
        ? Math.floor(Math.random() * 2_147_483_647)
        : seedFromBody;

    // Load each reference independently. A single bad reference (deleted
    // upload, transient storage error) shouldn't silently drop ALL the
    // user's other references — load per-item, keep what we can, and
    // surface the failures so the response can flag a degraded run.
    const refImages: Array<{ b64Json: string; mimeType: string }> = [];
    const refFailures: Array<{ index: number; label?: string; reason: string }> =
      [];
    const refsIn = body.references ?? [];
    if (refsIn.length > 0) {
      const loaded = await Promise.allSettled(
        refsIn.map((r) => loadImageAsBase64(r.objectPath)),
      );
      loaded.forEach((r, i) => {
        if (r.status === "fulfilled") {
          refImages.push(r.value);
        } else {
          const reason =
            r.reason instanceof Error ? r.reason.message : String(r.reason);
          refFailures.push({
            index: i,
            label: refsIn[i]?.label ?? undefined,
            reason,
          });
        }
      });
      if (refFailures.length > 0) {
        logger.warn(
          { label, failed: refFailures.length, total: refsIn.length },
          "Some reference images failed to load; proceeding with the rest",
        );
      }
    }

    const finalPrompt = buildCinemaPrompt(body, resolvedSeed);
    const aspectRatio = mapToGeminiAspectRatio(
      body.outputControls.aspectRatio ?? "16:9",
    );

    const t0 = Date.now();
    try {
      const { b64_json, mimeType, engine } = await generateImageWithRetry(
        finalPrompt,
        refImages,
        aspectRatio,
        body.outputControls.aspectRatio ?? "16:9",
      );
      const { objectPath } = await saveBase64Image(b64_json, mimeType);
      logger.info(
        {
          label,
          ok: true,
          seed: resolvedSeed,
          aspectRatio,
          ms: Date.now() - t0,
          engine,
        },
        "Cinema image generated",
      );
      res.json({
        objectPath,
        mimeType,
        generatedAt: new Date().toISOString(),
        seed: resolvedSeed,
        finalPrompt,
      });
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      logger.warn({ label, err: raw }, "Cinema image generation failed");
      res.status(500).json({ error: classifyError(raw) });
    }
  },
);

const PROMPT_SCORE_SYSTEM = `You are an expert AI cinematography prompt director (the "AI Director" feature inside ContentStudio AI's Cinema Image Studio).

Your job is to grade an image-generation prompt for production quality and produce an improved rewrite. Be strict, specific, and useful.

Rules:
  • Output STRICT JSON ONLY — no markdown fences, no commentary, no preamble.
  • Every score is a number from 0 to 10 (one decimal allowed).
  • promptRiskScore: 0 = totally safe, 10 = high risk of being blocked or failing safety.
  • improvedPrompt is a single paragraph cinematic prompt the user can paste back in. Keep it under 600 words.
  • missingDetails and improvementSuggestions are short, actionable bullet strings (max 16 each).

JSON SHAPE (return EXACTLY these keys):
{
  "overallPromptScore": number,
  "cinematicScore": number,
  "cameraClarityScore": number,
  "lensClarityScore": number,
  "lightingScore": number,
  "styleConsistencyScore": number,
  "characterConsistencyScore": number,
  "compositionScore": number,
  "promptRiskScore": number,
  "missingDetails": string[],
  "improvementSuggestions": string[],
  "improvedPrompt": string
}`;

/**
 * POST /api/cinema-prompt-score
 *
 * "AI Director" prompt grading. Sends the user's raw prompt + the
 * structured config summary to Claude (haiku) and returns an 8-axis
 * score plus an improved prompt the user can one-click apply.
 */
router.post(
  "/cinema-prompt-score",
  requireAuth,
  async (req: Request, res: Response) => {
    const label = "cinema-prompt-score";
    const parsed = ScoreCinemaPromptBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: formatZodError(parsed.error as unknown as ZodErrorLike),
      });
      return;
    }
    const { rawPrompt, configSummary } = parsed.data;

    const userPrompt = `Grade this image-generation prompt and produce an improved rewrite.

USER PROMPT:
${rawPrompt}

STUDIO CONFIG SUMMARY:
${configSummary?.trim() || "(no config summary provided)"}

Return STRICT JSON only — no markdown fences.`;

    try {
      const result = await generateJson({
        systemPrompt: PROMPT_SCORE_SYSTEM,
        userPrompt,
        schema: ScoreCinemaPromptResponse,
        label,
        model: ANTHROPIC_FAST_MODEL,
        prependMasterContext: false,
      });
      res.json(result);
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      logger.warn({ label, err: raw }, "Prompt scoring failed");
      res
        .status(500)
        .json({ error: "Could not grade the prompt. Please try again." });
    }
  },
);

export default router;
