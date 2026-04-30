import type { ShotRecipe } from "./types";

/**
 * localStorage persistence for user-authored Shot Recipes.
 *
 * Built-in recipes ship in code; custom ones live here. We don't put
 * these on the server because they're per-device personalisation.
 */
const KEY = "cs_cinema_custom_recipes";

function safeRead(): ShotRecipe[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (r): r is ShotRecipe =>
        typeof r === "object" &&
        r !== null &&
        typeof (r as ShotRecipe).id === "string" &&
        typeof (r as ShotRecipe).name === "string",
    );
  } catch {
    return [];
  }
}

function safeWrite(recipes: ShotRecipe[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(recipes));
  } catch {
    // Quota errors here are non-fatal — user just loses the new custom recipe.
  }
}

export const customRecipeStorage = {
  list(): ShotRecipe[] {
    return safeRead();
  },
  save(recipe: ShotRecipe): ShotRecipe[] {
    const list = safeRead();
    const idx = list.findIndex((r) => r.id === recipe.id);
    if (idx >= 0) list[idx] = recipe;
    else list.push(recipe);
    safeWrite(list);
    return list;
  },
  remove(id: string): ShotRecipe[] {
    const list = safeRead().filter((r) => r.id !== id);
    safeWrite(list);
    return list;
  },
};
