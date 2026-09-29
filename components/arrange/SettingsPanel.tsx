"use client";

import type { AutoGenerateSettings } from "@/lib/arrange/types";

interface Props {
  settings: AutoGenerateSettings;
  onChange: (settings: AutoGenerateSettings) => void;
  onAutoGenerate: () => void;
  onExport: () => void;
  onClear: () => void;
  canExport: boolean;
  resultCount: number;
  generating: boolean;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-widest text-muted">{label}</span>
      {children}
    </div>
  );
}

const inputClass = "border border-line bg-transparent px-2 py-1 text-xs text-foam focus:border-accent focus:outline-none";

export default function SettingsPanel({
  settings,
  onChange,
  onAutoGenerate,
  onExport,
  onClear,
  canExport,
  resultCount,
  generating,
}: Props) {
  const set = <K extends keyof AutoGenerateSettings>(key: K, value: AutoGenerateSettings[K]) =>
    onChange({ ...settings, [key]: value });

  return (
    <div className="flex flex-col gap-4">
      <Field label="Amount">
        <input
          type="number"
          min={1}
          max={200}
          value={settings.amount}
          onChange={(e) => set("amount", Math.max(1, Number(e.target.value) || 1))}
          className={inputClass}
        />
      </Field>
      <Field label="Max copies of one piece">
        <input
          type="number"
          min={1}
          max={50}
          value={settings.maxCopiesPerEntry}
          onChange={(e) => set("maxCopiesPerEntry", Math.max(1, Number(e.target.value) || 1))}
          className={inputClass}
        />
      </Field>
      <Field label="Scale range">
        <div className="flex items-center gap-2">
          <input
            type="number"
            step={0.1}
            min={0.1}
            value={settings.scaleMin}
            onChange={(e) => set("scaleMin", Math.min(Math.max(0.1, Number(e.target.value) || 0.1), settings.scaleMax))}
            className={`${inputClass} w-20`}
          />
          <span className="text-muted">to</span>
          <input
            type="number"
            step={0.1}
            min={settings.scaleMin}
            value={settings.scaleMax}
            onChange={(e) => set("scaleMax", Math.max(Number(e.target.value) || settings.scaleMin, settings.scaleMin))}
            className={`${inputClass} w-20`}
          />
        </div>
      </Field>
      <Field label={`Seed — ${settings.seed}`}>
        <input
          type="range"
          min={0}
          max={9999}
          value={settings.seed}
          onChange={(e) => set("seed", Number(e.target.value))}
          className="w-full accent-accent"
        />
      </Field>

      <div className="flex flex-col gap-1">
        <label className="flex items-center gap-2 text-[11px] text-foam">
          <input type="checkbox" className="studio-checkbox" checked={settings.spineFirst} onChange={(e) => set("spineFirst", e.target.checked)} />
          Spine-first growth
        </label>
        <span className="text-[10px] text-muted">Extends one dominant chain through the biggest opening first, then branches.</span>
      </div>

      <button
        type="button"
        onClick={onAutoGenerate}
        disabled={generating}
        className="border border-accent bg-accent px-4 py-2 text-xs uppercase tracking-widest2 text-ink hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {generating ? "Generating…" : "Auto-generate"}
      </button>

      <div className="text-[11px] text-muted">{resultCount} piece(s) placed</div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={onExport}
          disabled={!canExport}
          className="flex-1 border border-line px-3 py-2 text-xs uppercase tracking-widest2 text-foam hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
        >
          Export OBJ
        </button>
        <button
          type="button"
          onClick={onClear}
          disabled={!canExport}
          className="border border-line px-3 py-2 text-xs uppercase tracking-widest2 text-foam hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
        >
          Clear
        </button>
      </div>
    </div>
  );
}
