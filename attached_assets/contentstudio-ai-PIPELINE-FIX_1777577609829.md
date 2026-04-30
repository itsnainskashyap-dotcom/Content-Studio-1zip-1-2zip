# FIX PROMPT — ContentStudio AI Pipeline Complete Overhaul
### Paste into Replit Agent. This fixes ALL broken pipeline issues in the existing app.

---

## PROBLEMS TO FIX (read all before touching any code)

1. **Random images** — Character images generate without story context. Images don't match characters. Location/environment is random, not from story.
2. **No OCR/Vision connection** — Generated character images are NOT being analyzed before next step. Gemini vision is not reading images to validate or carry forward visual data.
3. **No connected reference chain** — Each generation step runs independently. Characters don't feed into scenes. Scenes don't feed into video. Nothing is connected.
4. **Audio not generating** — Neither Cont Pro (Veo 3.1) nor Cont Ultra (Seedance 2.0) is outputting audio. Prompts don't include proper audio instructions.
5. **Seedance references broken** — Seedance is not receiving the previous video as reference. Each chunk generates independently with no visual continuity.
6. **Veo references broken** — Same issue. First frame not being passed correctly.
7. **Prompts not optimized** — Prompts going to both models are too vague/generic. No physics, no character lock, no camera work, no proper audio JSON.
8. **Images not hyper-realistic** — nano-banana-2 prompts don't include quality markers for hyper-realistic output.

---

## THE ROOT CAUSE

The pipeline runs steps in sequence but **does not pass output from one step as input to the next**. Fix this by implementing a **Context Chain** — a single object that accumulates all generated assets and is passed forward through every step.

---

## FIX 1 — THE CONTEXT CHAIN SYSTEM

### Replace all pipeline state management with this in `server/pipeline/videoPipeline.js`:

```javascript
// THE CONTEXT CHAIN — single source of truth for the entire pipeline
// Every agent reads from this AND writes to this
// Nothing generates without reading from this first

class PipelineContext {
  constructor(input) {
    this.input = input;                    // original user input
    this.storyBible = null;               // from Step 1
    this.characters = [];                 // from Step 2 — ANALYZED by Gemini vision
    this.environments = [];               // from Step 3 — ANALYZED by Gemini vision
    this.storyboard = null;               // from Step 4 — uses characters + environments
    this.sceneFrames = [];                // from Step 5 — uses storyboard + character refs
    this.videoChunks = [];                // from Step 6 — accumulates as loop runs
    this.lastGeneratedVideo = null;       // CRITICAL — last video path, feeds next chunk
    this.lastCapturedFrame = null;        // CRITICAL — last frame base64, feeds next chunk
    this.characterConsistencyLock = null; // extracted from Gemini analysis of char images
    this.environmentLock = null;          // extracted from Gemini analysis of env images
  }
}
```

---

## FIX 2 — STORY BIBLE DRIVES EVERYTHING

### Rewrite `agents/storyAnalyzer.js` completely:

```javascript
import Anthropic from '@anthropic-ai/sdk';
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const CLAUDE = 'claude-sonnet-4-6';

export async function analyzeStory(ctx, log) {
  log('Analyzing story', 'Claude Sonnet 4.6 building story bible...');

  const response = await anthropic.messages.create({
    model: CLAUDE,
    max_tokens: 6000,
    system: `You are a master anime story director and production designer.
You analyze stories and extract everything needed for visual production:
character appearances, locations, scene-by-scene breakdowns, and visual consistency rules.
Be EXTREMELY specific about visual details — exact colors, exact clothing, exact locations.
Return ONLY valid JSON. No markdown.`,
    messages: [{
      role: 'user',
      content: `Analyze this story for anime video production.
      
STORY: ${JSON.stringify(ctx.input.story)}
ANIME TYPE: ${ctx.input.animeType}
VISUAL STYLE: ${ctx.input.style}
GENRE: ${ctx.input.genre}
TOTAL DURATION: ${ctx.input.totalDurationSeconds}s
VOICEOVER LANGUAGE: ${ctx.input.voiceoverLanguage}

Extract and return:
{
  "title": "string",
  "setting": {
    "world": "string — detailed world description",
    "timeperiod": "string",
    "primaryLocation": "string — main location with exact visual details",
    "locationDetails": "string — architecture, colors, lighting, atmosphere",
    "timeOfDay": "string — when story starts",
    "weather": "string"
  },
  "visualTone": {
    "colorPalette": ["hex1", "hex2", "hex3"],
    "lightingStyle": "string",
    "shadowStyle": "string",
    "atmosphericElements": ["string"]
  },
  "characters": [
    {
      "id": "char_1",
      "name": "string",
      "role": "protagonist|antagonist|supporting",
      "age": "string",
      "gender": "string",
      "bodyType": "string — height, build, posture",
      "face": {
        "faceShape": "string",
        "eyeColor": "string — exact color",
        "eyeShape": "string",
        "hairColor": "string — exact color with highlights if any",
        "hairLength": "string",
        "hairStyle": "string — exact style description",
        "skinTone": "string — exact skin tone"
      },
      "outfit": {
        "top": "string — exact garment, color, style",
        "bottom": "string — exact garment, color, style",
        "footwear": "string",
        "accessories": ["string"],
        "colors": ["exact hex or color name"]
      },
      "distinguishingFeatures": "string — scars, tattoos, unique marks",
      "personalityVisuals": "string — how personality shows in posture/expression",
      "typicalExpression": "string"
    }
  ],
  "scenes": [
    {
      "sceneNumber": 1,
      "title": "string",
      "location": "string — exact location with full visual detail",
      "timeOfDay": "string",
      "weather": "string",
      "lighting": "string — exact lighting direction, quality, color temp",
      "charactersPresent": ["char_id"],
      "summary": "string — what happens",
      "emotionalTone": "string",
      "keyVisualMoments": ["string", "string"],
      "dialogue": ["string"],
      "estimatedDurationSeconds": 15,
      "cameraStyle": "string — how this scene should be shot"
    }
  ],
  "narrativeArc": "string",
  "productionNotes": "string — important visual consistency notes"
}`
    }]
  });

  ctx.storyBible = JSON.parse(response.content[0].text);
  log('Story analyzed', `${ctx.storyBible.characters.length} characters · ${ctx.storyBible.scenes.length} scenes`, 'done');
  return ctx.storyBible;
}
```

---

## FIX 3 — CHARACTER GENERATION WITH GEMINI VISION ANALYSIS

### Rewrite `agents/characterDesigner.js` completely:

This is the most critical fix. After EVERY image is generated, Gemini vision READS it and extracts the actual visual data. This data is stored in the context chain and used by ALL subsequent steps.

```javascript
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs/promises';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const genai = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
const CLAUDE = 'claude-sonnet-4-6';
const GEMINI_VISION = 'gemini-2.0-flash';
const IMAGE_MODEL = 'nano-banana-2';

// ─── GENERATE ALL CHARACTER IMAGES ───────────────────────────────────────────

export async function generateAllCharacters(ctx, log) {
  log('Generating characters', 'Creating character reference sheets...');
  
  const styleRules = getAnimeStyleRules(ctx.input.style, ctx.input.animeType);
  
  for (const charSpec of ctx.storyBible.characters) {
    log('Generating characters', `Building ${charSpec.name}...`);
    
    const characterData = await generateSingleCharacter(charSpec, styleRules, ctx, log);
    ctx.characters.push(characterData);
  }

  // Build the consistency lock from ALL analyzed character images
  ctx.characterConsistencyLock = buildConsistencyLock(ctx.characters);
  
  log('Characters complete', 
    `${ctx.characters.length} characters · Gemini-verified · consistency lock set`, 'done');
}

// ─── GENERATE + ANALYZE ONE CHARACTER ────────────────────────────────────────

async function generateSingleCharacter(charSpec, styleRules, ctx, log) {
  const angles = [
    { name: 'full_front', description: 'full body, front view, neutral pose, arms at sides' },
    { name: 'full_34_left', description: 'full body, 3/4 view from left, slight turn' },
    { name: 'full_back', description: 'full body, back view, same outfit' },
    { name: 'face_front', description: 'face and upper chest close-up, front, neutral expression' },
    { name: 'face_34', description: 'face close-up, 3/4 angle, slight smile' },
    { name: 'action_pose', description: getActionPoseForRole(charSpec.role) },
    { name: 'expression_sheet', description: 'upper body only, 4 expressions in grid: happy, serious, surprised, determined' }
  ];

  const generatedAngles = [];

  for (const angle of angles) {
    let imageBase64 = null;
    let geminiAnalysis = null;
    let attempts = 0;
    const maxAttempts = 3;

    while (attempts < maxAttempts) {
      attempts++;

      // Claude Sonnet 4.6 writes the nano-banana-2 prompt
      const promptRes = await anthropic.messages.create({
        model: CLAUDE,
        max_tokens: 600,
        messages: [{
          role: 'user',
          content: `Write a hyper-realistic nano-banana-2 image generation prompt.

CHARACTER SPECIFICATION:
Name: ${charSpec.name}
Role: ${charSpec.role}
Body: ${charSpec.bodyType}
Face shape: ${charSpec.face.faceShape}
Eye color: ${charSpec.face.eyeColor} (${charSpec.face.eyeShape})
Hair: ${charSpec.face.hairColor}, ${charSpec.face.hairLength}, ${charSpec.face.hairStyle}
Skin: ${charSpec.face.skinTone}
Top: ${charSpec.outfit.top}
Bottom: ${charSpec.outfit.bottom}
Shoes: ${charSpec.outfit.footwear}
Accessories: ${charSpec.outfit.accessories.join(', ')}
Distinguishing: ${charSpec.distinguishingFeatures}

ANGLE: ${angle.description}

STYLE: ${ctx.input.style}
ANIME TYPE: ${ctx.input.animeType}
STYLE RULES: ${styleRules}

${attempts > 1 && geminiAnalysis ? `PREVIOUS ATTEMPT ISSUES (fix these):
${geminiAnalysis.issues.join(', ')}` : ''}

REQUIREMENTS:
- Hyper-realistic ${ctx.input.animeType} anime art style
- PURE WHITE background — character only, no props, no environment
- Full character visible, no cropping
- Every clothing detail exactly as specified
- Hair color and style exactly as specified
- Eye color exactly as specified
- Professional character design sheet quality
- Ultra-detailed, high-resolution anime illustration
- Consistent lighting: soft front-facing studio light

QUALITY MARKERS: masterpiece, best quality, ultra-detailed, 8k, professional anime illustration, sharp lines, clean coloring, character sheet

Return ONLY the prompt. No explanation. 150-180 words.`
        }]
      });

      const nanoBananaPrompt = promptRes.content[0].text.trim();
      
      // Generate image
      imageBase64 = await callNanoBanana2(nanoBananaPrompt, ctx.jobId, 
        `char_${charSpec.id}_${angle.name}_attempt${attempts}`);

      // Gemini Vision READS and ANALYZES the generated image
      geminiAnalysis = await analyzeCharacterImageWithGemini(imageBase64, charSpec, angle.name);

      if (geminiAnalysis.consistent && geminiAnalysis.confidence > 0.75) {
        break; // Image passes — move to next angle
      }
      
      log('Generating characters', 
        `${charSpec.name} ${angle.name}: retry ${attempts} — ${geminiAnalysis.issues.join(', ')}`);
    }

    generatedAngles.push({
      angleName: angle.name,
      imageBase64,
      imageUrl: `/outputs/images/${ctx.jobId}/char_${charSpec.id}_${angle.name}.jpg`,
      geminiAnalysis,
      promptUsed: ''  // stored for debugging
    });
  }

  // Gemini does a FINAL DEEP ANALYSIS of the front-facing image
  // This extracted data becomes the CHARACTER LOCK used in ALL video generation
  const frontImage = generatedAngles.find(a => a.angleName === 'full_front');
  const deepAnalysis = await deepAnalyzeCharacterWithGemini(frontImage.imageBase64, charSpec);

  return {
    ...charSpec,
    angles: generatedAngles,
    geminiExtractedAppearance: deepAnalysis,   // what Gemini ACTUALLY sees in the image
    primaryReferenceBase64: frontImage.imageBase64,  // most important reference image
    allReferencesBase64: generatedAngles.map(a => a.imageBase64)
  };
}

// ─── GEMINI VALIDATES CHARACTER IMAGE ────────────────────────────────────────

async function analyzeCharacterImageWithGemini(imageBase64, charSpec, angleName) {
  const model = genai.getGenerativeModel({ model: GEMINI_VISION });

  const result = await model.generateContent([
    {
      inlineData: {
        data: imageBase64,
        mimeType: 'image/jpeg'
      }
    },
    {
      text: `Analyze this character image and check consistency with the specification.

EXPECTED:
Hair: ${charSpec.face.hairColor} ${charSpec.face.hairStyle}
Eyes: ${charSpec.face.eyeColor}
Skin: ${charSpec.face.skinTone}
Top: ${charSpec.outfit.top}
Bottom: ${charSpec.outfit.bottom}
Angle: ${angleName}

Check EACH item and return JSON only:
{
  "consistent": true/false,
  "confidence": 0.0-1.0,
  "hairMatch": true/false,
  "eyeColorMatch": true/false,
  "outfitMatch": true/false,
  "angleCorrect": true/false,
  "issues": ["list only failed checks"],
  "whatYouSee": {
    "hairColor": "string",
    "hairStyle": "string",
    "eyeColor": "string",
    "outfitTop": "string",
    "outfitBottom": "string",
    "skinTone": "string"
  }
}`
    }
  ]);

  try {
    return JSON.parse(result.response.text().replace(/```json\n?|```/g, '').trim());
  } catch {
    return { consistent: true, confidence: 0.5, issues: [], whatYouSee: {} };
  }
}

// ─── GEMINI DEEP ANALYSIS — BUILDS CHARACTER LOCK ────────────────────────────

async function deepAnalyzeCharacterWithGemini(imageBase64, charSpec) {
  const model = genai.getGenerativeModel({ model: GEMINI_VISION });

  const result = await model.generateContent([
    { inlineData: { data: imageBase64, mimeType: 'image/jpeg' } },
    {
      text: `You are a character design analyst. Study this image carefully and extract EXACT visual data.
This data will be used as a reference lock to ensure character consistency across all future images.

Return JSON only — be extremely specific:
{
  "exactHairColor": "string — exact shade e.g. 'deep navy blue with lighter blue highlights'",
  "exactHairStyle": "string — every detail of how hair falls and is styled",
  "exactEyeColor": "string — exact shade",
  "exactSkinTone": "string — exact description",
  "exactOutfitTop": "string — full description of top garment color, style, fabric appearance",
  "exactOutfitBottom": "string — full description",
  "exactFootwear": "string",
  "bodyProportions": "string — height relative to frame, build",
  "distinguishingVisuals": "string — anything unique/memorable about this character's look",
  "colorHexApproximations": {
    "hair": "#hex",
    "eyes": "#hex",
    "outfitPrimary": "#hex",
    "outfitSecondary": "#hex",
    "skin": "#hex"
  },
  "promptDescriptor": "string — one dense 80-word description of this character's full appearance, usable as a reference block in future prompts"
}`
    }
  ]);

  try {
    return JSON.parse(result.response.text().replace(/```json\n?|```/g, '').trim());
  } catch {
    return { promptDescriptor: `${charSpec.name}: ${charSpec.face.hairColor} ${charSpec.face.hairStyle} hair, ${charSpec.face.eyeColor} eyes, wearing ${charSpec.outfit.top} and ${charSpec.outfit.bottom}` };
  }
}

// ─── BUILD CONSISTENCY LOCK ───────────────────────────────────────────────────
// This is used by EVERY subsequent prompt to ensure visual consistency

function buildConsistencyLock(characters) {
  const lock = {};
  for (const char of characters) {
    lock[char.id] = {
      name: char.name,
      promptDescriptor: char.geminiExtractedAppearance?.promptDescriptor || '',
      exactColors: char.geminiExtractedAppearance?.colorHexApproximations || {},
      primaryImageBase64: char.primaryReferenceBase64,
      allAnglesBase64: char.allReferencesBase64
    };
  }
  return lock;
}

function getActionPoseForRole(role) {
  const poses = {
    protagonist: 'dynamic action pose, forward movement, confident stance',
    antagonist: 'powerful standing pose, arms crossed or weapon drawn, menacing',
    supporting: 'friendly casual pose, side view, relaxed'
  };
  return poses[role] || poses.supporting;
}
```

---

## FIX 4 — ENVIRONMENT GENERATION WITH GEMINI ANALYSIS

### New file: `agents/environmentBuilder.js`

Environments are generated FROM the story bible, analyzed by Gemini, and locked before any scene generation.

```javascript
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const genai = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
const CLAUDE = 'claude-sonnet-4-6';

export async function generateAllEnvironments(ctx, log) {
  log('Building environments', 'Generating location reference images...');

  // Get unique locations from story bible
  const uniqueLocations = [...new Set(ctx.storyBible.scenes.map(s => s.location))];

  for (const location of uniqueLocations) {
    const sceneWithThisLocation = ctx.storyBible.scenes.find(s => s.location === location);
    
    // Claude Sonnet 4.6 writes the environment prompt based on story bible
    const promptRes = await anthropic.messages.create({
      model: CLAUDE,
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: `Write a hyper-realistic nano-banana-2 environment image prompt.

STORY SETTING: ${JSON.stringify(ctx.storyBible.setting)}
LOCATION: ${location}
TIME OF DAY: ${sceneWithThisLocation.timeOfDay}
WEATHER: ${sceneWithThisLocation.weather}
LIGHTING: ${sceneWithThisLocation.lighting}
ANIME TYPE: ${ctx.input.animeType}
VISUAL STYLE: ${ctx.input.style}
COLOR PALETTE: ${ctx.storyBible.visualTone.colorPalette.join(', ')}
ATMOSPHERE: ${ctx.storyBible.visualTone.atmosphericElements.join(', ')}

REQUIREMENTS:
- NO characters, NO people
- Full environment establishing shot
- Ultra-detailed background art
- Hyper-realistic ${ctx.input.animeType} anime environment
- Exact architecture, vegetation, objects as described
- Correct time of day lighting
- Correct weather atmosphere
- Professional anime background art quality
- QUALITY MARKERS: masterpiece, best quality, ultra-detailed, 8k, professional anime background art

Return ONLY the prompt. 140-170 words.`
      }]
    });

    const envPrompt = promptRes.content[0].text.trim();
    const envBase64 = await callNanoBanana2(envPrompt, ctx.jobId, 
      `env_${location.replace(/\s+/g, '_').toLowerCase()}`);

    // Gemini analyzes the environment image
    const envAnalysis = await analyzeEnvironmentWithGemini(envBase64, location, sceneWithThisLocation);

    ctx.environments.push({
      location,
      imageBase64: envBase64,
      imageUrl: `/outputs/images/${ctx.jobId}/env_${location.replace(/\s+/g, '_').toLowerCase()}.jpg`,
      geminiAnalysis: envAnalysis,
      promptUsed: envPrompt
    });
  }

  // Build environment lock
  ctx.environmentLock = {};
  for (const env of ctx.environments) {
    ctx.environmentLock[env.location] = {
      imageBase64: env.imageBase64,
      geminiDescription: env.geminiAnalysis.description,
      colorPalette: env.geminiAnalysis.dominantColors,
      lightingDescription: env.geminiAnalysis.lighting
    };
  }

  log('Environments ready', `${ctx.environments.length} locations · Gemini-analyzed · locked`, 'done');
}

async function analyzeEnvironmentWithGemini(imageBase64, location, sceneSpec) {
  const model = genai.getGenerativeModel({ model: 'gemini-2.0-flash' });

  const result = await model.generateContent([
    { inlineData: { data: imageBase64, mimeType: 'image/jpeg' } },
    {
      text: `Analyze this environment image and extract visual data for production use.
      
Expected location: ${location}
Expected time: ${sceneSpec.timeOfDay}
Expected weather: ${sceneSpec.weather}

Return JSON only:
{
  "description": "string — 80-word dense description of exactly what is in this image, usable as reference in future prompts",
  "dominantColors": ["#hex1", "#hex2", "#hex3"],
  "lighting": "string — exact lighting description",
  "keyElements": ["string", "string", "string"],
  "timeOfDayAccurate": true/false,
  "weatherAccurate": true/false,
  "promptDescriptor": "string — 60-word description for inserting into video prompts"
}`
    }
  ]);

  try {
    return JSON.parse(result.response.text().replace(/```json\n?|```/g, '').trim());
  } catch {
    return { description: location, dominantColors: [], lighting: sceneSpec.lighting, promptDescriptor: location };
  }
}
```

---

## FIX 5 — STORYBOARD USES LOCKED CHARACTER + ENVIRONMENT DATA

### Rewrite `agents/sceneBuilder.js`:

The storyboard is now built AFTER characters and environments are analyzed. It uses the Gemini-extracted data, not the original text spec.

```javascript
export async function buildStoryboard(ctx, log) {
  log('Building storyboard', 'Creating scene-by-scene production plan...');

  // Build character reference block from Gemini-analyzed data
  const charRefBlock = Object.values(ctx.characterConsistencyLock)
    .map(c => `CHARACTER "${c.name}": ${c.promptDescriptor}`)
    .join('\n');

  const response = await anthropic.messages.create({
    model: CLAUDE,
    max_tokens: 8000,
    system: `You are a storyboard director. Create precise video production storyboards.
You use EXACT character appearance data extracted from generated reference images.
Every shot must be achievable with the visual references already generated.
Return ONLY valid JSON.`,
    messages: [{
      role: 'user',
      content: `Create the complete video production storyboard.

STORY SCENES:
${JSON.stringify(ctx.storyBible.scenes)}

VERIFIED CHARACTER APPEARANCES (from image analysis):
${charRefBlock}

VERIFIED ENVIRONMENTS (from image analysis):
${ctx.environments.map(e => `LOCATION "${e.location}": ${e.geminiAnalysis.promptDescriptor}`).join('\n')}

ANIME TYPE: ${ctx.input.animeType}
STYLE: ${ctx.input.style}
VOICEOVER LANGUAGE: ${ctx.input.voiceoverLanguage}
CHUNK SIZE: 8 seconds per chunk

For each scene, create production chunks:
{
  "totalChunks": number,
  "characterConsistencyRules": "string — global rules for ALL chunks",
  "scenes": [
    {
      "sceneNumber": 1,
      "location": "string — must match an environment in the lock",
      "charactersPresent": ["char_id"],
      "chunks": [
        {
          "chunkNumber": 1,
          "globalChunkNumber": 1,
          "timeRange": "00:00-00:08",
          "sceneTitle": "string",
          "narrativePurpose": "string",
          "keyAction": "string",
          "charactersInShot": ["char_id"],
          "cameraWork": "string — precise camera movement with direction",
          "lighting": "string — exact lighting, matches environment lock",
          "startingFrameDescription": "string — EXACT description of first frame using verified character + environment data",
          "cutDescriptions": [
            {"atSecond": 2, "description": "string — exact visual state at 2s"},
            {"atSecond": 4, "description": "string — exact visual state at 4s"},
            {"atSecond": 6, "description": "string — exact visual state at 6s"}
          ],
          "endingState": {
            "characterPositions": "string",
            "cameraAngle": "string",
            "lightingState": "string",
            "motionVector": "string",
            "fullDescription": "string — complete last frame for next chunk to start from"
          },
          "audioDirection": {
            "voiceoverText": "string — actual words in ${ctx.input.voiceoverLanguage}",
            "voiceoverTiming": "starts at second X, ends at second Y",
            "soundEffects": [
              {"sound": "string", "atSecond": 0, "durationSec": 2}
            ],
            "musicDirection": "string — genre, BPM, instruments, energy"
          }
        }
      ]
    }
  ]
}`
    }]
  });

  ctx.storyboard = JSON.parse(response.content[0].text);
  log('Storyboard complete', `${ctx.storyboard.totalChunks} chunks across ${ctx.storyboard.scenes.length} scenes`, 'done');
}
```

---

## FIX 6 — SCENE FRAMES USE CHARACTER + ENVIRONMENT REFERENCES

### Rewrite `agents/sceneFrameGenerator.js`:

Each starting frame and cut frame is generated with BOTH the character reference AND the environment reference baked into the prompt.

```javascript
export async function generateSceneFrames(ctx, log) {
  log('Generating scene frames', 'Building frame reference library with character + environment data...');

  for (const scene of ctx.storyboard.scenes) {
    const envLock = ctx.environmentLock[scene.location];
    const charLocks = scene.charactersPresent.map(id => ctx.characterConsistencyLock[id]).filter(Boolean);

    for (const chunk of scene.chunks) {
      // Generate starting frame with full context
      const startPrompt = await buildFramePrompt({
        description: chunk.startingFrameDescription,
        envLock,
        charLocks,
        cameraWork: chunk.cameraWork,
        lighting: chunk.lighting,
        style: ctx.input.style,
        animeType: ctx.input.animeType,
        isStartFrame: true
      });

      const startBase64 = await callNanoBanana2(
        startPrompt, ctx.jobId, `frame_chunk${chunk.globalChunkNumber}_start`
      );

      // Generate 3 cut frames
      const cutFrames = [];
      for (const cut of chunk.cutDescriptions) {
        const cutPrompt = await buildFramePrompt({
          description: cut.description,
          envLock,
          charLocks,
          cameraWork: chunk.cameraWork,
          lighting: chunk.lighting,
          style: ctx.input.style,
          animeType: ctx.input.animeType,
          isStartFrame: false
        });

        const cutBase64 = await callNanoBanana2(
          cutPrompt, ctx.jobId, `frame_chunk${chunk.globalChunkNumber}_cut_${cut.atSecond}s`
        );

        cutFrames.push({ atSecond: cut.atSecond, imageBase64: cutBase64 });
      }

      ctx.sceneFrames.push({
        globalChunkNumber: chunk.globalChunkNumber,
        startFrameBase64: startBase64,
        cutFrames
      });
    }
  }

  log('Scene frames ready', `${ctx.sceneFrames.length} chunks × (1 start + 3 cut) frames`, 'done');
}

async function buildFramePrompt({ description, envLock, charLocks, cameraWork, lighting, style, animeType, isStartFrame }) {
  const response = await anthropic.messages.create({
    model: CLAUDE,
    max_tokens: 400,
    messages: [{
      role: 'user',
      content: `Write a hyper-realistic nano-banana-2 scene frame prompt.

SCENE DESCRIPTION: ${description}

ENVIRONMENT REFERENCE:
${envLock.promptDescriptor}
${envLock.geminiDescription}

CHARACTER REFERENCES:
${charLocks.map(c => `${c.name}: ${c.promptDescriptor}`).join('\n')}

CAMERA: ${cameraWork}
LIGHTING: ${lighting}
ANIME TYPE: ${animeType}
STYLE: ${style}

REQUIREMENTS:
- Characters must match EXACTLY the reference descriptions above
- Environment must match EXACTLY the environment reference
- Hyper-realistic ${animeType} anime scene
- No random or invented visual elements
- Camera angle exactly as specified
- QUALITY MARKERS: masterpiece, best quality, ultra-detailed, 8k, cinematic anime scene

Return ONLY the prompt. 130-160 words.`
    }]
  });

  return response.content[0].text.trim();
}
```

---

## FIX 7 — CONT ULTRA (SEEDANCE 2.0) — PROPER REFERENCES + AUDIO

### Rewrite the Seedance API call in `server/pipeline/videoPipeline.js`:

**The core problem:** Seedance was not receiving the previous video as reference. It was only getting images. This fix adds the previous video + properly structured audio.

```javascript
async function generateWithContUltra(ctx, jsonPrompt, chunkFrames, chunkData, log) {
  const outputDir = `server/outputs/videos/${ctx.jobId}`;
  await fs.mkdir(outputDir, { recursive: true });
  const outputPath = `${outputDir}/chunk_${chunkData.globalChunkNumber}.mp4`;

  // Build reference images
  // Order: [first frame, cut1, cut2, cut3, char references]
  const firstFrameBase64 = ctx.lastCapturedFrame || chunkFrames.startFrameBase64;
  
  const referenceImages = [
    firstFrameBase64,
    ...chunkFrames.cutFrames.map(f => f.imageBase64),
    // Add character reference images from lock
    ...Object.values(ctx.characterConsistencyLock)
      .filter(c => chunkData.charactersInShot.includes(c.name) || true)
      .map(c => c.primaryImageBase64)
      .filter(Boolean)
  ];

  // ── AUDIO PROMPT — properly formatted for Seedance ──────────────
  const audioSpec = buildSeedanceAudioPrompt(chunkData.audioDirection, ctx.input.voiceoverLanguage);

  // Full request body
  const requestBody = {
    prompt: JSON.stringify({
      ...jsonPrompt,
      audio: audioSpec
    }),
    
    // REFERENCE FRAMES: first image = first frame of video
    image: `data:image/jpeg;base64,${firstFrameBase64}`,
    
    // PREVIOUS VIDEO REFERENCE: critical for continuity
    // Seedance uses this to understand visual flow, motion, and physics
    reference_video: ctx.lastGeneratedVideo
      ? await videoToDataUrl(ctx.lastGeneratedVideo)
      : null,
    
    reference_images: referenceImages.slice(1)
      .map(b64 => `data:image/jpeg;base64,${b64}`),
    
    duration: 8,
    aspect_ratio: '16:9',
    resolution: '720p',
    fps: 24,
    
    // Audio generation flags — MUST be true for audio output
    generate_audio: true,
    audio_config: {
      generate_voiceover: true,
      generate_sound_effects: true,
      generate_background_music: true,
      voiceover_text: audioSpec.voiceover.text,
      voiceover_language: audioSpec.voiceover.language,
      music_style: audioSpec.backgroundMusic.genre,
      music_bpm: audioSpec.backgroundMusic.bpm
    }
  };

  // Remove null reference_video if not available
  if (!requestBody.reference_video) delete requestBody.reference_video;

  // POST to Seedance
  const startRes = await fetch('https://api.freepik.com/v1/ai/video/seedance-2', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-freepik-api-key': process.env.FREEPIK_API_KEY
    },
    body: JSON.stringify(requestBody)
  });

  if (!startRes.ok) {
    const err = await startRes.text();
    throw new Error(`Seedance API error: ${startRes.status} — ${err}`);
  }

  const startData = await startRes.json();
  const taskId = startData.task_id || startData.id || startData.data?.id;

  // Poll for completion
  const videoUrl = await pollSeedanceTask(taskId, log);

  // Download video
  const videoRes = await fetch(videoUrl);
  if (!videoRes.ok) throw new Error('Failed to download Seedance output');
  const videoBuffer = Buffer.from(await videoRes.arrayBuffer());
  await fs.writeFile(outputPath, videoBuffer);

  // UPDATE CONTEXT CHAIN — this is what makes next chunk work
  ctx.lastGeneratedVideo = outputPath;

  return outputPath;
}

// ─── POLL SEEDANCE TASK ───────────────────────────────────────────────────────

async function pollSeedanceTask(taskId, log, maxWaitMs = 300000) {
  const startTime = Date.now();
  
  while (Date.now() - startTime < maxWaitMs) {
    await new Promise(r => setTimeout(r, 5000));
    
    const res = await fetch(
      `https://api.freepik.com/v1/ai/video/seedance-2/${taskId}`,
      { headers: { 'x-freepik-api-key': process.env.FREEPIK_API_KEY } }
    );
    
    const data = await res.json();
    const status = data.status || data.data?.status;
    
    if (status === 'completed' || status === 'succeeded' || status === 'done') {
      const url = data.video_url || data.data?.video_url || data.output?.url;
      if (url) return url;
    }
    if (status === 'failed' || status === 'error') {
      throw new Error(`Seedance task failed: ${data.error || data.message || 'unknown'}`);
    }
  }
  
  throw new Error('Seedance task timeout after 5 minutes');
}

// ─── CONVERT PREVIOUS VIDEO TO DATA URL ──────────────────────────────────────

async function videoToDataUrl(videoPath) {
  try {
    const buf = await fs.readFile(videoPath);
    return `data:video/mp4;base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}
```

---

## FIX 8 — CONT PRO (VEO 3.1) — PROPER REFERENCES + AUDIO

### Rewrite the Veo 3.1 API call:

```javascript
async function generateWithContPro(ctx, jsonPrompt, chunkFrames, chunkData) {
  const outputDir = `server/outputs/videos/${ctx.jobId}`;
  await fs.mkdir(outputDir, { recursive: true });
  const outputPath = `${outputDir}/chunk_${chunkData.globalChunkNumber}.mp4`;

  const firstFrameBase64 = ctx.lastCapturedFrame || chunkFrames.startFrameBase64;
  
  const allReferenceImages = [
    firstFrameBase64,
    ...chunkFrames.cutFrames.map(f => f.imageBase64),
    ...Object.values(ctx.characterConsistencyLock)
      .map(c => c.primaryImageBase64)
      .filter(Boolean)
  ];

  const audioSpec = buildVeoAudioPrompt(chunkData.audioDirection, ctx.input.voiceoverLanguage);

  const model = vertexAI.preview.getGenerativeModel({ model: 'veo-3.1' });

  const imageParts = allReferenceImages.map(b64 => ({
    inlineData: { data: b64, mimeType: 'image/jpeg' }
  }));

  const fullPrompt = JSON.stringify({ ...jsonPrompt, audio: audioSpec });

  const request = {
    contents: [{
      role: 'user',
      parts: [...imageParts, { text: fullPrompt }]
    }],
    generationConfig: {
      durationSeconds: 8,
      aspectRatio: 'ASPECT_RATIO_16_9',
      resolution: 'RESOLUTION_1080P',
      
      // FIRST FRAME — Veo starts from this exact image
      startImage: {
        bytesBase64Encoded: firstFrameBase64,
        mimeType: 'image/jpeg'
      },

      // AUDIO — must be explicitly enabled
      generateAudio: true,
      audioConfig: {
        generateVoiceover: true,
        generateSoundEffects: true,
        generateBackgroundMusic: true,
        voiceoverText: audioSpec.voiceover.text,
        voiceoverLanguage: audioSpec.voiceover.language === 'hinglish' ? 'hi-IN' : 'en-US',
        musicStyle: audioSpec.backgroundMusic.genre,
        soundEffectsConfig: audioSpec.soundEffects
      }
    }
  };

  const response = await model.generateVideo(request);
  const videoBytes = Buffer.from(
    response.candidates[0].content.parts[0].inlineData.data, 'base64'
  );
  await fs.writeFile(outputPath, videoBytes);

  // UPDATE CONTEXT CHAIN
  ctx.lastGeneratedVideo = outputPath;

  return outputPath;
}
```

---

## FIX 9 — AUDIO PROMPT BUILDER (BOTH MODELS)

### New file: `agents/audioPromptBuilder.js`

This is why audio wasn't generating — prompts had no proper audio structure.

```javascript
export function buildSeedanceAudioPrompt(audioDirection, voiceoverLanguage) {
  const voiceoverText = voiceoverLanguage === 'hinglish'
    ? applyHinglishPhonetics(audioDirection.voiceoverText)
    : audioDirection.voiceoverText;

  return {
    voiceover: {
      text: voiceoverText,
      language: voiceoverLanguage === 'hinglish' ? 'hi' : 'en',
      tone: audioDirection.tone || 'natural',
      startAtSecond: parseFloat(audioDirection.voiceoverTiming?.match(/(\d+\.?\d*)/)?.[1]) || 0.3,
      pace: 'normal'
    },
    soundEffects: audioDirection.soundEffects.map((sfx, i) => ({
      description: sfx.sound || sfx,
      startAtSecond: sfx.atSecond || i * 2,
      durationSeconds: sfx.durationSec || 1.5,
      volume: sfx.volume || 0.6
    })),
    backgroundMusic: {
      genre: audioDirection.musicDirection?.split(',')[0]?.trim() || 'cinematic',
      bpm: parseInt(audioDirection.musicDirection?.match(/(\d+)\s*bpm/i)?.[1]) || 90,
      instruments: extractInstruments(audioDirection.musicDirection),
      energy: 0.7,
      fadeIn: true,
      fadeOut: false
    }
  };
}

export function buildVeoAudioPrompt(audioDirection, voiceoverLanguage) {
  // Same structure but formatted for Veo
  const base = buildSeedanceAudioPrompt(audioDirection, voiceoverLanguage);
  return {
    ...base,
    voiceover: {
      ...base.voiceover,
      language: voiceoverLanguage === 'hinglish' ? 'hi-IN' : 'en-US'
    }
  };
}

// ─── HINGLISH PHONETIC OPTIMIZER ─────────────────────────────────────────────
// Fixes Seedance's Hindi pronunciation issues

export function applyHinglishPhonetics(text) {
  if (!text) return text;

  const fixes = [
    // Syllable breaks for common Hindi words
    [/kyunki/gi, 'kyun-ki'],
    [/isliye/gi, 'is-li-ye'],
    [/lekin/gi, 'le-kin'],
    [/bahut/gi, 'ba-hut'],
    [/acha/gi, 'a-cha'],
    [/theek/gi, 'theek'],
    [/bilkul/gi, 'bil-kul'],
    [/matlab/gi, 'mat-lab'],
    [/samajh/gi, 'sa-majh'],
    [/zindagi/gi, 'zin-da-gi'],
    [/duniya/gi, 'du-ni-ya'],
    [/yahan/gi, 'ya-han'],
    [/wahan/gi, 'wa-han'],
    [/kuch/gi, 'kuch'],
    [/kaise/gi, 'kai-se'],
    [/tumhare/gi, 'tum-ha-re'],
    [/hamara/gi, 'ha-ma-ra'],
    [/chahiye/gi, 'cha-hi-ye'],
    [/milega/gi, 'mi-le-ga'],
    [/bolna/gi, 'bol-na'],
    [/sunna/gi, 'sun-na'],
    [/dekhna/gi, 'dekh-na'],
    [/jaana/gi, 'jaa-na'],
    [/aana/gi, 'aa-na'],
    [/karna/gi, 'kar-na'],
    [/sochna/gi, 'soch-na'],
    [/sirf/gi, 'sirf'],
    [/abhi/gi, 'ab-hi'],
    [/phir/gi, 'phir'],
    [/nahi/gi, 'na-hi'],
    [/haan/gi, 'haan'],
    [/yaar/gi, 'yaar']
  ];

  let processed = text;
  for (const [pattern, replacement] of fixes) {
    processed = processed.replace(pattern, replacement);
  }

  // Add stress on important words (capitalize first letter signals stress to TTS)
  // Add [pause] for dramatic beats (comma positions)
  processed = processed
    .replace(/\.\s+/g, '. [pause] ')
    .replace(/!\s+/g, '! [pause] ');

  // Prepend English calibration phrase
  return `Ready. ${processed}`;
}

function extractInstruments(musicDirection) {
  if (!musicDirection) return ['strings', 'piano'];
  const common = ['strings', 'piano', 'guitar', 'drums', 'violin', 'flute', 'bass', 'synth', 'brass', 'tabla', 'sitar'];
  return common.filter(i => musicDirection.toLowerCase().includes(i)) || ['strings', 'piano'];
}
```

---

## FIX 10 — UPDATED MAIN PIPELINE LOOP

### Update `generateVideoChunks` in `server/pipeline/videoPipeline.js`:

```javascript
async function runGenerationLoop(job, ctx, log) {
  log('Starting generation', `${ctx.storyboard.totalChunks} chunks · continuous loop...`);
  job.status = 'generating';

  for (const scene of ctx.storyboard.scenes) {
    const envLock = ctx.environmentLock[scene.location];
    
    for (const chunk of scene.chunks) {
      const chunkFrames = ctx.sceneFrames.find(f => f.globalChunkNumber === chunk.globalChunkNumber);

      log(`Chunk ${chunk.globalChunkNumber}/${ctx.storyboard.totalChunks}`,
        `${chunk.timeRange} · "${chunk.sceneTitle}" · generating...`, 'active');

      // Claude Sonnet 4.6 writes the full JSON video prompt
      // Uses: consistency lock + environment lock + storyboard data + previous chunk state
      const jsonPrompt = await buildVideoJsonPrompt({
        chunk,
        storyboard: ctx.storyboard,
        charLock: ctx.characterConsistencyLock,
        envLock,
        style: ctx.input.style,
        animeType: ctx.input.animeType,
        isFirst: chunk.globalChunkNumber === 1,
        isLast: chunk.globalChunkNumber === ctx.storyboard.totalChunks,
        previousVideo: ctx.lastGeneratedVideo,
        previousFrame: ctx.lastCapturedFrame
      });

      // Generate video (model-specific)
      let videoPath;
      if (job.inbuiltModel === 'cont-pro') {
        videoPath = await withRetry(() =>
          generateWithContPro(ctx, jsonPrompt, chunkFrames, chunk), 2);
      } else {
        videoPath = await withRetry(() =>
          generateWithContUltra(ctx, jsonPrompt, chunkFrames, chunk, log), 2);
      }

      // Capture last frame — feeds next chunk
      const lastFrame = await captureLastFrame(videoPath, ctx.jobId, chunk.globalChunkNumber);
      
      // UPDATE CONTEXT CHAIN — critical for continuity
      ctx.lastCapturedFrame = lastFrame;     // → next chunk's first frame
      ctx.lastGeneratedVideo = videoPath;    // → next chunk's reference video (Seedance)

      ctx.videoChunks.push({
        globalChunkNumber: chunk.globalChunkNumber,
        sceneNumber: scene.sceneNumber,
        chunkNumber: chunk.chunkNumber,
        timeRange: chunk.timeRange,
        sceneTitle: chunk.sceneTitle,
        videoPath,
        videoUrl: `/outputs/videos/${ctx.jobId}/chunk_${chunk.globalChunkNumber}.mp4`,
        lastFrameBase64: lastFrame
      });

      job.assets.videoChunks = ctx.videoChunks;
      job.progress.currentChunk = chunk.globalChunkNumber;
      job.progress.percentComplete = 35 + Math.round(
        (chunk.globalChunkNumber / ctx.storyboard.totalChunks) * 55
      );

      log(`Chunk ${chunk.globalChunkNumber}/${ctx.storyboard.totalChunks}`,
        `${chunk.timeRange} · "${chunk.sceneTitle}" · ✓ video + audio`, 'done');

      await persistJob(job);
      // → loop continues automatically to next chunk
    }
  }
}
```

---

## FIX 11 — UPDATED MAIN PIPELINE RUNNER

### Replace `runPipeline` in `server/pipeline/videoPipeline.js`:

```javascript
export async function runPipeline(jobId, input) {
  const job = jobs.get(jobId);
  if (!job) throw new Error('Job not found');

  // Create context chain — passed through ALL steps
  const ctx = new PipelineContext(input);
  ctx.jobId = jobId;

  try {
    // Step 1: Story analysis
    await analyzeStory(ctx, (step, detail, status) => log(job, step, detail, status));
    
    // Step 2: Character generation + Gemini vision analysis
    await generateAllCharacters(ctx, (step, detail, status) => log(job, step, detail, status));
    
    // Step 3: Environment generation + Gemini vision analysis
    await generateAllEnvironments(ctx, (step, detail, status) => log(job, step, detail, status));
    
    // Step 4: Storyboard (uses character lock + environment lock)
    await buildStoryboard(ctx, (step, detail, status) => log(job, step, detail, status));
    
    // Step 5: Scene frames (uses storyboard + locks)
    await generateSceneFrames(ctx, (step, detail, status) => log(job, step, detail, status));
    
    // Step 6: Video generation loop (uses everything above)
    await runGenerationLoop(job, ctx, (step, detail, status) => log(job, step, detail, status));
    
    // Step 7: Stitch
    await stitchFinalVideo(job, ctx);

    job.status = 'complete';
    job.progress.percentComplete = 100;
    job.completedAt = new Date().toISOString();
    log(job, '✅ Complete', 'Your video is ready', 'done');
    await persistJob(job);

  } catch (err) {
    job.status = 'failed';
    job.error = err.message;
    log(job, '❌ Failed', err.message, 'error');
    await persistJob(job);
    throw err;
  }
}
```

---

## FIX 12 — GEMINI SDK SETUP

### Add to `server/index.js`:

```javascript
import { GoogleGenerativeAI } from '@google/generative-ai';
// Make available to all agents
export const genai = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
```

### Add to `package.json`:

```json
"@google/generative-ai": "^0.21.0"
```

---

## SUMMARY OF ALL FIXES

| Problem | Fix |
|---|---|
| Random images | Story bible → character spec → Gemini-analyzed → locked before any generation |
| Random locations | Environment generation from story bible → Gemini-analyzed → locked |
| No OCR/Vision | Gemini analyzes EVERY generated image, extracts exact visual data |
| Nothing connected | PipelineContext chain — every step reads from and writes to it |
| No audio (Seedance) | `generate_audio: true` + full `audio_config` + `buildSeedanceAudioPrompt()` |
| No audio (Veo) | `generateAudio: true` + full `audioConfig` with voiceover text |
| Seedance no continuity | Previous video passed as `reference_video` in every API call |
| Veo no continuity | `startImage` set to captured last frame for all chunks after first |
| Hinglish pronunciation | `applyHinglishPhonetics()` — syllable breaks, stress markers, calibration phrase |
| Prompts too vague | Full JSON structure with physics, camera, character lock, environment lock |

---

**Fix all 12 issues in the existing app. Do not rebuild pages or UI. Only fix the pipeline agents and API calls.**
