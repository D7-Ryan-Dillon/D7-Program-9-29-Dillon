"use client";

import { useState } from "react";
import ThreeViewport, { type DisplayMode, type PieceName } from "./ThreeViewport";
import DisplayModeBar from "./DisplayModeBar";
import ViewButtons from "./ViewButtons";
import VisibilityPanel from "./VisibilityPanel";
import MetricsPanel from "./MetricsPanel";
import UploadZone from "./UploadZone";
import type { ParsedTile } from "@/lib/types";
import type { NamedView } from "@/lib/faceViews";

interface Props {
  tile: ParsedTile | null;
  onTileLoaded: (tile: ParsedTile) => void;
}

export default function ViewerTab({ tile, onTileLoaded }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [displayMode, setDisplayMode] = useState<DisplayMode>("Rendered");
  const [namedView, setNamedView] = useState<NamedView>("Perspective");
  const [visibility, setVisibility] = useState<Record<PieceName, boolean>>({
    foam: true,
    void: true,
  });
  const [colors, setColors] = useState<Record<PieceName, string>>({
    foam: "#f5f5f2",
    void: "#ff2f92",
  });
  const [availablePieces, setAvailablePieces] = useState<PieceName[]>(["foam", "void"]);

  const handleLoaded = (t: ParsedTile) => {
    setError(null);
    setDisplayMode("Rendered");
    setNamedView("Perspective");
    setVisibility({ foam: true, void: true });
    onTileLoaded(t);
  };

  if (!tile) {
    return (
      <div className="flex h-full items-center justify-center p-10">
        <div className="w-full max-w-xl">
          <UploadZone onLoaded={handleLoaded} onError={setError} />
          {error && (
            <div className="mt-4 border border-accent/60 bg-accent/10 p-3 text-xs text-accent">
              {error}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0">
      {/* left: mode / view / visibility controls */}
      <div className="flex w-64 shrink-0 flex-col gap-6 overflow-y-auto border-r border-line p-4">
        <div>
          <div className="mb-2 text-[11px] uppercase tracking-widest2 text-muted">Display mode</div>
          <DisplayModeBar value={displayMode} onChange={setDisplayMode} />
        </div>
        <div>
          <div className="mb-2 text-[11px] uppercase tracking-widest2 text-muted">View</div>
          <ViewButtons value={namedView} onChange={setNamedView} />
        </div>
        <VisibilityPanel
          visibility={visibility}
          colors={colors}
          available={availablePieces}
          onVisibilityChange={(piece, value) => setVisibility((v) => ({ ...v, [piece]: value }))}
          onColorChange={(piece, value) => setColors((c) => ({ ...c, [piece]: value }))}
        />
        <div className="mt-auto pt-4">
          <div className="mb-2 text-[11px] uppercase tracking-widest2 text-muted">Add a tile</div>
          <UploadZone onLoaded={handleLoaded} onError={setError} compact />
          {error && <div className="mt-2 text-[11px] text-accent">{error}</div>}
        </div>
      </div>

      {/* center: viewport */}
      <div className="relative min-w-0 flex-1">
        <ThreeViewport
          key={tile.glbUrl}
          glbUrl={tile.glbUrl}
          glbNodeNames={tile.glbNodeNames}
          displayMode={displayMode}
          namedView={namedView}
          visibility={visibility}
          colors={colors}
          onReady={({ pieces }) => setAvailablePieces(pieces)}
          onError={setError}
        />
        <div className="pointer-events-none absolute left-3 top-3 text-[11px] uppercase tracking-widest2 text-muted">
          {tile.tile.name}
        </div>
        <div className="pointer-events-none absolute bottom-3 left-3 text-[10px] uppercase tracking-widest text-muted/70">
          Orbit · Pan · Zoom
        </div>
      </div>

      {/* right: metrics legend */}
      <div className="w-80 shrink-0 overflow-y-auto border-l border-line p-4">
        <div className="mb-1 text-[11px] uppercase tracking-widest2 text-accent">Metrics</div>
        <MetricsPanel tile={tile} />
      </div>
    </div>
  );
}
