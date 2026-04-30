/**
 * Cinema Image Studio — shared types.
 *
 * The Cinema Image Studio is a standalone "AI cinematography control room"
 * inside ContentStudio AI. The user picks a camera body, lens pack, shot
 * recipe, reference strength sliders, generation controls and output
 * controls; the Studio assembles a structured prompt JSON
 * (`buildCinemaPrompt`) that is sent to the backend to generate an image
 * via Gemini 2.5 Flash Image (a.k.a. "nano-banana-2" in user-facing copy).
 *
 * IMPORTANT: most of these IDs and label strings are user-visible. Renames
 * here are renames in the UI.
 */

export type StyleMode =
  | "photoreal_cinematic"
  | "anime_2d"
  | "pixel_art"
  | "cgi_3d"
  | "commercial_product";

export interface LensPack {
  id: string;
  name: string;
  look: string;
  bestFor: string[];
  promptInjection: string;
}

export interface CameraBody {
  id: string;
  name: string;
  /** User-facing "Inspired Look" label (trademark-safe). */
  lookPreset: string;
  sensorDescription: string;
  bestFor: string[];
  /** IDs from `LENS_PACKS`. */
  recommendedLensPacks: string[];
  recommendedFocalLengths: string[];
  recommendedColorGrades: string[];
  /** Style mode this camera belongs to (drives the style translation layer). */
  styleMode: StyleMode;
  /** Prompt fragment injected into the final image prompt. */
  promptInjection: string;
  /** Optional PNG path under `/public/assets/cinema/camera-previews/`. */
  previewImage?: string;
}

export interface ShotRecipe {
  id: string;
  name: string;
  description?: string;
  cameraAngle: string;
  shotSize: string;
  /** Free-text lens hint — may map to a focal length OR a lens pack vibe. */
  lens: string;
  lighting: string;
  composition: string;
  promptBoost: string;
  /** Tags for search/filter (mood / genre / style). */
  tags?: string[];
  /** True when authored by the user (saved to localStorage). */
  custom?: boolean;
}

export interface ReferenceStrengthSliders {
  faceLock: number;
  outfitLock: number;
  poseLock: number;
  styleLock: number;
  locationLock: number;
  lightingLock: number;
  productShapeLock: number;
  compositionLock: number;
}

export const DEFAULT_REFERENCE_STRENGTH: ReferenceStrengthSliders = {
  faceLock: 85,
  outfitLock: 80,
  poseLock: 60,
  styleLock: 75,
  locationLock: 70,
  lightingLock: 65,
  productShapeLock: 90,
  compositionLock: 60,
};

export interface GenerationControls {
  /** -1 means "let model pick" (only used when randomSeed=false). */
  seed: number;
  randomSeed: boolean;
  variationStrength: number;
  creativeFreedom: number;
  promptAdherence: number;
  realismStrength: number;
  styleStrength: number;
  detailLevel: number;
  compositionStrictness: number;
}

export const DEFAULT_GENERATION_CONTROLS: GenerationControls = {
  seed: -1,
  randomSeed: true,
  variationStrength: 35,
  creativeFreedom: 45,
  promptAdherence: 75,
  realismStrength: 80,
  styleStrength: 75,
  detailLevel: 80,
  compositionStrictness: 65,
};

/** All output-aspect-ratio options shown in the Output panel. */
export const OUTPUT_ASPECT_RATIOS = [
  { value: "16:9", label: "16:9 Cinematic Landscape" },
  { value: "9:16", label: "9:16 Vertical Reels/Shorts" },
  { value: "1:1", label: "1:1 Square" },
  { value: "4:5", label: "4:5 Instagram Portrait" },
  { value: "3:4", label: "3:4 Portrait" },
  { value: "21:9", label: "21:9 Ultra Wide Cinema" },
  { value: "2.39:1", label: "2.39:1 Anamorphic Cinema" },
  { value: "4:3", label: "4:3 Classic Film" },
  { value: "3:2", label: "3:2 Photography" },
] as const;

export type OutputAspectRatio = (typeof OUTPUT_ASPECT_RATIOS)[number]["value"];

export const RESOLUTIONS = ["standard", "high", "ultra"] as const;
export type Resolution = (typeof RESOLUTIONS)[number];

export const FORMATS = ["png", "jpg", "webp"] as const;
export type ImageFormat = (typeof FORMATS)[number];

export interface OutputControls {
  aspectRatio: OutputAspectRatio;
  resolution: Resolution;
  imageCount: 1 | 2 | 4;
  format: ImageFormat;
}

export const DEFAULT_OUTPUT_CONTROLS: OutputControls = {
  aspectRatio: "16:9",
  resolution: "high",
  imageCount: 1,
  format: "png",
};

export interface CinemaReferenceUpload {
  id: string;
  /** "/objects/uploads/<id>" */
  objectPath: string;
  mimeType: string;
  /** User-facing label, e.g. "Hero face ref" or "Wardrobe ref". */
  label?: string;
}

export interface CinemaState {
  rawPrompt: string;
  styleMode: StyleMode;
  cameraBodyId: string | null;
  lensPackId: string | null;
  focalLength: string;
  aperture: string;
  shotRecipeId: string | null;
  referenceStrength: ReferenceStrengthSliders;
  generationControls: GenerationControls;
  outputControls: OutputControls;
  references: CinemaReferenceUpload[];
  negativePrompt: string[];
}

export const DEFAULT_CINEMA_STATE: CinemaState = {
  rawPrompt: "",
  styleMode: "photoreal_cinematic",
  cameraBodyId: null,
  lensPackId: null,
  focalLength: "35mm classic cinema",
  aperture: "f/2.8",
  shotRecipeId: null,
  referenceStrength: DEFAULT_REFERENCE_STRENGTH,
  generationControls: DEFAULT_GENERATION_CONTROLS,
  outputControls: DEFAULT_OUTPUT_CONTROLS,
  references: [],
  negativePrompt: [],
};

export interface PromptScore {
  overallPromptScore: number;
  cinematicScore: number;
  cameraClarityScore: number;
  lensClarityScore: number;
  lightingScore: number;
  styleConsistencyScore: number;
  characterConsistencyScore: number;
  compositionScore: number;
  promptRiskScore: number;
  missingDetails: string[];
  improvementSuggestions: string[];
  improvedPrompt: string;
}

export interface CinemaResultImage {
  objectPath: string;
  mimeType: string;
  generatedAt: string;
  seed: number;
  finalPrompt: string;
}
