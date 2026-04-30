import { randomBytes } from "crypto";
import { db } from "@workspace/db";
import { users, sessions, type User } from "@workspace/db/schema";
import { eq, and, gt } from "drizzle-orm";

/**
 * Minimal email + password + httpOnly-cookie session auth tailored to
 * ContentStudio AI's existing UX (the in-app signup card already collects
 * email/password). We deliberately do NOT pull in Clerk / Replit Auth
 * here — the user wanted the same friction-free flow they had before, but
 * with real cross-device persistence on the server.
 *
 * Password hashing: bcryptjs (pure-JS so it works without native build
 * toolchains in the Replit container).
 *
 * Session model: opaque random session id stored in `sessions` table,
 * scoped to a user, with a hard 30-day expiry. The id is sent back as a
 * `cs_session` httpOnly cookie. There's no refresh-token dance because
 * 30 days is plenty for a creator-tools workflow.
 */

export const SESSION_COOKIE = "cs_session";
const SESSION_TTL_DAYS = 30;

export async function findUserByEmail(email: string): Promise<User | null> {
  const [row] = await db
    .select()
    .from(users)
    .where(eq(users.email, email.toLowerCase().trim()))
    .limit(1);
  return row ?? null;
}

export async function findUserByFirebaseUid(
  uid: string,
): Promise<User | null> {
  const [row] = await db
    .select()
    .from(users)
    .where(eq(users.firebaseUid, uid))
    .limit(1);
  return row ?? null;
}

/**
 * Look up the local user record for a verified Firebase identity, creating
 * one on the very first sign-in. We try the firebase_uid index first; if a
 * legacy email-based row exists (from the old password flow) we link it
 * by stamping the uid onto it instead of inserting a duplicate.
 */
export async function findOrCreateFirebaseUser(args: {
  firebaseUid: string;
  email: string;
  name: string;
  photoUrl?: string | null;
}): Promise<User> {
  const email = args.email.toLowerCase().trim();
  const name = args.name.trim() || email.split("@")[0] || "User";

  const existingByUid = await findUserByFirebaseUid(args.firebaseUid);
  if (existingByUid) return existingByUid;

  const existingByEmail = await findUserByEmail(email);
  if (existingByEmail) {
    const [updated] = await db
      .update(users)
      .set({
        firebaseUid: args.firebaseUid,
        photoUrl: args.photoUrl ?? existingByEmail.photoUrl,
        name: existingByEmail.name || name,
      })
      .where(eq(users.id, existingByEmail.id))
      .returning();
    return updated ?? existingByEmail;
  }

  const [row] = await db
    .insert(users)
    .values({
      email,
      name,
      firebaseUid: args.firebaseUid,
      photoUrl: args.photoUrl ?? null,
    })
    .returning();
  if (!row) throw new Error("Failed to create user");
  return row;
}

export async function findUserById(id: string): Promise<User | null> {
  const [row] = await db
    .select()
    .from(users)
    .where(eq(users.id, id))
    .limit(1);
  return row ?? null;
}

export function newSessionId(): string {
  return randomBytes(32).toString("hex");
}

export function sessionExpiry(): Date {
  return new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
}

export async function createSession(userId: string): Promise<{
  id: string;
  expiresAt: Date;
}> {
  const id = newSessionId();
  const expiresAt = sessionExpiry();
  await db.insert(sessions).values({ id, userId, expiresAt });
  return { id, expiresAt };
}

export async function getSessionUser(
  sessionId: string,
): Promise<User | null> {
  const now = new Date();
  const [row] = await db
    .select({ user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, sessionId), gt(sessions.expiresAt, now)))
    .limit(1);
  return row?.user ?? null;
}

export async function destroySession(sessionId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, sessionId));
}

export function sessionCookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    expires: expiresAt,
    // Replit always serves the artifact through HTTPS via the workspace
    // proxy, but local pure-HTTP (e.g. localhost smoke-tests) would fail
    // if we hard-coded `secure: true`. The proxy already enforces TLS in
    // production, so it's safe to omit.
  };
}
