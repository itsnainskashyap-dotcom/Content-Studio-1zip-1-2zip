import { AnthropicVertex } from "@anthropic-ai/vertex-sdk";
import { GoogleAuth } from "google-auth-library";

const credentials = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
const googleAuth = new GoogleAuth({
  credentials,
  scopes: ["https://www.googleapis.com/auth/cloud-platform"],
});

const client = new AnthropicVertex({
  projectId: process.env.ANTHROPIC_VERTEX_PROJECT_ID,
  region: process.env.ANTHROPIC_VERTEX_REGION ?? "us-east5",
  googleAuth,
});

try {
  const r = await client.messages.create({
    model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6",
    max_tokens: 30,
    messages: [{ role: "user", content: "Reply with the single word: OK" }],
  });
  console.log("SUCCESS. Response:", JSON.stringify(r.content));
  console.log("Model used:", r.model);
} catch (e) {
  console.log("ERROR:", e.message);
  if (e.status) console.log("HTTP Status:", e.status);
  if (e.error) console.log("Error body:", JSON.stringify(e.error).slice(0, 500));
}
