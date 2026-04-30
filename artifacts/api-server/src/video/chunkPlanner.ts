/**
 * Chunk planner — splits a target duration into ordered 8-second parts
 * for the selected internal engine. Pure function, no I/O.
 *
 * Cont Pro: up to 60s, 8s chunks (8 parts max). Last part may be < 8s
 * and is trimmed to exact duration during stitching per spec rule 14.
 * Cont Ultra: up to 120s, 10s chunks (12 parts max — Freepik Seedance
 * I2V only accepts 5 or 10 sec per call).
 */

import { ENGINE_CAPS, type ChunkPart, type ChunkPlan, type EngineModel } from "./types";

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function fmt(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${pad2(m)}:${pad2(s)}`;
}

export function createChunkPlan(args: {
  model: EngineModel;
  durationSeconds: number;
}): ChunkPlan {
  const { model, durationSeconds } = args;
  if (durationSeconds <= 0) {
    throw new Error(`durationSeconds must be > 0 (got ${durationSeconds})`);
  }
  const cap = ENGINE_CAPS[model];
  if (durationSeconds > cap.maxSeconds) {
    throw new Error(
      `${model} caps total duration at ${cap.maxSeconds}s (requested ${durationSeconds}s)`,
    );
  }

  const chunkSize = cap.chunkSeconds;
  const fullChunks = Math.floor(durationSeconds / chunkSize);
  const remainder = durationSeconds - fullChunks * chunkSize;
  const partCount = fullChunks + (remainder > 0 ? 1 : 0);

  const parts: ChunkPart[] = [];
  for (let i = 0; i < partCount; i++) {
    const start = i * chunkSize;
    const isLast = i === partCount - 1;
    // Per spec rule 14: even when the last segment is shorter than the
    // chunk size, generate a full 8s chunk and trim during stitching.
    // We still tag the part with its TARGET duration so stitcher knows
    // how much to keep.
    const targetEnd = isLast && remainder > 0 ? start + remainder : start + chunkSize;
    const part: ChunkPart = {
      partNumber: i + 1,
      startSeconds: start,
      endSeconds: targetEnd,
      durationSeconds: targetEnd - start,
      timeRange: `${fmt(start)}-${fmt(targetEnd)}`,
    };
    parts.push(part);
  }

  return {
    model,
    totalDurationSeconds: durationSeconds,
    parts,
  };
}
