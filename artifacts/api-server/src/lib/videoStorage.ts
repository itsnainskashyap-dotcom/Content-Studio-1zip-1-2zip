/**
 * Helpers for streaming generated video bytes (mp4 chunks, final mp4,
 * thumbnail PNGs) into Replit Object Storage. Mirrors `imageStorage`
 * but uploads from a local file path instead of base64 (FFmpeg writes
 * to disk first; we then push the resulting file into GCS).
 *
 * Local-disk fallback: when the Replit Object Storage sidecar refuses to
 * mint a token (returns `401 "no allowed resources"`), GCS save fails
 * with the misleading `Error code undefined`. In that case we transparently
 * persist the bytes under `<api-server>/.local-image-store/uploads/<id>`
 * so the rest of the pipeline (`/objects/uploads/<id>` paths, downstream
 * downloads) keeps working through the infra outage.
 */

import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  readFile,
  writeFile,
  unlink,
  mkdtemp,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
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

/** Upload a buffer (mp4 / png / etc) and return /objects/uploads/<id>. */
export async function saveBufferToObjectStorage(
  buf: Buffer,
  contentType: string,
): Promise<{ objectPath: string }> {
  const id = randomUUID();
  try {
    const dir = objectStorageService.getPrivateObjectDir();
    const fullPath = `${dir.replace(/\/$/, "")}/uploads/${id}`;
    const { bucketName, objectName } = parseBucketAndObject(fullPath);
    const file = objectStorageClient.bucket(bucketName).file(objectName);
    await file.save(buf, {
      contentType,
      resumable: false,
      metadata: { contentType },
    });
  } catch (err) {
    if (isObjectStorageAuthError(err)) {
      logger.warn(
        { id, mime: contentType, bytes: buf.length },
        "Object Storage sidecar refused token; saving video buffer to local-disk fallback",
      );
    } else {
      logger.warn(
        {
          id,
          mime: contentType,
          bytes: buf.length,
          err: (err as Error).message,
        },
        "Object Storage save failed; saving video buffer to local-disk fallback",
      );
    }
    await saveLocalImage(id, buf, contentType);
  }
  return { objectPath: `/objects/uploads/${id}` };
}

/** Upload from a local file path. Streams instead of buffering into memory. */
export async function saveFileToObjectStorage(
  localPath: string,
  contentType: string,
): Promise<{ objectPath: string }> {
  const id = randomUUID();
  try {
    const dir = objectStorageService.getPrivateObjectDir();
    const fullPath = `${dir.replace(/\/$/, "")}/uploads/${id}`;
    const { bucketName, objectName } = parseBucketAndObject(fullPath);
    const file = objectStorageClient.bucket(bucketName).file(objectName);

    await new Promise<void>((resolve, reject) => {
      const upload = file.createWriteStream({
        contentType,
        resumable: false,
        metadata: { contentType },
      });
      const source = createReadStream(localPath);
      const cleanup = () => {
        source.removeAllListeners("error");
        upload.removeAllListeners("error");
        upload.removeAllListeners("finish");
      };
      // Source-stream errors must tear down the upload stream and reject —
      // otherwise we'd hang forever on a half-piped file read failure.
      source.once("error", (err) => {
        cleanup();
        upload.destroy(err);
        reject(err);
      });
      upload.once("error", (err) => {
        cleanup();
        source.destroy();
        reject(err);
      });
      upload.once("finish", () => {
        cleanup();
        resolve();
      });
      source.pipe(upload);
    });
  } catch (err) {
    if (isObjectStorageAuthError(err)) {
      logger.warn(
        { id, mime: contentType, src: localPath },
        "Object Storage sidecar refused token; saving file to local-disk fallback",
      );
    } else {
      logger.warn(
        {
          id,
          mime: contentType,
          src: localPath,
          err: (err as Error).message,
        },
        "Object Storage save failed; saving file to local-disk fallback",
      );
    }
    const buf = await readFile(localPath);
    await saveLocalImage(id, buf, contentType);
  }
  return { objectPath: `/objects/uploads/${id}` };
}

/** Download an object to a local temp file and return its path. */
export async function downloadObjectToTempFile(
  objectPath: string,
  filenameHint: string,
): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "video-studio-"));
  const filePath = path.join(dir, filenameHint);

  try {
    const file = await objectStorageService.getObjectEntityFile(objectPath);
    const [bytes] = await file.download();
    await writeFile(filePath, bytes);
    return filePath;
  } catch (err) {
    if (
      err instanceof ObjectNotFoundError ||
      isObjectStorageAuthError(err)
    ) {
      const id = objectPathToLocalId(objectPath);
      if (id) {
        const local = await loadLocalImage(id);
        if (local) {
          await writeFile(filePath, local.bytes);
          return filePath;
        }
      }
    }
    throw err;
  }
}

/** Convenience: load any persisted object back as base64 + mime type. */
export async function loadObjectAsBase64(
  objectPath: string,
): Promise<{ b64: string; mimeType: string }> {
  try {
    const file = await objectStorageService.getObjectEntityFile(objectPath);
    const [bytes] = await file.download();
    const [meta] = await file.getMetadata();
    return {
      b64: bytes.toString("base64"),
      mimeType: (meta.contentType as string | undefined) ?? "video/mp4",
    };
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
            b64: local.bytes.toString("base64"),
            mimeType: local.mimeType || "video/mp4",
          };
        }
      }
    }
    throw err;
  }
}

/** Best-effort temp file cleanup that never throws. */
export async function safeUnlink(p: string): Promise<void> {
  try {
    await unlink(p);
  } catch {
    /* ignore */
  }
}

export async function safeReadFile(p: string): Promise<Buffer | null> {
  try {
    return await readFile(p);
  } catch {
    return null;
  }
}
