/**
 * /api/video-studio routes.
 *
 *   POST /video-studio/jobs                — start a new job (202 + status)
 *   GET  /video-studio/jobs/:id            — current snapshot (poll target)
 *   POST /video-studio/jobs/:id/cancel     — cancel a running job
 *
 * Auth-gated: every endpoint requires a logged-in user. The job is
 * scoped to its owner; reads and cancels only succeed for the same
 * user that started it.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import {
  CreateVideoStudioJobBody,
  type VideoStudioJobRequest,
} from "@workspace/api-zod";
import { requireAuth } from "../../middleware/auth";
import {
  startVideoStudioJob,
} from "../../video/aiVideoStudioEngine";
import {
  deleteJob,
  getActiveJobForOwner,
  getJob,
  listJobsForOwner,
  toStatusSnapshot,
  updateJob,
} from "../../video/jobStore";
import { ENGINE_DURATIONS, type EngineModel } from "../../video/types";

const router: IRouter = Router();

router.post(
  "/video-studio/jobs",
  requireAuth,
  async (req: Request, res: Response) => {
    const parsed = CreateVideoStudioJobBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request body" });
      return;
    }
    // Cast to the OpenAPI-generated request type — the zod schema only
    // mirrors a subset of the type fields, but at runtime parsed.data
    // structurally satisfies the engine's input shape.
    const body = parsed.data as VideoStudioJobRequest;

    // Validate the (model, durationSeconds) pair against the spec table.
    const model = body.model as EngineModel;
    const allowed = ENGINE_DURATIONS[model];
    if (!allowed.includes(body.durationSeconds as never)) {
      res.status(400).json({
        error: `Duration ${body.durationSeconds}s is not allowed for ${model}. Allowed: ${allowed.join(", ")}.`,
      });
      return;
    }

    try {
      const userId = req.user!.id;
      const { jobId } = await startVideoStudioJob({
        ownerId: userId,
        request: body,
      });
      const job = await getJob(jobId);
      if (!job) {
        res.status(500).json({ error: "Job created but could not be read back" });
        return;
      }
      const snapshot = await toStatusSnapshot(job);
      res.status(202).json(snapshot);
    } catch (err) {
      req.log.error({ err }, "video-studio: failed to start job");
      const message = err instanceof Error ? err.message : "Failed to start job";
      res.status(500).json({ error: message });
    }
  },
);

/**
 * GET /video-studio/jobs/active
 *
 * Returns the user's most recent in-flight (`queued` or `running`) job
 * snapshot, or `null` if none exists. The frontend calls this on mount
 * so the AI Video Studio page can reconnect to a generation that is
 * still progressing server-side after a navigation, refresh, or tab
 * reopen — fixing the user's complaint that the in-progress generation
 * disappears from the UI when they navigate away and return.
 *
 * IMPORTANT: this route must come BEFORE `/jobs/:id` or the param
 * matcher would swallow "active".
 */
router.get(
  "/video-studio/jobs/active",
  requireAuth,
  async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const job = await getActiveJobForOwner(userId);
    if (!job) {
      res.json(null);
      return;
    }
    const snapshot = await toStatusSnapshot(job);
    res.json(snapshot);
  },
);

/**
 * GET /video-studio/jobs
 *
 * Lightweight library listing for the user's saved generations. We
 * return a slim card shape (id, model, status, thumbnail, character /
 * opening-frame previews, created/expires timestamps) so the Library
 * grid can render fast without pulling the full chunk arrays. Heavy
 * fields like `chunks` and `inputStory` stay on the per-job snapshot
 * route — the user clicks a card to drill in if they want detail.
 *
 * Sort: newest-first. Capped at 100 — see `listJobsForOwner`.
 */
router.get(
  "/video-studio/jobs",
  requireAuth,
  async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const jobs = await listJobsForOwner(userId);
    const cards = jobs.map((job) => {
      const bible = (job.visualBible ?? null) as {
        characters?: Array<{
          name?: string;
          referenceImageObjectPath?: string;
        }>;
        openingFrame?: { objectPath?: string };
      } | null;
      const characterThumbs = Array.isArray(bible?.characters)
        ? bible!.characters
            .map((c) => ({
              name: String(c?.name ?? ""),
              objectPath: String(c?.referenceImageObjectPath ?? ""),
            }))
            .filter((c) => c.objectPath.length > 0)
        : [];
      const expiresAt = job.expiresAt ?? null;
      const daysRemaining = expiresAt
        ? Math.max(
            0,
            Math.ceil(
              (expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24),
            ),
          )
        : null;
      return {
        id: job.id,
        model: job.model,
        status: job.status,
        stage: job.stage,
        progressPercent: job.progressPercent,
        durationSeconds: job.durationSeconds,
        aspectRatio: job.aspectRatio,
        finalVideoObjectPath: job.finalVideoObjectPath,
        thumbnailObjectPath: job.thumbnailObjectPath,
        openingFrameObjectPath: bible?.openingFrame?.objectPath ?? null,
        characterThumbs,
        error: job.error,
        createdAt: job.createdAt,
        completedAt: job.completedAt,
        expiresAt,
        daysRemaining,
      };
    });
    res.json({ jobs: cards });
  },
);

router.get(
  "/video-studio/jobs/:id",
  requireAuth,
  async (req: Request, res: Response) => {
    const id = String(req.params["id"]);
    const job = await getJob(id);
    if (!job) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    if (job.ownerId !== req.user!.id) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    const snapshot = await toStatusSnapshot(job);
    res.json(snapshot);
  },
);

/**
 * DELETE /video-studio/jobs/:id
 *
 * Manual delete from the Library. Removes the row + cascades chunks +
 * best-effort wipes Object Storage assets (final mp4, thumbnail, all
 * chunk videos, last-frames, and reference images from the visual
 * bible). Idempotent — a 404 is returned only if the user does not
 * own the job; deleting a non-existent or already-deleted job returns
 * 204 so the UI can optimistically remove the card.
 */
router.delete(
  "/video-studio/jobs/:id",
  requireAuth,
  async (req: Request, res: Response) => {
    const id = String(req.params["id"]);
    const job = await getJob(id);
    if (job && job.ownerId !== req.user!.id) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    // Refuse to delete a still-running job — cancelling first prevents
    // the engine from racing with our storage cleanup. The frontend
    // surfaces this as "cancel before delete".
    if (
      job &&
      (job.status === "queued" || job.status === "running")
    ) {
      res.status(409).json({
        error:
          "This generation is still in progress — cancel it first, then delete.",
      });
      return;
    }
    try {
      // Pass the authenticated owner id so the destructive SQL is
      // gated on `id = ? AND owner_id = ?` — keeps the auth invariant
      // atomic with the delete (no TOCTOU window vs the read above).
      await deleteJob(id, req.user!.id);
      res.status(204).end();
    } catch (err) {
      req.log.error({ err, jobId: id }, "video-studio: delete failed");
      res.status(500).json({ error: "Failed to delete the generation" });
    }
  },
);

router.post(
  "/video-studio/jobs/:id/cancel",
  requireAuth,
  async (req: Request, res: Response) => {
    const id = String(req.params["id"]);
    const job = await getJob(id);
    if (!job) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    if (job.ownerId !== req.user!.id) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    if (job.status === "complete" || job.status === "failed") {
      const snapshot = await toStatusSnapshot(job);
      res.json(snapshot);
      return;
    }
    await updateJob(id, {
      status: "cancelled",
      message: "Cancelled by user.",
      completedAt: new Date(),
    });
    const after = await getJob(id);
    const snapshot = await toStatusSnapshot(after!);
    res.json(snapshot);
  },
);

export default router;
