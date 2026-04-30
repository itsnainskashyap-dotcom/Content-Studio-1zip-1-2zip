import { anthropic } from "@workspace/integrations-anthropic-ai";
import { logger } from "../../lib/logger";
import {
  MASTER_SYSTEM_CONTEXT,
  applyModelTokens,
  getVideoModelProfile,
  DEFAULT_VIDEO_MODEL,
} from "./prompts";

// Model names are overridable so the same code path works on both the
// direct Anthropic API and Vertex AI (which requires version-suffixed
// model IDs like `claude-sonnet-4-6@20251015`).
const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6";
const FAST_MODEL = process.env.ANTHROPIC_FAST_MODEL ?? "claude-haiku-4-5";

export { MODEL as ANTHROPIC_MODEL };
export { FAST_MODEL as ANTHROPIC_FAST_MODEL };
export { anthropic as anthropicClient };

/**
 * Multi-agent model dispatch — invisible to the user.
 *
 * Every prompt-generating route (story, continue-story, video-prompts,
 * edit-video-prompts, music-brief) runs on Sonnet so the JSON envelope
 * quality the validation pipeline depends on never regresses.
 *
 * Lightweight text-rewrite routes (voiceover, expand-prompt, trim-prompt)
 * run on Haiku purely as a backend-only speed optimisation. The user does
 * not pick a model and does not see one — the speedup just happens.
 */
export function pickModel(args: {
  route:
    | "generate-story"
    | "continue-story"
    | "generate-video-prompts"
    | "edit-video-prompts"
    | "generate-voiceover"
    | "generate-music-brief"
    | "expand-prompt"
    | "trim-prompt";
}): string {
  if (
    args.route === "generate-voiceover" ||
    args.route === "expand-prompt" ||
    args.route === "trim-prompt"
  ) {
    return FAST_MODEL;
  }
  return MODEL;
}

/**
 * Reference image attached to a user message. Sent as an Anthropic
 * `image` content block alongside the text user prompt so the model can
 * literally SEE the character/location/style we want it to honor.
 */
export interface InlineReferenceImage {
  /** Base64-encoded image bytes (no data URL prefix). */
  b64Json: string;
  /** MIME type — Anthropic supports image/png, image/jpeg, image/webp, image/gif. */
  mimeType: string;
  /** Short caption shown to the model right above the image. */
  caption?: string;
}
// Per-route max output token budget. The all-in-one Seedance video-prompts
// JSON now has a HARD-CAPPED copyablePrompt of 4500 chars (~1500 tokens
// for English, ~3000 tokens when Hinglish/Devanagari is mixed in — those
// scripts cost ~2x tokens per char). Add the structured shots /
// effectsInventory / densityMap / energyArc fields (~1500-2500 tokens),
// plus an autoVoiceoverScript that for a 90s Hindi VO can reach 1500+
// tokens by itself, plus JSON envelope/escape overhead — realistic
// worst-case output for a long-story heavy-shot Hindi part is ~9-12K
// tokens. The PREVIOUS 8000 cap was right on that edge: the model's
// first-attempt overshoot (before the validate-retry can ask "be more
// concise") would silently truncate, the JSON would be malformed, and
// the user saw "the AI's response was too long and got cut off". Bumping
// to 16000 gives 2× headroom so a single overshoot can complete in full
// and be caught by the length validator instead of the truncation guard.
// Sonnet 4.6 supports 64K output tokens; the cap doesn't affect latency
// or cost — generation time and billing scale with tokens actually
// produced, not with the cap.
const DEFAULT_MAX_TOKENS = 8192;
const VIDEO_PROMPTS_MAX_TOKENS = 16000;
// Story generation must scale to long-form videos (10-min videos = 40 parts
// × ~15s). The story object is the SINGLE source of truth that EVERY one of
// those 40 per-part video-prompt calls re-reads, so for long videos the
// story prompt itself instructs the model to produce 5-7 acts with 12-25
// sentence descriptions per act and 5-8 characters with 4-8 sentence
// visually-reproducible profiles. That output can easily reach 12-15K
// tokens for a 10-min video. 16000 gives comfortable headroom plus retry
// margin without being so large it slows short-story generation (Anthropic
// only bills/streams the actual produced tokens, not the cap).
const STORY_MAX_TOKENS = 16000;

function maxTokensForLabel(label: string): number {
  if (label === "generate-video-prompts") return VIDEO_PROMPTS_MAX_TOKENS;
  if (label === "edit-video-prompts") return VIDEO_PROMPTS_MAX_TOKENS;
  if (label === "generate-story") return STORY_MAX_TOKENS;
  if (label === "continue-story") return STORY_MAX_TOKENS;
  return DEFAULT_MAX_TOKENS;
}

export type ValidationFailure = {
  /** Human-readable reason the result is unacceptable. */
  reason: string;
  /** Extra system-side instruction appended for the next retry. */
  retryInstruction: string;
};

/**
 * Allows a route to recover from final validation failure by post-processing
 * the model's attempts (e.g. picking the closest-to-band copyablePrompt
 * across retries). If present and it returns a non-null value, that value is
 * returned to the caller instead of throwing. Receives every parsed-but-
 * failed attempt in chronological order alongside the last validation
 * failure.
 */
export type FinalRecover<T> = (
  attempts: Array<{ result: T; failure: ValidationFailure }>,
) => T | null | Promise<T | null>;

export async function generateJson<T>(args: {
  systemPrompt: string;
  userPrompt: string;
  schema: { parse: (input: unknown) => T };
  label: string;
  /**
   * Optional post-parse validator. Return null if the result is acceptable, or
   * a ValidationFailure to trigger a retry with a targeted instruction. Used
   * by video-prompts to enforce the strict 4200-4500 char copyablePrompt band
   * even when the model ignores the system prompt's word limit.
   */
  validate?: (result: T) => ValidationFailure | null;
  /**
   * Optional final-attempt recovery. After all validation retries are
   * exhausted, this is called with the last parsed result and the last
   * validation failure. If it returns a value, that value is returned to
   * the caller; otherwise a generation-failed error is thrown. Used by
   * video-prompts to fall back to truncating an over-length copyablePrompt
   * rather than failing the whole request.
   */
  finalRecover?: FinalRecover<T>;
  /**
   * Optional inline reference images. Sent as Anthropic image content
   * blocks alongside the text user prompt so the model can literally SEE
   * the characters/locations/style references the writer attached.
   */
  referenceImages?: InlineReferenceImage[];
  /**
   * If true (default), MASTER_SYSTEM_CONTEXT is prepended to systemPrompt
   * so every Claude call shares the same project preamble. Internal
   * helpers that build their own systems can opt out.
   */
  prependMasterContext?: boolean;
  /**
   * Multi-agent override: which Anthropic model to use for this call.
   * When omitted defaults to `MODEL` (claude-sonnet-4-6). Routes that
   * honour the per-project AI quality tier resolve the model upstream
   * via `pickModel(...)` and pass it through here.
   */
  model?: string;
  /**
   * Writer-selected target VIDEO model (e.g. "veo-3", "seedance-2.0",
   * "sora", "kling-2.1"). Used to substitute `{{TARGET_MODEL}}` /
   * `{{TARGET_MODEL_SLUG}}` / etc. tokens in MASTER_SYSTEM_CONTEXT and
   * the per-route systemPrompt so the LLM produces output tailored to
   * the writer's chosen video model rather than defaulting to literal
   * placeholder text or the legacy "Seedance 2.0" hardcode.
   *
   * When omitted, falls back to DEFAULT_VIDEO_MODEL (Seedance) — but
   * any route that lets the user pick a video model SHOULD pass this
   * through, otherwise the prompt drifts back to Seedance defaults.
   */
  videoModel?: string;
}): Promise<T> {
  const {
    systemPrompt,
    userPrompt,
    schema,
    label,
    validate,
    finalRecover,
    referenceImages,
    prependMasterContext = true,
    model = MODEL,
    videoModel,
  } = args;
  const maxTokens = maxTokensForLabel(label);
  // Substitute {{TARGET_MODEL_*}} tokens in BOTH the master context and
  // the route's system prompt so the LLM sees concrete model names
  // throughout — never literal `{{TARGET_MODEL}}` placeholders. Routes
  // that build their system prompt via `buildVideoPromptSystem` already
  // run this substitution once; running it again here is a safe no-op
  // (every token has been replaced) and ensures MASTER_SYSTEM_CONTEXT,
  // which references {{TARGET_MODEL}}, is always covered too.
  const profile = getVideoModelProfile(videoModel ?? DEFAULT_VIDEO_MODEL);
  const masterCtx = applyModelTokens(MASTER_SYSTEM_CONTEXT, profile);
  const routeSystem = applyModelTokens(systemPrompt, profile);
  const fullSystem = prependMasterContext
    ? `${masterCtx}\n\n${routeSystem}`
    : routeSystem;

  // Track the latest raw model response across attempts so terminal-failure
  // logging can include a snippet of what the model actually produced. This
  // is critical for diagnosing "invalid response" failures — without it we
  // throw a generic error and have no idea WHAT shape the model returned.
  // Use a wrapper object so TS doesn't narrow the variable's type to
  // `null` when it sees only the `null` initializer and assignments
  // inside a nested closure.
  const rawState: { value: string | null } = { value: null };
  let lastFailureStage: string | null = null;

  const attempt = async (extraSystem?: string): Promise<T> => {
    // Clear per-attempt state so terminal-failure logs only ever show
    // the response from the FINAL attempt, never a stale snippet from
    // an earlier successful text-extraction.
    rawState.value = null;
    let message;
    try {
      // Build user content. Plain string when no images attached (most
      // common path) so existing Anthropic SDK behaviour is unchanged.
      // When references exist, send a content array: text block first,
      // then one image block per reference (Claude reads in order).
      const userContent =
        referenceImages && referenceImages.length > 0
          ? [
              { type: "text" as const, text: userPrompt },
              ...referenceImages.flatMap((img) => {
                const blocks: Array<
                  | { type: "text"; text: string }
                  | {
                      type: "image";
                      source: {
                        type: "base64";
                        media_type: string;
                        data: string;
                      };
                    }
                > = [];
                if (img.caption) {
                  blocks.push({
                    type: "text" as const,
                    text: `Reference image — ${img.caption}:`,
                  });
                }
                blocks.push({
                  type: "image" as const,
                  source: {
                    type: "base64" as const,
                    media_type: img.mimeType,
                    data: img.b64Json,
                  },
                });
                return blocks;
              }),
            ]
          : userPrompt;

      message = await anthropic.messages.create({
        model,
        max_tokens: maxTokens,
        system: extraSystem ? `${fullSystem}\n\n${extraSystem}` : fullSystem,
        // Cast: the Anthropic SDK types for `content` accept both string
        // and the content-block array union. The union shape we build
        // above matches the SDK's `MessageParam.content` definition.
        messages: [{ role: "user", content: userContent as never }],
      });
    } catch (err) {
      lastFailureStage = "anthropic-api";
      const detail = err instanceof Error ? err.message : String(err);
      throw new Error(`Anthropic API call failed for ${label}: ${detail}`);
    }

    // If the model hit the output cap mid-response we'll have invalid JSON
    // — surface that as a distinct, actionable error instead of letting
    // JSON.parse blow up at a confusing position.
    if (message.stop_reason === "max_tokens") {
      lastFailureStage = "truncated";
      throw new Error(
        `Model response was truncated at the ${maxTokens}-token output cap for ${label}. Increase max_tokens or shorten the request.`,
      );
    }

    const textBlock = message.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      lastFailureStage = "no-text-block";
      throw new Error(
        `Anthropic response did not contain a text block (stop_reason=${
          message.stop_reason ?? "unknown"
        }, content_blocks=${message.content.length})`,
      );
    }

    const raw = textBlock.text.trim();
    rawState.value = raw;
    const jsonText = extractJson(raw);
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonText);
    } catch (err) {
      lastFailureStage = "json-parse";
      const detail = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Model output was not valid JSON for ${label}: ${detail}`,
      );
    }
    let result: T;
    try {
      result = schema.parse(parsed);
    } catch (err) {
      lastFailureStage = "schema-parse";
      const detail = err instanceof Error ? err.message : String(err);
      // Trim Zod's verbose error to first ~300 chars so logs stay readable.
      const trimmed = detail.length > 300 ? `${detail.slice(0, 300)}…` : detail;
      throw new Error(
        `Model output did not match the expected schema for ${label}: ${trimmed}`,
      );
    }

    if (validate) {
      let failure: ValidationFailure | null;
      try {
        failure = validate(result);
      } catch (validatorErr) {
        // A throw from `validate` itself indicates a bug in OUR validation
        // code, not in the model output. Surface it immediately rather than
        // burning more LLM calls on a request that will never succeed.
        const msg =
          validatorErr instanceof Error
            ? validatorErr.message
            : "unknown validator error";
        throw new ValidatorBugError(
          `Internal validator threw for ${label}: ${msg}`,
        );
      }
      if (failure) {
        throw new ValidationRetryError(failure, result);
      }
    }

    return result;
  };

  // We allow up to 2 attempts (initial + 1 retry). Each attempt against
  // claude-sonnet-4-6 with our 8000-token cap takes ~60-90s, so a third
  // retry pushes worst-case latency past 4 minutes which both reverse
  // proxies and users find unacceptable. The vast majority of length-band
  // failures self-correct on the first retry; the rare double-overshoot
  // path is caught by `finalRecover` (which truncates to band) so we
  // ship a usable prompt instead of failing the request.
  const MAX_ATTEMPTS = 2;
  let lastErr: unknown;
  let lastValidationFailure: ValidationFailure | null = null;
  const validationAttempts: Array<{ result: T; failure: ValidationFailure }> = [];

  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    try {
      let extra: string | undefined;
      if (i > 0) {
        const prevMsg = (lastErr as Error)?.message ?? "";
        if (lastValidationFailure) {
          extra = lastValidationFailure.retryInstruction;
        } else if (prevMsg.includes("truncated")) {
          extra =
            "REMINDER: Your previous response was cut off because it was too long. Be MORE CONCISE this time — keep descriptions tight, drop any redundancy, but still return ONLY a single complete valid JSON object exactly matching the schema. No markdown fences, no comments, no prose.";
        } else {
          extra =
            "REMINDER: Return ONLY a single valid JSON object exactly matching the schema described above. Do not include markdown fences, comments, or any prose. The previous attempt failed parsing or validation.";
        }
        logger.warn(
          { label, attempt: i + 1, reason: lastValidationFailure?.reason ?? prevMsg },
          "Retrying LLM call with corrective instruction",
        );
      }
      return await attempt(extra);
    } catch (err) {
      // A bug in our own validator code is non-recoverable — bail out
      // immediately so we don't burn more model calls on a request that
      // will never pass validation.
      if (err instanceof ValidatorBugError) {
        logger.error({ label, err: err.message }, "Validator bug — aborting");
        throw err;
      }
      lastErr = err;
      if (err instanceof ValidationRetryError) {
        lastValidationFailure = err.failure;
        validationAttempts.push({
          result: err.result as T,
          failure: err.failure,
        });
      } else {
        lastValidationFailure = null;
      }
    }
  }

  const finalMsg = (lastErr as Error)?.message ?? "unknown error";
  const finalStack =
    lastErr instanceof Error ? lastErr.stack ?? "(no stack)" : "(no error)";
  // Build a structural fingerprint of the raw response that's useful for
  // diagnosis WITHOUT leaking response content. Includes length, opening
  // characters (which indicate whether the model produced JSON, prose,
  // or markdown fences), and counts of structural markers — enough to
  // tell e.g. "ended mid-string" vs "produced prose explanation".
  const finalRaw: string | null = rawState.value;
  const rawFingerprint = finalRaw
    ? {
        len: finalRaw.length,
        startsWith: finalRaw.slice(0, 16),
        endsWith: finalRaw.slice(-16),
        openBraces: (finalRaw.match(/\{/g) ?? []).length,
        closeBraces: (finalRaw.match(/\}/g) ?? []).length,
        hasFences: finalRaw.includes("```"),
      }
    : null;
  // Verbatim snippets of the model response are ONLY logged in
  // development. In production the response can contain user-derived
  // PII or proprietary content and must not land in log pipelines.
  const includeSnippet = process.env.NODE_ENV !== "production";
  const rawHead =
    includeSnippet && finalRaw ? finalRaw.slice(0, 400) : null;
  const rawTail =
    includeSnippet && finalRaw && finalRaw.length > 600
      ? finalRaw.slice(-200)
      : null;
  logger.error(
    {
      label,
      finalErr: finalMsg,
      failureStage: lastFailureStage,
      validationAttempts: validationAttempts.length,
      rawFingerprint,
      ...(rawHead ? { rawHead } : {}),
      ...(rawTail ? { rawTail } : {}),
      stack: finalStack.split("\n").slice(0, 6).join("\n"),
    },
    "LLM JSON generation failed after all retries",
  );

  // Try recovery whenever earlier attempts produced parsed-but-failed
  // candidates, even if the LAST attempt failed for a different reason
  // (e.g. truncation or invalid JSON). Otherwise we'd discard usable
  // candidates just because the model's final retry happened to be a
  // different kind of failure.
  if (finalRecover && validationAttempts.length > 0) {
    const recovered = await finalRecover(validationAttempts);
    if (recovered !== null) {
      logger.warn(
        {
          label,
          attemptCount: validationAttempts.length,
          finalErr: finalMsg,
        },
        "Recovered from validation failure via finalRecover",
      );
      return recovered;
    }
  }

  if (lastValidationFailure) {
    throw new Error(
      `Generation failed for ${label}: ${lastValidationFailure.reason}. Please try again.`,
    );
  }
  const truncated =
    lastFailureStage === "truncated" || finalMsg.includes("truncated");
  if (truncated) {
    throw new Error(
      `Generation failed for ${label}: the AI's response was too long and got cut off. Try a shorter story or fewer shots per part, then try again.`,
    );
  }
  // For non-validation, non-truncation failures (Anthropic API error,
  // bad JSON, schema mismatch, missing text block) surface a SPECIFIC
  // user-facing reason derived from the failure stage. Generic "invalid
  // response" gives the user no idea what went wrong AND gives us no
  // signal to debug. Attach the underlying detail too — frontend can
  // show or hide it as desired but at least it lands in console.
  const stageMsg = stageToUserMessage(lastFailureStage, finalMsg);
  throw new Error(`Generation failed for ${label}: ${stageMsg}`);
}

/**
 * Map an internal failure stage to a user-facing explanation. We avoid
 * dumping raw API error text into the UI but still give the user a hint
 * about what kind of failure happened so they know whether to retry,
 * shorten the request, or report a bug.
 */
function stageToUserMessage(stage: string | null, _finalMsg: string): string {
  switch (stage) {
    case "anthropic-api":
      return "the AI service was temporarily unavailable. Please try again in a moment.";
    case "no-text-block":
      return "the AI returned an empty response. Please try again.";
    case "json-parse":
      return "the AI returned malformed JSON. Please try again — if this keeps happening, shorten the story or reduce parts per video.";
    case "schema-parse":
      return "the AI returned an unexpected shape. Please try again — if this keeps happening, shorten the story or reduce parts per video.";
    case "truncated":
      return "the response was too long and got cut off. Try a shorter story or fewer shots per part.";
    default:
      // Never echo the underlying error string to the user — it can
      // contain internal details (stack snippets, API error bodies)
      // that shouldn't surface in the UI. The full detail is already
      // logged server-side via the structured error log above.
      return "the model returned an invalid response. Please try again.";
  }
}

class ValidationRetryError extends Error {
  failure: ValidationFailure;
  result: unknown;
  constructor(failure: ValidationFailure, result: unknown) {
    super(failure.reason);
    this.name = "ValidationRetryError";
    this.failure = failure;
    this.result = result;
  }
}

class ValidatorBugError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidatorBugError";
  }
}

function extractJson(raw: string): string {
  const fenced = raw.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/);
  if (fenced) {
    return fenced[1].trim();
  }
  const firstBrace = raw.indexOf("{");
  const lastBrace = raw.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return raw.slice(firstBrace, lastBrace + 1);
  }
  return raw;
}
