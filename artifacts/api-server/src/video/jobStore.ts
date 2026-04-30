/**
 * Job store — DB-backed CRUD for video studio jobs and their per-part
 * chunks. Wraps Drizzle so the engine + routes never touch the schema
 * directly.
 *
 * Status snapshots returned by `toStatusSnapshot` are the exact shape
 * the polling endpoint sends back to the client.
 */

import { db } from "@workspace/db";
import {
  videoJobs,
  videoChunks,
  type VideoJob,
  type VideoChunk,
} from "@workspace/db/schema";
import { eq, asc, desc, and, lt, notInArray } from "drizzle-orm";
import type { VideoStudioJobStatus } from "@workspace/api-zod";
import type { EngineModel } from "./types";
import type { VideoStudioJobRequest } from "@workspace/api-zod";
import { sanitizeUserFacingError } from "./sanitize";
import { ObjectStorageService } from "../lib/objectStorage";
import { logger } from "../lib/logger";

export interface CreateJobInput {
  ownerId: string;
  request: VideoStudioJobRequest;
  totalParts: number;
}

export async function createJob(input: CreateJobInput): Promise<VideoJob> {
  const [row] = await db
    .insert(videoJobs)
    .values({
      ownerId: input.ownerId,
      model: input.request.model,
      durationSeconds: input.request.durationSeconds,
      aspectRatio: input.request.aspectRatio,
      voiceoverLanguage: input.request.voiceoverLanguage ?? null,
      voiceoverEnabled: input.request.voiceoverEnabled ?? true,
      bgmEnabled: input.request.bgmEnabled ?? true,
      subtitlesEnabled: input.request.subtitlesEnabled ?? false,
      quality: input.request.quality ?? "standard",
      storyProjectId: input.request.storyProjectId ?? null,
      inputStory: input.request.story,
      status: "queued",
      stage: "queued",
      message: "Waiting to start...",
      progressPercent: 0,
      currentPart: 0,
      totalParts: input.totalParts,
    })
    .returning();
  return row;
}

export async function getJob(id: string): Promise<VideoJob | null> {
  const rows = await db
    .select()
    .from(videoJobs)
    .where(eq(videoJobs.id, id))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Return the user's most recent non-terminal job (`queued` or `running`),
 * or null if none exists. Used by the video-studio page on mount so the
 * UI can reconnect to a server-side job that's still in progress after
 * a navigation, refresh, or tab reopen.
 */
export async function getActiveJobForOwner(
  ownerId: string,
): Promise<VideoJob | null> {
  const rows = await db
    .select()
    .from(videoJobs)
    .where(
      and(
        eq(videoJobs.ownerId, ownerId),
        notInArray(videoJobs.status, ["complete", "failed", "cancelled"]),
      ),
    )
    .orderBy(desc(videoJobs.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

export interface UpdateJobProgress {
  stage?: string;
  message?: string;
  progressPercent?: number;
  currentPart?: number;
  totalParts?: number;
  status?: "queued" | "running" | "complete" | "failed" | "cancelled";
  error?: string | null;
  finalVideoObjectPath?: string | null;
  thumbnailObjectPath?: string | null;
  voiceoverScript?: string | null;
  normalizedStory?: unknown;
  visualBible?: unknown;
  completedAt?: Date | null;
}

/**
 * Status-aware update with compare-and-set semantics so we can never
 * silently overwrite a terminal state.
 *
 * Rules:
 *   - Writing `status: "cancelled"` (the user-cancel path) wins over
 *     anything except an already-terminal `complete`/`failed` row.
 *   - Any other write — progress, status:"running", status:"complete",
 *     status:"failed", or no status at all — is blocked once the row
 *     is in {cancelled, complete, failed}. This protects the engine's
 *     in-flight progress writes from clobbering a freshly cancelled
 *     job, and protects a stitched/complete job from being overwritten.
 *
 * The actual gating is a SQL `WHERE status NOT IN (...)` clause so the
 * decision is atomic with the write.
 */
export async function updateJob(
  id: string,
  patch: UpdateJobProgress,
): Promise<void> {
  const blocked: Array<"queued" | "running" | "complete" | "failed" | "cancelled"> =
    patch.status === "cancelled"
      ? ["complete", "failed"]
      : ["cancelled", "complete", "failed"];
  await db
    .update(videoJobs)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(videoJobs.id, id), notInArray(videoJobs.status, blocked)));
}

export async function listJobChunks(jobId: string): Promise<VideoChunk[]> {
  return db
    .select()
    .from(videoChunks)
    .where(eq(videoChunks.jobId, jobId))
    .orderBy(asc(videoChunks.partNumber));
}

export async function ensureChunkRow(args: {
  jobId: string;
  partNumber: number;
  timeRangeStart: number;
  timeRangeEnd: number;
}): Promise<VideoChunk> {
  const existing = await db
    .select()
    .from(videoChunks)
    .where(eq(videoChunks.jobId, args.jobId))
    .orderBy(desc(videoChunks.partNumber));
  const match = existing.find((c) => c.partNumber === args.partNumber);
  if (match) return match;
  const [row] = await db
    .insert(videoChunks)
    .values({
      jobId: args.jobId,
      partNumber: args.partNumber,
      timeRangeStart: args.timeRangeStart,
      timeRangeEnd: args.timeRangeEnd,
      status: "pending",
    })
    .returning();
  return row;
}

export interface UpdateChunkPatch {
  status?: "pending" | "generating" | "complete" | "failed";
  jsonPrompt?: unknown;
  videoObjectPath?: string | null;
  lastFrameObjectPath?: string | null;
  summary?: string | null;
  attempts?: number;
  error?: string | null;
}

export async function updateChunk(
  jobId: string,
  partNumber: number,
  patch: UpdateChunkPatch,
): Promise<void> {
  // chunkId lookup by composite (jobId, partNumber).
  const rows = await db
    .select()
    .from(videoChunks)
    .where(eq(videoChunks.jobId, jobId));
  const target = rows.find((r) => r.partNumber === partNumber);
  if (!target) {
    throw new Error(
      `Chunk not found: job=${jobId} part=${partNumber} (call ensureChunkRow first)`,
    );
  }
  // Sanitize provider/service names from any user-facing chunk error
  // before persisting — the frontend timeline renders this verbatim.
  const safePatch: UpdateChunkPatch =
    patch.error != null
      ? { ...patch, error: sanitizeUserFacingError(patch.error) }
      : patch;
  await db
    .update(videoChunks)
    .set({ ...safePatch, updatedAt: new Date() })
    .where(eq(videoChunks.id, target.id));
}

/**
 * Slim, UI-safe view of the visual bible for the polling frontend.
 * Strips heavy `referenceImageB64` blobs (we want fast snapshot reads
 * and the browser builds image URLs from objectPath via the same
 * `objectPathToUrl` helper used elsewhere). Kept as a structural
 * extension on the snapshot — the openapi schema doesn't yet
 * declare it, so the frontend reads it via a typed cast.
 */
export interface VisualBibleSnapshot {
  characters: Array<{
    id: string;
    name: string;
    referenceImageObjectPath: string;
  }>;
  locations: Array<{
    id: string;
    name: string;
    referenceImageObjectPath: string;
  }>;
  openingFrame?: { objectPath: string };
}

interface BibleShape {
  characters?: Array<{
    id?: string;
    name?: string;
    referenceImageObjectPath?: string;
  }>;
  locations?: Array<{
    id?: string;
    name?: string;
    referenceImageObjectPath?: string;
  }>;
  openingFrame?: { objectPath?: string };
}

function projectVisualBible(raw: unknown): VisualBibleSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const b = raw as BibleShape;
  return {
    characters: Array.isArray(b.characters)
      ? b.characters.map((c) => ({
          id: String(c?.id ?? ""),
          name: String(c?.name ?? ""),
          referenceImageObjectPath: String(c?.referenceImageObjectPath ?? ""),
        }))
      : [],
    locations: Array.isArray(b.locations)
      ? b.locations.map((l) => ({
          id: String(l?.id ?? ""),
          name: String(l?.name ?? ""),
          referenceImageObjectPath: String(l?.referenceImageObjectPath ?? ""),
        }))
      : [],
    openingFrame:
      b.openingFrame && b.openingFrame.objectPath
        ? { objectPath: String(b.openingFrame.objectPath) }
        : undefined,
  };
}

/**
 * List the most recent jobs owned by a user, newest first. Used by the
 * Library page (history.tsx → AI Video Library section) to show all
 * generated videos within their 30-day TTL window.
 *
 * `limit` defaults to 100 — the Library is a small grid, not infinite
 * scroll, and stale rows are pruned by the boot sweep so the working
 * set stays bounded.
 */
export async function listJobsForOwner(
  ownerId: string,
  limit = 100,
): Promise<VideoJob[]> {
  return db
    .select()
    .from(videoJobs)
    .where(eq(videoJobs.ownerId, ownerId))
    .orderBy(desc(videoJobs.createdAt))
    .limit(limit);
}

/**
 * Collect every `/objects/...` path stored on a job and its chunks so
 * the caller can wipe Object Storage before deleting the row. Pulled
 * out as its own helper because both the boot sweep and the manual
 * delete endpoint need the same logic, and it lets us unit-test path
 * collection independently of DB IO.
 */
function collectJobObjectPaths(
  job: VideoJob,
  chunks: VideoChunk[],
): string[] {
  const paths = new Set<string>();
  if (job.finalVideoObjectPath) paths.add(job.finalVideoObjectPath);
  if (job.thumbnailObjectPath) paths.add(job.thumbnailObjectPath);
  // Reference frames live inside the visual bible jsonb. We only need
  // the paths — the inline base64 blobs are not stored in object
  // storage.
  const bible = projectVisualBible(job.visualBible);
  if (bible) {
    for (const c of bible.characters) {
      if (c.referenceImageObjectPath) paths.add(c.referenceImageObjectPath);
    }
    for (const l of bible.locations) {
      if (l.referenceImageObjectPath) paths.add(l.referenceImageObjectPath);
    }
    if (bible.openingFrame?.objectPath) {
      paths.add(bible.openingFrame.objectPath);
    }
  }
  for (const c of chunks) {
    if (c.videoObjectPath) paths.add(c.videoObjectPath);
    if (c.lastFrameObjectPath) paths.add(c.lastFrameObjectPath);
  }
  return [...paths];
}

/**
 * Hard-delete a job. Removes Object Storage assets best-effort first
 * (so an orphaned blob is preferable to a missing DB row that still
 * thinks it owns blobs), then deletes the row — chunks cascade via FK.
 *
 * `ownerId` is OPTIONAL: when supplied (the manual-delete-from-Library
 * path) the SQL DELETE is gated on `id = ? AND owner_id = ?` so the
 * authorization check stays atomic with the destructive write — no
 * TOCTOU window between the route's ownership check and the delete.
 * The expired-job sweeper passes no ownerId because the row is being
 * dropped on TTL grounds independent of the owner.
 *
 * Returns the number of object-storage entities successfully removed
 * so the caller can log a useful summary.
 */
export async function deleteJob(
  jobId: string,
  ownerId?: string,
): Promise<{
  storageDeleted: number;
  storageMissed: number;
}> {
  const job = await getJob(jobId);
  if (!job) return { storageDeleted: 0, storageMissed: 0 };
  // Defense-in-depth: if the caller scoped this to a specific owner,
  // refuse to touch a row that doesn't belong to them. This guards
  // against a future bug elsewhere accidentally calling deleteJob
  // with an id picked from the wrong context.
  if (ownerId && job.ownerId !== ownerId) {
    return { storageDeleted: 0, storageMissed: 0 };
  }
  const chunks = await listJobChunks(jobId);
  const paths = collectJobObjectPaths(job, chunks);
  const storage = new ObjectStorageService();
  let storageDeleted = 0;
  let storageMissed = 0;
  // Sequential cleanup keeps memory + sidecar token churn predictable
  // — these are tiny HEAD/DELETE calls per asset and a single library
  // delete only fans out a few dozen at most.
  for (const p of paths) {
    const ok = await storage.tryDeleteObjectEntity(p);
    if (ok) storageDeleted++;
    else storageMissed++;
  }
  // Owner-scoped delete when caller passed ownerId — keeps the auth
  // invariant inside the destructive SQL itself.
  const whereClause = ownerId
    ? and(eq(videoJobs.id, jobId), eq(videoJobs.ownerId, ownerId))
    : eq(videoJobs.id, jobId);
  await db.delete(videoJobs).where(whereClause);
  logger.info(
    { jobId, ownerScoped: Boolean(ownerId), storageDeleted, storageMissed },
    "video-studio: job deleted",
  );
  return { storageDeleted, storageMissed };
}

/**
 * Sweep every job whose `expiresAt` has passed. Called from boot AND
 * could be called from a periodic timer later — both paths use the
 * same helper to avoid logic drift.
 *
 * We snapshot the id list FIRST so a job created mid-sweep (after the
 * SELECT) is never touched, and so a cancellation between SELECT and
 * DELETE on a single id is harmless (deleteJob is a no-op if missing).
 */
export async function sweepExpiredJobs(): Promise<{
  jobs: number;
  storageDeleted: number;
}> {
  const now = new Date();
  const expired = await db
    .select({ id: videoJobs.id })
    .from(videoJobs)
    .where(lt(videoJobs.expiresAt, now));
  if (expired.length === 0) return { jobs: 0, storageDeleted: 0 };
  let storageDeleted = 0;
  for (const { id } of expired) {
    try {
      const result = await deleteJob(id);
      storageDeleted += result.storageDeleted;
    } catch (err) {
      logger.error({ err, jobId: id }, "video-studio: expired-job delete failed");
    }
  }
  return { jobs: expired.length, storageDeleted };
}

export async function toStatusSnapshot(
  job: VideoJob,
): Promise<VideoStudioJobStatus & { visualBible: VisualBibleSnapshot | null }> {
  const chunks = await listJobChunks(job.id);
  return {
    id: job.id,
    status: job.status as VideoStudioJobStatus["status"],
    stage: job.stage,
    message: job.message,
    progressPercent: job.progressPercent,
    currentPart: job.currentPart,
    totalParts: job.totalParts,
    model: job.model as EngineModel,
    durationSeconds: job.durationSeconds,
    aspectRatio: job.aspectRatio as VideoStudioJobStatus["aspectRatio"],
    finalVideoObjectPath: job.finalVideoObjectPath,
    thumbnailObjectPath: job.thumbnailObjectPath,
    voiceoverScript: job.voiceoverScript,
    error: job.error,
    createdAt: job.createdAt,
    completedAt: job.completedAt,
    // Live partial visual bible — streamed from storyboardEngine after
    // every NB2 reference call so the frontend can render character
    // cards / opening frame as they arrive instead of waiting for the
    // whole stage to finish.
    visualBible: projectVisualBible(job.visualBible),
    chunks: chunks.map((c) => ({
      partNumber: c.partNumber,
      timeRangeStart: c.timeRangeStart,
      timeRangeEnd: c.timeRangeEnd,
      status: c.status as "pending" | "generating" | "complete" | "failed",
      videoObjectPath: c.videoObjectPath,
      lastFrameObjectPath: c.lastFrameObjectPath,
      summary: c.summary,
      attempts: c.attempts,
      error: c.error,
    })),
  };
}
