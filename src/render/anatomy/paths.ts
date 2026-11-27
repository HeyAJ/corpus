import organsFile from '../../data/organs.json';
import { capsule, chain, ellipsoid, offset, smoothSubtract, smoothUnion, translated, type Sdf, type V3 } from './sdf';

/**
 * CENTRELINES SHARED BY MORE THAN ONE ORGAN FILE.
 *
 * WHY THIS MODULE EXISTS. The vertebral column ENCLOSES the spinal cord, so its shell and its
 * atlas are drawn along the cord's own centreline. That centreline used to live in models.ts,
 * but models.ts registers every shell builder and so imports `shells/vertebral_column.ts`,
 * which imported models.ts back for the path: an import cycle. It happened to work only
 * because the column's shell read the constant inside a function (at call time) instead of at
 * module level, a fragile arrangement that a later edit to a skeleton file could break with a
 * temporal-dead-zone error that shows up as one organ silently not building. The shared data
 * now lives here, in a module that imports only the pure SDF toolkit and the organ data, so models.ts and
 * the skeleton files can both depend on it and neither on the other.
 *
 * Pure data, no three.js: it is listed in tsconfig.node.json because models.ts (reached from
 * tools/placeholder-organs.ts) imports it, and the build fails on an unlisted file (TS6307).
 */

/**
 * Spinal cord centreline, unexploded body coordinates, foramen magnum to the sacrum.
 *
 * THE CERVICAL PART WAS MOVED BACK (nk, 2026-11). It used to run at z -0.026 to -0.05 from y 0.39
 * to 0.29, which put the cervical vertebral bodies (they lie IN FRONT of the canal, a full
 * 15 mm deep in Gray's) on top of the oesophagus and pharynx: the oesophagus's back wall is at
 * z -0.029 from y 0.20 to 0.35 and the trachea sits in front of it, so there was no room for
 * canal, cord and body behind them. sk1 hid that by shrinking the bodies to 4 mm; the honest fix
 * is here, because the cord is the one centreline that the column, the ribs, the nerve overlay
 * and the pharynx all follow. The front-to-back order is now trachea, oesophagus, a gap,
 * vertebral bodies, canal with the cord.
 *
 * The top point stays at the brainstem's end (the medulla's lower tip is at z -0.0255, brain
 * atlas) so the cord leaves the brain where it always did; the path then falls back by about
 * 3.5 cm over the next 6 cm and joins the old line at y 0.29 and below it exactly as before from
 * y 0.22. The bend between the medulla (tilting back about 14 degrees) and the first cord
 * segment is a drawing choice that stands for the craniovertebral junction; the exploded
 * stack's warp stretches the first 5 mm of it over 14 mm of scene height, which softens it.
 */
export const SPINAL_CORD_PATH: [number, number, number][] = [
  [0, 0.39, -0.0255],
  [0, 0.38, -0.0335],
  [0, 0.37, -0.0465],
  [0, 0.36, -0.0555],
  [0, 0.345, -0.061],
  [0, 0.33, -0.0625],
  [0, 0.29, -0.0655],
  [0, 0.22, -0.078],
  [0, 0.15, -0.08],
  [0, 0.09, -0.07],
  [0, 0.045, -0.062],
  [0, -0.03, -0.066],
  [0, -0.1, -0.078],
];

/**
 * Height of the tip of the conus medullaris, body y: the intervertebral disc between L1 and L2,
 * which is where Gray's puts the end of the adult spinal cord. It is the midpoint of L1's lower
 * face (0.0159) and L2's upper face (0.0101) in the vertebral column's own levels
 * (`COLUMN_LEVELS` in shells/vertebral_column.ts); that file imports this one, so the number is
 * written here rather than derived, and a probe compares them. Below it the cord is drawn as the
 * cauda equina and the filum terminale, which carry on to the coccyx. `spinalCordRadius` in
 * models.ts holds the same number.
 */
export const CONUS_TIP_Y = 0.013;

/* ===================================================================================== */
/* THE THORAX ROUND THE HEART (gx1, 2026-11-27)                                          */
/* ===================================================================================== */

/**
 * WHY THE LUNGS ARE CUT BY THE HEART'S OWN SHAPE.
 *
 * WHAT WAS WRONG. The lung shells carried a cardiac impression drawn as one free-standing
 * ellipsoid in the lung's own frame, placed before the heart was drawn the way it lies. The heart
 * (organs.json: position [-0.016, 0.168, 0.016], never to be moved) sits further left and forward
 * than that ellipsoid assumed, so 2,223 of the heart's 7,130 vertices were inside the left lung,
 * the deepest 33.0 mm (y 0.193, x -0.071), and lung vertices reached 20.7 mm into the heart. The
 * heart's apex and left ventricle are lateral to the lung's whole mediastinal face, so no
 * ellipsoid in the lung's frame could ever have worked.
 *
 * WHAT GRAY'S SAYS (Gray's Anatomy, 42nd ed., the pleurae and lungs). The medial surface of each
 * lung carries a cardiac impression, DEEP on the left, where the heart lies mostly to the left of
 * the midline, and shallower on the right; the left lung's anterior border carries the cardiac
 * notch with the lingula hanging below it. The impression is the heart (in its pericardium)
 * pressing on the lung, so the right way to draw it is to subtract the heart itself, grown by
 * the thin pericardial and pleural layers, from each lung. That is what `heartCavity` does: it is
 * the heart's own field, copied from `heart()` in models.ts, grown by `PLEURAL_GAP_M` (the pericardial sac the heart atlas draws), expressed in
 * the lung's frame.
 *
 * KEEP IN STEP. `heartMassLocal` repeats the primitives of `heart()` in models.ts. If that shell
 * is ever redrawn, change this too; the overlap probe (heart in lung) is what notices.
 * The frame offset is read from organs.json, so the two organs' positions cannot drift apart
 * silently; both are in the 'thoracic' group, so the exploded stack's offset cancels.
 */

/**
 * How far the lung's cardiac impression stands off the heart's own shell, metres. THE HEART ATLAS
 * DRAWS ITS PERICARDIAL SAC `PERICARDIUM_SAC` = 7.5 mm outside the shell (atlas/heart.parts.ts, a
 * display choice), and Gray's has the lung's impression against that sac, with only the pleura
 * between; so the cut is the sac's 7.5 mm plus 0.5 mm of pleura. Anything smaller would put the
 * sac the heart atlas draws inside the lung. A DISPLAY CHOICE tied to that constant: change them together.
 */
export const PLEURAL_GAP_M = 0.008;

/** The heart's solid, in the heart's own frame: a copy of the field in models.ts `heart()`. */
export function heartMassLocal(): Sdf {
  const rv = capsule([0.012, 0.014, 0.014], [-0.03, -0.046, 0.022], 0.027, 0.011);
  const lv = capsule([-0.008, 0.016, -0.008], [-0.044, -0.052, 0.012], 0.031, 0.013);
  let ventricles = smoothUnion(0.01, rv, lv);
  ventricles = smoothSubtract(0.005, ventricles, capsule([-0.006, 0.02, 0.036], [-0.038, -0.046, 0.03], 0.0035));
  return smoothUnion(
    0.007,
    ventricles,
    ellipsoid([0.03, 0.022, 0.0], [0.02, 0.027, 0.022]),
    ellipsoid([-0.012, 0.036, -0.028], [0.026, 0.02, 0.017]),
    ellipsoid([0.016, 0.042, 0.022], [0.012, 0.009, 0.009]),
    ellipsoid([-0.038, 0.034, 0.0], [0.01, 0.008, 0.011]),
    chain([[-0.002, 0.03, 0.002], [0.006, 0.058, 0.0], [0.014, 0.084, -0.008]], 0.0138),
    chain([[-0.012, 0.03, 0.02], [-0.014, 0.054, 0.012], [-0.01, 0.072, -0.008]], 0.0128),
    capsule([0.034, 0.04, -0.004], [0.036, 0.09, -0.014], 0.0092),
    capsule([0.03, 0.006, -0.012], [0.03, -0.024, -0.02], 0.0105),
    capsule([-0.03, 0.04, -0.034], [-0.055, 0.046, -0.036], 0.0055),
    capsule([-0.03, 0.03, -0.036], [-0.055, 0.03, -0.04], 0.0055),
    capsule([0.006, 0.04, -0.036], [0.045, 0.046, -0.04], 0.0055),
    capsule([0.006, 0.03, -0.038], [0.045, 0.03, -0.042], 0.0055),
  );
}

/** The heart as it stands in the frame of a lung (`lung_l` or `lung_r`), grown by the pleural gap. */
export function heartCavity(lung: 'lung_l' | 'lung_r'): Sdf {
  const pos = (id: string): V3 => (organsFile.organs.find((o) => o.id === id)!.position as unknown as V3);
  const h = pos('heart');
  const l = pos(lung);
  return translated(offset(heartMassLocal(), PLEURAL_GAP_M), [h[0] - l[0], h[1] - l[1], h[2] - l[2]]);
}

/**
 * THE AIRWAY BEHIND THE GREAT VESSELS: trachea centreline, carina and the two main bronchi.
 *
 * WHAT WAS WRONG. The trachea ran straight down at z +0.004 to a carina at (0, 0.254, 0.004).
 * The heart's ascending-aorta root (its field ends at y 0.252 with a rounded cap to 0.266, back wall
 * at z -0.0058) and pulmonary-trunk root stand exactly there, so the trachea went 13.6 mm into the
 * heart and the heart 8.6 mm into the trachea. The two main bronchi ended at (+-0.03, 0.222-0.228,
 * -0.002), the left one inside the left atrium (top at y 0.224).
 *
 * WHAT GRAY'S SAYS. The trachea ends at the carina at about the level of T4/T5 (the sternal angle),
 * lying BEHIND the aortic arch and the ascending aorta and in front of the oesophagus; the main
 * bronchi leave it above the left atrium and pass behind the heart's base to the hila, the left
 * one crossing in front of the oesophagus and under the arch. So the lower trachea is drawn
 * inclining backwards below y 0.30, which is how it gets behind the aortic root; the front wall
 * clears the aortic root's back wall by 1.4 mm at the carina (centre z -0.017, radius 9.8 mm,
 * heart back wall -0.0058). ABOVE y 0.30 NOTHING MOVED: the points at y 0.352, 0.32 and the
 * straight run to y 0.30 are the old ones (the neck was reconciled in ADR-051), so the larynx,
 * cricoid and the neck's neighbours are as they were.
 *
 * The bend is a chain of straight capsules (models.ts `trachea()` and the atlas use these same
 * points), so the steepest stretch is about 23 degrees from the vertical; the stretch of
 * 20 degrees is a DISPLAY consequence of the clearances above, not a measured inclination.
 */
export const TRACHEA_CENTRELINE: readonly V3[] = [
  [0, 0.352, 0],
  [0, 0.32, 0.002],
  [0, 0.3, 0.003],
  [0, 0.28, -0.0025],
  [0, 0.268, -0.0098],
  [0, 0.254, -0.0185],
];
export const CARINA: V3 = TRACHEA_CENTRELINE[TRACHEA_CENTRELINE.length - 1];

/**
 * The ends of the main bronchi sit AT THE HILA (`lungHilum` below). The right one is 5 mm medial and
 * 4 mm above the right hilum, and the right bronchus is the wider, shorter and steeper (Gray's); it
 * passes above the right atrium (top y 0.217) and behind the superior vena cava (back wall z 0.0003
 * at y 0.226). The left ends BEHIND and ABOVE the heart shell's left pulmonary-vein stubs
 * (Gray's, hilum of the left lung: the pulmonary artery above, the bronchus behind, the veins in front
 * and below), 11 mm above the upper stub and 14 mm behind it, which is what keeps the airway out of the
 * heart's vein roots; on the way it passes over the left atrium (top y 0.224) with 9 mm to spare and in
 * front of the oesophagus (the left main bronchus crosses in front of it, Gray's).
 */
export const BRONCHUS_RIGHT_END: V3 = [0.03, 0.226, -0.016];
export const BRONCHUS_LEFT_END: V3 = [-0.066, 0.222, -0.034];

/**
 * THE THORACIC OESOPHAGUS BEHIND THE LEFT ATRIUM.
 *
 * WHAT WAS WRONG. The authored centreline (organs.json giCentrelines 'oesophagus', z -0.014 to
 * -0.021 from y 0.29 to 0.15) put a 17 mm tube inside the back of the heart (the left atrium and
 * the right pulmonary-vein roots reach z -0.0315 at y 0.20): 8.2 mm of oesophagus inside the heart and 7.3 mm
 * of heart inside the oesophagus; and once the trachea was brought back (above) it would sit
 * against it too.
 *
 * WHAT GRAY'S SAYS. The thoracic oesophagus lies directly behind the left atrium, separated
 * from it by the pericardium, in front of the vertebral bodies, behind the trachea and the left main
 * bronchus; it is flattened from front to back where it is squeezed between them. In THIS model the
 * room between the heart's back (z -0.031 at y 0.20) and the front of the vertebral bodies
 * (`bodyFrontAt` -0.0428 from y 0.24 down) is 11.8 mm, less than the 17 mm round tube, so the tube is
 * moved back and flattened there (`OESOPHAGUS_FLATTEN`).
 *
 * THE NODES. Each one is the centre that keeps the front wall in front of what is behind it,
 * measured against this model's own shells: y 0.30 and 0.28 clear the trachea's back wall
 * (z -0.0068, -0.0143); y 0.254 sits behind the trachea at the carina; y 0.22 to 0.20 sit
 * between the left atrium's back (-0.029 to -0.0315) and the spine (-0.0428); y 0.18 to 0.14 are behind
 * the ventricular base (-0.023 to -0.014). THE FIRST POINT (y 0.352) AND THE LAST (the
 * gastro-oesophageal junction, [-0.012, 0.105, -0.008]) ARE THE AUTHORED ONES, unchanged: the
 * pharynx still joins the top and the stomach still starts at the bottom (gx3 may move the stomach
 * slightly; the junction point left here is (-0.012, 0.105, -0.008) in unexploded body
 * coordinates). The old organs.json points are still read by GiBolus.ts and are not mine.
 */
export const OESOPHAGUS_PATH: readonly V3[] = [
  [0.002, 0.352, -0.02],
  [0.003, 0.3, -0.0215],
  [0.003, 0.28, -0.025],
  [0.003, 0.27, -0.0268],
  [0.003, 0.254, -0.0358],
  [0.003, 0.24, -0.0345],
  [0.002, 0.22, -0.0352],
  [0.001, 0.2, -0.0368],
  [-0.001, 0.18, -0.0345],
  [-0.003, 0.16, -0.03],
  [-0.005, 0.14, -0.0265],
  [-0.008, 0.125, -0.0215],
  [-0.012, 0.105, -0.008],
];

/**
 * Front-to-back scale of the tube about its own centreline, by height: [y, zScale]. 1 where
 * there is room; down to 0.55 (a 9.5 mm front-to-back span) behind the left atrium where the
 * measured room is 11.8 mm less margins. The width grows to compensate by half the loss
 * (`xScale = 1 + 0.5 (1 - zScale)`, a DISPLAY CHOICE that stops the tube becoming a thin slit;
 * the collapsed oesophagus's area is smaller than the round tube's, as Gray's has it).
 */
export const OESOPHAGUS_FLATTEN: readonly (readonly [number, number])[] = [
  [0.28, 1],
  [0.27, 0.72],
  [0.254, 0.62],
  [0.24, 0.87],
  [0.22, 0.78],
  [0.2, 0.55],
  [0.18, 0.87],
  [0.16, 1],
];

/**
 * Where each lung's bronchus and vessels enter it, in that lung's own frame (the hilum).
 *
 * THE LEFT ONE MOVED. It sat at local x +0.047, which is world x -0.021: inside the left atrium,
 * because it was placed on the old flat mediastinal face (local x 0.042) before the heart stood where it
 * does. Gray's puts the hilum on the mediastinal surface BEHIND the cardiac impression, where the
 * pulmonary veins come from the left atrium and the bronchus enters behind them. Here the heart shell's own
 * left pulmonary-vein stubs end at world (-0.071, 0.214/0.198, -0.020/-0.024), and the left bronchus
 * ends 11 mm above and 14 mm behind them (`BRONCHUS_LEFT_END`), so the hilum is the point between
 * the two, world (-0.070, 0.216, -0.030) = local (-0.002, 0.011, -0.030), and the pocket cut at it is
 * 14 mm in radius (models.ts `lung`). The RIGHT one keeps its x and y and moves back in z from -0.004 to
 * -0.016, towards its own vein stubs (z -0.024/-0.020) and in line with the carina's new depth (the
 * right bronchus must run from the carina to it).
 */
export function lungHilum(side: -1 | 1): V3 {
  return side < 0 ? [-0.002, 0.011, -0.03] : [-0.047, 0.012, -0.016];
}

/**
 * The groove the main bronchus lies in on the lung's mediastinal face: the bronchus capsule, grown
 * by 2 mm, in the lung's frame, to be subtracted from the lung. The main bronchi run in the mediastinum
 * (Gray's), NOT through the lung: the lung's medial wall (world x -0.026 left, +0.030 right) is
 * medial of the hilum, so a bronchus drawn from the carina to a hilum 40 mm lateral of that wall
 * would otherwise lie inside the lung for its last stretch (5.2 mm of left lung inside the bronchus
 * measured). The 2 mm clearance is a display choice, like `PLEURAL_GAP_M`.
 */
export function bronchusCorridor(lung: 'lung_l' | 'lung_r'): Sdf {
  const l = organsFile.organs.find((o) => o.id === lung)!.position as unknown as V3;
  const end = lung === 'lung_l' ? BRONCHUS_LEFT_END : BRONCHUS_RIGHT_END;
  const [r0, r1] = lung === 'lung_l' ? [0.0058, 0.005] : [0.0068, 0.0058];
  const g = 0.002;
  return capsule(
    [CARINA[0] - l[0], CARINA[1] - l[1], CARINA[2] - l[2]],
    [end[0] - l[0], end[1] - l[1], end[2] - l[2]],
    r0 + g,
    r1 + g,
  );
}
