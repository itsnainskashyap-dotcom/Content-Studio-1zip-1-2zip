# ADD-ON PROMPT — Character Reference Frames + Scene Generation Per Part
### Paste this into Replit AI as an additional feature update to the existing ContentStudio AI app.

---

## CONTEXT

This is an ADD-ON to the existing ContentStudio AI app. Do NOT rebuild. The user has already uploaded character design images into the app. Now every generated video part must produce:

1. A **Starting Frame prompt** — describes exactly how the scene opens, using the character's design reference
2. An **Ending Frame prompt** — describes exactly how the scene closes, designed to seamlessly feed into the next part
3. **Scene-by-scene breakdown** within each part — every shot gets a full scene description
4. A **Frame Generation Toggle** — user can turn Starting/Ending frames ON or OFF per project

---

## FEATURE 1 — CHARACTER REFERENCE UPLOAD SYSTEM

### New Component: `src/components/CharacterRefUploader.jsx`

Add this to the **Story Builder page**, between the Style selector and the Voiceover selector.

**Section title:** "Character & Location References"
**Sub-label:** "Upload character designs, location references, or style guides. These will be embedded into every Starting and Ending frame prompt."

**Upload area:**
```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│   ⬆  Drop images here or click to upload                   │
│                                                             │
│   Accepts: JPG, PNG, WEBP — Max 5 images                   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

After upload, each image shows as a card:
```
┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│  [thumb]    │  │  [thumb]    │  │  [thumb]    │
│             │  │             │  │             │
│ Character 1 │  │ Location 1  │  │ Style Ref   │
│ [Label ✎]  │  │ [Label ✎]  │  │ [Label ✎]  │
│    [✕]      │  │    [✕]      │  │    [✕]      │
└─────────────┘  └─────────────┘  └─────────────┘
```

Each image card:
- Editable label (click pencil icon → inline text input)
- Label types (pill selector under label): Character / Location / Style / Prop / Other
- Delete button (✕) — confirms before delete
- Thumbnail: 80×80px, object-fit cover, rounded 6px

**Image storage:**
- Convert uploaded images to base64
- Store in localStorage under project: `project.referenceImages[]`
- Each reference: `{ id, label, type, base64, fileName }`
- Max 5 images per project (show error if exceeded)

**When no images uploaded:** Show a muted info box:
```
ℹ  No references uploaded. Frames will be generated based on story 
   and style only. Upload character designs for more consistent results.
```

---

## FEATURE 2 — FRAME GENERATION TOGGLE

### Add to Prompt Generator page — inside the Audio Attachment Panel area

Add a new section **above** the Audio panel called **"Frame Settings"**:

```
┌─────────────────────────────────────────────────────────────┐
│  FRAME SETTINGS                                             │
│                                                             │
│  Starting Frame    [  ON  ●────  ]                         │
│  Generate a precise opening frame prompt for each part     │
│  using your character and location references              │
│                                                             │
│  Ending Frame      [  ON  ●────  ]                         │
│  Generate a precise closing frame prompt that feeds        │
│  into the next part for seamless continuation              │
│                                                             │
│  Scene Breakdown   [  ON  ●────  ]  (always recommended)   │
│  Every shot gets a full scene description with             │
│  character positioning, lighting, and environment          │
└─────────────────────────────────────────────────────────────┘
```

Toggle styling:
- ON state: accent color `#E8FF47` track, white circle
- OFF state: `#333333` track, `#666666` circle
- Smooth 200ms transition
- All three ON by default
- Settings persist in localStorage per project: `project.frameSettings`

```javascript
frameSettings: {
  startingFrame: true,   // generate starting frame prompt
  endingFrame: true,     // generate ending frame prompt
  sceneBreakdown: true   // generate scene descriptions per shot
}
```

---

## FEATURE 3 — UPDATE `/api/generate-video-prompts` INPUT

Add these new fields to the request body:

```json
{
  "story": "object",
  "style": "string",
  "duration": 15,
  "part": 1,
  "totalParts": 4,
  "previousLastFrame": "null or string",
  "voiceoverScript": "string or null",
  "voiceoverLanguage": "string or null",
  "voiceoverTone": "string or null",
  "bgmStyle": "string or null",
  "bgmTempo": "string or null",
  "bgmInstruments": [],
  "promptMode": "normal or json",
  "frameSettings": {
    "startingFrame": true,
    "endingFrame": true,
    "sceneBreakdown": true
  },
  "referenceImages": [
    {
      "id": "string",
      "label": "Main Character",
      "type": "character",
      "base64": "data:image/jpeg;base64,..."
    }
  ]
}
```

When `referenceImages` is provided, pass them as image content blocks in the Claude API call:

```javascript
// Build messages array with reference images
const userContent = [];

// Add reference images first if present
if (referenceImages && referenceImages.length > 0) {
  userContent.push({
    type: "text",
    text: `REFERENCE IMAGES PROVIDED (${referenceImages.length} total):\n` +
      referenceImages.map((img, i) =>
        `Image ${i+1}: "${img.label}" (type: ${img.type})`
      ).join('\n') +
      '\n\nStudy these references carefully. All Starting Frame and Ending Frame prompts must accurately describe these characters, locations, and styles as shown in the reference images.'
  });

  referenceImages.forEach((img) => {
    userContent.push({
      type: "image",
      source: {
        type: "base64",
        media_type: img.base64.split(';')[0].split(':')[1],
        data: img.base64.split(',')[1]
      }
    });
  });
}

// Add main generation prompt
userContent.push({
  type: "text",
  text: mainGenerationPrompt
});

const response = await client.messages.create({
  model: "claude-opus-4-5",
  max_tokens: 4096,
  system: MASTER_SYSTEM_CONTEXT + "\n\n" + endpointSpecificSystemPrompt,
  messages: [{ role: "user", content: userContent }]
});
```

---

## FEATURE 4 — STARTING FRAME PROMPT GENERATION

### Add to both Normal Mode and JSON Mode system prompts

Append these rules to the existing system prompts:

**For Normal Mode — append after ENERGY ARC section:**

```
═══════════════════════════════════════════════════════════
STARTING FRAME PROMPT
═══════════════════════════════════════════════════════════
[Only generate if frameSettings.startingFrame is true]

This is a standalone image generation prompt for the FIRST FRAME of this video part.
It should be pasteable into Midjourney, DALL·E, or Stable Diffusion to generate
the exact opening frame before running Seedance.

FORMAT:
[Subject description matching reference images exactly — hair, clothing, expression, 
body position] [in/at] [environment description matching location reference] 
[lighting setup: direction, quality, color temperature] [camera: lens, angle, 
distance from subject] [style: visual style descriptors matching selected style] 
[atmosphere: fog/dust/particles/flare/time of day] [mood: one word] 
[technical: aspect ratio 16:9, cinematic composition]

REFERENCE CONSISTENCY RULES:
- If character reference uploaded: describe exact clothing colors, hair style, 
  face structure, distinguishing features from reference image
- If location reference uploaded: describe exact architectural details, 
  color palette, key environmental elements from reference image  
- If style reference uploaded: describe exact visual treatment, 
  color grade, texture from reference image
- Never invent character details not visible in the reference
- Never contradict what is shown in any reference image

═══════════════════════════════════════════════════════════
ENDING FRAME PROMPT  
═══════════════════════════════════════════════════════════
[Only generate if frameSettings.endingFrame is true]

This is a standalone image generation prompt for the LAST FRAME of this video part.
It shows the exact state at which this part ends — for the user to generate an 
anchor image, and for the next part to begin from.

Same format as Starting Frame but describes the END STATE:
- Subject's final position, expression, body language
- Camera's final position and angle
- Environmental state at end (lighting changed? weather? time shift?)
- Atmospheric state (any effects that are present in the final frame)

CRITICAL: This ending frame description must EXACTLY MATCH the 
continuationAnchor / LAST FRAME data so Part [N+1] begins from 
the precise visual state shown here.
```

**For JSON Mode — add to the JSON structure:**

```json
"startingFrame": {
  "enabled": true,
  "imageGenPrompt": "[Complete image generation prompt for the first frame — 150-200 words — references character design, location, lighting, camera, style, mood, technical specs]",
  "characterState": {
    "position": "[exact body position and pose]",
    "expression": "[facial expression]",
    "clothing": "[clothing description matching reference]",
    "distinguishingFeatures": "[key features from reference images]"
  },
  "environmentState": {
    "location": "[location description]",
    "timeOfDay": "[morning/golden hour/midday/dusk/night]",
    "weather": "[clear/overcast/foggy/rainy]",
    "keyDetails": "[specific environmental details from location reference]"
  },
  "cameraState": {
    "angle": "[eye level/low angle/high angle/dutch]",
    "distance": "[extreme close-up/close-up/medium/wide/extreme wide]",
    "lens": "[lens type]",
    "composition": "[rule of thirds/centered/leading lines etc]"
  },
  "lightingState": {
    "primarySource": "[direction and type]",
    "colorTemperature": "[warm/cool/neutral + Kelvin]",
    "quality": "[hard/soft/diffused/dramatic]",
    "practicals": "[any visible light sources in frame]"
  },
  "atmosphericState": "[fog/dust/particles/lens flare details]",
  "styleDescriptors": ["descriptor1", "descriptor2", "descriptor3"],
  "technicalSpecs": "16:9 aspect ratio, cinematic composition, [style] rendering"
},

"endingFrame": {
  "enabled": true,
  "imageGenPrompt": "[Complete image generation prompt for the last frame — 150-200 words]",
  "characterState": {
    "position": "[exact final body position]",
    "expression": "[final facial expression]",
    "actionState": "[what the character is doing/has just done]"
  },
  "environmentState": {
    "location": "[same or changed location]",
    "timeOfDay": "[if time has passed, updated time]",
    "changesFromStart": "[what changed in environment vs starting frame]"
  },
  "cameraState": {
    "angle": "[final camera angle]",
    "distance": "[final camera distance]",
    "movementState": "[camera stopped/still moving]"
  },
  "lightingState": {
    "primarySource": "[final lighting direction]",
    "colorTemperature": "[final color temp]",
    "changesFromStart": "[how lighting evolved]"
  },
  "matchesContinuationAnchor": true,
  "nextPartPickupInstruction": "[Exact instruction for Part N+1 opening shot]"
}
```

---

## FEATURE 5 — SCENE BREAKDOWN PER SHOT

### Add to both Normal and JSON mode prompts

When `frameSettings.sceneBreakdown is true`, every shot gets an expanded scene description block.

**For Normal Mode — add to each SHOT block:**

```
SHOT [N] (00:XX–00:XX) — [Shot Name]
EFFECT: [effects]
SCENE: [Full scene description — 40-60 words covering: where exactly are we, 
what is the character doing, what environmental details are visible, 
what is the light doing, what is in foreground/midground/background, 
does it match any reference image]
CHARACTER: [character name from reference] — [exact position, action, 
expression, clothing detail visible in this shot]
ENVIRONMENT: [specific location details, what makes this location identifiable 
from the reference, key props or architectural elements visible]
VO: "[line]" [sync]
MUSIC: [note]
CAMERA: [movement]
SPEED: [value]
EXIT → [transition]
```

**For JSON Mode — add to each shot object:**

```json
"sceneDescription": {
  "enabled": true,
  "fullDescription": "[40-60 words: complete scene description with character, environment, light, atmosphere]",
  "characterInScene": {
    "name": "[character label from reference]",
    "action": "[what they are doing]",
    "position": "[where in frame, distance from camera]",
    "expression": "[facial expression if visible]",
    "clothingVisible": "[which clothing elements are visible at this shot distance]"
  },
  "environmentInScene": {
    "location": "[specific location name/description]",
    "visibleDetails": ["detail1", "detail2", "detail3"],
    "foreground": "[what is in foreground]",
    "midground": "[what is in midground]",
    "background": "[what is in background]",
    "matchesReference": "[which reference image this matches, or null]"
  },
  "lightInScene": {
    "direction": "[where light is coming from in this shot]",
    "fallsOn": "[what the light specifically illuminates]",
    "shadowsIn": "[where shadows fall]"
  }
}
```

---

## FEATURE 6 — UPDATED PART CARD UI

### Update: Part card in Prompt Generator page

Each generated part card now has these sections (all collapsible except header and copy button):

```
┌──────────────────────────────────────────────────────────────┐
│  PART 1 / 4  ·  00:00–00:15  ·  Anime 2D  ·  { } JSON      │
│  [▼ Character Ref: 2 images used]                           │
├──────────────────────────────────────────────────────────────┤
│  🎬 STARTING FRAME  [ON]              [📋 Copy Frame Prompt] │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ [imageGenPrompt text — truncated to 3 lines]           │  │
│  │ Character: [label] · Location: [label]                 │  │
│  │ [Show full ↓]                                          │  │
│  └────────────────────────────────────────────────────────┘  │
├──────────────────────────────────────────────────────────────┤
│  🎥 SHOTS  [▼ expand all]                                    │
│  ┌─ Shot 1 ──────────────────────────────────────────────┐   │
│  │ 00:00–00:03 · [name]  [SIGNATURE ⭐]                   │   │
│  │ SCENE: [scene description — 2 lines preview]          │   │
│  │ CHARACTER: [name] — [action]                          │   │
│  │ EFFECTS: [chip] [chip]                                │   │
│  │ VO: "[line]"                                          │   │
│  │ [Show full shot ↓]                                    │   │
│  └───────────────────────────────────────────────────────┘   │
│  [Shot 2] [Shot 3] [Shot 4] ...                              │
├──────────────────────────────────────────────────────────────┤
│  🎵 AUDIO  [▼]                                               │
│  VO: "[script]"  BGM: [style] · [BPM]                       │
│  Sync Points: [list]                                         │
├──────────────────────────────────────────────────────────────┤
│  📊 DENSITY MAP  [▼]                                         │
│  [████░░░░] LOW  [████████] HIGH  [██████░░] MED            │
├──────────────────────────────────────────────────────────────┤
│  🔚 ENDING FRAME  [ON]               [📋 Copy Frame Prompt] │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ [imageGenPrompt text — truncated to 3 lines]           │  │
│  │ → Next Part picks up from: [nextPartPickupInstruction] │  │
│  │ [Show full ↓]                                          │  │
│  └────────────────────────────────────────────────────────┘  │
├──────────────────────────────────────────────────────────────┤
│  PROMPT LENGTH: ████████████████████░░  4,318 chars  ✓      │
│  [  { } Copy Full JSON Prompt  ]  [  ↓ Download  ]          │
└──────────────────────────────────────────────────────────────┘
```

**Starting Frame and Ending Frame sections:**
- Show ON/OFF toggle inside the card header (overrides the global setting for this part)
- If OFF: section collapses completely and frame prompt is excluded from the copied prompt
- Each has its own "Copy Frame Prompt" button — copies ONLY that frame's imageGenPrompt
- "Show full ↓" expands to reveal complete prompt text in a monospace block

**Shot cards inside the part:**
- Default: collapsed, showing 2-line preview
- "Show full shot ↓" expands to full scene description + all fields
- Signature shot gets ⭐ badge + subtle accent left border

---

## FEATURE 7 — COPY BEHAVIOR UPDATE

Three separate copy actions per part:

1. **Copy Starting Frame Prompt** — copies ONLY the imageGenPrompt for the first frame
   - Toast: "✓ Starting frame prompt copied — paste into Midjourney / DALL·E"

2. **Copy Ending Frame Prompt** — copies ONLY the imageGenPrompt for the last frame
   - Toast: "✓ Ending frame prompt copied — paste into Midjourney / DALL·E"

3. **Copy Full Prompt** — copies complete prompt including:
   - If startingFrame ON: prepends `[STARTING FRAME: imageGenPrompt]` at top
   - Visual Style + BGM + Voiceover blocks
   - All shots with scene descriptions
   - Effects inventory, density map, energy arc
   - If endingFrame ON: appends `[ENDING FRAME: imageGenPrompt]` at bottom
   - Toast: "✓ Full prompt copied — paste into Seedance 2.0"

---

## FEATURE 8 — PROJECT SCHEMA UPDATE

### Update: `src/context/AppContext.jsx`

Add to project object:

```javascript
{
  // ... existing fields ...
  referenceImages: [],     // uploaded character/location/style references
  frameSettings: {
    startingFrame: true,
    endingFrame: true,
    sceneBreakdown: true
  },
  
  // Each part now includes:
  parts: [
    {
      partNumber: 1,
      // ... existing part fields ...
      startingFrame: {
        enabled: true,
        imageGenPrompt: "string",
        characterState: {},
        environmentState: {},
        cameraState: {},
        lightingState: {},
        atmosphericState: "string",
        styleDescriptors: [],
        technicalSpecs: "string"
      } | null,
      endingFrame: {
        enabled: true,
        imageGenPrompt: "string",
        characterState: {},
        environmentState: {},
        cameraState: {},
        lightingState: {},
        matchesContinuationAnchor: true,
        nextPartPickupInstruction: "string"
      } | null,
      shots: [
        {
          // ... existing shot fields ...
          sceneDescription: {
            enabled: true,
            fullDescription: "string",
            characterInScene: {},
            environmentInScene: {},
            lightInScene: {}
          }
        }
      ]
    }
  ]
}
```

---

## FEATURE 9 — MASTER SYSTEM PROMPT UPDATE

### Update: `MASTER_SYSTEM_CONTEXT` in `server/index.js`

Append these lines to the existing MASTER_SYSTEM_CONTEXT:

```javascript
const MASTER_SYSTEM_CONTEXT_APPEND = `

REFERENCE IMAGE RULES — CRITICAL:
When reference images are provided, you MUST:
1. Study every reference image carefully before generating any frame prompt
2. Starting Frame prompt must describe the character's EXACT appearance from 
   the reference — same hair color, same clothing, same distinguishing features
3. Never invent physical details not shown in the reference
4. Never contradict what is visible in any reference image
5. Location reference images define the visual language of the environment — 
   use the same color palette, architectural style, and atmosphere
6. Style reference images define the rendering quality and visual treatment

SCENE DESCRIPTION RULES:
When sceneBreakdown is true:
1. Every shot must place the character precisely in the environment
2. Describe what is in foreground, midground, and background
3. Connect the scene to the reference images where applicable
4. Scene descriptions must be consistent across all shots — same environment 
   unless the story explicitly moves locations

FRAME CONTINUITY RULES:
1. The Ending Frame's imageGenPrompt MUST visually match the 
   continuationAnchor description — same subject state, camera state, lighting
2. The next part's Starting Frame MUST visually match the previous part's 
   Ending Frame — seamless handoff
3. Character appearance MUST be 100% consistent across all Starting and 
   Ending frames — same clothing, same features, no variation
4. If no reference images provided, maintain self-consistency across frames 
   by describing the same character details you established in Part 1
`;
```

---

## WHAT NOT TO CHANGE

- ❌ Do NOT change the design system (colors, fonts, spacing)
- ❌ Do NOT change Music Generator or Voiceover Generator pages
- ❌ Do NOT change History or Settings pages
- ❌ Do NOT change the dual mode (Normal/JSON) selector
- ❌ Do NOT change the 4200–4500 character count system
- ❌ Do NOT rebuild from scratch

---

## TESTING CHECKLIST

- [ ] Reference image upload area shows on Story Builder page
- [ ] Up to 5 images uploadable, 6th shows error message
- [ ] Each image gets editable label + type selector (Character/Location/Style/Prop/Other)
- [ ] Images stored as base64 in localStorage under project
- [ ] Frame Settings toggles show (Starting Frame / Ending Frame / Scene Breakdown)
- [ ] All three toggles ON by default
- [ ] Toggle OFF collapses that section from part cards
- [ ] Reference images sent as image blocks in Claude API call
- [ ] Starting Frame prompt generated for each part when enabled
- [ ] Ending Frame prompt generated for each part when enabled
- [ ] Starting Frame matches character reference (hair, clothing, features)
- [ ] Ending Frame matches continuationAnchor exactly
- [ ] Scene breakdown generates for every shot when enabled
- [ ] Each shot shows character position, environment details, lighting
- [ ] Part card shows Starting Frame section with copy button
- [ ] Part card shows Ending Frame section with copy button
- [ ] "Copy Starting Frame Prompt" copies only imageGenPrompt with correct toast
- [ ] "Copy Ending Frame Prompt" copies only imageGenPrompt with correct toast
- [ ] "Copy Full Prompt" includes [STARTING FRAME] and [ENDING FRAME] blocks when ON
- [ ] Shot cards collapse/expand correctly
- [ ] Signature shot shows ⭐ badge + accent border
- [ ] Character appearance consistent across all parts' frame prompts
- [ ] No reference images = graceful fallback with info message
- [ ] All new fields save to localStorage correctly

---

**Extend existing app only. Character reference consistency across all parts is critical — the same character must look identical in every Starting and Ending Frame prompt.**
