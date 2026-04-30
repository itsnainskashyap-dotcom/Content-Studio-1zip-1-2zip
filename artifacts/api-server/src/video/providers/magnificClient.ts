/**
 * Shared HTTP client for the Magnific (formerly Freepik) AI API.
 *
 * Centralises:
 *   - base URL (api.magnific.com — old api.freepik.com host still works
 *     during the 6-month deprecation window, but we standardise on the
 *     new canonical host so deprecation headers don't poison logs)
 *   - auth header (sends BOTH x-magnific-api-key and the legacy
 *     x-freepik-api-key so we transparently work whether the upstream
 *     gateway has fully cut over yet or not)
 *   - async task pattern: POST /v1/ai/<slug> returns { task_id, status,
 *     generated[] }; we then GET /v1/ai/<slug>/<task_id> until status
 *     is COMPLETED / FAILED / CANCELED.
 *
 * One reusable {@link createTaskAndPoll} covers every Magnific endpoint
 * the app uses (Nano Banana Pro images, Veo 3.1 image-to-video,
 * Seedance image-to-video). Anything that needs a different polling
 * cadence or timeout passes options.
 */

import { logger } from "../../lib/logger";

/**
 * Canonical Magnific base URL. Set MAGNIFIC_BASE_URL to override (for
 * example to keep using the legacy api.freepik.com host during a
 * gradual migration, or to point at a staging gateway).
 */
const BASE_URL =
  process.env.MAGNIFIC_BASE_URL ?? "https://api.magnific.com/v1/ai";

export interface MagnificCreateResponse {
  data?: {
    task_id?: string;
    status?: string;
    generated?: string[];
  };
  task_id?: string;
  status?: string;
  generated?: string[];
}

export interface MagnificPollResponse extends MagnificCreateResponse {}

export interface CreateTaskAndPollOptions {
  /** Per-request poll cadence. Defaults to 8s. */
  pollIntervalMs?: number;
  /** Hard timeout for the whole job. Defaults to 12 minutes. */
  maxWaitMs?: number;
  /** Tag for log lines so multiple concurrent jobs are distinguishable. */
  label?: string;
}

export interface CreateTaskAndPollResult {
  taskId: string;
  /** Raw URLs returned by Magnific (typically a single MP4 / PNG URL). */
  generated: string[];
}

function apiKey(): string {
  const k = process.env.FREEPIK_API_KEY;
  if (!k) {
    throw new Error(
      "FREEPIK_API_KEY is not set — Magnific (Freepik) image and video " +
        "generation requires an API key. Set FREEPIK_API_KEY to your " +
        "Magnific / Freepik key (the same key works on both hosts).",
    );
  }
  return k;
}

/** Headers used for every Magnific request. Sends both auth header
 *  variants so the request works against the new and legacy gateway. */
function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const k = apiKey();
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

/**
 * Submit a Magnific async task and poll until it's COMPLETED.
 *
 * @param slug   Path under /v1/ai, e.g. "image-to-video/veo-3-1" or
 *               "text-to-image/nano-banana-pro". The same slug is used
 *               for both POST (create) and GET (poll by id).
 * @param body   JSON request body specific to the endpoint.
 */
export async function createTaskAndPoll(
  slug: string,
  body: Record<string, unknown>,
  opts: CreateTaskAndPollOptions = {},
): Promise<CreateTaskAndPollResult> {
  const pollIntervalMs = opts.pollIntervalMs ?? 8_000;
  const maxWaitMs = opts.maxWaitMs ?? 12 * 60 * 1000;
  const label = opts.label ?? slug;

  const createUrl = `${BASE_URL}/${slug}`;
  const createRes = await fetch(createUrl, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  const createBody = (await safeJson(createRes)) as MagnificCreateResponse;
  if (!createRes.ok) {
    throw new Error(
      `Magnific ${label} create-task failed (HTTP ${createRes.status}): ${JSON.stringify(createBody)}`,
    );
  }
  const taskId = createBody.data?.task_id ?? createBody.task_id;
  if (!taskId) {
    throw new Error(
      `Magnific ${label} create-task returned no task_id: ${JSON.stringify(createBody)}`,
    );
  }
  logger.info({ label, taskId }, "Magnific task created");

  const pollUrl = `${createUrl}/${taskId}`;
  const startedAt = Date.now();
  while (true) {
    if (Date.now() - startedAt > maxWaitMs) {
      throw new Error(
        `Magnific ${label} task ${taskId} timed out after ${maxWaitMs / 1000}s`,
      );
    }
    await sleep(pollIntervalMs);

    let pollRes: Response;
    try {
      pollRes = await fetch(pollUrl, { headers: authHeaders() });
    } catch (err) {
      logger.warn({ label, taskId, err }, "Magnific poll fetch error; retrying");
      continue;
    }
    const pollBody = (await safeJson(pollRes)) as MagnificPollResponse;
    if (!pollRes.ok) {
      // Terminal HTTP errors should fail fast — wasting 12 minutes on a
      // bad key (401/403), missing task (404) or schema rejection
      // (400/422) hides the real cause and burns wall-clock budget.
      // Only true transient classes (408 timeout, 425 too early, 429
      // rate limit, and 5xx) get retried until maxWaitMs.
      const transient =
        pollRes.status === 408 ||
        pollRes.status === 425 ||
        pollRes.status === 429 ||
        pollRes.status >= 500;
      if (!transient) {
        throw new Error(
          `Magnific ${label} poll failed (HTTP ${pollRes.status}) for task ${taskId}: ${JSON.stringify(pollBody)}`,
        );
      }
      logger.warn(
        { label, taskId, status: pollRes.status, body: pollBody },
        "Magnific poll transient non-OK; retrying",
      );
      continue;
    }
    const status = (pollBody.data?.status ?? pollBody.status ?? "")
      .toString()
      .toUpperCase();
    if (status === "COMPLETED") {
      const generated = pollBody.data?.generated ?? pollBody.generated ?? [];
      if (generated.length === 0) {
        throw new Error(
          `Magnific ${label} task ${taskId} completed with no generated assets`,
        );
      }
      return { taskId, generated };
    }
    if (status === "FAILED" || status === "CANCELED") {
      throw new Error(
        `Magnific ${label} task ${taskId} reported ${status}: ${JSON.stringify(pollBody)}`,
      );
    }
    // CREATED / IN_PROGRESS / PROCESSING — keep polling.
  }
}

/**
 * Download a Magnific output URL into a Buffer. Used for both image
 * (PNG) and video (MP4) outputs. Throws on non-2xx.
 */
export async function downloadMagnificAsset(url: string): Promise<{
  buffer: Buffer;
  contentType: string;
}> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `Magnific asset download failed (HTTP ${res.status}) for ${url}`,
    );
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const contentType = res.headers.get("content-type") ?? "application/octet-stream";
  return { buffer: buf, contentType };
}
