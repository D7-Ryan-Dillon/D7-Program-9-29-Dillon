"use client";

// Lets the user review the joints a generation produced and mark specific
// ones good or bad, then regenerate only the bad ones — the concrete
// feature lib/arrange/types.ts's Connection graph and
// lib/arrange/regenerate.ts's regenerateMarkedJoints exist to support.
// Only rendered once a generation's connections exist (see ArrangeTab.tsx)
// — a manually-edited composition has no connection graph to review.

import type { Connection, PlacedInstance } from "@/lib/arrange/types";

interface Props {
  connections: Connection[];
  instances: PlacedInstance[];
  marks: Record<string, "good" | "bad">;
  onMark: (connectionId: string, mark: "good" | "bad" | null) => void;
  onSelect: (connectionId: string) => void;
  onRegenerate: () => void;
  regenerating: boolean;
}

function markButtonClass(active: boolean, kind: "good" | "bad") {
  if (!active) return "flex-1 border border-line px-2 py-1 text-[10px] uppercase tracking-widest text-muted hover:border-accent hover:text-accent";
  const color = kind === "good" ? "border-accent text-accent" : "border-red-400 text-red-400";
  return `flex-1 border px-2 py-1 text-[10px] uppercase tracking-widest ${color}`;
}

export default function JointsPanel({ connections, instances, marks, onMark, onSelect, onRegenerate, regenerating }: Props) {
  if (connections.length === 0) return null;

  const nameOf = (id: string) => instances.find((inst) => inst.id === id)?.tileName ?? "?";
  const badCount = connections.reduce((n, c) => n + (marks[c.id] === "bad" ? 1 : 0), 0);

  return (
    <div className="flex flex-col gap-2 border border-line p-3">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-widest text-muted">Joints</span>
        <span className="text-[10px] text-muted">{connections.length} joint(s)</span>
      </div>
      <div className="flex max-h-64 flex-col gap-1 overflow-y-auto">
        {connections.map((conn) => {
          const mark = marks[conn.id];
          return (
            <div key={conn.id} className="flex flex-col gap-1 border border-line p-2">
              <button
                type="button"
                onClick={() => onSelect(conn.id)}
                className="truncate text-left text-[11px] text-foam hover:text-accent"
                title={`${nameOf(conn.parentInstanceId)} → ${nameOf(conn.childInstanceId)}`}
              >
                {nameOf(conn.parentInstanceId)} → {nameOf(conn.childInstanceId)}
              </button>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-muted">score {(conn.matchScore * 100).toFixed(0)}%</span>
                <div className="ml-auto flex gap-1">
                  <button type="button" onClick={() => onMark(conn.id, mark === "good" ? null : "good")} className={markButtonClass(mark === "good", "good")}>
                    Good
                  </button>
                  <button type="button" onClick={() => onMark(conn.id, mark === "bad" ? null : "bad")} className={markButtonClass(mark === "bad", "bad")}>
                    Bad
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <button
        type="button"
        onClick={onRegenerate}
        disabled={badCount === 0 || regenerating}
        className="border border-accent bg-accent px-4 py-2 text-xs uppercase tracking-widest2 text-ink hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {regenerating ? "Regenerating…" : badCount > 0 ? `Regenerate ${badCount} marked` : "Regenerate marked"}
      </button>
    </div>
  );
}
