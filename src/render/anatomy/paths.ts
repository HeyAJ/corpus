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

/** Spinal cord centreline, unexploded body coordinates, foramen magnum to the sacrum. */
export const SPINAL_CORD_PATH: [number, number, number][] = [
  [0, 0.39, -0.026],
  [0, 0.36, -0.03],
  [0, 0.33, -0.034],
  [0, 0.29, -0.05],
  [0, 0.22, -0.078],
  [0, 0.15, -0.08],
  [0, 0.09, -0.07],
  [0, 0.045, -0.062],
  [0, -0.03, -0.066],
  [0, -0.1, -0.078],
];
