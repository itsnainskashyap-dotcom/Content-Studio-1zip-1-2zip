import { GoogleGenAI, Modality } from "@google/genai";
import { readFile } from "node:fs/promises";

const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_GENAI_API_KEY });

async function step(name, fn) {
  process.stdout.write(`▶ ${name} ... `);
  try {
    const t0 = Date.now();
    const note = await fn();
    console.log(`OK (${Date.now() - t0}ms) ${note ?? ""}`);
  } catch (e) {
    console.log(`FAIL: ${e.message?.slice(0, 250)}`);
  }
}

// Test 1: text-only on Nano Banana 2 with 21:9 ultrawide
await step("NB2 (gemini-3.1-flash-image-preview) text+21:9", async () => {
  const r = await ai.models.generateContent({
    model: "gemini-3.1-flash-image-preview",
    contents: [{ role: "user", parts: [{ text: "A cinematic ultrawide shot of a red sports car on a coastal highway at sunset" }] }],
    config: {
      responseModalities: [Modality.TEXT, Modality.IMAGE],
      imageConfig: { aspectRatio: "21:9" },
    },
  });
  const part = r.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
  if (!part?.inlineData?.data) throw new Error("no image");
  return `→ ${Math.round(part.inlineData.data.length * 0.75 / 1024)} KB`;
});

// Test 2: with reference image, 16:9
const refPng = await readFile("/tmp/test-image.png");
await step("NB2 with reference image, 16:9", async () => {
  const r = await ai.models.generateContent({
    model: "gemini-3.1-flash-image-preview",
    contents: [{
      role: "user",
      parts: [
        { inlineData: { data: refPng.toString("base64"), mimeType: "image/png" } },
        { text: "Use the red shape as inspiration. Generate a cinematic still of a red sphere floating in a futuristic gallery." },
      ],
    }],
    config: {
      responseModalities: [Modality.TEXT, Modality.IMAGE],
      imageConfig: { aspectRatio: "16:9" },
    },
  });
  const part = r.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
  if (!part?.inlineData?.data) throw new Error("no image");
  return `→ ${Math.round(part.inlineData.data.length * 0.75 / 1024)} KB`;
});

// Test 3: extreme aspect ratio 8:1 (NB2 exclusive)
await step("NB2 ultrawide 8:1 exclusive", async () => {
  const r = await ai.models.generateContent({
    model: "gemini-3.1-flash-image-preview",
    contents: [{ role: "user", parts: [{ text: "A panoramic banner of a misty mountain range at dawn" }] }],
    config: {
      responseModalities: [Modality.TEXT, Modality.IMAGE],
      imageConfig: { aspectRatio: "8:1" },
    },
  });
  const part = r.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
  if (!part?.inlineData?.data) throw new Error("no image");
  return `→ ${Math.round(part.inlineData.data.length * 0.75 / 1024)} KB`;
});

// Test 4: Nano Banana Pro for comparison (highest fidelity)
await step("NB Pro (gemini-3-pro-image-preview) text+16:9", async () => {
  const r = await ai.models.generateContent({
    model: "gemini-3-pro-image-preview",
    contents: [{ role: "user", parts: [{ text: "A cinematic still of a red sports car on a coastal highway at sunset" }] }],
    config: {
      responseModalities: [Modality.TEXT, Modality.IMAGE],
      imageConfig: { aspectRatio: "16:9" },
    },
  });
  const part = r.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
  if (!part?.inlineData?.data) throw new Error("no image");
  return `→ ${Math.round(part.inlineData.data.length * 0.75 / 1024)} KB`;
});
