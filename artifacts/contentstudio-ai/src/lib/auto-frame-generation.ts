import type {
  GenerateFrameImageRequest,
  GenerateFrameImageResult,
  QcFrameImageRequest,
  QcFrameImageResult,
} from "@workspace/api-client-react";
import { storage, type Project, type ProjectPart } from "./storage";

/**
 * Auto-frame generation with built-in QC.
 *
 * Once character reference sheets exist, every part with a writer-supplied
 * starting / ending frame prompt should auto-render its still using those
 * sheets as visual references — that's how we keep the cast on-model
 * without forcing the user to click "Generate" 12 times. After each render
 * we run a quick Vision-based QC pass; if the still doesn't match the
 * prompt we regenerate ONCE with the QC suggestion appended as a hint.
 *
 * Design choices:
 *   - Sequential, not parallel. Gemini image gen is rate-limited and the
 *     QC pass needs the just-rendered frame anyway. Parallel calls would
 *     also race on `storage.replaceProjectPart` writes.
 *   - Skip parts that already have an image. The user asked: "once
 *     generated, never auto-regenerate unless I explicitly click". That
 *     applies to frames too.
 *   - Soft-fail per part. One failed frame must not abort the rest of
 *     the batch; the user can manually retry from the prompts page.
 *   - QC failures are non-blocking. If the QC endpoint errors or returns
 *     a soft-pass, we ship the frame as-is. QC is a quality booster, not
 *     a gatekeeper.
 *   - All progress is reported via `onProgress` so the caller can show a
 *     toast / status pill — this module knows nothing about React state.
 */

export interface CharacterRef {
  objectPath: string;
  mimeType: string;
}

export interface AutoFrameProgress {
  /** 1-based index of the frame currently being processed. */
  current: number;
  /** Total frames the batch will attempt (computed up-front). */
  total: number;
  /** Part number for the frame in flight. */
  partNumber: number;
  /** "starting" or "ending". */
  kind: "starting" | "ending";
  /**
   * High-level lifecycle event for this frame:
   *   - "generating": calling /generate-frame-image
   *   - "qc": calling /qc-frame-image on the just-rendered still
   *   - "regenerating": QC failed, calling /generate-frame-image again
   *     with the suggestion appended
   *   - "done": frame saved (regardless of QC pass/fail)
   *   - "skipped": frame already had an image, no work done
   *   - "error": frame generation failed, batch continues
   */
  status:
    | "generating"
    | "qc"
    | "regenerating"
    | "done"
    | "skipped"
    | "error";
  /** Last QC score for this frame, if QC ran. */
  qcScore?: number;
  /** Error message when status === "error". */
  error?: string;
}

export interface AutoFrameOptions {
  /** Cast reference sheets to keep characters on-model. Pass empty array if none. */
  characterReferences: CharacterRef[];
  /** Project visual style ("Live Action Cinematic" etc). */
  style: string;
  /**
   * Aspect ratio to render every still at. Forwarded to both the
   * generate and QC calls so the still matches the project's video
   * ratio (e.g. 9:16 for Reels). Optional — when omitted the model
   * picks its default and QC doesn't grade the ratio.
   */
  aspectRatio?:
    | "16:9"
    | "9:16"
    | "1:1"
    | "4:3"
    | "3:4"
    | "21:9";
  /** Mutation caller for /generate-frame-image. */
  generateFrame: (args: {
    data: GenerateFrameImageRequest;
  }) => Promise<GenerateFrameImageResult>;
  /** Mutation caller for /qc-frame-image. */
  qcFrame: (args: { data: QcFrameImageRequest }) => Promise<QcFrameImageResult>;
  /**
   * Called before each frame and after each completion so the UI can
   * show progress. May be undefined for headless callers.
   */
  onProgress?: (event: AutoFrameProgress) => void;
  /**
   * AbortSignal — when fired, the batch stops between frames (we don't
   * cancel an in-flight Gemini call but we never start the next one).
   */
  signal?: AbortSignal;
}

interface FrameJob {
  partNumber: number;
  kind: "starting" | "ending";
  prompt: string;
}

/**
 * Walk the project's parts and queue up every frame that needs generating.
 * A part contributes a job iff:
 *   - the writer included a frame prompt for that side, AND
 *   - no image is currently persisted for that side
 *
 * The legacy inline-base64 (`b64Json`) shape still counts as "has image"
 * since the migration helper will eventually upload it; we don't want to
 * silently overwrite the user's existing render.
 */
function planJobs(project: Project): FrameJob[] {
  const jobs: FrameJob[] = [];
  for (const part of project.parts) {
    const startPrompt = part.startingFrame?.prompt?.trim();
    const startImg = part.startingFrameImage;
    if (
      startPrompt &&
      !(startImg && (startImg.objectPath || startImg.b64Json))
    ) {
      jobs.push({ partNumber: part.partNumber, kind: "starting", prompt: startPrompt });
    }
    const endPrompt = part.endingFrame?.prompt?.trim();
    const endImg = part.endingFrameImage;
    if (
      endPrompt &&
      !(endImg && (endImg.objectPath || endImg.b64Json))
    ) {
      jobs.push({ partNumber: part.partNumber, kind: "ending", prompt: endPrompt });
    }
  }
  return jobs;
}

function applyFrameToPart(
  projectId: string,
  partNumber: number,
  kind: "starting" | "ending",
  image: { objectPath: string; mimeType: string; generatedAt: string; sourcePrompt: string },
): ProjectPart | undefined {
  const fresh = storage.getProject(projectId);
  if (!fresh) return undefined;
  const part = fresh.parts.find((p) => p.partNumber === partNumber);
  if (!part) return undefined;
  // Re-check the "no existing image" guarantee at write time. If a manual
  // generation completed between planning and now, leave the user's image
  // alone — never silently overwrite work the user explicitly did.
  const existing =
    kind === "starting" ? part.startingFrameImage : part.endingFrameImage;
  if (existing && (existing.objectPath || existing.b64Json)) {
    return part;
  }
  const updated: ProjectPart =
    kind === "starting"
      ? { ...part, startingFrameImage: image }
      : { ...part, endingFrameImage: image };
  storage.replaceProjectPart(projectId, updated);
  return updated;
}

/**
 * Public entry point. Returns a summary so the caller can show a final
 * toast like "Auto-rendered 8 frames (2 with QC retry, 1 failed)".
 */
export interface AutoFrameSummary {
  totalPlanned: number;
  generated: number;
  regenerated: number;
  failed: number;
  skipped: number;
}

export async function autoGenerateFramesForProject(
  projectId: string,
  options: AutoFrameOptions,
): Promise<AutoFrameSummary> {
  const project = storage.getProject(projectId);
  if (!project) {
    return { totalPlanned: 0, generated: 0, regenerated: 0, failed: 0, skipped: 0 };
  }

  const jobs = planJobs(project);
  const summary: AutoFrameSummary = {
    totalPlanned: jobs.length,
    generated: 0,
    regenerated: 0,
    failed: 0,
    skipped: 0,
  };
  if (jobs.length === 0) return summary;

  const refs = options.characterReferences.slice(0, 4); // Gemini saturates beyond ~4 refs
  const QC_PASS_THRESHOLD = 7;

  for (let i = 0; i < jobs.length; i++) {
    if (options.signal?.aborted) break;
    const job = jobs[i];
    const baseProgress = {
      current: i + 1,
      total: jobs.length,
      partNumber: job.partNumber,
      kind: job.kind,
    };

    // Re-check the per-part guard right before generating. If the user
    // (or another tab) generated this frame manually while we were
    // working on the previous one, skip — never overwrite their work.
    const fresh = storage.getProject(projectId);
    const freshPart = fresh?.parts.find((p) => p.partNumber === job.partNumber);
    const existing =
      job.kind === "starting"
        ? freshPart?.startingFrameImage
        : freshPart?.endingFrameImage;
    if (existing && (existing.objectPath || existing.b64Json)) {
      summary.skipped += 1;
      options.onProgress?.({ ...baseProgress, status: "skipped" });
      continue;
    }

    options.onProgress?.({ ...baseProgress, status: "generating" });

    let result: GenerateFrameImageResult;
    try {
      result = await options.generateFrame({
        data: {
          framePrompt: job.prompt,
          style: options.style,
          characterReferences: refs.length > 0 ? refs : undefined,
          aspectRatio: options.aspectRatio,
        },
      });
    } catch (err) {
      summary.failed += 1;
      options.onProgress?.({
        ...baseProgress,
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      });
      continue;
    }

    // After-await abort check: the bytes are already in object storage
    // and the user paid for the call, so persist the result, but skip
    // every remaining (expensive) phase for this frame and stop the batch.
    if (options.signal?.aborted) {
      applyFrameToPart(projectId, job.partNumber, job.kind, {
        objectPath: result.objectPath,
        mimeType: result.mimeType,
        generatedAt: result.generatedAt,
        sourcePrompt: job.prompt,
      });
      summary.generated += 1;
      options.onProgress?.({ ...baseProgress, status: "done" });
      break;
    }

    // First-pass QC. If it errors we treat as a soft-pass and ship.
    let qc: QcFrameImageResult | null = null;
    options.onProgress?.({ ...baseProgress, status: "qc" });
    try {
      qc = await options.qcFrame({
        data: {
          objectPath: result.objectPath,
          framePrompt: job.prompt,
          style: options.style,
          characterReferences: refs.length > 0 ? refs : undefined,
          aspectRatio: options.aspectRatio,
        },
      });
    } catch {
      qc = null;
    }

    let finalResult = result;
    let didRegenerate = false;

    // ONE retry with QC's suggestion appended to the prompt. We cap at
    // a single retry on purpose: more attempts rarely improve adherence
    // and burn through Gemini quota fast. If the second attempt is also
    // poor, we still ship it — the user can manually regenerate.
    // Also skip the retry path entirely if abort fired during QC.
    if (
      !options.signal?.aborted &&
      qc &&
      !qc.passed &&
      qc.score < QC_PASS_THRESHOLD
    ) {
      const hint = (qc.suggestion || qc.issues.join("; ")).trim();
      if (hint.length > 0) {
        const hintedPrompt =
          `${job.prompt}\n\nNOTES FROM QC (previous attempt failed): ${hint}`.slice(
            0,
            3990,
          );
        options.onProgress?.({
          ...baseProgress,
          status: "regenerating",
          qcScore: qc.score,
        });
        try {
          finalResult = await options.generateFrame({
            data: {
              framePrompt: hintedPrompt,
              style: options.style,
              characterReferences: refs.length > 0 ? refs : undefined,
              aspectRatio: options.aspectRatio,
            },
          });
          didRegenerate = true;
          // Run QC once more on the retry so the persisted score reflects
          // what we actually shipped (best-effort; failures are silent).
          // Skip the second QC pass if abort fired during regenerate.
          if (!options.signal?.aborted) {
            try {
              qc = await options.qcFrame({
                data: {
                  objectPath: finalResult.objectPath,
                  framePrompt: job.prompt,
                  style: options.style,
                  characterReferences: refs.length > 0 ? refs : undefined,
                  aspectRatio: options.aspectRatio,
                },
              });
            } catch {
              /* keep prior qc */
            }
          }
        } catch {
          // Retry failed — ship the first attempt rather than nothing.
          // finalResult already points to the first-pass result.
        }
      }
    }

    applyFrameToPart(projectId, job.partNumber, job.kind, {
      objectPath: finalResult.objectPath,
      mimeType: finalResult.mimeType,
      generatedAt: finalResult.generatedAt,
      sourcePrompt: job.prompt,
    });

    summary.generated += 1;
    if (didRegenerate) summary.regenerated += 1;
    options.onProgress?.({
      ...baseProgress,
      status: "done",
      qcScore: qc?.score,
    });

    // Stop cleanly if abort fired after we finished writing this frame.
    if (options.signal?.aborted) break;
  }

  return summary;
}
