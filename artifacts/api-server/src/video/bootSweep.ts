/**
 * Boot-time sweep for AI Video Studio jobs left in a non-terminal
 * state when the API server restarted mid-render.
 *
 * The engine runs in-process (fire-and-forget Promise from the create
 * route). If the server is restarted while a job is `queued` or
 * `running`, no worker is left to advance it — the row would otherwise
 * sit forever in the running state and the polling client would just
 * see a frozen progress bar.
 *
 * On boot we mark every such row as `failed` with a sanitized,
 * user-facing message so the frontend can surface a "retry" CTA.
 * Per-chunk rows are not touched — the failed parent message is
 * sufficient for the UI.
 */

import { db } from "@workspace/db";
import { videoJobs } from "@workspace/db/schema";
import { and, inArray } from "drizzle-orm";
import { logger } from "../lib/logger";
import { sweepExpiredJobs } from "./jobStore";

export async function sweepStaleVideoJobs(): Promise<void> {
  // Phase 1: TTL sweep — drop everything past `expiresAt` (default 30
  // days). Do this BEFORE the stale-running check so an expired job
  // that was also abandoned mid-render is removed cleanly instead of
  // first being marked failed and then deleted on the next boot.
  try {
    const result = await sweepExpiredJobs();
    if (result.jobs > 0) {
      logger.warn(
        { jobs: result.jobs, storageDeleted: result.storageDeleted },
        "video-studio: swept N expired jobs (30-day TTL)",
      );
    }
  } catch (err) {
    logger.error({ err }, "video-studio: TTL sweep failed");
  }

  // Phase 2: stale running/queued sweep — same logic as before.
  try {
    // Step 1: snapshot the EXACT set of pre-boot stale rows. We rescan
    // by id below so a job created milliseconds after this query — or a
    // job belonging to another live process in a multi-instance deploy
    // — is never affected by our restart-failure write.
    const stale = await db
      .select({ id: videoJobs.id })
      .from(videoJobs)
      .where(inArray(videoJobs.status, ["queued", "running"]));
    if (stale.length === 0) return;
    const ids = stale.map((s: { id: string }) => s.id);
    // Step 2: update only those specific ids, AND only if they are
    // still in a non-terminal state (so a job that completed between
    // step 1 and step 2 is not retroactively marked failed).
    await db
      .update(videoJobs)
      .set({
        status: "failed",
        stage: "failed",
        message:
          "Generation was interrupted by a server restart — please retry.",
        error:
          "Generation was interrupted by a server restart — please retry.",
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          inArray(videoJobs.id, ids),
          inArray(videoJobs.status, ["queued", "running"]),
        ),
      );
    logger.warn(
      { count: stale.length, ids },
      "video-studio: marked stale running/queued jobs as failed on boot",
    );
  } catch (err) {
    logger.error({ err }, "video-studio: boot sweep failed");
  }
}
