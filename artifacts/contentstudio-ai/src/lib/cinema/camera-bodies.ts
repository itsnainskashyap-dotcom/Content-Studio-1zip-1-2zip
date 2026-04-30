import type { CameraBody } from "./types";

/**
 * Camera Bodies — selectable "look presets" inspired by real cinema cameras
 * (handled in a trademark-safe way: each entry is presented as an
 * "Inspired Look", never as a guarantee that the image was actually shot
 * on that hardware). Selecting a camera auto-suggests recommended lens
 * packs, focal lengths, and color grades.
 *
 * Order is the order shown in the picker grid.
 */
export const CAMERA_BODIES: CameraBody[] = [
  {
    id: "arri_alexa_35",
    name: "ARRI Alexa 35",
    lookPreset: "ARRI Alexa 35 Inspired Look",
    sensorDescription: "Super 35 ALEV-style sensor — filmic latitude, organic skin tones",
    bestFor: ["drama", "character", "premium scripted"],
    recommendedLensPacks: [
      "cooke_warm_cinema",
      "zeiss_sharp_cinema",
      "panavision_epic_anamorphic",
    ],
    recommendedFocalLengths: [
      "35mm classic cinema",
      "50mm natural portrait",
      "85mm cinematic close-up",
    ],
    recommendedColorGrades: ["Filmic Warm Drama", "Natural Hollywood", "Soft Teal Orange"],
    styleMode: "photoreal_cinematic",
    promptInjection:
      "ARRI Alexa 35 Inspired Look, super 35 filmic rendering, organic skin tones, premium cinema latitude.",
  },
  {
    id: "arri_alexa_mini_lf",
    name: "ARRI Alexa Mini LF",
    lookPreset: "ARRI Alexa Mini LF Inspired Look",
    sensorDescription: "Large format sensor — premium depth, elegant rolloff",
    bestFor: ["premium ads", "fashion", "epic drama"],
    recommendedLensPacks: [
      "arri_signature_prime",
      "panavision_epic_anamorphic",
      "leica_luxury_portrait",
    ],
    recommendedFocalLengths: [
      "35mm classic cinema",
      "50mm natural portrait",
      "65mm compressed portrait",
    ],
    recommendedColorGrades: ["Premium Large Format", "Luxury Commercial", "Epic Fantasy"],
    styleMode: "photoreal_cinematic",
    promptInjection:
      "ARRI Alexa Mini LF Inspired Look, large format sensor depth, premium cinema highlight rolloff.",
  },
  {
    id: "red_v_raptor",
    name: "RED V-Raptor",
    lookPreset: "RED V-Raptor Inspired Look",
    sensorDescription: "VV sensor — clean modern detail, high contrast",
    bestFor: ["sci-fi", "thriller", "action"],
    recommendedLensPacks: [
      "zeiss_sharp_cinema",
      "sigma_cine_clean",
      "panavision_epic_anamorphic",
    ],
    recommendedFocalLengths: [
      "24mm wide natural",
      "35mm classic cinema",
      "85mm cinematic close-up",
    ],
    recommendedColorGrades: ["High Contrast Action", "Modern Sci-Fi", "Cyberpunk Neon"],
    styleMode: "photoreal_cinematic",
    promptInjection:
      "RED V-Raptor Inspired Look, clean modern digital cinema detail, sharp high-contrast rendering.",
  },
  {
    id: "sony_venice_2",
    name: "Sony Venice 2",
    lookPreset: "Sony Venice 2 Inspired Look",
    sensorDescription: "Dual base ISO sensor — clean low-light, premium digital cinema",
    bestFor: ["music videos", "neon night", "premium digital"],
    recommendedLensPacks: [
      "panavision_epic_anamorphic",
      "leica_luxury_portrait",
      "sigma_cine_clean",
    ],
    recommendedFocalLengths: [
      "35mm classic cinema",
      "50mm natural portrait",
      "85mm cinematic close-up",
    ],
    recommendedColorGrades: ["Neon Night", "Clean Premium Digital", "Music Video Glow"],
    styleMode: "photoreal_cinematic",
    promptInjection:
      "Sony Venice 2 Inspired Look, dual-base ISO clean rendering, premium digital cinema with low-light fidelity.",
  },
  {
    id: "canon_c500_mark_ii",
    name: "Canon C500 Mark II",
    lookPreset: "Canon C500 Mark II Inspired Look",
    sensorDescription: "Full-frame CMOS — natural color science, documentary-friendly",
    bestFor: ["documentary", "travel", "human stories"],
    recommendedLensPacks: [
      "canon_cne_natural",
      "cooke_warm_cinema",
      "angenieux_zoom_documentary",
    ],
    recommendedFocalLengths: [
      "28mm documentary",
      "35mm classic cinema",
      "50mm natural portrait",
    ],
    recommendedColorGrades: ["Documentary Natural", "Warm Human Story", "Travel Film"],
    styleMode: "photoreal_cinematic",
    promptInjection:
      "Canon C500 Mark II Inspired Look, natural color science, smooth skin tones, documentary-friendly cinema feel.",
  },
  {
    id: "blackmagic_pocket_6k",
    name: "Blackmagic Pocket 6K",
    lookPreset: "Blackmagic Pocket 6K Inspired Look",
    sensorDescription: "Super 35 sensor — indie film texture, raw cinematic feel",
    bestFor: ["indie film", "music videos", "urban shorts"],
    recommendedLensPacks: [
      "vintage_soviet_lens",
      "canon_cne_natural",
      "sigma_cine_clean",
    ],
    recommendedFocalLengths: [
      "24mm wide natural",
      "35mm classic cinema",
      "50mm natural portrait",
    ],
    recommendedColorGrades: ["Indie Film", "Urban Music Video", "Raw Cinematic"],
    styleMode: "photoreal_cinematic",
    promptInjection:
      "Blackmagic Pocket 6K Inspired Look, indie film texture, raw cinematic rendering, super 35 character.",
  },
  {
    id: "generic_anime_virtual_camera",
    name: "Anime Virtual Camera",
    lookPreset: "2D Anime Virtual Camera",
    sensorDescription: "Hand-crafted 2D anime camera — cel-shaded animation style",
    bestFor: ["anime", "cel-shaded", "key art"],
    recommendedLensPacks: [
      "anime_hero_frame",
      "anime_closeup_frame",
      "anime_speed_perspective",
    ],
    recommendedFocalLengths: [
      "anime wide hero frame",
      "anime emotional close-up",
      "anime extreme perspective",
    ],
    recommendedColorGrades: ["Anime Vibrant", "Anime Soft Pastel", "Anime Dark Action"],
    styleMode: "anime_2d",
    promptInjection:
      "hand-crafted 2D anime virtual camera, cel-shaded animation, painted background, hand-drawn line quality, anime film aesthetic.",
  },
  {
    id: "generic_pixel_art_camera",
    name: "Pixel Art Camera",
    lookPreset: "Pixel Art Virtual Camera",
    sensorDescription: "Crisp pixel grid — limited palette, hand-pixeled detail",
    bestFor: ["retro games", "pixel art scenes"],
    recommendedLensPacks: ["pixel_side_scroller", "pixel_isometric", "pixel_top_down"],
    recommendedFocalLengths: [
      "side-scroller wide",
      "isometric frame",
      "top-down pixel view",
    ],
    recommendedColorGrades: ["Retro Arcade", "Limited Palette", "Pixel Night"],
    styleMode: "pixel_art",
    promptInjection:
      "pixel art virtual camera, crisp pixel grid, limited palette, hand-pixeled detail, no anti-aliasing, retro game aesthetic.",
  },
  {
    id: "generic_3d_cgi_camera",
    name: "3D CGI Camera",
    lookPreset: "3D CGI Virtual Camera",
    sensorDescription: "Virtual rigged camera — animated film polish, global illumination",
    bestFor: ["3D animation", "stylized CGI", "game cinematics"],
    recommendedLensPacks: [
      "virtual_35mm_cgi",
      "virtual_50mm_character",
      "virtual_wide_hero",
    ],
    recommendedFocalLengths: [
      "35mm virtual camera",
      "50mm character close-up",
      "wide hero lens",
    ],
    recommendedColorGrades: ["Pixar Warm", "Game Cinematic", "Fantasy CGI"],
    styleMode: "cgi_3d",
    promptInjection:
      "stylized 3D CGI virtual camera, animated film polish, global illumination, smooth subsurface skin, premium animated film aesthetic.",
  },
];

export const CAMERA_BODY_BY_ID: Record<string, CameraBody> = Object.fromEntries(
  CAMERA_BODIES.map((c) => [c.id, c]),
);
