import { Router, type IRouter, type Request, type Response } from "express";
import { Readable } from "stream";
import {
  RequestUploadUrlBody,
  RequestUploadUrlResponse,
} from "@workspace/api-zod";
import {
  ObjectStorageService,
  ObjectNotFoundError,
} from "../lib/objectStorage";
import {
  isObjectStorageAuthError,
  objectPathToLocalId,
  openLocalImageStream,
} from "../lib/localImageStore";
import { requireAuth } from "../middleware/auth";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

/**
 * POST /storage/uploads/request-url
 *
 * Request a presigned URL for file upload.
 * The client sends JSON metadata (name, size, contentType) — NOT the file.
 * Then uploads the file directly to the returned presigned URL.
 *
 * Gated by `requireAuth` so anonymous callers can't burn presigned URLs.
 */
router.post("/storage/uploads/request-url", requireAuth, async (req: Request, res: Response) => {
  const parsed = RequestUploadUrlBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Missing or invalid required fields" });
    return;
  }

  try {
    const { name, size, contentType } = parsed.data;

    const uploadURL = await objectStorageService.getObjectEntityUploadURL();
    const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);

    res.json(
      RequestUploadUrlResponse.parse({
        uploadURL,
        objectPath,
        metadata: { name, size, contentType },
      }),
    );
  } catch (error) {
    req.log.error({ err: error }, "Error generating upload URL");
    res.status(500).json({ error: "Failed to generate upload URL" });
  }
});

/**
 * GET /storage/public-objects/*
 *
 * Serve public assets from PUBLIC_OBJECT_SEARCH_PATHS.
 * These are unconditionally public — no authentication or ACL checks.
 * IMPORTANT: Always provide this endpoint when object storage is set up.
 */
router.get("/storage/public-objects/*filePath", async (req: Request, res: Response) => {
  try {
    const raw = req.params.filePath;
    const filePath = Array.isArray(raw) ? raw.join("/") : raw;
    const file = await objectStorageService.searchPublicObject(filePath);
    if (!file) {
      res.status(404).json({ error: "File not found" });
      return;
    }

    const response = await objectStorageService.downloadObject(file);

    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));

    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    req.log.error({ err: error }, "Error serving public object");
    res.status(500).json({ error: "Failed to serve public object" });
  }
});

/**
 * GET /storage/objects/*
 *
 * Serve object entities from PRIVATE_OBJECT_DIR.
 *
 * No auth required: object paths are unguessable UUIDs generated server-side
 * by `getObjectEntityUploadURL`, so possessing the path is the access token.
 * This allows <img src> tags in the browser to load images without needing
 * custom Authorization headers.
 *
 * Implementation: redirect (302) to a short-lived signed GCS URL so the
 * browser fetches bytes directly from Google's CDN. Streaming through
 * Node was costing 5+ seconds per ~1.5MB image (3 sequential GCS round
 * trips for exists/metadata/ACL plus the byte proxy). The redirect cuts
 * that to a single sign call (~50-200ms) plus a direct browser→GCS
 * download.
 */
router.get("/storage/objects/*path", async (req: Request, res: Response) => {
  const raw = req.params.path;
  const wildcardPath = Array.isArray(raw) ? raw.join("/") : raw;
  const objectPath = `/objects/${wildcardPath}`;

  // Stream bytes out of the local-disk fallback store. Returns true iff
  // the response was started/finished here.
  const tryServeLocal = async (): Promise<boolean> => {
    const id = objectPathToLocalId(objectPath);
    if (!id) return false;
    const local = await openLocalImageStream(id);
    if (!local) return false;
    res.setHeader("Content-Type", local.mimeType);
    res.setHeader("Content-Length", String(local.size));
    // Defense-in-depth: never let the browser sniff an unexpected type.
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "private, max-age=3000");
    local.stream.on("error", (err) => {
      req.log.error({ err, objectPath }, "Local-disk stream errored mid-response");
      if (!res.headersSent) res.status(500).end();
      else res.destroy(err);
    });
    local.stream.pipe(res);
    return true;
  };

  // CHECK LOCAL DISK FIRST.
  //
  // Why this order matters: `getObjectEntitySignedDownloadURL` has a
  // fast-path for `uploads/*` paths that signs WITHOUT confirming the
  // object exists in GCS. If we asked GCS first, an object that was
  // saved to local disk during a prior sidecar outage would happily
  // get a 302 to a GCS URL that returns 404 in the browser.
  //
  // Doing a cheap fs.stat() up front guarantees local-only objects
  // always serve correctly, and adds ~1ms to GCS-only requests
  // (which is negligible compared to the GCS sign call itself).
  try {
    if (await tryServeLocal()) return;
  } catch (localErr) {
    req.log.error({ err: localErr, objectPath }, "Local-disk probe failed");
  }

  try {
    const signedUrl =
      await objectStorageService.getObjectEntitySignedDownloadURL(objectPath);

    // 302 with a Cache-Control on the redirect itself so the browser keeps
    // re-using the same signed URL while it is valid (signed URL TTL is
    // 1h by default; we cap the redirect at 50min so the browser never
    // hands out an expired signed URL).
    res.setHeader("Cache-Control", "private, max-age=3000");
    res.redirect(302, signedUrl);
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      // Local probe already returned false above — this is a genuine miss.
      req.log.warn({ objectPath }, "Object not found in GCS or local store");
      res.status(404).json({ error: "Object not found" });
      return;
    }
    if (isObjectStorageAuthError(error)) {
      // Sidecar refused signing AND the object isn't on local disk.
      req.log.error(
        { err: error, objectPath },
        "Object Storage auth failed and no local-disk fallback for this object",
      );
      res.status(503).json({
        error: "Object storage temporarily unavailable",
      });
      return;
    }
    req.log.error({ err: error, objectPath }, "Error serving object");
    res.status(500).json({ error: "Failed to serve object" });
  }
});

export default router;
