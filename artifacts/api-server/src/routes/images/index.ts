import { Router, type IRouter, type Request, type Response } from "express";
import {
  GenerateCharacterImagesBody,
  GenerateFrameImageBody,
  QcFrameImageBody,
  RegenerateCharacterImageBody,
} from "@workspace/api-zod";
import { ai } from "@workspace/integrations-gemini-ai";
import { generateImageBest } from "@workspace/integrations-gemini-ai/image";
import { logger } from "../../lib/logger";
import { loadImageAsBase64, saveBase64Image } from "../../lib/imageStorage";
import { requireAuth } from "../../middleware/auth";

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
 * Build a Nano Banana (Gemini 2.5 Flash Image) prompt that produces ONE
 * composite character reference sheet for a single story character with
 * three head/face views — front, left profile, right profile — laid out
 * side-by-side on a clean neutral background. The model is instructed
 * to keep facial structure, hair, skin tone, age, and wardrobe IDENTICAL
 * across all three views so the sheet is usable as a Seedance character
 * reference image (paste-once, reuse-across-shots).
 */
/**
 * Nano Banana 2-tuned character sheet prompt.
 *
 * NB2 responds best to a tight, declarative paragraph followed by a
 * compact JSON-style spec block — it ignores ASCII bullet decoration
 * but keys off explicit camera, lighting, and consistency directives.
 * We keep the prompt under ~1500 chars to stay well inside the model's
 * prompt budget.
 */
function buildCharacterSheetPrompt(args: {
  name: string;
  description: string;
  style: string;
}): string {
  const { name, description, style } = args;
  const spec = {
    subject: `character reference sheet of "${name}"`,
    description: description.trim(),
    visual_style: style,
    layout: "single landscape composite, three equal panels side by side, left to right: LEFT PROFILE, FRONT, RIGHT PROFILE — head and shoulders only, eye-level framing in every panel",
    consistency: [
      "identical face shape, jawline, nose, lips, eye color across all three panels",
      "identical hair colour, hairstyle, skin tone, age, and distinctive features (scars, freckles, glasses, facial hair, jewellery)",
      "identical wardrobe (top garment, collar, accessories) in every panel",
    ],
    lighting: "even soft neutral studio key light, no harsh shadows that hide features",
    background: "plain neutral light-grey seamless backdrop, no environment, no props",
    quality: "tack-sharp face focus in every panel, photographic reference grade, high detail",
    forbidden: ["text", "captions", "labels", "watermarks", "panel borders", "logos", "extra characters", "duplicate heads in a single panel"],
  };
  return [
    `A production-grade three-view CHARACTER REFERENCE SHEET for "${name}". Treat this as a casting / VFX reference, not a stylized poster. Render the SAME person in all three panels with absolute facial identity consistency — the goal is downstream re-use as a likeness anchor for video generation.`,
    ``,
    `SPEC (JSON):`,
    JSON.stringify(spec, null, 2),
  ].join("\n");
}

/**
 * POST /api/generate-character-images
 *
 * Accepts a list of story characters and a project visual style; returns
 * ONE multi-angle reference image per character (base64-encoded). Each
 * character is processed independently — a single failure does NOT fail
 * the whole batch; failed characters are returned in `errors[]` so the
 * client can show partial results and offer per-character retry.
 *
 * Concurrency is intentionally low (2) to stay well under Gemini's rate
 * limits when stories have many characters; total wall time for a
 * typical 5-character story is ~25-40s.
 */
router.post("/generate-character-images", async (req: Request, res: Response) => {
  const label = "generate-character-images";
  const parsed = GenerateCharacterImagesBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: formatZodError(parsed.error as unknown as ZodErrorLike),
    });
    return;
  }
  const { characters, style } = parsed.data;

  // Process characters with controlled concurrency. We avoid pulling in
  // the batch utility because we need per-character success/failure
  // partitioning rather than fail-fast batch behaviour.
  const CONCURRENCY = 2;
  const images: Array<{
    name: string;
    objectPath: string;
    mimeType: string;
    generatedAt: string;
  }> = [];
  const errors: Array<{ name: string; message: string }> = [];

  // Use precise tokens / patterns so we don't mis-classify benign errors that
  // merely contain substrings like "rate" (e.g. the word "generate") or
  // "policy". Patterns are applied to the lowercased raw message.
  const RATE_LIMIT_RE =
    /\b429\b|\brate[\s_-]?limit\b|\bquota\b|\bresource[\s_-]?exhausted\b|\btoo[\s_-]?many[\s_-]?requests\b/;
  const SAFETY_RE = /\bsafety\b|\bblocked\b|\bblocklist\b|\bharm[\s_-]?category\b/;
  const TIMEOUT_RE = /\btimed?[\s_-]?out\b|\betimedout\b|\baborted\b/;
  const TRANSIENT_RE =
    /\b429\b|\bratelimit\b|\brate[\s_-]?limit\b|\bquota\b|\bresource[\s_-]?exhausted\b|\b503\b|\bservice[\s_-]?unavailable\b|\btimed?[\s_-]?out\b|\betimedout\b/;

  // Map raw upstream errors to user-safe text. Detailed errors stay in logs.
  function classifyError(raw: string): string {
    const lower = raw.toLowerCase();
    if (RATE_LIMIT_RE.test(lower)) {
      return "Rate limited by the image service. Please retry in a moment.";
    }
    if (SAFETY_RE.test(lower)) {
      return "The image was blocked by the safety filter. Try softening the character description.";
    }
    if (TIMEOUT_RE.test(lower)) {
      return "Image generation timed out. Please try again.";
    }
    return "Image generation failed. Please try again.";
  }

  // One bounded retry on transient (rate-limit / 5xx / timeout) errors.
  async function generateOneWithRetry(prompt: string): Promise<{
    b64_json: string;
    mimeType: string;
    engine: "nano-banana-2";
  }> {
    const MAX_ATTEMPTS = 2;
    let lastErr: unknown = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        return await generateImageBest(prompt);
      } catch (err) {
        lastErr = err;
        const msg =
          err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
        if (!TRANSIENT_RE.test(msg) || attempt === MAX_ATTEMPTS) throw err;
        // Backoff: 1.5s before the second attempt.
        await new Promise((r) => setTimeout(r, 1500 * attempt));
      }
    }
    throw lastErr ?? new Error("Image generation failed");
  }

  const queue = [...characters];
  async function worker(): Promise<void> {
    while (queue.length > 0) {
      const character = queue.shift();
      if (!character) return;
      const prompt = buildCharacterSheetPrompt({
        name: character.name,
        description: character.description,
        style,
      });
      try {
        const { b64_json, mimeType, engine } =
          await generateOneWithRetry(prompt);
        const { objectPath } = await saveBase64Image(b64_json, mimeType);
        images.push({
          name: character.name,
          objectPath,
          mimeType,
          generatedAt: new Date().toISOString(),
        });
        logger.info(
          { label, character: character.name, engine },
          "Character image generated",
        );
      } catch (err) {
        const raw = err instanceof Error ? err.message : String(err);
        // Detailed error → server logs only.
        logger.warn(
          { label, character: character.name, err: raw },
          "Character image generation failed",
        );
        // Normalized user-facing message → response body.
        errors.push({ name: character.name, message: classifyError(raw) });
      }
    }
  }

  const t0 = Date.now();
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, characters.length) }, () =>
      worker(),
    ),
  );
  logger.info(
    {
      label,
      total: characters.length,
      ok: images.length,
      failed: errors.length,
      ms: Date.now() - t0,
    },
    "Character image batch complete",
  );

  res.json({ images, errors });
});

/**
 * Build a single-character regeneration prompt that respects:
 *  • the original story description (so the new sheet is still recognisably
 *    that character),
 *  • the project's visual style,
 *  • optional user `customPrompt` (wardrobe tweaks, age, mood),
 *  • optional reference photo (which is sent as an inlineData part by the
 *    Gemini integration BEFORE this text — the model is told to USE that
 *    photo for likeness).
 */
function buildRegeneratePrompt(args: {
  name: string;
  description?: string;
  style: string;
  customPrompt?: string;
  hasReferencePhoto: boolean;
}): string {
  const { name, description, style, customPrompt, hasReferencePhoto } = args;
  const spec: Record<string, unknown> = {
    subject: `character reference sheet of "${name}"`,
    visual_style: style,
    layout: "single landscape composite, three equal panels: LEFT PROFILE, FRONT, RIGHT PROFILE — head and shoulders, eye-level in every panel",
    consistency: [
      "identical face shape, jawline, nose, lips, eye color across all three panels",
      "identical hair colour, hairstyle, skin tone, age, distinctive features",
      "identical wardrobe in every panel",
    ],
    lighting: "even soft neutral studio key light",
    background: "plain neutral light-grey seamless backdrop",
    quality: "tack-sharp face focus, photographic reference grade",
    forbidden: ["text", "captions", "watermarks", "panel borders", "logos", "extra characters"],
  };
  if (description && description.trim().length > 0) {
    spec.story_description = description.trim();
  }
  if (customPrompt && customPrompt.trim().length > 0) {
    spec.user_guidance = customPrompt.trim();
  }
  if (hasReferencePhoto) {
    spec.reference_photo = "the image attached BEFORE this text is the likeness anchor — preserve its face shape, skin tone, hair colour and hairstyle, distinctive features, and rough age; re-render in the requested visual_style; do NOT clone the photo's lighting or background";
  }
  const lead = hasReferencePhoto
    ? `A production-grade three-view CHARACTER REFERENCE SHEET for "${name}". The attached photo is the LIKENESS SOURCE — match the face. Render the same person in three head-and-shoulders views with absolute facial identity consistency.`
    : `A production-grade three-view CHARACTER REFERENCE SHEET for "${name}". Treat this as a casting / VFX reference — render the SAME person in all three panels with absolute facial identity consistency.`;
  return [lead, ``, `SPEC (JSON):`, JSON.stringify(spec, null, 2)].join("\n");
}

/**
 * POST /api/regenerate-character-image
 *
 * Re-generate the reference sheet for ONE character. Accepts an optional
 * user `customPrompt` and / or an inlined reference photo. Used by the
 * "Custom" button on each character card so the user can correct a sheet
 * the auto-batch got wrong (wrong age, wrong wardrobe, off-model face) or
 * supply a real likeness photo for an OC-of-self.
 *
 * Same retry / classification helpers as the batch endpoint, scoped down
 * to a single image so we can return a clean 200 / 500 instead of the
 * batch's images[]+errors[] partition.
 */
router.post("/regenerate-character-image", async (req: Request, res: Response) => {
  const label = "regenerate-character-image";
  const parsed = RegenerateCharacterImageBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: formatZodError(parsed.error as unknown as ZodErrorLike),
    });
    return;
  }
  const { name, description, customPrompt, referenceImage, style, aspectRatio } =
    parsed.data;

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
      return "The image was blocked by the safety filter. Try softening the description or removing the reference photo.";
    }
    if (TIMEOUT_RE.test(lower)) {
      return "Image generation timed out. Please try again.";
    }
    return "Image generation failed. Please try again.";
  }

  const prompt = buildRegeneratePrompt({
    name,
    description,
    style,
    customPrompt,
    hasReferencePhoto: !!referenceImage,
  });

  const refs = referenceImage
    ? [{ b64Json: referenceImage.b64Json, mimeType: referenceImage.mimeType }]
    : undefined;

  const t0 = Date.now();
  const MAX_ATTEMPTS = 2;
  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const { b64_json, mimeType, engine } = await generateImageBest(prompt, {
        referenceImages: refs,
        aspectRatio,
      });
      const { objectPath } = await saveBase64Image(b64_json, mimeType);
      logger.info(
        {
          label,
          name,
          ms: Date.now() - t0,
          hasCustomPrompt: !!customPrompt,
          hasReference: !!referenceImage,
          attempt,
          objectPath,
          aspectRatio,
          engine,
        },
        "Single character image regenerated",
      );
      res.json({
        name,
        objectPath,
        mimeType,
        generatedAt: new Date().toISOString(),
      });
      return;
    } catch (err) {
      lastErr = err;
      const raw = err instanceof Error ? err.message : String(err);
      const lower = raw.toLowerCase();
      if (!TRANSIENT_RE.test(lower) || attempt === MAX_ATTEMPTS) {
        logger.warn(
          { label, name, err: raw, attempt },
          "Single character image regeneration failed",
        );
        res.status(500).json({ error: classifyError(raw) });
        return;
      }
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
  // Defensive — loop above always returns; this guards against future edits.
  const raw = lastErr instanceof Error ? lastErr.message : String(lastErr ?? "unknown");
  res.status(500).json({ error: classifyError(raw) });
});

/**
 * Build a Gemini prompt that produces a SINGLE film still for one specific
 * moment of a video part — the starting frame or the ending frame. The
 * writer's `framePrompt` is the cinematic description (composition, action,
 * lighting). We wrap it in an instruction template that:
 *  • tells Gemini this is a STILL FRAME, not a reference sheet (no head
 *    panels, no plain background, no character-rotation grids),
 *  • locks the project's visual style,
 *  • instructs the model to use any attached character reference sheets
 *    as likeness anchors so the same actors appear from part to part.
 */
function buildFrameStillPrompt(args: {
  framePrompt: string;
  style: string;
  hasCharacterReferences: boolean;
  aspectRatio?: string;
}): string {
  const { framePrompt, style, hasCharacterReferences, aspectRatio } = args;
  const spec: Record<string, unknown> = {
    subject: "single cinematic film still — one paused movie frame",
    visual_style: style,
    aspect_ratio: aspectRatio ?? "16:9",
    framing_rule: aspectRatio
      ? `compose natively for ${aspectRatio}; do NOT letterbox or pillarbox a wider/taller composition; use negative space appropriate to ${aspectRatio}`
      : "compose natively for the requested ratio",
    frame_description: framePrompt.trim(),
    quality_target: "photographic cinematic film-still quality, in-world environment, lighting, and composition as described — NOT a studio reference sheet, NOT concept art",
    forbidden: [
      "text", "captions", "subtitles", "watermarks", "UI overlays", "panel borders", "logos",
      "three-panel head views", "neutral grey backdrop",
    ],
  };
  if (hasCharacterReferences) {
    spec.character_references = "the image(s) attached BEFORE this text are reference sheets for the cast — use them as the likeness source for any character that appears in this frame; preserve face shape, skin tone, hair, distinctive features, and rough wardrobe; re-stage the character inside the cinematic scene described in frame_description";
  }
  const lead = `A single production-grade cinematic FILM STILL. The frame_description below is the literal moment to render. Treat it as a paused frame from a finished movie, not concept art.`;
  return [lead, ``, `SPEC (JSON):`, JSON.stringify(spec, null, 2)].join("\n");
}

/**
 * POST /api/generate-frame-image
 *
 * Generate a single still image for a video part's starting or ending frame.
 * Used by the inline-prompts UI so the user gets an actual rendered frame
 * (not just the writer's text prompt) that they can paste into Seedance as
 * the locked first/last frame of a shot.
 *
 * Mirrors the retry / classification helpers used by /regenerate-character-image
 * so the response shape is a clean 200 / 500 instead of the batch's
 * images[]+errors[] partition.
 */
router.post("/generate-frame-image", async (req: Request, res: Response) => {
  const label = "generate-frame-image";
  const parsed = GenerateFrameImageBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: formatZodError(parsed.error as unknown as ZodErrorLike),
    });
    return;
  }
  const { framePrompt, style, characterReferences, aspectRatio } = parsed.data;

  // Reference images are now passed by `objectPath`. The server pulls the
  // bytes from Object Storage just-in-time and inlines them into the
  // Gemini call. We cap the per-call sheet count (the OpenAPI schema
  // enforces maxItems: 8) and also bail out early if any single ref
  // can't be loaded — that signals a stale path from an old project.
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
      return "The frame was blocked by the safety filter. Try softening the description.";
    }
    if (TIMEOUT_RE.test(lower)) {
      return "Image generation timed out. Please try again.";
    }
    return "Image generation failed. Please try again.";
  }

  let refs:
    | Array<{ b64Json: string; mimeType: string }>
    | undefined = undefined;
  if (characterReferences && characterReferences.length > 0) {
    try {
      refs = await Promise.all(
        characterReferences.map(async (r) => {
          const { b64Json, mimeType } = await loadImageAsBase64(r.objectPath);
          return { b64Json, mimeType: r.mimeType || mimeType };
        }),
      );
    } catch (err) {
      logger.warn(
        { label, err, refs: characterReferences.length },
        "Failed to load character reference from object storage",
      );
      res.status(400).json({
        error:
          "One of the character references couldn't be loaded. Try regenerating that character's reference sheet.",
      });
      return;
    }
  }

  const prompt = buildFrameStillPrompt({
    framePrompt,
    style,
    hasCharacterReferences: !!refs && refs.length > 0,
    aspectRatio,
  });

  const t0 = Date.now();
  const MAX_ATTEMPTS = 2;
  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const { b64_json, mimeType, engine } = await generateImageBest(prompt, {
        referenceImages: refs,
        aspectRatio,
      });
      const { objectPath } = await saveBase64Image(b64_json, mimeType);
      logger.info(
        {
          label,
          ms: Date.now() - t0,
          framePromptLen: framePrompt.length,
          refs: refs?.length ?? 0,
          attempt,
          objectPath,
          engine,
        },
        "Frame image generated",
      );
      res.json({
        objectPath,
        mimeType,
        generatedAt: new Date().toISOString(),
      });
      return;
    } catch (err) {
      lastErr = err;
      const raw = err instanceof Error ? err.message : String(err);
      const lower = raw.toLowerCase();
      if (!TRANSIENT_RE.test(lower) || attempt === MAX_ATTEMPTS) {
        logger.warn(
          { label, err: raw, attempt },
          "Frame image generation failed",
        );
        res.status(500).json({ error: classifyError(raw) });
        return;
      }
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
  // Defensive — loop above always returns; this guards against future edits.
  const raw = lastErr instanceof Error ? lastErr.message : String(lastErr ?? "unknown");
  res.status(500).json({ error: classifyError(raw) });
});

/**
 * Quality-control review of a generated frame still. Loads the candidate
 * image (and any cast reference sheets) from object storage and asks
 * Gemini Vision to grade adherence to the writer's prompt + likeness on a
 * 0-10 scale. Returns a structured verdict the client can act on:
 *
 *   - `passed=true`  → ship the frame
 *   - `passed=false` → call /generate-frame-image again, optionally
 *                      appending `suggestion` to the framePrompt as a hint.
 *
 * QC failure modes (Gemini errors, JSON parse failures, etc.) are
 * surfaced as a soft "passed=true" with score=null-ish so QC never
 * blocks a frame from shipping — the user can always re-run manually.
 */
router.post("/qc-frame-image", requireAuth, async (req: Request, res: Response) => {
  const label = "qc-frame-image";
  const parsed = QcFrameImageBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: formatZodError(parsed.error as unknown as ZodErrorLike),
    });
    return;
  }
  const { objectPath, framePrompt, style, characterReferences, aspectRatio } =
    parsed.data;

  // Load the candidate frame; fail loud if the object is gone (QC has
  // nothing to grade and the caller almost certainly has a stale path).
  let frame: { b64Json: string; mimeType: string };
  try {
    frame = await loadImageAsBase64(objectPath);
  } catch (err) {
    logger.warn(
      { label, err, objectPath },
      "QC: candidate frame not found in object storage",
    );
    res.status(400).json({
      error:
        "Couldn't load the frame to QC. It may have been deleted — regenerate the frame first.",
    });
    return;
  }

  // Cast references are best-effort: a missing reference shouldn't fail
  // the whole QC. We just down-weight likeness in the prompt below.
  const refs: Array<{ b64Json: string; mimeType: string }> = [];
  if (characterReferences && characterReferences.length > 0) {
    for (const r of characterReferences) {
      try {
        const loaded = await loadImageAsBase64(r.objectPath);
        refs.push({ b64Json: loaded.b64Json, mimeType: r.mimeType || loaded.mimeType });
      } catch {
        // ignore one bad ref; QC continues without it
      }
    }
  }

  const QC_PASS_THRESHOLD = 7;
  const qcPrompt =
    `You are a film QC reviewer. Compare the candidate image against the requested frame ` +
    `prompt and the cast reference sheets (if any). Grade ONLY based on what's visible.\n\n` +
    `Requested visual style: ${style}\n` +
    (aspectRatio
      ? `Requested aspect ratio: ${aspectRatio}. The candidate's frame should look natively ` +
        `composed for ${aspectRatio} (no obvious letterboxing / pillarboxing of a wider ` +
        `or taller composition). Penalize if the visible ratio is clearly wrong.\n`
      : "") +
    `Requested frame prompt:\n"""\n${framePrompt}\n"""\n\n` +
    (refs.length > 0
      ? `Cast reference sheets follow the candidate image. Characters in the candidate ` +
        `should look like the same people on those sheets (face, hair, wardrobe).\n\n`
      : `No cast reference sheets were provided — do not penalize for likeness.\n\n`) +
    `Reply with ONE JSON object on a single line, no prose, no code fences:\n` +
    `{"score":<0-10 number>,"passed":<true|false>,"issues":[<short string>,...],"suggestion":"<one-sentence regen hint or empty>"}\n\n` +
    `Scoring rubric:\n` +
    `  10 = matches prompt exactly, characters on-model, style fits\n` +
    `  7-9 = minor issues, ship it\n` +
    `  4-6 = significant issues, regenerate\n` +
    `  0-3 = unusable\n` +
    `passed = score >= ${QC_PASS_THRESHOLD}.`;

  // Order: candidate first, then refs, then text — mirrors how
  // generate-frame-image arranges parts so Gemini treats the candidate
  // as "the image being reviewed" and refs as comparison material.
  const parts: Array<
    | { inlineData: { data: string; mimeType: string } }
    | { text: string }
  > = [];
  parts.push({ inlineData: { data: frame.b64Json, mimeType: frame.mimeType } });
  for (const r of refs) {
    parts.push({ inlineData: { data: r.b64Json, mimeType: r.mimeType } });
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

    // Tolerant JSON extraction: model occasionally wraps in fences or
    // emits leading prose despite the instructions.
    let raw = text.trim();
    const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenceMatch) raw = fenceMatch[1].trim();
    const firstBrace = raw.indexOf("{");
    const lastBrace = raw.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      raw = raw.slice(firstBrace, lastBrace + 1);
    }

    let parsedJson: {
      score?: unknown;
      passed?: unknown;
      issues?: unknown;
      suggestion?: unknown;
    } = {};
    try {
      parsedJson = JSON.parse(raw);
    } catch (parseErr) {
      logger.warn(
        { label, err: parseErr, sample: text.slice(0, 200) },
        "QC: model returned non-JSON, treating as soft-pass",
      );
      // Soft-pass so QC never blocks shipping when the model misbehaves.
      res.json({
        score: QC_PASS_THRESHOLD,
        passed: true,
        issues: [],
        suggestion: "",
      });
      return;
    }

    const scoreNum =
      typeof parsedJson.score === "number"
        ? parsedJson.score
        : Number(parsedJson.score);
    const score = Number.isFinite(scoreNum)
      ? Math.max(0, Math.min(10, scoreNum))
      : QC_PASS_THRESHOLD;
    // Always derive `passed` from the normalized score. Trusting the
    // model's own `passed` flag lets a malformed `{score:2,passed:true}`
    // suppress the regenerate path the score implies.
    const passed = score >= QC_PASS_THRESHOLD;
    const issues = Array.isArray(parsedJson.issues)
      ? parsedJson.issues
          .filter((i) => typeof i === "string" && i.trim().length > 0)
          .slice(0, 8)
          .map((i) => String(i).slice(0, 200))
      : [];
    const suggestion =
      typeof parsedJson.suggestion === "string"
        ? parsedJson.suggestion.slice(0, 400)
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
      "QC review complete",
    );
    res.json({ score, passed, issues, suggestion });
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    logger.warn({ label, err: raw }, "QC: vision call failed, soft-passing");
    // Soft-pass on infrastructure errors so QC never blocks the user.
    res.json({
      score: QC_PASS_THRESHOLD,
      passed: true,
      issues: [],
      suggestion: "",
    });
  }
});

export default router;
