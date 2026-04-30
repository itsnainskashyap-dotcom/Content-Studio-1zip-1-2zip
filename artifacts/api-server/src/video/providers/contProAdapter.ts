/**
 * Cont Pro adapter — Veo 3.1 / Veo 3.1 Fast via Magnific (formerly
 * Freepik). Image-to-video only: every chunk is conditioned on a
 * starting frame (Nano Banana Pro opening frame for part 1, ffmpeg-
 * captured last frame from part N-1 for parts >= 2).
 *
 * Why Magnific instead of Google direct: the previous Google direct
 * `@google/genai` path required a Vertex AI Veo allowlist (the
 * GOOGLE_GENAI_API_KEY route returned HTTP 403 PERMISSION_DENIED for
 * every Veo request on the user's account). Magnific's hosted Veo 3.1
 * is the official Google partner endpoint, accepts the same FREEPIK
 * API key as Cont Ultra (Seedance) so the entire pipeline now uses a
 * single secret, and accepts both base64 AND public HTTPS URLs for
 * the input image — so we keep the existing "ship base64 inline"
 * pattern with no Object Storage URL plumbing.
 *
 * Reference-to-Video (multi-image character lock) is intentionally NOT
 * wired up here because the Magnific reference-to-video endpoint
 * requires public HTTPS URLs (no base64), which would need an Object
 * Storage public-URL pipeline we don't have today. The opening frame
 * is itself rendered with character + location refs by the storyboard
 * stage (Nano Banana Pro), so Part 1 already inherits the locked
 * appearance via the start frame; Parts 2..N inherit via the chained
 * captured last frame.
 */

import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { saveFileToObjectStorage, safeUnlink } from "../../lib/videoStorage";
import { logger } from "../../lib/logger";
import { createTaskAndPoll, downloadMagnificAsset } from "./magnificClient";
import { enforcePromptCap } from "../lib/promptEnvelope";
import type { BuiltAudioSpec } from "../lib/hinglishPhonetics";

/**
 * Magnific Veo 3.1 model slugs by quality tier.
 *  - standard → veo-3-1-fast (faster, lower cost)
 *  - high     → veo-3-1      (full quality)
 * Image-to-video lives at /v1/ai/image-to-video/<slug>.
 * Override either via env if Magnific renames a route.
 */
const VEO_I2V_SLUG_STANDARD =
  process.env.VEO_SLUG_STANDARD ?? "veo-3-1-fast";
const VEO_I2V_SLUG_HIGH = process.env.VEO_SLUG_HIGH ?? "veo-3-1";

function pickVeoSlug(quality: "standard" | "high"): string {
  if (process.env.VEO_SLUG) return process.env.VEO_SLUG;
  return quality === "high" ? VEO_I2V_SLUG_HIGH : VEO_I2V_SLUG_STANDARD;
}

/**
 * Magnific Veo I2V `aspect_ratio` enum is "16:9" or "9:16" only.
 * Anything else is folded into the closest supported orientation.
 */
function toVeoAspect(ratio: string): "16:9" | "9:16" {
  const n = ratio.trim();
  if (n === "9:16" || n === "1:8" || n === "1:4" || n === "9:21" || n === "3:4") {
    return "9:16";
  }
  return "16:9";
}

/**
 * Magnific Veo I2V `duration` enum is 4 | 6 | 8 (seconds). The
 * canonical Cont Pro chunk size is 8s; shorter tails are clamped to
 * the next-lower supported value to avoid HTTP 422.
 */
function toVeoDuration(seconds: number): 4 | 6 | 8 {
  if (seconds <= 4) return 4;
  if (seconds <= 6) return 6;
  return 8;
}

export interface ContProArgs {
  /**
   * Prompt for the 8-second shot. Per the pipeline-fix doc this is
   * now expected to be a JSON-formatted string (≤ 4500 chars), built
   * by the caller via `buildJsonPrompt`. Plain natural-language
   * strings are still accepted (capped defensively).
   */
  prompt: string;
  /** Optional negative prompt (anti-drift cues). */
  negativePrompt?: string;
  /** Aspect ratio: "16:9" | "9:16" | "1:1". */
  aspectRatio: string;
  /** Per spec — ALL parts request 8s, last part trimmed during stitching. */
  durationSeconds: number;
  /**
   * Quality tier: "standard" → Veo 3.1 Fast, "high" → full Veo 3.1.
   * Defaults to "standard" if omitted.
   */
  quality?: "standard" | "high";
  /**
   * Required starting frame. Cont Pro is now image-to-video only —
   * Part 1 uses the Nano Banana Pro opening frame, Parts 2..N use the
   * ffmpeg-captured last frame from the previous chunk.
   */
  startingFrame: { b64: string; mimeType: string };
  /**
   * Optional structured audio spec built via `buildAudioSpec(...)`.
   * When provided, the adapter forwards an `audio_config` field to
   * Magnific Veo so voiceover text + music style + SFX cues land in
   * the generated MP4 instead of being inferred from the prompt only.
   */
  audio?: BuiltAudioSpec;
}

export interface ContProResult {
  videoObjectPath: string;
  /** Local temp file path (caller must delete after frame extraction). */
  localTempPath: string;
}

export async function generateContProClip(
  args: ContProArgs,
): Promise<ContProResult> {
  const {
    prompt,
    negativePrompt,
    aspectRatio,
    durationSeconds,
    startingFrame,
    quality = "standard",
    audio,
  } = args;

  if (!startingFrame) {
    throw new Error(
      "Cont Pro requires a starting frame (image-to-video only via " +
        "Magnific Veo 3.1). Pass the Nano Banana Pro opening frame for " +
        "Part 1, or the captured last frame for Parts 2+.",
    );
  }

  const slug = pickVeoSlug(quality);
  const veoAspect = toVeoAspect(aspectRatio);
  const veoDuration = toVeoDuration(durationSeconds);

  // Hard cap the prompt at 4500 chars (user's pipeline-fix requirement).
  // Caller normally builds the JSON-formatted prompt via
  // `buildJsonPrompt`, which already enforces the cap, but we re-check
  // defensively in case a caller passed a raw string.
  const cappedPrompt = enforcePromptCap(prompt, "contProAdapter");

  const body: Record<string, unknown> = {
    prompt: cappedPrompt,
    image: `data:${startingFrame.mimeType};base64,${startingFrame.b64}`,
    duration: veoDuration,
    resolution: process.env.VEO_RESOLUTION ?? "720p",
    aspect_ratio: veoAspect,
    generate_audio: true,
  };
  if (audio) {
    body.audio_config = {
      generate_voiceover: Boolean(audio.voiceover.text),
      generate_sound_effects: audio.soundEffects.length > 0,
      generate_background_music: Boolean(audio.backgroundMusic.genre),
      voiceover_text: audio.voiceover.text,
      voiceover_language: audio.voiceover.language,
      voiceover_tone: audio.voiceover.tone,
      voiceover_start_at_second: audio.voiceover.startAtSecond,
      voiceover_pace: audio.voiceover.pace,
      music_style: audio.backgroundMusic.genre,
      music_bpm: audio.backgroundMusic.bpm,
      music_instruments: audio.backgroundMusic.instruments,
      music_energy: audio.backgroundMusic.energy,
      music_fade_in: audio.backgroundMusic.fadeIn,
      music_fade_out: audio.backgroundMusic.fadeOut,
      sound_effects: audio.soundEffects,
    };
  }
  if (negativePrompt && negativePrompt.length > 0) {
    body.negative_prompt = negativePrompt;
  }

  logger.info(
    {
      slug,
      quality,
      mode: "i2v",
      durationSeconds: veoDuration,
      aspectRatio: veoAspect,
      promptChars: cappedPrompt.length,
      audioEnabled: Boolean(audio),
    },
    "Cont Pro: starting Magnific Veo 3.1 generation",
  );

  // Veo I2V can take 2-6 minutes for the high-quality tier. Bump the
  // poll/timeout above the shared default to match.
  const result = await createTaskAndPoll(
    `image-to-video/${slug}`,
    body,
    {
      pollIntervalMs: 10_000,
      maxWaitMs: 15 * 60 * 1000,
      label: `cont-pro-${slug}`,
    },
  );

  const videoUrl = result.generated[0];
  const dl = await downloadMagnificAsset(videoUrl);

  const dir = await mkdtemp(path.join(tmpdir(), "video-studio-veo-"));
  const localPath = path.join(dir, "chunk.mp4");
  await writeFile(localPath, dl.buffer);

  const { objectPath } = await saveFileToObjectStorage(localPath, "video/mp4");
  logger.info(
    { objectPath, taskId: result.taskId },
    "Cont Pro: clip saved to object storage",
  );
  return { videoObjectPath: objectPath, localTempPath: localPath };
}

export async function cleanupContProTemp(localPath: string): Promise<void> {
  await safeUnlink(localPath);
}
