// The 12 descriptors from the team's Assignment 1 Part 3 matrix. Text is
// transcribed verbatim from PART 3 MATRIX.png — this is reference data,
// not something the scoring engine derives on its own.
//
// NOTE: the scoring engine itself (turning tile metrics into an actual
// qualitative + quantitative score per descriptor) is the next build
// phase — this file only carries the matrix's own text and grouping so
// the Analysis tab can show real criteria while that engine is built.

export type DescriptorCategory =
  | "Formal / Geometrical"
  | "Organizational / Spatial"
  | "Experiential / Atmospheric";

export interface Descriptor {
  id: string;
  name: string;
  category: DescriptorCategory;
  qualitative: string;
  quantitative: string;
}

export const DESCRIPTORS: Descriptor[] = [
  {
    id: "carved",
    name: "Carved",
    category: "Formal / Geometrical",
    qualitative: "Perceived sense the void was subtracted from solid mass",
    quantitative: "% of void surface that is seamless vs. paneled",
  },
  {
    id: "stepped",
    name: "Stepped / Terraced",
    category: "Formal / Geometrical",
    qualitative: "Legibility of successive setbacks in section",
    quantitative: "Number of distinct setback increments per building height",
  },
  {
    id: "porous",
    name: "Porous",
    category: "Formal / Geometrical",
    qualitative: "Perceived visual permeability across levels",
    quantitative: "% of void wall area occupied by openings/bridges vs. solid",
  },
  {
    id: "continuous",
    name: "Continuous",
    category: "Formal / Geometrical",
    qualitative: "Absence of perceptible material joints",
    quantitative: "Number of visible seams per 10m of surface",
  },
  {
    id: "resistant",
    name: "Retained / Resistant",
    category: "Formal / Geometrical",
    qualitative: "Clarity that one element resists the surrounding erosion",
    quantitative: "% of floor area/volume occupied by the retained solid",
  },
  {
    id: "threaded",
    name: "Threaded",
    category: "Organizational / Spatial",
    qualitative: "Sense that public program is encountered continuously, not just at entry",
    quantitative: "Number of public program instances located above ground floor",
  },
  {
    id: "graduated",
    name: "Graduated",
    category: "Organizational / Spatial",
    qualitative: "Smoothness of transition between enclosed and open zones",
    quantitative: 'Number of discrete enclosure "steps" from private to public',
  },
  {
    id: "non_hierarchical",
    name: "Non-hierarchical Circulation",
    category: "Organizational / Spatial",
    qualitative: "Degree to which multiple paths feel equally valid",
    quantitative: "Number of distinct routes from entry to a given destination",
  },
  {
    id: "force_driven",
    name: "Force-driven",
    category: "Organizational / Spatial",
    qualitative: "Legibility of the generating force in the final form",
    quantitative:
      "Measurable input used to generate geometry (e.g. required sun-hours, pedestrian counts)",
  },
  {
    id: "light_filled",
    name: "Light-filled",
    category: "Experiential / Atmospheric",
    qualitative: "Perceived brightness/quality of daylight at void's base",
    quantitative: "Skylight area as % of void floor area below it",
  },
  {
    id: "monumental",
    name: "Monumental",
    category: "Experiential / Atmospheric",
    qualitative: "Perceived significance communicated by scale",
    quantitative: "Void height-to-width ratio, or void volume as % of total building volume",
  },
  {
    id: "spatial_density",
    name: "Spatial Density (Compresses-then-released)",
    category: "Experiential / Atmospheric",
    qualitative: "Perceived contrast between narrowest and widest moments",
    quantitative: "Ratio of narrowest to widest passage width along the sequence",
  },
];

export const DESCRIPTOR_CATEGORIES: DescriptorCategory[] = [
  "Formal / Geometrical",
  "Organizational / Spatial",
  "Experiential / Atmospheric",
];

export const MINIMUM_REQUIRED = 6;
