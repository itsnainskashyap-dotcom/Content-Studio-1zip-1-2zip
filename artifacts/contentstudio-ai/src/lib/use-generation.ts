import { createContext, useContext } from "react";
import type {
  AspectRatio,
  FrameSettings,
  Project,
  ProjectPart,
  PromptMode,
  ReferenceImage,
  VideoModel,
  VoiceoverLanguage,
} from "@/lib/storage";

export interface GenerationConfig {
  projectId: string;
  story: NonNullable<Project["story"]>;
  style: string;
  partsCount: number;
  partDuration: number;
  voiceoverLanguage: VoiceoverLanguage;
  voiceoverTone: string;
  bgm: { name: string; tempo: string; instruments: string[] } | null;
  /** DUAL-MODE: writer's chosen output format ("normal" or "json"). */
  mode: PromptMode;
  /** FRAMES: per-part starting/ending frame + per-shot scene-breakdown toggles. */
  frameSettings: FrameSettings;
  /**
   * FRAMES: inline reference images sent with every Claude call. Capped at
   * 5 by the server but we forward whatever the project has.
   */
  referenceImages: ReferenceImage[];
  /**
   * Aspect ratio chosen at project setup. Forwarded to both the writer
   * (so shots are composed for this ratio + the [VIDEO SPEC: …] header
   * names it) and the auto-frame renderer (so the still preview matches
   * what the user will see in the final video).
   */
  aspectRatio: AspectRatio;
  /**
   * Target video generation model the writer optimizes per-part copyablePrompt
   * for (Seedance / Veo / Kling / Sora / Runway / Luma / Hailuo / Pika). The
   * writer uses this to pick the correct prompt dialect AND to size shot
   * timestamps inside the model's per-clip duration band.
   */
  videoModel: VideoModel;
  /**
   * When true, the writer embeds an explicit "use Image 1 as the FIRST frame
   * and Image 2 as the LAST frame" header in copyablePrompt (and as
   * `imageToImage` in JSON mode) so the user can paste the project's rendered
   * starting + ending frame stills into the target model as keyframe anchors.
   * Driven by `frameSettings.startingFrameEnabled && endingFrameEnabled`.
   */
  framesAsImageReferences: boolean;
}

export type FrameRenderStatus = "pending" | "rendering" | "done" | "error";

export interface PartFrameStatus {
  starting: FrameRenderStatus;
  ending: FrameRenderStatus;
}

export interface GenerationJob {
  projectId: string;
  status: "running" | "awaiting_next" | "done" | "error" | "cancelled";
  total: number;
  current: number;
  parts: ProjectPart[];
  error: string | null;
  config: GenerationConfig;
  startedAt: number;
  previousLastFrame?: string;
  /**
   * Per-part frame render progress. Keys are partNumber strings ("1", "2", …)
   * so the UI can surface "rendering starting/ending frame" badges live and
   * the global progress pill can show overall completeness.
   */
  frameStatuses: Record<string, PartFrameStatus>;
  /**
   * Human-readable label for the "currently doing" step. Drives the global
   * generation pill: e.g. "Writing part 2 of 5", "Rendering ending frame
   * for part 2", "Done". Always reflects the latest in-flight work.
   */
  stage: string;
}

/** A flat snapshot of every active job — used by the global progress pill. */
export interface GenerationSnapshot {
  projectId: string;
  projectTitle: string;
  status: GenerationJob["status"];
  total: number;
  current: number;
  stage: string;
  framesPending: number;
  framesDone: number;
  startedAt: number;
}

export interface GenerationContextValue {
  getJob: (projectId: string) => GenerationJob | null;
  startGeneration: (config: GenerationConfig) => void;
  generateNextPart: (projectId: string) => void;
  cancel: (projectId: string) => void;
  clear: (projectId: string) => void;
  replaceJobPart: (projectId: string, replacement: ProjectPart) => void;
  /** Active jobs across all projects — drives the global progress pill. */
  activeSnapshots: GenerationSnapshot[];
}

export const GenerationContext = createContext<GenerationContextValue | null>(
  null,
);

export function useGeneration(): GenerationContextValue {
  const ctx = useContext(GenerationContext);
  if (!ctx)
    throw new Error("useGeneration must be used inside GenerationProvider");
  return ctx;
}
