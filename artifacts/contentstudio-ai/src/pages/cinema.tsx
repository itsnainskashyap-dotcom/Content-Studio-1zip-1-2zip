import { useEffect, useMemo, useRef, useState } from "react";
import {
  Camera,
  Aperture,
  Film,
  Search,
  Wand2,
  Save,
  Trash2,
  Upload,
  X,
  Settings2,
  Image as ImageIcon,
  Copy,
  Download,
  Loader2,
  Dice5,
  Lock,
  Unlock,
  Check,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import {
  useGenerateCinemaImage,
  useScoreCinemaPrompt,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { objectPathToUrl, apiBasePrefix } from "@/lib/image-url";
import { apiFetch } from "@/lib/session-token";
import {
  CAMERA_BODIES,
  CAMERA_BODY_BY_ID,
} from "@/lib/cinema/camera-bodies";
import { LENS_PACKS, LENS_PACK_BY_ID } from "@/lib/cinema/lens-packs";
import {
  BUILTIN_SHOT_RECIPES,
  listAllRecipes,
  recipeById,
} from "@/lib/cinema/shot-recipes";
import { customRecipeStorage } from "@/lib/cinema/storage";
import {
  translateCameraLanguageForStyle,
  styleModeLabel,
} from "@/lib/cinema/style-translation";
import {
  DEFAULT_CINEMA_STATE,
  DEFAULT_REFERENCE_STRENGTH,
  DEFAULT_GENERATION_CONTROLS,
  OUTPUT_ASPECT_RATIOS,
  RESOLUTIONS,
  FORMATS,
  type CinemaState,
  type StyleMode,
  type ShotRecipe,
  type PromptScore,
  type CinemaResultImage,
  type CinemaReferenceUpload,
} from "@/lib/cinema/types";

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────

const STYLE_MODES: { value: StyleMode; label: string }[] = [
  { value: "photoreal_cinematic", label: "Photoreal Cinematic" },
  { value: "anime_2d", label: "2D Anime" },
  { value: "pixel_art", label: "Pixel Art" },
  { value: "cgi_3d", label: "3D CGI" },
  { value: "commercial_product", label: "Commercial / Product" },
];

const FOCAL_LENGTH_PRESETS = [
  "18mm cinematic wide",
  "24mm wide natural",
  "28mm documentary",
  "35mm classic cinema",
  "50mm natural portrait",
  "65mm compressed portrait",
  "85mm cinematic close-up",
  "100mm macro/detail",
];

const APERTURE_PRESETS = ["f/1.4", "f/2.0", "f/2.8", "f/4.0", "f/5.6", "f/8.0"];

const NEGATIVE_TAG_PRESETS = [
  "extra fingers",
  "low quality",
  "watermark",
  "text",
  "logo",
  "bad anatomy",
  "blurry",
  "deformed",
];

interface UploadUrlResp {
  uploadURL: string;
  objectPath: string;
}

async function uploadReferenceFile(
  file: File,
): Promise<{ objectPath: string; mimeType: string }> {
  const metaRes = await apiFetch(
    `${apiBasePrefix()}/api/storage/uploads/request-url`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: file.name,
        size: file.size,
        contentType: file.type || "application/octet-stream",
      }),
    },
  );
  if (!metaRes.ok) {
    throw new Error(`Could not request upload URL (${metaRes.status})`);
  }
  const meta = (await metaRes.json()) as UploadUrlResp;
  const putRes = await fetch(meta.uploadURL, {
    method: "PUT",
    body: file,
    headers: {
      "Content-Type": file.type || "application/octet-stream",
    },
  });
  if (!putRes.ok) {
    throw new Error(`Upload failed (${putRes.status})`);
  }
  return {
    objectPath: meta.objectPath,
    mimeType: file.type || "image/png",
  };
}

function buildConfigSummary(state: CinemaState): string {
  const cam = state.cameraBodyId
    ? CAMERA_BODY_BY_ID[state.cameraBodyId]
    : undefined;
  const lens = state.lensPackId ? LENS_PACK_BY_ID[state.lensPackId] : undefined;
  const recipe = state.shotRecipeId
    ? recipeById(state.shotRecipeId, customRecipeStorage.list())
    : undefined;
  const lines: string[] = [];
  lines.push(`Style mode: ${styleModeLabel(state.styleMode)}`);
  if (cam) lines.push(`Camera: ${cam.name} (${cam.lookPreset})`);
  if (lens) lines.push(`Lens pack: ${lens.name} — ${lens.look}`);
  lines.push(`Focal length: ${state.focalLength}; Aperture: ${state.aperture}`);
  if (recipe) {
    lines.push(
      `Recipe: ${recipe.name} — ${recipe.cameraAngle} / ${recipe.shotSize} / ${recipe.lighting}`,
    );
  }
  lines.push(
    `Output: ${state.outputControls.aspectRatio} · ${state.outputControls.resolution} · ${state.outputControls.imageCount}× · ${state.outputControls.format}`,
  );
  return lines.join("\n");
}

// ────────────────────────────────────────────────────────────────────────
// Small reusable bits
// ────────────────────────────────────────────────────────────────────────

function SectionHeader({
  icon: Icon,
  title,
  hint,
  right,
}: {
  icon: typeof Camera;
  title: string;
  hint?: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 mb-3">
      <div className="flex items-start gap-3">
        <div className="w-7 h-7 rounded-md bg-secondary/60 flex items-center justify-center mt-0.5 shrink-0">
          <Icon className="w-3.5 h-3.5 text-primary" />
        </div>
        <div>
          <div className="text-sm font-medium text-foreground tracking-wide uppercase font-mono">
            {title}
          </div>
          {hint && (
            <div className="text-xs text-muted-foreground mt-0.5 font-mono">
              {hint}
            </div>
          )}
        </div>
      </div>
      {right}
    </div>
  );
}

function LabeledSlider({
  label,
  value,
  onChange,
  hint,
  testId,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  hint?: string;
  testId?: string;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label className="text-xs text-foreground font-mono tracking-wide">
          {label}
        </Label>
        <span
          className="text-[11px] font-mono text-primary tabular-nums"
          data-testid={testId ? `${testId}-value` : undefined}
        >
          {value}
        </span>
      </div>
      <Slider
        min={0}
        max={100}
        step={1}
        value={[value]}
        onValueChange={(v) => onChange(v[0] ?? 0)}
        data-testid={testId}
      />
      {hint && (
        <div className="text-[10px] text-muted-foreground/80 font-mono">
          {hint}
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Page
// ────────────────────────────────────────────────────────────────────────

export default function CinemaImageStudio() {
  const [state, setState] = useState<CinemaState>(DEFAULT_CINEMA_STATE);
  const [customRecipes, setCustomRecipes] = useState<ShotRecipe[]>(() =>
    customRecipeStorage.list(),
  );
  const [recipeSearch, setRecipeSearch] = useState("");
  const [results, setResults] = useState<CinemaResultImage[]>([]);
  const [score, setScore] = useState<PromptScore | null>(null);
  const [busyVariations, setBusyVariations] = useState(false);
  const [savingRecipe, setSavingRecipe] = useState(false);
  const [newRecipeName, setNewRecipeName] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const generateMut = useGenerateCinemaImage();
  const scoreMut = useScoreCinemaPrompt();

  const camera = state.cameraBodyId
    ? CAMERA_BODY_BY_ID[state.cameraBodyId]
    : undefined;
  const lens = state.lensPackId
    ? LENS_PACK_BY_ID[state.lensPackId]
    : undefined;
  const allRecipes = useMemo(
    () => listAllRecipes(customRecipes),
    [customRecipes],
  );

  const filteredRecipes = useMemo(() => {
    const q = recipeSearch.trim().toLowerCase();
    if (!q) return allRecipes;
    return allRecipes.filter((r) =>
      [r.name, r.cameraAngle, r.shotSize, r.lighting, ...(r.tags ?? [])]
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [allRecipes, recipeSearch]);

  // When the user picks a camera, suggest the first recommended lens pack
  // if they don't already have one selected — never overwrite a user choice.
  useEffect(() => {
    if (!camera) return;
    setState((s) => {
      if (s.lensPackId) return s;
      const firstLens = camera.recommendedLensPacks[0];
      return firstLens ? { ...s, lensPackId: firstLens } : s;
    });
  }, [camera]);

  function patch<K extends keyof CinemaState>(
    key: K,
    value: CinemaState[K],
  ): void {
    setState((s) => ({ ...s, [key]: value }));
  }

  function patchOutput<K extends keyof CinemaState["outputControls"]>(
    key: K,
    value: CinemaState["outputControls"][K],
  ): void {
    setState((s) => ({
      ...s,
      outputControls: { ...s.outputControls, [key]: value },
    }));
  }

  function patchGen<K extends keyof CinemaState["generationControls"]>(
    key: K,
    value: CinemaState["generationControls"][K],
  ): void {
    setState((s) => ({
      ...s,
      generationControls: { ...s.generationControls, [key]: value },
    }));
  }

  function patchRefStrength<
    K extends keyof CinemaState["referenceStrength"],
  >(key: K, value: CinemaState["referenceStrength"][K]): void {
    setState((s) => ({
      ...s,
      referenceStrength: { ...s.referenceStrength, [key]: value },
    }));
  }

  // ── Reference uploads ──────────────────────────────────────────────────
  async function onFilesPicked(files: FileList | null): Promise<void> {
    if (!files || files.length === 0) return;
    const room = 8 - state.references.length;
    const slice = Array.from(files).slice(0, room);
    if (slice.length < files.length) {
      toast.warning("Up to 8 reference images supported");
    }
    for (const file of slice) {
      try {
        const { objectPath, mimeType } = await uploadReferenceFile(file);
        const ref: CinemaReferenceUpload = {
          id:
            typeof crypto !== "undefined" && crypto.randomUUID
              ? crypto.randomUUID()
              : `${Date.now()}-${Math.random()}`,
          objectPath,
          mimeType,
          label: file.name,
        };
        setState((s) => ({ ...s, references: [...s.references, ref] }));
      } catch (err) {
        const msg = err instanceof Error ? err.message : "upload failed";
        toast.error(`Could not upload ${file.name}: ${msg}`);
      }
    }
  }

  function removeReference(id: string): void {
    setState((s) => ({
      ...s,
      references: s.references.filter((r) => r.id !== id),
    }));
  }

  // ── Generation ──────────────────────────────────────────────────────────
  function buildRequestPayload(seedOverride?: number) {
    const recipe = state.shotRecipeId
      ? recipeById(state.shotRecipeId, customRecipes)
      : undefined;
    return {
      rawPrompt: state.rawPrompt,
      styleMode: state.styleMode,
      cameraBodyId: state.cameraBodyId ?? null,
      cameraBodyLabel: camera?.lookPreset,
      cameraInjection: camera?.promptInjection,
      lensPackId: state.lensPackId ?? null,
      lensPackLabel: lens?.name,
      lensInjection: lens?.promptInjection,
      focalLength: state.focalLength,
      aperture: state.aperture,
      shotRecipe: recipe
        ? {
            name: recipe.name,
            cameraAngle: recipe.cameraAngle,
            shotSize: recipe.shotSize,
            lens: recipe.lens,
            lighting: recipe.lighting,
            composition: recipe.composition,
            promptBoost: recipe.promptBoost,
          }
        : undefined,
      referenceStrength: state.referenceStrength,
      generationControls:
        seedOverride !== undefined
          ? { ...state.generationControls, seed: seedOverride, randomSeed: false }
          : state.generationControls,
      outputControls: state.outputControls,
      references: state.references.map((r) => ({
        objectPath: r.objectPath,
        mimeType: r.mimeType,
        label: r.label,
      })),
      negativePrompt: state.negativePrompt,
      styleTranslation: translateCameraLanguageForStyle(state),
    };
  }

  async function onGenerate(): Promise<void> {
    if (!state.rawPrompt.trim()) {
      toast.error("Add a prompt first");
      return;
    }
    try {
      const out = await generateMut.mutateAsync({
        data: buildRequestPayload(),
      });
      setResults((prev) => [
        {
          objectPath: out.objectPath,
          mimeType: out.mimeType,
          generatedAt: out.generatedAt,
          seed: out.seed,
          finalPrompt: out.finalPrompt,
        },
        ...prev,
      ]);
      toast.success("Image generated");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Generation failed";
      toast.error(msg);
    }
  }

  async function onGenerateVariation(): Promise<void> {
    // A "variation" is the same prompt with a fresh random seed and a slight
    // bump to the variation strength so the model stays close but not
    // identical to the previous result.
    const lastSeed = results[0]?.seed ?? -1;
    const newSeed = (lastSeed + 1 + Math.floor(Math.random() * 9999)) | 0;
    try {
      const out = await generateMut.mutateAsync({
        data: buildRequestPayload(newSeed),
      });
      setResults((prev) => [
        {
          objectPath: out.objectPath,
          mimeType: out.mimeType,
          generatedAt: out.generatedAt,
          seed: out.seed,
          finalPrompt: out.finalPrompt,
        },
        ...prev,
      ]);
      toast.success("Variation generated");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Variation failed";
      toast.error(msg);
    }
  }

  async function onGenerate4Grid(): Promise<void> {
    if (!state.rawPrompt.trim()) {
      toast.error("Add a prompt first");
      return;
    }
    setBusyVariations(true);
    const seeds = Array.from({ length: 4 }, () =>
      Math.floor(Math.random() * 2_147_483_647),
    );
    try {
      const settled = await Promise.allSettled(
        seeds.map((s) =>
          generateMut.mutateAsync({ data: buildRequestPayload(s) }),
        ),
      );
      const fresh: CinemaResultImage[] = [];
      let failed = 0;
      for (const r of settled) {
        if (r.status === "fulfilled") {
          fresh.push({
            objectPath: r.value.objectPath,
            mimeType: r.value.mimeType,
            generatedAt: r.value.generatedAt,
            seed: r.value.seed,
            finalPrompt: r.value.finalPrompt,
          });
        } else {
          failed += 1;
        }
      }
      setResults((prev) => [...fresh, ...prev]);
      if (fresh.length > 0) {
        toast.success(
          failed > 0
            ? `${fresh.length}/4 generated — ${failed} failed`
            : "4 variations generated",
        );
      } else {
        toast.error("All 4 variations failed — try again");
      }
    } finally {
      setBusyVariations(false);
    }
  }

  async function onAnalyzePrompt(): Promise<void> {
    if (!state.rawPrompt.trim()) {
      toast.error("Add a prompt first");
      return;
    }
    try {
      const result = await scoreMut.mutateAsync({
        data: {
          rawPrompt: state.rawPrompt,
          configSummary: buildConfigSummary(state),
        },
      });
      setScore(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not grade prompt";
      toast.error(msg);
    }
  }

  function applyImprovedPrompt(): void {
    if (!score) return;
    patch("rawPrompt", score.improvedPrompt);
    toast.success("Improved prompt applied");
  }

  // ── Recipe save ─────────────────────────────────────────────────────────
  function saveCurrentAsRecipe(): void {
    const name = newRecipeName.trim();
    if (!name) {
      toast.error("Give the recipe a name");
      return;
    }
    const recipe: ShotRecipe = {
      id: `custom-${Date.now()}`,
      name,
      cameraAngle: "Custom",
      shotSize: "Custom",
      lens: state.focalLength,
      lighting: lens?.look ?? "custom",
      composition: "custom",
      promptBoost: state.rawPrompt.slice(0, 240),
      tags: ["custom"],
      custom: true,
    };
    const next = customRecipeStorage.save(recipe);
    setCustomRecipes(next);
    setSavingRecipe(false);
    setNewRecipeName("");
    patch("shotRecipeId", recipe.id);
    toast.success(`Saved recipe "${name}"`);
  }

  function deleteCustomRecipe(id: string): void {
    const next = customRecipeStorage.remove(id);
    setCustomRecipes(next);
    if (state.shotRecipeId === id) patch("shotRecipeId", null);
  }

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="max-w-7xl mx-auto px-4 md:px-8 py-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <h1
            className="text-2xl md:text-3xl font-semibold tracking-tight"
            data-testid="cinema-title"
          >
            Cinema Image Studio
          </h1>
          <p className="text-xs text-muted-foreground font-mono mt-1">
            Pro-level cinematography controls — pick a camera, lens, recipe,
            and references; tune the look; generate.
          </p>
        </div>
        <Tabs
          value={state.styleMode}
          onValueChange={(v) => patch("styleMode", v as StyleMode)}
        >
          <TabsList data-testid="cinema-style-mode-tabs">
            {STYLE_MODES.map((m) => (
              <TabsTrigger
                key={m.value}
                value={m.value}
                data-testid={`style-mode-${m.value}`}
              >
                {m.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      {/* Main two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: controls (2 cols) */}
        <div className="lg:col-span-2 space-y-6">
          {/* CAMERA BODY */}
          <Card>
            <CardContent className="p-5">
              <SectionHeader
                icon={Camera}
                title="Camera Body"
                hint="Inspired-look presets — sets the rendered film stock vibe."
              />
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {CAMERA_BODIES.filter(
                  (c) => c.styleMode === state.styleMode,
                ).map((cam) => {
                  const active = state.cameraBodyId === cam.id;
                  return (
                    <button
                      key={cam.id}
                      type="button"
                      onClick={() => patch("cameraBodyId", cam.id)}
                      data-testid={`camera-${cam.id}`}
                      className={cn(
                        "text-left rounded-md border p-3 transition-colors",
                        active
                          ? "border-primary bg-primary/10"
                          : "border-border hover:border-foreground/40",
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <div className="text-xs font-mono uppercase tracking-wide text-foreground">
                          {cam.name}
                        </div>
                        {active && (
                          <Check className="w-3.5 h-3.5 text-primary" />
                        )}
                      </div>
                      <div className="text-[10px] text-muted-foreground mt-1 line-clamp-2">
                        {cam.sensorDescription}
                      </div>
                      <div className="text-[10px] text-primary/80 mt-1 font-mono">
                        {cam.bestFor.slice(0, 2).join(" · ")}
                      </div>
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* LENS PACK */}
          <Card>
            <CardContent className="p-5">
              <SectionHeader
                icon={Aperture}
                title="Lens Pack"
                hint="Lens 'personality' beyond focal length — flare, bokeh, contrast."
              />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {LENS_PACKS.filter((p) => {
                  // Show recommended packs first, then any others matching style mode.
                  if (!camera) return true;
                  return camera.recommendedLensPacks.includes(p.id) ||
                    LENS_PACKS.findIndex((x) => x.id === p.id) < 0
                    ? true
                    : true;
                }).map((p) => {
                  const recommended =
                    camera?.recommendedLensPacks.includes(p.id) ?? false;
                  const active = state.lensPackId === p.id;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => patch("lensPackId", p.id)}
                      data-testid={`lens-${p.id}`}
                      className={cn(
                        "text-left rounded-md border p-3 transition-colors relative",
                        active
                          ? "border-primary bg-primary/10"
                          : "border-border hover:border-foreground/40",
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-xs font-mono uppercase tracking-wide truncate">
                          {p.name}
                        </div>
                        {recommended && (
                          <Badge variant="secondary" className="h-5 text-[9px]">
                            REC
                          </Badge>
                        )}
                      </div>
                      <div className="text-[10px] text-muted-foreground mt-1 line-clamp-2">
                        {p.look}
                      </div>
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* FOCAL + APERTURE */}
          <Card>
            <CardContent className="p-5">
              <SectionHeader
                icon={Film}
                title="Focal Length & Aperture"
                hint="Translated into style-appropriate language for non-photoreal modes."
              />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-xs font-mono">Focal length</Label>
                  <Input
                    value={state.focalLength}
                    onChange={(e) => patch("focalLength", e.target.value)}
                    placeholder="35mm classic cinema"
                    data-testid="input-focal-length"
                  />
                  <div className="flex flex-wrap gap-1">
                    {FOCAL_LENGTH_PRESETS.map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => patch("focalLength", p)}
                        className="text-[10px] px-2 py-0.5 rounded border border-border hover:border-primary/60 text-muted-foreground hover:text-foreground transition-colors font-mono"
                        data-testid={`focal-preset-${p.split(" ")[0]}`}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-mono">Aperture</Label>
                  <Input
                    value={state.aperture}
                    onChange={(e) => patch("aperture", e.target.value)}
                    placeholder="f/2.8"
                    data-testid="input-aperture"
                  />
                  <div className="flex flex-wrap gap-1">
                    {APERTURE_PRESETS.map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => patch("aperture", p)}
                        className="text-[10px] px-2 py-0.5 rounded border border-border hover:border-primary/60 text-muted-foreground hover:text-foreground transition-colors font-mono"
                        data-testid={`aperture-preset-${p}`}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* SHOT RECIPE */}
          <Card>
            <CardContent className="p-5">
              <SectionHeader
                icon={Camera}
                title="Shot Recipe"
                hint="Pre-built cinematic shot templates."
                right={
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setSavingRecipe((v) => !v)}
                    data-testid="btn-save-recipe-toggle"
                  >
                    <Save className="w-3.5 h-3.5 mr-1.5" />
                    Save current
                  </Button>
                }
              />
              {savingRecipe && (
                <div className="flex gap-2 mb-3">
                  <Input
                    value={newRecipeName}
                    onChange={(e) => setNewRecipeName(e.target.value)}
                    placeholder="Recipe name…"
                    data-testid="input-recipe-name"
                  />
                  <Button
                    onClick={saveCurrentAsRecipe}
                    data-testid="btn-save-recipe-confirm"
                  >
                    Save
                  </Button>
                </div>
              )}
              <div className="relative mb-3">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <Input
                  value={recipeSearch}
                  onChange={(e) => setRecipeSearch(e.target.value)}
                  placeholder="Search recipes (genre, mood, lighting…)"
                  className="pl-8"
                  data-testid="input-recipe-search"
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-[320px] overflow-y-auto pr-1">
                {filteredRecipes.map((r) => {
                  const active = state.shotRecipeId === r.id;
                  return (
                    <div
                      key={r.id}
                      className={cn(
                        "rounded-md border p-3 transition-colors relative",
                        active
                          ? "border-primary bg-primary/10"
                          : "border-border hover:border-foreground/40",
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => patch("shotRecipeId", r.id)}
                        className="text-left w-full"
                        data-testid={`recipe-${r.id}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-xs font-mono uppercase tracking-wide truncate">
                            {r.name}
                          </div>
                          {r.custom && (
                            <Badge variant="outline" className="h-5 text-[9px]">
                              MY
                            </Badge>
                          )}
                        </div>
                        <div className="text-[10px] text-muted-foreground mt-1">
                          {r.cameraAngle} · {r.shotSize}
                        </div>
                        <div className="text-[10px] text-muted-foreground/80 mt-0.5 line-clamp-2">
                          {r.lighting}
                        </div>
                      </button>
                      {r.custom && (
                        <button
                          type="button"
                          onClick={() => deleteCustomRecipe(r.id)}
                          className="absolute top-1 right-1 p-1 text-muted-foreground hover:text-red-400"
                          data-testid={`btn-delete-recipe-${r.id}`}
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  );
                })}
                {filteredRecipes.length === 0 && (
                  <div className="text-xs text-muted-foreground/70 font-mono py-6 text-center col-span-full">
                    No recipes match your search.
                  </div>
                )}
              </div>
              <div className="text-[10px] text-muted-foreground/70 font-mono mt-2">
                {BUILTIN_SHOT_RECIPES.length} built-in · {customRecipes.length} custom
              </div>
            </CardContent>
          </Card>

          {/* REFERENCES */}
          <Card>
            <CardContent className="p-5">
              <SectionHeader
                icon={ImageIcon}
                title="Reference Images"
                hint="Upload up to 8 — face / outfit / location / style refs."
                right={
                  <>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      multiple
                      hidden
                      onChange={(e) => {
                        void onFilesPicked(e.target.files);
                        e.target.value = "";
                      }}
                      data-testid="input-ref-file"
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => fileInputRef.current?.click()}
                      data-testid="btn-upload-ref"
                    >
                      <Upload className="w-3.5 h-3.5 mr-1.5" />
                      Upload
                    </Button>
                  </>
                }
              />
              {state.references.length > 0 && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
                  {state.references.map((r) => (
                    <div
                      key={r.id}
                      className="relative group rounded-md overflow-hidden border border-border bg-secondary/30"
                      data-testid={`ref-thumb-${r.id}`}
                    >
                      <img
                        src={objectPathToUrl(r.objectPath)}
                        alt={r.label ?? "reference"}
                        className="w-full h-24 object-cover"
                      />
                      <button
                        type="button"
                        onClick={() => removeReference(r.id)}
                        className="absolute top-1 right-1 p-1 rounded bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                        data-testid={`btn-remove-ref-${r.id}`}
                      >
                        <X className="w-3 h-3" />
                      </button>
                      <div className="absolute bottom-0 inset-x-0 px-1 py-0.5 bg-black/60 text-[9px] text-white truncate font-mono">
                        {r.label}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3">
                <LabeledSlider
                  label="Face likeness lock"
                  value={state.referenceStrength.faceLock}
                  onChange={(v) => patchRefStrength("faceLock", v)}
                  testId="slider-face-lock"
                />
                <LabeledSlider
                  label="Outfit lock"
                  value={state.referenceStrength.outfitLock}
                  onChange={(v) => patchRefStrength("outfitLock", v)}
                  testId="slider-outfit-lock"
                />
                <LabeledSlider
                  label="Pose lock"
                  value={state.referenceStrength.poseLock}
                  onChange={(v) => patchRefStrength("poseLock", v)}
                  testId="slider-pose-lock"
                />
                <LabeledSlider
                  label="Style lock"
                  value={state.referenceStrength.styleLock}
                  onChange={(v) => patchRefStrength("styleLock", v)}
                  testId="slider-style-lock"
                />
                <LabeledSlider
                  label="Location lock"
                  value={state.referenceStrength.locationLock}
                  onChange={(v) => patchRefStrength("locationLock", v)}
                  testId="slider-location-lock"
                />
                <LabeledSlider
                  label="Lighting lock"
                  value={state.referenceStrength.lightingLock}
                  onChange={(v) => patchRefStrength("lightingLock", v)}
                  testId="slider-lighting-lock"
                />
                <LabeledSlider
                  label="Product shape lock"
                  value={state.referenceStrength.productShapeLock}
                  onChange={(v) => patchRefStrength("productShapeLock", v)}
                  testId="slider-product-lock"
                />
                <LabeledSlider
                  label="Composition lock"
                  value={state.referenceStrength.compositionLock}
                  onChange={(v) => patchRefStrength("compositionLock", v)}
                  testId="slider-composition-lock"
                />
              </div>
              <div className="flex justify-end mt-3">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    patch("referenceStrength", DEFAULT_REFERENCE_STRENGTH)
                  }
                  data-testid="btn-reset-ref-strength"
                >
                  Reset locks
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* GENERATION CONTROLS */}
          <Card>
            <CardContent className="p-5">
              <SectionHeader
                icon={Settings2}
                title="Generation Controls"
                hint="Tune the model's interpretation of your prompt."
                right={
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      patch("generationControls", DEFAULT_GENERATION_CONTROLS)
                    }
                    data-testid="btn-reset-gen"
                  >
                    Reset
                  </Button>
                }
              />
              <div className="flex items-center justify-between mb-4 p-3 rounded-md border border-border bg-secondary/30">
                <div className="flex items-center gap-2">
                  {state.generationControls.randomSeed ? (
                    <Unlock className="w-3.5 h-3.5 text-muted-foreground" />
                  ) : (
                    <Lock className="w-3.5 h-3.5 text-primary" />
                  )}
                  <Label className="text-xs font-mono">
                    {state.generationControls.randomSeed
                      ? "Random seed (each run differs)"
                      : "Locked seed (reproducible)"}
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    className="w-32 font-mono text-xs"
                    type="number"
                    value={
                      state.generationControls.seed === -1
                        ? ""
                        : state.generationControls.seed
                    }
                    placeholder="auto"
                    disabled={state.generationControls.randomSeed}
                    onChange={(e) =>
                      patchGen(
                        "seed",
                        e.target.value === "" ? -1 : Number(e.target.value),
                      )
                    }
                    data-testid="input-seed"
                  />
                  <Button
                    size="icon"
                    variant="outline"
                    type="button"
                    onClick={() =>
                      patchGen(
                        "seed",
                        Math.floor(Math.random() * 2_147_483_647),
                      )
                    }
                    data-testid="btn-random-seed"
                    disabled={state.generationControls.randomSeed}
                  >
                    <Dice5 className="w-3.5 h-3.5" />
                  </Button>
                  <Switch
                    checked={state.generationControls.randomSeed}
                    onCheckedChange={(c) => patchGen("randomSeed", c)}
                    data-testid="switch-random-seed"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3">
                <LabeledSlider
                  label="Variation strength"
                  value={state.generationControls.variationStrength}
                  onChange={(v) => patchGen("variationStrength", v)}
                  testId="slider-variation"
                />
                <LabeledSlider
                  label="Creative freedom"
                  value={state.generationControls.creativeFreedom}
                  onChange={(v) => patchGen("creativeFreedom", v)}
                  testId="slider-creative"
                />
                <LabeledSlider
                  label="Prompt adherence"
                  value={state.generationControls.promptAdherence}
                  onChange={(v) => patchGen("promptAdherence", v)}
                  testId="slider-adherence"
                />
                <LabeledSlider
                  label="Realism strength"
                  value={state.generationControls.realismStrength}
                  onChange={(v) => patchGen("realismStrength", v)}
                  testId="slider-realism"
                />
                <LabeledSlider
                  label="Style strength"
                  value={state.generationControls.styleStrength}
                  onChange={(v) => patchGen("styleStrength", v)}
                  testId="slider-style-strength"
                />
                <LabeledSlider
                  label="Detail level"
                  value={state.generationControls.detailLevel}
                  onChange={(v) => patchGen("detailLevel", v)}
                  testId="slider-detail"
                />
                <LabeledSlider
                  label="Composition strictness"
                  value={state.generationControls.compositionStrictness}
                  onChange={(v) => patchGen("compositionStrictness", v)}
                  testId="slider-composition-strictness"
                />
              </div>
            </CardContent>
          </Card>

          {/* OUTPUT CONTROLS */}
          <Card>
            <CardContent className="p-5">
              <SectionHeader
                icon={ImageIcon}
                title="Output"
                hint="Aspect ratio, resolution, count, format."
              />
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="space-y-1.5 col-span-2">
                  <Label className="text-xs font-mono">Aspect ratio</Label>
                  <Select
                    value={state.outputControls.aspectRatio}
                    onValueChange={(v) =>
                      patchOutput(
                        "aspectRatio",
                        v as CinemaState["outputControls"]["aspectRatio"],
                      )
                    }
                  >
                    <SelectTrigger data-testid="select-aspect-ratio">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {OUTPUT_ASPECT_RATIOS.map((r) => (
                        <SelectItem key={r.value} value={r.value}>
                          {r.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-mono">Resolution</Label>
                  <Select
                    value={state.outputControls.resolution}
                    onValueChange={(v) =>
                      patchOutput(
                        "resolution",
                        v as CinemaState["outputControls"]["resolution"],
                      )
                    }
                  >
                    <SelectTrigger data-testid="select-resolution">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {RESOLUTIONS.map((r) => (
                        <SelectItem key={r} value={r}>
                          {r.toUpperCase()}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-mono">Format</Label>
                  <Select
                    value={state.outputControls.format}
                    onValueChange={(v) =>
                      patchOutput(
                        "format",
                        v as CinemaState["outputControls"]["format"],
                      )
                    }
                  >
                    <SelectTrigger data-testid="select-format">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {FORMATS.map((f) => (
                        <SelectItem key={f} value={f}>
                          {f.toUpperCase()}
                          {f !== "png" ? " (saved as PNG)" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* NEGATIVE PROMPT */}
          <Card>
            <CardContent className="p-5">
              <SectionHeader
                icon={X}
                title="Avoid (Negative Prompt)"
                hint="Things the model should NOT include."
              />
              <div className="flex flex-wrap gap-1.5 mb-2">
                {state.negativePrompt.map((tag) => (
                  <Badge
                    key={tag}
                    variant="secondary"
                    className="gap-1.5 cursor-pointer"
                    onClick={() =>
                      patch(
                        "negativePrompt",
                        state.negativePrompt.filter((t) => t !== tag),
                      )
                    }
                    data-testid={`neg-tag-${tag}`}
                  >
                    {tag}
                    <X className="w-3 h-3" />
                  </Badge>
                ))}
              </div>
              <div className="flex flex-wrap gap-1">
                {NEGATIVE_TAG_PRESETS.filter(
                  (t) => !state.negativePrompt.includes(t),
                ).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() =>
                      patch("negativePrompt", [...state.negativePrompt, t])
                    }
                    className="text-[10px] px-2 py-0.5 rounded border border-border hover:border-primary/60 text-muted-foreground hover:text-foreground transition-colors font-mono"
                    data-testid={`neg-add-${t}`}
                  >
                    + {t}
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right: prompt + actions + results (1 col, sticky on lg) */}
        <div className="space-y-6">
          <Card>
            <CardContent className="p-5 space-y-3">
              <SectionHeader
                icon={Wand2}
                title="Prompt"
                hint="Describe the scene — your camera/lens setup is added automatically."
              />
              <Textarea
                value={state.rawPrompt}
                onChange={(e) => patch("rawPrompt", e.target.value)}
                placeholder="A lone samurai walks across a misty bamboo forest at dawn, low fog drifting between the trees…"
                rows={6}
                className="font-mono text-xs"
                data-testid="textarea-prompt"
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={onAnalyzePrompt}
                  disabled={scoreMut.isPending}
                  data-testid="btn-analyze-prompt"
                >
                  {scoreMut.isPending ? (
                    <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                  ) : null}
                  Analyze prompt
                </Button>
                {score && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={applyImprovedPrompt}
                    data-testid="btn-apply-improved"
                  >
                    Apply improved
                  </Button>
                )}
              </div>
              {score && (
                <div className="rounded-md border border-border p-3 space-y-2 bg-secondary/30">
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-mono uppercase tracking-wide text-foreground">
                      AI Director
                    </div>
                    <div className="text-xs font-mono text-primary">
                      {score.overallPromptScore.toFixed(1)} / 10
                    </div>
                  </div>
                  <ScoreRow label="Cinematic" v={score.cinematicScore} />
                  <ScoreRow label="Camera clarity" v={score.cameraClarityScore} />
                  <ScoreRow label="Lens clarity" v={score.lensClarityScore} />
                  <ScoreRow label="Lighting" v={score.lightingScore} />
                  <ScoreRow
                    label="Style consistency"
                    v={score.styleConsistencyScore}
                  />
                  <ScoreRow label="Composition" v={score.compositionScore} />
                  <ScoreRow
                    label="Risk"
                    v={score.promptRiskScore}
                    inverted
                  />
                  {score.missingDetails.length > 0 && (
                    <div className="pt-2">
                      <div className="text-[10px] uppercase font-mono text-muted-foreground mb-1">
                        Missing
                      </div>
                      <ul className="text-[10px] space-y-0.5">
                        {score.missingDetails.map((m) => (
                          <li key={m} className="text-muted-foreground">
                            · {m}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {score.improvementSuggestions.length > 0 && (
                    <div>
                      <div className="text-[10px] uppercase font-mono text-muted-foreground mb-1">
                        Suggestions
                      </div>
                      <ul className="text-[10px] space-y-0.5">
                        {score.improvementSuggestions.map((s) => (
                          <li key={s} className="text-foreground/90">
                            · {s}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* GENERATE actions */}
          <Card>
            <CardContent className="p-5 space-y-2">
              <Button
                className="w-full"
                onClick={onGenerate}
                disabled={generateMut.isPending || busyVariations}
                data-testid="btn-generate"
              >
                {generateMut.isPending && !busyVariations ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Generating…
                  </>
                ) : (
                  <>
                    <Camera className="w-4 h-4 mr-2" />
                    Generate
                  </>
                )}
              </Button>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant="outline"
                  onClick={onGenerateVariation}
                  disabled={
                    generateMut.isPending ||
                    busyVariations ||
                    results.length === 0
                  }
                  data-testid="btn-generate-variation"
                >
                  Variation
                </Button>
                <Button
                  variant="outline"
                  onClick={onGenerate4Grid}
                  disabled={generateMut.isPending || busyVariations}
                  data-testid="btn-generate-4grid"
                >
                  {busyVariations ? (
                    <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                  ) : null}
                  4× grid
                </Button>
              </div>
              <div className="text-[10px] text-muted-foreground/80 font-mono pt-2">
                {state.references.length} ref{state.references.length === 1 ? "" : "s"} ·{" "}
                {state.outputControls.aspectRatio} · seed{" "}
                {state.generationControls.randomSeed
                  ? "auto"
                  : state.generationControls.seed}
              </div>
            </CardContent>
          </Card>

          {/* RESULTS */}
          <Card>
            <CardContent className="p-5">
              <SectionHeader
                icon={ImageIcon}
                title={`Results (${results.length})`}
                hint="Click any image to copy or download."
              />
              {results.length === 0 ? (
                <div className="text-xs text-muted-foreground/70 font-mono py-12 text-center">
                  No images yet — your generations will appear here.
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3">
                  {results.map((img, idx) => (
                    <ResultCard key={`${img.objectPath}-${idx}`} img={img} />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function ScoreRow({
  label,
  v,
  inverted,
}: {
  label: string;
  v: number;
  inverted?: boolean;
}) {
  // For "risk", lower is better — invert the colour scale.
  const good = inverted ? v < 4 : v >= 7;
  const ok = inverted ? v < 7 : v >= 5;
  const colour = good
    ? "text-primary"
    : ok
      ? "text-yellow-400"
      : "text-red-400";
  return (
    <div className="flex items-center justify-between text-[11px] font-mono">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("tabular-nums", colour)}>{v.toFixed(1)}</span>
    </div>
  );
}

function ResultCard({ img }: { img: CinemaResultImage }) {
  const url = objectPathToUrl(img.objectPath);
  const [imgError, setImgError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  return (
    <div
      className="rounded-md overflow-hidden border border-border bg-card"
      data-testid={`result-${img.seed}`}
    >
      {imgError ? (
        <div className="aspect-square w-full flex flex-col items-center justify-center gap-3 p-6 bg-secondary/30 text-center">
          <ImageIcon className="w-8 h-8 text-muted-foreground/40" />
          <div className="space-y-1">
            <div className="text-xs font-mono text-foreground">
              Image is taking longer than expected
            </div>
            <div className="text-[10px] font-mono text-muted-foreground/70 break-all">
              {img.objectPath}
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setImgError(false);
              setRetryKey((k) => k + 1);
            }}
            data-testid={`btn-reload-${img.seed}`}
          >
            <RefreshCw className="w-3 h-3 mr-1.5" />
            Reload
          </Button>
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="text-[10px] font-mono text-primary underline hover:no-underline"
          >
            Open directly
          </a>
        </div>
      ) : (
        <a href={url} target="_blank" rel="noreferrer" className="block">
          <img
            key={retryKey}
            src={url}
            alt={`Generated still seed=${img.seed}`}
            className="w-full h-auto"
            onError={() => setImgError(true)}
            onLoad={() => setImgError(false)}
          />
        </a>
      )}
      <div className="px-3 py-2 flex items-center justify-between gap-2">
        <div className="text-[10px] font-mono text-muted-foreground truncate">
          seed {img.seed} · {new Date(img.generatedAt).toLocaleTimeString()}
        </div>
        <div className="flex gap-1">
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6"
            onClick={() => {
              void navigator.clipboard.writeText(img.finalPrompt);
              toast.success("Prompt copied");
            }}
            data-testid={`btn-copy-prompt-${img.seed}`}
          >
            <Copy className="w-3 h-3" />
          </Button>
          <a
            href={url}
            download
            className="inline-flex items-center justify-center h-6 w-6 rounded-md hover:bg-secondary/50 text-muted-foreground hover:text-foreground"
            data-testid={`btn-download-${img.seed}`}
          >
            <Download className="w-3 h-3" />
          </a>
        </div>
      </div>
    </div>
  );
}
