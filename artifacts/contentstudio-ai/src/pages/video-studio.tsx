import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { toast } from "sonner";
import {
  useCreateVideoStudioJob,
  useGetVideoStudioJob,
  useCancelVideoStudioJob,
  getGetVideoStudioJobQueryKey,
  type VideoStudioJobRequest,
  type VideoStudioJobStatus,
  VideoStudioModel,
  VideoStudioAspectRatio,
  VideoStudioVoiceoverLanguage,
  VideoStudioQuality,
  VideoStudioJobRequestDurationSeconds,
  VideoStudioChunkStatusStatus,
  VideoStudioJobStatusStatus,
} from "@workspace/api-client-react";
import { storage, type Project } from "@/lib/storage";
import { objectPathToUrl, apiBasePrefix } from "@/lib/image-url";
import { apiFetch } from "@/lib/session-token";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import {
  BookOpen,
  Play,
  Volume2,
  Settings,
  Loader2,
  CheckCircle2,
  XCircle,
  Download,
  Film,
  Cpu,
  Wand2,
  AlertTriangle,
  Square,
  RefreshCw,
} from "lucide-react";

type ModelKey = (typeof VideoStudioModel)[keyof typeof VideoStudioModel];
type AspectKey = (typeof VideoStudioAspectRatio)[keyof typeof VideoStudioAspectRatio];
type VoLang = (typeof VideoStudioVoiceoverLanguage)[keyof typeof VideoStudioVoiceoverLanguage];
type QualityKey = (typeof VideoStudioQuality)[keyof typeof VideoStudioQuality];
type DurationKey = (typeof VideoStudioJobRequestDurationSeconds)[keyof typeof VideoStudioJobRequestDurationSeconds];

const MODEL_OPTIONS: Array<{
  value: ModelKey;
  label: string;
  blurb: string;
  durations: DurationKey[];
}> = [
  {
    value: "cont_pro",
    label: "Cont Pro",
    blurb: "Photoreal cinematic. Best for shorter clips with character continuity.",
    durations: [15 as DurationKey, 30 as DurationKey, 60 as DurationKey],
  },
  {
    value: "cont_ultra",
    label: "Cont Ultra",
    blurb: "Long-form cinematic. Use for full short-films up to two minutes.",
    durations: [30 as DurationKey, 60 as DurationKey, 120 as DurationKey],
  },
];

const ASPECT_OPTIONS: Array<{ value: AspectKey; label: string }> = [
  { value: "16:9", label: "16:9 — Wide" },
  { value: "9:16", label: "9:16 — Vertical" },
  { value: "1:1", label: "1:1 — Square" },
];

const LANGUAGE_OPTIONS: Array<{ value: VoLang; label: string }> = [
  { value: "english", label: "English" },
  { value: "hindi", label: "Hindi" },
  { value: "hinglish", label: "Hinglish" },
];

const QUALITY_OPTIONS: Array<{ value: QualityKey; label: string }> = [
  { value: "standard", label: "Standard" },
  { value: "high", label: "High" },
];

/** localStorage key for the most recent in-flight video-studio job id. */
const ACTIVE_JOB_LS_KEY = "cs:video-studio:activeJobId";

const STAGE_LABELS: Record<string, string> = {
  queued: "Queued — waiting for engine slot",
  writing_story: "Writing final story structure...",
  designing_chars: "Designing characters...",
  building_storyboard: "Creating visual storyboard...",
  preparing_part: "Preparing scene...",
  generating_part: "Generating scene...",
  continuity: "Maintaining continuity...",
  audio_sync: "Syncing voiceover and music...",
  merging: "Merging final video...",
  done: "Final video ready.",
};

interface FormState {
  model: ModelKey;
  durationSeconds: DurationKey;
  aspectRatio: AspectKey;
  voiceoverEnabled: boolean;
  voiceoverLanguage: VoLang;
  bgmEnabled: boolean;
  subtitlesEnabled: boolean;
  quality: QualityKey;
}

const DEFAULT_FORM: FormState = {
  model: "cont_pro",
  durationSeconds: 15 as DurationKey,
  aspectRatio: "16:9",
  voiceoverEnabled: true,
  voiceoverLanguage: "english",
  bgmEnabled: true,
  subtitlesEnabled: false,
  quality: "standard",
};

export default function VideoStudio() {
  const [project, setProject] = useState<Project | null>(null);
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  // Hydrate active job id from localStorage so a page reload / navigation
  // doesn't drop the in-flight generation card. The actual server-side
  // truth is reconciled by the GET /jobs/active fetch below.
  const [activeJobId, setActiveJobIdState] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      return window.localStorage.getItem(ACTIVE_JOB_LS_KEY);
    } catch {
      return null;
    }
  });
  const setActiveJobId = (next: string | null) => {
    setActiveJobIdState(next);
    try {
      if (next) window.localStorage.setItem(ACTIVE_JOB_LS_KEY, next);
      else window.localStorage.removeItem(ACTIVE_JOB_LS_KEY);
    } catch {
      // localStorage may be unavailable in private mode — non-fatal.
    }
  };

  // On mount, ask the server if this user has an in-flight job. If yes,
  // reconnect to it; if no, clear any stale localStorage hint. This is
  // what fixes the "navigate away → come back → UI shows nothing" bug:
  // the engine keeps running server-side, we just need to find the id.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch(
          `${apiBasePrefix()}/api/video-studio/jobs/active`,
          { credentials: "include" },
        );
        if (!res.ok) return;
        const data = (await res.json()) as VideoStudioJobStatus | null;
        if (cancelled) return;
        if (data && data.id) {
          setActiveJobId(data.id);
        } else {
          // No in-flight job server-side. Clear any stale localStorage
          // pointer so we don't keep polling a finished job's id.
          setActiveJobId(null);
        }
      } catch {
        // Network blip — keep whatever we hydrated from localStorage.
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Refresh project when storage changes (in case user hops over from /story).
  useEffect(() => {
    const refresh = () => setProject(storage.getCurrentProject());
    refresh();
    window.addEventListener("storage", refresh);
    window.addEventListener("cs:projects-changed", refresh as EventListener);
    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener(
        "cs:projects-changed",
        refresh as EventListener,
      );
    };
  }, []);

  const story = project?.story ?? null;
  const allowedDurations = useMemo<DurationKey[]>(
    () =>
      MODEL_OPTIONS.find((m) => m.value === form.model)?.durations ?? [
        15 as DurationKey,
      ],
    [form.model],
  );

  // Snap duration to allowed list when model changes.
  useEffect(() => {
    if (!allowedDurations.includes(form.durationSeconds)) {
      const fallback = allowedDurations[0] ?? (15 as DurationKey);
      setForm((f) => ({ ...f, durationSeconds: fallback }));
    }
  }, [allowedDurations, form.durationSeconds]);

  const createJob = useCreateVideoStudioJob({
    mutation: {
      onSuccess: (data) => {
        setActiveJobId(data.id);
        toast.success("Video generation started");
      },
      onError: (err: unknown) => {
        const msg =
          err instanceof Error ? err.message : "Failed to start generation";
        toast.error(msg);
      },
    },
  });

  const onGenerate = () => {
    if (!project) {
      toast.error("Select a project first.");
      return;
    }
    if (!story) {
      toast.error("Build a story before generating a video.");
      return;
    }
    const body: VideoStudioJobRequest = {
      model: form.model,
      durationSeconds: form.durationSeconds,
      aspectRatio: form.aspectRatio,
      voiceoverEnabled: form.voiceoverEnabled,
      voiceoverLanguage: form.voiceoverEnabled ? form.voiceoverLanguage : null,
      bgmEnabled: form.bgmEnabled,
      subtitlesEnabled: form.subtitlesEnabled,
      quality: form.quality,
      storyProjectId: project.id,
      story,
    };
    createJob.mutate({ data: body });
  };

  return (
    <div className="px-4 md:px-8 py-6 max-w-5xl mx-auto" data-testid="page-video-studio">
      <header className="mb-6">
        <div className="flex items-center gap-3">
          <Film className="w-5 h-5 text-primary" />
          <h1 className="text-xl md:text-2xl font-semibold">AI Video Studio</h1>
        </div>
        <p className="mt-1 text-sm text-muted-foreground max-w-2xl">
          Turn a saved story into a single continuous cinematic clip — frame-aware
          generation, character continuity, voiceover, music, all stitched into
          one MP4.
        </p>
      </header>

      {!project && <NoProjectCard />}
      {project && !story && <NoStoryCard projectTitle={project.title} />}
      {project && story && (
        <div className="grid grid-cols-1 gap-6">
          <ProjectSummary project={project} />
          <SettingsCard
            form={form}
            setForm={setForm}
            allowedDurations={allowedDurations}
            disabled={createJob.isPending || activeJobId !== null}
          />
          <div className="flex justify-end">
            <Button
              onClick={onGenerate}
              disabled={createJob.isPending || activeJobId !== null}
              size="lg"
              className="gap-2"
              data-testid="button-generate-video"
            >
              {createJob.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" /> Starting…
                </>
              ) : (
                <>
                  <Play className="w-4 h-4" /> Generate Video
                </>
              )}
            </Button>
          </div>
          {activeJobId && (
            <JobProgress
              jobId={activeJobId}
              onReset={() => setActiveJobId(null)}
            />
          )}
        </div>
      )}
    </div>
  );
}

/* ---------------- empty-state cards ---------------- */

function NoProjectCard() {
  return (
    <Card className="p-6 border-dashed border-border bg-card/40">
      <div className="flex items-start gap-3">
        <BookOpen className="w-5 h-5 text-muted-foreground mt-0.5" />
        <div className="flex-1">
          <h3 className="text-sm font-medium">No active project</h3>
          <p className="text-xs text-muted-foreground mt-1">
            Open a project from the dashboard or start a new one in the Story
            Builder.
          </p>
          <div className="mt-4 flex gap-2">
            <Link href="/story">
              <Button size="sm" data-testid="button-go-story">
                Go to Story Builder
              </Button>
            </Link>
            <Link href="/">
              <Button size="sm" variant="outline">
                Open Dashboard
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </Card>
  );
}

function NoStoryCard({ projectTitle }: { projectTitle: string }) {
  return (
    <Card className="p-6 border-dashed border-border bg-card/40">
      <div className="flex items-start gap-3">
        <Wand2 className="w-5 h-5 text-muted-foreground mt-0.5" />
        <div className="flex-1">
          <h3 className="text-sm font-medium">
            "{projectTitle}" doesn't have a story yet
          </h3>
          <p className="text-xs text-muted-foreground mt-1">
            The Video Studio reads the project's story to drive characters,
            beats, and continuity. Build the story first.
          </p>
          <div className="mt-4">
            <Link href="/story">
              <Button size="sm" data-testid="button-build-story">
                Build the Story
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </Card>
  );
}

/* ---------------- project summary ---------------- */

function ProjectSummary({ project }: { project: Project }) {
  const story = project.story;
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground">
            Source story
          </div>
          <div className="mt-1 text-base font-semibold truncate">
            {project.title}
          </div>
          {story && (
            <p className="mt-2 text-xs text-muted-foreground line-clamp-3 max-w-2xl">
              {story.synopsis || story.acts?.[0]?.description || "Story drafted."}
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-1.5 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
            <Badge variant="secondary" className="font-mono">
              {story?.acts?.length ?? 0} acts
            </Badge>
            <Badge variant="secondary" className="font-mono">
              {story?.characters?.length ?? 0} characters
            </Badge>
            {story?.mood && (
              <Badge variant="secondary" className="font-mono">
                Mood · {story.mood}
              </Badge>
            )}
          </div>
        </div>
        <Link href="/story">
          <Button variant="ghost" size="sm" className="shrink-0">
            Edit story
          </Button>
        </Link>
      </div>
    </Card>
  );
}

/* ---------------- settings ---------------- */

function SettingsCard({
  form,
  setForm,
  allowedDurations,
  disabled,
}: {
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  allowedDurations: DurationKey[];
  disabled: boolean;
}) {
  return (
    <Card className="p-5 space-y-6">
      <SectionLabel icon={Cpu}>Engine</SectionLabel>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {MODEL_OPTIONS.map((opt) => {
          const active = form.model === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              disabled={disabled}
              onClick={() => setForm((f) => ({ ...f, model: opt.value }))}
              data-testid={`engine-${opt.value}`}
              className={cn(
                "text-left rounded-md border p-4 transition-colors",
                "disabled:opacity-50 disabled:cursor-not-allowed",
                active
                  ? "border-primary bg-secondary/60"
                  : "border-border hover:bg-secondary/30",
              )}
            >
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium">{opt.label}</div>
                {active && (
                  <CheckCircle2 className="w-4 h-4 text-primary" />
                )}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {opt.blurb}
              </div>
              <div className="mt-2 text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                Up to {opt.durations[opt.durations.length - 1]}s
              </div>
            </button>
          );
        })}
      </div>

      <Separator />

      <SectionLabel icon={Film}>Length</SectionLabel>
      <div className="flex flex-wrap gap-2">
        {allowedDurations.map((d) => {
          const active = form.durationSeconds === d;
          return (
            <button
              key={d}
              type="button"
              disabled={disabled}
              onClick={() => setForm((f) => ({ ...f, durationSeconds: d }))}
              data-testid={`duration-${d}`}
              className={cn(
                "text-xs px-3 py-1.5 rounded-md border font-mono",
                "disabled:opacity-50 disabled:cursor-not-allowed",
                active
                  ? "border-primary bg-secondary/60 text-foreground"
                  : "border-border text-muted-foreground hover:bg-secondary/30",
              )}
            >
              {d}s
            </button>
          );
        })}
      </div>

      <Separator />

      <SectionLabel icon={Film}>Aspect</SectionLabel>
      <div className="flex flex-wrap gap-2">
        {ASPECT_OPTIONS.map((opt) => {
          const active = form.aspectRatio === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              disabled={disabled}
              onClick={() => setForm((f) => ({ ...f, aspectRatio: opt.value }))}
              data-testid={`aspect-${opt.value.replace(":", "-")}`}
              className={cn(
                "text-xs px-3 py-1.5 rounded-md border font-mono",
                "disabled:opacity-50 disabled:cursor-not-allowed",
                active
                  ? "border-primary bg-secondary/60 text-foreground"
                  : "border-border text-muted-foreground hover:bg-secondary/30",
              )}
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      <Separator />

      <SectionLabel icon={Volume2}>Audio</SectionLabel>
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <Label htmlFor="vo-toggle" className="text-sm">
              Voiceover
            </Label>
            <p className="text-xs text-muted-foreground">
              Auto-narrate scenes in the chosen language.
            </p>
          </div>
          <Switch
            id="vo-toggle"
            checked={form.voiceoverEnabled}
            disabled={disabled}
            onCheckedChange={(v) =>
              setForm((f) => ({ ...f, voiceoverEnabled: Boolean(v) }))
            }
            data-testid="switch-voiceover"
          />
        </div>
        {form.voiceoverEnabled && (
          <div className="flex flex-wrap gap-2 pl-1">
            {LANGUAGE_OPTIONS.map((opt) => {
              const active = form.voiceoverLanguage === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  disabled={disabled}
                  onClick={() =>
                    setForm((f) => ({ ...f, voiceoverLanguage: opt.value }))
                  }
                  data-testid={`vo-lang-${opt.value}`}
                  className={cn(
                    "text-xs px-3 py-1 rounded-md border font-mono",
                    "disabled:opacity-50 disabled:cursor-not-allowed",
                    active
                      ? "border-primary bg-secondary/60 text-foreground"
                      : "border-border text-muted-foreground hover:bg-secondary/30",
                  )}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        )}
        <div className="flex items-center justify-between">
          <div>
            <Label htmlFor="bgm-toggle" className="text-sm">
              Background music
            </Label>
            <p className="text-xs text-muted-foreground">
              Generated to match the story mood.
            </p>
          </div>
          <Switch
            id="bgm-toggle"
            checked={form.bgmEnabled}
            disabled={disabled}
            onCheckedChange={(v) =>
              setForm((f) => ({ ...f, bgmEnabled: Boolean(v) }))
            }
            data-testid="switch-bgm"
          />
        </div>
        <div className="flex items-center justify-between">
          <div>
            <Label htmlFor="subs-toggle" className="text-sm">
              Subtitles
            </Label>
            <p className="text-xs text-muted-foreground">
              Burn captions onto the final video.
            </p>
          </div>
          <Switch
            id="subs-toggle"
            checked={form.subtitlesEnabled}
            disabled={disabled}
            onCheckedChange={(v) =>
              setForm((f) => ({ ...f, subtitlesEnabled: Boolean(v) }))
            }
            data-testid="switch-subtitles"
          />
        </div>
      </div>

      <Separator />

      <SectionLabel icon={Settings}>Quality</SectionLabel>
      <div className="flex flex-wrap gap-2">
        {QUALITY_OPTIONS.map((opt) => {
          const active = form.quality === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              disabled={disabled}
              onClick={() => setForm((f) => ({ ...f, quality: opt.value }))}
              data-testid={`quality-${opt.value}`}
              className={cn(
                "text-xs px-3 py-1.5 rounded-md border font-mono",
                "disabled:opacity-50 disabled:cursor-not-allowed",
                active
                  ? "border-primary bg-secondary/60 text-foreground"
                  : "border-border text-muted-foreground hover:bg-secondary/30",
              )}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </Card>
  );
}

function SectionLabel({
  icon: Icon,
  children,
}: {
  icon: typeof Cpu;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest font-mono text-muted-foreground">
      <Icon className="w-3.5 h-3.5" />
      {children}
    </div>
  );
}

/* ---------------- progress + final video ---------------- */

function JobProgress({
  jobId,
  onReset,
}: {
  jobId: string;
  onReset: () => void;
}) {
  const lastStatusRef = useRef<string | null>(null);

  const query = useGetVideoStudioJob(jobId, {
    query: {
      queryKey: getGetVideoStudioJobQueryKey(jobId),
      // Poll fast while running; once terminal, stop refetching.
      refetchInterval: (q) => {
        const data = q.state.data as VideoStudioJobStatus | undefined;
        if (!data) return 2500;
        if (
          data.status === "complete" ||
          data.status === "failed" ||
          data.status === "cancelled"
        ) {
          return false;
        }
        return 2500;
      },
      refetchOnWindowFocus: false,
      retry: 2,
    },
  });

  const cancelJob = useCancelVideoStudioJob({
    mutation: {
      onSuccess: () => {
        toast.message("Cancelling…");
        void query.refetch();
      },
      onError: (err: unknown) => {
        const msg = err instanceof Error ? err.message : "Failed to cancel";
        toast.error(msg);
      },
    },
  });

  const job = query.data;

  // Toast on terminal transitions.
  useEffect(() => {
    if (!job) return;
    if (job.status === lastStatusRef.current) return;
    lastStatusRef.current = job.status;
    if (job.status === "complete") {
      toast.success("Video generation complete");
    } else if (job.status === "failed") {
      toast.error(job.error ?? "Video generation failed");
    } else if (job.status === "cancelled") {
      toast.message("Video generation cancelled");
    }
  }, [job]);

  // Polling failed (network, 5xx, etc) — surface a recovery action so
  // the user isn't stuck on a "Connecting…" spinner.
  if (query.isError && !job) {
    return (
      <Card className="p-5 border-destructive/40">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-destructive mt-0.5" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium">
              Lost connection to the engine
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              We couldn't fetch this job's status. The job may still be running
              in the background.
            </div>
            <div className="mt-3 flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => query.refetch()}
                className="gap-2"
                data-testid="button-retry-poll"
              >
                <RefreshCw className="w-3.5 h-3.5" /> Retry
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={onReset}
                data-testid="button-reset-job-error"
              >
                Start over
              </Button>
            </div>
          </div>
        </div>
      </Card>
    );
  }

  if (query.isLoading || !job) {
    return (
      <Card className="p-5">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" /> Connecting to engine…
        </div>
      </Card>
    );
  }

  const isRunning = job.status === "queued" || job.status === "running";

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground">
              Job · {job.id.slice(0, 8)}
            </div>
            <div className="mt-1 text-sm font-medium truncate">
              {job.message || STAGE_LABELS[job.stage] || job.stage}
            </div>
          </div>
          <StatusBadge status={job.status} />
        </div>
        <div className="mt-4 space-y-2">
          <Progress
            value={job.progressPercent}
            className="h-1.5"
            data-testid="progress-bar"
          />
          <div className="flex items-center justify-between text-[11px] font-mono uppercase tracking-widest text-muted-foreground">
            <span>
              Scene {Math.max(1, Math.min(job.currentPart, job.totalParts))} /{" "}
              {job.totalParts}
            </span>
            <span>{job.progressPercent}%</span>
          </div>
        </div>
        {isRunning && (
          <div className="mt-4 flex justify-end">
            <Button
              size="sm"
              variant="outline"
              disabled={cancelJob.isPending}
              onClick={() => cancelJob.mutate({ id: job.id })}
              className="gap-2"
              data-testid="button-cancel-job"
            >
              {cancelJob.isPending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Square className="w-3.5 h-3.5" />
              )}
              Cancel
            </Button>
          </div>
        )}
      </Card>

      <VisualBibleGallery job={job} />
      <ChunkTimeline chunks={job.chunks} />

      {job.status === "complete" && job.finalVideoObjectPath && (
        <FinalPlayer
          job={job}
          onReset={onReset}
        />
      )}

      {job.status === "failed" && (
        <Card className="p-5 border-destructive/40">
          <div className="flex items-start gap-3">
            <XCircle className="w-5 h-5 text-destructive mt-0.5" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium">Generation failed</div>
              <div className="text-xs text-muted-foreground mt-1 break-words">
                {job.error ?? "Unknown error"}
              </div>
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={onReset}
                data-testid="button-reset-job"
              >
                Try again
              </Button>
            </div>
          </div>
        </Card>
      )}

      {job.status === "cancelled" && (
        <Card className="p-5 border-border">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-muted-foreground mt-0.5" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium">Generation cancelled</div>
              <div className="text-xs text-muted-foreground mt-1">
                The job was stopped before the final video could be merged.
              </div>
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={onReset}
                data-testid="button-reset-cancelled"
              >
                New generation
              </Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}

function StatusBadge({
  status,
}: {
  status: (typeof VideoStudioJobStatusStatus)[keyof typeof VideoStudioJobStatusStatus];
}) {
  if (status === "complete") {
    return (
      <Badge className="font-mono uppercase tracking-widest bg-emerald-600/20 text-emerald-300 border-emerald-700/40">
        <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Complete
      </Badge>
    );
  }
  if (status === "failed") {
    return (
      <Badge className="font-mono uppercase tracking-widest bg-destructive/20 text-destructive border-destructive/40">
        <XCircle className="w-3.5 h-3.5 mr-1" /> Failed
      </Badge>
    );
  }
  if (status === "cancelled") {
    return (
      <Badge variant="secondary" className="font-mono uppercase tracking-widest">
        Cancelled
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="font-mono uppercase tracking-widest">
      <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> {status}
    </Badge>
  );
}

/**
 * Slim shape of the live `visualBible` field that the API server
 * appends to each snapshot. Not in the openapi schema yet, so we read
 * it via a typed cast on the snapshot.
 */
interface LiveVisualBible {
  characters: Array<{
    id: string;
    name: string;
    referenceImageObjectPath: string;
  }>;
  locations: Array<{
    id: string;
    name: string;
    referenceImageObjectPath: string;
  }>;
  openingFrame?: { objectPath: string };
}

/**
 * Live playground that renders character reference frames, the
 * primary location, and the opening frame as they stream in from
 * the engine. Empty until the first NB2 call lands; cards appear
 * one-by-one with the correct image once each is ready.
 */
function VisualBibleGallery({ job }: { job: VideoStudioJobStatus }) {
  const bible = (job as unknown as { visualBible?: LiveVisualBible | null })
    .visualBible;
  const characters = bible?.characters ?? [];
  const location = bible?.locations?.[0];
  const opening = bible?.openingFrame;
  const hasAny = characters.length > 0 || location || opening;
  if (!hasAny) {
    if (
      job.stage === "designing_chars" ||
      job.stage === "writing_story" ||
      job.stage === "queued"
    ) {
      return (
        <Card className="p-5">
          <div className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground mb-3">
            Visual bible
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            Waiting for the first reference frame…
          </div>
        </Card>
      );
    }
    return null;
  }
  return (
    <Card className="p-5" data-testid="visual-bible-gallery">
      <div className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground mb-3">
        Visual bible · live
      </div>
      {characters.length > 0 && (
        <div className="mb-4">
          <div className="text-xs text-muted-foreground mb-2">
            Characters ({characters.length})
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {characters.map((c) => (
              <ReferenceTile
                key={c.id}
                label={c.name || "Character"}
                objectPath={c.referenceImageObjectPath}
                aspect={job.aspectRatio}
                testId={`vb-character-${c.id}`}
              />
            ))}
          </div>
        </div>
      )}
      {(location || opening) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {location && (
            <ReferenceTile
              label={`Location · ${location.name || ""}`}
              objectPath={location.referenceImageObjectPath}
              aspect={job.aspectRatio}
              testId="vb-location"
            />
          )}
          {opening && (
            <ReferenceTile
              label="Opening frame"
              objectPath={opening.objectPath}
              aspect={job.aspectRatio}
              testId="vb-opening"
            />
          )}
        </div>
      )}
    </Card>
  );
}

function ReferenceTile({
  label,
  objectPath,
  aspect,
  testId,
}: {
  label: string;
  objectPath: string;
  aspect: VideoStudioJobStatus["aspectRatio"];
  testId?: string;
}) {
  const aspectClass =
    aspect === "9:16"
      ? "aspect-[9/16]"
      : aspect === "1:1"
        ? "aspect-square"
        : "aspect-video";
  const url = objectPath ? objectPathToUrl(objectPath) : null;
  return (
    <div className="space-y-1.5" data-testid={testId}>
      <div
        className={cn(
          "relative w-full overflow-hidden rounded-md bg-muted/40 border border-border",
          aspectClass,
        )}
      >
        {url ? (
          <img
            src={url}
            alt={label}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
          </div>
        )}
      </div>
      <div className="text-[11px] font-medium truncate">{label}</div>
    </div>
  );
}

function ChunkTimeline({
  chunks,
}: {
  chunks: VideoStudioJobStatus["chunks"];
}) {
  if (!chunks || chunks.length === 0) return null;
  return (
    <Card className="p-5">
      <div className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground mb-3">
        Scene timeline · live
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {[...chunks]
          .sort((a, b) => a.partNumber - b.partNumber)
          .map((c) => (
            <ChunkTile key={c.partNumber} chunk={c} />
          ))}
      </div>
    </Card>
  );
}

function ChunkTile({
  chunk: c,
}: {
  chunk: VideoStudioJobStatus["chunks"][number];
}) {
  const videoUrl = c.videoObjectPath ? objectPathToUrl(c.videoObjectPath) : null;
  const lastFrameUrl = c.lastFrameObjectPath
    ? objectPathToUrl(c.lastFrameObjectPath)
    : null;
  return (
    <div
      className="rounded-md border border-border bg-card/40 p-2.5 space-y-2"
      data-testid={`chunk-${c.partNumber}`}
    >
      <div className="flex items-center gap-2 text-[11px]">
        <ChunkStatusDot status={c.status} />
        <div className="font-mono uppercase tracking-widest text-muted-foreground">
          Scene {c.partNumber}
        </div>
        <div className="font-mono text-muted-foreground/70 ml-auto">
          {c.timeRangeStart}s–{c.timeRangeEnd}s
        </div>
      </div>
      <div className="relative w-full aspect-video rounded overflow-hidden bg-muted/40">
        {videoUrl ? (
          <video
            src={videoUrl}
            className="w-full h-full object-cover"
            muted
            playsInline
            controls
            preload="metadata"
            poster={lastFrameUrl ?? undefined}
          />
        ) : lastFrameUrl ? (
          <img
            src={lastFrameUrl}
            alt={`Scene ${c.partNumber} preview`}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            {c.status === "generating" ? (
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
            ) : (
              <span className="text-[11px] uppercase tracking-widest font-mono text-muted-foreground/60">
                {statusCopy(c.status)}
              </span>
            )}
          </div>
        )}
      </div>
      <div className="text-[11px] text-muted-foreground line-clamp-2 min-h-[2.2em]">
        {c.summary ?? c.error ?? statusCopy(c.status)}
      </div>
    </div>
  );
}

function statusCopy(
  status: (typeof VideoStudioChunkStatusStatus)[keyof typeof VideoStudioChunkStatusStatus],
): string {
  switch (status) {
    case "complete":
      return "Done";
    case "generating":
      return "Generating…";
    case "failed":
      return "Failed";
    default:
      return "Queued";
  }
}

function ChunkStatusDot({
  status,
}: {
  status: (typeof VideoStudioChunkStatusStatus)[keyof typeof VideoStudioChunkStatusStatus];
}) {
  const cls =
    status === "complete"
      ? "bg-emerald-500"
      : status === "failed"
        ? "bg-destructive"
        : status === "generating"
          ? "bg-primary animate-pulse"
          : "bg-muted-foreground/40";
  return <span className={cn("w-2 h-2 rounded-full shrink-0", cls)} />;
}

function FinalPlayer({
  job,
  onReset,
}: {
  job: VideoStudioJobStatus;
  onReset: () => void;
}) {
  const videoSrc = job.finalVideoObjectPath
    ? objectPathToUrl(job.finalVideoObjectPath)
    : "";
  const thumbSrc = job.thumbnailObjectPath
    ? objectPathToUrl(job.thumbnailObjectPath)
    : undefined;

  return (
    <Card className="p-5 space-y-4">
      <div className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground">
        Final video
      </div>
      <video
        controls
        playsInline
        poster={thumbSrc}
        src={videoSrc}
        className="w-full rounded-md bg-black"
        data-testid="video-final-player"
      />
      <div className="flex flex-wrap gap-2">
        <a href={videoSrc} download={`video-${job.id.slice(0, 8)}.mp4`}>
          <Button size="sm" className="gap-2" data-testid="button-download-mp4">
            <Download className="w-4 h-4" /> Download MP4
          </Button>
        </a>
        {job.voiceoverScript && (
          <a
            href={`data:text/plain;charset=utf-8,${encodeURIComponent(
              job.voiceoverScript,
            )}`}
            download={`voiceover-${job.id.slice(0, 8)}.txt`}
          >
            <Button
              size="sm"
              variant="outline"
              className="gap-2"
              data-testid="button-download-script"
            >
              <Download className="w-4 h-4" /> Download Script
            </Button>
          </a>
        )}
        <Button
          size="sm"
          variant="ghost"
          onClick={onReset}
          data-testid="button-new-generation"
        >
          New generation
        </Button>
      </div>
    </Card>
  );
}
