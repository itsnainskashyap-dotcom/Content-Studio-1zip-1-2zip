/**
 * Helpers for resolving image references to URLs the browser can render.
 *
 * After the Object Storage migration, every generated image is stored
 * server-side and the project keeps only a small reference object:
 *
 *   { objectPath: "/objects/uploads/<uuid>", mimeType: "image/png", ... }
 *
 * Legacy projects (created before the migration) may still carry inline
 * base64 in `b64Json`. Both shapes are supported here so a refresh on
 * pre-migration data still renders.
 */

const BASE_URL_RAW = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

/** Path-routed prefix for API calls. Mirrors the App.tsx setBaseUrl call. */
export function apiBasePrefix(): string {
  return BASE_URL_RAW;
}

/**
 * Build an absolute (relative-to-host) URL for a server-stored image given
 * its object path. The server's storage route accepts BOTH the long
 * "/objects/uploads/<id>" form AND the short ":id" form, so we keep the
 * full path verbatim — easier to debug, and forward-compatible if the
 * server adds new prefixes.
 */
export function objectPathToUrl(objectPath: string): string {
  // Storage routes are mounted under /api/storage. The object path itself
  // begins with "/objects/...". Compose: <base>/api/storage/<rest-of-path>
  const trimmed = objectPath.replace(/^\//, "");
  return `${BASE_URL_RAW}/api/storage/${trimmed}`;
}

export interface ImageRefLike {
  objectPath?: string | null;
  b64Json?: string | null;
  mimeType?: string | null;
}

/**
 * Resolve an image ref to a `<img src>`-compatible URL.
 *
 *   1. Prefer the new objectPath form (server URL).
 *   2. Fall back to legacy inline base64 → data URL.
 *   3. Empty string when the ref carries neither (caller should
 *      treat that as "no image yet" and render a placeholder).
 */
export function imageRefSrc(ref: ImageRefLike | null | undefined): string {
  if (!ref) return "";
  if (ref.objectPath) return objectPathToUrl(ref.objectPath);
  if (ref.b64Json && ref.mimeType) {
    return `data:${ref.mimeType};base64,${ref.b64Json}`;
  }
  return "";
}

/** True when the ref points at *something* renderable (server or legacy). */
export function hasImage(ref: ImageRefLike | null | undefined): boolean {
  if (!ref) return false;
  return Boolean(ref.objectPath) || Boolean(ref.b64Json);
}
