import type { ShotRecipe } from "./types";

/**
 * Built-in Shot Recipe Library. User-saved custom recipes live in
 * localStorage (see ./storage.ts) and are merged with these at read
 * time.
 */
export const BUILTIN_SHOT_RECIPES: ShotRecipe[] = [
  {
    id: "hero_entry",
    name: "Hero Entry",
    description: "Powerful protagonist reveal",
    cameraAngle: "Low Angle",
    shotSize: "Medium Wide Shot",
    lens: "35mm anamorphic",
    lighting: "backlit rim light with atmospheric haze",
    composition: "center hero composition",
    promptBoost:
      "heroic entrance, strong silhouette, cinematic low angle, dramatic atmosphere",
    tags: ["hero", "drama", "epic"],
  },
  {
    id: "villain_reveal",
    name: "Villain Reveal",
    cameraAngle: "Low Angle",
    shotSize: "Close-Up",
    lens: "50mm vintage lens",
    lighting: "hard side light, deep shadows",
    composition: "negative space and shadow framing",
    promptBoost:
      "ominous villain reveal, half-lit face, slow dread, powerful presence",
    tags: ["villain", "drama", "dark"],
  },
  {
    id: "rainy_noir_closeup",
    name: "Rainy Noir Close-Up",
    cameraAngle: "Eye Level",
    shotSize: "Medium Close-Up",
    lens: "85mm cinematic close-up",
    lighting: "neon rim light and wet reflections",
    composition: "foreground rain streaks",
    promptBoost:
      "rainy noir street, wet reflections, moody close-up, cinematic loneliness",
    tags: ["noir", "moody", "rain"],
  },
  {
    id: "anime_power_up",
    name: "Anime Power-Up",
    cameraAngle: "Low Angle",
    shotSize: "Full Shot",
    lens: "anime extreme perspective",
    lighting: "glowing aura and speed lines",
    composition: "dynamic diagonal pose",
    promptBoost:
      "hand-crafted 2D anime power-up, cel shading, energy aura, dynamic key pose",
    tags: ["anime", "action"],
  },
  {
    id: "final_boss_frame",
    name: "Final Boss Frame",
    cameraAngle: "Worm's Eye",
    shotSize: "Wide Shot",
    lens: "wide dramatic",
    lighting: "storm backlight and smoke",
    composition: "huge scale silhouette",
    promptBoost:
      "massive final boss presence, epic scale, dramatic storm, cinematic threat",
    tags: ["epic", "fantasy", "villain"],
  },
  {
    id: "detective_interrogation",
    name: "Detective Interrogation",
    cameraAngle: "Eye Level",
    shotSize: "Over The Shoulder",
    lens: "50mm natural portrait",
    lighting: "single overhead practical light",
    composition: "table foreground, dark background",
    promptBoost:
      "tense interrogation room, noir shadows, psychological drama",
    tags: ["noir", "drama", "thriller"],
  },
  {
    id: "luxury_product_shot",
    name: "Luxury Product Shot",
    cameraAngle: "Low Angle",
    shotSize: "Product Beauty Shot",
    lens: "100mm macro/detail",
    lighting: "studio product lighting with controlled reflections",
    composition: "premium center composition",
    promptBoost:
      "luxury product photography, premium reflections, clean background, sharp product edges",
    tags: ["product", "commercial", "luxury"],
  },
  {
    id: "romantic_golden_hour",
    name: "Romantic Golden Hour",
    cameraAngle: "Eye Level",
    shotSize: "Medium Close-Up",
    lens: "50mm portrait",
    lighting: "soft golden hour backlight",
    composition: "warm foreground bokeh",
    promptBoost:
      "romantic warm golden hour, soft glow, emotional expression, gentle film look",
    tags: ["romance", "warm", "drama"],
  },
  {
    id: "horror_hallway",
    name: "Horror Hallway",
    cameraAngle: "Dutch Angle",
    shotSize: "Wide Shot",
    lens: "24mm wide natural",
    lighting: "cold moonlight and flickering practical",
    composition: "deep hallway leading lines",
    promptBoost:
      "haunted hallway, unsettling negative space, cold shadows, slow dread",
    tags: ["horror", "moody"],
  },
  {
    id: "cyberpunk_street",
    name: "Cyberpunk Street",
    cameraAngle: "Ground Level",
    shotSize: "Wide Shot",
    lens: "35mm anamorphic",
    lighting: "magenta cyan neon",
    composition: "wet reflective street leading lines",
    promptBoost:
      "cyberpunk neon street, wet reflections, holographic signs, dark futuristic city",
    tags: ["cyberpunk", "neon", "sci-fi"],
  },
  {
    id: "epic_battlefield",
    name: "Epic Battlefield",
    cameraAngle: "Crane Height",
    shotSize: "Extreme Wide Shot",
    lens: "18mm cinematic wide",
    lighting: "dusty sunset backlight",
    composition: "layered armies and smoke",
    promptBoost:
      "epic battlefield scale, dust, banners, dramatic sunset, cinematic war frame",
    tags: ["epic", "fantasy", "war"],
  },
  {
    id: "god_ray_temple",
    name: "God Ray Temple Shot",
    cameraAngle: "Low Angle",
    shotSize: "Wide Shot",
    lens: "24mm wide natural",
    lighting: "volumetric god rays",
    composition: "temple pillars as foreground frame",
    promptBoost:
      "ancient temple interior, volumetric god rays, sacred atmosphere, mystical cinematic frame",
    tags: ["fantasy", "epic", "atmospheric"],
  },
  {
    id: "music_video_performance",
    name: "Music Video Performance",
    cameraAngle: "Low Angle",
    shotSize: "Medium Shot",
    lens: "24mm wide energetic",
    lighting: "stage lights and colored haze",
    composition: "dynamic diagonal framing",
    promptBoost:
      "high-energy music video performance, colored lights, haze, cinematic stage presence",
    tags: ["music", "energy"],
  },
  {
    id: "fashion_editorial",
    name: "Fashion Editorial",
    cameraAngle: "Eye Level",
    shotSize: "Full Shot",
    lens: "85mm portrait",
    lighting: "soft beauty light",
    composition: "minimal premium background",
    promptBoost:
      "fashion editorial pose, premium styling, clean luxury composition, refined lighting",
    tags: ["fashion", "luxury"],
  },
  {
    id: "car_commercial",
    name: "Car Commercial Shot",
    cameraAngle: "Low Angle",
    shotSize: "Hero Product Shot",
    lens: "35mm wide commercial",
    lighting: "sunset rim light and glossy reflections",
    composition: "road leading lines",
    promptBoost:
      "premium car commercial, glossy reflections, dynamic road, cinematic automotive hero frame",
    tags: ["commercial", "automotive", "product"],
  },
  {
    id: "food_macro",
    name: "Food Macro Shot",
    cameraAngle: "Macro Tabletop",
    shotSize: "Extreme Close-Up",
    lens: "100mm macro/detail",
    lighting: "soft studio key light",
    composition: "shallow depth food texture",
    promptBoost:
      "delicious food macro, steam, texture detail, premium commercial lighting",
    tags: ["food", "commercial", "macro"],
  },
  {
    id: "fantasy_portal_reveal",
    name: "Fantasy Portal Reveal",
    cameraAngle: "Wide Hero Angle",
    shotSize: "Wide Shot",
    lens: "24mm wide",
    lighting: "magical portal glow",
    composition: "portal centered with character silhouette",
    promptBoost:
      "fantasy portal opening, glowing magical light, character silhouette, epic mystical atmosphere",
    tags: ["fantasy", "epic", "magic"],
  },
  {
    id: "emotional_tear_closeup",
    name: "Emotional Tear Close-Up",
    cameraAngle: "Eye Level",
    shotSize: "Extreme Close-Up",
    lens: "85mm cinematic close-up",
    lighting: "soft side light",
    composition: "eyes and tear detail",
    promptBoost:
      "emotional tear close-up, subtle expression, cinematic shallow depth, intimate human moment",
    tags: ["drama", "emotional"],
  },
];

export function listAllRecipes(custom: ShotRecipe[]): ShotRecipe[] {
  return [...BUILTIN_SHOT_RECIPES, ...custom];
}

export function recipeById(
  id: string,
  custom: ShotRecipe[] = [],
): ShotRecipe | undefined {
  return listAllRecipes(custom).find((r) => r.id === id);
}
