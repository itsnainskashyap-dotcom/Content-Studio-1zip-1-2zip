/**
 * AI Video Studio engine — top-level orchestrator. Mirrors the spec's
 * `runAIVideoStudioJob` flow exactly:
 *
 *   1. Load the Story Builder output (already on the request body).
 *   2. Normalize into the spec's internal story format.
 *   3. Create the chunk plan (8s parts, capped per model).
 *   4. Build the visual bible (Nano Banana 2 character + location refs).
 *   5. Build the initial storyboard state (Claude).
 *   6. Run the continuous loop: per-part JSON prompt → video gen →
 *      capture last frame → update storyboard → next part.
 *   7. Stitch into one MP4, trim to exact duration, save final + thumb.
 *
 * Every progress milestone is persisted via `updateJob` so the polling
 * endpoint can surface user-friendly stage labels (per spec) without
 * exposing third-party model names.
 *
 * The actual provider + storyboard / prompt engine implementations live
 * in `./providers/*` and `./storyboardEngine.ts` etc. and are wired in
 * later phases. This file owns the order and the progress reporting.
 */

import type { VideoStudioJobRequest } from "@workspace/api-zod";
import { createChunkPlan } from "./chunkPlanner";
import { normalizeStoryForVideo } from "./storyAdapter";
import {
  createJob,
  updateJob,
  ensureChunkRow,
  updateChunk,
  getJob,
} from "./jobStore";
import type { ChunkPart, EngineModel, VisualBible } from "./types";
import { logger } from "../lib/logger";

/**
 * Friendly per-stage labels — must match the user-facing copy in the
 * spec's "user-facing progress" block (no third-party names).
 */
export const ENGINE_STAGES = {
  writing_story: "Writing final story structure...",
  designing_chars: "Designing characters...",
  building_storyboard: "Creating visual storyboard...",
  preparing_part: (n: number) => `Preparing scene ${n}...`,
  generating_part: (n: number) => `Generating scene ${n}...`,
  continuity: "Maintaining continuity...",
  audio_sync: "Syncing voiceover and music...",
  merging: "Merging final video...",
  done: "Final video ready.",
} as const;

export interface StartJobResult {
  jobId: string;
}

/**
 * Public entry point used by the route. Creates the job row, kicks off
 * the engine in the background (resolved promise tracking is handled
 * via the DB), and returns the new job id immediately.
 */
export async function startVideoStudioJob(args: {
  ownerId: string;
  request: VideoStudioJobRequest;
}): Promise<StartJobResult> {
  // 1) Plan the work up-front so totalParts is known when we insert
  //    the row — the polling client renders the progress bar from this.
  const plan = createChunkPlan({
    model: args.request.model as EngineModel,
    durationSeconds: args.request.durationSeconds,
  });

  const job = await createJob({
    ownerId: args.ownerId,
    request: args.request,
    totalParts: plan.parts.length,
  });

  // Pre-create the per-part chunk rows so the polling client's UI can
  // render the empty timeline immediately instead of growing it row by
  // row mid-job.
  for (const part of plan.parts) {
    await ensureChunkRow({
      jobId: job.id,
      partNumber: part.partNumber,
      timeRangeStart: part.startSeconds,
      timeRangeEnd: part.endSeconds,
    });
  }

  // Fire-and-forget the engine. We deliberately don't await — the route
  // returns 202 + jobId, and the engine reports progress via DB.
  void runEngine({
    jobId: job.id,
    request: args.request,
    plan: plan.parts,
  }).catch((err) => {
    logger.error({ err, jobId: job.id }, "video-studio engine crashed");
  });

  return { jobId: job.id };
}

/**
 * Thrown internally when a cooperative cancellation check sees the
 * job has been marked `cancelled` from the route. Lets the catch
 * block distinguish "user cancel" from "real failure" so we don't
 * overwrite the terminal cancelled state with `failed`.
 */
class JobCancelledError extends Error {
  constructor() {
    super("Cancelled");
    this.name = "JobCancelledError";
  }
}

/**
 * Cooperative cancellation gate. Reads the current job row and throws
 * `JobCancelledError` if the user (or anything else) has marked the
 * job `cancelled`. Cheap enough to call between every stage and before
 * every per-part call.
 */
async function assertNotCancelled(jobId: string): Promise<void> {
  const current = await getJob(jobId);
  if (!current) throw new JobCancelledError();
  if (current.status === "cancelled") throw new JobCancelledError();
}

// Provider-name scrubber lives in ./sanitize so jobStore (chunk-level
// errors) and aiVideoStudioEngine (job-level errors) share one rule.
import { sanitizeUserFacingError } from "./sanitize";

/**
 * The actual orchestration. Runs as an in-process background promise
 * tracked entirely via DB writes. If the process restarts mid-job,
 * the job row will sit in `running` until a future "resume on boot"
 * routine picks it up — TODO once the engine is fully battle-tested.
 */
async function runEngine(args: {
  jobId: string;
  request: VideoStudioJobRequest;
  plan: ChunkPart[];
}): Promise<void> {
  const { jobId, request, plan } = args;

  try {
    await assertNotCancelled(jobId);
    await updateJob(jobId, {
      status: "running",
      stage: "writing_story",
      message: ENGINE_STAGES.writing_story,
      progressPercent: 2,
    });

    // Stage 1: normalize story.
    const normalizedStory = normalizeStoryForVideo({
      jobId,
      story: request.story,
      request,
    });
    await assertNotCancelled(jobId);
    await updateJob(jobId, {
      normalizedStory: normalizedStory as unknown,
      stage: "designing_chars",
      message: ENGINE_STAGES.designing_chars,
      progressPercent: 6,
    });

    // Stage 2: visual bible (Nano Banana 2 reference frames).
    // Implemented in providers/nanoBananaAdapter + storyboardEngine.
    const visualBible = await buildVisualBible({
      jobId,
      story: normalizedStory,
      request,
      onStageMessage: async ({ message, progressPercent }) => {
        // Best-effort progress writes between each NB2 reference call
        // so the UI stops looking frozen on "Designing characters...".
        await updateJob(jobId, { message, progressPercent }).catch(() => {
          // swallow — progress is non-critical, never fail the job
        });
      },
      onPartialBible: async (partial) => {
        // Stream the partial visual bible into the DB so the polling
        // frontend can render character cards / opening frame as soon
        // as each NB2 call lands. Best-effort; never fails the job.
        await updateJob(jobId, { visualBible: partial as unknown }).catch(
          () => {},
        );
      },
    });
    await assertNotCancelled(jobId);
    await updateJob(jobId, {
      visualBible: visualBible as unknown,
      stage: "building_storyboard",
      message: ENGINE_STAGES.building_storyboard,
      progressPercent: 14,
    });

    // Stage 3: continuous chunk loop. The loop also checks
    // assertNotCancelled before each per-part generation via the
    // onProgress callback below.
    const chunks = await runContinuousLoop({
      jobId,
      request,
      plan,
      normalizedStory,
      visualBible,
    });

    await assertNotCancelled(jobId);
    // Stage 4: stitching.
    await updateJob(jobId, {
      stage: "merging",
      message: ENGINE_STAGES.merging,
      progressPercent: 92,
    });
    const final = await stitchFinalVideo({
      jobId,
      chunks,
      request,
    });

    // Final guard: if the user cancelled while we were stitching,
    // do NOT overwrite the cancelled terminal state with `complete`.
    const beforeFinal = await getJob(jobId);
    if (!beforeFinal || beforeFinal.status === "cancelled") {
      logger.info({ jobId }, "video-studio job cancelled before final write");
      return;
    }

    await updateJob(jobId, {
      status: "complete",
      stage: "done",
      message: ENGINE_STAGES.done,
      progressPercent: 100,
      finalVideoObjectPath: final.videoObjectPath,
      thumbnailObjectPath: final.thumbnailObjectPath,
      voiceoverScript: final.voiceoverScript ?? null,
      completedAt: new Date(),
    });
  } catch (err) {
    if (err instanceof JobCancelledError) {
      logger.info({ jobId }, "video-studio engine: cooperative cancellation");
      // Cancel-state was already written by the route. Do not overwrite.
      return;
    }
    const rawMessage = err instanceof Error ? err.message : String(err);
    logger.error({ err, jobId }, "video-studio engine failure");
    // Don't clobber a job that the user cancelled while we were running.
    const current = await getJob(jobId);
    if (current && current.status === "cancelled") return;
    const friendly = sanitizeUserFacingError(rawMessage);
    await updateJob(jobId, {
      status: "failed",
      error: friendly,
      message: `Generation failed: ${friendly}`,
      completedAt: new Date(),
    });
  }
}

/** Phase 2 — Nano Banana 2 driven visual bible. */
async function buildVisualBible(args: {
  jobId: string;
  story: ReturnType<typeof normalizeStoryForVideo>;
  request: VideoStudioJobRequest;
  /**
   * Optional progress hook forwarded to the storyboard engine so the
   * UI sees per-character progress instead of a frozen "Designing
   * characters..." label for the whole stage.
   */
  onStageMessage?: (msg: { message: string; progressPercent: number }) => Promise<void>;
  /**
   * Optional partial-bible hook forwarded to the storyboard engine so
   * the engine can stream incremental visualBible state into the DB
   * after every successful NB2 reference call.
   */
  onPartialBible?: (partial: VisualBible) => Promise<void>;
}): Promise<VisualBible> {
  const mod = await import("./storyboardEngine");
  return mod.buildVisualBible(args);
}

/** Phase 3 — main per-part generation loop. */
async function runContinuousLoop(args: {
  jobId: string;
  request: VideoStudioJobRequest;
  plan: ChunkPart[];
  normalizedStory: ReturnType<typeof normalizeStoryForVideo>;
  visualBible: VisualBible;
}): Promise<
  Array<{
    partNumber: number;
    videoObjectPath: string;
    lastFrameObjectPath: string;
    summary: string;
    durationSeconds: number;
  }>
> {
  const mod = await import("./storyboardEngine");
  return mod.runContinuousLoop({
    ...args,
    onProgress: async ({ partNumber, totalParts, stage }) => {
      // Cooperative cancellation gate: bails out the loop before every
      // expensive provider call, so a `cancelled` row halts work fast.
      await assertNotCancelled(args.jobId);
      const base = 14;
      const span = 78; // 14 → 92 spans the per-part work
      const pct = Math.min(91, base + Math.floor(((partNumber - 1) / totalParts) * span));
      const message =
        stage === "preparing"
          ? ENGINE_STAGES.preparing_part(partNumber)
          : ENGINE_STAGES.generating_part(partNumber);
      await updateJob(args.jobId, {
        stage: stage === "preparing" ? "preparing_part" : "generating_part",
        message,
        progressPercent: pct,
        currentPart: partNumber,
      });
    },
    onChunkUpdate: async ({ partNumber, patch }) => {
      await updateChunk(args.jobId, partNumber, patch);
    },
  });
}

/** Phase 3 — concat-demuxer stitch + trim + thumbnail. */
async function stitchFinalVideo(args: {
  jobId: string;
  chunks: Array<{
    partNumber: number;
    videoObjectPath: string;
    lastFrameObjectPath: string;
    summary: string;
    durationSeconds: number;
  }>;
  request: VideoStudioJobRequest;
}): Promise<{
  videoObjectPath: string;
  thumbnailObjectPath: string;
  voiceoverScript?: string;
}> {
  const mod = await import("./stitcher");
  return mod.stitchFinalVideo(args);
}

/** Re-export so routes can hand back a fresh status without importing jobStore. */
export { getJob };
