/**
 * Hinglish phonetic optimizer + structured audio-spec builder.
 *
 * Per the pipeline-fix doc:
 *   "Seedance / Veo mispronounce Hindi-romanized words. Insert
 *    syllable breaks, mark dramatic pauses, and prepend an English
 *    calibration phrase so the TTS engine warms up on familiar
 *    phonemes before hitting Hindi."
 *
 * `applyHinglishPhonetics(text)` is intentionally idempotent: running
 * it twice on the same input must NOT double-hyphenate (the regex set
 * uses lookahead-free word boundaries that only match unsyllabized
 * forms). We rely on lowercase comparison + the original token spelling
 * being lowercase post-replacement to prevent re-matching.
 */

const HINGLISH_FIXES: Array<[RegExp, string]> = [
  // Common Hindi-romanized words → syllable-broken forms.
  [/\bkyunki\b/gi, "kyun-ki"],
  [/\bisliye\b/gi, "is-li-ye"],
  [/\blekin\b/gi, "le-kin"],
  [/\bbahut\b/gi, "ba-hut"],
  [/\bacha\b/gi, "a-cha"],
  [/\btheek\b/gi, "theek"],
  [/\bbilkul\b/gi, "bil-kul"],
  [/\bmatlab\b/gi, "mat-lab"],
  [/\bsamajh\b/gi, "sa-majh"],
  [/\bzindagi\b/gi, "zin-da-gi"],
  [/\bduniya\b/gi, "du-ni-ya"],
  [/\byahan\b/gi, "ya-han"],
  [/\bwahan\b/gi, "wa-han"],
  [/\bkaise\b/gi, "kai-se"],
  [/\btumhare\b/gi, "tum-ha-re"],
  [/\bhamara\b/gi, "ha-ma-ra"],
  [/\bchahiye\b/gi, "cha-hi-ye"],
  [/\bmilega\b/gi, "mi-le-ga"],
  [/\bbolna\b/gi, "bol-na"],
  [/\bsunna\b/gi, "sun-na"],
  [/\bdekhna\b/gi, "dekh-na"],
  [/\bjaana\b/gi, "jaa-na"],
  [/\baana\b/gi, "aa-na"],
  [/\bkarna\b/gi, "kar-na"],
  [/\bsochna\b/gi, "soch-na"],
  [/\babhi\b/gi, "ab-hi"],
  [/\bnahi\b/gi, "na-hi"],
];

/**
 * Apply Hinglish phonetic syllable breaks + dramatic pause markers +
 * an English calibration prepend. Returns the processed string ready
 * for Seedance / Veo voiceover. If `text` is empty / null the input
 * is returned unchanged.
 */
export function applyHinglishPhonetics(text: string | null | undefined): string {
  if (!text) return "";
  let processed = text;
  for (const [pattern, replacement] of HINGLISH_FIXES) {
    processed = processed.replace(pattern, replacement);
  }
  // Insert dramatic pause markers after sentence terminators so the
  // TTS engine gives the listener a beat to absorb.
  processed = processed
    .replace(/\.\s+/g, ". [pause] ")
    .replace(/!\s+/g, "! [pause] ");
  // English calibration prepend — gives the TTS warmup phonemes it
  // already knows so it doesn't fumble the first Hindi word.
  return `Ready. ${processed}`;
}

export interface AudioDirection {
  voiceoverText?: string | null;
  voiceoverTone?: string | null;
  voiceoverTiming?: string | null;
  /** Free-form music direction string from the storyboard. */
  musicDirection?: string | null;
  /** Either array of {sound,atSecond,...} or array of strings. */
  soundEffects?: Array<
    | string
    | {
        sound?: string;
        description?: string;
        atSecond?: number;
        durationSec?: number;
        volume?: number;
      }
  >;
}

export interface BuiltAudioSpec {
  voiceover: {
    text: string;
    language: string;
    tone: string;
    startAtSecond: number;
    pace: "slow" | "normal" | "fast";
  };
  soundEffects: Array<{
    description: string;
    startAtSecond: number;
    durationSeconds: number;
    volume: number;
  }>;
  backgroundMusic: {
    genre: string;
    bpm: number;
    instruments: string[];
    energy: number;
    fadeIn: boolean;
    fadeOut: boolean;
  };
}

const COMMON_INSTRUMENTS = [
  "strings",
  "piano",
  "guitar",
  "drums",
  "violin",
  "flute",
  "bass",
  "synth",
  "brass",
  "tabla",
  "sitar",
  "cello",
  "harp",
];

function extractInstruments(musicDirection: string | null | undefined): string[] {
  if (!musicDirection) return ["strings", "piano"];
  const lower = musicDirection.toLowerCase();
  const found = COMMON_INSTRUMENTS.filter((i) => lower.includes(i));
  return found.length > 0 ? found : ["strings", "piano"];
}

/**
 * Build the structured audio spec used inside the JSON video prompt
 * AND inside the Magnific `audio_config` request body. `targetEngine`
 * controls voiceover language code formatting:
 *   - "veo"      → "hi-IN" / "en-US"
 *   - "seedance" → "hi" / "en"
 */
export function buildAudioSpec(
  direction: AudioDirection,
  voiceoverLanguage: string | null | undefined,
  targetEngine: "veo" | "seedance",
): BuiltAudioSpec {
  const isHinglish = (voiceoverLanguage ?? "").toLowerCase() === "hinglish";
  const voText = isHinglish
    ? applyHinglishPhonetics(direction.voiceoverText ?? "")
    : direction.voiceoverText ?? "";

  const langCode = isHinglish
    ? targetEngine === "veo"
      ? "hi-IN"
      : "hi"
    : targetEngine === "veo"
      ? "en-US"
      : "en";

  const startMatch = direction.voiceoverTiming?.match(/(\d+\.?\d*)/);
  const startAt = startMatch ? parseFloat(startMatch[1]) : 0.3;

  const sfx = (direction.soundEffects ?? []).map((s, i) => {
    if (typeof s === "string") {
      return {
        description: s,
        startAtSecond: i * 2,
        durationSeconds: 1.5,
        volume: 0.6,
      };
    }
    return {
      description: s.description ?? s.sound ?? "",
      startAtSecond: typeof s.atSecond === "number" ? s.atSecond : i * 2,
      durationSeconds:
        typeof s.durationSec === "number" ? s.durationSec : 1.5,
      volume: typeof s.volume === "number" ? s.volume : 0.6,
    };
  });

  const md = direction.musicDirection ?? "";
  const bpmMatch = md.match(/(\d+)\s*bpm/i);
  const genre = md.split(",")[0]?.trim() || "cinematic";

  return {
    voiceover: {
      text: voText,
      language: langCode,
      tone: direction.voiceoverTone ?? "natural",
      startAtSecond: Number.isFinite(startAt) ? startAt : 0.3,
      pace: "normal",
    },
    soundEffects: sfx,
    backgroundMusic: {
      genre,
      bpm: bpmMatch ? parseInt(bpmMatch[1], 10) : 90,
      instruments: extractInstruments(md),
      energy: 0.7,
      fadeIn: true,
      fadeOut: false,
    },
  };
}
