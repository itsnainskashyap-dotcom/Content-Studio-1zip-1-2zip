/**
 * Stitcher — concat the per-part MP4 chunks into a single MP4, trim the
 * very last chunk to the exact requested duration (per spec rule 14),
 * normalize codec / fps / pixel format so the demuxer never chokes on
 * mismatched streams, and emit a thumbnail PNG for the UI player.
 *
 * Strategy:
 *   - Re-encode every chunk to a known-safe baseline (h264/yuv420p/30fps,
 *     stereo aac 48k, even dimensions) so concat ALWAYS works regardless
 *     of which provider produced which chunk.
 *   - Trim the last chunk's input to its target durationSeconds.
 *   - Use the concat demuxer (-f concat) — exact byte-for-byte concat
 *     since every input now shares identical encoding params.
 *   - Capture a thumbnail at 1s.
 */

import type { VideoStudioJobRequest } from "@workspace/api-zod";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  downloadObjectToTempFile,
  saveFileToObjectStorage,
  safeUnlink,
} from "../lib/videoStorage";
import { runFfmpeg, captureFrameAtTimestamp } from "./frameCapture";

export interface StitchInputChunk {
  partNumber: number;
  videoObjectPath: string;
  lastFrameObjectPath: string;
  summary: string;
  durationSeconds: number;
}

export interface StitchResult {
  videoObjectPath: string;
  thumbnailObjectPath: string;
  voiceoverScript?: string;
}

const TARGET_FPS = 30;

export async function stitchFinalVideo(args: {
  jobId: string;
  chunks: StitchInputChunk[];
  request: VideoStudioJobRequest;
}): Promise<StitchResult> {
  const { chunks, request } = args;
  if (chunks.length === 0) {
    throw new Error("Cannot stitch: no chunks produced");
  }

  const dir = await mkdtemp(path.join(tmpdir(), "video-studio-stitch-"));
  const normalizedPaths: string[] = [];

  // Step 1: download + normalize each chunk.
  for (const chunk of chunks.sort((a, b) => a.partNumber - b.partNumber)) {
    const local = await downloadObjectToTempFile(
      chunk.videoObjectPath,
      `part_${chunk.partNumber}_in.mp4`,
    );
    const normalized = path.join(dir, `part_${chunk.partNumber}.mp4`);
    const trimDuration = chunk.durationSeconds; // exact target seconds
    const targetW = aspectToWidth(request.aspectRatio);
    const targetH = aspectToHeight(request.aspectRatio);

    await runFfmpeg([
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      local,
      "-t",
      String(trimDuration),
      "-vf",
      `scale=${targetW}:${targetH}:force_original_aspect_ratio=decrease,pad=${targetW}:${targetH}:(ow-iw)/2:(oh-ih)/2,fps=${TARGET_FPS},format=yuv420p`,
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "20",
      "-pix_fmt",
      "yuv420p",
      "-r",
      String(TARGET_FPS),
      "-c:a",
      "aac",
      "-ar",
      "48000",
      "-ac",
      "2",
      "-b:a",
      "192k",
      "-movflags",
      "+faststart",
      normalized,
    ]);
    normalizedPaths.push(normalized);
    await safeUnlink(local);
  }

  // Step 2: write the concat list.
  const concatList = path.join(dir, "list.txt");
  await writeFile(
    concatList,
    normalizedPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n"),
  );

  // Step 3: concat — copy codecs since every input is already aligned.
  const finalLocal = path.join(dir, "final.mp4");
  await runFfmpeg([
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    concatList,
    "-c",
    "copy",
    "-movflags",
    "+faststart",
    finalLocal,
  ]);

  // Step 4: thumbnail.
  const thumbSeekSec = Math.min(1, Math.max(0, request.durationSeconds - 0.5));
  const thumb = await captureFrameAtTimestamp(finalLocal, thumbSeekSec);

  // Step 5: persist final to GCS.
  const { objectPath: finalObjectPath } = await saveFileToObjectStorage(
    finalLocal,
    "video/mp4",
  );

  // Voiceover script aggregate is built from per-chunk summaries — this
  // gives the UI's caption panel something readable without re-running
  // the LLM. (The actual lip-synced VO already lives baked into each
  // chunk's audio track, courtesy of Veo / Seedance.)
  const voiceoverScript = chunks
    .sort((a, b) => a.partNumber - b.partNumber)
    .map((c) => `Scene ${c.partNumber} (${secs(c.durationSeconds)}): ${c.summary}`)
    .join("\n\n");

  // Cleanup normalized parts (final has been uploaded already).
  for (const p of normalizedPaths) await safeUnlink(p);
  await safeUnlink(finalLocal);
  await safeUnlink(concatList);

  return {
    videoObjectPath: finalObjectPath,
    thumbnailObjectPath: thumb.objectPath,
    voiceoverScript,
  };
}

function aspectToWidth(aspect: string): number {
  switch (aspect) {
    case "16:9":
      return 1280;
    case "9:16":
      return 720;
    case "1:1":
      return 1024;
    default:
      return 1280;
  }
}

function aspectToHeight(aspect: string): number {
  switch (aspect) {
    case "16:9":
      return 720;
    case "9:16":
      return 1280;
    case "1:1":
      return 1024;
    default:
      return 720;
  }
}

function secs(n: number): string {
  return `${n}s`;
}
