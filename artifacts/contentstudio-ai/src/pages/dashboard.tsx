import { Link, useLocation } from "wouter";
import { useEffect, useState } from "react";
import {
  ArrowRight,
  BookOpen,
  Video,
  Play,
  Mic,
  Camera,
  Film,
  LayoutTemplate,
  Volume2,
  Sparkles,
  X,
} from "lucide-react";
import {
  storage,
  styleAccent,
  type Project,
  type VoiceoverLanguage,
} from "@/lib/storage";

const ASSET_BASE = import.meta.env.BASE_URL;

interface Template {
  key: string;
  title: string;
  blurb: string;
  prefill: {
    brief: string;
    genre: string;
    totalDurationSeconds: number;
    style: string;
    voiceoverLanguage: VoiceoverLanguage;
  };
}

const TEMPLATES: Template[] = [
  {
    key: "product-launch-ad",
    title: "Product Launch Ad",
    blurb: "30s · Live Action Cinematic · Hinglish VO",
    prefill: {
      brief:
        "A bold 30-second product reveal — the new product cuts through chaos in a city, snapping the audience to attention with confident swagger and unmissable detail shots.",
      genre: "Drama",
      totalDurationSeconds: 30,
      style: "Live Action Cinematic",
      voiceoverLanguage: "hinglish",
    },
  },
  {
    key: "cinematic-travel-reel",
    title: "Cinematic Travel Reel",
    blurb: "1 min · Live Action Cinematic · No VO",
    prefill: {
      brief:
        "A 1-minute cinematic travel reel through coastal mountains and golden-hour streets — wide vistas, intimate locals, sweeping movement, scored to a hopeful track.",
      genre: "Adventure",
      totalDurationSeconds: 60,
      style: "Live Action Cinematic",
      voiceoverLanguage: "none",
    },
  },
  {
    key: "anime-short",
    title: "Anime Short",
    blurb: "30s · Anime 2D · No VO",
    prefill: {
      brief:
        "A 30-second anime short: a young protagonist sprints through neon Tokyo rain to deliver a single envelope before midnight. Bold linework, dynamic camera, dramatic lighting.",
      genre: "Action",
      totalDurationSeconds: 30,
      style: "Anime 2D",
      voiceoverLanguage: "none",
    },
  },
  {
    key: "brand-film",
    title: "Brand Film",
    blurb: "2 min · Live Action Cinematic · English VO",
    prefill: {
      brief:
        "A 2-minute brand film weaving customer stories with founder narration. Real people, real moments, building to a quiet declaration of why the brand exists.",
      genre: "Drama",
      totalDurationSeconds: 120,
      style: "Live Action Cinematic",
      voiceoverLanguage: "english",
    },
  },
  {
    key: "horror-short",
    title: "Horror Short",
    blurb: "1 min · Horror Atmospheric · No VO",
    prefill: {
      brief:
        "A 1-minute slow-creep horror short: a lone figure in a too-quiet apartment gradually realises the layout has changed since they fell asleep.",
      genre: "Horror",
      totalDurationSeconds: 60,
      style: "Horror Atmospheric",
      voiceoverLanguage: "none",
    },
  },
  {
    key: "motivational-reel",
    title: "Motivational Reel",
    blurb: "30s · Music Video Hyper · Hindi VO",
    prefill: {
      brief:
        "30 सेकंड का motivational reel — सुबह 5 बजे की तैयारी, पसीना, ज़िद, और एक छोटी सी जीत। तेज़ कट, energetic music, और एक यादगार आख़िरी फ्रेम।",
      genre: "Drama",
      totalDurationSeconds: 30,
      style: "Music Video Hyper",
      voiceoverLanguage: "none",
    },
  },
];

// Cinematic module showcase — matches the glass-card grid in the reference
// images. Each card is a doorway into one of the studio's flagship features.
const STUDIO_MODULES: Array<{
  href: string;
  icon: React.ElementType;
  title: string;
  desc: string;
  testId: string;
  resetProject?: boolean;
}> = [
  {
    href: "/story",
    icon: BookOpen,
    title: "Story Builder",
    desc: "Plan cinematic stories that connect.",
    testId: "module-story",
    resetProject: true,
  },
  {
    href: "/generate",
    icon: Video,
    title: "Video Prompts",
    desc: "Generate shot lists and scene ideas.",
    testId: "module-prompts",
  },
  {
    href: "/video-studio",
    icon: Film,
    title: "AI Video Studio",
    desc: "Turn ideas into stunning videos.",
    testId: "module-video-studio",
  },
  {
    href: "/cinema",
    icon: Camera,
    title: "Cinema Studio",
    desc: "Grade, light, and shoot like a pro.",
    testId: "module-cinema",
  },
  {
    href: "/voiceover",
    icon: Mic,
    title: "Voiceover",
    desc: "Natural, expressive voiceovers in minutes.",
    testId: "module-voiceover",
  },
];

// Visual style preset cards — uses the four AI-generated reference plates
// (Cinematic Live Action, Anime 2D, Pixar 3D, Dark Fantasy) so users can
// see the look they're picking before they commit.
const VISUAL_PRESETS: Array<{
  key: string;
  name: string;
  blurb: string;
  tags: string[];
  image: string;
  styleName: string;
}> = [
  {
    key: "cinematic-live-action",
    name: "Cinematic Live Action",
    blurb: "Real-world filmic visuals with natural lighting, depth, and authentic detail.",
    tags: ["Realistic", "Filmic", "Immersive"],
    image: `${ASSET_BASE}style-presets/cinematic-live-action.png`,
    styleName: "Live Action Cinematic",
  },
  {
    key: "anime-2d",
    name: "Anime 2D",
    blurb: "Stylised 2D animation with expressive characters, vibrant colors, and dynamic framing.",
    tags: ["Stylised", "Expressive", "Dynamic"],
    image: `${ASSET_BASE}style-presets/anime-2d.png`,
    styleName: "Anime 2D",
  },
  {
    key: "pixar-3d",
    name: "3D Pixar Style",
    blurb: "Charming 3D animation with character, warm lighting, and storybook appeal.",
    tags: ["Charming", "Warm", "Storybook"],
    image: `${ASSET_BASE}style-presets/pixar-3d.png`,
    styleName: "3D Pixar Style",
  },
  {
    key: "dark-fantasy",
    name: "Dark Fantasy",
    blurb: "Gothic, atmospheric worlds with mystery, shadow, and epic fantasy elements.",
    tags: ["Dark", "Epic", "Atmospheric"],
    image: `${ASSET_BASE}style-presets/dark-fantasy.png`,
    styleName: "Dark Fantasy",
  },
];

export default function Dashboard() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [, navigate] = useLocation();

  useEffect(() => {
    const refresh = () => setProjects(storage.getProjects());
    refresh();
    window.addEventListener("cs:projects-changed", refresh);
    return () => window.removeEventListener("cs:projects-changed", refresh);
  }, []);

  const totalShots = projects.reduce(
    (sum, p) => sum + p.parts.reduce((s, part) => s + part.shots.length, 0),
    0,
  );
  const styleCounts = projects.reduce<Record<string, number>>((acc, p) => {
    if (p.style) acc[p.style] = (acc[p.style] ?? 0) + 1;
    return acc;
  }, {});
  const mostUsedStyle =
    Object.entries(styleCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "—";

  const recent = [...projects]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 8);

  const applyTemplate = (t: Template) => {
    sessionStorage.setItem("cs_template", JSON.stringify(t.prefill));
    storage.setCurrentProjectId(null);
    setTemplatesOpen(false);
    navigate("/story");
  };

  // Style-only payload: lets the user pre-pick a look and still write their
  // own brief / duration / VO from scratch on the Story Builder.
  const startWithStyle = (styleName: string) => {
    sessionStorage.setItem(
      "cs_template",
      JSON.stringify({ style: styleName }),
    );
    storage.setCurrentProjectId(null);
    navigate("/story");
  };

  return (
    <div
      className="cs-dashboard px-4 py-8 md:px-12 md:py-14 max-w-7xl mx-auto"
      data-testid="page-dashboard"
    >
      {/* TRIAL BANNER */}
      <div
        className="cs-trial-banner"
        data-testid="trial-banner"
      >
        <Sparkles className="w-4 h-4" />
        <span className="cs-trial-eyebrow">Launch offer</span>
        <span className="cs-trial-text">
          Every studio feature is <strong>free for 30 days</strong> — no card,
          no caps, full HD export.
        </span>
      </div>

      {/* HERO */}
      <div className="cs-hero">
        <div className="cs-hero-copy">
          <div className="cs-eyebrow">
            <span className="cs-dot" /> ContentStudio AI · cinema studio
          </div>
          <h1
            className="cs-hero-title"
            data-testid="hero-heading"
          >
            Turn stories into
            <br />
            <span className="cs-hero-accent">cinematic prompts.</span>
          </h1>
          <p className="cs-hero-sub">
            Brief in, full prompt package out — story, shots, music, voiceover,
            stitched MP4. Your idea, projected at the speed of light.
          </p>
          <div className="cs-hero-cta">
            <Link
              href="/story"
              onClick={() => storage.setCurrentProjectId(null)}
              className="cs-btn cs-btn-primary"
              data-testid="cta-new-project"
            >
              Start new project <ArrowRight className="w-4 h-4" />
            </Link>
            <Link
              href="/history"
              className="cs-btn cs-btn-ghost"
              data-testid="cta-history"
            >
              View history
            </Link>
          </div>
        </div>
        <div className="cs-hero-art" aria-hidden="true">
          <img
            src={`${ASSET_BASE}cinematic/lens-collection.png`}
            alt=""
            loading="eager"
            decoding="async"
          />
          <div className="cs-hero-art-overlay" />
        </div>
      </div>

      {/* STATS */}
      <div className="cs-stat-row">
        <Stat label="Total Projects" value={projects.length.toString()} />
        <Stat label="Shots Generated" value={totalShots.toString()} />
        <Stat label="Most Used Style" value={mostUsedStyle} />
      </div>

      {/* STUDIO MODULES — glass cards */}
      <section className="cs-section">
        <div className="cs-section-head">
          <div className="cs-section-eyebrow">Studio</div>
          <h2 className="cs-section-title">Open a tool</h2>
        </div>
        <div className="cs-modules">
          {STUDIO_MODULES.map((m) => (
            <Link
              key={m.testId}
              href={m.href}
              onClick={
                m.resetProject ? () => storage.setCurrentProjectId(null) : undefined
              }
              className="cs-module-card"
              data-testid={m.testId}
            >
              <div className="cs-module-icon">
                <m.icon className="w-5 h-5" strokeWidth={1.6} />
              </div>
              <div className="cs-module-text">
                <div className="cs-module-title">{m.title}</div>
                <div className="cs-module-desc">{m.desc}</div>
              </div>
              <ArrowRight className="cs-module-arrow w-4 h-4" />
            </Link>
          ))}
          <button
            type="button"
            onClick={() => setTemplatesOpen(true)}
            className="cs-module-card cs-module-template"
            data-testid="module-templates"
          >
            <div className="cs-module-icon">
              <LayoutTemplate className="w-5 h-5" strokeWidth={1.6} />
            </div>
            <div className="cs-module-text">
              <div className="cs-module-title">From Template</div>
              <div className="cs-module-desc">
                Pick a preset and start in one click
              </div>
            </div>
            <ArrowRight className="cs-module-arrow w-4 h-4" />
          </button>
        </div>
      </section>

      {/* VISUAL STYLE PRESETS */}
      <section className="cs-section">
        <div className="cs-section-head">
          <div className="cs-section-eyebrow">Pick a look</div>
          <h2 className="cs-section-title">
            Visual style <span className="cs-accent">presets</span>
          </h2>
          <p className="cs-section-sub">
            Choose the perfect visual style for your story. Each preset defines
            the look, mood, and cinematic language of your final video.
          </p>
        </div>
        <div className="cs-presets">
          {VISUAL_PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => startWithStyle(p.styleName)}
              className="cs-preset-card"
              data-testid={`preset-${p.key}`}
            >
              <div className="cs-preset-image-wrap">
                <img
                  src={p.image}
                  alt={p.name}
                  loading="lazy"
                  decoding="async"
                />
                <div className="cs-preset-image-fade" />
              </div>
              <div className="cs-preset-body">
                <div className="cs-preset-name">{p.name}</div>
                <p className="cs-preset-blurb">{p.blurb}</p>
                <div className="cs-preset-tags">
                  {p.tags.map((t) => (
                    <span key={t}>{t}</span>
                  ))}
                </div>
              </div>
            </button>
          ))}
        </div>
      </section>

      {/* RECENT PROJECTS — colored gradient borders, like the reference */}
      <section className="cs-section">
        <div className="cs-section-head cs-section-head-row">
          <div>
            <div className="cs-section-eyebrow">Your work</div>
            <h2 className="cs-section-title">Recent Projects</h2>
          </div>
          <Link
            href="/history"
            className="cs-link-link"
            data-testid="recent-view-all"
          >
            View all →
          </Link>
        </div>

        {recent.length === 0 ? (
          <div className="cs-empty" data-testid="recent-empty">
            <Play className="w-7 h-7 opacity-50" />
            <div className="cs-empty-title">No projects yet</div>
            <div className="cs-empty-sub">
              Start a new story to fill this space.
            </div>
          </div>
        ) : (
          <div className="cs-recent-grid">
            {recent.map((p) => {
              const accent = styleAccent(p.style);
              // A project counts as "complete" only when it actually has parts
              // and every part has shots. `[].every` is vacuously true, which
              // would otherwise mis-label brand-new drafts as "Completed".
              const isComplete =
                p.parts.length > 0 &&
                p.parts.every(
                  (part) => part.shots && part.shots.length > 0,
                );
              const completionPct = p.parts.length
                ? Math.round(
                    (p.parts.filter((part) => part.shots && part.shots.length > 0)
                      .length /
                      p.parts.length) *
                      100,
                  )
                : 0;
              return (
                <Link
                  key={p.id}
                  href={`/history?id=${p.id}`}
                  className="cs-recent-card"
                  style={
                    {
                      "--cs-accent": accent,
                    } as React.CSSProperties
                  }
                  data-testid={`recent-card-${p.id}`}
                >
                  <div className="cs-recent-art">
                    <div className="cs-recent-art-grad" />
                    <div className="cs-recent-art-mark">
                      {p.title.slice(0, 1).toUpperCase() || "•"}
                    </div>
                  </div>
                  <div className="cs-recent-body">
                    <h3 className="cs-recent-title">{p.title}</h3>
                    <div className="cs-recent-chips">
                      {p.style && (
                        <span
                          className="cs-recent-chip"
                          style={{
                            color: accent,
                            borderColor: `${accent}55`,
                          }}
                          data-testid={`recent-style-chip-${p.id}`}
                        >
                          {p.style}
                        </span>
                      )}
                      <span className="cs-recent-chip cs-recent-chip-muted">
                        {p.parts.length} part{p.parts.length === 1 ? "" : "s"}
                      </span>
                      <span className="cs-recent-chip cs-recent-chip-muted">
                        {Math.round(
                          (p.totalDurationSeconds ?? p.totalDuration ?? 0) / 60,
                        )}
                        :
                        {String(
                          (p.totalDurationSeconds ?? p.totalDuration ?? 0) % 60,
                        ).padStart(2, "0")}{" "}
                        min
                      </span>
                      {p.voiceoverLanguage && p.voiceoverLanguage !== "none" && (
                        <span
                          className="cs-recent-chip cs-recent-chip-vo"
                          data-testid={`recent-vo-chip-${p.id}`}
                        >
                          <Volume2 className="w-2.5 h-2.5" />
                          {p.voiceoverLanguage}
                        </span>
                      )}
                    </div>
                    <div className="cs-recent-foot">
                      <div className="cs-recent-status">
                        {isComplete ? (
                          <span className="cs-status-complete">Completed ✓</span>
                        ) : completionPct === 0 ? (
                          <span className="cs-status-draft">Draft +</span>
                        ) : (
                          <span className="cs-status-progress">
                            Processing
                          </span>
                        )}
                      </div>
                      {!isComplete && completionPct > 0 && (
                        <div className="cs-recent-progress">
                          <div
                            className="cs-recent-progress-bar"
                            style={{
                              width: `${completionPct}%`,
                              background: accent,
                            }}
                          />
                          <span>{completionPct}%</span>
                        </div>
                      )}
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      {/* TEMPLATES MODAL */}
      {templatesOpen && (
        <div
          className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in"
          onClick={() => setTemplatesOpen(false)}
          data-testid="templates-modal"
        >
          <div
            className="bg-card border border-border rounded-md max-w-3xl w-full max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-5 border-b border-border sticky top-0 bg-card">
              <div>
                <div className="text-[10px] font-mono uppercase tracking-widest text-primary">
                  Templates
                </div>
                <h3 className="mt-1 font-display text-2xl tracking-tight">
                  Start from a preset
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setTemplatesOpen(false)}
                className="text-muted-foreground hover:text-foreground"
                data-testid="templates-close"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-3">
              {TEMPLATES.map((t) => {
                const accent = styleAccent(t.prefill.style);
                return (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => applyTemplate(t)}
                    className="text-left border-l-4 border-r border-t border-b border-border rounded-md p-4 hover:border-r-primary hover:border-t-primary hover:border-b-primary transition-colors"
                    style={{ borderLeftColor: accent }}
                    data-testid={`template-${t.key}`}
                  >
                    <div className="font-display text-lg tracking-tight">
                      {t.title}
                    </div>
                    <div className="mt-1 text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                      {t.blurb}
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground line-clamp-2">
                      {t.prefill.brief}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="cs-stat">
      <div className="cs-stat-label">{label}</div>
      <div className="cs-stat-value">{value}</div>
    </div>
  );
}
