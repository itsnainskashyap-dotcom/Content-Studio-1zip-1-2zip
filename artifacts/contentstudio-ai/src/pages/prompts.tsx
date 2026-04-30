import { useEffect, useMemo, useRef, useState } from "react";
import {
  Loader2,
  Play,
  Download,
  ArrowDownToLine,
  Check,
  Diamond,
} from "lucide-react";
import { toast } from "sonner";
import { useGenerateVideoPrompts } from "@workspace/api-client-react";
import {
  storage,
  STYLES,
  VIDEO_MODELS,
  DEFAULT_VIDEO_MODEL,
  getVideoModelMeta,
  type Project,
  type ProjectPart,
  type VideoModel,
} from "@/lib/storage";
import { buildPreviousPartDigests } from "@/lib/part-digest";
import { extractEnvelopeError } from "@/lib/api-call";
import { ErrorCard } from "@/components/error-card";
import { CopyButton } from "@/components/copy-button";

// Superset of duration pills the page can offer. The actual pills shown are
// filtered to the selected video model's per-clip range (e.g. Veo 3 caps at
// 8s so we hide the 10/15/20 pills when Veo is the target).
const ALL_PART_DURATIONS = [2, 3, 5, 6, 8, 10, 15, 20];

function partDurationsForModel(model: VideoModel): number[] {
  const { min, max } = getVideoModelMeta(model).durationRangeSeconds;
  return ALL_PART_DURATIONS.filter((d) => d >= min && d <= max);
}

function snapPartDurationToModel(current: number, model: VideoModel): number {
  const allowed = partDurationsForModel(model);
  if (allowed.includes(current)) return current;
  // Pick the largest pill <= current; otherwise the smallest pill that
  // is still in-range. Falls back to the model's max if neither path
  // produces a value (which can only happen for an empty list — guarded).
  const lower = [...allowed].reverse().find((d) => d <= current);
  if (lower !== undefined) return lower;
  return allowed[0] ?? getVideoModelMeta(model).durationRangeSeconds.max;
}

/**
 * Normalize a thrown error from a mutateAsync call into a user-readable
 * string. Mirrors the heuristics in `useApiCall` so the error card
 * surfaces the same friendly text as the legacy path (rate-limit hints,
 * heartbeat-envelope errors, generic fallback).
 */
function normalizeMutationError(err: unknown): string {
  // Heartbeat envelope: server returned 200 with `{ "error": "..." }`
  // (it can't change status after the first heartbeat byte).
  const envMsg =
    err && typeof err === "object" && "data" in err
      ? extractEnvelopeError((err as { data: unknown }).data)
      : null;
  if (envMsg) return envMsg;
  if (err && typeof err === "object" && "message" in err) {
    const raw = String((err as { message: unknown }).message);
    const lower = raw.toLowerCase();
    if (lower.includes("rate") && lower.includes("limit")) {
      return "Hit the AI rate limit. Please wait 30 seconds and try again.";
    }
    if (lower.includes("429")) {
      return "Too many requests right now. Please wait 30 seconds and try again.";
    }
    if (raw) return raw;
  }
  return "Something went wrong. Please try again.";
}

export default function PromptGenerator() {
  const [project, setProject] = useState<Project | null>(null);
  const [style, setStyle] = useState<string | null>(null);
  const [videoModel, setVideoModel] = useState<VideoModel>(DEFAULT_VIDEO_MODEL);
  const [partDuration, setPartDuration] = useState(5);
  const [generating, setGenerating] = useState(false);
  const [parts, setParts] = useState<ProjectPart[]>([]);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const generatePromptsMut = useGenerateVideoPrompts();
  const allowedDurations = useMemo(
    () => partDurationsForModel(videoModel),
    [videoModel],
  );
  const currentModelMeta = useMemo(
    () => getVideoModelMeta(videoModel),
    [videoModel],
  );
  // Per-run guard. Each call to startGeneration() bumps this counter.
  // Late-resolving promises from a stale (failed/cancelled) run check
  // their captured runId against `runIdRef.current` and bail out instead
  // of clobbering the UI state of the next run (or leaving a ghost
  // progress increment after an abort).
  const runIdRef = useRef(0);

  // Mirrors of state we read inside the storage-sync handler. The
  // handler is bound once (empty deps) so it can't see fresh values
  // from later renders without these refs. We use them to:
  //  - skip re-hydration entirely while a generation run is in flight
  //    (so the run's in-flight selections aren't clobbered);
  //  - only adopt persisted style when the user has not yet picked one
  //    locally (i.e. avoid overwriting unsaved local edits).
  const generatingRef = useRef(false);
  const styleRef = useRef<string | null>(null);
  const videoModelRef = useRef<VideoModel>(DEFAULT_VIDEO_MODEL);
  useEffect(() => {
    generatingRef.current = generating;
  }, [generating]);
  useEffect(() => {
    styleRef.current = style;
  }, [style]);
  useEffect(() => {
    videoModelRef.current = videoModel;
  }, [videoModel]);

  useEffect(() => {
    // Re-hydrate the local project state every time the central project
    // cache changes. Without this, opening the page before the server
    // hydrate finishes (or coming back after another tab regenerated an
    // image) leaves the local copy stale — character images, frame
    // images, and freshly-saved parts silently disappear from the UI.
    const sync = () => {
      const current = storage.getCurrentProject();
      if (!current) return;
      setProject(current);
      // While a generation run is in flight, never let an external
      // re-hydrate clobber the user's current selections — that would
      // reset style/model/duration mid-run. Do still refresh the
      // project reference so saved parts can flush on completion.
      if (generatingRef.current) return;
      // Only adopt the persisted style/model/duration when the user has
      // not yet made a local choice, OR when a freshly hydrated project
      // brings real, differing values. This prevents the listener from
      // wiping unsaved local selections.
      if (current.style && !styleRef.current) setStyle(current.style);
      const model = current.videoModel ?? DEFAULT_VIDEO_MODEL;
      if (model !== videoModelRef.current && current.parts.length > 0) {
        setVideoModel(model);
      }
      if (current.duration && current.parts.length > 0) {
        setPartDuration(snapPartDurationToModel(current.duration, model));
      }
      if (current.parts.length > 0) setParts(current.parts);
    };
    sync();
    window.addEventListener("cs:projects-changed", sync);
    return () => {
      window.removeEventListener("cs:projects-changed", sync);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the part duration valid as the user switches models. We only
  // snap when the user has not yet generated any parts — once parts
  // exist the model + duration are frozen alongside them.
  useEffect(() => {
    if (parts.length > 0 || generating) return;
    setPartDuration((prev) => snapPartDurationToModel(prev, videoModel));
  }, [videoModel, parts.length, generating]);

  const totalParts = useMemo(() => {
    if (!project) return 0;
    return Math.max(1, Math.ceil(project.totalDuration / partDuration));
  }, [project, partDuration]);

  const startGeneration = async () => {
    if (!project || !project.story || !style) {
      toast.error("Pick a story, save it, and choose a style first");
      return;
    }
    // Bump the run-guard. Any in-flight promise from an earlier (failed/
    // restarted) run will see runIdRef.current change underneath it and
    // bail out of its .then handler.
    runIdRef.current += 1;
    const myRunId = runIdRef.current;
    const isCurrent = () => runIdRef.current === myRunId;

    setGenerating(true);
    setError(null);
    setParts([]);

    const collected: ProjectPart[] = [];
    setProgress({ current: 0, total: totalParts });

    const story = project.story;

    // CHECKPOINTING: we persist the project after every successfully
    // generated part so a mid-run refresh / browser crash doesn't lose
    // already-completed work. The leading wipe-save below also makes the
    // "Generate" click visually consistent — the previous run's parts
    // disappear from storage immediately, not only after success.
    let workingProject: Project = storage.saveProject({
      ...project,
      style,
      videoModel,
      duration: partDuration,
      parts: [],
    });
    storage.setCurrentProjectId(workingProject.id);
    window.dispatchEvent(new Event("cs:projects-changed"));

    // STRICT SEQUENTIAL with FULL MEMORY. The user's explicit ask:
    // continuity > speed. Each part receives:
    //   - the FULL story (server adds via describeStory()),
    //   - `previousLastFrame` from the immediately-prior part so the
    //     opening shot continues seamlessly, AND
    //   - `previousParts`: compact text digests of EVERY already-generated
    //     part (shots, cameraWork, effects, voiceover, lastFrame) so the
    //     model can avoid repeating beats and can build on what came
    //     before. Server-side `describePreviousParts()` injects them with
    //     a "do NOT repeat shots/voiceover lines/signature beats" header.
    // We could parallel-batch, but that would force same-batch parts to
    // be blind to each other — exactly the failure mode the user wants
    // gone. So we run one at a time.
    for (let i = 0; i < totalParts; i++) {
      const partNumber = i + 1;
      const previousLastFrame =
        collected.length > 0
          ? collected[collected.length - 1].lastFrameDescription
          : undefined;
      const previousParts = buildPreviousPartDigests(collected);

      let resp: ProjectPart;
      try {
        const raw = await generatePromptsMut.mutateAsync({
          data: {
            story,
            style,
            duration: partDuration,
            part: partNumber,
            totalParts,
            previousLastFrame,
            previousParts,
            aspectRatio: project.aspectRatio,
            videoModel,
            // v1 wiring: when both starting + ending frame slots are on
            // for this project, instruct the writer to embed the explicit
            // "Image 1 / Image 2" first-and-last-frame keyframe header.
            // The user pastes the rendered stills into the target model
            // alongside copyablePrompt — the model treats them as
            // keyframe anchors (image-to-video).
            framesAsImageReferences:
              project.frameSettings.startingFrameEnabled &&
              project.frameSettings.endingFrameEnabled,
          },
        });
        // STALE-RUN GUARD: another run started (or this one was reset)
        // while we were awaiting — drop silently, that run owns the UI.
        if (!isCurrent()) return;
        // ENVELOPE-ERROR GUARD: the server's heartbeat helper can
        // return HTTP 200 with `{ "error": "..." }` after the first
        // heartbeat byte. React-query treats that as success, so we
        // must inspect the body ourselves.
        const envelopeErr = extractEnvelopeError(raw);
        if (envelopeErr) {
          throw new Error(envelopeErr);
        }
        resp = { ...raw, partNumber } satisfies ProjectPart;
      } catch (err) {
        if (!isCurrent()) return;
        setError(normalizeMutationError(err));
        setGenerating(false);
        setProgress(null);
        return;
      }

      collected.push(resp);
      setParts([...collected]);
      setProgress({ current: collected.length, total: totalParts });

      // CHECKPOINT: persist this part immediately so a refresh / crash
      // mid-run keeps everything we've already generated. We rebase off
      // the last `saveProject` return so we always carry forward the
      // freshest `updatedAt` / normalized fields.
      workingProject = storage.saveProject({
        ...workingProject,
        parts: [...collected],
      });
      window.dispatchEvent(new Event("cs:projects-changed"));
    }

    setProject(workingProject);
    setGenerating(false);
    setProgress(null);
    toast.success(
      `Generated ${collected.length} part${collected.length === 1 ? "" : "s"}`,
    );
  };

  const downloadAll = () => {
    if (!project || parts.length === 0) return;
    const lines: string[] = [];
    lines.push(`# ${project.title}`);
    if (project.story) {
      lines.push(``);
      lines.push(`## Story`);
      lines.push(project.story.synopsis);
    }
    lines.push(``);
    lines.push(`Style: ${project.style ?? style ?? "—"}`);
    lines.push(
      `Target model: ${currentModelMeta.name} ${currentModelMeta.version} (${currentModelMeta.maker})`,
    );
    lines.push(`Per-part duration: ${partDuration}s`);
    lines.push(`Total parts: ${parts.length}`);
    parts.forEach((p) => {
      lines.push(``);
      lines.push(`---`);
      lines.push(`# PART ${p.partNumber}`);
      lines.push(``);
      lines.push(p.copyablePrompt);
      lines.push(``);
      lines.push(`Last frame: ${p.lastFrameDescription}`);
    });
    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${project.title.replace(/\s+/g, "_")}-prompts.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // No project / story state
  if (!project || !project.story) {
    return (
      <div className="px-4 py-8 md:px-12 md:py-14 max-w-3xl mx-auto">
        <h1 className="font-display text-4xl md:text-5xl tracking-tight">
          Video Prompts
        </h1>
        <p className="mt-3 text-muted-foreground">
          You need a saved story before generating shot prompts.
        </p>
        <a
          href={`${import.meta.env.BASE_URL}story`}
          className="mt-6 inline-flex items-center gap-2 px-5 py-3 rounded-md bg-primary text-black font-mono text-xs uppercase tracking-widest hover:bg-[#D4EB3A] transition-colors"
          data-testid="button-go-story"
        >
          Go to Story Builder
        </a>
      </div>
    );
  }

  // Style selection state
  if (!style && parts.length === 0) {
    return (
      <div className="px-4 py-8 md:px-12 md:py-14 max-w-6xl mx-auto">
        <div className="text-xs font-mono uppercase tracking-widest text-muted-foreground">
          Step 1 of 2 · Pick a style
        </div>
        <h1 className="mt-1 font-display text-4xl md:text-5xl tracking-tight">
          Video Prompts
        </h1>
        <p className="mt-3 text-muted-foreground max-w-2xl">
          Choose the visual world. The prompts will be tailored to it shot by
          shot.
        </p>
        <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {STYLES.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => setStyle(s.name)}
              className="text-left border border-border rounded-md p-4 bg-card hover:border-primary transition-colors group"
              data-testid={`style-${s.key}`}
              style={{ borderTopColor: s.accent, borderTopWidth: 3 }}
            >
              <div className="font-display text-2xl tracking-tight group-hover:text-primary">
                {s.name}
              </div>
              <div className="mt-2 text-xs text-muted-foreground">
                {s.description}
              </div>
              <div className="mt-3 text-[10px] font-mono uppercase tracking-widest text-muted-foreground/80">
                {s.keywords}
              </div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  // Selected style → duration + generate
  return (
    <div className="px-4 py-8 md:px-12 md:py-14 max-w-6xl mx-auto">
      <div className="text-xs font-mono uppercase tracking-widest text-muted-foreground">
        Project · {project.title}
      </div>
      <h1 className="mt-1 font-display text-4xl md:text-5xl tracking-tight">
        Video Prompts
      </h1>

      <div className="mt-6 border border-border rounded-md p-5 bg-card flex flex-wrap gap-6 items-end">
        <div>
          <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
            Style
          </div>
          <div className="mt-1 font-display text-2xl tracking-tight">
            {style}
          </div>
          {parts.length === 0 && (
            <button
              type="button"
              onClick={() => setStyle(null)}
              className="mt-1 text-[10px] font-mono uppercase tracking-widest text-muted-foreground hover:text-primary"
              data-testid="button-change-style"
            >
              Change style
            </button>
          )}
        </div>
        <div className="min-w-[220px]">
          <div className="flex items-center gap-2">
            <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
              Target model
            </div>
            <span className="text-[9px] font-mono uppercase tracking-widest text-primary/70">
              {currentModelMeta.durationRangeSeconds.min}-
              {currentModelMeta.durationRangeSeconds.max}s · per clip
            </span>
          </div>
          <select
            value={videoModel}
            disabled={generating || parts.length > 0}
            onChange={(e) => setVideoModel(e.target.value as VideoModel)}
            className="mt-1 w-full bg-background border border-border rounded-md px-2 py-1.5 font-display text-base tracking-tight focus:outline-none focus:border-primary disabled:opacity-50 disabled:cursor-not-allowed"
            data-testid="select-video-model"
          >
            {VIDEO_MODELS.map((m) => (
              <option key={m.slug} value={m.slug}>
                {m.name} {m.version} — {m.maker}
              </option>
            ))}
          </select>
          <div className="mt-1 text-[10px] text-muted-foreground/80 leading-snug">
            {currentModelMeta.blurb}
          </div>
        </div>
        <div>
          <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
            Duration / part
          </div>
          <div className="mt-2 flex gap-2 flex-wrap">
            {allowedDurations.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setPartDuration(d)}
                disabled={generating || parts.length > 0}
                className={`px-3 py-1.5 rounded-md text-xs font-mono uppercase tracking-widest border transition-colors ${
                  partDuration === d
                    ? "bg-primary text-black border-primary"
                    : "border-border text-muted-foreground hover:text-foreground"
                } ${generating || parts.length > 0 ? "opacity-50 cursor-not-allowed" : ""}`}
                data-testid={`pill-pdur-${d}`}
              >
                {d}s
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
            Total
          </div>
          <div className="mt-1 font-mono text-sm">
            {totalParts} × {partDuration}s = {totalParts * partDuration}s
          </div>
        </div>
        <div className="ml-auto flex gap-2">
          {parts.length === 0 ? (
            <button
              type="button"
              onClick={startGeneration}
              disabled={generating}
              className="inline-flex items-center gap-2 px-5 py-3 rounded-md bg-primary text-black font-mono text-xs uppercase tracking-widest hover:bg-[#D4EB3A] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              data-testid="button-generate-prompts"
            >
              {generating ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" /> Generating…
                </>
              ) : (
                <>
                  <Play className="w-4 h-4" /> Generate prompts
                </>
              )}
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={downloadAll}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-md border border-border font-mono text-xs uppercase tracking-widest hover:border-primary hover:text-primary transition-colors"
                data-testid="button-download-all"
              >
                <Download className="w-4 h-4" /> Download .txt
              </button>
              <button
                type="button"
                onClick={() => {
                  setParts([]);
                  setStyle(null);
                  toast("Reset — pick a style and generate again");
                }}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-md border border-border font-mono text-xs uppercase tracking-widest hover:border-primary hover:text-primary transition-colors"
                data-testid="button-reset"
              >
                Start over
              </button>
            </>
          )}
        </div>
      </div>

      {progress && (
        <div className="mt-6" data-testid="generation-progress">
          <div className="text-xs font-mono uppercase tracking-widest text-muted-foreground">
            Generated {progress.current} of {progress.total} parts…
          </div>
          <div className="mt-2 h-1 bg-secondary/40 rounded">
            <div
              className="h-1 bg-primary rounded transition-all"
              style={{
                width: `${
                  progress.total > 0
                    ? (progress.current / progress.total) * 100
                    : 0
                }%`,
              }}
            />
          </div>
        </div>
      )}

      {error && (
        <div className="mt-6">
          <ErrorCard message={error} onRetry={startGeneration} />
        </div>
      )}

      {parts.length > 0 && (
        <div className="mt-10 space-y-8">
          {parts.map((p, idx) => (
            <PartCard key={p.partNumber} part={p} continuesFrom={idx > 0} />
          ))}

          <div className="border border-primary/40 bg-primary/5 rounded-md p-5">
            <div className="text-[10px] font-mono uppercase tracking-widest text-primary">
              Complete prompt package
            </div>
            <div className="mt-1 font-display text-2xl tracking-tight">
              {parts.length} part{parts.length === 1 ? "" : "s"} ·{" "}
              {parts.reduce((s, p) => s + p.shots.length, 0)} shots
            </div>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={downloadAll}
                className="inline-flex items-center gap-2 px-5 py-3 rounded-md bg-primary text-black font-mono text-xs uppercase tracking-widest hover:bg-[#D4EB3A] transition-colors"
                data-testid="button-download-package"
              >
                <ArrowDownToLine className="w-4 h-4" /> Download all prompts
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PartCard({
  part,
  continuesFrom,
}: {
  part: ProjectPart;
  continuesFrom: boolean;
}) {
  const [expandedShot, setExpandedShot] = useState<number | null>(null);

  return (
    <div
      className="border border-border rounded-md bg-card"
      data-testid={`part-${part.partNumber}`}
    >
      <div className="flex items-center justify-between p-5 border-b border-border">
        <div>
          <div className="text-[10px] font-mono uppercase tracking-widest text-primary">
            Part {part.partNumber}
          </div>
          <div className="mt-1 font-display text-2xl tracking-tight">
            {part.shots.length} shots
          </div>
          {continuesFrom && (
            <div className="mt-1 text-[11px] font-mono text-muted-foreground">
              ↳ Continues from Part {part.partNumber - 1}
            </div>
          )}
        </div>
        <CopyButton
          text={part.copyablePrompt}
          label="Copy prompt"
          variant="accent"
          testId={`button-copy-part-${part.partNumber}`}
        />
      </div>

      <div className="p-5 space-y-3">
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
          <div className="flex justify-between mt-1 text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
            <span>{part.densityMap[0]?.timeRange ?? ""}</span>
            <span>{part.densityMap[part.densityMap.length - 1]?.timeRange ?? ""}</span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-4">
          {(["act1", "act2", "act3"] as const).map((k) => (
            <div
              key={k}
              className="border border-border rounded-md p-3 bg-background"
            >
              <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                {k.toUpperCase()}
              </div>
              <p className="mt-1 text-xs">{part.energyArc[k]}</p>
            </div>
          ))}
        </div>

        <div className="mt-6">
          <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-2">
            Shots
          </div>
          <ul className="space-y-2">
            {part.shots.map((s) => (
              <li
                key={s.shotNumber}
                className="border border-border rounded-md bg-background"
              >
                <button
                  type="button"
                  onClick={() =>
                    setExpandedShot((cur) =>
                      cur === s.shotNumber ? null : s.shotNumber,
                    )
                  }
                  className="w-full flex items-center justify-between gap-3 p-3 text-left"
                  data-testid={`shot-${part.partNumber}-${s.shotNumber}`}
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
                      <span className="ml-2 inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-widest text-black bg-primary px-1.5 py-0.5 rounded">
                        <Diamond className="w-3 h-3" /> Signature
                      </span>
                    )}
                  </div>
                  <Play
                    className={`w-4 h-4 text-muted-foreground transition-transform ${
                      expandedShot === s.shotNumber ? "rotate-90" : ""
                    }`}
                  />
                </button>
                {expandedShot === s.shotNumber && (
                  <div className="px-3 pb-3 pt-0 space-y-2">
                    <p className="text-xs">{s.description}</p>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-[11px]">
                      <Field label="Camera" value={s.cameraWork} />
                      <Field label="Speed" value={s.speed} />
                      <Field label="Transition" value={s.transition} />
                    </div>
                    <div>
                      <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-1">
                        Effects
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {s.effects.map((e, i) => (
                          <span
                            key={i}
                            className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-border"
                          >
                            {e}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-6 border-t border-border pt-4">
          <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-2 flex items-center gap-1">
            <Check className="w-3 h-3" /> Last frame (continuation)
          </div>
          <p className="text-xs text-muted-foreground italic">
            {part.lastFrameDescription}
          </p>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-border rounded-md p-2">
      <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
        {label}
      </div>
      <div className="text-xs">{value}</div>
    </div>
  );
}
