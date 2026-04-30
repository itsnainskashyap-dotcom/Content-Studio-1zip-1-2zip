/**
 * Root Gemini client export.
 *
 * Image generation has been migrated to Magnific (see `./image/client`),
 * so the only remaining direct caller of Google GenAI is the optional
 * Image Studio QC vision route in the API server. To make that route
 * truly optional — i.e. the API server still boots when neither
 * GOOGLE_GENAI_API_KEY nor the proxy creds are set — we expose `ai` as
 * a lazy proxy: construction is deferred until the first method access,
 * and only THEN do we throw the configuration error. Importing the
 * symbol is always safe.
 */

import { GoogleGenAI } from "@google/genai";

let cached: GoogleGenAI | null = null;

function build(): GoogleGenAI {
  if (cached) return cached;
  const directKey = process.env.GOOGLE_GENAI_API_KEY;
  const proxyKey = process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
  const proxyBase = process.env.AI_INTEGRATIONS_GEMINI_BASE_URL;
  if (!directKey && !(proxyKey && proxyBase)) {
    throw new Error(
      "Gemini is not configured. Set GOOGLE_GENAI_API_KEY (your own " +
        "Google AI / Vertex key) or AI_INTEGRATIONS_GEMINI_API_KEY + " +
        "AI_INTEGRATIONS_GEMINI_BASE_URL. Image generation has moved to " +
        "Magnific (FREEPIK_API_KEY); this client is only required for " +
        "Gemini text/vision routes such as the Image Studio QC scorer.",
    );
  }
  cached = directKey
    ? new GoogleGenAI({ apiKey: directKey })
    : new GoogleGenAI({
        apiKey: proxyKey!,
        httpOptions: { apiVersion: "", baseUrl: proxyBase! },
      });
  return cached;
}

/**
 * Lazy `GoogleGenAI` proxy. Reading any property on it triggers
 * construction; if Gemini isn't configured, the configuration error
 * surfaces at the call site rather than at module-load time.
 */
export const ai: GoogleGenAI = new Proxy({} as GoogleGenAI, {
  get(_target, prop, receiver) {
    const real = build() as unknown as Record<PropertyKey, unknown>;
    const value = Reflect.get(real, prop, receiver);
    return typeof value === "function" ? value.bind(real) : value;
  },
  has(_target, prop) {
    const real = build() as unknown as object;
    return prop in real;
  },
});
