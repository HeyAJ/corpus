import { P } from '../core/constants';
import type { SimState } from '../core/state';
import { metabolicBicarbonate } from './respiratory';

/**
 * ACID-BASE.
 *
 * Until this file existed, blood pH was a constant. It was written once at boot from
 * physiology.json and never touched again, so a body with a PaCO2 of 99 and a lactate
 * of 12 reported a pH of exactly 7.400, and the laboratory panel plotted that frozen
 * number as if it were a measurement. Nothing downstream could respond to acidaemia
 * because acidaemia could not happen.
 *
 * WHAT IS COMPUTED, AND FROM WHAT.
 *
 *   HCO3 = metabolic bicarbonate                     (fixed acids, lactate, ketoacids, alkali)
 *        + 0.1 x (PaCO2 - 40)                        (acute buffering by haemoglobin)
 *        + renal compensation                        (slow; 0.35 per mmHg once complete)
 *   pH   = 6.1 + log10( HCO3 / (0.0301 x PaCO2) )    (Henderson-Hasselbalch)
 *
 * Every coefficient is a published one (Adrogue and Madias 1998 for the compensation
 * slopes; West for the pK and CO2 solubility). None was fitted to a trace.
 *
 * LACTATE AND KETOACIDS ARE BUFFERED 1:1 and are subtracted at the point of use rather
 * than integrated into the bicarbonate pool. This gets the recovery right for free:
 * when the liver clears lactate it regenerates exactly the bicarbonate the lactic acid
 * consumed, so a resolving lactic acidosis corrects itself without the kidney having to
 * do anything - which is what happens after a seizure or a sprint.
 *
 * THE KIDNEY acts on the rest, slowly. The metabolic pool relaxes toward normal with a
 * one-day time constant (complete in three to five days), and a sustained change in
 * PaCO2 recruits a renal compensation on the same clock. That is why an acute
 * respiratory acidosis is profoundly acidaemic and a chronic one at the same PaCO2 is
 * nearly normal - the distinction every blood-gas interpretation turns on.
 *
 * WHAT IT FEEDS. pH is read by the oxygen dissociation curve (the Bohr shift, in
 * respiratory.ts), by the myocardium (acidaemia depresses contractility, in cardio.ts),
 * and by the chemoreflex through the metabolic bicarbonate (respiratory.ts). The anion
 * gap and base excess are pure readouts.
 */

export function stepAcidBase(s: SimState, dt: number): void {
  const ab = s.acidBase;
  const dtH = dt / 3600;

  const normalHco3 = P('blood.hco3_mEq_per_L');
  const paco2 = s.resp.arterialPco2;

  // Renal return of the metabolic pool toward normal. First-order, exact exponential.
  const kMet = 1 - Math.exp(-dtH / P('acidbase.metabolicRecoveryTau_h'));
  ab.metabolicHco3 += (normalHco3 - ab.metabolicHco3) * kMet;

  // Renal compensation for a sustained PaCO2 change: the chronic slope minus the acute
  // one, because the acute buffering is already counted separately below.
  const acute = P('acidbase.acuteHco3PerPaco2');
  const chronic = P('acidbase.chronicHco3PerPaco2');
  const compensationTarget = (chronic - acute) * (paco2 - 40);
  const kRen = 1 - Math.exp(-dtH / P('acidbase.renalCompensationTau_h'));
  ab.renalCompensation += (compensationTarget - ab.renalCompensation) * kRen;

  const hco3 = Math.max(1, metabolicBicarbonate(s) + acute * (paco2 - 40) + ab.renalCompensation);
  s.chem.hco3 = hco3;
  s.chem.ph = hendersonHasselbalch(hco3, paco2);
}

/** pH from bicarbonate (mEq/L) and PaCO2 (mmHg). */
export function hendersonHasselbalch(hco3: number, paco2: number): number {
  const dissolved = P('resp.co2SolubilityFactor') * Math.max(1, paco2);
  const ph = P('acidbase.pK') + Math.log10(Math.max(0.5, hco3) / dissolved);
  return Math.max(6.5, Math.min(7.9, ph));
}

/** Standard base excess, mEq/L (Siggaard-Andersen / Van Slyke, CLSI form). */
export function baseExcess(hco3: number, ph: number): number {
  return 0.93 * (hco3 - 24.4 + 14.8 * (ph - 7.4));
}

/** Anion gap, mEq/L: Na - (Cl + HCO3). */
export function anionGap(s: SimState): number {
  return s.chem.na - (s.chem.cl + s.chem.hco3);
}

/**
 * A plain-language reading of the gas, for the interface. The rules are the textbook
 * ones: decide acidaemia or alkalaemia from pH, name the primary process from which of
 * PaCO2 and bicarbonate moved in the direction that explains it, and call it mixed when
 * both did.
 */
export function interpretAcidBase(ph: number, paco2: number, hco3: number): string {
  const acidaemia = ph < 7.35;
  const alkalaemia = ph > 7.45;
  const respAcid = paco2 > 45;
  const respAlk = paco2 < 35;
  const metAcid = hco3 < 22;
  const metAlk = hco3 > 26;

  if (!acidaemia && !alkalaemia) {
    if ((respAcid && metAlk) || (respAlk && metAcid)) return 'compensated or mixed disorder, pH normal';
    return 'normal';
  }
  if (acidaemia) {
    if (respAcid && metAcid) return 'mixed respiratory and metabolic acidosis';
    if (respAcid) return metAlk ? 'respiratory acidosis, partly compensated' : 'acute respiratory acidosis';
    if (metAcid) return respAlk ? 'metabolic acidosis with respiratory compensation' : 'metabolic acidosis';
    return 'acidaemia';
  }
  if (respAlk && metAlk) return 'mixed respiratory and metabolic alkalosis';
  if (respAlk) return metAcid ? 'respiratory alkalosis, partly compensated' : 'acute respiratory alkalosis';
  if (metAlk) return respAcid ? 'metabolic alkalosis with respiratory compensation' : 'metabolic alkalosis';
  return 'alkalaemia';
}

/** Add an alkali (positive) or acid (negative) load, in mEq, spread over the ECF. */
export function addBicarbonate(s: SimState, mEq: number): void {
  const ecf_L = s.body.mass_kg * 0.2;
  s.acidBase.metabolicHco3 = Math.max(2, Math.min(60, s.acidBase.metabolicHco3 + mEq / ecf_L));
}
