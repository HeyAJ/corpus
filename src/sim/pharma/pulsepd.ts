import type { Drug, Receptor } from '../../data/pharma-types';
import type { DrugPkState, SimState } from '../core/state';
import { addEffect } from '../core/effects';

/**
 * PULSE PHARMACODYNAMICS (spec 5.6).
 *
 * Pulse publishes, per substance, an EC50 and a set of fractional effect modifiers,
 * applied through the same Emax form this engine uses:
 *
 *   effect = modifier * C^n / (EC50^n + C^n)
 *
 * This is how propofol and midazolam produce a real, cited, concentration-dependent
 * response even though GtoPdb publishes no GABA-A affinity for either of them. The
 * alternative was to invent a Ki, which the spec forbids and rightly so.
 *
 * TWO TRANSLATIONS ARE NEEDED, and both are approximations worth naming.
 *
 * 1. Pulse modifies systolic and diastolic pressure *directly*, because its
 *    cardiovascular model exposes them as targets. Ours computes them from a
 *    circuit, so a direct write would overwrite the physics. Instead the mean
 *    modifier (sys + 2*dia)/3 is routed to systemic resistance, and the pulse-
 *    pressure component (sys - dia) to contractility — the two mechanisms that
 *    actually produce those numbers.
 *
 * 2. Double counting. A drug with GtoPdb affinities already reaches some of these
 *    targets through receptor occupancy. Applying both paths would count the effect
 *    twice, so a Pulse modifier is applied ONLY for a target that the drug's own
 *    receptors do not already reach. `coveredTargets` is computed once at load.
 *
 * Both are recorded in docs/MODEL_LIMITATIONS.md.
 *
 * THE BLOCK IS COMPETABLE WHERE THE DRUG NAMES ITS SITE (ADR-026).
 *
 * A Pulse block is a curve fitted to a whole-drug exposure, so it ran strictly in
 * parallel with receptor occupancy and nothing at a receptor could reach it. That is
 * defensible for a drug whose mechanism is diffuse, and wrong for one whose mechanism
 * is a named site with a licensed antidote. Measured: after midazolam 2 mg IV,
 * flumazenil 0.2 mg moved sedation from 0.683 to 0.680 in a minute — indistinguishable
 * from midazolam's own decay — while the same flumazenil dose reversed diazepam
 * properly, because diazepam has a published benzodiazepine-site Ki and midazolam has
 * no published human GABA-A affinity of any kind.
 *
 * So `pulsePd.mediatedBy` names the site, and the block's response is scaled by the
 * share of that site NOT held by some other ligand, weighted by how completely each
 * one shuts it (a neutral antagonist counts fully, a full agonist not at all). No Ki is
 * invented for the drug that owns the block, and a drug that names no site is
 * unaffected.
 *
 * WHAT THIS IS NOT. It is one-directional competition, not Gaddum: the drug owning the
 * block has no affinity, so it cannot compete BACK. Flumazenil at a saturating
 * concentration reverses 2 mg of midazolam and 50 mg of midazolam by the same fraction,
 * where in reality the antagonist can be out-competed by enough agonist. Stated in
 * docs/MODEL_LIMITATIONS.md.
 */

export interface PulsePdPlan {
  drugId: string;
  ec50_mg_per_L: number;
  hill: number;
  /** Effect-bus contributions: target -> modifier, already de-duplicated. */
  contributions: { target: string; gain: number }[];
  /**
   * Competitive gate, or null when the drug names no mediating site. `receptorIndex`
   * indexes `s.receptors`, which is built parallel to the receptor table, and `weight`
   * is how completely each rival ligand shuts the site: `1 - clamp(intrinsicActivity)`,
   * so an antagonist counts 1 and a full agonist 0.
   */
  gate: { receptorIndex: number; blockers: { drugId: string; weight: number }[] } | null;
}

const PRESSURE_TARGETS = ['cardio.systemicResistance', 'cardio.contractility'];

export function buildPulsePdPlans(drugs: Drug[], receptors: Receptor[]): Map<string, PulsePdPlan> {
  const byId = new Map(receptors.map((r) => [r.id, r]));
  const plans = new Map<string, PulsePdPlan>();

  for (const d of drugs) {
    const pd = d.pulsePd;
    if (!pd) continue;

    const covered = new Set<string>();
    for (const t of d.targets) {
      const r = byId.get(t.receptorId);
      if (!r) continue;
      for (const e of r.effects) covered.add(e.target);
    }
    for (const e of d.directEffects) covered.add(e.target);

    const contributions: { target: string; gain: number }[] = [];
    const push = (target: string, gain: number) => {
      if (gain === 0 || covered.has(target)) return;
      contributions.push({ target, gain });
    };

    const m = pd.modifiers;

    if (m.heartRate !== undefined) push('cardio.heartRate', m.heartRate);

    const sys = m.systolicPressure ?? 0;
    const dia = m.diastolicPressure ?? 0;
    if (sys !== 0 || dia !== 0) {
      const mean = (sys + 2 * dia) / 3;
      const pulse = sys - dia;
      if (!PRESSURE_TARGETS.some((t) => covered.has(t))) {
        push('cardio.systemicResistance', mean);
        push('cardio.contractility', pulse * 0.5);
      }
    }

    // CENTRAL DRIVE, NOT BREATHING PATTERN. This is the correction for a bug that made
    // midazolam do nothing at all.
    //
    // `resp.rate` and `resp.tidalVolume` are applied where the drive is split into a
    // rate and a depth - DOWNSTREAM of the chemoreceptor loop. Push on them and the
    // loop simply undoes it: rate falls, alveolar ventilation falls, PaCO2 climbs,
    // the central chemoreceptor raises drive, and rate comes straight back to where it
    // started. The measured result was a 2 mg dose of midazolam producing a respiratory
    // trace byte-identical to giving nothing, with a -0.17 modifier sitting uselessly
    // on the bus the whole time.
    //
    // The receptor data already had this right and this bridge was the odd one out:
    // mu pushes `resp.drive` -0.85 and gabaa pushes it -0.45, while beta2, m3 and h1 -
    // airway calibre, which really is mechanical - push `resp.tidalVolume`. The rule
    // is central drive versus mechanical capacity, and a benzodiazepine is central.
    //
    // Minute ventilation is rate x depth, so a drug that multiplies rate by (1+a) and
    // depth by (1+b) multiplies ventilation by (1+a)(1+b). That product is the drive
    // modifier; it is derived from Pulse's own two numbers rather than invented, and
    // the model's own 0.55/0.45 exponents split it back into a rate and a depth.
    //
    // Depressing drive does NOT abolish the chemoreflex, which is the physiologically
    // important part: ventilation still settles where it must to clear metabolic CO2,
    // but it settles at a higher PaCO2. Hypercapnia, not a stopped clock, is the
    // signature of opioid and benzodiazepine respiratory depression.
    const rateMod = m.respirationRate ?? 0;
    const depthMod = m.tidalVolume ?? 0;
    if (rateMod !== 0 || depthMod !== 0) {
      push('resp.drive', (1 + rateMod) * (1 + depthMod) - 1);
    }

    if (m.sedation !== undefined) push('neuro.sedation', m.sedation);

    // These two stay on the pattern target, because they are not drive at all. A
    // bronchodilator changes airway calibre and a paralytic changes whether the
    // muscles can answer the drive - a paralysed patient has enormous drive and no
    // ventilation, and routing either through drive would model them backwards.
    if (m.bronchodilation !== undefined) push('resp.tidalVolume', m.bronchodilation * 0.4);
    if (m.neuromuscularBlock !== undefined) push('resp.tidalVolume', -Math.abs(m.neuromuscularBlock));
    // Pulse's TubularPermeabilityModifier is positive for a diuretic: more permeable
    // tubule, less water reabsorbed. Our target has the opposite sense.
    if (m.tubularPermeability !== undefined) push('renal.waterReabsorption', -m.tubularPermeability);

    if (contributions.length > 0) {
      plans.set(d.id, {
        drugId: d.id,
        ec50_mg_per_L: pd.ec50_mg_per_L,
        hill: pd.emaxShape,
        contributions,
        gate: buildGate(pd.mediatedBy, drugs, receptors),
      });
    }
  }
  return plans;
}

/**
 * Who else can shut the site this block runs through.
 *
 * Every drug with a declared affinity at that receptor is a candidate, INCLUDING the
 * drug that owns the block if it happens to have one — a drug cannot compete with
 * itself here, but it also never appears twice, because a drug with its own affinity at
 * the site would have that target covered by `coveredTargets` and would not reach this
 * code with a contribution to gate in the first place.
 */
function buildGate(
  mediatedBy: string | null | undefined,
  drugs: Drug[],
  receptors: Receptor[],
): PulsePdPlan['gate'] {
  if (!mediatedBy) return null;
  const receptorIndex = receptors.findIndex((r) => r.id === mediatedBy);
  // A site the registry does not carry is a manifest typo, and silently ignoring it
  // would leave the antidote quietly not working again. Nothing throws inside the
  // engine, so the gate is dropped and the block behaves as it did before.
  if (receptorIndex < 0) return null;

  const blockers: { drugId: string; weight: number }[] = [];
  for (const d of drugs) {
    const t = d.targets.find((x) => x.receptorId === mediatedBy);
    if (!t || t.Ki_nM === null) continue;
    const weight = 1 - Math.max(0, Math.min(1, t.intrinsicActivity));
    if (weight > 0) blockers.push({ drugId: d.id, weight });
  }
  return { receptorIndex, blockers };
}

export function applyPulsePd(s: SimState, plans: Map<string, PulsePdPlan>, drugs: DrugPkState[]): void {
  for (const st of drugs) {
    const plan = plans.get(st.drugId);
    if (!plan || st.cp <= 0) continue;

    const c = Math.pow(st.cp, plan.hill);
    const e = Math.pow(plan.ec50_mg_per_L, plan.hill);
    let response = c / (e + c);

    // COMPETITION AT THE NAMED SITE. See the header: this is what lets flumazenil
    // reverse midazolam without inventing a benzodiazepine-site Ki for midazolam.
    if (plan.gate) {
      const rs = s.receptors[plan.gate.receptorIndex];
      let blocked = 0;
      for (const b of plan.gate.blockers) blocked += (rs.byLigand[b.drugId] ?? 0) * b.weight;
      response *= Math.max(0, 1 - blocked);
    }

    for (const contribution of plan.contributions) {
      addEffect(s.effects, contribution.target, contribution.gain * response);
    }
  }
}
