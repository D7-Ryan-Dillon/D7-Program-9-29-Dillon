"use client";

import type { DisplayMode } from "./ThreeViewport";

const MODES: DisplayMode[] = ["Rendered", "Ghosted"];

interface Props {
  value: DisplayMode;
  onChange: (mode: DisplayMode) => void;
}

export default function DisplayModeBar({ value, onChange }: Props) {
  return (
    <div className="flex gap-2">
      {MODES.map((mode) => {
        const active = mode === value;
        return (
          <button
            key={mode}
            type="button"
            onClick={() => onChange(mode)}
            className={`border px-3 py-1.5 text-xs uppercase tracking-widest2 ${
              active
                ? "border-accent bg-accent text-ink"
                : "border-line text-foam hover:border-accent hover:text-accent"
            }`}
          >
            {mode}
          </button>
        );
      })}
    </div>
  );
}
