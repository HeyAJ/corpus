/**
 * CURATED RECEPTOR REGISTRY.
 *
 * GtoPdb tells you that a ligand binds a target and how tightly. It does not — and
 * cannot — tell you that beta-1 occupancy raises cardiac contractility, because
 * that is physiology, not a binding assay. So the pipeline merges two things:
 *
 *   - affinities and actions, SCRAPED from GtoPdb (tools/ingest/fetch_gtopdb.ts)
 *   - effect vectors, CURATED here with a textbook citation for each one
 *
 * The gains are `derived`, not `measured`: their *sign and relative magnitude* come
 * from the cited pharmacology, and the absolute scale is calibrated so that a
 * reference dose produces the response the same textbook describes. That is stated
 * in every entry's provenance and in docs/MODEL_LIMITATIONS.md. It is not the same
 * thing as inventing a number, and it is not presented as if it were measured.
 *
 * RECEPTOR RESERVE, and why `ec50Occupancy` is not 0.5.
 *
 * GtoPdb publishes BINDING affinities. For amplified GPCR signalling those are not
 * the same thing as functional potencies, and for the catecholamines they are not
 * even close: adrenaline's beta-1 binding Ki is 4467 nM, while its functional EC50
 * for inotropy in cardiac tissue is nanomolar. The difference is receptor reserve —
 * occupying a few per cent of the receptors saturates the downstream response,
 * because the signal is amplified at every step from G protein to second messenger
 * to kinase (Goodman & Gilman ch. 3; Rang & Dale ch. 2, "spare receptors").
 *
 * Ignoring that understates catecholamine potency by orders of magnitude, and it
 * showed up immediately: 1 mg of adrenaline — a cardiac-arrest dose — moved systolic
 * pressure by nine millimetres of mercury. So `ec50Occupancy` encodes the reserve:
 * it is the occupancy at which the downstream response is half-maximal, and for a
 * heavily amplified receptor that is a few per cent rather than half.
 *
 * `baselineTone` is on the same scale, and must be: it is the resting occupancy by
 * the endogenous ligand, and resting plasma noradrenaline is about 1-2 nM against a
 * beta-1 Ki in the micromolar range. Setting it there is also what lets a pure
 * antagonist work — a beta-blocker has an effect at rest precisely because there is
 * a small resting occupancy for it to displace.
 *
 * `activationModel` IS THE FIRST THING TO GET RIGHT ON A NEW ENTRY (ADR-025). It says
 * what the effect gains below are written RELATIVE TO, and therefore what
 * `intrinsicActivity` can mean for a drug that binds it:
 *
 *   'endogenous-agonist'  a receptor with an endogenous ligand. Gains are written for
 *                         the ACTIVATED state; `baselineTone` is load-bearing; a drug's
 *                         intrinsic activity is an efficacy fraction.
 *   'inhibition'          a constitutively active enzyme or an ion channel. Gains are
 *                         written for the INHIBITED or BLOCKED state; intrinsic activity
 *                         is only a direction. `baselineTone` here is the descriptive
 *                         claim that the target is active at rest, not a term in the
 *                         response.
 *   'transporter'         gains are written for "synaptic transmitter raised"; both a
 *                         reuptake inhibitor and a releaser drive them the same way;
 *                         `baselineTone` is zero.
 *
 * Getting this wrong does not make a drug weak, it makes it point backwards. Milrinone
 * was a negative inotrope and a vasoconstrictor, and every NSAID raised gastric pH,
 * for exactly this reason.
 */

import type { Receptor } from '../../src/data/pharma-types';

export { SOURCES } from './pharm_sources';
import { SOURCES } from './pharm_sources';

import type { SourceKey } from './pharm_sources';

function fx(target: string, gain: number, source: SourceKey, note: string) {
  return { target, gain, source: SOURCES[source].label, sourceUrl: SOURCES[source].url, note };
}

/**
 * `gtopdbName` is matched case-insensitively against GtoPdb's `Target` column so
 * the pipeline can attach the real target id and pull affinities. Where a receptor
 * family is represented by several GtoPdb rows, `gtopdbAliases` lists them.
 */
export type { Receptor };

export interface RegistryEntry extends Omit<Receptor, 'gtopdbTargetId'> {
  gtopdbName: string;
  gtopdbAliases: string[];
}

export const REGISTRY: RegistryEntry[] = [
  /* ----------------------------------------------------------- adrenergic */
  {
    id: 'alpha1', label: 'α1', group: 'adrenergic',
    gtopdbName: 'α1A-adrenoceptor', gtopdbAliases: ['α1B-adrenoceptor', 'α1D-adrenoceptor'],
    tissues: ['vasculature', 'kidney', 'gi', 'bladder'],
    baselineTone: 0.030, endogenousDriver: 'sympathetic', centralFraction: 0.10, ec50Occupancy: 0.15, hill: 1.2,
    activationModel: 'endogenous-agonist',
    effects: [
      fx('cardio.systemicResistance', 1.45, 'GG14', 'Arteriolar smooth-muscle contraction; the dominant pressor mechanism of phenylephrine and of high-dose noradrenaline.'),
      fx('vascular.tone', 1.0, 'GG14', 'Venoconstriction raises mean systemic filling pressure and therefore preload.'),
      fx('renal.vascularResistance', 0.55, 'GH14', 'Afferent arteriolar constriction; enough of it drops renal plasma flow.'),
      fx('cardio.contractility', 0.15, 'GG14', 'Weak positive inotropy in human myocardium; minor next to beta-1.'),
      fx('gi.motility', -0.25, 'RANG10', 'Sphincter contraction with reduced propulsive activity.'),
      fx('neuro.pupilDiameter', 0.4, 'GH14', 'Radial dilator pupillae contraction: sympathetic mydriasis. Why a sympathomimetic toxidrome has wide pupils and why phenylephrine is used to dilate them.'),
    ],
    notes: 'Gq-coupled. Modelled as the combined α1A/B/D response; the subtypes are not separated because no drug in the set discriminates them meaningfully.',
  },
  {
    id: 'alpha2', label: 'α2', group: 'adrenergic',
    gtopdbName: 'α2A-adrenoceptor', gtopdbAliases: ['α2B-adrenoceptor', 'α2C-adrenoceptor'],
    tissues: ['cns', 'vasculature', 'pancreas'],
    baselineTone: 0.025, endogenousDriver: 'sympathetic', centralFraction: 0.80, ec50Occupancy: 0.12, hill: 1.0,
    activationModel: 'endogenous-agonist',
    effects: [
      fx('cardio.systemicResistance', -0.55, 'GG14', 'Presynaptic autoreceptor: central sympatholysis dominates over the peripheral α2B vasoconstriction.'),
      fx('cardio.heartRate', -0.30, 'GG14', 'Reduced central sympathetic outflow plus increased vagal tone.'),
      fx('neuro.sedation', 0.55, 'GG14', 'Locus coeruleus α2A agonism; the basis of dexmedetomidine sedation.'),
      fx('metabolic.insulinSecretion', -0.30, 'RANG10', 'α2 on the beta cell inhibits insulin release.'),
    ],
    notes: 'Gi-coupled. The net cardiovascular sign is central, not peripheral, at clinically relevant occupancies.',
  },
  {
    id: 'beta1', label: 'β1', group: 'adrenergic',
    gtopdbName: 'β1-adrenoceptor', gtopdbAliases: [],
    tissues: ['heart', 'kidney'],
    baselineTone: 0.012, endogenousDriver: 'sympathetic', centralFraction: 0.00, ec50Occupancy: 0.05, hill: 1.0,
    activationModel: 'endogenous-agonist',
    effects: [
      fx('cardio.contractility', 1.60, 'GG14', 'Gs -> cAMP -> PKA -> increased L-type calcium current and SERCA activity. Gain calibrated so a 1 mg intravenous adrenaline bolus roughly doubles contractility, as the textbook describes.'),
      fx('cardio.heartRate', 1.70, 'GG14', 'Increased If and Ica in the sinoatrial node. Calibrated so direct beta-1 chronotropy OUTWEIGHS the reflex bradycardia that the simultaneous pressor response provokes: adrenaline causes net tachycardia, and a smaller gain made the model produce the opposite.'),
      fx('renal.reninRelease', 0.60, 'GH14', 'Juxtaglomerular β1 is the direct sympathetic route to renin release.'),
      fx('cardio.arrhythmogenicity', 0.70, 'GG14', 'Calcium loading and shortened refractoriness; why catecholamines lower the fibrillation threshold.'),
    ],
    notes: 'The principal cardiac adrenoceptor. Its effect gains set the scale for the whole catecholamine response.',
  },
  {
    id: 'beta2', label: 'β2', group: 'adrenergic',
    gtopdbName: 'β2-adrenoceptor', gtopdbAliases: [],
    tissues: ['lung', 'vasculature', 'skeletal muscle', 'liver'],
    baselineTone: 0.015, endogenousDriver: 'sympathetic', centralFraction: 0.05, ec50Occupancy: 0.08, hill: 1.0,
    activationModel: 'endogenous-agonist',
    effects: [
      fx('cardio.systemicResistance', -0.70, 'GG14', 'Skeletal-muscle arteriolar dilation; why low-dose adrenaline can lower diastolic pressure.'),
      fx('resp.tidalVolume', 0.35, 'GG14', 'Bronchial smooth-muscle relaxation lowers airway resistance.'),
      fx('metabolic.hepaticGlucoseOutput', 0.45, 'RANG10', 'Glycogenolysis and gluconeogenesis; the hyperglycaemia of a catecholamine surge.'),
      fx('cardio.contractility', 0.25, 'GG14', 'Human ventricle carries roughly 20-30% β2.'),
    ],
    notes: 'Gs-coupled. Also drives intracellular potassium shift, handled as a direct effect on serum K in the engine.',
  },
  {
    id: 'beta3', label: 'β3', group: 'adrenergic',
    gtopdbName: 'β3-adrenoceptor', gtopdbAliases: [],
    tissues: ['adipose', 'bladder', 'heart'],
    baselineTone: 0.005, endogenousDriver: 'sympathetic', centralFraction: 0.00, ec50Occupancy: 0.10, hill: 1.0,
    activationModel: 'endogenous-agonist',
    effects: [
      fx('thermal.heatProduction', 0.60, 'RANG10', 'Lipolysis and adaptive thermogenesis in adipose tissue.'),
    ],
    notes: 'Minor at the doses modelled here; present because thermogenesis is an explicit readout.',
  },

  /* --------------------------------------------------------- dopaminergic */
  {
    id: 'd1', label: 'D1', group: 'dopaminergic',
    gtopdbName: 'D1 receptor', gtopdbAliases: ['D5 receptor'],
    tissues: ['kidney', 'splanchnic vasculature', 'cns'],
    baselineTone: 0.005, endogenousDriver: 'none', centralFraction: 0.75, ec50Occupancy: 0.15, hill: 1.0,
    activationModel: 'endogenous-agonist',
    effects: [
      fx('renal.vascularResistance', -0.65, 'GG14', 'Renal and splanchnic vasodilation; the classical "renal dose" dopamine effect.'),
      fx('cardio.systemicResistance', -0.20, 'GG14', 'Splanchnic bed dilation contributes a modest systemic fall.'),
      fx('neuro.arousal', 0.35, 'RANG10', 'Striatal and cortical D1 signalling.'),
    ],
    notes: 'Gs-coupled.',
  },
  {
    id: 'd2', label: 'D2', group: 'dopaminergic',
    gtopdbName: 'D2 receptor', gtopdbAliases: ['D3 receptor', 'D4 receptor'],
    tissues: ['cns', 'pituitary', 'gi'],
    baselineTone: 0.010, endogenousDriver: 'none', centralFraction: 0.85, ec50Occupancy: 0.15, hill: 1.1,
    activationModel: 'endogenous-agonist',
    effects: [
      fx('neuro.arousal', 0.45, 'RANG10', 'Mesolimbic and nigrostriatal signalling.'),
      fx('gi.motility', -0.30, 'GG14', 'D2 on the myenteric plexus inhibits acetylcholine release; blockade is why metoclopramide is prokinetic.'),
    ],
    notes: 'Gi-coupled. Modelled as the D2-LIKE FAMILY (D2/D3/D4), which share Gi coupling and therefore the sign of every effect here; the tightest published affinity across the three is used, exactly as the alpha-1 entry treats its subtypes. No drug in the set discriminates them.',
  },

  /* --------------------------------------------------------- cholinergic */
  {
    id: 'm1', label: 'M1', group: 'cholinergic',
    gtopdbName: 'M1 receptor', gtopdbAliases: [],
    tissues: ['cns', 'autonomic ganglia', 'stomach'],
    baselineTone: 0.18, endogenousDriver: 'parasympathetic', centralFraction: 0.75, ec50Occupancy: 0.35, hill: 1.1,
    activationModel: 'endogenous-agonist',
    effects: [
      fx('neuro.arousal', 0.55, 'GG14', 'Cortical and hippocampal M1 underpins attention and memory; blockade is the mechanism of antimuscarinic delirium, which is the effect that distinguishes atropine from glycopyrrolate.'),
      fx('gi.acidSecretion', 0.40, 'GH14', 'Ganglionic and ECL-cell M1 amplifies vagally-driven acid secretion.'),
    ],
    notes: 'Gq-coupled. Added because atropine binds it more tightly than either M2 or M3 (891 pM against 630 pM and 158 pM in GtoPdb) and because its central blockade is the clinically visible difference between a tertiary and a quaternary antimuscarinic.',
  },
  {
    id: 'm2', label: 'M2', group: 'cholinergic',
    gtopdbName: 'M2 receptor', gtopdbAliases: [],
    tissues: ['heart'],
    baselineTone: 0.25, endogenousDriver: 'parasympathetic', centralFraction: 0.05, ec50Occupancy: 0.3, hill: 1.2,
    activationModel: 'endogenous-agonist',
    effects: [
      fx('cardio.heartRate', -0.95, 'GG14', 'Gi -> GIRK opening in the sinoatrial node; the fastest reflex effector in the body.'),
      fx('cardio.avNodalBlock', 0.80, 'GG14', 'Slowed atrioventricular conduction.'),
      fx('cardio.contractility', -0.20, 'GG14', 'Mostly atrial; ventricular vagal innervation is sparse.'),
    ],
    notes: 'Carries a high resting tone, which is why an antimuscarinic raises heart rate in a resting subject but does little during exercise.',
  },
  {
    id: 'm3', label: 'M3', group: 'cholinergic',
    gtopdbName: 'M3 receptor', gtopdbAliases: [],
    tissues: ['lung', 'gi', 'bladder', 'glands'],
    baselineTone: 0.20, endogenousDriver: 'parasympathetic', centralFraction: 0.10, ec50Occupancy: 0.35, hill: 1.1,
    activationModel: 'endogenous-agonist',
    effects: [
      fx('gi.motility', 0.70, 'GH14', 'Smooth-muscle contraction and propulsive peristalsis.'),
      fx('gi.acidSecretion', 0.65, 'GH14', 'Direct parietal-cell stimulation plus ECL histamine release.'),
      fx('resp.tidalVolume', -0.30, 'GG14', 'Bronchoconstriction raises airway resistance.'),
      fx('neuro.pupilDiameter', -0.8, 'GH14', 'Circular sphincter pupillae contraction under parasympathetic (oculomotor) tone. Written for the ACTIVATED receptor, so blockade removes the resting tone and the pupil DILATES: the mydriasis of atropine and of the anticholinergic toxidrome.'),
    ],
    notes: 'Gq-coupled.',
  },
  {
    id: 'm4', label: 'M4', group: 'cholinergic',
    gtopdbName: 'M4 receptor', gtopdbAliases: [],
    tissues: ['cns', 'striatum'],
    baselineTone: 0.15, endogenousDriver: 'parasympathetic', centralFraction: 0.90, ec50Occupancy: 0.35, hill: 1.1,
    activationModel: 'endogenous-agonist',
    effects: [
      fx('neuro.arousal', 0.25, 'CONCISE2023', 'Striatal M4 autoreceptors restrain cholinergic interneuron firing and modulate dopamine release.'),
      fx('neuro.sedation', -0.15, 'RANG10', 'Net arousing through the same striatal circuit.'),
    ],
    notes: 'Gi-coupled. Almost entirely central, so its contribution is gated to nothing for a drug that does not cross.',
  },
  {
    id: 'm5', label: 'M5', group: 'cholinergic',
    gtopdbName: 'M5 receptor', gtopdbAliases: [],
    tissues: ['cerebral vasculature', 'cns'],
    baselineTone: 0.10, endogenousDriver: 'parasympathetic', centralFraction: 0.85, ec50Occupancy: 0.35, hill: 1.0,
    activationModel: 'endogenous-agonist',
    effects: [
      fx('cardio.systemicResistance', -0.10, 'CONCISE2023', 'Cerebral arteriolar dilation. Small at the systemic level, because the cerebral bed is a few per cent of total peripheral resistance.'),
      fx('neuro.arousal', 0.15, 'CONCISE2023', 'Modulation of midbrain dopaminergic tone.'),
    ],
    notes: 'Gq-coupled and the least characterised of the five. Gains are deliberately small: the human physiology is not firmly enough established to justify anything larger.',
  },
  {
    id: 'nachr', label: 'nAChR', group: 'cholinergic',
    gtopdbName: 'nicotinic acetylcholine receptor alpha4beta2',
    gtopdbAliases: [
      'nicotinic acetylcholine receptor alpha7', 'nicotinic acetylcholine receptor',
      'nicotinic acetylcholine receptor α4β2', 'nicotinic acetylcholine receptor α7',
      // GtoPdb names the individual subunits, and its HTML-stripped form loses the
      // Greek letter entirely: "nicotinic acetylcholine receptor alpha3 subunit"
      // arrives as "nicotinic acetylcholine receptor 3 subunit". Without these,
      // nicotine — the drug the receptor is named after — matched nothing.
      // The names carry &alpha; entities, which cleanName decodes to the letter and
      // then expands back to the word alpha - so the matching form contains
      // alpha3, not 3. Written with the Greek letter here so the two agree.
      'nicotinic acetylcholine receptor α1 subunit', 'nicotinic acetylcholine receptor α2 subunit',
      'nicotinic acetylcholine receptor α3 subunit', 'nicotinic acetylcholine receptor α4 subunit',
      'nicotinic acetylcholine receptor α5 subunit', 'nicotinic acetylcholine receptor α6 subunit',
      'nicotinic acetylcholine receptor α7 subunit', 'nicotinic acetylcholine receptor α9 subunit',
      'nicotinic acetylcholine receptor α10 subunit',
      'nicotinic acetylcholine receptor β1 subunit', 'nicotinic acetylcholine receptor β2 subunit',
      'nicotinic acetylcholine receptor β4 subunit',
      'nicotinic acetylcholine receptor 1 subunit', 'nicotinic acetylcholine receptor 2 subunit',
      'nicotinic acetylcholine receptor 3 subunit', 'nicotinic acetylcholine receptor 4 subunit',
      'nicotinic acetylcholine receptor 5 subunit', 'nicotinic acetylcholine receptor 6 subunit',
      'nicotinic acetylcholine receptor 7 subunit', 'nicotinic acetylcholine receptor 9 subunit',
      'nicotinic acetylcholine receptor 10 subunit',
    ],
    tissues: ['ganglia', 'adrenal medulla', 'neuromuscular junction', 'cns'],
    baselineTone: 0.10, endogenousDriver: 'none', centralFraction: 0.60, ec50Occupancy: 0.4, hill: 1.4,
    activationModel: 'endogenous-agonist',
    effects: [
      fx('cardio.heartRate', 0.35, 'GG14', 'Ganglionic and adrenal-medullary activation; the net cardiovascular effect of nicotine is sympathetic.'),
      fx('neuro.arousal', 0.40, 'RANG10', 'Cortical and thalamic α4β2 signalling.'),
    ],
    notes: 'Ligand-gated cation channel. The neuromuscular subtype is not modelled separately; no drug in the current set is a blocker.',
  },

  /* -------------------------------------------------------- serotonergic */
  {
    id: 'ht1a', label: '5-HT1A', group: 'serotonergic',
    gtopdbName: '5-HT1A receptor', gtopdbAliases: [],
    tissues: ['cns'],
    baselineTone: 0.10, endogenousDriver: 'none', centralFraction: 0.95, ec50Occupancy: 0.35, hill: 1.0,
    activationModel: 'endogenous-agonist',
    effects: [
      fx('thermal.heatProduction', -0.35, 'RANG10', 'Somatodendritic autoreceptor activation produces hypothermia in humans.'),
      fx('neuro.sedation', 0.25, 'RANG10', 'Reduced raphe firing.'),
      fx('cardio.heartRate', -0.15, 'GG14', 'Central sympathoinhibition slows the sinus node modestly.'),
    ],
    notes: 'Gi-coupled.',
  },
  {
    id: 'ht2a', label: '5-HT2A', group: 'serotonergic',
    gtopdbName: '5-HT2A receptor', gtopdbAliases: [],
    tissues: ['cns', 'vasculature', 'platelets'],
    baselineTone: 0.08, endogenousDriver: 'none', centralFraction: 0.80, ec50Occupancy: 0.30, hill: 1.2,
    activationModel: 'endogenous-agonist',
    effects: [
      fx('cardio.systemicResistance', 0.40, 'GG14', 'Direct vascular smooth-muscle contraction.'),
      fx('thermal.heatProduction', 0.55, 'RANG10', 'Central 5-HT2A drives hyperthermia; the mechanism behind serotonin-toxicity temperature rise.'),
      fx('neuro.arousal', 0.50, 'CONCISE2023', 'Cortical layer V pyramidal excitation.'),
    ],
    notes: 'Gq-coupled. This entry exists because the reference app foregrounds it; no drug in the shipped set is a 5-HT2A agonist.',
  },
  {
    id: 'ht2c', label: '5-HT2C', group: 'serotonergic',
    gtopdbName: '5-HT2C receptor', gtopdbAliases: [],
    tissues: ['cns', 'choroid plexus'],
    baselineTone: 0.06, endogenousDriver: 'none', centralFraction: 0.95, ec50Occupancy: 0.35, hill: 1.1,
    activationModel: 'endogenous-agonist',
    effects: [
      fx('neuro.arousal', -0.20, 'RANG10', 'Net inhibitory through increased GABAergic and dopaminergic modulation.'),
      fx('metabolic.glucoseUptake', 0.15, 'CONCISE2023', 'Hypothalamic appetite and energy-balance signalling.'),
    ],
    notes: 'Gq-coupled.',
  },
  {
    id: 'ht3', label: '5-HT3', group: 'serotonergic',
    gtopdbName: '5-HT3 receptor',
    // GtoPdb indexes the assembled pentamers, not "5-HT3 receptor". Ondansetron,
    // metoclopramide and cocaine all matched nothing until these were added.
    gtopdbAliases: ['5-HT3A', '5-HT3AB', '5-HT3 receptor (all subtypes)'],
    tissues: ['gi', 'area postrema', 'vagal afferents'],
    baselineTone: 0.05, endogenousDriver: 'none', centralFraction: 0.35, ec50Occupancy: 0.4, hill: 1.5,
    activationModel: 'endogenous-agonist',
    effects: [
      fx('gi.motility', 0.45, 'GG14', 'Enteric 5-HT3 drives propulsive reflexes; blockade is constipating.'),
    ],
    notes: 'Ligand-gated cation channel, the only ionotropic serotonin receptor.',
  },

  /* ------------------------------------------------------- histaminergic */
  {
    id: 'h1', label: 'H1', group: 'histaminergic',
    gtopdbName: 'H1 receptor', gtopdbAliases: [],
    tissues: ['cns', 'vasculature', 'lung'],
    baselineTone: 0.15, endogenousDriver: 'none', centralFraction: 0.65, ec50Occupancy: 0.3, hill: 1.0,
    activationModel: 'endogenous-agonist',
    effects: [
      // RECALIBRATED FROM 0.60. Effect gains in this registry are calibrated rather than
      // measured - the citation fixes the direction and the mechanism, and the absolute
      // scale is fitted so a reference dose produces a textbook-sized response, which is
      // what the interface tells the user on first run. At 0.60 it did not: olanzapine 10 mg
      // reached 42 % H1 occupancy and produced a sedation score of 0.051, and
      // diphenhydramine 50 mg - a drug sold specifically as a sleep aid - produced 0.064.
      // Both are indistinguishable from nothing on a screen.
      //
      // Two terms cap this before the gain is even applied: baselineTone 0.15 means total
      // blockade can only remove 0.15 of tone, and centralFraction 0.65 then takes a third
      // of what is left. Those two are structural claims about the receptor and are left
      // alone; the gain is the knob that was always meant to carry the scale.
      fx('neuro.arousal', 1.50, 'GG14', 'Tuberomammillary histaminergic tone maintains wakefulness; blockade is why first-generation antihistamines sedate.'),
      fx('cardio.systemicResistance', -0.45, 'GG14', 'Endothelial NO release and direct vasodilation.'),
      fx('resp.tidalVolume', -0.20, 'RANG10', 'Histamine-mediated bronchoconstriction raises airway resistance.'),
    ],
    notes: 'Gq-coupled. Carries meaningful resting tone, so antagonism has an effect without any agonist present.',
  },
  {
    id: 'h2', label: 'H2', group: 'histaminergic',
    gtopdbName: 'H2 receptor', gtopdbAliases: [],
    tissues: ['stomach', 'heart'],
    baselineTone: 0.12, endogenousDriver: 'none', centralFraction: 0.05, ec50Occupancy: 0.3, hill: 1.0,
    activationModel: 'endogenous-agonist',
    effects: [
      fx('gi.acidSecretion', 0.85, 'GH14', 'The final common path for parietal-cell acid secretion; blockade is how H2 antagonists work.'),
      fx('cardio.heartRate', 0.25, 'GG14', 'Positive chronotropy at the sinoatrial node.'),
    ],
    notes: 'Gs-coupled.',
  },

  /* -------------------------------------------------------------- opioid */
  {
    id: 'mu', label: 'μ-opioid', group: 'opioid',
    gtopdbName: 'μ receptor', gtopdbAliases: ['MOP receptor', 'mu receptor', 'μ-opioid receptor'],
    tissues: ['cns', 'brainstem', 'gi'],
    baselineTone: 0.03, endogenousDriver: 'none', centralFraction: 0.75, ec50Occupancy: 0.25, hill: 1.4,
    activationModel: 'endogenous-agonist',
    effects: [
      fx('neuro.analgesia', 1.0, 'GG14', 'Spinal and supraspinal antinociception.'),
      {
        target: 'resp.drive',
        gain: -1.0,
        // RAISED FROM -0.85. At -0.85 a saturating mu agonist could depress central
        // respiratory drive by only 85%, leaving a residual the chemoreflex always
        // rescued: a behavioural sweep found fentanyl at the 10x multiplier plateauing
        // at a respiratory rate of 11 and SpO2 95%, when the defining lethal event of
        // opioid pharmacology is APNOEA — the abolition of respiratory rhythm, not its
        // attenuation. Saturating mu agonism silences the pre-Botzinger rhythm
        // generator outright, and the gain has to be able to reach that floor.
        source: 'Pattinson KTS. Opioids and the control of respiration. Br J Anaesth 100(6):747-758, 2008.',
        sourceUrl: 'https://doi.org/10.1093/bja/aen094',
        note:
          'Reduced sensitivity of the medullary chemoreceptors to CO2 AND depression of '
          + 'the pre-Botzinger rhythm generator: at full occupancy the two together abolish '
          + 'respiratory rhythm, which is the mechanism of opioid death and must be reachable, '
          + 'not merely approached.',
      },
      fx('neuro.sedation', 0.55, 'GG14', 'Dose-dependent depression of consciousness.'),
      {
        target: 'neuro.pupilDiameter',
        gain: -0.55,
        // Pinpoint pupils are THE bedside sign of opioid toxicity, and until the pupil had a
        // consumer (sim/systems/mind.ts) nothing needed this entry. At full activation it
        // takes a 3.5 mm resting pupil to about 1.6 mm, the pinpoint range.
        source: 'Knaggs RD, Crighton IM, Cobby TF, Fletcher AJ, Hobbs GJ. The pupillary effects of intravenous morphine, codeine, and tramadol in volunteers. Anesth Analg 99(1):108-112, 2004.',
        sourceUrl: 'https://doi.org/10.1213/01.ANE.0000116924.16535.BA',
        note:
          'Miosis via disinhibition of the Edinger-Westphal nucleus: mu agonism removes the '
          + 'GABAergic brake on the parasympathetic pupilloconstrictor outflow. Tolerance to it '
          + 'develops little, which is why it persists as a sign in chronic users.',
      },
      fx('gi.motility', -0.75, 'GG14', 'Enteric μ receptors suppress propulsive peristalsis.'),
      fx('cardio.heartRate', -0.20, 'GG14', 'Central vagal predominance.'),
    ],
    notes: 'Gi-coupled. The respiratory gain is deliberately large: this is the receptor that makes an overdose scenario behave correctly.',
  },
  {
    id: 'kappa', label: 'κ-opioid', group: 'opioid',
    gtopdbName: 'κ receptor', gtopdbAliases: ['KOP receptor', 'kappa receptor', 'κ-opioid receptor'],
    tissues: ['cns', 'spinal cord'],
    baselineTone: 0.02, endogenousDriver: 'none', centralFraction: 0.80, ec50Occupancy: 0.3, hill: 1.2,
    activationModel: 'endogenous-agonist',
    effects: [
      fx('neuro.analgesia', 0.6, 'GG14', 'Predominantly spinal antinociception.'),
      fx('neuro.sedation', 0.35, 'GG14', 'Sedation and dysphoria without meaningful respiratory depression.'),
      fx('renal.waterReabsorption', -0.35, 'RANG10', 'Inhibition of vasopressin release causes a water diuresis.'),
    ],
    notes: 'Gi-coupled. Notably spares respiratory drive, which is the pharmacological contrast with μ.',
  },

  {
    id: 'delta', label: 'δ-opioid', group: 'opioid',
    gtopdbName: 'δ receptor', gtopdbAliases: ['DOP receptor', 'delta receptor', 'δ-opioid receptor'],
    tissues: ['cns', 'spinal cord', 'gi'],
    baselineTone: 0.02, endogenousDriver: 'none', centralFraction: 0.85, ec50Occupancy: 0.30, hill: 1.2,
    activationModel: 'endogenous-agonist',
    effects: [
      fx('neuro.analgesia', 0.45, 'GG14', 'Spinal and supraspinal antinociception, weaker than mu at equivalent occupancy.'),
      fx('neuro.sedation', 0.15, 'GG14', 'Modest contribution to the overall depressant effect.'),
      fx('gi.motility', -0.25, 'RANG10', 'Enteric delta receptors add to the mu-mediated slowing of transit.'),
    ],
    notes: 'Gi-coupled. Added because every opioid in the set binds it within a factor of ten of mu (naloxone 63 nM, morphine 126 nM, fentanyl 159 nM), so dropping it understated what an opioid and its antagonist are both doing. Notably it does NOT carry a respiratory-drive gain: delta agonism spares ventilation, and that contrast with mu is the point of separating them.',
  },

  /* --------------------------------------------------------- amino acids */
  {
    id: 'gabaa', label: 'GABA-A', group: 'amino-acid',
    gtopdbName: 'GABAA receptor', gtopdbAliases: ['GABAA receptor alpha1beta2gamma2', 'GABA-A receptor'],
    tissues: ['cns'],
    baselineTone: 0.20, endogenousDriver: 'none', centralFraction: 1.00, ec50Occupancy: 0.3, hill: 1.6,
    activationModel: 'endogenous-agonist',
    effects: [
      fx('neuro.sedation', 1.0, 'GG14', 'Chloride conductance hyperpolarises cortical and thalamic neurons; the basis of every intravenous sedative-hypnotic in use.'),
      fx('resp.drive', -0.45, 'GG14', 'Central depression of respiratory rhythm generation, additive with μ-opioid.'),
      fx('cardio.systemicResistance', -0.35, 'GG14', 'Reduced central sympathetic outflow; the reason propofol drops blood pressure.'),
    ],
    notes: 'Ligand-gated chloride channel. Benzodiazepines and propofol are positive allosteric modulators, represented as partial agonism at the orthosteric site.',
  },
  {
    id: 'nmda', label: 'NMDA', group: 'amino-acid',
    gtopdbName: 'NMDA receptor', gtopdbAliases: ['GluN2A', 'GluN2B', 'GluN2C', 'GluN2D', 'GluN1', 'GluN1/GluN2A', 'GluN1/GluN2B'],
    tissues: ['cns'],
    baselineTone: 0.25, endogenousDriver: 'none', centralFraction: 1.00, ec50Occupancy: 0.35, hill: 1.3,
    activationModel: 'endogenous-agonist',
    effects: [
      fx('neuro.arousal', 0.70, 'GG14', 'Glutamatergic cortical excitation; channel blockade produces dissociative anaesthesia.'),
      fx('cardio.systemicResistance', 0.20, 'GG14', 'Blockade paradoxically raises pressure via central sympathetic activation — modelled as a negative on this positive gain.'),
    ],
    notes: 'Ligand-gated cation channel with a substantial resting tone, so a channel blocker such as ketamine has a large effect without any agonist present.',
  },

  /* -------------------------------------------------------- cannabinoid */
  {
    id: 'cb1', label: 'CB1', group: 'cannabinoid',
    gtopdbName: 'CB1 receptor', gtopdbAliases: [],
    tissues: ['cns', 'gi'],
    baselineTone: 0.05, endogenousDriver: 'none', centralFraction: 0.85, ec50Occupancy: 0.3, hill: 1.1,
    activationModel: 'endogenous-agonist',
    effects: [
      fx('neuro.sedation', 0.40, 'RANG10', 'Retrograde endocannabinoid signalling suppresses neurotransmitter release.'),
      fx('gi.motility', -0.40, 'RANG10', 'Enteric CB1 slows transit.'),
      fx('cardio.heartRate', 0.30, 'RANG10', 'Acute tachycardia from reduced vagal tone.'),
    ],
    notes: 'Gi-coupled.',
  },

  /* -------------------------------------------------------- transporters */
  {
    id: 'dat', label: 'DAT', group: 'transporter',
    gtopdbName: 'DAT', gtopdbAliases: ['dopamine transporter', 'SLC6A3', 'DAT (SLC6A3)'],
    tissues: ['cns'],
    baselineTone: 0, endogenousDriver: 'none', centralFraction: 0.95, ec50Occupancy: 0.35, hill: 1.2,
    activationModel: 'transporter',
    effects: [
      fx('neuro.arousal', 0.85, 'GG14', 'Raised synaptic dopamine in mesolimbic and striatal terminals.'),
      fx('cardio.heartRate', 0.20, 'GG14', 'Indirect sympathomimetic effect.'),
      fx('thermal.heatProduction', 0.30, 'RANG10', 'Contributes to stimulant hyperthermia.'),
    ],
    notes: 'Effect is driven by synaptic transmitter elevation, so both a reuptake inhibitor and a substrate/releaser raise it; a releaser raises it further. See the transporter handling in sim/pharma/pd.ts.',
  },
  {
    id: 'net', label: 'NET', group: 'transporter',
    gtopdbName: 'NET', gtopdbAliases: ['noradrenaline transporter', 'SLC6A2', 'NET (SLC6A2)'],
    tissues: ['cns', 'sympathetic terminals'],
    baselineTone: 0, endogenousDriver: 'none', centralFraction: 0.55, ec50Occupancy: 0.35, hill: 1.2,
    activationModel: 'transporter',
    effects: [
      fx('cardio.heartRate', 0.55, 'GG14', 'Raised synaptic noradrenaline at cardiac sympathetic terminals.'),
      fx('cardio.systemicResistance', 0.50, 'GG14', 'Raised noradrenaline at vascular α1.'),
      fx('neuro.arousal', 0.45, 'RANG10', 'Cortical noradrenergic tone.'),
      fx('neuro.pupilDiameter', 0.35, 'GH14', 'Raised noradrenaline at the iris dilator: the wide pupils of the sympathomimetic toxidrome (cocaine, amfetamines), the sign that separates it from the pinpoint pupils of opioid toxicity.'),
    ],
    notes: 'Same transporter semantics as DAT.',
  },
  {
    id: 'sert', label: 'SERT', group: 'transporter',
    gtopdbName: 'SERT', gtopdbAliases: ['serotonin transporter', 'SLC6A4', 'SERT (SLC6A4)'],
    tissues: ['cns', 'gi', 'platelets'],
    baselineTone: 0, endogenousDriver: 'none', centralFraction: 0.60, ec50Occupancy: 0.35, hill: 1.2,
    activationModel: 'transporter',
    effects: [
      fx('gi.motility', 0.40, 'GG14', 'Raised mucosal serotonin drives enteric reflexes; the reason SSRIs commonly cause nausea and loose stool.'),
      fx('thermal.heatProduction', 0.35, 'RANG10', 'Contributes to serotonin-toxicity hyperthermia.'),
      fx('neuro.arousal', 0.15, 'RANG10', 'Modest direct arousal effect.'),
    ],
    notes: 'Same transporter semantics as DAT.',
  },
  {
    id: 'taar1', label: 'TAAR1', group: 'trace-amine',
    gtopdbName: 'TA1 receptor', gtopdbAliases: ['TAAR1', 'trace amine-associated receptor 1', 'TA<sub>1</sub> receptor'],
    tissues: ['cns'],
    baselineTone: 0.02, endogenousDriver: 'none', centralFraction: 0.95, ec50Occupancy: 0.4, hill: 1.0,
    activationModel: 'endogenous-agonist',
    effects: [
      fx('neuro.arousal', 0.55, 'CONCISE2023', 'Trace-amine signalling modulates monoamine neuron firing.'),
      fx('thermal.heatProduction', 0.45, 'CONCISE2023', 'Contributes to amphetamine-type hyperthermia.'),
      fx('cardio.heartRate', 0.20, 'CONCISE2023', 'Indirect sympathomimetic effect.'),
    ],
    notes: 'Gs-coupled intracellular receptor. Present in the registry because the reference app displays it alongside DAT, which is exactly the inhibitor-versus-releaser distinction the schema encodes.',
  },

  /* ------------------------------------------------------------- peptide */
  {
    id: 'v1a', label: 'V1', group: 'peptide',
    gtopdbName: 'V1A receptor', gtopdbAliases: [],
    tissues: ['vasculature'],
    baselineTone: 0.05, endogenousDriver: 'none', centralFraction: 0.00, ec50Occupancy: 0.3, hill: 1.2,
    activationModel: 'endogenous-agonist',
    effects: [
      fx('cardio.systemicResistance', 0.90, 'GG14', 'Vasopressin-mediated vasoconstriction, independent of the adrenergic system — which is why it still works in acidosis.'),
    ],
    notes: 'Gq-coupled.',
  },
  {
    id: 'at1', label: 'AT1', group: 'peptide',
    gtopdbName: 'AT1 receptor', gtopdbAliases: [],
    tissues: ['vasculature', 'kidney', 'adrenal'],
    baselineTone: 0.10, endogenousDriver: 'none', centralFraction: 0.10, ec50Occupancy: 0.3, hill: 1.1,
    activationModel: 'endogenous-agonist',
    effects: [
      fx('cardio.systemicResistance', 0.80, 'GH14', 'Direct arteriolar constriction by angiotensin II.'),
      fx('renal.vascularResistance', 0.55, 'GH14', 'Preferential efferent arteriolar constriction maintains filtration fraction.'),
      fx('renal.waterReabsorption', 0.50, 'GH14', 'Aldosterone release and direct proximal tubular sodium reabsorption.'),
    ],
    notes: 'Gq-coupled.',
  },
  {
    id: 'insulin_r', label: 'Insulin-R', group: 'metabolic',
    gtopdbName: 'insulin receptor', gtopdbAliases: [],
    tissues: ['muscle', 'adipose', 'liver'],
    baselineTone: 0.15, endogenousDriver: 'none', centralFraction: 0.05, ec50Occupancy: 0.3, hill: 1.0,
    activationModel: 'endogenous-agonist',
    effects: [
      fx('metabolic.glucoseUptake', 1.0, 'GH14', 'GLUT4 translocation in muscle and adipose tissue.'),
      fx('metabolic.hepaticGlucoseOutput', -0.75, 'GH14', 'Suppression of gluconeogenesis and glycogenolysis.'),
    ],
    notes: 'Receptor tyrosine kinase. Endogenous insulin is modelled in systems/metabolic.ts; this entry lets exogenous insulin act through the same path.',
  },

  /* ----------------------------------------------------------- co-transport */
  {
    id: 'nkcc2', label: 'NKCC2', group: 'transporter',
    gtopdbName: 'Kidney-specific Na-K-Cl symporter',
    gtopdbAliases: ['Basolateral Na-K-Cl symporter', 'NKCC2', 'SLC12A1'],
    tissues: ['thick ascending limb'],
    baselineTone: 0, endogenousDriver: 'none', centralFraction: 0.00, ec50Occupancy: 0.30, hill: 1.0,
    activationModel: 'transporter',
    effects: [],
    notes:
      'The Na-K-2Cl symporter of the thick ascending limb, and the entire molecular target of a loop diuretic. ' +
      'ITS EFFECT VECTOR IS DELIBERATELY EMPTY. The consequence of blocking it is already computed by the tubular ' +
      'permeability model in systems/renal.ts, driven by the Pulse TubularPermeabilityModifier and its published ' +
      'EC50 — a better source than any gain curated here. Adding a second path to renal.waterReabsorption would ' +
      'double-count the same block. What this entry contributes is the measured affinity and a live occupancy ' +
      'readout, so the binding that drives the diuresis is visible next to the diuresis itself.',
  },

  /* ------------------------------------------------------------ purinergic */
  {
    id: 'a1', label: 'A1', group: 'peptide',
    gtopdbName: 'A1 receptor', gtopdbAliases: [],
    tissues: ['heart', 'cns', 'kidney'],
    baselineTone: 0.04, endogenousDriver: 'none', centralFraction: 0.25, ec50Occupancy: 0.25, hill: 1.5,
    activationModel: 'endogenous-agonist',
    effects: [
      fx('cardio.avNodalBlock', 1.0, 'GG14', 'Adenosine A1 opens GIRK in nodal tissue, producing transient complete atrioventricular block — the mechanism that terminates re-entrant SVT.'),
      fx('cardio.heartRate', -0.90, 'GG14', 'Profound sinoatrial slowing.'),
    ],
    notes: 'Gi-coupled. Added beyond the minimum set in spec 5.4 because adenosine is one of the nine reference drugs and A1 is its entire mechanism.',
  },
  {
    id: 'a2a', label: 'A2A', group: 'peptide',
    gtopdbName: 'A2A receptor', gtopdbAliases: [],
    tissues: ['vasculature', 'cns'],
    baselineTone: 0.04, endogenousDriver: 'none', centralFraction: 0.45, ec50Occupancy: 0.3, hill: 1.1,
    activationModel: 'endogenous-agonist',
    effects: [
      fx('cardio.systemicResistance', -0.55, 'GG14', 'Coronary and systemic vasodilation; the flushing and chest discomfort of an adenosine push.'),
      fx('neuro.arousal', -0.30, 'RANG10', 'Sleep-promoting; the target caffeine antagonises.'),
    ],
    notes: 'Gs-coupled. Added alongside A1 for the same reason.',
  },
];

/*
 * Part two lives in its own file for readability and is concatenated here. The
 * import sits at the bottom deliberately: REGISTRY_2 imports SOURCES and the
 * RegistryEntry type from this module, so a top-level import would be circular.
 */
import { REGISTRY_2 } from './receptor_registry_2';

REGISTRY.push(...REGISTRY_2);

export const RECEPTOR_IDS = REGISTRY.map((r) => r.id);
