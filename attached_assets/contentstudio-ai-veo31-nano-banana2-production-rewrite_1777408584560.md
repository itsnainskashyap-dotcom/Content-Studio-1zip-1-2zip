# ADD-ON PROMPT — ContentStudio AI Production-Grade Inbuilt Video Generator
## Claude Sonnet 4.6 → nano-banana-2 → Veo 3.1 → FFmpeg Continuity Pipeline

Paste this into Replit AI. This REPLACES the previous inbuilt video generator prompt. Do NOT rebuild the existing app. Extend the existing ContentStudio AI app only.

---

## MAIN GOAL

Add a production-grade **Inbuilt Video Generator** mode to ContentStudio AI.

The user gives a story, character, location, genre, visual style, language, and duration. The app must automatically create a complete video by using this exact pipeline:

```text
USER STORY INPUT
  ↓
claude-sonnet-4-6
  → story analysis
  → consistency bible
  → screenplay beats
  → exact chunk durations
  → visual storyboard plan
  → nano-banana-2 image prompts
  → optimized Veo 3.1 JSON prompts
  ↓
nano-banana-2
  → character reference sheets
  → face close-ups
  → expression sheets
  → location references
  → style references
  → first frame for chunk 1
  → cut-scene reference frames for each chunk
  ↓
FRAME QC LOOP
  → check face, style, costume, location, lighting, hands, quality
  → if score < 8/10, regenerate with correction prompt
  ↓
veo-3.1
  → receives JSON prompt + first frame + nano-banana-2 visual storyboard refs
  → generates max 8-second video chunk with video + voiceover + SFX + ambience + BGM
  ↓
CHUNK QC LOOP
  → extract start/mid/end frames
  → validate character, physics, style, audio, continuity, ending state
  → if score < 8/10, regenerate chunk with stricter correction prompt
  ↓
FFmpeg
  → capture last frame from approved chunk
  → feed that frame as next chunk first frame
  ↓
Repeat until final duration is complete
  ↓
FFmpeg final stitch + audio loudness normalization + thumbnail + optional subtitles
  ↓
FINAL MP4
```

---

## CRITICAL MODEL NAMES — USE EXACTLY

Every `model:` field in the entire codebase must use exactly these strings:

```javascript
const CLAUDE_MODEL = 'claude-sonnet-4-6';
const IMAGE_MODEL = 'nano-banana-2';
const VIDEO_MODEL = 'veo-3.1';
```

Never use these old model names anywhere:

```text
imagen-3
imagen-3.0-generate-002
claude-opus-4-5
claude-sonnet-4-5
```

Rename old functions, variables, comments, logs, UI labels, and test names:

```javascript
callImagen3()                  → callNanoBanana2()
generateImagenPrompt           → generateNanoBananaPrompt
generateSceneFrames            → generateVisualStoryboardFrames
Imagen character references     → nano-banana-2 character references
Imagen frame generation         → nano-banana-2 visual storyboard generation
```

UI label should show **nano banana 2** or **nano-banana-2**, never Imagen.

---

## MODEL RESPONSIBILITIES

### 1. Claude Sonnet 4.6 — Director, Screenwriter, Continuity Supervisor, Prompt Brain

Claude does NOT create images and does NOT create videos. Claude writes the complete creative and technical plan.

Claude must create:

- story analysis
- screenplay beats
- exact chunk duration plan
- project consistency bible
- character bible
- world/location bible
- visual style bible
- audio bible
- physics bible
- negative prompt bible
- nano-banana-2 prompts for all visual assets
- Veo 3.1 JSON prompt for every video chunk
- QC criteria for every frame and video chunk
- retry correction instructions if quality fails

All Claude output must be valid JSON only. No markdown. No explanations.

### 2. nano-banana-2 — Visual Storyboard and Reference Frame Generator

nano-banana-2 receives image prompts from Claude and generates all visual references.

nano-banana-2 must generate:

- main character full-body front reference
- main character face close-up
- main character side profile
- main character emotion/expression sheet
- secondary character references, max 2 characters
- primary location reference
- lighting/style reference
- first frame for chunk 1
- cut-scene reference frames for every chunk
- close-up frames for dialogue scenes
- action pose frames for action scenes
- atmosphere/reveal/reaction frames for thriller/horror scenes

nano-banana-2 output is image assets only.

### 3. QC Layer — Mandatory Quality Gate

No nano-banana-2 frame or Veo 3.1 chunk can move forward unless it passes QC.

Minimum passing score: **8/10**.

Max retries per frame: **2**.
Max retries per video chunk: **2**.

QC checks must include:

- face consistency
- costume consistency
- body/build consistency
- location continuity
- style continuity
- lighting continuity
- hand/eye quality
- no random objects
- no duplicate characters
- no text/watermark/logo
- scene matches storyboard beat
- physics and motion plausibility
- audio continuity for video chunks

### 4. Veo 3.1 — Final Video Chunk Generator

Veo 3.1 receives:

- strict JSON prompt only
- first frame image
- previous chunk last frame for continuation chunks
- nano-banana-2 cut-scene frames
- character references
- location references
- style references

Veo 3.1 must generate:

- final video chunk
- camera movement
- realistic physics
- character movement
- voiceover
- sound effects
- ambience
- background music
- cinematic image quality

Veo prompt must be JSON, not plain text.

---

## EXACT DURATION RULE

Veo 3.1 generates maximum 8 seconds per call. Do not accidentally create extra duration.

Use this exact function:

```javascript
function buildChunkDurations(totalDurationSeconds) {
  const chunks = [];
  let remaining = totalDurationSeconds;
  let chunkNumber = 1;

  while (remaining > 0) {
    const durationSeconds = Math.min(8, remaining);
    chunks.push({ chunkNumber, durationSeconds });
    remaining -= durationSeconds;
    chunkNumber++;
  }

  return chunks;
}
```

Examples:

```text
30 seconds = 8 + 8 + 8 + 6
45 seconds = 8 + 8 + 8 + 8 + 8 + 5
60 seconds = 8 + 8 + 8 + 8 + 8 + 8 + 8 + 4
```

---

## REQUIRED PROJECT BIBLE

Before creating chunks, Claude must generate a permanent `projectBible`. This bible must be injected into every nano-banana-2 image prompt and every Veo 3.1 JSON prompt.

```json
{
  "projectBible": {
    "mainCharacterLock": {
      "name": "character name",
      "face": "exact face shape, age, skin tone, eyes, eyebrows, nose, lips, hairstyle, facial hair if any",
      "body": "height, build, posture, movement style",
      "clothing": "fixed costume, colors, fabric, accessories, footwear",
      "expressionRange": "allowed emotions and facial expression style",
      "voice": "age, tone, accent, speaking speed, emotional delivery",
      "doNotChange": [
        "face shape",
        "hairstyle",
        "clothes",
        "skin tone",
        "body build",
        "eye color",
        "core personality"
      ]
    },
    "secondaryCharacterLocks": [],
    "worldLock": {
      "primaryLocation": "exact location description",
      "era": "time period or world type",
      "environmentRules": "what must stay fixed in the world",
      "objectContinuity": "important props and their positions",
      "timeOfDay": "fixed or gradual change only",
      "weather": "weather and atmosphere continuity"
    },
    "visualStyleLock": {
      "style": "selected style",
      "cameraLanguage": "cinematic grammar, lens, movement style",
      "colorPalette": "fixed color palette",
      "lightingRules": "lighting direction, quality, color temperature",
      "qualityFloor": "sharp face, stable hands, smooth motion, no flicker, no style drift"
    },
    "audioBible": {
      "musicStyle": "music genre and mood",
      "bpm": "recommended BPM if relevant",
      "key": "musical key if relevant",
      "instruments": ["instrument 1", "instrument 2"],
      "voiceoverStyle": "same narrator/character voice across every chunk",
      "mixingRules": "voice clear, music under voice, no sudden volume jumps",
      "continuityRule": "continue the same sonic world across chunks; do not restart music unless scene demands it"
    },
    "physicsBible": {
      "humanMotion": "natural weight transfer, grounded foot contact, realistic acceleration",
      "clothHair": "cloth and hair react naturally to body movement and wind",
      "environmentPhysics": "dust, smoke, water, fire, sparks, leaves, and particles obey gravity and wind",
      "cameraPhysics": "no impossible camera teleportation; camera movement must be motivated and smooth",
      "objectPhysics": "objects stay in place unless moved on screen"
    },
    "negativePromptBible": [
      "no face morphing",
      "no costume change",
      "no extra fingers",
      "no broken hands",
      "no distorted eyes",
      "no duplicate main character",
      "no random text",
      "no watermark",
      "no logo",
      "no sudden background change",
      "no camera teleportation",
      "no inconsistent lighting",
      "no blurry face",
      "no robotic body movement",
      "no lip-sync mismatch",
      "no scene reset between chunks"
    ]
  }
}
```

---

## CLAUDE STORYBOARD JSON STRUCTURE

Update `buildStoryboard()` so Claude returns this exact JSON structure:

```json
{
  "title": "Final video title",
  "totalDurationSeconds": 60,
  "chunkDurations": [
    { "chunkNumber": 1, "durationSeconds": 8 },
    { "chunkNumber": 2, "durationSeconds": 8 },
    { "chunkNumber": 8, "durationSeconds": 4 }
  ],
  "narrativeArc": "Complete story arc description",
  "projectBible": {},
  "nanoBananaVisualStoryboard": {
    "characterReferencePrompts": [
      {
        "assetType": "main_character_full_body_front",
        "prompt": "nano-banana-2 prompt. Include projectBible character lock, clothing, face, body, clean background, selected visual style."
      },
      {
        "assetType": "main_character_face_closeup",
        "prompt": "nano-banana-2 prompt for face identity lock."
      },
      {
        "assetType": "main_character_side_profile",
        "prompt": "nano-banana-2 prompt for side profile."
      },
      {
        "assetType": "main_character_expression_sheet",
        "prompt": "nano-banana-2 prompt showing 4 to 6 expressions while preserving same face."
      }
    ],
    "locationReferencePrompts": [
      {
        "assetType": "primary_location_reference",
        "prompt": "nano-banana-2 prompt for main location with locked lighting, color palette, props, atmosphere."
      }
    ],
    "styleReferencePrompts": [
      {
        "assetType": "style_reference",
        "prompt": "nano-banana-2 prompt that defines exact visual style, lighting, camera tone, color grade."
      }
    ]
  },
  "chunks": [
    {
      "chunkNumber": 1,
      "timeRange": "00:00-00:08",
      "durationSeconds": 8,
      "sceneTitle": "Scene title",
      "sceneType": "action / dialogue / emotional / horror / reveal / transition / montage",
      "narrativePurpose": "What this chunk achieves in the story",
      "continuityFromPrevious": "For chunk 1: opening frame. For chunk 2+: continue from previous captured last frame.",
      "nanoBananaPrompts": {
        "firstFramePrompt": "Prompt for exact first frame of this chunk. For chunk 1, this creates the opening first frame. For later chunks, use only if fallback is needed because actual first frame must come from previous last frame.",
        "cutSceneFramePrompts": [
          {
            "frameType": "wide_establishing / closeup / action_pose / reaction / reveal / atmosphere / ending_pose",
            "timeTarget": "00:02",
            "prompt": "nano-banana-2 prompt for this specific visual beat. Must inject projectBible."
          }
        ],
        "faceConsistencyPrompt": "Generate a close-up if the face is visible in this chunk.",
        "actionPosePrompt": "Generate body/action reference if motion is complex.",
        "endingFrameReferencePrompt": "Optional visual reference for intended ending state."
      },
      "veoPromptJson": {
        "model": "veo-3.1",
        "duration_seconds": 8,
        "aspect_ratio": "16:9",
        "resolution": "1080p",
        "generate_audio": true,
        "first_frame_instruction": "Start exactly from the provided first frame. Do not redesign the character, outfit, background, lighting, camera angle, or style.",
        "continuity_instruction": "If this is chunk 2 or later, continue directly from the previous chunk's captured last frame. No intro, no reset, no sudden time jump, no costume change, no location change unless explicitly shown on screen.",
        "project_bible_summary": "Inject locked character, world, style, audio, physics, and negative prompt rules here.",
        "visual": {
          "scene_description": "Exact scene description.",
          "character_action": "Precise action for this chunk.",
          "environment": "Location, props, background, weather, atmosphere.",
          "style": "Selected visual style and camera tone.",
          "lighting": "Lighting direction, color temperature, intensity, shadows.",
          "color_palette": "Fixed color palette.",
          "character_consistency": "Locked face, clothing, body, expression continuity."
        },
        "timecoded_action": [
          {
            "time": "0.0-2.0",
            "visual": "Start from first frame, exact camera/action beat.",
            "camera": "Camera movement and framing for this beat.",
            "audio": "Voice/SFX/music/ambience for this beat."
          },
          {
            "time": "2.0-4.0",
            "visual": "Second beat.",
            "camera": "Second camera beat.",
            "audio": "Second audio beat."
          },
          {
            "time": "4.0-6.0",
            "visual": "Third beat.",
            "camera": "Third camera beat.",
            "audio": "Third audio beat."
          },
          {
            "time": "6.0-8.0",
            "visual": "Final beat ending on exact continuation frame.",
            "camera": "Final camera framing.",
            "audio": "Audio ending smoothly without abrupt cutoff."
          }
        ],
        "camera": {
          "lens": "35mm / 50mm / wide / macro etc.",
          "movement": "dolly, handheld, crane, orbit, push-in, whip pan, locked-off etc.",
          "framing": "wide, medium, close-up, over-shoulder etc.",
          "cut_style": "hard cut / match cut / whip pan / continuous camera / fade only if needed"
        },
        "physics_rules": {
          "motion": "Natural human body motion, grounded foot contact, no floating limbs, realistic weight transfer.",
          "camera": "No impossible camera teleportation, smooth motivated camera motion only.",
          "cloth_hair": "Cloth and hair respond naturally to wind and movement.",
          "environment": "Dust, smoke, water, fire, sparks, leaves, particles obey gravity, wind, impact, turbulence.",
          "object_continuity": "Objects remain in same position unless moved on screen."
        },
        "audio": {
          "voiceover": {
            "language": "User selected language",
            "line": "Exact voiceover or dialogue line for this chunk. Keep short enough for duration.",
            "voice_style": "Same narrator/character voice from audioBible.",
            "delivery": "Emotion, pace, pause, intensity, accent."
          },
          "sound_effects": [
            {
              "time": "00:02",
              "effect": "Specific SFX synced with action"
            }
          ],
          "ambient_sound": "Location ambience continuing across chunks.",
          "background_music": {
            "style": "Music style from audioBible.",
            "mood": "Mood for this chunk.",
            "instruments": "Instrument choices.",
            "energy": "low / medium / high",
            "continuity": "Continue same score from previous chunk unless story demands a musical shift.",
            "sync_notes": "Music hit points synced with cuts/action."
          },
          "mixing": "Voiceover clear, music lower under dialogue, SFX punchy but not clipping, no sudden volume jump."
        },
        "transition_to_next": {
          "type": "match cut / hard cut / whip pan / continuous movement / fade",
          "reason": "Why this transition maintains continuity.",
          "next_first_frame_instruction": "Next chunk starts from captured last frame with same character, lighting, location, camera direction."
        },
        "quality_controls": {
          "resolution": "1080p cinematic quality or higher",
          "motion_quality": "Smooth natural motion, no flicker, no warping, no rubber body movement.",
          "face_quality": "Stable recognizable face across frames.",
          "style_quality": "Maintain selected style without drifting.",
          "audio_quality": "Clean voiceover, coherent ambience, continuous music, no clipping.",
          "negative_prompt": [
            "no face morphing",
            "no changing clothes",
            "no extra fingers",
            "no duplicate characters",
            "no random text or watermark",
            "no sudden background change",
            "no camera teleportation",
            "no inconsistent lighting",
            "no blurry face",
            "no robotic body movement",
            "no lip-sync mismatch",
            "no distorted eyes or hands"
          ]
        },
        "ending_state": {
          "visual_description": "Exact final frame description for next chunk continuation.",
          "character_position": "Where the character ends.",
          "camera_position": "Where the camera ends.",
          "lighting_state": "Lighting at end frame.",
          "audio_state": "Music/ambience state at cut point."
        }
      },
      "qcCriteria": {
        "frameQcMustPass": ["face", "costume", "location", "style", "hands", "lighting", "storyboard_match"],
        "videoQcMustPass": ["start_frame_match", "ending_state_match", "physics", "audio", "continuity", "no_artifacts"],
        "minimumScore": 8,
        "maxRetries": 2
      }
    }
  ]
}
```

---

## DYNAMIC CUT-FRAME COUNT RULE

Do not always use exactly 4 cut frames. Choose based on scene type:

```javascript
function getCutFrameCount(sceneType) {
  const map = {
    dialogue: 4,
    emotional: 3,
    action: 6,
    horror: 5,
    thriller: 5,
    reveal: 4,
    montage: 6,
    transition: 3
  };
  return map[sceneType] || 4;
}
```

Frame type rules:

```text
Dialogue scene: wide + over-shoulder + face close-up + reaction
Emotional scene: close-up + hand/prop detail + ending expression
Action scene: wide + action pose + impact + reaction + environment movement + ending pose
Horror scene: atmosphere + shadow/reveal + reaction + threat hint + ending dread frame
Reveal scene: build-up + object detail + character reaction + reveal frame
Montage scene: 6 strong visual beats
Transition scene: current state + movement bridge + next state
```

---

## NANO-BANANA-2 FRAME GENERATION WITH QC

Create or update these functions:

```javascript
async function callNanoBanana2(prompt, jobId, filename) {
  const model = vertexAI.preview.getGenerativeModel({ model: 'nano-banana-2' });
  // Generate image from prompt and save as jpg/png.
  // Return { imageBase64, imageUrl, prompt }.
}

async function generateImageWithQc({ prompt, jobId, filename, qcContext }) {
  let attempts = 0;
  let lastResult = null;
  let correctionNotes = '';

  while (attempts < 3) {
    const finalPrompt = attempts === 0
      ? prompt
      : `${prompt}\n\nCORRECTION REQUIRED:\n${correctionNotes}\nPreserve projectBible exactly. Fix only the failed details.`;

    const image = await callNanoBanana2(finalPrompt, jobId, `${filename}_attempt_${attempts + 1}`);
    const qc = await validateNanoBananaFrame({ imageBase64: image.imageBase64, qcContext });

    lastResult = { ...image, qc, attempts: attempts + 1 };

    if (qc.score >= 8 && qc.passed === true) {
      return lastResult;
    }

    correctionNotes = qc.correctionPrompt;
    attempts++;
  }

  return lastResult;
}
```

Image QC validator:

```javascript
async function validateNanoBananaFrame({ imageBase64, qcContext }) {
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1200,
    system: `You are a strict AI image QC supervisor. Return only valid JSON.`,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'text',
          text: `Check this generated frame against the projectBible and storyboard requirement.

Return JSON:
{
  "passed": true,
  "score": 1-10,
  "issues": [],
  "faceConsistency": 1-10,
  "costumeConsistency": 1-10,
  "locationMatch": 1-10,
  "styleMatch": 1-10,
  "lightingMatch": 1-10,
  "handsEyesQuality": 1-10,
  "storyboardMatch": 1-10,
  "correctionPrompt": "short correction prompt for regeneration"
}

QC CONTEXT:
${JSON.stringify(qcContext, null, 2)}`
        },
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: 'image/jpeg',
            data: imageBase64
          }
        }
      ]
    }]
  });

  return JSON.parse(response.content[0].text);
}
```

Only QC-approved images should be passed to Veo 3.1.

---

## VEO 3.1 CHUNK GENERATION WITH QC

For every chunk:

```javascript
async function generateVideoChunkWithQc({ chunk, references, jobId, previousLastFrameBase64 }) {
  let attempts = 0;
  let lastResult = null;
  let correctionNotes = '';

  while (attempts < 3) {
    const promptJson = attempts === 0
      ? chunk.veoPromptJson
      : {
          ...chunk.veoPromptJson,
          correction_instruction: correctionNotes,
          stricter_rules: [
            'Follow provided first frame exactly',
            'Preserve character face and clothing',
            'Maintain same location and lighting',
            'Fix physics/motion/audio issues listed in correction_instruction',
            'End on the required ending_state'
          ]
        };

    const videoPath = await callVeo31({
      promptJson: JSON.stringify(promptJson, null, 2),
      referenceImagesBase64: references,
      jobId,
      chunkNumber: chunk.chunkNumber,
      durationSeconds: chunk.durationSeconds
    });

    const qcFrames = await extractQcFrames(videoPath, jobId, chunk.chunkNumber);
    const videoQc = await validateVeoChunk({
      qcFrames,
      chunk,
      projectBible: chunk.projectBible,
      videoPath
    });

    lastResult = { videoPath, qcFrames, videoQc, attempts: attempts + 1 };

    if (videoQc.passed === true && videoQc.score >= 8) {
      return lastResult;
    }

    correctionNotes = videoQc.correctionPrompt;
    attempts++;
  }

  return lastResult;
}
```

Extract start, middle, and end frames:

```javascript
async function extractQcFrames(videoPath, jobId, chunkNumber) {
  const outputDir = `server/outputs/images/${jobId}/qc_chunk_${chunkNumber}`;
  await fs.mkdir(outputDir, { recursive: true });

  const startPath = `${outputDir}/start.jpg`;
  const midPath = `${outputDir}/mid.jpg`;
  const endPath = `${outputDir}/end.jpg`;

  await runCommand(`ffmpeg -i "${videoPath}" -ss 00:00:00.2 -vframes 1 -q:v 2 "${startPath}" -y`);
  await runCommand(`ffmpeg -i "${videoPath}" -ss 00:00:04.0 -vframes 1 -q:v 2 "${midPath}" -y`);
  await runCommand(`ffmpeg -sseof -0.1 -i "${videoPath}" -vframes 1 -q:v 2 "${endPath}" -y`);

  return {
    startBase64: (await fs.readFile(startPath)).toString('base64'),
    midBase64: (await fs.readFile(midPath)).toString('base64'),
    endBase64: (await fs.readFile(endPath)).toString('base64'),
    startPath,
    midPath,
    endPath
  };
}
```

Video QC validator:

```javascript
async function validateVeoChunk({ qcFrames, chunk, projectBible, videoPath }) {
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1600,
    system: `You are a strict AI video continuity and quality supervisor. Return only valid JSON.`,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'text',
          text: `Validate this video chunk using its start, middle, and end frames.

Return JSON:
{
  "passed": true,
  "score": 1-10,
  "issues": [],
  "startFrameMatch": 1-10,
  "characterConsistency": 1-10,
  "costumeConsistency": 1-10,
  "styleConsistency": 1-10,
  "locationContinuity": 1-10,
  "physicsQuality": 1-10,
  "cameraQuality": 1-10,
  "endingStateMatch": 1-10,
  "artifactScore": 1-10,
  "audioExpectedCheck": "describe whether prompt likely contains correct audio requirements",
  "correctionPrompt": "specific correction instructions for Veo regeneration"
}

CHUNK:
${JSON.stringify(chunk, null, 2)}

PROJECT BIBLE:
${JSON.stringify(projectBible, null, 2)}`
        },
        {
          type: 'image',
          source: { type: 'base64', media_type: 'image/jpeg', data: qcFrames.startBase64 }
        },
        {
          type: 'image',
          source: { type: 'base64', media_type: 'image/jpeg', data: qcFrames.midBase64 }
        },
        {
          type: 'image',
          source: { type: 'base64', media_type: 'image/jpeg', data: qcFrames.endBase64 }
        }
      ]
    }]
  });

  return JSON.parse(response.content[0].text);
}
```

---

## FIRST-FRAME / LAST-FRAME CONTINUITY LOOP

This is the core innovation. Do not remove it.

Rules:

```text
Chunk 1 first frame = nano-banana-2 approved first frame.
Chunk 2+ first frame = FFmpeg-captured last frame from previous approved Veo chunk.
Chunk 2+ must not use a newly generated first frame unless fallback recovery is required.
Every Veo prompt must state that the first frame is locked and must not be redesigned.
Every chunk must end in a planned ending_state so the next chunk can continue smoothly.
```

Implementation:

```javascript
let previousLastFrameBase64 = null;

for (const chunk of storyboard.chunks) {
  const firstFrameBase64 = chunk.chunkNumber === 1
    ? approvedNanoBananaFrames[`chunk_${chunk.chunkNumber}_first`].imageBase64
    : previousLastFrameBase64;

  const referenceImages = [
    firstFrameBase64,
    ...approvedNanoBananaFrames[`chunk_${chunk.chunkNumber}_cutFrames`].map(f => f.imageBase64),
    ...approvedCharacterReferences.map(f => f.imageBase64),
    ...approvedLocationReferences.map(f => f.imageBase64),
    ...approvedStyleReferences.map(f => f.imageBase64)
  ];

  const approvedChunk = await generateVideoChunkWithQc({
    chunk,
    references: referenceImages,
    jobId,
    previousLastFrameBase64
  });

  previousLastFrameBase64 = await captureLastFrameFromVideo(
    approvedChunk.videoPath,
    jobId,
    chunk.chunkNumber
  );
}
```

---

## VEO PROMPT JSON RULES

Every Veo prompt must include:

```text
1. duration_seconds
2. first_frame_instruction
3. continuity_instruction
4. project_bible_summary
5. visual scene description
6. timecoded_action
7. camera rules
8. physics rules
9. audio: voiceover, SFX, ambience, BGM, mixing
10. transition_to_next
11. quality_controls
12. negative_prompt
13. ending_state
```

Do not send a plain paragraph to Veo. Always send:

```javascript
const veoPrompt = JSON.stringify(chunk.veoPromptJson, null, 2);
```

---

## AUDIO CONTINUITY RULES

Because Veo 3.1 generates native audio in every chunk, enforce audio continuity through the `audioBible` and every chunk prompt.

Each chunk must include:

```json
{
  "audioContinuity": {
    "narratorVoice": "same voice, same accent, same tone as previous chunk",
    "music": "continue the same background score; do not restart unless scene changes dramatically",
    "ambience": "same location ambience across continuous scenes",
    "mixing": "keep voice clear, music under dialogue, no clipping, no sudden loudness jump",
    "chunkEnding": "audio should end smoothly so FFmpeg stitch does not feel abrupt"
  }
}
```

For final stitch, add loudness normalization.

---

## FINAL STITCH AND POLISH

Use FFmpeg to stitch approved chunks only.

Required final outputs:

```text
server/outputs/videos/[jobId]/final.mp4
server/outputs/videos/[jobId]/thumbnail.jpg
server/jobs/[jobId].json
```

Recommended FFmpeg command:

```javascript
await runCommand(
  `ffmpeg -f concat -safe 0 -i "${concatPath}" ` +
  `-c:v libx264 -preset fast -crf 18 ` +
  `-c:a aac -b:a 192k ` +
  `-af "loudnorm=I=-16:TP=-1.5:LRA=11" ` +
  `-movflags +faststart ` +
  `"${finalVideoPath}" -y`
);
```

Thumbnail:

```javascript
await runCommand(
  `ffmpeg -i "${finalVideoPath}" -ss 00:00:02 -vframes 1 -q:v 2 "${thumbnailPath}" -y`
);
```

Optional subtitle support:

```text
If user enables subtitles:
- Claude creates chunk-level subtitle lines.
- Save .srt file.
- Offer both clean video and subtitle-burned video.
```

---

## JOB STATE STRUCTURE

Update job assets to store QC and retries:

```javascript
const job = {
  jobId,
  projectId,
  status: 'queued',
  progress: {
    currentStep: 'Queued',
    currentChunk: 0,
    totalChunks: 0,
    percentComplete: 0,
    stepsLog: []
  },
  projectBible: null,
  storyboard: null,
  assets: {
    characterReferences: [],
    locationReferences: [],
    styleReferences: [],
    visualStoryboardFrames: [],
    approvedFrames: [],
    rejectedFrames: [],
    videoChunks: [],
    approvedVideoChunks: [],
    rejectedVideoChunks: [],
    lastFrames: [],
    finalVideo: null,
    thumbnail: null,
    subtitles: null
  },
  qc: {
    imageQcReports: [],
    videoQcReports: [],
    retries: []
  },
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  completedAt: null,
  error: null
};
```

Persist job state after every major step, every QC result, every retry, every approved chunk, and final render.

---

## PROGRESS UI TEXT

Update progress UI to show this chain:

```text
1. Claude Sonnet 4.6 writing story context
2. Claude creating project consistency bible
3. Claude creating nano-banana-2 visual prompts
4. Claude creating Veo 3.1 JSON prompts
5. nano-banana-2 generating character references
6. QC checking character references
7. nano-banana-2 generating location/style references
8. QC checking location/style references
9. nano-banana-2 generating visual storyboard frames
10. QC checking visual storyboard frames
11. Veo 3.1 generating chunk 1/N
12. QC checking chunk 1/N
13. FFmpeg capturing last frame for continuation
14. Repeating 8-second loop
15. FFmpeg stitching final MP4
16. Final audio normalization and thumbnail
17. Video ready
```

Persistent bottom bar:

```text
🎬 [Project Name] · Veo chunk 3/8 · QC passed · Last-frame continuity active · 52% [View →]
```

Asset panel should show:

- character reference thumbnails
- face close-up reference
- expression sheet
- location reference
- style reference
- first frame for chunk 1
- cut-scene frames per chunk
- QC score badges
- retry count if regenerated
- completed video chunk mini player
- final stitched MP4 player

---

## API ENDPOINT REQUIREMENTS

Keep existing endpoints if already present, but make sure these fields are returned.

### `POST /api/pipeline/start`

Returns:

```json
{
  "jobId": "uuid",
  "status": "queued",
  "message": "Pipeline started",
  "totalChunks": 8,
  "chunkDurations": [8, 8, 8, 8, 8, 8, 8, 4]
}
```

### `GET /api/pipeline/status/:jobId`

Must include:

```json
{
  "jobId": "uuid",
  "status": "generating",
  "progress": {},
  "projectBible": {},
  "storyboard": {},
  "assets": {
    "characterReferences": [],
    "locationReferences": [],
    "styleReferences": [],
    "visualStoryboardFrames": [],
    "approvedVideoChunks": [],
    "finalVideoUrl": null,
    "thumbnailUrl": null
  },
  "qc": {
    "imageQcReports": [],
    "videoQcReports": [],
    "retries": []
  },
  "error": null
}
```

### `POST /api/pipeline/cancel/:jobId`

Should stop future chunks from generating and mark job as cancelled.

---

## IMPORTANT SAFETY AND RELIABILITY RULES

- Do not rebuild the app.
- Do not remove existing prompt mode.
- Add this only as Inbuilt Generator mode.
- Duration cap for inbuilt mode: 60 seconds.
- Use exact model constants only.
- No old model names anywhere.
- Claude must return valid JSON only.
- Parse JSON safely with fallback repair if needed.
- Save every job state to disk.
- Continue job even if frontend disconnects.
- Every chunk must use the approved first frame.
- Every chunk after chunk 1 must use previous chunk captured last frame.
- Every image and video must pass QC score 8/10 or retry.
- Never pass rejected frames to Veo.
- Never stitch rejected chunks into final video.
- Final MP4 should only use approved chunks.
- Show meaningful error messages in UI.

---

## TESTING CHECKLIST

- [ ] No `imagen-3`, `imagen-3.0-generate-002`, `claude-opus-4-5`, or `claude-sonnet-4-5` remains in code/comments/UI.
- [ ] Every Claude call uses `claude-sonnet-4-6`.
- [ ] Every image call uses `nano-banana-2`.
- [ ] Every video call uses `veo-3.1`.
- [ ] 60-second video creates 8 chunks with durations `8,8,8,8,8,8,8,4`.
- [ ] Claude creates `projectBible` before chunks.
- [ ] Project bible is injected into every nano-banana-2 prompt.
- [ ] Project bible is injected into every Veo prompt JSON.
- [ ] Character references include full body, face close-up, side profile, expression sheet.
- [ ] Scene cut-frame count changes by scene type.
- [ ] nano-banana-2 image QC runs after every generated image.
- [ ] Failed image QC triggers max 2 regenerations.
- [ ] Only approved images go to Veo.
- [ ] Veo receives JSON prompt, not plain paragraph.
- [ ] Veo prompt includes timecoded action beats.
- [ ] Veo prompt includes physics rules.
- [ ] Veo prompt includes voiceover, SFX, ambience, BGM, and mixing.
- [ ] Veo prompt includes negative prompt list.
- [ ] Veo prompt includes transition_to_next.
- [ ] Veo prompt includes exact ending_state.
- [ ] Chunk 1 uses nano-banana-2 approved first frame.
- [ ] Chunk 2+ uses FFmpeg captured last frame from previous approved chunk.
- [ ] Video QC extracts start, middle, and end frames.
- [ ] Failed video QC triggers max 2 regenerations.
- [ ] Only approved chunks are stitched.
- [ ] FFmpeg captures last frame after each approved chunk.
- [ ] FFmpeg final stitch applies audio loudness normalization.
- [ ] Final thumbnail is generated.
- [ ] Progress UI shows QC status and retry count.
- [ ] Final MP4 plays correctly from `/outputs/videos/[jobId]/final.mp4`.

---

## FINAL IMPLEMENTATION SUMMARY

The final system must behave like this:

```text
Claude Sonnet 4.6 writes the story brain and exact prompts.
nano-banana-2 creates the full visual storyboard and references.
QC approves or regenerates every frame.
Veo 3.1 receives JSON + first frame + visual refs and generates each video chunk.
QC approves or regenerates every chunk.
FFmpeg captures the last frame and feeds the next chunk.
FFmpeg stitches only approved chunks into one final polished MP4.
```

This full QC + bible + last-frame loop is mandatory for better character consistency, better physics, smoother cuts, stronger audio continuity, and more predictable final video generation.
