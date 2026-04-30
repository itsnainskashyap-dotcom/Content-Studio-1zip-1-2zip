import { useState } from "react";
import { Link } from "wouter";
import { Loader2, X, ChevronUp, ChevronDown, ImageIcon } from "lucide-react";
import { useGeneration } from "@/lib/use-generation";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Floating, route-persistent progress pill.
 *
 * Renders a fixed-position card in the bottom-right that lists every active
 * generation job (story → parts → frame stills). Persists across navigation
 * because GenerationProvider lives at the App root, so the user can leave the
 * /generate page and still see progress and cancel from anywhere.
 *
 * Hides itself when no jobs are active so it doesn't take up screen space.
 */
export function GlobalGenerationPill() {
  const { activeSnapshots, cancel } = useGeneration();
  const [expanded, setExpanded] = useState(true);

  if (activeSnapshots.length === 0) return null;

  // Use the most-recent job for the collapsed summary.
  const primary = activeSnapshots[0];
  const totalActiveCount = activeSnapshots.length;

  return (
    <div
      className="fixed bottom-4 right-4 z-50 w-[320px] max-w-[calc(100vw-2rem)] rounded-xl border border-primary/30 bg-card/95 backdrop-blur-md shadow-2xl shadow-primary/10"
      data-testid="global-generation-pill"
    >
      {/* Collapsed header — always visible */}
      <button
        type="button"
        className="w-full flex items-center justify-between gap-3 px-3 py-2.5 text-left"
        onClick={() => setExpanded((v) => !v)}
        data-testid="btn-toggle-pill"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <Loader2 className="w-4 h-4 text-primary animate-spin shrink-0" />
          <div className="min-w-0">
            <div className="text-[11px] font-mono uppercase tracking-wider text-primary truncate">
              {totalActiveCount > 1
                ? `${totalActiveCount} generations running`
                : `Part ${primary.current}/${primary.total}`}
            </div>
            <div className="text-[10px] font-mono text-muted-foreground truncate">
              {primary.stage}
            </div>
          </div>
        </div>
        {expanded ? (
          <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
        ) : (
          <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" />
        )}
      </button>

      {expanded && (
        <div className="border-t border-border px-3 py-2 space-y-3 max-h-[60vh] overflow-y-auto">
          {activeSnapshots.map((snap) => {
            const partsPct =
              snap.total > 0
                ? Math.round((snap.current / snap.total) * 100)
                : 0;
            const totalFrames = snap.framesPending + snap.framesDone;
            const framesPct =
              totalFrames > 0
                ? Math.round((snap.framesDone / totalFrames) * 100)
                : 100;
            const isCancellable =
              snap.status === "running" || snap.status === "awaiting_next";
            return (
              <div
                key={snap.projectId}
                className="space-y-1.5"
                data-testid={`pill-job-${snap.projectId}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <Link
                    href="/generate"
                    className="text-[11px] font-mono text-foreground hover:text-primary truncate"
                  >
                    {snap.projectTitle}
                  </Link>
                  {isCancellable && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6 text-muted-foreground hover:text-red-400"
                      onClick={() => cancel(snap.projectId)}
                      data-testid={`btn-cancel-${snap.projectId}`}
                      title="Cancel generation"
                    >
                      <X className="w-3.5 h-3.5" />
                    </Button>
                  )}
                </div>

                <div>
                  <div className="flex items-center justify-between text-[9px] font-mono uppercase tracking-widest text-muted-foreground mb-1">
                    <span>Parts</span>
                    <span className="tabular-nums">
                      {snap.current}/{snap.total}
                    </span>
                  </div>
                  <ProgressBar pct={partsPct} />
                </div>

                {totalFrames > 0 && (
                  <div>
                    <div className="flex items-center justify-between text-[9px] font-mono uppercase tracking-widest text-muted-foreground mb-1">
                      <span className="flex items-center gap-1">
                        <ImageIcon className="w-2.5 h-2.5" />
                        Frame stills
                      </span>
                      <span className="tabular-nums">
                        {snap.framesDone}/{totalFrames}
                      </span>
                    </div>
                    <ProgressBar pct={framesPct} muted />
                  </div>
                )}

                <div className="text-[9px] font-mono text-muted-foreground/70 truncate">
                  {snap.stage}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ProgressBar({ pct, muted }: { pct: number; muted?: boolean }) {
  return (
    <div className="h-1 w-full rounded-full bg-secondary/50 overflow-hidden">
      <div
        className={cn(
          "h-full transition-all duration-500",
          muted ? "bg-muted-foreground/60" : "bg-primary",
        )}
        style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
      />
    </div>
  );
}
