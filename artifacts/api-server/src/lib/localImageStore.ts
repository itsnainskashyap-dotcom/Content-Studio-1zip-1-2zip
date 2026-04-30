import { mkdir, readFile, writeFile, stat, rename, unlink } from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

/**
 * Local-disk fallback for object-storage saves/loads.
 *
 * Why this exists:
 *   The Replit Object Storage sidecar at 127.0.0.1:1106 occasionally returns
 *   `401 "no allowed resources"` from its `/token` STS exchange. When that
 *   happens, every `objectStorageClient.bucket().file().save()` call fails
 *   with `Error code undefined` (the literal message synthesized by
 *   google-auth-library when the OAuth error response has no `error` field).
 *
 *   Without a fallback, users see "0 of N images generated" even though
 *   the upstream model (Nano Banana 2 / Veo / Seedance) successfully
 *   returned bytes. That UX is unrecoverable without infra intervention.
 *
 *   This module persists bytes under `<api-server-cwd>/.local-image-store/uploads/<uuid>`
 *   alongside a `<uuid>.meta.json` companion. The save+load+serve helpers
 *   in `imageStorage`, `videoStorage`, and the `/storage/objects/*` route
 *   try GCS first and silently fall through to here on auth-style errors
 *   so the rest of the app keeps using the same `/objects/uploads/<id>`
 *   path scheme — no client changes required.
 */

const LOCAL_STORE_ROOT = path.resolve(
  process.cwd(),
  ".local-image-store",
  "uploads",
);

async function ensureRoot(): Promise<void> {
  await mkdir(LOCAL_STORE_ROOT, { recursive: true });
}

function pathsFor(id: string): { blob: string; meta: string } {
  return {
    blob: path.join(LOCAL_STORE_ROOT, id),
    meta: path.join(LOCAL_STORE_ROOT, `${id}.meta.json`),
  };
}

// Strict v4-shaped UUID matcher. We mint ids with crypto.randomUUID(), so
// every legitimate id is a hex UUID. Restricting to this shape eliminates
// any chance of `.`, `..`, slashes, or NUL bytes reaching the filesystem
// path join below.
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * Pull the trailing UUID out of any of these shapes:
 *   - "/objects/uploads/<uuid>"
 *   - "/objects/<uuid>"
 *   - "uploads/<uuid>"
 *   - "<uuid>"
 *
 * Returns null if the path doesn't end in a strict UUID.
 */
export function objectPathToLocalId(objectPath: string): string | null {
  if (!objectPath) return null;
  const trimmed = objectPath.replace(/^\/+/, "").replace(/\/+$/, "");
  if (!trimmed) return null;
  const parts = trimmed.split("/");
  const last = parts[parts.length - 1];
  if (!last) return null;
  if (!UUID_RE.test(last)) return null;
  // Defense-in-depth: re-resolve and confirm the resulting absolute path is
  // still inside LOCAL_STORE_ROOT (catches any future regex slippage).
  const resolved = path.resolve(LOCAL_STORE_ROOT, last);
  if (!resolved.startsWith(LOCAL_STORE_ROOT + path.sep)) return null;
  return last;
}

/** Mint a fresh UUID id usable as a local store key. */
export function newLocalImageId(): string {
  return randomUUID();
}

/**
 * Persist bytes + mime type under the given id, atomically.
 *
 * We write to `<file>.<rand>.tmp`, fsync-implicit via writeFile, then rename
 * over the destination. The metadata file is written FIRST and the blob is
 * renamed LAST so that any reader who sees the blob is guaranteed to also
 * find a complete metadata file.
 */
export async function saveLocalImage(
  id: string,
  bytes: Buffer,
  mimeType: string,
): Promise<void> {
  if (!UUID_RE.test(id)) {
    throw new Error(`saveLocalImage: refusing non-UUID id "${id}"`);
  }
  await ensureRoot();
  const { blob, meta } = pathsFor(id);
  const rand = randomUUID();
  const blobTmp = `${blob}.${rand}.tmp`;
  const metaTmp = `${meta}.${rand}.tmp`;
  try {
    await writeFile(
      metaTmp,
      JSON.stringify({ mimeType, savedAt: new Date().toISOString() }),
    );
    await writeFile(blobTmp, bytes);
    await rename(metaTmp, meta);
    await rename(blobTmp, blob);
  } catch (err) {
    // Best-effort cleanup of leftover temp files.
    await Promise.allSettled([
      unlink(blobTmp).catch(() => {}),
      unlink(metaTmp).catch(() => {}),
    ]);
    throw err;
  }
}

/** Stream-friendly variant for large payloads (videos). */
export async function saveLocalImageFromBuffer(
  id: string,
  bytes: Buffer,
  mimeType: string,
): Promise<void> {
  return saveLocalImage(id, bytes, mimeType);
}

/** Load bytes + mime type for an id. Returns null if not present. */
export async function loadLocalImage(
  id: string,
): Promise<{ bytes: Buffer; mimeType: string } | null> {
  try {
    const { blob, meta } = pathsFor(id);
    const [bytes, metaJson] = await Promise.all([
      readFile(blob),
      readFile(meta, "utf8").catch(() => "{}"),
    ]);
    let mimeType = "application/octet-stream";
    try {
      const parsed = JSON.parse(metaJson);
      if (parsed && typeof parsed.mimeType === "string") {
        mimeType = parsed.mimeType;
      }
    } catch {
      /* ignore */
    }
    return { bytes, mimeType };
  } catch {
    return null;
  }
}

/** Open a read stream for an id. Returns null if not present. */
export async function openLocalImageStream(
  id: string,
): Promise<{
  stream: NodeJS.ReadableStream;
  size: number;
  mimeType: string;
} | null> {
  try {
    const { blob, meta } = pathsFor(id);
    const [statRes, metaJson] = await Promise.all([
      stat(blob),
      readFile(meta, "utf8").catch(() => "{}"),
    ]);
    let mimeType = "application/octet-stream";
    try {
      const parsed = JSON.parse(metaJson);
      if (parsed && typeof parsed.mimeType === "string") {
        mimeType = parsed.mimeType;
      }
    } catch {
      /* ignore */
    }
    return {
      stream: createReadStream(blob),
      size: statRes.size,
      mimeType,
    };
  } catch {
    return null;
  }
}

/**
 * Heuristic: was this error thrown by the GCS auth pipeline because the
 * Replit Object Storage sidecar refused to mint a token?
 *
 * google-auth-library produces the literal string "Error code undefined"
 * when the sidecar returns a non-OAuth-shaped 401/403 body (which is
 * exactly what the sidecar does for unprovisioned bucket grants). We
 * also catch raw 401/403 statuses, common refresh failures, and the
 * sidecar's plain-text "no allowed resources" body.
 */
export function isObjectStorageAuthError(err: unknown): boolean {
  if (!err) return false;
  const e = err as {
    code?: number | string;
    status?: number | string;
    message?: string;
    response?: { status?: number; data?: unknown };
  };
  const status =
    typeof e.status === "number"
      ? e.status
      : typeof e.code === "number"
        ? e.code
        : e.response?.status;
  if (status === 401 || status === 403) return true;
  const msg = String(e.message ?? "").toLowerCase();
  if (
    msg.includes("error code undefined") ||
    msg.includes("no allowed resources") ||
    msg.includes("invalid_grant") ||
    msg.includes("could not refresh access token") ||
    msg.includes("unable to refresh access token") ||
    // Replit sidecar's signed-URL endpoint surfaces auth/grant failures
    // through a custom message: "Failed to sign object URL, errorcode: 401,
    // make sure you're running on Replit". We treat any 401/403 the
    // sidecar returns from that endpoint as the same class of failure.
    msg.includes("failed to sign object url, errorcode: 401") ||
    msg.includes("failed to sign object url, errorcode: 403")
  ) {
    return true;
  }
  const respData = String((e.response as { data?: unknown } | undefined)?.data ?? "").toLowerCase();
  if (respData.includes("no allowed resources")) return true;
  return false;
}

/** Where local-store files live (for diagnostics / health checks). */
export function getLocalStoreRoot(): string {
  return LOCAL_STORE_ROOT;
}
