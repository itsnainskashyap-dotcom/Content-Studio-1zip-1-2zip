const TOKEN_KEY = "cs_token";

export function getSessionToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setSessionToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // storage unavailable — cookie-only fallback
  }
}

export function clearSessionToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    // ignore
  }
}

/**
 * Returns headers to include on every authenticated API request.
 * Sends the session token as a Bearer token so auth works even when
 * httpOnly cookies are blocked in the Replit workspace iframe context.
 */
export function authHeaders(): Record<string, string> {
  const token = getSessionToken();
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}

/**
 * A drop-in replacement for `fetch` that automatically attaches the
 * session token as an Authorization header on every request.
 */
export async function apiFetch(
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  const token = getSessionToken();
  const headers = new Headers(init.headers);
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  return fetch(url, { ...init, headers, credentials: "include" });
}
