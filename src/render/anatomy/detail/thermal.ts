import * as THREE from 'three';

/**
 * A PERCEPTUAL "TEMPERATURE" RAMP: deep blue -> cyan -> green -> yellow -> orange -> red
 * -> near-white.
 *
 * Used where a 0..1 quantity is shown as a field of colour rather than a glow: the brain's
 * interior and the brain scan. The order of hues is the one a viewer already reads as
 * "cold to hot", and it ends in near-white rather than a saturated red so that the very
 * top of the range is distinguishable from the band just below it.
 *
 * The stops are authored in sRGB, because that is how a person judges a colour ramp, and
 * the blend between two stops is done in sRGB for the same reason: blending in linear
 * light makes the midpoint of blue-to-yellow a muddy bright grey that is nowhere on the
 * ramp the stops describe. The result is then converted to the renderer's linear working
 * space by `setRGB(..., SRGBColorSpace)`, which allocates nothing.
 *
 * These are presentation colours, not physiological constants: nothing here is a
 * measurement and no value of `t` corresponds to a temperature.
 */

// Each stop: position 0..1, then r, g, b in sRGB 0..1. Positions are ascending.
const STOPS: readonly (readonly [number, number, number, number])[] = [
  [0.0, 0.05, 0.10, 0.55], // deep blue
  [0.2, 0.0, 0.78, 0.88], // cyan
  [0.4, 0.2, 0.75, 0.3], // green
  [0.58, 0.95, 0.88, 0.2], // yellow
  [0.74, 0.97, 0.55, 0.12], // orange
  [0.88, 0.85, 0.12, 0.1], // red
  [1.0, 1.0, 0.95, 0.9], // near-white
];

type Stops = readonly (readonly [number, number, number, number])[];

/**
 * THE SCAN RAMP: the same hue order as the ramp above, with the stops moved to where a
 * RESTING brain actually sits. Measured at rest, the engine's activity index for the 21
 * brain regions runs from 0.15 (pineal) to 0.40 (prefrontal cortex, thalamus); the 3D
 * organ ramp spends that whole span between cyan and green, so a resting scan looked like
 * one colour. Here the resting 0.15..0.40 spans blue, cyan, green, yellow and orange (most regions
 * sit at 0.25..0.31, so that is where the stops are densest), a part lifted to about
 * 0.6 is red, and one driven to 0.9 reads red-to-white. Display constants, not physiology.
 * Kept separate from STOPS so the organ interior is untouched.
 */
export const SCAN_STOPS: Stops = [
  [0.0, 0.05, 0.08, 0.45], // dark blue
  [0.12, 0.12, 0.3, 0.95], // blue
  [0.2, 0.0, 0.8, 0.92], // cyan
  [0.25, 0.2, 0.82, 0.3], // green
  [0.33, 0.96, 0.9, 0.2], // yellow
  [0.42, 0.98, 0.55, 0.1], // orange
  [0.58, 0.88, 0.1, 0.08], // red
  [0.9, 1.0, 0.6, 0.5], // red toward white
  [1.0, 1.0, 0.97, 0.95], // near-white
];

/** Write the ramp colour for `t` (clamped to 0..1) into `out` and return it. */
export function thermalColor(t: number, out: THREE.Color, stops: Stops = STOPS): THREE.Color {
  const x = t !== t ? 0 : t < 0 ? 0 : t > 1 ? 1 : t; // NaN reads as the cold end
  let i = 1;
  while (i < stops.length - 1 && x > stops[i][0]) i++;
  const a = stops[i - 1];
  const b = stops[i];
  const f = (x - a[0]) / (b[0] - a[0]);
  return out.setRGB(
    a[1] + (b[1] - a[1]) * f,
    a[2] + (b[2] - a[2]) * f,
    a[3] + (b[3] - a[3]) * f,
    THREE.SRGBColorSpace,
  );
}
