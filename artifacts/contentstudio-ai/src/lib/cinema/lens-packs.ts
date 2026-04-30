import type { LensPack } from "./types";

/**
 * Lens Packs — opinionated lens "personalities" that go beyond focal
 * length/aperture. Each pack contributes a `promptInjection` fragment that
 * is appended to the final image prompt.
 *
 * Pack IDs are STABLE — they're keyed in CAMERA_BODIES.recommendedLensPacks
 * and may be persisted on user-saved presets.
 */
export const LENS_PACKS: LensPack[] = [
  {
    id: "cooke_warm_cinema",
    name: "Cooke Warm Cinema",
    look: "warm skin tones, soft contrast, gentle falloff, emotional cinematic warmth",
    bestFor: ["drama", "romance", "character closeups", "period films"],
    promptInjection:
      "Cooke-style warm cinema lens look, gentle contrast, warm skin tones, soft pleasing falloff, emotional filmic rendering.",
  },
  {
    id: "zeiss_sharp_cinema",
    name: "Zeiss Sharp Cinema",
    look: "clean sharp image, high micro-contrast, precise modern cinema detail",
    bestFor: ["sci-fi", "thriller", "commercial", "architecture", "action"],
    promptInjection:
      "Zeiss-style sharp cinema lens look, crisp detail, clean contrast, precise modern optical rendering.",
  },
  {
    id: "arri_signature_prime",
    name: "ARRI Signature Prime",
    look: "large format softness, premium depth, elegant highlight rolloff, luxury cinema feel",
    bestFor: ["premium ads", "fashion", "epic drama", "luxury product"],
    promptInjection:
      "ARRI Signature Prime inspired large-format lens look, elegant softness, smooth depth, premium cinematic highlight rolloff.",
  },
  {
    id: "panavision_epic_anamorphic",
    name: "Panavision Epic Anamorphic",
    look: "wide cinematic frame, oval bokeh, horizontal flare, epic Hollywood scale",
    bestFor: ["action", "sci-fi", "fantasy", "epic hero shots"],
    promptInjection:
      "Panavision-style anamorphic cinema look, epic wide frame, oval bokeh, horizontal lens flare, grand Hollywood scale.",
  },
  {
    id: "leica_luxury_portrait",
    name: "Leica Luxury Portrait",
    look: "premium portrait softness, rich contrast, elegant skin texture, refined bokeh",
    bestFor: ["fashion", "beauty", "romance", "premium portraits"],
    promptInjection:
      "Leica-inspired luxury portrait lens look, refined bokeh, rich contrast, elegant skin texture, premium portrait softness.",
  },
  {
    id: "atlas_orion_anamorphic",
    name: "Atlas Orion Anamorphic",
    look: "modern anamorphic character, cinematic flare, organic distortion, indie sci-fi feel",
    bestFor: ["music videos", "indie films", "cyberpunk", "urban drama"],
    promptInjection:
      "Atlas Orion inspired anamorphic lens look, organic cinematic distortion, soft flare, modern indie film character.",
  },
  {
    id: "canon_cne_natural",
    name: "Canon CN-E Natural",
    look: "natural colors, smooth faces, clean creator-friendly cinema",
    bestFor: ["documentary", "travel", "creator videos", "short films"],
    promptInjection:
      "Canon CN-E inspired natural cinema lens look, warm realistic color, smooth skin, clean cinematic clarity.",
  },
  {
    id: "sigma_cine_clean",
    name: "Sigma Cine Clean",
    look: "clean modern sharpness, neutral contrast, versatile commercial style",
    bestFor: ["commercial", "product", "fitness", "corporate", "social content"],
    promptInjection:
      "Sigma Cine inspired clean modern lens look, neutral contrast, controlled sharpness, versatile commercial clarity.",
  },
  {
    id: "vintage_soviet_lens",
    name: "Vintage Soviet Lens",
    look: "swirly bokeh, imperfect vintage softness, dreamy artistic distortion",
    bestFor: ["dream scenes", "nostalgia", "music video", "surreal fantasy"],
    promptInjection:
      "vintage Soviet lens inspired look, swirly bokeh, dreamy softness, imperfect optical character, nostalgic cinematic texture.",
  },
  {
    id: "angenieux_zoom_documentary",
    name: "Angenieux Zoom Documentary",
    look: "classic documentary zoom lens, natural field realism, live-action immediacy",
    bestFor: ["documentary", "war scenes", "news style", "realistic handheld scenes"],
    promptInjection:
      "Angenieux-style documentary zoom lens look, natural field realism, cinematic documentary immediacy, subtle zoom-lens character.",
  },
  {
    id: "macro_probe_lens",
    name: "Macro Probe Lens",
    look: "extreme close macro detail, tiny-world perspective, dramatic foreground depth",
    bestFor: ["product macro", "food", "insects", "details", "object reveals"],
    promptInjection:
      "macro probe lens look, extreme close detail, tiny-world perspective, dramatic foreground depth, sharp product-level texture.",
  },
  {
    id: "anime_hero_frame",
    name: "Anime Hero Frame",
    look: "wide anime hero composition, dynamic poses, painted background",
    bestFor: ["anime hero shots", "key art", "poster frames"],
    promptInjection:
      "anime hero frame composition, wide dynamic pose, painted background, dramatic cel-shaded lighting.",
  },
  {
    id: "anime_closeup_frame",
    name: "Anime Close-Up Frame",
    look: "anime emotional close-up framing, large expressive eyes, soft cel shading",
    bestFor: ["anime emotional beats", "character moments"],
    promptInjection:
      "anime emotional close-up framing, expressive eyes, soft cel shading, painted background blur, hand-drawn line quality.",
  },
  {
    id: "anime_speed_perspective",
    name: "Anime Speed Perspective",
    look: "extreme anime perspective, speed lines, motion impact frame",
    bestFor: ["anime action", "fight scenes", "power-ups"],
    promptInjection:
      "anime extreme speed perspective, dramatic foreshortening, speed lines, action impact frame, hand-drawn 2D energy.",
  },
  {
    id: "pixel_side_scroller",
    name: "Pixel Side-Scroller",
    look: "side-on pixel art composition, parallax layers, crisp pixel grid",
    bestFor: ["retro platformers", "side-scroll game art"],
    promptInjection:
      "side-scroller pixel art composition, parallax background layers, crisp pixel grid, limited palette, no anti-aliasing.",
  },
  {
    id: "pixel_isometric",
    name: "Pixel Isometric",
    look: "isometric pixel composition, crisp tile-based perspective",
    bestFor: ["RPG scenes", "city builders", "tactical art"],
    promptInjection:
      "isometric pixel art frame, crisp tile-based perspective, limited palette, hand-pixeled detail, no anti-aliasing.",
  },
  {
    id: "pixel_top_down",
    name: "Pixel Top-Down",
    look: "top-down pixel composition, classic JRPG / arcade feel",
    bestFor: ["top-down games", "dungeon crawlers", "arcade scenes"],
    promptInjection:
      "top-down pixel art view, classic arcade composition, crisp pixel grid, limited palette, no anti-aliasing.",
  },
  {
    id: "virtual_35mm_cgi",
    name: "Virtual 35mm CGI",
    look: "stylized CGI with virtual 35mm framing, global illumination",
    bestFor: ["3D animation", "game cinematics"],
    promptInjection:
      "stylized 3D CGI rendered with virtual 35mm focal length, global illumination, smooth subsurface skin, animated film polish.",
  },
  {
    id: "virtual_50mm_character",
    name: "Virtual 50mm Character",
    look: "CGI character close-up framing, expressive rigged face, premium animation feel",
    bestFor: ["3D character moments", "premium animated film"],
    promptInjection:
      "stylized 3D CGI virtual 50mm character close-up, expressive rigged face, premium animated film lighting, smooth subsurface skin.",
  },
  {
    id: "virtual_wide_hero",
    name: "Virtual Wide Hero",
    look: "wide CGI hero composition, large-scale environment, animated film polish",
    bestFor: ["3D hero shots", "fantasy CGI", "epic animated frames"],
    promptInjection:
      "stylized 3D CGI wide hero shot, large-scale environment, dramatic key light, animated film polish, global illumination.",
  },
];

export const LENS_PACK_BY_ID: Record<string, LensPack> = Object.fromEntries(
  LENS_PACKS.map((p) => [p.id, p]),
);
