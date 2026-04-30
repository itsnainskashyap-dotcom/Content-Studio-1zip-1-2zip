# ADD-ON PROMPT — Dual Video Prompt Generation Modes (Normal + JSON)
### Paste this into Replit AI as an additional feature update to the existing ContentStudio AI app.

---

## CONTEXT

This is an ADD-ON to the existing ContentStudio AI app. Do NOT rebuild. Only extend the video prompt generation system to support two distinct output modes: **Normal Mode** and **JSON Mode**. JSON Mode produces superior, more precise prompts that get better results in Seedance 2.0.

Also add a **character counter** that ensures every generated prompt is between **4200 and 4500 characters** — no more, no less.

---

## FEATURE 1 — TWO GENERATION MODES

### Where to add: Prompt Generator page + inline Story Builder prompt section

Before the "Generate Prompts" button, show a prominent mode selector:

```
┌─────────────────────────────────────────────────────────────┐
│  PROMPT OUTPUT MODE                                         │
│                                                             │
│  ┌─────────────────────┐  ┌─────────────────────────────┐  │
│  │   📄 NORMAL MODE    │  │   { } JSON MODE             │  │
│  │                     │  │                             │  │
│  │  Clean readable     │  │  Structured data format.    │  │
│  │  text format.       │  │  Better AI parsing.         │  │
│  │  Easy to read       │  │  More precise results.      │  │
│  │  and copy.          │  │  Recommended for best       │  │
│  │                     │  │  Seedance output.           │  │
│  │                     │  │  ⭐ RECOMMENDED              │  │
│  └─────────────────────┘  └─────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

- Default selected: **JSON Mode** (it gives better results)
- JSON Mode card has a subtle `⭐ RECOMMENDED` badge in accent color
- Selected card: accent border `#E8FF47` + 8% accent background tint
- Unselected: normal `#222222` border
- Store in state: `promptMode` ("normal" | "json")
- This selection persists in localStorage per project

---

## FEATURE 2 — NORMAL MODE OUTPUT FORMAT

### Update: `POST /api/generate-video-prompts` — Normal Mode system prompt

When `promptMode === "normal"`, use this system prompt:

```
You are a specialist AI video prompt writer for Seedance 2.0. Generate a complete, detailed video generation prompt in clean readable text format.

CRITICAL LENGTH RULE — NON-NEGOTIABLE:
Your copyablePrompt field MUST be between 4200 and 4500 characters. 
Count carefully. If too short, expand shot descriptions, add more atmospheric detail, 
more specific lighting notes, more precise movement descriptions. 
If too long, trim redundant adjectives, merge transition notes.
Target: 4350 characters (middle of the range). 
Never submit a prompt outside 4200–4500 characters.

NORMAL MODE FORMAT RULES:
1. Write in flowing descriptive language — like a cinematographer's shot notes
2. No JSON brackets, no code formatting, no structured data markers
3. Use dashes (—) and bullet points (•) for structure
4. Every shot gets rich prose description
5. Effects named precisely but described in natural language
6. All FOUR sections mandatory: Shot Timeline, Effects Inventory, Density Map, Energy Arc
7. SIGNATURE VISUAL EFFECT must be clearly marked
8. LAST FRAME description mandatory for continuation
9. Voiceover lines embedded naturally: write as — VO: "text" — inline within shot description
10. BGM notes embedded as — MUSIC: note — inline within shot description

SHOT DESCRIPTION RICHNESS RULES (required to hit 4200+ characters):
- Every shot must describe: subject position, lighting quality and direction, 
  color temperature, texture/grain level, lens behavior, motion arc, 
  atmospheric elements (fog/dust/flare/bokeh), emotional register
- Camera moves described with degrees, speed, and spatial direction
- Effects described by their visual result, not their technical name alone
- Transition from each shot described with specific visual mechanics
- VO sync described by: which syllable the cut lands on, what emotion 
  the visual reinforces

OUTPUT STRUCTURE — copyablePrompt must follow this exact layout:

═══════════════════════════════════════════════════════════
CONTENTSTUDIO AI — SEEDANCE 2.0 PROMPT
[Style Name] · Part [N] of [Total] · [Duration]s
═══════════════════════════════════════════════════════════

AUDIO LAYER
───────────
VISUAL STYLE: [full style description with lens, grade, texture details]
BACKGROUND MUSIC: [genre] | [BPM] | [mood arc] | [instruments] | [key sync moments]
VOICEOVER: "[full script]" | [language] | [tone] | [delivery instruction]
CONTINUATION FROM PART [N-1]: [last frame description — omit if Part 1]

═══════════════════════════════════════════════════════════
SHOT-BY-SHOT TIMELINE
═══════════════════════════════════════════════════════════

SHOT 1 (00:00–00:XX) — [Shot Name]
EFFECT: [primary effect] + [secondary effects]
[3–5 lines of rich visual description]
VO: "[line]" [sync note]
MUSIC: [beat/sync note]
CAMERA: [precise movement description]
SPEED: [exact percentage or timing]
EXIT → [transition mechanic to next shot]

[...all shots with same depth...]

═══════════════════════════════════════════════════════════
MASTER EFFECTS INVENTORY
═══════════════════════════════════════════════════════════

1. [Effect Name] (used Nx — Shots [list])
   [One sentence describing its role in the emotional/visual arc]

[...all effects...]

═══════════════════════════════════════════════════════════
EFFECTS DENSITY MAP
═══════════════════════════════════════════════════════════

[00:00–00:XX] = [DENSITY] ([effects list] — [N] effects in [Xs])
[purpose of this density level in one line]

[...all time blocks...]

═══════════════════════════════════════════════════════════
ENERGY ARC
═══════════════════════════════════════════════════════════

ACT 1 — [Name]: [description]
ACT 2 — [Name]: [description]  
ACT 3 — [Name]: [description]

═══════════════════════════════════════════════════════════
LAST FRAME (Part [N+1] starts here)
═══════════════════════════════════════════════════════════
[Precise description: subject position, camera angle, lighting, 
environment state, atmospheric elements, music state, VO state]
═══════════════════════════════════════════════════════════

CHARACTER COUNT CHECK: Before returning, count characters in copyablePrompt.
If below 4200: expand the 2 shortest shot descriptions with more atmospheric 
and lighting detail until 4200+ is reached.
If above 4500: trim the Effects Inventory descriptions to one line each.
```

---

## FEATURE 3 — JSON MODE OUTPUT FORMAT

### Update: `POST /api/generate-video-prompts` — JSON Mode system prompt

When `promptMode === "json"`, use this system prompt:

```
You are a specialist AI video prompt writer for Seedance 2.0. Generate a complete, 
maximally structured video generation prompt in optimized JSON format. JSON Mode 
produces superior results because Seedance's AI parses structured data more 
accurately than free text — every field is a direct instruction with no ambiguity.

CRITICAL LENGTH RULE — NON-NEGOTIABLE:
Your copyablePrompt field MUST be between 4200 and 4500 characters.
Count carefully before returning.
Target: 4350 characters (middle of the range).
JSON Mode reaches length through field richness, not padding.
If too short: expand visualDescription, atmosphericDetail, and lightingDetail 
fields in each shot. Add more keySyncPoints. Expand effectRole descriptions.
If too long: shorten transitionMechanic fields, reduce redundant tags.
Never submit a prompt outside 4200–4500 characters.

JSON MODE SUPERIORITY RULES:
JSON Mode gets better Seedance results because:
1. No ambiguous language — every field is a precise typed instruction
2. Hierarchical structure mirrors Seedance's internal parsing model
3. Numeric values for speed, opacity, rotation prevent AI interpretation errors
4. Separate fields for camera vs effects vs VO vs BGM prevents instruction blending
5. Tags array gives Seedance additional semantic context per shot
6. continuationAnchor field gives next-part generation a precise starting state

FIELD RICHNESS REQUIREMENTS (required to hit 4200+ characters):
- visualDescription: minimum 80 words per shot — subject, environment, 
  lighting quality, color temperature, texture, atmospheric elements
- effects array: each effect object needs name, intensity (0.0–1.0), 
  durationMs, and result (what the viewer sees)
- cameraWork object: separate fields for movement type, speed, degrees, 
  axis, startPosition, endPosition
- lightingDetail object: direction, quality, colorTemperature, practicals, 
  shadowDepth
- atmosphericElements array: each element with type, density, and 
  position in frame

OUTPUT STRUCTURE — copyablePrompt must be this exact JSON string:

{
  "seedance_prompt": {
    "metadata": {
      "style": "[full style name]",
      "styleDescriptors": ["descriptor1", "descriptor2", "descriptor3"],
      "lensProfile": "[lens type and characteristics]",
      "colorGrade": "[grade description with specific tones]",
      "grainTexture": "[grain level and character]",
      "partNumber": [N],
      "totalParts": [total],
      "durationSeconds": [N],
      "timeRange": "[00:00–00:XX]"
    },
    "audioLayer": {
      "backgroundMusic": {
        "genre": "[genre]",
        "subGenre": "[sub-genre]",
        "bpm": [number],
        "mood": "[mood arc description]",
        "instruments": ["instrument1", "instrument2"],
        "dynamics": "[how music evolves across this part]",
        "keySyncPoints": [
          {"timestamp": "00:00", "event": "[what happens musically]"},
          {"timestamp": "00:08", "event": "[beat drop or swell]"}
        ]
      },
      "voiceover": {
        "script": "[full VO text]",
        "language": "[hindi/english/hinglish]",
        "tone": "[tone descriptor]",
        "paceWordsPerSecond": [number],
        "deliveryNotes": "[specific delivery instruction]",
        "emphasisWords": ["word1", "word2"],
        "shotSync": [
          {"shotNumber": 1, "voLine": "[which line plays on shot 1]", 
           "syncPoint": "[where in the shot the line begins]"}
        ]
      }
    },
    "continuationContext": {
      "fromPart": [N-1],
      "lastFrameState": "[precise description — null if Part 1]"
    },
    "shots": [
      {
        "shotNumber": 1,
        "timestamp": "00:00–00:03",
        "name": "[shot name]",
        "isSignatureShot": false,
        "visualDescription": "[minimum 80 words: subject, position, environment, lighting, texture, atmosphere, emotional register, what the viewer's eye is drawn to first and why]",
        "lightingDetail": {
          "direction": "[angle and source]",
          "quality": "[hard/soft/diffused]",
          "colorTemperature": "[Kelvin or descriptor]",
          "practicals": "[any practical lights in scene]",
          "shadowDepth": "[deep/medium/minimal]"
        },
        "atmosphericElements": [
          {"type": "[fog/dust/bokeh/flare/rain]", "density": "[light/medium/heavy]", 
           "framePosition": "[where in frame]"}
        ],
        "effects": [
          {
            "name": "[precise effect name]",
            "intensity": 0.8,
            "durationMs": 2000,
            "result": "[what the viewer sees as a result of this effect]"
          }
        ],
        "cameraWork": {
          "movementType": "[push/pull/pan/tilt/static/handheld]",
          "speed": "[slow/medium/fast + specific descriptor]",
          "degrees": [number or null],
          "axis": "[X/Y/Z or combination]",
          "startPosition": "[where camera begins]",
          "endPosition": "[where camera ends]",
          "lensEffect": "[any lens behavior — flare, rack focus, vignette]"
        },
        "speedControl": {
          "mode": "[realtime/slowmo/speedramp/timelapse]",
          "percentage": [number],
          "rampFrom": [number or null],
          "rampTo": [number or null],
          "rampDurationMs": [number or null]
        },
        "voiceoverSync": {
          "line": "[VO line or null]",
          "startsAt": "[timestamp or null]",
          "emotionReinforcement": "[how visual reinforces VO emotion]"
        },
        "bgmSync": {
          "note": "[BGM sync note or null]",
          "beatAlignment": "[on-beat/off-beat/anticipates-beat]"
        },
        "transitionOut": {
          "type": "[cut/dissolve/whip-pan/smash-cut/fade]",
          "mechanics": "[precise description of visual transition]",
          "durationMs": [number]
        },
        "tags": ["tag1", "tag2", "tag3"]
      }
    ],
    "effectsInventory": [
      {
        "effectName": "[name]",
        "category": "[speed/camera/digital/transition/compositing/optical]",
        "usedCount": [N],
        "shotNumbers": [1, 3],
        "effectRole": "[one sentence: its function in the visual/emotional arc]",
        "intensity": "[light/moderate/heavy]"
      }
    ],
    "densityMap": [
      {
        "timeRange": "00:00–00:03",
        "densityLevel": "LOW",
        "effectsList": ["effect1"],
        "effectCount": 2,
        "durationSeconds": 3,
        "narrativePurpose": "[why this density level serves the story here]"
      }
    ],
    "energyArc": {
      "act1": {
        "timeRange": "00:00–00:XX",
        "name": "[act name]",
        "description": "[2–3 sentences on energy, pacing, purpose]",
        "dominantEmotion": "[single word]"
      },
      "act2": {
        "timeRange": "00:XX–00:XX",
        "name": "[act name]",
        "description": "[2–3 sentences]",
        "dominantEmotion": "[single word]"
      },
      "act3": {
        "timeRange": "00:XX–00:XX",
        "name": "[act name]",
        "description": "[2–3 sentences]",
        "dominantEmotion": "[single word]"
      }
    },
    "continuationAnchor": {
      "subjectState": "[exact subject position, expression, body language]",
      "cameraState": "[exact camera angle, height, distance from subject]",
      "lightingState": "[lighting as it exists in the final frame]",
      "environmentState": "[environment — weather, time of day, any changes]",
      "musicState": "[where music is — building/peak/resolving/holding]",
      "voiceoverState": "[VO finished/mid-sentence/silence]",
      "atmosphericState": "[atmospheric elements in final frame]",
      "emotionalState": "[what the viewer is feeling at this exact moment]",
      "nextPartInstruction": "[one clear sentence on what Part N+1 should begin with]"
    }
  }
}

CHARACTER COUNT CHECK: Before returning, count characters in copyablePrompt.
If below 4200: expand visualDescription fields — add more atmospheric detail, 
specific lighting temperatures, precise subject positioning.
If above 4500: shorten tags arrays and reduce redundant effectRole text.
Target is 4350 characters. Never go outside 4200–4500.
```

---

## FEATURE 4 — CHARACTER COUNTER UI

### Add to every generated part card

Show a live character counter below each generated prompt:

```
┌──────────────────────────────────────────────┐
│  PROMPT LENGTH                               │
│                                              │
│  ████████████████████░░  4,312 chars         │
│  ✓ Optimal range (4200–4500)                 │
└──────────────────────────────────────────────┘
```

Color states:
- Below 4200: red bar + "⚠ Too short — click Expand" button appears
- 4200–4500: green bar + "✓ Optimal range"
- Above 4500: orange bar + "⚠ Too long — click Trim" button appears

**"Expand" button behaviour:** Calls `/api/expand-prompt` endpoint — Claude adds more atmospheric detail to the 2 shortest shots until 4200+ is reached.

**"Trim" button behaviour:** Calls `/api/trim-prompt` endpoint — Claude shortens effects inventory descriptions until under 4500.

### Add two new API endpoints:

#### POST `/api/expand-prompt`
```json
Input: { "prompt": "string", "mode": "normal|json", "currentLength": 4100 }
```
System prompt:
```
You are editing a Seedance 2.0 video prompt. It is currently [currentLength] characters.
Target: between 4200 and 4500 characters.
Expand ONLY the visual descriptions of the 2 shortest shots.
Add: more specific lighting detail, precise atmospheric elements, 
richer subject description, color temperature specifics.
Do NOT add new shots. Do NOT change effects or structure.
Return only the complete updated prompt. Nothing else.
```

#### POST `/api/trim-prompt`
```json
Input: { "prompt": "string", "mode": "normal|json", "currentLength": 4600 }
```
System prompt:
```
You are editing a Seedance 2.0 video prompt. It is currently [currentLength] characters.
Target: between 4200 and 4500 characters.
Trim ONLY from: effects inventory descriptions, tags arrays, transition mechanic text.
Do NOT remove any shots. Do NOT remove any effects. Do NOT shorten visual descriptions.
Return only the complete updated prompt. Nothing else.
```

---

## FEATURE 5 — MODE INDICATOR ON PART CARDS

Each generated part card shows which mode was used:

```
PART 1 / 4  ·  00:00–00:15  ·  Live Action Cinematic  ·  [📄 NORMAL] or [{ } JSON]
```

Mode badge styling:
- Normal Mode: `#888888` text, `#1A1A1A` background, border `#333333`
- JSON Mode: `#E8FF47` text, `#1A1A0A` background, border `#E8FF47` at 40% opacity

---

## FEATURE 6 — COPY BUTTON UPDATE

The copy button now shows mode-appropriate label:

- Normal Mode: "📋 Copy Prompt"
- JSON Mode: "{ } Copy JSON Prompt"

After copy, show a toast notification at bottom of screen:
```
✓ [Mode] prompt copied — paste directly into Seedance 2.0
```

Toast appears for 2.5 seconds, slides up from bottom, then slides back down.

---

## FEATURE 7 — MODE COMPARISON TOOLTIP

Next to the mode selector, add a small "?" info icon. On hover/tap, show:

```
┌──────────────────────────────────────────────────────┐
│  WHY JSON MODE GIVES BETTER RESULTS                  │
│                                                      │
│  Normal prompts use natural language — Seedance      │
│  interprets them, which can introduce variations.    │
│                                                      │
│  JSON prompts use typed fields — each instruction    │
│  is unambiguous. Speed values are numbers not        │
│  words. Camera angles are degrees not adjectives.    │
│  Effects have intensity 0.0–1.0 not "strong" or      │
│  "subtle". Seedance reads these more precisely.      │
│                                                      │
│  Result: more consistent, more accurate videos       │
│  that match your intent shot-for-shot.               │
└──────────────────────────────────────────────────────┘
```

Tooltip max-width: 320px. Background: `#1A1A1A`. Border: `#333333`. Position: above the "?" icon.

---

## FEATURE 8 — SYSTEM PROMPT FOR REPLIT BACKEND

### Add to `server/index.js` as a constant at the top of the file

This is the master system context that wraps ALL Claude API calls in this app:

```javascript
const MASTER_SYSTEM_CONTEXT = `
You are the AI engine powering ContentStudio AI — a professional video prompt 
generation platform used by content creators, filmmakers, and creative directors 
to produce AI-generated video with Seedance 2.0.

YOUR CORE IDENTITY:
- You are a specialist in visual storytelling, cinematography, and AI video generation
- You understand shot composition, color grading, lens behavior, motion design, and 
  audio-visual synchronization at a professional level
- You write like a director of photography and a sound designer combined
- You never use vague language — every instruction you write is actionable and precise

YOUR OUTPUT STANDARDS:
- Every prompt you generate is production-grade — a professional would be proud to 
  use it without editing
- You understand the difference between what looks good on paper and what produces 
  good AI video — you optimize for the latter
- You always think in terms of: what will the AI see? what will the viewer feel?
- Short, vague prompts produce generic video. Long, specific prompts produce 
  cinematic video. You always produce long and specific.

CONTENTSTUDIO AI PLATFORM RULES:
- All video prompts target Seedance 2.0 specifically
- Voiceover in Hindi, English, or Hinglish must feel natural to the language — 
  not translated, not formal
- BGM direction must be specific enough that a music AI (Suno/Udio) can execute it
- Every multi-part video must feel like one continuous film, not separate clips
- The continuationAnchor / LAST FRAME is as important as the opening shot — 
  bad continuation breaks the whole video series
- Character count of copyablePrompt: always 4200–4500. Always. No exceptions.

QUALITY GATES — before returning any prompt, verify:
1. Is copyablePrompt between 4200 and 4500 characters?
2. Are all 4 sections present (Timeline, Inventory, Density Map, Energy Arc)?
3. Is the SIGNATURE VISUAL EFFECT marked?
4. Is the LAST FRAME / continuationAnchor complete?
5. Does every shot have lighting detail, atmospheric elements, and precise camera work?
6. Is VO synced to specific shots with specific timing?
7. Is BGM synced to specific timestamps with beat alignment notes?

If any gate fails — fix it before returning.
`;
```

Use this as the `system` parameter in EVERY Claude API call across all endpoints:

```javascript
const response = await client.messages.create({
  model: "claude-opus-4-5",
  max_tokens: 4096,
  system: MASTER_SYSTEM_CONTEXT + "\n\n" + endpointSpecificSystemPrompt,
  messages: [{ role: "user", content: userPrompt }]
});
```

---

## WHAT NOT TO CHANGE

- ❌ Do NOT change the design system (colors, fonts, spacing)
- ❌ Do NOT change Story Builder page
- ❌ Do NOT change Music Generator or Voiceover Generator pages
- ❌ Do NOT change History or Settings pages
- ❌ Do NOT rebuild from scratch

---

## TESTING CHECKLIST

- [ ] Mode selector shows both cards with correct styling
- [ ] JSON Mode is pre-selected by default with ⭐ badge
- [ ] Mode selection persists in localStorage
- [ ] Normal Mode generates readable text prompt
- [ ] JSON Mode generates valid parseable JSON prompt
- [ ] Both modes produce copyablePrompt between 4200–4500 characters
- [ ] Character counter shows correct count with color-coded bar
- [ ] Green bar for 4200–4500 range
- [ ] Red bar + Expand button below 4200
- [ ] Orange bar + Trim button above 4500
- [ ] Expand endpoint correctly lengthens short prompts without adding shots
- [ ] Trim endpoint correctly shortens long prompts without removing shots
- [ ] Mode badge shows correctly on each part card
- [ ] Copy button label changes per mode
- [ ] Toast notification appears on copy for 2.5s then disappears
- [ ] "?" tooltip renders correctly on hover/tap with comparison explanation
- [ ] MASTER_SYSTEM_CONTEXT is prepended to every Claude API call
- [ ] JSON prompt is valid JSON (JSON.parse() does not throw)

---

**Extend the existing app only. Every feature above must work. Character range 4200–4500 is non-negotiable.**
