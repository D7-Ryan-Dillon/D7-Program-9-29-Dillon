// Manual-mode guidance: snaps one placed instance to touch whichever other
// instance it's currently nearest to, using the same real shape-matching
// engine auto-generate uses (lib/arrange/matching.ts) — searches every
// orientation for the target instance's own tile/piece and picks whichever
// one lines its opening up best against the neighbour.

import type { FaceName, ParsedTile } from "@/lib/types";
import type { PlacedInstance } from "./types";
import { bestPlacement } from "./matching";

function dominantDirection(delta: [number, number, number]): FaceName {
  const abs = delta.map(Math.abs);
  const i = abs.indexOf(Math.max(...abs));
  const axes: [FaceName, FaceName][] = [
    ["+X", "-X"],
    ["+Y", "-Y"],
    ["+Z", "-Z"],
  ];
  return delta[i] >= 0 ? axes[i][0] : axes[i][1];
}

export function snapToNearest(
  target: PlacedInstance,
  targetTile: ParsedTile,
  others: { instance: PlacedInstance; tile: ParsedTile }[],
): PlacedInstance["transform"] | null {
  if (others.length === 0) return null;

  let nearest = others[0];
  let nearestDist = Infinity;
  for (const o of others) {
    const d = Math.hypot(
      o.instance.transform.positionFt[0] - target.transform.positionFt[0],
      o.instance.transform.positionFt[1] - target.transform.positionFt[1],
      o.instance.transform.positionFt[2] - target.transform.positionFt[2],
    );
    if (d < nearestDist) {
      nearestDist = d;
      nearest = o;
    }
  }

  const delta: [number, number, number] = [
    target.transform.positionFt[0] - nearest.instance.transform.positionFt[0],
    target.transform.positionFt[1] - nearest.instance.transform.positionFt[1],
    target.transform.positionFt[2] - nearest.instance.transform.positionFt[2],
  ];
  // straight up/on top of an identical spot reads as "no direction yet" —
  // default to +X so a freshly-added piece at the origin still snaps somewhere
  const worldDir = delta.some((v) => v !== 0) ? dominantDirection(delta) : "+X";

  const placement = bestPlacement(
    nearest.instance,
    nearest.tile,
    worldDir,
    targetTile,
    target.tileFt,
    target.contentMinFt,
    target.contentMaxFt,
    [target.transform.scale],
    0,
  );
  if (!placement) return null;

  return {
    positionFt: placement.positionFt,
    rotXSteps: placement.orientation.rotXSteps,
    rotYSteps: placement.orientation.rotYSteps,
    rotZSteps: placement.orientation.rotZSteps,
    mirrorX: placement.orientation.mirrorX,
    mirrorY: placement.orientation.mirrorY,
    scale: target.transform.scale,
  };
}
