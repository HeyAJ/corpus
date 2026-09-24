import type { Drug } from '../../data/pharma-types';
import type { DrugPkState, SimState } from '../core/state';

/**
 * PHARMACOKINETICS (spec 5.2).
 *
 *   dA1/dt = -(k10 + k12 + k13)*A1 + k21*A2 + k31*A3 + input(t)
 *   dA2/dt =  k12*A1 - k21*A2
 *   dA3/dt =  k13*A1 - k31*A3
 *   Cp     =  A1 / V1
 *
 * Integrated as ODEs, deliberately NOT as a closed-form bi-exponential. Closed form
 * is exact for a single bolus into an empty body and wrong for everything else: a
 * second dose, a running infusion, or a time-varying clearance all break it. Since
 * clearance here IS time-varying — renal elimination scales with live GFR — the
 * closed form was never an option.
 *
 * THE FEEDBACK LOOP (spec 4.5): k10_renal is multiplied by `renal.clearanceScale`
 * every tick. A hypotensive body filters less, clears less, and the second dose of
 * a renally-eliminated drug therefore hits harder and lasts longer.
 */

/** mg/L (== ug/mL) to nM, given molecular weight in g/mol. */
export function mgPerL_to_nM(mgPerL: number, mw: number): number {
  return (mgPerL * 1e6) / mw;
}

export function nM_to_mgPerL(nM: number, mw: number): number {
  return (nM * mw) / 1e6;
}

/**
 * Advance one drug's PK by `dt` seconds.
 * `gutInput_mg` is what systems/gi.ts absorbed this tick for this drug.
 */
export function stepPk(
  s: SimState,
  st: DrugPkState,
  drug: Drug,
  dt: number,
  gutInput_mg: number,
): void {
  const dtMin = dt / 60;
  const pk = drug.pk;

  const V1 = pk.V1_L;
  if (V1 === null || V1 <= 0) {
    // No sourced central volume: the drug cannot be simulated. Everything it was
    // given stays at zero and the UI renders an em-dash (spec 0.4, 0.6).
    st.cp = 0;
    st.freeNM = null;
    return;
  }

  const k10 = pk.k10_min ?? 0;
  const k12 = pk.k12_min ?? 0;
  const k21 = pk.k21_min ?? 0;
  const k13 = pk.k13_min ?? 0;
  const k31 = pk.k31_min ?? 0;

  // --- input ---------------------------------------------------------------
  let input = st.infusionRate * dtMin;

  // Oral: the gut hands over absorbed mass, then first-pass extraction removes a
  // share of it before it ever reaches the systemic circulation.
  if (gutInput_mg > 0) {
    const eh = pk.hepaticExtraction ?? 0;
    const f = pk.bioavailability;
    // If bioavailability is measured, it already includes first-pass; do not apply
    // the extraction ratio twice.
    const survived = f !== null ? gutInput_mg * f : gutInput_mg * (1 - eh);
    input += survived;
  }

  // Nebulised: zero-order pulmonary input for as long as the chamber has something
  // in it. Unlike an infusion it ends by itself.
  if (st.pulmonaryRemaining > 0) {
    const active = Math.min(dtMin, st.pulmonaryRemaining);
    input += st.pulmonaryRate * active;
    st.pulmonaryRemaining -= active;
    if (st.pulmonaryRemaining <= 0) {
      st.pulmonaryRemaining = 0;
      st.pulmonaryRate = 0;
    }
  }

  // EXTRAVASCULAR DEPOTS. Each parcel releases first-order at ITS OWN rate, because
  // the rate belongs to the route rather than to the drug: a fentanyl patch and a
  // fentanyl injection differ by three orders of magnitude in ka, and a single shared
  // depot would release the patch at the injection's rate.
  //
  // The lag is per-parcel too. A transdermal dose spends twelve hours getting through
  // the stratum corneum before it releases anything at all, and that lag is the whole
  // reason a patch is dangerous: the decision to apply one is separated from its
  // consequence by half a day.
  if (st.depots.length > 0) {
    for (const d of st.depots) {
      if (d.lagRemaining > 0) {
        d.lagRemaining = Math.max(0, d.lagRemaining - dtMin);
        continue;
      }
      const released = d.amount * (1 - Math.exp(-d.ka_min * dtMin));
      d.amount -= released;
      input += released * d.bioavailability;
    }
    // Drop spent parcels so the list cannot grow without bound over a long session.
    // The threshold is in micrograms: below it a parcel cannot move any readout.
    if (st.depots.some((d) => d.amount < 1e-6 && d.lagRemaining <= 0)) {
      st.depots = st.depots.filter((d) => d.amount >= 1e-6 || d.lagRemaining > 0);
    }
  }

  // --- elimination ---------------------------------------------------------
  const renalFraction = pk.renalFraction ?? 0;
  const renalScale = s.renal.clearanceScale;
  // Hepatic clearance tracks hepatic blood flow, which tracks cardiac output for a
  // high-extraction drug. Modelled as a proportional scaling, floored so a low-output
  // state does not abolish metabolism entirely.
  const hepaticScale = Math.max(0.15, Math.min(1.6, s.cardio.co / 5.0));

  const k10eff = k10 * (renalFraction * renalScale + (1 - renalFraction) * hepaticScale);

  // Saturable (Michaelis-Menten) elimination replaces the first-order term when the
  // drug declares it: ethanol and phenytoin are zero-order at therapeutic levels.
  let mmElimination = 0;
  if (pk.vmax_mg_per_min !== null && pk.km_mg_per_L !== null) {
    const c = st.a1 / V1;
    mmElimination = (pk.vmax_mg_per_min * c) / (pk.km_mg_per_L + c);
  }

  // --- integrate -----------------------------------------------------------
  const a1 = st.a1;
  const a2 = st.a2;
  const a3 = st.a3;

  const firstOrderOut = pk.vmax_mg_per_min !== null ? 0 : k10eff * a1;

  const da1 = -(firstOrderOut) - k12 * a1 - k13 * a1 + k21 * a2 + k31 * a3 - mmElimination;
  const da2 = k12 * a1 - k21 * a2;
  const da3 = k13 * a1 - k31 * a3;

  st.a1 = Math.max(0, a1 + da1 * dtMin + input);
  st.a2 = Math.max(0, a2 + da2 * dtMin);
  st.a3 = Math.max(0, a3 + da3 * dtMin);

  // --- concentrations ------------------------------------------------------
  st.cp = st.a1 / V1;

  const bound = pk.proteinBound;
  const mw = pk.MW_gmol;
  if (mw === null || mw <= 0) {
    st.freeNM = null;
  } else {
    const freeFraction = bound === null ? 1 : 1 - bound;
    st.freeNM = mgPerL_to_nM(st.cp * freeFraction, mw);
  }
}

/**
 * Terminal-phase half-life, minutes. Used by the golden PK tests.
 *
 * For a mammillary model the disposition exponents are the eigenvalues of the rate
 * matrix, and the terminal slope is the smallest of them. Solving only the
 * two-compartment quadratic and ignoring a third compartment understates the
 * terminal half-life badly: it gave fentanyl 53 minutes against a published 3-8
 * hours, because the slow peripheral compartment is exactly what produces the long
 * tail. The eigenvalues are found by bisection on the characteristic polynomial,
 * which needs no matrix library and is exact to the tolerance asked for.
 */
export function terminalHalfLife_min(drug: Drug): number | null {
  const { k10_min, k12_min, k21_min, k13_min, k31_min } = drug.pk;
  if (k10_min === null || k10_min <= 0) return null;

  const k10 = k10_min;
  const k12 = k12_min ?? 0;
  const k21 = k21_min ?? 0;
  const k13 = k13_min ?? 0;
  const k31 = k31_min ?? 0;

  if (k12 === 0 && k13 === 0) return Math.LN2 / k10;

  if (k13 === 0 || k31 === 0) {
    // Two compartments: beta is the smaller root of the quadratic.
    const a = k10 + k12 + k21;
    const disc = Math.sqrt(Math.max(0, a * a - 4 * k10 * k21));
    const beta = (a - disc) / 2;
    return beta > 0 ? Math.LN2 / beta : null;
  }

  // Three compartments. The exponents are the roots of
  //   l^3 + a2 l^2 + a1 l + a0 = 0
  // with the standard mammillary coefficients.
  const a2 = k10 + k12 + k13 + k21 + k31;
  const a1 = k10 * k21 + k10 * k31 + k21 * k31 + k12 * k31 + k13 * k21;
  const a0 = k10 * k21 * k31;

  const f = (l: number) => l * l * l - a2 * l * l + a1 * l - a0;

  // All three roots are real and positive for a mammillary model. The smallest lies
  // between 0 and the smallest of the individual rate constants.
  let lo = 0;
  let hi = Math.min(k10, k21, k31);
  if (f(lo) * f(hi) > 0) hi = a2; // widen if the bracket is wrong
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (f(lo) * f(mid) <= 0) hi = mid;
    else lo = mid;
  }
  const beta = (lo + hi) / 2;
  return beta > 0 ? Math.LN2 / beta : null;
}
