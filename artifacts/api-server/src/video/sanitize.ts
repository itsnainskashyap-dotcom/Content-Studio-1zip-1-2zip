/**
 * Strips third-party AI provider/service names from user-facing
 * error strings so the UI never leaks "Veo", "Imagen", "Seedance",
 * "Freepik", "Claude", etc. The raw text is still safe to log.
 *
 * Single source of truth — used by:
 *   - aiVideoStudioEngine (job-level error/message)
 *   - jobStore.updateChunk (chunk-level error before persisting)
 *   - any other future surface that hands a provider error to the UI.
 */

const PROVIDER_NAME_PATTERN =
  /\b(veo|imagen|gemini|google\s*genai|seedance|freepik|anthropic|claude|sonnet)\b[\w.-]*/gi;

export function sanitizeUserFacingError(raw: string): string {
  const stripped = raw.replace(PROVIDER_NAME_PATTERN, "engine").trim();
  // Collapse repeated "engine"s left by adjacent matches.
  const cleaned = stripped.replace(/\b(engine\s+){2,}/gi, "engine ");
  return cleaned.length > 0 ? cleaned : "Generation engine error";
}
