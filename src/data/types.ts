/**
 * LAYER D — data types. Zero logic lives in this directory.
 *
 * Every numeric constant that reaches the engine carries provenance. A field with
 * no source is `null`; it renders as an em-dash in the UI, contributes nothing to
 * the engine, and is listed in docs/MISSING_CONSTANTS.md (spec 0.4, 5.6).
 */

/** A number that knows where it came from. `value: null` means "we do not know". */
export interface Sourced<T = number> {
  value: T | null;
  unit: string;
  source: string;
  sourceUrl: string;
  /** 'measured' = taken verbatim; 'derived' = unit-converted from a cited value; 'assumed' = engineering default, never a physiological claim. */
  confidence: 'measured' | 'derived' | 'assumed';
  note?: string;
}

export type OrganId =
  | 'brain' | 'heart' | 'lung_l' | 'lung_r' | 'trachea' | 'oesophagus'
  | 'liver' | 'stomach' | 'pancreas' | 'spleen'
  | 'kidney_l' | 'kidney_r' | 'bladder'
  | 'intestine_small' | 'intestine_large';

export type OrganGroup = 'cranial' | 'thoracic' | 'abdominal' | 'pelvic';

export interface OrganDef {
  id: OrganId;
  displayName: string;
  group: OrganGroup;
  /** Which panel layout the UI shows on selection. */
  panel: 'cardiac' | 'neuro' | 'respiratory' | 'renal' | 'gastric' | 'hepatic' | 'gi' | 'bladder' | 'generic';
  /** Saturated colour when selected (spec 6.4, measured in VISUAL_AUDIT 2.1). */
  selectedColor: string;
  /** Placeholder generator recipe. Replaced by a .glb in Phase 7; ids and pivots are identical. */
  placeholder: PlaceholderRecipe;
  /** Rest position in metres, body-centred, Y-up. */
  position: [number, number, number];
  /** Group-level exploded-stack offset applied on top of `position` (spec 6.1). */
  layoutOffset: [number, number, number];
  rotation?: [number, number, number];
  /** Nominal anatomical volume in millilitres, used for fill-fraction shaders. */
  volume_mL: number | null;
  volumeSource?: string;
  /** Screen-space label anchor bias so labels do not collide (fraction of bounding radius). */
  labelBias?: [number, number];
}

export type PlaceholderRecipe =
  | { kind: 'ellipsoid'; radii: [number, number, number]; detail?: number; noise?: number }
  | { kind: 'lathe'; profile: [number, number][]; segments?: number; noise?: number }
  | { kind: 'capsuleChain'; points: [number, number, number][]; radius: number; tube?: number }
  | { kind: 'tube'; path: [number, number, number][]; radius: number }
  | { kind: 'lobedLung'; side: -1 | 1 }
  | { kind: 'heartShell' }
  | { kind: 'brainShell' };

/** A hand-authored centreline through a GI segment (spec 6.5, 7.5). */
export interface GiCentreline {
  segment: string;
  points: [number, number, number][];
}

export interface OrgansFile {
  version: number;
  units: 'metres';
  organs: OrganDef[];
  giCentrelines: GiCentreline[];
  /** Group offsets applied to every organ in the group; animatable (spec 6.1). */
  groupLayout: Record<OrganGroup, { offset: [number, number, number] }>;
}
