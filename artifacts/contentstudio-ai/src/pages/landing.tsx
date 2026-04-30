import React, { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import {
  ArrowRight,
  Play,
  CheckCircle2,
  ChevronDown,
  Quote,
  MessageSquare,
  ListVideo,
  Loader2,
  Music2,
  Mic2,
  Shield,
  BookOpen,
  Clapperboard,
  Film,
  Camera,
  Mic,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { BrandLogo } from "@/components/brand-logo";

const ASSET_BASE = import.meta.env.BASE_URL;
const HERO_BG = `${ASSET_BASE}cinematic/hero-camera-lens.png`;
const MODEL_LOGO = (slug: string) => `${ASSET_BASE}models/${slug}.png`;
const MODULE_BG = (slug: string) => `${ASSET_BASE}cinematic/module-${slug}.png`;

export default function Landing() {
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const [scrollY, setScrollY] = useState(0);
  const heroRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handler = () => setScrollY(window.scrollY);
    window.addEventListener("scroll", handler, { passive: true });
    return () => window.removeEventListener("scroll", handler);
  }, []);

  // Reveal-on-scroll for sections
  useEffect(() => {
    const sections = document.querySelectorAll("[data-reveal]");
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("revealed");
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.15 },
    );
    sections.forEach((s) => io.observe(s));
    return () => io.disconnect();
  }, []);

  const goCTA = () => {
    if (user) navigate("/app");
    else navigate("/login");
  };

  return (
    <div className="cs-landing" data-testid="page-landing">
      {/* Top nav */}
      <header className="landing-nav">
        <div className="landing-nav-inner">
          <Link href="/" className="landing-brand" data-testid="landing-brand">
            <BrandLogo variant="auto" height={36} />
          </Link>
          <nav className="landing-nav-links">
            <a href="#features" data-testid="nav-features">Features</a>
            <a href="#models" data-testid="nav-models">Models</a>
            <a href="#how" data-testid="nav-how">How it works</a>
            <a href="#showcase" data-testid="nav-showcase">Showcase</a>
            <a href="#pricing" data-testid="nav-pricing">Pricing</a>
          </nav>
          <div className="landing-nav-actions">
            {user ? (
              <Link
                href="/app"
                className="btn btn-primary"
                data-testid="nav-open-app"
              >
                Open Studio <ArrowRight className="w-4 h-4" />
              </Link>
            ) : (
              <>
                <Link href="/login" data-testid="nav-signin" className="btn btn-ghost">
                  Sign in
                </Link>
                <Link
                  href="/login?mode=signup"
                  className="btn btn-primary"
                  data-testid="nav-signup"
                >
                  Get started
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Hero with parallax photographic background */}
      <section className="hero" ref={heroRef}>
        <div
          className="hero-photo"
          style={{
            backgroundImage: `url(${HERO_BG})`,
            transform: `translateY(${scrollY * 0.25}px) scale(1.08)`,
          }}
          aria-hidden="true"
        />
        <div className="hero-photo-overlay" aria-hidden="true" />
        <div
          className="hero-grid"
          style={{ transform: `translateY(${scrollY * 0.12}px)` }}
        />
        <div className="hero-glow" />

        <div className="hero-inner-grid">
          {/* LEFT: pitch */}
          <div className="hero-col-text">
            <div className="hero-eyebrow">
              <span className="dot" /> Built for Seedance 2.0 + every major AI
              video model
            </div>
            <h1 className="hero-title">
              Turn one brief into <em>cinema-grade</em> video prompts.
            </h1>
            <p className="hero-sub">
              Write your idea once. ContentStudio AI plans the story, breaks
              it into shots, scores the music, writes the voiceover, and hands
              you paste-ready prompts for every part of your video.
            </p>
            <div className="hero-cta">
              <button
                type="button"
                onClick={goCTA}
                className="btn btn-primary btn-lg"
                data-testid="hero-cta-start"
              >
                <Play className="w-4 h-4" />
                {user ? "Open the studio" : "Start free"}
              </button>
              <a
                href="#how"
                className="btn btn-outline btn-lg"
                data-testid="hero-cta-how"
              >
                See how it works
              </a>
            </div>
            <div className="hero-trust">
              <div>
                <div className="trust-num">15s</div>
                <div className="trust-label">parts per shot list</div>
              </div>
              <div>
                <div className="trust-num">12</div>
                <div className="trust-label">visual styles</div>
              </div>
              <div>
                <div className="trust-num">3</div>
                <div className="trust-label">voiceover languages</div>
              </div>
              <div>
                <div className="trust-num">∞</div>
                <div className="trust-label">refinements</div>
              </div>
            </div>
          </div>

          {/* RIGHT: glass card overlay with the 5 modules and prompt-ready badge */}
          <div className="hero-col-card" data-testid="hero-card">
            <div className="hero-card-eyebrow">
              <span className="dot" />
              Inside the studio
            </div>
            <div className="hero-card-modules">
              {HERO_MODULES.map((m) => (
                <div className="hero-card-module" key={m.label}>
                  <div className="hero-card-module-icon">
                    <m.Icon className="w-4 h-4" />
                  </div>
                  <div className="hero-card-module-text">
                    <div className="hero-card-module-label">{m.label}</div>
                    <div className="hero-card-module-meta">{m.meta}</div>
                  </div>
                  <div className="hero-card-module-status">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                  </div>
                </div>
              ))}
            </div>
            <div className="hero-card-badge" data-testid="hero-card-badge">
              <CheckCircle2 className="w-4 h-4" />
              <span>
                Prompt Generated <strong>24 Shots</strong> ·{" "}
                <strong>3:12 Min</strong> · <strong>Dark Fantasy Style</strong>
              </span>
            </div>
          </div>
        </div>

        <a href="#features" className="hero-scroll" aria-label="Scroll">
          <ChevronDown />
        </a>
      </section>

      {/* Feature preview window */}
      <section
        className="preview"
        data-reveal
        style={{ transform: `translateY(${Math.min(0, (scrollY - 600) * -0.05)}px)` }}
      >
        <div className="preview-window">
          <div className="preview-chrome">
            <span /> <span /> <span />
            <div className="preview-url">contentstudio.ai/story</div>
          </div>
          <div className="preview-body">
            <div className="preview-side">
              <div className="preview-side-title">
                <BrandLogo variant="icon" height={24} /> ContentStudio AI
              </div>
              <ul>
                <li className="active">Story Builder</li>
                <li>Video Prompts</li>
                <li>Music Brief</li>
                <li>Voiceover</li>
                <li>History</li>
              </ul>
            </div>
            <div className="preview-main">
              <div className="preview-chip">Step 2 of 3 · refine in chat</div>
              <h3 className="preview-h">The Midnight Graffiti</h3>
              <div className="preview-acts">
                {["Awakening", "Pursuit", "Reveal"].map((t, i) => (
                  <div className="preview-act" key={t}>
                    <div className="preview-act-num">Act {i + 1}</div>
                    <div className="preview-act-title">{t}</div>
                    <div className="preview-act-line" />
                    <div className="preview-act-line short" />
                  </div>
                ))}
              </div>
              <div className="preview-bubble user">
                "make act 2 more tense — add a chase across rooftops"
              </div>
              <div className="preview-bubble assistant">
                Updated. Act 2 now opens with a 9-shot rooftop chase. Anything
                else?
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features grid */}
      <section className="features" id="features" data-reveal>
        <div className="section-head">
          <div className="section-eyebrow">What you get</div>
          <h2 className="section-title">Everything between idea and edit.</h2>
          <p className="section-sub">
            One workspace. One brief. The whole prompt package — story, shots,
            music, voiceover — in minutes, not weeks.
          </p>
        </div>
        <div className="feature-grid">
          {FEATURES.map((f, i) => (
            <div className="feature-card" key={f.title} data-reveal style={{ animationDelay: `${i * 60}ms` }}>
              <div className="feature-icon-lucide">
                <f.Icon className="w-6 h-6" />
              </div>
              <h3>{f.title}</h3>
              <p>{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Cinematic 5-module row — backdrops with overlay text */}
      <section className="modules" id="modules" data-reveal>
        <div className="section-head">
          <div className="section-eyebrow">The studio, room by room</div>
          <h2 className="section-title">Five rooms. One brief.</h2>
          <p className="section-sub">
            Story, prompts, image, video, voice — each module is its own
            cinema. Walk in and start working.
          </p>
        </div>
        <div className="module-row">
          {MODULE_ROW.map((m, i) => (
            <Link
              key={m.slug}
              href={user ? m.href : "/login"}
              className="module-tile"
              data-reveal
              data-testid={`module-tile-${m.slug}`}
              style={{ animationDelay: `${i * 60}ms` }}
            >
              <div
                className="module-tile-bg"
                style={{ backgroundImage: `url(${MODULE_BG(m.slug)})` }}
              />
              <div className="module-tile-overlay" />
              <div className="module-tile-content">
                <div className="module-tile-label">{m.label}</div>
                <div className="module-tile-body">{m.body}</div>
                <div className="module-tile-cta">
                  Open <ArrowRight className="w-3.5 h-3.5" />
                </div>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* Supported video models — real PNG logos + per-model features */}
      <section className="models" id="models" data-reveal>
        <div className="section-head">
          <div className="section-eyebrow">Works with every major model</div>
          <h2 className="section-title">One brief. Every video model.</h2>
          <p className="section-sub">
            ContentStudio AI writes prompts that copy-paste into the model of
            your choice — JSON for Seedance 2.0, structured prose for everyone
            else. Switch models without rewriting a single shot.
          </p>
        </div>
        <div className="models-grid">
          {MODELS.map((m, i) => (
            <div
              className="model-card"
              key={m.name}
              data-reveal
              data-testid={`model-card-${m.slug}`}
              style={{ animationDelay: `${i * 50}ms` }}
            >
              <div className="model-logo-wrap">
                <img
                  src={MODEL_LOGO(m.slug)}
                  alt={`${m.name} logo`}
                  className="model-logo"
                  loading="lazy"
                  decoding="async"
                />
              </div>
              <div className="model-meta">
                <div className="model-name">{m.name}</div>
                <div className="model-maker">{m.maker}</div>
              </div>
              <p className="model-body">{m.body}</p>
              <ul className="model-tags">
                {m.tags.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* How it works — three big steps with parallax */}
      <section className="how" id="how" data-reveal>
        <div className="section-head">
          <div className="section-eyebrow">How it works</div>
          <h2 className="section-title">Three steps. No technical skills.</h2>
        </div>
        <div className="steps">
          {STEPS.map((s, i) => (
            <div className="step" key={s.title} data-reveal>
              <div
                className="step-num"
                style={{ transform: `translateY(${Math.max(-30, (scrollY - 1400 - i * 200) * -0.06)}px)` }}
              >
                0{i + 1}
              </div>
              <div className="step-body">
                <h3>{s.title}</h3>
                <p>{s.body}</p>
                <ul>
                  {s.bullets.map((b) => (
                    <li key={b}>
                      <CheckCircle2 className="w-4 h-4" /> {b}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Showcase strip */}
      <section className="showcase" id="showcase" data-reveal>
        <div className="section-head">
          <div className="section-eyebrow">Showcase</div>
          <h2 className="section-title">Built for every visual style.</h2>
        </div>
        <div className="showcase-grid">
          {STYLES.map((s, i) => (
            <div
              className="showcase-card"
              key={s.name}
              data-reveal
              style={{
                background: s.gradient,
                transform: `translateY(${Math.sin((scrollY + i * 80) * 0.005) * 8}px)`,
              }}
            >
              <div className="showcase-frame">
                <div className="showcase-meta">
                  <span>{s.name}</span>
                  <span>{s.parts}</span>
                </div>
                <div className="showcase-shots">
                  {Array.from({ length: 8 }).map((_, j) => (
                    <span
                      key={j}
                      className="shot-dot"
                      style={{ animationDelay: `${j * 120}ms` }}
                    />
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Quote */}
      <section className="quote-row" data-reveal>
        <Quote className="quote-mark" />
        <blockquote>
          “We used to spend a full afternoon just sketching the shot list. With
          ContentStudio AI we have the whole prompt package — story, shots,
          music brief — before our coffee gets cold.”
        </blockquote>
        <div className="quote-by">— Aanya, Director, indie short film</div>
      </section>

      {/* Pricing — every tier is free for the launch trial period */}
      <section className="pricing" id="pricing" data-reveal>
        <div className="section-head">
          <div className="section-eyebrow">Launch offer · 30-day trial</div>
          <h2 className="section-title">
            Every plan, <em>free</em> for the first 30 days.
          </h2>
          <p className="section-sub">
            Pick any tier and use it the way you'd use it on day 90 — full
            features, no card needed, no watermarks, no caps. Paid plans turn
            on later. Today, the studio is yours.
          </p>
        </div>
        <div className="price-grid">
          {PRICE_TIERS.map((tier) => (
            <div
              key={tier.name}
              className={`price-card ${tier.featured ? "featured" : ""}`}
              data-testid={`price-card-${tier.testId}`}
            >
              {tier.featured && (
                <div className="price-badge">Most popular</div>
              )}
              <div className="price-name">{tier.name}</div>
              <div className="price-amount">
                <span className="big">Free</span>
                <span className="small">/ 30 days</span>
              </div>
              <div
                className="price-future"
                title="Pricing once the launch trial ends"
              >
                later: <span>{tier.futurePrice}</span>
              </div>
              <ul>
                {tier.features.map((f) => (
                  <li key={f}>
                    <CheckCircle2 className="w-4 h-4" /> {f}
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={goCTA}
                className={`btn ${tier.featured ? "btn-primary" : "btn-outline"} w-full`}
                data-testid={`price-cta-${tier.testId}`}
              >
                {user ? "Open the studio" : tier.cta}
              </button>
            </div>
          ))}
        </div>
        <p className="price-footnote">
          No credit card required during the 30-day trial. Razorpay billing
          turns on once paid plans launch — we'll email you well before your
          trial ends.
        </p>
      </section>

      {/* Footer CTA */}
      <section className="final-cta" data-reveal>
        <div className="final-cta-bg" />
        <div className="final-cta-inner">
          <h2>Your next video starts with one sentence.</h2>
          <p>Open the studio and write it.</p>
          <button
            type="button"
            onClick={goCTA}
            className="btn btn-primary btn-lg"
            data-testid="final-cta"
          >
            <Play className="w-4 h-4" /> {user ? "Open the studio" : "Start free now"}
          </button>
        </div>
      </section>

      <footer className="landing-footer">
        <div>
          <BrandLogo variant="icon" height={28} />
          <span>© {new Date().getFullYear()} ContentStudio AI</span>
        </div>
        <div className="footer-links">
          <a href="#features">Features</a>
          <a href="#how">How it works</a>
          <a href="#pricing">Pricing</a>
        </div>
      </footer>
    </div>
  );
}

const FEATURES: Array<{
  title: string;
  body: string;
  Icon: LucideIcon;
}> = [
  {
    title: "Story chat",
    body: "Brief in, story out. Then refine via chat — \"make act 2 darker\", \"swap the protagonist\" — until it feels right.",
    Icon: MessageSquare,
  },
  {
    title: "Shot-by-shot prompts",
    body: "Each 15s part comes with a full shot list, named effects, density map and energy arc — paste-ready into Seedance 2.0.",
    Icon: ListVideo,
  },
  {
    title: "Background generation",
    body: "Hit Finalize and walk away. Every part keeps generating in the background and saves itself as it goes.",
    Icon: Loader2,
  },
  {
    title: "Music brief",
    body: "Get a tempo, mood and instrument list per part — and a copy-ready prompt for Suno or Udio.",
    Icon: Music2,
  },
  {
    title: "Voiceover EN · हिंदी · Hinglish",
    body: "Native scripts in three languages. Word counts tuned to part length. ElevenLabs-ready.",
    Icon: Mic2,
  },
  {
    title: "Honest, literal AI",
    body: "Your brief is law. The model never invents characters or settings outside what you wrote.",
    Icon: Shield,
  },
];

/** Hero glass-card row items — match the 5 product modules. */
const HERO_MODULES: Array<{ label: string; meta: string; Icon: LucideIcon }> = [
  { label: "Story Builder", meta: "3 acts · ready", Icon: BookOpen },
  { label: "Video Prompts", meta: "24 shots · 8 parts", Icon: Clapperboard },
  { label: "AI Video Studio", meta: "Seedance · 1080p", Icon: Film },
  { label: "Cinema Image Studio", meta: "Anamorphic · 16:9", Icon: Camera },
  { label: "Voiceover", meta: "EN · 412 words", Icon: Mic },
];

/** Cinematic modules row shown under the preview window. */
const MODULE_ROW: Array<{
  slug: string;
  label: string;
  body: string;
  href: string;
}> = [
  {
    slug: "story-builder",
    label: "Story Builder",
    body: "Acts, beats and a chat that hears you.",
    href: "/story",
  },
  {
    slug: "video-prompts",
    label: "Video Prompts",
    body: "Shot-by-shot, scored for any model.",
    href: "/generate",
  },
  {
    slug: "video-studio",
    label: "AI Video Studio",
    body: "Render the cut from your shot list.",
    href: "/video-studio",
  },
  {
    slug: "cinema-studio",
    label: "Cinema Image Studio",
    body: "Stills, references and frame anchors.",
    href: "/cinema",
  },
  {
    slug: "voiceover",
    label: "Voiceover",
    body: "EN, हिंदी and Hinglish, ElevenLabs-ready.",
    href: "/voiceover",
  },
];

const STEPS: Array<{ title: string; body: string; bullets: string[] }> = [
  {
    title: "Write the brief",
    body: "Pick a duration, a style and a voiceover language. Drop your one-sentence idea.",
    bullets: ["12 visual styles", "30s → 5min", "EN / HI / Hinglish VO"],
  },
  {
    title: "Refine the story in chat",
    body: "The AI drafts the story. You react. Send any tweak — small or sweeping — until it sings.",
    bullets: ["Refine acts", "Swap characters", "Change tone or palette"],
  },
  {
    title: "Generate the prompt package",
    body: "One Finalize click and the studio writes every shot, the music brief and the voiceover.",
    bullets: ["Runs in background", "Auto-saves per part", "Copy or download .txt"],
  },
];

const MODELS: Array<{
  slug: string;
  name: string;
  maker: string;
  body: string;
  tags: string[];
}> = [
  {
    slug: "seedance",
    name: "Seedance 2.0",
    maker: "ByteDance",
    body: "Our flagship target. JSON envelopes with shot-by-shot dialogue, BGM cues and lip-sync directives — paste-and-play, no extra config.",
    tags: ["JSON envelope", "Lip-sync", "Up to 1080p"],
  },
  {
    slug: "veo",
    name: "Veo 3",
    maker: "Google DeepMind",
    body: "Cinematic 4K with native audio. We hand it dense prose prompts with explicit camera, lighting and sound design — Veo's sweet spot.",
    tags: ["Native audio", "4K", "Long takes"],
  },
  {
    slug: "kling",
    name: "Kling 2.1",
    maker: "Kuaishou",
    body: "Best-in-class motion realism. We deliver tight movement choreography per shot so Kling's physics engine has clear ground to stand on.",
    tags: ["Real motion", "1080p", "Image-to-video"],
  },
  {
    slug: "sora",
    name: "Sora",
    maker: "OpenAI",
    body: "Long, coherent scenes up to 60s. We feed it act-by-act narrative beats and continuity anchors so Sora keeps characters consistent.",
    tags: ["60s scenes", "Continuity", "Storyboards"],
  },
  {
    slug: "runway",
    name: "Runway Gen-4",
    maker: "Runway",
    body: "Reference-image driven characters. Drop a character sheet — we build prompts that lock the look across every part.",
    tags: ["Ref images", "Character lock", "Editorial"],
  },
  {
    slug: "luma",
    name: "Dream Machine",
    maker: "Luma AI",
    body: "Fast, painterly motion. We send Luma compact poetic prompts — exactly what Ray-2 and Dream Machine reward.",
    tags: ["Fast", "Painterly", "Loops"],
  },
  {
    slug: "hailuo",
    name: "Hailuo 02",
    maker: "MiniMax",
    body: "Director-mode camera control with 1080p output. We translate your shot list into Hailuo's camera command syntax.",
    tags: ["Director mode", "1080p", "6s + 10s"],
  },
  {
    slug: "pika",
    name: "Pika 2.2",
    maker: "Pika Labs",
    body: "Scene Ingredients + Pikaframes. We pre-write keyframe pairs and ingredient lists so your edits land first try.",
    tags: ["Keyframes", "Ingredients", "Style swap"],
  },
  {
    slug: "hunyuan",
    name: "Hunyuan Video",
    maker: "Tencent",
    body: "Open-source 13B model with crisp text rendering. We surface dialogue and on-screen text as first-class fields.",
    tags: ["Open source", "Text rendering", "13B"],
  },
  {
    slug: "wan",
    name: "Wan 2.1",
    maker: "Alibaba",
    body: "Open-source bilingual model with great Chinese-text support. We honour the brief in EN, HI, or ZH without losing scene structure.",
    tags: ["Bilingual", "Open source", "VBench-leader"],
  },
];

// Six tier landing copy. Real prices live in `futurePrice` so the trial-now /
// pay-later story is honest. The `featured` flag is what triggers the green
// "Most popular" badge + filled CTA.
const PRICE_TIERS: Array<{
  name: string;
  testId: string;
  features: string[];
  futurePrice: string;
  cta: string;
  featured?: boolean;
}> = [
  {
    name: "Starter",
    testId: "starter",
    features: [
      "Story Builder, Video Prompts & Voiceover",
      "900 monthly credits worth of work",
      "15 s and 30 s test videos",
      "All 12 visual style presets",
    ],
    futurePrice: "₹799 / mo",
    cta: "Start free for 30 days",
  },
  {
    name: "Creator",
    testId: "creator",
    featured: true,
    features: [
      "Everything in Starter",
      "AI Video Studio · 1-minute videos",
      "Cinema Studio still frames",
      "No watermark, full HD export",
      "2 800 monthly credits worth of work",
    ],
    futurePrice: "₹1 999 / mo",
    cta: "Start free for 30 days",
  },
  {
    name: "Pro",
    testId: "pro",
    features: [
      "Everything in Creator",
      "Cinematic 1-minute output mode",
      "Multiple long-form videos / month",
      "Priority generation queue",
      "8 000 monthly credits worth of work",
    ],
    futurePrice: "₹4 999 / mo",
    cta: "Start free for 30 days",
  },
];

const STYLES: Array<{ name: string; parts: string; gradient: string }> = [
  { name: "Live Action Cinematic", parts: "8 parts · 2min", gradient: "linear-gradient(135deg,#0f1419 0%,#1a2332 100%)" },
  { name: "Cyberpunk Neon", parts: "6 parts · 90s", gradient: "linear-gradient(135deg,#1a0033 0%,#FF006E 100%)" },
  { name: "Studio Ghibli", parts: "4 parts · 60s", gradient: "linear-gradient(135deg,#2D5016 0%,#A8D5BA 100%)" },
  { name: "Anime 2D", parts: "10 parts · 2.5min", gradient: "linear-gradient(135deg,#FF6B9D 0%,#FFC75F 100%)" },
  { name: "Dark Fantasy", parts: "12 parts · 3min", gradient: "linear-gradient(135deg,#2C0033 0%,#5A189A 100%)" },
  { name: "Music Video Hyper", parts: "8 parts · 2min", gradient: "linear-gradient(135deg,#E8FF47 0%,#9BCB1A 100%)" },
];
