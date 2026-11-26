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
 * now lives here, in a module that imports nothing, so models.ts and the skeleton files can
 * both depend on it and neither on the other.
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
