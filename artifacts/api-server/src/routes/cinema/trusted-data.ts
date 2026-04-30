/**
 * Trusted server-side mirror of the cinema camera/lens lookup tables.
 *
 * The client (`artifacts/contentstudio-ai/src/lib/cinema/`) holds the same
 * data for UI rendering, but the server MUST NOT trust client-supplied
 * `cameraInjection`, `lensInjection`, or `styleTranslation` strings —
 * otherwise a direct API caller could override the model's style guardrails
 * by smuggling instructions through those fields.
 *
 * Instead the route here recomputes those strings from the IDs the client
 * sends. If a future schema/data change diverges between client and server,
 * the server's table wins and the client just falls back to a generic
 * descriptive prompt — never an injection.
 *
 * Keep this file in sync with the client tables when you add cameras/lenses.
 */

export interface TrustedCamera {
  id: string;
  lookPreset: string;
  promptInjection: string;
  styleMode:
    | "photoreal_cinematic"
    | "anime_2d"
    | "pixel_art"
    | "cgi_3d"
    | "commercial_product";
}

export interface TrustedLens {
  id: string;
  name: string;
  promptInjection: string;
}

export const TRUSTED_CAMERAS: Record<string, TrustedCamera> = {
  arri_alexa_35: {
    id: "arri_alexa_35",
    lookPreset: "ARRI Alexa 35 Inspired Look",
    styleMode: "photoreal_cinematic",
    promptInjection:
      "ARRI Alexa 35 Inspired Look, super 35 filmic rendering, organic skin tones, premium cinema latitude.",
  },
  arri_alexa_mini_lf: {
    id: "arri_alexa_mini_lf",
    lookPreset: "ARRI Alexa Mini LF Inspired Look",
    styleMode: "photoreal_cinematic",
    promptInjection:
      "ARRI Alexa Mini LF Inspired Look, large format sensor depth, premium cinema highlight rolloff.",
  },
  red_v_raptor: {
    id: "red_v_raptor",
    lookPreset: "RED V-Raptor Inspired Look",
    styleMode: "photoreal_cinematic",
    promptInjection:
      "RED V-Raptor Inspired Look, clean modern digital cinema detail, sharp high-contrast rendering.",
  },
  sony_venice_2: {
    id: "sony_venice_2",
    lookPreset: "Sony Venice 2 Inspired Look",
    styleMode: "photoreal_cinematic",
    promptInjection:
      "Sony Venice 2 Inspired Look, dual-base ISO clean rendering, premium digital cinema with low-light fidelity.",
  },
  canon_c500_mark_ii: {
    id: "canon_c500_mark_ii",
    lookPreset: "Canon C500 Mark II Inspired Look",
    styleMode: "photoreal_cinematic",
    promptInjection:
      "Canon C500 Mark II Inspired Look, natural color science, smooth skin tones, documentary-friendly cinema feel.",
  },
  blackmagic_pocket_6k: {
    id: "blackmagic_pocket_6k",
    lookPreset: "Blackmagic Pocket 6K Inspired Look",
    styleMode: "photoreal_cinematic",
    promptInjection:
      "Blackmagic Pocket 6K Inspired Look, indie film texture, raw cinematic rendering, super 35 character.",
  },
  generic_anime_virtual_camera: {
    id: "generic_anime_virtual_camera",
    lookPreset: "2D Anime Virtual Camera",
    styleMode: "anime_2d",
    promptInjection:
      "hand-crafted 2D anime virtual camera, cel-shaded animation, painted background, hand-drawn line quality, anime film aesthetic.",
  },
  generic_pixel_art_camera: {
    id: "generic_pixel_art_camera",
    lookPreset: "Pixel Art Virtual Camera",
    styleMode: "pixel_art",
    promptInjection:
      "pixel art virtual camera, crisp pixel grid, limited palette, hand-pixeled detail, no anti-aliasing, retro game aesthetic.",
  },
  generic_3d_cgi_camera: {
    id: "generic_3d_cgi_camera",
    lookPreset: "3D CGI Virtual Camera",
    styleMode: "cgi_3d",
    promptInjection:
      "stylized 3D CGI virtual camera, animated film polish, global illumination, smooth subsurface skin, premium animated film aesthetic.",
  },
};

export const TRUSTED_LENSES: Record<string, TrustedLens> = {
  cooke_warm_cinema: {
    id: "cooke_warm_cinema",
    name: "Cooke Warm Cinema",
    promptInjection:
      "Cooke-style warm cinema lens look, gentle contrast, warm skin tones, soft pleasing falloff, emotional filmic rendering.",
  },
  zeiss_sharp_cinema: {
    id: "zeiss_sharp_cinema",
    name: "Zeiss Sharp Cinema",
    promptInjection:
      "Zeiss-style sharp cinema lens look, crisp detail, clean contrast, precise modern optical rendering.",
  },
  arri_signature_prime: {
    id: "arri_signature_prime",
    name: "ARRI Signature Prime",
    promptInjection:
      "ARRI Signature Prime inspired large-format lens look, elegant softness, smooth depth, premium cinematic highlight rolloff.",
  },
  panavision_epic_anamorphic: {
    id: "panavision_epic_anamorphic",
    name: "Panavision Epic Anamorphic",
    promptInjection:
      "Panavision-style anamorphic cinema look, epic wide frame, oval bokeh, horizontal lens flare, grand Hollywood scale.",
  },
  leica_luxury_portrait: {
    id: "leica_luxury_portrait",
    name: "Leica Luxury Portrait",
    promptInjection:
      "Leica-inspired luxury portrait lens look, refined bokeh, rich contrast, elegant skin texture, premium portrait softness.",
  },
  atlas_orion_anamorphic: {
    id: "atlas_orion_anamorphic",
    name: "Atlas Orion Anamorphic",
    promptInjection:
      "Atlas Orion inspired anamorphic lens look, organic cinematic distortion, soft flare, modern indie film character.",
  },
  canon_cne_natural: {
    id: "canon_cne_natural",
    name: "Canon CN-E Natural",
    promptInjection:
      "Canon CN-E inspired natural cinema lens look, warm realistic color, smooth skin, clean cinematic clarity.",
  },
  sigma_cine_clean: {
    id: "sigma_cine_clean",
    name: "Sigma Cine Clean",
    promptInjection:
      "Sigma Cine inspired clean modern lens look, neutral contrast, controlled sharpness, versatile commercial clarity.",
  },
  vintage_soviet_lens: {
    id: "vintage_soviet_lens",
    name: "Vintage Soviet Lens",
    promptInjection:
      "vintage Soviet lens inspired look, swirly bokeh, dreamy softness, imperfect optical character, nostalgic cinematic texture.",
  },
  angenieux_zoom_documentary: {
    id: "angenieux_zoom_documentary",
    name: "Angenieux Zoom Documentary",
    promptInjection:
      "Angenieux-style documentary zoom lens look, natural field realism, cinematic documentary immediacy, subtle zoom-lens character.",
  },
  macro_probe_lens: {
    id: "macro_probe_lens",
    name: "Macro Probe Lens",
    promptInjection:
      "macro probe lens look, extreme close detail, tiny-world perspective, dramatic foreground depth, sharp product-level texture.",
  },
  anime_hero_frame: {
    id: "anime_hero_frame",
    name: "Anime Hero Frame",
    promptInjection:
      "anime hero frame composition, wide dynamic pose, painted background, dramatic cel-shaded lighting.",
  },
  anime_closeup_frame: {
    id: "anime_closeup_frame",
    name: "Anime Close-Up Frame",
    promptInjection:
      "anime emotional close-up framing, expressive eyes, soft cel shading, painted background blur, hand-drawn line quality.",
  },
  anime_speed_perspective: {
    id: "anime_speed_perspective",
    name: "Anime Speed Perspective",
    promptInjection:
      "anime extreme speed perspective, dramatic foreshortening, speed lines, action impact frame, hand-drawn 2D energy.",
  },
  pixel_side_scroller: {
    id: "pixel_side_scroller",
    name: "Pixel Side-Scroller",
    promptInjection:
      "side-scroller pixel art composition, parallax background layers, crisp pixel grid, limited palette, no anti-aliasing.",
  },
  pixel_isometric: {
    id: "pixel_isometric",
    name: "Pixel Isometric",
    promptInjection:
      "isometric pixel art frame, crisp tile-based perspective, limited palette, hand-pixeled detail, no anti-aliasing.",
  },
  pixel_top_down: {
    id: "pixel_top_down",
    name: "Pixel Top-Down",
    promptInjection:
      "top-down pixel art view, classic arcade composition, crisp pixel grid, limited palette, no anti-aliasing.",
  },
  virtual_35mm_cgi: {
    id: "virtual_35mm_cgi",
    name: "Virtual 35mm CGI",
    promptInjection:
      "stylized 3D CGI rendered with virtual 35mm focal length, global illumination, smooth subsurface skin, animated film polish.",
  },
  virtual_50mm_character: {
    id: "virtual_50mm_character",
    name: "Virtual 50mm Character",
    promptInjection:
      "stylized 3D CGI virtual 50mm character close-up, expressive rigged face, premium animated film lighting, smooth subsurface skin.",
  },
  virtual_wide_hero: {
    id: "virtual_wide_hero",
    name: "Virtual Wide Hero",
    promptInjection:
      "stylized 3D CGI wide hero shot, large-scale environment, dramatic key light, animated film polish, global illumination.",
  },
};

/**
 * Server-authored style translation. Mirrors the client helper, but is the
 * authoritative source of truth — the route ignores any client-supplied
 * `styleTranslation` and recomputes here. Style guardrails (e.g. "do NOT
 * render plastic 3D faces in anime mode") therefore can't be bypassed by
 * a malicious caller smuggling instructions through the field.
 */
export function trustedStyleTranslation(args: {
  styleMode: string;
  focalLength: string;
  aperture: string;
}): string {
  const { styleMode, focalLength, aperture } = args;
  switch (styleMode) {
    case "photoreal_cinematic":
      return [
        `keep real cinema lens terminology — focal length ${focalLength}, aperture ${aperture}`,
        `use filmic optics, real bokeh shape, natural sensor grain, accurate lens flare`,
      ].join("; ");
    case "anime_2d":
      return [
        `treat camera framing as anime composition language, NOT real optics`,
        `use dynamic anime key pose, cel shading, painted background, anime close-up framing, speed perspective when motion is implied`,
        `do NOT render realistic skin pores, real camera noise, or plastic 3D faces`,
      ].join("; ");
    case "pixel_art":
      return [
        `treat camera framing as pixel-art composition language, NOT real optics`,
        `use crisp pixel grid, limited palette, side-scroller / isometric / top-down framing, parallax sprite layers`,
        `do NOT render shallow DOF blur, anti-aliased smooth edges, or photoreal textures`,
      ].join("; ");
    case "cgi_3d":
      return [
        `treat camera as a virtual rigged 3D camera with virtual focal length ${focalLength}, stylized depth of field`,
        `use global illumination, smooth subsurface skin, premium animated film polish`,
        `do NOT render cheap game-engine textures, unstable model design, or low-poly silhouettes`,
      ].join("; ");
    case "commercial_product":
      return [
        `camera language must emphasize product shape, material accuracy, controlled reflections, clean studio background`,
        `use focal length ${focalLength} and aperture ${aperture} as product framing guidance`,
        `do NOT render messy props, distorted text/logos, or chaotic backgrounds`,
      ].join("; ");
    default:
      return `focal length ${focalLength}, aperture ${aperture}`;
  }
}
