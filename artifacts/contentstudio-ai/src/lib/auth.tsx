import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { apiBasePrefix } from "./image-url";
import {
  getSessionToken,
  setSessionToken,
  clearSessionToken,
  apiFetch,
} from "./session-token";
import {
  signInWithGoogle as firebaseSignInWithGoogle,
  firebaseClientSignOut,
  isFirebaseConfigured,
} from "./firebase";

export interface CSUser {
  id: string;
  email: string;
  name: string;
  photoUrl?: string | null;
  /**
   * ISO-8601 timestamp the account was created on the server. Kept as a
   * string here (not a number) since the server returns it that way; the
   * UI never does arithmetic on this value.
   */
  createdAt: string;
}

interface AuthContextValue {
  user: CSUser | null;
  loading: boolean;
  /**
   * Pop a Google sign-in window via Firebase, exchange the resulting ID
   * token for a server session, and update the local user state. Returns
   * `{ ok: false, error }` for a friendly toast on failure (popup
   * closed, network down, server rejected the token, etc.).
   */
  signInWithGoogle: () => Promise<{ ok: boolean; error?: string }>;
  signOut: () => Promise<void>;
  firebaseConfigured: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const API = (path: string): string => `${apiBasePrefix()}/api${path}`;

interface JsonErrorBody {
  error?: string;
}

async function readError(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as JsonErrorBody;
    if (body && typeof body.error === "string" && body.error.trim().length > 0) {
      return body.error;
    }
  } catch {
    // body wasn't JSON — fall through
  }
  return fallback;
}

/**
 * AuthProvider wraps a Firebase Google sign-in flow on top of the existing
 * server-side session API:
 *   - GET    /api/auth/me        — boot-time session check
 *   - POST   /api/auth/firebase  — exchange Firebase ID token → session
 *   - POST   /api/auth/signout   — destroy server session + cookie
 *
 * The server session id is carried via the `cs_session` httpOnly cookie
 * AND a Bearer token (localStorage fallback for the workspace iframe).
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CSUser | null>(null);
  const [loading, setLoading] = useState(true);
  const firebaseConfigured = isFirebaseConfigured();

  // Boot-time session restore. Uses any stored token + cookie.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch(API("/auth/me"), {
          method: "GET",
        });
        if (cancelled) return;
        if (res.ok) {
          const body = (await res.json()) as { user?: CSUser };
          if (body.user) setUser(body.user);
        } else {
          // Session expired or invalid — clear stored token
          clearSessionToken();
        }
      } catch {
        // Network down on first paint — leave user null.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const signInWithGoogle = useCallback(async () => {
    if (!firebaseConfigured) {
      return {
        ok: false,
        error:
          "Google sign-in isn't configured yet. Please add the Firebase secrets in Replit Secrets.",
      };
    }
    try {
      const { idToken } = await firebaseSignInWithGoogle();
      const res = await fetch(API("/auth/firebase"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken }),
      });
      if (!res.ok) {
        const msg = await readError(res, "Couldn't complete sign-in. Please try again.");
        return { ok: false, error: msg };
      }
      const body = (await res.json()) as { user?: CSUser; token?: string };
      if (!body.user) return { ok: false, error: "Server returned no user." };
      if (body.token) setSessionToken(body.token);
      setUser(body.user);
      return { ok: true };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Sign-in failed.";
      // Firebase throws a specific code when the user closes the popup.
      if (
        message.includes("auth/popup-closed-by-user") ||
        message.includes("auth/cancelled-popup-request")
      ) {
        return { ok: false, error: "Sign-in cancelled." };
      }
      if (message.includes("auth/popup-blocked")) {
        return {
          ok: false,
          error:
            "Your browser blocked the sign-in popup. Please allow popups for this site and try again.",
        };
      }
      return { ok: false, error: message };
    }
  }, [firebaseConfigured]);

  const signOut = useCallback(async () => {
    try {
      const token = getSessionToken();
      await fetch(API("/auth/signout"), {
        method: "POST",
        credentials: "include",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
    } catch {
      // Best-effort
    }
    clearSessionToken();
    try {
      await firebaseClientSignOut();
    } catch {
      // Best-effort — Firebase signOut never blocks our local sign-out.
    }
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{ user, loading, signInWithGoogle, signOut, firebaseConfigured }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
