import { useCallback, useState } from "react";

// Story / music / VO generations regularly take 60-150s on rich briefs
// (especially with Hinglish/Devanagari output). The video-prompts pipeline
// after the MAX_ATTEMPTS=2 reduction in `routes/ai/llm.ts` runs up to:
// 2 attempts × ~70-90s + an LLM compression-recovery pass × ~25s ≈
// 165-205s worst case. The server now also keeps the connection alive
// via `respondWithHeartbeat`, so the proxy never times out before us.
// 360s is kept as the abort ceiling so a stuck request still gets
// cancelled instead of hanging the UI forever.
const TIMEOUT_MS = 360_000;

export interface CallState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

/**
 * Detect the `{ "error": "..." }` envelope returned by the streaming
 * heartbeat helper on the API server. Once the heartbeat fires the
 * server can no longer change its HTTP status, so failures are encoded
 * as a 200 response with an `error` field. Returns the message string
 * if the envelope is present, otherwise null.
 *
 * Exported so other client wrappers (e.g. generation-context.tsx) can
 * apply the same check without duplicating the heuristic.
 */
function isMeaningfulErrorString(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (trimmed.length === 0) return false;
  // Defend against upstream payloads that literally contain the strings
  // "null" or "undefined" — these would otherwise leak into the toast and
  // reproduce the very bug this helper was added to fix.
  const lower = trimmed.toLowerCase();
  return lower !== "null" && lower !== "undefined";
}

export function extractEnvelopeError(result: unknown): string | null {
  if (!result || typeof result !== "object") return null;
  const maybe = (result as { error?: unknown }).error;
  return isMeaningfulErrorString(maybe) ? maybe : null;
}

/**
 * Extract a human-readable error message from a thrown value, regardless
 * of whether it came from:
 *   - the heartbeat envelope ({ error: "..." } at status 200)
 *   - an Orval ApiError thrown for a non-2xx response (real message lives
 *     in `err.data.error`, not `err.message` which is just "HTTP 500 ...")
 *   - a plain Error (fetch network failure, abort, etc.)
 *   - any other unknown shape
 *
 * Always returns a non-empty string so toast messages never read
 * "...: null" or "...: undefined" when a real failure happens.
 */
export function extractErrorMessage(err: unknown): string {
  if (err == null) return "Unknown error";

  // 1. Orval ApiError carries the parsed body on `.data`. Server emits
  //    `{ "error": "..." }` so check there first — it's the most useful.
  if (typeof err === "object") {
    const data = (err as { data?: unknown }).data;
    const fromData = extractEnvelopeError(data);
    if (fromData) return fromData;

    // Direct `{ error: "..." }` envelope (success-path heartbeat failure).
    const fromEnvelope = extractEnvelopeError(err);
    if (fromEnvelope) return fromEnvelope;
  }

  // 2. Any Error instance with a meaningful message.
  if (err instanceof Error && isMeaningfulErrorString(err.message)) {
    return err.message;
  }

  // 3. Plain object with a meaningful `.message`.
  if (typeof err === "object") {
    const m = (err as { message?: unknown }).message;
    if (isMeaningfulErrorString(m)) return m;
  }

  // 4. Stringified primitive (e.g. `throw "boom"`).
  if (isMeaningfulErrorString(err)) return err;

  return "Unknown error";
}

function normalizeError(err: unknown, aborted: boolean): string {
  if (aborted) return "Request timed out after 6 minutes. Please try again.";
  if (err && typeof err === "object" && "message" in err) {
    const raw = String((err as { message: unknown }).message);
    const lower = raw.toLowerCase();
    if (lower.includes("rate") && lower.includes("limit")) {
      return "Hit the AI rate limit. Please wait 30 seconds and try again.";
    }
    if (lower.includes("429")) {
      return "Too many requests right now. Please wait 30 seconds and try again.";
    }
    if (raw) return raw;
  }
  return "Something went wrong. Please try again.";
}

/**
 * Wraps an async API mutation (typically from generated react-query hooks
 * via mutateAsync, or any (args, signal) => Promise<T> function) with:
 *  - 60s AbortController timeout
 *  - normalized error messages with rate-limit text
 *  - inline retry support via an idempotent run() call.
 */
export function useApiCall<TArgs, TResult>(
  fn: (args: TArgs, signal: AbortSignal) => Promise<TResult>,
) {
  const [state, setState] = useState<CallState<TResult>>({
    data: null,
    loading: false,
    error: null,
  });

  const run = useCallback(
    async (args: TArgs): Promise<TResult | null> => {
      setState({ data: null, loading: true, error: null });
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      try {
        const result = await fn(args, controller.signal);
        clearTimeout(timer);
        // Long-running AI endpoints use a streaming heartbeat (see
        // `respondWithHeartbeat` in artifacts/api-server/src/routes/ai/index.ts).
        // Once a heartbeat byte has been written we cannot change the
        // HTTP status to 5xx, so the server emits a `{ "error": "..." }`
        // envelope at status 200 instead. Detect it here and surface it
        // as a thrown Error so callers see identical behaviour to the
        // old status-500 path.
        const envelopeError = extractEnvelopeError(result);
        if (envelopeError) throw new Error(envelopeError);
        setState({ data: result, loading: false, error: null });
        return result;
      } catch (err) {
        clearTimeout(timer);
        const message = normalizeError(err, controller.signal.aborted);
        setState({ data: null, loading: false, error: message });
        return null;
      }
    },
    [fn],
  );

  const reset = useCallback(() => {
    setState({ data: null, loading: false, error: null });
  }, []);

  const setData = useCallback((data: TResult | null) => {
    setState({ data, loading: false, error: null });
  }, []);

  return { ...state, run, reset, setData };
}

/**
 * Adapter: converts a react-query mutation hook (like useGenerateStory)
 * into a (body, signal) => Promise<TResult> function that useApiCall expects.
 *
 * The generated hooks accept a `signal` via mutationOptions; we pass it
 * through so the AbortController properly cancels in-flight requests.
 */
export function mutationCaller<TBody, TResult>(
  mutateAsync: (variables: {
    data: TBody;
    signal?: AbortSignal;
  }) => Promise<TResult>,
) {
  return (body: TBody, signal: AbortSignal) =>
    mutateAsync({ data: body, signal });
}
