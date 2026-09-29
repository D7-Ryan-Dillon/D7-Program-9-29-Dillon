"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ParsedTile } from "@/lib/types";
import { fmtFt2, fmtPercent } from "@/lib/format";
import { scoreTile, type DescriptorScore, type ScoreResult } from "@/lib/scoring/engine";
import RotatingPreview from "./RotatingPreview";
import {
  DESCRIPTORS,
  DESCRIPTOR_CATEGORIES,
  MINIMUM_REQUIRED,
  type Descriptor,
} from "./descriptors";

interface Props {
  tile: ParsedTile | null;
}

/** Sizes its children as a true square that fits inside whichever of the
 * available width/height is smaller — CSS aspect-ratio alone can't do this
 * once both dimensions are constrained, so it's measured. */
function SquareFrame({ children }: { children: React.ReactNode }) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [side, setSide] = useState(0);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setSide(Math.max(0, Math.min(el.clientWidth, el.clientHeight)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={wrapRef} className="flex min-h-0 flex-1 items-center justify-center">
      <div className="border border-line" style={{ width: side, height: side }}>
        {children}
      </div>
    </div>
  );
}

function ScoreBar({ label, result }: { label: string; result: ScoreResult }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-sm border border-line px-2.5 py-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[9px] uppercase tracking-widest text-muted">{label}</span>
        <span className="text-base font-semibold tabular-nums text-accent">{result.score}</span>
      </div>
      <div className="relative h-1.5 w-full bg-line">
        <div className="absolute inset-y-0 left-0 bg-accent/50" style={{ width: `${result.score}%` }} />
        <div
          className="absolute top-1/2 h-3 w-0.5 -translate-y-1/2 bg-accent"
          style={{ left: `${result.score}%` }}
        />
      </div>
      <span className="text-[11px] leading-snug text-muted">{result.explanation}</span>
    </div>
  );
}

function DescriptorRow({
  descriptor,
  enabled,
  onToggle,
  scores,
}: {
  descriptor: Descriptor;
  enabled: boolean;
  onToggle: (value: boolean) => void;
  scores: DescriptorScore;
}) {
  return (
    <div className="flex gap-3 border-b border-line py-4 last:border-b-0">
      <input
        type="checkbox"
        className="studio-checkbox mt-1"
        checked={enabled}
        onChange={(e) => onToggle(e.target.checked)}
      />
      <div className="flex-1">
        <div className="text-sm font-medium text-foam">{descriptor.name}</div>
        <div className="mt-2 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <div className="text-[11px] text-muted">
              <span className="text-muted/70">Qualitative — </span>
              {descriptor.qualitative}
            </div>
            <ScoreBar label="Qualitative score" result={scores.qualitative} />
          </div>
          <div className="flex flex-col gap-2">
            <div className="text-[11px] text-muted">
              <span className="text-muted/70">Quantitative — </span>
              {descriptor.quantitative}
            </div>
            <ScoreBar label="Quantitative score" result={scores.quantitative} />
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AnalysisTab({ tile }: Props) {
  const [enabled, setEnabled] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(DESCRIPTORS.map((d) => [d.id, true])),
  );

  const enabledCount = Object.values(enabled).filter(Boolean).length;

  const scored = useMemo(() => (tile ? scoreTile(tile) : null), [tile]);

  if (!tile || !scored) {
    return (
      <div className="flex h-full items-center justify-center p-10 text-center">
        <div className="max-w-sm text-xs text-muted">
          Load a tile in the Viewer tab first — the analysis below reads the same
          bundle (metrics, faces, sections) once one is loaded.
        </div>
      </div>
    );
  }

  const m = tile.tile.metrics;

  return (
    <div className="flex h-full min-h-0">
      <div className="min-w-0 flex-1 overflow-y-auto p-6">
        <div className="mx-auto flex max-w-2xl flex-col gap-6">
          <div className="border border-line p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <div className="text-xs uppercase tracking-widest2 text-accent">
                  {tile.parsedName.category
                    ? `${tile.parsedName.category} ${tile.parsedName.slotNumber ?? ""}`
                    : "Tile"}
                </div>
                <div className="text-sm text-foam">
                  {tile.parsedName.typology ?? tile.tile.name}
                </div>
              </div>
              <div className="text-right text-[11px] text-muted">
                <div>{fmtPercent(m.void_fraction)} void · {m.void_pieces} piece(s)</div>
                <div>{fmtFt2(m.open_area_on_faces_ft2)} open on faces</div>
              </div>
            </div>
            <div className="mt-3 text-[11px] text-muted">
              {enabledCount} of {DESCRIPTORS.length} descriptors selected (studio minimum is{" "}
              {MINIMUM_REQUIRED}). Scores are computed from this tile&rsquo;s own geometry and
              recipe — each score&rsquo;s sentence explains how it was derived.
            </div>
          </div>

          {DESCRIPTOR_CATEGORIES.map((category) => (
            <div key={category}>
              <div className="mb-2 text-xs uppercase tracking-widest2 text-accent">{category}</div>
              <div className="border border-line px-4">
                {DESCRIPTORS.filter((d) => d.category === category).map((d) => (
                  <DescriptorRow
                    key={d.id}
                    descriptor={d}
                    enabled={enabled[d.id]}
                    onToggle={(value) => setEnabled((e) => ({ ...e, [d.id]: value }))}
                    scores={scored[d.id]}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex w-2/5 min-w-[22rem] shrink-0 flex-col border-l border-line p-4">
        <div className="mb-2 text-[11px] uppercase tracking-widest2 text-accent">Reference</div>
        <SquareFrame>
          <RotatingPreview glbUrl={tile.glbUrl} />
        </SquareFrame>
        <div className="mt-2 text-[10px] uppercase tracking-widest text-muted/70">
          {tile.tile.name} · ghosted
        </div>
      </div>
    </div>
  );
}
