/**
 * Cont Ultra adapter — Seedance 2.0 image-to-video via the unified
 * Magnific (formerly Freepik) client. Image-to-video only: every chunk
 * is conditioned on a starting frame (Nano Banana Pro opening frame for
 * part 1, captured last frame from part N-1 for parts ≥ 2). Polls the
 * Magnific task until the MP4 url is ready, downloads it, and persists
 * it to Object Storage.
 *
 * Uses {@link createTaskAndPoll} so it sends both the new
 * `x-magnific-api-key` header and the legacy `x-freepik-api-key`
 * header against `api.magnific.com`, matching every other generation
 * adapter in the app.
 */

import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { saveFileToObjectStorage, safeUnlink } from "../../lib/videoStorage";
import { logger } from "../../lib/logger";
import {
  createTaskAndPoll,
  downloadMagnificAsset,
} from "./magnificClient";
import { enforcePromptCap } from "../lib/promptEnvelope";
import type { BuiltAudioSpec } from "../lib/hinglishPhonetics";

/**
 * Magnific Seedance image-to-video model slugs by quality tier.
 *  - standard → seedance-lite-720p (Seedance 2.0 Fast/Lite, 720p)
 *  - high     → seedance-pro-720p  (Seedance 2.0 Pro, 720p — same
 *                                   resolution as standard but the
 *                                   full Pro model produces sharper,
 *                                   more accurate motion)
 * Image-to-video lives at /v1/ai/image-to-video/<slug>.
 * Override either slug via env if Magnific renames a route.
 */
const SEEDANCE_I2V_SLUG_STANDARD =
  process.env.SEEDANCE_SLUG_STANDARD ?? "seedance-lite-720p";
const SEEDANCE_I2V_SLUG_HIGH =
  process.env.SEEDANCE_SLUG_HIGH ?? "seedance-pro-720p";

function pickSeedanceI2VSlug(quality: "standard" | "high"): string {
  if (process.env.SEEDANCE_SLUG) return process.env.SEEDANCE_SLUG;
  return quality === "high" ? SEEDANCE_I2V_SLUG_HIGH : SEEDANCE_I2V_SLUG_STANDARD;
}

/**
 * Magnific Seedance I2V uses named aspect-ratio enums, not the standard
 * "W:H" form everyone else uses. Mapping per Magnific's 422 validation
 * error message:
 *   16:9 → widescreen_16_9       9:16 → social_story_9_16
 *   21:9 → film_horizontal_21_9  9:21 → film_vertical_9_21
 *   4:3  → classic_4_3           3:4  → traditional_3_4
 *   1:1  → square_1_1
 * Anything else falls back to widescreen_16_9 so we never trip a 400.
 */
function toSeedanceAspect(ratio: string): string {
  const normalized = ratio.trim().toLowerCase().replace(/\s+/g, "");
  switch (normalized) {
    case "16:9":
      return "widescreen_16_9";
    case "9:16":
      return "social_story_9_16";
    case "21:9":
      return "film_horizontal_21_9";
    case "9:21":
      return "film_vertical_9_21";
    case "4:3":
      return "classic_4_3";
    case "3:4":
      return "traditional_3_4";
    case "1:1":
      return "square_1_1";
    default:
      return "widescreen_16_9";
  }
}

export interface ContUltraArgs {
  /**
   * The prompt as it should be sent to Magnific Seedance. Per the
   * pipeline-fix doc this is now expected to be a JSON-formatted
   * string (≤ 4500 chars) — built by the caller via `buildJsonPrompt`.
   * Plain natural-language strings still work.
   */
  prompt: string;
  negativePrompt?: string;
  aspectRatio: string; // "16:9" | "9:16" | "1:1"
  durationSeconds: number;
  /** Quality tier: standard → Seedance Lite 720p (Fast), high → Seedance Pro 720p (sharper, more accurate motion at the same resolution). */
  quality?: "standard" | "high";
  /**
   * Required starting frame. Cont Ultra is image-to-video only — every
   * chunk must be conditioned on a frame (Nano Banana Pro opening frame
   * for part 1, captured last frame from part N-1 for parts ≥ 2).
   */
  startingFrame: { b64: string; mimeType: string };
  /**
   * Optional structured audio spec built via `buildAudioSpec(...)`.
   * When provided, the adapter sends `generate_audio: true` plus a
   * Magnific-shaped `audio_config` field so Seedance produces
   * voiceover + SFX + BGM. Without this, Seedance generates a silent
   * MP4 — which was the user's "no audio" complaint pre-fix.
   */
  audio?: BuiltAudioSpec;
}

export interface ContUltraResult {
  videoObjectPath: string;
  localTempPath: string;
}

export async function generateContUltraClip(
  args: ContUltraArgs,
): Promise<ContUltraResult> {
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
      "Cont Ultra requires a starting frame (image-to-video only). " +
        "Pure text-to-video is no longer supported.",
    );
  }

  const slug = pickSeedanceI2VSlug(quality);

  // Cont Ultra (Seedance 2.0 I2V via Magnific) only accepts duration
  // 5 or 10. We size each chunk to match the canonical engine chunk
  // size from chunkPlanner (10s) so each part is generated in ONE
  // task; shorter tails are clamped to 5 to avoid 422.
  const requestedDuration: "5" | "10" = durationSeconds <= 6 ? "5" : "10";

  // Hard cap the prompt at 4500 chars (user's pipeline-fix requirement).
  // The caller builds it via `buildJsonPrompt`, but if the caller passed
  // a raw string we still need to enforce the cap defensively.
  const cappedPrompt = enforcePromptCap(prompt, "contUltraAdapter");

  const body: Record<string, unknown> = {
    prompt: cappedPrompt,
    duration: requestedDuration,
    aspect_ratio: toSeedanceAspect(aspectRatio),
    seed: Math.floor(Math.random() * 1_000_000),
    image: `data:${startingFrame.mimeType};base64,${startingFrame.b64}`,
    // ALWAYS request audio. Without these flags Seedance ships a silent
    // MP4 — the user's "no voice / no music" complaint pre-fix.
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
      durationSeconds: requestedDuration,
      promptChars: cappedPrompt.length,
      audioEnabled: Boolean(audio),
    },
    "Cont Ultra: starting Seedance generation",
  );

  const { generated, taskId } = await createTaskAndPoll(
    `image-to-video/${slug}`,
    body,
    { label: `cont-ultra-${slug}` },
  );
  const videoUrl = generated[0];
  if (!videoUrl) {
    throw new Error(
      `Cont Ultra task ${taskId} completed with no video URL`,
    );
  }

  const { buffer } = await downloadMagnificAsset(videoUrl);
  const dir = await mkdtemp(path.join(tmpdir(), "video-studio-seedance-"));
  const localPath = path.join(dir, "chunk.mp4");
  await writeFile(localPath, buffer);

  const { objectPath } = await saveFileToObjectStorage(localPath, "video/mp4");
  return { videoObjectPath: objectPath, localTempPath: localPath };
}

export async function cleanupContUltraTemp(localPath: string): Promise<void> {
  await safeUnlink(localPath);
}
