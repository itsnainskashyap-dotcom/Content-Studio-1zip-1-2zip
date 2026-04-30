import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import {
  createSession,
  destroySession,
  findOrCreateFirebaseUser,
  sessionCookieOptions,
  SESSION_COOKIE,
} from "../lib/auth";
import { verifyFirebaseIdToken } from "../lib/firebase-admin";
import { requireAuth } from "../middleware/auth";

const router: IRouter = Router();

const FirebaseBody = z.object({
  idToken: z.string().min(1).max(8000),
});

function publicUser(u: {
  id: string;
  email: string;
  name: string;
  photoUrl?: string | null;
  createdAt: Date;
}) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    photoUrl: u.photoUrl ?? null,
    createdAt: u.createdAt.toISOString(),
  };
}

/**
 * Exchange a Firebase ID token for a server session. The client obtains
 * the ID token via Firebase Auth (Google sign-in) on the browser, then
 * POSTs it here. We verify it with the Admin SDK, upsert the user record
 * on first sign-in, mint a session, and respond with the canonical user
 * shape + an opaque session token (for the Authorization-header fallback).
 */
router.post("/auth/firebase", async (req: Request, res: Response) => {
  const parsed = FirebaseBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Missing or invalid idToken" });
    return;
  }
  try {
    const decoded = await verifyFirebaseIdToken(parsed.data.idToken);
    const email = decoded.email?.toLowerCase().trim();
    if (!email) {
      res.status(400).json({
        error:
          "Your Google account did not return an email address. Please try a different account.",
      });
      return;
    }
    const name =
      (typeof decoded.name === "string" && decoded.name.trim()) ||
      email.split("@")[0] ||
      "User";
    const photoUrl =
      typeof decoded.picture === "string" && decoded.picture.length > 0
        ? decoded.picture
        : null;

    const user = await findOrCreateFirebaseUser({
      firebaseUid: decoded.uid,
      email,
      name,
      photoUrl,
    });

    const { id, expiresAt } = await createSession(user.id);
    res.cookie(SESSION_COOKIE, id, sessionCookieOptions(expiresAt));
    res.json({ user: publicUser(user), token: id });
  } catch (err) {
    req.log.error({ err }, "Firebase sign-in failed");
    const msg = err instanceof Error ? err.message : "Sign-in failed";
    if (msg.includes("not configured")) {
      res.status(500).json({
        error:
          "Sign-in is not yet configured on the server. Please contact the administrator.",
      });
      return;
    }
    res.status(401).json({ error: "Could not verify your Google sign-in." });
  }
});

router.post("/auth/signout", async (req: Request, res: Response) => {
  const sid =
    req.cookies?.[SESSION_COOKIE] ??
    (req.headers.authorization?.startsWith("Bearer ")
      ? req.headers.authorization.slice(7)
      : null);
  if (sid && typeof sid === "string") {
    try {
      await destroySession(sid);
    } catch (err) {
      req.log.warn({ err }, "Failed to destroy session row");
    }
  }
  res.clearCookie(SESSION_COOKIE, { path: "/" });
  res.json({ ok: true });
});

router.get("/auth/me", requireAuth, async (req: Request, res: Response) => {
  res.json({ user: publicUser(req.user!) });
});

export default router;
