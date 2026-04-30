import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Loader2,
  Play,
  Diamond,
  ArrowDownToLine,
  Volume2,
  Music as MusicIcon,
  X,
  StopCircle,
  ClipboardCopy,
  Check,
  Pencil,
  ChevronDown,
  ChevronUp,
  Send,
  Upload,
  Image as ImageIcon,
  Star,
  FileJson,
  FileText,
  Scissors,
  Trash2,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import {
  editVideoPrompts,
  expandPrompt,
  trimPrompt,
  useGenerateFrameImage,
} from "@workspace/api-client-react";
import { buildPreviousPartDigests } from "@/lib/part-digest";
import { extractEnvelopeError, extractErrorMessage } from "@/lib/api-call";
import {
  storage,
  DEFAULT_FRAME_SETTINGS,
  DEFAULT_PROMPT_MODE,
  MAX_REFERENCE_IMAGES,
  ProjectStorageQuotaError,
  VIDEO_MODELS,
  getVideoModelMeta,
  type AspectRatio,
  type FrameSettings,
  type Project,
  type ProjectPart,
  type PromptMode,
  type ReferenceImage,
  type VideoModel,
  type VoiceoverLanguage,
} from "@/lib/storage";
import { useGeneration } from "@/lib/use-generation";
import { imageRefSrc, hasImage, objectPathToUrl } from "@/lib/image-url";
import { ErrorCard } from "@/components/error-card";
import { CopyButton } from "@/components/copy-button";
import { Progress } from "@/components/ui/progress";

// DUAL-MODE: copyable prompts should land in this character band. Outside the
// band the UI lights up "Expand" / "Trim" buttons which call the matching
// /expand-prompt or /trim-prompt routes.
const COPYABLE_BAND_MIN = 4200;
const COPYABLE_BAND_MAX = 4500;
// Hard cap on per-image upload size (400 KB raw bytes ≈ ~533 KB after base64).
// Worst case 5 images = ~2.7 MB, leaving comfortable headroom inside the
// browser's ~5 MB localStorage bucket for the rest of the project + parts.
const MAX_REFERENCE_IMAGE_BYTES = 400_000;
// Soft budget on the cumulative encoded payload of all reference images on a
// single project (~3 MB of base64). This is checked before each upload so we
// never let the user push the project over the localStorage quota.
const TOTAL_REFERENCE_PAYLOAD_BUDGET = 3_000_000;
const ACCEPTED_IMAGE_MIME = ["image/png", "image/jpeg", "image/webp"];

function estimatedReferencePayloadBytes(refs: ReferenceImage[]): number {
  // Both shapes contribute to the budget: legacy inline base64 is huge,
  // post-migration objectPath refs are tiny strings (~50 chars). We count
  // whichever is set.
  return refs.reduce(
    (sum, r) =>
      sum +
      (r.b64Json?.length ?? 0) +
      (r.objectPath?.length ?? 0) +
      (r.name?.length ?? 0) +
      100,
    0,
  );
}

function newRefImageId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `ref_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function fileToReferenceImage(file: File): Promise<ReferenceImage> {
  return new Promise((resolve, reject) => {
    if (!ACCEPTED_IMAGE_MIME.includes(file.type)) {
      reject(new Error("Only PNG, JPEG, or WEBP images are supported."));
      return;
    }
    if (file.size > MAX_REFERENCE_IMAGE_BYTES) {
      reject(
        new Error(
          `Image is too large (${Math.round(file.size / 1024)} KB). Max ${MAX_REFERENCE_IMAGE_BYTES / 1000} KB.`,
        ),
      );
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read that file."));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("Could not decode that file."));
        return;
      }
      // result is "data:<mime>;base64,<payload>" — strip the prefix.
      const comma = result.indexOf(",");
      const b64 = comma >= 0 ? result.slice(comma + 1) : result;
      resolve({
        id: newRefImageId(),
        name: file.name.slice(0, 80) || "upload",
        kind: "character",
        source: "upload",
        b64Json: b64,
        mimeType: file.type,
      });
    };
    reader.readAsDataURL(file);
  });
}

const VO_TONES = [
  "energetic",
  "cinematic",
  "conversational",
  "motivational",
  "mysterious",
  "humorous",
];

const BGM_PRESETS: Array<{ name: string; tempo: string; instruments: string[] }> = [
  {
    name: "Cinematic Orchestral",
    tempo: "110 BPM",
    instruments: ["strings", "percussion", "piano"],
  },
  {
    name: "Driving Synthwave",
    tempo: "120 BPM",
    instruments: ["synths", "drum machine", "bass"],
  },
  {
    name: "Dark Ambient",
    tempo: "70 BPM",
    instruments: ["pads", "sub bass", "drones"],
  },
  {
    name: "Hip-Hop Trap",
    tempo: "140 BPM",
    instruments: ["808s", "hi-hats", "synths"],
  },
  {
    name: "Indie Folk",
    tempo: "100 BPM",
    instruments: ["acoustic guitar", "soft drums", "vocals"],
  },
  {
    name: "Lo-Fi Beats",
    tempo: "85 BPM",
    instruments: ["lo-fi piano", "vinyl crackle", "soft drums"],
  },
];

function suggestBgm(mood: string): { name: string; tempo: string; instruments: string[] } {
  const m = (mood || "").toLowerCase();
  if (/\b(dark|gothic|horror|dread|tense)\b/.test(m)) return BGM_PRESETS[2];
  if (/\b(cyber|neon|synth|tech|future)\b/.test(m)) return BGM_PRESETS[1];
  if (/\b(hip|trap|street|urban)\b/.test(m)) return BGM_PRESETS[3];
  if (/\b(folk|nostalg|warm|indie|gentle)\b/.test(m)) return BGM_PRESETS[4];
  if (/\b(chill|lo-?fi|melancholic|slow)\b/.test(m)) return BGM_PRESETS[5];
  return BGM_PRESETS[0];
}

interface Props {
  project: Project;
  style: string;
  partsCount: number;
  initialVoiceoverLanguage: VoiceoverLanguage;
  onProjectUpdated: (p: Project) => void;
  /**
   * When true, automatically kick off generation once after mount if no job
   * exists yet for this project and no parts have been generated. Used by the
   * Story Builder's "Finalize" → generate flow.
   */
  autoStart?: boolean;
}

export function InlinePrompts({
  project,
  style,
  partsCount,
  initialVoiceoverLanguage,
  onProjectUpdated,
  autoStart = false,
}: Props) {
  // The user's intended total runtime (was originally encoded as
  // `partsCount * 15` in story.tsx where every part = 15s). We preserve
  // that target total but RE-CUT it per the chosen model's clip length
  // below — so the script's scenes auto-fit each model's strengths
  // (Veo = 8s scenes, Sora = 20s, Luma = 9s, Seedance = 15s, etc.)
  // instead of being locked to a generic 15s slice.
  const targetTotalSeconds = partsCount * 15;
  const generation = useGeneration();
  const job = generation.getJob(project.id);

  const [voLanguage, setVoLanguage] = useState<VoiceoverLanguage>(
    job?.config.voiceoverLanguage ?? initialVoiceoverLanguage,
  );
  const [voTone, setVoTone] = useState<string>(
    job?.config.voiceoverTone ?? "cinematic",
  );
  const [voPanelOpen, setVoPanelOpen] = useState(false);
  const initialBgm = useMemo(
    () => suggestBgm(project.story?.mood ?? ""),
    [project.story?.mood],
  );
  const [bgm, setBgm] = useState<{
    name: string;
    tempo: string;
    instruments: string[];
  } | null>(job?.config.bgm ?? initialBgm);
  const [bgmPanelOpen, setBgmPanelOpen] = useState(false);

  // FRAMES + DUAL-MODE state. Initialised from the active job (if a generation
  // is mid-flight) so the controls reflect what's actually being used, then
  // falls back to the project's persisted settings, then to the defaults.
  const [mode, setMode] = useState<PromptMode>(
    job?.config.mode ?? project.promptMode ?? DEFAULT_PROMPT_MODE,
  );
  // Target video model — picked here in the dashboard right after Finalize so
  // the user locks the generator (Veo / Sora / Seedance / etc.) BEFORE the
  // first prompt is generated. Mirrors the project's persisted videoModel
  // when no job is active. Once a job starts (or any parts already exist)
  // the picker is disabled — switching mid-run would split the show across
  // two model dialects.
  const [videoModel, setVideoModel] = useState<VideoModel>(
    job?.config.videoModel ?? project.videoModel,
  );
  const currentModelMeta = useMemo(
    () => getVideoModelMeta(videoModel),
    [videoModel],
  );
  // Per-model adaptive scene length. Each model gets scenes sized to its
  // single-clip sweet spot — so the script is cut into as many scenes as
  // make sense for THAT model, instead of a uniform 15s grid.
  const effectivePartDuration = currentModelMeta.durationRangeSeconds.max;
  const effectivePartsCount = Math.max(
    1,
    Math.ceil(targetTotalSeconds / effectivePartDuration),
  );
  // Defensive sync: if a job appears AFTER mount (e.g. background generation
  // started from another route, or the user navigated away mid-run and came
  // back), pull the in-flight model into local state so the (now-disabled)
  // picker accurately reflects what the API was actually called with.
  useEffect(() => {
    const inFlightModel = job?.config.videoModel;
    if (inFlightModel && inFlightModel !== videoModel) {
      setVideoModel(inFlightModel);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.config.videoModel]);
  const [frameSettings, setFrameSettings] = useState<FrameSettings>(
    job?.config.frameSettings ??
      project.frameSettings ??
      DEFAULT_FRAME_SETTINGS,
  );
  const [referenceImages, setReferenceImages] = useState<ReferenceImage[]>(
    job?.config.referenceImages ?? project.referenceImages ?? [],
  );
  const [refPanelOpen, setRefPanelOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Persist frames-spec / dual-mode meta back to the project whenever the
  // user toggles something. We DON'T persist on first mount — that would
  // bump updatedAt for every project opened — so a ref tracks whether the
  // user has actually interacted with the controls yet.
  const userTouchedMetaRef = useRef(false);
  // Snapshot of the last-persisted referenceImages so we can roll back the
  // visible state if the browser refuses the write (quota exceeded).
  const lastPersistedRefImagesRef = useRef<ReferenceImage[]>(
    project.referenceImages ?? [],
  );
  useEffect(() => {
    if (!userTouchedMetaRef.current) return;
    const fresh = storage.getProject(project.id);
    if (!fresh) return;
    try {
      const saved = storage.saveProject({
        ...fresh,
        promptMode: mode,
        frameSettings,
        referenceImages,
        videoModel,
      });
      lastPersistedRefImagesRef.current = referenceImages;
      onProjectUpdated(saved);
      window.dispatchEvent(new Event("cs:projects-changed"));
    } catch (err) {
      if (err instanceof ProjectStorageQuotaError) {
        toast.error(err.message);
        // Roll the visible reference list back to whatever last persisted —
        // mode/frameSettings flips are tiny so we keep those, but the heavy
        // base64 blob that just blew the quota is reverted.
        setReferenceImages(lastPersistedRefImagesRef.current);
        return;
      }
      throw err;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, frameSettings, referenceImages, videoModel]);

  const markTouched = () => {
    userTouchedMetaRef.current = true;
  };

  const setModeAndPersist = (next: PromptMode) => {
    markTouched();
    setMode(next);
  };
  const setVideoModelAndPersist = (next: VideoModel) => {
    if (next === videoModel) return;
    markTouched();
    setVideoModel(next);
    const meta = getVideoModelMeta(next);
    toast.success(
      `Target model set to ${meta.name} ${meta.version} · ${meta.durationRangeSeconds.min}-${meta.durationRangeSeconds.max}s per clip`,
    );
  };
  const toggleFrameSetting = (key: keyof FrameSettings) => {
    markTouched();
    setFrameSettings((cur) => ({ ...cur, [key]: !cur[key] }));
  };

  const removeReferenceImage = (id: string) => {
    markTouched();
    setReferenceImages((cur) => cur.filter((r) => r.id !== id));
  };

  const handleReferenceFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      const remaining = MAX_REFERENCE_IMAGES - referenceImages.length;
      if (remaining <= 0) {
        toast.error(
          `You already have ${MAX_REFERENCE_IMAGES} reference images. Remove one first.`,
        );
        return;
      }
      const slice = Array.from(files).slice(0, remaining);
      if (files.length > remaining) {
        toast.message(
          `Only added the first ${remaining} — limit is ${MAX_REFERENCE_IMAGES}.`,
        );
      }
      const added: ReferenceImage[] = [];
      let runningBytes = estimatedReferencePayloadBytes(referenceImages);
      let budgetHit = false;
      for (const f of slice) {
        try {
          const ref = await fileToReferenceImage(f);
          const refBytes =
            (ref.b64Json?.length ?? 0) + (ref.name?.length ?? 0) + 100;
          if (runningBytes + refBytes > TOTAL_REFERENCE_PAYLOAD_BUDGET) {
            budgetHit = true;
            break;
          }
          added.push(ref);
          runningBytes += refBytes;
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Couldn't add image";
          toast.error(msg);
        }
      }
      if (budgetHit) {
        toast.error(
          "Reference images would exceed browser storage budget. Remove an image first or upload smaller files.",
        );
      }
      if (added.length > 0) {
        markTouched();
        setReferenceImages((cur) => [...cur, ...added]);
        toast.success(
          `Added ${added.length} reference image${added.length === 1 ? "" : "s"}`,
        );
      }
    },
    [referenceImages],
  );

  // Mirror finished parts back into local project state on every part completion
  useEffect(() => {
    if (!job) return;
    if (job.parts.length > 0 && job.parts.length !== project.parts.length) {
      const fresh = storage.getProject(project.id);
      if (fresh) onProjectUpdated(fresh);
    }
    if (job.status === "awaiting_next" && job.parts.length > 0) {
      // AUTO-CHAIN: as soon as a part completes, kick off the next one
      // automatically so the whole multi-part run feels like a single
      // continuous generation. The user no longer has to click
      // "Generate next prompt" between parts. This matches the standalone
      // /generate page behavior. The job slot for `current` is already
      // advanced server-side in generation-context.runOnePart, so calling
      // generateNextPart here is safe.
      toast.success(
        `Part ${job.parts.length} ready · starting Part ${job.parts.length + 1}…`,
      );
      generation.generateNextPart(project.id);
    }
    if (job.status === "done") {
      toast.success(
        `All ${job.parts.length} parts generated`,
      );
      const fresh = storage.getProject(project.id);
      if (fresh) onProjectUpdated(fresh);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.status, job?.parts.length]);

  const generating = job?.status === "running";
  const awaitingNext = job?.status === "awaiting_next";
  const parts: ProjectPart[] = job?.parts && job.parts.length > 0
    ? job.parts
    : project.parts;
  const nextPartNumber = (job?.current ?? parts.length) + 1;
  // Once a job is in flight, lock to its part count (so changing the model
  // mid-run doesn't shift the displayed total). Before any job exists, use
  // the model-adaptive count so the user sees what THIS model will produce.
  const totalParts = job?.total ?? effectivePartsCount;
  const allDone = job?.status === "done" || (parts.length >= totalParts && parts.length > 0);
  // We only surface the runtime/scene-count summary in the header AFTER the
  // user clicks Generate. Pre-generation, the panel is purely a setup form
  // with the model picker and creative settings — nothing pre-committed.
  const showRuntimeSummary = generating || awaitingNext || parts.length > 0;

  const startGeneration = () => {
    if (!project.story) {
      toast.error("Save the story first");
      return;
    }
    generation.startGeneration({
      projectId: project.id,
      story: project.story,
      style,
      // MODEL-ADAPTIVE SCENE CUTTING: instead of the original prop's
      // hardcoded 15s × N split, we re-cut the script into scenes sized
      // to the chosen generator's clip length (Veo = 8s, Sora = 20s,
      // Luma = 9s, Seedance = 15s, etc.) while preserving the user's
      // target total runtime. Each scene is one model clip — the writer
      // then optimises shots inside it via shotCountMath.
      partsCount: effectivePartsCount,
      partDuration: effectivePartDuration,
      voiceoverLanguage: voLanguage,
      voiceoverTone: voTone,
      bgm,
      mode,
      frameSettings,
      referenceImages,
      aspectRatio: project.aspectRatio,
      // Use the locally-picked videoModel directly so the dropdown choice is
      // honored even before the persist useEffect has flushed `project`.
      videoModel,
      // The writer embeds the explicit "Image 1 / Image 2" first-and-last-
      // frame keyframe header whenever both frame slots are on for this
      // project. See GenerationConfig.framesAsImageReferences for the
      // full rationale.
      framesAsImageReferences:
        frameSettings.startingFrameEnabled && frameSettings.endingFrameEnabled,
    });
  };

  const generateNext = () => {
    generation.generateNextPart(project.id);
  };

  // Auto-start generation once when the panel mounts due to "Finalize" — only
  // if there's no existing job for this project AND no parts already saved.
  // Guarded by a ref so re-renders don't re-trigger.
  const autoStartedRef = useRef(false);
  useEffect(() => {
    if (!autoStart) return;
    if (autoStartedRef.current) return;
    if (job) return;
    if (project.parts.length > 0) return;
    if (!project.story) return;
    autoStartedRef.current = true;
    startGeneration();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart, project.id]);

  const cancelGeneration = () => {
    generation.cancel(project.id);
    toast.message("Generation stopped");
  };

  const buildAllPartsText = (): string => {
    const lines: string[] = [];
    lines.push(`# ${project.title}`);
    if (project.story) {
      lines.push(``);
      lines.push(`## Story`);
      lines.push(project.story.synopsis);
    }
    lines.push(``);
    lines.push(`Style: ${style}`);
    const effDur = job?.config.partDuration ?? effectivePartDuration;
    lines.push(`Total scenes: ${parts.length} × ${effDur}s · ${currentModelMeta.name} ${currentModelMeta.version}`);
    if (voLanguage !== "none") lines.push(`Voiceover: ${voLanguage}`);
    if (bgm) lines.push(`BGM: ${bgm.name} (${bgm.tempo})`);
    parts.forEach((p) => {
      lines.push(``);
      lines.push(`---`);
      lines.push(`# PART ${p.partNumber}`);
      lines.push(``);
      lines.push(p.copyablePrompt);
      lines.push(``);
      lines.push(`Last frame: ${p.lastFrameDescription}`);
    });
    return lines.join("\n");
  };

  const downloadAll = () => {
    if (parts.length === 0) return;
    const blob = new Blob([buildAllPartsText()], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${project.title.replace(/\s+/g, "_")}-prompts.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const [copyAllState, setCopyAllState] = useState<"idle" | "copied" | "error">(
    "idle",
  );
  const copyAllParts = async () => {
    if (parts.length === 0) return;
    const text = buildAllPartsText();
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopyAllState("copied");
      toast.success(`Copied all ${parts.length} parts to clipboard`);
      window.setTimeout(() => setCopyAllState("idle"), 2200);
    } catch {
      setCopyAllState("error");
      toast.error("Could not copy to clipboard");
      window.setTimeout(() => setCopyAllState("idle"), 2200);
    }
  };

  return (
    <section
      className="mt-12 border border-border rounded-md bg-card overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-300"
      data-testid="inline-prompts-section"
    >
      <div className="px-4 md:px-6 py-4 border-b border-border bg-background/50 flex flex-wrap items-center gap-3">
        <div className="text-[10px] font-mono uppercase tracking-widest text-primary">
          Video Prompts
        </div>
        <span className="text-muted-foreground/40">·</span>
        <div className="font-mono text-xs uppercase tracking-widest text-foreground">
          {style}
        </div>
        {showRuntimeSummary ? (
          <>
            <span className="text-muted-foreground/40">·</span>
            <div className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
              {(() => {
                const dur = job?.config.partDuration ?? effectivePartDuration;
                const sceneWord = totalParts === 1 ? "scene" : "scenes";
                if (allDone && parts.length > 0) {
                  return `${parts.length * dur}s · ${parts.length} ${sceneWord} · ${dur}s/clip`;
                }
                if (generating || awaitingNext || parts.length > 0) {
                  return `${parts.length}/${totalParts} ${sceneWord} ready · ${dur}s/clip`;
                }
                return `${totalParts * dur}s · ${totalParts} ${sceneWord} · ${dur}s/clip`;
              })()}
            </div>
          </>
        ) : (
          <>
            <span className="text-muted-foreground/40">·</span>
            <div className="font-mono text-xs uppercase tracking-widest text-muted-foreground/70">
              Pick model + settings, then Generate
            </div>
          </>
        )}
        {generating && (
          <span className="ml-auto inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-widest text-primary">
            <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
            Generating in background — safe to navigate away
          </span>
        )}
      </div>

      {/* TARGET MODEL: surfaced inline right after Finalize so the user
          locks the generator (Veo / Sora / Seedance / etc.) BEFORE the
          first prompt is generated. The writer tunes its dialect, realism
          block, and single-take boost off this choice — switching mid-run
          would split the show across two model dialects, so we lock the
          picker once any part exists or a job is active. */}
      <div className="px-4 md:px-6 py-4 border-b border-border bg-primary/[0.03]">
        <div className="flex flex-wrap items-start gap-4">
          <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground w-24 mt-2">
            Target model
          </div>
          <div className="flex-1 min-w-[260px]">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-[9px] font-mono uppercase tracking-widest text-primary">
                {currentModelMeta.durationRangeSeconds.min}-
                {currentModelMeta.durationRangeSeconds.max}s · per clip
              </span>
              <span className="text-muted-foreground/40">·</span>
              <span className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground">
                Recommended mode: {currentModelMeta.preferredMode}
              </span>
              {(generating || parts.length > 0) && (
                <span className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground/70">
                  · locked for this run
                </span>
              )}
            </div>
            <select
              value={videoModel}
              disabled={generating || parts.length > 0}
              onChange={(e) =>
                setVideoModelAndPersist(e.target.value as VideoModel)
              }
              className="w-full bg-background border border-border rounded-md px-2 py-1.5 font-display text-base tracking-tight focus:outline-none focus:border-primary disabled:opacity-50 disabled:cursor-not-allowed"
              data-testid="select-video-model-inline"
            >
              {VIDEO_MODELS.map((m) => (
                <option key={m.slug} value={m.slug}>
                  {m.name} {m.version} — {m.maker} ({m.durationRangeSeconds.min}-{m.durationRangeSeconds.max}s)
                </option>
              ))}
            </select>
            <div className="mt-1.5 text-[11px] text-muted-foreground/85 leading-snug">
              {currentModelMeta.blurb}
            </div>
            <div className="mt-2 text-[10px] font-mono text-primary/80 leading-snug">
              Scenes will auto-fit to {currentModelMeta.name} {currentModelMeta.version}'s {effectivePartDuration}s per-clip strength — the AI cuts your script into the natural number of scenes for this model.
            </div>
          </div>
        </div>
      </div>

      {/* DUAL-MODE: Output mode selector */}
      <div className="px-4 md:px-6 py-4 border-b border-border flex flex-wrap items-center gap-3">
        <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground w-24">
          Output mode
        </div>
        <div
          role="radiogroup"
          aria-label="Output mode"
          className="inline-flex rounded-md border border-border overflow-hidden"
          data-testid="mode-selector"
        >
          <button
            type="button"
            role="radio"
            aria-checked={mode === "json"}
            onClick={() => setModeAndPersist("json")}
            disabled={generating}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
              mode === "json"
                ? "bg-primary text-black"
                : "bg-transparent text-muted-foreground hover:text-foreground"
            }`}
            data-testid="mode-json"
          >
            <Star className="w-3 h-3 fill-current" /> JSON
            <span className="opacity-70 normal-case tracking-normal">recommended</span>
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={mode === "normal"}
            onClick={() => setModeAndPersist("normal")}
            disabled={generating}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest transition-colors disabled:opacity-50 disabled:cursor-not-allowed border-l border-border ${
              mode === "normal"
                ? "bg-primary text-black"
                : "bg-transparent text-muted-foreground hover:text-foreground"
            }`}
            data-testid="mode-normal"
          >
            <FileText className="w-3 h-3" /> Normal
          </button>
        </div>
        <span className="text-[11px] text-muted-foreground/80 font-mono">
          {mode === "json"
            ? "Seedance 2.0 JSON envelope (parses more reliably)"
            : "Human-readable structured text"}
        </span>
      </div>

      {/* FRAMES: Frame settings toggles */}
      <div className="px-4 md:px-6 py-4 border-b border-border flex flex-wrap items-center gap-3">
        <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground w-24">
          Frames
        </div>
        <FrameToggle
          label="Starting frame"
          checked={frameSettings.startingFrameEnabled}
          disabled={generating}
          onClick={() => toggleFrameSetting("startingFrameEnabled")}
          testId="toggle-starting-frame"
        />
        <FrameToggle
          label="Ending frame"
          checked={frameSettings.endingFrameEnabled}
          disabled={generating}
          onClick={() => toggleFrameSetting("endingFrameEnabled")}
          testId="toggle-ending-frame"
        />
        <FrameToggle
          label="Scene breakdown"
          checked={frameSettings.sceneBreakdownEnabled}
          disabled={generating}
          onClick={() => toggleFrameSetting("sceneBreakdownEnabled")}
          testId="toggle-scene-breakdown"
        />
      </div>

      {/* FRAMES: Reference images */}
      <div className="px-4 md:px-6 py-4 border-b border-border space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground w-24">
            References
          </div>
          <button
            type="button"
            onClick={() => setRefPanelOpen((v) => !v)}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md border border-border text-xs font-mono uppercase tracking-widest text-muted-foreground hover:border-primary hover:text-primary transition-colors"
            data-testid="button-ref-images-toggle"
            aria-expanded={refPanelOpen}
          >
            <ImageIcon className="w-3 h-3" />
            {referenceImages.length} / {MAX_REFERENCE_IMAGES} images
            {refPanelOpen ? (
              <ChevronUp className="w-3 h-3" />
            ) : (
              <ChevronDown className="w-3 h-3" />
            )}
          </button>
          <span className="text-[11px] text-muted-foreground/80 font-mono">
            Sent inline to Claude on every part
          </span>
        </div>
        {refPanelOpen && (
          <div className="ml-0 md:ml-24 border border-border rounded-md p-3 bg-background space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={
                  generating ||
                  referenceImages.length >= MAX_REFERENCE_IMAGES
                }
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md border border-border text-[10px] font-mono uppercase tracking-widest hover:border-primary hover:text-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                data-testid="button-ref-upload"
              >
                <Upload className="w-3 h-3" /> Upload image
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPTED_IMAGE_MIME.join(",")}
                multiple
                className="hidden"
                onChange={(e) => {
                  void handleReferenceFiles(e.target.files);
                  e.target.value = "";
                }}
                data-testid="input-ref-file"
              />
              <span className="text-[10px] font-mono text-muted-foreground/70">
                PNG / JPEG / WEBP · max{" "}
                {Math.round(MAX_REFERENCE_IMAGE_BYTES / 1000)} KB each · max{" "}
                {MAX_REFERENCE_IMAGES} total
              </span>
            </div>
            {referenceImages.length === 0 ? (
              <div className="text-[11px] text-muted-foreground italic">
                No references yet. Upload character sheets, location stills, or
                style boards so every prompt stays visually consistent.
              </div>
            ) : (
              <ul
                className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2"
                data-testid="ref-images-grid"
              >
                {referenceImages.map((r) => (
                  <li
                    key={r.id}
                    className="relative border border-border rounded-md bg-card overflow-hidden"
                    data-testid={`ref-image-${r.id}`}
                  >
                    <img
                      src={imageRefSrc(r)}
                      alt={r.name}
                      className="w-full h-24 object-cover"
                    />
                    <div className="px-2 py-1 text-[10px] font-mono truncate text-muted-foreground">
                      {r.name}
                    </div>
                    <div className="absolute top-1 left-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-black/70 text-[9px] font-mono uppercase tracking-widest text-white">
                      {r.source === "auto" ? (
                        <>auto</>
                      ) : (
                        <>
                          <Upload className="w-2.5 h-2.5" /> upload
                        </>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => removeReferenceImage(r.id)}
                      disabled={generating}
                      className="absolute top-1 right-1 inline-flex items-center justify-center w-6 h-6 rounded bg-black/70 text-white hover:bg-red-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      data-testid={`button-ref-remove-${r.id}`}
                      aria-label={`Remove ${r.name}`}
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* Audio attachment */}
      <div className="px-4 md:px-6 py-5 border-b border-border space-y-4">
        {/* Voiceover row */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground w-24">
            Voiceover
          </div>
          {voLanguage !== "none" ? (
            <div
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs font-mono"
              data-testid="chip-voiceover"
            >
              <Volume2 className="w-3 h-3" />
              {voLanguage} · {voTone}
              <button
                type="button"
                onClick={() => setVoLanguage("none")}
                disabled={generating}
                className="ml-1 opacity-60 hover:opacity-100 disabled:cursor-not-allowed"
                data-testid="button-vo-remove"
                aria-label="Remove voiceover"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setVoPanelOpen((v) => !v)}
              disabled={generating}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md border border-border text-xs font-mono uppercase tracking-widest text-muted-foreground hover:border-primary hover:text-primary disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              data-testid="button-vo-add"
            >
              + Add voiceover
            </button>
          )}
          {voLanguage !== "none" && (
            <button
              type="button"
              onClick={() => setVoPanelOpen((v) => !v)}
              disabled={generating}
              className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground hover:text-primary disabled:opacity-50"
              data-testid="button-vo-change"
            >
              Change
            </button>
          )}
        </div>
        {voPanelOpen && (
          <div className="ml-0 md:ml-24 border border-border rounded-md p-3 bg-background space-y-3">
            <div>
              <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-2">
                Language
              </div>
              <div className="flex gap-2 flex-wrap">
                {(["english", "hindi", "hinglish", "none"] as const).map(
                  (l) => (
                    <button
                      key={l}
                      type="button"
                      onClick={() => {
                        setVoLanguage(l);
                        if (l === "none") setVoPanelOpen(false);
                      }}
                      className={`px-3 py-1.5 rounded-md text-xs font-mono uppercase tracking-widest border transition-colors ${
                        voLanguage === l
                          ? "bg-primary text-black border-primary"
                          : "border-border text-muted-foreground hover:border-foreground/30"
                      }`}
                      data-testid={`vo-lang-${l}`}
                    >
                      {l === "hindi" ? "हिंदी" : l}
                    </button>
                  ),
                )}
              </div>
            </div>
            {voLanguage !== "none" && (
              <div>
                <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-2">
                  Tone
                </div>
                <div className="flex gap-2 flex-wrap">
                  {VO_TONES.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setVoTone(t)}
                      className={`px-3 py-1 rounded-md text-[10px] font-mono uppercase tracking-widest border transition-colors ${
                        voTone === t
                          ? "bg-primary text-black border-primary"
                          : "border-border text-muted-foreground hover:border-foreground/30"
                      }`}
                      data-testid={`vo-tone-${t}`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* BGM row */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground w-24">
            BGM
          </div>
          {bgm ? (
            <div
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-primary/10 border border-primary/30 text-primary text-xs font-mono"
              data-testid="chip-bgm"
            >
              <MusicIcon className="w-3 h-3" />
              {bgm.name} · {bgm.tempo}
              <button
                type="button"
                onClick={() => setBgm(null)}
                disabled={generating}
                className="ml-1 opacity-60 hover:opacity-100 disabled:cursor-not-allowed"
                data-testid="button-bgm-remove"
                aria-label="Remove BGM"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setBgm(initialBgm)}
              disabled={generating}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md border border-border text-xs font-mono uppercase tracking-widest text-muted-foreground hover:border-primary hover:text-primary disabled:opacity-50 transition-colors"
              data-testid="button-bgm-add"
            >
              + Add BGM
            </button>
          )}
          <button
            type="button"
            onClick={() => setBgmPanelOpen((v) => !v)}
            disabled={generating}
            className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground hover:text-primary disabled:opacity-50"
            data-testid="button-bgm-change"
          >
            Change BGM
          </button>
        </div>
        {bgmPanelOpen && (
          <div className="ml-0 md:ml-24 border border-border rounded-md p-3 bg-background">
            <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-2">
              Pick a style
            </div>
            <div className="flex gap-2 flex-wrap">
              {BGM_PRESETS.map((p) => (
                <button
                  key={p.name}
                  type="button"
                  onClick={() => {
                    setBgm(p);
                    setBgmPanelOpen(false);
                  }}
                  className={`px-3 py-1.5 rounded-md text-[10px] font-mono uppercase tracking-widest border transition-colors ${
                    bgm?.name === p.name
                      ? "bg-primary text-black border-primary"
                      : "border-border text-muted-foreground hover:border-foreground/30"
                  }`}
                  data-testid={`bgm-${p.name.replace(/\s+/g, "-")}`}
                >
                  {p.name} · {p.tempo}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Generate / Next / Stop button */}
      <div className="px-4 md:px-6 py-5 border-b border-border flex flex-wrap items-center gap-3">
        {!generating && !awaitingNext && parts.length === 0 && (
          <button
            type="button"
            onClick={startGeneration}
            className="inline-flex items-center gap-2 px-5 py-3 rounded-md bg-primary text-black font-mono text-xs uppercase tracking-widest hover:bg-[#D4EB3A] transition-colors"
            data-testid="button-generate-prompts-inline"
          >
            <Play className="w-4 h-4" /> Generate scenes
          </button>
        )}
        {!generating && awaitingNext && nextPartNumber <= totalParts && (
          <button
            type="button"
            onClick={generateNext}
            className="relative inline-flex items-center gap-2 px-5 py-3 rounded-md bg-primary text-black font-mono text-xs uppercase tracking-widest hover:bg-[#D4EB3A] hover:shadow-[0_8px_24px_-8px_rgba(232,255,71,0.6)] hover:-translate-y-0.5 transition-all border-2 border-primary"
            data-testid="button-generate-next-prompt"
          >
            <Play className="w-4 h-4" /> Generate next prompt — part {nextPartNumber} of {totalParts}
          </button>
        )}
        {!generating && allDone && parts.length > 0 && (
          <button
            type="button"
            onClick={startGeneration}
            className="inline-flex items-center gap-2 px-5 py-3 rounded-md border border-border font-mono text-xs uppercase tracking-widest hover:border-primary hover:text-primary transition-colors"
            data-testid="button-regenerate-prompts-inline"
          >
            <Play className="w-4 h-4" /> Regenerate from part 1
          </button>
        )}
        {generating && (
          <>
            <button
              type="button"
              disabled
              className="inline-flex items-center gap-2 px-5 py-3 rounded-md bg-primary/40 text-black font-mono text-xs uppercase tracking-widest"
              data-testid="button-generate-prompts-inline"
            >
              <Loader2 className="w-4 h-4 animate-spin" /> Generating part {(job?.current ?? 0) + 1} of {totalParts}…
            </button>
            <button
              type="button"
              onClick={cancelGeneration}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-md border border-border font-mono text-xs uppercase tracking-widest hover:border-red-500 hover:text-red-400 transition-colors"
              data-testid="button-stop-generation"
            >
              <StopCircle className="w-4 h-4" /> Stop
            </button>
          </>
        )}
        {parts.length > 0 && !generating && (
          <>
            <button
              type="button"
              onClick={copyAllParts}
              className={`relative inline-flex items-center gap-2 px-5 py-3 rounded-md font-mono text-xs uppercase tracking-widest transition-all border-2 ${
                copyAllState === "copied"
                  ? "bg-green-500 border-green-500 text-black"
                  : "bg-primary border-primary text-black hover:bg-[#D4EB3A] hover:shadow-[0_8px_24px_-8px_rgba(232,255,71,0.6)] hover:-translate-y-0.5"
              }`}
              data-testid="button-copy-all-parts"
              aria-label="Copy all parts to clipboard"
            >
              {copyAllState === "copied" ? (
                <>
                  <Check className="w-4 h-4" /> Copied all {parts.length} parts!
                </>
              ) : (
                <>
                  <ClipboardCopy className="w-4 h-4" /> Copy ALL {parts.length}{" "}
                  part{parts.length === 1 ? "" : "s"}
                </>
              )}
            </button>
            <button
              type="button"
              onClick={downloadAll}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-md border border-border font-mono text-xs uppercase tracking-widest hover:border-primary hover:text-primary transition-colors"
              data-testid="button-download-all-inline"
            >
              <ArrowDownToLine className="w-4 h-4" /> Download .txt
            </button>
          </>
        )}
      </div>

      {job && (generating || awaitingNext) && (
        <div
          className="px-4 md:px-6 py-4 border-b border-border"
          data-testid="generation-progress"
          aria-live="polite"
        >
          <div className="flex items-center justify-between text-xs font-mono uppercase tracking-widest text-muted-foreground">
            <span>
              {generating
                ? `Generating part ${job.current + 1} of ${job.total}…`
                : `${job.current} of ${job.total} parts ready`}
            </span>
            <span
              className="text-primary"
              data-testid="generation-progress-percent"
            >
              {(() => {
                // Real progress = (fully-completed parts + partial credit
                // for the part currently being written) / total. The
                // generating part is given 0.5 weight because we have no
                // mid-request signal, but the UI animates smoothly as
                // each part completes (jumping by 1/total each time).
                const completed = job.current;
                const inFlight = generating ? 0.5 : 0;
                const pct = Math.min(
                  100,
                  ((completed + inFlight) / Math.max(1, job.total)) * 100,
                );
                return `${Math.round(pct)}%`;
              })()}
            </span>
          </div>
          <Progress
            className="mt-2 h-1.5"
            value={Math.min(
              100,
              ((job.current + (generating ? 0.5 : 0)) / Math.max(1, job.total)) * 100,
            )}
          />
        </div>
      )}

      {job?.status === "error" && job.error && (
        <div className="px-4 md:px-6 py-4 border-b border-border">
          <ErrorCard
            message={job.error}
            onRetry={job.parts.length > 0 ? generateNext : startGeneration}
          />
        </div>
      )}

      {parts.length > 0 && (
        <div className="px-4 md:px-6 py-6 space-y-6">
          {parts.map((p, idx) => (
            <PartCard
              key={p.partNumber}
              part={p}
              parts={parts}
              partsCount={parts.length}
              partsTotal={totalParts}
              partDuration={job?.config.partDuration ?? effectivePartDuration}
              continuesFrom={idx > 0}
              story={project.story}
              style={style}
              voLanguage={voLanguage}
              voTone={voTone}
              bgm={bgm}
              mode={mode}
              frameSettings={frameSettings}
              referenceImages={referenceImages}
              characterImages={project.characterImages?.items ?? null}
              projectId={project.id}
              aspectRatio={project.aspectRatio}
              videoModel={job?.config.videoModel ?? videoModel}
              onPartUpdated={(updated) => {
                const saved = storage.replaceProjectPart(project.id, updated);
                if (saved) {
                  onProjectUpdated(saved);
                  window.dispatchEvent(new Event("cs:projects-changed"));
                }
                generation.replaceJobPart(project.id, updated);
              }}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function FrameToggle({
  label,
  checked,
  disabled,
  onClick,
  testId,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onClick: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-md border text-[10px] font-mono uppercase tracking-widest transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
        checked
          ? "border-primary text-primary bg-primary/10"
          : "border-border text-muted-foreground hover:border-foreground/30"
      }`}
      data-testid={testId}
    >
      <span
        className={`inline-flex w-7 h-4 rounded-full p-0.5 transition-colors ${
          checked ? "bg-primary" : "bg-muted"
        }`}
        aria-hidden
      >
        <span
          className={`w-3 h-3 rounded-full bg-background transition-transform ${
            checked ? "translate-x-3" : ""
          }`}
        />
      </span>
      {label}
    </button>
  );
}

function PartCard({
  part,
  parts,
  partsCount,
  partsTotal,
  partDuration,
  continuesFrom,
  story,
  style,
  voLanguage,
  voTone,
  bgm,
  mode,
  frameSettings,
  referenceImages,
  characterImages,
  projectId,
  aspectRatio,
  videoModel,
  onPartUpdated,
}: {
  part: ProjectPart;
  parts: ProjectPart[];
  partsCount: number;
  partsTotal: number;
  partDuration: number;
  continuesFrom: boolean;
  story: Project["story"];
  style: string;
  voLanguage: VoiceoverLanguage;
  voTone: string;
  bgm: { name: string; tempo: string; instruments: string[] } | null;
  mode: PromptMode;
  frameSettings: FrameSettings;
  referenceImages: ReferenceImage[];
  /**
   * Cast reference sheets keyed by character name (from
   * `project.characterImages.items`). Threaded down so the per-part
   * "Generate frame image" call can attach them to Gemini for likeness
   * consistency across shots. `null` means no cast images cached yet.
   */
  characterImages:
    | Record<
        string,
        { objectPath?: string; b64Json?: string; mimeType: string }
      >
    | null;
  /** Project id, needed for read-modify-write of the part on completion. */
  projectId: string;
  /**
   * Aspect ratio chosen for this project. Forwarded to the per-part
   * "Generate frame image" call so the manual still matches the project's
   * video ratio (and the auto-generated stills, which already use it).
   */
  aspectRatio?: AspectRatio;
  /**
   * Target video generation model for this project. Forwarded to the
   * /edit-video-prompts call so the refined copyablePrompt stays in the
   * dialect the original part was written in.
   */
  videoModel: VideoModel;
  onPartUpdated: (updated: ProjectPart) => void;
}) {
  const [expandedShot, setExpandedShot] = useState<number | null>(null);
  const [showFullPrompt, setShowFullPrompt] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editInstruction, setEditInstruction] = useState("");
  const [editing, setEditing] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [adjusting, setAdjusting] = useState<"expand" | "trim" | null>(null);
  // FRAME IMAGES: in-flight loading state for the per-part starting / ending
  // frame Gemini calls. The result is persisted onto the part itself via
  // onPartUpdated so a refresh re-uses the rendered still instead of
  // regenerating it.
  const [frameLoading, setFrameLoading] = useState<
    "starting" | "ending" | null
  >(null);
  const frameImageMut = useGenerateFrameImage();
  // Live per-part frame status from the GenerationProvider — shows
  // "rendering starting frame…" badges so the user can see the
  // background work that follows part-prompt generation.
  const partGen = useGeneration().getJob(projectId);
  const livePartFrameStatus = partGen?.frameStatuses[String(part.partNumber)];
  const bgmName = bgm?.name ?? null;
  const bgmTempo = bgm?.tempo ?? null;
  // The mode this part was actually generated under — falls back to the
  // current project mode when older parts didn't stamp one yet.
  const partMode: PromptMode = (part.promptMode as PromptMode) ?? mode;
  const charCount = part.copyablePrompt.length;
  const inBand =
    charCount >= COPYABLE_BAND_MIN && charCount <= COPYABLE_BAND_MAX;
  const tooShort = charCount < COPYABLE_BAND_MIN;
  const tooLong = charCount > COPYABLE_BAND_MAX;
  // Per-scene timeline math uses the ACTUAL per-scene duration of this run
  // (model-adaptive — Veo=8s, Sora=20s, Luma=9s, Seedance=15s, etc.) rather
  // than the legacy hardcoded 15s grid, so the displayed timecodes reflect
  // what the user will actually render.
  const start = (part.partNumber - 1) * partDuration;
  const end = part.partNumber * partDuration;
  const fmt = (n: number) =>
    `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
  const signature = part.shots.find((s) => s.isSignature);

  const previousPart = parts.find((p) => p.partNumber === part.partNumber - 1);
  const nextPart = parts.find((p) => p.partNumber === part.partNumber + 1);

  // Close modal on Escape
  useEffect(() => {
    if (!editOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !editing) setEditOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editOpen, editing]);

  const submitEdit = async () => {
    const instruction = editInstruction.trim();
    if (!instruction) {
      setEditError("Please describe what you want to change.");
      return;
    }
    if (!story) {
      setEditError("This project has no saved story to edit against.");
      return;
    }
    setEditing(true);
    setEditError(null);
    // Close the modal IMMEDIATELY so the user gets back to the workspace
    // and can see the "Refining…" badge on the part card while the edit
    // request is still in flight. The button on the part card stays
    // disabled (driven by `editing`) until the request resolves.
    // We KEEP `editInstruction` populated so that if the request fails
    // we can re-open the modal with the user's text already in place
    // (otherwise they'd have to retype). On success we clear it below.
    setEditOpen(false);
    toast.message(`Refining Part ${part.partNumber}…`, {
      description: "You'll see the updated prompt here when it's ready.",
    });
    try {
      const result = await editVideoPrompts({
        story,
        style,
        duration: partDuration,
        part: part.partNumber,
        totalParts: partsTotal,
        instruction,
        aspectRatio,
        videoModel,
        framesAsImageReferences:
          frameSettings.startingFrameEnabled && frameSettings.endingFrameEnabled,
        existingPart: part,
        previousLastFrame: previousPart?.lastFrameDescription ?? null,
        previousParts: buildPreviousPartDigests(
          parts.filter((p) => p.partNumber !== part.partNumber),
        ),
        nextFirstShot: nextPart?.shots[0]?.description ?? null,
        voiceoverLanguage:
          voLanguage === "none" ? null : voLanguage,
        voiceoverTone: voLanguage === "none" ? null : voTone,
        bgmStyle: bgmName,
        bgmTempo: bgmTempo,
        bgmInstruments: bgm?.instruments ?? [],
        mode,
        frameSettings,
        // Writer endpoint still expects inline base64 for refs (not yet
        // wired to load from Object Storage by path). Drop migrated
        // refs that no longer carry inline bytes; they no longer
        // influence the writer until the spec is extended. New uploads
        // (made this session) always have b64Json present.
        referenceImages: referenceImages
          .filter((r): r is typeof r & { b64Json: string } =>
            typeof r.b64Json === "string" && r.b64Json.length > 0,
          )
          .map(({ id: _id, objectPath: _op, ...rest }) => rest),
      });
      // The /edit-video-prompts route is wrapped in respondWithHeartbeat
      // server-side, which encodes mid-flight failures as a 200 response
      // with `{ "error": "..." }`. Detect that envelope before treating
      // the result as a real ProjectPart, otherwise we'd silently
      // overwrite the user's part with garbage on a server failure.
      const envelopeError = extractEnvelopeError(result);
      if (envelopeError) throw new Error(envelopeError);
      const updated: ProjectPart = {
        ...result,
        partNumber: part.partNumber,
        voiceoverLanguage: voLanguage === "none" ? null : voLanguage,
        bgmStyle: bgmName,
        bgmTempo: bgmTempo,
      };
      onPartUpdated(updated);
      toast.success(`Part ${part.partNumber} updated`);
      // Success: clear the instruction. (We deliberately did NOT clear
      // it before the await so a failed request can re-show the same
      // text in the re-opened modal — see catch branch below.)
      setEditInstruction("");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Edit failed";
      setEditError(msg);
      // Re-open the modal so the user can see the inline error AND
      // their original instruction text is still there, ready for them
      // to tweak and retry.
      setEditOpen(true);
      toast.error(`Couldn't refine Part ${part.partNumber}: ${msg}`);
    } finally {
      setEditing(false);
    }
  };

  // DUAL-MODE: ask the API to grow / shrink the prompt into the 4200-4500 band.
  const adjustLength = async (direction: "expand" | "trim") => {
    setAdjusting(direction);
    try {
      const fn = direction === "expand" ? expandPrompt : trimPrompt;
      const result = await fn({
        copyablePrompt: part.copyablePrompt,
        mode: partMode,
        targetMin: COPYABLE_BAND_MIN,
        targetMax: COPYABLE_BAND_MAX,
        // Forward the writer's selected target so the EXPAND/TRIM
        // instruction references the correct engine (e.g. "Veo 3 video"
        // instead of the legacy hardcoded "Seedance 2.0").
        videoModel,
      });
      // /expand-prompt and /trim-prompt are heartbeat-wrapped — failures
      // arrive as 200 + `{ error }` envelopes. Without this check we'd
      // overwrite copyablePrompt with `undefined` on a server failure.
      const envelopeError = extractEnvelopeError(result);
      if (envelopeError) throw new Error(envelopeError);
      const updated: ProjectPart = {
        ...part,
        copyablePrompt: result.copyablePrompt,
        promptMode: (result.mode as ProjectPart["promptMode"]) ?? part.promptMode,
      };
      onPartUpdated(updated);
      const verb = direction === "expand" ? "Expanded" : "Trimmed";
      toast.success(
        `${verb} part ${part.partNumber} → ${result.characterCount.toLocaleString()} chars`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Adjustment failed";
      toast.error(`Couldn't ${direction}: ${msg}`);
    } finally {
      setAdjusting(null);
    }
  };

  /**
   * Generate (or regenerate) a starting / ending frame still for this part.
   * Sends the writer's frame prompt + project visual style + cast reference
   * sheets (when available) to the backend so Gemini can produce one
   * consistent in-world still. The result is persisted on the part itself
   * via `onPartUpdated` → storage.replaceProjectPart, so a refresh re-uses
   * it instead of re-running Gemini.
   */
  const generateFrameImage = async (kind: "starting" | "ending") => {
    if (frameLoading) return;
    const framePrompt =
      kind === "starting"
        ? part.startingFrame?.prompt
        : part.endingFrame?.prompt;
    if (!framePrompt || framePrompt.trim().length === 0) {
      toast.error(`No ${kind} frame prompt to render.`);
      return;
    }
    setFrameLoading(kind);
    try {
      // Post-Object-Storage migration the cast references are tiny
      // `{ objectPath, mimeType }` tuples — the server fetches the bytes
      // from Object Storage just-in-time. We keep a hard upper bound of 4
      // refs since Gemini's likeness conditioning saturates past a few.
      // Items still on the legacy inline-base64 shape (objectPath missing)
      // are skipped here; the migration helper will upload them on next
      // signin.
      const REFS_MAX_COUNT = 4;
      const characterReferences: Array<{
        objectPath: string;
        mimeType: string;
      }> = [];
      if (characterImages) {
        for (const [, v] of Object.entries(characterImages)) {
          if (characterReferences.length >= REFS_MAX_COUNT) break;
          if (!v.objectPath) continue;
          characterReferences.push({
            objectPath: v.objectPath,
            mimeType: v.mimeType,
          });
        }
      }
      const result = await frameImageMut.mutateAsync({
        data: {
          framePrompt,
          style: style || "Live Action Cinematic",
          characterReferences:
            characterReferences.length > 0 ? characterReferences : undefined,
          aspectRatio,
        },
      });
      // READ-MODIFY-WRITE: read the latest version of this part from storage
      // at completion time so a concurrent edit (e.g. "Edit with prompt"
      // landed while Gemini was rendering) doesn't get clobbered. Without
      // this, the captured `part` closure variable could be stale by the
      // time we save and we'd silently undo the edit.
      const fresh = storage.getProject(projectId);
      const freshPart =
        fresh?.parts.find((p) => p.partNumber === part.partNumber) ?? part;
      const newImage = {
        objectPath: result.objectPath,
        mimeType: result.mimeType,
        generatedAt: new Date().toISOString(),
        // Capture the freshest writer prompt so the "prompt drifted" hint
        // tracks the current text, not whatever `part` had at click time.
        sourcePrompt:
          (kind === "starting"
            ? freshPart.startingFrame?.prompt
            : freshPart.endingFrame?.prompt) ?? framePrompt,
      };
      const updated: ProjectPart = {
        ...freshPart,
        ...(kind === "starting"
          ? { startingFrameImage: newImage }
          : { endingFrameImage: newImage }),
      };
      onPartUpdated(updated);
      toast.success(
        `${kind === "starting" ? "Starting" : "Ending"} frame generated for part ${part.partNumber}.`,
      );
    } catch (err) {
      const msg = extractErrorMessage(err);
      toast.error(`Couldn't generate ${kind} frame: ${msg}`);
    } finally {
      setFrameLoading(null);
    }
  };

  /**
   * Trigger a browser download of a frame image. Server-stored images
   * download via the storage URL (browser handles content-disposition);
   * legacy inline base64 still works via a data URL fallback.
   */
  const downloadFrameImage = (
    kind: "starting" | "ending",
    img: { objectPath?: string; b64Json?: string; mimeType: string },
  ) => {
    const a = document.createElement("a");
    a.href = imageRefSrc(img);
    if (!a.href) {
      toast.error("This frame has no downloadable image yet.");
      return;
    }
    const ext = img.mimeType.includes("jpeg") ? "jpg" : "png";
    a.download = `part-${part.partNumber}-${kind}-frame.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <div
      className="border border-border rounded-md bg-background"
      data-testid={`part-card-${part.partNumber}`}
    >
      <div className="flex items-center justify-between p-5 border-b border-border flex-wrap gap-3">
        <div>
          <div className="text-[10px] font-mono uppercase tracking-widest text-primary flex items-center gap-2 flex-wrap">
            <span>
              Part {part.partNumber} / {partsCount} · {fmt(start)} – {fmt(end)} ·{" "}
              {style}
            </span>
            {/* DUAL-MODE: per-part mode badge */}
            <span
              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-mono text-[9px] tracking-widest ${
                partMode === "json"
                  ? "bg-primary/15 text-primary border border-primary/40"
                  : "bg-secondary/40 text-muted-foreground border border-border"
              }`}
              data-testid={`mode-badge-${part.partNumber}`}
              title={
                partMode === "json"
                  ? "Generated as JSON envelope"
                  : "Generated as Normal mode (structured text)"
              }
            >
              {partMode === "json" ? (
                <FileJson className="w-2.5 h-2.5" />
              ) : (
                <FileText className="w-2.5 h-2.5" />
              )}
              {partMode}
            </span>
          </div>
          <div className="mt-1 font-display text-2xl tracking-tight">
            {part.shots.length} shots
          </div>
          {continuesFrom && (
            <div className="mt-1 text-[11px] font-mono text-muted-foreground">
              ↳ Continues from Part {part.partNumber - 1}
            </div>
          )}
          {signature && (
            <div className="mt-2 inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-widest text-black bg-primary px-2 py-0.5 rounded">
              <Diamond className="w-3 h-3" /> Signature: {signature.name}
            </div>
          )}
          {editing && (
            <div
              className="mt-2 inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-widest text-primary bg-primary/10 border border-primary/30 px-2 py-0.5 rounded animate-pulse"
              data-testid={`badge-refining-part-${part.partNumber}`}
              aria-live="polite"
            >
              <Loader2 className="w-3 h-3 animate-spin" /> Refining Part {part.partNumber}…
            </div>
          )}
          {/* Live per-part frame render status from GenerationProvider —
              gives the user visible feedback for the autoRenderFramesForPart
              background renders that fire after each part lands. */}
          {livePartFrameStatus && (
            <div className="mt-2 flex items-center gap-1.5 flex-wrap">
              <FrameStatusBadge
                kind="starting"
                status={livePartFrameStatus.starting}
                partNumber={part.partNumber}
              />
              <FrameStatusBadge
                kind="ending"
                status={livePartFrameStatus.ending}
                partNumber={part.partNumber}
              />
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => setEditOpen(true)}
            disabled={editing}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md border border-border font-mono text-[10px] uppercase tracking-widest text-muted-foreground hover:border-primary hover:text-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            data-testid={`button-edit-part-${part.partNumber}`}
            aria-label={`Edit part ${part.partNumber} with a prompt`}
          >
            {editing ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Refining…
              </>
            ) : (
              <>
                <Pencil className="w-3.5 h-3.5" /> Edit with prompt
              </>
            )}
          </button>
          {/* FRAMES: three copy actions — full prompt + starting/ending frame */}
          <CopyButton
            text={part.copyablePrompt}
            label="Copy full prompt"
            variant="accent"
            testId={`button-copy-part-${part.partNumber}`}
          />
          {part.startingFrame?.prompt && (
            <CopyButton
              text={part.startingFrame.prompt}
              label="Copy starting frame"
              testId={`button-copy-starting-frame-${part.partNumber}`}
            />
          )}
          {part.endingFrame?.prompt && (
            <CopyButton
              text={part.endingFrame.prompt}
              label="Copy ending frame"
              testId={`button-copy-ending-frame-${part.partNumber}`}
            />
          )}
        </div>
      </div>

      {/* DUAL-MODE: char counter + expand/trim controls */}
      <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-border bg-card/40 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
            Prompt length
          </div>
          <div
            className={`font-mono text-xs tabular-nums ${
              inBand
                ? "text-emerald-400"
                : tooShort
                  ? "text-amber-400"
                  : "text-red-400"
            }`}
            data-testid={`char-counter-${part.partNumber}`}
          >
            {charCount.toLocaleString()} chars
          </div>
          <div className="text-[10px] font-mono text-muted-foreground/70">
            target {COPYABLE_BAND_MIN.toLocaleString()}–
            {COPYABLE_BAND_MAX.toLocaleString()}
          </div>
          {inBand && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono uppercase tracking-widest text-emerald-300 bg-emerald-500/10 border border-emerald-500/30">
              <Check className="w-2.5 h-2.5" /> in band
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {tooShort && (
            <button
              type="button"
              onClick={() => adjustLength("expand")}
              disabled={adjusting !== null}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-amber-500/40 text-amber-300 font-mono text-[10px] uppercase tracking-widest hover:bg-amber-500/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              data-testid={`button-expand-prompt-${part.partNumber}`}
            >
              {adjusting === "expand" ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : null}
              Expand to band
            </button>
          )}
          {tooLong && (
            <button
              type="button"
              onClick={() => adjustLength("trim")}
              disabled={adjusting !== null}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-red-500/40 text-red-300 font-mono text-[10px] uppercase tracking-widest hover:bg-red-500/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              data-testid={`button-trim-prompt-${part.partNumber}`}
            >
              {adjusting === "trim" ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Scissors className="w-3 h-3" />
              )}
              Trim to band
            </button>
          )}
        </div>
      </div>

      <div className="p-5 space-y-5">
        {(voLanguage !== "none" || bgmName) && (
          <div className="flex flex-wrap gap-2">
            {voLanguage !== "none" && part.autoVoiceoverScript && (
              <div
                className="text-xs flex-1 min-w-full sm:min-w-[260px] px-3 py-2 rounded-md bg-emerald-500/5 border border-emerald-500/20"
                data-testid={`vo-block-${part.partNumber}`}
              >
                <div className="text-[10px] font-mono uppercase tracking-widest text-emerald-300/80 flex items-center gap-1">
                  <Volume2 className="w-3 h-3" /> Voiceover · {voLanguage}
                </div>
                <p
                  className={`mt-1 text-xs ${
                    voLanguage === "hindi" ? "font-devanagari" : ""
                  }`}
                >
                  "{part.autoVoiceoverScript}"
                </p>
              </div>
            )}
            {bgmName && (
              <div className="text-xs flex-1 min-w-full sm:min-w-[200px] px-3 py-2 rounded-md bg-primary/5 border border-primary/20">
                <div className="text-[10px] font-mono uppercase tracking-widest text-primary/80 flex items-center gap-1">
                  <MusicIcon className="w-3 h-3" /> BGM
                </div>
                <p className="mt-1 text-xs">
                  {bgmName} {bgmTempo ? `· ${bgmTempo}` : ""}
                </p>
              </div>
            )}
          </div>
        )}

        <div>
          <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-2">
            Density Map
          </div>
          <div className="flex gap-1 h-3">
            {part.densityMap.map((d, i) => (
              <div
                key={i}
                title={`${d.timeRange} · ${d.density} · ${d.effects.join(", ")}`}
                className="flex-1 rounded-sm"
                style={{
                  background:
                    d.density === "HIGH"
                      ? "#FF4444"
                      : d.density === "MEDIUM"
                        ? "#E8FF47"
                        : "#4ADE80",
                }}
              />
            ))}
          </div>
        </div>

        <div>
          <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-2">
            Shots
          </div>
          <ul className="space-y-2">
            {part.shots.map((s) => (
              <li
                key={s.shotNumber}
                className="border border-border rounded-md bg-card"
              >
                <button
                  type="button"
                  onClick={() =>
                    setExpandedShot((cur) =>
                      cur === s.shotNumber ? null : s.shotNumber,
                    )
                  }
                  className="w-full flex items-center justify-between gap-3 p-3 text-left"
                  data-testid={`inline-shot-${part.partNumber}-${s.shotNumber}`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="font-mono text-[10px] text-muted-foreground uppercase tracking-widest">
                      #{s.shotNumber}
                    </span>
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {s.timestamp}
                    </span>
                    <span className="font-display text-base tracking-tight truncate">
                      {s.name}
                    </span>
                    {s.isSignature && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-widest text-black bg-primary px-1.5 py-0.5 rounded">
                        <Diamond className="w-2.5 h-2.5" />
                      </span>
                    )}
                  </div>
                  <span className="text-[10px] font-mono text-muted-foreground">
                    {expandedShot === s.shotNumber ? "−" : "+"}
                  </span>
                </button>
                {expandedShot === s.shotNumber && (
                  <div className="border-t border-border p-3 text-xs space-y-2">
                    <div>
                      <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                        Description ·{" "}
                      </span>
                      {s.description}
                    </div>
                    {/* FRAMES: per-shot scene breakdown */}
                    {s.sceneDescription && (
                      <div
                        className="rounded-md border border-primary/20 bg-primary/5 p-2"
                        data-testid={`scene-breakdown-${part.partNumber}-${s.shotNumber}`}
                      >
                        <span className="font-mono text-[10px] uppercase tracking-widest text-primary/80">
                          Scene breakdown ·{" "}
                        </span>
                        <span className="text-foreground/90">
                          {s.sceneDescription}
                        </span>
                      </div>
                    )}
                    <div>
                      <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                        Effects ·{" "}
                      </span>
                      {s.effects.join(", ")}
                    </div>
                    <div>
                      <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                        Camera ·{" "}
                      </span>
                      {s.cameraWork}
                    </div>
                    <div>
                      <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                        Speed ·{" "}
                      </span>
                      {s.speed}
                    </div>
                    <div>
                      <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                        Exit ·{" "}
                      </span>
                      {s.transition}
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>

        {part.energyArc && (
          <div>
            <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-2">
              Energy Arc
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              {(["act1", "act2", "act3"] as const).map((k, i) => (
                <div
                  key={k}
                  className="border border-border rounded-md p-3 bg-card text-xs"
                >
                  <div className="text-[10px] font-mono uppercase tracking-widest text-primary">
                    Act {i + 1}
                  </div>
                  <p className="mt-1">{part.energyArc[k]}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* FRAMES: starting / ending frame — Gemini-rendered still + writer prompt */}
        {(part.startingFrame?.prompt || part.endingFrame?.prompt) && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {part.startingFrame?.prompt && (
              <FrameImageCard
                kind="starting"
                partNumber={part.partNumber}
                framePrompt={part.startingFrame.prompt}
                image={part.startingFrameImage ?? null}
                loading={frameLoading === "starting"}
                disabled={frameLoading !== null}
                onGenerate={() => generateFrameImage("starting")}
                onDownload={(img) => downloadFrameImage("starting", img)}
              />
            )}
            {part.endingFrame?.prompt && (
              <FrameImageCard
                kind="ending"
                partNumber={part.partNumber}
                framePrompt={part.endingFrame.prompt}
                image={part.endingFrameImage ?? null}
                loading={frameLoading === "ending"}
                disabled={frameLoading !== null}
                onGenerate={() => generateFrameImage("ending")}
                onDownload={(img) => downloadFrameImage("ending", img)}
              />
            )}
          </div>
        )}

        {/* Full copyable prompt — collapsible */}
        <div>
          <button
            type="button"
            onClick={() => setShowFullPrompt((v) => !v)}
            className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-md border border-border text-left hover:border-primary/50 transition-colors"
            data-testid={`button-toggle-full-prompt-${part.partNumber}`}
            aria-expanded={showFullPrompt}
          >
            <span className="flex items-center gap-2">
              <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                Full Seedance prompt
              </span>
              <span className="text-[10px] font-mono text-muted-foreground/70">
                ({part.copyablePrompt.length.toLocaleString()} chars)
              </span>
            </span>
            <span className="flex items-center gap-2">
              {showFullPrompt ? (
                <ChevronUp className="w-4 h-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="w-4 h-4 text-muted-foreground" />
              )}
            </span>
          </button>
          {showFullPrompt && (
            <div className="mt-2 border border-border rounded-md bg-card">
              <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border">
                <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                  Paste-ready Seedance 2.0 prompt
                </div>
                <CopyButton
                  text={part.copyablePrompt}
                  label="Copy"
                  testId={`button-copy-full-prompt-${part.partNumber}`}
                />
              </div>
              <pre
                className="px-3 py-3 text-[11px] leading-relaxed whitespace-pre-wrap break-words font-mono text-foreground/90 max-h-[420px] overflow-y-auto"
                data-testid={`text-full-prompt-${part.partNumber}`}
              >
                {part.copyablePrompt}
              </pre>
              <div className="px-3 py-2 border-t border-border text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                Last frame · {part.lastFrameDescription}
              </div>
            </div>
          )}
        </div>
      </div>

      {editOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in-0"
          onClick={() => {
            if (!editing) setEditOpen(false);
          }}
          role="dialog"
          aria-modal="true"
          aria-labelledby={`edit-part-title-${part.partNumber}`}
          data-testid={`edit-part-modal-${part.partNumber}`}
        >
          <div
            className="relative w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-md border border-border bg-background shadow-2xl animate-in zoom-in-95"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 z-10 flex items-start justify-between gap-3 px-5 py-4 bg-background border-b border-border">
              <div className="min-w-0">
                <div className="text-[10px] font-mono uppercase tracking-widest text-primary">
                  Edit · Part {part.partNumber} of {partsTotal}
                </div>
                <h3
                  id={`edit-part-title-${part.partNumber}`}
                  className="font-display text-2xl tracking-tight mt-1"
                >
                  Refine with a prompt
                </h3>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Tell the AI what to change. Continuity to {previousPart ? `Part ${previousPart.partNumber}` : "(no previous part)"}{" "}
                  and {nextPart ? `Part ${nextPart.partNumber}` : "(no next part)"} will be preserved automatically.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (!editing) setEditOpen(false);
                }}
                disabled={editing}
                className="w-8 h-8 inline-flex items-center justify-center rounded-md border border-border text-muted-foreground hover:border-primary hover:text-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                data-testid={`button-close-edit-${part.partNumber}`}
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="px-5 py-5 space-y-4">
              <div>
                <label
                  htmlFor={`edit-instruction-${part.partNumber}`}
                  className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground"
                >
                  Your instruction
                </label>
                <textarea
                  id={`edit-instruction-${part.partNumber}`}
                  value={editInstruction}
                  onChange={(e) => {
                    setEditInstruction(e.target.value);
                    if (editError) setEditError(null);
                  }}
                  disabled={editing}
                  rows={5}
                  placeholder='e.g. "Make shot 3 a slow whip pan instead of a cut" or "Drop the second shot and add a close-up at the end"'
                  className="mt-2 w-full px-3 py-2 rounded-md border border-border bg-card text-sm focus:outline-none focus:border-primary resize-y disabled:opacity-50"
                  data-testid={`textarea-edit-instruction-${part.partNumber}`}
                />
              </div>

              <div className="rounded-md border border-border bg-card/50 px-3 py-2 text-[11px] text-muted-foreground space-y-1">
                <div>
                  <span className="font-mono uppercase tracking-widest text-[9px]">Entry continuity ·</span>{" "}
                  {previousPart
                    ? `continues from Part ${previousPart.partNumber}'s last frame.`
                    : "this is the first part — no entry constraint."}
                </div>
                <div>
                  <span className="font-mono uppercase tracking-widest text-[9px]">Exit continuity ·</span>{" "}
                  {nextPart
                    ? `must end so Part ${nextPart.partNumber} can still continue from it.`
                    : "this is the final part — no exit constraint."}
                </div>
              </div>

              {editError && (
                <div
                  className="px-3 py-2 rounded-md border border-red-500/30 bg-red-500/10 text-xs text-red-400"
                  data-testid={`text-edit-error-${part.partNumber}`}
                >
                  {editError}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
                <button
                  type="button"
                  onClick={() => {
                    if (!editing) setEditOpen(false);
                  }}
                  disabled={editing}
                  className="px-4 py-2 rounded-md border border-border font-mono text-xs uppercase tracking-widest text-muted-foreground hover:border-foreground/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  data-testid={`button-cancel-edit-${part.partNumber}`}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={submitEdit}
                  disabled={editing || !editInstruction.trim()}
                  className="inline-flex items-center gap-2 px-5 py-2 rounded-md bg-primary text-black font-mono text-xs uppercase tracking-widest hover:bg-[#D4EB3A] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  data-testid={`button-submit-edit-${part.partNumber}`}
                >
                  {editing ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Refining…
                    </>
                  ) : (
                    <>
                      <Send className="w-4 h-4" /> Apply edit
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Per-part frame card. Renders the Gemini-generated still if present, with
 * Download + Regenerate controls; otherwise shows a "Generate frame image"
 * call-to-action. The original writer prompt is kept as a collapsible caption
 * so the user can still copy the text version into Seedance directly.
 */
function FrameImageCard({
  kind,
  partNumber,
  framePrompt,
  image,
  loading,
  disabled,
  onGenerate,
  onDownload,
}: {
  kind: "starting" | "ending";
  partNumber: number;
  framePrompt: string;
  image:
    | {
        objectPath?: string;
        b64Json?: string;
        mimeType: string;
        generatedAt: string;
        sourcePrompt: string;
      }
    | null;
  loading: boolean;
  disabled: boolean;
  onGenerate: () => void;
  onDownload: (img: {
    objectPath?: string;
    b64Json?: string;
    mimeType: string;
  }) => void;
}) {
  const [showPrompt, setShowPrompt] = useState(false);
  const label = kind === "starting" ? "Starting frame" : "Ending frame";
  // Surface a soft hint when the underlying writer prompt has drifted from
  // the prompt used to render the image (e.g. after an "Edit with prompt"
  // round). The image is still shown so the user doesn't lose work.
  const promptDrifted =
    !!image && image.sourcePrompt.trim() !== framePrompt.trim();
  return (
    <div
      className="border border-border rounded-md bg-card overflow-hidden"
      data-testid={`${kind}-frame-${partNumber}`}
    >
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border">
        <div className="text-[10px] font-mono uppercase tracking-widest text-primary flex items-center gap-1.5">
          <ImageIcon className="w-3 h-3" /> {label} · part {partNumber}
        </div>
        <CopyButton
          text={framePrompt}
          label="Copy prompt"
          testId={`button-copy-${kind}-frame-inline-${partNumber}`}
        />
      </div>

      {image && hasImage(image) ? (
        <div className="space-y-2">
          <div className="relative bg-black/50">
            {/* Letterboxed image; max height keeps card heights similar across parts. */}
            <img
              src={imageRefSrc(image)}
              alt={`${label} for part ${partNumber}`}
              className="block w-full max-h-72 object-contain"
              data-testid={`${kind}-frame-image-${partNumber}`}
            />
            {loading && (
              <div className="absolute inset-0 flex items-center justify-center bg-background/70">
                <Loader2 className="w-5 h-5 animate-spin text-primary" />
              </div>
            )}
          </div>
          <div className="flex items-center justify-between gap-2 px-3 pb-2 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={() =>
                  onDownload({
                    objectPath: image.objectPath,
                    b64Json: image.b64Json,
                    mimeType: image.mimeType,
                  })
                }
                disabled={disabled}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-border font-mono text-[10px] uppercase tracking-widest text-muted-foreground hover:border-primary hover:text-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                data-testid={`button-download-${kind}-frame-${partNumber}`}
              >
                <ArrowDownToLine className="w-3 h-3" /> Download
              </button>
              <button
                type="button"
                onClick={onGenerate}
                disabled={disabled}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-border font-mono text-[10px] uppercase tracking-widest text-muted-foreground hover:border-primary hover:text-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                data-testid={`button-regenerate-${kind}-frame-${partNumber}`}
              >
                {loading ? (
                  <>
                    <Loader2 className="w-3 h-3 animate-spin" /> Regenerating…
                  </>
                ) : (
                  <>
                    <RefreshCw className="w-3 h-3" /> Regenerate
                  </>
                )}
              </button>
            </div>
            {promptDrifted && (
              <span
                className="text-[10px] font-mono text-amber-500"
                title="The frame prompt has changed since this image was generated. Click Regenerate to refresh."
              >
                prompt updated · regenerate?
              </span>
            )}
          </div>
        </div>
      ) : (
        <div className="px-3 py-4 flex flex-col gap-3">
          <div className="aspect-[16/9] w-full rounded-md border border-dashed border-border bg-background/40 flex items-center justify-center">
            {loading ? (
              <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" /> Rendering frame…
              </div>
            ) : (
              <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground text-center px-4">
                No frame image yet — generate one from the prompt below.
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onGenerate}
            disabled={disabled}
            className="self-start inline-flex items-center gap-1.5 px-3 py-2 rounded-md border border-primary/40 font-mono text-[10px] uppercase tracking-widest text-primary hover:bg-primary/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            data-testid={`button-generate-${kind}-frame-${partNumber}`}
          >
            {loading ? (
              <>
                <Loader2 className="w-3 h-3 animate-spin" /> Generating…
              </>
            ) : (
              <>
                <ImageIcon className="w-3 h-3" /> Generate frame image
              </>
            )}
          </button>
        </div>
      )}

      <div className="border-t border-border">
        <button
          type="button"
          onClick={() => setShowPrompt((v) => !v)}
          className="w-full flex items-center justify-between gap-2 px-3 py-1.5 text-left hover:bg-background/40 transition-colors"
          aria-expanded={showPrompt}
          data-testid={`button-toggle-${kind}-frame-prompt-${partNumber}`}
        >
          <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
            Writer prompt ({framePrompt.length.toLocaleString()} chars)
          </span>
          {showPrompt ? (
            <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
          )}
        </button>
        {showPrompt && (
          <pre className="px-3 pb-3 text-[11px] leading-relaxed whitespace-pre-wrap break-words font-mono text-foreground/90 max-h-56 overflow-y-auto">
            {framePrompt}
          </pre>
        )}
      </div>
    </div>
  );
}

/**
 * Tiny per-part frame status badge. Surfaces the GenerationProvider's live
 * `frameStatuses[partNumber]` map so the user can see autoRenderFramesForPart
 * progress without having to scroll down to the per-part FrameImageCard.
 */
function FrameStatusBadge({
  kind,
  status,
  partNumber,
}: {
  kind: "starting" | "ending";
  status: "pending" | "rendering" | "done" | "error";
  partNumber: number;
}) {
  if (status === "done") {
    return (
      <span
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-mono text-[9px] tracking-widest border bg-secondary/40 text-muted-foreground border-border"
        data-testid={`frame-status-${kind}-${partNumber}`}
      >
        <Check className="w-2.5 h-2.5" /> {kind} frame
      </span>
    );
  }
  const cfg =
    status === "rendering"
      ? {
          cls: "bg-primary/15 text-primary border-primary/40 animate-pulse",
          icon: <Loader2 className="w-2.5 h-2.5 animate-spin" />,
          label: `Rendering ${kind} frame…`,
        }
      : status === "error"
        ? {
            cls: "bg-red-500/10 text-red-300 border-red-500/40",
            icon: <X className="w-2.5 h-2.5" />,
            label: `${kind} frame failed`,
          }
        : {
            cls: "bg-secondary/30 text-muted-foreground border-border/50",
            icon: <Loader2 className="w-2.5 h-2.5" />,
            label: `${kind} frame queued`,
          };
  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-mono text-[9px] uppercase tracking-widest border ${cfg.cls}`}
      data-testid={`frame-status-${kind}-${partNumber}`}
    >
      {cfg.icon} {cfg.label}
    </span>
  );
}
