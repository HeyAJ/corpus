import type { Drug, Receptor } from '../../data/pharma-types';
import type { ReceptorState, SimState } from '../core/state';
import { addEffect } from '../core/effects';

/**
 * PHARMACODYNAMICS (spec 5.3).
 *
 * Receptor occupancy with explicit binding KINETICS, not instantaneous equilibrium:
 *
 *   dOmega/dt = kon * C_free * (1 - Omega_total) - koff * Omega
 *
 * The (1 - Omega_total) term is shared across every ligand at a receptor, which is
 * the Gaddum competitive-antagonism correction: ligands compete for the same finite
 * pool of sites and the occupancies can never sum above 1.
 *
 * Why kinetics and not equilibrium: the ramp has a visible rise time. An
 * equilibrium model would make occupancy track plasma concentration instantly, and
 * the receptor chart would be a scaled copy of the plasma curve — which is both
 * wrong and boring. Note that kon only sets *how fast* equilibrium is reached; the
 * equilibrium occupancy itself is C/(C + Ki) and depends only on the measured Ki.
 * That is why a default kon is defensible where a default Ki would not be.
 *
 * ENDOGENOUS TONE. Each receptor carries a resting occupancy by its natural ligand
 * (noradrenaline at beta-1, acetylcholine at M2, ...). Drug effects are computed as
 * the *difference* from that resting state, which is the only way a pure antagonist
 * can do anything: it displaces tone it did not create.
 *
 * THREE ACTIVATION MODELS, NOT ONE (ADR-025). The paragraph above describes a
 * RECEPTOR. The registry also holds enzymes, ion channels and transporters, and for
 * those "displace the endogenous tone" is not merely an approximation, it is the wrong
 * sign. One generic formula was applied to all three and it inverted, by actual
 * measurement:
 *
 *   - milrinone, an INODILATOR, produced -75.8 % contractility and +51.8 % systemic
 *     resistance, because PDE3's effect vector is written for the INHIBITED enzyme and
 *     the tone-displacement formula can only ever subtract from baseline;
 *   - acetazolamide, a DIURETIC, cut urine output and raised PaCO2, identically;
 *   - ketorolac, ibuprofen and naproxen made the stomach LESS acidic and raised urine
 *     output, which is NSAID gastric and renal injury backwards;
 *   - amfetamine, a SYMPATHOMIMETIC, gave a heart rate of 45 and a mean pressure of 79,
 *     because `intrinsicActivity: -1` at a transporter whose tone is zero produced a
 *     large negative activation and ran backwards through NET's positive gains;
 *   - phenytoin, lidocaine and bupivacaine SPED UP cardiac conduction;
 *   - fluoxetine and sertraline were constipating and hypothermic.
 *
 * So the model is declared per target in the registry and each one says what its own
 * effect gains are written relative to. The switch below is the whole of it.
 *
 * ACTIVATION HAS A FLOOR OF ZERO, and that is the other half of the fix. The earlier
 * code clamped to [-1, 1] and `hillResponse` is odd, so an inverse agonist at full
 * occupancy did not merely abolish signalling, it drove the receptor to the mirror
 * image of full agonism. There is no such state: the floor of a signalling pathway is
 * "not signalling". Risperidone's 5-HT2A inverse agonism at 92 % occupancy therefore
 * drove `thermal.heatProduction` to about -65 %, which starved the alveolar
 * ventilation equation of CO2, crashed PaCO2 to 20 mmHg, vasoconstricted the cerebral
 * circulation and took consciousness from 0.877 to 0.117 — while `sedation` read
 * exactly 0.000 the whole time. With the floor at zero an inverse agonist can remove
 * all of a receptor's activity and no more, which is what an inverse agonist does.
 * The model has no term for constitutive activity separate from `baselineTone`, so it
 * cannot distinguish an inverse agonist from a neutral antagonist once the site is
 * saturated; that is a stated limitation and it is on the correct side of the line.
 */

export interface DrugTargetLink {
  drugId: string;
  receptorId: string;
  kon: number;
  koff: number;
  /** Efficacy or direction, depending on the target's activationModel. See ADR-025. */
  intrinsicActivity: number;
  /**
   * Fraction of this receptor's effect this ligand can actually reach, given the
   * receptor's central share and the drug's blood-brain barrier access. 1 for a
   * peripheral receptor or a lipophilic drug; well below 1 for, say, adrenaline at
   * the central alpha-2 autoreceptor, which it does not reach.
   */
  access: number;
}

/** Association rate applied when a target has a measured Ki but no measured kon. */
export function deriveKinetics(
  Ki_nM: number | null,
  kon: number | null,
  koff: number | null,
  defaultKon: number,
): { kon: number; koff: number } | null {
  if (kon !== null && koff !== null) return { kon, koff };
  if (Ki_nM === null || Ki_nM <= 0) return null;
  const k1 = kon ?? defaultKon;
  // Ki = koff / kon at equilibrium.
  return { kon: k1, koff: k1 * Ki_nM };
}

/**
 * Endogenous tone at a receptor right now, 0..1. Sympathetic and parasympathetic
 * receptors follow the reflex limbs, so a beta-blocker bites harder in a body that
 * is leaning on its sympathetic drive — which is exactly the clinical warning.
 */
export function endogenousTone(s: SimState, r: Receptor): number {
  switch (r.endogenousDriver) {
    case 'sympathetic':
      return Math.max(0, Math.min(1, r.baselineTone * (s.reflex.symp / 0.5)));
    case 'parasympathetic':
      return Math.max(0, Math.min(1, r.baselineTone * (s.reflex.vagal / 0.5)));
    default:
      return r.baselineTone;
  }
}

/**
 * Advance every receptor's occupancy and write the resulting effects onto the bus.
 * `links` is precomputed at load so the hot loop never touches the JSON.
 */
export function stepPd(
  s: SimState,
  dt: number,
  receptors: Receptor[],
  links: Map<string, DrugTargetLink[]>,
  drugConc: Map<string, number | null>,
): void {
  const dtMin = dt / 60;

  for (let i = 0; i < receptors.length; i++) {
    const r = receptors[i];
    const st = s.receptors[i];
    const ls = links.get(r.id);

    // --- binding kinetics --------------------------------------------------
    if (ls && ls.length > 0) {
      let occupied = 0;
      for (const l of ls) occupied += st.byLigand[l.drugId] ?? 0;
      const free = Math.max(0, 1 - occupied);

      let total = 0;
      for (const l of ls) {
        const c = drugConc.get(l.drugId);
        const omega = st.byLigand[l.drugId] ?? 0;
        if (c === null || c === undefined) {
          // No free concentration available (missing MW): the drug contributes
          // nothing rather than a guess. It still shows in the drug list.
          st.byLigand[l.drugId] = omega * Math.exp(-l.koff * dtMin);
          total += st.byLigand[l.drugId];
          continue;
        }
        // EXACT SOLUTION, NOT AN EULER STEP.
        //
        // Over one tick `free` is constant, so this is linear in omega:
        //     dOmega/dt = a - b*Omega,   a = kon*c*free,  b = koff
        // which has a closed form. The explicit step that used to be here,
        // `omega + (a - b*omega) * dtMin`, is only stable while b*dtMin < 2 - and
        // `koff = kon * Ki`, so a weak-affinity target blows straight past that. Aspirin
        // at COX-1 (Ki 562,341 nM) gives koff*dtMin = 56: every step computed
        // omega - 55*omega, clamped at zero, and the occupancy sat at EXACTLY zero
        // forever while the free concentration climbed past 950 nM. Aspirin did nothing,
        // paracetamol did nothing, caffeine's A1 arm was dead so caffeine SLOWED the
        // heart, and phenytoin's sodium-channel occupancy collapsed to zero halfway
        // through a loading infusion.
        //
        // The closed form is unconditionally stable at any koff and costs one exp().
        // The branch immediately above already used it for the washout case; it simply
        // was not used for the case that binds.
        const a = l.kon * c * free;
        const b = l.koff;
        const decay = Math.exp(-b * dtMin);
        const settled = b > 0 ? a / b : omega;
        const next = Math.max(0, Math.min(1, settled + (omega - settled) * decay));
        st.byLigand[l.drugId] = next;
        total += next;
      }

      // Numerical guard: normalise if the explicit step overshot the site pool.
      if (total > 1) {
        for (const l of ls) st.byLigand[l.drugId] /= total;
        total = 1;
      }
      st.total = total;
    } else {
      st.total = 0;
    }

    // --- signed activation -------------------------------------------------
    let activationNow: number;
    let activationRest: number;

    switch (r.activationModel) {
      case 'inhibition': {
        // ENZYME OR ION CHANNEL. There is no endogenous agonist and no tone to
        // displace: the effect vector is written for the INHIBITED state, so the
        // response follows how much of the target the drug is holding shut.
        //
        // `intrinsicActivity` is a DIRECTION here, not an efficacy. Every drug in the
        // set that binds one of these is an inhibitor or a blocker (IA <= 0) and drives
        // the vector as written. A positive value is an activator or channel opener and
        // drives it backwards, which `hillResponse` handles because it is odd.
        let engaged = 0;
        if (ls) {
          for (const l of ls) {
            const direction = l.intrinsicActivity > 0 ? -1 : 1;
            engaged += (st.byLigand[l.drugId] ?? 0) * l.access * direction;
          }
        }
        activationNow = clamp(engaged, -1, 1);
        // Nothing is inhibited at rest, so the reference state is zero and the drug's
        // whole occupancy is the signal. `baselineTone` deliberately does not appear:
        // the gains already describe the step from "constitutively active" to
        // "inhibited", and multiplying by the tone would count that step twice.
        activationRest = 0;
        break;
      }

      case 'transporter': {
        // The readout is SYNAPTIC TRANSMITTER, and the effect vector is written for
        // "transmitter raised". A reuptake inhibitor raises it by blocking clearance; a
        // substrate/releaser raises it by running the carrier backwards. Both signs of
        // `intrinsicActivity` therefore point the same way, which is exactly what the
        // registry entries for DAT, NET and SERT have said in prose since they were
        // written — there was simply no code here that read it.
        //
        // What the model does NOT do is make a releaser bigger than an inhibitor at the
        // same occupancy. No cited efficacy scale exists for that, so the distinction is
        // carried by affinity alone and the gap is stated in MODEL_LIMITATIONS.
        let engaged = 0;
        if (ls) for (const l of ls) engaged += (st.byLigand[l.drugId] ?? 0) * l.access;
        activationNow = clamp(engaged, 0, 1);
        activationRest = 0;
        break;
      }

      default: {
        // A RECEPTOR WITH AN ENDOGENOUS AGONIST. `intrinsicActivity` is efficacy
        // relative to that agonist, which is the only reading under which a fraction
        // means anything, and drug occupancy displaces the endogenous ligand
        // proportionally.
        const tone = endogenousTone(s, r);
        const remainingTone = tone * Math.max(0, 1 - st.total);
        let drugActivation = 0;
        if (ls) {
          for (const l of ls) {
            drugActivation += (st.byLigand[l.drugId] ?? 0) * l.intrinsicActivity * l.access;
          }
        }
        // Floor at zero: see the header. A pathway that is not signalling is the bottom
        // of the range, not the middle of it.
        activationNow = clamp(remainingTone + drugActivation, 0, 1);
        activationRest = clamp(tone, 0, 1);
        break;
      }
    }

    st.activation = activationNow;

    // --- downstream effects ------------------------------------------------
    const responseNow = hillResponse(activationNow, r.ec50Occupancy, r.hill);
    const responseRest = hillResponse(activationRest, r.ec50Occupancy, r.hill);
    const delta = responseNow - responseRest;

    if (delta !== 0) {
      for (const e of r.effects) {
        addEffect(s.effects, e.target, e.gain * delta);
      }
    }
  }
}

/**
 * Occupancy-to-effect transform, Hill/Emax form from spec 5.3, normalised so full
 * activation gives exactly 1.
 *
 *   E(A) = A^gamma / (EC50^gamma + A^gamma), normalised by E(1)
 *
 * IT IS ODD, AND THAT IS NOW ONLY USED IN ONE PLACE. The negative branch exists for a
 * channel opener or enzyme activator under `activationModel: 'inhibition'`, where a
 * positive intrinsic activity means "drives the effect vector backwards" and a signed
 * response is the natural way to say so. It is NOT how an inverse agonist is modelled:
 * at an `endogenous-agonist` target the activation passed in is floored at zero,
 * because there is no state below "not signalling". Reading the oddness as "an inverse
 * agonist mirrors an agonist" is what drove risperidone's 5-HT2A arm to a mirror-image
 * full agonist response and took the patient's consciousness with it. See stepPd.
 */
export function hillResponse(a: number, ec50: number, hill: number): number {
  const sign = a < 0 ? -1 : 1;
  const x = Math.abs(a);
  if (x <= 0) return 0;
  const xg = Math.pow(x, hill);
  const eg = Math.pow(ec50, hill);
  const raw = xg / (eg + xg);
  const full = 1 / (eg + 1);
  return sign * (raw / full);
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Build the drug -> receptor link table once at load. */
export function buildLinks(
  drugs: Drug[],
  receptors: Receptor[],
  defaultKon: number,
): Map<string, DrugTargetLink[]> {
  const known = new Set(receptors.map((r) => r.id));
  const map = new Map<string, DrugTargetLink[]>();
  for (const r of receptors) map.set(r.id, []);

  for (const d of drugs) {
    for (const t of d.targets) {
      if (!known.has(t.receptorId)) continue;
      const kin = deriveKinetics(t.Ki_nM, t.kon, t.koff, defaultKon);
      if (!kin) continue; // no affinity, no binding — never a guessed Ki
      const receptor = receptors.find((r) => r.id === t.receptorId)!;
      const penetration = d.pk.bbbPenetration;
      // No measured lipophilicity means we cannot claim the drug is excluded from
      // the brain, so it gets full access and the gap is reported rather than
      // silently assumed away.
      const access = penetration === null
        ? 1
        : 1 - receptor.centralFraction * (1 - penetration);

      map.get(t.receptorId)!.push({
        drugId: d.id,
        receptorId: t.receptorId,
        kon: kin.kon,
        koff: kin.koff,
        intrinsicActivity: t.intrinsicActivity,
        access,
      });
    }
  }
  return map;
}

export function createReceptorStates(receptors: Receptor[]): ReceptorState[] {
  // Resting activation is the endogenous tone for a receptor that has one, and zero for
  // an enzyme, a channel or a transporter — nothing is inhibited and nothing is blocked
  // before a drug arrives. Seeding those with `baselineTone` would put a non-zero
  // activation in the receptor panel for a body with no drugs in it.
  return receptors.map((r) => ({
    receptorId: r.id,
    byLigand: {},
    total: 0,
    activation: r.activationModel === 'endogenous-agonist' ? r.baselineTone : 0,
  }));
}
