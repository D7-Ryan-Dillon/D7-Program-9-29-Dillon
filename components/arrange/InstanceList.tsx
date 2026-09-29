"use client";

import type { PlacedInstance } from "@/lib/arrange/types";

interface Props {
  instances: PlacedInstance[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export default function InstanceList({ instances, selectedId, onSelect }: Props) {
  if (instances.length === 0) {
    return <div className="text-[11px] text-muted">No pieces placed yet — auto-generate, or add one above.</div>;
  }

  return (
    <div className="flex flex-col gap-1">
      {instances.map((inst) => {
        const active = inst.id === selectedId;
        return (
          <button
            key={inst.id}
            type="button"
            onClick={() => onSelect(inst.id)}
            className={`truncate border px-2 py-1.5 text-left text-[11px] ${
              active ? "border-accent bg-accent/10 text-accent" : "border-line text-foam hover:border-accent hover:text-accent"
            }`}
            title={inst.tileName}
          >
            {inst.tileName}
          </button>
        );
      })}
    </div>
  );
}
