import { randomUUID } from "crypto";
import {
  objectStorageClient,
  ObjectStorageService,
  ObjectNotFoundError,
} from "./objectStorage";
import {
  isObjectStorageAuthError,
  loadLocalImage,
  objectPathToLocalId,
  saveLocalImage,
} from "./localImageStore";
import { logger } from "./logger";

/**
 * Helpers that bridge our AI image-generation pipeline with Replit Object
 * Storage. The flow is:
 *
 *  1. Gemini returns base64 image bytes server-side.
 *  2. We upload them directly into the bucket (no presigned-URL round trip
 *     needed — the server already has both the bytes and bucket creds).
 *  3. We hand the client back the normalized `/objects/<id>` path. The
 *     client serves the image from `GET /api/storage/objects/<id>` and
 *     stores ONLY the path in its project state — never the bytes.
 *
 * Going through Object Storage instead of inlining base64 in JSON solves
 * the localStorage quota explosion users were hitting once they had a
 * handful of generated frames + character sheets (~1.5 MB each).
 *
 * Local-disk fallback:
 *   When the Replit Object Storage sidecar can't mint a token (sidecar
 *   returns `401 "no allowed resources"`), GCS save fails with the
 *   misleading message `Error code undefined`. To keep image generation
 *   working through that infra outage, we transparently fall back to a
 *   local-disk store under `<api-server>/.local-image-store/uploads/`.
 *   The same `/objects/uploads/<id>` path scheme is preserved so the
 *   frontend doesn't need to know which backend served the bytes; the
 *   `/api/storage/objects/*` route checks both stores on serve.
 */

const objectStorageService = new ObjectStorageService();

function parseBucketAndObject(fullPath: string): {
  bucketName: string;
  objectName: string;
} {
  let p = fullPath;
  if (!p.startsWith("/")) p = `/${p}`;
  const parts = p.split("/");
  if (parts.length < 3) {
    throw new Error(`Invalid object path: ${fullPath}`);
  }
  const bucketName = parts[1] as string;
  const objectName = parts.slice(2).join("/");
  return { bucketName, objectName };
}

/**
 * Save a base64-encoded image. Tries Replit Object Storage first; on auth
 * errors from the sidecar (or any GCS failure), falls back to a local-disk
 * store keyed by the same UUID. Either way the returned path is
 * `/objects/uploads/<id>` and the serve route resolves it from whichever
 * backend has the bytes.
 */
export async function saveBase64Image(
  b64: string,
  mimeType: string,
): Promise<{ objectPath: string }> {
  const buf = Buffer.from(b64, "base64");
  const id = randomUUID();

  let usedFallback = false;
  try {
    const dir = objectStorageService.getPrivateObjectDir();
    const fullPath = `${dir.replace(/\/$/, "")}/uploads/${id}`;
    const { bucketName, objectName } = parseBucketAndObject(fullPath);
    const file = objectStorageClient.bucket(bucketName).file(objectName);
    await file.save(buf, {
      contentType: mimeType,
      resumable: false,
      metadata: { contentType: mimeType },
    });
  } catch (err) {
    usedFallback = true;
    if (isObjectStorageAuthError(err)) {
      logger.warn(
        { id, mime: mimeType, bytes: buf.length },
        "Object Storage sidecar refused token; saving image to local-disk fallback",
      );
    } else {
      logger.warn(
        {
          id,
          mime: mimeType,
          bytes: buf.length,
          err: (err as Error).message,
        },
        "Object Storage save failed; saving image to local-disk fallback",
      );
    }
    await saveLocalImage(id, buf, mimeType);
  }

  if (usedFallback) {
    // Note: success on the fallback path is still a success. Keeping the
    // log at debug level so the warn above is the single signal.
    logger.debug({ id }, "Saved image to local-disk fallback");
  }

  // Return the SAME shape `getObjectEntityFile` expects (segments after
  // /objects/ map verbatim to the bucket layout). The bytes were written
  // under "<bucket>/uploads/<id>" (or local-disk equivalent), so the
  // public path must include the "uploads/" segment too — otherwise the
  // storage GET returns 404.
  return { objectPath: `/objects/uploads/${id}` };
}

/**
 * Load an image previously saved via `saveBase64Image` (or uploaded
 * through the presigned-URL flow) and return it as base64 + mimeType
 * suitable for forwarding to Gemini's inlineData parts.
 *
 * Tries GCS first, then falls back to the local-disk store. Throws if
 * neither backend has the bytes.
 */
export async function loadImageAsBase64(
  objectPath: string,
): Promise<{ b64Json: string; mimeType: string }> {
  try {
    const file = await objectStorageService.getObjectEntityFile(objectPath);
    const [bytes] = await file.download();
    const [meta] = await file.getMetadata();
    const mimeType =
      (meta.contentType as string | undefined) ?? "application/octet-stream";
    return { b64Json: bytes.toString("base64"), mimeType };
  } catch (err) {
    if (
      err instanceof ObjectNotFoundError ||
      isObjectStorageAuthError(err)
    ) {
      const id = objectPathToLocalId(objectPath);
      if (id) {
        const local = await loadLocalImage(id);
        if (local) {
          return {
            b64Json: local.bytes.toString("base64"),
            mimeType: local.mimeType,
          };
        }
      }
    }
    throw err;
  }
}
