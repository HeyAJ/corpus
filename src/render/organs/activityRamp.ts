/**
 * THE ACTIVITY RAMP: ONE SEQUENTIAL HUE FOR "HOW MUCH DID THIS ORGAN ANSWER".
 *
 * Pure TypeScript with no three.js import, so the legend in `src/ui` can import the same
 * stops the renderer paints with and the two can never drift apart.
 *
 * Colour rules, from the project's data-visualisation method: one hue running from light
 * to dark, lightness strictly monotonic, never a rainbow. The hue is amber/orange on
 * purpose. RED is reserved for alarms and arterial blood, and BLUE reads as venous, so an
 * activity colour in either family would be misread as a clinical statement. Amber is the
 * one warm hue left that carries neither meaning.
 *
 * Every stop is a DISPLAY CHOICE, not a physiological number. `t` is the organ's
 * engagement above its own rest (0 at rest, 1 at the engine's ceiling), the same 0..1
 * index `snapshot.anatomy.organs` carries.
 *
 * The stops are authored as sRGB hex. The renderer multiplies through Beer-Lambert
 * absorption, which darkens whatever it is given, so the colour that reaches the screen is
 * not this colour; it is a monotonic function of it (tests/render/activity.test.ts and the
 * rendered luminance probe check that the SCREEN result also falls strictly with t).
 */
export const ACTIVITY_RAMP: readonly { t: number; hex: string }[] = [
  { t: 0.0, hex: '#f6ece0' },
  { t: 0.2, hex: '#f4d8b0' },
  { t: 0.4, hex: '#efbd78' },
  { t: 0.6, hex: '#e29a3a' },
  { t: 0.8, hex: '#c0731a' },
  { t: 1.0, hex: '#8a4a0a' },
];

interface Stop {
  t: number;
  r: number;
  g: number;
  b: number;
}

/** Parsed once at module load, so `activityColour` allocates nothing per call. */
const STOPS: readonly Stop[] = ACTIVITY_RAMP.map(({ t, hex }) => ({
  t,
  r: parseInt(hex.slice(1, 3), 16) / 255,
  g: parseInt(hex.slice(3, 5), 16) / 255,
  b: parseInt(hex.slice(5, 7), 16) / 255,
}));

/**
 * Fill `out` with the sRGB (0..1, NOT linear) colour of the ramp at `t`, interpolated
 * piecewise-linearly between stops. `t` is clamped; NaN reads as 0. Returns `out`.
 */
export function activityColour(t: number, out: { r: number; g: number; b: number }): { r: number; g: number; b: number } {
  const x = Number.isFinite(t) ? Math.max(0, Math.min(1, t)) : 0;
  let i = 1;
  while (i < STOPS.length - 1 && x > STOPS[i].t) i++;
  const a = STOPS[i - 1];
  const b = STOPS[i];
  const f = (x - a.t) / (b.t - a.t);
  out.r = a.r + (b.r - a.r) * f;
  out.g = a.g + (b.g - a.g) * f;
  out.b = a.b + (b.b - a.b) * f;
  return out;
}
