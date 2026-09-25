import type { Drug } from '../../data/pharma-types';
import type { DrugPkState, SimState } from '../core/state';
import type { Route } from '../../bridge/types';
import { addVolume } from '../systems/cardio';
import { swallow } from '../systems/gi';
import { depotParamsFor, routeSpec } from './routes';
import { P } from '../core/constants';
import { addBicarbonate } from '../systems/acidbase';

/**
 * ROUTES OF ADMINISTRATION (spec 5.1).
 *
 * Twelve of them now, in four families, and the family is what decides the code path:
 *
 *   intravascular  IV_PUSH, IV_DRIP, INTRAOSSEOUS
 *                  straight into the central compartment. IO is IV with a transit
 *                  delay, because a marrow cavity is a vein that cannot collapse.
 *
 *   depot          IM, SUBCUTANEOUS, INTRANASAL, SUBLINGUAL, RECTAL, TRANSDERMAL
 *                  a parcel that releases first-order at its own rate. Each parcel
 *                  keeps its own ka, lag and bioavailability, so a patch applied
 *                  during an intramuscular dose does not inherit the injection's
 *                  kinetics.
 *
 *   pulmonary      INHALED, NEBULISED
 *                  alveolar surface is enormous and one cell thick, so the only
 *                  parameter that matters is what fraction got there. A nebuliser
 *                  delivers the same fraction over ten minutes instead of one breath.
 *
 *   gut            ORAL
 *                  not a depot at all: a digesta payload subject to the whole
 *                  gastrointestinal model, then first-pass extraction.
 *
 * Route parameters live in src/data/routes.json with citations; see pharma/routes.ts.
 *
 * ON DOSE AMOUNTS. `administer` takes a number of milligrams and integrates it. It
 * does not decide whether that number is a sensible one — that judgement belongs to
 * the caller, and the engine's ADMINISTER handler is where the bounds are enforced.
 */

export function getOrCreatePkState(s: SimState, drugId: string): DrugPkState {
  let st = s.drugs.find((d) => d.drugId === drugId);
  if (!st) {
    st = {
      drugId,
      a1: 0,
      a2: 0,
      a3: 0,
      gut: 0,
      depots: [],
      pulmonaryRate: 0,
      pulmonaryRemaining: 0,
      lagRemaining: 0,
      infusionRate: 0,
      payloadPending: 0,
      payloadRate: 0,
      cumulativeDose: 0,
      cp: 0,
      freeNM: null,
    };
    s.drugs.push(st);
  }
  return st;
}

export interface AdministerResult {
  ok: boolean;
  reason?: string;
}

export function administer(
  s: SimState,
  drug: Drug,
  route: Route,
  dose_mg: number,
  durationMin: number | undefined,
): AdministerResult {
  if (!drug.routes.includes(route)) {
    return { ok: false, reason: `${drug.displayName} has no ${route} route` };
  }
  if (routeSpec(route).requiresIvAccess && !s.procedures.ivAccess) {
    return { ok: false, reason: 'No IV access' };
  }

  const st = getOrCreatePkState(s, drug.id);

  const spec = routeSpec(route);

  // Electrolyte / fluid payloads act on the blood compartment directly, not through a
  // receptor. Normal saline has no Ki because it does not bind anything.
  //
  // SCHEDULED, NOT APPLIED. This used to run before the route was consulted and hand
  // over the whole dose in a single tick. The consequences were visible and wrong: a
  // litre of saline declared "over 30 minutes" landed in 10 ms, taking systolic from
  // 120 to 184 and pulse pressure from 46 to 132, and the baroreflex answered that
  // near-instant step by dropping heart rate to 28 bpm. Oral potassium and oral calcium
  // reached serum just as fast as an intravenous push, with no gut in between.
  //
  // The rates below are the route's own, not new numbers: an infusion uses the duration
  // its preset declares, and an enteral dose empties at the cited gastric half-time the
  // GI model already uses. A push really is a bolus, so that one still applies at once.
  if (drug.payload) {
    if (spec.kind === 'intravascular' && route !== 'IV_DRIP') {
      applyPayload(s, drug, dose_mg);
    } else if (route === 'IV_DRIP') {
      const mins = durationMin && durationMin > 0 ? durationMin : 60;
      st.payloadPending += dose_mg;
      st.payloadRate += dose_mg / mins;
    } else {
      st.payloadPending += dose_mg;
      st.payloadRate = 0; // first-order, at the gastric emptying rate
    }
  }

  switch (spec.kind) {
    case 'intravascular': {
      if (route === 'IV_DRIP') {
        const mins = durationMin && durationMin > 0 ? durationMin : 60;
        st.infusionRate += dose_mg / mins;
        break;
      }
      if (spec.lagMin > 0) {
        // Intraosseous: the same destination, reached a moment later. Modelled as a
        // depot with a lag and an effectively instantaneous release, so the delay is
        // visible on the plasma trace without a second code path.
        st.depots.push({
          route,
          amount: dose_mg,
          ka_min: 10,
          lagRemaining: spec.lagMin,
          bioavailability: 1,
        });
        break;
      }
      st.a1 += dose_mg;
      break;
    }

    case 'depot': {
      const params = depotParamsFor(drug, route);
      if (params === null) {
        // No measured absorption constant to scale, so there is no honest rate to
        // release this at. Refuse rather than invent one (spec 0.4).
        return {
          ok: false,
          reason: `${drug.displayName} has no measured absorption rate, so the ${spec.label.toLowerCase()} route cannot be simulated`,
        };
      }
      st.depots.push({
        route,
        amount: dose_mg,
        ka_min: params.ka_min,
        lagRemaining: params.lagMin,
        bioavailability: params.bioavailability,
      });
      break;
    }

    case 'pulmonary': {
      const f = drug.routePk?.[route]?.bioavailability ?? drug.pk.bioavailability ?? 1;
      if (spec.durationMin && spec.durationMin > 0) {
        // Nebulised: the same pulmonary uptake, spread over the run of the device.
        // Kept separate from `infusionRate`, which belongs to IV_DRIP and runs until
        // it is cancelled. A nebuliser stops itself when the chamber empties, and
        // conflating the two would make cancelling one silently cancel the other.
        st.pulmonaryRate += (dose_mg * f) / spec.durationMin;
        st.pulmonaryRemaining = Math.max(st.pulmonaryRemaining, spec.durationMin);
      } else {
        st.a1 += dose_mg * f;
      }
      break;
    }

    case 'gut': {
      // The dose rides on a small volume of water as a digesta payload, so it obeys
      // gastric emptying like anything else the body swallowed. A fatty meal already
      // in the stomach will delay it, and that shows up in the plasma curve.
      swallow(s, {
        volume_mL: 30,
        carb_g: 0,
        fat_g: 0,
        protein_g: 0,
        solidFraction: 0.05,
        label: drug.displayName,
        drugPayload: { [drug.id]: dose_mg },
      });
      break;
    }
  }

  st.cumulativeDose += dose_mg;
  return { ok: true };
}

/**
 * Hand over whatever of the payload is due this tick.
 *
 * Called from the engine rather than from `stepPk`, because `stepPk` returns early for
 * any drug with no central volume - which is every payload drug there is. That early
 * return is also why the infusion bookkeeping was computed and then never drained.
 */
export function stepPayload(s: SimState, drug: Drug, st: DrugPkState, dt: number): void {
  if (!drug.payload || st.payloadPending <= 0) return;
  const dtMin = dt / 60;

  let deliver: number;
  if (st.payloadRate > 0) {
    deliver = Math.min(st.payloadPending, st.payloadRate * dtMin);
  } else {
    // First-order, at the cited gastric emptying half-time. The tail is closed out once
    // it falls below a thousandth of a unit so the compartment actually empties rather
    // than approaching zero forever.
    const k = Math.LN2 / P('gi.gastricEmptyingHalfTime_min');
    deliver = st.payloadPending * (1 - Math.exp(-k * dtMin));
    if (st.payloadPending - deliver < 1e-3) deliver = st.payloadPending;
  }

  st.payloadPending -= deliver;
  if (st.payloadPending <= 0) {
    st.payloadPending = 0;
    st.payloadRate = 0;
  }
  applyPayload(s, drug, deliver);
}

export function stopInfusion(s: SimState, drugId: string): void {
  const st = s.drugs.find((d) => d.drugId === drugId);
  if (st) st.infusionRate = 0;
}

/**
 * Electrolyte and fluid payloads. Concentrations are recomputed from mass over
 * plasma volume, so giving 10 mEq of potassium to a hypovolaemic body raises the
 * serum level more than giving it to a euvolaemic one. That is correct and it is
 * the reason potassium is dangerous.
 */
function applyPayload(s: SimState, drug: Drug, dose_mg: number): void {
  const p = drug.payload!;
  // Presets are expressed in the drug's own unit; `dose_mg` carries the numeric
  // amount and the payload describes what one unit of it delivers.
  const scale = dose_mg;

  if (p.volume_mL) addVolume(s.cardio, p.volume_mL * scale);

  const plasmaVolume_L = (s.cardio.bloodVolume * (1 - s.chem.hct)) / 1000;
  const ecfVolume_L = s.body.mass_kg * 0.2;

  if (p.na_mEq) s.chem.na += (p.na_mEq * scale) / ecfVolume_L;
  if (p.k_mEq) s.chem.k += (p.k_mEq * scale) / ecfVolume_L;
  if (p.cl_mEq) s.chem.cl += (p.cl_mEq * scale) / ecfVolume_L;
  if (p.ca_mmol) s.chem.ca += (p.ca_mmol * scale) / Math.max(1, plasmaVolume_L * 3);

  // Dextrose lands in the glucose distribution volume the Bergman model uses, as a
  // concentration rise in mg/dL: grams x 1000 mg/g over the distribution volume in dL.
  // That is why 25 g of 50% dextrose lifts a hypoglycaemic adult by roughly 40 mg/dL,
  // and why the insulin response then follows on its own.
  if (p.glucose_g) s.metabolic.G += (p.glucose_g * scale * 1000) / P('metabolic.glucoseDistributionVolume_dL');

  // Sodium bicarbonate raises the metabolic bicarbonate pool (and the sodium that came
  // with it). The acid-base system turns that into a pH change through Henderson-
  // Hasselbalch, and the chemoreflex answers - which is why a bolus given to a patient
  // who cannot increase their ventilation can paradoxically worsen the intracellular
  // acidosis, a lesson the coupled model can show.
  if (p.hco3_mEq) addBicarbonate(s, p.hco3_mEq * scale);

  // Iron replaces a deficit over WEEKS - it is incorporated into new red cells on the
  // marrow's timescale, not the session's - so there is deliberately no acute effect to
  // apply here. Recording the mass keeps the dose auditable and lets a future
  // erythropoiesis model draw on it; applying an acute haematocrit rise would be a lie.
  void p.iron_mg;
}

/** Dilution of every electrolyte when circulating volume changes. */
export function rebalanceElectrolytes(s: SimState, previousVolume: number): void {
  const now = s.cardio.bloodVolume;
  // The ISOTONIC part of this tick's volume change (whole blood, saline) carried its
  // solutes with it and must not concentrate anything. Only the free-water part does.
  const isotonic = s.cardio.isotonicDelta_mL;
  s.cardio.isotonicDelta_mL = 0;
  const effectiveNow = now - isotonic;
  if (previousVolume <= 0 || effectiveNow <= 0) return;
  const ratio = previousVolume / effectiveNow;
  if (!Number.isFinite(ratio) || Math.abs(ratio - 1) < 1e-9) return;
  // Only the intravascular share dilutes immediately; the ECF equilibrates over
  // minutes, so the effective ratio is damped. Hct and albumin are intravascular, so
  // they take the full ratio - which is why transcapillary refill after a bleed lowers
  // them (haemodilution) while the bleed itself, being isotonic, does not.
  const damped = 1 + (ratio - 1) * 0.35;
  s.chem.na *= damped;
  s.chem.k *= damped;
  s.chem.cl *= damped;
  s.chem.ca *= damped;
  s.chem.hct *= ratio;
  s.chem.albumin *= ratio;
}
