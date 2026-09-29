"use client";

import type { PieceName } from "./ThreeViewport";

interface Props {
  visibility: Record<PieceName, boolean>;
  colors: Record<PieceName, string>;
  onVisibilityChange: (piece: PieceName, value: boolean) => void;
  onColorChange: (piece: PieceName, value: string) => void;
  available: PieceName[];
}

const LABELS: Record<PieceName, string> = { foam: "Foam", void: "Void" };

export default function VisibilityPanel({
  visibility,
  colors,
  onVisibilityChange,
  onColorChange,
  available,
}: Props) {
  return (
    <div className="flex flex-col gap-2">
      <div className="text-[11px] uppercase tracking-widest2 text-muted">Pieces</div>
      {(["foam", "void"] as PieceName[]).map((piece) => {
        const disabled = !available.includes(piece);
        return (
          <div key={piece} className="flex items-center gap-2.5">
            <input
              type="checkbox"
              className="studio-checkbox"
              checked={visibility[piece]}
              disabled={disabled}
              onChange={(e) => onVisibilityChange(piece, e.target.checked)}
            />
            <span className={`w-12 text-xs ${disabled ? "text-muted/50" : "text-foam"}`}>
              {LABELS[piece]}
            </span>
            <input
              type="color"
              value={colors[piece]}
              disabled={disabled}
              onChange={(e) => onColorChange(piece, e.target.value)}
            />
            {disabled && <span className="text-[10px] text-muted">not in this tile</span>}
          </div>
        );
      })}
    </div>
  );
}
