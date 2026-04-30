import { Router, type IRouter, type Request, type Response } from "express";
import {
  GenerateStoryBody,
  GenerateStoryResponse,
  ContinueStoryBody,
  ContinueStoryResponse,
  GenerateVideoPromptsBody,
  GenerateVideoPromptsResponse,
  EditVideoPromptsBody,
  EditVideoPromptsResponse,
  GenerateMusicBriefBody,
  GenerateMusicBriefResponse,
  GenerateVoiceoverBody,
  GenerateVoiceoverResponse,
  ExpandPromptBody,
  ExpandPromptResponse,
  TrimPromptBody,
  TrimPromptResponse,
} from "@workspace/api-zod";
import { logger } from "../../lib/logger";
import {
  generateJson,
  type ValidationFailure,
  type FinalRecover,
  type InlineReferenceImage,
  anthropicClient,
  ANTHROPIC_MODEL,
  ANTHROPIC_FAST_MODEL,
  pickModel,
} from "./llm";
import {
  STORY_SYSTEM_PROMPT,
  CONTINUE_STORY_SYSTEM_PROMPT,
  VIDEO_PROMPTS_SYSTEM_PROMPT,
  EDIT_VIDEO_PART_SYSTEM_PROMPT,
  MUSIC_BRIEF_SYSTEM_PROMPT,
  VOICEOVER_SYSTEM_PROMPT,
  JSON_MODE_ADDENDUM,
  NORMAL_MODE_ADDENDUM,
  EXPAND_PROMPT_SYSTEM_PROMPT,
  TRIM_PROMPT_SYSTEM_PROMPT,
  MASTER_SYSTEM_CONTEXT,
  buildFrameSettingsAddendum,
  buildRealismBlockForModel,
  buildSingleTakeBoost,
  buildFrameImageAnchorAddendum,
  buildModelAwareShotCountBlock,
  applyModelTokens,
  type VideoModelProfile,
  shotCountMath,
  getVideoModelProfile,
  DEFAULT_VIDEO_MODEL,
} from "./prompts";

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

function handleError(res: Response, label: string, err: unknown) {
  logger.error({ err, label }, "AI route error");
  const message = err instanceof Error ? err.message : "Unknown server error";
  res.status(500).json({ error: message });
}

// Heartbeat interval for long-running LLM responses. Must be smaller than
// the most aggressive proxy idle-timeout we know about. Replit's preview
// proxy starts dropping silent connections around ~30s; deployment
// proxies are usually generous (5min) but 20s gives a safe margin
// everywhere without flooding the wire.
const HEARTBEAT_INTERVAL_MS = 20_000;

/**
 * Stream-friendly wrapper around a slow LLM call that keeps the upstream
 * HTTP connection alive while we wait for Anthropic to finish.
 *
 * THE PROBLEM: A single claude-sonnet-4-6 call for video-prompts can take
 * 60-150 seconds (with retries up to ~180s). `res.json(result)` writes
 * NOTHING to the wire until that full duration elapses, so the Replit
 * dev/deploy proxy silently closes the upstream socket after ~30s of
 * idle and the user sees "upstream timeout" / 504 long before the LLM
 * actually fails or succeeds.
 *
 * THE FIX: We commit to a 200 status + JSON content-type immediately,
 * flush the headers, and write a single SPACE byte every 20s while the
 * LLM is thinking. JSON.parse ignores leading whitespace, so the final
 * `JSON.stringify(result)` we emit at the end still parses cleanly on
 * the client — no client-side streaming-aware reader needed.
 *
 * ERROR CASE: Once the heartbeat has fired, headers are already on the
 * wire and we can't change status to 500 anymore. We instead emit a
 * `{ "error": "..." }` envelope at status 200. The client wrappers
 * (api-call.ts, generation-context.tsx) detect this envelope and
 * throw a real Error so caller behaviour is identical to the old
 * status-500 path.
 */
async function respondWithHeartbeat<T>(
  res: Response,
  label: string,
  work: () => Promise<T>,
): Promise<void> {
  res.status(200);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  // Tell nginx-style reverse proxies not to buffer. The Replit proxy
  // honours this header and will forward our heartbeats immediately.
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  // Tracks whether the underlying socket is still writable. Once the
  // client disconnects (e.g. AbortController.abort() on the frontend,
  // or a proxy-side close), we must STOP touching `res` — further
  // res.write() calls will throw and noisy-log the failure for every
  // tick of the heartbeat interval.
  let aborted = false;

  // Guarded write — fail-fast on a destroyed/ended socket, swallow the
  // (very rare) EPIPE-style errors that can race with the close event.
  const safeWrite = (chunk: string): boolean => {
    if (aborted || res.writableEnded || res.destroyed || !res.writable) {
      return false;
    }
    try {
      res.write(chunk);
      return true;
    } catch (writeErr) {
      // Once a write fails the socket is unusable. Mark as aborted so
      // future heartbeats stop trying.
      aborted = true;
      logger.warn(
        { err: writeErr, label },
        "Heartbeat write failed — client likely disconnected",
      );
      return false;
    }
  };

  // If the client goes away mid-flight, kill the interval immediately
  // and stop trying to write. The in-flight LLM call still completes
  // but its result is discarded — this is the same behaviour Express
  // exhibits for a normal aborted res.json() request.
  const onClose = () => {
    aborted = true;
  };
  res.on("close", onClose);

  const interval: NodeJS.Timeout = setInterval(() => {
    if (aborted) {
      clearInterval(interval);
      return;
    }
    // A single ASCII space — valid JSON whitespace, ignored by JSON.parse.
    safeWrite(" ");
  }, HEARTBEAT_INTERVAL_MS);

  try {
    const result = await work();
    clearInterval(interval);
    if (safeWrite(JSON.stringify(result)) && !res.writableEnded) {
      res.end();
    }
  } catch (err) {
    clearInterval(interval);
    logger.error({ err, label }, "AI route error (heartbeat path)");
    const message = err instanceof Error ? err.message : "Unknown server error";
    if (safeWrite(JSON.stringify({ error: message })) && !res.writableEnded) {
      res.end();
    }
  } finally {
    res.off("close", onClose);
  }
}

// DUAL-MODE-spec band: copyablePrompt must land in 4200-4500 chars. The
// upper bound is Seedance 2.0's hard limit; the lower bound (raised from
// 1500) is the user-facing requirement that prompts feel "rich enough"
// to use directly. The /expand-prompt + /trim-prompt endpoints exist
// specifically to nudge an out-of-band prompt back into this range
// without re-running the whole generation pipeline.
const COPYABLE_PROMPT_MIN = 4200;
const COPYABLE_PROMPT_MAX = 4500;
// Floor for emergency-rescue paths. The 4200-char user-facing band is
// enforced for normal generations, but if recovery has to ship a
// degraded prompt rather than fail the request, anything above this
// hard floor is still considered usable. Without it, recovery would
// reject every degraded result and the user would see HTTP 500s.
const COPYABLE_PROMPT_HARD_FLOOR = 1500;

function validateCopyablePromptLength(
  result: { copyablePrompt: string },
  mode: "normal" | "json" = "normal",
  modelName: string = "the target video model",
): ValidationFailure | null {
  const len = result.copyablePrompt.length;
  if (len >= COPYABLE_PROMPT_MIN && len <= COPYABLE_PROMPT_MAX) return null;
  const sweet = "4300-4450";
  const structureHint =
    mode === "json"
      ? "the copyablePrompt JSON envelope (with header, startingFrame/endingFrame if enabled, every shot, effectsInventory, densityMap, energyArc, dialogue, audioDesign, lastFrame)"
      : "all [BRACKET] header lines, all 6 mandatory ## sections in canonical order, every shot, all 7 bullets per shot";
  if (len > COPYABLE_PROMPT_MAX) {
    const overBy = len - COPYABLE_PROMPT_MAX;
    return {
      reason: `copyablePrompt was ${len} chars (max ${COPYABLE_PROMPT_MAX})`,
      retryInstruction: `LENGTH CAP — your previous copyablePrompt was ${len} characters, ${overBy} characters OVER the HARD 4500-character ceiling. ${modelName} will not accept anything longer. Rewrite the JSON now keeping the SAME structure (${structureHint}) but make every line drastically shorter:\n  • Each per-shot value ≤ 50 characters (one core idea, no adjectives, no hype).\n  • DIALOGUE: just the actual spoken words in quotes plus a 2-3 word lip-sync directive.\n  • AUDIO: 2-4 SFX/ambient tokens separated by commas.\n  • Section bodies: one short line per item, no prose paragraphs.\nAim for ${sweet} chars total. Do NOT drop any shots or sections. Return ONLY the JSON, no prose.`,
    };
  }
  const underBy = COPYABLE_PROMPT_MIN - len;
  return {
    reason: `copyablePrompt was ${len} chars (min ${COPYABLE_PROMPT_MIN})`,
    retryInstruction: `LENGTH FLOOR — your previous copyablePrompt was only ${len} characters, ${underBy} below the ${COPYABLE_PROMPT_MIN}-char floor. The prompt is too thin to be useful. Rewrite the JSON now with the SAME structure (${structureHint}) and add depth — richer per-shot bullets, more SFX/ambient detail, fuller dialogue context, more BGM SYNC MAP entries — until copyablePrompt lands in ${COPYABLE_PROMPT_MIN}-${COPYABLE_PROMPT_MAX} chars (target ${sweet}). Do NOT add hype adjectives. Return ONLY the JSON, no prose.`,
  };
}

/**
 * Model-aware shot range. Mirrors the decision tree in
 * `buildModelAwareShotCountBlock` so the validator agrees with the
 * guidance the writer was given. The validator MUST stay in sync with
 * the prompt block — otherwise the LLM is told "1-2 shots is fine" but
 * the validator forces "minimum 8 shots", and every short-part
 * generation triggers an unnecessary retry storm.
 *
 * `modelMaxClip` is the target video model's max single-clip duration
 * (e.g. Veo 3 = 8s, Seedance = 15s). When omitted (legacy / recovery
 * paths that don't know the model), we default to 15s — the most
 * generous common cap, which means the validator falls back to lenient
 * ranges and never rejects shots that the new model-aware writer
 * legitimately produced.
 *
 * Returns [minShots, maxShots]. minShots is a HARD floor — going below
 * it means the part literally cannot be rendered (partDuration >
 * modelMaxClip × shotCount). maxShots is a SOFT ceiling — generously
 * loose to allow scene-driven over-cutting when the story demands it.
 */
function expectedShotRange(
  durationSec: number,
  modelMaxClip: number = 15,
): [number, number] {
  // Reuse the SAME math the writer was given via
  // `buildModelAwareShotCountBlock`. The validator bounds are:
  //   floor = hardFloor (physically impossible to go below)
  //   ceil  = recommendedMax + 2 (small grace band for scene-driven
  //           over-cutting; rejects only when the model wildly
  //           over-cuts the recommended range)
  // Sharing `shotCountMath` between writer guidance and validator
  // eliminates the previous drift where the writer was told "1-2 shots"
  // but the validator demanded 8.
  const m = shotCountMath({ partDuration: durationSec, modelMaxClip });
  return [m.hardFloor, m.recommendedMax + 2];
}

const REQUIRED_SECTIONS = [
  "## SHOT-BY-SHOT EFFECTS TIMELINE",
  "## MASTER EFFECTS INVENTORY",
  "## EFFECTS DENSITY MAP",
  "## ENERGY ARC",
  "## DIALOGUE & VOICEOVER",
  "## AUDIO DESIGN",
] as const;

const REQUIRED_BRACKET_HEADER = "[VISUAL STYLE";
const PART_BRACKET_HEADER = "[PART";

/**
 * Returns the first missing required-section name, or null if every
 * required section is present in canonical order.
 */
function findMissingSection(prompt: string): string | null {
  let cursor = 0;
  for (const heading of REQUIRED_SECTIONS) {
    const next = prompt.indexOf(heading, cursor);
    if (next < 0) return heading;
    cursor = next + heading.length;
  }
  return null;
}

/**
 * Single source of truth for the structural shape of a video-prompt
 * response. Used both by the live validator (which produces retry
 * instructions) and by the final-recovery filter (which silently rejects
 * malformed candidates). Returning the same predicate from both code
 * paths means recovery cannot accept anything the validator would have
 * rejected on shape grounds.
 *
 * Checks (in priority order):
 *  - [VISUAL STYLE: ...] header present
 *  - [PART: ...] header present
 *  - All 6 mandatory ## sections in canonical order
 *  - Per-shot bullet shape: each shot has at least one "• DIALOGUE:" and
 *    one "• AUDIO:" bullet. Per-shot DIALOGUE/AUDIO is the entire reason
 *    we embed audio inside copyablePrompt — without these bullets the
 *    paste-into-Seedance promise is broken.
 *  - Shot count within the skill's per-duration range (both bounds).
 */
type ShapeIssue = { code: string; message: string; retry: string };

function checkVideoPromptShape(
  result: { copyablePrompt: string; shots: ReadonlyArray<unknown> },
  durationSec: number,
  modelMaxClip?: number,
): ShapeIssue | null {
  const [minShots, maxShots] = expectedShotRange(durationSec, modelMaxClip);
  const cp = result.copyablePrompt;

  if (cp.indexOf(REQUIRED_BRACKET_HEADER) < 0) {
    return {
      code: "missing-visual-style-header",
      message: "copyablePrompt missing [VISUAL STYLE ...] header",
      retry: `STRUCTURE — your previous copyablePrompt is missing the required "[VISUAL STYLE: ...]" bracket header line at the very top. Rewrite the JSON now with the same content but ensure copyablePrompt opens with all required header lines: [VISUAL STYLE: ...], [BACKGROUND MUSIC: ...] if BGM is enabled, [VOICEOVER: ...] if voiceover is enabled, then [PART: N of M | ...]. Then continue with all 6 mandatory ## sections in canonical order. Return ONLY the JSON, no prose.`,
    };
  }
  if (cp.indexOf(PART_BRACKET_HEADER) < 0) {
    return {
      code: "missing-part-header",
      message: "copyablePrompt missing [PART ...] header",
      retry: `STRUCTURE — your previous copyablePrompt is missing the required "[PART: N of M | ...]" bracket header line. Rewrite the JSON now keeping every shot and section but add the [PART: ${durationSec}s ...] line in the headers block at the top of copyablePrompt. Return ONLY the JSON, no prose.`,
    };
  }
  const missing = findMissingSection(cp);
  if (missing !== null) {
    return {
      code: "missing-section",
      message: `copyablePrompt missing "${missing}" section`,
      retry: `STRUCTURE — your previous copyablePrompt is missing the "${missing}" section (or it appears out of order). All 6 mandatory ## sections must appear in this exact order: ## SHOT-BY-SHOT EFFECTS TIMELINE, ## MASTER EFFECTS INVENTORY, ## EFFECTS DENSITY MAP, ## ENERGY ARC, ## DIALOGUE & VOICEOVER, ## AUDIO DESIGN. Rewrite the JSON now keeping every shot and the same prose detail but ensure all 6 sections appear in order. Return ONLY the JSON, no prose.`,
    };
  }

  const shotsCount = result.shots?.length ?? 0;
  if (shotsCount < minShots) {
    return {
      code: "too-few-shots",
      message: `only ${shotsCount} shots for a ${durationSec}s part (skill requires ${minShots}-${maxShots})`,
      retry: `SHOT-COUNT FLOOR — your previous response had only ${shotsCount} shots in shots[] for a ${durationSec}-second part. The HARD floor is ${minShots} (the target model can't render ${durationSec}s in fewer clips). Recommended range: ${minShots}-${maxShots}. Rewrite the JSON now with at least ${minShots} shots — let the scene + voiceover decide the exact count. Each shot must still carry all 7 bullets in copyablePrompt (EFFECT, visual, camera, speed/timing, transition, DIALOGUE, AUDIO). Update effectsInventory, densityMap, the per-shot SFX entries inside ## AUDIO DESIGN, and the per-shot dialogue entries inside ## DIALOGUE & VOICEOVER to match the new shot list. Keep all 6 ## sections and the 4 [BRACKET] headers. Return ONLY the JSON, no prose.`,
    };
  }
  if (shotsCount > maxShots) {
    return {
      code: "too-many-shots",
      message: `${shotsCount} shots for a ${durationSec}s part (skill ceiling is ${maxShots})`,
      retry: `SHOT-COUNT CEILING — your previous response had ${shotsCount} shots in shots[] for a ${durationSec}-second part. The model-aware ceiling is ${maxShots} (range: ${minShots}-${maxShots}). Going over creates over-cut pacing and bloats copyablePrompt past the 4500-char cap. Consolidate or trim shots so the total is between ${minShots} and ${maxShots}. Each remaining shot must still carry all 7 bullets in copyablePrompt (EFFECT, visual, camera, speed/timing, transition, DIALOGUE, AUDIO). Update effectsInventory, densityMap, the per-shot SFX entries inside ## AUDIO DESIGN, and the per-shot dialogue entries inside ## DIALOGUE & VOICEOVER to match the new shot list. Keep all 6 ## sections and the 4 [BRACKET] headers. Return ONLY the JSON, no prose.`,
    };
  }

  // Per-shot bullet shape: each shot block (in ## SHOT-BY-SHOT EFFECTS
  // TIMELINE) must contain BOTH a "• DIALOGUE:" and a "• AUDIO:" bullet.
  // We do a per-block check rather than a global count, because the
  // compression-recovery pass can drop intermediate bullets while the
  // global counts still match. Per-block validation is the only way to
  // catch a compressed output that, e.g., dropped the visual/camera/
  // speed/transition bullets but kept DIALOGUE+AUDIO across the board.
  const timelineHeader = "## SHOT-BY-SHOT EFFECTS TIMELINE";
  const timelineStart = cp.indexOf(timelineHeader);
  const nextSectionStart = cp.indexOf(REQUIRED_SECTIONS[1], timelineStart);
  const timeline = cp.slice(
    timelineStart + timelineHeader.length,
    nextSectionStart < 0 ? cp.length : nextSectionStart,
  );
  // Split on SHOT N markers; each block represents one shot's body.
  const shotMarker = /^SHOT\s+\d+\b/gm;
  const shotMarkers: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = shotMarker.exec(timeline)) !== null) {
    shotMarkers.push(m.index);
  }
  if (shotMarkers.length < shotsCount) {
    return {
      code: "missing-shot-blocks",
      message: `only ${shotMarkers.length} SHOT N blocks for ${shotsCount} shots`,
      retry: `SHOT BLOCK COUNT — your ## SHOT-BY-SHOT EFFECTS TIMELINE only has ${shotMarkers.length} "SHOT N" header lines but shots[] declares ${shotsCount}. Every entry in shots[] must have a corresponding "SHOT N (00:0X-00:0Y) — Name" header in the timeline, followed by exactly 7 bullets in order (EFFECT, visual, camera, speed/timing, transition, DIALOGUE, AUDIO). Rewrite the JSON now keeping every shot and section. Return ONLY the JSON, no prose.`,
    };
  }
  for (let i = 0; i < shotMarkers.length; i++) {
    const blockStart = shotMarkers[i];
    const blockEnd =
      i + 1 < shotMarkers.length ? shotMarkers[i + 1] : timeline.length;
    const block = timeline.slice(blockStart, blockEnd);
    const hasDialogue = /^•\s*DIALOGUE:/m.test(block);
    const hasAudio = /^•\s*AUDIO:/m.test(block);
    if (!hasDialogue || !hasAudio) {
      const which = !hasDialogue ? "• DIALOGUE:" : "• AUDIO:";
      return {
        code: "missing-per-shot-audio-bullet",
        message: `SHOT ${i + 1} block is missing a ${which} bullet`,
        retry: `PER-SHOT EMBEDDED AUDIO — SHOT ${i + 1} in ## SHOT-BY-SHOT EFFECTS TIMELINE is missing the required "${which}" bullet. EVERY shot block must contain ALL 7 bullets in this exact order: • EFFECT, • visual, • camera, • speed/timing, • transition, • DIALOGUE, • AUDIO. (Use "• DIALOGUE: (silent — ambient only)" for silent shots.) Rewrite the JSON now keeping every shot and section but make sure each shot block has all 7 bullets. Return ONLY the JSON, no prose.`,
      };
    }
    // Spot-check the other 5 bullets exist in the block. The skill specs
    // 7 bullets per shot (EFFECT, visual, camera, speed, transition,
    // DIALOGUE, AUDIO), but Seedance only HARD-requires DIALOGUE+AUDIO to
    // generate the audio layer; the other 5 are quality-of-render. Under
    // heavy length pressure (long stories + tight 4500-char cap) the
    // model sometimes folds visual+camera or speed+transition into one
    // bullet, producing 4-5 bullets per shot. We accept that rather than
    // reject the whole prompt — a 5-bullet shot still renders cleanly in
    // Seedance and the alternative is a generation failure for the user.
    // We only fail when the block is so thin (≤3 bullets) that the
    // visual layer itself is missing.
    const bulletLines = (block.match(/^•\s/gm) || []).length;
    if (bulletLines < 4) {
      return {
        code: "missing-shot-bullets",
        message: `SHOT ${i + 1} block has only ${bulletLines} bullets (need at least 4)`,
        retry: `PER-SHOT BULLET COUNT — SHOT ${i + 1} in ## SHOT-BY-SHOT EFFECTS TIMELINE only has ${bulletLines} "• " bullets. Every shot block needs at MINIMUM 4 bullets that together cover: visual description, camera/speed/transition info, DIALOGUE, AUDIO (the prescribed 7-bullet shape is preferred: • EFFECT, • visual, • camera, • speed, • transition, • DIALOGUE, • AUDIO — but you may merge visual/camera/speed/transition into fewer bullets if length is tight). Rewrite the JSON now keeping every shot but with at least 4 bullets per shot block including DIALOGUE+AUDIO. Return ONLY the JSON, no prose.`,
      };
    }
  }

  return null;
}

/**
 * JSON-mode shape check. The Normal-mode predicate validates [BRACKET]
 * headers + ## sections + per-shot bullets — none of which apply when
 * the writer asked for a JSON envelope. Instead we verify copyablePrompt
 * parses as JSON and carries the same shot count as the structured
 * shots[] array.
 */
function checkVideoPromptShapeJson(
  result: { copyablePrompt: string; shots: ReadonlyArray<unknown> },
  durationSec: number,
  modelMaxClip?: number,
): ShapeIssue | null {
  const [minShots, maxShots] = expectedShotRange(durationSec, modelMaxClip);
  const cp = result.copyablePrompt;
  let parsed: unknown;
  try {
    parsed = JSON.parse(cp);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return {
      code: "json-mode-not-json",
      message: `copyablePrompt is not valid JSON in JSON mode (${detail})`,
      retry: `JSON MODE — your previous copyablePrompt was not valid JSON (parse error: ${detail}). In JSON mode, copyablePrompt MUST be a JSON-encoded STRING that itself parses as the JSON envelope defined in the system prompt (with header, shots[], effectsInventory, densityMap, energyArc, dialogue, audioDesign, lastFrame). Do NOT wrap it in markdown fences. Do NOT add prose. Re-emit the WHOLE JSON response with copyablePrompt re-encoded as a valid JSON string.`,
    };
  }
  if (!parsed || typeof parsed !== "object") {
    return {
      code: "json-mode-not-object",
      message: "copyablePrompt JSON did not decode to an object",
      retry: `JSON MODE — your previous copyablePrompt JSON decoded to a non-object value. It must decode to an object with at least \`shots\` (array), \`header\` (object), and \`audioDesign\` (object). Re-emit the WHOLE JSON response with copyablePrompt re-encoded as a valid JSON-string envelope.`,
    };
  }
  const envelope = parsed as { shots?: unknown };
  const envelopeShots = Array.isArray(envelope.shots) ? envelope.shots.length : 0;
  if (envelopeShots !== result.shots.length) {
    return {
      code: "json-mode-shot-count-mismatch",
      message: `copyablePrompt envelope has ${envelopeShots} shots but shots[] has ${result.shots.length}`,
      retry: `JSON MODE — the shots array inside copyablePrompt (${envelopeShots} entries) doesn't match the structured shots[] array (${result.shots.length} entries). Both must list the same shots in the same order. Re-emit with copyablePrompt's shots array having exactly ${result.shots.length} entries.`,
    };
  }
  if (envelopeShots < minShots) {
    return {
      code: "too-few-shots",
      message: `only ${envelopeShots} shots for a ${durationSec}s part (need ${minShots}-${maxShots})`,
      retry: `SHOT COUNT — your previous response had only ${envelopeShots} shots for a ${durationSec}-second part. The skill requires at least ${minShots} shots (range ${minShots}-${maxShots}). Re-emit with the right shot count, both in shots[] AND inside copyablePrompt's JSON envelope.`,
    };
  }
  if (envelopeShots > maxShots) {
    return {
      code: "too-many-shots",
      message: `${envelopeShots} shots for a ${durationSec}s part (cap ${maxShots})`,
      retry: `SHOT COUNT — your previous response had ${envelopeShots} shots for a ${durationSec}-second part. The skill caps at ${maxShots} (range ${minShots}-${maxShots}). Consolidate shots; re-emit with the right shot count in both shots[] and copyablePrompt's envelope.`,
    };
  }
  return null;
}

/**
 * Build a validator that runs the length safety check first (cheap to
 * verify, retry instructions are length-specific) and then the unified
 * shape predicate. Mode-aware: Normal mode runs the full structural
 * check; JSON mode runs the JSON-envelope check.
 */
function makeVideoPromptValidator(
  durationSec: number,
  label: string,
  mode: "normal" | "json" = "normal",
  modelMaxClip?: number,
  modelName?: string,
): (result: {
  copyablePrompt: string;
  shots: ReadonlyArray<unknown>;
}) => ValidationFailure | null {
  return (result) => {
    const lenFailure = validateCopyablePromptLength(result, mode, modelName);
    if (lenFailure) return lenFailure;
    const shape =
      mode === "json"
        ? checkVideoPromptShapeJson(result, durationSec, modelMaxClip)
        : checkVideoPromptShape(result, durationSec, modelMaxClip);
    if (shape) {
      return {
        reason: `${label}: ${shape.message}`,
        retryInstruction: shape.retry,
      };
    }
    return null;
  };
}

/**
 * Build a final-attempt fallback when validation retries don't all pass.
 * Every recovered candidate must pass the SAME unified shape predicate
 * the validator uses (`checkVideoPromptShape`) — that means required
 * bracket headers, all 6 ## sections in canonical order, per-shot
 * DIALOGUE/AUDIO bullets, and a shot count inside the skill's range.
 * Recovery never accepts something the validator would have rejected.
 *
 *  1. If any retry lands in the safety range AND is fully shape-compliant,
 *     use it (closest to TARGET wins).
 *  2. Else, accept the closest-to-range fully shape-compliant candidate,
 *     but only if it's within 1500 chars of the safety range (i.e.
 *     between 3500 and 29500 chars). Anything further is too malformed
 *     to silently ship.
 *  3. As a last resort, truncate the smallest-overshoot attempt at a line
 *     boundary, but only if the truncated prompt still passes the full
 *     shape predicate after the cut.
 *  4. If nothing meets these bars, return null so generateJson surfaces a
 *     clean error to the caller.
 */
/**
 * Recursively trim every string value inside a parsed JSON value to
 * `maxStrLen` characters. Cuts at the last word boundary inside the cap
 * (when one exists past 70% of maxStrLen — otherwise falls back to a
 * raw slice). Non-string leaves and the surrounding object/array
 * structure are preserved exactly. Used by the JSON-mode deterministic
 * compressor below.
 */
function trimStringsRecursively(value: unknown, maxStrLen: number): unknown {
  if (typeof value === "string") {
    if (value.length <= maxStrLen) return value;
    const slice = value.slice(0, maxStrLen);
    const lastSpace = slice.lastIndexOf(" ");
    return lastSpace > maxStrLen * 0.7 ? slice.slice(0, lastSpace) : slice;
  }
  if (Array.isArray(value)) {
    return value.map((v) => trimStringsRecursively(v, maxStrLen));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = trimStringsRecursively(v, maxStrLen);
    }
    return out;
  }
  return value;
}

/**
 * Deterministic JSON-mode compressor for an over-length copyablePrompt.
 *
 * In JSON mode `copyablePrompt` is a JSON-encoded envelope (object with
 * `header`, `shots[]`, `audioDesign`, etc.) — the LLM-based compressor
 * we use for normal-mode prompts is a TERRIBLE fit because (a) it was
 * given a normal-mode system prompt and would convert JSON → plain
 * text, breaking `checkVideoPromptShapeJson`, and (b) the compressed
 * output then fails the min-structure rescue gate because it doesn't
 * have the expected `[VISUAL STYLE|PART|...]` bracket headers.
 *
 * Production logs (the 7828-char Hinglish failure) confirmed both
 * failure modes happening on the same request, which is why the user
 * still saw `Generation failed for generate-video-prompts:
 * copyablePrompt was 7828 chars (max 4500)` even after the iterative
 * LLM-compressor fix.
 *
 * Algorithm (no LLM round-trips, runs in microseconds):
 *  1. Parse the input JSON. If it doesn't parse, give up — the JSON
 *     mode shape check would have failed it anyway.
 *  2. Re-serialize without indentation (sometimes the model emits
 *     pretty-printed JSON which alone wastes 500-1500 chars on
 *     whitespace).
 *  3. If still over the cap, iteratively trim every string value in
 *     the envelope to a tightening per-pass length cap (200 → 140 →
 *     100 → 80 → 60 → 40). String content carries the bulk of the
 *     bytes so this converges fast.
 *  4. Return the smallest serialization that fits, or the smallest we
 *     produced (caller can still try line-truncation as a final pass).
 */
function compressJsonEnvelope(
  jsonString: string,
  targetMax: number,
): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonString);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;

  const compactInitial = JSON.stringify(parsed);
  if (compactInitial.length <= targetMax) return compactInitial;

  // Helper: drop named keys from the (cloned) envelope at the top level.
  const dropTopLevel = (obj: object, keys: string[]) => {
    const clone: Record<string, unknown> = { ...(obj as Record<string, unknown>) };
    for (const k of keys) delete clone[k];
    return clone;
  };
  // Helper: drop named keys from each entry of shots[].
  const dropPerShot = (obj: object, keys: string[]) => {
    const clone: Record<string, unknown> = { ...(obj as Record<string, unknown>) };
    if (Array.isArray(clone.shots)) {
      clone.shots = clone.shots.map((s) => {
        if (!s || typeof s !== "object") return s;
        const sc: Record<string, unknown> = { ...(s as Record<string, unknown>) };
        for (const k of keys) delete sc[k];
        return sc;
      });
    }
    return clone;
  };
  // Helper: drop a key inside audioDesign sub-object.
  const dropInAudioDesign = (obj: object, keys: string[]) => {
    const clone: Record<string, unknown> = { ...(obj as Record<string, unknown>) };
    if (clone.audioDesign && typeof clone.audioDesign === "object") {
      const ad: Record<string, unknown> = { ...(clone.audioDesign as Record<string, unknown>) };
      for (const k of keys) delete ad[k];
      clone.audioDesign = ad;
    }
    return clone;
  };

  // Progressive recovery passes — applied IN ORDER, each starts from the
  // envelope produced by the previous pass (so they compose). After each
  // pass we run the string-length trim ladder and return the first
  // serialization that fits under the cap. Field-dropping order keeps the
  // most-essential Seedance signal (header, shots[].visual/dialogue/audio,
  // lastFrame) until last.
  const stringTrimLadder = [200, 140, 100, 80, 60, 50, 40, 30];
  let best = compactInitial;
  let working: object = parsed as object;

  const tryFitAfter = (obj: object): string | null => {
    const serializedRaw = JSON.stringify(obj);
    if (serializedRaw.length < best.length) best = serializedRaw;
    if (serializedRaw.length <= targetMax) return serializedRaw;
    for (const cap of stringTrimLadder) {
      const trimmed = trimStringsRecursively(obj, cap);
      const serialized = JSON.stringify(trimmed);
      if (serialized.length < best.length) best = serialized;
      if (serialized.length <= targetMax) return serialized;
    }
    return null;
  };

  // Pass 1: just trim strings on the original envelope.
  const fit1 = tryFitAfter(working);
  if (fit1) return fit1;

  // Pass 2: drop per-shot `scene` (2-4 sentences each — verbose, optional
  // when scene-breakdown is disabled in the UI; Seedance still works with
  // visual/camera/dialogue/audio).
  working = dropPerShot(working, ["scene"]);
  const fit2 = tryFitAfter(working);
  if (fit2) return fit2;

  // Pass 3: drop the densityMap + energyArc — top-level analytics arrays
  // that exist for the UI's visualisation, not for Seedance rendering.
  working = dropTopLevel(working, ["densityMap", "energyArc"]);
  const fit3 = tryFitAfter(working);
  if (fit3) return fit3;

  // Pass 4: drop bgmSyncMap + sfx arrays inside audioDesign — keep
  // audioDesign.bgm + audioDesign.ambient strings so Seedance still has
  // music/ambient direction; the per-shot `audio` bullet on each shot
  // already carries SFX info.
  working = dropInAudioDesign(working, ["bgmSyncMap", "sfx"]);
  const fit4 = tryFitAfter(working);
  if (fit4) return fit4;

  // Pass 5: drop effectsInventory + the dialogue index array (per-shot
  // `dialogue` field on shots[] still carries the actual lines).
  working = dropTopLevel(working, ["effectsInventory", "dialogue"]);
  const fit5 = tryFitAfter(working);
  if (fit5) return fit5;

  // Pass 6: drop per-shot `effect`, `transition`, `speed`, `camera` —
  // visual/dialogue/audio/timestamp/n is the absolute Seedance minimum.
  working = dropPerShot(working, ["effect", "transition", "speed", "camera", "isSignature"]);
  const fit6 = tryFitAfter(working);
  if (fit6) return fit6;

  // Pass 7: drop the entire audioDesign + startingFrame + endingFrame
  // sub-objects — they're nice-to-have but Seedance can render from
  // header + shots + lastFrame alone.
  working = dropTopLevel(working, ["audioDesign", "startingFrame", "endingFrame"]);
  const fit7 = tryFitAfter(working);
  if (fit7) return fit7;

  // Even the most aggressive pass didn't fit — return the smallest
  // serialization we produced. Caller (makeRecoverCopyablePrompt's
  // emergency-rescue path) can decide whether to ship as a min-structure
  // candidate or surface the original validation error.
  return best;
}

/**
 * JSON-mode minimum-structure gate. The plain-text `diagnoseMinimum
 * Structure` looks for `[VISUAL STYLE|PART|...]` bracket headers and
 * `## ...` section markers, neither of which appear in JSON-mode
 * copyablePrompts (which are JSON-encoded objects). For JSON mode the
 * minimum bar is: parses as a JSON object and carries a `shots` array
 * whose length matches the structured `shots[]` from the response.
 * Anything looser than this would let us ship malformed JSON that
 * Seedance can't render; anything stricter (e.g. requiring all
 * original fields present, or per-shot textual-content checks) would
 * reject perfectly-usable trimmed envelopes whose values were aggressive-
 * trimmed but remain Seedance-pasteable.
 */
function jsonMinimumStructurePasses(
  text: string,
  expectedShots: number,
): { passes: boolean; reason: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return {
      passes: false,
      reason: `not parseable JSON: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { passes: false, reason: "JSON is not an object" };
  }
  const env = parsed as { shots?: unknown };
  if (!Array.isArray(env.shots)) {
    return { passes: false, reason: "missing shots[] array" };
  }
  if (env.shots.length !== expectedShots) {
    return {
      passes: false,
      reason: `shots[] has ${env.shots.length} (expected ${expectedShots})`,
    };
  }
  return { passes: true, reason: "ok" };
}

function makeRecoverCopyablePrompt(
  durationSec: number,
  label: string,
  mode: "normal" | "json" = "normal",
  modelMaxClip?: number,
  modelName: string = "the target video model",
): FinalRecover<{ copyablePrompt: string; shots: ReadonlyArray<unknown> }> {
  const baseShapeCheck =
    mode === "json" ? checkVideoPromptShapeJson : checkVideoPromptShape;
  const shapeCheck = (
    candidate: { copyablePrompt: string; shots: ReadonlyArray<unknown> },
    dur: number,
  ) => baseShapeCheck(candidate, dur, modelMaxClip);
  return async (attempts) => {
    // JSON mode short-circuit. The deterministic JSON compressor is
    // strictly better than the LLM-based path for JSON envelopes —
    // it's instantaneous, never converts JSON → plain text, and
    // always preserves the `shots[]` count + structure. Try it on
    // each over-length attempt before falling through to the
    // shape-based candidate selection below.
    if (mode === "json") {
      const overAttempts = attempts
        .filter((a) => a.result.copyablePrompt.length > COPYABLE_PROMPT_MAX)
        .sort(
          (a, b) =>
            a.result.copyablePrompt.length - b.result.copyablePrompt.length,
        );
      for (const a of overAttempts) {
        const compressed = compressJsonEnvelope(
          a.result.copyablePrompt,
          COPYABLE_PROMPT_MAX,
        );
        if (!compressed) continue;
        const candidate = { ...a.result, copyablePrompt: compressed };
        if (
          compressed.length <= COPYABLE_PROMPT_MAX &&
          shapeCheck(candidate, durationSec) === null
        ) {
          logger.warn(
            {
              label,
              originalLen: a.result.copyablePrompt.length,
              compressedLen: compressed.length,
              shots: a.result.shots?.length ?? 0,
            },
            "Recovered: deterministic JSON envelope compression fit cap with shape preserved",
          );
          return candidate;
        }
        // Still over cap or shape broken — try a min-structure ship.
        // Better to deliver a slightly-degraded but pasteable JSON
        // envelope than to fail the whole request.
        const minStruct = jsonMinimumStructurePasses(
          compressed,
          a.result.shots?.length ?? 0,
        );
        if (
          compressed.length <= COPYABLE_PROMPT_MAX &&
          minStruct.passes
        ) {
          logger.warn(
            {
              label,
              originalLen: a.result.copyablePrompt.length,
              compressedLen: compressed.length,
            },
            "Recovered: deterministic JSON compression fit cap (min-structure only)",
          );
          return candidate;
        }
        logger.warn(
          {
            label,
            compressedLen: compressed.length,
            shapeOk: shapeCheck(candidate, durationSec) === null,
            minStructPasses: minStruct.passes,
            minStructReason: minStruct.reason,
          },
          "Deterministic JSON compression produced unusable candidate — trying next attempt",
        );
      }
      // Fell through — no JSON attempt could be compressed under cap
      // while passing min-structure. Return null so the caller surfaces
      // the validation error. (We deliberately do NOT fall through to
      // the LLM-compression path below: in JSON mode that path would
      // convert JSON → plain text, which fails checkVideoPromptShapeJson
      // and the JSON-mode min-structure gate, just wasting LLM latency.)
      logger.warn(
        { label, attemptCount: attempts.length },
        "JSON-mode recovery exhausted — handing failure back to caller",
      );
      return null;
    }

    const TARGET = Math.round((COPYABLE_PROMPT_MIN + COPYABLE_PROMPT_MAX) / 2);
    type Cand = {
      result: { copyablePrompt: string; shots: ReadonlyArray<unknown> };
      len: number;
      overshoot: number;
      undershoot: number;
      shotsCount: number;
      inSafetyRange: boolean;
      shapeOk: boolean;
    };
    const cands: Cand[] = attempts.map(({ result }) => {
      const len = result.copyablePrompt.length;
      const shotsCount = result.shots?.length ?? 0;
      return {
        result,
        len,
        overshoot: Math.max(0, len - COPYABLE_PROMPT_MAX),
        undershoot: Math.max(0, COPYABLE_PROMPT_MIN - len),
        shotsCount,
        inSafetyRange:
          len >= COPYABLE_PROMPT_MIN && len <= COPYABLE_PROMPT_MAX,
        shapeOk: shapeCheck(result, durationSec) === null,
      };
    });

    // 1. In safety range AND fully shape-compliant. Closest to TARGET wins.
    const inRange = cands
      .filter((c) => c.inSafetyRange && c.shapeOk)
      .sort((a, b) => Math.abs(TARGET - a.len) - Math.abs(TARGET - b.len));
    if (inRange[0]) {
      logger.warn(
        { label, len: inRange[0].len, shots: inRange[0].shotsCount },
        "Recovered: in-safety-range candidate from earlier attempt",
      );
      return inRange[0].result;
    }

    // 2. Fully shape-compliant but slightly outside the length safety
    //    range. Tolerance: 1500 chars (so 3500–29500). Overshoot is
    //    penalised 2x undershoot — a short-but-complete prompt is more
    //    useful than a runaway one.
    const TOLERANCE = 1500;
    const scored = cands
      .filter((c) => c.shapeOk)
      .map((c) => ({ c, dist: c.overshoot * 2 + c.undershoot }))
      .sort((a, b) => a.dist - b.dist);
    if (scored[0] && scored[0].dist <= TOLERANCE) {
      logger.warn(
        {
          label,
          len: scored[0].c.len,
          shots: scored[0].c.shotsCount,
          overshoot: scored[0].c.overshoot,
          undershoot: scored[0].c.undershoot,
        },
        "Recovered: closest-to-range fully shape-compliant candidate",
      );
      return scored[0].c.result;
    }

    // 3. Last-resort truncation, only when the truncated prompt still
    //    passes the unified shape check (sections + headers + per-shot
    //    DIALOGUE/AUDIO bullets + shot count). Truncation typically
    //    drops the tail, so passing the predicate after the cut is the
    //    only safe acceptance criterion.
    const overshooters = cands
      .filter((c) => c.overshoot > 0)
      .sort((a, b) => a.len - b.len);
    for (const c of overshooters) {
      const slice = c.result.copyablePrompt.slice(0, COPYABLE_PROMPT_MAX);
      const lastBreak = slice.lastIndexOf("\n");
      const cut =
        lastBreak >= COPYABLE_PROMPT_HARD_FLOOR
          ? slice.slice(0, lastBreak)
          : slice;
      const truncated = { ...c.result, copyablePrompt: cut };
      if (shapeCheck(truncated, durationSec) === null) {
        logger.warn(
          {
            label,
            originalLen: c.len,
            recoveredLen: cut.length,
            shots: c.shotsCount,
          },
          "Recovered: truncated over-length attempt while preserving full shape",
        );
        return truncated;
      }
    }

    // 4. LLM compression pass — last-resort. Naive truncation cuts off the
    //    final sections (## DIALOGUE & VOICEOVER, ## AUDIO DESIGN), so it
    //    almost never preserves shape for prompts that are 30%+ over. Ask
    //    the model to compress its own best-but-still-over-length attempt
    //    line-by-line, preserving every section, header, shot, and bullet
    //    while tightening prose. We feed it the OWN over-length output as
    //    a starting point so this is much faster than a fresh generation.
    const bestOver = overshooters[0];
    if (bestOver) {
      try {
        const compressed = await compressCopyablePrompt(
          bestOver.result.copyablePrompt,
          bestOver.shotsCount,
          durationSec,
          modelName,
        );
        if (compressed) {
          const candidate = {
            ...bestOver.result,
            copyablePrompt: compressed,
          };
          if (
            compressed.length >= COPYABLE_PROMPT_HARD_FLOOR &&
            compressed.length <= COPYABLE_PROMPT_MAX &&
            shapeCheck(candidate, durationSec) === null
          ) {
            logger.warn(
              {
                label,
                originalLen: bestOver.len,
                compressedLen: compressed.length,
                shots: bestOver.shotsCount,
              },
              "Recovered: LLM-compressed over-length attempt to fit cap while preserving shape",
            );
            return candidate;
          }
          // Compression got close but still over (or shape broke). If shape
          // is still intact AND we're within ~600 chars of the cap, a
          // line-boundary truncation now has a real shot at preserving
          // shape — much more so than truncating the original 7000+ char
          // output, where naive cuts dropped whole tail sections.
          const compressedCandidateShapeOk =
            shapeCheck(candidate, durationSec) === null;
          if (
            compressedCandidateShapeOk &&
            compressed.length > COPYABLE_PROMPT_MAX &&
            compressed.length <= COPYABLE_PROMPT_MAX + 600
          ) {
            const slice = compressed.slice(0, COPYABLE_PROMPT_MAX);
            const lastBreak = slice.lastIndexOf("\n");
            const cut =
              lastBreak >= COPYABLE_PROMPT_HARD_FLOOR
                ? slice.slice(0, lastBreak)
                : slice;
            const truncatedCompressed = {
              ...bestOver.result,
              copyablePrompt: cut,
            };
            if (
              shapeCheck(truncatedCompressed, durationSec) === null
            ) {
              logger.warn(
                {
                  label,
                  originalLen: bestOver.len,
                  compressedLen: compressed.length,
                  finalLen: cut.length,
                  shots: bestOver.shotsCount,
                },
                "Recovered: LLM-compressed then line-truncated to fit cap with shape preserved",
              );
              return truncatedCompressed;
            }
          }
          logger.warn(
            {
              label,
              compressedLen: compressed.length,
              shapeOk: compressedCandidateShapeOk,
            },
            "Compression pass produced an unusable candidate (out of band or shape-broken)",
          );
          // Step 5 — emergency rescue. Compression got us close (e.g.
          // 4500-5500 chars) but shape is no longer perfect. Rather than
          // throw HTTP 500 at the user, force-trim the compression output
          // to fit the cap at a section boundary and ship it — BUT ONLY
          // if the trimmed result still satisfies the minimum-structural
          // gate (Seedance still needs at least the timeline section + ≥1
          // DIALOGUE bullet + ≥1 AUDIO bullet to produce something
          // pasteable). If even that minimum bar fails, return null and
          // let generateJson surface the original over-length error
          // instead of shipping garbage.
          if (compressed.length >= COPYABLE_PROMPT_HARD_FLOOR) {
            const rescued = forceTrimToCap(compressed);
            const minStructDiag = diagnoseMinimumStructure(
              rescued,
              bestOver.shotsCount,
            );
            if (rescued.length >= COPYABLE_PROMPT_HARD_FLOOR && minStructDiag.passes) {
              logger.warn(
                {
                  label,
                  originalLen: bestOver.len,
                  compressedLen: compressed.length,
                  rescuedLen: rescued.length,
                  shots: bestOver.shotsCount,
                },
                "Recovered: emergency hard-trim of compressed output (shape may be degraded but minimum-structure passed)",
              );
              return {
                ...bestOver.result,
                copyablePrompt: rescued,
              };
            }
            logger.warn(
              {
                label,
                rescuedLen: rescued.length,
                diag: minStructDiag,
                head: rescued.slice(0, 300),
                tail: rescued.slice(-200),
              },
              "Emergency rescue (compressed) rejected: failed minimum-structure gate",
            );
          }
        }
      } catch (err) {
        logger.warn(
          {
            label,
            err: err instanceof Error ? err.message : String(err),
          },
          "Compression pass threw — falling through to emergency rescue",
        );
      }
    }

    // Step 6 — final emergency rescue. Compression failed entirely (network
    // error, invalid output, etc). Take the SHORTEST raw over-length
    // attempt and force-trim it to the cap. Same minimum-structure gate
    // as step 5: better to fail cleanly than ship a structurally broken
    // prompt that won't paste into Seedance.
    if (bestOver) {
      const rescued = forceTrimToCap(bestOver.result.copyablePrompt);
      const rawDiag = diagnoseMinimumStructure(rescued, bestOver.shotsCount);
      if (rescued.length >= COPYABLE_PROMPT_HARD_FLOOR && rawDiag.passes) {
        logger.warn(
          {
            label,
            originalLen: bestOver.len,
            rescuedLen: rescued.length,
            shots: bestOver.shotsCount,
          },
          "Recovered: emergency hard-trim of raw attempt (shape may be degraded but minimum-structure passed)",
        );
        return {
          ...bestOver.result,
          copyablePrompt: rescued,
        };
      }
      logger.warn(
        {
          label,
          rescuedLen: rescued.length,
          diag: rawDiag,
          head: rescued.slice(0, 300),
          tail: rescued.slice(-200),
        },
        "Emergency rescue (raw) rejected: failed minimum-structure gate",
      );
    }

    return null;
  };
}

/**
 * Force-trim a copyablePrompt to fit under COPYABLE_PROMPT_MAX. Cuts at
 * the last preserved newline so we never end mid-line. Used by the
 * emergency rescue step when no recovery path produces a shape-perfect
 * result — the alternative is HTTP 500 to the user, which is worse.
 */
function forceTrimToCap(text: string): string {
  if (text.length <= COPYABLE_PROMPT_MAX) return text;
  const slice = text.slice(0, COPYABLE_PROMPT_MAX);
  const lastBreak = slice.lastIndexOf("\n");
  if (lastBreak >= COPYABLE_PROMPT_HARD_FLOOR) {
    return slice.slice(0, lastBreak);
  }
  // No reasonable line break found — return raw slice. Rare edge case.
  return slice;
}

/**
 * Minimum-structural gate for the emergency-rescue paths. A rescued
 * prompt must, at minimum, still be a recognisable Seedance prompt —
 * NOT a half-truncated text blob. Required:
 *   - At least one [VISUAL STYLE] / [PART] / [BACKGROUND MUSIC] /
 *     [VOICEOVER] bracket header (any one of the standard four)
 *   - The "## SHOT-BY-SHOT EFFECTS TIMELINE" section header (the only
 *     truly indispensable section for Seedance to render anything) —
 *     allow some leading whitespace or `# ` prefix variants from the
 *     model
 *   - At least 1 DIALOGUE: and 1 AUDIO: marker anywhere (the model
 *     sometimes uses `- DIALOGUE:` or `*  DIALOGUE:` after compression
 *     instead of strict `• DIALOGUE:`, so we accept any bullet marker)
 *   - At least ceil(shotsCount / 2) "SHOT N" blocks survived the trim
 *     (so we don't ship a prompt with only 1-2 shots when the user
 *     asked for 8). Half is the floor; less than that is too degraded.
 *
 * This is intentionally MUCH weaker than checkVideoPromptShape — it's a
 * "pasteable Seedance prompt" floor, not a "perfect Seedance prompt"
 * bar. If even this fails, the user deserves a clean error instead of
 * silently-broken output.
 */
type MinimumStructureDiagnosis = {
  passes: boolean;
  hasHeader: boolean;
  hasTimelineSection: boolean;
  hasDialogueBullet: boolean;
  hasAudioBullet: boolean;
  survivingShots: number;
  minSurvivingShots: number;
};

function diagnoseMinimumStructure(
  text: string,
  shotsCount: number,
): MinimumStructureDiagnosis {
  // Headers are formatted as `[VISUAL STYLE: ...]`, `[PART: 1 of 40 | ...]`,
  // etc — content lives INSIDE the brackets after a colon, so the previous
  // `]`-immediately-after-keyword pattern was wrong and rejected every
  // real prompt. Match keyword followed by word boundary instead.
  const hasHeader =
    /\[(VISUAL STYLE|PART|BACKGROUND MUSIC|VOICEOVER)\b/.test(text);
  const hasTimelineSection = /SHOT-BY-SHOT\s+EFFECTS\s+TIMELINE/i.test(text);
  // Accept any bullet marker (•, -, *, etc) before DIALOGUE/AUDIO so a
  // compression pass that switched markers doesn't get rejected.
  const hasDialogueBullet = /(?:^|\n)\s*[•\-*]\s*DIALOGUE:/i.test(text);
  const hasAudioBullet = /(?:^|\n)\s*[•\-*]\s*AUDIO:/i.test(text);
  const survivingShots = (text.match(/(?:^|\n)\s*SHOT\s+\d+/g) || []).length;
  const minSurvivingShots = Math.max(1, Math.ceil(shotsCount / 2));
  return {
    passes:
      hasHeader &&
      hasTimelineSection &&
      hasDialogueBullet &&
      hasAudioBullet &&
      survivingShots >= minSurvivingShots,
    hasHeader,
    hasTimelineSection,
    hasDialogueBullet,
    hasAudioBullet,
    survivingShots,
    minSurvivingShots,
  };
}

/**
 * Last-resort compression pass. Takes the model's own over-length
 * copyablePrompt and asks it to tighten line-by-line to fit the 4500-char
 * cap WITHOUT dropping any shot, section, header, or bullet. Returns the
 * compressed plain-text copyablePrompt or null if the model fails.
 *
 * Iterative: if the first compression pass is still over the cap (which
 * happens consistently for Hinglish/Devanagari content where each char
 * costs ~2x the tokens of English), the result is fed back in for a
 * second / third pass. Each pass starts from a smaller candidate so it
 * converges fast — typical 7000→4400 takes 1-2 passes.
 *
 * This is intentionally NOT a JSON-shaped call — we only need the
 * copyablePrompt string back. Smaller request + smaller response = much
 * lower latency than re-running the full schema generation.
 */
async function compressCopyablePrompt(
  original: string,
  shotsCount: number,
  durationSec: number,
  modelName: string = "the target video model",
): Promise<string | null> {
  const targetMax = COPYABLE_PROMPT_MAX;
  // Sweet spot inside the user-facing 4200-4500 band but with ~50 chars
  // of headroom under the cap. The compressor frequently overshoots its
  // own target by 50-150 chars; aiming at 4350 typically lands at 4380-
  // 4470 which IS in band. Aiming higher (e.g. 4450) often lands at
  // 4550+, breaking the cap.
  const targetSweetSpot = "4300-4400";
  const perShotBudget = Math.floor(2400 / Math.max(1, shotsCount));

  // Per-pass token budget. Hinglish/Devanagari output costs ~1.5-2x
  // tokens per char vs English, so a 4500-char band can need 6500+
  // output tokens. The previous 4096 cap silently truncated those
  // outputs and forced compression to return null. Match the bumped
  // VIDEO_PROMPTS_MAX_TOKENS (16000) cap from llm.ts so a single
  // compression pass never gets clipped — the model only bills/streams
  // tokens it actually produces, so larger cap is free for short inputs
  // and rescues long Hindi-VO Heavy-shot parts that were the source of
  // user-visible "compression hit max_tokens, discarding output"
  // failures.
  const COMPRESSION_MAX_TOKENS = 16000;

  // Maximum number of compression iterations. Each pass costs ~15-30s
  // of LLM latency, so 3 is a hard ceiling — by then we've either
  // converged (typical) or the input genuinely cannot fit the cap
  // without dropping shots, in which case we hand off to the
  // emergency-rescue paths in `makeRecoverCopyablePrompt`.
  const MAX_PASSES = 3;

  const runOnePass = async (input: string): Promise<string | null> => {
    const compressionSystem = `You are a precise text compressor for a ${modelName} video prompt. You will be given a copyablePrompt that is too long. Your job is to return ONLY the compressed copyablePrompt as plain text — nothing else, no JSON, no markdown fences, no commentary, no preamble.

HARD RULES (non-negotiable):
1. Final length must be ≤ ${targetMax} characters. AIM for ${targetSweetSpot} chars (leave HEADROOM — going over the cap renders the output USELESS, going under it does not).
2. Preserve EVERY [BRACKET] header line at the top.
3. Preserve EVERY ## section in the same order:
   ## SHOT-BY-SHOT EFFECTS TIMELINE → ## MASTER EFFECTS INVENTORY →
   ## EFFECTS DENSITY MAP → ## ENERGY ARC →
   ## DIALOGUE & VOICEOVER → ## AUDIO DESIGN
4. Preserve ALL ${shotsCount} shot blocks (SHOT 1, SHOT 2, ... SHOT ${shotsCount}).
5. Each shot block must keep AT LEAST 4 bullets including the • DIALOGUE: and • AUDIO: bullets (these two are MANDATORY because ${modelName} generates audio from them). The other 5 bullets (• EFFECT, • visual, • camera, • speed, • transition) may be merged together if length is tight, but DIALOGUE+AUDIO must stay as separate bullets.
6. Do NOT drop or merge shots. Do NOT drop sections.
7. Per-bullet ≤ 50 chars typical, 70 absolute max.
8. Per-shot block ≤ ${perShotBudget} chars total.

COMPRESSION TECHNIQUES (use aggressively):
- Sentence fragments only. Drop articles (the/a/an).
- Strip ALL adjectives that don't change meaning (epic, stunning,
  cinematic, dramatic, lightning-fast, breathtaking, etc).
- DIALOGUE: keep just [Char, lang]: "line" (lip: tight).
- AUDIO: 2-4 comma tokens (kick on 1, rain hiss, tire skid).
- EFFECT: name + comma list (speed ramp 100→25%, RGB split).
- Inventory: NAME (xN) — shots 1,3 — role (one line each).
- Density Map: one line per band.
- Energy Arc: one line per act.

Output: ONLY the compressed copyablePrompt as raw plain text.`;
    const compressionUser = `Compress this copyablePrompt for a ${durationSec}-second part with ${shotsCount} shots. Current length: ${input.length} chars. Need to fit under ${targetMax} (target ${targetSweetSpot}). Return ONLY the compressed plain-text prompt, no commentary.

--- ORIGINAL ---
${input}
--- END ORIGINAL ---`;

    const message = await anthropicClient.messages.create({
      model: ANTHROPIC_MODEL,
      max_tokens: COMPRESSION_MAX_TOKENS,
      system: compressionSystem,
      messages: [{ role: "user", content: compressionUser }],
    });

    if (message.stop_reason === "max_tokens") {
      logger.warn(
        { inputLen: input.length, capTokens: COMPRESSION_MAX_TOKENS },
        "Compression pass hit max_tokens — discarding output",
      );
      return null;
    }

    const textBlock = message.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") return null;
    return textBlock.text.trim();
  };

  // `current` is the input fed to the next pass — we shrink it monotonically.
  // `bestSoFar` is the SMALLEST compressed candidate we've seen at any pass,
  // and it's what we ultimately return on every non-converged exit path
  // (null pass, regression, exhaustion). Tracking these separately fixes a
  // subtle bug where a single regressed pass would replace a perfectly-good
  // smaller earlier candidate, sending an UNNECESSARILY large blob to the
  // emergency-rescue line-truncation paths and reducing their success rate.
  let current = original;
  let bestSoFar: string | null = null;
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const compressed = await runOnePass(current);
    if (!compressed) {
      // A null from runOnePass means the LLM truncated or returned
      // nothing usable. Hand the smallest compressed candidate we have
      // back to the caller — even if still over the cap, the rescue
      // paths can try to line-truncate it, which is much more likely
      // to preserve shape when starting from a smaller candidate vs
      // the original 7000+ char blob.
      return bestSoFar;
    }
    if (bestSoFar === null || compressed.length < bestSoFar.length) {
      bestSoFar = compressed;
    }

    if (compressed.length <= targetMax) {
      if (pass > 0) {
        logger.warn(
          { passes: pass + 1, finalLen: compressed.length, originalLen: original.length },
          "Compression converged after multiple passes",
        );
      }
      return compressed;
    }

    // Still over cap — feed the smaller compressed result back in for
    // another pass. Each iteration should be a strict-monotone shrink;
    // if it's not (model regressed and produced same/longer output),
    // bail to avoid wasted latency. We DON'T return the regressed
    // candidate — bestSoFar holds the smaller earlier one which gives
    // the rescue paths a much better starting point.
    if (compressed.length >= current.length) {
      logger.warn(
        {
          pass: pass + 1,
          inputLen: current.length,
          outputLen: compressed.length,
          bestSoFarLen: bestSoFar.length,
        },
        "Compression pass did not shrink — bailing with smallest candidate",
      );
      return bestSoFar;
    }
    current = compressed;
  }

  // Exhausted MAX_PASSES without landing under cap. Return the smallest
  // compression result we saw so the rescue paths can still try
  // line-truncation / emergency-rescue against it.
  logger.warn(
    {
      passes: MAX_PASSES,
      finalLen: bestSoFar?.length ?? null,
      originalLen: original.length,
    },
    "Compression did not converge under cap — handing off to emergency rescue",
  );
  return bestSoFar;
}

// ============================================================================
// FRAMES + DUAL-MODE helpers
// ============================================================================

interface FrameSettingsReq {
  startingFrameEnabled: boolean;
  endingFrameEnabled: boolean;
  sceneBreakdownEnabled: boolean;
}

const DEFAULT_FRAME_SETTINGS_REQ: FrameSettingsReq = {
  startingFrameEnabled: true,
  endingFrameEnabled: true,
  sceneBreakdownEnabled: true,
};

/**
 * Resolve the writer's mode + frame-settings preferences from a request
 * body, applying spec defaults when the writer hasn't overridden them.
 */
function resolveModeAndFrames(body: {
  mode?: "normal" | "json";
  frameSettings?: FrameSettingsReq;
}): {
  mode: "normal" | "json";
  frameSettings: FrameSettingsReq;
} {
  return {
    mode: body.mode ?? "json",
    frameSettings: body.frameSettings ?? DEFAULT_FRAME_SETTINGS_REQ,
  };
}

/**
 * Convert the openapi-shaped reference image array (b64Json + mimeType)
 * into the inline shape generateJson consumes. Caps at 5 to mirror the
 * client-side MAX_REFERENCE_IMAGES limit, even if a buggy client sends
 * more — Anthropic charges per image and we never want to silently bill
 * the user for ignored attachments.
 */
const ALLOWED_REFERENCE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

function toInlineReferenceImages(
  refs:
    | Array<{
        name: string;
        kind: "character" | "location" | "style";
        source: "auto" | "upload";
        b64Json: string;
        mimeType: string;
      }>
    | undefined,
): InlineReferenceImage[] | undefined {
  if (!refs || refs.length === 0) return undefined;
  const filtered = refs.filter((r) =>
    ALLOWED_REFERENCE_MIME_TYPES.has(r.mimeType),
  );
  if (filtered.length === 0) return undefined;
  return filtered.slice(0, 5).map((r) => ({
    b64Json: r.b64Json,
    mimeType: r.mimeType,
    caption: `${r.name} (${r.kind}, ${r.source === "auto" ? "auto-generated" : "user-uploaded"})`,
  }));
}

/**
 * Compose the full system prompt for a video-prompts call: base prompt
 * + mode addendum + frame-settings addendum + per-target-model dialect
 * addendum + global physics-realism block + (when both starting & ending
 * frame slots are on AND the user has opted to treat them as keyframe
 * anchors) the explicit "Image 1 / Image 2" first-and-last-frame block.
 *
 * Used by both the generate and edit endpoints so they stay in lockstep.
 */
function buildVideoPromptSystem(args: {
  base: string;
  mode: "normal" | "json";
  frameSettings: FrameSettingsReq;
  hasReferenceImages: boolean;
  videoModel?: string;
  framesAsImageReferences?: boolean;
  /**
   * Per-part duration in seconds. Used together with the target model's
   * max-single-clip-duration to compute the model-aware shot-count guidance
   * — short parts that fit in a single model clip should be 1-3 shots
   * (one continuous take) rather than the old "minimum 4-7 shots" rule
   * that produced over-cut, over-long prompts.
   */
  partDuration?: number;
}): string {
  const modeBlock =
    args.mode === "json" ? JSON_MODE_ADDENDUM : NORMAL_MODE_ADDENDUM;
  const framesBlock = buildFrameSettingsAddendum({
    startingFrameEnabled: args.frameSettings.startingFrameEnabled,
    endingFrameEnabled: args.frameSettings.endingFrameEnabled,
    sceneBreakdownEnabled: args.frameSettings.sceneBreakdownEnabled,
    hasReferenceImages: args.hasReferenceImages,
  });
  const profile = getVideoModelProfile(args.videoModel ?? DEFAULT_VIDEO_MODEL);
  const dialectBlock = profile.dialectAddendum;
  const modelName = `${profile.name} ${profile.version}`;
  const shotCountBlock =
    typeof args.partDuration === "number" && args.partDuration > 0
      ? buildModelAwareShotCountBlock({
          partDuration: args.partDuration,
          modelMaxClip: profile.durationRangeSeconds.max,
          modelName,
        })
      : "";
  // SINGLE-TAKE boost — only emitted when this part fits in ONE model
  // clip (e.g. 8s on Veo 3, 15s on Seedance). Tells the writer to pour
  // every cinematic detail into the one shot since there are no cuts to
  // spread storytelling across. Returns "" otherwise.
  const singleTakeBoost =
    typeof args.partDuration === "number" && args.partDuration > 0
      ? buildSingleTakeBoost({
          partDuration: args.partDuration,
          modelMaxClip: profile.durationRangeSeconds.max,
          modelName,
        })
      : "";
  // Per-model REALISM block. Photoreal models (Veo / Sora / Seedance /
  // Kling / Hailuo) get strict physics + anti-uncanny-valley rules;
  // painterly models (Luma) get film-emulsion / cinematography rules;
  // stylised-friendly models (Pika / Runway) get adaptive rules
  // (photoreal vs stylised brief).
  const realismBlock = buildRealismBlockForModel(profile);
  const frameAnchorBlock = args.framesAsImageReferences
    ? buildFrameImageAnchorAddendum({
        hasStartingFrame: args.frameSettings.startingFrameEnabled,
        hasEndingFrame: args.frameSettings.endingFrameEnabled,
        modelName,
        modelSupportsImageToImage: profile.supportsImageToImage,
      })
    : "";
  const assembled = [
    args.base,
    modeBlock,
    framesBlock,
    dialectBlock,
    shotCountBlock,
    singleTakeBoost,
    realismBlock,
    frameAnchorBlock,
  ]
    .filter((s) => s && s.length > 0)
    .join("\n\n");
  // Substitute model-specific tokens ({{TARGET_MODEL}}, {{TARGET_MODEL_SLUG}},
  // etc.) so the LLM sees concrete model names ("Veo 3", "Sora 1", ...) and
  // the JSON envelope template ships the writer-selected slug rather than a
  // hardcoded "seedance-2.0". Without this pass, the prompt would mention
  // {{TARGET_MODEL}} literally and copyablePrompt would always claim
  // "version: seedance-2.0" no matter which model the writer selected.
  return applyModelTokens(assembled, profile);
}

function describePreviousParts(previousParts: string[] | undefined): string {
  if (!previousParts || previousParts.length === 0) return "";
  return `\nALREADY-GENERATED PARTS (full memory of what was already shown — do NOT repeat shots, voiceover lines, or signature beats; build on what came before):\n${previousParts
    .map((p, i) => `--- Part ${i + 1} digest ---\n${p}`)
    .join("\n\n")}\n`;
}

const GenerateVideoPromptsBodyChecked = GenerateVideoPromptsBody.refine(
  (v) => v.part <= v.totalParts,
  { message: "part must be <= totalParts", path: ["part"] },
);

function describeStory(story: {
  title: string;
  synopsis: string;
  acts: Array<{
    actNumber: number;
    title: string;
    description: string;
    keyMoment: string;
  }>;
  characters: Array<{ name: string; description: string }>;
  mood: string;
  colorPalette: string[];
  musicSuggestion: string;
}): string {
  return `Title: ${story.title}
Synopsis: ${story.synopsis}
Mood: ${story.mood}
Color palette: ${story.colorPalette.join(", ")}
Music suggestion: ${story.musicSuggestion}

Characters:
${story.characters.map((c) => `- ${c.name}: ${c.description}`).join("\n")}

Acts:
${story.acts
  .map(
    (a) =>
      `Act ${a.actNumber} — ${a.title}\n  Description: ${a.description}\n  Key moment: ${a.keyMoment}`,
  )
  .join("\n")}`;
}

router.post("/generate-story", async (req: Request, res: Response) => {
  const parsed = GenerateStoryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: formatZodError(parsed.error) });
    return;
  }
  const {
    brief,
    genre,
    duration,
    totalDurationSeconds,
    partsCount,
    style,
    voiceoverLanguage,
  } = parsed.data;
  const totalDur = totalDurationSeconds ?? duration;
  const parts = partsCount ?? Math.max(1, Math.ceil(totalDur / 15));
  const userPrompt = `Create a structured cinematic story from the following brief.

BRIEF:
${brief}

GENRE: ${genre}
TOTAL DURATION: ${totalDur} seconds
PARTS COUNT: ${parts} (the video will be ${parts} parts of ~15 seconds each — structure your acts so they map cleanly to that)
STYLE: ${style ?? "(creator has not picked a style yet — keep it style-agnostic)"}
VOICEOVER LANGUAGE: ${voiceoverLanguage ?? "none"}

Output the structured story as JSON.`;

  await respondWithHeartbeat(res, "generate-story", () =>
    generateJson({
      systemPrompt: STORY_SYSTEM_PROMPT,
      userPrompt,
      schema: GenerateStoryResponse,
      label: "generate-story",
    }),
  );
});

router.post("/continue-story", async (req: Request, res: Response) => {
  const parsed = ContinueStoryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: formatZodError(parsed.error) });
    return;
  }
  const { existingStory, direction } = parsed.data;
  const userPrompt = `Apply the writer's instruction to the existing story. Honor the instruction LITERALLY — append, refine a specific act, change a character, change tone/mood/title/synopsis, full rewrite, or fix a single detail. Preserve any field the writer did not mention. Return the COMPLETE updated story as JSON with sequential actNumber values starting at 1.

EXISTING STORY:
${describeStory(existingStory)}

WRITER'S INSTRUCTION:
${direction}

Output the full updated story as JSON.`;

  await respondWithHeartbeat(res, "continue-story", () =>
    generateJson({
      systemPrompt: CONTINUE_STORY_SYSTEM_PROMPT,
      userPrompt,
      schema: ContinueStoryResponse,
      label: "continue-story",
    }),
  );
});

router.post(
  "/generate-video-prompts",
  async (req: Request, res: Response) => {
    const parsed = GenerateVideoPromptsBodyChecked.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: formatZodError(parsed.error) });
      return;
    }
    const {
      story,
      style,
      duration,
      part,
      totalParts,
      previousLastFrame,
      previousParts,
      voiceoverLanguage,
      voiceoverTone,
      voiceoverScript,
      bgmStyle,
      bgmTempo,
      bgmInstruments,
      aspectRatio,
      referenceImages: rawRefs,
      videoModel,
      framesAsImageReferences,
    } = parsed.data;
    const { mode, frameSettings } = resolveModeAndFrames(parsed.data);
    const inlineRefs = toInlineReferenceImages(rawRefs);
    const targetModel = getVideoModelProfile(videoModel ?? DEFAULT_VIDEO_MODEL);

    const audioBlock: string[] = [];
    if (voiceoverLanguage) {
      audioBlock.push(
        `- Voiceover language: ${voiceoverLanguage}` +
          (voiceoverTone ? ` (tone: ${voiceoverTone})` : "") +
          (voiceoverScript
            ? `\n  Use this pre-written script verbatim, distributing its lines across the per-shot DIALOGUE bullets and re-stating the full script in the ## DIALOGUE & VOICEOVER section: ${voiceoverScript}`
            : `\n  No script provided — AUTO-WRITE the dialogue per shot. Embed it inside copyablePrompt: per-shot DIALOGUE bullet (with character + language tag + lip-sync directive) AND a top-level ## DIALOGUE & VOICEOVER section listing every line. Also extract the same spoken text as a plain readable string into autoVoiceoverScript for the UI's voiceover panel.`) +
          `\n  REMINDER: ${targetModel.name} ${targetModel.version} GENERATES dialogue + lip-sync at video-generation time, so the dialogue MUST be embedded in copyablePrompt. autoVoiceoverScript is only a UI convenience field — never the only place dialogue lives.`,
      );
    } else {
      audioBlock.push(
        `- Voiceover: NOT included. autoVoiceoverScript = null, audioSummary.voiceoverIncluded = false. The [VOICEOVER: ...] header line is omitted from copyablePrompt; per-shot DIALOGUE bullets all read "(silent — ambient only)"; the ## DIALOGUE & VOICEOVER section says exactly: "No voiceover for this part — ambient sound only."`,
      );
    }
    if (bgmStyle) {
      audioBlock.push(
        `- Background music: ${bgmStyle}` +
          (bgmTempo ? ` (${bgmTempo})` : "") +
          (bgmInstruments && bgmInstruments.length
            ? ` — instruments: ${bgmInstruments.join(", ")}`
            : "") +
          `\n  Embed the BGM cues inside copyablePrompt: include the [BACKGROUND MUSIC: ...] header, the per-shot AUDIO bullet (with the BGM beat at that moment), and a BGM TRACK + BGM SYNC MAP block inside ## AUDIO DESIGN. ${targetModel.name} ${targetModel.version} generates the music itself; the prompt must give it explicit beat-sync points.`,
      );
    } else {
      audioBlock.push(
        `- Background music: NOT included. Omit the [BACKGROUND MUSIC: ...] header line and the BGM TRACK / BGM SYNC MAP block inside ## AUDIO DESIGN — keep only AMBIENT BED and SFX. audioSummary.bgmIncluded = false.`,
      );
    }

    const userPrompt = `Generate video prompts for ONE part of a multi-part video.

[TARGET MODEL: ${targetModel.name} ${targetModel.version} by ${targetModel.maker} | single-clip range: ${targetModel.durationRangeSeconds.min}-${targetModel.durationRangeSeconds.max}s | recommended mode: ${targetModel.preferredMode}]
The system prompt above includes a TARGET MODEL section with model-specific dialect rules — follow them for copyablePrompt formatting and shot-bullet style. Also mention the target model name inside copyablePrompt's [VIDEO SPEC: ...] header so the user knows which engine the prompt is calibrated for.${framesAsImageReferences ? `\n[FRAME-ANCHOR MODE: ON] — the system prompt includes the FRAME-AS-KEYFRAME ANCHOR block. Embed the "Image 1 / Image 2" first/last-frame instructions EXACTLY as specified there.` : ""}

STORY (full context for all parts):
${describeStory(story)}
${describePreviousParts(previousParts)}
THIS PART:
- Part number: ${part} of ${totalParts}
- Duration of this part: ${duration} seconds (build shots whose timestamps sum to roughly this duration${duration > targetModel.durationRangeSeconds.max ? ` — note ${targetModel.name} ${targetModel.version} caps single clips at ${targetModel.durationRangeSeconds.max}s, so this part will need to be rendered as a sequence of ≤${targetModel.durationRangeSeconds.max}s clips; structure SHOT timestamps accordingly` : ""})
- Style: ${style}${aspectRatio ? `\n- Aspect ratio: ${aspectRatio}. Frame every shot natively for ${aspectRatio} — choose camera angles, subject placement, and negative space that read correctly at this ratio (e.g. for 9:16 favor vertical compositions and tight headroom; for 21:9 emphasize wide horizontal landscapes; for 1:1 center the subject). Mention the aspect ratio inside copyablePrompt's [VIDEO SPEC: ...] header so the model renders to the correct frame.` : ""}
${previousLastFrame ? `- Previous part ended on this frame (the FIRST shot of this part must continue from it):\n  ${previousLastFrame}` : "- This is the FIRST part — no previous frame to continue from."}

AUDIO FOR THIS PART:
${audioBlock.join("\n")}

Output the JSON described in the system prompt.`;

    const model = pickModel({ route: "generate-video-prompts" });
    await respondWithHeartbeat(res, "generate-video-prompts", async () => {
      const result = await generateJson({
        systemPrompt: buildVideoPromptSystem({
          base: VIDEO_PROMPTS_SYSTEM_PROMPT,
          mode,
          frameSettings,
          hasReferenceImages: Boolean(inlineRefs && inlineRefs.length > 0),
          videoModel: videoModel ?? DEFAULT_VIDEO_MODEL,
          framesAsImageReferences: Boolean(framesAsImageReferences),
          partDuration: duration,
        }),
        userPrompt,
        schema: GenerateVideoPromptsResponse,
        label: "generate-video-prompts",
        validate: makeVideoPromptValidator(
          duration,
          "generate-video-prompts",
          mode,
          targetModel.durationRangeSeconds.max,
          `${targetModel.name} ${targetModel.version}`,
        ),
        finalRecover: makeRecoverCopyablePrompt(
          duration,
          "generate-video-prompts",
          mode,
          targetModel.durationRangeSeconds.max,
          `${targetModel.name} ${targetModel.version}`,
        ),
        referenceImages: inlineRefs,
        model,
        videoModel: targetModel.slug,
      });
      // Stamp the writer's chosen mode onto the response so the UI's
      // mode badge and copy actions know whether to format buttons for
      // a JSON envelope or a structured-text prompt without re-asking.
      return { ...result, promptMode: mode };
    });
  },
);

router.post(
  "/edit-video-prompts",
  async (req: Request, res: Response) => {
    const parsed = EditVideoPromptsBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const {
      story,
      style,
      duration,
      part,
      totalParts,
      instruction,
      existingPart,
      previousLastFrame,
      previousParts,
      nextFirstShot,
      voiceoverLanguage,
      voiceoverTone,
      voiceoverScript,
      bgmStyle,
      bgmTempo,
      bgmInstruments,
      aspectRatio,
      referenceImages: rawRefs,
      videoModel,
      framesAsImageReferences,
    } = parsed.data;
    const { mode, frameSettings } = resolveModeAndFrames(parsed.data);
    const inlineRefs = toInlineReferenceImages(rawRefs);
    const targetModel = getVideoModelProfile(videoModel ?? DEFAULT_VIDEO_MODEL);

    const audioBlock: string[] = [];
    if (voiceoverLanguage && voiceoverLanguage !== "none") {
      audioBlock.push(
        `- Voiceover language: ${voiceoverLanguage}` +
          (voiceoverTone ? ` (tone: ${voiceoverTone})` : "") +
          (voiceoverScript
            ? `\n  Use this pre-written script verbatim, distributing its lines across the per-shot DIALOGUE bullets and re-stating it in the ## DIALOGUE & VOICEOVER section: ${voiceoverScript}`
            : `\n  No script provided — keep / refresh the dialogue per shot inside copyablePrompt: per-shot DIALOGUE bullet (with character + language tag + lip-sync directive) AND a top-level ## DIALOGUE & VOICEOVER section. Also extract the spoken text into autoVoiceoverScript for the UI.`) +
          `\n  REMINDER: ${targetModel.name} ${targetModel.version} GENERATES dialogue + lip-sync at video-generation time, so the dialogue MUST be embedded in copyablePrompt. autoVoiceoverScript is only a UI convenience field.`,
      );
    } else {
      audioBlock.push(
        `- Voiceover: NOT included. autoVoiceoverScript = null. Omit the [VOICEOVER: ...] header; per-shot DIALOGUE bullets read "(silent — ambient only)"; the ## DIALOGUE & VOICEOVER section says exactly: "No voiceover for this part — ambient sound only."`,
      );
    }
    if (bgmStyle) {
      audioBlock.push(
        `- Background music: ${bgmStyle}` +
          (bgmTempo ? ` (${bgmTempo})` : "") +
          (bgmInstruments && bgmInstruments.length
            ? ` — instruments: ${bgmInstruments.join(", ")}`
            : "") +
          `\n  Embed the BGM cues inside copyablePrompt: [BACKGROUND MUSIC: ...] header, per-shot AUDIO bullet, and a BGM TRACK + BGM SYNC MAP block inside ## AUDIO DESIGN.`,
      );
    } else {
      audioBlock.push(
        `- Background music: NOT included. Omit the [BACKGROUND MUSIC: ...] header and the BGM TRACK / BGM SYNC MAP block inside ## AUDIO DESIGN — keep only AMBIENT BED and SFX.`,
      );
    }

    const userPrompt = `Refine ONE existing part of a multi-part video. Apply the writer's instruction LITERALLY. Preserve continuity to the surrounding parts per the rules in the system prompt.

[TARGET MODEL: ${targetModel.name} ${targetModel.version} by ${targetModel.maker} | single-clip range: ${targetModel.durationRangeSeconds.min}-${targetModel.durationRangeSeconds.max}s | recommended mode: ${targetModel.preferredMode}]
The system prompt above includes a TARGET MODEL section with model-specific dialect rules — keep the refined copyablePrompt in that dialect.${framesAsImageReferences ? `\n[FRAME-ANCHOR MODE: ON] — preserve / re-emit the "Image 1 / Image 2" first-and-last-frame block exactly as the system prompt's FRAME-AS-KEYFRAME ANCHOR section specifies.` : ""}

STORY (full context for all parts):
${describeStory(story)}
${describePreviousParts(previousParts)}
THIS PART:
- Part number: ${part} of ${totalParts}
- Duration of this part: ${duration} seconds (keep the refined part roughly the same total duration)
- Style: ${style}${aspectRatio ? `\n- Aspect ratio: ${aspectRatio}. Keep every shot natively framed for ${aspectRatio} — preserve composition discipline for this ratio (e.g. 9:16 vertical, 21:9 ultra-wide, 1:1 centered). Make sure copyablePrompt's [VIDEO SPEC: ...] header still names this aspect ratio.` : ""}
${previousLastFrame ? `- ENTRY CONTINUITY — the previous part ended on this frame; the FIRST shot of the refined part must continue from it (unless the writer's instruction explicitly retargets the opening):\n  ${previousLastFrame}` : "- This is the FIRST part — no entry frame to continue from."}
${nextFirstShot ? `- EXIT CONTINUITY — the NEXT part has already been generated. Its first shot is:\n  ${nextFirstShot}\n  Your refined lastFrameDescription MUST end in a state that allows that next shot to enter seamlessly.` : "- This is the FINAL part — no next-shot constraint on lastFrameDescription."}

AUDIO FOR THIS PART:
${audioBlock.join("\n")}

EXISTING PART (the JSON the writer is refining — preserve everything they did NOT mention):
${JSON.stringify(existingPart)}

WRITER'S INSTRUCTION (apply LITERALLY, this is the only thing that should change unless side-effects are unavoidable):
${instruction}

Output the COMPLETE refined VideoPromptsResponse JSON.`;

    const model = pickModel({ route: "edit-video-prompts" });
    await respondWithHeartbeat(res, "edit-video-prompts", async () => {
      const result = await generateJson({
        systemPrompt: buildVideoPromptSystem({
          base: EDIT_VIDEO_PART_SYSTEM_PROMPT,
          mode,
          frameSettings,
          hasReferenceImages: Boolean(inlineRefs && inlineRefs.length > 0),
          videoModel: videoModel ?? DEFAULT_VIDEO_MODEL,
          framesAsImageReferences: Boolean(framesAsImageReferences),
          partDuration: duration,
        }),
        userPrompt,
        schema: EditVideoPromptsResponse,
        label: "edit-video-prompts",
        validate: makeVideoPromptValidator(
          duration,
          "edit-video-prompts",
          mode,
          targetModel.durationRangeSeconds.max,
          `${targetModel.name} ${targetModel.version}`,
        ),
        finalRecover: makeRecoverCopyablePrompt(
          duration,
          "edit-video-prompts",
          mode,
          targetModel.durationRangeSeconds.max,
          `${targetModel.name} ${targetModel.version}`,
        ),
        referenceImages: inlineRefs,
        model,
        videoModel: targetModel.slug,
      });
      return { ...result, promptMode: mode };
    });
  },
);

router.post("/generate-music-brief", async (req: Request, res: Response) => {
  const parsed = GenerateMusicBriefBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: formatZodError(parsed.error) });
    return;
  }
  const { story, style, mood, duration, language, energyLevel, tempo, totalParts } =
    parsed.data;

  const userPrompt = `Create a music brief that scores the following video.

STORY:
${describeStory(story)}

VIDEO SETTINGS:
- Visual style: ${style}
- Override mood (creator-specified): ${mood}
- Total duration: ${duration} seconds
- Language / cultural context: ${language}
- Energy level (1=calm, 10=explosive): ${energyLevel ?? "(not specified — pick a fitting energy)"}
- Tempo bucket: ${tempo ?? "(not specified — pick a fitting tempo)"}
- Total video parts: ${totalParts ?? 1} (provide one partBreakdown entry per part)

Output the music brief as JSON. The sunoPrompt MUST follow Suno's bracketed tag format.`;

  await respondWithHeartbeat(res, "generate-music-brief", () =>
    generateJson({
      systemPrompt: MUSIC_BRIEF_SYSTEM_PROMPT,
      userPrompt,
      schema: GenerateMusicBriefResponse,
      label: "generate-music-brief",
    }),
  );
});

router.post("/generate-voiceover", async (req: Request, res: Response) => {
  const parsed = GenerateVoiceoverBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: formatZodError(parsed.error) });
    return;
  }
  const { story, style, language, tone, duration, part, pace } = parsed.data;

  const userPrompt = `Write a voiceover script in ${language.toUpperCase()} for ONE part of the following video.

STORY (full context):
${describeStory(story)}

THIS PART:
- Part number: ${part}
- Duration: ${duration} seconds
- Visual style: ${style ?? "(not specified)"}
- Tone: ${tone}
- Pace: ${pace ?? "normal"}

Output the voiceover as JSON. Remember: if language is "hindi", write the script and copyableScript in Devanagari. If "hinglish", use natural code-switched Hindi-English with Hindi in Roman script.`;

  await respondWithHeartbeat(res, "generate-voiceover", () =>
    generateJson({
      systemPrompt: VOICEOVER_SYSTEM_PROMPT,
      userPrompt,
      schema: GenerateVoiceoverResponse,
      label: "generate-voiceover",
      // Voiceover is a simple text rewrite — Haiku finishes 3-5x faster
      // than Sonnet with no observed quality loss on Hindi/English/Hinglish.
      model: pickModel({ route: "generate-voiceover" }),
    }),
  );
});

// ============================================================================
// /expand-prompt + /trim-prompt
// ----------------------------------------------------------------------------
// These two endpoints are writer-facing length adjusters. The model returns
// PLAIN TEXT (or a JSON-encoded string when mode === "json") rather than a
// JSON envelope, so we bypass generateJson and call Anthropic directly. The
// MASTER_SYSTEM_CONTEXT is prepended to keep tone/policy parity with the
// rest of the pipeline. We always echo the chosen mode back so the UI can
// keep its mode badge in sync, and we compute characterCount server-side
// (string length is cheap) so the client never has to double-check.
// ============================================================================

const DEFAULT_TARGET_MIN = 4200;
const DEFAULT_TARGET_MAX = 4500;

async function adjustPrompt(args: {
  systemPrompt: string;
  copyablePrompt: string;
  mode: "normal" | "json";
  targetMin: number;
  targetMax: number;
  label: "expand-prompt" | "trim-prompt";
  verb: "EXPAND" | "TRIM";
  /**
   * Writer-selected target VIDEO model. When omitted, falls back to the
   * default (Seedance 2.0). The model name is woven into the user prompt
   * AND any `{{TARGET_MODEL}}` placeholders inside `systemPrompt` /
   * MASTER_SYSTEM_CONTEXT are substituted, so a writer who picked Veo 3
   * sees an "EXPAND this Veo 3 video prompt..." instruction rather than
   * the legacy hardcoded "Seedance 2.0" string.
   */
  videoModel?: string;
}): Promise<{ copyablePrompt: string; characterCount: number }> {
  const sweet = Math.round((args.targetMin + args.targetMax) / 2);
  const currentLen = args.copyablePrompt.length;
  const profile = getVideoModelProfile(args.videoModel ?? DEFAULT_VIDEO_MODEL);
  const modelLabel = `${profile.name} ${profile.version}`;
  const userPrompt = `${args.verb} this copyablePrompt for a ${modelLabel} video. Current length: ${currentLen} chars. Target band: ${args.targetMin}-${args.targetMax} chars (aim for ~${sweet}). Mode: ${args.mode}.

Return ONLY the ${args.verb === "EXPAND" ? "expanded" : "trimmed"} copyablePrompt — no commentary, no markdown fences, no preamble.

--- ORIGINAL ---
${args.copyablePrompt}
--- END ORIGINAL ---`;

  // Substitute {{TARGET_MODEL_*}} tokens in the master + route system
  // prompts so EXPAND / TRIM instructions reference the writer's chosen
  // engine instead of leaking literal placeholder text or defaulting to
  // "Seedance 2.0".
  const fullSystem = applyModelTokens(
    `${MASTER_SYSTEM_CONTEXT}\n\n${args.systemPrompt}`,
    profile,
  );
  // Expand/Trim are simple text-rewrite ops — Haiku is 3-5x faster and the
  // output (just a length-adjusted version of the input) doesn't need
  // Sonnet-class reasoning.
  const message = await anthropicClient.messages.create({
    model: pickModel({ route: args.label }),
    max_tokens: 4096,
    system: fullSystem,
    messages: [{ role: "user", content: userPrompt }],
  });

  if (message.stop_reason === "max_tokens") {
    throw new Error(
      `${args.label} hit max_tokens — model output was truncated. Try again with a slightly smaller input.`,
    );
  }

  const textBlock = message.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error(`${args.label} returned no text content`);
  }
  const out = textBlock.text.trim();
  if (out.length === 0) {
    throw new Error(`${args.label} returned empty output`);
  }
  return { copyablePrompt: out, characterCount: out.length };
}

router.post("/expand-prompt", async (req: Request, res: Response) => {
  const parsed = ExpandPromptBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: formatZodError(parsed.error) });
    return;
  }
  const {
    copyablePrompt,
    mode = "json",
    targetMin = DEFAULT_TARGET_MIN,
    targetMax = DEFAULT_TARGET_MAX,
  } = parsed.data;

  if (targetMin >= targetMax) {
    res.status(400).json({ error: "targetMin must be less than targetMax" });
    return;
  }

  await respondWithHeartbeat(res, "expand-prompt", async () => {
    const result = await adjustPrompt({
      systemPrompt: EXPAND_PROMPT_SYSTEM_PROMPT,
      copyablePrompt,
      mode,
      targetMin,
      targetMax,
      label: "expand-prompt",
      verb: "EXPAND",
      videoModel: parsed.data.videoModel,
    });
    const response: typeof ExpandPromptResponse._type = { ...result, mode };
    return response;
  });
});

router.post("/trim-prompt", async (req: Request, res: Response) => {
  const parsed = TrimPromptBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: formatZodError(parsed.error) });
    return;
  }
  const {
    copyablePrompt,
    mode = "json",
    targetMin = DEFAULT_TARGET_MIN,
    targetMax = DEFAULT_TARGET_MAX,
  } = parsed.data;

  if (targetMin >= targetMax) {
    res.status(400).json({ error: "targetMin must be less than targetMax" });
    return;
  }

  await respondWithHeartbeat(res, "trim-prompt", async () => {
    const result = await adjustPrompt({
      systemPrompt: TRIM_PROMPT_SYSTEM_PROMPT,
      copyablePrompt,
      mode,
      targetMin,
      targetMax,
      label: "trim-prompt",
      verb: "TRIM",
      videoModel: parsed.data.videoModel,
    });
    const response: typeof TrimPromptResponse._type = { ...result, mode };
    return response;
  });
});

export default router;
