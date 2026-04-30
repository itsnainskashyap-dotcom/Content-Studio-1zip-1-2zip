import { useEffect, useRef, useState } from "react";
import { Download, Upload } from "lucide-react";
import { toast } from "sonner";
import {
  storage,
  STYLES,
  backup,
  ImportParseError,
  type Settings,
  type ImportPreview,
  type ConflictResolution,
} from "@/lib/storage";

const PART_DURATIONS = [5, 10, 15, 20];
const LANGS: Array<{ key: Settings["defaultLanguage"]; label: string }> = [
  { key: "english", label: "English" },
  { key: "hindi", label: "हिंदी" },
  { key: "hinglish", label: "Hinglish" },
];

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings>(storage.getSettings());
  const [confirmClear, setConfirmClear] = useState(false);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(
    null,
  );
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setSettings(storage.getSettings());
  }, []);

  const update = (next: Partial<Settings>) => {
    const updated = { ...settings, ...next };
    setSettings(updated);
    storage.saveSettings(updated);
    toast.success("Settings saved");
  };

  const clearAll = () => {
    storage.clearAll();
    setSettings(storage.getSettings());
    setConfirmClear(false);
    window.dispatchEvent(new Event("cs:projects-changed"));
    toast.success("All data cleared");
  };

  const handleExportAll = () => {
    const count = backup.exportAll();
    if (count === 0) {
      toast.message("No projects to export yet — file is empty.");
    } else {
      toast.success(
        `Exported ${count} project${count === 1 ? "" : "s"} to a JSON file.`,
      );
    }
  };

  const handlePickFile = () => {
    fileInputRef.current?.click();
  };

  const handleFileChosen = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0];
    // Reset so picking the same file again still fires onChange.
    e.target.value = "";
    if (!file) return;
    try {
      const text = await file.text();
      const preview = backup.preview(text);
      if (preview.totalIncoming === 0) {
        toast.message("That file contained no projects.");
        return;
      }
      if (preview.conflicts.length === 0) {
        const result = backup.apply(preview, "skip");
        window.dispatchEvent(new Event("cs:projects-changed"));
        toast.success(
          `Imported ${result.added} project${result.added === 1 ? "" : "s"}.`,
        );
        return;
      }
      // Conflicts exist — let the user choose.
      setImportPreview(preview);
    } catch (err) {
      const msg =
        err instanceof ImportParseError
          ? err.message
          : "Couldn't read that file.";
      toast.error(msg);
    }
  };

  const resolveImport = (resolution: ConflictResolution) => {
    if (!importPreview) return;
    const result = backup.apply(importPreview, resolution);
    setImportPreview(null);
    window.dispatchEvent(new Event("cs:projects-changed"));
    const bits: string[] = [];
    if (result.added) bits.push(`${result.added} added`);
    if (result.replaced) bits.push(`${result.replaced} replaced`);
    if (result.duplicated) bits.push(`${result.duplicated} imported as copies`);
    if (result.skipped) bits.push(`${result.skipped} skipped`);
    toast.success(`Import complete — ${bits.join(", ")}.`);
  };

  return (
    <div className="px-4 py-8 md:px-12 md:py-14 max-w-3xl mx-auto">
      <div className="text-xs font-mono uppercase tracking-widest text-muted-foreground">
        Preferences
      </div>
      <h1 className="mt-1 font-display text-4xl md:text-5xl tracking-tight">
        Settings
      </h1>

      <section className="mt-10 border border-border rounded-md p-5 bg-card">
        <h2 className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
          Default per-part duration
        </h2>
        <div className="mt-2 flex gap-2 flex-wrap">
          {PART_DURATIONS.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => update({ defaultDuration: d })}
              className={`px-3 py-1.5 rounded-md text-xs font-mono uppercase tracking-widest border transition-colors ${
                settings.defaultDuration === d
                  ? "bg-primary text-black border-primary"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
              data-testid={`pref-duration-${d}`}
            >
              {d}s
            </button>
          ))}
        </div>
      </section>

      <section className="mt-6 border border-border rounded-md p-5 bg-card">
        <h2 className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
          Default style
        </h2>
        <select
          value={settings.defaultStyle}
          onChange={(e) => update({ defaultStyle: e.target.value })}
          className="mt-2 w-full bg-background border border-border rounded-md p-2 text-sm focus:outline-none focus:border-primary"
          data-testid="pref-style"
        >
          {STYLES.map((s) => (
            <option key={s.key} value={s.name}>
              {s.name}
            </option>
          ))}
        </select>
      </section>

      <section className="mt-6 border border-border rounded-md p-5 bg-card">
        <h2 className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
          Default voiceover language
        </h2>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {LANGS.map((l) => (
            <button
              key={l.key}
              type="button"
              onClick={() => update({ defaultLanguage: l.key })}
              className={`border rounded-md py-3 px-3 text-center transition-colors ${
                settings.defaultLanguage === l.key
                  ? "bg-primary text-black border-primary"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
              data-testid={`pref-lang-${l.key}`}
            >
              <div
                className="font-display text-lg"
                style={{
                  fontFamily:
                    l.key === "hindi"
                      ? "var(--app-font-devanagari, 'Noto Sans Devanagari', sans-serif)"
                      : undefined,
                }}
              >
                {l.label}
              </div>
            </button>
          ))}
        </div>
      </section>

      <section className="mt-6 border border-border rounded-md p-5 bg-card">
        <h2 className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
          Backup &amp; restore
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Projects are stored only in this browser. Export a JSON backup to
          keep them safe, share, or move to another device. Importing a file
          merges its projects in — anything that clashes with an existing
          project will ask before overwriting.
        </p>
        <div className="mt-3 flex gap-2 flex-wrap">
          <button
            type="button"
            onClick={handleExportAll}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-md border border-border font-mono text-xs uppercase tracking-widest hover:border-primary hover:text-primary transition-colors"
            data-testid="button-export-all"
          >
            <Download className="w-3.5 h-3.5" /> Export all projects
          </button>
          <button
            type="button"
            onClick={handlePickFile}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-md border border-border font-mono text-xs uppercase tracking-widest hover:border-primary hover:text-primary transition-colors"
            data-testid="button-import"
          >
            <Upload className="w-3.5 h-3.5" /> Import projects
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            onChange={handleFileChosen}
            className="hidden"
            data-testid="input-import-file"
          />
        </div>
      </section>

      <section className="mt-6 border border-[#FF4444]/40 rounded-md p-5 bg-card">
        <h2 className="font-mono text-xs uppercase tracking-widest text-[#FF4444]">
          Danger zone
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Clear every saved project, setting, and current project pointer in
          this browser. This cannot be undone.
        </p>
        <button
          type="button"
          onClick={() => setConfirmClear(true)}
          className="mt-3 px-4 py-2 rounded-md border border-[#FF4444] text-[#FF4444] font-mono text-xs uppercase tracking-widest hover:bg-[#FF4444]/10"
          data-testid="button-clear-all"
        >
          Clear all data
        </button>
      </section>

      <section className="mt-10 text-center text-[11px] text-muted-foreground/70 font-mono">
        ContentStudio AI · v0.1.0
      </section>

      {confirmClear && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4">
          <div className="border border-border bg-card rounded-md p-6 max-w-md w-full">
            <div className="font-display text-2xl tracking-tight">
              Clear everything?
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              All projects and settings will be permanently removed from this
              browser.
            </p>
            <div className="mt-5 flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setConfirmClear(false)}
                className="px-4 py-2 rounded-md border border-border font-mono text-xs uppercase tracking-widest"
                data-testid="button-cancel-clear"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={clearAll}
                className="px-4 py-2 rounded-md bg-[#FF4444] text-white font-mono text-xs uppercase tracking-widest hover:bg-[#FF6666]"
                data-testid="button-confirm-clear"
              >
                Clear all
              </button>
            </div>
          </div>
        </div>
      )}

      {importPreview && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4"
          data-testid="import-conflicts-modal"
        >
          <div className="border border-border bg-card rounded-md p-6 max-w-lg w-full">
            <div className="font-display text-2xl tracking-tight">
              Some projects already exist
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              {importPreview.fresh.length > 0 ? (
                <>
                  {importPreview.fresh.length} new project
                  {importPreview.fresh.length === 1 ? "" : "s"} will be added.
                  {" "}
                </>
              ) : null}
              {importPreview.conflicts.length} project
              {importPreview.conflicts.length === 1 ? "" : "s"} in the file
              {importPreview.conflicts.length === 1 ? " has" : " have"} the
              same id as something you already have. How should those be
              handled?
            </p>

            <div className="mt-3 max-h-40 overflow-auto border border-border rounded-md divide-y divide-border">
              {importPreview.conflicts.map((c) => (
                <div
                  key={c.id}
                  className="px-3 py-2 text-xs"
                  data-testid={`conflict-row-${c.id}`}
                >
                  <div className="font-mono uppercase tracking-widest text-muted-foreground">
                    Existing
                  </div>
                  <div className="truncate">{c.existing.title}</div>
                  <div className="mt-1 font-mono uppercase tracking-widest text-muted-foreground">
                    Incoming
                  </div>
                  <div className="truncate">{c.incoming.title}</div>
                </div>
              ))}
            </div>

            <div className="mt-5 flex gap-2 justify-end flex-wrap">
              <button
                type="button"
                onClick={() => setImportPreview(null)}
                className="px-4 py-2 rounded-md border border-border font-mono text-xs uppercase tracking-widest hover:border-foreground"
                data-testid="button-cancel-import"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => resolveImport("skip")}
                className="px-4 py-2 rounded-md border border-border font-mono text-xs uppercase tracking-widest hover:border-primary hover:text-primary"
                data-testid="button-import-skip"
              >
                Skip duplicates
              </button>
              <button
                type="button"
                onClick={() => resolveImport("duplicate")}
                className="px-4 py-2 rounded-md border border-border font-mono text-xs uppercase tracking-widest hover:border-primary hover:text-primary"
                data-testid="button-import-duplicate"
              >
                Import as copies
              </button>
              <button
                type="button"
                onClick={() => resolveImport("replace")}
                className="px-4 py-2 rounded-md bg-[#FF4444] text-white font-mono text-xs uppercase tracking-widest hover:bg-[#FF6666]"
                data-testid="button-import-replace"
              >
                Replace existing
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
