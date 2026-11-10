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
  | 'brain' | 'eyes' | 'spinal_cord'
  | 'thyroid' | 'thymus' | 'adrenal_l' | 'adrenal_r'
  | 'heart' | 'lung_l' | 'lung_r' | 'trachea' | 'diaphragm' | 'oesophagus'
  | 'liver' | 'gallbladder' | 'stomach' | 'pancreas' | 'spleen'
  | 'kidney_l' | 'kidney_r' | 'ureters' | 'bladder'
  | 'intestine_small' | 'intestine_large'
  | 'prostate' | 'testes' | 'penis'
  | 'uterus' | 'ovaries' | 'vagina' | 'breasts' | 'fetus';

/**
 * Body regions of the exploded stack. `axial` is for structures that run through more
 * than one region (the cord, the oesophagus, a ureter): they take no rigid offset and
 * carry the continuous warp in their own geometry instead. See `axialWarp` below.
 */
export type OrganGroup = 'cranial' | 'thoracic' | 'abdominal' | 'pelvic' | 'axial';

/** Which body system an organ belongs to: drives the layer switches and the grouping in lists. */
export type BodySystem =
  | 'nervous' | 'cardiovascular' | 'respiratory' | 'digestive'
  | 'urinary' | 'endocrine' | 'lymphatic' | 'reproductive';

export type OrganPanel =
  | 'cardiac' | 'neuro' | 'respiratory' | 'renal' | 'gastric' | 'hepatic' | 'gi' | 'bladder'
  | 'pancreatic' | 'endocrine' | 'reproductive' | 'fetal' | 'ocular' | 'spinal' | 'generic';

export interface OrganDef {
  id: OrganId;
  displayName: string;
  system: BodySystem;
  /**
   * Present on the organs only one sex has. An organ with no `sex` belongs to every
   * body. The renderer shows or hides these from `snapshot.body.sex`, so switching the
   * body's sex in the interface swaps the reproductive organs with it.
   */
  sex?: 'male' | 'female';
  /** Shown only while the body is pregnant (the fetus). */
  pregnancyOnly?: boolean;
  /**
   * Which file in src/data/anatomy/ describes this organ's parts. Defaults to the
   * organ's own id; set where two organs share one structure (both kidneys, both
   * adrenals).
   */
  atlas?: string;
  /**
   * Multiplier on the dormant absorption density, for a structure that is a sheet
   * rather than a mass (the diaphragm): at full density a membrane seen edge-on is the
   * darkest thing in the body, which is the opposite of what it is.
   */
  shellDensity?: number;
  group: OrganGroup;
  /** Which panel layout the UI shows on selection. */
  panel: OrganPanel;
  /** Saturated colour when selected (spec 6.4, measured in VISUAL_AUDIT 2.1). */
  selectedColor: string;
  /**
   * Geometry recipe. The name is historical: these began as crude placeholders for
   * meshes that were going to be bought in (spec 7.2). `model` recipes are the
   * authored, signed-distance anatomy in render/anatomy/models.ts; the older recipe
   * kinds are kept because the generators are small and the tests still exercise them.
   */
  placeholder: PlaceholderRecipe;
  /** Rest position in metres, body-centred, Y-up, +x = the PATIENT'S right. */
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
  | { kind: 'brainShell' }
  /** Authored signed-distance anatomy, by name. See render/anatomy/models.ts. */
  | { kind: 'model'; model: string };

/** A hand-authored centreline through a GI segment (spec 6.5, 7.5). */
export interface GiCentreline {
  segment: string;
  points: [number, number, number][];
}

/**
 * The exploded stack as a continuous function of height. Each entry is the band, in
 * unexploded body y, across which that region's offset fades in: `[from, to]`.
 */
export interface AxialWarp {
  note: string;
  cranial: [number, number];
  abdominal: [number, number];
  pelvic: [number, number];
}

export interface OrgansFile {
  version: number;
  units: 'metres';
  organs: OrganDef[];
  giCentrelines: GiCentreline[];
  /** Group offsets applied to every organ in the group; animatable (spec 6.1). */
  groupLayout: Record<OrganGroup, { offset: [number, number, number] }>;
  axialWarp: AxialWarp;
}
