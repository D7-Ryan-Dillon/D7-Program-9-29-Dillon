// Lets the user keep the parts of a generation they like and regrow just
// the parts they don't: mark a joint "bad" in the joints review panel
// (components/arrange/JointsPanel.tsx) and only that joint's own branch of
// the tree gets removed and regrown — with a fresh random draw, so a
// repeated regenerate actually tries something different — while every
// other joint, whether marked "good" or left unmarked, stays completely
// untouched. This is the concrete feature lib/arrange/types.ts's
// Connection/GenerationState and lib/arrange/autoGenerate.ts's resumable
// growComposition core exist to support.
//
// The composition is provably a rooted tree: every instance after the
// seed instance was created by filling exactly one socket on exactly one
// already-placed instance (growComposition never retroactively connects
// two already-placed instances) — so removing a bad joint's CHILD and
// everything descended from it is an unambiguous subtree deletion, not a
// general graph problem needing cycle bookkeeping.
//
// "Keep the good parts" is a structural guarantee here, not a hope: the
// surviving instances/connections are never even passed into
// growComposition's own instance list for it to grow from — regrowth only
// ever sees the freshly-freed sockets. Held-back sockets (already open,
// on surviving instances, untouched by any bad mark) are spliced back in
// only after growth finishes.

import type { FaceName } from "@/lib/types";
import { computeFaceBranches } from "@/lib/faceBranches";
import type { BankEntry, Connection, GenerationState, OpenSocket, PlacedInstance } from "./types";
import { growComposition, socketId, type GrowOptions } from "./autoGenerate";
import { localFaceFacing } from "./transforms";
import { createRng } from "./rng";

interface PruneResult {
  instances: PlacedInstance[];
  connections: Connection[];
  /** Sockets that were already open before pruning and still are — on
   * surviving instances, untouched by any bad mark. Held back from
   * regrowth (see file comment). */
  heldBackSockets: OpenSocket[];
  /** One fresh socket per pruned bad connection whose parent survived —
   * exactly what regrowth is allowed to fill. */
  freshlyFreedSockets: OpenSocket[];
  usage: Map<string, number>;
  nextInstanceSeq: number;
  nextConnectionSeq: number;
}

/** Recomputes the one specific socket a just-pruned connection used to
 * occupy on its (surviving) parent, fresh from the parent's CURRENT
 * transform — mirrors lib/arrange/autoGenerate.ts's socketsForInstance,
 * just for one already-known (worldDir, branchIndex) instead of every
 * branch on every face. Null only if the branch genuinely isn't there
 * anymore, which shouldn't happen (the branch existed when this
 * connection was first made, and nothing here changes the parent's own
 * geometry), but this stays defensive rather than assuming. */
function reopenSocket(bank: BankEntry[], parent: PlacedInstance, worldDir: FaceName, branchIndex: number): OpenSocket | null {
  const tile = bank.find((b) => b.tile.glbUrl === parent.glbUrl)?.tile;
  if (!tile) return null;
  const localFace = localFaceFacing(worldDir, parent.transform);
  const branches = computeFaceBranches(tile, localFace);
  const branch = branches[branchIndex];
  if (!branch) return null;
  const scale2 = parent.transform.scale * parent.transform.scale;
  return { id: socketId(parent.id, worldDir, branchIndex), instanceId: parent.id, worldDir, branchIndex, branchAreaFt2: branch.areaFt2 * scale2 };
}

/** Removes every bad connection's child and its full descendant subtree,
 * and re-opens exactly one socket per pruned connection on whichever
 * parent survived (see file comment for why this is an unambiguous tree
 * deletion, not a general graph problem). Doesn't mutate `state`. */
export function pruneMarkedJoints(state: GenerationState, bank: BankEntry[], badConnectionIds: Set<string>): PruneResult {
  const childrenOf = new Map<string, Connection[]>();
  for (const c of state.connections) {
    const list = childrenOf.get(c.parentInstanceId);
    if (list) list.push(c);
    else childrenOf.set(c.parentInstanceId, [c]);
  }

  const badConnections = state.connections.filter((c) => badConnectionIds.has(c.id));

  const removedInstanceIds = new Set<string>();
  const stack = badConnections.map((c) => c.childInstanceId);
  while (stack.length) {
    const id = stack.pop()!;
    if (removedInstanceIds.has(id)) continue;
    removedInstanceIds.add(id);
    for (const child of childrenOf.get(id) ?? []) stack.push(child.childInstanceId);
  }

  const instances = state.instances.filter((inst) => !removedInstanceIds.has(inst.id));
  const survivingIds = new Set(instances.map((i) => i.id));
  const byId = new Map(instances.map((i) => [i.id, i]));

  const connections = state.connections.filter((c) => survivingIds.has(c.parentInstanceId) && survivingIds.has(c.childInstanceId));
  const heldBackSockets = state.openSockets.filter((s) => survivingIds.has(s.instanceId));

  const freshlyFreedSockets: OpenSocket[] = [];
  for (const conn of badConnections) {
    const parent = byId.get(conn.parentInstanceId);
    if (!parent) continue; // the parent was itself removed, inside some OTHER bad connection's subtree -- nothing to free
    const socket = reopenSocket(bank, parent, conn.parentWorldDir, conn.parentBranchIndex);
    if (socket) freshlyFreedSockets.push(socket);
  }

  // Recomputed fresh from the survivors rather than incrementally
  // decremented off `state.usage` — simplest, and immune to ever drifting
  // out of sync with what's actually still placed.
  const usage = new Map<string, number>();
  for (const inst of instances) usage.set(inst.glbUrl, (usage.get(inst.glbUrl) ?? 0) + 1);

  return { instances, connections, heldBackSockets, freshlyFreedSockets, usage, nextInstanceSeq: state.nextInstanceSeq, nextConnectionSeq: state.nextConnectionSeq };
}

/** Prunes every joint marked bad, then regrows only the sockets that
 * freed — back up to the composition's own pre-prune size — with a fresh
 * random draw, while every untouched instance/connection stays exactly as
 * it was (see file comment). `opts.spineFirst` is passed straight through
 * to the regrowth, same as a fresh auto-generate. */
export async function regenerateMarkedJoints(
  state: GenerationState,
  bank: BankEntry[],
  badConnectionIds: Set<string>,
  opts?: Pick<GrowOptions, "spineFirst">,
): Promise<GenerationState> {
  const pruned = pruneMarkedJoints(state, bank, badConnectionIds);
  const targetAmount = state.instances.length; // grow back to the same total the composition had before pruning

  const growFrom: GenerationState = {
    instances: pruned.instances,
    connections: pruned.connections,
    openSockets: pruned.freshlyFreedSockets,
    usage: pruned.usage,
    settings: state.settings,
    nextInstanceSeq: pruned.nextInstanceSeq,
    nextConnectionSeq: pruned.nextConnectionSeq,
  };

  // A fresh, non-deterministic draw — not the settings' own seed sequence
  // — so a repeated regenerate actually tries something different instead
  // of walking straight back into the same "bad" result.
  const rng = createRng(Math.floor(Math.random() * 0xffffffff));

  const grown = await growComposition(growFrom, bank, targetAmount, { rng, ...opts });

  return { ...grown, openSockets: [...grown.openSockets, ...pruned.heldBackSockets] };
}
