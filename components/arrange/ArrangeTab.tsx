"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type * as THREE from "three";
import type { ParsedTile } from "@/lib/types";
import type { AutoGenerateSettings, BankEntry, GenerationState, PieceKind, PlacedInstance } from "@/lib/arrange/types";
import { makeInstance } from "@/lib/arrange/types";
import { autoGenerate } from "@/lib/arrange/autoGenerate";
import { regenerateMarkedJoints } from "@/lib/arrange/regenerate";
import { buildMergedGeometry, downloadText, exportObj } from "@/lib/arrange/geometry";
import { buildSmoothedSolid } from "@/lib/arrange/smoothMerge";
import { snapToNearest } from "@/lib/arrange/snap";
import BankPanel from "./BankPanel";
import SettingsPanel from "./SettingsPanel";
import InstanceList from "./InstanceList";
import InstanceEditor from "./InstanceEditor";
import ArrangeViewport from "./ArrangeViewport";
import JointsPanel from "./JointsPanel";
import DisplayModeBar from "@/components/viewer/DisplayModeBar";
import ViewButtons from "@/components/viewer/ViewButtons";
import type { DisplayMode } from "@/components/viewer/ThreeViewport";
import type { NamedView } from "@/lib/faceViews";

interface Props {
  tiles: ParsedTile[];
}

const DEFAULT_SETTINGS: AutoGenerateSettings = {
  amount: 8,
  maxCopiesPerEntry: 3,
  scaleMin: 1,
  scaleMax: 1,
  seed: 1,
  spineFirst: false,
};

const DEFAULT_COLOR = "#ffffff";

const PIECE_MODES: PieceKind[] = ["void", "foam"];

export default function ArrangeTab({ tiles }: Props) {
  const [selection, setSelection] = useState<Record<string, boolean>>({});
  const [settings, setSettings] = useState<AutoGenerateSettings>(DEFAULT_SETTINGS);
  const [instances, setInstances] = useState<PlacedInstance[]>([]);
  // The connection graph + resumable-growth bookkeeping behind the most
  // recent auto-generate/regenerate — kept parallel to `instances`, not a
  // replacement for it. Every manual-edit handler below explicitly clears
  // this alongside its own setInstances call (not a useEffect keyed on
  // `instances`): a regenerate needs to set both together in the same
  // tick, and an effect watching `instances` would race that.
  const [generationState, setGenerationState] = useState<GenerationState | null>(null);
  const [jointMarks, setJointMarks] = useState<Record<string, "good" | "bad">>({});
  const [regenerating, setRegenerating] = useState(false);
  // A joint-row click sets selectedId to the joint's child instance (so
  // InstanceEditor/InstanceList highlight it via their own existing,
  // unchanged logic) plus this, a second viewport cue covering both sides
  // of the joint.
  const [highlightIds, setHighlightIds] = useState<string[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [displayMode, setDisplayMode] = useState<DisplayMode>("Rendered");
  const [namedView, setNamedView] = useState<NamedView>("Perspective");
  const [pieceMode, setPieceMode] = useState<PieceKind>("void");
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [smoothedGeometry, setSmoothedGeometry] = useState<THREE.BufferGeometry | null>(null);
  const [smoothFailedCount, setSmoothFailedCount] = useState(0);
  const [smoothOpenEdgeCount, setSmoothOpenEdgeCount] = useState(0);
  const [smoothing, setSmoothing] = useState(false);
  const [smoothProgress, setSmoothProgress] = useState<{ done: number; total: number } | null>(null);
  const [generating, setGenerating] = useState(false);
  // Live refs so an in-flight smoothing computation can tell, after the
  // fact, whether the composition it was started for is still current.
  const instancesRef = useRef(instances);
  instancesRef.current = instances;
  const pieceModeRef = useRef(pieceMode);
  pieceModeRef.current = pieceMode;

  // A smoothed solid is a snapshot of the composition at the moment it was
  // built — any edit invalidates it, so it's cleared automatically rather
  // than silently going stale. Re-smoothing is an explicit, possibly-slow
  // action the user triggers again on purpose.
  useEffect(() => {
    setSmoothedGeometry(null);
    setSmoothFailedCount(0);
    setSmoothOpenEdgeCount(0);
  }, [instances, pieceMode]);

  const bank: BankEntry[] = useMemo(
    () => tiles.map((tile) => ({ tile, included: selection[tile.glbUrl] ?? false })),
    [tiles, selection],
  );
  const eligibleBank = bank.filter((b) => b.included);
  const selectedInstance = instances.find((inst) => inst.id === selectedId) ?? null;

  const handleToggle = (glbUrl: string, value: boolean) => {
    setSelection((prev) => ({ ...prev, [glbUrl]: value }));
  };

  const handleSelectAll = (value: boolean) => {
    setSelection((prev) => {
      const next = { ...prev };
      for (const tile of tiles) next[tile.glbUrl] = value;
      return next;
    });
  };

  const handleAutoGenerate = async () => {
    if (generating) return;
    setGenerating(true);
    try {
      const result = await autoGenerate(eligibleBank, settings);
      setInstances(result.instances);
      setGenerationState(result);
      setJointMarks({});
      setHighlightIds(null);
      setSelectedId(null);
    } finally {
      setGenerating(false);
    }
  };

  const handleMarkJoint = (connectionId: string, mark: "good" | "bad" | null) => {
    setJointMarks((prev) => {
      if (mark === null) {
        const next = { ...prev };
        delete next[connectionId];
        return next;
      }
      return { ...prev, [connectionId]: mark };
    });
  };

  const handleSelectJoint = (connectionId: string) => {
    const conn = generationState?.connections.find((c) => c.id === connectionId);
    if (!conn) return;
    setSelectedId(conn.childInstanceId);
    setHighlightIds([conn.parentInstanceId, conn.childInstanceId]);
  };

  const handleRegenerateMarked = async () => {
    if (regenerating || !generationState) return;
    const badIds = new Set(Object.entries(jointMarks).filter(([, mark]) => mark === "bad").map(([id]) => id));
    if (badIds.size === 0) return;
    setRegenerating(true);
    try {
      const result = await regenerateMarkedJoints(generationState, eligibleBank, badIds, { spineFirst: settings.spineFirst });
      setInstances(result.instances);
      setGenerationState(result);
      // Marks on joints that survived (good or unmarked) still refer to
      // real connections; marks on the just-regenerated bad ones don't
      // mean anything anymore — drop those, keep the rest.
      setJointMarks((prev) => {
        const survivingIds = new Set(result.connections.map((c) => c.id));
        const next: Record<string, "good" | "bad"> = {};
        for (const [id, mark] of Object.entries(prev)) if (survivingIds.has(id)) next[id] = mark;
        return next;
      });
      setHighlightIds(null);
      setSelectedId(null);
    } finally {
      setRegenerating(false);
    }
  };

  const handleAdd = (tile: ParsedTile) => {
    const instance = makeInstance(tile, [0, 0, 0]);
    setInstances((prev) => [...prev, instance]);
    setGenerationState(null);
    setJointMarks({});
    setHighlightIds(null);
    setSelectedId(instance.id);
  };

  const handleUpdate = (id: string, transform: PlacedInstance["transform"]) => {
    setInstances((prev) => prev.map((inst) => (inst.id === id ? { ...inst, transform } : inst)));
    setGenerationState(null);
    setJointMarks({});
    setHighlightIds(null);
  };

  const handleRemove = (id: string) => {
    setInstances((prev) => prev.filter((inst) => inst.id !== id));
    setGenerationState(null);
    setJointMarks({});
    setHighlightIds(null);
    setSelectedId((prev) => (prev === id ? null : prev));
  };

  const handleSnap = (id: string) => {
    const target = instances.find((inst) => inst.id === id);
    if (!target) return;
    const targetTile = tiles.find((t) => t.glbUrl === target.glbUrl);
    if (!targetTile) return;
    const others = instances
      .filter((inst) => inst.id !== id)
      .map((inst) => ({ instance: inst, tile: tiles.find((t) => t.glbUrl === inst.glbUrl) }))
      .filter((o): o is { instance: PlacedInstance; tile: ParsedTile } => !!o.tile);
    const transform = snapToNearest(target, targetTile, others);
    if (transform) handleUpdate(id, transform);
  };

  const handleClear = () => {
    setInstances([]);
    setGenerationState(null);
    setJointMarks({});
    setHighlightIds(null);
    setSelectedId(null);
  };

  // A plain instance selection (viewport click, or the placed-pieces list)
  // isn't about a joint — clears any leftover highlight from a previous
  // joint-row click rather than leaving it stale on the new selection.
  const handleSelectInstance = (id: string | null) => {
    setSelectedId(id);
    setHighlightIds(null);
  };

  const handleExport = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const geometry = smoothedGeometry ?? (await buildMergedGeometry(instances, pieceMode));
      if (geometry) {
        const suffix = smoothedGeometry ? "-smoothed" : "";
        downloadText(`arranged-composition-${pieceMode}${suffix}.obj`, exportObj(geometry));
      }
    } finally {
      setExporting(false);
    }
  };

  const handleToggleSmooth = async () => {
    if (smoothedGeometry) {
      setSmoothedGeometry(null);
      setSmoothFailedCount(0);
      setSmoothOpenEdgeCount(0);
      return;
    }
    // Captured so a result computed against a composition the user has
    // since changed (edited a piece, re-generated, switched piece mode)
    // never gets applied — the clearing effect above already reset
    // smoothedGeometry for the new state, this only stops a late result
    // from overwriting that. Checked against the live refs (not this
    // closure's own `instances`/`pieceMode`, which never change) after the
    // await, so it reflects whatever's current by the time this resolves.
    const startedFor = { instances, pieceMode };
    setSmoothing(true);
    setSmoothProgress({ done: 0, total: instances.length });
    try {
      const result = await buildSmoothedSolid(instances, pieceMode, (done, total) => setSmoothProgress({ done, total }));
      if (result && instancesRef.current === startedFor.instances && pieceModeRef.current === startedFor.pieceMode) {
        setSmoothedGeometry(result.geometry);
        setSmoothFailedCount(result.failedCount);
        setSmoothOpenEdgeCount(result.openEdgeCount);
      }
    } finally {
      setSmoothing(false);
      setSmoothProgress(null);
    }
  };

  if (tiles.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-10 text-center">
        <div className="max-w-sm text-xs text-muted">
          Upload at least one tile in the Viewer tab first — the bank fills in from
          whatever you&rsquo;ve loaded.
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0">
      <div className="flex w-72 shrink-0 flex-col gap-6 overflow-y-auto border-r border-line p-4">
        <div>
          <div className="mb-2 text-[11px] uppercase tracking-widest2 text-muted">Display mode</div>
          <DisplayModeBar value={displayMode} onChange={setDisplayMode} />
        </div>
        <div>
          <div className="mb-2 text-[11px] uppercase tracking-widest2 text-muted">View</div>
          <ViewButtons value={namedView} onChange={setNamedView} />
        </div>
        <div>
          <div className="mb-2 text-[11px] uppercase tracking-widest2 text-muted">
            Reading space through
          </div>
          <div className="flex gap-2">
            {PIECE_MODES.map((mode) => {
              const active = mode === pieceMode;
              return (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setPieceMode(mode)}
                  className={`flex-1 border px-3 py-1.5 text-xs uppercase tracking-widest2 ${
                    active ? "border-accent bg-accent text-ink" : "border-line text-foam hover:border-accent hover:text-accent"
                  }`}
                >
                  {mode === "void" ? "Voids" : "Foams"}
                </button>
              );
            })}
          </div>
          <div className="mt-2 text-[10px] leading-snug text-muted">
            Same arrangement either way — the voids define the space; foams just show the
            solid mass carved around it.
          </div>
        </div>
        <div>
          <div className="mb-2 text-[11px] uppercase tracking-widest2 text-muted">Model color</div>
          <div className="flex items-center gap-2.5">
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
            <span className="text-xs text-foam">{color}</span>
          </div>
        </div>
        <div>
          <div className="mb-2 text-[11px] uppercase tracking-widest2 text-accent">Bank</div>
          <BankPanel tiles={tiles} selection={selection} onToggle={handleToggle} onSelectAll={handleSelectAll} />
        </div>
      </div>

      <div className="min-w-0 flex-1">
        <ArrangeViewport
          instances={instances}
          selectedId={selectedId}
          onSelect={handleSelectInstance}
          highlightIds={highlightIds}
          displayMode={displayMode}
          namedView={namedView}
          pieceMode={pieceMode}
          color={color}
          smoothedGeometry={smoothedGeometry}
        />
      </div>

      <div className="flex w-80 shrink-0 flex-col gap-6 overflow-y-auto border-l border-line p-4">
        <div>
          <div className="mb-2 text-[11px] uppercase tracking-widest2 text-accent">Auto-generate</div>
          <SettingsPanel
            settings={settings}
            onChange={setSettings}
            onAutoGenerate={handleAutoGenerate}
            onExport={handleExport}
            onClear={handleClear}
            canExport={instances.length > 0 && !exporting}
            resultCount={instances.length}
            generating={generating}
          />
        </div>

        {generationState && generationState.connections.length > 0 && (
          <JointsPanel
            connections={generationState.connections}
            instances={instances}
            marks={jointMarks}
            onMark={handleMarkJoint}
            onSelect={handleSelectJoint}
            onRegenerate={handleRegenerateMarked}
            regenerating={regenerating}
          />
        )}

        {instances.length > 0 && (
          <div>
            <div className="mb-2 text-[11px] uppercase tracking-widest2 text-accent">Solid export</div>
            <button
              type="button"
              onClick={handleToggleSmooth}
              disabled={smoothing}
              className={`w-full border px-3 py-2 text-xs uppercase tracking-widest2 disabled:cursor-not-allowed disabled:opacity-60 ${
                smoothedGeometry ? "border-accent bg-accent text-ink" : "border-line text-foam hover:border-accent hover:text-accent"
              }`}
            >
              {smoothing
                ? `Sealing… ${smoothProgress?.done ?? 0}/${smoothProgress?.total ?? instances.length}`
                : smoothedGeometry
                  ? "Unsmooth"
                  : "Smooth & seal into 1 solid"}
            </button>
            <div className="mt-2 text-[10px] leading-snug text-muted">
              {smoothedGeometry
                ? "Showing one welded solid — Export OBJ now exports this instead of the separate pieces."
                : "Fuses every piece into one real solid (true boolean union) and softens the seams — for 3D printing or a single clean mesh in Rhino. Editing a piece or auto-generating again clears this."}
              {smoothFailedCount > 0 && (
                <span className="text-accent"> {smoothFailedCount} piece(s) couldn&rsquo;t be sealed cleanly and were left out.</span>
              )}
              {smoothedGeometry && smoothOpenEdgeCount === 0 && (
                <span className="text-foam"> Fully watertight — no open edges.</span>
              )}
              {smoothedGeometry && smoothOpenEdgeCount > 0 && (
                <span className="text-accent">
                  {" "}
                  {smoothOpenEdgeCount} open edge(s) remain (a few tiny seams the auto-repair couldn&rsquo;t safely close) —
                  run this through your slicer&rsquo;s or Rhino&rsquo;s own mesh repair before printing.
                </span>
              )}
            </div>
          </div>
        )}

        <div>
          <div className="mb-2 text-[11px] uppercase tracking-widest2 text-accent">Add manually</div>
          {eligibleBank.length === 0 ? (
            <div className="text-[11px] text-muted">Check a tile in the bank to add it here.</div>
          ) : (
            <div className="flex flex-col gap-1">
              {eligibleBank.map((entry) => (
                <button
                  key={entry.tile.glbUrl}
                  type="button"
                  onClick={() => handleAdd(entry.tile)}
                  className="border border-line px-2 py-1 text-left text-[11px] text-foam hover:border-accent hover:text-accent"
                >
                  + {entry.tile.tile.name}
                </button>
              ))}
            </div>
          )}
        </div>

        <div>
          <div className="mb-2 text-[11px] uppercase tracking-widest2 text-accent">Selected piece</div>
          <InstanceEditor instance={selectedInstance} onUpdate={handleUpdate} onRemove={handleRemove} onSnap={handleSnap} />
        </div>

        <div>
          <div className="mb-2 text-[11px] uppercase tracking-widest2 text-accent">Placed pieces</div>
          <InstanceList instances={instances} selectedId={selectedId} onSelect={handleSelectInstance} />
        </div>
      </div>
    </div>
  );
}
