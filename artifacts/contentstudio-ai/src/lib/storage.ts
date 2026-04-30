import type {
  StoryResponse,
  VideoPromptsResponse,
  MusicBriefResponse,
  VoiceoverResponse,
} from "@workspace/api-client-react";
import { apiBasePrefix } from "./image-url";
import { apiFetch } from "./session-token";

/**
 * Gemini-generated film still for either the starting or ending frame of a
 * video part. Persisted on the part so a refresh re-uses it instead of
 * silently re-running Gemini. The user can manually re-trigger generation
 * via the part UI.
 *
 * After the Object Storage migration the bytes live on the server and we
 * keep only a small reference here:
 *   - `objectPath`  Server-side path; consume via `imageRefSrc()` to get a URL.
 *   - `b64Json`     Legacy inline base64 (pre-migration). Optional; kept so
 *                   old persisted projects still render until they are
 *                   migrated by `migrate-local-projects.ts`.
 */
export interface ProjectPartFrameImage {
  /** Server-side reference for the image bytes. New writes always set this. */
  objectPath?: string;
  /** Base64-encoded PNG/JPEG bytes (no data URL prefix) — LEGACY ONLY. */
  b64Json?: string;
  mimeType: string;
  generatedAt: string;
  /**
   * The exact frame prompt used to generate this still. Stored alongside
   * so the UI can detect when the underlying writer prompt has drifted (e.g.
   * after an "Edit with prompt" round) and offer a re-generate hint.
   */
  sourcePrompt: string;
}

export interface ProjectPart extends VideoPromptsResponse {
  partNumber: number;
  voiceoverLanguage?: string | null;
  bgmStyle?: string | null;
  bgmTempo?: string | null;
  /** Gemini-rendered still for the starting frame (manual generate). */
  startingFrameImage?: ProjectPartFrameImage | null;
  /** Gemini-rendered still for the ending frame (manual generate). */
  endingFrameImage?: ProjectPartFrameImage | null;
}

// FRAMES + DUAL-MODE additions ------------------------------------------------
export type PromptMode = "normal" | "json";

export interface FrameSettings {
  startingFrameEnabled: boolean;
  endingFrameEnabled: boolean;
  sceneBreakdownEnabled: boolean;
}

export const DEFAULT_FRAME_SETTINGS: FrameSettings = {
  startingFrameEnabled: true,
  endingFrameEnabled: true,
  sceneBreakdownEnabled: true,
};

export const DEFAULT_PROMPT_MODE: PromptMode = "json";

/**
 * Aspect ratio options the user can pick at project setup time.
 *
 * Kept in sync with the AspectRatio enum in lib/api-spec/openapi.yaml AND
 * the GenerateImageAspectRatio union in lib/integrations-gemini-ai. Adding
 * a new value here without updating those will compile but the model will
 * reject the request at runtime — keep all three lists in lockstep.
 */
export type AspectRatio = "16:9" | "9:16" | "1:1" | "4:3" | "3:4" | "21:9";

export const DEFAULT_ASPECT_RATIO: AspectRatio = "16:9";

export const ASPECT_RATIOS: Array<{
  value: AspectRatio;
  label: string;
  hint: string;
}> = [
  { value: "16:9", label: "16:9", hint: "Widescreen / YouTube" },
  { value: "9:16", label: "9:16", hint: "Reels / Shorts / TikTok" },
  { value: "1:1", label: "1:1", hint: "Square / feed posts" },
  { value: "4:3", label: "4:3", hint: "Classic TV" },
  { value: "3:4", label: "3:4", hint: "Vertical portrait" },
  { value: "21:9", label: "21:9", hint: "Ultra-wide cinematic" },
];

// Target video generation model the writer optimizes the per-part prompt for.
// Slugs MUST stay in lockstep with the VideoModel enum in lib/api-spec/openapi.yaml
// AND the VIDEO_MODEL_PROFILES table in artifacts/api-server/src/routes/ai/prompts.ts.
export type VideoModel =
  | "seedance-2.0"
  | "veo-3"
  | "kling-2.1"
  | "sora"
  | "runway-gen-4"
  | "luma-ray-2"
  | "hailuo-02"
  | "pika-2.0";

export const DEFAULT_VIDEO_MODEL: VideoModel = "seedance-2.0";

export interface VideoModelMeta {
  slug: VideoModel;
  name: string;
  version: string;
  maker: string;
  /** Min / max single-clip seconds. Drives the per-part duration pills the
   * Video Prompts page shows — pills outside this band are hidden. */
  durationRangeSeconds: { min: number; max: number };
  /** Recommended output mode for this model. Surfaced as a hint in the UI;
   * the writer still honors the user's explicit `promptMode` choice. */
  preferredMode: "json" | "normal";
  /** True when the model natively reads first + last frame keyframes. */
  supportsImageToImage: boolean;
  /** Short blurb shown in the model picker. */
  blurb: string;
}

export const VIDEO_MODELS: VideoModelMeta[] = [
  {
    slug: "seedance-2.0",
    name: "Seedance",
    version: "2.0",
    maker: "ByteDance",
    durationRangeSeconds: { min: 2, max: 15 },
    preferredMode: "json",
    supportsImageToImage: true,
    blurb: "Audio + video in one pass. Best with the JSON envelope.",
  },
  {
    slug: "veo-3",
    name: "Veo",
    version: "3",
    maker: "Google",
    durationRangeSeconds: { min: 2, max: 8 },
    preferredMode: "normal",
    supportsImageToImage: true,
    blurb: "Best-in-class lip-sync + ambient audio. Loves natural prose.",
  },
  {
    slug: "kling-2.1",
    name: "Kling",
    version: "2.1",
    maker: "Kuaishou",
    durationRangeSeconds: { min: 5, max: 10 },
    preferredMode: "normal",
    supportsImageToImage: true,
    blurb: "Top-tier physics + motion realism. Reward precise verbs.",
  },
  {
    slug: "sora",
    name: "Sora",
    version: "1",
    maker: "OpenAI",
    durationRangeSeconds: { min: 5, max: 20 },
    preferredMode: "normal",
    supportsImageToImage: true,
    blurb: "Long, coherent scenes. Loves screenplay-style prose.",
  },
  {
    slug: "runway-gen-4",
    name: "Runway Gen-4",
    version: "4",
    maker: "Runway",
    durationRangeSeconds: { min: 5, max: 10 },
    preferredMode: "normal",
    supportsImageToImage: true,
    blurb: "Strong motion brush + camera control. Scene-card prompts.",
  },
  {
    slug: "luma-ray-2",
    name: "Luma Ray",
    version: "2",
    maker: "Luma AI",
    durationRangeSeconds: { min: 5, max: 9 },
    preferredMode: "normal",
    supportsImageToImage: true,
    blurb: "Painterly motion. Compact poetic imagery wins.",
  },
  {
    slug: "hailuo-02",
    name: "Hailuo",
    version: "02",
    maker: "MiniMax",
    durationRangeSeconds: { min: 6, max: 10 },
    preferredMode: "normal",
    supportsImageToImage: true,
    blurb: "Director-mode camera commands. 1080p native.",
  },
  {
    slug: "pika-2.0",
    name: "Pika",
    version: "2.0",
    maker: "Pika Labs",
    durationRangeSeconds: { min: 5, max: 10 },
    preferredMode: "normal",
    supportsImageToImage: true,
    blurb: "Multi-asset Scene Ingredients. Tight quick-cut sequences.",
  },
];

export function getVideoModelMeta(slug: VideoModel | undefined | null): VideoModelMeta {
  return (
    VIDEO_MODELS.find((m) => m.slug === slug) ??
    VIDEO_MODELS.find((m) => m.slug === DEFAULT_VIDEO_MODEL)!
  );
}

export type ReferenceImageKind = "character" | "location" | "style";
export type ReferenceImageSource = "auto" | "upload";

/**
 * User-uploaded (or auto-generated) reference image, attached to the project
 * and sent inline to Claude on every part. Reference images are always
 * relatively small (≤ ~400 KB each, max 5 per project) so they can stay
 * inline as base64 — the heavy bytes are the generated frame stills which
 * now live on the server.
 *
 * Both `objectPath` and `b64Json` are optional; new uploads land as `b64Json`
 * (cheap path), generated character sheets land as `objectPath`. Consumers
 * resolve to a URL via `imageRefSrc()`.
 */
export interface ReferenceImage {
  /** Stable id used by the UI for keyed lists & deduplication. */
  id: string;
  name: string;
  kind: ReferenceImageKind;
  source: ReferenceImageSource;
  /** Server-side reference for the image bytes (preferred). */
  objectPath?: string;
  /** Inline base64 (no data URL prefix) — used for fresh user uploads. */
  b64Json?: string;
  mimeType: string;
}

export const MAX_REFERENCE_IMAGES = 5;

export class ProjectStorageQuotaError extends Error {
  constructor(message = "Browser storage is full. Remove a reference image or delete an old project.") {
    super(message);
    this.name = "ProjectStorageQuotaError";
  }
}

function isQuotaError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return (
    err.name === "QuotaExceededError" ||
    err.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
    /quota/i.test(err.message)
  );
}

export interface ProjectVoiceoverPart extends VoiceoverResponse {
  partNumber: number;
}

export interface ProjectVoiceover {
  language: "english" | "hindi" | "hinglish";
  tone: string;
  parts: ProjectVoiceoverPart[];
}

export type VoiceoverLanguage = "none" | "english" | "hindi" | "hinglish";

/**
 * Cached auto-generated character reference sheets, persisted on the project
 * so a page refresh re-uses them instead of triggering a fresh ~30-60s Gemini
 * batch every time. `sig` is the concatenation of cast + style used to build
 * the sheets; the cache is invalidated when sig changes (cast or style edit).
 * `items` is keyed by character name. A single user-customised re-generation
 * (custom prompt / reference photo) overwrites just that name's entry but
 * keeps `sig` aligned with the current cast so the rest of the cast is still
 * reused.
 *
 * Each item carries the same dual `objectPath`/`b64Json` shape as
 * `ProjectPartFrameImage` so legacy projects keep rendering until migration.
 */
export interface CharacterImageItem {
  /** Server-side reference for the image bytes. New writes always set this. */
  objectPath?: string;
  /** Legacy inline base64. Optional. */
  b64Json?: string;
  mimeType: string;
}

export interface ProjectCharacterImages {
  sig: string;
  items: Record<string, CharacterImageItem>;
  updatedAt: string;
}

export interface Project {
  id: string;
  title: string;
  brief: string;
  genre: string;
  story: StoryResponse | null;
  style: string | null;
  duration: number; // per-part seconds (kept for compat with /generate page)
  totalDuration: number; // total seconds requested at story creation (alias of totalDurationSeconds)
  totalDurationSeconds: number; // canonical name per spec
  partsCount: number; // Math.ceil(totalDurationSeconds / 15)
  voiceoverLanguage: VoiceoverLanguage;
  parts: ProjectPart[];
  music: MusicBriefResponse | null;
  voiceover: ProjectVoiceover | null;
  /** FRAMES-spec: per-project frame toggles, default all true. */
  frameSettings: FrameSettings;
  /**
   * FRAMES-spec: up to 5 inline reference images (auto-generated character
   * sheets + user uploads). Persisted as base64 in localStorage.
   */
  referenceImages: ReferenceImage[];
  /**
   * DUAL-MODE-spec: which output mode the writer prefers for this project.
   * Defaults to "json" (recommended ⭐).
   */
  promptMode: PromptMode;
  /**
   * Target video generation model the writer optimizes the per-part prompt
   * for (Seedance / Veo / Kling / Sora / Runway / Luma / Hailuo / Pika).
   * Each model has its own copyablePrompt dialect and per-clip duration
   * range. Optional for backwards compatibility — `migrateProject` backfills
   * `DEFAULT_VIDEO_MODEL` when missing.
   */
  videoModel: VideoModel;
  /**
   * Cached auto-generated (and per-character custom-regenerated) character
   * reference sheets. `null` means none cached yet — the next visit will
   * trigger a fresh batch. Persisted so a page refresh does NOT silently
   * re-call Gemini for every character on every reload.
   */
  characterImages: ProjectCharacterImages | null;
  /**
   * Target aspect ratio for both the rendered video (the writer is told to
   * frame shots for this ratio) and any frame stills generated for it
   * (Gemini renders at the requested ratio so the still preview matches
   * what the user will see in the final video).
   *
   * Optional for backwards compatibility — older projects predate the
   * selector. `migrateProject` backfills `DEFAULT_ASPECT_RATIO` when
   * missing so consumers can treat it as required after read.
   */
  aspectRatio: AspectRatio;
  createdAt: string;
  updatedAt: string;
}

export interface Settings {
  defaultDuration: number; // per-part
  defaultStyle: string;
  defaultLanguage: "english" | "hindi" | "hinglish";
}

const DEFAULT_SETTINGS: Settings = {
  defaultDuration: 5,
  defaultStyle: "Live Action Cinematic",
  defaultLanguage: "english",
};

const STORAGE_KEYS = {
  PROJECTS: "cs_projects",
  PROJECTS_CACHE: "cs_projects_cache_v2", // post-migration cache (server is source of truth)
  SETTINGS: "cs_settings",
  CURRENT_PROJECT_ID: "cs_current_project_id",
};

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `p_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createEmptyProject(input: {
  title: string;
  brief: string;
  genre: string;
  totalDuration: number;
  style?: string | null;
  voiceoverLanguage?: VoiceoverLanguage;
  aspectRatio?: AspectRatio;
}): Project {
  const now = new Date().toISOString();
  const total = input.totalDuration;
  return {
    id: newId(),
    title: input.title || "Untitled project",
    brief: input.brief,
    genre: input.genre,
    story: null,
    style: input.style ?? null,
    duration: 15,
    totalDuration: total,
    totalDurationSeconds: total,
    partsCount: Math.max(1, Math.ceil(total / 15)),
    voiceoverLanguage: input.voiceoverLanguage ?? "none",
    parts: [],
    music: null,
    voiceover: null,
    frameSettings: { ...DEFAULT_FRAME_SETTINGS },
    referenceImages: [],
    promptMode: DEFAULT_PROMPT_MODE,
    videoModel: DEFAULT_VIDEO_MODEL,
    characterImages: null,
    aspectRatio: input.aspectRatio ?? DEFAULT_ASPECT_RATIO,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Migrate legacy projects in localStorage to ensure new required fields exist.
 * Called from getProjects() so reads always return well-shaped projects.
 */
function migrateProject(p: Project): Project {
  const total = p.totalDurationSeconds ?? p.totalDuration ?? 30;
  const fs = p.frameSettings ?? DEFAULT_FRAME_SETTINGS;
  // Strip any keys that no longer belong on Project so legacy localStorage
  // doesn't carry them forward forever (e.g. `aiQuality` from the removed
  // user-facing speed selector). The list is the runtime allow-list of
  // currently-valid Project keys; spreading `p` first then overriding
  // doesn't help because `...p` keeps the extra keys.
  const {
    aiQuality: _legacyAiQuality, // removed in 2026-04 cleanup
    ...rest
  } = p as Project & { aiQuality?: unknown };
  return {
    ...rest,
    totalDurationSeconds: total,
    totalDuration: p.totalDuration ?? total,
    partsCount: p.partsCount ?? Math.max(1, Math.ceil(total / 15)),
    voiceoverLanguage: (p.voiceoverLanguage ?? "none") as VoiceoverLanguage,
    frameSettings: {
      startingFrameEnabled: fs.startingFrameEnabled ?? true,
      endingFrameEnabled: fs.endingFrameEnabled ?? true,
      sceneBreakdownEnabled: fs.sceneBreakdownEnabled ?? true,
    },
    referenceImages: Array.isArray(p.referenceImages) ? p.referenceImages : [],
    promptMode: (p.promptMode ?? DEFAULT_PROMPT_MODE) as PromptMode,
    videoModel: VIDEO_MODELS.some((m) => m.slug === p.videoModel)
      ? (p.videoModel as VideoModel)
      : DEFAULT_VIDEO_MODEL,
    aspectRatio: ASPECT_RATIOS.some((r) => r.value === p.aspectRatio)
      ? (p.aspectRatio as AspectRatio)
      : DEFAULT_ASPECT_RATIO,
    characterImages:
      p.characterImages &&
      typeof p.characterImages === "object" &&
      typeof (p.characterImages as ProjectCharacterImages).sig === "string" &&
      (p.characterImages as ProjectCharacterImages).items &&
      typeof (p.characterImages as ProjectCharacterImages).items === "object"
        ? (p.characterImages as ProjectCharacterImages)
        : null,
  };
}

// ----------------------------------------------------------------------------
// Server-backed cache layer
// ----------------------------------------------------------------------------
//
// The classic local-only flow used `localStorage` as the source of truth.
// After the multi-device sync work the server (Postgres) is now authoritative
// and `localStorage` is only an offline read cache.
//
// We keep the public `storage.*` surface SYNCHRONOUS (large parts of the UI
// — restore-on-load, in-effect dependency arrays, generation state mirroring
// — depend on it) by hydrating into a module-level cache at boot. App.tsx
// must call `hydrateProjects({ authed })` before rendering any project page.
// Until hydration completes, `getProjects()` returns the localStorage cache
// (or empty array), which keeps anonymous users working too.
//
// Writes go to the in-memory cache + localStorage cache + a fire-and-forget
// PUT /api/projects/:id when authenticated. Failed PUTs queue a one-shot
// retry on next save; we deliberately do NOT block the UI on round-trips
// because frame-image saves can come in bursts of 5+ within a few seconds.

let projectsCache: Project[] | null = null;
let serverAuthed = false;
let hydrationPromise: Promise<void> | null = null;
/**
 * Bumped on every `clearProjectsCache` / `invalidateHydration` so that
 * an in-flight `hydrateProjects` started under a previous auth state
 * (e.g. signing out mid-fetch) can detect it became stale and refuse
 * to overwrite the now-current cache. Without this, a slow GET that
 * resolves AFTER signout would dump the old user's projects into the
 * fresh anonymous cache.
 */
let hydrationToken = 0;
const dirtyProjects = new Set<string>();

function readLocalStorageProjects(): Project[] {
  // Prefer the post-migration cache; fall back to the legacy raw bucket so
  // a freshly-loaded device that has never signed in still sees its data.
  for (const key of [STORAGE_KEYS.PROJECTS_CACHE, STORAGE_KEYS.PROJECTS]) {
    try {
      const data = localStorage.getItem(key);
      if (!data) continue;
      const raw = JSON.parse(data) as Project[];
      if (!Array.isArray(raw)) continue;
      return raw.map(migrateProject);
    } catch {
      // try next key
    }
  }
  return [];
}

function writeLocalStorageCache(projects: Project[]): void {
  try {
    localStorage.setItem(STORAGE_KEYS.PROJECTS_CACHE, JSON.stringify(projects));
  } catch (err) {
    if (isQuotaError(err)) {
      // Cache is best-effort — don't crash the UI just because the device
      // is out of room. The next signin can re-hydrate from the server.
      try {
        localStorage.removeItem(STORAGE_KEYS.PROJECTS_CACHE);
      } catch {
        /* swallow */
      }
    } else {
      throw err;
    }
  }
}

async function fetchServerProjects(): Promise<Project[]> {
  const res = await apiFetch(`${apiBasePrefix()}/api/projects`, {
    method: "GET",
  });
  if (!res.ok) {
    throw new Error(`GET /projects failed: ${res.status}`);
  }
  const body = (await res.json()) as { projects: Project[] };
  return (body.projects ?? []).map(migrateProject);
}

async function putServerProject(project: Project): Promise<void> {
  const res = await apiFetch(
    `${apiBasePrefix()}/api/projects/${encodeURIComponent(project.id)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(project),
    },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`PUT /projects/${project.id} ${res.status} — ${text.slice(0, 200)}`);
  }
}

async function deleteServerProject(id: string): Promise<void> {
  const res = await apiFetch(
    `${apiBasePrefix()}/api/projects/${encodeURIComponent(id)}`,
    { method: "DELETE" },
  );
  if (!res.ok && res.status !== 404) {
    throw new Error(`DELETE /projects/${id} ${res.status}`);
  }
}

function scheduleServerWrite(project: Project): void {
  if (!serverAuthed) return;
  dirtyProjects.add(project.id);
  void putServerProject(project)
    .then(() => {
      dirtyProjects.delete(project.id);
    })
    .catch((err) => {
      // Leave it dirty so the next saveProject() picks it up. Surfaced
      // through the network panel rather than user-facing UI to keep
      // generation flows snappy.
      // eslint-disable-next-line no-console
      console.warn(`[storage] background sync failed for ${project.id}`, err);
    });
}

function flushDirty(): void {
  if (!serverAuthed || dirtyProjects.size === 0) return;
  if (!projectsCache) return;
  for (const id of Array.from(dirtyProjects)) {
    const proj = projectsCache.find((p) => p.id === id);
    if (proj) scheduleServerWrite(proj);
  }
}

/**
 * Hydrate the in-memory project cache. Called from App.tsx on every auth
 * state change so signin replaces the anonymous cache with the user's
 * server-side projects, and signout falls back to the local cache.
 *
 * Idempotent per-auth-state; the second concurrent call returns the same
 * in-flight promise.
 */
export async function hydrateProjects(opts: { authed: boolean }): Promise<void> {
  serverAuthed = opts.authed;
  if (!opts.authed) {
    projectsCache = readLocalStorageProjects();
    hydrationPromise = null;
    return;
  }
  if (hydrationPromise) return hydrationPromise;
  // Snapshot the token at request time. If `clearProjectsCache` /
  // `invalidateHydration` runs before fetch resolves (e.g. signout
  // mid-flight), the post-fetch write below is skipped.
  const myToken = hydrationToken;
  hydrationPromise = (async () => {
    try {
      const server = await fetchServerProjects();
      if (myToken !== hydrationToken) return; // auth state moved on
      projectsCache = server;
      writeLocalStorageCache(server);
      // After we're back online with stale local writes pending, push them.
      flushDirty();
    } catch (err) {
      if (myToken !== hydrationToken) return;
      // Network down or server failure — keep working off the local cache
      // so the user can still see their last-known data. Server is now
      // source of truth so we DO NOT auto-push the local cache here;
      // migration runs as a separate one-shot.
      // eslint-disable-next-line no-console
      console.warn("[storage] hydrate failed, falling back to local cache", err);
      projectsCache = readLocalStorageProjects();
    }
  })();
  return hydrationPromise;
}

/** Force a re-hydrate next time (used after migration completes). */
export function invalidateHydration(): void {
  hydrationPromise = null;
  hydrationToken += 1;
}

/** Clear the in-memory + local cache (used on signout). */
export function clearProjectsCache(): void {
  projectsCache = null;
  hydrationPromise = null;
  hydrationToken += 1;
  serverAuthed = false;
  try {
    localStorage.removeItem(STORAGE_KEYS.PROJECTS_CACHE);
  } catch {
    /* ignore */
  }
}

export const storage = {
  getProjects(): Project[] {
    if (projectsCache === null) {
      // Cold read before hydration — serve the localStorage cache. This
      // keeps the UI snappy on first paint while hydrate is still in
      // flight, and is the only path used by anonymous users.
      projectsCache = readLocalStorageProjects();
    }
    return projectsCache;
  },

  saveProject(project: Project): Project {
    const projects = storage.getProjects();
    const idx = projects.findIndex((p) => p.id === project.id);
    const updated = { ...project, updatedAt: new Date().toISOString() };
    if (idx >= 0) {
      projects[idx] = updated;
    } else {
      projects.unshift(updated);
    }
    projectsCache = projects;
    try {
      writeLocalStorageCache(projects);
    } catch (err) {
      if (isQuotaError(err)) {
        throw new ProjectStorageQuotaError();
      }
      throw err;
    }
    scheduleServerWrite(updated);
    return updated;
  },

  getProject(id: string): Project | undefined {
    return storage.getProjects().find((p) => p.id === id);
  },

  duplicateProject(id: string): Project | undefined {
    const original = storage.getProject(id);
    if (!original) return undefined;
    const copy: Project = {
      ...original,
      id: newId(),
      title: `${original.title} (copy)`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    return storage.saveProject(copy);
  },

  deleteProject(id: string): void {
    const projects = storage.getProjects().filter((p) => p.id !== id);
    projectsCache = projects;
    writeLocalStorageCache(projects);
    if (storage.getCurrentProjectId() === id) {
      storage.setCurrentProjectId(null);
    }
    if (serverAuthed) {
      void deleteServerProject(id).catch((err) => {
        // eslint-disable-next-line no-console
        console.warn(`[storage] background delete failed for ${id}`, err);
      });
    }
  },

  getCurrentProjectId(): string | null {
    return localStorage.getItem(STORAGE_KEYS.CURRENT_PROJECT_ID);
  },

  setCurrentProjectId(id: string | null): void {
    if (id) {
      localStorage.setItem(STORAGE_KEYS.CURRENT_PROJECT_ID, id);
    } else {
      localStorage.removeItem(STORAGE_KEYS.CURRENT_PROJECT_ID);
    }
  },

  getCurrentProject(): Project | null {
    const id = storage.getCurrentProjectId();
    if (!id) return null;
    return storage.getProject(id) ?? null;
  },

  getSettings(): Settings {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.SETTINGS);
      return data
        ? { ...DEFAULT_SETTINGS, ...(JSON.parse(data) as Partial<Settings>) }
        : DEFAULT_SETTINGS;
    } catch {
      return DEFAULT_SETTINGS;
    }
  },

  saveSettings(settings: Settings): void {
    localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
  },

  clearAll(): void {
    localStorage.removeItem(STORAGE_KEYS.PROJECTS);
    localStorage.removeItem(STORAGE_KEYS.PROJECTS_CACHE);
    localStorage.removeItem(STORAGE_KEYS.SETTINGS);
    localStorage.removeItem(STORAGE_KEYS.CURRENT_PROJECT_ID);
    projectsCache = null;
  },

  totalShots(project: Project): number {
    return project.parts.reduce((sum, p) => sum + p.shots.length, 0);
  },

  /**
   * Replace the part with the matching partNumber in the given project. If
   * the part doesn't exist yet (edge case after a partial regenerate) it is
   * appended. Returns the saved project.
   */
  replaceProjectPart(projectId: string, replacement: ProjectPart): Project | undefined {
    const proj = storage.getProject(projectId);
    if (!proj) return undefined;
    const idx = proj.parts.findIndex(
      (p) => p.partNumber === replacement.partNumber,
    );
    const nextParts = [...proj.parts];
    if (idx >= 0) {
      nextParts[idx] = replacement;
    } else {
      nextParts.push(replacement);
      nextParts.sort((a, b) => a.partNumber - b.partNumber);
    }
    return storage.saveProject({ ...proj, parts: nextParts });
  },
};

// ----------------------------------------------------------------------------
// Backup / restore
// ----------------------------------------------------------------------------

export const EXPORT_FILE_TYPE = "contentstudio-ai-export";
export const EXPORT_FILE_VERSION = 1;

export interface ProjectExportFile {
  type: typeof EXPORT_FILE_TYPE;
  version: number;
  exportedAt: string;
  projects: Project[];
}

export interface ImportConflict {
  id: string;
  incoming: Project;
  existing: Project;
}

export interface ImportPreview {
  fresh: Project[];
  conflicts: ImportConflict[];
  totalIncoming: number;
}

export type ConflictResolution = "skip" | "replace" | "duplicate";

export class ImportParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportParseError";
  }
}

function isProjectShape(value: unknown): value is Project {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.title === "string" &&
    typeof v.brief === "string" &&
    typeof v.genre === "string" &&
    Array.isArray(v.parts) &&
    typeof v.createdAt === "string" &&
    typeof v.updatedAt === "string"
  );
}

export function buildExportFile(projects: Project[]): ProjectExportFile {
  return {
    type: EXPORT_FILE_TYPE,
    version: EXPORT_FILE_VERSION,
    exportedAt: new Date().toISOString(),
    projects: projects.map((p) => migrateProject(p)),
  };
}

export function parseExportFile(text: string): Project[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ImportParseError("That file isn't valid JSON.");
  }
  if (!data || typeof data !== "object") {
    throw new ImportParseError("Unrecognised file contents.");
  }
  const obj = data as Record<string, unknown>;
  if (obj.type !== EXPORT_FILE_TYPE) {
    throw new ImportParseError(
      "This doesn't look like a ContentStudio export file.",
    );
  }
  if (typeof obj.version !== "number" || obj.version > EXPORT_FILE_VERSION) {
    throw new ImportParseError(
      "This export was made by a newer version of ContentStudio.",
    );
  }
  if (!Array.isArray(obj.projects)) {
    throw new ImportParseError("Export file is missing a projects list.");
  }
  const projects: Project[] = [];
  for (const item of obj.projects) {
    if (!isProjectShape(item)) {
      throw new ImportParseError(
        "One or more projects in this file are malformed.",
      );
    }
    projects.push(migrateProject(item));
  }
  return projects;
}

function downloadJSON(filename: string, payload: unknown): void {
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function safeFilenamePart(input: string): string {
  return (
    input
      .replace(/[^A-Za-z0-9_\-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 60) || "project"
  );
}

export const backup = {
  exportAll(): number {
    const projects = storage.getProjects();
    const file = buildExportFile(projects);
    const date = new Date().toISOString().slice(0, 10);
    downloadJSON(`contentstudio-projects-${date}.json`, file);
    return projects.length;
  },

  exportOne(id: string): Project | undefined {
    const project = storage.getProject(id);
    if (!project) return undefined;
    const file = buildExportFile([project]);
    const date = new Date().toISOString().slice(0, 10);
    downloadJSON(
      `contentstudio-${safeFilenamePart(project.title)}-${date}.json`,
      file,
    );
    return project;
  },

  preview(text: string): ImportPreview {
    const incoming = parseExportFile(text);
    const existing = storage.getProjects();
    const existingById = new Map(existing.map((p) => [p.id, p]));
    const fresh: Project[] = [];
    const conflicts: ImportConflict[] = [];
    for (const proj of incoming) {
      const match = existingById.get(proj.id);
      if (match) {
        conflicts.push({ id: proj.id, incoming: proj, existing: match });
      } else {
        fresh.push(proj);
      }
    }
    return { fresh, conflicts, totalIncoming: incoming.length };
  },

  /**
   * Apply an import after the caller has decided how to resolve conflicts.
   * - `fresh` projects are added as-is.
   * - For each conflict, behaviour depends on `resolution`:
   *     * "skip"      → existing project is kept, incoming dropped
   *     * "replace"   → incoming overwrites existing (preserving id)
   *     * "duplicate" → incoming is added with a new id and "(imported)" suffix
   */
  apply(
    preview: ImportPreview,
    resolution: ConflictResolution,
  ): { added: number; replaced: number; skipped: number; duplicated: number } {
    const projects = storage.getProjects();
    const byId = new Map(projects.map((p) => [p.id, p]));
    const now = new Date().toISOString();
    let added = 0;
    let replaced = 0;
    let skipped = 0;
    let duplicated = 0;

    for (const proj of preview.fresh) {
      byId.set(proj.id, { ...proj, updatedAt: proj.updatedAt || now });
      added += 1;
    }

    for (const c of preview.conflicts) {
      if (resolution === "skip") {
        skipped += 1;
        continue;
      }
      if (resolution === "replace") {
        byId.set(c.id, { ...c.incoming, updatedAt: now });
        replaced += 1;
        continue;
      }
      // duplicate: assign a new id, suffix title
      const copy: Project = {
        ...c.incoming,
        id: newId(),
        title: `${c.incoming.title} (imported)`,
        createdAt: now,
        updatedAt: now,
      };
      byId.set(copy.id, copy);
      duplicated += 1;
    }

    const merged = Array.from(byId.values()).sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt),
    );
    projectsCache = merged;
    writeLocalStorageCache(merged);
    // Push every imported project to the server too so the new content
    // syncs across devices, not just into the local cache.
    if (serverAuthed) {
      for (const p of merged) scheduleServerWrite(p);
    }
    return { added, replaced, skipped, duplicated };
  },
};

export const STYLES: Array<{
  key: string;
  name: string;
  description: string;
  keywords: string;
  accent: string;
}> = [
  {
    key: "live-action",
    name: "Live Action Cinematic",
    description: "Real. Raw. Filmic.",
    keywords: "photoreal · 35mm · grain · anamorphic",
    accent: "#FF6B35",
  },
  {
    key: "anime-2d",
    name: "Anime 2D",
    description: "Bold. Expressive. Dynamic.",
    keywords: "cel-shaded · ink · sakura · dynamic",
    accent: "#FF4D8F",
  },
  {
    key: "pixar-3d",
    name: "3D Pixar Style",
    description: "Warm. Polished. Emotive.",
    keywords: "soft · 3D · expressive · render",
    accent: "#4DA6FF",
  },
  {
    key: "pixel-art",
    name: "Pixel Art",
    description: "Retro. Sharp. Nostalgic.",
    keywords: "pixels · 16-bit · retro · CRT",
    accent: "#9B59B6",
  },
  {
    key: "ghibli",
    name: "Studio Ghibli",
    description: "Painterly. Gentle. Alive.",
    keywords: "painterly · watercolor · gentle · wonder",
    accent: "#27AE60",
  },
  {
    key: "cyberpunk",
    name: "Cyberpunk Neon",
    description: "Electric. Dark. Futuristic.",
    keywords: "neon · rain · holo · noir",
    accent: "#00FFCC",
  },
  {
    key: "dark-fantasy",
    name: "Dark Fantasy",
    description: "Gothic. Heavy. Atmospheric.",
    keywords: "gothic · fog · candlelight · arcane",
    accent: "#8B0000",
  },
  {
    key: "claymation",
    name: "Claymation",
    description: "Tactile. Warm. Handmade.",
    keywords: "clay · stop-motion · tactile · warm",
    accent: "#F39C12",
  },
  {
    key: "wes-anderson",
    name: "Wes Anderson",
    description: "Symmetrical. Pastel. Deadpan.",
    keywords: "symmetry · pastel · deadpan · whimsy",
    accent: "#E91E8C",
  },
  {
    key: "documentary",
    name: "Documentary",
    description: "Natural. Honest. Vérité.",
    keywords: "handheld · vérité · natural · observational",
    accent: "#95A5A6",
  },
  {
    key: "horror",
    name: "Horror Atmospheric",
    description: "Dread. Shadows. Unsettling.",
    keywords: "shadow · desaturated · dread · uncanny",
    accent: "#2C2C2C",
  },
  {
    key: "music-video",
    name: "Music Video Hyper",
    description: "Fast. Punchy. Rhythm-driven.",
    keywords: "hyper · ramp · flash · pulse",
    accent: "#FF0066",
  },
];

export function styleAccent(name: string | null | undefined): string {
  if (!name) return "#94A3B8";
  const m = STYLES.find((s) => s.name === name);
  return m?.accent ?? "#94A3B8";
}

export const TONES: Array<{ key: string; label: string; emoji: string }> = [
  { key: "energetic", label: "Energetic", emoji: "⚡" },
  { key: "cinematic", label: "Cinematic", emoji: "🎬" },
  { key: "conversational", label: "Conversational", emoji: "💬" },
  { key: "motivational", label: "Motivational", emoji: "🔥" },
  { key: "mysterious", label: "Mysterious", emoji: "🌑" },
  { key: "humorous", label: "Humorous", emoji: "😄" },
];

export const GENRES = [
  "Action",
  "Drama",
  "Horror",
  "Romance",
  "Sci-Fi",
  "Fantasy",
  "Documentary",
  "Comedy",
  "Thriller",
  "Mystery",
  "Adventure",
  "Slice of Life",
];
