/**
 * Image generation client.
 *
 * NOTE on naming: this module lives inside `@workspace/integrations-gemini-ai`
 * for historical reasons (callers used to hit Google's Nano Banana 2 /
 * Imagen 4 directly). The active backend is now Magnific's hosted
 * Nano Banana Pro (Google's `gemini-3-pro-image-preview` model served
 * via the Magnific / Freepik gateway), so all image generation funnels
 * through a single API key (`FREEPIK_API_KEY`) and a single REST host.
 *
 * The exported function names and shapes are unchanged so every existing
 * caller (`generateImage`, `generateImageBest`, `generateImagen4`)
 * compiles without edits.
 *
 * The `ai` (`GoogleGenAI`) export is retained because non-image code
 * paths still use it for Gemini text/vision (e.g. the QC route in
 * `routes/images/index.ts` calls `gemini-2.5-flash` for visual scoring).
 * That client is now constructed lazily so missing Google credentials
 * no longer break server boot — they only fail when the QC route is
 * actually invoked.
 */

import { GoogleGenAI } from "@google/genai";

const MAGNIFIC_BASE_URL =
  process.env.MAGNIFIC_BASE_URL ?? "https://api.magnific.com/v1/ai";

/**
 * Lazy GoogleGenAI client used ONLY by Gemini text/vision callers (e.g.
 * QC scoring). Image generation no longer goes through Google direct.
 *
 * The proxy/direct fallback is preserved for backward compatibility:
 * any deployment that already had GOOGLE_GENAI_API_KEY or the Replit
 * AI proxy variables set continues to work for QC.
 */
class LazyGoogleGenAI {
  private _client: GoogleGenAI | null = null;

  private build(): GoogleGenAI {
    const directKey = process.env.GOOGLE_GENAI_API_KEY;
    const proxyKey = process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
    const proxyBase = process.env.AI_INTEGRATIONS_GEMINI_BASE_URL;
    if (!directKey && !(proxyKey && proxyBase)) {
      throw new Error(
        "Gemini text/vision client is not configured. Set GOOGLE_GENAI_API_KEY " +
          "or AI_INTEGRATIONS_GEMINI_API_KEY + AI_INTEGRATIONS_GEMINI_BASE_URL. " +
          "(Image generation no longer uses this client — it goes through Magnific.)",
      );
    }
    return directKey
      ? new GoogleGenAI({ apiKey: directKey })
      : new GoogleGenAI({
          apiKey: proxyKey!,
          httpOptions: { apiVersion: "", baseUrl: proxyBase! },
        });
  }

  get models(): GoogleGenAI["models"] {
    if (!this._client) this._client = this.build();
    return this._client.models;
  }

  get files(): GoogleGenAI["files"] {
    if (!this._client) this._client = this.build();
    return this._client.files;
  }

  get operations(): GoogleGenAI["operations"] {
    if (!this._client) this._client = this.build();
    return this._client.operations;
  }
}

export const ai = new LazyGoogleGenAI() as unknown as GoogleGenAI;

/**
 * Active image-generation model nickname. Magnific exposes two Nano
 * Banana Pro variants:
 *   - `nano-banana-pro`       → Gemini 3 Pro Image, 2K default,
 *                                higher fidelity, slower (~25-60s).
 *   - `nano-banana-pro-flash` → Gemini 3.1 Flash Image, optimised for
 *                                speed (~5-15s) and cost.
 * Default is the flash variant since most callers (storyboard frames,
 * cinema thumbnails) are latency-sensitive. Override per-deploy via
 * MAGNIFIC_IMAGE_MODEL.
 */
const MAGNIFIC_IMAGE_MODEL =
  process.env.MAGNIFIC_IMAGE_MODEL ?? "nano-banana-pro-flash";

/** Backward-compat constant — some callers still log this. */
export const GEMINI_IMAGE_MODEL = MAGNIFIC_IMAGE_MODEL;

export interface ReferenceImageInput {
  /** Base64-encoded bytes (no data URL prefix). */
  b64Json: string;
  mimeType: string;
}

/**
 * Aspect ratios accepted by Magnific Nano Banana Pro. Matches the
 * `aspect_ratio` enum in the Magnific REST schema. Note Magnific does
 * NOT publicly support 1:4 / 4:1 / 1:8 / 8:1 — the four extreme ratios
 * the old Nano Banana 2 supported are silently mapped to the closest
 * supported ratio (16:9 / 9:16) at the call site.
 */
export type GenerateImageAspectRatio =
  | "1:1"
  | "2:3"
  | "3:2"
  | "3:4"
  | "4:3"
  | "4:5"
  | "5:4"
  | "9:16"
  | "16:9"
  | "21:9"
  | "1:4"
  | "4:1"
  | "1:8"
  | "8:1";

const MAGNIFIC_SUPPORTED_RATIOS = new Set<string>([
  "1:1",
  "2:3",
  "3:2",
  "3:4",
  "4:3",
  "4:5",
  "5:4",
  "9:16",
  "16:9",
  "21:9",
]);

function mapToMagnificRatio(requested?: string): string | undefined {
  if (!requested) return undefined;
  if (MAGNIFIC_SUPPORTED_RATIOS.has(requested)) return requested;
  // Map ultrawide/ultratall to the closest supported ratio.
  switch (requested) {
    case "4:1":
    case "8:1":
      return "21:9";
    case "1:4":
    case "1:8":
      return "9:16";
    default:
      return "16:9";
  }
}

export interface GenerateImageOptions {
  /** Reference images injected before the text prompt to anchor the look. */
  referenceImages?: ReferenceImageInput[];
  /** Target aspect ratio. Defaults to model default (1:1) when omitted. */
  aspectRatio?: GenerateImageAspectRatio;
}

interface MagnificImageResponse {
  data?: {
    task_id?: string;
    status?: string;
    generated?: string[];
  };
}

function magnificKey(): string {
  const k = process.env.FREEPIK_API_KEY;
  if (!k) {
    throw new Error(
      "FREEPIK_API_KEY is not set — image generation requires a Magnific " +
        "(Freepik) API key. Set FREEPIK_API_KEY to your Magnific key.",
    );
  }
  return k;
}

function magnificHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const k = magnificKey();
  return {
    "x-magnific-api-key": k,
    "x-freepik-api-key": k,
    ...extra,
  };
}

async function safeJson(res: Response): Promise<unknown> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const POLL_INTERVAL_MS = 4_000;
const MAX_WAIT_MS = 5 * 60 * 1000; // 5 min — Nano Banana Pro is fast.

/**
 * Generate a single image via Magnific Nano Banana Pro (Gemini 3 Pro
 * / 3.1 Flash, depending on MAGNIFIC_IMAGE_MODEL). Reference images
 * are uploaded inline via data URLs so the caller doesn't need a public
 * URL upload pipeline.
 *
 * Returns base64 PNG bytes + the original mime type, matching the old
 * Google-direct contract.
 */
export async function generateImage(
  prompt: string,
  referenceImagesOrOptions?: ReferenceImageInput[] | GenerateImageOptions,
  legacyAspectRatio?: GenerateImageAspectRatio,
): Promise<{ b64_json: string; mimeType: string }> {
  const opts: GenerateImageOptions = Array.isArray(referenceImagesOrOptions)
    ? { referenceImages: referenceImagesOrOptions, aspectRatio: legacyAspectRatio }
    : referenceImagesOrOptions ?? {};
  const { referenceImages, aspectRatio } = opts;

  const body: Record<string, unknown> = {
    prompt,
    resolution: process.env.MAGNIFIC_IMAGE_RESOLUTION ?? "2K",
  };
  const aspect = mapToMagnificRatio(aspectRatio);
  if (aspect) body.aspect_ratio = aspect;

  // Magnific NB Pro accepts up to 3 reference images, each as either
  // a public URL or a data URL. We pass data URLs so callers can
  // continue to ship inline base64 (the existing API contract).
  if (referenceImages && referenceImages.length > 0) {
    const refs = referenceImages
      .filter((r) => r && typeof r.b64Json === "string" && r.b64Json.length > 0)
      .slice(0, 3)
      .map((r) => ({
        image: `data:${r.mimeType || "image/png"};base64,${r.b64Json}`,
        mime_type: r.mimeType || "image/png",
      }));
    if (refs.length > 0) body.reference_images = refs;
  }

  const slug = `text-to-image/${MAGNIFIC_IMAGE_MODEL}`;
  const createUrl = `${MAGNIFIC_BASE_URL}/${slug}`;
  const createRes = await fetch(createUrl, {
    method: "POST",
    headers: magnificHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  const createBody = (await safeJson(createRes)) as MagnificImageResponse;
  if (!createRes.ok) {
    throw new Error(
      `Magnific image create-task failed (HTTP ${createRes.status}): ${JSON.stringify(createBody)}`,
    );
  }
  const taskId = createBody.data?.task_id;
  if (!taskId) {
    throw new Error(
      `Magnific image create-task returned no task_id: ${JSON.stringify(createBody)}`,
    );
  }

  // Poll until the asset is ready, then download the PNG.
  const pollUrl = `${createUrl}/${taskId}`;
  const startedAt = Date.now();
  let imageUrl: string | undefined;
  while (true) {
    if (Date.now() - startedAt > MAX_WAIT_MS) {
      throw new Error(
        `Magnific image task ${taskId} timed out after ${MAX_WAIT_MS / 1000}s`,
      );
    }
    await sleep(POLL_INTERVAL_MS);
    const pollRes = await fetch(pollUrl, { headers: magnificHeaders() });
    const pollBody = (await safeJson(pollRes)) as MagnificImageResponse;
    if (!pollRes.ok) {
      // Transient — try again next tick.
      continue;
    }
    const status = (pollBody.data?.status ?? "").toUpperCase();
    if (status === "COMPLETED") {
      imageUrl = pollBody.data?.generated?.[0];
      if (!imageUrl) {
        throw new Error(
          `Magnific image task ${taskId} completed with no asset URL`,
        );
      }
      break;
    }
    if (status === "FAILED" || status === "CANCELED") {
      throw new Error(
        `Magnific image task ${taskId} reported ${status}: ${JSON.stringify(pollBody)}`,
      );
    }
  }

  const dlRes = await fetch(imageUrl);
  if (!dlRes.ok) {
    throw new Error(
      `Magnific image download failed (HTTP ${dlRes.status}) for ${imageUrl}`,
    );
  }
  const buf = Buffer.from(await dlRes.arrayBuffer());
  const mimeType = dlRes.headers.get("content-type") ?? "image/png";
  return { b64_json: buf.toString("base64"), mimeType };
}

/**
 * @deprecated Quarantined legacy export. ContentStudio AI no longer
 * calls Imagen 4 anywhere — every image-generation path now funnels
 * through Magnific Nano Banana Pro. This thin shim forwards to
 * `generateImage` so any leftover external caller keeps compiling.
 */
export async function generateImagen4(
  prompt: string,
  opts: { aspectRatio?: string } = {},
): Promise<{ b64_json: string; mimeType: string }> {
  const aspectRatio = (opts.aspectRatio ?? "16:9") as GenerateImageAspectRatio;
  return generateImage(prompt, { aspectRatio });
}

/**
 * Smart router for Cinema Studio and the images endpoint. Identical
 * surface to the old export; backend is now Magnific Nano Banana Pro.
 *
 * The `engine` field is preserved for backward compatibility with
 * callers that log/route on it. It is now always `"nano-banana-2"`
 * (the Magnific endpoint slug is `nano-banana-pro` / `-flash`, but
 * downstream UI and analytics already key off this string — keeping
 * it stable avoids churning unrelated code).
 */
export async function generateImageBest(
  prompt: string,
  opts: GenerateImageOptions & { forceGeminiFlash?: boolean } = {},
): Promise<{ b64_json: string; mimeType: string; engine: "nano-banana-2" }> {
  const result = await generateImage(prompt, opts);
  return { ...result, engine: "nano-banana-2" };
}
