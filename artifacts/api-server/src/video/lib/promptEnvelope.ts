/**
 * Pipeline prompt envelope.
 *
 * The user's hard requirement (pipeline-fix doc):
 *   "Every prompt that goes to image gen, Veo and Seedance must be a
 *    JSON-formatted string, ≤ 4500 chars (including spaces)."
 *
 * `buildJsonPrompt(spec, opts)` takes a structured object (image spec,
 * video spec, audio spec, etc.), serializes it as compact JSON with
 * STABLE key order, and enforces the 4500-char hard cap. If the
 * serialized JSON would exceed the cap, fields are dropped tail-first
 * from `dropOrder`; if it still exceeds, the longest remaining string
 * field is truncated. The function NEVER throws — it always returns a
 * usable prompt string and logs a warning when it had to shrink.
 *
 * Stable key order matters because:
 *   - downstream caching / dedupe hashes the prompt
 *   - architects / users compare prompts across runs
 *   - some video models are sensitive to field-order in prompts
 */

import { logger } from "../../lib/logger";

export const MAX_PROMPT_CHARS = 4500;

export interface BuildJsonPromptOpts {
  /** Hard cap including all whitespace. Default: 4500. */
  maxChars?: number;
  /**
   * Field names (top-level keys of `spec`) to drop tail-first when the
   * serialized JSON exceeds the cap. Earlier entries are dropped first
   * — so put LEAST-critical fields at the start of this list.
   */
  dropOrder?: string[];
  /**
   * If non-empty after dropping all `dropOrder` fields the JSON still
   * exceeds the cap, the value of this field will be truncated as a
   * last resort (suffixed with "…"). If null/undefined, the longest
   * remaining string-valued top-level field is truncated.
   */
  truncatableField?: string;
  /** Label for log messages. */
  label?: string;
}

/**
 * Sort object keys deterministically so two equivalent specs produce
 * identical JSON strings. Recurses into nested plain objects; leaves
 * arrays in their existing order (order is semantically meaningful for
 * arrays — e.g. key beats, sound effects).
 */
function stableSort<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.map(stableSort) as unknown as T;
  }
  const obj = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    sorted[key] = stableSort(obj[key]);
  }
  return sorted as unknown as T;
}

function serialize(spec: unknown): string {
  // Compact JSON (no indentation) so we waste zero chars on whitespace
  // — every byte counts toward the 4500 cap.
  return JSON.stringify(stableSort(spec));
}

/**
 * Build a JSON prompt string for any pipeline call (NB Pro, Veo,
 * Seedance). Always returns a string ≤ `maxChars`.
 */
export function buildJsonPrompt(
  spec: Record<string, unknown>,
  opts: BuildJsonPromptOpts = {},
): string {
  const cap = opts.maxChars ?? MAX_PROMPT_CHARS;
  const label = opts.label ?? "promptEnvelope";

  let working: Record<string, unknown> = { ...spec };
  let out = serialize(working);
  if (out.length <= cap) return out;

  // Phase 1 — drop optional fields tail-first.
  const dropOrder = opts.dropOrder ?? [];
  const dropped: string[] = [];
  for (const field of dropOrder) {
    if (out.length <= cap) break;
    if (field in working) {
      delete working[field];
      dropped.push(field);
      out = serialize(working);
    }
  }
  if (out.length <= cap) {
    logger.warn(
      { label, droppedFields: dropped, finalChars: out.length, cap },
      "promptEnvelope: shrunk prompt by dropping optional fields",
    );
    return out;
  }

  // Phase 2 — truncate the longest STRING-VALUED field, iteratively.
  // We never coerce a non-string field to a "[object Object]…" — that
  // would silently corrupt the spec. Instead we repeatedly shave the
  // longest string anywhere in the spec until JSON ≤ cap, OR no
  // string is long enough to shave.
  //
  // Preferred-target: if `truncatableField` is provided AND its value
  // is a string, shave that one first; otherwise we always pick the
  // longest string in the whole object tree.
  const truncatedFields: string[] = [];
  const preferred = opts.truncatableField;
  if (
    preferred &&
    preferred in working &&
    typeof working[preferred] === "string"
  ) {
    const overshoot = out.length - cap;
    const orig = working[preferred] as string;
    const newLen = Math.max(0, orig.length - overshoot - 8);
    working[preferred] = orig.slice(0, newLen) + "…";
    truncatedFields.push(preferred);
    out = serialize(working);
  }

  // Iterative shave. Bounded by string count to guarantee termination.
  const HARD_ITER_CAP = 64;
  let iters = 0;
  while (out.length > cap && iters < HARD_ITER_CAP) {
    iters += 1;
    const target = findLongestStringPath(working);
    if (!target || target.value.length < 16) break; // cannot shave more
    const overshoot = out.length - cap;
    const newLen = Math.max(8, target.value.length - overshoot - 8);
    setAtPath(working, target.path, target.value.slice(0, newLen) + "…");
    truncatedFields.push(target.path.join("."));
    out = serialize(working);
  }
  if (out.length <= cap) {
    logger.warn(
      {
        label,
        droppedFields: dropped,
        truncatedFields,
        finalChars: out.length,
        cap,
      },
      "promptEnvelope: shrunk prompt via field drop + string truncation",
    );
    return out;
  }

  // Phase 3 — last resort. The user's hard requirement says JSON-
  // formatted, so we WILL NOT slice the serialized JSON in half. We
  // emit a minimal valid-JSON envelope that preserves whatever
  // top-level keys still fit and stuffs the rest under an
  // "_overflow" string field that gets shaved to fit. This guarantees
  // the output is parseable JSON ≤ cap.
  const minimal: Record<string, unknown> = {};
  for (const k of Object.keys(working)) {
    const candidate = { ...minimal, [k]: working[k] };
    if (serialize(candidate).length <= cap) {
      minimal[k] = working[k];
    }
  }
  let minOut = serialize(minimal);
  // If even { } overflows the cap (cap < 2) we hit a config bug, not
  // a runtime issue — emit empty-object fallback.
  if (minOut.length > cap) {
    logger.error(
      { label, cap, finalChars: 2 },
      "promptEnvelope: cap is impossibly small; emitting {}",
    );
    return "{}";
  }
  logger.error(
    {
      label,
      droppedFields: dropped,
      truncatedFields,
      keptKeys: Object.keys(minimal),
      finalChars: minOut.length,
      cap,
    },
    "promptEnvelope: phase-3 — emitted minimal valid JSON (some fields dropped)",
  );
  return minOut;
}

/**
 * Walk the spec tree and find the longest string value, returning
 * both its full path (for setAtPath) and the value itself. We only
 * descend into plain objects and arrays; primitives terminate.
 */
interface StringPath {
  path: (string | number)[];
  value: string;
}
function findLongestStringPath(root: unknown): StringPath | null {
  let best: StringPath | null = null;
  const stack: { node: unknown; path: (string | number)[] }[] = [
    { node: root, path: [] },
  ];
  while (stack.length > 0) {
    const { node, path } = stack.pop()!;
    if (typeof node === "string") {
      if (!best || node.length > best.value.length) {
        best = { path, value: node };
      }
      continue;
    }
    if (node === null || typeof node !== "object") continue;
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) {
        stack.push({ node: node[i], path: [...path, i] });
      }
      continue;
    }
    for (const k of Object.keys(node as Record<string, unknown>)) {
      stack.push({
        node: (node as Record<string, unknown>)[k],
        path: [...path, k],
      });
    }
  }
  return best;
}

function setAtPath(
  root: Record<string, unknown>,
  path: (string | number)[],
  value: unknown,
): void {
  if (path.length === 0) return;
  let cursor: any = root;
  for (let i = 0; i < path.length - 1; i++) {
    cursor = cursor[path[i] as keyof typeof cursor];
    if (cursor === null || typeof cursor !== "object") return;
  }
  cursor[path[path.length - 1] as keyof typeof cursor] = value;
}

/**
 * Cap a string-shaped prompt at MAX_PROMPT_CHARS.
 *
 * IMPORTANT: this is for legacy / NL-text prompts only. JSON-shaped
 * prompts MUST go through `buildJsonPrompt` instead — slicing JSON
 * mid-string would produce malformed output and silently corrupt the
 * model's input.
 *
 * If `prompt` looks like JSON (starts with "{" or "[") AND is over
 * cap, we fail loudly: the caller should be using buildJsonPrompt.
 */
export function enforcePromptCap(prompt: string, label = "promptEnvelope"): string {
  if (prompt.length <= MAX_PROMPT_CHARS) return prompt;
  const trimmed = prompt.trimStart();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    logger.error(
      { label, originalChars: prompt.length, cap: MAX_PROMPT_CHARS },
      "promptEnvelope: refusing to slice oversize JSON prompt — call buildJsonPrompt",
    );
    // Return the original; downstream provider error is preferable
    // to silent JSON corruption.
    return prompt;
  }
  logger.warn(
    { label, originalChars: prompt.length, cap: MAX_PROMPT_CHARS },
    "promptEnvelope: enforcePromptCap truncating text prompt",
  );
  return prompt.slice(0, MAX_PROMPT_CHARS - 1) + "…";
}
