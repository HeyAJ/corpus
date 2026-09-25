import { SOURCES } from './pharm_sources';
import type { RegistryEntry } from './receptor_registry';

/**
 * RECEPTOR REGISTRY, PART TWO.
 *
 * The original registry covered the emergency-drug set: adrenoceptors, muscarinics,
 * opioids, the monoamine transporters. This file adds what a WIDE therapeutic set
 * needs — the enzymes, ion channels and nuclear receptors that most of medicine
 * actually acts on.
 *
 * Split into its own file purely for readability. It is concatenated onto REGISTRY
 * and is subject to exactly the same rules: every effect gain carries a citation and
 * a note explaining the mechanism, and a receptor with no effect vector must say
 * DELIBERATELY EMPTY and explain why (tests/data/provenance.test.ts enforces both).
 *
 * A NOTE ON ENZYMES AND CHANNELS AS "RECEPTORS". Cyclo-oxygenase is not a receptor
 * and neither is Nav1.5. They are included here because the binding model — occupancy
 * as a function of free concentration and an affinity — describes a reversible
 * inhibitor binding an enzyme just as well as it describes an agonist binding a GPCR,
 * and GtoPdb publishes affinities for both in the same table. What changes is the
 * SIGN convention: for an enzyme or a channel the "agonist" is the inhibitor, so the
 * effect gains below are written for the INHIBITED state.
 *
 * THAT CONVENTION WAS WRITTEN DOWN HERE AND NOWHERE ELSE, WHICH IS WHY EVERY ONE OF
 * THESE ENTRIES WAS INVERTED. The paragraph above claimed "the intrinsic activity that
 * arrives from GtoPdb is negative"; it is not. `actionToIntrinsicActivity` maps
 * "Inhibitor / Inhibition" and "Channel blocker" to ZERO for a non-transporter, and the
 * engine's one generic formula could then only ever subtract from `baselineTone` — so
 * an inhibitor drove the effect vector backwards. Milrinone, an inodilator, produced
 * -75.8 % contractility and +51.8 % systemic resistance; acetazolamide, a diuretic,
 * reduced urine output; ketorolac made the stomach less acidic; phenytoin sped up
 * cardiac conduction. Every entry in this file was affected and none of it was visible
 * in the data, because the data was exactly as intended.
 *
 * The convention is now declared per entry as `activationModel: 'inhibition'` and read
 * by the engine (ADR-025). It is not a comment any more.
 */

function fx(target: string, gain: number, source: keyof typeof SOURCES, note: string) {
  return { target, gain, source: SOURCES[source].label, sourceUrl: SOURCES[source].url, note };
}

export const REGISTRY_2: RegistryEntry[] = [
  /* ------------------------------------------------------- serotonin, more */
  {
    id: 'ht1b', label: '5-HT1B', group: 'serotonergic',
    gtopdbName: '5-HT1B receptor', gtopdbAliases: ['5-HT1D receptor', '5-ht1e receptor', '5-HT1F receptor'],
    tissues: ['cns', 'cerebral vasculature'],
    baselineTone: 0.06, endogenousDriver: 'none', centralFraction: 0.85, ec50Occupancy: 0.30, hill: 1.0,
    activationModel: 'endogenous-agonist',
    effects: [
      fx('cardio.systemicResistance', 0.25, 'GG14', 'Cranial vasoconstriction; the mechanism by which triptans abort a migraine, and the reason they are contraindicated in coronary disease.'),
      fx('neuro.anxiety', -0.20, 'RANG10', 'Terminal autoreceptor: reduces serotonin release, with a net anxiolytic effect at steady state.'),
    ],
    notes: 'Gi-coupled. Modelled as the 5-HT1B/1D/1E/1F group, which share Gi coupling and the sign of every effect; no drug in this set discriminates them.',
  },
  {
    id: 'ht6', label: '5-HT6', group: 'serotonergic',
    gtopdbName: '5-HT6 receptor', gtopdbAliases: [],
    tissues: ['cns', 'striatum'],
    baselineTone: 0.05, endogenousDriver: 'none', centralFraction: 0.95, ec50Occupancy: 0.35, hill: 1.0,
    activationModel: 'endogenous-agonist',
    effects: [
      fx('neuro.arousal', -0.25, 'CONCISE2023', 'Gs-coupled and almost entirely striatal; blockade is procognitive, which is why it is an antipsychotic target.'),
    ],
    notes: 'Gs-coupled. Present because the atypical antipsychotics and the tricyclics both bind it with meaningful affinity.',
  },
  {
    id: 'ht7', label: '5-HT7', group: 'serotonergic',
    gtopdbName: '5-HT7 receptor', gtopdbAliases: [],
    tissues: ['cns', 'vasculature', 'gi'],
    baselineTone: 0.05, endogenousDriver: 'none', centralFraction: 0.75, ec50Occupancy: 0.30, hill: 1.0,
    activationModel: 'endogenous-agonist',
    effects: [
      fx('cardio.systemicResistance', -0.30, 'CONCISE2023', 'Smooth-muscle relaxation; contributes to the hypotension of several antipsychotics.'),
      fx('neuro.sedation', 0.25, 'RANG10', 'Suprachiasmatic signalling; involved in sleep architecture and circadian phase.'),
    ],
    notes: 'Gs-coupled.',
  },

  /* ------------------------------------------------------ dopamine, more */
  {
    id: 'd3', label: 'D3', group: 'dopaminergic',
    gtopdbName: 'D3 receptor', gtopdbAliases: ['D4 receptor'],
    tissues: ['cns', 'limbic'],
    baselineTone: 0.01, endogenousDriver: 'none', centralFraction: 0.95, ec50Occupancy: 0.20, hill: 1.1,
    activationModel: 'endogenous-agonist',
    effects: [
      fx('neuro.arousal', 0.35, 'RANG10', 'Limbic D3/D4; the preferential limbic distribution is the usual explanation for why some antipsychotics are less extrapyramidal.'),
      fx('neuro.dependence', 0.45, 'GG14', 'Mesolimbic reward signalling.'),
    ],
    notes: 'Gi-coupled. Modelled as the D3/D4 pair, separately from the D2 entry, because several antipsychotics bind them an order of magnitude apart from D2 and that selectivity is their selling point.',
  },

  /* -------------------------------------------------------------- enzymes */
  {
    id: 'cox1', label: 'COX-1', group: 'enzyme',
    gtopdbName: 'COX-1', gtopdbAliases: ['cyclooxygenase-1', 'PTGS1', 'prostaglandin-endoperoxide synthase 1'],
    tissues: ['platelets', 'stomach', 'kidney'],
    baselineTone: 0.60, endogenousDriver: 'none', centralFraction: 0.05, ec50Occupancy: 0.50, hill: 1.0,
    activationModel: 'inhibition',
    effects: [
      fx('blood.plateletAggregation', -0.85, 'GG14', 'Platelet thromboxane A2 synthesis. Platelets have no nucleus and cannot resynthesise the enzyme, which is why aspirin lasts the platelet lifespan and ibuprofen does not.'),
      fx('gi.acidSecretion', 0.35, 'GG14', 'Loss of the protective prostaglandins that restrain acid and maintain mucus; the mechanism of NSAID ulceration.'),
      fx('renal.vascularResistance', 0.30, 'GH14', 'Loss of prostaglandin-mediated afferent dilation. Harmless in a well-perfused kidney and dangerous in a hypovolaemic one, which is the whole clinical point.'),
    ],
    notes: 'Constitutive isoform. Carries a high resting tone because it is constitutively active, so an inhibitor has an effect with no agonist present.',
  },
  {
    id: 'cox2', label: 'COX-2', group: 'enzyme',
    gtopdbName: 'COX-2', gtopdbAliases: ['cyclooxygenase-2', 'PTGS2', 'prostaglandin-endoperoxide synthase 2'],
    tissues: ['inflamed tissue', 'cns', 'kidney'],
    baselineTone: 0.25, endogenousDriver: 'none', centralFraction: 0.40, ec50Occupancy: 0.50, hill: 1.0,
    activationModel: 'inhibition',
    effects: [
      fx('immune.inflammation', -0.80, 'GG14', 'Inducible isoform: the prostaglandins of inflammation. This is the therapeutic target of every NSAID.'),
      fx('neuro.analgesia', 0.55, 'GG14', 'Peripheral and central sensitisation both fall when prostaglandin E2 does.'),
      fx('thermal.setPoint', -0.70, 'GH14', 'Hypothalamic PGE2 sets the febrile temperature; blocking it is exactly what an antipyretic does.'),
    ],
    notes: 'Inducible isoform. Its separation from COX-1 is the entire rationale for the coxibs, and the residual cardiovascular risk of selective inhibition is the reason that separation is not as clean as it was hoped.',
  },
  {
    id: 'hmgcr', label: 'HMG-CoA reductase', group: 'enzyme',
    gtopdbName: 'hydroxymethylglutaryl-CoA reductase', gtopdbAliases: ['HMGCR', 'HMG-CoA reductase'],
    tissues: ['liver'],
    baselineTone: 0.50, endogenousDriver: 'none', centralFraction: 0.02, ec50Occupancy: 0.40, hill: 1.0,
    activationModel: 'inhibition',
    effects: [
      fx('metabolic.lipidSynthesis', -0.90, 'GG14', 'The rate-limiting step of hepatic cholesterol synthesis. Inhibiting it upregulates the LDL receptor, and that upregulation — not the synthesis block itself — is what lowers plasma LDL.'),
    ],
    notes: 'Hepatic and essentially not central, which is why statin lipophilicity matters for the muscle and CNS side effects rather than for the efficacy.',
  },
  {
    id: 'carbonic_anhydrase', label: 'Carbonic anhydrase', group: 'enzyme',
    gtopdbName: 'carbonic anhydrase 2', gtopdbAliases: ['carbonic anhydrase 1', 'carbonic anhydrase 4', 'carbonic anhydrase 7', 'carbonic anhydrase 12', 'carbonic anhydrase 14'],
    tissues: ['kidney', 'eye', 'red cell', 'cns'],
    baselineTone: 0.70, endogenousDriver: 'none', centralFraction: 0.30, ec50Occupancy: 0.55, hill: 1.0,
    activationModel: 'inhibition',
    effects: [
      fx('renal.sodiumReabsorption', -0.55, 'GH14', 'Proximal tubular bicarbonate reabsorption depends on it; inhibition produces a bicarbonate diuresis and a metabolic acidosis.'),
      fx('renal.waterReabsorption', -0.30, 'GH14', 'Water follows the unreabsorbed solute.'),
      // A `resp.drive +0.40` effect stood here until 2026-09-25, as a stand-in for the
      // metabolic acidosis the bicarbonate diuresis causes. It was removed because it
      // put the consequence on the wrong clock: a receptor effect acts as fast as the
      // drug binds, so a 250 mg tablet dropped PaCO2 by 7.7 mmHg within three minutes,
      // where the real ventilatory stimulation follows the acidosis over hours to a day.
      // It was also not a receptor action at all, so no blood-brain barrier rule could
      // gate it correctly. The acidosis itself (and so acetazolamide's altitude benefit)
      // is not modelled; MODEL_LIMITATIONS records it rather than keeping a shortcut
      // that is right in direction and wrong in time.
    ],
    notes: 'Modelled as the isoform family, which no drug in this set discriminates. Constitutively active, so the resting tone is high and an inhibitor acts immediately.',
  },
  {
    id: 'pde3', label: 'PDE3', group: 'enzyme',
    gtopdbName: 'phosphodiesterase 3A', gtopdbAliases: ['phosphodiesterase 3B', 'PDE3A', 'PDE3B'],
    tissues: ['heart', 'vasculature', 'platelets'],
    baselineTone: 0.55, endogenousDriver: 'none', centralFraction: 0.05, ec50Occupancy: 0.45, hill: 1.0,
    activationModel: 'inhibition',
    effects: [
      fx('cardio.contractility', 0.95, 'GG14', 'Inhibition raises cardiac cAMP without touching a beta receptor. That is why an inodilator still works in a heart that is beta-blocked or beta-downregulated — the classic reason to reach for milrinone.'),
      fx('cardio.systemicResistance', -0.65, 'GG14', 'The same raised cAMP relaxes vascular smooth muscle, so the inotropy comes with vasodilation. Inodilator, not inotrope.'),
      fx('cardio.arrhythmogenicity', 0.40, 'GG14', 'Raised cAMP loads the cell with calcium by the same route a catecholamine does, with the same arrhythmic cost.'),
    ],
    notes: 'The cAMP-specific isoform of the myocardium. Constitutively active, hence the resting tone.',
  },

  /* ------------------------------------------------------ nuclear receptors */
  {
    id: 'glucocorticoid', label: 'Glucocorticoid-R', group: 'nuclear',
    gtopdbName: 'Glucocorticoid receptor', gtopdbAliases: ['NR3C1'],
    tissues: ['immune', 'liver', 'muscle', 'lung'],
    baselineTone: 0.30, endogenousDriver: 'none', centralFraction: 0.30, ec50Occupancy: 0.30, hill: 1.2,
    activationModel: 'endogenous-agonist',
    effects: [
      fx('immune.inflammation', -0.95, 'GG14', 'Transrepression of NF-kB and AP-1. The broadest anti-inflammatory mechanism in medicine.'),
      fx('metabolic.hepaticGlucoseOutput', 0.55, 'GH14', 'Gluconeogenesis from amino acids; the reason steroids raise blood sugar.'),
      fx('metabolic.proteinCatabolism', 0.60, 'GH14', 'Skeletal muscle breakdown supplying the substrate.'),
      fx('cardio.systemicResistance', 0.25, 'GG14', 'Permissive: catecholamines act poorly on a glucocorticoid-deficient vasculature, which is what makes an adrenal crisis a vasoplegic shock.'),
      fx('resp.bronchodilation', 0.45, 'GG14', 'Not direct relaxation — restored beta-2 responsiveness and reduced airway inflammation over hours.'),
    ],
    notes: 'A NUCLEAR receptor: it works by changing transcription, so its effects take hours, not seconds. The model applies them with the same instantaneous occupancy every other receptor uses, which overstates the speed considerably; recorded in docs/MODEL_LIMITATIONS.md.',
  },
  {
    id: 'mineralocorticoid', label: 'Mineralocorticoid-R', group: 'nuclear',
    gtopdbName: 'Mineralocorticoid receptor', gtopdbAliases: ['NR3C2'],
    tissues: ['kidney', 'heart', 'vasculature'],
    baselineTone: 0.35, endogenousDriver: 'none', centralFraction: 0.05, ec50Occupancy: 0.30, hill: 1.2,
    activationModel: 'endogenous-agonist',
    effects: [
      fx('renal.sodiumReabsorption', 0.85, 'GH14', 'The aldosterone receptor. Collecting-duct ENaC and Na/K-ATPase.'),
      fx('renal.potassiumExcretion', 0.75, 'GH14', 'The other half of the same exchange, and the reason an antagonist causes hyperkalaemia.'),
      fx('renal.waterReabsorption', 0.35, 'GH14', 'Water follows the reabsorbed sodium.'),
    ],
    notes: 'Shares the endogenous ligand aldosterone with the endocrine model, so an exogenous antagonist and the body’s own hormone compete at the same site. Nuclear, so the same speed caveat as the glucocorticoid receptor applies.',
  },

  /* ---------------------------------------------------------- ion channels */
  {
    id: 'nav', label: 'Nav', group: 'channel',
    gtopdbName: 'Nav1.5', gtopdbAliases: ['Nav1.1', 'Nav1.2', 'Nav1.3', 'Nav1.4', 'Nav1.6', 'Nav1.7', 'Nav1.8'],
    tissues: ['heart', 'nerve', 'muscle'],
    baselineTone: 0.50, endogenousDriver: 'none', centralFraction: 0.45, ec50Occupancy: 0.45, hill: 1.2,
    activationModel: 'inhibition',
    effects: [
      fx('cardio.conductionVelocity', -0.80, 'GG14', 'Phase-0 upstroke velocity falls, so conduction slows and the QRS widens. The class I antiarrhythmic action, and the toxicity of a local anaesthetic that reaches the circulation.'),
      fx('cardio.contractility', -0.30, 'GG14', 'Indirect, through reduced sodium-calcium exchange.'),
      fx('neuro.seizureThreshold', 0.55, 'RANG10', 'Use-dependent block of repetitive firing; the mechanism of phenytoin, carbamazepine and lamotrigine.'),
      fx('neuro.analgesia', 0.40, 'GG14', 'Blocking propagation in a peripheral nerve is what local anaesthesia is.'),
    ],
    notes: 'Modelled as the voltage-gated sodium channel family. The subtypes matter enormously in reality — Nav1.5 is cardiac and Nav1.7 is nociceptive — and collapsing them means this model cannot represent a subtype-selective drug. Stated in docs/MODEL_LIMITATIONS.md.',
  },
  {
    id: 'cav', label: 'Cav (L-type)', group: 'channel',
    gtopdbName: 'Cav1.2', gtopdbAliases: ['Cav1.1', 'Cav1.3', 'Cav1.4'],
    tissues: ['heart', 'vasculature'],
    baselineTone: 0.50, endogenousDriver: 'none', centralFraction: 0.10, ec50Occupancy: 0.45, hill: 1.2,
    activationModel: 'inhibition',
    effects: [
      fx('cardio.systemicResistance', -0.85, 'GG14', 'Arteriolar smooth-muscle relaxation. The dihydropyridines are nearly pure vasodilators because vascular Cav1.2 is in a state they bind preferentially.'),
      fx('cardio.contractility', -0.55, 'GG14', 'Reduced calcium entry during the plateau. Pronounced for verapamil and diltiazem, minimal for the dihydropyridines.'),
      fx('cardio.heartRate', -0.45, 'GG14', 'Sinoatrial depolarisation is a calcium current, so a rate-limiting calcium blocker slows it directly.'),
      fx('cardio.avNodalBlock', 0.70, 'GG14', 'Atrioventricular conduction is calcium-dependent too, which is why verapamil terminates a re-entrant SVT.'),
    ],
    notes: 'L-type. The model does not separate vascular from cardiac Cav1.2, so it cannot reproduce the difference between amlodipine and verapamil from affinity alone; each drug carries that distinction as a direct effect instead.',
  },
  {
    id: 'herg', label: 'hERG / Kv11.1', group: 'channel',
    // ALIASES NARROWED TO THE THING THIS ENTRY ACTUALLY IS. It used to accept Kv1.5,
    // Kv1.7, Kv1.8 and Kv10.1 as well, on the reading that they are all "the
    // delayed-rectifier group". They are not: Kv1.5 carries the atrial IKur, Kv10.1 is
    // EAG1, and Kv1.7 and Kv1.8 are neither cardiac nor delayed rectifiers. Only Kv11.1
    // carries IKr, and IKr is what the two effect gains below describe.
    //
    // Every hERG affinity in the shipped set came in through one of those four aliases
    // and none through Kv11.1: verapamil from a Kv1.7 pKd of 4.8 (15,849 nM, which is
    // not a concentration any preset reaches), haloperidol from Kv10.1, bupivacaine from
    // Kv1.5. A receptor panel row reading "hERG / Kv11.1  Ki 15,849 nM" for verapamil is
    // a fabricated claim assembled out of real numbers, which is the worst kind.
    //
    // The consequence is that no drug in the set now binds this entry — GtoPdb's Kv11.1
    // rows are dofetilide, astemizole, cisapride, terfenadine and similar, none of which
    // are modelled. It is kept because its effect vector is correct and because the next
    // drug added may well be one of those; it is reported as unoccupied rather than
    // quietly filled from a neighbouring channel.
    gtopdbName: 'Kv11.1', gtopdbAliases: ['hERG', 'KCNH2', 'ERG1', 'Kv11.1 channel'],
    tissues: ['heart'],
    baselineTone: 0.50, endogenousDriver: 'none', centralFraction: 0.02, ec50Occupancy: 0.40, hill: 1.1,
    activationModel: 'inhibition',
    effects: [
      fx('cardio.qtInterval', 0.90, 'GG14', 'The rapid delayed-rectifier potassium current repolarises the ventricle. Block it and repolarisation is delayed, which is QT prolongation.'),
      fx('cardio.arrhythmogenicity', 0.65, 'GG14', 'A prolonged repolarisation invites early afterdepolarisations and torsades de pointes. This channel is the reason a drug can be withdrawn for an electrocardiographic finding alone.'),
    ],
    notes: 'The single most important off-target in modern drug development. Modelled as the delayed-rectifier group.',
  },

  /* --------------------------------------------------------- purinergic */
  {
    id: 'p2y12', label: 'P2Y12', group: 'purinergic',
    gtopdbName: 'P2Y12 receptor', gtopdbAliases: [],
    tissues: ['platelets'],
    baselineTone: 0.20, endogenousDriver: 'none', centralFraction: 0.00, ec50Occupancy: 0.30, hill: 1.0,
    activationModel: 'endogenous-agonist',
    effects: [
      fx('blood.plateletAggregation', 0.90, 'GG14', 'ADP-driven amplification of platelet activation. Blocking it is the second antiplatelet pathway, independent of thromboxane, which is why dual therapy is additive.'),
    ],
    notes: 'Gi-coupled and entirely platelet. Clopidogrel binds it irreversibly after hepatic activation; ticagrelor reversibly and without needing activation, and the model represents neither difference.',
  },
  {
    id: 'cyslt1', label: 'CysLT1', group: 'peptide',
    gtopdbName: 'CysLT1 receptor', gtopdbAliases: [],
    tissues: ['lung', 'immune'],
    baselineTone: 0.12, endogenousDriver: 'none', centralFraction: 0.05, ec50Occupancy: 0.30, hill: 1.1,
    activationModel: 'endogenous-agonist',
    effects: [
      fx('resp.bronchodilation', -0.60, 'GG14', 'Cysteinyl leukotrienes are among the most potent bronchoconstrictors known; antagonism relieves it.'),
      fx('immune.inflammation', 0.40, 'RANG10', 'Eosinophil recruitment and mucus secretion.'),
      fx('vascular.permeability', 0.35, 'RANG10', 'Leukotriene-mediated oedema.'),
    ],
    notes: 'Gq-coupled. Carries a resting tone because leukotriene production is ongoing in an inflamed airway, so an antagonist works without an added agonist.',
  },

  /* ------------------------------------------------------ peptide, more */
  {
    id: 'v2', label: 'V2', group: 'peptide',
    gtopdbName: 'V2 receptor', gtopdbAliases: ['OT receptor', 'V1B receptor'],
    tissues: ['kidney'],
    baselineTone: 0.15, endogenousDriver: 'none', centralFraction: 0.00, ec50Occupancy: 0.30, hill: 1.2,
    activationModel: 'endogenous-agonist',
    effects: [
      fx('renal.waterReabsorption', 0.90, 'GH14', 'Aquaporin-2 insertion into the collecting-duct apical membrane. This is the antidiuretic action proper; the V1A vasoconstriction is a separate receptor.'),
    ],
    notes: 'Gs-coupled, and the reason vasopressin has two quite different jobs depending on which receptor the concentration is high enough to reach.',
  },
  {
    id: 'glucagon_r', label: 'Glucagon-R', group: 'metabolic',
    gtopdbName: 'glucagon receptor', gtopdbAliases: ['GCGR'],
    tissues: ['liver'],
    baselineTone: 0.20, endogenousDriver: 'none', centralFraction: 0.00, ec50Occupancy: 0.30, hill: 1.0,
    activationModel: 'endogenous-agonist',
    effects: [
      // CALIBRATED, not textbook: 0.90 until 2026-09-25, when the target it writes was
      // finally consumed (metabolic.ts) and 1 mg of glucagon still raised glucose by only
      // 3 mg/dL. 28 is the gain at which 1 mg reproduces the label's mean glucose peaks
      // (SC 136, IM 138 mg/dL; model ~137 and ~136 at ~22 min) with the label's own
      // absorption (route_presets.ts). Its size is a statement about this glucose model,
      // whose insulin feedback is stiff (see MODEL_LIMITATIONS), not about the receptor;
      // the hepatic output it implies at the peak, a few times basal, is inside what a
      // pharmacological glucagon dose really produces.
      fx('metabolic.glycogenolysis', 28, 'GLUCAGEN', 'Hepatic glycogen phosphorylase activation: the fast defence against hypoglycaemia, and useless once glycogen is gone. Gain calibrated so 1 mg SC reproduces the label glucose peak.'),
      fx('metabolic.hepaticGlucoseOutput', 0.80, 'GH14', 'Gluconeogenesis and glycogenolysis together.'),
      fx('cardio.contractility', 0.45, 'GG14', 'Gs-coupled in myocardium, and critically it bypasses the beta receptor entirely — which is why glucagon is the antidote to beta-blocker overdose.'),
      fx('cardio.heartRate', 0.35, 'GG14', 'Same mechanism, same bypass.'),
    ],
    notes: 'Gs-coupled. Shares its endogenous ligand with the endocrine model, so the hormone and any exogenous dose act at the same site.',
  },
  {
    id: 'glp1_r', label: 'GLP-1R', group: 'metabolic',
    gtopdbName: 'GLP-1 receptor', gtopdbAliases: ['GLP1R'],
    tissues: ['pancreas', 'stomach', 'cns'],
    baselineTone: 0.10, endogenousDriver: 'none', centralFraction: 0.35, ec50Occupancy: 0.25, hill: 1.1,
    activationModel: 'endogenous-agonist',
    effects: [
      fx('metabolic.insulinSecretion', 0.75, 'GG14', 'Glucose-DEPENDENT insulin secretion, which is why a GLP-1 agonist alone essentially does not cause hypoglycaemia.'),
      fx('gi.motility', -0.50, 'GG14', 'Marked slowing of gastric emptying, which blunts the post-prandial glucose excursion and causes most of the nausea.'),
      fx('gi.appetite', -0.65, 'GG14', 'Hypothalamic and brainstem signalling; the mechanism behind the weight effect.'),
    ],
    notes: 'Gs-coupled incretin receptor.',
  },

  {
    id: 'xanthine_oxidase', label: 'Xanthine oxidase', group: 'enzyme',
    gtopdbName: 'xanthine dehydrogenase', gtopdbAliases: ['xanthine oxidase', 'XDH'],
    tissues: ['liver', 'gut'],
    baselineTone: 0.60, endogenousDriver: 'none', centralFraction: 0.05, ec50Occupancy: 0.50, hill: 1.0,
    activationModel: 'inhibition',
    effects: [
      fx('metabolic.urateProduction', -0.85, 'GG14', 'The final two steps of purine catabolism, hypoxanthine to xanthine to urate. Inhibiting it is the only way to lower urate production rather than merely excrete more of it.'),
    ],
    notes: 'Added after the pipeline reported that allopurinol had no target while GtoPdb was publishing two human affinity rows for exactly this enzyme. Constitutively active, hence the resting tone.',
  },

  /* --------------------------------------------------------- amino acid */
  {
    id: 'gaba_a_bz', label: 'GABA-A (BZ site)', group: 'amino-acid',
    gtopdbName: 'GABAA receptor alpha1 subunit',
    gtopdbAliases: ['GABAA receptor alpha2 subunit', 'GABAA receptor alpha3 subunit', 'GABAA receptor alpha5 subunit', 'GABAA receptor alpha6 subunit', 'GABAA receptor 1 subunit', 'GABAA receptor 2 subunit', 'GABAA receptor 3 subunit', 'GABAA receptor 5 subunit', 'GABAA receptor 6 subunit'],
    tissues: ['cns'],
    baselineTone: 0.18, endogenousDriver: 'none', centralFraction: 1.00, ec50Occupancy: 0.30, hill: 1.5,
    activationModel: 'endogenous-agonist',
    effects: [
      fx('neuro.sedation', 0.95, 'GG14', 'Chloride conductance hyperpolarises cortical and thalamic neurons.'),
      fx('resp.drive', -0.40, 'GG14', 'Central depression of respiratory rhythm generation, additive with mu-opioid — which is why the combination kills at doses neither reaches alone.'),
      fx('neuro.anxiety', -0.80, 'GG14', 'Limbic alpha-2 subunit; the anxiolytic action, separable in principle from the sedative alpha-1 one.'),
      fx('neuro.muscleTone', -0.55, 'RANG10', 'Spinal alpha-2/alpha-3; the muscle-relaxant action.'),
      fx('neuro.seizureThreshold', 0.85, 'GG14', 'Raising the seizure threshold is why a benzodiazepine is first-line for status epilepticus.'),
    ],
    notes: 'The benzodiazepine site, indexed by GtoPdb as the individual alpha subunits. Kept separate from the orthosteric `gabaa` entry so a benzodiazepine and a direct GABA-A agonist are distinguishable — they are pharmacologically very different, and the existence of flumazenil as an antidote to one but not the other is the proof.',
  },
];
