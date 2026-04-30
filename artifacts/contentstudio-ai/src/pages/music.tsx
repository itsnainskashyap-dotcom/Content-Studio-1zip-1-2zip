import { useEffect, useState } from "react";
import { Loader2, Music, Play } from "lucide-react";
import { toast } from "sonner";
import {
  useGenerateMusicBrief,
  type MusicBriefRequestTempo,
  type MusicBriefRequestLanguage,
} from "@workspace/api-client-react";
import { storage, type Project } from "@/lib/storage";
import { useApiCall, mutationCaller } from "@/lib/api-call";
import { ErrorCard } from "@/components/error-card";
import { CopyButton } from "@/components/copy-button";

const STYLES = [
  "Cinematic Orchestra",
  "Electronic / Synth",
  "Hip-Hop / Trap",
  "Bollywood / Indian Classical",
  "Lo-Fi Chill",
  "Rock / Alternative",
  "Jazz / Soul",
  "Ambient / Minimal",
  "Folk / Acoustic",
  "EDM / Dance",
  "Metal / Intense",
];

const TEMPOS: Array<{ key: MusicBriefRequestTempo; label: string }> = [
  { key: "slow", label: "Slow (60–80)" },
  { key: "medium", label: "Medium (90–110)" },
  { key: "fast", label: "Fast (120–140)" },
  { key: "very_fast", label: "Very Fast (150+)" },
];

export default function MusicGenerator() {
  const [project, setProject] = useState<Project | null>(null);
  const [style, setStyle] = useState<string>("Cinematic Orchestra");
  const [customStyle, setCustomStyle] = useState("");
  const [energy, setEnergy] = useState(6);
  const [tempo, setTempo] = useState<MusicBriefRequestTempo>("medium");
  const [moodOverride, setMoodOverride] = useState("");

  const generateMusicMut = useGenerateMusicBrief();
  const call = useApiCall(mutationCaller(generateMusicMut.mutateAsync));

  useEffect(() => {
    const cur = storage.getCurrentProject();
    if (cur) {
      setProject(cur);
      if (cur.music) call.setData(cur.music);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleGenerate = async () => {
    if (!project || !project.story) {
      toast.error("Save a story first");
      return;
    }
    const usedStyle = style === "__custom" ? customStyle.trim() : style;
    if (!usedStyle) {
      toast.error("Pick or enter a music style");
      return;
    }
    const totalParts = Math.max(1, project.parts.length || 1);
    const result = await call.run({
      story: project.story,
      style: usedStyle,
      mood: moodOverride || project.story.mood,
      duration: project.totalDuration,
      language: (project.genre.toLowerCase().includes("bollywood")
        ? "hindi"
        : "english") as MusicBriefRequestLanguage,
      energyLevel: energy,
      tempo,
      totalParts,
    });
    if (result) {
      const updated = { ...project, music: result };
      const saved = storage.saveProject(updated);
      setProject(saved);
      window.dispatchEvent(new Event("cs:projects-changed"));
      toast.success("Music brief generated and saved");
    }
  };

  if (!project || !project.story) {
    return (
      <div className="px-4 py-8 md:px-12 md:py-14 max-w-3xl mx-auto">
        <h1 className="font-display text-4xl md:text-5xl tracking-tight">
          Music Brief
        </h1>
        <p className="mt-3 text-muted-foreground">
          Save a story first — the music brief is built around it.
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

  const brief = call.data;

  return (
    <div className="px-4 py-8 md:px-12 md:py-14 max-w-7xl mx-auto">
      <div className="text-xs font-mono uppercase tracking-widest text-muted-foreground">
        Project · {project.title}
      </div>
      <h1 className="mt-1 font-display text-4xl md:text-5xl tracking-tight">
        Music Brief
      </h1>

      <div className="mt-8 grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* LEFT — controls */}
        <section className="border border-border rounded-md p-5 bg-card">
          <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
            Story summary
          </div>
          <div className="mt-2 text-sm text-foreground/90 line-clamp-4">
            {project.story.synopsis}
          </div>

          <h3 className="mt-6 font-mono text-xs uppercase tracking-widest text-muted-foreground">
            Music style
          </h3>
          <div className="mt-2 flex flex-wrap gap-2">
            {STYLES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStyle(s)}
                className={`px-3 py-1.5 rounded-md text-xs font-mono uppercase tracking-widest border transition-colors ${
                  style === s
                    ? "bg-primary text-black border-primary"
                    : "border-border text-muted-foreground hover:text-foreground"
                }`}
                data-testid={`pill-style-${s}`}
              >
                {s}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setStyle("__custom")}
              className={`px-3 py-1.5 rounded-md text-xs font-mono uppercase tracking-widest border transition-colors ${
                style === "__custom"
                  ? "bg-primary text-black border-primary"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
              data-testid="pill-style-custom"
            >
              Custom
            </button>
          </div>
          {style === "__custom" && (
            <input
              type="text"
              value={customStyle}
              onChange={(e) => setCustomStyle(e.target.value)}
              placeholder="e.g. Sufi-electronic crossover"
              className="mt-2 w-full bg-background border border-border rounded-md p-2 text-sm focus:outline-none focus:border-primary"
              data-testid="input-custom-style"
            />
          )}

          <h3 className="mt-6 font-mono text-xs uppercase tracking-widest text-muted-foreground flex items-center justify-between">
            <span>Energy</span>
            <span className="text-primary">{energy}/10</span>
          </h3>
          <input
            type="range"
            min={1}
            max={10}
            value={energy}
            onChange={(e) => setEnergy(parseInt(e.target.value, 10))}
            className="mt-2 w-full accent-[#E8FF47]"
            data-testid="input-energy"
          />
          <div className="mt-1 flex justify-between text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
            <span>Calm</span>
            <span>Explosive</span>
          </div>

          <h3 className="mt-6 font-mono text-xs uppercase tracking-widest text-muted-foreground">
            Tempo
          </h3>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {TEMPOS.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTempo(t.key)}
                className={`px-3 py-2 rounded-md text-xs font-mono uppercase tracking-widest border transition-colors ${
                  tempo === t.key
                    ? "bg-primary text-black border-primary"
                    : "border-border text-muted-foreground hover:text-foreground"
                }`}
                data-testid={`pill-tempo-${t.key}`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <h3 className="mt-6 font-mono text-xs uppercase tracking-widest text-muted-foreground">
            Mood override (optional)
          </h3>
          <input
            type="text"
            value={moodOverride}
            onChange={(e) => setMoodOverride(e.target.value)}
            placeholder="e.g. melancholic but hopeful"
            className="mt-2 w-full bg-background border border-border rounded-md p-2 text-sm focus:outline-none focus:border-primary"
            data-testid="input-mood-override"
          />

          <div className="mt-6 text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
            Duration: {project.totalDuration}s · {Math.max(1, project.parts.length || 1)} part
            {project.parts.length === 1 ? "" : "s"}
          </div>

          <button
            type="button"
            onClick={handleGenerate}
            disabled={call.loading}
            className="mt-6 w-full inline-flex items-center justify-center gap-2 px-5 py-3 rounded-md bg-primary text-black font-mono text-xs uppercase tracking-widest hover:bg-[#D4EB3A] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            data-testid="button-generate-music"
          >
            {call.loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" /> Composing brief…
              </>
            ) : (
              <>
                <Play className="w-4 h-4" /> Generate music brief
              </>
            )}
          </button>

          {call.error && (
            <div className="mt-4">
              <ErrorCard message={call.error} onRetry={handleGenerate} />
            </div>
          )}
        </section>

        {/* RIGHT — output */}
        <section className="border border-border rounded-md p-5 bg-card min-h-[400px]">
          {!brief ? (
            <div className="h-full min-h-[400px] flex flex-col items-center justify-center text-center text-muted-foreground">
              <Music className="w-10 h-10 opacity-30 mb-3" />
              <div className="font-mono text-xs uppercase tracking-widest">
                Brief will appear here
              </div>
            </div>
          ) : (
            <div className="space-y-5">
              <div className="flex flex-wrap gap-2 items-center">
                <span className="px-2 py-1 rounded border border-border text-[10px] font-mono uppercase tracking-widest text-foreground">
                  {brief.genre}
                </span>
                <span className="px-2 py-1 rounded border border-border text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                  {brief.subGenre}
                </span>
                <span className="px-2 py-1 rounded bg-primary/20 text-primary text-[10px] font-mono uppercase tracking-widest">
                  {brief.energy}
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="border border-border rounded-md p-3">
                  <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                    Tempo
                  </div>
                  <div className="text-sm mt-1">{brief.tempo}</div>
                </div>
                <div className="border border-border rounded-md p-3">
                  <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                    Mood
                  </div>
                  <div className="text-sm mt-1">{brief.mood}</div>
                </div>
              </div>

              <div>
                <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-2">
                  Instruments
                </div>
                <div className="flex flex-wrap gap-1">
                  {brief.instruments.map((i, n) => (
                    <span
                      key={n}
                      className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-border"
                    >
                      {i}
                    </span>
                  ))}
                </div>
              </div>

              <div>
                <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-1">
                  Sounds like
                </div>
                <div className="text-sm">
                  {brief.referenceArtists.join(" · ")}
                </div>
              </div>

              {brief.vocalStyle && (
                <div className="border border-border rounded-md p-3">
                  <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                    Vocal Style
                  </div>
                  <div className="text-sm mt-1">{brief.vocalStyle}</div>
                </div>
              )}

              <div className="border border-border rounded-md p-3">
                <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                  Timing notes
                </div>
                <p className="text-sm mt-1">{brief.timingNotes}</p>
              </div>

              <div>
                <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-2">
                  Per-part direction
                </div>
                <div className="space-y-2">
                  {brief.partBreakdown.map((p) => (
                    <div
                      key={p.part}
                      className="border border-border rounded-md p-3"
                      data-testid={`music-part-${p.part}`}
                    >
                      <div className="text-[10px] font-mono uppercase tracking-widest text-primary">
                        Part {p.part}
                      </div>
                      <p className="text-xs mt-1">{p.musicDirection}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-3 border-t border-border">
                <div>
                  <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-1">
                    Suno prompt
                  </div>
                  <pre className="text-[11px] font-mono bg-background border border-border rounded-md p-2 whitespace-pre-wrap break-words max-h-40 overflow-auto">
                    {brief.sunoPrompt}
                  </pre>
                  <CopyButton
                    text={brief.sunoPrompt}
                    label="Copy Suno"
                    variant="accent"
                    className="mt-2 w-full"
                    testId="button-copy-suno"
                  />
                </div>
                <div>
                  <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-1">
                    Udio prompt
                  </div>
                  <pre className="text-[11px] font-mono bg-background border border-border rounded-md p-2 whitespace-pre-wrap break-words max-h-40 overflow-auto">
                    {brief.udioPrompt}
                  </pre>
                  <CopyButton
                    text={brief.udioPrompt}
                    label="Copy Udio"
                    variant="accent"
                    className="mt-2 w-full"
                    testId="button-copy-udio"
                  />
                </div>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
