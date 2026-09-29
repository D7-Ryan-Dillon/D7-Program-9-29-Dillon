"use client";

import type { ParsedTile } from "@/lib/types";

interface Props {
  tiles: ParsedTile[];
  selection: Record<string, boolean>;
  onToggle: (glbUrl: string, value: boolean) => void;
  onSelectAll: (value: boolean) => void;
}

export default function BankPanel({ tiles, selection, onToggle, onSelectAll }: Props) {
  const allChecked = tiles.length > 0 && tiles.every((t) => selection[t.glbUrl]);

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => onSelectAll(!allChecked)}
        className="border border-line px-2 py-1 text-[10px] uppercase tracking-widest text-foam hover:border-accent hover:text-accent"
      >
        {allChecked ? "Deselect all" : "Select all"}
      </button>
      {tiles.map((tile) => (
        <label key={tile.glbUrl} className="flex items-center gap-2 border border-line px-2 py-2">
          {tile.thumbnailUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- vanilla <img>, matching the rest of the app
            <img src={tile.thumbnailUrl} alt="" className="h-9 w-9 shrink-0 border border-line object-cover" />
          ) : (
            <div className="h-9 w-9 shrink-0 border border-line" />
          )}
          <div className="min-w-0 flex-1 truncate text-[11px] text-foam" title={tile.tile.name}>
            {tile.tile.name}
          </div>
          <input
            type="checkbox"
            className="studio-checkbox"
            checked={selection[tile.glbUrl] ?? false}
            onChange={(e) => onToggle(tile.glbUrl, e.target.checked)}
          />
        </label>
      ))}
    </div>
  );
}
