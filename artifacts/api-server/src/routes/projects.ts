import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { projects } from "@workspace/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { requireAuth } from "../middleware/auth";

const router: IRouter = Router();

/**
 * The Project shape lives in the frontend as a TypeScript type. We don't
 * mirror every field server-side — instead we accept the entire project
 * as JSON and store it in a `jsonb` column. This keeps schema migrations
 * out of the inner-loop while the Project type is still evolving (Veo
 * mode integration, video render results, etc.).
 *
 * The only invariants we enforce here are: an `id` exists, it's a
 * non-empty string, and the body isn't absurdly large.
 */
const ProjectBody = z
  .object({
    id: z.string().min(1).max(120),
  })
  .passthrough();

// 6 MB cap. Generated frame + character images are now references (tiny
// strings), so the only heavy payload left on a project is the user's
// uploaded reference images (max 5 × ~400 KB base64 ≈ 2.7 MB). 6 MB
// gives comfortable headroom for the rest (story / parts / prompts)
// without leaving the door open to a runaway inline-base64 client.
const MAX_PROJECT_BYTES = 6_000_000;

router.use(requireAuth);

router.get("/projects", async (req: Request, res: Response) => {
  try {
    const rows = await db
      .select({ data: projects.data, updatedAt: projects.updatedAt })
      .from(projects)
      .where(eq(projects.ownerId, req.user!.id))
      .orderBy(desc(projects.updatedAt));
    res.json({
      projects: rows.map((r) => ({
        ...(r.data as Record<string, unknown>),
        updatedAt: r.updatedAt.toISOString(),
      })),
    });
  } catch (err) {
    req.log.error({ err }, "List projects failed");
    res.status(500).json({ error: "Failed to load projects" });
  }
});

router.get("/projects/:id", async (req: Request, res: Response) => {
  try {
    // Express 5 widens the params type to `string | string[]` for catch-all
    // routes; `:id` is always a single segment so the cast is safe and keeps
    // Drizzle's `eq` happy without a runtime check.
    const id = String(req.params["id"]);
    const [row] = await db
      .select({ data: projects.data, updatedAt: projects.updatedAt })
      .from(projects)
      .where(
        and(
          eq(projects.ownerId, req.user!.id),
          eq(projects.id, id),
        ),
      )
      .limit(1);
    if (!row) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    res.json({
      project: {
        ...(row.data as Record<string, unknown>),
        updatedAt: row.updatedAt.toISOString(),
      },
    });
  } catch (err) {
    req.log.error({ err }, "Get project failed");
    res.status(500).json({ error: "Failed to load project" });
  }
});

router.put("/projects/:id", async (req: Request, res: Response) => {
  const parsed = ProjectBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid project body" });
    return;
  }
  if (parsed.data.id !== req.params["id"]) {
    res.status(400).json({ error: "Project id in body must match URL" });
    return;
  }
  // Defensive cap — frontend should never send anywhere near this since
  // images are now stored by reference, but we still want to refuse a
  // pathological client that crammed everything back into base64.
  const bytes = Buffer.byteLength(JSON.stringify(parsed.data));
  if (bytes > MAX_PROJECT_BYTES) {
    res.status(413).json({
      error: "Project too large to save. Make sure images are stored by reference, not inline.",
    });
    return;
  }
  try {
    const now = new Date();
    await db
      .insert(projects)
      .values({
        id: parsed.data.id,
        ownerId: req.user!.id,
        data: parsed.data,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [projects.id, projects.ownerId],
        set: { data: parsed.data, updatedAt: now },
      });
    res.json({
      project: { ...parsed.data, updatedAt: now.toISOString() },
    });
  } catch (err) {
    req.log.error({ err }, "Upsert project failed");
    res.status(500).json({ error: "Failed to save project" });
  }
});

router.delete("/projects/:id", async (req: Request, res: Response) => {
  try {
    const id = String(req.params["id"]);
    await db
      .delete(projects)
      .where(
        and(
          eq(projects.ownerId, req.user!.id),
          eq(projects.id, id),
        ),
      );
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Delete project failed");
    res.status(500).json({ error: "Failed to delete project" });
  }
});

export default router;
