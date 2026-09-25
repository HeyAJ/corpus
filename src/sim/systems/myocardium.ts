import { P } from '../core/constants';
import type { SimState } from '../core/state';
import type { Rng } from '../core/rng';
import { REFERENCE_CAO2 } from './respiratory';

/**
 * THE HEART'S OWN OXYGEN SUPPLY: WHERE THE LUNGS AND THE HEART MEET.
 *
 * THE BUG THIS EXISTS FOR. Nothing in the cardiac model read oxygen. A body could stop
 * breathing, desaturate to twenty per cent, and keep a normal sinus rhythm at a normal
 * pressure for as long as anyone watched. The reverse coupling - an arrested heart
 * stopping the breathing - had been fixed (ADR-021/022), so the model had become
 * lopsided: the heart could kill the lungs but the lungs could not kill the heart.
 * That asymmetry is what was reported as "sometimes the lungs stop and the heart keeps
 * working".
 *
 * THE MODEL IS A SUPPLY-DEMAND RATIO, built only from textbook quantities:
 *
 *   supply = (CaO2 / CaO2_normal) x reserve x (CPP / CPP_normal) x max extraction
 *   demand = resting extraction x [ basal + (1 - basal) x (HR x SBP) / (HR x SBP)_normal ]
 *
 * The heart already extracts about 70 % of the oxygen delivered to it at rest (GH14),
 * so it cannot answer a fall in oxygen content by extracting more; it can only raise
 * coronary flow, three- to four-fold at most, and that flow is driven by coronary
 * perfusion pressure. Demand tracks the rate-pressure product, the classical index of
 * myocardial oxygen consumption. Those two facts together say where the heart fails:
 * at a normal pressure it tolerates hypoxaemia down to a saturation in the high
 * twenties, and at a normal saturation it tolerates hypotension down to a perfusion
 * pressure in the mid-teens - which is, independently, the coronary perfusion pressure
 * below which resuscitation does not succeed (Paradis 1990; `arrest.cppRosc_mmHg`).
 * That agreement is a check on the model rather than something tuned into it.
 *
 * WHAT A SHORTFALL DOES.
 *
 *   - Contractility scales with the supply ratio (below 1). Suga showed myocardial
 *     oxygen consumption is linear in the pressure-volume area the ventricle generates,
 *     so a heart given half the oxygen it needs does about half the mechanical work.
 *   - The sinus node slows with it: hypoxic bradycardia, the pre-terminal rhythm of
 *     every asphyxial arrest.
 *   - Sustained, near-total hypoxia turns an organised rhythm into PEA, and PEA left
 *     hypoxic degrades to asystole. Hypoxic arrests present as bradycardia -> PEA ->
 *     asystole, not as VF, and the model reproduces that order.
 *   - Restoring oxygenation during PEA - good compressions with oxygenated blood,
 *     adrenaline raising the aortic diastolic pressure - returns a pulse (ROSC). Treat
 *     the cause and the heart restarts; fail to and it does not. This is the "Hs and
 *     Ts" of advanced life support made mechanical: hypoxia, hypovolaemia, acidosis,
 *     hyperkalaemia and hypothermia all act here, through supply, through the
 *     perfusion pressure, or through the explicit gates below.
 */

/** Rate-pressure product of the reference adult, bpm x mmHg. */
const REFERENCE_RPP = P('cardio.heartRateBaseline_bpm') * 120;

export function stepMyocardium(s: SimState, dt: number, rng: Rng): void {
  const m = s.myocardium;
  const c = s.cardio;

  const caRatio = Math.max(0, s.resp.arterialO2Content / REFERENCE_CAO2);
  const perfusion = Math.max(0, Math.min(1.4, c.cpp / P('myocardium.referenceCpp_mmHg')));
  const supply = caRatio * P('myocardium.coronaryFlowReserve') * perfusion * P('myocardium.maxO2Extraction');

  const basal = P('myocardium.arrestedDemandFraction');
  let work: number;
  switch (c.rhythm) {
    case 'asystole':
    case 'pea':
      // Electrically active or not, a heart that is not contracting is spending only
      // its basal metabolism.
      work = 0;
      break;
    case 'vfib':
      // Fibrillating myocardium is working hard and achieving nothing; its consumption
      // is at least that of a normally beating heart.
      work = 1;
      break;
    default:
      work = Math.max(0.2, (c.hr * Math.max(20, c.sbp)) / REFERENCE_RPP);
  }
  const demand = P('myocardium.restingO2Extraction') * (basal + (1 - basal) * work);

  const ratio = demand > 0 ? supply / demand : 4;
  const k = 1 - Math.exp(-dt / P('myocardium.hypoxiaTau_s'));
  m.supplyRatio += (ratio - m.supplyRatio) * k;
  m.hypoxia = Math.max(0, Math.min(1, 1 - m.supplyRatio));

  stepHypoxicRhythm(s, dt, rng);
}

/**
 * Hypoxic degeneration and recovery of the rhythm.
 *
 * The RNG is drawn only on a transition that is already due, so an undisturbed body's
 * random stream is exactly what it was before this existed (determinism test).
 */
function stepHypoxicRhythm(s: SimState, dt: number, rng: Rng): void {
  const m = s.myocardium;
  const c = s.cardio;
  const organised = c.rhythm === 'nsr' || c.rhythm === 'sinus_brad' || c.rhythm === 'sinus_tach' || c.rhythm === 'afib';

  // "Profound" is supply below a tenth of demand. Counted while the rhythm is organised
  // (heading for PEA) or in PEA (heading for asystole), reset otherwise.
  const profound = m.supplyRatio < 0.1;
  if (profound && (organised || c.rhythm === 'pea')) m.hypoxicTime += dt;
  else if (!profound) m.hypoxicTime = Math.max(0, m.hypoxicTime - dt * 2);

  if (organised && m.hypoxicTime >= P('myocardium.peaAfterProfoundHypoxia_s')) {
    c.rhythm = 'pea';
    c.cycleT = 0;
    m.hypoxicTime = 0;
    if (s.procedures.arrestStartT === null) s.procedures.arrestStartT = s.t;
    return;
  }
  if (c.rhythm === 'pea' && m.hypoxicTime >= P('myocardium.asystoleAfterPea_s')) {
    c.rhythm = 'asystole';
    m.hypoxicTime = 0;
    return;
  }

  // ROSC. The test is whether the myocardium COULD sustain a beating heart: supply
  // against the demand of a normal resting beat, not against the tiny demand of the
  // arrested one - otherwise any compression would "restart" a heart that would
  // re-arrest the moment it tried to work. The reversible causes gate it explicitly
  // where supply alone would not see them.
  if (c.rhythm === 'pea' || c.rhythm === 'asystole') {
    const beatingDemand = P('myocardium.restingO2Extraction');
    const caRatio = s.resp.arterialO2Content / REFERENCE_CAO2;
    const perfusion = Math.max(0, Math.min(1.4, c.cpp / P('myocardium.referenceCpp_mmHg')));
    const couldBeat =
      (caRatio * P('myocardium.coronaryFlowReserve') * perfusion * P('myocardium.maxO2Extraction')) / beatingDemand;
    const reversibleCausesTreated =
      s.chem.k < 7.0 && s.chem.k > 2.5 && s.chem.ph > 6.9 && s.metabolic.coreTemp > 30 && s.cardio.bloodVolume > 3000;

    if (couldBeat >= 1 && reversibleCausesTreated) m.recoveryTime += dt;
    else m.recoveryTime = Math.max(0, m.recoveryTime - dt);

    // Asystole additionally needs something to drive a pacemaker: adrenaline's
    // chronotropy on the bus. Electrical silence does not restart on oxygen alone.
    const pacemakerDrive = c.rhythm === 'pea' || (s.effects['cardio.heartRate'] ?? 0) > 0.2;
    const dwell = P('myocardium.roscAfterReoxygenation_s') * (c.rhythm === 'asystole' ? 3 : 1);
    if (pacemakerDrive && m.recoveryTime >= dwell) {
      // A single draw, only now that ROSC is due, decides whether the first organised
      // beats are sinus or atrial fibrillation - post-arrest AF is common.
      c.rhythm = rng.chance(0.85) ? 'nsr' : 'afib';
      c.cycleT = 0;
      c.hr = Math.max(40, c.hr);
      m.recoveryTime = 0;
      m.hypoxicTime = 0;
      m.supplyRatio = Math.max(m.supplyRatio, 1);
      s.procedures.arrestStartT = null;
    }
  } else {
    m.recoveryTime = 0;
  }
}

/**
 * Multiplier on ventricular elastance from the oxygen supply and from acidaemia.
 * 1 when the myocardium is well supplied and pH is above the depression threshold.
 */
export function myocardialContractilityFactor(s: SimState): number {
  const oxygen = Math.max(0, Math.min(1, s.myocardium.supplyRatio));
  const onset = P('acidbase.myocardialDepressionOnset_pH');
  const acid = s.chem.ph < onset ? Math.max(0.3, 1 - P('acidbase.contractilityLossPerPh') * (onset - s.chem.ph)) : 1;
  return oxygen * acid;
}

/** Multiplier on the sinus rate from myocardial hypoxia: hypoxic bradycardia. */
export function sinusHypoxiaFactor(s: SimState): number {
  return Math.max(0.25, Math.min(1, s.myocardium.supplyRatio));
}
