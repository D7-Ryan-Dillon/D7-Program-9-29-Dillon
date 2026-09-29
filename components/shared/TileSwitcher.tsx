"use client";

import type { ParsedTile } from "@/lib/types";

interface Props {
  tiles: ParsedTile[];
  activeIndex: number | null;
  onSelect: (index: number) => void;
  onClose: (index: number) => void;
}

export default function TileSwitcher({ tiles, activeIndex, onSelect, onClose }: Props) {
  return (
    <div className="flex h-9 shrink-0 items-stretch gap-2 overflow-x-auto border-b border-line px-3">
      {tiles.map((tile, i) => {
        const active = i === activeIndex;
        return (
          <div
            key={tile.glbUrl}
            className={`flex shrink-0 items-center gap-2 border px-2.5 text-[11px] uppercase tracking-widest2 ${
              active
                ? "border-accent bg-accent text-ink"
                : "border-line text-foam hover:border-accent hover:text-accent"
            }`}
          >
            <button type="button" onClick={() => onSelect(i)} className="py-1.5">
              {tile.tile.name}
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onClose(i);
              }}
              aria-label={`Close ${tile.tile.name}`}
              className="opacity-70 hover:opacity-100"
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}
