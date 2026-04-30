import { useEffect, useMemo, useState, useCallback } from "react";
import { Link, useLocation } from "wouter";
import {
  Trash2,
  Copy as CopyIcon,
  Download,
  FolderOpen,
  Play,
  Search,
  Film,
} from "lucide-react";
import { toast } from "sonner";
import { storage, backup, type Project } from "@/lib/storage";
import { apiBasePrefix, objectPathToUrl } from "@/lib/image-url";
import { apiFetch } from "@/lib/session-token";

/**
 * Slim card shape returned by `GET /api/video-studio/jobs`. Mirrors the
 * server's response in routes/video-studio/index.ts; kept inline here so
 * the Library section is self-contained until we move it into a shared
 * api client. Fields that may be null on a still-running job are typed
 * as `| null`.
 */
interface VideoLibraryCard {
  id: string;
  model: string;
  status: "queued" | "running" | "complete" | "failed" | "cancelled";
  stage: string;
  progressPercent: number;
  durationSeconds: number;
  aspectRatio: string;
  finalVideoObjectPath: string | null;
  thumbnailObjectPath: string | null;
  openingFrameObjectPath: string | null;
  characterThumbs: Array<{ name: string; objectPath: string }>;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
  expiresAt: string | null;
  daysRemaining: number | null;
}

type SortKey = "newest" | "oldest" | "most_shots";
type DateRange = "all" | "today" | "week" | "month";
type DurationRange = "all" | "short" | "medium" | "long";

export default function History() {
  const [, navigate] = useLocation();
  const [projects, setProjects] = useState<Project[]>([]);
  const [filterStyle, setFilterStyle] = useState<string>("__all");
  const [filterDuration, setFilterDuration] = useState<DurationRange>("all");
  const [filterDate, setFilterDate] = useState<DateRange>("all");
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("newest");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  // ---------------- AI Video Library state ----------------
  // Server-side rendered jobs from the AI Video Studio. Loaded once on
  // mount + refreshed on every successful delete. We DON'T poll — the
  // user-cancellable in-flight job state already lives on the
  // /video-studio page; this list is a passive 30-day archive.
  const [videos, setVideos] = useState<VideoLibraryCard[] | null>(null);
  const [videosError, setVideosError] = useState<string | null>(null);
  const [videoConfirmDelete, setVideoConfirmDelete] = useState<string | null>(
    null,
  );
  const [videoDeleting, setVideoDeleting] = useState<string | null>(null);

  const loadVideos = useCallback(async () => {
    try {
      const res = await apiFetch(
        `${apiBasePrefix()}/api/video-studio/jobs`,
        { credentials: "include" },
      );
      if (!res.ok) {
        // 401 → user not signed in for this artifact; just hide the
        // section silently rather than yelling at them.
        if (res.status === 401) {
          setVideos([]);
          return;
        }
        throw new Error(`HTTP ${res.status}`);
      }
      const data = (await res.json()) as { jobs?: VideoLibraryCard[] };
      setVideos(Array.isArray(data.jobs) ? data.jobs : []);
      setVideosError(null);
    } catch (err) {
      setVideosError(
        err instanceof Error ? err.message : "Couldn't load video library",
      );
      setVideos([]);
    }
  }, []);

  useEffect(() => {
    void loadVideos();
  }, [loadVideos]);

  const removeVideo = async (id: string) => {
    setVideoDeleting(id);
    try {
      const res = await apiFetch(
        `${apiBasePrefix()}/api/video-studio/jobs/${id}`,
        { method: "DELETE", credentials: "include" },
      );
      if (!res.ok && res.status !== 204) {
        const j = await res.json().catch(() => ({}) as { error?: string });
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      // Optimistic local removal — server is the source of truth, but
      // re-fetching for a single delete adds latency and a flicker.
      setVideos((prev) => (prev ? prev.filter((v) => v.id !== id) : prev));
      toast.success("Video deleted");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to delete the video",
      );
    } finally {
      setVideoDeleting(null);
      setVideoConfirmDelete(null);
    }
  };

  useEffect(() => {
    refresh();
    // open a project if ?id= is set
    const params = new URLSearchParams(window.location.search);
    const id = params.get("id");
    if (id) {
      storage.setCurrentProjectId(id);
    }
    // Re-read whenever App.tsx broadcasts that the project cache was
    // refreshed (e.g. after sign-in hydrates the server projects).
    window.addEventListener("cs:projects-changed", refresh);
    return () => window.removeEventListener("cs:projects-changed", refresh);
  }, []);

  const refresh = () => setProjects(storage.getProjects());

  const styles = useMemo(() => {
    const set = new Set<string>();
    projects.forEach((p) => p.style && set.add(p.style));
    return Array.from(set);
  }, [projects]);

  const visible = useMemo(() => {
    let list = [...projects];
    if (filterStyle !== "__all") {
      list = list.filter((p) => p.style === filterStyle);
    }
    if (filterDuration !== "all") {
      list = list.filter((p) => {
        if (filterDuration === "short") return p.totalDuration <= 15;
        if (filterDuration === "medium")
          return p.totalDuration > 15 && p.totalDuration <= 30;
        return p.totalDuration > 30;
      });
    }
    if (filterDate !== "all") {
      const now = Date.now();
      const cutoff =
        filterDate === "today"
          ? now - 24 * 60 * 60 * 1000
          : filterDate === "week"
            ? now - 7 * 24 * 60 * 60 * 1000
            : now - 30 * 24 * 60 * 60 * 1000;
      list = list.filter((p) => new Date(p.updatedAt).getTime() >= cutoff);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (p) =>
          p.title.toLowerCase().includes(q) ||
          p.brief.toLowerCase().includes(q),
      );
    }
    list.sort((a, b) => {
      if (sortKey === "newest")
        return b.updatedAt.localeCompare(a.updatedAt);
      if (sortKey === "oldest")
        return a.updatedAt.localeCompare(b.updatedAt);
      return storage.totalShots(b) - storage.totalShots(a);
    });
    return list;
  }, [projects, filterStyle, filterDuration, filterDate, search, sortKey]);

  const open = (p: Project) => {
    storage.setCurrentProjectId(p.id);
    window.dispatchEvent(new Event("cs:projects-changed"));
    navigate("/story");
  };

  const duplicate = (p: Project) => {
    const copy = storage.duplicateProject(p.id);
    if (copy) {
      window.dispatchEvent(new Event("cs:projects-changed"));
      refresh();
      toast.success("Project duplicated");
    }
  };

  const exportOne = (p: Project) => {
    const exported = backup.exportOne(p.id);
    if (exported) {
      toast.success("Project exported as JSON");
    } else {
      toast.error("Couldn't find that project to export.");
    }
  };

  const remove = (id: string) => {
    storage.deleteProject(id);
    window.dispatchEvent(new Event("cs:projects-changed"));
    setConfirmDelete(null);
    refresh();
    toast.success("Project deleted");
  };

  return (
    <div className="px-4 py-8 md:px-12 md:py-14 max-w-6xl mx-auto">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <div className="text-xs font-mono uppercase tracking-widest text-muted-foreground">
            All projects
          </div>
          <h1 className="mt-1 font-display text-4xl md:text-5xl tracking-tight">
            History
          </h1>
        </div>
        <Link
          href="/story"
          onClick={() => storage.setCurrentProjectId(null)}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-primary text-black font-mono text-xs uppercase tracking-widest hover:bg-[#D4EB3A] transition-colors"
          data-testid="button-new-from-history"
        >
          <Play className="w-4 h-4" /> New project
        </Link>
      </div>

      {/* ---------------- AI Video Library ----------------
          30-day archive of generated videos. Renders cards for each
          job with thumbnail/opening frame preview, character thumbs,
          status badge, days-remaining countdown, open-in-studio link,
          and a manual delete with confirmation. Hidden entirely if the
          server returns no jobs (signed-out, brand new account, or
          everything was just deleted). */}
      {videos && videos.length > 0 && (
        <section
          className="mt-10 border border-border rounded-md p-4 md:p-6"
          data-testid="library-video-section"
        >
          <div className="flex items-end justify-between flex-wrap gap-2 mb-4">
            <div>
              <div className="text-xs font-mono uppercase tracking-widest text-muted-foreground">
                AI Video Library
              </div>
              <h2 className="mt-1 font-display text-2xl tracking-tight flex items-center gap-2">
                <Film className="w-5 h-5 text-primary" /> Saved videos
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Auto-deleted 30 days after creation. Delete anytime to
                free up space sooner.
              </p>
            </div>
            <Link
              href="/video-studio"
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md border border-border font-mono text-[10px] uppercase tracking-widest hover:border-primary hover:text-primary transition-colors"
              data-testid="button-new-video"
            >
              <Play className="w-3.5 h-3.5" /> New video
            </Link>
          </div>
          {videosError && (
            <div className="mb-3 px-3 py-2 border border-border rounded-md text-xs text-[#FF8888] bg-[#FF4444]/10">
              {videosError}
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {videos.map((v) => {
              const previewUrl = v.thumbnailObjectPath
                ? objectPathToUrl(v.thumbnailObjectPath)
                : v.openingFrameObjectPath
                  ? objectPathToUrl(v.openingFrameObjectPath)
                  : null;
              const videoUrl = v.finalVideoObjectPath
                ? objectPathToUrl(v.finalVideoObjectPath)
                : null;
              const statusBadge =
                v.status === "complete"
                  ? "border-primary text-primary"
                  : v.status === "failed" || v.status === "cancelled"
                    ? "border-[#FF4444] text-[#FF8888]"
                    : "border-border text-muted-foreground";
              return (
                <div
                  key={v.id}
                  className="border border-border rounded-md overflow-hidden bg-card flex flex-col"
                  data-testid={`library-video-${v.id}`}
                >
                  <div className="relative aspect-video bg-black">
                    {videoUrl ? (
                      <video
                        src={videoUrl}
                        poster={previewUrl ?? undefined}
                        controls
                        preload="metadata"
                        className="w-full h-full object-contain bg-black"
                        data-testid={`library-video-player-${v.id}`}
                      />
                    ) : previewUrl ? (
                      <img
                        src={previewUrl}
                        alt=""
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                        <Film className="w-10 h-10 opacity-30" />
                      </div>
                    )}
                    {v.daysRemaining != null && (
                      <span className="absolute top-2 right-2 px-1.5 py-0.5 rounded bg-black/70 text-[10px] font-mono uppercase tracking-widest text-white">
                        {v.daysRemaining}d left
                      </span>
                    )}
                  </div>
                  <div className="p-3 flex-1 flex flex-col gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className={`px-1.5 py-0.5 border rounded text-[10px] font-mono uppercase tracking-widest ${statusBadge}`}
                      >
                        {v.status}
                      </span>
                      <span className="px-1.5 py-0.5 border border-border rounded text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                        {v.model === "cont_ultra" ? "Cont Ultra" : "Cont Pro"}
                      </span>
                      <span className="px-1.5 py-0.5 border border-border rounded text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                        {v.durationSeconds}s · {v.aspectRatio}
                      </span>
                    </div>
                    {v.characterThumbs.length > 0 && (
                      <div className="flex items-center gap-1.5">
                        {v.characterThumbs.slice(0, 3).map((c) => (
                          <img
                            key={c.objectPath}
                            src={objectPathToUrl(c.objectPath)}
                            alt={c.name}
                            title={c.name}
                            className="w-7 h-7 rounded-full object-cover border border-border"
                          />
                        ))}
                        {v.characterThumbs.length > 3 && (
                          <span className="text-[10px] font-mono text-muted-foreground">
                            +{v.characterThumbs.length - 3}
                          </span>
                        )}
                      </div>
                    )}
                    {v.error && (
                      <div className="text-[11px] text-[#FF8888] line-clamp-2">
                        {v.error}
                      </div>
                    )}
                    <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mt-auto">
                      {new Date(v.createdAt).toLocaleString()}
                    </div>
                    <div className="flex gap-1 pt-1">
                      <Link
                        href={`/video-studio?job=${v.id}`}
                        className="flex-1 text-center px-3 py-1.5 rounded-md border border-border font-mono text-[10px] uppercase tracking-widest hover:border-primary hover:text-primary transition-colors"
                        data-testid={`library-open-${v.id}`}
                      >
                        Open
                      </Link>
                      {videoUrl && (
                        <a
                          href={videoUrl}
                          download
                          title="Download MP4"
                          className="p-1.5 rounded-md border border-border hover:border-primary hover:text-primary transition-colors"
                          data-testid={`library-download-${v.id}`}
                        >
                          <Download className="w-3.5 h-3.5" />
                        </a>
                      )}
                      <button
                        type="button"
                        onClick={() => setVideoConfirmDelete(v.id)}
                        disabled={videoDeleting === v.id}
                        title="Delete"
                        className="p-1.5 rounded-md border border-border hover:border-[#FF4444] hover:text-[#FF4444] transition-colors disabled:opacity-50"
                        data-testid={`library-delete-${v.id}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {projects.length === 0 ? (
        <div className="mt-10 border border-border rounded-md p-12 text-center text-muted-foreground">
          <FolderOpen className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="font-mono text-xs uppercase tracking-widest">
            No projects yet
          </p>
          <p className="text-xs mt-2">Start creating to see them here.</p>
          <Link
            href="/story"
            onClick={() => storage.setCurrentProjectId(null)}
            className="mt-6 inline-flex items-center gap-2 px-4 py-2 rounded-md bg-primary text-black font-mono text-xs uppercase tracking-widest hover:bg-[#D4EB3A] transition-colors"
          >
            Start a project
          </Link>
        </div>
      ) : (
        <>
          <div className="mt-8 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
            <div className="relative lg:col-span-2">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search…"
                className="w-full bg-background border border-border rounded-md pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-primary"
                data-testid="input-search"
              />
            </div>
            <select
              value={filterStyle}
              onChange={(e) => setFilterStyle(e.target.value)}
              className="bg-background border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:border-primary"
              data-testid="select-filter-style"
            >
              <option value="__all">All styles</option>
              {styles.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <select
              value={filterDuration}
              onChange={(e) =>
                setFilterDuration(e.target.value as DurationRange)
              }
              className="bg-background border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:border-primary"
              data-testid="select-filter-duration"
            >
              <option value="all">Any duration</option>
              <option value="short">Short (≤15s)</option>
              <option value="medium">Medium (16–30s)</option>
              <option value="long">Long (&gt;30s)</option>
            </select>
            <select
              value={filterDate}
              onChange={(e) => setFilterDate(e.target.value as DateRange)}
              className="bg-background border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:border-primary"
              data-testid="select-filter-date"
            >
              <option value="all">Any date</option>
              <option value="today">Last 24 hours</option>
              <option value="week">Last 7 days</option>
              <option value="month">Last 30 days</option>
            </select>
            <select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
              className="bg-background border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:border-primary lg:col-span-1"
              data-testid="select-sort"
            >
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="most_shots">Most shots</option>
            </select>
          </div>

          <div className="mt-6 divide-y divide-border border border-border rounded-md">
            {visible.map((p) => (
              <div
                key={p.id}
                className="flex items-center gap-4 p-4 hover:bg-secondary/30 transition-colors"
                data-testid={`history-row-${p.id}`}
              >
                <div className="flex-1 min-w-0">
                  <div className="font-display text-2xl tracking-tight truncate">
                    {p.title}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-2 text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                    {p.style && (
                      <span className="px-1.5 py-0.5 border border-border rounded">
                        {p.style}
                      </span>
                    )}
                    <span className="px-1.5 py-0.5 border border-border rounded">
                      {p.totalDuration}s
                    </span>
                    <span className="px-1.5 py-0.5 border border-border rounded">
                      {storage.totalShots(p)} shots
                    </span>
                    <span>· {new Date(p.updatedAt).toLocaleString()}</span>
                  </div>
                </div>
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => open(p)}
                    className="px-3 py-1.5 rounded-md border border-border font-mono text-[10px] uppercase tracking-widest hover:border-primary hover:text-primary transition-colors"
                    data-testid={`button-open-${p.id}`}
                  >
                    Open
                  </button>
                  <button
                    type="button"
                    onClick={() => duplicate(p)}
                    title="Duplicate"
                    className="p-1.5 rounded-md border border-border hover:border-primary hover:text-primary transition-colors"
                    data-testid={`button-duplicate-${p.id}`}
                  >
                    <CopyIcon className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => exportOne(p)}
                    title="Export as JSON"
                    className="p-1.5 rounded-md border border-border hover:border-primary hover:text-primary transition-colors"
                    data-testid={`button-export-${p.id}`}
                  >
                    <Download className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(p.id)}
                    title="Delete"
                    className="p-1.5 rounded-md border border-border hover:border-[#FF4444] hover:text-[#FF4444] transition-colors"
                    data-testid={`button-delete-${p.id}`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
            {visible.length === 0 && (
              <div className="p-6 text-center text-xs text-muted-foreground">
                No projects match the current filters.
              </div>
            )}
          </div>
        </>
      )}

      {videoConfirmDelete && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4"
          data-testid="confirm-delete-video-modal"
        >
          <div className="border border-border bg-card rounded-md p-6 max-w-md w-full">
            <div className="font-display text-2xl tracking-tight">
              Delete this video?
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              This permanently removes the video, all chunks, and the
              character + opening-frame references from your library.
            </p>
            <div className="mt-5 flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setVideoConfirmDelete(null)}
                disabled={videoDeleting !== null}
                className="px-4 py-2 rounded-md border border-border font-mono text-xs uppercase tracking-widest hover:border-foreground disabled:opacity-50"
                data-testid="button-cancel-delete-video"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => removeVideo(videoConfirmDelete)}
                disabled={videoDeleting !== null}
                className="px-4 py-2 rounded-md bg-[#FF4444] text-white font-mono text-xs uppercase tracking-widest hover:bg-[#FF6666] disabled:opacity-50"
                data-testid="button-confirm-delete-video"
              >
                {videoDeleting ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmDelete && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4"
          data-testid="confirm-delete-modal"
        >
          <div className="border border-border bg-card rounded-md p-6 max-w-md w-full">
            <div className="font-display text-2xl tracking-tight">
              Delete this project?
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              This is permanent. The project, story, prompts, music, and
              voiceover will all be removed from this browser.
            </p>
            <div className="mt-5 flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setConfirmDelete(null)}
                className="px-4 py-2 rounded-md border border-border font-mono text-xs uppercase tracking-widest hover:border-foreground"
                data-testid="button-cancel-delete"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => remove(confirmDelete)}
                className="px-4 py-2 rounded-md bg-[#FF4444] text-white font-mono text-xs uppercase tracking-widest hover:bg-[#FF6666]"
                data-testid="button-confirm-delete"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
