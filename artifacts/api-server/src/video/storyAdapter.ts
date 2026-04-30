/**
 * Story adapter — converts a `StoryResponse` from the existing Story
 * Builder into the spec's normalized internal story structure that the
 * engine, storyboard generator, and JSON prompt engine consume.
 *
 * This is intentionally a deterministic mapping (no LLM call). The
 * Story Builder already produces rich character + act content; we just
 * unfold it into the per-character / per-location / per-beat shape the
 * spec mandates so downstream code reads from one canonical source.
 *
 * Beats come from acts: each act becomes one beat. If the Story Builder
 * gave us N acts, we get N beats; the chunk planner produces M parts,
 * and the storyboard engine maps beats to parts (M may be > N — beats
 * are reused across multiple parts in that case).
 */

import type { StoryResponse, VideoStudioJobRequest } from "@workspace/api-zod";
import type {
  NormalizedStory,
  NormalizedStoryCharacter,
  NormalizedStoryLocation,
  NormalizedStoryBeat,
} from "./types";

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32);
}

/**
 * Pull a coarse "location" string from an act's prose if present. This
 * is a best-effort heuristic — the JSON prompt engine will refine it
 * per-part with the real story context. We just need *something*
 * non-empty so the visual bible has at least one location to lock.
 */
function inferLocationFromActs(
  acts: StoryResponse["acts"],
): { name: string; description: string } {
  const text = acts
    .map((a) => `${a.title}. ${a.description}. ${a.keyMoment}`)
    .join(" ");
  // Very simple: take the first noun-phrase-ish chunk before a comma /
  // period from the description of act 1 as the canonical location.
  const first = acts[0]?.description ?? "";
  const cut = first.split(/[.,;]/)[0]?.trim() ?? "";
  return {
    name: cut.length > 0 ? cut.slice(0, 80) : "Primary location",
    description:
      first.length > 0
        ? first
        : text.slice(0, 240) || "A cinematic environment matching the story's tone.",
  };
}

export function normalizeStoryForVideo(args: {
  jobId: string;
  story: StoryResponse;
  request: VideoStudioJobRequest;
}): NormalizedStory {
  const { jobId, story, request } = args;

  const characters: NormalizedStoryCharacter[] = story.characters.map(
    (c, i) => {
      const id = `char_${i + 1}_${slugify(c.name)}`;
      // The Story Builder packs all visual + behavioural detail into
      // `c.description` — we surface it across the spec's slots so the
      // JSON prompt engine sees rich text in every field rather than
      // empty strings.
      return {
        id,
        name: c.name,
        age: c.description,
        gender: c.description,
        face: c.description,
        hair: c.description,
        body: c.description,
        outfit: c.description,
        accessories: c.description,
        personality: c.description,
        voiceTone: c.description,
        continuityLock: `${c.name} must look identical in every part: same face, same outfit, same hair, same age, same body proportions. Source: ${c.description}`,
      };
    },
  );

  const inferred = inferLocationFromActs(story.acts);
  const locations: NormalizedStoryLocation[] = [
    {
      id: "loc_1_primary",
      name: inferred.name,
      description: inferred.description,
      lighting: story.mood ?? "cinematic",
      mood: story.mood ?? "cinematic",
      continuityLock: `Primary location must remain consistent across parts unless story explicitly cuts. Lighting & mood: ${story.mood ?? "cinematic"}.`,
    },
  ];

  const storyBeats: NormalizedStoryBeat[] = story.acts.map((a) => ({
    beatNumber: a.actNumber,
    summary: `${a.title} — ${a.description}. Key moment: ${a.keyMoment}`,
    characters: characters.map((c) => c.id),
    location: locations[0].id,
    emotionalPurpose: story.mood ?? "cinematic",
    visualPurpose: a.keyMoment,
  }));

  return {
    storyId: jobId,
    title: story.title,
    logline: story.synopsis,
    genre: "cinematic",
    visualStyle: "cinematic",
    language:
      request.voiceoverLanguage ??
      (request.voiceoverEnabled ? "english" : "english"),
    voiceoverTone: story.mood ?? "cinematic",
    bgmStyle: story.musicSuggestion ?? "cinematic orchestral",
    characters,
    locations,
    storyBeats,
  };
}
