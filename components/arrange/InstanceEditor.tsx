"use client";

import type { PlacedInstance } from "@/lib/arrange/types";

interface Props {
  instance: PlacedInstance | null;
  onUpdate: (id: string, transform: PlacedInstance["transform"]) => void;
  onRemove: (id: string) => void;
  onSnap: (id: string) => void;
}

const numClass = "w-20 border border-line bg-transparent px-1.5 py-1 text-[11px] text-foam focus:border-accent focus:outline-none";

function rotateButtonClass(steps: number) {
  return `flex-1 border px-2 py-1.5 text-[10px] uppercase tracking-widest ${
    steps ? "border-accent text-accent" : "border-line text-foam hover:border-accent hover:text-accent"
  }`;
}

export default function InstanceEditor({ instance, onUpdate, onRemove, onSnap }: Props) {
  if (!instance) {
    return (
      <div className="border border-line p-3 text-[11px] text-muted">
        Click a piece in the viewport (or in the list below) to select and edit it.
      </div>
    );
  }

  const t = instance.transform;
  const set = (patch: Partial<PlacedInstance["transform"]>) => onUpdate(instance.id, { ...t, ...patch });
  const cycle = (steps: number) => ((steps + 1) % 4) as 0 | 1 | 2 | 3;

  return (
    <div className="flex flex-col gap-3 border border-line p-3">
      <div className="flex items-start justify-between gap-2">
        <span className="text-[11px] text-foam" title={instance.tileName}>
          {instance.tileName}
        </span>
        <button
          type="button"
          onClick={() => onRemove(instance.id)}
          aria-label={`Remove ${instance.tileName}`}
          className="shrink-0 text-muted hover:text-accent"
        >
          ×
        </button>
      </div>

      <div>
        <div className="mb-1 text-[10px] uppercase tracking-widest text-muted">Position (ft)</div>
        <div className="flex gap-2">
          <label className="flex items-center gap-1 text-[10px] text-muted">
            X
            <input
              type="number"
              value={t.positionFt[0]}
              onChange={(e) => set({ positionFt: [Number(e.target.value) || 0, t.positionFt[1], t.positionFt[2]] })}
              className={numClass}
            />
          </label>
          <label className="flex items-center gap-1 text-[10px] text-muted">
            Y
            <input
              type="number"
              value={t.positionFt[1]}
              onChange={(e) => set({ positionFt: [t.positionFt[0], Number(e.target.value) || 0, t.positionFt[2]] })}
              className={numClass}
            />
          </label>
          <label className="flex items-center gap-1 text-[10px] text-muted">
            Z
            <input
              type="number"
              value={t.positionFt[2]}
              onChange={(e) => set({ positionFt: [t.positionFt[0], t.positionFt[1], Number(e.target.value) || 0] })}
              className={numClass}
            />
          </label>
        </div>
      </div>

      <label className="flex items-center gap-2 text-[10px] text-muted">
        Scale
        <input
          type="number"
          step={0.1}
          min={0.1}
          value={t.scale}
          onChange={(e) => set({ scale: Math.max(0.1, Number(e.target.value) || 1) })}
          className={numClass}
        />
      </label>

      <div>
        <div className="mb-1 text-[10px] uppercase tracking-widest text-muted">Rotate 90°</div>
        <div className="flex gap-1.5">
          <button type="button" onClick={() => set({ rotXSteps: cycle(t.rotXSteps) })} className={rotateButtonClass(t.rotXSteps)}>
            X{t.rotXSteps ? ` ·${t.rotXSteps}` : ""}
          </button>
          <button type="button" onClick={() => set({ rotYSteps: cycle(t.rotYSteps) })} className={rotateButtonClass(t.rotYSteps)}>
            Y{t.rotYSteps ? ` ·${t.rotYSteps}` : ""}
          </button>
          <button type="button" onClick={() => set({ rotZSteps: cycle(t.rotZSteps) })} className={rotateButtonClass(t.rotZSteps)}>
            Z{t.rotZSteps ? ` ·${t.rotZSteps}` : ""}
          </button>
        </div>
      </div>

      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={() => set({ mirrorX: !t.mirrorX })}
          className={`flex-1 border px-2 py-1.5 text-[10px] uppercase tracking-widest ${t.mirrorX ? "border-accent text-accent" : "border-line text-foam hover:border-accent hover:text-accent"}`}
        >
          Mirror X
        </button>
        <button
          type="button"
          onClick={() => set({ mirrorY: !t.mirrorY })}
          className={`flex-1 border px-2 py-1.5 text-[10px] uppercase tracking-widest ${t.mirrorY ? "border-accent text-accent" : "border-line text-foam hover:border-accent hover:text-accent"}`}
        >
          Mirror Y
        </button>
      </div>

      <button
        type="button"
        onClick={() => onSnap(instance.id)}
        className="border border-line px-3 py-1.5 text-[11px] uppercase tracking-widest text-foam hover:border-accent hover:text-accent"
      >
        Snap to nearest
      </button>
    </div>
  );
}
