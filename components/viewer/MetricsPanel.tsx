"use client";

import type { ParsedTile } from "@/lib/types";
import { FACE_NAMES } from "@/lib/types";
import { fmtFt, fmtFt2, fmtFt3, fmtInt, fmtNum, fmtPercent, fmtVec3 } from "@/lib/format";

function Section({
  title,
  defaultOpen = true,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details open={defaultOpen} className="border-b border-line py-2.5 group">
      <summary className="cursor-pointer select-none text-[11px] uppercase tracking-widest2 text-muted flex items-center gap-1.5 [&::-webkit-details-marker]:hidden [&::marker]:hidden">
        <span className="text-accent group-open:rotate-90 transition-transform inline-block">▸</span>
        {title}
      </summary>
      <div className="mt-2 space-y-1">{children}</div>
    </details>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-xs">
      <span className="text-muted">{label}</span>
      <span className="text-foam text-right">{value}</span>
    </div>
  );
}

export default function MetricsPanel({ tile }: { tile: ParsedTile }) {
  const t = tile.tile;
  const m = t.metrics;
  const nonzeroFloors = m.floor_area_by_z_ft2.filter((v) => v > 0.001).length;

  return (
    <div className="text-xs">
      <Section title="Identity">
        <Row label="Name" value={<span className="break-all">{t.name}</span>} />
        {tile.parsedName.category && (
          <Row
            label="Parsed as"
            value={`${tile.parsedName.category} ${tile.parsedName.slotNumber ?? ""} — ${
              tile.parsedName.typology
            }`}
          />
        )}
        <Row label="Tile ID" value={<span className="break-all">{t.id}</span>} />
        <Row label="Engine" value={t.engine_version} />
        <Row label="Exported" value={t.exported} />
        <Row label="Frame" value={`${t.frame_exported} / ${t.last_frame}`} />
        <Row label="Tile size" value={`${fmtVec3(t.tile_ft, 1)} ft`} />
        <Row label="Cell size" value={fmtFt(t.cell_ft)} />
        <Row label="Grid" value={t.grid.join(" × ")} />
      </Section>

      <Section title="Volumes">
        <Row label="Void fraction" value={fmtPercent(m.void_fraction)} />
        <Row label="Void volume" value={fmtFt3(m.void_volume_ft3)} />
        <Row label="Foam volume" value={fmtFt3(m.foam_volume_ft3)} />
        <Row label="Tile volume" value={fmtFt3(m.tile_volume_ft3)} />
        <Row label="Void pieces" value={fmtInt(m.void_pieces)} />
        <Row label="Largest piece" value={fmtFt3(m.largest_void_ft3)} />
      </Section>

      <Section title="Per-face openings">
        {FACE_NAMES.map((face) => {
          const f = m.faces[face];
          return (
            <Row
              key={face}
              label={face}
              value={
                f
                  ? `${fmtFt2(f.open_area_ft2)} · ${fmtPercent(f.open_fraction)}`
                  : "—"
              }
            />
          );
        })}
        <Row label="Total on faces" value={fmtFt2(m.open_area_on_faces_ft2)} />
      </Section>

      <Section title="Void extents" defaultOpen={false}>
        <Row label="Bbox min" value={fmtVec3(m.void_bbox?.min_ft ?? null)} />
        <Row label="Bbox max" value={fmtVec3(m.void_bbox?.max_ft ?? null)} />
        <Row label="Centroid" value={fmtVec3(m.void_bbox?.centroid_ft ?? null)} />
        <Row
          label="Z range"
          value={m.void_z_range_ft ? `${fmtFt(m.void_z_range_ft[0])} – ${fmtFt(m.void_z_range_ft[1])}` : "—"}
        />
      </Section>

      <Section title="Void components" defaultOpen={false}>
        {m.void_components.slice(0, 8).map((c) => (
          <Row
            key={c.id}
            label={`Piece ${c.id}`}
            value={`${fmtFt3(c.volume_ft3)} · touches ${Object.keys(c.touches_faces_open_area_ft2).length} face(s)`}
          />
        ))}
        {m.void_components.length > 8 && (
          <Row label="" value={`+ ${m.void_components.length - 8} more`} />
        )}
      </Section>

      <Section title="Surface areas" defaultOpen={false}>
        <Row label="Void mesh area" value={fmtFt2(m.void_mesh_area_ft2)} />
        <Row label="Void wall area (est.)" value={fmtFt2(m.void_wall_area_ft2_estimate)} />
        <Row label="Foam mesh area" value={fmtFt2(m.foam_mesh_area_ft2)} />
        <Row label="Voxel wall area" value={fmtFt2(m.voxel_wall_area_ft2)} />
      </Section>

      <Section title="Floors" defaultOpen={false}>
        <Row label="Total floor area" value={fmtFt2(m.floor_area_total_ft2)} />
        <Row label="Elevation bands with a floor" value={fmtInt(nonzeroFloors)} />
      </Section>

      <Section title="Erosion settings" defaultOpen={false}>
        <Row label="Steps" value={fmtInt(t.config.steps)} />
        <Row label="Gravity" value={fmtNum(t.config.gravity, 2)} />
        <Row label="Drain" value={t.config.drain ? "on" : "off (pools)"} />
        <Row label="Seed" value={fmtInt(t.config.seed)} />
        <Row label="Weld axes" value={t.config.weld || "none"} />
        <Row label="Min void cleanup" value={fmtFt3(t.config.min_void_ft3)} />
        <Row label="Min foam cleanup" value={fmtFt3(t.config.min_foam_ft3)} />
        <Row label="Foam noise" value={fmtNum(t.config.foam.noise, 2)} />
        <Row label="Foam scale" value={fmtFt(t.config.foam.scale)} />
        <Row label="Sources" value={fmtInt(t.config.sources.length)} />
      </Section>
    </div>
  );
}
