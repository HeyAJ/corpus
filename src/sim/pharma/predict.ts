import type { Drug } from '../../data/pharma-types';
import type { Route } from '../../bridge/types';
import { depotParamsFor, routeSpec } from './routes';

/**
 * FORWARD PREDICTION OF A PLASMA CURVE.
 *
 * What this is for: the dose control draws the curve a dose would produce, so moving
 * the slider shows the consequence rather than only the number. A dose of "3.2x the
 * reference" means nothing on its own; a curve that is visibly three times taller and
 * lasts an hour longer means something immediately.
 *
 * WHY THIS LIVES IN LAYER A rather than in the component that draws it. A preview
 * computed by different code from the simulation is a second implementation of the
 * same model, and second implementations drift — silently, and in the direction that
 * makes the interface look right. Sharing the module means the preview cannot promise
 * something the engine will not deliver.
 *
 * WHAT IT DELIBERATELY IGNORES, and why that is safe:
 *
 *   - Renal and hepatic clearance scaling. The engine multiplies elimination by
 *     `renal.clearanceScale` and by cardiac output over five litres a minute; at rest
 *     both are 1. A preview drawn for a shocked or anuric body would be wrong, so the
 *     control labels the curve as the resting case rather than as a promise.
 *   - Everything already in the body. The curve is for THIS dose alone, added to
 *     whatever is already there. That is the question the control is asking.
 *   - The gastrointestinal model. An oral dose really does depend on what is in the
 *     stomach, and the preview cannot know; see `oralIsApproximate`.
 */

export interface PredictedPoint {
  /** Minutes after administration. */
  t: number;
  /** Plasma concentration, mg/L (== ug/mL). */
  cp: number;
}

export interface Prediction {
  points: PredictedPoint[];
  peak: number;
  tmax_min: number;
  /** True when the route's curve depends on state the preview cannot see. */
  approximate: boolean;
  /** Null when this drug cannot be simulated, or cannot take this route. */
  reason: string | null;
}

const EMPTY: Prediction = { points: [], peak: 0, tmax_min: 0, approximate: false, reason: null };

/**
 * Integrate the same three-compartment system the engine integrates, with the same
 * depot handling, at a coarser step. `horizonMin` is the window to draw.
 */
export function predict(
  drug: Drug,
  route: Route,
  dose_mg: number,
  horizonMin: number,
  /** Infusion run time, minutes. Ignored by every route that is not an infusion. */
  durationMin?: number,
  samples = 160,
): Prediction {
  const pk = drug.pk;
  const V1 = pk.V1_L;
  if (V1 === null || V1 <= 0) {
    return { ...EMPTY, reason: 'No sourced central volume, so this drug has no plasma curve to predict.' };
  }

  const spec = routeSpec(route);
  const k10 = pk.k10_min ?? 0;
  const k12 = pk.k12_min ?? 0;
  const k21 = pk.k21_min ?? 0;
  const k13 = pk.k13_min ?? 0;
  const k31 = pk.k31_min ?? 0;

  let a1 = 0;
  let a2 = 0;
  let a3 = 0;
  let depot = 0;
  let depotKa = 0;
  let lag = 0;
  let depotF = 1;
  let infusionRate = 0;
  let infusionRemaining = 0;
  let approximate = false;

  switch (spec.kind) {
    case 'intravascular':
      if (route === 'IV_DRIP') {
        // The run time the control is actually going to send. It has to be this and
        // not a fixed fraction of the window: the whole reason the duration field
        // exists is that the same total dose over ten minutes and over four hours are
        // different drugs, and a preview that drew them identically would say the
        // opposite of what the field is for.
        const mins = durationMin && durationMin > 0 ? durationMin : 60;
        infusionRate = dose_mg / mins;
        infusionRemaining = mins;
      } else if (spec.lagMin > 0) {
        depot = dose_mg;
        depotKa = 10;
        lag = spec.lagMin;
      } else {
        a1 = dose_mg;
      }
      break;

    case 'depot': {
      const params = depotParamsFor(drug, route);
      if (params === null) {
        return {
          ...EMPTY,
          reason: `${drug.displayName} has no measured absorption rate, so this route cannot be simulated.`,
        };
      }
      depot = dose_mg;
      depotKa = params.ka_min;
      lag = params.lagMin;
      depotF = params.bioavailability;
      break;
    }

    case 'pulmonary': {
      const f = drug.routePk?.[route]?.bioavailability ?? pk.bioavailability ?? 1;
      if (spec.durationMin && spec.durationMin > 0) {
        infusionRate = (dose_mg * f) / spec.durationMin;
        infusionRemaining = spec.durationMin;
      } else {
        a1 = dose_mg * f;
      }
      break;
    }

    case 'gut': {
      // The gut model is a twelve-segment transit with gastric emptying that depends
      // on what else is in the stomach. The preview stands in a single first-order
      // absorption for it and SAYS SO, rather than drawing a confident wrong curve.
      approximate = true;
      depot = dose_mg;
      depotKa = 0.03;
      lag = 10;
      depotF = pk.bioavailability ?? (1 - (pk.hepaticExtraction ?? 0));
      break;
    }
  }

  const dt = Math.max(0.005, horizonMin / 20000);
  const stride = Math.max(1, Math.round(horizonMin / dt / samples));

  const points: PredictedPoint[] = [];
  let peak = 0;
  let tmax = 0;

  const steps = Math.round(horizonMin / dt);
  for (let i = 0; i <= steps; i++) {
    const t = i * dt;

    let input = 0;
    if (infusionRemaining > 0) {
      const active = Math.min(dt, infusionRemaining);
      input += infusionRate * active;
      infusionRemaining -= active;
    }
    if (depot > 0) {
      if (lag > 0) {
        lag = Math.max(0, lag - dt);
      } else {
        const released = depot * (1 - Math.exp(-depotKa * dt));
        depot -= released;
        input += released * depotF;
      }
    }

    const da1 = -k10 * a1 - k12 * a1 - k13 * a1 + k21 * a2 + k31 * a3;
    const da2 = k12 * a1 - k21 * a2;
    const da3 = k13 * a1 - k31 * a3;
    a1 += da1 * dt + input;
    a2 += da2 * dt;
    a3 += da3 * dt;

    const cp = a1 / V1;
    if (cp > peak) {
      peak = cp;
      tmax = t;
    }
    if (i % stride === 0) points.push({ t, cp });
  }

  return { points, peak, tmax_min: tmax, approximate, reason: null };
}

/**
 * A sensible window to draw. Long enough to show the peak and a good share of the
 * decline, short enough that the interesting part is not squeezed into one pixel.
 */
export function horizonFor(drug: Drug, route: Route, durationMin?: number): number {
  const spec = routeSpec(route);
  if (spec.kind === 'depot' && route === 'TRANSDERMAL') return 72 * 60;

  const k10 = drug.pk.k10_min ?? 0.1;
  const terminal = k10 > 0 ? Math.LN2 / k10 : 60;

  const params = spec.kind === 'depot' ? depotParamsFor(drug, route) : null;
  const absorption = params && params.ka_min > 0 ? Math.LN2 / params.ka_min : 0;
  const lag = params?.lagMin ?? spec.lagMin;

  // A route that delivers over time has not finished at its own duration, so the
  // window has to clear it. Without this the nebuliser's curve was still climbing at
  // the right-hand edge, which reads as "and then it keeps going forever".
  const delivery = route === 'IV_DRIP'
    ? (durationMin && durationMin > 0 ? durationMin : 60)
    : (spec.durationMin ?? 0);

  // Four disposition half-lives past the end of input shows the shape without wasting
  // the axis on a flat tail.
  return Math.max(10, Math.min(72 * 60, lag + delivery + absorption * 3 + terminal * 4));
}
