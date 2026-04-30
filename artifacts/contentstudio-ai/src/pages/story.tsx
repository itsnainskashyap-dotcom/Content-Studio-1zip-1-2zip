import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import {
  Loader2,
  Play,
  ArrowRight,
  Volume2,
  CheckCircle2,
  RefreshCw,
  Send,
  Lock,
  Unlock,
  User,
  MessageCircle,
  Eye,
  X,
  Download,
  ImageIcon,
  AlertCircle,
  Settings2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import {
  useGenerateStory,
  useContinueStory,
  useGenerateCharacterImages,
  useGenerateFrameImage,
  useQcFrameImage,
  useRegenerateCharacterImage,
  type StoryResponse,
} from "@workspace/api-client-react";
import {
  autoGenerateFramesForProject,
  type AutoFrameProgress,
  type CharacterRef,
} from "@/lib/auto-frame-generation";
import {
  storage,
  createEmptyProject,
  GENRES,
  STYLES,
  ASPECT_RATIOS,
  DEFAULT_ASPECT_RATIO,
  type AspectRatio,
  type Project,
  type ProjectCharacterImages,
  type VoiceoverLanguage,
} from "@/lib/storage";
import { useApiCall, mutationCaller } from "@/lib/api-call";
import { useGeneration } from "@/lib/use-generation";
import { imageRefSrc, hasImage } from "@/lib/image-url";
import { ErrorCard } from "@/components/error-card";
import { CopyButton } from "@/components/copy-button";
import { InlinePrompts } from "@/components/inline-prompts";

/**
 * Per-character image entry shape used throughout this page. After the
 * Object Storage migration both `objectPath` (server URL) and the legacy
 * `b64Json` (inline base64) are optional — generated images use objectPath,
 * legacy projects still carry b64Json until migrate-local-projects runs.
 */
type CharImageEntry = {
  objectPath?: string;
  b64Json?: string;
  mimeType: string;
};

interface DurationPreset {
  key: string;
  label: string;
  seconds: number | null;
}
const DURATIONS: DurationPreset[] = [
  { key: "30s", label: "30s", seconds: 30 },
  { key: "1min", label: "1 min", seconds: 60 },
  { key: "2min", label: "2 min", seconds: 120 },
  { key: "3min", label: "3 min", seconds: 180 },
  { key: "5min", label: "5 min", seconds: 300 },
  { key: "custom", label: "Custom", seconds: null },
];

const VO_OPTIONS: Array<{ key: VoiceoverLanguage; label: string }> = [
  { key: "none", label: "No VO" },
  { key: "hindi", label: "हिंदी" },
  { key: "english", label: "English" },
  { key: "hinglish", label: "Hinglish" },
];

interface PrefillTemplate {
  brief?: string;
  genre?: string;
  totalDurationSeconds?: number;
  style?: string;
  voiceoverLanguage?: VoiceoverLanguage;
  autoGenerate?: boolean;
}

type ChatMessage =
  | { id: string; role: "user"; text: string }
  | { id: string; role: "assistant"; text: string; story: StoryResponse };

function newMsgId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `m_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// Progress steps shown while the AI is writing a fresh story from a brief.
// Cycled in order; the last one stays put if the request takes longer than
// the full sequence.
const STORY_GEN_STEPS = [
  "Reading your brief…",
  "Building the world…",
  "Casting characters…",
  "Outlining the acts…",
  "Writing scenes…",
  "Adding dialogue…",
  "Polishing the story…",
];

// Progress steps for chat revisions (continueStory). Shorter sequence — the
// model is editing an existing story rather than building from scratch.
const STORY_REVISE_STEPS = [
  "Reading your note…",
  "Re-thinking the story…",
  "Tweaking scenes…",
  "Rewriting dialogue…",
  "Polishing…",
];

// Cycles through `steps` while `active` is true, ~1.8s per step. The final
// step stays once reached. Resets to step 0 every time `active` flips
// false → true so each new request starts the sequence fresh.
function useProgressSteps(active: boolean, steps: string[]): string {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (!active) {
      setIndex(0);
      return;
    }
    setIndex(0);
    const id = window.setInterval(() => {
      setIndex((i) => (i < steps.length - 1 ? i + 1 : i));
    }, 1800);
    return () => window.clearInterval(id);
  }, [active, steps]);
  return steps[Math.min(index, steps.length - 1)] ?? steps[0] ?? "";
}

export default function StoryBuilder() {
  const [, _navigate] = useLocation();
  void _navigate;
  const [brief, setBrief] = useState("");
  const [genre, setGenre] = useState("Drama");
  const [durationKey, setDurationKey] = useState<string>("30s");
  const [customMin, setCustomMin] = useState(0);
  const [customSec, setCustomSec] = useState(45);
  const [styleName, setStyleName] = useState<string | null>(null);
  const [voLanguage, setVoLanguage] = useState<VoiceoverLanguage>("none");
  const [aspectRatio, setAspectRatio] =
    useState<AspectRatio>(DEFAULT_ASPECT_RATIO);
  const [project, setProject] = useState<Project | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [finalized, setFinalized] = useState(false);
  const [showPrompts, setShowPrompts] = useState(false);
  const [autoStartGen, setAutoStartGen] = useState(false);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  const generateStoryMut = useGenerateStory();
  const continueStoryMut = useContinueStory();
  const charImagesMut = useGenerateCharacterImages();
  const regenCharImageMut = useRegenerateCharacterImage();
  const frameImageMut = useGenerateFrameImage();
  const qcFrameImageMut = useQcFrameImage();
  // Tracks the currently-running auto-frame batch so a chat reset / unmount
  // can stop us from queueing more frames after the user moved on. The
  // batch itself can't cancel an already-fired Gemini call, but the abort
  // signal short-circuits between frames (see auto-frame-generation.ts).
  const autoFrameAbortRef = useRef<AbortController | null>(null);
  // Toast id of the in-flight auto-frame batch so per-frame progress
  // updates an existing toast instead of stacking dozens of new ones.
  const autoFrameToastRef = useRef<string | number | null>(null);

  // The character whose "Custom" button is currently being clicked, if any.
  // Drives the CustomImageModal below. `null` means the modal is closed.
  const [customTarget, setCustomTarget] = useState<{
    msgId: string;
    name: string;
    description: string;
  } | null>(null);

  /**
   * Persist (or clear) the character-image cache onto the *current* project
   * so that a hard refresh restores them instantly without re-calling Gemini.
   * The signature lets us detect when the cast/style changes — in that case
   * the saved sheets are stale and we drop them on the next save.
   *
   * Always writes to `storage` AND to local state so the in-memory project
   * stays in sync (otherwise the next save would overwrite this).
   */
  const persistCharacterImages = (
    items: Record<string, CharImageEntry> | null,
    sig: string | null,
  ) => {
    setProject((prev) => {
      if (!prev) return prev;
      const nextField: ProjectCharacterImages | null =
        items && sig
          ? { sig, items, updatedAt: new Date().toISOString() }
          : null;
      const updated: Project = { ...prev, characterImages: nextField };
      try {
        storage.saveProject(updated);
      } catch (err) {
        // localStorage quota is the realistic failure mode here. Don't crash
        // the UI; the in-memory copy still works for this session and the
        // next refresh just re-generates.
        console.warn("Failed to persist character images:", err);
      }
      return updated;
    });
  };
  const storyCall = useApiCall(mutationCaller(generateStoryMut.mutateAsync));
  const continueCall = useApiCall(
    mutationCaller(continueStoryMut.mutateAsync),
  );
  const generation = useGeneration();

  // Rotating progress text shown while the AI is writing / revising the
  // story. Two separate sequences — initial generation vs. chat tweak.
  const initialProgressLabel = useProgressSteps(
    storyCall.loading,
    STORY_GEN_STEPS,
  );
  const reviseProgressLabel = useProgressSteps(
    continueCall.loading,
    STORY_REVISE_STEPS,
  );

  // Per-message character-image state. Each assistant message (a story turn)
  // gets its own image set, so older turns keep showing the images they were
  // generated with even after a revision.
  const [imagesByMsgId, setImagesByMsgId] = useState<
    Record<string, Record<string, CharImageEntry>>
  >({});
  const [imageStatusByMsgId, setImageStatusByMsgId] = useState<
    Record<string, "loading" | "done" | "partial" | "error">
  >({});
  const [imageNoteByMsgId, setImageNoteByMsgId] = useState<
    Record<string, string>
  >({});

  // Cache the last successful generation. Signature combines visual style with
  // the cast so a style change forces fresh art (Code-review fix).
  const lastCharSigRef = useRef<{
    sig: string;
    images: Record<string, CharImageEntry>;
    seq: number;
  } | null>(null);

  // Sequence counter ensures only the most recent in-flight generation is
  // allowed to write back to state / cache (prevents stale-overlap writes).
  const charGenSeqRef = useRef(0);

  // Names of characters the user has explicitly customised via the "Custom"
  // button on the current cast. Their images live in
  // `project.characterImages.items` and must NOT be silently overwritten by a
  // subsequent auto-batch run on the same cast (e.g. after a chat tweak that
  // re-renders the assistant turn). Cleared on "New brief"; entries for
  // characters that vanish from the cast are dropped lazily inside
  // `triggerCharacterImageGen`.
  const customCharsRef = useRef<Set<string>>(new Set());

  // Mounted guard — drop late state writes after navigation/unmount.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // Stop any in-flight auto-frame batch from queueing more frames once
      // the page is gone (the toast would never get dismissed otherwise).
      autoFrameAbortRef.current?.abort();
    };
  }, []);

  // Cap how many turns we keep image payloads for. Each PNG is ~1-2MB base64
  // chars; over a long chat session this can pile up. Keep the latest few.
  const MAX_RETAINED_IMAGE_TURNS = 3;
  const pruneOldImageTurns = (
    map: Record<string, Record<string, CharImageEntry>>,
    keepMsgId: string,
  ): Record<string, Record<string, CharImageEntry>> => {
    const ids = Object.keys(map);
    if (ids.length <= MAX_RETAINED_IMAGE_TURNS) return map;
    // Newest first: ensure the freshly-set msgId is kept; drop the oldest.
    const ordered = [keepMsgId, ...ids.filter((x) => x !== keepMsgId)];
    const keep = new Set(ordered.slice(0, MAX_RETAINED_IMAGE_TURNS));
    const next: typeof map = {};
    for (const id of ids) if (keep.has(id)) next[id] = map[id];
    return next;
  };

  const buildCharSignature = (
    chars: { name: string; description: string }[],
    style: string,
  ): string =>
    `style=${style}::` +
    chars
      .map((c) => `${c.name}|||${c.description}`)
      .sort()
      .join("§§§");

  /**
   * Render every still that's missing on the active project's parts using
   * the freshly-generated character sheets as visual references, then
   * QC each one and regenerate poor matches once. Aborts cleanly if the
   * user resets the chat or unmounts the page mid-batch.
   *
   * Skips frames that already have an image (objectPath OR legacy b64Json)
   * — never silently overwrite a render the user kept.
   */
  const triggerAutoFrameGeneration = async (
    projectId: string,
    characterReferences: CharacterRef[],
    style: string,
    aspectRatioForBatch: AspectRatio,
  ): Promise<void> => {
    // Cancel any earlier batch — only the latest "characters done" event
    // should drive frame rendering. The aborted batch will exit between
    // frames; the in-flight Gemini call (if any) still completes.
    autoFrameAbortRef.current?.abort();
    const ctrl = new AbortController();
    autoFrameAbortRef.current = ctrl;

    // Capture the toast id locally so this run can only ever touch its
    // OWN toast. Otherwise a slow aborted batch could dismiss the toast
    // belonging to the newer batch that just took over (race observed in
    // code review). The shared `autoFrameToastRef` is only used as a
    // global "what's currently shown?" tracker, and we only clear it if
    // it still points to OUR toast id.
    const myToastId = toast.loading(
      "Auto-rendering frames with the new cast…",
    );
    autoFrameToastRef.current = myToastId;
    const updateToast = (
      msg: string,
      kind: "loading" | "success" | "info" | "error" = "loading",
    ) => {
      const opts = { id: myToastId };
      if (kind === "loading") toast.loading(msg, opts);
      else if (kind === "success") toast.success(msg, opts);
      else if (kind === "error") toast.error(msg, opts);
      else toast.message(msg, opts);
    };
    const dismissMine = () => {
      toast.dismiss(myToastId);
      if (autoFrameToastRef.current === myToastId) {
        autoFrameToastRef.current = null;
      }
    };
    const releaseMine = () => {
      // Final state shown — release the slot but DON'T dismiss (success
      // / error toasts should auto-dismiss on their own timer).
      if (autoFrameToastRef.current === myToastId) {
        autoFrameToastRef.current = null;
      }
    };

    const onProgress = (e: AutoFrameProgress) => {
      if (ctrl.signal.aborted) return;
      const label = e.kind === "starting" ? "1st" : "last";
      if (e.status === "generating") {
        updateToast(
          `Rendering ${label} frame for part ${e.partNumber} (${e.current}/${e.total})…`,
        );
      } else if (e.status === "qc") {
        updateToast(
          `QC review for ${label} frame, part ${e.partNumber} (${e.current}/${e.total})…`,
        );
      } else if (e.status === "regenerating") {
        const score =
          typeof e.qcScore === "number" ? ` (QC ${e.qcScore.toFixed(0)}/10)` : "";
        updateToast(
          `Regenerating ${label} frame for part ${e.partNumber}${score}…`,
        );
      }
    };

    try {
      const summary = await autoGenerateFramesForProject(projectId, {
        characterReferences,
        style,
        aspectRatio: aspectRatioForBatch,
        generateFrame: (args) => frameImageMut.mutateAsync(args),
        qcFrame: (args) => qcFrameImageMut.mutateAsync(args),
        onProgress,
        signal: ctrl.signal,
      });
      if (ctrl.signal.aborted) {
        // Silent abort — a newer batch took over (or the page unmounted).
        dismissMine();
        return;
      }
      if (summary.totalPlanned === 0) {
        dismissMine();
        return;
      }
      const parts: string[] = [];
      parts.push(
        `Auto-rendered ${summary.generated} frame${summary.generated === 1 ? "" : "s"}`,
      );
      if (summary.regenerated > 0) {
        parts.push(`${summary.regenerated} retried after QC`);
      }
      if (summary.failed > 0) {
        parts.push(`${summary.failed} failed`);
      }
      if (summary.skipped > 0) {
        parts.push(`${summary.skipped} kept as-is`);
      }
      const msg = parts.join(" · ");
      if (summary.failed > 0 && summary.generated === 0) {
        updateToast(msg, "error");
      } else {
        updateToast(msg, "success");
      }
      releaseMine();
    } catch (err) {
      if (ctrl.signal.aborted) {
        dismissMine();
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      updateToast(`Auto-frame generation stopped: ${msg}`, "error");
      releaseMine();
    }
  };

  const triggerCharacterImageGen = async (
    msgId: string,
    story: StoryResponse,
    style: string | null,
    /**
     * Optional subset of character names to generate (default: chars without
     * a persisted image). Used by the "Retry missing" path so we only re-call
     * Gemini for the characters not already in the persisted cache.
     */
    onlyNames?: Set<string>,
    /**
     * Force a full re-run of every character even when persisted images
     * already exist. Used by the "Retry all" path. Without this flag, the
     * default behaviour is to ONLY fetch characters that don't have a
     * persisted image — so a refresh / chat-continuation never silently
     * regenerates images the user already has, matching the user's hard
     * requirement: "once generated, they must persist and never
     * auto-regenerate unless I explicitly click Custom".
     */
    force?: boolean,
  ) => {
    if (!story.characters || story.characters.length === 0) return;
    const effectiveStyle = style ?? "Live Action Cinematic";
    const sig = buildCharSignature(story.characters, effectiveStyle);

    // Build the working cast list. Precedence:
    //   1. Explicit onlyNames (e.g. "Retry missing" with a known subset)
    //   2. force=true (user clicked "Retry all") → every character
    //   3. default → only characters that DON'T already have a persisted
    //      image. This is the core of the no-auto-regen guarantee: a
    //      style or description tweak no longer wipes the existing
    //      character sheets.
    const persistedItems =
      project?.characterImages?.items ?? ({} as Record<string, CharImageEntry>);
    const hasPersisted = (name: string): boolean => hasImage(persistedItems[name]);

    let requestedChars = story.characters;
    if (onlyNames) {
      requestedChars = story.characters.filter((c) => onlyNames.has(c.name));
    } else if (!force) {
      requestedChars = story.characters.filter((c) => !hasPersisted(c.name));
    }

    // If every character already has a persisted image and we're not forced
    // or filtered, just seed the per-msg cache and mark done — no API call.
    if (requestedChars.length === 0) {
      if (!mountedRef.current) return;
      const seeded: Record<string, CharImageEntry> = {};
      for (const c of story.characters) {
        if (hasPersisted(c.name)) seeded[c.name] = persistedItems[c.name];
      }
      setImagesByMsgId((prev) =>
        pruneOldImageTurns({ ...prev, [msgId]: seeded }, msgId),
      );
      setImageStatusByMsgId((prev) => ({ ...prev, [msgId]: "done" }));
      lastCharSigRef.current = {
        sig,
        images: seeded,
        seq: charGenSeqRef.current,
      };
      return;
    }

    const mySeq = ++charGenSeqRef.current;
    setImageStatusByMsgId((prev) => ({ ...prev, [msgId]: "loading" }));
    setImageNoteByMsgId((prev) => {
      const next = { ...prev };
      delete next[msgId];
      return next;
    });

    // Hard deadline guard. Promise.race only short-circuits the local await —
    // the underlying request keeps running (the generated mutation hook does
    // not expose AbortSignal). The mountedRef + seq checks below prevent any
    // late state writes from doing damage.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error("Character image generation timed out.")),
        360_000,
      );
    });

    const isStillCurrent = () =>
      mountedRef.current && charGenSeqRef.current === mySeq;

    try {
      const result = await Promise.race([
        charImagesMut.mutateAsync({
          data: {
            characters: requestedChars.map((c) => ({
              name: c.name,
              description: c.description,
            })),
            style: effectiveStyle,
          },
        }),
        timeoutPromise,
      ]);
      if (timer) clearTimeout(timer);

      // Bail out if the component unmounted OR a reset bumped the seq counter.
      // After a reset the chat is empty, so writing back to old msgIds would
      // re-introduce ghost state that the user explicitly cleared.
      if (!isStillCurrent()) return;
      const map: Record<string, CharImageEntry> = {};
      for (const img of result.images) {
        map[img.name] = { objectPath: img.objectPath, mimeType: img.mimeType };
      }
      const failed = result.errors.length;

      // Prune customCharsRef to the names that still exist in the current
      // cast (a renamed/removed character should not "stick" in the override
      // set forever).
      const currentCastNames = new Set(story.characters.map((c) => c.name));
      for (const customName of Array.from(customCharsRef.current)) {
        if (!currentCastNames.has(customName)) {
          customCharsRef.current.delete(customName);
        }
      }

      // Single merge+save path used by BOTH full success and partial success.
      // Without this, a partial batch failure leaves project.characterImages
      // empty and every subsequent refresh re-runs the whole batch — exactly
      // the "every refresh regenerates" bug the user reported.
      setProject((prev) => {
        if (!prev) return prev;
        // Carry forward ALL previously-persisted items regardless of sig.
        // The sig-match guard used to wipe the entire snapshot whenever the
        // user changed style or any character description — which made a
        // refresh after a tweak silently re-run Gemini for every character,
        // even ones that hadn't changed. Per the user's hard requirement
        // ("once generated, never auto-regenerate unless I click Custom"),
        // the persisted snapshot is the source of truth and we only ever
        // ADD to it from a fresh API result; we never drop entries based on
        // a sig mismatch.
        const carry = prev.characterImages?.items ?? {};
        const overrideMap: typeof map = {};
        for (const customName of customCharsRef.current) {
          const persistedCustom = prev.characterImages?.items?.[customName];
          if (persistedCustom) overrideMap[customName] = persistedCustom;
        }
        // Precedence: carried cache → fresh API result → user customs (top).
        const merged = { ...carry, ...map, ...overrideMap };
        // Mirror the merged map into in-memory message state and the dedup
        // cache so subsequent renders see the same thing.
        setImagesByMsgId((prevImages) =>
          pruneOldImageTurns({ ...prevImages, [msgId]: merged }, msgId),
        );
        lastCharSigRef.current = { sig, images: merged, seq: mySeq };
        // Persist scoped to the FULL current cast (not just what we requested
        // this round) so the snapshot stays well-formed across partial runs.
        const persistedNext: typeof merged = {};
        for (const c of story.characters) {
          if (merged[c.name]) persistedNext[c.name] = merged[c.name];
        }
        const updated: Project = {
          ...prev,
          characterImages: {
            sig,
            items: persistedNext,
            updatedAt: new Date().toISOString(),
          },
        };
        try {
          storage.saveProject(updated);
        } catch (err) {
          console.warn("Failed to persist character images:", err);
        }
        return updated;
      });

      if (failed === 0) {
        setImageStatusByMsgId((prev) => ({ ...prev, [msgId]: "done" }));
      } else {
        setImageStatusByMsgId((prev) => ({ ...prev, [msgId]: "partial" }));
        setImageNoteByMsgId((prev) => ({
          ...prev,
          [msgId]: `${failed} of ${requestedChars.length} character${failed === 1 ? "" : "s"} failed. Click retry to try again.`,
        }));
      }

      // Once the cast is locked in, kick off auto-frame generation so the
      // 1st/last stills for every part render with the same characters.
      // We only run this on a clean batch (failed===0) so we're not chasing
      // a half-built cast. If the user explicitly clicked "Custom" on a
      // single character, that path doesn't reach here either — by design.
      const projectIdForFrames = project?.id;
      if (failed === 0 && projectIdForFrames) {
        const refs: CharacterRef[] = [];
        for (const c of story.characters) {
          const persisted =
            (storage.getProject(projectIdForFrames)?.characterImages?.items ?? {})[
              c.name
            ];
          if (persisted?.objectPath && persisted.mimeType) {
            refs.push({ objectPath: persisted.objectPath, mimeType: persisted.mimeType });
          }
        }
        // Fire-and-forget — the batch updates project state via storage,
        // and React Query subscribers re-render automatically. We don't
        // await it because the user shouldn't be blocked from chatting
        // while the frames render in the background (can take 30s+).
        void triggerAutoFrameGeneration(
          projectIdForFrames,
          refs,
          effectiveStyle,
          aspectRatio,
        );
      }
    } catch (err) {
      if (timer) clearTimeout(timer);
      // Same reset/unmount guard for the failure path.
      if (!isStillCurrent()) return;
      setImageStatusByMsgId((prev) => ({ ...prev, [msgId]: "error" }));
      // User-facing message — don't leak raw upstream errors. Detailed errors
      // are still logged via the network tab / server logs.
      const friendly =
        err instanceof Error && /timed out/i.test(err.message)
          ? "Character image generation timed out. Click retry."
          : "Couldn't generate character reference images. Click retry.";
      setImageNoteByMsgId((prev) => ({ ...prev, [msgId]: friendly }));
    }
  };

  // True when ANY message still has character images mid-generation.
  const anyCharImagesLoading = useMemo(
    () => Object.values(imageStatusByMsgId).some((s) => s === "loading"),
    [imageStatusByMsgId],
  );

  const totalDurationSeconds = useMemo(() => {
    const preset = DURATIONS.find((d) => d.key === durationKey);
    if (!preset) return 30;
    if (preset.seconds !== null) return preset.seconds;
    return Math.min(3600, Math.max(15, customMin * 60 + customSec));
  }, [durationKey, customMin, customSec]);

  const partsCount = useMemo(
    () => Math.max(1, Math.ceil(totalDurationSeconds / 15)),
    [totalDurationSeconds],
  );

  // Scroll chat to bottom on new message
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, storyCall.loading, continueCall.loading]);

  // Re-sync the local project state every time the central project cache
  // changes (server hydrate completes, character images saved from another
  // tab, etc). Without this, navigating back to /story before hydration
  // finishes leaves the page rendering stale data — character reference
  // sheets and saved frames silently disappear from the UI.
  useEffect(() => {
    const sync = () => {
      const fresh = storage.getCurrentProject();
      if (!fresh) return;
      setProject(fresh);
    };
    window.addEventListener("cs:projects-changed", sync);
    return () => {
      window.removeEventListener("cs:projects-changed", sync);
    };
  }, []);

  useEffect(() => {
    let prefill: PrefillTemplate | null = null;
    try {
      const raw = sessionStorage.getItem("cs_template");
      if (raw) {
        prefill = JSON.parse(raw) as PrefillTemplate;
        sessionStorage.removeItem("cs_template");
      }
    } catch {
      prefill = null;
    }

    const current = storage.getCurrentProject();
    if (current && !prefill) {
      setProject(current);
      setBrief(current.brief);
      setGenre(current.genre);
      setStyleName(current.style ?? null);
      setVoLanguage((current.voiceoverLanguage ?? "none") as VoiceoverLanguage);
      setAspectRatio(current.aspectRatio ?? DEFAULT_ASPECT_RATIO);
      const sec = current.totalDurationSeconds ?? current.totalDuration ?? 30;
      const preset = DURATIONS.find((d) => d.seconds === sec);
      if (preset) {
        setDurationKey(preset.key);
      } else {
        setDurationKey("custom");
        setCustomMin(Math.floor(sec / 60));
        setCustomSec(sec % 60);
      }
      if (current.story) {
        const restoredCommentary =
          current.story.commentary && current.story.commentary.trim().length > 0
            ? current.story.commentary
            : "Here's your story.";
        const restoredAssistantId = newMsgId();
        setMessages([
          {
            id: newMsgId(),
            role: "user",
            text: current.brief,
          },
          {
            id: restoredAssistantId,
            role: "assistant",
            text: restoredCommentary,
            story: current.story,
          },
        ]);
        // Auto-generate (or re-generate) the character reference sheets for
        // the restored story so the user sees images on reload too — not just
        // when they freshly clicked "Start the story". When the project
        // already has persisted images whose signature matches the current
        // cast + style, seed state from those instead of re-calling Gemini.
        if (
          current.story.characters &&
          current.story.characters.length > 0
        ) {
          const restoredStory = current.story;
          const restoredStyle = current.style ?? null;
          const effectiveStyle = restoredStyle ?? "Live Action Cinematic";
          const expectedSig = buildCharSignature(
            restoredStory.characters.map((c) => ({
              name: c.name,
              description: c.description,
            })),
            effectiveStyle,
          );
          const persisted = current.characterImages;
          // PER-NAME SEED — sig is now ignored on restore. The user's
          // explicit requirement: "once a character image is generated, it
          // must persist and never auto-regenerate unless I click Custom".
          // We seed from whatever per-character entries exist in the
          // persisted snapshot, regardless of style or description tweaks
          // since they were generated.
          const seeded: Record<string, CharImageEntry> = {};
          if (persisted?.items) {
            for (const c of restoredStory.characters) {
              const item = persisted.items[c.name];
              if (item && hasImage(item)) {
                seeded[c.name] = {
                  objectPath: item.objectPath,
                  b64Json: item.b64Json,
                  mimeType: item.mimeType,
                };
              }
            }
          }
          const seededNames = Object.keys(seeded);
          const missingNames = restoredStory.characters
            .map((c) => c.name)
            .filter((name) => !(name in seeded));

          // Always seed visible state from persisted, even when partially
          // empty. NEVER auto-fire Gemini on refresh — the user explicitly
          // forbade that. Missing characters get a retry CTA instead.
          if (seededNames.length > 0) {
            setImagesByMsgId((prev) =>
              pruneOldImageTurns(
                { ...prev, [restoredAssistantId]: seeded },
                restoredAssistantId,
              ),
            );
          }
          lastCharSigRef.current = {
            sig: expectedSig,
            images: seeded,
            seq: charGenSeqRef.current,
          };
          // Treat every seeded name as a custom-protected override so a
          // future auto-batch (e.g. after a chat tweak) preserves them
          // instead of silently overwriting.
          customCharsRef.current = new Set(seededNames);

          if (missingNames.length === 0 && seededNames.length > 0) {
            setImageStatusByMsgId((prev) => ({
              ...prev,
              [restoredAssistantId]: "done",
            }));
          } else if (seededNames.length === 0) {
            // No persisted images at all for this story. Surface the manual
            // retry CTA — and DO NOT auto-fire Gemini, even on a brand-new
            // story restored from a previous session where image gen had
            // never been attempted.
            setImageStatusByMsgId((prev) => ({
              ...prev,
              [restoredAssistantId]: "error",
            }));
            setImageNoteByMsgId((prev) => ({
              ...prev,
              [restoredAssistantId]: `Character images not generated yet. Click retry to fetch them.`,
            }));
          } else {
            setImageStatusByMsgId((prev) => ({
              ...prev,
              [restoredAssistantId]: "partial",
            }));
            setImageNoteByMsgId((prev) => ({
              ...prev,
              [restoredAssistantId]: `${missingNames.length} of ${restoredStory.characters.length} character${missingNames.length === 1 ? "" : "s"} not yet generated. Click retry to fetch them.`,
            }));
          }
        }
        // Restore the "finalized → generating prompts" state on remount.
        // Trigger if EITHER:
        //   (a) parts have already been saved to the project, OR
        //   (b) a generation job is still live in the GenerationContext for
        //       this project (covers the case where the user finalized,
        //       navigated away while the very first part was still
        //       generating, then came back — parts.length is still 0 but
        //       the job is alive and we must show the panel so they can
        //       see progress / cancel / etc.)
        const liveJob = generation.getJob(current.id);
        const hasLiveJob =
          !!liveJob &&
          (liveJob.status === "running" ||
            liveJob.status === "awaiting_next" ||
            liveJob.status === "done" ||
            liveJob.status === "error");
        if (current.parts.length > 0 || hasLiveJob) {
          setFinalized(true);
          setShowPrompts(true);
          // Don't auto-start a fresh job — InlinePrompts will recover the
          // existing one (or just display the saved parts).
          setAutoStartGen(false);
        }
      }
    } else if (prefill) {
      if (prefill.brief !== undefined) setBrief(prefill.brief);
      if (prefill.genre) setGenre(prefill.genre);
      if (prefill.style !== undefined) setStyleName(prefill.style);
      if (prefill.voiceoverLanguage)
        setVoLanguage(prefill.voiceoverLanguage);
      if (prefill.totalDurationSeconds) {
        const preset = DURATIONS.find(
          (d) => d.seconds === prefill!.totalDurationSeconds,
        );
        if (preset) {
          setDurationKey(preset.key);
        } else {
          setDurationKey("custom");
          setCustomMin(Math.floor(prefill.totalDurationSeconds / 60));
          setCustomSec(prefill.totalDurationSeconds % 60);
        }
      }
      storage.setCurrentProjectId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const latestStory: StoryResponse | null = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role === "assistant") return m.story;
    }
    return null;
  }, [messages]);

  const persistProject = (story: StoryResponse, existing?: Project | null): Project => {
    // ALWAYS re-read the latest persisted snapshot from storage before
    // merging so we don't clobber concurrent updates made via functional
    // setProject (e.g. handleRegenerateCustom or triggerCharacterImageGen
    // success-path persisting `characterImages`). The React `project` state
    // can be stale by the time the API call resolves.
    const latest =
      existing ??
      (project?.id ? (storage.getProject(project.id) ?? project) : project);
    let next = latest;
    if (!next) {
      next = createEmptyProject({
        title: story.title,
        brief,
        genre,
        totalDuration: totalDurationSeconds,
        style: styleName,
        voiceoverLanguage: voLanguage,
        aspectRatio,
      });
    } else {
      next = {
        ...next,
        title: story.title,
        brief,
        genre,
        totalDuration: totalDurationSeconds,
        totalDurationSeconds,
        partsCount,
        style: styleName,
        voiceoverLanguage: voLanguage,
        aspectRatio,
      };
    }
    next.story = story;
    const saved = storage.saveProject(next);
    storage.setCurrentProjectId(saved.id);
    setProject(saved);
    window.dispatchEvent(new Event("cs:projects-changed"));
    return saved;
  };

  const canGenerate =
    brief.trim().length > 0 && styleName !== null && totalDurationSeconds > 0;

  const handleGenerateInitial = async () => {
    if (!brief.trim()) {
      toast.error("Add a brief first");
      return;
    }
    if (!styleName) {
      toast.error("Pick a visual style");
      return;
    }
    // Reset chat
    setMessages([{ id: newMsgId(), role: "user", text: brief }]);
    setFinalized(false);
    setShowPrompts(false);
    const result = await storyCall.run({
      brief,
      genre,
      duration: totalDurationSeconds,
      totalDurationSeconds,
      partsCount,
      style: styleName,
      voiceoverLanguage: voLanguage,
    });
    if (result) {
      const note =
        result.commentary && result.commentary.trim().length > 0
          ? `${result.commentary}\n\nRead it through, then send any tweaks — "make act 2 darker", "add a twist ending", "change the protagonist to a woman" — and I'll revise. Hit Finalize when it feels right.`
          : "Here's your story. Read it through, then send any tweaks — \"make act 2 darker\", \"add a twist ending\", \"change the protagonist to a woman\", etc. When you're happy, hit Finalize.";
      const assistantMsgId = newMsgId();
      setMessages((m) => [
        ...m,
        {
          id: assistantMsgId,
          role: "assistant",
          text: note,
          story: result,
        },
      ]);
      persistProject(result);
      toast.success("Story generated");
      // Fire-and-forget: kick off character image generation for this turn.
      void triggerCharacterImageGen(assistantMsgId, result, styleName);
    }
  };

  const handleSendChat = async () => {
    if (finalized) {
      toast.error("Story is locked. Unlock to keep editing.");
      return;
    }
    const text = chatInput.trim();
    if (!text) return;
    if (!latestStory) {
      toast.error("Generate the story first");
      return;
    }
    setChatInput("");
    setMessages((m) => [...m, { id: newMsgId(), role: "user", text }]);
    const result = await continueCall.run({
      existingStory: latestStory,
      direction: text,
    });
    if (result) {
      const note =
        result.commentary && result.commentary.trim().length > 0
          ? result.commentary
          : "Updated. Anything else?";
      const assistantMsgId = newMsgId();
      setMessages((m) => [
        ...m,
        {
          id: assistantMsgId,
          role: "assistant",
          text: note,
          story: result,
        },
      ]);
      persistProject(result);
      // Refresh character images if the cast changed (the helper short-circuits
      // when the signature matches the previous successful generation).
      void triggerCharacterImageGen(assistantMsgId, result, styleName);
    }
  };

  const handleFinalize = () => {
    if (!latestStory) return;
    persistProject(latestStory);
    setFinalized(true);
    setShowPrompts(true);
    // Do NOT auto-start prompt generation. User reviews mode / frames /
    // references / voiceover / BGM settings first, then clicks the
    // "Generate part 1" button manually.
    setAutoStartGen(false);
    requestAnimationFrame(() => {
      const el = document.querySelector(
        '[data-testid="inline-prompts-section"]',
      );
      el?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    toast.success(
      "Story finalized — pick your settings, then hit Generate when ready.",
    );
  };

  const handleUnlock = () => {
    setFinalized(false);
    setShowPrompts(false);
    toast.message("Story unlocked — keep editing");
  };

  /**
   * Run a one-character regeneration with the user's custom prompt and / or
   * reference photo, then write the result into BOTH per-message state (so
   * the card updates in place) and the persisted snapshot (so it survives a
   * refresh). Also bust `lastCharSigRef` so the next auto-batch run won't
   * overwrite the user's custom image silently.
   */
  const handleRegenerateCustom = async (args: {
    msgId: string;
    name: string;
    description: string;
    customPrompt?: string;
    referenceImage?: { b64Json: string; mimeType: string };
  }): Promise<boolean> => {
    const effectiveStyle = styleName ?? "Live Action Cinematic";
    try {
      const result = await regenCharImageMut.mutateAsync({
        data: {
          name: args.name,
          description: args.description,
          customPrompt: args.customPrompt,
          referenceImage: args.referenceImage,
          style: effectiveStyle,
        },
      });
      if (!mountedRef.current) return false;
      const entry: CharImageEntry = {
        objectPath: result.objectPath,
        mimeType: result.mimeType,
      };

      // Merge into per-message state so the card on the active turn updates.
      setImagesByMsgId((prev) => {
        const existingForMsg = prev[args.msgId] ?? {};
        return pruneOldImageTurns(
          {
            ...prev,
            [args.msgId]: { ...existingForMsg, [args.name]: entry },
          },
          args.msgId,
        );
      });
      setImageStatusByMsgId((prev) => ({
        ...prev,
        [args.msgId]:
          prev[args.msgId] === "loading" ? prev[args.msgId] : "done",
      }));

      // Mark this character as "customised" so any subsequent auto-batch run
      // on the same cast preserves this image instead of silently
      // overwriting it (see merge step in `triggerCharacterImageGen`).
      customCharsRef.current.add(args.name);

      // Persist the merged map. ALWAYS recompute the signature from the
      // project's current cast + style — using the previously-persisted sig
      // would let a stale cast permanently shadow the real one and break the
      // restore-on-refresh path.
      setProject((prev) => {
        if (!prev) return prev;
        const currentSig = prev.story
          ? buildCharSignature(
              prev.story.characters.map((c) => ({
                name: c.name,
                description: c.description,
              })),
              effectiveStyle,
            )
          : `custom::${args.name}::${Date.now()}`;
        // Prune persisted items down to the current cast (drop entries for
        // removed/renamed characters), then layer the new custom entry on top
        // so it always appears even if the auto-batch hadn't produced one
        // for this character yet.
        const prevItems = prev.characterImages?.items ?? {};
        const currentNames = prev.story
          ? new Set(prev.story.characters.map((c) => c.name))
          : new Set<string>([args.name]);
        const prunedItems: Record<string, CharImageEntry> = {};
        for (const [name, val] of Object.entries(prevItems)) {
          if (currentNames.has(name)) prunedItems[name] = val;
        }
        prunedItems[args.name] = entry;
        const updated: Project = {
          ...prev,
          characterImages: {
            sig: currentSig,
            items: prunedItems,
            updatedAt: new Date().toISOString(),
          },
        };
        try {
          storage.saveProject(updated);
        } catch (err) {
          console.warn("Failed to persist custom character image:", err);
        }
        return updated;
      });

      // Patch the in-memory dedup cache when its signature still matches the
      // current cast — that way a future trigger that hits the cached branch
      // returns the customised image too. Do NOT null the cache: nulling
      // would force an expensive un-needed Gemini batch on the next call.
      // If sigs differ the cache belongs to a different cast/style and the
      // next trigger will rebuild it (and the merge-step in
      // triggerCharacterImageGen will preserve this custom via
      // customCharsRef + persisted overrides), so we leave it alone.
      const cachedSig = lastCharSigRef.current?.sig;
      const currentCacheSig = project?.story
        ? buildCharSignature(
            project.story.characters.map((c) => ({
              name: c.name,
              description: c.description,
            })),
            effectiveStyle,
          )
        : null;
      if (
        lastCharSigRef.current &&
        cachedSig &&
        currentCacheSig &&
        cachedSig === currentCacheSig
      ) {
        lastCharSigRef.current = {
          ...lastCharSigRef.current,
          images: {
            ...lastCharSigRef.current.images,
            [args.name]: entry,
          },
        };
      }
      toast.success(`Custom image generated for ${args.name}`);
      return true;
    } catch (err) {
      const friendly =
        err instanceof Error && err.message ? err.message : "Generation failed.";
      toast.error(friendly);
      return false;
    }
  };

  const handleResetChat = () => {
    setMessages([]);
    setFinalized(false);
    setShowPrompts(false);
    storyCall.setData(null);
    continueCall.setData(null);
    // Drop all character image state so a new brief starts fresh.
    setImagesByMsgId({});
    setImageStatusByMsgId({});
    setImageNoteByMsgId({});
    lastCharSigRef.current = null;
    customCharsRef.current = new Set();
    // Bump the seq so any in-flight request can't write back into fresh state.
    charGenSeqRef.current += 1;
    // Cancel any auto-frame batch so the cleared chat doesn't keep
    // generating frames (and toasting) for the old cast.
    autoFrameAbortRef.current?.abort();
    if (autoFrameToastRef.current !== null) {
      toast.dismiss(autoFrameToastRef.current);
      autoFrameToastRef.current = null;
    }
    // Also clear the persisted snapshot — otherwise next refresh would seed
    // images for the OLD cast and confuse the user. persistCharacterImages
    // bails out cleanly when project is null (e.g. on a fresh install).
    persistCharacterImages(null, null);
  };

  return (
    <div className="px-4 py-8 md:px-12 md:py-14 max-w-6xl mx-auto">
      <div className="mb-8">
        <div className="text-xs font-mono uppercase tracking-widest text-muted-foreground">
          {finalized
            ? "Step 3 of 3 — generate prompts"
            : latestStory
              ? "Step 2 of 3 — refine in chat"
              : "Step 1 of 3 — brief"}
        </div>
        <h1 className="font-display text-4xl md:text-5xl tracking-tight mt-1">
          Story Builder
        </h1>
        <p className="text-sm text-muted-foreground mt-2 max-w-2xl">
          Set your brief, style and voiceover, then iterate with the AI as a
          chat. When the story feels right, finalize and turn it into video
          prompts.
        </p>
      </div>

      {/* Brief / setup section — collapses into a summary once a story exists */}
      {!latestStory ? (
        <section className="border border-border rounded-md p-6 bg-card">
          <h2 className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
            Brief
          </h2>
          <textarea
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            placeholder="Describe your video concept… e.g. A street artist in Mumbai discovers their graffiti comes alive at midnight."
            rows={4}
            className="mt-3 w-full bg-background border border-border rounded-md p-3 text-sm focus:outline-none focus:border-primary placeholder:text-muted-foreground/60"
            data-testid="input-brief"
          />

          <div className="mt-5">
            <h3 className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
              Genre
            </h3>
            <div className="mt-2 flex flex-wrap gap-2">
              {GENRES.map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => setGenre(g)}
                  className={`px-3 py-1.5 rounded-md text-xs font-mono uppercase tracking-widest border transition-colors ${
                    genre === g
                      ? "bg-primary text-black border-primary"
                      : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/30"
                  }`}
                  data-testid={`pill-genre-${g}`}
                >
                  {g}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-6">
            <h3 className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
              Total Duration
            </h3>
            <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
              {DURATIONS.map((d) => {
                const active = durationKey === d.key;
                return (
                  <button
                    key={d.key}
                    type="button"
                    onClick={() => setDurationKey(d.key)}
                    className={`text-left p-3 rounded-md border transition-colors ${
                      active
                        ? "border-primary bg-primary/10 text-foreground"
                        : "border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground"
                    }`}
                    data-testid={`duration-card-${d.key}`}
                  >
                    <div className="font-display text-2xl tracking-tight">
                      {d.label}
                    </div>
                    <div
                      className={`text-[10px] font-mono uppercase tracking-widest mt-1 ${
                        active ? "text-primary" : "text-muted-foreground"
                      }`}
                    >
                      {d.seconds === null
                        ? "min + sec"
                        : `${Math.max(1, Math.ceil(d.seconds / 15))} parts`}
                    </div>
                  </button>
                );
              })}
            </div>
            {durationKey === "custom" && (
              <div className="mt-3 flex items-center gap-3">
                <label className="flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-muted-foreground">
                  Min
                  <input
                    type="number"
                    min={0}
                    max={60}
                    value={customMin}
                    onChange={(e) =>
                      setCustomMin(Math.max(0, Number(e.target.value || 0)))
                    }
                    className="w-16 bg-background border border-border rounded-md p-2 text-sm focus:outline-none focus:border-primary"
                    data-testid="input-custom-min"
                  />
                </label>
                <label className="flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-muted-foreground">
                  Sec
                  <input
                    type="number"
                    min={0}
                    max={59}
                    value={customSec}
                    onChange={(e) =>
                      setCustomSec(
                        Math.max(0, Math.min(59, Number(e.target.value || 0))),
                      )
                    }
                    className="w-16 bg-background border border-border rounded-md p-2 text-sm focus:outline-none focus:border-primary"
                    data-testid="input-custom-sec"
                  />
                </label>
                <span className="text-xs font-mono text-muted-foreground">
                  = {totalDurationSeconds}s · {partsCount} parts
                </span>
              </div>
            )}
          </div>

          <div className="mt-6">
            <h3 className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
              Visual Style
            </h3>
            <div className="mt-3 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
              {STYLES.map((s) => {
                const active = styleName === s.name;
                return (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => setStyleName(s.name)}
                    className={`text-left p-3 rounded-md border-t-4 border-l border-r border-b transition-colors ${
                      active
                        ? "border-l-primary border-r-primary border-b-primary bg-primary/10"
                        : "border-l-border border-r-border border-b-border hover:border-l-foreground/30 hover:border-r-foreground/30 hover:border-b-foreground/30"
                    }`}
                    style={{ borderTopColor: s.accent }}
                    data-testid={`style-card-${s.key}`}
                  >
                    <div className="font-display text-base tracking-tight">
                      {s.name}
                    </div>
                    <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mt-1">
                      {s.description}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mt-6">
            <h3 className="font-mono text-xs uppercase tracking-widest text-muted-foreground flex items-center gap-2">
              <Volume2 className="w-3 h-3" /> Voiceover Language
            </h3>
            <div className="mt-2 flex flex-wrap gap-2">
              {VO_OPTIONS.map((o) => (
                <button
                  key={o.key}
                  type="button"
                  onClick={() => setVoLanguage(o.key)}
                  className={`px-3 py-1.5 rounded-md text-xs font-mono uppercase tracking-widest border transition-colors ${
                    voLanguage === o.key
                      ? "bg-primary text-black border-primary"
                      : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/30"
                  } ${o.key === "hindi" ? "font-devanagari" : ""}`}
                  data-testid={`vo-option-${o.key}`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-6">
            <h3 className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
              Aspect Ratio
            </h3>
            <p className="mt-1 text-[10px] font-mono text-muted-foreground">
              Both your video prompts and the auto-generated frame stills
              will use this ratio.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {ASPECT_RATIOS.map((r) => (
                <button
                  key={r.value}
                  type="button"
                  onClick={() => setAspectRatio(r.value)}
                  className={`px-3 py-1.5 rounded-md text-xs font-mono uppercase tracking-widest border transition-colors ${
                    aspectRatio === r.value
                      ? "bg-primary text-black border-primary"
                      : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/30"
                  }`}
                  title={r.hint}
                  data-testid={`aspect-ratio-${r.value.replace(":", "x")}`}
                >
                  {r.label}
                  <span className="ml-1 normal-case opacity-60">
                    {r.hint}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div
            className="mt-6 px-3 py-2 rounded-md border border-border bg-background text-xs font-mono text-muted-foreground"
            data-testid="generate-summary"
          >
            {totalDurationSeconds}s ·{" "}
            <span className="text-foreground">{styleName ?? "no style"}</span>{" "}
            ·{" "}
            <span className="text-foreground">
              {voLanguage === "none" ? "no voiceover" : voLanguage}
            </span>{" "}
            · <span className="text-foreground">{aspectRatio}</span>
            {" "}· {partsCount} part{partsCount === 1 ? "" : "s"}
          </div>

          <button
            type="button"
            onClick={handleGenerateInitial}
            disabled={storyCall.loading || !canGenerate}
            className="mt-6 w-full inline-flex items-center justify-center gap-2 px-5 py-3 rounded-md bg-primary text-black font-mono text-xs uppercase tracking-widest hover:bg-[#D4EB3A] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            data-testid="button-generate-story"
          >
            {storyCall.loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />{" "}
                {initialProgressLabel}
              </>
            ) : !brief.trim() ? (
              <>Add a brief</>
            ) : !styleName ? (
              <>Pick a style</>
            ) : (
              <>
                <Play className="w-4 h-4" /> Start the story
              </>
            )}
          </button>

          {storyCall.error && (
            <div className="mt-4">
              <ErrorCard
                message={storyCall.error}
                onRetry={handleGenerateInitial}
              />
            </div>
          )}
        </section>
      ) : (
        // Compact summary chip strip when chat is active
        <section
          className="flex flex-wrap items-center gap-3 px-4 py-3 rounded-md border border-border bg-card"
          data-testid="setup-summary"
        >
          <div className="text-[10px] font-mono uppercase tracking-widest text-primary">
            {finalized ? "Locked" : "Brief"}
          </div>
          <span className="text-muted-foreground/40">·</span>
          <div className="font-mono text-xs uppercase tracking-widest text-foreground">
            {styleName ?? "no style"}
          </div>
          <span className="text-muted-foreground/40">·</span>
          <div className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
            {totalDurationSeconds}s · {partsCount} parts
          </div>
          {voLanguage !== "none" && (
            <>
              <span className="text-muted-foreground/40">·</span>
              <div
                className="font-mono text-xs uppercase tracking-widest text-emerald-300"
                data-testid="post-story-vo"
              >
                VO: {voLanguage}
              </div>
            </>
          )}
          <div className="flex-1" />
          <button
            type="button"
            onClick={handleResetChat}
            className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground hover:text-primary"
            data-testid="button-new-brief"
          >
            <RefreshCw className="w-3 h-3 inline mr-1" /> New brief
          </button>
        </section>
      )}

      {/* Chat thread */}
      {messages.length > 0 && (
        <section className="mt-6 border border-border rounded-md bg-card overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center gap-2">
            <MessageCircle className="w-4 h-4 text-primary" />
            <div className="text-[10px] font-mono uppercase tracking-widest text-primary">
              Story Chat
            </div>
            {finalized && (
              <span className="ml-auto inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-widest text-primary">
                <Lock className="w-3 h-3" /> Finalized
              </span>
            )}
          </div>
          <div
            className="px-4 py-4 space-y-4 max-h-[640px] overflow-y-auto"
            data-testid="chat-messages"
          >
            {messages.map((m) =>
              m.role === "user" ? (
                <UserBubble key={m.id} text={m.text} />
              ) : (
                <AssistantBubble
                  key={m.id}
                  text={m.text}
                  story={m.story}
                  images={imagesByMsgId[m.id]}
                  imageStatus={imageStatusByMsgId[m.id]}
                  imageNote={imageNoteByMsgId[m.id]}
                  onRetryImages={() => {
                    // Compute which characters are still missing from the
                    // per-message cache and ONLY ask Gemini for those. Without
                    // this, the dedup short-circuit in triggerCharacterImageGen
                    // (sig match → return cached) makes retry a no-op for the
                    // partial-failure / partial-cache case.
                    const have = imagesByMsgId[m.id] ?? {};
                    const missing = new Set(
                      m.story.characters
                        .map((c) => c.name)
                        .filter((name) => !hasImage(have[name])),
                    );
                    if (missing.size === 0) {
                      // Nothing missing — user wants a full re-run from
                      // scratch. Drop the dedup cache AND pass force=true so
                      // the trigger doesn't short-circuit on the
                      // "every-character-has-a-persisted-image" guard.
                      lastCharSigRef.current = null;
                      void triggerCharacterImageGen(
                        m.id,
                        m.story,
                        styleName,
                        undefined,
                        true,
                      );
                    } else {
                      void triggerCharacterImageGen(
                        m.id,
                        m.story,
                        styleName,
                        missing,
                      );
                    }
                  }}
                  onCustomImage={(charName, charDescription) =>
                    setCustomTarget({
                      msgId: m.id,
                      name: charName,
                      description: charDescription,
                    })
                  }
                />
              ),
            )}
            {(storyCall.loading || continueCall.loading) && (
              <div
                className="flex items-center gap-2 text-xs font-mono text-muted-foreground"
                data-testid="chat-typing"
                aria-live="polite"
              >
                <Loader2 className="w-3 h-3 animate-spin text-primary" />
                <span className="opacity-80" data-testid="chat-typing-label">
                  {storyCall.loading
                    ? initialProgressLabel
                    : reviseProgressLabel}
                </span>
              </div>
            )}
            {continueCall.error && (
              <ErrorCard
                message={continueCall.error}
                onRetry={() => {
                  // Try last user instruction again
                  const lastUser = [...messages]
                    .reverse()
                    .find((x) => x.role === "user");
                  if (lastUser && latestStory) {
                    continueCall.run({
                      existingStory: latestStory,
                      direction: lastUser.text,
                    });
                  }
                }}
              />
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Chat composer */}
          <div className="border-t border-border p-3 flex items-end gap-2">
            <textarea
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              disabled={finalized || continueCall.loading}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSendChat();
                }
              }}
              placeholder={
                finalized
                  ? "Story is locked. Unlock to keep editing."
                  : 'Tweak the story… e.g. "make act 2 more tense" or "add a twist ending"'
              }
              rows={2}
              className="flex-1 bg-background border border-border rounded-md p-3 text-sm resize-none focus:outline-none focus:border-primary disabled:opacity-50 placeholder:text-muted-foreground/60"
              data-testid="chat-input"
            />
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={handleSendChat}
                disabled={
                  finalized ||
                  continueCall.loading ||
                  chatInput.trim().length === 0
                }
                className="inline-flex items-center gap-1 px-3 py-2 rounded-md bg-primary text-black font-mono text-xs uppercase tracking-widest hover:bg-[#D4EB3A] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                data-testid="button-send-chat"
              >
                <Send className="w-3.5 h-3.5" />
                Send
              </button>
              {!finalized && latestStory && (
                <button
                  type="button"
                  onClick={() => {
                    if (anyCharImagesLoading) {
                      const ok = window.confirm(
                        "Character reference images are still generating. Finalize without them? You can grab them once they're ready.",
                      );
                      if (!ok) return;
                    }
                    handleFinalize();
                  }}
                  className="inline-flex items-center gap-1 px-3 py-2 rounded-md border border-primary text-primary font-mono text-xs uppercase tracking-widest hover:bg-primary hover:text-black transition-colors"
                  data-testid="button-finalize-story"
                  title={
                    anyCharImagesLoading
                      ? "Character reference images still generating — you'll be asked to confirm."
                      : undefined
                  }
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Finalize
                </button>
              )}
              {finalized && (
                <button
                  type="button"
                  onClick={handleUnlock}
                  className="inline-flex items-center gap-1 px-3 py-2 rounded-md border border-border font-mono text-xs uppercase tracking-widest text-muted-foreground hover:border-primary hover:text-primary transition-colors"
                  data-testid="button-unlock-story"
                >
                  <Unlock className="w-3.5 h-3.5" />
                  Unlock
                </button>
              )}
            </div>
          </div>

          {finalized && !showPrompts && (
            <div className="border-t border-border px-4 py-3">
              <button
                type="button"
                onClick={() => setShowPrompts(true)}
                className="inline-flex items-center gap-2 px-5 py-3 rounded-md bg-primary text-black font-mono text-xs uppercase tracking-widest hover:bg-[#D4EB3A] transition-colors"
                data-testid="button-to-prompts"
              >
                Generate video prompts <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </section>
      )}

      {/* Inline Prompts panel — shown after finalize. Generation does NOT
          auto-start; the user picks output mode / frames / refs / VO / BGM
          and then clicks the "Generate part 1" button inside the panel. */}
      {showPrompts && project?.story && styleName && (
        <InlinePrompts
          project={project}
          style={styleName}
          partsCount={partsCount}
          initialVoiceoverLanguage={voLanguage}
          onProjectUpdated={(p) => setProject(p)}
          autoStart={autoStartGen}
        />
      )}

      {/* Custom-image modal — opens when the user clicks "Custom" on a
          character card. Closing or successful generation both clear it. */}
      {customTarget && (
        <CustomImageModal
          target={customTarget}
          submitting={regenCharImageMut.isPending}
          onClose={() => setCustomTarget(null)}
          onSubmit={async ({ customPrompt, referenceImage }) => {
            const ok = await handleRegenerateCustom({
              msgId: customTarget.msgId,
              name: customTarget.name,
              description: customTarget.description,
              customPrompt,
              referenceImage,
            });
            if (ok) setCustomTarget(null);
          }}
        />
      )}
    </div>
  );
}

function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-3" data-testid="chat-bubble-user">
      <div className="w-7 h-7 shrink-0 rounded-full bg-secondary border border-border flex items-center justify-center">
        <User className="w-3.5 h-3.5 text-muted-foreground" />
      </div>
      <div className="flex-1 max-w-[80%] rounded-md rounded-tl-sm bg-background border border-border px-3 py-2 text-sm whitespace-pre-wrap">
        {text}
      </div>
    </div>
  );
}

function AssistantBubble({
  text,
  story,
  images,
  imageStatus,
  imageNote,
  onRetryImages,
  onCustomImage,
}: {
  text: string;
  story: StoryResponse;
  images?: Record<string, CharImageEntry>;
  imageStatus?: "loading" | "done" | "partial" | "error";
  imageNote?: string;
  onRetryImages: () => void;
  /** Called when the user clicks "Custom" on a character card. */
  onCustomImage: (charName: string, charDescription: string) => void;
}) {
  return (
    <div className="flex items-start gap-3" data-testid="chat-bubble-assistant">
      <div className="w-7 h-7 shrink-0 rounded-full bg-primary/15 border border-primary/40 flex items-center justify-center">
        <MessageCircle className="w-3.5 h-3.5 text-primary" />
      </div>
      <div className="flex-1 space-y-3">
        <div className="rounded-md rounded-tl-sm bg-background border border-border px-3 py-2 text-sm">
          {text}
        </div>
        <StoryCard
          story={story}
          images={images}
          imageStatus={imageStatus}
          imageNote={imageNote}
          onRetryImages={onRetryImages}
          onCustomImage={onCustomImage}
        />
      </div>
    </div>
  );
}

function sanitizeFilename(name: string): string {
  return (
    name
      .replace(/[^a-zA-Z0-9_-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 60) || "character"
  );
}

function downloadBase64(b64: string, mimeType: string, filename: string) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Defer revoke so the download has a chance to start in all browsers.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Download a character/frame image regardless of storage form. Server-stored
 * images use the Object Storage URL (browser content-disposition); legacy
 * inline base64 falls through to the `downloadBase64` decoder. Used by the
 * per-character download buttons in `StoryCard`.
 */
function downloadCharImage(img: CharImageEntry, filename: string) {
  if (img.objectPath) {
    const a = document.createElement("a");
    a.href = imageRefSrc(img);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    return;
  }
  if (img.b64Json) {
    downloadBase64(img.b64Json, img.mimeType, filename);
  }
}

function extFromMime(mime: string): string {
  if (mime === "image/png") return "png";
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/webp") return "webp";
  return "png";
}

function StoryCard({
  story,
  images,
  imageStatus,
  imageNote,
  onRetryImages,
  onCustomImage,
}: {
  story: StoryResponse;
  images?: Record<string, CharImageEntry>;
  imageStatus?: "loading" | "done" | "partial" | "error";
  imageNote?: string;
  onRetryImages?: () => void;
  onCustomImage?: (charName: string, charDescription: string) => void;
}) {
  const [viewActNumber, setViewActNumber] = useState<number | null>(null);
  const viewedAct = useMemo(
    () =>
      viewActNumber !== null
        ? story.acts.find((a) => a.actNumber === viewActNumber) ?? null
        : null,
    [viewActNumber, story.acts],
  );

  // Close on Escape
  useEffect(() => {
    if (viewActNumber === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setViewActNumber(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [viewActNumber]);

  return (
    <div
      className="rounded-md border border-border bg-background overflow-hidden"
      data-testid="story-card"
    >
      <div className="px-4 py-3 border-b border-border flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3
            className="font-display text-2xl md:text-3xl tracking-tight"
            data-testid="story-title"
          >
            {story.title}
          </h3>
          <p
            className="mt-1 text-xs text-muted-foreground line-clamp-3"
            data-testid="story-synopsis"
          >
            {story.synopsis}
          </p>
        </div>
        <CopyButton
          text={`${story.title}\n\n${story.synopsis}\n\n${story.acts
            .map(
              (a) =>
                `Act ${a.actNumber}: ${a.title}\n${a.description}\nKey moment: ${a.keyMoment}`,
            )
            .join("\n\n")}`}
          label="Copy"
          testId="button-copy-story"
        />
      </div>

      <div className="px-4 py-4">
        <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-2">
          Acts
        </div>
        <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1">
          {story.acts.map((act) => (
            <div
              key={act.actNumber}
              className="min-w-[220px] max-w-[280px] border border-border rounded-md p-3 bg-card flex-shrink-0 flex flex-col"
              data-testid={`act-${act.actNumber}`}
            >
              <div className="text-[10px] font-mono uppercase tracking-widest text-primary">
                Act {act.actNumber}
              </div>
              <h4 className="mt-1 font-display text-base tracking-tight">
                {act.title}
              </h4>
              <p className="mt-1 text-[11px] text-muted-foreground line-clamp-3">
                {act.description}
              </p>
              <div className="mt-2 border-t border-border pt-2">
                <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                  Key moment
                </div>
                <p className="text-[11px] text-foreground mt-1 line-clamp-2">
                  {act.keyMoment}
                </p>
              </div>
              <div className="mt-3 pt-2 border-t border-border flex justify-end">
                <button
                  type="button"
                  onClick={() => setViewActNumber(act.actNumber)}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-border font-mono text-[10px] uppercase tracking-widest text-muted-foreground hover:border-primary hover:text-primary transition-colors"
                  data-testid={`button-view-act-${act.actNumber}`}
                  aria-label={`View full details of Act ${act.actNumber}`}
                >
                  <Eye className="w-3 h-3" />
                  View
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-2">
          <div
            className="border border-border rounded-md p-3 bg-card md:col-span-1"
            data-testid="character-card"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                Characters
              </div>
              {imageStatus === "done" && images && Object.keys(images).length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    for (const c of story.characters) {
                      const img = images[c.name];
                      if (!img || !hasImage(img)) continue;
                      downloadCharImage(
                        img,
                        `${sanitizeFilename(c.name)}_refsheet.${extFromMime(img.mimeType)}`,
                      );
                    }
                  }}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-border font-mono text-[9px] uppercase tracking-widest text-muted-foreground hover:border-primary hover:text-primary transition-colors"
                  data-testid="button-download-all-characters"
                  title="Download all character reference sheets"
                >
                  <Download className="w-3 h-3" />
                  All
                </button>
              )}
            </div>

            {imageStatus === "loading" && (
              <div
                className="mt-2 flex items-center gap-2 text-[10px] font-mono text-muted-foreground"
                data-testid="character-images-loading"
              >
                <Loader2 className="w-3 h-3 animate-spin text-primary" />
                <span>
                  Generating reference sheets… (~{story.characters.length * 4}s)
                </span>
              </div>
            )}
            {(imageStatus === "error" || imageStatus === "partial") && (
              <div
                className="mt-2 flex items-start gap-2 text-[10px] font-mono"
                data-testid="character-images-error"
              >
                <AlertCircle className="w-3 h-3 mt-0.5 shrink-0 text-destructive" />
                <div className="flex-1 min-w-0">
                  <div className="text-destructive">
                    {imageNote ?? "Some images failed."}
                  </div>
                  {onRetryImages && (
                    <button
                      type="button"
                      onClick={onRetryImages}
                      className="mt-1 inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-border uppercase tracking-widest text-muted-foreground hover:border-primary hover:text-primary transition-colors"
                      data-testid="button-retry-character-images"
                    >
                      <RefreshCw className="w-2.5 h-2.5" />
                      Retry
                    </button>
                  )}
                </div>
              </div>
            )}

            <ul className="mt-2 space-y-3">
              {story.characters.map((c) => {
                const img = images?.[c.name];
                return (
                  <li key={c.name} className="text-[11px]">
                    {img ? (
                      <div className="space-y-1.5">
                        <div className="relative group rounded-md overflow-hidden border border-border bg-secondary">
                          <img
                            src={imageRefSrc(img)}
                            alt={`${c.name} — left, front, right reference`}
                            className="w-full h-auto block"
                            data-testid={`character-image-${sanitizeFilename(c.name)}`}
                          />
                          {/* Action buttons stacked top-right of the image. */}
                          <div className="absolute top-1.5 right-1.5 flex gap-1">
                            {onCustomImage && (
                              <button
                                type="button"
                                onClick={() =>
                                  onCustomImage(c.name, c.description)
                                }
                                className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-black/70 text-white font-mono text-[9px] uppercase tracking-widest hover:bg-primary hover:text-black transition-colors backdrop-blur-sm"
                                data-testid={`button-custom-character-${sanitizeFilename(c.name)}`}
                                title={`Customise ${c.name} (custom prompt or reference photo)`}
                              >
                                <Settings2 className="w-3 h-3" /> Custom
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() =>
                                downloadCharImage(
                                  img,
                                  `${sanitizeFilename(c.name)}_refsheet.${extFromMime(img.mimeType)}`,
                                )
                              }
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-black/70 text-white font-mono text-[9px] uppercase tracking-widest hover:bg-primary hover:text-black transition-colors backdrop-blur-sm"
                              data-testid={`button-download-character-${sanitizeFilename(c.name)}`}
                              title={`Download ${c.name} reference sheet`}
                            >
                              <Download className="w-3 h-3" />
                              PNG
                            </button>
                          </div>
                        </div>
                        <div>
                          <span className="font-display text-sm">{c.name}</span>
                          <span className="text-muted-foreground">
                            {" "}
                            · {c.description}
                          </span>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        {imageStatus === "loading" && (
                          <div className="aspect-[3/1] rounded-md border border-border bg-secondary/50 flex items-center justify-center">
                            <ImageIcon className="w-4 h-4 text-muted-foreground/50 animate-pulse" />
                          </div>
                        )}
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <span className="font-display text-sm">
                              {c.name}
                            </span>
                            <span className="text-muted-foreground">
                              {" "}
                              · {c.description}
                            </span>
                          </div>
                          {/* Placeholder Custom button — lets the user kick
                              off a custom generation even when the auto-batch
                              hasn't produced this character yet (e.g. partial
                              failure, or while still loading). */}
                          {onCustomImage && imageStatus !== "loading" && (
                            <button
                              type="button"
                              onClick={() =>
                                onCustomImage(c.name, c.description)
                              }
                              className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-md border border-border font-mono text-[9px] uppercase tracking-widest text-muted-foreground hover:border-primary hover:text-primary transition-colors"
                              data-testid={`button-custom-character-${sanitizeFilename(c.name)}`}
                              title={`Customise ${c.name} (custom prompt or reference photo)`}
                            >
                              <Settings2 className="w-3 h-3" /> Custom
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
          <div className="border border-border rounded-md p-3 bg-card">
            <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
              Mood
            </div>
            <p className="mt-2 text-xs">{story.mood}</p>
            <div className="mt-3 flex flex-wrap gap-1">
              {story.colorPalette.map((hex) => (
                <span
                  key={hex}
                  className="w-4 h-4 rounded-sm border border-border"
                  style={{ background: hex }}
                  title={hex}
                />
              ))}
            </div>
          </div>
          <div className="border border-border rounded-md p-3 bg-card">
            <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
              Music
            </div>
            <p className="mt-2 text-xs">{story.musicSuggestion}</p>
          </div>
        </div>
      </div>

      {viewedAct && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in-0"
          onClick={() => setViewActNumber(null)}
          data-testid="act-view-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="act-view-title"
        >
          <div
            className="relative w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-md border border-border bg-background shadow-2xl animate-in zoom-in-95"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 z-10 flex items-start justify-between gap-3 px-5 py-4 bg-background border-b border-border">
              <div className="min-w-0">
                <div className="text-[10px] font-mono uppercase tracking-widest text-primary">
                  Act {viewedAct.actNumber} of {story.acts.length}
                </div>
                <h3
                  id="act-view-title"
                  className="font-display text-2xl md:text-3xl tracking-tight mt-1"
                  data-testid="text-view-act-title"
                >
                  {viewedAct.title}
                </h3>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <CopyButton
                  text={`Act ${viewedAct.actNumber}: ${viewedAct.title}\n\n${viewedAct.description}\n\nKey moment: ${viewedAct.keyMoment}`}
                  label="Copy"
                  testId="button-copy-view-act"
                />
                <button
                  type="button"
                  onClick={() => setViewActNumber(null)}
                  className="w-8 h-8 inline-flex items-center justify-center rounded-md border border-border text-muted-foreground hover:border-primary hover:text-primary transition-colors"
                  data-testid="button-close-view-act"
                  aria-label="Close"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="px-5 py-5 space-y-5">
              <div>
                <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-2">
                  Description
                </div>
                <p
                  className="text-sm leading-relaxed whitespace-pre-wrap"
                  data-testid="text-view-act-description"
                >
                  {viewedAct.description}
                </p>
              </div>

              <div className="border-t border-border pt-5">
                <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-2">
                  Key moment
                </div>
                <p
                  className="text-sm leading-relaxed whitespace-pre-wrap"
                  data-testid="text-view-act-key-moment"
                >
                  {viewedAct.keyMoment}
                </p>
              </div>

              {story.acts.length > 1 && (
                <div className="border-t border-border pt-5 flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const idx = story.acts.findIndex(
                        (a) => a.actNumber === viewedAct.actNumber,
                      );
                      const prev = story.acts[idx - 1];
                      if (prev) setViewActNumber(prev.actNumber);
                    }}
                    disabled={
                      story.acts.findIndex(
                        (a) => a.actNumber === viewedAct.actNumber,
                      ) === 0
                    }
                    className="inline-flex items-center gap-1 px-3 py-2 rounded-md border border-border font-mono text-xs uppercase tracking-widest text-muted-foreground hover:border-primary hover:text-primary transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:border-border disabled:hover:text-muted-foreground"
                    data-testid="button-view-act-prev"
                  >
                    ← Prev act
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const idx = story.acts.findIndex(
                        (a) => a.actNumber === viewedAct.actNumber,
                      );
                      const next = story.acts[idx + 1];
                      if (next) setViewActNumber(next.actNumber);
                    }}
                    disabled={
                      story.acts.findIndex(
                        (a) => a.actNumber === viewedAct.actNumber,
                      ) ===
                      story.acts.length - 1
                    }
                    className="inline-flex items-center gap-1 px-3 py-2 rounded-md border border-border font-mono text-xs uppercase tracking-widest text-muted-foreground hover:border-primary hover:text-primary transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:border-border disabled:hover:text-muted-foreground"
                    data-testid="button-view-act-next"
                  >
                    Next act →
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Hard cap on the reference photo upload size, in bytes. Anything bigger
 * blows the 10mb express body limit (after base64 inflation + JSON wrapper)
 * and slows down Gemini for no quality gain.
 */
const CUSTOM_REFERENCE_MAX_BYTES = 4 * 1024 * 1024;

/**
 * Read a File into base64 (without the `data:...;base64,` prefix) and the
 * detected mime type. Resolves with `null` on read failure.
 */
function fileToBase64(
  file: File,
): Promise<{ b64Json: string; mimeType: string } | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        resolve(null);
        return;
      }
      const commaIdx = result.indexOf(",");
      if (commaIdx === -1) {
        resolve(null);
        return;
      }
      const b64 = result.slice(commaIdx + 1);
      resolve({
        b64Json: b64,
        // Trust the browser's sniffed type, fall back to image/png so the
        // server's mime validator passes.
        mimeType: file.type || "image/png",
      });
    };
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

/**
 * Modal that lets the user write a custom prompt for one character and / or
 * upload a reference photo. The parent owns the network call — this
 * component only collects + validates input, then hands a clean
 * `{ customPrompt?, referenceImage? }` payload to `onSubmit`.
 */
function CustomImageModal({
  target,
  submitting,
  onClose,
  onSubmit,
}: {
  target: { msgId: string; name: string; description: string };
  submitting: boolean;
  onClose: () => void;
  onSubmit: (data: {
    customPrompt?: string;
    referenceImage?: { b64Json: string; mimeType: string };
  }) => void | Promise<void>;
}) {
  const [customPrompt, setCustomPrompt] = useState("");
  const [referenceImage, setReferenceImage] = useState<
    { b64Json: string; mimeType: string; previewUrl: string; fileName: string }
    | null
  >(null);

  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitting) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, submitting]);

  // Revoke any previous preview URL when a new one replaces it / on unmount.
  useEffect(() => {
    return () => {
      if (referenceImage?.previewUrl) {
        URL.revokeObjectURL(referenceImage.previewUrl);
      }
    };
  }, [referenceImage]);

  const handleFile = async (file: File | null) => {
    if (!file) {
      setReferenceImage(null);
      return;
    }
    if (!file.type.startsWith("image/")) {
      toast.error("Please choose an image file (PNG, JPG, WEBP).");
      return;
    }
    if (file.size > CUSTOM_REFERENCE_MAX_BYTES) {
      toast.error(
        `Reference photo is too large (max ${Math.round(
          CUSTOM_REFERENCE_MAX_BYTES / 1024 / 1024,
        )}MB).`,
      );
      return;
    }
    const data = await fileToBase64(file);
    if (!data) {
      toast.error("Couldn't read that image. Try a different file.");
      return;
    }
    setReferenceImage({
      ...data,
      previewUrl: URL.createObjectURL(file),
      fileName: file.name,
    });
  };

  const trimmedPrompt = customPrompt.trim();
  const canSubmit =
    !submitting && (trimmedPrompt.length > 0 || referenceImage !== null);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in-0"
      onClick={() => {
        if (!submitting) onClose();
      }}
      role="dialog"
      aria-modal="true"
      data-testid="custom-image-modal"
    >
      <div
        className="bg-card border border-border rounded-md w-full max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-border flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10px] font-mono uppercase tracking-widest text-primary">
              Custom Reference Sheet
            </div>
            <h3 className="font-display text-xl tracking-tight mt-0.5 truncate">
              {target.name}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="text-muted-foreground hover:text-foreground disabled:opacity-50"
            aria-label="Close"
            data-testid="button-close-custom-modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <div>
            <label
              className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground"
              htmlFor="custom-prompt-textarea"
            >
              Custom prompt (optional)
            </label>
            <textarea
              id="custom-prompt-textarea"
              value={customPrompt}
              onChange={(e) => setCustomPrompt(e.target.value.slice(0, 1500))}
              placeholder="Tell me how you want this character to look — wardrobe tweaks, age, mood, etc."
              rows={4}
              className="mt-1.5 w-full bg-background border border-border rounded-md p-3 text-sm focus:outline-none focus:border-primary placeholder:text-muted-foreground/60"
              data-testid="input-custom-prompt"
              disabled={submitting}
            />
            <div className="mt-1 text-[10px] font-mono text-muted-foreground text-right">
              {customPrompt.length} / 1500
            </div>
          </div>

          <div>
            <label
              className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground"
              htmlFor="custom-reference-input"
            >
              Reference photo (optional)
            </label>
            {referenceImage ? (
              <div className="mt-1.5 border border-border rounded-md p-2 flex items-center gap-3">
                <img
                  src={referenceImage.previewUrl}
                  alt="Reference preview"
                  className="w-16 h-16 object-cover rounded-md border border-border"
                />
                <div className="flex-1 min-w-0">
                  <div
                    className="text-xs truncate"
                    data-testid="custom-reference-filename"
                  >
                    {referenceImage.fileName}
                  </div>
                  <div className="text-[10px] font-mono text-muted-foreground">
                    {referenceImage.mimeType}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setReferenceImage(null)}
                  disabled={submitting}
                  className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground hover:text-destructive disabled:opacity-50"
                  data-testid="button-remove-reference"
                >
                  Remove
                </button>
              </div>
            ) : (
              <label
                htmlFor="custom-reference-input"
                className="mt-1.5 flex items-center justify-center gap-2 px-3 py-4 border border-dashed border-border rounded-md cursor-pointer hover:border-primary hover:text-primary transition-colors text-xs font-mono uppercase tracking-widest text-muted-foreground"
              >
                <Upload className="w-3.5 h-3.5" />
                Choose image (≤ 4MB)
                <input
                  id="custom-reference-input"
                  type="file"
                  accept="image/*"
                  className="hidden"
                  data-testid="input-custom-reference"
                  disabled={submitting}
                  onChange={(e) => {
                    const file = e.target.files?.[0] ?? null;
                    void handleFile(file);
                    // Reset so picking the same file again still fires.
                    e.target.value = "";
                  }}
                />
              </label>
            )}
          </div>
        </div>

        <div className="px-5 py-3 border-t border-border flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-3 py-2 rounded-md border border-border font-mono text-xs uppercase tracking-widest text-muted-foreground hover:border-foreground/30 hover:text-foreground transition-colors disabled:opacity-50"
            data-testid="button-cancel-custom"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!canSubmit}
            onClick={() =>
              void onSubmit({
                customPrompt: trimmedPrompt.length > 0 ? trimmedPrompt : undefined,
                referenceImage: referenceImage
                  ? {
                      b64Json: referenceImage.b64Json,
                      mimeType: referenceImage.mimeType,
                    }
                  : undefined,
              })
            }
            className="inline-flex items-center gap-2 px-3 py-2 rounded-md bg-primary text-black font-mono text-xs uppercase tracking-widest hover:opacity-90 transition-opacity disabled:opacity-30 disabled:cursor-not-allowed"
            data-testid="button-submit-custom"
          >
            {submitting ? (
              <>
                <Loader2 className="w-3 h-3 animate-spin" />
                Generating…
              </>
            ) : (
              <>
                <Play className="w-3 h-3" /> Generate
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
