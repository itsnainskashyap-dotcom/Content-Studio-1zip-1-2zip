import type { Request, Response, NextFunction } from "express";
import { getSessionUser, SESSION_COOKIE } from "../lib/auth";
import type { User } from "@workspace/db/schema";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

/**
 * Reads the session from either:
 *   1. The `cs_session` httpOnly cookie (preferred)
 *   2. An `Authorization: Bearer <token>` header (fallback for environments
 *      where cookies are blocked, e.g. the Replit workspace iframe proxy)
 *
 * Never throws — anonymous requests pass through with `req.user === undefined`.
 */
export async function attachUser(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    let sid: string | undefined;

    const cookieSid = req.cookies?.[SESSION_COOKIE];
    if (cookieSid && typeof cookieSid === "string") {
      sid = cookieSid;
    }

    if (!sid) {
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith("Bearer ")) {
        const token = authHeader.slice(7).trim();
        if (token) sid = token;
      }
    }

    if (sid) {
      const user = await getSessionUser(sid);
      if (user) req.user = user;
    }
  } catch (err) {
    req.log.warn({ err }, "attachUser failed; treating request as anonymous");
  }
  next();
}

export function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!req.user) {
    res.status(401).json({ error: "Not signed in" });
    return;
  }
  next();
}
