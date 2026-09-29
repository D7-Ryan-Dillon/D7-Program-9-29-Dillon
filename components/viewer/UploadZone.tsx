"use client";

import { useCallback, useRef, useState } from "react";
import {
  buildFileMapFromDataTransfer,
  buildFileMapFromFileList,
  buildFileMapFromZip,
  IngestError,
  parseTileBundle,
} from "@/lib/ingest";
import type { ParsedTile } from "@/lib/types";

interface Props {
  onLoaded: (tile: ParsedTile) => void;
  onError: (message: string) => void;
  compact?: boolean;
}

export default function UploadZone({ onLoaded, onError, compact }: Props) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const zipInputRef = useRef<HTMLInputElement | null>(null);

  const runIngest = useCallback(
    async (task: () => Promise<Map<string, Blob>>, sourceKind: "folder" | "zip") => {
      setIsLoading(true);
      try {
        const fileMap = await task();
        const tile = await parseTileBundle(fileMap, sourceKind);
        onLoaded(tile);
      } catch (err) {
        const message =
          err instanceof IngestError
            ? err.message
            : `Unexpected error while reading the bundle: ${
                err instanceof Error ? err.message : String(err)
              }`;
        onError(message);
      } finally {
        setIsLoading(false);
      }
    },
    [onLoaded, onError],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragOver(false);
      const dt = e.dataTransfer;
      const singleFile = dt.files.length === 1 ? dt.files[0] : null;
      if (singleFile && singleFile.name.toLowerCase().endsWith(".zip")) {
        runIngest(() => buildFileMapFromZip(singleFile), "zip");
        return;
      }
      runIngest(() => buildFileMapFromDataTransfer(dt), "folder");
    },
    [runIngest],
  );

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragOver(true);
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={handleDrop}
      className={`flex flex-col items-center justify-center gap-3 border ${
        isDragOver ? "border-accent bg-accent/5" : "border-line"
      } ${compact ? "p-6" : "p-14"} text-center transition-colors`}
    >
      <div className="text-xs uppercase tracking-widest2 text-muted">
        {isLoading ? "Reading bundle…" : "Drop a tile's _analysis folder here"}
      </div>
      {!isLoading && (
        <>
          <div className="text-[11px] text-muted">
            or a .zip of that folder — either works
          </div>
          <div className="mt-2 flex gap-3">
            <button
              type="button"
              onClick={() => folderInputRef.current?.click()}
              className="border border-line px-4 py-2 text-xs uppercase tracking-widest2 text-foam hover:border-accent hover:text-accent"
            >
              Choose folder
            </button>
            <button
              type="button"
              onClick={() => zipInputRef.current?.click()}
              className="border border-line px-4 py-2 text-xs uppercase tracking-widest2 text-foam hover:border-accent hover:text-accent"
            >
              Choose .zip
            </button>
          </div>
        </>
      )}
      {/* webkitdirectory/directory are real, widely-supported, but
          non-standard attributes that React's TS typings don't declare —
          set imperatively via the ref so this stays type-clean. */}
      <input
        ref={(el) => {
          folderInputRef.current = el;
          el?.setAttribute("webkitdirectory", "");
          el?.setAttribute("directory", "");
        }}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            runIngest(() => Promise.resolve(buildFileMapFromFileList(e.target.files!)), "folder");
          }
          e.target.value = "";
        }}
      />
      <input
        ref={zipInputRef}
        type="file"
        accept=".zip"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) runIngest(() => buildFileMapFromZip(f), "zip");
          e.target.value = "";
        }}
      />
    </div>
  );
}
