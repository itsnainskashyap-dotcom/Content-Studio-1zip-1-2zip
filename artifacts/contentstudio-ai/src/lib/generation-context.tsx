import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  generateVideoPrompts,
  generateFrameImage,
} from "@workspace/api-client-react";
import type { GenerateFrameImageRequest } from "@workspace/api-client-react";
import { buildPreviousPartDigests } from "./part-digest";
import { storage, type ProjectPart } from "@/lib/storage";
import { extractEnvelopeError } from "./api-call";
import {
  GenerationContext,
  type GenerationConfig,
  type GenerationJob,
  type GenerationSnapshot,
  type PartFrameStatus,
} from "./use-generation";

/**
 * Build the cast-reference array sent to /generate-frame-image. Post Object
 * Storage migration the references are tiny `{ objectPath, mimeType }` tuples
 * — the server pulls the bytes from object storage just-in-time — so the old
 * byte-budget cap is no longer needed. We keep a hard upper bound of 4 since
 * Gemini's likeness conditioning saturates past a few refs.
 *
 * Items missing an `objectPath` (legacy projects whose images haven't been
 * migrated yet) are skipped; they'll get re-uploaded by the migration helper
 * on next signin.
 */
const FRAME_REFS_MAX_COUNT = 4;
function buildCharacterReferencesForFrames(
  items:
    | Record<string, { objectPath?: string; b64Json?: string; mimeType: string }>
    | undefined,
): Array<{ objectPath: string; mimeType: string }> | undefined {
  if (!items) return undefined;
  const refs: Array<{ objectPath: string; mimeType: string }> = [];
  for (const v of Object.values(items)) {
    if (refs.length >= FRAME_REFS_MAX_COUNT) break;
    if (!v.objectPath) continue;
    refs.push({ objectPath: v.objectPath, mimeType: v.mimeType });
  }
  return refs.length > 0 ? refs : undefined;
}

/**
 * Per-frame timeout. Gemini image generation typically returns in 8-20s but
 * can spike on cold paths. We give it 90s so the frame doesn't hard-fail on
 * a slightly slow render — much shorter than the part-prompt timeout because
 * the payload is bounded and there's no retry storm on the server side.
 */
const FRAME_TIMEOUT_MS = 90_000;

/**
 * In-flight tracker keyed by `${projectId}:${partNumber}:${kind}` so we never
 * fire two concurrent renders for the same frame slot (e.g. if `runOnePart`
 * is somehow re-entered on the same part).
 */
const inflightFrames = new Set<string>();

/**
 * Auto-render starting + ending frame still images for a freshly generated
 * part. Reads from storage (not the React closure) so it works regardless of
 * whether the user has navigated away. Each render is independent — a single
 * failure doesn't lose the other frame.
 */
async function autoRenderFramesForPart(args: {
  projectId: string;
  part: ProjectPart;
  style: string;
  frameSettings: { startingFrameEnabled: boolean; endingFrameEnabled: boolean };
  aspectRatio?: GenerateFrameImageRequest["aspectRatio"];
  /** Surface live frame status to the GenerationJob so the UI can show
   * "rendering frame…" badges and the global pill can advance. */
  onFrameStatus?: (
    partNumber: number,
    kind: "starting" | "ending",
    status: "rendering" | "done" | "error",
  ) => void;
}): Promise<void> {
  const { projectId, part, style, frameSettings, aspectRatio, onFrameStatus } =
    args;

  const renderOne = async (kind: "starting" | "ending") => {
    const enabled =
      kind === "starting"
        ? frameSettings.startingFrameEnabled
        : frameSettings.endingFrameEnabled;
    // Disabled frames are seeded as "done" upstream — nothing to do.
    if (!enabled) return;

    const framePrompt =
      kind === "starting"
        ? part.startingFrame?.prompt
        : part.endingFrame?.prompt;
    // Enabled but missing prompt → resolve the seeded "pending" so the
    // badge doesn't get stuck. Treat as done (no work to do).
    if (!framePrompt || framePrompt.trim().length === 0) {
      onFrameStatus?.(part.partNumber, kind, "done");
      return;
    }

    // Re-read storage to skip if this frame already exists (e.g. user
    // re-ran after a partial failure of just one slot).
    const fresh = storage.getProject(projectId);
    if (!fresh) {
      onFrameStatus?.(part.partNumber, kind, "done");
      return;
    }
    const freshPart = fresh.parts.find(
      (p) => p.partNumber === part.partNumber,
    );
    const existing =
      kind === "starting"
        ? freshPart?.startingFrameImage
        : freshPart?.endingFrameImage;
    if (existing) {
      // Already rendered — mark done so the seeded "pending" clears.
      onFrameStatus?.(part.partNumber, kind, "done");
      return;
    }

    const flightKey = `${projectId}:${part.partNumber}:${kind}`;
    if (inflightFrames.has(flightKey)) return;
    inflightFrames.add(flightKey);

    onFrameStatus?.(part.partNumber, kind, "rendering");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FRAME_TIMEOUT_MS);

    try {
      const characterReferences = buildCharacterReferencesForFrames(
        fresh.characterImages?.items,
      );
      const result = await generateFrameImage(
        {
          framePrompt,
          style,
          characterReferences,
          aspectRatio,
        },
        { signal: controller.signal },
      );
      clearTimeout(timer);

      // Streaming heartbeat envelope: a mid-flight server failure can come
      // back as a 200 with an `error` field instead of a 5xx, so we have
      // to inspect the body before persisting.
      const envelopeError = extractEnvelopeError(result);
      if (envelopeError) throw new Error(envelopeError);

      const newImage = {
        objectPath: result.objectPath,
        mimeType: result.mimeType,
        generatedAt: new Date().toISOString(),
        sourcePrompt: framePrompt,
      };

      // Read-modify-write so concurrent renders for the same part
      // (starting + ending in flight at the same time) don't clobber.
      const latest = storage.getProject(projectId);
      if (!latest) return;
      const updatedParts = latest.parts.map((p) =>
        p.partNumber === part.partNumber
          ? {
              ...p,
              ...(kind === "starting"
                ? { startingFrameImage: newImage }
                : { endingFrameImage: newImage }),
            }
          : p,
      );
      storage.saveProject({ ...latest, parts: updatedParts });
      window.dispatchEvent(new Event("cs:projects-changed"));
      onFrameStatus?.(part.partNumber, kind, "done");
    } catch (err) {
      clearTimeout(timer);
      // Soft-fail. The InlinePrompts FrameImageCard still has a manual
      // "Generate frame image" button so the user can retry per-frame.
      // We log to console rather than toasting because frame renders run
      // in the background and a toast storm during a 12-part run would
      // overwhelm the UI. The card itself shows a retry affordance.
      // eslint-disable-next-line no-console
      console.warn(
        `[auto-frame] part ${part.partNumber} ${kind} render failed:`,
        err,
      );
      onFrameStatus?.(part.partNumber, kind, "error");
    } finally {
      inflightFrames.delete(flightKey);
    }
  };

  // Run both in parallel — they're independent.
  await Promise.all([renderOne("starting"), renderOne("ending")]);
}

// Per-part client timeout. The server can take 60-150s for a richly detailed
// part (especially when voiceover + BGM are included and the model produces
// 14k+ chars of copyablePrompt). The backend's worst-case path is 3
// retries × ~70-80s + an LLM compression-recovery pass (~25s) +
// emergency-rescue (~negligible) ≈ 285-300s. We saw real 287s
// generations against rich 40-part stories, so this MUST be at least as
// large as `api-call.ts`' TIMEOUT_MS (360s) — otherwise the generation
// context aborts the abort-controller seconds before the network call
// would have completed. 360s gives a comfortable margin so the
// AbortController doesn't fire on a slightly slower-than-average response,
// while still protecting against an actually-stuck request.
const TIMEOUT_MS = 360_000;

function normalizeError(err: unknown): string {
  if (err && typeof err === "object" && "message" in err) {
    const raw = String((err as { message: unknown }).message);
    const lower = raw.toLowerCase();
    if (lower.includes("rate") && lower.includes("limit")) {
      return "Hit the AI rate limit. Please wait 30 seconds and try again.";
    }
    if (lower.includes("429")) {
      return "Too many requests right now. Please wait 30 seconds and try again.";
    }
    if (raw) return raw;
  }
  return "Something went wrong. Please try again.";
}

export function GenerationProvider({ children }: { children: ReactNode }) {
  const [jobs, setJobs] = useState<Record<string, GenerationJob>>({});
  // Refs for the actual mutable state used by the running async loop —
  // setJobs only mirrors for the React render path.
  const jobsRef = useRef<Record<string, GenerationJob>>({});
  const controllersRef = useRef<Record<string, AbortController>>({});

  const updateJob = useCallback((projectId: string, patch: Partial<GenerationJob>) => {
    const cur = jobsRef.current[projectId];
    if (!cur) return;
    const next = { ...cur, ...patch };
    jobsRef.current[projectId] = next;
    setJobs((s) => ({ ...s, [projectId]: next }));
  }, []);

  /**
   * Patch a single per-part frame status without losing the rest of the
   * frameStatuses map. Used by autoRenderFramesForPart's callback so the
   * UI shows live "rendering frame…" badges and the global pill can
   * advance through the starting/ending render steps.
   */
  const setFrameStatus = useCallback(
    (
      projectId: string,
      partNumber: number,
      kind: "starting" | "ending",
      status: "rendering" | "done" | "error",
    ) => {
      const cur = jobsRef.current[projectId];
      if (!cur) return;
      const key = String(partNumber);
      const existing: PartFrameStatus =
        cur.frameStatuses[key] ?? { starting: "pending", ending: "pending" };
      const updated: PartFrameStatus = { ...existing, [kind]: status };
      const stageLabel =
        status === "rendering"
          ? `Rendering ${kind === "starting" ? "starting" : "ending"} frame · part ${partNumber}`
          : cur.stage;
      updateJob(projectId, {
        frameStatuses: { ...cur.frameStatuses, [key]: updated },
        stage: stageLabel,
      });
    },
    [updateJob],
  );

  // Generates ONE part (the next one) using the job already stored for this
  // project. Caller is responsible for ensuring a job exists.
  const runOnePart = useCallback(
    async (projectId: string) => {
      const job = jobsRef.current[projectId];
      if (!job) return;
      if (job.status === "running") return; // already running
      if (job.current >= job.total) return; // nothing left
      const partNumber = job.current + 1;
      const config = job.config;

      // Cancel any previous controller for safety
      const prev = controllersRef.current[projectId];
      if (prev) prev.abort();

      const controller = new AbortController();
      controllersRef.current[projectId] = controller;
      updateJob(projectId, {
        status: "running",
        error: null,
        stage: `Writing part ${partNumber} of ${job.total}`,
      });

      const partTimer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      try {
        const result = await generateVideoPrompts(
          {
            story: config.story,
            style: config.style,
            duration: config.partDuration,
            part: partNumber,
            totalParts: config.partsCount,
            previousLastFrame: job.previousLastFrame,
            previousParts: buildPreviousPartDigests(job.parts),
            voiceoverLanguage:
              config.voiceoverLanguage === "none" ? null : config.voiceoverLanguage,
            voiceoverTone:
              config.voiceoverLanguage === "none" ? null : config.voiceoverTone,
            bgmStyle: config.bgm?.name ?? null,
            bgmTempo: config.bgm?.tempo ?? null,
            bgmInstruments: config.bgm?.instruments ?? [],
            aspectRatio: config.aspectRatio,
            videoModel: config.videoModel,
            framesAsImageReferences: config.framesAsImageReferences,
            // FRAMES + DUAL-MODE pass-through. Strip the local-only `id` so
            // we send the same wire shape as the openapi spec expects.
            mode: config.mode,
            frameSettings: config.frameSettings,
            // Writer endpoint still expects inline base64 refs (the spec
            // hasn't been extended to load by objectPath yet). Drop any
            // post-migration refs that lost their inline bytes; new
            // uploads in the same session still carry b64Json.
            referenceImages: config.referenceImages
              .filter(
                (r): r is typeof r & { b64Json: string } =>
                  typeof r.b64Json === "string" && r.b64Json.length > 0,
              )
              .map(({ id: _id, objectPath: _op, ...rest }) => rest),
          },
          { signal: controller.signal },
        );
        clearTimeout(partTimer);

        // Streaming heartbeat envelope (see api-call.ts comment): a
        // mid-flight server failure surfaces as a 200 response with an
        // `error` field instead of a 5xx, so we have to inspect the
        // body before treating it as a real result.
        const envelopeError = extractEnvelopeError(result);
        if (envelopeError) throw new Error(envelopeError);

        const part: ProjectPart = {
          ...result,
          partNumber,
          voiceoverLanguage:
            config.voiceoverLanguage === "none" ? null : config.voiceoverLanguage,
          bgmStyle: config.bgm?.name ?? null,
          bgmTempo: config.bgm?.tempo ?? null,
        };
        const collected = [...job.parts, part];

        // Persist incrementally
        const proj = storage.getProject(projectId);
        if (proj) {
          const saved = storage.saveProject({
            ...proj,
            style: config.style,
            duration: config.partDuration,
            partsCount: config.partsCount,
            voiceoverLanguage: config.voiceoverLanguage,
            parts: [...collected],
          });
          storage.setCurrentProjectId(saved.id);
          window.dispatchEvent(new Event("cs:projects-changed"));
        }

        const isDone = partNumber >= config.partsCount;
        // Seed frame statuses for this part so the UI can show "pending"
        // before autoRenderFramesForPart fires. Only seed enabled frames so
        // disabled-frame parts show as "done" immediately. Read frame
        // statuses from the LIVE jobsRef (not the stale `job` closure) —
        // a previous part's frame render may have completed while this
        // part was being written, and we must not overwrite that update.
        const seededFrameStatus: PartFrameStatus = {
          starting: config.frameSettings.startingFrameEnabled
            ? "pending"
            : "done",
          ending: config.frameSettings.endingFrameEnabled ? "pending" : "done",
        };
        const liveFrameStatuses =
          jobsRef.current[projectId]?.frameStatuses ?? job.frameStatuses;
        const nextFrameStatuses = {
          ...liveFrameStatuses,
          [String(partNumber)]: seededFrameStatus,
        };
        updateJob(projectId, {
          parts: collected,
          current: partNumber,
          previousLastFrame: result.lastFrameDescription,
          status: isDone ? "done" : "awaiting_next",
          frameStatuses: nextFrameStatuses,
          stage: isDone
            ? "Done — finalising frames…"
            : `Part ${partNumber} done · ready for next`,
        });

        // FRAME AUTO-RENDER: kick off Gemini renders for this part's
        // starting / ending frame stills as soon as the part lands.
        // Fire-and-forget — frame images are independent of subsequent
        // video prompts and shouldn't gate part N+1.
        void autoRenderFramesForPart({
          projectId,
          part,
          style: config.style,
          frameSettings: config.frameSettings,
          aspectRatio: config.aspectRatio,
          onFrameStatus: (pn, kind, status) =>
            setFrameStatus(projectId, pn, kind, status),
        });
      } catch (err) {
        clearTimeout(partTimer);
        if (controller.signal.aborted) {
          updateJob(projectId, {
            status: "cancelled",
            stage: "Cancelled",
          });
        } else {
          updateJob(projectId, {
            status: "error",
            error: normalizeError(err),
            stage: `Error on part ${partNumber}`,
          });
        }
      } finally {
        if (controllersRef.current[projectId] === controller) {
          delete controllersRef.current[projectId];
        }
      }
    },
    [updateJob],
  );

  const startGeneration = useCallback(
    (config: GenerationConfig) => {
      // Cancel any previous run for this project
      const prev = controllersRef.current[config.projectId];
      if (prev) prev.abort();

      const job: GenerationJob = {
        projectId: config.projectId,
        status: "awaiting_next",
        total: config.partsCount,
        current: 0,
        parts: [],
        error: null,
        config,
        startedAt: Date.now(),
        previousLastFrame: undefined,
        frameStatuses: {},
        stage: "Starting…",
      };
      jobsRef.current[config.projectId] = job;
      setJobs((s) => ({ ...s, [config.projectId]: job }));

      // Kick off the FIRST part automatically
      void runOnePart(config.projectId);
    },
    [runOnePart],
  );

  const generateNextPart = useCallback(
    (projectId: string) => {
      const job = jobsRef.current[projectId];
      if (!job) return;
      if (job.status === "running") return;
      if (job.current >= job.total) return;
      void runOnePart(projectId);
    },
    [runOnePart],
  );

  const cancel = useCallback((projectId: string) => {
    const c = controllersRef.current[projectId];
    if (c) c.abort();
    delete controllersRef.current[projectId];
    const cur = jobsRef.current[projectId];
    // Cancel any in-flight or queued state, not just "running" — the
    // global pill exposes a Cancel button on awaiting_next jobs too.
    if (cur && (cur.status === "running" || cur.status === "awaiting_next")) {
      updateJob(projectId, { status: "cancelled", stage: "Cancelled" });
    }
  }, [updateJob]);

  const replaceJobPart = useCallback(
    (projectId: string, replacement: ProjectPart) => {
      const cur = jobsRef.current[projectId];
      if (!cur) return;
      const idx = cur.parts.findIndex(
        (p) => p.partNumber === replacement.partNumber,
      );
      if (idx < 0) return;
      const nextParts = [...cur.parts];
      nextParts[idx] = replacement;
      // If the replaced part is the LAST one we've completed so far, also
      // refresh previousLastFrame so any subsequent "generate next" picks
      // up the new continuation frame.
      const isLastCompleted = idx === cur.parts.length - 1;
      updateJob(projectId, {
        parts: nextParts,
        previousLastFrame: isLastCompleted
          ? replacement.lastFrameDescription
          : cur.previousLastFrame,
      });
    },
    [updateJob],
  );

  const clear = useCallback((projectId: string) => {
    const c = controllersRef.current[projectId];
    if (c) c.abort();
    delete controllersRef.current[projectId];
    delete jobsRef.current[projectId];
    setJobs((s) => {
      const next = { ...s };
      delete next[projectId];
      return next;
    });
  }, []);

  const getJob = useCallback(
    (projectId: string): GenerationJob | null => jobs[projectId] ?? null,
    [jobs],
  );

  /**
   * Snapshot of every job that's still in flight or recently finished. The
   * global progress pill consumes this so the user can see "Generating part
   * 2/5 · cancel" no matter which page they're on, including for jobs they
   * navigated away from.
   */
  const activeSnapshots: GenerationSnapshot[] = Object.values(jobs)
    .filter(
      (j) =>
        j.status === "running" ||
        j.status === "awaiting_next" ||
        // Keep "done" jobs visible for a few seconds so frame renders
        // wrapping up after the last part still surface in the pill.
        (j.status === "done" &&
          Object.values(j.frameStatuses).some(
            (f) => f.starting === "rendering" || f.ending === "rendering",
          )),
    )
    .map((j) => {
      const frames = Object.values(j.frameStatuses);
      const framesPending = frames.reduce(
        (n, f) =>
          n +
          (f.starting === "pending" || f.starting === "rendering" ? 1 : 0) +
          (f.ending === "pending" || f.ending === "rendering" ? 1 : 0),
        0,
      );
      const framesDone = frames.reduce(
        (n, f) =>
          n + (f.starting === "done" ? 1 : 0) + (f.ending === "done" ? 1 : 0),
        0,
      );
      const project = storage.getProject(j.projectId);
      return {
        projectId: j.projectId,
        projectTitle: project?.title ?? "Untitled project",
        status: j.status,
        total: j.total,
        current: j.current,
        stage: j.stage,
        framesPending,
        framesDone,
        startedAt: j.startedAt,
      };
    })
    .sort((a, b) => b.startedAt - a.startedAt);

  // Cleanup on unmount (only fires when entire app unmounts, not on route change)
  useEffect(() => {
    return () => {
      for (const c of Object.values(controllersRef.current)) c.abort();
    };
  }, []);

  return (
    <GenerationContext.Provider
      value={{
        getJob,
        startGeneration,
        generateNextPart,
        cancel,
        clear,
        replaceJobPart,
        activeSnapshots,
      }}
    >
      {children}
    </GenerationContext.Provider>
  );
}

