/**
 * Storyboard engine — Phase 3 real implementation.
 *
 *   buildVisualBible(...)       Nano Banana 2 generates one reference
 *                               frame per character + one for the
 *                               primary location + one opening film
 *                               still.
 *
 *   runContinuousLoop(...)      For every chunk:
 *                                 1) Claude writes the JSON prompt
 *                                    (with full continuity context).
 *                                 2) The provider adapter (Cont Pro or
 *                                    Cont Ultra) generates the 8s clip,
 *                                    seeded with the locked starting
 *                                    frame (Nano Banana 2 opening frame
 *                                    for part 1, captured last frame
 *                                    for parts 2..N).
 *                                 3) FFmpeg captures the real last
 *                                    frame; Claude summarizes the chunk;
 *                                    the loop continues.
 */

import type { VideoStudioJobRequest } from "@workspace/api-zod";
import type {
  ChunkPart,
  EngineModel,
  JsonVideoPrompt,
  NormalizedStory,
  VisualBible,
  VisualBibleCharacter,
  VisualBibleLocation,
} from "./types";
import { generateNanoBananaFrame } from "./providers/nanoBananaAdapter";
import {
  generateContProClip,
  cleanupContProTemp,
} from "./providers/contProAdapter";
import {
  generateContUltraClip,
  cleanupContUltraTemp,
} from "./providers/contUltraAdapter";
import {
  generateInitialStoryboard,
  generatePerPartJsonPrompt,
  summarizeChunkAfterGeneration,
  type Storyboard,
} from "./providers/claude46Adapter";
import { captureLastFrame } from "./frameCapture";
import { logger } from "../lib/logger";
import { buildJsonPrompt, MAX_PROMPT_CHARS } from "./lib/promptEnvelope";
import {
  buildAudioSpec,
  type AudioDirection,
} from "./lib/hinglishPhonetics";

const MAX_CHUNK_RETRIES = 2;

/* ============================== visual bible ============================== */

export async function buildVisualBible(args: {
  jobId: string;
  story: NormalizedStory;
  request: VideoStudioJobRequest;
  /**
   * Optional progress hook. Called between each NB2 reference-frame
   * call so the engine can surface per-character/per-asset progress to
   * the UI (e.g. "Designing character 2 of 5: Aarav"). Without this,
   * the entire visual-bible stage looks frozen on `Designing
   * characters...` for 30-60s — the user's complaint.
   */
  onStageMessage?: (msg: { message: string; progressPercent: number }) => Promise<void>;
  /**
   * Optional partial-bible hook. Called after every successful NB2
   * call with the visual bible AS BUILT SO FAR. The engine forwards
   * this to `updateJob({ visualBible })` so the polling frontend can
   * render character cards/opening frame as they arrive — the user's
   * complaint that "nothing visible happens during generation" is
   * fixed by streaming this partial state instead of writing only the
   * final bible at the end of the stage.
   */
  onPartialBible?: (partial: VisualBible) => Promise<void>;
}): Promise<VisualBible> {
  const { story, request, onStageMessage, onPartialBible } = args;
  const aspectRatio = request.aspectRatio;
  const totalAssets = story.characters.length + 2; // chars + location + opening
  let assetIdx = 0;
  const reportProgress = async (label: string) => {
    assetIdx++;
    if (!onStageMessage) return;
    // Designing-chars stage runs from 6% → 14% in the parent engine.
    // Spread per-asset bumps inside that band so the progress bar
    // visibly moves (1.0 → 1.0 + 7 / N per asset).
    const pct = 6 + Math.round((assetIdx / totalAssets) * 7);
    await onStageMessage({ message: label, progressPercent: pct }).catch(() => {
      // Progress writes are best-effort; never fail the build for them.
    });
  };

  // Character reference frames — generated with bounded concurrency so
  // a 3-5 character story doesn't pay the full N×call latency. If a
  // character's primary attempt fails after NB2's internal retries,
  // we fall back to a simplified prompt before giving up — without
  // the reference frame, that character's continuity in the rendered
  // video is materially weaker, so a fallback is worth the extra call.
  const CHARACTER_CONCURRENCY = 3;
  const characters: VisualBibleCharacter[] = [];
  const locations: VisualBibleLocation[] = [];
  // Stable style-lock object so we can keep emitting partial bibles
  // with the same shape as the final bible (the field is mandatory
  // on the type).
  const styleLock = {
    visualStyle: story.visualStyle || "cinematic photoreal",
    colorGrade: story.voiceoverTone || "natural cinematic",
    cameraLanguage: "handheld-stabilized to gimbal-smooth, prime lens look",
    qualityRules: [
      "photoreal subjects, no plastic skin",
      "physically plausible motion",
      "consistent global lighting per part",
      "no overlay text or watermarks",
    ],
  } as VisualBible["styleLock"];
  let opening: { objectPath: string; b64: string; mimeType: string } | null = null;
  // Emit the bible-so-far so the frontend can render whatever is
  // ready (e.g. 2 of 5 character cards). Best-effort — never fails
  // the build.
  const emitPartial = async (label?: string) => {
    if (!onPartialBible) return;
    await onPartialBible({
      characters: [...characters],
      locations: [...locations],
      styleLock,
      openingFrame: opening
        ? {
            objectPath: opening.objectPath,
            b64: opening.b64,
            mimeType: opening.mimeType,
            prompt: openingPromptForPartial,
          }
        : undefined,
    }).catch(() => {
      logger.warn({ label }, "buildVisualBible: onPartialBible threw, ignoring");
    });
  };
  // Captured later when the opening frame is generated; we keep a
  // hoisted slot so emitPartial above can read it without TDZ issues.
  let openingPromptForPartial = "";
  // Pre-allocate a result slot per character so concurrent completions
  // never reorder the array (UI cards must match the story order).
  const charSlots: Array<VisualBibleCharacter | null> = story.characters.map(
    () => null,
  );
  const buildCharacterRef = async (
    c: (typeof story.characters)[number],
    idx: number,
  ): Promise<void> => {
    await reportProgress(
      `Designing character ${idx + 1} of ${story.characters.length}: ${c.name}…`,
    );
    // Structured spec → JSON-formatted prompt (≤ 4500 chars). The
    // adapter wraps it in `buildJsonPrompt`, sends to Magnific NB Pro,
    // then runs Gemini vision validation + retries on mismatch
    // (user's pipeline-fix requirement).
    const charSpec = {
      type: "character_reference_plate",
      character: {
        name: c.name,
        description_must_match_exactly: c.continuityLock,
        outfit: c.outfit,
      },
      framing: {
        composition: "centered, fully visible, fills 60% of frame",
        camera: "medium-close reference portrait, neutral cinematic prime lens",
        lighting: "neutral cinematic key + soft fill, photoreal skin tones",
      },
      style: {
        look: "hyperreal cinematic film still",
        grade: "natural skin tones, no plastic",
        aspect_ratio: aspectRatio,
      },
      negative: [
        "background characters",
        "overlay text",
        "logo",
        "watermark",
        "stylized cartoon",
        "blurry",
        "low resolution",
      ],
      purpose:
        "Lock face, hair, build, and outfit so every video chunk renders the same person.",
    };
    let nbOut: { objectPath: string; b64: string; mimeType: string } | null = null;
    let primaryErr: unknown = null;
    try {
      nbOut = await generateNanoBananaFrame({
        spec: charSpec,
        aspectRatio,
        envelopeOpts: {
          dropOrder: ["purpose", "negative"],
        },
        qc: {
          label: `char:${c.id}`,
          expectedSpec:
            `A single hyperreal cinematic portrait of "${c.name}". ` +
            `MUST MATCH: ${c.continuityLock}. Outfit: ${c.outfit}. ` +
            `No other characters, no text, no logo. Aspect ${aspectRatio}.`,
        },
      });
    } catch (err) {
      primaryErr = err;
      logger.warn(
        { err, characterId: c.id },
        "Visual bible: NB2 frame failed for character, attempting simplified fallback",
      );
      // Fallback: a much shorter prompt (still JSON-shaped) that's less
      // likely to trip a safety / parsing edge case. Better to ship a
      // slightly less specific reference than none at all.
      const fallbackSpec = {
        type: "character_reference_plate",
        description: c.continuityLock,
        framing: "centered, neutral lighting, single subject",
        aspect_ratio: aspectRatio,
        negative: ["background characters", "overlay text"],
      };
      try {
        nbOut = await generateNanoBananaFrame({
          spec: fallbackSpec,
          aspectRatio,
          qc: { label: `char-fallback:${c.id}` },
        });
        logger.info(
          { characterId: c.id, jobId: args.jobId },
          "Visual bible: character reference recovered via simplified fallback",
        );
      } catch (fallbackErr) {
        logger.error(
          { err: fallbackErr, characterId: c.id, jobId: args.jobId },
          "Visual bible: character reference fallback also failed",
        );
        // FAIL LOUD: a missing character reference is the root cause
        // of "scenes start before characters render" complaints.
        // Without a ref, downstream chunk generation produces a
        // different face every part. Stop the job here with a clear
        // user-facing message rather than ship a half-built bible.
        const detail =
          fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
        throw new Error(
          `Could not generate a reference frame for character "${c.name}". The image model rejected both the detailed and simplified prompts (${detail}). Try rewriting this character's description with simpler, neutral language and start a new job.`,
        );
      }
    }
    if (!nbOut || !nbOut.objectPath) {
      // Defensive: NB2 returned a falsy object path despite no throw.
      // Treat as failure so we never persist an empty reference.
      const detail =
        primaryErr instanceof Error ? primaryErr.message : "no image returned";
      throw new Error(
        `Reference frame for character "${c.name}" came back empty (${detail}). Please try again.`,
      );
    }
    charSlots[idx] = {
      id: c.id,
      name: c.name,
      referenceImageObjectPath: nbOut.objectPath,
      referenceImageB64: nbOut.b64,
      referenceImageMime: nbOut.mimeType,
      faceLock: c.continuityLock,
      outfitLock: c.outfit,
      negativeRules: [
        "different face",
        "different hair",
        "different outfit",
        "age change",
        "ethnicity change",
        "gender change",
      ],
    };
    // Push completed slots in order into the public characters array
    // so emitPartial sees them in story order. Only flush slots that
    // are contiguous from the current head, so a fast-completing
    // character at index 3 doesn't appear before a still-pending one
    // at index 1.
    while (
      characters.length < charSlots.length &&
      charSlots[characters.length] !== null
    ) {
      // Non-null asserted by the loop predicate above.
      characters.push(charSlots[characters.length] as VisualBibleCharacter);
    }
    await emitPartial(`character:${c.id}`);
  };

  // Bounded-parallel pool. Workers pull the next index off a shared
  // counter — simpler than chunking and gives steady provider pressure.
  let nextIdx = 0;
  const workers: Promise<void>[] = [];
  const workerCount = Math.min(CHARACTER_CONCURRENCY, story.characters.length);
  for (let w = 0; w < workerCount; w++) {
    workers.push(
      (async () => {
        while (true) {
          const i = nextIdx++;
          if (i >= story.characters.length) return;
          const c = story.characters[i];
          if (!c) return;
          await buildCharacterRef(c, i);
        }
      })(),
    );
  }
  await Promise.all(workers);

  // Primary location reference.
  await reportProgress("Designing primary location…");
  const primaryLoc = story.locations[0];
  // Structured location spec → JSON envelope. Same vision-validation
  // path as character refs.
  const locSpec = {
    type: "location_reference_plate",
    location: {
      name: primaryLoc.name,
      description: primaryLoc.description,
      lighting: primaryLoc.lighting,
      mood: primaryLoc.mood,
    },
    framing: {
      composition: "establishing wide-to-medium, no humans in frame",
      camera: "neutral cinematic prime, eye-level unless otherwise needed",
    },
    style: {
      look: "hyperreal cinematic film still",
      grade: "photoreal, atmospheric depth",
      aspect_ratio: aspectRatio,
    },
    negative: ["characters", "overlay text", "logo", "watermark", "blurry"],
    purpose:
      "Lock the primary environment so every chunk reads as the same place.",
  };
  let locOut: { objectPath: string; b64: string; mimeType: string } | null = null;
  try {
    locOut = await generateNanoBananaFrame({
      spec: locSpec,
      aspectRatio,
      envelopeOpts: { dropOrder: ["purpose", "negative"] },
      qc: {
        label: `loc:${primaryLoc.id}`,
        expectedSpec:
          `A single hyperreal cinematic establishing shot of "${primaryLoc.name}". ` +
          `${primaryLoc.description}. Lighting: ${primaryLoc.lighting}. ` +
          `No people, no text. Aspect ${aspectRatio}.`,
      },
    });
  } catch (err) {
    logger.warn(
      { err, jobId: args.jobId },
      "Visual bible: NB2 location frame failed, attempting simplified fallback",
    );
    const locFallbackSpec = {
      type: "location_reference_plate",
      location: primaryLoc.name,
      lighting: primaryLoc.lighting,
      framing: "wide establishing, no characters",
      aspect_ratio: aspectRatio,
    };
    try {
      locOut = await generateNanoBananaFrame({
        spec: locFallbackSpec,
        aspectRatio,
        qc: { label: `loc-fallback:${primaryLoc.id}` },
      });
      logger.info(
        { jobId: args.jobId },
        "Visual bible: location reference recovered via simplified fallback",
      );
    } catch (err2) {
      const detail = err2 instanceof Error ? err2.message : String(err2);
      throw new Error(
        `Could not generate the location reference frame for "${primaryLoc.name}" (${detail}). Try simplifying the location description.`,
      );
    }
  }
  if (!locOut?.objectPath) {
    throw new Error(
      `Location reference for "${primaryLoc.name}" came back empty. Please try again.`,
    );
  }
  locations.push({
    id: primaryLoc.id,
    name: primaryLoc.name,
    referenceImageObjectPath: locOut.objectPath,
    referenceImageB64: locOut.b64,
    referenceImageMime: locOut.mimeType,
    lightingLock: primaryLoc.lighting,
    environmentLock: primaryLoc.description,
  });
  await emitPartial("location");

  // Opening frame — used to seed part 1's image-to-video.
  await reportProgress("Designing opening frame…");
  const openingSpec = {
    type: "opening_film_still",
    film: {
      title: story.title,
      logline: story.logline,
      first_beat: story.storyBeats[0]?.summary ?? "the inciting moment",
    },
    framing: {
      composition: "establishing wide-to-medium for film opener",
      camera: "neutral cinematic prime, opener composition",
      lighting: `mood-grade matching ${story.voiceoverTone}`,
    },
    style: {
      look: `hyperreal cinematic, ${story.visualStyle}`,
      grade: `mood: ${story.voiceoverTone}`,
      aspect_ratio: aspectRatio,
    },
    negative: ["overlay text", "logo", "watermark", "blurry", "low resolution"],
  };
  const openingExpectedSpec =
    `Hyperreal cinematic opening film still: ${story.storyBeats[0]?.summary ?? "the inciting moment"}. ` +
    `Style: ${story.visualStyle}. Mood: ${story.voiceoverTone}. ` +
    `No overlay text. Aspect ${aspectRatio}.`;
  // Keep a stringified preview for partial-bible emission so the UI
  // can render the opening prompt as a card while it's being generated.
  openingPromptForPartial = JSON.stringify(openingSpec);
  // Pixel-level visual lock: feed the just-generated character +
  // location reference plates into Nano Banana Pro as
  // `reference_images`. Magnific NB Pro accepts up to 3 refs, so we
  // prioritise the primary location (sets the world) + the first two
  // story-order characters (sets the faces seen first). The remaining
  // character refs still influence downstream chunks via the JSON
  // prompt's `must_match_exactly` blocks. We mirror the same set
  // into QC so the validator scores against the actual locked images
  // instead of a paraphrase.
  const openingRefs = collectOpeningReferences(characters, locations);
  try {
    opening = await generateNanoBananaFrame({
      spec: openingSpec,
      aspectRatio,
      referenceImages: openingRefs,
      envelopeOpts: { dropOrder: ["negative"] },
      qc: {
        label: "opening",
        expectedSpec: openingExpectedSpec,
        references: openingRefs,
      },
    });
  } catch (err) {
    logger.warn(
      { err, jobId: args.jobId },
      "Visual bible: NB2 opening frame failed, attempting simplified fallback",
    );
  }
  // The opening frame is ALWAYS required now (both Cont Pro & Cont
  // Ultra) because the chained-frame loop and the Veo reference-image
  // path both depend on it. If the primary prompt failed, try a
  // simplified one before giving up.
  if (!opening) {
    const fallbackOpeningSpec = {
      type: "opening_film_still",
      logline: story.logline,
      framing: "single establishing wide shot, neutral cinematic lighting",
      aspect_ratio: aspectRatio,
      negative: ["overlay text", "logo", "watermark"],
    };
    openingPromptForPartial = JSON.stringify(fallbackOpeningSpec);
    try {
      opening = await generateNanoBananaFrame({
        spec: fallbackOpeningSpec,
        aspectRatio,
        // Keep the visual lock active even on the simplified retry —
        // a simpler prompt + locked refs is the best chance of
        // recovering an opening that still matches the cast/world.
        referenceImages: openingRefs,
        qc: {
          label: "opening-fallback",
          expectedSpec: openingExpectedSpec,
          references: openingRefs,
        },
      });
      logger.info(
        { jobId: args.jobId },
        "Visual bible: opening frame recovered via simplified fallback prompt",
      );
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Could not generate the opening film still (${detail}). Try shortening the story logline or using simpler language.`,
      );
    }
  }
  if (!opening?.objectPath) {
    throw new Error(
      "Opening film still came back empty. Please try again.",
    );
  }
  // Final emit so the saved bible always matches what's on disk.
  await emitPartial("opening");

  return {
    characters,
    locations,
    styleLock,
    openingFrame: {
      objectPath: opening.objectPath,
      b64: opening.b64,
      mimeType: opening.mimeType,
      prompt: openingPromptForPartial,
    },
  };
}

/* ============================== main loop ============================== */

export interface ChunkRunResult {
  partNumber: number;
  videoObjectPath: string;
  lastFrameObjectPath: string;
  summary: string;
  durationSeconds: number;
}

export interface RunLoopArgs {
  jobId: string;
  request: VideoStudioJobRequest;
  plan: ChunkPart[];
  normalizedStory: NormalizedStory;
  visualBible: VisualBible;
  onProgress: (a: {
    partNumber: number;
    totalParts: number;
    stage: "preparing" | "generating";
  }) => Promise<void>;
  onChunkUpdate: (a: {
    partNumber: number;
    patch: {
      status?: "pending" | "generating" | "complete" | "failed";
      jsonPrompt?: unknown;
      videoObjectPath?: string | null;
      lastFrameObjectPath?: string | null;
      summary?: string | null;
      attempts?: number;
      error?: string | null;
    };
  }) => Promise<void>;
}

export async function runContinuousLoop(
  args: RunLoopArgs,
): Promise<ChunkRunResult[]> {
  const { request, plan, normalizedStory, visualBible, onProgress, onChunkUpdate } =
    args;
  const engineModel = request.model as EngineModel;

  // Up-front storyboard so per-part prompts share a single plan.
  const storyboard = await generateInitialStoryboard({
    normalizedStory,
    visualBibleSummary: summarizeBible(visualBible),
    totalParts: plan.length,
    durationSeconds: request.durationSeconds,
    engineModel,
  });

  const chunks: ChunkRunResult[] = [];
  let previousChunkSummary = "";
  let previousJsonPrompt: JsonVideoPrompt | null = null;
  let previousLastFrame: { objectPath: string; b64: string; mimeType: string } | null = null;

  for (const part of plan) {
    await onProgress({
      partNumber: part.partNumber,
      totalParts: plan.length,
      stage: "preparing",
    });
    await onChunkUpdate({
      partNumber: part.partNumber,
      patch: { status: "generating" },
    });

    let attempts = 0;
    let lastErr: unknown = null;
    let chunkResult: ChunkRunResult | null = null;
    while (attempts <= MAX_CHUNK_RETRIES && chunkResult === null) {
      attempts++;
      try {
        // 1) JSON prompt with full continuity context.
        const jsonPrompt = await generatePerPartJsonPrompt({
          normalizedStory,
          visualBible,
          storyboard,
          partNumber: part.partNumber,
          totalParts: plan.length,
          timeRange: part.timeRange,
          engineModel,
          voiceoverEnabled: request.voiceoverEnabled ?? true,
          voiceoverLanguage: request.voiceoverLanguage ?? null,
          bgmEnabled: request.bgmEnabled ?? true,
          previousChunkSummary,
          previousLastFrameObjectPath: previousLastFrame?.objectPath ?? null,
          previousJsonPrompt,
        });

        await onChunkUpdate({
          partNumber: part.partNumber,
          patch: { jsonPrompt: jsonPrompt as unknown, attempts },
        });

        // 2) Provider call. Part 1 seeds with opening frame; part N>1
        //    seeds with the real captured last frame from part N-1.
        await onProgress({
          partNumber: part.partNumber,
          totalParts: plan.length,
          stage: "generating",
        });
        // Per pipeline-fix doc: ship the JsonVideoPrompt as a JSON
        // string (≤ 4500 chars) directly to Veo / Seedance. The old
        // NL-flattening path was discarding 60-70% of the structured
        // direction; modern video models read structured-looking
        // prompts well.
        const videoJsonPrompt = serializeVideoJsonPrompt(jsonPrompt);
        const negative = jsonPrompt.negativePrompt.join(", ");

        // Pull the audio block out of the JSON prompt and turn it into
        // the structured BuiltAudioSpec the adapter posts as
        // `audio_config`. Hinglish phonetics applied automatically
        // when the user picked "hinglish" voiceover.
        const audioDirection: AudioDirection = {
          voiceoverText: jsonPrompt.audio.voiceoverText,
          voiceoverTone: jsonPrompt.audio.voiceoverTone,
          musicDirection: [
            jsonPrompt.audio.backgroundMusic.style,
            jsonPrompt.audio.backgroundMusic.tempo,
            jsonPrompt.audio.backgroundMusic.instruments,
          ]
            .filter(Boolean)
            .join(", "),
          soundEffects: jsonPrompt.audio.soundEffects,
        };
        const audioSpec = buildAudioSpec(
          audioDirection,
          jsonPrompt.audio.voiceoverLanguage,
          engineModel === "cont_pro" ? "veo" : "seedance",
        );

        // Each engine has its own canonical chunk size — Cont Pro = 8s
        // (Veo 3.x), Cont Ultra = 10s (Seedance I2V on Freepik only
        // accepts duration 5 or 10). We ask the provider to render the
        // FULL chunk; the stitcher trims to part.durationSeconds.
        const chunkRequestSeconds =
          engineModel === "cont_pro" ? 8 : 10;
        const quality: "standard" | "high" =
          request.quality === "high" ? "high" : "standard";
        let providerOut: { videoObjectPath: string; localTempPath: string };
        // Both Cont Pro (Magnific Veo 3.1 I2V) and Cont Ultra (Magnific
        // Seedance I2V) are image-to-video only — neither accepts
        // separate "reference image" inputs from a base64 inline path.
        // The starting-frame derivation is therefore:
        //   • Part 1  → Nano Banana Pro opening frame (already encodes
        //               character + location appearance via the visual
        //               bible refs at render time).
        //   • Part 2+ → BRIDGE FRAME: NB Pro re-render that takes the
        //               previous captured last frame as a continuity
        //               reference AND the character plates as identity
        //               references. This fixes the case where the raw
        //               last frame contains no characters (wide
        //               landscape, object cutaway, empty room) and
        //               Seedance / Veo would otherwise have no pixel
        //               memory of what the cast looks like. Bridge is
        //               best-effort — on NB Pro failure we fall back to
        //               the raw last frame and continue.
        // If Part 1's opening frame is missing (an upstream NB Pro blip)
        // we make ONE inline recovery attempt before failing — a single
        // hiccup must not kill the whole job.
        let startingFrame: { b64: string; mimeType: string } | undefined;
        if (part.partNumber === 1 && visualBible.openingFrame) {
          startingFrame = {
            b64: visualBible.openingFrame.b64,
            mimeType: visualBible.openingFrame.mimeType,
          };
        } else if (previousLastFrame) {
          await onProgress({
            partNumber: part.partNumber,
            totalParts: plan.length,
            stage: "preparing",
          });
          const bridge = await buildChunkBridgeFrame({
            partNumber: part.partNumber,
            totalParts: plan.length,
            jsonPrompt,
            visualBible,
            previousLastFrame: {
              b64: previousLastFrame.b64,
              mimeType: previousLastFrame.mimeType,
            },
            aspectRatio: request.aspectRatio,
            jobId: args.jobId,
          });
          startingFrame = { b64: bridge.b64, mimeType: bridge.mimeType };
        }
        let resolvedStartingFrame = startingFrame;
        if (!resolvedStartingFrame && part.partNumber === 1) {
          try {
            const inlineSpec = {
              type: "opening_film_still",
              logline: normalizedStory.logline,
              framing:
                "single establishing wide shot, neutral cinematic lighting",
              aspect_ratio: request.aspectRatio,
              negative: ["overlay text", "logo", "watermark"],
            };
            // Same visual lock as the primary opening render — refs
            // come from the saved visual bible so the recovered
            // opening still matches the cast/world the rest of the
            // video has already been planned around.
            const inlineRefs = collectOpeningReferences(
              visualBible.characters,
              visualBible.locations,
            );
            const recovered = await generateNanoBananaFrame({
              spec: inlineSpec,
              aspectRatio: request.aspectRatio,
              referenceImages: inlineRefs,
              qc: {
                label: "opening-inline-recovery",
                references: inlineRefs,
              },
            });
            resolvedStartingFrame = {
              b64: recovered.b64,
              mimeType: recovered.mimeType,
            };
            logger.info(
              { jobId: args.jobId, engineModel },
              "Part 1: opening frame recovered inline",
            );
          } catch (err) {
            logger.error(
              { err, jobId: args.jobId, engineModel },
              "Part 1: inline opening-frame recovery failed",
            );
          }
        }
        if (!resolvedStartingFrame) {
          throw new Error(
            "Reference frame for the opening shot is unavailable. " +
              "The image service may be rate-limited — please retry in a moment.",
          );
        }
        if (engineModel === "cont_pro") {
          providerOut = await generateContProClip({
            prompt: videoJsonPrompt,
            negativePrompt: negative,
            aspectRatio: request.aspectRatio,
            durationSeconds: chunkRequestSeconds,
            quality,
            startingFrame: resolvedStartingFrame,
            audio: audioSpec,
          });
        } else {
          providerOut = await generateContUltraClip({
            prompt: videoJsonPrompt,
            negativePrompt: negative,
            aspectRatio: request.aspectRatio,
            durationSeconds: chunkRequestSeconds,
            quality,
            startingFrame: resolvedStartingFrame,
            audio: audioSpec,
          });
        }

        // 3+4) Capture real last frame AND summarize the chunk in
        //      parallel — frame capture is local FFmpeg, summary is a
        //      remote Claude call, so there is no contention. This
        //      saves a few seconds per chunk × N chunks on long jobs.
        //
        //      We use `allSettled` (NOT `Promise.all`) so a fast
        //      rejection on one branch never triggers temp-file
        //      cleanup while the other branch is still reading the
        //      MP4 — `Promise.all` would unlink the file mid-capture
        //      and turn a summary failure into a spurious capture
        //      failure too. Both branches must settle before we
        //      decide success/failure.
        //
        //      Frame capture retries once on a transient ffmpeg /
        //      decoder hiccup before giving up; without that, a single
        //      bad chunk would cascade and fail every subsequent part
        //      because the next chunk has no frame to seed from.
        //
        //      The cleanup of the temp MP4 is wrapped in `finally` so
        //      we never leak the file even if capture or summarization
        //      throws.
        let lastFrame: Awaited<ReturnType<typeof captureLastFrame>>;
        let summary: string;
        const captureWithRetry = async () => {
          try {
            return await captureLastFrame(providerOut.localTempPath);
          } catch (capErr) {
            logger.warn(
              { err: capErr, jobId: args.jobId, partNumber: part.partNumber },
              "video-studio: last-frame capture failed, retrying once",
            );
            await new Promise((r) => setTimeout(r, 750));
            return captureLastFrame(providerOut.localTempPath);
          }
        };
        try {
          const [capRes, sumRes] = await Promise.allSettled([
            captureWithRetry(),
            summarizeChunkAfterGeneration({
              jsonPrompt,
              partNumber: part.partNumber,
            }),
          ]);
          if (capRes.status === "rejected") {
            // Capture is the harder dependency — without a last frame
            // every subsequent part would have no seed. Surface this
            // first so the chunk-attempt retry can re-render the part.
            throw capRes.reason instanceof Error
              ? capRes.reason
              : new Error(String(capRes.reason));
          }
          if (sumRes.status === "rejected") {
            throw sumRes.reason instanceof Error
              ? sumRes.reason
              : new Error(String(sumRes.reason));
          }
          lastFrame = capRes.value;
          summary = sumRes.value;
        } finally {
          // 5) Cleanup temp video file regardless of outcome.
          try {
            if (engineModel === "cont_pro") {
              await cleanupContProTemp(providerOut.localTempPath);
            } else {
              await cleanupContUltraTemp(providerOut.localTempPath);
            }
          } catch (cleanupErr) {
            logger.warn(
              { err: cleanupErr, jobId: args.jobId, partNumber: part.partNumber },
              "video-studio: temp cleanup failed (non-fatal)",
            );
          }
        }

        await onChunkUpdate({
          partNumber: part.partNumber,
          patch: {
            status: "complete",
            videoObjectPath: providerOut.videoObjectPath,
            lastFrameObjectPath: lastFrame.objectPath,
            summary,
            attempts,
            error: null,
          },
        });

        chunkResult = {
          partNumber: part.partNumber,
          videoObjectPath: providerOut.videoObjectPath,
          lastFrameObjectPath: lastFrame.objectPath,
          summary,
          durationSeconds: part.durationSeconds,
        };
        previousChunkSummary = summary;
        previousJsonPrompt = jsonPrompt;
        previousLastFrame = {
          objectPath: lastFrame.objectPath,
          b64: lastFrame.b64,
          mimeType: lastFrame.mimeType,
        };
      } catch (err) {
        lastErr = err;
        logger.warn(
          { err, jobId: args.jobId, partNumber: part.partNumber, attempts },
          "video-studio: chunk attempt failed",
        );
        await onChunkUpdate({
          partNumber: part.partNumber,
          patch: {
            status: attempts > MAX_CHUNK_RETRIES ? "failed" : "generating",
            attempts,
            error:
              err instanceof Error ? err.message : "Chunk generation failed",
          },
        });
      }
    }

    if (!chunkResult) {
      throw lastErr instanceof Error
        ? lastErr
        : new Error(`Part ${part.partNumber} failed after retries`);
    }
    chunks.push(chunkResult);
  }

  return chunks;
}

/* ============================== helpers ============================== */

/**
 * Pick up to 3 reference images for the opening film still — the
 * shot that seeds every downstream chunk via image-to-video. NB Pro's
 * `reference_images` array is hard-capped at 3 by Magnific, so we
 * prioritise:
 *
 *   1. The primary location plate (locks the world / lighting).
 *   2. The first story-order character plate (locks the lead's face).
 *   3. The second story-order character plate (locks the next face
 *      that appears, if there is one).
 *
 * We deliberately do NOT cross-reference characters against each
 * other when generating their own plates — NB Pro treats refs as
 * identity hints, so feeding character A as a ref while making
 * character B blends faces. The opening still is the one place where
 * mixing all of them is desirable: it IS the shot that anchors the
 * whole cast in one composition.
 *
 * Returns an empty array when nothing is locked yet (e.g. the
 * extremely degenerate case of zero characters AND zero locations),
 * which causes the adapter to fall back to text-only generation.
 */
function collectOpeningReferences(
  characters: Array<{ referenceImageB64?: string; referenceImageMime?: string }>,
  locations: Array<{ referenceImageB64?: string; referenceImageMime?: string }>,
): Array<{ b64: string; mimeType: string }> {
  const refs: Array<{ b64: string; mimeType: string }> = [];
  const loc = locations[0];
  if (loc?.referenceImageB64) {
    refs.push({
      b64: loc.referenceImageB64,
      mimeType: loc.referenceImageMime || "image/png",
    });
  }
  for (const c of characters) {
    if (refs.length >= 3) break;
    if (c.referenceImageB64) {
      refs.push({
        b64: c.referenceImageB64,
        mimeType: c.referenceImageMime || "image/png",
      });
    }
  }
  return refs;
}

/**
 * Build a "bridge frame" for chunks N >= 2. Seedance / Veo are
 * image-to-video and only see the SINGLE starting frame — so if the
 * captured last frame of part N-1 happens to land on a moment with
 * no character on screen (a wide landscape, an object cutaway, an
 * empty room), part N has zero pixel-level memory of what the cast
 * looks like and the face will visibly drift.
 *
 * Bridge frame = one fresh NB Pro render that combines:
 *   • The previous chunk's captured last frame as ref #1 → preserves
 *     world, lighting, color grade, composition language.
 *   • Up to 2 character plates from the visual bible as refs #2-#3 →
 *     re-asserts the locked faces / outfits NB Pro generated earlier.
 *
 * Magnific NB Pro caps `reference_images` at 3, so the prioritisation
 * is intentional: scene-continuity ref always wins slot 1, then the
 * first two story-order characters (the leads). The chunk's JSON
 * `startingFramePrompt` is what tells NB Pro WHAT scene to build, and
 * the refs tell it HOW it should look. The rendered bridge then
 * becomes the actual `image` we hand to Seedance / Veo.
 *
 * Best-effort: any failure logs and returns the original
 * previousLastFrame so a bridge hiccup never kills a long job. Set
 * `VIDEO_STUDIO_DISABLE_CHUNK_BRIDGE=1` to skip the bridge entirely
 * (emergency switch, not recommended).
 */
async function buildChunkBridgeFrame(args: {
  partNumber: number;
  totalParts: number;
  jsonPrompt: JsonVideoPrompt;
  visualBible: VisualBible;
  previousLastFrame: { b64: string; mimeType: string };
  aspectRatio: string;
  jobId: string;
}): Promise<{ b64: string; mimeType: string; bridged: boolean }> {
  const {
    partNumber,
    totalParts,
    jsonPrompt,
    visualBible,
    previousLastFrame,
    aspectRatio,
    jobId,
  } = args;

  if (process.env.VIDEO_STUDIO_DISABLE_CHUNK_BRIDGE === "1") {
    return { ...previousLastFrame, bridged: false };
  }

  // Beat-aware character selection: scan the chunk's
  // startingFramePrompt + currentBeat for character-name mentions. If
  // chunk N is intentionally a characterless cutaway (object close-up,
  // establishing wide, b-roll), forcing the cast back into frame
  // would break the cinematic intent — so we drop character refs in
  // that case and let the bridge be a pure continuity re-render.
  const beatHaystack =
    `${jsonPrompt.visualStoryboard.startingFramePrompt} ${jsonPrompt.storyContext.currentBeat}`.toLowerCase();
  const charactersInShot = visualBible.characters.filter((c) =>
    c.name && beatHaystack.includes(c.name.toLowerCase()),
  );

  // Refs: previous last frame first (slot 1 = scene continuity).
  // Slots 2-3 are filled ONLY by characters the upcoming shot
  // actually features. NB Pro hard cap is 3, enforced again by the
  // adapter.
  const refs: Array<{ b64: string; mimeType: string }> = [
    {
      b64: previousLastFrame.b64,
      mimeType: previousLastFrame.mimeType || "image/png",
    },
  ];
  for (const c of charactersInShot) {
    if (refs.length >= 3) break;
    if (c.referenceImageB64) {
      refs.push({
        b64: c.referenceImageB64,
        mimeType: c.referenceImageMime || "image/png",
      });
    }
  }

  // Pull the most informative bits of the chunk's JSON prompt into a
  // small spec — we don't want to ship the WHOLE 4500-char video
  // prompt to NB Pro, just enough to describe the starting frame.
  // `must_match_characters` is conditionally included so a
  // character-free shot doesn't force NB Pro to plant people in the
  // composition.
  const characterIdentityLocks = charactersInShot.map((c) => ({
    name: c.name,
    must_match_exactly: c.faceLock,
    outfit: c.outfitLock,
  }));
  const primaryLoc = visualBible.locations[0];
  const bridgeSpec: Record<string, unknown> = {
    type: "chunk_starting_frame",
    purpose:
      charactersInShot.length > 0
        ? "Re-anchor identity + scene continuity before the next image-to-video call. Match the lighting, composition, color grade, and world of REFERENCE IMAGE #1 (previous last frame), and make every character's face / outfit match the corresponding character reference plate."
        : "Re-anchor scene continuity before the next image-to-video call. This is an intentionally character-free shot — match the lighting, composition, color grade, and world of REFERENCE IMAGE #1 (previous last frame). DO NOT add people.",
    part: { partNumber, totalParts, timeRange: jsonPrompt.timeRange },
    starting_frame_prompt: jsonPrompt.visualStoryboard.startingFramePrompt,
    scene_context: {
      current_beat: jsonPrompt.storyContext.currentBeat,
      previous_beat: jsonPrompt.storyContext.previousBeat,
    },
    ...(characterIdentityLocks.length > 0
      ? { must_match_characters: characterIdentityLocks }
      : { no_characters_in_frame: true }),
    must_match_location: primaryLoc
      ? {
          name: primaryLoc.name,
          lighting: primaryLoc.lightingLock,
          environment: primaryLoc.environmentLock,
        }
      : null,
    style: {
      aspect_ratio: aspectRatio,
      look: "hyperreal cinematic film still — same grade as reference #1",
    },
    negative:
      charactersInShot.length > 0
        ? ["overlay text", "logo", "watermark", "different face", "different outfit"]
        : ["overlay text", "logo", "watermark", "people", "human figures"],
  };

  try {
    const bridge = await generateNanoBananaFrame({
      spec: bridgeSpec,
      aspectRatio,
      referenceImages: refs,
      envelopeOpts: { dropOrder: ["scene_context", "negative"] },
      qc: {
        // QC here can be lenient — the bridge is an internal stepping
        // stone, not a deliverable. We still want vision validation
        // to catch catastrophic mismatches, but a strict pass isn't
        // required to proceed.
        label: `chunk-bridge:${partNumber}`,
        threshold: 6,
        qcMaxRetries: 1,
        references: refs,
        expectedSpec:
          `Cinematic re-entry still for part ${partNumber}/${totalParts}. ` +
          `Scene: ${jsonPrompt.visualStoryboard.startingFramePrompt}. ` +
          `Match lighting and composition of the previous last frame. ` +
          `Characters MUST match their reference plates. Aspect ${aspectRatio}.`,
      },
    });
    logger.info(
      {
        jobId,
        partNumber,
        refsUsed: refs.length,
        charactersInShot: charactersInShot.map((c) => c.name),
        characterFreeShot: charactersInShot.length === 0,
        qcScore: bridge.qc?.score,
        qcPassed: bridge.qc?.passed,
      },
      "video-studio: chunk bridge frame rendered",
    );
    return { b64: bridge.b64, mimeType: bridge.mimeType, bridged: true };
  } catch (err) {
    logger.warn(
      { err, jobId, partNumber },
      "video-studio: chunk bridge frame failed, falling back to raw previous last frame",
    );
    return { ...previousLastFrame, bridged: false };
  }
}

function summarizeBible(b: VisualBible): string {
  return [
    `Style: ${b.styleLock.visualStyle} | grade ${b.styleLock.colorGrade}`,
    `Camera: ${b.styleLock.cameraLanguage}`,
    `Quality rules: ${b.styleLock.qualityRules.join("; ")}`,
    `Characters: ${b.characters.map((c) => c.name).join(", ") || "(none)"}`,
    `Locations: ${b.locations.map((l) => l.name).join(", ") || "(none)"}`,
  ].join("\n");
}

/**
 * Serialize the JsonVideoPrompt as the JSON-formatted string we send
 * to Veo / Seedance. Per pipeline-fix doc the prompt MUST be JSON,
 * ≤ 4500 chars (incl. spaces). The audio block is intentionally
 * stripped — the adapter posts it separately as `audio_config` to
 * avoid duplicate / conflicting fields.
 *
 * Drop priority (least-critical first) when JSON would overflow:
 *   1. endStateForNextPart  (next-chunk hint)
 *   2. cutSceneRules        (rare)
 *   3. continuity           (sceneContinuityRules)
 *   4. visualStoryboard     (key beats)
 */
function serializeVideoJsonPrompt(p: JsonVideoPrompt): string {
  const spec: Record<string, unknown> = {
    engineModel: p.engineModel,
    partNumber: p.partNumber,
    totalParts: p.totalParts,
    timeRange: p.timeRange,
    storyContext: p.storyContext,
    continuity: p.continuity,
    visualStoryboard: p.visualStoryboard,
    videoDirection: p.videoDirection,
    cutSceneRules: p.cutSceneRules,
    endStateForNextPart: p.endStateForNextPart,
  };
  return buildJsonPrompt(spec, {
    maxChars: MAX_PROMPT_CHARS,
    dropOrder: [
      "endStateForNextPart",
      "cutSceneRules",
      "continuity",
      "visualStoryboard",
    ],
    // No `truncatableField` — none of our top-level fields are strings,
    // so the envelope's tree-walking string truncator handles overflow
    // by shaving the longest deeply-nested string (mainAction, lighting,
    // etc.) without coercing objects to "[object Object]…".
    label: `videoJsonPrompt:${p.engineModel}`,
  });
}

export type { Storyboard };
