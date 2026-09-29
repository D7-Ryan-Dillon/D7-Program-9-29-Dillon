"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Header from "@/components/shared/Header";
import TabNav, { type AppTab } from "@/components/shared/TabNav";
import TileSwitcher from "@/components/shared/TileSwitcher";
import ViewerTab from "@/components/viewer/ViewerTab";
import AnalysisTab from "@/components/analysis/AnalysisTab";
import ArrangeTab from "@/components/arrange/ArrangeTab";
import { releaseParsedTile } from "@/lib/ingest";
import type { ParsedTile } from "@/lib/types";

interface TileLibrary {
  tiles: ParsedTile[];
  activeIndex: number | null;
}

export default function Home() {
  const [tab, setTab] = useState<AppTab>("viewer");
  const [library, setLibrary] = useState<TileLibrary>({ tiles: [], activeIndex: null });
  const libraryRef = useRef<TileLibrary>(library);
  libraryRef.current = library;

  // uploading always adds a new tile to the library and switches to it —
  // previously-loaded tiles stay around so you can click back to them
  const handleTileLoaded = useCallback((next: ParsedTile) => {
    setLibrary((prev) => ({ tiles: [...prev.tiles, next], activeIndex: prev.tiles.length }));
  }, []);

  const handleTileSelected = useCallback((index: number) => {
    setLibrary((prev) => ({ ...prev, activeIndex: index }));
  }, []);

  const handleTileClosed = useCallback((index: number) => {
    const target = libraryRef.current.tiles[index];
    if (target) releaseParsedTile(target);
    setLibrary((prev) => {
      const tiles = prev.tiles.filter((_, i) => i !== index);
      let activeIndex = prev.activeIndex;
      if (activeIndex !== null) {
        if (tiles.length === 0) activeIndex = null;
        else if (index < activeIndex) activeIndex -= 1;
        else if (index === activeIndex) activeIndex = Math.min(activeIndex, tiles.length - 1);
      }
      return { tiles, activeIndex };
    });
  }, []);

  // release every loaded tile's object URLs when the whole app unmounts
  useEffect(() => {
    return () => libraryRef.current.tiles.forEach(releaseParsedTile);
  }, []);

  const { tiles, activeIndex } = library;
  const tile = activeIndex !== null ? (tiles[activeIndex] ?? null) : null;

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <Header />
      <TabNav
        active={tab}
        onChange={setTab}
        hasTile={tile !== null}
      />
      {tiles.length > 0 && (
        <TileSwitcher
          tiles={tiles}
          activeIndex={activeIndex}
          onSelect={handleTileSelected}
          onClose={handleTileClosed}
        />
      )}
      <main className="min-h-0 flex-1">
        {/* Both tabs stay mounted once visited, switched with CSS only —
            this keeps the WebGL viewport (and its loaded model) alive
            when you flip to Analysis and back, instead of reloading it. */}
        <div className={tab === "viewer" ? "h-full" : "hidden"}>
          <ViewerTab tile={tile} onTileLoaded={handleTileLoaded} />
        </div>
        <div className={tab === "analysis" ? "h-full" : "hidden"}>
          <AnalysisTab tile={tile} />
        </div>
        <div className={tab === "arrange" ? "h-full" : "hidden"}>
          <ArrangeTab tiles={tiles} />
        </div>
      </main>
    </div>
  );
}
