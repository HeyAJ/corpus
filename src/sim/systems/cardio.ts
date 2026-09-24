import { P } from '../core/constants';
import type { CardioState, SimState } from '../core/state';
import type { Rng } from '../core/rng';
import { effect } from '../core/effects';

/**
 * CARDIOVASCULAR SYSTEM — closed-loop lumped-parameter circuit (spec 4.2).
 *
 * Eight compartments round a single loop, so total blood volume is conserved by
 * construction: LA -> LV -> aorta -> systemic veins -> RA -> RV -> pulmonary
 * artery -> pulmonary veins -> LA.
 *
 * Both ventricles use time-varying elastance, P = E(t)(V - V0), with E(t) a
 * double-Hill activation. That single choice gives EDV, ESV, stroke volume and
 * therefore ejection fraction as *outputs* — EF is never a stored number
 * (spec 4.2). The arterial side is a 4-element Windkessel: the aortic valve flow
 * is a state variable because of the inertance term.
 *
 * The circuit is sub-stepped at dt/5 (2 ms). The mitral/tricuspid time constant
 * (R_valve x atrial compliance) is ~24 ms, so a 10 ms forward-Euler step sits at
 * the edge of stability; 2 ms is comfortably inside it. This is an integration
 * detail inside the fixed 10 ms physiology step and does not change the spec's
 * time model.
 */

const CV_SUBSTEPS = 5;

/** Normalised double-Hill activation, e(t) in 0..1 (Mynard et al. 2012). */
export function activation(cycleT: number, rr: number): number {
  // Systole shortens with rate, but sub-linearly: a Bazett-like square-root scaling
  // keeps systole from collapsing to nothing at HR 200 the way a pure fraction-of-RR
  // formulation would.
  const REF_RR = 60 / P('cardio.heartRateBaseline_bpm');
  const scale = Math.sqrt(Math.min(rr, REF_RR * 2) / REF_RR);
  const tau1 = P('cardio.activation.tau1_fraction') * REF_RR * scale;
  const tau2 = P('cardio.activation.tau2_fraction') * REF_RR * scale;
  const m1 = P('cardio.activation.hill1_exponent');
  const m2 = P('cardio.activation.hill2_exponent');

  const g1 = Math.pow(cycleT / tau1, m1);
  const g2 = Math.pow(cycleT / tau2, m2);
  const e = (g1 / (1 + g1)) * (1 / (1 + g2));
  // The double-Hill peaks below 1; normalise by the analytic peak so Emax means Emax.
  return e / DOUBLE_HILL_PEAK;
}

/** Peak of the un-normalised double-Hill, computed once at module load. */
const DOUBLE_HILL_PEAK = (() => {
  const m1 = 1.9;
  const m2 = 21.9;
  const t1 = 0.269;
  const t2 = 0.452;
  let peak = 0;
  for (let i = 0; i <= 2000; i++) {
    const t = (i / 2000) * 1.2;
    const g1 = Math.pow(t / t1, m1);
    const g2 = Math.pow(t / t2, m2);
    const e = (g1 / (1 + g1)) * (1 / (1 + g2));
    if (e > peak) peak = e;
  }
  return peak;
})();

/** Forward-only valve: a diode with a finite forward resistance. */
function valve(pUp: number, pDown: number, r: number): number {
  const dp = pUp - pDown;
  return dp > 0 ? dp / r : 0;
}

/**
 * Mechanical effectiveness of the current rhythm. VT is deliberately NOT given a
 * penalty here: its haemodynamic collapse must emerge from the short diastole
 * failing to fill the ventricle, which is what actually happens.
 */
function mechanicalGain(c: CardioState): number {
  switch (c.rhythm) {
    case 'vfib':
      // Fibrillating myocardium is not weakly contracting myocardium: it is
      // contracting out of phase with itself, so regional shortening cancels and
      // chamber volume barely changes. That distinction matters numerically,
      // because ANY periodic elastance swing against competent valves pumps — it is
      // exactly how the CPR thoracic pump works. At 0.03 the model produced
      // 0.86 L/min of spurious cardiac output in VF, which is more than some
      // patients have in cardiogenic shock. 0.004 leaves a quiver that moves
      // essentially no blood, which is the real behaviour.
      return 0.004;
    case 'asystole':
    case 'pea':
      return 0;
    default:
      return 1;
  }
}

/**
 * External (intrathoracic) pressure from a CPR compression, mmHg.
 *
 * CPR is modelled as a thoracic pump rather than as a scripted stroke volume: the
 * compression raises pressure inside the chest and blood moves through the valve
 * equations that are already there. Compression rate, volume status and vascular
 * tone therefore all feed into the output the way they do in reality.
 *
 * The subtlety, and it cost a failing test to find: the pressure is NOT applied
 * only to the heart. The thoracic aorta and the great veins are inside the chest
 * too and are squeezed along with it, so only the DIFFERENCE in transmission
 * becomes a driving gradient. Applying the compression to the heart alone turned
 * CPR into an implausibly good pump — a coronary perfusion pressure of 69 mmHg,
 * about four times what optimal manual compressions achieve in a real arrest.
 */
function cprExternalPressure(s: SimState): number {
  if (!s.procedures.cprActive) return 0;
  const since = s.t - s.procedures.lastCompressionT;
  const downstroke = P('arrest.cprDownstrokeDuration_s');
  if (since < 0 || since > downstroke) return 0;
  return P('arrest.cprPressureAmplitude_mmHg') * Math.sin((Math.PI * since) / downstroke);
}

/**
 * Explicit Frank-Starling term (spec 4.2).
 *
 * The elastance model already produces a Starling response geometrically: a larger
 * EDV at the same E gives a larger developed pressure and therefore a larger stroke
 * volume. This extra factor models the *additional* mechanism — length-dependent
 * calcium sensitivity of the myofilaments — so the gain is deliberately small. A
 * large gain here would double-count the geometric effect.
 */
function starling(edv: number): number {
  const REF_EDV = 120;
  const GAIN = 0.25;
  return Math.min(1.3, Math.max(0.7, 1 + GAIN * (edv / REF_EDV - 1)));
}

export function stepCardio(s: SimState, dt: number, rng: Rng): void {
  const c = s.cardio;
  const h = dt / CV_SUBSTEPS;

  // ---- rate & rhythm -----------------------------------------------------
  updateRate(s, rng);

  const gain = mechanicalGain(c);
  const pExt = cprExternalPressure(s);
  const arterialTransmission = P('arrest.cprArterialTransmission');
  const venousTransmission = P('arrest.cprVenousTransmission');

  // Drug/receptor modulation, read once per tick from the effect accumulator.
  const inotropy = c.contractilityScale * (1 + effect(s, 'cardio.contractility'));
  const svr = c.svrScale * (1 + effect(s, 'cardio.systemicResistance'));
  const venousTone = c.venousToneScale;

  const rValve = P('cardio.valve.R_mmHg_s_per_mL');
  const rSys = P('cardio.wk.R_mmHg_s_per_mL') * Math.max(0.15, svr);
  const rVen = P('cardio.venous.R_mmHg_s_per_mL');
  const rPulm = P('cardio.pulm.R_mmHg_s_per_mL');
  const rPvein = P('cardio.pulmVein.R_mmHg_s_per_mL');
  const rc = P('cardio.wk.Rc_mmHg_s_per_mL');
  const lAo = P('cardio.wk.L_mmHg_s2_per_mL');

  const starlingFactor = starling(c.beatEdv);

  for (let i = 0; i < CV_SUBSTEPS; i++) {
    c.cycleT += h;

    // --- elastance ---------------------------------------------------------
    let act = 0;
    if (gain > 0) {
      if (c.rhythm === 'vfib') {
        // Fibrillation: no coordinated activation. A fast, low-amplitude tremor.
        act = 0.5 + 0.5 * Math.sin(c.cycleT * 2 * Math.PI * 5.5);
      } else {
        act = activation(c.cycleT, c.rr);
      }
    }
    c.activation = act;

    const eLv = c.lv.Emin + (c.lv.Emax * inotropy * starlingFactor - c.lv.Emin) * act * gain;
    const eRv = c.rv.Emin + (c.rv.Emax * inotropy * starlingFactor - c.rv.Emin) * act * gain;

    // Atrial contraction leads ventricular systole; model it as a short kick at the
    // end of the previous diastole (the P wave), which is what gives the atrial
    // contribution to filling.
    const atrialPhase = Math.max(0, 1 - Math.abs(c.cycleT - (c.rr - 0.12)) / 0.09);
    const atrialAct = c.rhythm === 'afib' || c.rhythm === 'vfib' || c.rhythm === 'asystole' ? 0 : atrialPhase;

    c.lv.P = eLv * (c.lv.V - c.lv.V0) + pExt;
    c.rv.P = eRv * (c.rv.V - c.rv.V0) + pExt;
    c.la.P = c.la.Emax * (1 + 0.8 * atrialAct) * (c.la.V - c.la.V0) + pExt;
    c.ra.P = c.ra.Emax * (1 + 0.8 * atrialAct) * (c.ra.V - c.ra.V0) + pExt;

    c.aorta.P = (c.aorta.V - c.aorta.V0) / c.aorta.C + pExt * arterialTransmission;
    const vuVein = P('cardio.venous.unstressedVolume_mL') * venousTone * (1 - effect(s, 'cardio.venousTone')) -
      P('baroreflex.gainVenousTone_mL') * (s.reflex.symp - 0.5) * 2;
    c.veins.V0 = vuVein;
    c.veins.P = Math.max(0, (c.veins.V - vuVein) / c.veins.C) + pExt * venousTransmission;
    c.pulmArt.P = (c.pulmArt.V - c.pulmArt.V0) / c.pulmArt.C + pExt;
    c.pulmVein.P = (c.pulmVein.V - c.pulmVein.V0) / c.pulmVein.C + pExt;

    // --- flows -------------------------------------------------------------
    const qMitral = valve(c.la.P, c.lv.P, rValve);
    const qTricuspid = valve(c.ra.P, c.rv.P, rValve);

    // Aortic valve: inertance makes flow a state variable (4-element Windkessel).
    const dq = (c.lv.P - c.aorta.P - c.qAortic * rc) / lAo;
    c.qAortic += dq * h;
    if (c.qAortic < 0) c.qAortic = 0;
    if (c.lv.P < c.aorta.P && c.qAortic <= 0) c.qAortic = 0;

    const qPulmonicValve = valve(c.rv.P, c.pulmArt.P, rValve);
    c.qPulmonic = qPulmonicValve;

    const qSys = (c.aorta.P - c.veins.P) / rSys;
    const qVenousReturn = (c.veins.P - c.ra.P) / rVen;
    const qPulmCap = (c.pulmArt.P - c.pulmVein.P) / rPulm;
    const qPulmVenous = (c.pulmVein.P - c.la.P) / rPvein;

    // --- volumes -----------------------------------------------------------
    c.lv.V += (qMitral - c.qAortic) * h;
    c.aorta.V += (c.qAortic - qSys) * h;
    c.veins.V += (qSys - qVenousReturn) * h;
    c.ra.V += (qVenousReturn - qTricuspid) * h;
    c.rv.V += (qTricuspid - qPulmonicValve) * h;
    c.pulmArt.V += (qPulmonicValve - qPulmCap) * h;
    c.pulmVein.V += (qPulmCap - qPulmVenous) * h;
    c.la.V += (qPulmVenous - qMitral) * h;

    // Volume floors. A compartment can empty but never go negative.
    if (c.lv.V < 2) c.lv.V = 2;
    if (c.rv.V < 2) c.rv.V = 2;
    if (c.la.V < 2) c.la.V = 2;
    if (c.ra.V < 2) c.ra.V = 2;
    if (c.veins.V < 50) c.veins.V = 50;

    // --- per-beat accumulators --------------------------------------------
    if (c.lv.V > c.beatMaxLv) c.beatMaxLv = c.lv.V;
    if (c.lv.V < c.beatMinLv) c.beatMinLv = c.lv.V;
    if (c.aorta.P > c.beatMaxAo) c.beatMaxAo = c.aorta.P;
    if (c.aorta.P < c.beatMinAo) c.beatMinAo = c.aorta.P;
    if (c.ra.P < c.beatMinRa) c.beatMinRa = c.ra.P;
    c.beatEjectedVolume += c.qAortic * h;

    // MAP as a leaky integral of instantaneous aortic pressure, tau = 2 s. This is
    // also what the baroreceptors see, low-passed harder in baroreflex.ts.
    c.mapFilter += ((c.aorta.P - c.mapFilter) * h) / 2.0;

    SUBSTEP_AORTIC_P[i] = c.aorta.P;

    // --- beat boundary -----------------------------------------------------
    if (c.cycleT >= c.rr) {
      latchBeat(s, rng);
    }
  }

  // Coronary perfusion pressure: aortic diastolic minus right atrial diastolic.
  // This is the number that gates defibrillation success (spec 9).
  //
  // BOTH sides must be relaxation-phase values. Taking the per-beat aortic minimum
  // against an INSTANTANEOUS right atrial pressure gave wildly swinging and even
  // negative coronary pressures during CPR, because a compression raises right
  // atrial pressure by the full intrathoracic pressure at that instant. Coronary
  // flow happens between compressions, which is why the clinically measured
  // quantity is diastolic-to-diastolic.
  c.cpp = c.dbp - c.dbpRa;

  // Total circulating volume, recomputed from the compartments so that any leak in
  // the integrator shows up instead of hiding.
  c.bloodVolume =
    c.lv.V + c.rv.V + c.la.V + c.ra.V + c.aorta.V + c.veins.V + c.pulmArt.V + c.pulmVein.V;
}

function latchBeat(s: SimState, rng: Rng): void {
  const c = s.cardio;
  c.cycleT -= c.rr;
  if (c.cycleT < 0) c.cycleT = 0;

  c.beatEdv = c.beatMaxLv;
  c.beatEsv = c.beatMinLv;
  c.beatSv = c.beatEjectedVolume;
  c.ef = c.beatEdv > 0 ? Math.max(0, Math.min(1, c.beatSv / c.beatEdv)) : 0;
  c.co = (c.beatSv * (60 / c.rr)) / 1000;

  c.sbp = c.beatMaxAo;
  c.dbp = c.beatMinAo;
  c.dbpRa = c.beatMinRa;
  c.map = c.mapFilter;

  c.rrHistory.push(c.rr);
  if (c.rrHistory.length > 8) c.rrHistory.shift();

  c.beatMaxLv = c.lv.V;
  c.beatMinLv = c.lv.V;
  c.beatMaxAo = c.aorta.P;
  c.beatMinAo = c.aorta.P;
  c.beatMinRa = c.ra.P;
  c.beatEjectedVolume = 0;

  maybeDegenerate(s, rng);
  c.rr = nextRrInterval(s, rng);
}

/**
 * THE ARRHYTHMIC LOAD: what `cardio.arrhythmogenicity`, `cardio.qtInterval` and
 * `cardio.conductionVelocity` add up to as a tendency for the rhythm to fall apart.
 *
 * All three targets were written and none was read, so nothing a drug did to the
 * myocardium's electrical stability could ever produce a rhythm. Measured before this
 * existed: haloperidol produced no rhythm change at any dose, although its own notes
 * say its hERG affinity "is the reason it needs an ECG"; bupivacaine, whose entire
 * reputation is cardiac arrest from an accidental intravascular injection, had no path
 * to arrest at all; and cocaine's note describes "the wide-complex arrhythmia" that the
 * model could not produce.
 *
 * THE THREE MECHANISMS ARE SUMMED, not multiplied, because they are three independent
 * routes to the same endpoint and a body exposed to two of them is at the sum of the
 * risks, not the product. They are:
 *
 *   - `cardio.arrhythmogenicity` itself: calcium loading and shortened refractoriness.
 *     Catecholamines (beta-1), PDE3 inhibition, digoxin and cocaine.
 *   - Delayed repolarisation, from `cardio.qtInterval`. A long QT invites early
 *     afterdepolarisations, which is torsades de pointes. Only the positive half
 *     counts: a drug that SHORTENS QT is not protective in this model, and claiming it
 *     was would be inventing a mechanism.
 *   - Slowed conduction, from the negative half of `cardio.conductionVelocity`. Slowed
 *     conduction is arrhythmogenic in its own right because it is the substrate for
 *     re-entry - dispersion of conduction lets a wavefront come back to tissue that has
 *     already recovered. This is the textbook explanation for why the class Ic drugs
 *     increased mortality in CAST, and it is why a sodium-channel blocker that reaches
 *     the circulation is dangerous rather than merely inert. The `nav` effect vector
 *     does not carry an arrhythmogenicity gain of its own, so without this term
 *     bupivacaine and cocaine reach the ventricle and can do nothing to it.
 *
 * Each contributes with a gain of one, because all three are the same dimensionless
 * fractional modifier on the same bus and there is no measurement that says one unit of
 * QT prolongation is worth more or less arrhythmia than one unit of calcium loading.
 * Weighting them differently would be inventing three numbers to replace none.
 */
function arrhythmicLoad(s: SimState): { total: number; repolarisation: number } {
  const calcium = Math.max(0, effect(s, 'cardio.arrhythmogenicity'));
  const repolarisation = Math.max(0, effect(s, 'cardio.qtInterval'));
  const conduction = Math.max(0, -effect(s, 'cardio.conductionVelocity'));
  return { total: calcium + repolarisation + conduction, repolarisation: repolarisation + conduction };
}

/**
 * Roll, once per beat, for degeneration into a lethal rhythm.
 *
 * THE THRESHOLD IS 1.0 AND IT IS NOT A FITTED NUMBER. `effects.ts` defines a bus value
 * of +1 as "this quantity has doubled". So the rule here is: a myocardium whose
 * arrhythmic tendency has been no more than doubled keeps its rhythm, and beyond that
 * the excess is the per-beat probability that this beat is the one that starts
 * something. Nothing else on the bus would have served as a threshold without being a
 * number somebody chose.
 *
 * It behaves correctly at both ends, which is the check that matters:
 *
 *   - A code dose of adrenaline saturates beta-1 and reaches 0.7. It does not by itself
 *     fibrillate a heart, and it must not, because it is given to every arrest.
 *   - A therapeutic dose of digoxin reaches about 0.36, and produces no arrhythmia. Four
 *     times that - which is what the direct-effect ceiling allows and what digoxin
 *     toxicity is - crosses 1 and does. The narrow therapeutic index that digoxin's own
 *     note asks the model to show is exactly this gap.
 *   - Haloperidol at 5 mg prolongs QT without reaching the threshold, so it gets the
 *     electrocardiographic finding and not the arrest. That is the clinical reality and
 *     it is why the drug carries an ECG warning rather than a contraindication.
 *
 * WHICH RHYTHM. Degeneration driven mostly by delayed repolarisation or slowed
 * conduction is polymorphic or wide-complex ventricular tachycardia - torsades, and the
 * sodium-blocker's wide-complex arrhythmia - so it lands on `vt`. Degeneration driven
 * mostly by calcium loading goes straight to `vfib`, which is what a catecholamine or a
 * digitalis-toxic heart does. Both are shockable, and which one the user sees is a
 * legible consequence of which drug they gave.
 *
 * Only an organised, self-driven rhythm can degenerate: there is nothing left to
 * destabilise in VF or asystole, and PEA's problem is mechanical rather than electrical.
 * The RNG IS ONLY DRAWN WHEN THE THRESHOLD IS ALREADY CROSSED, so an undrugged body's
 * random stream is bit-for-bit what it was before this function existed.
 */
function maybeDegenerate(s: SimState, rng: Rng): void {
  const c = s.cardio;
  if (c.rhythm !== 'nsr' && c.rhythm !== 'sinus_tach' && c.rhythm !== 'sinus_brad' && c.rhythm !== 'afib') {
    return;
  }
  const load = arrhythmicLoad(s);
  const excess = load.total - 1;
  if (excess <= 0) return;

  if (rng.chance(Math.min(1, excess))) {
    c.rhythm = load.repolarisation * 2 >= load.total ? 'vt' : 'vfib';
    c.cycleT = 0;
  }
}

/** Resample the R-R interval at each beat. AF randomises it; everything else does not. */
function nextRrInterval(s: SimState, rng: Rng): number {
  const c = s.cardio;
  const base = 60 / Math.max(15, c.hr);
  if (c.rhythm === 'afib') {
    // Irregularly irregular: log-normal jitter around the mean, +/-25%.
    return Math.max(0.24, base * Math.exp(rng.gaussian() * 0.25));
  }
  // Respiratory sinus arrhythmia: a one-line change that makes the trace look real
  // (spec 4.3). Modulated at the respiratory rate, in phase with inspiration.
  if (c.rhythm === 'nsr' || c.rhythm === 'sinus_brad') {
    const phase = (s.resp.cycleT / s.resp.period) * 2 * Math.PI;
    return base * (1 - P('ecg.rsaFraction') * Math.sin(phase));
  }
  return base;
}

function updateRate(s: SimState, _rng: Rng): void {
  const c = s.cardio;

  if (c.rhythm === 'vt') {
    // Ectopic ventricular focus: a fixed fast rate, not under reflex control.
    //
    // AV NODAL BLOCK IS DELIBERATELY NOT APPLIED HERE, and the omission is the
    // teaching point. A ventricular focus fires BELOW the atrioventricular node, so
    // nothing done to the node reaches it. That is exactly why adenosine does not
    // terminate ventricular tachycardia and why giving verapamil to a wide-complex
    // tachycardia that turns out to be VT is a recognised way to kill someone: the
    // rate is untouched and the negative inotropy is not. Applying the block to every
    // rhythm uniformly would have modelled that backwards.
    c.hr = 180 * (1 + effect(s, 'cardio.ectopicRate'));
    c.rr = 60 / c.hr;
    return;
  }
  if (c.rhythm === 'vfib' || c.rhythm === 'asystole') {
    c.hr = 0;
    c.rr = 1;
    return;
  }

  const rest = P('cardio.heartRateBaseline_bpm');
  const gs = P('baroreflex.gainHR_sym_bpm');
  const gv = P('baroreflex.gainHR_vagal_bpm');

  const reflexHr = rest + gs * (s.reflex.symp - 0.5) * 2 - gv * (s.reflex.vagal - 0.5) * 2;

  // Direct drug chronotropy on top of the reflex (beta-1 agonism, muscarinic block,
  // adenosine-mediated AV nodal effects, ...).
  let hr = reflexHr * c.chronotropicScale * (1 + effect(s, 'cardio.heartRate')) + c.hrOffset;

  // Hyperkalaemia slows conduction and, at high levels, the sinus node itself.
  if (s.chem.k > 6.0) hr *= Math.max(0.35, 1 - (s.chem.k - 6.0) * 0.18);

  // --- atrioventricular conduction ----------------------------------------
  //
  // Everything above this line is the rate at which the ATRIA are being driven. What
  // reaches the ventricle, and therefore what produces a pulse, is that rate times the
  // fraction of impulses the atrioventricular node conducts. `cardio.avNodalBlock` is
  // the fraction it fails to conduct.
  //
  // This is the only path several drugs have to physiology at all, and it had no
  // consumer. Adenosine's entire clinical identity is transient complete AV block -
  // the A1 vector calls it "the mechanism that terminates re-entrant SVT" and reaches
  // 0.87 on this bus at a 6 mg push - and it did nothing. Verapamil and digoxin both
  // carry it as a cited direct effect, and rate control of atrial fibrillation is what
  // digoxin is FOR: its own note says "this, not the inotropy, is what rate-controls
  // atrial fibrillation". M2 carries it too.
  //
  // WHY A MULTIPLIER ON RATE RATHER THAN DROPPED BEATS. Real nodal block drops
  // individual beats in Wenckebach or fixed ratios, and at the limit produces a pause
  // with no ventricular activity at all. This model has one beat generator and no
  // separate atrial and ventricular clocks, so it cannot drop a beat; what it can do
  // exactly is reduce the ventricular rate in proportion to the impulses that fail to
  // get through, which is the same thing averaged over a few seconds and is what the
  // rate readout and the cardiac output depend on. A 6 mg adenosine push takes the
  // rate to a few beats a minute for as long as the drug lasts - about six seconds,
  // which is its half-life - and the R-R floor in `nextRrInterval` turns that into the
  // multi-second ventricular pause that an adenosine push actually produces. The
  // approximation is that the pause is regular rather than abrupt; it is recorded in
  // docs/MODEL_LIMITATIONS.md.
  //
  // CLAMPED AT ZERO FROM BELOW, which is not a numerical guard but a physiological
  // statement: a node cannot conduct MORE than every impulse it is given. Atropine and
  // the other antimuscarinics drive this target negative by displacing vagal tone at
  // M2, and their positive chronotropy is already carried - through the same receptor,
  // from the same displaced tone - by `cardio.heartRate`. Letting a negative block
  // multiply the rate up as well would count one vagolytic effect twice.
  const avBlock = Math.max(0, Math.min(1, effect(s, 'cardio.avNodalBlock')));
  hr *= 1 - avBlock;

  c.hr = Math.max(0, Math.min(240, hr));

  // Sinus rhythm naming is derived from the rate, not stored separately.
  if (c.rhythm === 'nsr' || c.rhythm === 'sinus_tach' || c.rhythm === 'sinus_brad') {
    c.rhythm = c.hr > 100 ? 'sinus_tach' : c.hr < 60 ? 'sinus_brad' : 'nsr';
  }
  if (c.rhythm === 'pea') {
    c.hr = Math.max(20, Math.min(120, hr));
  }
}

/** Add or remove circulating volume. Fluids and haemorrhage both land in the veins. */
export function addVolume(c: CardioState, mL: number): void {
  c.veins.V = Math.max(50, c.veins.V + mL);
  c.targetBloodVolume = Math.max(500, c.targetBloodVolume + mL);
}

/**
 * Aortic pressure captured at each of the CV_SUBSTEPS sub-steps of the last tick.
 * The 250 Hz arterial-pressure waveform channel reads this, so the strip shows a
 * real pulse contour instead of one held sample per 10 ms.
 */
export const SUBSTEP_AORTIC_P = new Float64Array(CV_SUBSTEPS);
export const CARDIO_SUBSTEPS = CV_SUBSTEPS;
