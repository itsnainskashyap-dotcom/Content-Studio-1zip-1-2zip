import { initializeApp, getApps, cert, applicationDefault } from "firebase-admin/app";
import { getAuth, type DecodedIdToken } from "firebase-admin/auth";

/**
 * Lazy-initialised Firebase Admin SDK. We support two configurations:
 *
 *   1. FIREBASE_SERVICE_ACCOUNT_JSON — single secret containing the entire
 *      service-account JSON blob (preferred for Replit Secrets).
 *   2. FIREBASE_PROJECT_ID + FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY
 *      — the three fields parsed individually.
 *
 * Initialisation is idempotent so the module is safe to import in tests
 * and route handlers alike.
 */
function ensureInitialised(): void {
  if (getApps().length > 0) return;

  const json = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (json && json.trim().length > 0) {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(json);
    } catch (err) {
      throw new Error(
        `FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    initializeApp({
      credential: cert(parsed as Parameters<typeof cert>[0]),
    });
    return;
  }

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  // Replit Secrets escape newlines — restore them so the PEM parses.
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (projectId && clientEmail && privateKey) {
    initializeApp({
      credential: cert({ projectId, clientEmail, privateKey }),
    });
    return;
  }

  // Last-ditch fallback for environments with GOOGLE_APPLICATION_CREDENTIALS.
  try {
    initializeApp({ credential: applicationDefault() });
  } catch {
    throw new Error(
      "Firebase Admin SDK is not configured. Set FIREBASE_SERVICE_ACCOUNT_JSON " +
        "or FIREBASE_PROJECT_ID + FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY.",
    );
  }
}

export async function verifyFirebaseIdToken(
  idToken: string,
): Promise<DecodedIdToken> {
  ensureInitialised();
  return getAuth().verifyIdToken(idToken);
}
