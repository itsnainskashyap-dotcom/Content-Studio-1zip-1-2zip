import Anthropic from "@anthropic-ai/sdk";
import { AnthropicVertex } from "@anthropic-ai/vertex-sdk";
import { GoogleAuth } from "google-auth-library";

/**
 * Resolve the Anthropic client. Three modes are supported.
 *
 * The backend can be picked **explicitly** via `ANTHROPIC_PROVIDER`
 * (recommended when more than one set of credentials is present, so
 * which one wins is obvious from env vars alone):
 *
 *   ANTHROPIC_PROVIDER=replit   → Replit-managed proxy
 *   ANTHROPIC_PROVIDER=vertex   → Google Vertex AI (Model Garden)
 *   ANTHROPIC_PROVIDER=direct   → Direct Anthropic API
 *
 * If `ANTHROPIC_PROVIDER` is unset/blank, fall through the historical
 * implicit priority order:
 *
 *   1. Vertex AI — when `ANTHROPIC_VERTEX_PROJECT_ID` is set. Uses
 *      Claude published in Google's Vertex Model Garden. Credentials
 *      come from `GOOGLE_APPLICATION_CREDENTIALS`, ADC, or the same
 *      `FIREBASE_SERVICE_ACCOUNT_JSON` blob the rest of the app uses.
 *   2. Direct Anthropic API — when `ANTHROPIC_API_KEY` is set.
 *   3. Replit-managed proxy — when both
 *      `AI_INTEGRATIONS_ANTHROPIC_API_KEY` and
 *      `AI_INTEGRATIONS_ANTHROPIC_BASE_URL` are set.
 */
function buildVertexClient(): AnthropicVertex {
  const vertexProject = process.env.ANTHROPIC_VERTEX_PROJECT_ID;
  if (!vertexProject) {
    throw new Error(
      "ANTHROPIC_PROVIDER=vertex but ANTHROPIC_VERTEX_PROJECT_ID is not set.",
    );
  }
  const region = process.env.ANTHROPIC_VERTEX_REGION ?? "us-east5";

  // If only FIREBASE_SERVICE_ACCOUNT_JSON is provided, materialise it
  // into a GoogleAuth credentials object so google-auth-library can pick
  // it up without a file-on-disk roundtrip.
  let googleAuth: GoogleAuth | undefined;
  const saJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS && saJson && saJson.trim()) {
    try {
      const credentials = JSON.parse(saJson);
      googleAuth = new GoogleAuth({
        credentials,
        scopes: ["https://www.googleapis.com/auth/cloud-platform"],
      });
    } catch (err) {
      throw new Error(
        `FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  return new AnthropicVertex({
    projectId: vertexProject,
    region,
    ...(googleAuth ? { googleAuth } : {}),
  });
}

function buildDirectClient(): Anthropic {
  const directKey = process.env.ANTHROPIC_API_KEY;
  if (!directKey) {
    throw new Error(
      "ANTHROPIC_PROVIDER=direct but ANTHROPIC_API_KEY is not set.",
    );
  }
  return new Anthropic({ apiKey: directKey });
}

function buildReplitProxyClient(): Anthropic {
  const proxyKey = process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY;
  const proxyBase = process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL;
  if (!proxyKey || !proxyBase) {
    throw new Error(
      "ANTHROPIC_PROVIDER=replit but AI_INTEGRATIONS_ANTHROPIC_API_KEY / " +
        "AI_INTEGRATIONS_ANTHROPIC_BASE_URL are not set.",
    );
  }
  return new Anthropic({ apiKey: proxyKey, baseURL: proxyBase });
}

function buildClient(): Anthropic | AnthropicVertex {
  const explicit = (process.env.ANTHROPIC_PROVIDER ?? "").trim().toLowerCase();
  if (explicit === "replit" || explicit === "replit-proxy" || explicit === "proxy") {
    return buildReplitProxyClient();
  }
  if (explicit === "vertex" || explicit === "vertex-ai") {
    return buildVertexClient();
  }
  if (explicit === "direct" || explicit === "anthropic") {
    return buildDirectClient();
  }
  if (explicit && explicit !== "auto") {
    throw new Error(
      `Unknown ANTHROPIC_PROVIDER="${explicit}". Use one of: replit, vertex, direct, auto.`,
    );
  }

  // Implicit priority order (legacy behaviour). Try each helper in
  // turn and only fall through when the required env vars are missing.
  if (process.env.ANTHROPIC_VERTEX_PROJECT_ID) return buildVertexClient();
  if (process.env.ANTHROPIC_API_KEY) return buildDirectClient();
  if (
    process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY &&
    process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL
  ) {
    return buildReplitProxyClient();
  }

  throw new Error(
    "Anthropic is not configured. Set ANTHROPIC_PROVIDER plus the matching " +
      "credentials, or rely on the implicit priority by setting one of: " +
      "ANTHROPIC_VERTEX_PROJECT_ID (Vertex), ANTHROPIC_API_KEY (direct), or " +
      "AI_INTEGRATIONS_ANTHROPIC_API_KEY + AI_INTEGRATIONS_ANTHROPIC_BASE_URL " +
      "(Replit proxy).",
  );
}

export const anthropic = buildClient();
