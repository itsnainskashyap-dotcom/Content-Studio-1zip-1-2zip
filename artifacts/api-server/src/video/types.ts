/**
 * Internal types shared across the AI Video Studio engine. Mirrors the
 * normalized story / visual bible / json prompt structures from the
 * spec. Kept in one place so providers, engine and routes all agree.
 */

import type { VideoStudioJobRequest } from "@workspace/api-zod";

export type EngineModel = "cont_pro" | "cont_ultra";

/**
 * Hard caps per engine.
 * Cont Pro (Veo 3.x): 8-second clips, stitched up to 60s total.
 * Cont Ultra (Seedance via Freepik): 10-second clips in a single call
 *   (Freepik's Seedance I2V endpoints only accept duration 5 or 10),
 *   stitched up to 120s total → at most 12 parts.
 */
export const ENGINE_CAPS = {
  cont_pro: { chunkSeconds: 8, maxSeconds: 60 },
  cont_ultra: { chunkSeconds: 10, maxSeconds: 120 },
} as const;

/** Allowed user-facing duration choices per model. */
export const ENGINE_DURATIONS = {
  cont_pro: [15, 30, 60] as const,
  cont_ultra: [30, 60, 120] as const,
} as const;

export interface ChunkPart {
  partNumber: number;
  /** Start second, inclusive (00:00 -> 0). */
  startSeconds: number;
  /** End second, exclusive (00:08 -> 8). */
  endSeconds: number;
  /** Duration in seconds (always >= 1, generally 8 except trimmed last). */
  durationSeconds: number;
  /** "00:00-00:08" style label. */
  timeRange: string;
}

export interface ChunkPlan {
  model: EngineModel;
  totalDurationSeconds: number;
  parts: ChunkPart[];
}

/** ---------- Normalized story (spec contract) ---------- */

export interface NormalizedStoryCharacter {
  id: string;
  name: string;
  age: string;
  gender: string;
  face: string;
  hair: string;
  body: string;
  outfit: string;
  accessories: string;
  personality: string;
  voiceTone: string;
  continuityLock: string;
}

export interface NormalizedStoryLocation {
  id: string;
  name: string;
  description: string;
  lighting: string;
  mood: string;
  continuityLock: string;
}

export interface NormalizedStoryBeat {
  beatNumber: number;
  summary: string;
  characters: string[];
  location: string;
  emotionalPurpose: string;
  visualPurpose: string;
}

export interface NormalizedStory {
  storyId: string;
  title: string;
  logline: string;
  genre: string;
  visualStyle: string;
  language: string;
  voiceoverTone: string;
  bgmStyle: string;
  characters: NormalizedStoryCharacter[];
  locations: NormalizedStoryLocation[];
  storyBeats: NormalizedStoryBeat[];
}

/** ---------- Visual bible ---------- */

export interface VisualBibleCharacter {
  id: string;
  name: string;
  /** Object Storage path of the reference image. */
  referenceImageObjectPath: string;
  /** Inline base64 (no data URL prefix) for engine handoff. */
  referenceImageB64: string;
  referenceImageMime: string;
  faceLock: string;
  outfitLock: string;
  negativeRules: string[];
}

export interface VisualBibleLocation {
  id: string;
  name: string;
  referenceImageObjectPath: string;
  referenceImageB64: string;
  referenceImageMime: string;
  lightingLock: string;
  environmentLock: string;
}

export interface VisualBibleStyleLock {
  visualStyle: string;
  colorGrade: string;
  cameraLanguage: string;
  qualityRules: string[];
}

export interface VisualBible {
  characters: VisualBibleCharacter[];
  locations: VisualBibleLocation[];
  styleLock: VisualBibleStyleLock;
  /**
   * Story opening reference frame (Nano Banana 2). Optional — when the model
   * access is restricted the visual bible is built without reference images
   * and Claude continuity rules carry the load instead.
   */
  openingFrame?: ReferenceFrame;
}

export interface ReferenceFrame {
  objectPath: string;
  b64: string;
  mimeType: string;
  prompt: string;
}

/** ---------- Per-part JSON video prompt (spec shape) ---------- */

export interface JsonVideoPrompt {
  engineModel: EngineModel;
  partNumber: number;
  totalParts: number;
  timeRange: string;
  storyContext: {
    title: string;
    fullStorySummary: string;
    currentBeat: string;
    previousBeat: string;
    nextBeat: string;
  };
  continuity: {
    startMode: "opening_frame" | "previous_last_frame";
    previousLastFrameObjectPath: string | null;
    mustStartFromPreviousFrame: boolean;
    characterContinuityRules: string[];
    sceneContinuityRules: string[];
  };
  visualStoryboard: {
    startingFramePrompt: string;
    endingFramePrompt: string;
    keyFrames: Array<{
      timestamp: string;
      description: string;
      camera: string;
      characterPose: string;
      environment: string;
    }>;
  };
  videoDirection: {
    mainAction: string;
    cameraMovement: string;
    lens: string;
    composition: string;
    lighting: string;
    atmosphere: string;
    physics: string;
    motionRules: string[];
  };
  cutSceneRules: {
    allowed: boolean;
    cutStyle: string;
    mustFeelContinuous: boolean;
    cutPurpose: string;
  };
  audio: {
    voiceoverLanguage: string;
    voiceoverText: string;
    voiceoverTone: string;
    soundEffects: string[];
    backgroundMusic: {
      style: string;
      tempo: string;
      instruments: string;
      energy: string;
    };
  };
  negativePrompt: string[];
  endStateForNextPart: {
    lastFrameDescription: string;
    characterPosition: string;
    cameraAngle: string;
    lightingState: string;
    emotionState: string;
    environmentState: string;
  };
}

/** ---------- Engine input ---------- */

export type EngineInput = VideoStudioJobRequest;

/** Convenience guard. */
export function isEngineModel(s: string): s is EngineModel {
  return s === "cont_pro" || s === "cont_ultra";
}
