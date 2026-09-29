"use client";

import { NAMED_VIEWS, NAMED_VIEW_DEFS, type NamedView } from "@/lib/faceViews";

interface Props {
  value: NamedView;
  onChange: (view: NamedView) => void;
}

export default function ViewButtons({ value, onChange }: Props) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {NAMED_VIEWS.map((view) => {
        const active = view === value;
        const face = NAMED_VIEW_DEFS[view]?.face;
        return (
          <button
            key={view}
            type="button"
            onClick={() => onChange(view)}
            title={face ? `Tile face ${face}` : "Free orbit"}
            className={`flex flex-col items-center border px-2.5 py-1 text-[11px] uppercase tracking-wider leading-tight ${
              active
                ? "border-accent bg-accent text-ink"
                : "border-line text-foam hover:border-accent hover:text-accent"
            }`}
          >
            <span>{view}</span>
            {face && (
              <span className={active ? "text-ink/70" : "text-muted"} style={{ fontSize: "9px" }}>
                {face}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
