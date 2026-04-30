# Content Studio AI Video Studio — Story Builder Driven Continuous Video Engine

## Objective

Build a new **AI Video Studio engine** inside the existing Content Studio website.

Important: Content Studio already has a working **Story Builder** and **JSON Video Prompt Generation System**. Do **not** replace that system. This new engine must connect to the existing story-writing flow, then convert the built story into model-ready JSON video prompts, generate video chunks automatically, capture each generated chunk’s last frame, and continue the next chunk from that exact frame until the full video is complete.

The user experience must feel like Content Studio has its own native inbuilt video engine. Do not expose third-party model/provider names anywhere in the UI.

---

## Core User Flow

When the user enters **AI Video Studio**, the flow must be:

```text
AI Video Studio opens
↓
Existing Story Builder opens first
↓
User builds / writes / expands the story using the existing Story Builder
↓
User selects internal video model:
   - Cont Pro
   - Cont Ultra
↓
System converts the final story into structured scene data
↓
System creates visual storyboard:
   - starting frame
   - ending frame
   - key scene frames
   - character references
   - location references
↓
System generates model-specific JSON video prompt for Part 1
↓
Part 1 video is generated
↓
System captures the real last frame from Part 1
↓
System updates the next storyboard state using:
   - original story
   - previous JSON prompt
   - generated video summary
   - real captured last frame
↓
System generates Part 2 JSON prompt
↓
Part 2 starts from the captured last frame of Part 1
↓
Loop continues automatically until the selected duration is complete
↓
All parts are stitched into one final video
↓
Final MP4 is shown in AI Video Studio
```

The user should press generate once. After that, the full pipeline must run automatically.

---

## Internal Model Names

Only these names should be visible to users:

```text
Cont Pro
Cont Ultra
```

### Cont Pro

Internal use:

```text
Google Cloud Vertex AI API
Veo 3.1 video generation
Imagen 4 image/reference generation
Claude Sonnet 4.6 prompt/storyboard reasoning
```

User-visible description:

```text
Cont Pro
High-quality cinematic video generation for short-to-medium stories.
Best for up to 1 minute.
```

### Cont Ultra

Internal use:

```text
Freepik/Magnific API adapter
Seedance 2.0 video generation
Imagen 4 image/reference generation where needed
Claude Sonnet 4.6 prompt/storyboard reasoning
```

User-visible description:

```text
Cont Ultra
Longer cinematic video generation with advanced continuity.
Best for up to 2 minutes.
```

Do not show: Veo, Seedance, Imagen, Vertex AI, Freepik, Magnific, Claude, API provider names, FFmpeg, chunking, or last-frame extraction in the user UI.

---

## Existing Story Builder Integration

Do not create a separate story-writing system if Content Studio already has one.

The AI Video Studio must reuse the existing Story Builder output.

Expected Story Builder output should be normalized into this internal structure:

```json
{
  "storyId": "string",
  "title": "string",
  "logline": "string",
  "genre": "cinematic | horror | mythology | sci-fi | action | anime | documentary | custom",
  "visualStyle": "realistic | cinematic | anime | 3d-cgi | indian-epic | custom",
  "language": "Hindi | Hinglish | English | custom",
  "voiceoverTone": "epic | emotional | suspense | calm | energetic | custom",
  "bgmStyle": "orchestral | ambient | horror | devotional | action | emotional | custom",
  "characters": [
    {
      "id": "char_1",
      "name": "string",
      "age": "string",
      "gender": "string",
      "face": "string",
      "hair": "string",
      "body": "string",
      "outfit": "string",
      "accessories": "string",
      "personality": "string",
      "voiceTone": "string",
      "continuityLock": "string"
    }
  ],
  "locations": [
    {
      "id": "loc_1",
      "name": "string",
      "description": "string",
      "lighting": "string",
      "mood": "string",
      "continuityLock": "string"
    }
  ],
  "storyBeats": [
    {
      "beatNumber": 1,
      "summary": "string",
      "characters": ["char_1"],
      "location": "loc_1",
      "emotionalPurpose": "string",
      "visualPurpose": "string"
    }
  ]
}
```

If the existing Story Builder already returns similar data, map it into this structure without breaking old features.

---

## AI Video Studio UI Flow

### Step 1 — Story Builder

When user opens AI Video Studio:

```text
Open existing Story Builder
```

The screen should show:

```text
Build your story first
Use your story to create a cinematic AI video.
```

The user can:

```text
Write new story
Expand existing idea
Use saved story
Import story
```

### Step 2 — Model Selection

After story is built, show:

```text
Choose Video Engine

[Cont Pro]
Best for cinematic videos up to 1 minute.

[Cont Ultra]
Best for longer videos up to 2 minutes.
```

### Step 3 — Duration

Cont Pro:

```text
15 sec
30 sec
60 sec
```

Cont Ultra:

```text
30 sec
60 sec
120 sec
```

### Step 4 — Style, Voice, Output Settings

Show simple options:

```text
Aspect Ratio: 16:9 / 9:16 / 1:1
Language: Hindi / Hinglish / English
Voiceover: On / Off
BGM: On / Off
Subtitles: On / Off
Quality: Standard / High
```

### Step 5 — Generate

Button:

```text
Generate Video
```

Do not show technical labels like chunks, provider, API, Veo, Seedance, Imagen, FFmpeg.

User-facing progress should be clean:

```text
Writing final story structure...
Designing characters...
Creating visual storyboard...
Preparing scene 1...
Generating scene 1...
Preparing scene 2...
Generating scene 2...
Maintaining continuity...
Syncing voiceover and music...
Merging final video...
Final video ready.
```

---

## Engine Architecture

Create a new orchestration layer:

```text
server/video/
  aiVideoStudioEngine.js
  storyAdapter.js
  storyboardEngine.js
  promptJsonEngine.js
  continuityEngine.js
  chunkPlanner.js
  frameCapture.js
  stitcher.js
  jobStore.js

server/video/providers/
  contProAdapter.js
  contUltraAdapter.js
  imagen4Adapter.js
  claude46Adapter.js
```

Do not remove existing Story Builder files.

---

## Main Engine Flow

Implement:

```javascript
async function runAIVideoStudioJob(input) {
  const job = await createVideoJob(input);

  // 1. Read output from existing Story Builder
  const story = await loadStoryBuilderOutput(input.storyId);

  // 2. Normalize the existing story into video-ready format
  const normalizedStory = await normalizeStoryForVideo(story, input);

  // 3. Create duration/chunk plan according to selected model
  const chunkPlan = createChunkPlan({
    model: input.model, // cont_pro or cont_ultra
    duration: input.duration
  });

  // 4. Create locked character sheets and location references using Imagen 4
  const visualBible = await createVisualBible({
    story: normalizedStory,
    model: input.model,
    style: input.visualStyle
  });

  // 5. Build first visual storyboard from full story
  let storyboardState = await createInitialStoryboardState({
    story: normalizedStory,
    visualBible,
    chunkPlan
  });

  // 6. Run automatic continuous loop
  const chunks = await generateContinuousVideoChunks({
    job,
    story: normalizedStory,
    visualBible,
    storyboardState,
    chunkPlan,
    input
  });

  // 7. Stitch chunks
  const finalVideo = await stitchVideoChunks({
    job,
    chunks,
    duration: input.duration
  });

  // 8. Save output
  await completeJob(job, finalVideo);

  return finalVideo;
}
```

---

## Chunk Planning

The system must split the final duration according to the selected internal model.

### Cont Pro

Cont Pro should generate up to 1 minute.

```javascript
const CONT_PRO_CHUNK_SECONDS = 8;
const CONT_PRO_MAX_SECONDS = 60;
```

For 60 seconds:

```text
Part 1: 00:00-00:08
Part 2: 00:08-00:16
Part 3: 00:16-00:24
Part 4: 00:24-00:32
Part 5: 00:32-00:40
Part 6: 00:40-00:48
Part 7: 00:48-00:56
Part 8: 00:56-01:00
```

The final part can be generated as 8 seconds and trimmed to exact duration if needed.

### Cont Ultra

Cont Ultra should generate up to 2 minutes.

```javascript
const CONT_ULTRA_CHUNK_SECONDS = 8;
const CONT_ULTRA_MAX_SECONDS = 120;
```

For 120 seconds:

```text
Part 1: 00:00-00:08
Part 2: 00:08-00:16
Part 3: 00:16-00:24
...
Part 15: 01:52-02:00
```

---

## Visual Bible Generation

Before video generation starts, create a locked visual bible.

Use Imagen 4 through Google Cloud Vertex AI API for:

```text
Character reference sheets
Main character portrait
Secondary character portraits
Outfit reference
Location reference frames
Opening frame
Scene start frames
Scene end frames
Poster/thumbnail
```

The visual bible must include:

```json
{
  "characters": [
    {
      "id": "char_1",
      "name": "string",
      "referenceImage": "base64-or-url",
      "faceLock": "exact description",
      "outfitLock": "exact description",
      "negativeRules": [
        "do not change face",
        "do not change outfit",
        "do not change age",
        "do not add random accessories"
      ]
    }
  ],
  "locations": [
    {
      "id": "loc_1",
      "referenceImage": "base64-or-url",
      "lightingLock": "string",
      "environmentLock": "string"
    }
  ],
  "styleLock": {
    "visualStyle": "string",
    "colorGrade": "string",
    "cameraLanguage": "string",
    "qualityRules": [
      "cinematic lighting",
      "stable faces",
      "no random morphing",
      "no scene reset between chunks",
      "no unwanted text or watermark"
    ]
  }
}
```

---

## JSON Video Prompt Engine

Content Studio already has a video prompt generation system. Reuse it, but extend it for model-specific JSON output.

For every part/chunk, Claude Sonnet 4.6 must create a fresh JSON prompt.

The prompt must be specific to:

```text
Selected model
Full story
Current story beat
Previous generated chunk
Real captured last frame
Current starting frame
Current ending frame
Visual storyboard
Character references
Voiceover
BGM
SFX
Physics
Camera movement
Lighting
Continuity rules
Next scene setup
```

### Required JSON format per chunk

```json
{
  "engineModel": "cont_pro_or_cont_ultra",
  "partNumber": 1,
  "totalParts": 8,
  "timeRange": "00:00-00:08",
  "storyContext": {
    "title": "string",
    "fullStorySummary": "string",
    "currentBeat": "string",
    "previousBeat": "string",
    "nextBeat": "string"
  },
  "continuity": {
    "startMode": "opening_frame_or_previous_last_frame",
    "previousLastFrame": "base64-or-url-or-null",
    "mustStartFromPreviousFrame": true,
    "characterContinuityRules": [
      "same face",
      "same outfit",
      "same age",
      "same body proportions",
      "same emotional state unless story changes it"
    ],
    "sceneContinuityRules": [
      "do not reset camera",
      "do not change location unless story beat requires it",
      "preserve lighting direction",
      "preserve object positions"
    ]
  },
  "visualStoryboard": {
    "startingFramePrompt": "string",
    "endingFramePrompt": "string",
    "keyFrames": [
      {
        "timestamp": "00:00",
        "description": "string",
        "camera": "string",
        "characterPose": "string",
        "environment": "string"
      }
    ]
  },
  "videoDirection": {
    "mainAction": "string",
    "cameraMovement": "string",
    "lens": "string",
    "composition": "string",
    "lighting": "string",
    "atmosphere": "string",
    "physics": "string",
    "motionRules": [
      "natural movement",
      "no teleporting",
      "no body morphing",
      "no sudden scene jump unless designed as a cutscene"
    ]
  },
  "cutSceneRules": {
    "allowed": true,
    "cutStyle": "cinematic match cut / camera whip / fade / hard cut",
    "mustFeelContinuous": true,
    "cutPurpose": "string"
  },
  "audio": {
    "voiceoverLanguage": "Hindi/Hinglish/English",
    "voiceoverText": "actual spoken words, no placeholder",
    "voiceoverTone": "string",
    "soundEffects": [
      "specific sound effect"
    ],
    "backgroundMusic": {
      "style": "string",
      "tempo": "string",
      "instruments": "string",
      "energy": "string"
    }
  },
  "negativePrompt": [
    "no character change",
    "no face drift",
    "no outfit change",
    "no extra fingers",
    "no random new characters",
    "no watermark",
    "no subtitles burned into video unless enabled",
    "no text glitches",
    "no physics mistakes",
    "no camera reset"
  ],
  "endStateForNextPart": {
    "lastFrameDescription": "exact final frame description",
    "characterPosition": "string",
    "cameraAngle": "string",
    "lightingState": "string",
    "emotionState": "string",
    "environmentState": "string"
  }
}
```

---

## Continuous Generation Loop

Implement this exact behavior:

```javascript
async function generateContinuousVideoChunks({
  job,
  story,
  visualBible,
  storyboardState,
  chunkPlan,
  input
}) {
  const chunks = [];
  let previousLastFrame = null;
  let previousChunkSummary = null;
  let previousJsonPrompt = null;

  for (let i = 0; i < chunkPlan.parts.length; i++) {
    const part = chunkPlan.parts[i];
    const isFirstPart = i === 0;
    const isLastPart = i === chunkPlan.parts.length - 1;

    updateJobProgress(job, {
      stage: 'generating',
      currentPart: part.partNumber,
      totalParts: chunkPlan.parts.length
    });

    // 1. Build or update storyboard for this part
    const currentStoryboard = await buildStoryboardForPart({
      story,
      visualBible,
      previousLastFrame,
      previousChunkSummary,
      previousJsonPrompt,
      part,
      isFirstPart,
      isLastPart
    });

    // 2. Generate starting and ending frame references
    // First part uses story opening frame.
    // Next parts use the real captured last frame from previous video.
    const startFrame = isFirstPart
      ? currentStoryboard.openingFrame
      : previousLastFrame;

    const endingFrame = await generateEndingFrameForPart({
      story,
      visualBible,
      currentStoryboard,
      startFrame,
      part
    });

    // 3. Create exact model-specific JSON video prompt
    const jsonPrompt = await generateJsonVideoPrompt({
      model: input.model,
      story,
      visualBible,
      currentStoryboard,
      startFrame,
      endingFrame,
      previousLastFrame,
      previousChunkSummary,
      previousJsonPrompt,
      part,
      isFirstPart,
      isLastPart,
      settings: input
    });

    // 4. Feed JSON prompt + references to selected internal video engine
    const videoChunk = await generateVideoChunkWithRetry({
      model: input.model,
      jsonPrompt,
      referenceImages: [
        startFrame,
        endingFrame,
        ...currentStoryboard.keyFrames,
        ...visualBible.characters.map(c => c.referenceImage),
        ...visualBible.locations.map(l => l.referenceImage)
      ],
      duration: part.durationSeconds,
      jobId: job.id,
      partNumber: part.partNumber
    });

    // 5. Capture the real final frame from generated video
    const capturedLastFrame = await captureLastFrameFromVideo({
      videoPath: videoChunk.path,
      jobId: job.id,
      partNumber: part.partNumber
    });

    // 6. Analyze generated chunk to summarize what actually happened
    const generatedSummary = await summarizeGeneratedChunk({
      story,
      jsonPrompt,
      videoChunk,
      capturedLastFrame,
      part
    });

    // 7. Save state for next part
    previousLastFrame = capturedLastFrame;
    previousChunkSummary = generatedSummary;
    previousJsonPrompt = jsonPrompt;

    chunks.push({
      partNumber: part.partNumber,
      timeRange: part.timeRange,
      jsonPrompt,
      videoPath: videoChunk.path,
      lastFrame: capturedLastFrame,
      summary: generatedSummary
    });

    await persistJobState(job, chunks);
  }

  return chunks;
}
```

---

## Critical Continuity Rules

The engine must follow these rules strictly:

```text
1. The first part starts from the story opening frame.
2. Every next part starts from the real captured last frame of the previous generated video.
3. Do not use only planned storyboard frames for part 2+. Use the actual generated video last frame.
4. Every part gets a fresh JSON prompt.
5. Every fresh JSON prompt must know:
   - full story
   - previous chunk summary
   - previous JSON prompt
   - real captured last frame
   - current story beat
   - next story beat
   - ending state needed for next chunk
6. Characters must remain the same across the whole video.
7. Character face, outfit, age, body, accessories, and voice tone are locked from the visual bible.
8. If a cutscene happens, it must feel intentional and cinematic, not like an AI scene reset.
9. Physics must remain natural:
   - no teleporting
   - no sudden object changes
   - no body warping
   - no gravity mistakes
   - no location jump unless story beat requires it
10. Voiceover must continue naturally across parts.
11. BGM should continue smoothly across parts.
12. The pipeline must run without user action until the video is complete.
13. If one part fails, retry that part. Do not restart the whole job.
14. If final duration is shorter than generated chunks, trim final output to exact selected duration.
```

---

## Model-Specific Prompt Optimization

### Cont Pro JSON Optimization

For Cont Pro, JSON prompt should focus on:

```text
8-second cinematic precision
high visual quality
native cinematic motion
strong reference-frame continuity
scene-to-scene natural cut
high-quality audio direction
clear ending frame handoff
```

### Cont Ultra JSON Optimization

For Cont Ultra, JSON prompt should focus on:

```text
long-form continuity
stable character identity across many parts
smooth scene progression
clear story beat transitions
strong start/end frame usage
longer emotional arc
controlled pacing
```

---

## Prompt Generation System Instruction

Use Claude Sonnet 4.6 for every JSON prompt generation step.

System instruction for Claude Sonnet 4.6:

```text
You are the JSON video prompt director inside Content Studio.

You receive a completed story from the Story Builder, the selected internal video engine, visual bible references, previous generated video state, captured last frame, current story beat, and next story beat.

Your job is to create a precise model-ready JSON video prompt for exactly one video part.

The JSON must produce maximum story accuracy, character consistency, camera continuity, realistic physics, correct cutscenes, correct voiceover, correct sound effects, and correct background music.

Never write vague placeholders.
Never write "voiceover here".
Never change characters unless the story explicitly says so.
Never reset the scene unless it is a planned cinematic cut.
Always describe the exact final frame state for the next part.
Return valid JSON only.
```

---

## Starting Frame / Ending Frame Logic

For each part:

### Part 1

```text
starting frame = Imagen 4 generated opening frame from the story
ending frame = Imagen 4 generated planned end-state frame for part 1
```

### Part 2+

```text
starting frame = actual captured last frame from previous generated video
ending frame = Imagen 4 generated planned end-state frame according to story + previous real frame
```

This is important:

```text
Do not start Part 2+ from a fresh storyboard image.
Always start Part 2+ from the real captured last frame.
```

---

## Storyboard Update After Each Generated Video

After each part is generated:

```javascript
async function updateStoryboardAfterGeneratedChunk({
  originalStory,
  previousStoryboard,
  jsonPromptUsed,
  generatedChunkSummary,
  capturedLastFrame,
  nextPart
}) {
  return await claude46({
    task: 'update_storyboard_for_next_video_part',
    originalStory,
    previousStoryboard,
    jsonPromptUsed,
    generatedChunkSummary,
    capturedLastFrame,
    nextPart,
    rules: [
      'continue from capturedLastFrame',
      'preserve character identity',
      'preserve location continuity unless story requires change',
      'create next ending frame according to story',
      'avoid repeating previous action',
      'prepare smooth next video prompt'
    ]
  });
}
```

The storyboard must evolve according to what was actually generated, not only what was planned.

---

## Audio Continuity

Voiceover, BGM, and SFX must be generated/handled as part of the prompt flow.

For every JSON prompt:

```text
voiceover text must be actual words
voiceover language must match user selection
voiceover tone must match scene emotion
BGM should not restart harshly every part
SFX must match visual action
```

Recommended final pipeline:

```text
Option A:
Use video model native audio per part and crossfade audio during stitching.

Option B:
Generate final separate voiceover + BGM timeline after story build, then sync it to stitched video.

Best quality:
Use Option B when available.
```

The engine should support both, but default to the best available quality.

---

## Final Stitching

After all parts complete:

```javascript
async function stitchVideoChunks({ job, chunks, duration }) {
  // 1. Sort chunks by partNumber
  // 2. Normalize resolution, fps, audio format
  // 3. Add micro crossfade only if it improves continuity
  // 4. Join all chunks
  // 5. Trim to exact requested duration
  // 6. Export final MP4
}
```

Final output:

```json
{
  "videoUrl": "string",
  "duration": 60,
  "model": "cont_pro",
  "status": "complete",
  "thumbnail": "string",
  "assets": {
    "story": "string",
    "visualStoryboard": "array",
    "voiceoverScript": "string",
    "sceneBreakdown": "array"
  }
}
```

---

## Quality Guardrails

Before final export, run checks:

```text
Check character consistency
Check story order
Check chunk continuity
Check scene transitions
Check audio continuity
Check final duration
Check missing chunks
Check failed parts
Check black frames
Check watermark/text artifacts
```

If a chunk has a major issue:

```text
Retry that chunk with stricter JSON prompt
Use captured previous frame again
Add stronger negative prompt
Do not regenerate the whole video unless necessary
```

---

## Final Requirement

The engine must behave like this:

```text
Story Builder creates story
↓
AI Video Studio converts story into visual storyboard
↓
JSON prompt engine creates exact model-specific prompt
↓
Video model receives:
   - JSON prompt
   - timestamp plan
   - style rules
   - voiceover
   - BGM
   - starting frame
   - ending frame
   - character references
   - scene references
↓
First chunk generates
↓
Last frame captured
↓
Next JSON prompt is created using real captured frame
↓
Next chunk generates
↓
Loop continues automatically
↓
Final stitched video is exported
```

This is not a simple video generator. This is a story-driven continuous cinematic video engine.
