/**
 * One-shot migration: take any projects that were saved in the old
 * `cs_projects` localStorage bucket (pre Object Storage refactor) and:
 *
 *   1. Walk every inline `b64Json` image embedded in the project
 *      (frame stills, character sheets, user reference uploads).
 *   2. Upload each one to Object Storage via the
 *      /api/storage/uploads/request-url presigned-URL flow.
 *   3. Replace the inline base64 with `{ objectPath, mimeType }`.
 *   4. PUT the rewritten project to /api/projects/:id so it's
 *      now backed by the server.
 *   5. Clear the legacy `cs_projects` key from localStorage so the
 *      migration only ever runs once per device.
 *
 * The migration is destructive of the OLD shape but never touches the
 * newly-server-backed projects — if it fails on any project we leave
 * `cs_projects` in place so a retry next session can resume.
 */
import { apiBasePrefix } from "./image-url";
import { apiFetch } from "./session-token";

const LEGACY_KEY = "cs_projects";
const MIGRATION_DONE_KEY = "cs_projects_migrated_v1";

interface UploadUrlResponse {
  uploadURL: string;
  objectPath: string;
  metadata: { name: string; size: number; contentType: string };
}

/**
 * Convert a base64 string to a Blob. We avoid a roundtrip through
 * `data:` URLs because some (very long) reference images can choke
 * the browser's URL parser.
 */
function base64ToBlob(b64: string, mimeType: string): Blob {
  const byteString = atob(b64);
  const len = byteString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = byteString.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
}

async function requestUploadUrl(
  name: string,
  blob: Blob,
): Promise<UploadUrlResponse> {
  const res = await apiFetch(
    `${apiBasePrefix()}/api/storage/uploads/request-url`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        size: blob.size,
        contentType: blob.type || "application/octet-stream",
      }),
    },
  );
  if (!res.ok) throw new Error(`request-url failed: ${res.status}`);
  return (await res.json()) as UploadUrlResponse;
}

async function uploadToPresignedUrl(uploadURL: string, blob: Blob): Promise<void> {
  const res = await fetch(uploadURL, {
    method: "PUT",
    body: blob,
    headers: { "Content-Type": blob.type || "application/octet-stream" },
  });
  if (!res.ok) throw new Error(`upload failed: ${res.status}`);
}

/**
 * Upload a single base64 image and return the new server-side reference
 * (objectPath + mimeType). Throws on any I/O failure so the surrounding
 * project migration short-circuits and the legacy bucket stays intact.
 */
async function uploadInlineImage(
  b64Json: string,
  mimeType: string,
  hintName: string,
): Promise<{ objectPath: string; mimeType: string }> {
  const blob = base64ToBlob(b64Json, mimeType);
  const ext = mimeType.includes("jpeg") ? "jpg" : mimeType.split("/")[1] || "png";
  const safeName = `${hintName.replace(/[^a-z0-9_-]/gi, "_").slice(0, 40)}.${ext}`;
  const meta = await requestUploadUrl(safeName, blob);
  await uploadToPresignedUrl(meta.uploadURL, blob);
  return { objectPath: meta.objectPath, mimeType };
}

interface LegacyImage {
  b64Json?: string;
  mimeType?: string;
  objectPath?: string;
}

interface LegacyPart {
  partNumber?: number;
  startingFrameImage?: LegacyImage | null;
  endingFrameImage?: LegacyImage | null;
}

interface LegacyProject {
  id?: string;
  title?: string;
  parts?: LegacyPart[];
  characterImages?: {
    sig?: string;
    items?: Record<string, LegacyImage>;
    updatedAt?: string;
  } | null;
  referenceImages?: Array<LegacyImage & { id?: string; name?: string; kind?: string; source?: string }>;
}

/**
 * Walk one project's nested image refs, upload every legacy `b64Json`
 * blob, and rewrite the ref to `{ objectPath, mimeType }`. Returns the
 * rewritten project. Mutates a shallow copy — the original is left alone
 * so a partial-failure rollback can fall back to it.
 */
async function rewriteProjectImages(
  legacy: LegacyProject,
  hintTitle: string,
): Promise<LegacyProject> {
  const out: LegacyProject = { ...legacy };

  // Frame images on each part
  if (Array.isArray(legacy.parts)) {
    const newParts: LegacyPart[] = [];
    for (const part of legacy.parts) {
      const np: LegacyPart = { ...part };
      if (part.startingFrameImage?.b64Json && !part.startingFrameImage.objectPath) {
        const ref = await uploadInlineImage(
          part.startingFrameImage.b64Json,
          part.startingFrameImage.mimeType ?? "image/png",
          `${hintTitle}-p${part.partNumber}-start`,
        );
        np.startingFrameImage = {
          ...part.startingFrameImage,
          objectPath: ref.objectPath,
          mimeType: ref.mimeType,
          b64Json: undefined,
        };
      }
      if (part.endingFrameImage?.b64Json && !part.endingFrameImage.objectPath) {
        const ref = await uploadInlineImage(
          part.endingFrameImage.b64Json,
          part.endingFrameImage.mimeType ?? "image/png",
          `${hintTitle}-p${part.partNumber}-end`,
        );
        np.endingFrameImage = {
          ...part.endingFrameImage,
          objectPath: ref.objectPath,
          mimeType: ref.mimeType,
          b64Json: undefined,
        };
      }
      newParts.push(np);
    }
    out.parts = newParts;
  }

  // Character reference sheets
  if (legacy.characterImages?.items) {
    const items: Record<string, LegacyImage> = {};
    for (const [name, img] of Object.entries(legacy.characterImages.items)) {
      if (img.b64Json && !img.objectPath) {
        const ref = await uploadInlineImage(
          img.b64Json,
          img.mimeType ?? "image/png",
          `${hintTitle}-char-${name}`,
        );
        items[name] = { objectPath: ref.objectPath, mimeType: ref.mimeType };
      } else {
        items[name] = img;
      }
    }
    out.characterImages = {
      ...legacy.characterImages,
      items,
    };
  }

  // User reference image uploads
  if (Array.isArray(legacy.referenceImages)) {
    const newRefs = [];
    for (const r of legacy.referenceImages) {
      if (r.b64Json && !r.objectPath) {
        const ref = await uploadInlineImage(
          r.b64Json,
          r.mimeType ?? "image/png",
          `${hintTitle}-ref-${r.name ?? "upload"}`,
        );
        newRefs.push({
          ...r,
          objectPath: ref.objectPath,
          mimeType: ref.mimeType,
          b64Json: undefined,
        });
      } else {
        newRefs.push(r);
      }
    }
    out.referenceImages = newRefs;
  }

  return out;
}

async function putProjectToServer(project: LegacyProject): Promise<void> {
  const id = project.id;
  if (!id) throw new Error("Project has no id");
  const res = await apiFetch(
    `${apiBasePrefix()}/api/projects/${encodeURIComponent(id)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(project),
    },
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`PUT /projects/${id} failed: ${res.status} — ${body.slice(0, 200)}`);
  }
}

export interface MigrationResult {
  attempted: number;
  migrated: number;
  failed: number;
  alreadyDone: boolean;
}

/**
 * Public entry point. Idempotent: a sentinel key is set on first
 * successful pass so subsequent calls bail out instantly, even if the
 * user signs out and back in. Returns a result object for the caller
 * to surface as a toast / debug log.
 *
 * IMPORTANT: callers MUST be authenticated before invoking this — the
 * upload + put endpoints are session-gated. Suggested call site is
 * right after `signIn` / `signUp` resolves with `{ ok: true }`.
 */
export async function migrateLegacyLocalProjects(): Promise<MigrationResult> {
  if (typeof window === "undefined") {
    return { attempted: 0, migrated: 0, failed: 0, alreadyDone: true };
  }
  if (localStorage.getItem(MIGRATION_DONE_KEY)) {
    return { attempted: 0, migrated: 0, failed: 0, alreadyDone: true };
  }
  const raw = localStorage.getItem(LEGACY_KEY);
  if (!raw) {
    // No legacy data — record completion so we don't keep checking.
    localStorage.setItem(MIGRATION_DONE_KEY, new Date().toISOString());
    return { attempted: 0, migrated: 0, failed: 0, alreadyDone: false };
  }

  let legacy: LegacyProject[] = [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) legacy = parsed as LegacyProject[];
  } catch {
    // Corrupt cs_projects — treat as nothing to migrate, but mark done.
    localStorage.removeItem(LEGACY_KEY);
    localStorage.setItem(MIGRATION_DONE_KEY, new Date().toISOString());
    return { attempted: 0, migrated: 0, failed: 0, alreadyDone: false };
  }

  let migrated = 0;
  let failed = 0;
  for (const proj of legacy) {
    if (!proj?.id) {
      failed += 1;
      continue;
    }
    try {
      const rewritten = await rewriteProjectImages(proj, proj.title ?? proj.id);
      await putProjectToServer(rewritten);
      migrated += 1;
    } catch (err) {
      failed += 1;
      // eslint-disable-next-line no-console
      console.warn(`[migration] project ${proj.id} failed`, err);
    }
  }

  // Only clear the legacy bucket and mark migration done on a clean pass.
  // If any project failed, leave BOTH the legacy bucket and the sentinel
  // unset so the next sign-in retries the failures from scratch.
  if (failed === 0) {
    localStorage.removeItem(LEGACY_KEY);
    localStorage.setItem(MIGRATION_DONE_KEY, new Date().toISOString());
  }

  return { attempted: legacy.length, migrated, failed, alreadyDone: false };
}

/** Reset the migration sentinel — useful for manual replays in dev tools. */
export function resetMigrationSentinel(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(MIGRATION_DONE_KEY);
}
