# ADD-ON PROMPT — Cinema Image Studio Advanced Cinematography Controls

Add the following advanced features to the existing Cinema Image Studio inside ContentStudio AI.

Do not rebuild the app.  
Do not remove existing Cinema Image Studio features.  
Extend the current feature with advanced camera, lens, prompt, reference, output, and quality controls.

---

## 1. LENS PACK SYSTEM

Add a new **Lens Pack** selector under Lens Controls.

Lens Pack is different from focal length.  
Lens Pack defines the personality, contrast, sharpness, color, bokeh, distortion, flare, and cinematic mood of the lens.

Add these Lens Packs:

```json
[
  {
    "id": "cooke_warm_cinema",
    "name": "Cooke Warm Cinema Lens Pack",
    "look": "warm skin tones, soft contrast, gentle falloff, emotional cinematic warmth",
    "bestFor": ["drama", "romance", "character closeups", "period films"],
    "promptInjection": "Cooke-style warm cinema lens look, gentle contrast, warm skin tones, soft pleasing falloff, emotional filmic rendering."
  },
  {
    "id": "zeiss_sharp_cinema",
    "name": "Zeiss Sharp Cinema Lens Pack",
    "look": "clean sharp image, high micro-contrast, precise modern cinema detail",
    "bestFor": ["sci-fi", "thriller", "commercial", "architecture", "action"],
    "promptInjection": "Zeiss-style sharp cinema lens look, crisp detail, clean contrast, precise modern optical rendering."
  },
  {
    "id": "arri_signature_prime",
    "name": "ARRI Signature Prime Look",
    "look": "large format softness, premium depth, elegant highlight rolloff, luxury cinema feel",
    "bestFor": ["premium ads", "fashion", "epic drama", "luxury product"],
    "promptInjection": "ARRI Signature Prime inspired large-format lens look, elegant softness, smooth depth, premium cinematic highlight rolloff."
  },
  {
    "id": "panavision_epic_anamorphic",
    "name": "Panavision Epic Anamorphic Look",
    "look": "wide cinematic frame, oval bokeh, horizontal flare, epic Hollywood scale",
    "bestFor": ["action", "sci-fi", "fantasy", "epic hero shots"],
    "promptInjection": "Panavision-style anamorphic cinema look, epic wide frame, oval bokeh, horizontal lens flare, grand Hollywood scale."
  },
  {
    "id": "leica_luxury_portrait",
    "name": "Leica Luxury Portrait Look",
    "look": "premium portrait softness, rich contrast, elegant skin texture, refined bokeh",
    "bestFor": ["fashion", "beauty", "romance", "premium portraits"],
    "promptInjection": "Leica-inspired luxury portrait lens look, refined bokeh, rich contrast, elegant skin texture, premium portrait softness."
  },
  {
    "id": "atlas_orion_anamorphic",
    "name": "Atlas Orion Anamorphic Look",
    "look": "modern anamorphic character, cinematic flare, organic distortion, indie sci-fi feel",
    "bestFor": ["music videos", "indie films", "cyberpunk", "urban drama"],
    "promptInjection": "Atlas Orion inspired anamorphic lens look, organic cinematic distortion, soft flare, modern indie film character."
  },
  {
    "id": "canon_cne_natural",
    "name": "Canon CN-E Natural Look",
    "look": "natural colors, smooth faces, clean creator-friendly cinema",
    "bestFor": ["documentary", "travel", "creator videos", "short films"],
    "promptInjection": "Canon CN-E inspired natural cinema lens look, warm realistic color, smooth skin, clean cinematic clarity."
  },
  {
    "id": "sigma_cine_clean",
    "name": "Sigma Cine Clean Look",
    "look": "clean modern sharpness, neutral contrast, versatile commercial style",
    "bestFor": ["commercial", "product", "fitness", "corporate", "social content"],
    "promptInjection": "Sigma Cine inspired clean modern lens look, neutral contrast, controlled sharpness, versatile commercial clarity."
  },
  {
    "id": "vintage_soviet_lens",
    "name": "Vintage Soviet Lens Look",
    "look": "swirly bokeh, imperfect vintage softness, dreamy artistic distortion",
    "bestFor": ["dream scenes", "nostalgia", "music video", "surreal fantasy"],
    "promptInjection": "vintage Soviet lens inspired look, swirly bokeh, dreamy softness, imperfect optical character, nostalgic cinematic texture."
  },
  {
    "id": "angenieux_zoom_documentary",
    "name": "Angenieux Zoom Documentary Look",
    "look": "classic documentary zoom lens, natural field realism, live-action immediacy",
    "bestFor": ["documentary", "war scenes", "news style", "realistic handheld scenes"],
    "promptInjection": "Angenieux-style documentary zoom lens look, natural field realism, cinematic documentary immediacy, subtle zoom-lens character."
  },
  {
    "id": "macro_probe_lens",
    "name": "Macro Probe Lens Look",
    "look": "extreme close macro detail, tiny-world perspective, dramatic foreground depth",
    "bestFor": ["product macro", "food", "insects", "details", "object reveals"],
    "promptInjection": "macro probe lens look, extreme close detail, tiny-world perspective, dramatic foreground depth, sharp product-level texture."
  }
]
```

Lens Pack should inject into the final nano-banana-2 prompt along with focal length and aperture.

---

## 2. CAMERA + LENS AUTO-PAIRING

When user selects a Camera Body, auto-suggest the best Lens Packs and focal lengths.

Add this pairing logic:

```json
{
  "arri_alexa_35": {
    "recommendedLensPacks": ["cooke_warm_cinema", "zeiss_sharp_cinema", "panavision_epic_anamorphic"],
    "recommendedFocalLengths": ["35mm classic cinema", "50mm natural portrait", "85mm cinematic close-up"],
    "recommendedColorGrades": ["Filmic Warm Drama", "Natural Hollywood", "Soft Teal Orange"]
  },
  "arri_alexa_mini_lf": {
    "recommendedLensPacks": ["arri_signature_prime", "panavision_epic_anamorphic", "leica_luxury_portrait"],
    "recommendedFocalLengths": ["35mm classic cinema", "50mm natural portrait", "65mm compressed portrait"],
    "recommendedColorGrades": ["Premium Large Format", "Luxury Commercial", "Epic Fantasy"]
  },
  "red_v_raptor": {
    "recommendedLensPacks": ["zeiss_sharp_cinema", "sigma_cine_clean", "panavision_epic_anamorphic"],
    "recommendedFocalLengths": ["24mm wide natural", "35mm classic cinema", "85mm cinematic close-up"],
    "recommendedColorGrades": ["High Contrast Action", "Modern Sci-Fi", "Cyberpunk Neon"]
  },
  "sony_venice_2": {
    "recommendedLensPacks": ["panavision_epic_anamorphic", "leica_luxury_portrait", "sigma_cine_clean"],
    "recommendedFocalLengths": ["35mm classic cinema", "50mm natural portrait", "85mm cinematic close-up"],
    "recommendedColorGrades": ["Neon Night", "Clean Premium Digital", "Music Video Glow"]
  },
  "canon_c500_mark_ii": {
    "recommendedLensPacks": ["canon_cne_natural", "cooke_warm_cinema", "angenieux_zoom_documentary"],
    "recommendedFocalLengths": ["28mm documentary", "35mm classic cinema", "50mm natural portrait"],
    "recommendedColorGrades": ["Documentary Natural", "Warm Human Story", "Travel Film"]
  },
  "blackmagic_pocket_6k": {
    "recommendedLensPacks": ["vintage_soviet_lens", "canon_cne_natural", "sigma_cine_clean"],
    "recommendedFocalLengths": ["24mm wide natural", "35mm classic cinema", "50mm natural portrait"],
    "recommendedColorGrades": ["Indie Film", "Urban Music Video", "Raw Cinematic"]
  },
  "generic_anime_virtual_camera": {
    "recommendedLensPacks": ["anime_hero_frame", "anime_closeup_frame", "anime_speed_perspective"],
    "recommendedFocalLengths": ["anime wide hero frame", "anime emotional close-up", "anime extreme perspective"],
    "recommendedColorGrades": ["Anime Vibrant", "Anime Soft Pastel", "Anime Dark Action"]
  },
  "generic_pixel_art_camera": {
    "recommendedLensPacks": ["pixel_side_scroller", "pixel_isometric", "pixel_top_down"],
    "recommendedFocalLengths": ["side-scroller wide", "isometric frame", "top-down pixel view"],
    "recommendedColorGrades": ["Retro Arcade", "Limited Palette", "Pixel Night"]
  },
  "generic_3d_cgi_camera": {
    "recommendedLensPacks": ["virtual_35mm_cgi", "virtual_50mm_character", "virtual_wide_hero"],
    "recommendedFocalLengths": ["35mm virtual camera", "50mm character close-up", "wide hero lens"],
    "recommendedColorGrades": ["Pixar Warm", "Game Cinematic", "Fantasy CGI"]
  }
}
```

When a camera is selected:

- auto-fill best lens pack if user has not manually selected one
- show “Recommended” badge on best lens packs
- suggest focal length and color grade
- allow user to override manually

---

## 3. SHOT RECIPE LIBRARY

Add a **Shot Recipe Library** panel.

Each recipe should auto-fill:

- camera body
- lens pack
- focal length
- aperture
- shot size
- camera angle
- lighting
- atmosphere
- composition
- color grade
- negative prompt additions

Add these recipes:

```json
[
  {
    "name": "Hero Entry",
    "description": "Powerful protagonist reveal",
    "cameraAngle": "Low Angle",
    "shotSize": "Medium Wide Shot",
    "lens": "35mm anamorphic",
    "lighting": "backlit rim light with atmospheric haze",
    "composition": "center hero composition",
    "promptBoost": "heroic entrance, strong silhouette, cinematic low angle, dramatic atmosphere"
  },
  {
    "name": "Villain Reveal",
    "cameraAngle": "Low Angle",
    "shotSize": "Close-Up",
    "lens": "50mm vintage lens",
    "lighting": "hard side light, deep shadows",
    "composition": "negative space and shadow framing",
    "promptBoost": "ominous villain reveal, half-lit face, slow dread, powerful presence"
  },
  {
    "name": "Rainy Noir Close-Up",
    "cameraAngle": "Eye Level",
    "shotSize": "Medium Close-Up",
    "lens": "85mm cinematic close-up",
    "lighting": "neon rim light and wet reflections",
    "composition": "foreground rain streaks",
    "promptBoost": "rainy noir street, wet reflections, moody close-up, cinematic loneliness"
  },
  {
    "name": "Anime Power-Up",
    "cameraAngle": "Low Angle",
    "shotSize": "Full Shot",
    "lens": "anime extreme perspective",
    "lighting": "glowing aura and speed lines",
    "composition": "dynamic diagonal pose",
    "promptBoost": "hand-crafted 2D anime power-up, cel shading, energy aura, dynamic key pose"
  },
  {
    "name": "Final Boss Frame",
    "cameraAngle": "Worm’s Eye",
    "shotSize": "Wide Shot",
    "lens": "wide dramatic",
    "lighting": "storm backlight and smoke",
    "composition": "huge scale silhouette",
    "promptBoost": "massive final boss presence, epic scale, dramatic storm, cinematic threat"
  },
  {
    "name": "Detective Interrogation",
    "cameraAngle": "Eye Level",
    "shotSize": "Over The Shoulder",
    "lens": "50mm natural portrait",
    "lighting": "single overhead practical light",
    "composition": "table foreground, dark background",
    "promptBoost": "tense interrogation room, noir shadows, psychological drama"
  },
  {
    "name": "Luxury Product Shot",
    "cameraAngle": "Low Angle",
    "shotSize": "Product Beauty Shot",
    "lens": "100mm macro/detail",
    "lighting": "studio product lighting with controlled reflections",
    "composition": "premium center composition",
    "promptBoost": "luxury product photography, premium reflections, clean background, sharp product edges"
  },
  {
    "name": "Romantic Golden Hour",
    "cameraAngle": "Eye Level",
    "shotSize": "Medium Close-Up",
    "lens": "50mm portrait",
    "lighting": "soft golden hour backlight",
    "composition": "warm foreground bokeh",
    "promptBoost": "romantic warm golden hour, soft glow, emotional expression, gentle film look"
  },
  {
    "name": "Horror Hallway",
    "cameraAngle": "Dutch Angle",
    "shotSize": "Wide Shot",
    "lens": "24mm wide natural",
    "lighting": "cold moonlight and flickering practical",
    "composition": "deep hallway leading lines",
    "promptBoost": "haunted hallway, unsettling negative space, cold shadows, slow dread"
  },
  {
    "name": "Cyberpunk Street",
    "cameraAngle": "Ground Level",
    "shotSize": "Wide Shot",
    "lens": "35mm anamorphic",
    "lighting": "magenta cyan neon",
    "composition": "wet reflective street leading lines",
    "promptBoost": "cyberpunk neon street, wet reflections, holographic signs, dark futuristic city"
  },
  {
    "name": "Epic Battlefield",
    "cameraAngle": "Crane Height",
    "shotSize": "Extreme Wide Shot",
    "lens": "18mm cinematic wide",
    "lighting": "dusty sunset backlight",
    "composition": "layered armies and smoke",
    "promptBoost": "epic battlefield scale, dust, banners, dramatic sunset, cinematic war frame"
  },
  {
    "name": "God Ray Temple Shot",
    "cameraAngle": "Low Angle",
    "shotSize": "Wide Shot",
    "lens": "24mm wide natural",
    "lighting": "volumetric god rays",
    "composition": "temple pillars as foreground frame",
    "promptBoost": "ancient temple interior, volumetric god rays, sacred atmosphere, mystical cinematic frame"
  },
  {
    "name": "Music Video Performance",
    "cameraAngle": "Low Angle",
    "shotSize": "Medium Shot",
    "lens": "24mm wide energetic",
    "lighting": "stage lights and colored haze",
    "composition": "dynamic diagonal framing",
    "promptBoost": "high-energy music video performance, colored lights, haze, cinematic stage presence"
  },
  {
    "name": "Fashion Editorial",
    "cameraAngle": "Eye Level",
    "shotSize": "Full Shot",
    "lens": "85mm portrait",
    "lighting": "soft beauty light",
    "composition": "minimal premium background",
    "promptBoost": "fashion editorial pose, premium styling, clean luxury composition, refined lighting"
  },
  {
    "name": "Car Commercial Shot",
    "cameraAngle": "Low Angle",
    "shotSize": "Hero Product Shot",
    "lens": "35mm wide commercial",
    "lighting": "sunset rim light and glossy reflections",
    "composition": "road leading lines",
    "promptBoost": "premium car commercial, glossy reflections, dynamic road, cinematic automotive hero frame"
  },
  {
    "name": "Food Macro Shot",
    "cameraAngle": "Macro Tabletop",
    "shotSize": "Extreme Close-Up",
    "lens": "100mm macro/detail",
    "lighting": "soft studio key light",
    "composition": "shallow depth food texture",
    "promptBoost": "delicious food macro, steam, texture detail, premium commercial lighting"
  },
  {
    "name": "Fantasy Portal Reveal",
    "cameraAngle": "Wide Hero Angle",
    "shotSize": "Wide Shot",
    "lens": "24mm wide",
    "lighting": "magical portal glow",
    "composition": "portal centered with character silhouette",
    "promptBoost": "fantasy portal opening, glowing magical light, character silhouette, epic mystical atmosphere"
  },
  {
    "name": "Emotional Tear Close-Up",
    "cameraAngle": "Eye Level",
    "shotSize": "Extreme Close-Up",
    "lens": "85mm cinematic close-up",
    "lighting": "soft side light",
    "composition": "eyes and tear detail",
    "promptBoost": "emotional tear close-up, subtle expression, cinematic shallow depth, intimate human moment"
  }
]
```

Add recipe search:

- search by mood
- search by genre
- search by style
- one-click apply recipe

User can save custom recipes.

---

## 4. REFERENCE STRENGTH SLIDERS

Add reference strength controls when user uploads or selects references.

Sliders:

- Face Lock Strength: 0–100
- Outfit Lock Strength: 0–100
- Pose Lock Strength: 0–100
- Style Lock Strength: 0–100
- Location Lock Strength: 0–100
- Lighting Lock Strength: 0–100
- Product Shape Lock Strength: 0–100
- Composition Lock Strength: 0–100

Default values:

- Face Lock: 85
- Outfit Lock: 80
- Pose Lock: 60
- Style Lock: 75
- Location Lock: 70
- Lighting Lock: 65
- Product Shape Lock: 90
- Composition Lock: 60

Prompt injection logic:

```text
0–30:
Use reference loosely for inspiration.

31–60:
Follow reference moderately while allowing creative changes.

61–85:
Follow reference closely, preserve key identity and structure.

86–100:
Strictly preserve reference. Do not redesign.
```

Add to final prompt:

```json
{
  "reference_strength": {
    "faceLock": 85,
    "outfitLock": 80,
    "poseLock": 60,
    "styleLock": 75,
    "locationLock": 70,
    "lightingLock": 65
  }
}
```

AI Director must respect slider values while building final nano-banana-2 prompt.

---

## 5. CAMERA PNG + SAMPLE LOOK PREVIEW

Each Camera Body card should show:

- camera PNG/icon
- camera name
- sample look thumbnail
- sensor/look description
- best use-cases
- recommended lens packs
- Apply button

Add sample look thumbnails path:

```text
/public/assets/cinema/camera-previews/
```

Example filenames:

```text
arri_alexa_35_preview.jpg
red_v_raptor_preview.jpg
sony_venice_2_preview.jpg
anime_virtual_camera_preview.jpg
pixel_art_camera_preview.jpg
generic_3d_cgi_camera_preview.jpg
```

If sample preview missing:

- show generated gradient placeholder
- show text “Preview will appear after first generation”
- do not break UI

Add option:

```text
Generate Sample Preview
```

This should create a simple reference image using nano-banana-2:

```text
cinematic test frame showing this camera look on a neutral subject.
```

Do not use copyrighted camera product photos or official logos unless user uploads licensed assets.

---

## 6. SEED / VARIATION / CREATIVE CONTROLS

Add Advanced Generation Controls:

```json
{
  "seed": -1,
  "randomSeed": true,
  "variationStrength": 35,
  "creativeFreedom": 45,
  "promptAdherence": 75,
  "realismStrength": 80,
  "styleStrength": 75,
  "detailLevel": 80,
  "compositionStrictness": 65
}
```

UI controls:

- Seed input
- Random seed toggle
- Variation Strength slider
- Creative Freedom slider
- Prompt Adherence slider
- Realism Strength slider
- Style Strength slider
- Detail Level slider
- Composition Strictness slider

Behavior:

- Higher prompt adherence = follow user prompt more strictly
- Higher creative freedom = AI can add cinematic details
- Higher realism strength = photoreal accuracy
- Higher style strength = stronger anime/pixel/CGI/commercial style
- Higher composition strictness = respect selected camera angle/framing

Add **Generate Variation** button:

- keeps same prompt
- changes seed
- respects variation strength

Add **Create 4 Variations** button:

- generates 4 different outputs from same setup
- displays comparison grid

---

## 7. OUTPUT CONTROLS

Add Output Settings panel.

Aspect Ratios:

- 16:9 Cinematic Landscape
- 9:16 Vertical Reels/Shorts
- 1:1 Square
- 4:5 Instagram Portrait
- 3:4 Portrait
- 21:9 Ultra Wide Cinema
- 2.39:1 Anamorphic Cinema
- 4:3 Classic Film
- 3:2 Photography

Resolution:

- Standard
- High
- Ultra

Image Count:

- 1
- 2
- 4

Format:

- PNG
- JPG
- WebP

Actions:

- Download Image
- Copy Prompt
- Copy JSON Prompt
- Save to Project
- Send to Video Generator
- Save as Character Reference
- Save as Location Reference
- Save as Style Reference
- Generate More Like This
- Upscale if supported by existing app
- Create Shot Deck from this image

Final prompt JSON should include:

```json
{
  "output": {
    "aspectRatio": "16:9",
    "resolution": "high",
    "imageCount": 1,
    "format": "png"
  }
}
```

---

## 8. PROMPT GRADING BEFORE GENERATION

Add **Prompt Score** before image generation.

When user clicks **Analyze Prompt** or AI Director runs, return:

```json
{
  "overallPromptScore": 8,
  "cinematicScore": 9,
  "cameraClarityScore": 8,
  "lensClarityScore": 8,
  "lightingScore": 7,
  "styleConsistencyScore": 9,
  "characterConsistencyScore": 8,
  "compositionScore": 8,
  "promptRiskScore": 3,
  "missingDetails": [],
  "improvementSuggestions": [],
  "improvedPrompt": ""
}
```

Display as a score card.

If score < 8, show button:

```text
Improve Prompt
```

Improve Prompt should:

- add missing camera detail
- add missing lighting detail
- clarify subject
- clarify style
- strengthen negative prompt
- preserve user intent

Do not force prompt grading on every generation.  
Make it fast and optional, but run automatically when AI Director is used.

---

## 9. STYLE-SPECIFIC TRANSLATION LAYER

Do not use the same camera language for every style.

Add function:

```javascript
translateCameraLanguageForStyle(state)
```

Rules:

### Photorealistic Cinematic

- keep real camera names
- keep real lens terms
- keep focal length, aperture, sensor size
- use filmic lighting and optics

### 2D Anime

- translate lens terms into anime framing language
- avoid realistic pores, real camera noise, plastic 3D look
- use terms like dynamic key pose, cel shading, painted background, anime close-up, speed perspective
- focal length can be used only as composition guidance, not photoreal optics

### Pixel Art

- translate lens terms into pixel composition language
- avoid shallow DOF blur, anti-aliased smooth edges, photoreal textures
- use crisp pixel grid, side-scroller/isometric/top-down, limited palette
- camera movement feeling becomes sprite framing/parallax feeling

### 3D CGI

- translate camera into virtual camera language
- use global illumination, rigged pose, virtual focal length, stylized depth
- avoid cheap game render, unstable model design

### Commercial Product

- camera language should emphasize product shape, reflection, material accuracy, clean background
- avoid messy props and distorted text/logos

Add translated prompt field:

```json
{
  "styleTranslatedCameraPrompt": "camera and lens instruction translated for selected visual style"
}
```

Final prompt must use translated style-safe camera language.

---

## 10. TRADEMARK-SAFE CAMERA ASSET RULES

Add these rules to implementation:

- Camera names may be used only as “look presets” or “inspired visual looks.”
- Do not claim the output is actually shot on that camera.
- Do not use official logos.
- Do not automatically scrape or download copyrighted product photos.
- Default camera PNGs must be original illustrated icons or simple silhouettes.
- If user uploads licensed PNGs, allow them to replace default icons.
- If camera name creates legal concern, show as:
  - “ARRI Alexa 35 Inspired Look”
  - “RED V-Raptor Inspired Look”
  - “Sony Venice 2 Inspired Look”

UI should use:

```text
Camera Look Preset
```

not:

```text
Real Camera Emulation Guarantee
```

Prompt should use:

```text
inspired cinematic look
```

not:

```text
shot on exact camera hardware
```

---

## 11. UPDATED FINAL PROMPT BUILDER

Update `buildNanoBananaCinemaPrompt(state)` to include:

- raw user prompt
- selected shot recipe
- selected camera body/look preset
- selected camera PNG metadata
- selected sample preview metadata
- lens pack
- focal length
- aperture
- style-translated camera language
- reference strength sliders
- seed/variation controls
- output controls
- prompt score metadata if available

Final JSON structure:

```json
{
  "model": "nano-banana-2",
  "task": "cinematic_image_generation",
  "raw_user_prompt": "",
  "shot_recipe": {
    "name": "",
    "promptBoost": ""
  },
  "camera_body": {
    "id": "",
    "name": "",
    "lookPreset": "",
    "promptInjection": "",
    "png": "",
    "samplePreview": ""
  },
  "lens_pack": {
    "id": "",
    "name": "",
    "promptInjection": ""
  },
  "style_translation": {
    "selectedStyle": "",
    "translatedCameraLanguage": ""
  },
  "reference_strength": {
    "faceLock": 85,
    "outfitLock": 80,
    "poseLock": 60,
    "styleLock": 75,
    "locationLock": 70,
    "lightingLock": 65
  },
  "generation_controls": {
    "seed": -1,
    "randomSeed": true,
    "variationStrength": 35,
    "creativeFreedom": 45,
    "promptAdherence": 75,
    "realismStrength": 80,
    "styleStrength": 75,
    "detailLevel": 80,
    "compositionStrictness": 65
  },
  "output": {
    "aspectRatio": "16:9",
    "resolution": "high",
    "imageCount": 1,
    "format": "png"
  },
  "prompt": "final optimized cinematic prompt",
  "negative_prompt": []
}
```

---

## 12. UPDATED UI ACCEPTANCE TESTS

- Lens Pack selector appears.
- Camera selection auto-suggests lens packs.
- Shot Recipe Library appears with search and filters.
- User can apply Hero Entry, Villain Reveal, Anime Power-Up, Cyberpunk Street, and other recipes.
- Reference Strength sliders appear for uploaded/generated references.
- Camera cards show PNG/icon and sample preview.
- Missing PNG/preview never breaks UI.
- Seed input and random seed toggle work.
- Generate Variation button works.
- Create 4 Variations button shows comparison grid.
- Output panel supports aspect ratio, resolution, image count, and format.
- Prompt Score card appears after AI Director or Analyze Prompt.
- Improve Prompt button improves weak prompts.
- Style translation changes camera language for Anime, Pixel, CGI, Photoreal, and Product modes.
- Trademark-safe camera asset rules are followed.
- Final nano-banana-2 JSON includes all selected camera/lens/reference/output controls.

---

## FINAL IMPLEMENTATION GOAL

After this add-on, Cinema Image Studio should become a full AI cinematography control room, not just a prompt box.

It must support:

- camera look presets
- camera PNG/icon cards
- sample look previews
- lens packs
- auto camera+lens pairing
- shot recipe library
- reference strength sliders
- seed and variation controls
- output controls
- prompt grading
- style-specific camera translation
- trademark-safe asset handling
- final nano-banana-2 JSON prompt generation
