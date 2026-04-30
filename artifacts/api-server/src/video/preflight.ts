/**
 * Boot-time preflight for the AI Video Studio engine.
 *
 * The engine touches several external services and one OS binary
 * (FFmpeg) deep inside the job, so a missing dependency normally only
 * surfaces after the user has already waited through earlier stages.
 * This sweep checks everything the engine needs at server boot and:
 *
 *   - throws (crashing the API) if a TRULY required dependency is
 *     missing (DATABASE_URL, ffmpeg, ffprobe). Without these no job
 *     can ever succeed and the failure should be loud.
 *
 *   - logs a clear warning if a per-provider key is missing. Some
 *     deployments only need one of Cont Pro (Veo) / Cont Ultra
 *     (Seedance), so we don't crash, but the log makes the gap
 *     obvious before a user kicks off a job.
 */

import { spawnSync } from "node:child_process";
import { logger } from "../lib/logger";

interface CheckResult {
  ok: boolean;
  detail: string;
}

function checkEnv(name: string): CheckResult {
  const v = process.env[name];
  return {
    ok: typeof v === "string" && v.length > 0,
    detail: v ? "present" : "missing",
  };
}

function checkAnthropic(): CheckResult {
  // Mirror lib/integrations-anthropic-ai/src/client.ts resolution.
  // Behavior:
  //   - If ANTHROPIC_PROVIDER is set, only that backend's vars are
  //     considered. Anything else is a guaranteed runtime failure.
  //   - Otherwise the client tries vertex → direct → proxy in that
  //     order, so any one fully-configured backend is enough.
  const explicit = (process.env["ANTHROPIC_PROVIDER"] ?? "").trim().toLowerCase();
  const vertexOk = !!process.env["ANTHROPIC_VERTEX_PROJECT_ID"];
  const directOk = !!process.env["ANTHROPIC_API_KEY"];
  const proxyOk =
    !!process.env["AI_INTEGRATIONS_ANTHROPIC_API_KEY"] &&
    !!process.env["AI_INTEGRATIONS_ANTHROPIC_BASE_URL"];

  if (explicit === "vertex") {
    return vertexOk
      ? { ok: true, detail: "explicit vertex" }
      : { ok: false, detail: "ANTHROPIC_PROVIDER=vertex but ANTHROPIC_VERTEX_PROJECT_ID missing" };
  }
  if (explicit === "direct") {
    return directOk
      ? { ok: true, detail: "explicit direct" }
      : { ok: false, detail: "ANTHROPIC_PROVIDER=direct but ANTHROPIC_API_KEY missing" };
  }
  if (explicit === "replit") {
    return proxyOk
      ? { ok: true, detail: "explicit proxy" }
      : { ok: false, detail: "ANTHROPIC_PROVIDER=replit but proxy key + base URL missing" };
  }
  if (explicit && explicit !== "auto") {
    return { ok: false, detail: `unknown ANTHROPIC_PROVIDER="${explicit}"` };
  }
  // auto / unset — any one backend is enough.
  if (vertexOk) return { ok: true, detail: "auto: vertex" };
  if (directOk) return { ok: true, detail: "auto: direct" };
  if (proxyOk) return { ok: true, detail: "auto: proxy" };
  return {
    ok: false,
    detail:
      "missing (need vertex project, direct key, or proxy key + base URL)",
  };
}

function checkGeminiQC(): CheckResult {
  // Gemini text/vision is now used ONLY by the optional QC vision
  // route (Image Studio quality scoring). Image generation moved to
  // Magnific Nano Banana Pro (FREEPIK_API_KEY). Either a direct
  // GOOGLE_GENAI_API_KEY OR a proxy key + base URL is acceptable; if
  // both are missing the QC route will fail at call time but every
  // other path keeps working.
  const direct = process.env["GOOGLE_GENAI_API_KEY"];
  const proxyKey = process.env["AI_INTEGRATIONS_GEMINI_API_KEY"];
  const proxyBase = process.env["AI_INTEGRATIONS_GEMINI_BASE_URL"];
  if (direct) return { ok: true, detail: "direct key present" };
  if (proxyKey && proxyBase) return { ok: true, detail: "proxy configured" };
  return {
    ok: false,
    detail:
      "missing (QC vision route only — image generation no longer needs Google credentials)",
  };
}

function checkBinary(name: string): CheckResult {
  try {
    const result = spawnSync(name, ["-version"], { stdio: "ignore" });
    if (result.error) {
      return { ok: false, detail: `not found in PATH (${result.error.message})` };
    }
    if (result.status !== 0) {
      return { ok: false, detail: `exited ${result.status}` };
    }
    return { ok: true, detail: "present" };
  } catch (err) {
    return {
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

export function runVideoStudioPreflight(): void {
  const required = {
    DATABASE_URL: checkEnv("DATABASE_URL"),
    ffmpeg: checkBinary("ffmpeg"),
    ffprobe: checkBinary("ffprobe"),
  };
  const optional = {
    // Single Magnific (Freepik) API key now powers ALL image + video
    // generation: Nano Banana Pro for images (visual bible, Cinema
    // Studio, Image Studio), Veo 3.1 I2V for Cont Pro, Seedance I2V
    // for Cont Ultra. Without this key, no generation works.
    "Magnific (FREEPIK_API_KEY)": checkEnv("FREEPIK_API_KEY"),
    // Claude director — accepts proxy / Vertex / direct.
    Anthropic: checkAnthropic(),
    // Optional Gemini text/vision for the Image Studio QC scoring
    // route. Image generation no longer touches Google directly.
    "Gemini (QC vision only)": checkGeminiQC(),
    // Used to upload videos & frames to durable storage.
    FIREBASE_SERVICE_ACCOUNT_JSON: checkEnv("FIREBASE_SERVICE_ACCOUNT_JSON"),
  };

  // Loud, single-line summary for the boot log.
  const summary = {
    required: Object.fromEntries(
      Object.entries(required).map(([k, v]) => [k, v.ok ? "ok" : v.detail]),
    ),
    optional: Object.fromEntries(
      Object.entries(optional).map(([k, v]) => [k, v.ok ? "ok" : v.detail]),
    ),
  };
  logger.info(summary, "video-studio: preflight summary");

  const missingRequired = Object.entries(required)
    .filter(([, v]) => !v.ok)
    .map(([k, v]) => `${k} (${v.detail})`);
  if (missingRequired.length > 0) {
    throw new Error(
      `AI Video Studio preflight failed — missing required dependencies: ${missingRequired.join(", ")}`,
    );
  }

  const missingOptional = Object.entries(optional)
    .filter(([, v]) => !v.ok)
    .map(([k, v]) => `${k} (${v.detail})`);
  if (missingOptional.length > 0) {
    logger.warn(
      { missing: missingOptional },
      "video-studio: optional providers/credentials missing — jobs depending on them will fail at runtime",
    );
  }
}
