/**
 * FFmpeg-driven last-frame extraction. Captures the very last frame of
 * an MP4 chunk as a PNG, persists it to Object Storage, and returns
 * `{objectPath, b64, mimeType}` so the caller can both reference it
 * later and immediately feed it to the next provider call as an
 * image-to-video starting frame.
 */

import { spawn } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { saveBufferToObjectStorage, safeUnlink } from "../lib/videoStorage";
import { logger } from "../lib/logger";

export interface FrameCaptureResult {
  objectPath: string;
  b64: string;
  mimeType: string;
}

/**
 * Extract the LAST decoded frame of `localMp4Path` as a PNG. We use
 * `-sseof -0.1` to seek to 100ms before EOF then `-update 1` to write
 * a single image, which reliably grabs the final visible frame even
 * for short clips with few keyframes.
 */
export async function captureLastFrame(
  localMp4Path: string,
): Promise<FrameCaptureResult> {
  const dir = await mkdtemp(path.join(tmpdir(), "video-studio-frame-"));
  const out = path.join(dir, "last.png");

  await runFfmpeg([
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-sseof",
    "-0.1",
    "-i",
    localMp4Path,
    "-update",
    "1",
    "-vframes",
    "1",
    "-vf",
    "scale=trunc(iw/2)*2:trunc(ih/2)*2",
    out,
  ]);

  const buf = await readFile(out);
  if (buf.length === 0) {
    throw new Error("Last-frame capture produced an empty PNG");
  }
  const { objectPath } = await saveBufferToObjectStorage(buf, "image/png");
  await safeUnlink(out);
  return { objectPath, b64: buf.toString("base64"), mimeType: "image/png" };
}

/** Capture a still at a specific timestamp — used for the final thumbnail. */
export async function captureFrameAtTimestamp(
  localMp4Path: string,
  seconds: number,
): Promise<FrameCaptureResult> {
  const dir = await mkdtemp(path.join(tmpdir(), "video-studio-thumb-"));
  const out = path.join(dir, "thumb.png");
  await runFfmpeg([
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-ss",
    String(seconds),
    "-i",
    localMp4Path,
    "-vframes",
    "1",
    "-vf",
    "scale=trunc(iw/2)*2:trunc(ih/2)*2",
    out,
  ]);
  const buf = await readFile(out);
  const { objectPath } = await saveBufferToObjectStorage(buf, "image/png");
  await safeUnlink(out);
  return { objectPath, b64: buf.toString("base64"), mimeType: "image/png" };
}

export function runFfmpeg(argv: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", argv, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    proc.once("error", (err) => {
      logger.error({ err }, "ffmpeg spawn failed");
      reject(err);
    });
    proc.once("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(
          new Error(`ffmpeg exited with code ${code}\n${stderr.slice(-2000)}`),
        );
      }
    });
  });
}

export function runFfprobeJson(argv: string[]): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffprobe", argv, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (c) => (stdout += c.toString()));
    proc.stderr.on("data", (c) => (stderr += c.toString()));
    proc.once("error", reject);
    proc.once("close", (code) => {
      if (code !== 0) {
        reject(new Error(`ffprobe exited with code ${code}: ${stderr}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (err) {
        reject(err);
      }
    });
  });
}
