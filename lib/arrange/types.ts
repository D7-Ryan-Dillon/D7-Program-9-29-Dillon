// Shared types for the Arrange tab: a bank of uploaded tiles, placed as
// scaled/rotated/mirrored instances into one composition that can be
// auto-generated, hand-edited, and merged into one exportable mesh.
//
// An instance is a placed TILE, not a placed "foam" or "void" piece — the
// arrangement itself (position/rotation/scale of every instance) is always
// computed from the void geometry, since the void is what defines usable
// space, in both foam and void pieces (a foam module's own interior
// character comes from the negative space carved into it, which is the
// exact same void geometry). Which mesh actually gets rendered/exported at
// each instance — foam or void — is a single global choice (`PieceKind`,
// picked in ArrangeTab) applied uniformly across the whole composition, not
// a per-instance property: switching it re-skins the same arrangement
// rather than re-arranging it. See lib/arrange/geometry.ts for how a
// transform becomes geometry (and where PieceKind is actually used to pick
// a mesh), and lib/arrange/matching.ts for how compatible joins are found.

import type { FaceName, ParsedTile } from "@/lib/types";

export type PieceKind = "foam" | "void";

export interface BankEntry {
  tile: ParsedTile;
  included: boolean;
}

export interface InstanceTransform {
  /** World position of this instance's own centre, in tile feet. */
  positionFt: [number, number, number];
  /** Quarter turns about each tile axis, composed in a fixed X-then-Y-then-Z
   * order — three independent steppers rather than one running rotation, so
   * "rotate X/Y/Z" buttons stay simple and predictable. Composing three
   * 90°-only axis rotations this way still reaches every one of the cube's
   * 24 proper orientations. */
  rotXSteps: 0 | 1 | 2 | 3;
  rotYSteps: 0 | 1 | 2 | 3;
  rotZSteps: 0 | 1 | 2 | 3;
  /** Mirror about the tile's own centre, along tile X or tile Y. */
  mirrorX: boolean;
  mirrorY: boolean;
  scale: number;
}

export const IDENTITY_TRANSFORM: Omit<InstanceTransform, "positionFt"> = {
  rotXSteps: 0,
  rotYSteps: 0,
  rotZSteps: 0,
  mirrorX: false,
  mirrorY: false,
  scale: 1,
};

export interface PlacedInstance {
  id: string;
  glbUrl: string;
  tileName: string;
  /** The source tile's own block size in feet — needed to re-centre its
   * geometry before mirroring/rotating (the GLB's own origin is the tile's
   * corner, not this instance's content). */
  tileFt: [number, number, number];
  /** The void's own occupied region in the tile's local feet frame — the
   * thing that actually defines this instance's "content" for adjacency
   * placement, whichever piece ends up rendered, so a small void doesn't
   * leave a placement gap sized for the whole 20 ft block it came from. */
  contentMinFt: [number, number, number];
  contentMaxFt: [number, number, number];
  transform: InstanceTransform;
}

export interface AutoGenerateSettings {
  amount: number;
  maxCopiesPerEntry: number;
  scaleMin: number;
  scaleMax: number;
  seed: number;
  /** When true, growth extends one dominant chain through the biggest
   * available opening at each step until it reaches a target length, before
   * falling through to the normal area-weighted-random pick across every
   * open socket (see lib/arrange/autoGenerate.ts's pickNextSocket) — a
   * legible backbone-then-branches structure instead of an undifferentiated
   * cluster. */
  spineFirst: boolean;
}

/** One still-open opening on an already-placed instance — id-based (not an
 * array index) so it stays valid once instances can be removed
 * (lib/arrange/regenerate.ts). */
export interface OpenSocket {
  id: string;
  instanceId: string;
  worldDir: FaceName;
  branchIndex: number;
  /** World-space area of this specific opening — drives trunk-first growth
   * (see lib/arrange/autoGenerate.ts's weightedPickIndex), not just which
   * branch this is. */
  branchAreaFt2: number;
}

/** One real join between two placed instances — the "memory" a pure
 * position list doesn't have. Recorded for every successful placement, kept
 * regardless of whether the user later marks it (lib/arrange/regenerate.ts
 * is what actually acts on `userMark`). */
export interface Connection {
  id: string;
  parentInstanceId: string;
  childInstanceId: string;
  /** The world direction, from the parent, the child was attached in. */
  parentWorldDir: FaceName;
  parentBranchIndex: number;
  /** The child's own local face/branch that ended up facing back at the
   * parent — always the opposite world direction, recorded for clarity
   * rather than re-derived every time it's needed. */
  childWorldDir: FaceName;
  childBranchIndex: number;
  /** The winning placement's combined score (shape match, and once
   * lib/arrange/depthMatch.ts lands, depth continuity too). */
  matchScore: number;
  /** lib/arrange/flowCompatibility.ts's value for this specific pair, at
   * placement time — kept per-joint for a future inspector even though
   * matchScore is what actually drove the pick. */
  compatibilityScore: number;
  /** The real measured gap (tile-ft) between the two pieces' actual
   * geometry after lib/arrange/autoGenerate.ts's contact correction ran —
   * null only if that correction couldn't load geometry to measure at all. */
  realGapFt: number | null;
  /** Set by the joints review panel; lib/arrange/regenerate.ts is what
   * actually prunes/regrows based on this. Unset means "not reviewed". */
  userMark?: "good" | "bad";
}

/** A composition, plus the bookkeeping needed to keep growing it, mark
 * specific joints, or partially regenerate it later — what turns
 * autoGenerate from a one-shot pure function into something with memory.
 * lib/arrange/autoGenerate.ts's growComposition is the only thing that
 * builds/extends one of these; lib/arrange/regenerate.ts is the only thing
 * that prunes one. */
export interface GenerationState {
  instances: PlacedInstance[];
  connections: Connection[];
  openSockets: OpenSocket[];
  /** glbUrl -> how many instances of that tile are currently placed. */
  usage: Map<string, number>;
  /** The settings this composition was (most recently) grown under —
   * carried along so a resumed/regenerated call knows the same
   * maxCopiesPerEntry/scale range without the caller re-passing it. */
  settings: AutoGenerateSettings;
  /** Monotonic counters for instance/connection ids — incremented on every
   * creation, NEVER decremented on removal, so a regenerated composition
   * can't reissue an id a just-removed instance used (a real hazard once
   * removal exists at all: stale references in selection state, joint
   * marks, or the viewport's per-id mesh cache would silently point at the
   * wrong thing). */
  nextInstanceSeq: number;
  nextConnectionSeq: number;
}

export function bankEligibleTiles(bank: BankEntry[]): ParsedTile[] {
  return bank.filter((entry) => entry.included).map((entry) => entry.tile);
}

/** The void's own occupied region in a tile's local feet frame — always
 * the real measured bbox (tile.json's void_bbox) when the exporter found
 * one, else the whole tile block as a fallback. Used for BOTH foam and
 * void placement: the void is what defines space in either case. */
export function voidContentBBoxFt(tile: ParsedTile): { min: [number, number, number]; max: [number, number, number] } {
  const bbox = tile.tile.metrics.void_bbox;
  if (bbox) return { min: bbox.min_ft, max: bbox.max_ft };
  return { min: [0, 0, 0], max: tile.tile.tile_ft };
}

let nextInstanceSeq = 0;

export function makeInstance(tile: ParsedTile, positionFt: [number, number, number]): PlacedInstance {
  const bbox = voidContentBBoxFt(tile);
  nextInstanceSeq += 1;
  return {
    id: `inst-${nextInstanceSeq}-${Math.random().toString(36).slice(2, 7)}`,
    glbUrl: tile.glbUrl,
    tileName: tile.tile.name,
    tileFt: tile.tile.tile_ft,
    contentMinFt: bbox.min,
    contentMaxFt: bbox.max,
    transform: { positionFt, ...IDENTITY_TRANSFORM },
  };
}
