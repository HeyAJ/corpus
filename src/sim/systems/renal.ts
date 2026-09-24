import { P } from '../core/constants';
import type { SimState } from '../core/state';
import { effect } from '../core/effects';

/**
 * RENAL SYSTEM (spec 4.5).
 *
 * The autoregulation curve is the point of this module. GFR is held flat across
 * MAP 80-180 mmHg by the myogenic response and tubuloglomerular feedback, then
 * falls off a cliff below 80. The user gives enough vasodilator, MAP drops under
 * 80, and the GFR readout collapses visibly.
 *
 * And the loop that closes it: renal drug clearance scales with live GFR, so a
 * hypotensive body clears renally-eliminated drugs more slowly and the second dose
 * hits harder. That feedback is wired here (`clearanceScale`) and consumed by
 * pharma/pk.ts. It is the most educational loop in the app, and it costs one line.
 */

export function stepRenal(s: SimState, dt: number): void {
  const r = s.renal;
  const map = s.cardio.map;

  // --- autoregulation ------------------------------------------------------
  r.autoreg = autoregulation(map);

  // Renal vascular resistance is also a drug target (dopamine at low dose, NSAIDs,
  // ACE inhibitors...), applied on top of the myogenic response.
  const rvrScale = 1 + effect(s, 'renal.vascularResistance');
  const perfusionFactor = r.autoreg / Math.max(0.2, rvrScale);

  r.rbf = P('renal.rbf_mL_per_min') * perfusionFactor * (s.cardio.co / 5.0);
  const plasmaFlow = r.rbf * (1 - s.chem.hct);
  const gfrTarget = Math.min(
    plasmaFlow * P('renal.filtrationFraction') * 1.0,
    P('renal.gfr_mL_per_min') * perfusionFactor,
  );

  // GFR follows perfusion with a short lag (afferent arteriolar tone takes seconds).
  r.gfr += ((gfrTarget - r.gfr) * dt) / 4;
  r.gfr = Math.max(0, r.gfr);

  // THE FEEDBACK LOOP. Renally-cleared drugs scale k10_renal by this.
  r.clearanceScale = r.gfr / P('renal.gfr_mL_per_min');

  // --- urine formation -----------------------------------------------------
  //
  // `renal.waterReabsorption` is the ADH/aldosterone-style set-point control that was
  // already wired here. `renal.sodiumReabsorption` is a SEPARATE bus target -
  // declared in effects.ts, written by the mineralocorticoid receptor, the
  // carbonic-anhydrase enzyme and hydrochlorothiazide's direct effect - that had no
  // consumer at all until now. That mattered most for hydrochlorothiazide: its own
  // note says it "blocks the distal convoluted tubule Na-Cl cotransporter", and that
  // is its ONLY declared mechanism. With nothing reading the target it wrote to, the
  // drug moved nothing whatsoever, at any dose.
  //
  // WHY SUMMED WITH WATER, AT THE SAME GAIN, RATHER THAN GIVEN A GAIN OF ITS OWN.
  // Sodium and water reabsorption are two independent routes to the same tubular
  // endpoint - how much of the filtrate returns to the blood rather than becoming
  // urine - which is the same reasoning cardio.ts gives for summing three
  // arrhythmia mechanisms (`arrhythmicLoad`) and neuro.ts gives for summing sedation
  // and arousal on one axis. Reusing the existing 0.008 gain instead of choosing a
  // second number keeps both targets on the one dimensionless bus scale the module
  // already assumes; inventing a smaller "sodium-only" gain would be a fitted
  // constant with nothing to fit it against.
  //
  // THE HONEST WRINKLE, LEFT VISIBLE RATHER THAN HIDDEN. Two existing writers of
  // `renal.sodiumReabsorption` - the mineralocorticoid receptor (aldosterone,
  // spironolactone) and carbonic anhydrase (acetazolamide) - ALSO carry their own,
  // separately-cited `renal.waterReabsorption` gain, added while sodiumReabsorption
  // was still dead specifically so those two mechanisms would still produce a
  // diuretic effect. Now that sodiumReabsorption has a consumer, those two
  // mechanisms are counted on BOTH targets and so contribute somewhat more urine
  // change than their water gain alone used to produce. hydrochlorothiazide is the
  // only drug in this set for which sodiumReabsorption is the SOLE path to urine
  // output, so it is also the only one whose behaviour moves from "nothing" to
  // "correct" here. The clean fix is to empty the redundant `renal.waterReabsorption`
  // entries on those two receptors in receptors.json, mirroring the nkcc2 entry's own
  // "vector deliberately empty" precedent - out of scope for this change (src/data/**
  // is not owned here) and reported instead of silently worked around.
  const waterTerm = effect(s, 'renal.waterReabsorption');
  const sodiumTerm = effect(s, 'renal.sodiumReabsorption');
  const reabsorption = P('renal.tubularReabsorptionFraction') * (1 + (waterTerm + sodiumTerm) * 0.008);
  // Floored as well as capped: a numerical guard (see DIRECT_EFFECT_CEILING's own
  // comment in engine.ts for the same idea), not a physiological claim - nothing in
  // this drug set can actually drive the sum this far negative, but urine output
  // must never exceed what was filtered.
  const urine = Math.max(0, r.gfr * (1 - Math.max(0, Math.min(0.9999, reabsorption))));
  r.urineRate = urine;

  const capacity = P('renal.bladderCapacity_mL');
  r.bladderVolume = Math.min(capacity, r.bladderVolume + (urine * dt) / 60);

  // Filtered volume leaves the circulation. At 1 mL/min this is small, but over a
  // simulated day at 300x it matters, and the homeostasis test will catch it if the
  // matching intake is missing.
  s.cardio.veins.V -= (urine * dt) / 60;

  // --- creatinine ----------------------------------------------------------
  // Production is constant; concentration is the balance against clearance. This is
  // why creatinine lags an acute GFR fall by hours, and the model reproduces that.
  const PRODUCTION_MG_PER_MIN = 1.1;
  const volumeOfDistribution_dL = 420; // 0.6 L/kg x 70 kg
  const clearance = r.gfr / 100; // dL/min
  const dCr = (PRODUCTION_MG_PER_MIN - r.creatinine * clearance) / volumeOfDistribution_dL;
  r.creatinine = Math.max(0.1, r.creatinine + (dCr * dt) / 60);

  // --- potassium and calcium: the two remaining dead renal targets ---------
  //
  // `renal.potassiumExcretion` and `renal.calciumReabsorption` were declared in
  // effects.ts and written by hydrochlorothiazide, spironolactone (via the
  // mineralocorticoid receptor) and the aldosterone hormone itself, and read by
  // nothing. hydrochlorothiazide's own note says why that mattered: "more sodium
  // reaching the collecting duct means more sodium-potassium exchange, which is why
  // thiazides cause hypokalaemia" - a mechanism with no path to `s.chem.k` at all -
  // and spironolactone's whole clinical identity, potassium-sparing to the point of
  // being potassium-DANGEROUS, had nowhere to go either.
  //
  // NEITHER ION HAS ANY OTHER OUTFLOW IN THIS MODEL. Dietary sodium, potassium,
  // calcium and iron are carried in the food data and mostly unused - only iron
  // reaches the model (docs/MODEL_LIMITATIONS.md, GI section) - and there is no
  // cellular-shift or hormonal-clearance term for either ion beyond what is added
  // here. Left as a bare filtered-load-times-effect, this would do to potassium
  // exactly what ADR-011 describes water doing before fluids.ts existed: accurately
  // and silently drain it, because something now removes it and nothing ever puts
  // it back. The fix takes the same shape as ADR-011's: the bus effect is read as a
  // DEVIATION from a baseline that an un-modelled intake is assumed to match, so a
  // resting body - bus effect exactly zero, per effects.ts's own "0 means no effect"
  // convention - sees no flux at all, and only a drug or hormone that pushes away
  // from zero moves the level. tests/sim/homeostasis.test.ts already asserts a
  // resting body's serum potassium does not drift across 24 simulated hours with no
  // drug; this construction satisfies that EXACTLY rather than approximately, because
  // the flux below is `filteredLoad * fraction * effect`, which is identically zero
  // whenever `effect` is zero, regardless of what `filteredLoad` or `fraction` are.
  //
  // THE TWO FRACTIONS ARE TEXTBOOK ORDER-OF-MAGNITUDE FIGURES, NOT DRUG DATA. GH14
  // teaches that the great majority of filtered potassium (roughly 85-90%) and
  // nearly all filtered calcium (roughly 98-99%) is reabsorbed at rest, upstream of
  // the sites aldosterone, thiazides and potassium-sparing diuretics adjust. What
  // these two constants set is how hard a given bus value bites, not which way it
  // bites - exactly like the 0.008 water/sodium gain above, and exactly the kind of
  // "engineering choice, not a measurement" docs/MODEL_LIMITATIONS.md already names
  // for the gastrointestinal glycaemic-index scale factor. No entry in
  // physiology.json carries a more precise figure for either fraction, and Hard
  // Rule 1 is to use an existing citation or a dimensionless gain rather than invent
  // one - this is the gain.
  const K_FILTERED_EXCRETED_FRACTION = 0.12;
  const CA_FILTERED_EXCRETED_FRACTION = 0.02;

  const filteredK_mEq_per_min = (r.gfr / 1000) * s.chem.k;
  const potassiumExcretionEffect = effect(s, 'renal.potassiumExcretion');
  // Same extracellular-fluid figure pharma/dosing.ts uses to convert a potassium
  // payload's mEq into a concentration change, so an IV KCl push and a diuretic's
  // renal loss are scaled against the same reference volume rather than two
  // unrelated ones.
  const kEcfVolume_L = s.body.mass_kg * 0.2;
  s.chem.k -=
    ((filteredK_mEq_per_min * K_FILTERED_EXCRETED_FRACTION * potassiumExcretionEffect) / kEcfVolume_L) * (dt / 60);
  // A concentration cannot go negative. A numerical floor, not a clinical one - see
  // the DIRECT_EFFECT_CEILING comment in engine.ts for the same reasoning.
  s.chem.k = Math.max(0.5, s.chem.k);

  const filteredCa_mmol_per_min = (r.gfr / 1000) * s.chem.ca;
  const calciumReabsorptionEffect = effect(s, 'renal.calciumReabsorption');
  const plasmaVolume_L = (s.cardio.bloodVolume * (1 - s.chem.hct)) / 1000;
  // Same apparent volume pharma/dosing.ts uses for a calcium payload: ionised
  // calcium buffers against bone and protein-bound calcium fast enough that its
  // effective volume of distribution is several times plasma volume alone.
  const caVolumeOfDistribution_L = Math.max(1, plasmaVolume_L * 3);
  s.chem.ca +=
    ((filteredCa_mmol_per_min * CA_FILTERED_EXCRETED_FRACTION * calciumReabsorptionEffect) / caVolumeOfDistribution_L) *
    (dt / 60);
  s.chem.ca = Math.max(0.1, s.chem.ca);
}

/**
 * Myogenic + tubuloglomerular autoregulation. Returns a fraction of baseline GFR.
 *
 * Flat (exactly 1.0) across the plateau; a cubic pressure-passive fall below it,
 * multiplied by a filtration cut-off because filtration ceases entirely once
 * glomerular capillary pressure can no longer overcome plasma oncotic pressure plus
 * Bowman's capsule pressure — around MAP 45. The function is continuous at both
 * plateau edges; `tests/sim/renal.test.ts` asserts that.
 */
export function autoregulation(map: number): number {
  const lo = P('renal.autoregLow_mmHg');
  const hi = P('renal.autoregHigh_mmHg');
  const k = P('renal.autoregSharpness');

  if (map >= lo && map <= hi) return 1;

  if (map < lo) {
    const x = Math.max(0, map / lo);
    const passive = x * x * x;
    const FILTRATION_CUTOFF_MMHG = 45;
    const cutoff = 1 / (1 + Math.exp(-2 * k * (map - FILTRATION_CUTOFF_MMHG)));
    return Math.max(0, passive * cutoff);
  }

  // Above the plateau the myogenic response is exhausted; GFR creeps up a little
  // (this is the pressure-natriuresis limb), capped.
  return 1 + Math.min(0.15, (map - hi) * 0.002);
}
