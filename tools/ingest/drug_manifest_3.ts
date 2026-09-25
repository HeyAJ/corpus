import type { ManifestEntry } from './drug_manifest';

/**
 * DRUG MANIFEST, PART THREE — the emergency trolley beyond the catecholamines, the
 * endocrine set, the anticoagulants, the neuromuscular drugs, the anti-infectives, and
 * the neuropsychiatric compounds a wider course covers.
 *
 * EVERY DRUG HERE WAS CHECKED AGAINST THE GtoPdb CACHE BEFORE BEING ADDED, exactly as
 * parts one and two were. Where GtoPdb publishes a human affinity for a target this
 * model carries, the receptor route is used; where it does not, the action is a cited
 * direct effect with a targetsNote saying which of the two it is. A drug that could be
 * named but not sourced is not here.
 *
 * FOUR MECHANISMS THAT ARE NEW TO THIS FILE, and which the engine consumes (some of
 * them are being wired in parallel, so a drug whose only action runs through one of
 * them may show a plasma concentration but no physiological change yet — those are
 * called out in the final report rather than pretended to work):
 *
 *   - payload.glucose_g / payload.hco3_mEq — a sugar or a buffer delivered straight to
 *     the blood, the same as the existing electrolyte payloads.
 *   - hormoneAnalogue — the drug IS a hormone, so its plasma level is converted into
 *     the hormone's own clinical unit and added to the endogenous pool. Used for
 *     insulin, glucagon and vasopressin here, and added to hydrocortisone and
 *     levothyroxine in drug_manifest_2.ts.
 *   - antimicrobial — the drug acts on a PATHOGEN, not on the body. Kill follows an
 *     Emax model on the free plasma concentration with a cited MIC (bacteria) or EC50
 *     (viruses, parasites) as the potency term.
 *
 * ON THE CONTROLLED SUBSTANCES here (the opioids, and LSD): they are modelled exactly
 * as methamphetamine and MDMA are in part two — receptor binding, pharmacokinetics and
 * the resulting physiology, with reference amounts taken from published human studies
 * and cited as study exposures. Nothing resembling usage guidance, preparation, route
 * advice for non-medical use or sourcing appears here or in any comment, for the same
 * reason it does not appear anywhere else in this project.
 */

const dailymed = (q: string) => ({
  source: `FDA Structured Product Label via DailyMed — ${q}`,
  sourceUrl: `https://dailymed.nlm.nih.gov/dailymed/search.cfm?labeltype=all&query=${encodeURIComponent(q)}`,
});

/** A reference exposure taken from a published human laboratory study. */
const study = (citation: string, doi: string) => ({ source: citation, sourceUrl: doi });

const ACLS = {
  source: 'Panchal AR, et al. Part 3: Adult Basic and Advanced Life Support: 2020 AHA Guidelines for CPR and ECC. Circulation 142(16_suppl_2), 2020.',
  sourceUrl: 'https://doi.org/10.1161/CIR.0000000000000916',
};

// The 40-unit vasopressin arrest dose is stated in the 2010 guideline ("1 dose of
// vasopressin 40 units IV/IO may replace either the first or second dose of epinephrine",
// Class IIb) and was taken out of the arrest algorithm in 2015; the 2020 guideline above
// discusses vasopressin without restating the dose, so it cannot be the citation for it.
const ACLS_2010 = {
  source: 'Neumar RW, et al. Part 8: Adult Advanced Cardiovascular Life Support: 2010 AHA Guidelines for CPR and ECC. Circulation 122(18 Suppl 3):S729-S767, 2010. The dose was removed from the arrest algorithm in 2015.',
  sourceUrl: 'https://doi.org/10.1161/CIRCULATIONAHA.110.970988',
};

/* The Emax antimicrobial kill framework, cited once and shared. The absolute maximal
 * kill rate for each drug is a modelling anchor calibrated to the class's published
 * time-kill behaviour, in exactly the sense the receptor effect gains are: the SHAPE
 * (pattern, hill) and the potency (MIC/EC50) are sourced, and the ceiling is scaled to
 * the class. Stated per entry. */
const NIELSEN_FRIBERG = {
  killSource: 'Nielsen EI, Friberg LE. Pharmacokinetic-pharmacodynamic modeling of antibacterial drugs. Pharmacol Rev 65(3):1053-1090, 2013.',
  killSourceUrl: 'https://doi.org/10.1124/pr.111.005769',
};
/** EUCAST wild-type reference MIC (ECOFF / modal MIC of the wild-type distribution). */
const eucast = (note: string) => ({
  source: 'EUCAST MIC distribution website: wild-type ECOFF / modal MIC (mic.eucast.org).',
  sourceUrl: 'https://mic.eucast.org',
  note,
});

export const MANIFEST_3: ManifestEntry[] = [
  /* ============================================ emergency / anaesthesia */
  {
    id: 'vasopressin', displayName: 'Vasopressin', class: 'other', drawerGroup: 'Vasopressors',
    routes: ['IV_PUSH', 'IV_DRIP'],
    // DOSED IN MILLIGRAMS, converted from USP units by the label's own statement, "One
    // mg is equivalent to 530 units" (Vasostrict, DESCRIPTION; MW 1084.23). Until
    // 2026-09-25 these presets said `unit: 'unit'`, and toMilligrams passes a unit
    // straight through as if it were a milligram - correct for a payload drug, whose
    // dosing.ts reads the amount in its own unit, and badly wrong for a drug with real
    // pharmacokinetics. So the 40-unit bolus entered the plasma as 40 mg, 530 times the
    // dose, and the ADH pool read in the millions of pg/mL. Insulin and heparin had the
    // same defect and were fixed the same way. At 0.04 units/min the corrected infusion
    // gives a steady-state level of order 100 pg/mL, which is where the septic-shock
    // literature finds it; 530 times that was never physiology.
    presetDoses: [
      { route: 'IV_PUSH', amount: 0.0755, unit: 'mg', label: '40 units (0.0755 mg)', ...ACLS_2010 },
      { route: 'IV_DRIP', amount: 0.00453, unit: 'mg', label: '0.04 unit/min (4.5 mcg/h)', durationMin: 60, ...dailymed('vasopressin injection') },
    ],
    pulseName: null, gtopdbLigand: 'vasopressin', gtopdbAliases: ['[Arg8]-vasopressin', 'argipressin'],
    receptorAllowList: ['v1a', 'v2'],
    hormoneAnalogue: {
      pool: 'adh',
      // 1 mg/L = 1e9 pg/L = 1e6 pg/mL. A mass-to-mass identity, the same one glucagon
      // uses; the clinical ADH assay reports pg/mL.
      unitsPerMgPerL: 1_000_000,
      note: 'Plasma vasopressin in mg/L converted to the ADH pool unit of pg/mL (1 mg/L = 1e6 pg/mL). The receptor targets carry the pressor and antidiuretic EFFECTS; the pool carries the level the lab panel reads and does not act a second time, exactly as hydrocortisone does for cortisol.',
      source: 'Unit identity (1 mg/L = 1e6 pg/mL); reference ADH assay range from Guyton & Hall, 14th ed.',
      sourceUrl: 'https://www.elsevier.com/books/guyton-and-hall-textbook-of-medical-physiology/hall/978-0-323-59712-8',
    },
    notes: 'A non-adrenergic vasopressor: it raises systemic resistance through V1A, so it still works in the acidotic, catecholamine-refractory circulation where an adrenaline infusion has stopped biting. The 40-unit arrest dose and the low-rate shock infusion are the two ways it has been given. Doses are carried in mg using the label conversion, one mg = 530 USP units (Vasostrict prescribing information), so 40 units is 0.0755 mg.',
  },
  {
    id: 'rocuronium', displayName: 'Rocuronium', class: 'other', drawerGroup: 'Neuromuscular',
    routes: ['IV_PUSH'],
    presetDoses: [{ route: 'IV_PUSH', amount: 50, unit: 'mg', label: '50 mg (rapid sequence)', ...dailymed('rocuronium bromide injection') }],
    pulseName: null, gtopdbLigand: null, gtopdbAliases: [],
    targetsNote: 'Deliberate. Rocuronium is a competitive antagonist at the MUSCLE-type nicotinic receptor of the neuromuscular junction, a target distinct from the central/ganglionic nAChR this model carries, and GtoPdb publishes no human affinity value for it. The paralysis is a cited direct effect.',
    directEffects: [
      { target: 'neuro.muscleTone', gain: -1.0, note: 'Non-depolarising blockade of the neuromuscular junction produces complete flaccid paralysis, the respiratory muscles included — which is the entire point and the entire danger: a paralysed patient who is not being ventilated is apnoeic. A reference intubating dose is modelled as full block.', ...dailymed('rocuronium bromide injection') },
    ],
    notes: 'A non-depolarising neuromuscular blocker. It does nothing a patient can feel and everything an anaesthetist must plan for — there is no sedation and no analgesia in the molecule, so giving it without both is the classic catastrophe. Reversed by sugammadex encapsulation, which this model does not carry.',
  },
  {
    id: 'succinylcholine', displayName: 'Succinylcholine', class: 'other', drawerGroup: 'Neuromuscular',
    routes: ['IV_PUSH'],
    presetDoses: [{ route: 'IV_PUSH', amount: 100, unit: 'mg', label: '100 mg (rapid sequence)', ...dailymed('succinylcholine chloride injection') }],
    pulseName: null, gtopdbLigand: null, gtopdbAliases: [],
    targetsNote: 'Deliberate. Succinylcholine is a depolarising agonist at the muscle-type nicotinic receptor, which GtoPdb lists for it with no human affinity value. The depolarising block is a cited direct effect.',
    directEffects: [
      { target: 'neuro.muscleTone', gain: -1.0, note: 'A DEPOLARISING block: it opens the junctional channel, the muscle fasciculates once and then cannot repolarise, so it goes flaccid. The end state looks like rocuronium — complete paralysis including the diaphragm — but it arrives through the opposite mechanism, which is why only this one causes the transient potassium efflux that can be fatal in a burn or crush injury.', ...dailymed('succinylcholine chloride injection') },
    ],
    notes: 'The fastest-onset, shortest-duration neuromuscular blocker, hydrolysed by plasma cholinesterase within minutes — which is why it is the classic rapid-sequence agent and why cholinesterase deficiency produces a frighteningly prolonged block. Its transient hyperkalaemia is a real hazard not modelled here.',
  },
  {
    id: 'neostigmine', displayName: 'Neostigmine', class: 'other', drawerGroup: 'Neuromuscular',
    routes: ['IV_PUSH'],
    presetDoses: [{ route: 'IV_PUSH', amount: 2.5, unit: 'mg', label: '2.5 mg (reversal)', ...dailymed('neostigmine methylsulfate injection') }],
    pulseName: null, gtopdbLigand: null, gtopdbAliases: [],
    targetsNote: 'Deliberate. Neostigmine inhibits acetylcholinesterase, which this model does not carry as a binding target; the accumulated acetylcholine acts everywhere at once, and the net effects are cited directly. It is a QUATERNARY amine and stays out of the brain.',
    directEffects: [
      { target: 'neuro.muscleTone', gain: 0.6, note: 'Raising junctional acetylcholine reverses a non-depolarising block, which is its purpose — modelled as a positive push on muscle tone that opposes rocuronium\'s negative one, so the two compete on the same bus as they do at the same synapse.', ...dailymed('neostigmine methylsulfate injection') },
      { target: 'cardio.heartRate', gain: -0.35, note: 'Muscarinic excess at the sinoatrial node causes bradycardia, which is why neostigmine is co-administered with an antimuscarinic. Reproduced here so that pairing has something to correct.', ...dailymed('neostigmine methylsulfate injection') },
      { target: 'gi.motility', gain: 0.5, note: 'Muscarinic stimulation of the gut is prokinetic; neostigmine is used for acute colonic pseudo-obstruction for exactly this reason.', ...dailymed('neostigmine methylsulfate injection') },
    ],
    notes: 'The reversal agent for non-depolarising blockade, and a cholinergic drug in every tissue at once — the muscarinic effects (bradycardia, salivation, gut activity) are the price of the nicotinic reversal, and are why glycopyrrolate is given alongside it.',
  },
  {
    id: 'glycopyrrolate', displayName: 'Glycopyrrolate', class: 'other', drawerGroup: 'Autonomic',
    routes: ['IV_PUSH'],
    presetDoses: [{ route: 'IV_PUSH', amount: 0.2, unit: 'mg', label: '200 mcg', ...dailymed('glycopyrrolate injection') }],
    pulseName: null, gtopdbLigand: 'glycopyrrolate', gtopdbAliases: ['glycopyrronium'],
    receptorAllowList: ['m1', 'm2', 'm3', 'm4', 'm5'],
    bbbPenetration: {
      value: 0.02,
      source: 'FDA Structured Product Label via DailyMed — glycopyrrolate injection (a quaternary ammonium antimuscarinic that does not cross the blood-brain barrier).',
      sourceUrl: 'https://dailymed.nlm.nih.gov/dailymed/search.cfm?labeltype=all&query=glycopyrrolate',
      note: 'The passive-permeability rule cannot see the PERMANENT POSITIVE CHARGE of a quaternary ammonium, so it scores glycopyrrolate as brain-penetrant and hands it central antimuscarinic effects it does not have — the exact same failure as ipratropium. Overridden to near-zero, which is why glycopyrrolate is the antimuscarinic given WITH neostigmine: it blocks the peripheral muscarinic excess without touching the brain.',
    },
    notes: 'A QUATERNARY antimuscarinic, so like ipratropium it is charged at every pH and essentially cannot cross a membrane — which is why it dries secretions and lifts the heart rate without any of atropine\'s central effects. The passive-permeability rule cannot see the charge, so the penetration is overridden to near zero; the contrast with atropine on exactly the blood-brain-barrier axis is why it is co-given with neostigmine.',
  },
  {
    id: 'etomidate', displayName: 'Etomidate', class: 'anaesthetic', drawerGroup: 'Sedatives',
    routes: ['IV_PUSH'],
    presetDoses: [{ route: 'IV_PUSH', amount: 20, unit: 'mg', label: '20 mg induction', ...dailymed('etomidate injection') }],
    pulseName: null, gtopdbLigand: null, gtopdbAliases: [],
    targetsNote: 'Deliberate. Etomidate is a positive allosteric modulator of GABA-A, the same class of action as propofol and midazolam, and GtoPdb publishes no orthosteric affinity this pipeline can convert. Sedation is a cited direct effect.',
    directEffects: [
      { target: 'neuro.sedation', gain: 0.85, note: 'GABA-A potentiation produces rapid hypnosis at induction doses. Modelled directly because no convertible affinity exists, as for the other GABAergic sedatives.', ...dailymed('etomidate injection') },
      { target: 'neuro.stressAxis', gain: -0.5, note: 'Etomidate INHIBITS 11-beta-hydroxylase, suppressing cortisol synthesis after even a single dose — the property that makes it cardiovascularly stable at induction but unsuitable for infusion. Represented as a suppression of the stress axis output.', ...dailymed('etomidate injection') },
    ],
    notes: 'The induction agent chosen when the blood pressure will not tolerate propofol: it drops neither the pressure nor the rate meaningfully. The cost is adrenal suppression from a single dose, which is why it is an induction agent and never an infusion.',
  },
  {
    id: 'remifentanil', displayName: 'Remifentanil', class: 'opioid', drawerGroup: 'Opioids',
    routes: ['IV_DRIP'],
    presetDoses: [{ route: 'IV_DRIP', amount: 0.5, unit: 'mg', label: '0.1 mcg/kg/min', durationMin: 60, ...dailymed('remifentanil hydrochloride injection') }],
    pulseName: null, gtopdbLigand: null, gtopdbAliases: [],
    targetsNote: 'Deliberate in the sense that nothing better exists: GtoPdb publishes no human affinity row for this ligand. Its mu-opioid actions are carried as cited direct effects, so the drug behaves correctly while the panel honestly shows nothing bound.',
    directEffects: [
      { target: 'neuro.analgesia', gain: 0.8, note: 'Potent mu-opioid agonism. Modelled directly because GtoPdb has no human affinity for this ligand.', ...dailymed('remifentanil hydrochloride injection') },
      { target: 'resp.drive', gain: -1.0, note: 'Profound, mu-mediated respiratory depression to the point of apnoea — the more striking here because the esterase clearance means it also RESOLVES within minutes of stopping the infusion, which is the whole reason to choose it.', ...dailymed('remifentanil hydrochloride injection') },
      { target: 'neuro.sedation', gain: 0.3, note: 'Contributes to depression of consciousness alongside any co-administered hypnotic.', ...dailymed('remifentanil hydrochloride injection') },
      { target: 'cardio.heartRate', gain: -0.2, note: 'Central vagal predominance, as for the other mu agonists.', ...dailymed('remifentanil hydrochloride injection') },
    ],
    notes: 'The opioid you can switch off: hydrolysed by non-specific esterases so its context-sensitive half-time stays near three minutes no matter how long it has run. The infusion demonstrates the same respiratory-depression loop as fentanyl but with an offset measured in minutes.',
  },
  {
    id: 'labetalol', displayName: 'Labetalol', class: 'antihypertensive', drawerGroup: 'Beta blockers',
    routes: ['IV_PUSH'],
    presetDoses: [{ route: 'IV_PUSH', amount: 20, unit: 'mg', label: '20 mg', ...dailymed('labetalol hydrochloride injection') }],
    pulseName: null, gtopdbLigand: 'labetalol', gtopdbAliases: [],
    receptorAllowList: ['alpha1', 'beta1', 'beta2', 'beta3'],
    // Labetalol arrives from GtoPdb at the three beta subtypes labelled "Partial
    // agonist", from the assays it was characterised in — the same artefact that made
    // carvedilol a beta AGONIST and took a modelled heart rate to 235 bpm. Clinically
    // labetalol is used to bring blood pressure and rate DOWN in a hypertensive
    // emergency; its net beta action is blockade. Curated to a neutral competitive
    // antagonist at all three beta subtypes, so it lowers rate through beta-1 while
    // lowering afterload through the alpha-1 antagonism GtoPdb already reports correctly.
    intrinsicActivity: Object.fromEntries(
      ['beta1', 'beta2', 'beta3'].map((r) => [r, {
        value: 0,
        note: 'Labetalol is used as a combined alpha/beta BLOCKER to lower pressure and rate; the assay "partial agonist" label is not its clinical efficacy. Modelled as a neutral competitive antagonist at the beta subtypes, with the alpha-1 blockade carried by the antagonist affinity GtoPdb publishes.',
        ...dailymed('labetalol hydrochloride injection'),
      }]),
    ),
    notes: 'Blocks alpha-1 as well as beta, in roughly a 1:3 ratio intravenously, so it drops afterload while it slows the heart — the property that makes it a first-line drug for a hypertensive emergency and for pre-eclampsia.',
  },
  {
    id: 'hydralazine', displayName: 'Hydralazine', class: 'antihypertensive', drawerGroup: 'Vasodilators',
    routes: ['IV_PUSH', 'ORAL'],
    presetDoses: [
      { route: 'IV_PUSH', amount: 10, unit: 'mg', label: '10 mg', ...dailymed('hydralazine hydrochloride injection') },
      { route: 'ORAL', amount: 25, unit: 'mg', label: '25 mg', ...dailymed('hydralazine hydrochloride tablets') },
    ],
    pulseName: null, gtopdbLigand: null, gtopdbAliases: [],
    targetsNote: 'Deliberate. Hydralazine\'s arteriolar smooth-muscle relaxation is not a receptor action GtoPdb indexes with a usable human affinity, so the vasodilation is a cited direct effect.',
    directEffects: [
      { target: 'cardio.systemicResistance', gain: -0.5, note: 'Direct arteriolar smooth-muscle relaxation, selective for resistance vessels over capacitance ones — which is why it drops afterload and provokes a reflex tachycardia rather than pooling blood venously. The reflex rate rise is not coded; it emerges from the baroreflex seeing the pressure fall.', ...dailymed('hydralazine hydrochloride injection') },
    ],
    notes: 'An arteriolar dilator whose reflex tachycardia is the reason it is usually paired with a beta blocker. In this model the tachycardia is emergent, not scripted, which is the point of putting the vasodilation on the bus and letting the baroreflex answer it.',
  },
  {
    id: 'glyceryl_trinitrate', displayName: 'Glyceryl Trinitrate', class: 'antihypertensive', drawerGroup: 'Vasodilators',
    routes: ['SUBLINGUAL', 'IV_DRIP'],
    presetDoses: [
      { route: 'SUBLINGUAL', amount: 0.4, unit: 'mg', label: '400 mcg SL', ...dailymed('nitroglycerin sublingual tablets') },
      { route: 'IV_DRIP', amount: 0.6, unit: 'mg', label: '10 mcg/min', durationMin: 60, ...dailymed('nitroglycerin injection') },
    ],
    pulseName: null, gtopdbLigand: null, gtopdbAliases: [],
    targetsNote: 'Deliberate. Glyceryl trinitrate is a nitric-oxide donor acting on vascular smooth-muscle guanylate cyclase, not a receptor GtoPdb indexes for it, so the venodilation is a cited direct effect.',
    directEffects: [
      { target: 'cardio.venousTone', gain: -0.65, note: 'PREDOMINANTLY a venodilator at low dose: it pools blood peripherally and drops preload, which is how it relieves angina by cutting myocardial wall tension rather than by dilating a coronary. The venous selectivity is why the effect on arterial pressure is modest until the dose climbs.', ...dailymed('nitroglycerin sublingual tablets') },
      { target: 'cardio.systemicResistance', gain: -0.2, note: 'Arterial dilation appears as the dose rises, adding an afterload-reducing effect on top of the preload reduction.', ...dailymed('nitroglycerin injection') },
    ],
    notes: 'The sublingual route is the lesson: swallowed, first-pass metabolism destroys it, so it is placed under the tongue to reach the systemic veins directly, where its tiny lipophilic molecule acts within two minutes. The intravenous infusion is titratable for acute pulmonary oedema.',
  },
  {
    id: 'sodium_nitroprusside', displayName: 'Sodium Nitroprusside', class: 'antihypertensive', drawerGroup: 'Vasodilators',
    routes: ['IV_DRIP'],
    presetDoses: [{ route: 'IV_DRIP', amount: 1.2, unit: 'mg', label: '0.3 mcg/kg/min', durationMin: 60, ...dailymed('sodium nitroprusside injection') }],
    pulseName: null, gtopdbLigand: null, gtopdbAliases: [],
    targetsNote: 'Deliberate. Like glyceryl trinitrate it is a nitric-oxide donor with no indexed receptor affinity; the balanced vasodilation is a cited direct effect.',
    directEffects: [
      { target: 'cardio.systemicResistance', gain: -0.7, note: 'A BALANCED arterial and venous dilator, unlike the venous-predominant nitrates — it drops afterload as much as preload, which is why it can control the most severe hypertensive emergency but also why it can drop the pressure precipitously.', ...dailymed('sodium nitroprusside injection') },
      { target: 'cardio.venousTone', gain: -0.4, note: 'The venous limb of the same balanced dilation, reducing preload alongside the arterial afterload reduction.', ...dailymed('sodium nitroprusside injection') },
    ],
    notes: 'The most titratable vasodilator there is, with a two-minute circulatory half-life — turn the infusion and the pressure follows within a minute. Its cyanide liberation on prolonged high-dose use is its toxicity and is not modelled.',
  },
  {
    id: 'sodium_bicarbonate', displayName: 'Sodium Bicarbonate', class: 'electrolyte', drawerGroup: 'Electrolyte',
    routes: ['IV_PUSH'],
    presetDoses: [{ route: 'IV_PUSH', amount: 50, unit: 'mEq', label: '50 mEq (8.4%)', ...ACLS }],
    pulseName: null, gtopdbLigand: null, gtopdbAliases: [],
    payload: { hco3_mEq: 1, na_mEq: 1, volume_mL: 1 },
    notes: 'No receptor pharmacology: it acts by raising the plasma bicarbonate buffer and, with it, the pH. 8.4% sodium bicarbonate is a 1 mEq/mL solution, so it delivers a mole of sodium for every mole of bicarbonate — which is why a large dose is also a large sodium load. The payload is expressed per millilitre.',
  },
  {
    id: 'dextrose_50', displayName: 'Dextrose 50%', class: 'electrolyte', drawerGroup: 'Fluids',
    routes: ['IV_PUSH'],
    presetDoses: [{ route: 'IV_PUSH', amount: 50, unit: 'mL', label: '50 mL (25 g)', ...dailymed('dextrose injection') }],
    pulseName: null, gtopdbLigand: null, gtopdbAliases: [],
    payload: { glucose_g: 0.5, volume_mL: 1 },
    notes: 'The bolus for symptomatic hypoglycaemia: 50 mL of 50% dextrose carries 25 g of glucose straight to the plasma glucose pool. The payload is per millilitre (0.5 g of glucose in each). Hyperosmolar, which is why it is a large-vein drug.',
  },
  {
    id: 'dextrose_10', displayName: 'Dextrose 10%', class: 'electrolyte', drawerGroup: 'Fluids',
    routes: ['IV_DRIP'],
    presetDoses: [{ route: 'IV_DRIP', amount: 250, unit: 'mL', label: '250 mL (25 g)', durationMin: 15, ...dailymed('dextrose injection') }],
    pulseName: null, gtopdbLigand: null, gtopdbAliases: [],
    payload: { glucose_g: 0.1, volume_mL: 1 },
    notes: 'The same 25 g of glucose as the 50% bolus, delivered as a gentler infusion of a much less hyperosmolar solution — the contrast between the two is the lesson in why concentration, not just dose, decides which vein a sugar can go into. Payload per millilitre.',
  },
  {
    id: 'mannitol', displayName: 'Mannitol', class: 'other', drawerGroup: 'Renal',
    routes: ['IV_DRIP'],
    presetDoses: [{ route: 'IV_DRIP', amount: 50, unit: 'g', label: '50 g (20%)', durationMin: 20, ...dailymed('mannitol injection') }],
    pulseName: null, gtopdbLigand: null, gtopdbAliases: [],
    targetsNote: 'Deliberate. Mannitol is an inert osmotic agent, not a receptor ligand. It is filtered and not reabsorbed, so it holds water in the tubule; the osmotic diuresis is a cited direct effect.',
    directEffects: [
      { target: 'renal.waterReabsorption', gain: -0.45, note: 'Freely filtered and not reabsorbed, mannitol raises tubular fluid osmolality and drags water with it into the urine — an osmotic diuresis that depends on preserved renal perfusion. It also expands the intravascular volume transiently before it diureses, which is the risk in a failing heart.', ...dailymed('mannitol injection') },
    ],
    notes: 'The osmotic diuretic, used to pull water out of the brain in raised intracranial pressure and to force a diuresis. Its action is pure physics — an unreabsorbed solute holding water in the tubule — which is why it needs a kidney that is still filtering to work at all.',
  },
  {
    id: 'magnesium_sulfate', displayName: 'Magnesium Sulfate', class: 'electrolyte', drawerGroup: 'Electrolyte',
    routes: ['IV_DRIP', 'IV_PUSH'],
    presetDoses: [
      { route: 'IV_DRIP', amount: 4, unit: 'g', label: '4 g over 20 min', durationMin: 20, ...dailymed('magnesium sulfate injection') },
      { route: 'IV_PUSH', amount: 2, unit: 'g', label: '2 g', ...dailymed('magnesium sulfate injection') },
    ],
    pulseName: null, gtopdbLigand: null, gtopdbAliases: [],
    targetsNote: 'Deliberate. Magnesium acts as a physiological calcium antagonist at many sites rather than through one indexed receptor; only its cited cardiovascular and neuromuscular membrane effects are modelled, and the gains\' absolute scale is a modelling choice anchored to those cited statements.',
    directEffects: [
      { target: 'cardio.arrhythmogenicity', gain: -0.4, note: 'Membrane stabilisation: magnesium is the specific treatment for torsades de pointes and suppresses the early afterdepolarisations that trigger it. Modelled as a reduction in arrhythmogenicity, its principal cardiac indication.', ...dailymed('magnesium sulfate injection') },
      { target: 'cardio.systemicResistance', gain: -0.25, note: 'Vascular smooth-muscle relaxation through calcium antagonism causes a modest fall in systemic resistance and blood pressure, part of why it is used in pre-eclampsia.', ...dailymed('magnesium sulfate injection') },
      { target: 'neuro.seizureThreshold', gain: 0.5, note: 'Magnesium raises the threshold for the eclamptic seizure — the reason it, and not a conventional anticonvulsant, is first-line in eclampsia. Modelled as a rise in seizure threshold; at toxic levels it would instead cause flaccid weakness, which is not represented.', ...dailymed('magnesium sulfate injection') },
    ],
    notes: 'A calcium antagonist masquerading as an electrolyte: it treats torsades, eclamptic seizures and severe asthma through membrane stabilisation and smooth-muscle relaxation. Its overdose is areflexia and respiratory muscle weakness, reversed by calcium — a detail the model does not carry.',
  },
  {
    id: 'dantrolene', displayName: 'Dantrolene', class: 'other', drawerGroup: 'Neuromuscular',
    routes: ['IV_PUSH'],
    presetDoses: [{ route: 'IV_PUSH', amount: 175, unit: 'mg', label: '2.5 mg/kg', ...dailymed('dantrolene sodium injection') }],
    pulseName: null, gtopdbLigand: null, gtopdbAliases: [],
    targetsNote: 'Deliberate. Dantrolene blocks the RyR1 calcium-release channel of the sarcoplasmic reticulum, which GtoPdb lists for it with no human affinity value and which this model does not carry as a target. Its actions are cited direct effects.',
    directEffects: [
      { target: 'neuro.muscleTone', gain: -0.5, note: 'By blocking RyR1-mediated calcium release, dantrolene uncouples excitation from contraction in skeletal muscle — a weakness quite distinct from a neuromuscular blocker, because the junction still fires; the muscle simply cannot answer. This is the mechanism, and the therapy, of malignant hyperthermia.', ...dailymed('dantrolene sodium injection') },
      { target: 'thermal.heatProduction', gain: -0.7, note: 'The runaway skeletal-muscle thermogenesis of malignant hyperthermia IS the emergency, and dantrolene is the only drug that stops it — by shutting off the calcium release that drives the heat. Modelled as a large reduction in heat production.', ...dailymed('dantrolene sodium injection') },
    ],
    notes: 'The antidote to malignant hyperthermia, and the only one: it stops the skeletal muscle producing heat by cutting off its calcium supply at the sarcoplasmic reticulum. Nothing else in the set acts on RyR1.',
  },
  {
    id: 'tranexamic_acid', displayName: 'Tranexamic Acid', class: 'other', drawerGroup: 'Haematological',
    routes: ['IV_DRIP', 'ORAL'],
    presetDoses: [
      { route: 'IV_DRIP', amount: 1000, unit: 'mg', label: '1 g over 10 min', durationMin: 10, ...dailymed('tranexamic acid injection') },
      { route: 'ORAL', amount: 1000, unit: 'mg', label: '1 g', ...dailymed('tranexamic acid tablets') },
    ],
    pulseName: null, gtopdbLigand: null, gtopdbAliases: [],
    targetsNote: 'Deliberate. Tranexamic acid blocks the lysine-binding site of plasminogen (GtoPdb lists this as a low-affinity binding interaction, pIC50 ~3.6, far below any plasma level reached); the target is not in this model\'s registry, so the antifibrinolytic action is a cited direct effect.',
    directEffects: [
      { target: 'blood.coagulation', gain: 0.4, note: 'ANTIFIBRINOLYTIC, therefore net procoagulant on this bus: it stops plasmin dissolving a clot that has already formed, rather than helping one form. The positive sign is the antifibrinolytic direction the bus documents; the CRASH-2 and WOMAN trials are why it is given early in trauma and post-partum haemorrhage.', ...dailymed('tranexamic acid injection') },
    ],
    notes: 'It does not make blood clot; it stops clots being broken down, by occupying the lysine site plasminogen needs to dock onto fibrin. That distinction — stabilising a clot versus forming one — is why it reduces bleeding deaths without the thrombosis profile of a procoagulant factor.',
  },

  /* ============================================ endocrine / metabolic */
  {
    id: 'insulin_regular', displayName: 'Insulin (regular)', class: 'other', drawerGroup: 'Diabetes',
    routes: ['IV_PUSH', 'SUBCUTANEOUS'],
    presetDoses: [
      { route: 'IV_PUSH', amount: 0.347, unit: 'mg', label: '10 units IV (0.347 mg)', ...dailymed('insulin human injection') },
      { route: 'SUBCUTANEOUS', amount: 0.347, unit: 'mg', label: '10 units SC (0.347 mg)', ...dailymed('insulin human injection') },
    ],
    pulseName: null, gtopdbLigand: null, gtopdbAliases: [],
    targetsNote: 'Deliberate. GtoPdb lists insulin at the insulin receptor with no affinity value, so no occupancy can be built. Instead insulin is modelled as the hormone it is: its plasma level is added to the endogenous insulin pool, and the metabolic model acts on the sum — the only way an exogenous dose and the body\'s own counter-regulation can meet.',
    hormoneAnalogue: {
      pool: 'insulin',
      // 1 IU human insulin = 0.0347 mg (WHO/USP), i.e. 28.82 IU/mg. Plasma level mg/L ->
      // uU/mL: 1 mg/L * 28.82 IU/mg = 28.82 IU/L = 28.82e6 uU/L = 28820 uU/mL.
      unitsPerMgPerL: 28_820,
      note: 'Plasma insulin in mg/L converted to the pool unit of uU/mL using the WHO/USP definition that 1 international unit of human insulin is 0.0347 mg (28.82 IU/mg): 1 mg/L = 28820 uU/mL. Added to the endogenous insulin pool so the Bergman model sees one number.',
      source: 'WHO International Standard for human insulin (4th IS, 83/500); 1 IU = 0.0347 mg. USP monograph, human insulin.',
      sourceUrl: 'https://www.who.int/publications/m/item/insulin-human-4th-is-nibsc-code-83-500',
    },
    notes: 'The hormone given from outside. Modelled through the endogenous pool rather than a receptor so that a hypoglycaemic body\'s own glucagon and adrenaline can see the dose and answer it. The intravenous and subcutaneous routes differ entirely in onset — minutes versus a rate-limited absorption of an hour or more — which is the practical lesson. Presets are labelled in units and simulated as the mass those units ARE (1 IU = 0.0347 mg, the WHO standard cited on the analogue block): feeding the unit count to the engine as milligrams overdosed it 29-fold and drove glucose to the floor.',
  },
  {
    id: 'insulin_glargine', displayName: 'Insulin glargine', class: 'other', drawerGroup: 'Diabetes',
    routes: ['SUBCUTANEOUS'],
    presetDoses: [{ route: 'SUBCUTANEOUS', amount: 0.694, unit: 'mg', label: '20 units SC (0.694 mg)', ...dailymed('insulin glargine injection') }],
    pulseName: null, gtopdbLigand: null, gtopdbAliases: [],
    targetsNote: 'Deliberate, and identical in reasoning to regular insulin: modelled as the hormone through the endogenous pool rather than through a receptor with no published affinity value.',
    hormoneAnalogue: {
      pool: 'insulin',
      unitsPerMgPerL: 28_820,
      note: 'Same conversion as regular insulin (1 mg/L = 28820 uU/mL). Glargine is an analogue of essentially equal receptor potency to human insulin, so the pool unit is treated as insulin-equivalent; its DIFFERENCE from regular insulin is entirely pharmacokinetic (a slow subcutaneous depot), carried by the PK, not the potency.',
      source: 'WHO International Standard for human insulin (4th IS, 83/500); 1 IU = 0.0347 mg. USP monograph, human insulin.',
      sourceUrl: 'https://www.who.int/publications/m/item/insulin-human-4th-is-nibsc-code-83-500',
    },
    notes: 'The long-acting basal insulin: it precipitates in subcutaneous tissue and dissolves slowly to give a flat, peakless profile lasting about a day. Against regular insulin it is the same hormone with a completely different absorption curve — the clearest insulin lesson the set offers.',
  },
  {
    id: 'glucagon', displayName: 'Glucagon', class: 'other', drawerGroup: 'Diabetes',
    routes: ['IM', 'IV_PUSH', 'SUBCUTANEOUS'],
    presetDoses: [
      { route: 'IM', amount: 1, unit: 'mg', label: '1 mg IM', ...dailymed('glucagon for injection') },
      { route: 'IV_PUSH', amount: 1, unit: 'mg', label: '1 mg IV', ...dailymed('glucagon for injection') },
      { route: 'SUBCUTANEOUS', amount: 1, unit: 'mg', label: '1 mg SC', ...dailymed('glucagon for injection') },
    ],
    pulseName: null, gtopdbLigand: 'glucagon', gtopdbAliases: [],
    receptorAllowList: ['glucagon_r'],
    hormoneAnalogue: {
      pool: 'glucagon',
      unitsPerMgPerL: 1_000_000,
      note: 'Plasma glucagon in mg/L converted to the pool unit of pg/mL (1 mg/L = 1e6 pg/mL). The glucagon receptor carries the hepatic and cardiac EFFECTS; the pool carries the level the lab panel reads and does not act a second time, the same split hydrocortisone uses.',
      source: 'Unit identity (1 mg/L = 1e6 pg/mL); reference glucagon range from Guyton & Hall, 14th ed.',
      sourceUrl: 'https://www.elsevier.com/books/guyton-and-hall-textbook-of-medical-physiology/hall/978-0-323-59712-8',
    },
    notes: 'The counter-regulatory hormone, given as a drug. Its rescue of hypoglycaemia is glycogenolysis and is therefore useless in a starved or alcoholic liver with no glycogen left — a limitation the model reproduces. It is also the antidote to beta-blocker overdose, because it raises cardiac cAMP without going through the beta receptor, which the glucagon receptor entry carries.',
  },
  {
    id: 'semaglutide', displayName: 'Semaglutide', class: 'other', drawerGroup: 'Diabetes',
    routes: ['SUBCUTANEOUS'],
    presetDoses: [{ route: 'SUBCUTANEOUS', amount: 1, unit: 'mg', label: '1 mg SC (weekly)', ...dailymed('semaglutide injection') }],
    pulseName: null, gtopdbLigand: 'semaglutide', gtopdbAliases: [],
    receptorAllowList: ['glp1_r'],
    notes: 'A GLP-1 receptor agonist: glucose-dependent insulin secretion (so it barely causes hypoglycaemia alone), delayed gastric emptying and suppressed appetite, with a one-week half-life that makes it a once-weekly injection. The appetite and emptying effects are as much its point as the glycaemic one.',
  },
  {
    id: 'glipizide', displayName: 'Glipizide', class: 'other', drawerGroup: 'Diabetes',
    routes: ['ORAL'],
    presetDoses: [{ route: 'ORAL', amount: 5, unit: 'mg', label: '5 mg', ...dailymed('glipizide tablets') }],
    pulseName: null, gtopdbLigand: null, gtopdbAliases: [],
    targetsNote: 'Deliberate. Sulfonylureas close the pancreatic beta-cell K-ATP channel (SUR1/Kir6.2), a target with no human affinity value GtoPdb can offer this pipeline; the insulin secretion is a cited direct effect.',
    directEffects: [
      { target: 'metabolic.insulinSecretion', gain: 0.7, note: 'Closes the beta-cell ATP-sensitive potassium channel, depolarising the cell and triggering insulin release INDEPENDENTLY of glucose — which is exactly why a sulfonylurea, unlike a GLP-1 agonist, CAN drive a fasting patient hypoglycaemic. That difference is the teaching contrast.', ...dailymed('glipizide tablets') },
    ],
    notes: 'The sulfonylurea, and the counterpoint to semaglutide and metformin: it forces insulin out whether or not the glucose is high, so its characteristic harm is hypoglycaemia. Renally and hepatically cleared with a short half-life, which is why it is dosed before meals.',
  },
  {
    id: 'atorvastatin', displayName: 'Atorvastatin', class: 'other', drawerGroup: 'Endocrine',
    routes: ['ORAL'],
    presetDoses: [{ route: 'ORAL', amount: 40, unit: 'mg', label: '40 mg', ...dailymed('atorvastatin calcium tablets') }],
    pulseName: null, gtopdbLigand: 'atorvastatin', gtopdbAliases: [],
    receptorAllowList: ['hmgcr'],
    notes: 'The HMG-CoA reductase inhibitor. What lowers plasma LDL is not the synthesis block itself but the LDL-receptor upregulation it provokes in the liver, over weeks — a slow effect the model applies far faster than life does, which is stated for every nuclear and transcriptional effect in the set.',
  },
  {
    id: 'desmopressin', displayName: 'Desmopressin', class: 'other', drawerGroup: 'Endocrine',
    routes: ['IV_PUSH'],
    presetDoses: [{ route: 'IV_PUSH', amount: 0.004, unit: 'mg', label: '4 mcg IV', ...dailymed('desmopressin acetate injection') }],
    pulseName: null, gtopdbLigand: 'desmopressin', gtopdbAliases: ['DDAVP', '1-deamino-8-D-arginine vasopressin'],
    receptorAllowList: ['v2', 'v1a'],
    notes: 'A vasopressin analogue selective for V2 over V1A, so it is antidiuretic without being a pressor — the difference from vasopressin, and the reason it treats central diabetes insipidus. Its resistance to peptidase is what gives it hours of action where the native hormone has minutes.',
  },

  /* ============================================ cardiovascular / renal */
  {
    id: 'lisinopril', displayName: 'Lisinopril', class: 'antihypertensive', drawerGroup: 'RAAS',
    routes: ['ORAL'],
    presetDoses: [{ route: 'ORAL', amount: 10, unit: 'mg', label: '10 mg', ...dailymed('lisinopril tablets') }],
    pulseName: null, gtopdbLigand: null, gtopdbAliases: [],
    targetsNote: 'Deliberate. Lisinopril inhibits angiotensin-converting enzyme (GtoPdb gives it a human pKi, but ACE is not in this model\'s registry), so its consequences are carried as cited direct effects — a fall in the angiotensin II that AT1 would otherwise see.',
    directEffects: [
      { target: 'cardio.systemicResistance', gain: -0.4, note: 'Blocking ACE lowers circulating angiotensin II, removing an arteriolar vasoconstrictor and dropping systemic resistance. Unlike a direct vasodilator it does so without a reflex tachycardia, because it also blunts the sympathetic facilitation angiotensin II provides.', ...dailymed('lisinopril tablets') },
      { target: 'renal.waterReabsorption', gain: -0.3, note: 'Less angiotensin II means less aldosterone and less proximal sodium-water reabsorption — a mild natriuresis that is part of the antihypertensive effect and the reason ACE inhibitors can raise serum potassium.', ...dailymed('lisinopril tablets') },
      { target: 'renal.vascularResistance', gain: -0.35, note: 'Angiotensin II preferentially constricts the efferent arteriole; removing it dilates the efferent and can drop the filtration fraction, which is renoprotective in diabetes and dangerous in bilateral renal artery stenosis.', ...dailymed('lisinopril tablets') },
    ],
    notes: 'The ACE inhibitor. Its signature adverse effects — the dry cough and angioedema — come from the bradykinin ACE also degrades, a mechanism this model does not carry. Long half-life, renally cleared, and the reason its dose is reduced in renal impairment.',
  },
  {
    id: 'losartan', displayName: 'Losartan', class: 'antihypertensive', drawerGroup: 'RAAS',
    routes: ['ORAL'],
    presetDoses: [{ route: 'ORAL', amount: 50, unit: 'mg', label: '50 mg', ...dailymed('losartan potassium tablets') }],
    pulseName: null, gtopdbLigand: 'losartan', gtopdbAliases: [],
    receptorAllowList: ['at1'],
    notes: 'The angiotensin receptor blocker: it antagonises AT1 directly rather than reducing angiotensin II production, so it lowers pressure like an ACE inhibitor but without the bradykinin-mediated cough — the exact contrast with lisinopril, and both are in the set so the receptor panel can show it. Its active metabolite does most of the work and outlasts the parent.',
  },
  {
    id: 'clopidogrel', displayName: 'Clopidogrel', class: 'other', drawerGroup: 'Anticoagulants',
    routes: ['ORAL'],
    presetDoses: [{ route: 'ORAL', amount: 300, unit: 'mg', label: '300 mg loading', ...dailymed('clopidogrel bisulfate tablets') }],
    pulseName: null, gtopdbLigand: 'clopidogrel (active metabolite)', gtopdbAliases: [],
    receptorAllowList: ['p2y12'],
    targetsNote: 'The affinity used is GtoPdb\'s row for the ACTIVE METABOLITE, because clopidogrel itself is an inactive prodrug (GtoPdb has no affinity row for the parent) that only blocks P2Y12 after hepatic CYP activation. The model carries the parent\'s pharmacokinetics and the metabolite\'s affinity, and this note records the join; the irreversibility of the real binding is not represented.',
    notes: 'A P2Y12 antagonist, and the second antiplatelet pathway — independent of the thromboxane route aspirin blocks, which is why the two are additive in dual antiplatelet therapy. It is a prodrug, so a poor CYP2C19 metaboliser gets little effect, a pharmacogenetic lesson the model notes but does not simulate.',
  },
  {
    id: 'heparin', displayName: 'Heparin (unfractionated)', class: 'other', drawerGroup: 'Anticoagulants',
    routes: ['IV_PUSH', 'IV_DRIP', 'SUBCUTANEOUS'],
    presetDoses: [
      { route: 'IV_PUSH', amount: 27.8, unit: 'mg', label: '5000 units bolus (27.8 mg)', ...dailymed('heparin sodium injection') },
      { route: 'IV_DRIP', amount: 6, unit: 'mg', label: '18 units/kg/h (6 mg over 1 h)', durationMin: 60, ...dailymed('heparin sodium injection') },
      { route: 'SUBCUTANEOUS', amount: 27.8, unit: 'mg', label: '5000 units SC (27.8 mg)', ...dailymed('heparin sodium injection') },
    ],
    pulseName: null, gtopdbLigand: null, gtopdbAliases: [],
    targetsNote: 'Deliberate. Heparin acts by activating antithrombin (GtoPdb lists this activation of SERPINC1), a target this model does not carry; the anticoagulant effect is a cited direct effect. A unit is a bioassay potency, not a mass, so heparin has no MW and no receptor occupancy here.',
    directEffects: [
      { target: 'blood.coagulation', gain: -0.65, note: 'Accelerates antithrombin\'s inactivation of thrombin and factor Xa a thousandfold, prolonging the aPTT — the anticoagulant direction is negative on this bus. Its effect is immediate and, unlike warfarin, reversible in minutes with protamine, which the model does not carry.', ...dailymed('heparin sodium injection') },
    ],
    notes: 'The immediate, titratable, reversible anticoagulant, given by weight and monitored by aPTT. Its dose is labelled in units of biological activity because the molecule is a heterogeneous polymer, which is also why it has no molecular weight in this data. The simulated amount is the MASS those units correspond to at the USP potency floor of 180 USP heparin units per mg (heparin sodium monograph, revised 2009): 5000 units = 27.8 mg. The engine integrates milligrams; feeding it the unit count as if it were milligrams overdosed it about 180-fold and read as an INR of 20 at a standard bolus.',
  },
  {
    id: 'enoxaparin', displayName: 'Enoxaparin', class: 'other', drawerGroup: 'Anticoagulants',
    routes: ['SUBCUTANEOUS'],
    presetDoses: [{ route: 'SUBCUTANEOUS', amount: 100, unit: 'mg', label: '1 mg/kg SC', ...dailymed('enoxaparin sodium injection') }],
    pulseName: null, gtopdbLigand: null, gtopdbAliases: [],
    targetsNote: 'Deliberate, as for heparin: antithrombin activation is not a target in this registry, so the anticoagulant action is a cited direct effect. A low-molecular-weight heparin is still a polymer, so no MW and no receptor occupancy.',
    directEffects: [
      { target: 'blood.coagulation', gain: -0.55, note: 'A low-molecular-weight heparin: it inactivates factor Xa far more than thrombin, so it barely prolongs the aPTT and is dosed by weight without routine monitoring. Modelled as a somewhat smaller, more predictable anticoagulant effect than unfractionated heparin.', ...dailymed('enoxaparin sodium injection') },
    ],
    notes: 'The outpatient anticoagulant: a predictable, weight-based subcutaneous dose that does not need an aPTT, at the cost of being only partly reversible by protamine. Renally cleared, which is why it accumulates in renal failure where unfractionated heparin does not.',
  },
  {
    id: 'warfarin', displayName: 'Warfarin', class: 'other', drawerGroup: 'Anticoagulants',
    routes: ['ORAL'],
    presetDoses: [{ route: 'ORAL', amount: 5, unit: 'mg', label: '5 mg', ...dailymed('warfarin sodium tablets') }],
    pulseName: null, gtopdbLigand: null, gtopdbAliases: [],
    targetsNote: 'Deliberate. Warfarin inhibits vitamin K epoxide reductase (GtoPdb gives a human pKi, but VKORC1 is not in this registry); its effect is carried as a cited direct effect, and the model cannot reproduce the days-long delay while existing clotting factors are consumed.',
    directEffects: [
      { target: 'blood.coagulation', gain: -0.6, note: 'Blocks the recycling of vitamin K, so the liver cannot carboxylate factors II, VII, IX and X — the anticoagulant direction is negative. CRUCIALLY the real effect is DELAYED by days while the already-made factors are used up, and this model, having only instantaneous kinetics, applies it far too fast; recorded in MODEL_LIMITATIONS.', ...dailymed('warfarin sodium tablets') },
    ],
    notes: 'The oral anticoagulant whose effect has nothing to do with its plasma level on any given day: it works by starving the liver of functional vitamin K, so the INR lags the dose by days in both directions. That lag, and the narrow therapeutic window, are why it is monitored and why the newer factor inhibitors displaced it.',
  },
  {
    id: 'apixaban', displayName: 'Apixaban', class: 'other', drawerGroup: 'Anticoagulants',
    routes: ['ORAL'],
    presetDoses: [{ route: 'ORAL', amount: 5, unit: 'mg', label: '5 mg', ...dailymed('apixaban tablets') }],
    pulseName: null, gtopdbLigand: null, gtopdbAliases: [],
    targetsNote: 'Deliberate. Apixaban is a direct factor Xa inhibitor (GtoPdb gives a human pKi of 10.1); coagulation factor Xa is not in this registry, so the anticoagulant action is a cited direct effect.',
    directEffects: [
      { target: 'blood.coagulation', gain: -0.55, note: 'Directly and reversibly inhibits factor Xa, the convergence point of the clotting cascade, without needing antithrombin. The anticoagulant direction is negative; unlike warfarin its effect tracks its plasma level, so it needs no monitoring — the whole reason the direct oral anticoagulants replaced it for most indications.', ...dailymed('apixaban tablets') },
    ],
    notes: 'A direct oral anticoagulant: predictable, fast on and off, and dosed without monitoring because its effect follows its concentration. The contrast with warfarin — level-tracking versus days-lagged — is the lesson the two of them make together.',
  },
  {
    id: 'alteplase', displayName: 'Alteplase', class: 'other', drawerGroup: 'Anticoagulants',
    routes: ['IV_DRIP'],
    presetDoses: [{ route: 'IV_DRIP', amount: 90, unit: 'mg', label: '0.9 mg/kg over 60 min', durationMin: 60, ...dailymed('alteplase for injection') }],
    pulseName: null, gtopdbLigand: null, gtopdbAliases: [],
    targetsNote: 'Deliberate. Alteplase is recombinant tissue plasminogen activator — an enzyme that converts plasminogen to plasmin — not a small-molecule ligand; it has no receptor target and no molecular weight here, and its fibrinolytic action is a cited direct effect.',
    directEffects: [
      { target: 'blood.coagulation', gain: -0.7, note: 'Converts plasminogen to plasmin, which DISSOLVES a formed fibrin clot — mechanistically distinct from every anticoagulant here, which only prevent one forming. Placed on the same coagulation bus with a negative sign because both reduce clot integrity, but the note records that lysing an existing clot and blocking a new one are different actions and the model does not distinguish them.', ...dailymed('alteplase for injection') },
    ],
    notes: 'The thrombolytic: it breaks down clots that have already formed, which is why it can reverse an ischaemic stroke or a massive pulmonary embolism and why its complication is catastrophic haemorrhage. Its five-minute half-life is why it is given as a front-loaded infusion, and its narrow time window is the whole of acute stroke care.',
  },

  /* ============================================ allergy / GI */
  {
    id: 'chlorphenamine', displayName: 'Chlorphenamine', class: 'other', drawerGroup: 'Antihistamines',
    routes: ['ORAL', 'IV_PUSH'],
    presetDoses: [
      { route: 'ORAL', amount: 4, unit: 'mg', label: '4 mg', ...dailymed('chlorpheniramine maleate tablets') },
      { route: 'IV_PUSH', amount: 10, unit: 'mg', label: '10 mg', ...dailymed('chlorpheniramine maleate injection') },
    ],
    pulseName: null, gtopdbLigand: 'chlorpheniramine', gtopdbAliases: ['chlorphenamine'],
    receptorAllowList: ['h1'],
    notes: 'A first-generation antihistamine used in anaphylaxis and allergy: lipophilic, so it crosses into the brain and sedates, the contrast with cetirizine being entirely about blood-brain-barrier access rather than receptor profile.',
  },
  {
    id: 'cetirizine', displayName: 'Cetirizine', class: 'other', drawerGroup: 'Antihistamines',
    routes: ['ORAL'],
    presetDoses: [{ route: 'ORAL', amount: 10, unit: 'mg', label: '10 mg', ...dailymed('cetirizine hydrochloride tablets') }],
    pulseName: null, gtopdbLigand: 'cetirizine', gtopdbAliases: [],
    receptorAllowList: ['h1'],
    bbbPenetration: {
      value: 0.14,
      source: 'Tashiro M, et al. Dose dependency of brain histamine H1 receptor occupancy following oral administration of cetirizine hydrochloride measured using PET with [11C]doxepin. Hum Psychopharmacol 24(7):540-548, 2009: brain H1 occupancy 12.6% after 10 mg (25.2% after 20 mg; hydroxyzine 30 mg 67.6%).',
      sourceUrl: 'https://doi.org/10.1002/hup.1051',
      note: 'DERIVED so the model reproduces the PET measurement: brain occupancy 0.126 divided by the model\'s own peak peripheral H1 occupancy after 10 mg (0.873, at 79 min) is 0.14. The passive-permeability rule had scored cetirizine at 0.90 - it cannot see that cetirizine is a zwitterion and a P-glycoprotein substrate - and that made 10 mg cut consciousness to 0.35, the largest sedation of any drug in a 152-drug sweep (round-2 tester). Loratadine\'s override had been made; this one had been missed.',
    },
    notes: 'A second-generation antihistamine: a zwitterion that barely crosses the blood-brain barrier, so it blocks peripheral H1 without the sedation. The model expresses that with the same blood-brain barrier gate it uses for everything else, set from PET brain-occupancy data because the physicochemical rule gets cetirizine wrong, so the sedation is absent for a reason the data carries.',
  },
  {
    id: 'promethazine', displayName: 'Promethazine', class: 'other', drawerGroup: 'Antihistamines',
    routes: ['ORAL', 'IM', 'IV_PUSH'],
    presetDoses: [
      { route: 'ORAL', amount: 25, unit: 'mg', label: '25 mg', ...dailymed('promethazine hydrochloride tablets') },
      { route: 'IM', amount: 25, unit: 'mg', label: '25 mg IM', ...dailymed('promethazine hydrochloride injection') },
      { route: 'IV_PUSH', amount: 12.5, unit: 'mg', label: '12.5 mg', ...dailymed('promethazine hydrochloride injection') },
    ],
    pulseName: null, gtopdbLigand: 'promethazine', gtopdbAliases: [],
    receptorAllowList: ['h1'],
    directEffects: [
      { target: 'gi.nausea', gain: -0.55, note: 'A phenothiazine antihistamine with central antidopaminergic and antimuscarinic activity that GtoPdb does not quantify for it; its antiemetic action is carried directly. The negative sign is the antiemetic direction the bus documents.', ...dailymed('promethazine hydrochloride injection') },
    ],
    notes: 'A sedating antihistamine that is also an antiemetic and a mild sedative, through the mix of H1, muscarinic and dopaminergic blockade that defines the older phenothiazines. Only its H1 affinity is published in a usable form, so the antiemetic half is carried directly.',
  },
  {
    id: 'prochlorperazine', displayName: 'Prochlorperazine', class: 'other', drawerGroup: 'Gastrointestinal',
    routes: ['ORAL', 'IM', 'IV_PUSH'],
    presetDoses: [
      { route: 'ORAL', amount: 5, unit: 'mg', label: '5 mg', ...dailymed('prochlorperazine maleate tablets') },
      { route: 'IM', amount: 10, unit: 'mg', label: '10 mg IM', ...dailymed('prochlorperazine edisylate injection') },
      { route: 'IV_PUSH', amount: 10, unit: 'mg', label: '10 mg', ...dailymed('prochlorperazine edisylate injection') },
    ],
    pulseName: null, gtopdbLigand: 'prochlorperazine', gtopdbAliases: [],
    receptorAllowList: ['d2', 'd3', 'd1'],
    directEffects: [
      { target: 'gi.nausea', gain: -0.65, note: 'D2 blockade in the area postrema is the antiemetic mechanism; the model has dopamine occupancy but no nausea state for it to act on, so the antiemetic effect is carried directly on the nausea bus. Negative is the antiemetic direction.', ...dailymed('prochlorperazine edisylate injection') },
    ],
    notes: 'A phenothiazine used far more as an antiemetic than as an antipsychotic — the same D2 blockade, aimed at the area postrema. Its dopamine antagonism is the reason it can cause an acute dystonia, and its receptor panel shows the D2/D3 binding that both effects come from.',
  },
  {
    id: 'loperamide', displayName: 'Loperamide', class: 'opioid', drawerGroup: 'Gastrointestinal',
    routes: ['ORAL'],
    presetDoses: [{ route: 'ORAL', amount: 4, unit: 'mg', label: '4 mg', ...dailymed('loperamide hydrochloride capsules') }],
    pulseName: null, gtopdbLigand: null, gtopdbAliases: [],
    targetsNote: 'Deliberate. Loperamide IS a potent mu-opioid agonist (GtoPdb pKi 9.28), but it is a P-glycoprotein substrate pumped back out of the brain, so at normal doses it acts only on the ENTERIC mu receptor. This model\'s blood-brain-barrier rule is passive permeability and does not represent active efflux, so using the receptor would wrongly give loperamide central opioid effects — analgesia, sedation, respiratory depression. The peripheral action is carried as a cited direct effect instead, which is the honest shape.',
    directEffects: [
      { target: 'gi.motility', gain: -0.7, note: 'Enteric mu-opioid agonism suppresses propulsive peristalsis, which is antidiarrhoeal — the same gut action every opioid has, here without the central effects because the drug is kept out of the brain by an efflux pump the model does not simulate.', ...dailymed('loperamide hydrochloride capsules') },
    ],
    notes: 'The peripherally-restricted opioid: the same enteric constipating action morphine has, with none of the central ones, because P-glycoprotein pumps it back out of the brain. That restriction is why it is an over-the-counter antidiarrhoeal and morphine is not — and why deliberate massive overdose, which overwhelms the pump, causes opioid cardiotoxicity.',
  },
  {
    id: 'pantoprazole', displayName: 'Pantoprazole', class: 'other', drawerGroup: 'Gastrointestinal',
    routes: ['ORAL', 'IV_PUSH'],
    presetDoses: [
      { route: 'ORAL', amount: 40, unit: 'mg', label: '40 mg', ...dailymed('pantoprazole sodium delayed-release tablets') },
      { route: 'IV_PUSH', amount: 40, unit: 'mg', label: '40 mg', ...dailymed('pantoprazole sodium for injection') },
    ],
    pulseName: null, gtopdbLigand: null, gtopdbAliases: [],
    targetsNote: 'Deliberate, and identical in kind to omeprazole: a proton-pump inhibitor is a prodrug activated in the parietal-cell canaliculus that then binds the H+/K+-ATPase covalently, and neither step is representable as an affinity. The acid suppression is a cited direct effect.',
    directEffects: [
      { target: 'gi.acidSecretion', gain: -0.85, note: 'Irreversible inhibition of the proton pump, the final common path for acid secretion. Because the binding is covalent the effect outlasts the plasma drug by a day, which this model — having only reversible kinetics — cannot reproduce, so it understates the duration exactly as it does for omeprazole.', ...dailymed('pantoprazole sodium for injection') },
    ],
    notes: 'A proton-pump inhibitor, and the intravenous one reached for in an acute upper GI bleed. The contrast the set makes is with famotidine: reversible H2 blockade whose effect tracks its half-life, versus covalent pump inhibition whose effect long outlives the drug.',
  },

  /* ============================================ neuro / psych */
  {
    id: 'zolpidem', displayName: 'Zolpidem', class: 'sedative', drawerGroup: 'Sedatives',
    routes: ['ORAL'],
    presetDoses: [{ route: 'ORAL', amount: 10, unit: 'mg', label: '10 mg', ...dailymed('zolpidem tartrate tablets') }],
    pulseName: null, gtopdbLigand: 'zolpidem', gtopdbAliases: [],
    receptorAllowList: ['gaba_a_bz'],
    // Zolpidem arrives from GtoPdb as an "Allosteric modulator / Positive", which the
    // pipeline maps to the 0.3 placeholder it uses for any positive modulator whose
    // efficacy fraction the label does not carry — the same under-reading that made
    // diazepam produce a sedation of 0.05. Zolpidem is a full agonist at the alpha1 BZ
    // site; curated to full efficacy so its sedation registers.
    intrinsicActivity: {
      gaba_a_bz: {
        value: 1,
        note: 'Zolpidem is a full agonist at the alpha1-subunit benzodiazepine site; the 0.3 the pipeline derives from the word "allosteric" is a placeholder for a missing efficacy fraction, not a measurement. NOTE A LIMITATION: it is alpha1-SELECTIVE, so clinically it is hypnotic with little anxiolytic or muscle-relaxant action, but the single lumped BZ-site entry cannot separate those, and it will therefore show more anxiolysis here than the real drug has.',
        source: "Brunton LL, Knollmann BC (eds). Goodman & Gilman's The Pharmacological Basis of Therapeutics, 14th ed. McGraw Hill, 2023.",
        sourceUrl: 'https://www.accesspharmacy.mhmedical.com/book.aspx?bookid=3191',
      },
    },
    notes: 'A "Z-drug" hypnotic: chemically not a benzodiazepine but acting at the same site, selectively on the alpha1 subunit, which is why it is a sleeping tablet rather than a broad anxiolytic. Reversed by flumazenil, because it occupies the very site flumazenil blocks.',
  },
  {
    id: 'alprazolam', displayName: 'Alprazolam', class: 'sedative', drawerGroup: 'Sedatives',
    routes: ['ORAL'],
    presetDoses: [{ route: 'ORAL', amount: 0.5, unit: 'mg', label: '0.5 mg', ...dailymed('alprazolam tablets') }],
    pulseName: null, gtopdbLigand: 'alprazolam', gtopdbAliases: [],
    receptorAllowList: ['gaba_a_bz'],
    intrinsicActivity: {
      gaba_a_bz: {
        value: 1,
        note: 'Alprazolam is a high-efficacy full agonist at the benzodiazepine site; curated to full efficacy for the same reason diazepam is, because the pipeline\'s 0.3 "allosteric" placeholder carries no efficacy fraction and would understate a clinically potent anxiolytic.',
        source: "Brunton LL, Knollmann BC (eds). Goodman & Gilman's The Pharmacological Basis of Therapeutics, 14th ed. McGraw Hill, 2023.",
        sourceUrl: 'https://www.accesspharmacy.mhmedical.com/book.aspx?bookid=3191',
      },
    },
    notes: 'A short-half-life, high-potency benzodiazepine, which is exactly the combination that makes it the most habit-forming of them: a fast, strong effect followed by a fast offset and interdose withdrawal. Same site as diazepam, opposite pharmacokinetic personality.',
  },
  {
    id: 'clonazepam', displayName: 'Clonazepam', class: 'sedative', drawerGroup: 'Sedatives',
    routes: ['ORAL'],
    presetDoses: [{ route: 'ORAL', amount: 0.5, unit: 'mg', label: '0.5 mg', ...dailymed('clonazepam tablets') }],
    pulseName: null, gtopdbLigand: 'clonazepam', gtopdbAliases: [],
    receptorAllowList: ['gaba_a_bz'],
    intrinsicActivity: {
      gaba_a_bz: {
        value: 1,
        note: 'Clonazepam is a high-efficacy full agonist at the benzodiazepine site; curated to full efficacy as diazepam and alprazolam are, replacing the pipeline\'s 0.3 "allosteric" placeholder that carries no efficacy fraction.',
        source: "Brunton LL, Knollmann BC (eds). Goodman & Gilman's The Pharmacological Basis of Therapeutics, 14th ed. McGraw Hill, 2023.",
        sourceUrl: 'https://www.accesspharmacy.mhmedical.com/book.aspx?bookid=3191',
      },
    },
    notes: 'A long-acting benzodiazepine used as an anticonvulsant and for panic: the 30-to-40-hour half-life is its defining feature and the reason it accumulates. The contrast with alprazolam is entirely pharmacokinetic — same site, same efficacy, ten times the duration.',
  },
  {
    id: 'valproate', displayName: 'Valproate', class: 'other', drawerGroup: 'Anticonvulsants',
    routes: ['ORAL', 'IV_DRIP'],
    presetDoses: [
      { route: 'ORAL', amount: 500, unit: 'mg', label: '500 mg', ...dailymed('divalproex sodium tablets') },
      { route: 'IV_DRIP', amount: 1000, unit: 'mg', label: '1 g over 10 min', durationMin: 10, ...dailymed('valproate sodium injection') },
    ],
    pulseName: null, gtopdbLigand: null, gtopdbAliases: [],
    targetsNote: 'Deliberate. Valproate acts through several diffuse mechanisms at once — sodium-channel and T-type calcium modulation, raised GABA — none of which GtoPdb indexes with a usable human affinity (its one row, an HDAC1 pIC50 of 3.4, is not the anticonvulsant mechanism and sits far below any plasma level). The broad-spectrum effect is carried directly.',
    directEffects: [
      { target: 'neuro.seizureThreshold', gain: 0.7, note: 'Raises the seizure threshold through a mixture of sodium-channel block, T-type calcium modulation and enhanced GABAergic transmission — which is why it is the broadest-spectrum anticonvulsant and works across seizure types that the sodium-channel drugs alone do not cover.', ...dailymed('divalproex sodium tablets') },
      { target: 'neuro.sedation', gain: 0.2, note: 'Dose-related sedation, the usual limit on how fast it can be titrated.', ...dailymed('divalproex sodium tablets') },
    ],
    notes: 'The broad-spectrum anticonvulsant and mood stabiliser. Its teratogenicity and hepatotoxicity are the reasons it is avoided in pregnancy, and its enzyme INHIBITION (the opposite of carbamazepine\'s induction) is a real interaction the model does not carry.',
  },
  {
    id: 'levetiracetam', displayName: 'Levetiracetam', class: 'other', drawerGroup: 'Anticonvulsants',
    routes: ['ORAL', 'IV_DRIP'],
    presetDoses: [
      { route: 'ORAL', amount: 500, unit: 'mg', label: '500 mg', ...dailymed('levetiracetam tablets') },
      { route: 'IV_DRIP', amount: 1000, unit: 'mg', label: '1 g over 15 min', durationMin: 15, ...dailymed('levetiracetam injection') },
    ],
    pulseName: null, gtopdbLigand: null, gtopdbAliases: [],
    targetsNote: 'Deliberate. Levetiracetam binds the synaptic vesicle protein SV2A, a target with no human affinity value in GtoPdb and not in this registry; the anticonvulsant effect is carried directly.',
    directEffects: [
      { target: 'neuro.seizureThreshold', gain: 0.65, note: 'Binding SV2A modulates neurotransmitter release and raises the seizure threshold by a mechanism unlike any of the sodium-channel drugs — which is why it combines with them additively and why it is a first choice for status epilepticus with almost no drug interactions.', ...dailymed('levetiracetam injection') },
    ],
    notes: 'The anticonvulsant with an entirely different mechanism (synaptic vesicle protein SV2A) and almost no interactions or protein binding — which is exactly why it has become a first-line agent and a common second drug in status epilepticus. Renally cleared, so its dose falls with renal function.',
  },
  {
    id: 'pregabalin', displayName: 'Pregabalin', class: 'other', drawerGroup: 'Anticonvulsants',
    routes: ['ORAL'],
    presetDoses: [{ route: 'ORAL', amount: 75, unit: 'mg', label: '75 mg', ...dailymed('pregabalin capsules') }],
    pulseName: null, gtopdbLigand: null, gtopdbAliases: [],
    targetsNote: 'Deliberate. Pregabalin binds the alpha-2-delta subunit of the voltage-gated calcium channel (CACNA2D1), a target GtoPdb does not carry a usable human affinity for and which is not in this registry; its effects are cited direct effects.',
    directEffects: [
      { target: 'neuro.analgesia', gain: 0.5, note: 'Binding the alpha-2-delta calcium-channel subunit reduces excitatory neurotransmitter release in sensitised pathways, which is analgesic in neuropathic pain — its principal use and a mechanism quite separate from the opioids and NSAIDs.', ...dailymed('pregabalin capsules') },
      { target: 'neuro.seizureThreshold', gain: 0.4, note: 'The same reduction in excitatory release raises the seizure threshold, its original anticonvulsant indication.', ...dailymed('pregabalin capsules') },
      { target: 'neuro.sedation', gain: 0.3, note: 'Dose-related sedation and dizziness, the usual dose-limiting effects and part of why it is misused.', ...dailymed('pregabalin capsules') },
    ],
    notes: 'A calcium-channel-subunit ligand used for neuropathic pain, anxiety and seizures, renally cleared and increasingly recognised for its own dependence and misuse potential — which is why the analgesia, sedation and its abuse liability all sit on the bus together.',
  },
  {
    id: 'buprenorphine', displayName: 'Buprenorphine', class: 'opioid', drawerGroup: 'Opioids',
    routes: ['SUBLINGUAL', 'IV_PUSH'],
    presetDoses: [
      { route: 'SUBLINGUAL', amount: 8, unit: 'mg', label: '8 mg SL', ...dailymed('buprenorphine sublingual tablets') },
      { route: 'IV_PUSH', amount: 0.3, unit: 'mg', label: '300 mcg', ...dailymed('buprenorphine hydrochloride injection') },
    ],
    pulseName: null, gtopdbLigand: 'buprenorphine', gtopdbAliases: [],
    receptorAllowList: ['mu', 'kappa', 'delta'],
    scheduled: true,
    scheduleNote: 'A controlled substance and a licensed opioid-dependence and analgesia treatment. Modelled because it is the cleanest illustration in the set of PARTIAL mu agonism — a ceiling on respiratory depression that a full agonist does not have — and because that ceiling is exactly the safety property it is prescribed for.',
    notes: 'A high-affinity PARTIAL mu agonist and kappa antagonist. The partial agonism is the whole point: it occupies mu tightly enough to block a full agonist and to hold off withdrawal, but its own effect plateaus, so its respiratory depression has a ceiling that heroin and fentanyl do not. That tight binding is also why it can precipitate withdrawal in someone still carrying a full agonist.',
  },
  {
    id: 'methadone', displayName: 'Methadone', class: 'opioid', drawerGroup: 'Opioids',
    routes: ['ORAL', 'IV_PUSH'],
    presetDoses: [
      { route: 'ORAL', amount: 10, unit: 'mg', label: '10 mg', ...dailymed('methadone hydrochloride tablets') },
      { route: 'IV_PUSH', amount: 5, unit: 'mg', label: '5 mg', ...dailymed('methadone hydrochloride injection') },
    ],
    pulseName: null, gtopdbLigand: 'methadone', gtopdbAliases: [],
    receptorAllowList: ['mu', 'delta', 'kappa'],
    scheduled: true,
    scheduleNote: 'A controlled substance and a licensed opioid-dependence and analgesia treatment. Modelled because its long and variable half-life against a fast-onset effect is the pharmacokinetic trap behind many of its deaths, and because its QT prolongation is a receptor-independent hazard the model can show.',
    directEffects: [
      { target: 'cardio.qtInterval', gain: 0.5, note: 'Methadone blocks the hERG potassium channel and prolongs the QT interval independently of its opioid action — a torsades risk that rises with dose and is the reason methadone programmes monitor the ECG. Carried directly because GtoPdb publishes only its opioid rows.', ...dailymed('methadone hydrochloride tablets') },
    ],
    notes: 'A full mu agonist with a long, highly variable half-life and an effect that comes on faster than it wears off — so a dose that feels right acutely can accumulate to a fatal level over days. Its NMDA antagonism (useful in tolerance) is not modelled; its QT prolongation is.',
  },
  {
    id: 'codeine', displayName: 'Codeine', class: 'opioid', drawerGroup: 'Opioids',
    routes: ['ORAL'],
    presetDoses: [{ route: 'ORAL', amount: 30, unit: 'mg', label: '30 mg', ...dailymed('codeine sulfate tablets') }],
    pulseName: null, gtopdbLigand: 'codeine', gtopdbAliases: [],
    receptorAllowList: ['mu'],
    scheduled: true,
    scheduleNote: 'A controlled substance and a licensed analgesic and antitussive. Modelled because it is a weak mu agonist and a PRODRUG — most of its analgesia comes from the fraction a CYP2D6 enzyme converts to morphine — which is the clearest pharmacogenetic lesson in the opioid set.',
    directEffects: [
      { target: 'resp.cough', gain: -0.6, note: 'Codeine suppresses the brainstem cough reflex at doses below its analgesic ones, which is its antitussive use. resp.cough is a readout target, so this shows the antitussive action without altering ventilation.', ...dailymed('codeine sulfate tablets') },
    ],
    notes: 'A weak mu agonist in its own right and a prodrug for morphine through CYP2D6 — so an ultrarapid metaboliser can reach dangerous morphine levels from an ordinary dose and a poor metaboliser gets almost no analgesia. The model carries the weak direct mu affinity but not the metabolic conversion, which is stated as a limitation.',
  },
  {
    id: 'lsd', displayName: 'LSD', class: 'psychedelic', drawerGroup: 'Controlled',
    routes: ['ORAL'],
    presetDoses: [{ route: 'ORAL', amount: 0.1, unit: 'mg', label: '100 mcg (study exposure)', ...study('Dolder PC, et al. Pharmacokinetics and concentration-effect relationship of oral LSD in humans. Int J Neuropsychopharmacol 19(1):pyv072, 2016. Controlled human laboratory exposures.', 'https://doi.org/10.1093/ijnp/pyv072') }],
    pulseName: null, gtopdbLigand: 'LSD', gtopdbAliases: ['lysergide', 'lysergic acid diethylamide'],
    receptorAllowList: ['ht2a', 'ht2c', 'ht7'],
    scheduled: true,
    scheduleNote: 'A controlled substance currently under study for psychiatric use. Modelled because 5-HT2A is a major serotonergic receptor no other compound in the set reaches as a high-efficacy agonist, and because its pharmacology — a potent 5-HT2A agonist active at microgram doses — is core to understanding the receptor.',
    directEffects: [
      { target: 'neuro.psychedelia', gain: 0.9, note: '5-HT2A agonism on cortical layer-V pyramidal neurons is the accepted mechanism of the psychedelic state; the model has 5-HT2A occupancy but no dedicated psychedelia gain on that receptor, so the subjective effect is carried directly on the psychedelia bus. Cited from the receptor pharmacology, dosed as a study exposure.', ...study('Nichols DE. Psychedelics. Pharmacol Rev 68(2):264-355, 2016.', 'https://doi.org/10.1124/pr.115.011478') },
      { target: 'neuro.euphoria', gain: 0.4, note: 'The mood elevation of the experience, a smaller and more variable effect than the perceptual one.', ...study('Nichols DE. Psychedelics. Pharmacol Rev 68(2):264-355, 2016.', 'https://doi.org/10.1124/pr.115.011478') },
    ],
    notes: 'A serotonergic psychedelic active at microgram doses, which is what makes it the reference 5-HT2A agonist. Its 5-HT2A occupancy also drives the thermogenic and vasoconstrictor gains that receptor already carries, so the modest sympathomimetic signs emerge from the same binding as the perceptual effects.',
  },
  {
    id: 'physostigmine', displayName: 'Physostigmine', class: 'other', drawerGroup: 'Autonomic',
    routes: ['IV_PUSH'],
    presetDoses: [{ route: 'IV_PUSH', amount: 1, unit: 'mg', label: '1 mg', ...dailymed('physostigmine salicylate injection') }],
    pulseName: null, gtopdbLigand: null, gtopdbAliases: [],
    targetsNote: 'Deliberate. Physostigmine inhibits acetylcholinesterase (GtoPdb gives a human pIC50, but the enzyme is not in this registry). Unlike neostigmine it is a TERTIARY amine and crosses into the brain, so its effects — both central and peripheral — are carried directly.',
    directEffects: [
      { target: 'neuro.arousal', gain: 0.5, note: 'Raising CENTRAL acetylcholine reverses the delirium and coma of antimuscarinic poisoning, which is physostigmine\'s signature use and the reason it, and not the quaternary neostigmine, is the antidote. The positive arousal push opposes the sedation an antimuscarinic delirium sits within.', ...dailymed('physostigmine salicylate injection') },
      { target: 'cardio.heartRate', gain: -0.4, note: 'Peripheral muscarinic excess slows the sinoatrial node — a bradycardia that is the hazard of giving too much, and the reason atropine is kept to hand when physostigmine is used.', ...dailymed('physostigmine salicylate injection') },
      { target: 'gi.motility', gain: 0.45, note: 'Muscarinic stimulation of the gut, part of the cholinergic picture that too large a dose produces.', ...dailymed('physostigmine salicylate injection') },
    ],
    notes: 'The centrally-acting anticholinesterase, and the mirror image of glycopyrrolate: because it is a tertiary amine it crosses into the brain, which is exactly what makes it the antidote to central antimuscarinic delirium and what makes its own overdose a cholinergic crisis.',
  },

  /* ============================================ anti-infectives */
  {
    id: 'amoxicillin', displayName: 'Amoxicillin', class: 'other', drawerGroup: 'Antibiotics',
    routes: ['ORAL', 'IV_PUSH'],
    presetDoses: [
      { route: 'ORAL', amount: 500, unit: 'mg', label: '500 mg', ...dailymed('amoxicillin capsules') },
      { route: 'IV_PUSH', amount: 1000, unit: 'mg', label: '1 g IV', ...dailymed('amoxicillin sodium injection') },
    ],
    pulseName: null, gtopdbLigand: null, gtopdbAliases: [],
    targetsNote: 'Deliberate. Amoxicillin acts on the bacterial penicillin-binding proteins, not on any human receptor; its whole pharmacology is in the antimicrobial block.',
    antimicrobial: {
      spectrum: [
        { pathogenId: 'strep_pneumoniae', mic_mg_per_L: 0.5, ...eucast('Amoxicillin wild-type ECOFF for Streptococcus pneumoniae, 0.5 mg/L.') },
        { pathogenId: 'e_coli', mic_mg_per_L: 8, ...eucast('Amoxicillin(-ampicillin) wild-type ECOFF for Escherichia coli, 8 mg/L; much of E. coli is now beta-lactamase-producing and resistant.') },
      ],
      maxKill_per_h: 2.0, hill: 1, pattern: 'time-dependent',
      ...NIELSEN_FRIBERG,
      note: 'An aminopenicillin: time-dependent killing, so efficacy tracks the time free drug stays above the MIC rather than the peak. The maximal kill rate is a modelling anchor scaled to the beta-lactam class in Nielsen & Friberg; the MICs and the time-dependent pattern are sourced.',
    },
    notes: 'The workhorse oral penicillin. Its spectrum here — good against pneumococcus, unreliable against E. coli because of acquired beta-lactamases — is the lesson that a drug given for the wrong bug visibly does nothing, which is what the antimicrobial model is for.',
  },
  {
    id: 'ceftriaxone', displayName: 'Ceftriaxone', class: 'other', drawerGroup: 'Antibiotics',
    routes: ['IV_PUSH', 'IM'],
    presetDoses: [
      { route: 'IV_PUSH', amount: 2000, unit: 'mg', label: '2 g IV', ...dailymed('ceftriaxone sodium injection') },
      { route: 'IM', amount: 1000, unit: 'mg', label: '1 g IM', ...dailymed('ceftriaxone sodium injection') },
    ],
    pulseName: null, gtopdbLigand: null, gtopdbAliases: [],
    targetsNote: 'Deliberate. A cephalosporin acts on bacterial penicillin-binding proteins; all of its modelled pharmacology is in the antimicrobial block.',
    antimicrobial: {
      spectrum: [
        { pathogenId: 'strep_pneumoniae', mic_mg_per_L: 0.5, ...eucast('Ceftriaxone wild-type ECOFF for Streptococcus pneumoniae, 0.5 mg/L.') },
        { pathogenId: 'e_coli', mic_mg_per_L: 0.06, ...eucast('Ceftriaxone wild-type ECOFF for Escherichia coli, 0.06 mg/L (raised by ESBLs, not modelled).') },
        { pathogenId: 'staph_aureus', mic_mg_per_L: 4, ...eucast('Ceftriaxone modal MIC for methicillin-susceptible Staphylococcus aureus, ~4 mg/L.') },
      ],
      maxKill_per_h: 2.0, hill: 1, pattern: 'time-dependent',
      ...NIELSEN_FRIBERG,
      note: 'A third-generation cephalosporin with a broad spectrum and a long half-life that allows once-daily dosing. Time-dependent killing; the kill ceiling is a beta-lactam-class modelling anchor and the MICs are sourced.',
    },
    notes: 'The broad-spectrum workhorse of the ward, covering pneumococcus, most E. coli and methicillin-susceptible staph. Its once-daily dosing follows from a half-life far longer than the other cephalosporins, and its half-biliary clearance means renal failure does not force a dose change.',
  },
  {
    id: 'cefazolin', displayName: 'Cefazolin', class: 'other', drawerGroup: 'Antibiotics',
    routes: ['IV_PUSH', 'IM'],
    presetDoses: [
      { route: 'IV_PUSH', amount: 2000, unit: 'mg', label: '2 g IV', ...dailymed('cefazolin injection') },
      { route: 'IM', amount: 1000, unit: 'mg', label: '1 g IM', ...dailymed('cefazolin injection') },
    ],
    pulseName: null, gtopdbLigand: null, gtopdbAliases: [],
    targetsNote: 'Deliberate. A cephalosporin acts on bacterial penicillin-binding proteins; its modelled pharmacology is entirely in the antimicrobial block.',
    antimicrobial: {
      spectrum: [
        { pathogenId: 'staph_aureus', mic_mg_per_L: 1, ...eucast('Cefazolin wild-type MIC for methicillin-susceptible Staphylococcus aureus, ~1 mg/L; it is a first-line MSSA agent.') },
        { pathogenId: 'e_coli', mic_mg_per_L: 2, ...eucast('Cefazolin wild-type MIC for Escherichia coli, ~1-2 mg/L.') },
      ],
      maxKill_per_h: 2.0, hill: 1, pattern: 'time-dependent',
      ...NIELSEN_FRIBERG,
      note: 'A first-generation cephalosporin whose reliable anti-staphylococcal activity makes it the standard surgical-prophylaxis and MSSA drug. Time-dependent killing; kill ceiling a beta-lactam-class anchor, MICs sourced.',
    },
    notes: 'The first-generation cephalosporin and the preferred drug for a methicillin-susceptible staph infection and for surgical prophylaxis — better tolerated and narrower than the newer agents, which is the point of keeping it in use.',
  },
  {
    id: 'vancomycin', displayName: 'Vancomycin', class: 'other', drawerGroup: 'Antibiotics',
    routes: ['IV_DRIP'],
    presetDoses: [{ route: 'IV_DRIP', amount: 1500, unit: 'mg', label: '1.5 g over 90 min', durationMin: 90, ...dailymed('vancomycin hydrochloride injection') }],
    pulseName: null, gtopdbLigand: null, gtopdbAliases: [],
    targetsNote: 'Deliberate. Vancomycin binds the D-Ala-D-Ala terminus of the bacterial cell-wall precursor, a target with no human counterpart; its pharmacology is the antimicrobial block.',
    antimicrobial: {
      spectrum: [
        { pathogenId: 'staph_aureus', mic_mg_per_L: 1, ...eucast('Vancomycin wild-type modal MIC for Staphylococcus aureus, ~1 mg/L; it is the reference agent for MRSA, which this MSSA pathogen stands in for.') },
        { pathogenId: 'strep_pneumoniae', mic_mg_per_L: 0.25, ...eucast('Vancomycin wild-type ECOFF for Streptococcus pneumoniae, 0.25 mg/L.') },
      ],
      maxKill_per_h: 1.2, hill: 1, pattern: 'exposure-dependent',
      ...NIELSEN_FRIBERG,
      note: 'A glycopeptide active only against Gram-positive organisms; efficacy tracks the 24-hour exposure (AUC/MIC), which is why it is dosed to a target level. The slower kill ceiling reflects its comparatively sluggish, exposure-dependent killing; the MICs are sourced.',
    },
    notes: 'The Gram-positive-only glycopeptide, reserved for resistant staph and for the seriously penicillin-allergic. It is dosed to an exposure target rather than a peak, must be infused slowly to avoid histamine release ("red man syndrome"), and is renally cleared — the reasons it needs monitoring.',
  },
  {
    id: 'meropenem', displayName: 'Meropenem', class: 'other', drawerGroup: 'Antibiotics',
    routes: ['IV_PUSH'],
    presetDoses: [{ route: 'IV_PUSH', amount: 1000, unit: 'mg', label: '1 g IV', ...dailymed('meropenem injection') }],
    pulseName: null, gtopdbLigand: null, gtopdbAliases: [],
    targetsNote: 'Deliberate. A carbapenem acts on bacterial penicillin-binding proteins; its modelled pharmacology is entirely in the antimicrobial block.',
    antimicrobial: {
      spectrum: [
        { pathogenId: 'e_coli', mic_mg_per_L: 0.03, ...eucast('Meropenem wild-type ECOFF for Escherichia coli, 0.03 mg/L.') },
        { pathogenId: 'strep_pneumoniae', mic_mg_per_L: 0.12, ...eucast('Meropenem wild-type ECOFF for Streptococcus pneumoniae, ~0.12 mg/L.') },
        { pathogenId: 'staph_aureus', mic_mg_per_L: 0.12, ...eucast('Meropenem wild-type MIC for methicillin-susceptible Staphylococcus aureus, ~0.12 mg/L.') },
      ],
      maxKill_per_h: 2.2, hill: 1, pattern: 'time-dependent',
      ...NIELSEN_FRIBERG,
      note: 'A carbapenem, the broadest beta-lactam here, reserved for severe or resistant infection. Time-dependent killing; the kill ceiling is a beta-lactam-class anchor and the MICs are sourced.',
    },
    notes: 'The broad-spectrum reserve carbapenem, kept for severe sepsis and multi-resistant Gram-negatives — the drug of last resort whose overuse breeds the carbapenemases that defeat it. Renally cleared with a short half-life, so it is given frequently or by extended infusion.',
  },
  {
    id: 'ciprofloxacin', displayName: 'Ciprofloxacin', class: 'other', drawerGroup: 'Antibiotics',
    routes: ['ORAL', 'IV_DRIP'],
    presetDoses: [
      { route: 'ORAL', amount: 500, unit: 'mg', label: '500 mg', ...dailymed('ciprofloxacin tablets') },
      { route: 'IV_DRIP', amount: 400, unit: 'mg', label: '400 mg over 60 min', durationMin: 60, ...dailymed('ciprofloxacin injection') },
    ],
    pulseName: null, gtopdbLigand: null, gtopdbAliases: [],
    targetsNote: 'Deliberate. A fluoroquinolone inhibits bacterial DNA gyrase and topoisomerase IV, not a human target; its pharmacology is the antimicrobial block.',
    antimicrobial: {
      spectrum: [
        { pathogenId: 'e_coli', mic_mg_per_L: 0.03, ...eucast('Ciprofloxacin wild-type ECOFF for Escherichia coli, 0.03-0.06 mg/L (widely raised by acquired resistance).') },
        { pathogenId: 'staph_aureus', mic_mg_per_L: 0.5, ...eucast('Ciprofloxacin wild-type ECOFF for Staphylococcus aureus, ~0.5 mg/L.') },
        { pathogenId: 'vibrio_cholerae', mic_mg_per_L: 0.03, ...eucast('Ciprofloxacin is highly active against Vibrio cholerae, wild-type MIC ~0.008-0.03 mg/L.') },
      ],
      maxKill_per_h: 3.5, hill: 1.5, pattern: 'concentration-dependent',
      ...NIELSEN_FRIBERG,
      note: 'A fluoroquinolone: concentration-dependent killing, so the peak-to-MIC ratio predicts efficacy and the steeper Hill slope reflects its sharp concentration-kill curve. The kill ceiling is a fluoroquinolone-class anchor; the MICs are sourced.',
    },
    notes: 'The oral Gram-negative fluoroquinolone, with the near-100% oral bioavailability that lets a serious infection be treated without a drip. Its concentration-dependent killing is the pharmacodynamic contrast with the time-dependent beta-lactams, and its tendonopathy and QT effects are the reasons its use has narrowed.',
  },
  {
    id: 'doxycycline', displayName: 'Doxycycline', class: 'other', drawerGroup: 'Antibiotics',
    routes: ['ORAL', 'IV_DRIP'],
    presetDoses: [
      { route: 'ORAL', amount: 100, unit: 'mg', label: '100 mg', ...dailymed('doxycycline hyclate tablets') },
      { route: 'IV_DRIP', amount: 100, unit: 'mg', label: '100 mg over 60 min', durationMin: 60, ...dailymed('doxycycline hyclate injection') },
    ],
    pulseName: null, gtopdbLigand: null, gtopdbAliases: [],
    targetsNote: 'Deliberate. A tetracycline binds the bacterial 30S ribosome and, in the parasite, the apicoplast ribosome — neither a human target; its pharmacology is the antimicrobial block.',
    antimicrobial: {
      spectrum: [
        { pathogenId: 'strep_pneumoniae', mic_mg_per_L: 0.5, ...eucast('Doxycycline wild-type ECOFF for Streptococcus pneumoniae, ~0.5 mg/L.') },
        { pathogenId: 'staph_aureus', mic_mg_per_L: 0.25, ...eucast('Doxycycline wild-type MIC for Staphylococcus aureus, ~0.25 mg/L.') },
        { pathogenId: 'vibrio_cholerae', mic_mg_per_L: 1, ...eucast('Doxycycline/tetracycline wild-type MIC for Vibrio cholerae, ~1 mg/L; doxycycline is an adjunct in cholera.') },
      ],
      maxKill_per_h: 0.8, hill: 1, pattern: 'exposure-dependent',
      ...NIELSEN_FRIBERG,
      note: 'A tetracycline: bacteriostatic, so the kill ceiling is deliberately low — it suppresses growth more than it kills, and efficacy tracks total exposure. The MICs are sourced. Its slow-acting antimalarial activity is real but not readily reducible to an MIC, so P. falciparum is left off rather than given an invented number.',
    },
    notes: 'The broad, oral, bacteriostatic tetracycline — atypical pneumonia, cholera, rickettsia, acne, and malaria prophylaxis. Its low kill ceiling here encodes that it is static rather than cidal, and P. falciparum is deliberately omitted from its spectrum because its slow antimalarial action has no clean MIC to cite.',
  },
  {
    id: 'azithromycin', displayName: 'Azithromycin', class: 'other', drawerGroup: 'Antibiotics',
    routes: ['ORAL', 'IV_DRIP'],
    presetDoses: [
      { route: 'ORAL', amount: 500, unit: 'mg', label: '500 mg', ...dailymed('azithromycin tablets') },
      { route: 'IV_DRIP', amount: 500, unit: 'mg', label: '500 mg over 60 min', durationMin: 60, ...dailymed('azithromycin injection') },
    ],
    pulseName: null, gtopdbLigand: null, gtopdbAliases: [],
    targetsNote: 'Deliberate. A macrolide binds the bacterial 50S ribosome, not a human target; its pharmacology is the antimicrobial block.',
    antimicrobial: {
      spectrum: [
        { pathogenId: 'strep_pneumoniae', mic_mg_per_L: 0.25, ...eucast('Azithromycin wild-type ECOFF for Streptococcus pneumoniae, ~0.25 mg/L (macrolide resistance is common).') },
        { pathogenId: 'staph_aureus', mic_mg_per_L: 1, ...eucast('Azithromycin wild-type MIC for Staphylococcus aureus, ~1 mg/L.') },
        { pathogenId: 'vibrio_cholerae', mic_mg_per_L: 0.5, ...eucast('Azithromycin is a first-line cholera treatment; wild-type MIC for Vibrio cholerae ~0.25-1 mg/L.') },
      ],
      maxKill_per_h: 0.9, hill: 1, pattern: 'exposure-dependent',
      ...NIELSEN_FRIBERG,
      note: 'A macrolide with enormous tissue distribution and a multi-day half-life, so a short course keeps working for days. Largely bacteriostatic, hence the modest kill ceiling; efficacy tracks total exposure. The MICs are sourced.',
    },
    notes: 'The macrolide whose pharmacokinetics are the lesson: it concentrates in tissue to levels far above plasma and has a half-life of days, so a three-day course treats for a week. First-line for atypical pneumonia and for cholera; its QT prolongation is the cardiac caveat.',
  },
  {
    id: 'oseltamivir', displayName: 'Oseltamivir', class: 'other', drawerGroup: 'Antivirals',
    routes: ['ORAL'],
    presetDoses: [{ route: 'ORAL', amount: 75, unit: 'mg', label: '75 mg', ...dailymed('oseltamivir phosphate capsules') }],
    pulseName: null, gtopdbLigand: null, gtopdbAliases: [],
    targetsNote: 'Deliberate. Oseltamivir\'s active carboxylate inhibits the influenza neuraminidase, a viral enzyme; there is no human target and its pharmacology is the antimicrobial block.',
    antimicrobial: {
      spectrum: [
        { pathogenId: 'influenza_a', mic_mg_per_L: 0.18,
          source: 'Mendel DB, et al. Oral administration of a prodrug of the influenza virus neuraminidase inhibitor GS4104 (oseltamivir). Antimicrob Agents Chemother 42(3):640-646, 1998; cell-culture EC50 ~0.65 uM for oseltamivir carboxylate against influenza A.',
          sourceUrl: 'https://doi.org/10.1128/AAC.42.3.640',
          note: 'Cell-culture EC50 ~0.65 uM for the active carboxylate; converted to mg/L using MW 284.35 (0.65 uM x 0.28435 = 0.18 mg/L). The enzyme IC50 is nanomolar, but the cell-culture EC50 is the relevant whole-virus potency for a plasma-concentration model.' },
      ],
      maxKill_per_h: 0.3, hill: 1, pattern: 'exposure-dependent',
      killSource: 'Canini L, et al. and standard influenza viral-dynamic models; suppression of neuraminidase-dependent viral release rather than direct kill.',
      killSourceUrl: 'https://doi.org/10.1128/AAC.42.3.640',
      note: 'A neuraminidase inhibitor blocks release of new virions rather than killing infected cells, so the effect is a low-rate SUPPRESSION of replication (virustatic). The maximal suppression rate is a modelling anchor for a virustatic drug; the EC50 is sourced. Its clinical benefit is modest and time-critical, which the small kill rate reflects.',
    },
    notes: 'The oral influenza neuraminidase inhibitor: it stops new virions detaching from infected cells rather than killing anything, which is why its benefit is small and depends on starting within a day or two of onset. Modelled as a weak virustatic suppression, matching that modest real effect.',
  },
  {
    id: 'remdesivir', displayName: 'Remdesivir', class: 'other', drawerGroup: 'Antivirals',
    routes: ['IV_DRIP'],
    presetDoses: [{ route: 'IV_DRIP', amount: 200, unit: 'mg', label: '200 mg loading over 60 min', durationMin: 60, ...dailymed('remdesivir injection') }],
    pulseName: null, gtopdbLigand: null, gtopdbAliases: [],
    targetsNote: 'Deliberate. Remdesivir\'s intracellular triphosphate inhibits the SARS-CoV-2 RNA polymerase, a viral enzyme; there is no human target and its pharmacology is the antimicrobial block.',
    antimicrobial: {
      spectrum: [
        { pathogenId: 'sars_cov_2', mic_mg_per_L: 0.083,
          source: 'Wang M, et al. Remdesivir and chloroquine effectively inhibit the recently emerged novel coronavirus (2019-nCoV) in vitro. Cell Res 30(3):269-271, 2020; EC50 0.77 uM (Vero E6), and Pruijssers et al. EC50 ~0.01-0.14 uM in respiratory cell lines.',
          sourceUrl: 'https://doi.org/10.1038/s41422-020-0282-0',
          note: 'Representative cell-culture EC50 ~0.137 uM against SARS-CoV-2 (China CDC / Wuhan Institute of Virology); converted with MW 602.58 (0.137 uM x 0.60258 = 0.083 mg/L). Cell line and assay change this several-fold, which is stated.' },
      ],
      maxKill_per_h: 0.35, hill: 1, pattern: 'exposure-dependent',
      killSource: 'Standard SARS-CoV-2 viral-dynamic modelling; a nucleotide-analogue polymerase inhibitor suppresses replication rather than killing infected cells.',
      killSourceUrl: 'https://doi.org/10.1038/s41422-020-0282-0',
      note: 'A polymerase inhibitor suppresses viral replication (virustatic), so the ceiling is a low suppression rate rather than a kill. The EC50 is sourced; the suppression rate is a modelling anchor. The parent drug is a delivery vehicle for a longer-lived intracellular triphosphate, a mismatch between plasma level and effect that the model does not resolve.',
    },
    notes: 'The intravenous antiviral for COVID-19: a nucleotide analogue whose active triphosphate stalls the viral polymerase. Its clinical effect is a modest shortening of illness, matched here by a low suppression rate, and the gap between its short-lived plasma parent and its long-lived intracellular active form is stated as a limitation.',
  },
  {
    id: 'nirmatrelvir', displayName: 'Nirmatrelvir', class: 'other', drawerGroup: 'Antivirals',
    routes: ['ORAL'],
    presetDoses: [{ route: 'ORAL', amount: 300, unit: 'mg', label: '300 mg', ...dailymed('nirmatrelvir tablets') }],
    pulseName: null, gtopdbLigand: null, gtopdbAliases: [],
    targetsNote: 'Deliberate. Nirmatrelvir inhibits the SARS-CoV-2 main protease (Mpro/3CLpro), a viral enzyme with no human counterpart; its pharmacology is the antimicrobial block. It is co-formulated with ritonavir purely as a CYP3A booster, which the model does not represent.',
    antimicrobial: {
      spectrum: [
        { pathogenId: 'sars_cov_2', mic_mg_per_L: 0.019,
          source: 'Owen DR, et al. An oral SARS-CoV-2 Mpro inhibitor clinical candidate for the treatment of COVID-19. Science 374(6575):1586-1593, 2021; antiviral EC50 ~38 nM in infected cells.',
          sourceUrl: 'https://doi.org/10.1126/science.abl4784',
          note: 'Cell-based antiviral EC50 ~38 nM against SARS-CoV-2; converted with MW 499.53 (0.038 uM x 0.49953 = 0.019 mg/L).' },
      ],
      maxKill_per_h: 0.4, hill: 1, pattern: 'exposure-dependent',
      killSource: 'Standard SARS-CoV-2 viral-dynamic modelling; a protease inhibitor suppresses production of infectious virions rather than killing infected cells.',
      killSourceUrl: 'https://doi.org/10.1126/science.abl4784',
      note: 'A main-protease inhibitor blocks maturation of new virions, a virustatic suppression; the EC50 is sourced and the suppression ceiling is a modelling anchor. Ritonavir boosting, essential to its real exposure, is not modelled and is noted.',
    },
    notes: 'The oral COVID-19 antiviral, a main-protease inhibitor given with a low dose of ritonavir to block its own metabolism. The model carries the antiviral potency but not the ritonavir boost, so the exposure it produces from a dose is lower than the real regimen — stated as a limitation.',
  },
  {
    id: 'artesunate', displayName: 'Artesunate', class: 'other', drawerGroup: 'Antiparasitics',
    routes: ['IV_PUSH'],
    presetDoses: [{ route: 'IV_PUSH', amount: 168, unit: 'mg', label: '2.4 mg/kg', ...dailymed('artesunate for injection') }],
    pulseName: null, gtopdbLigand: null, gtopdbAliases: [],
    targetsNote: 'Deliberate. Artesunate (through its active metabolite dihydroartemisinin) kills the malaria parasite by iron-catalysed radical damage; there is no human target and its pharmacology is the antimicrobial block.',
    antimicrobial: {
      spectrum: [
        { pathogenId: 'p_falciparum', mic_mg_per_L: 0.0005,
          source: 'Lopera-Mesa TM, et al. Plasmodium falciparum clearance rates in response to artesunate in Malian children. Lancet Infect Dis 13(4):331-339, 2013; in-vitro IC50 ~1.2 nM for artesunate against P. falciparum.',
          sourceUrl: 'https://doi.org/10.1016/S1473-3099(13)70058-9',
          note: 'In-vitro IC50 ~1.2 nM against P. falciparum (Malian wild-type isolates); converted with MW 384.42 (0.0012 uM x 0.38442 = 0.00046 mg/L, rounded 0.0005). Artemisinin resistance raises this several-fold.' },
      ],
      maxKill_per_h: 4.0, hill: 1, pattern: 'concentration-dependent',
      killSource: 'White NJ. Malaria parasite clearance. Malar J 16:88, 2017; artemisinins produce the fastest parasite reduction ratio of any antimalarial (~10^4 per asexual cycle).',
      killSourceUrl: 'https://doi.org/10.1186/s12936-017-1731-1',
      note: 'Artemisinins give the fastest parasite clearance of any antimalarial — a parasite reduction ratio near 10^4 per 48-hour cycle — so the kill ceiling is set high and concentration-dependent. The potency (IC50) is sourced; the ceiling is a modelling anchor to that clearance rate.',
    },
    notes: 'The first-line drug for severe malaria, and the fastest-acting antimalarial there is — its active metabolite dihydroartemisinin clears parasites within hours. Its own half-life is under an hour, which is why it is always given with a longer-lived partner drug; that partner is not modelled, and the risk of recrudescence without it is the reason it matters.',
  },
  {
    id: 'tenofovir', displayName: 'Tenofovir (TDF)', class: 'other', drawerGroup: 'Antivirals',
    routes: ['ORAL'],
    presetDoses: [{ route: 'ORAL', amount: 300, unit: 'mg', label: '300 mg', ...dailymed('tenofovir disoproxil fumarate tablets') }],
    pulseName: null, gtopdbLigand: null, gtopdbAliases: [],
    targetsNote: 'Deliberate. Tenofovir\'s intracellular diphosphate inhibits HIV-1 reverse transcriptase, a viral enzyme; there is no human target and its pharmacology is the antimicrobial block.',
    antimicrobial: {
      spectrum: [
        { pathogenId: 'hiv_1', mic_mg_per_L: 0.05,
          source: 'FDA Structured Product Label — Viread (tenofovir disoproxil fumarate), Microbiology: HIV-1 EC50 0.04-8.5 uM in lymphoid cell lines and PBMCs.',
          sourceUrl: 'https://dailymed.nlm.nih.gov/dailymed/search.cfm?labeltype=all&query=tenofovir%20disoproxil%20fumarate',
          note: 'The label gives a cell-culture EC50 range of 0.04-8.5 uM against HIV-1; a representative ~0.18 uM converted with tenofovir MW 287.21 (0.18 uM x 0.28721 = 0.05 mg/L). The wide range reflects cell line and assay.' },
      ],
      maxKill_per_h: 0.2, hill: 1, pattern: 'exposure-dependent',
      killSource: 'Standard HIV-1 viral-dynamic modelling; a reverse-transcriptase inhibitor suppresses new infection of cells rather than clearing infected ones.',
      killSourceUrl: 'https://dailymed.nlm.nih.gov/dailymed/search.cfm?labeltype=all&query=tenofovir%20disoproxil%20fumarate',
      note: 'A nucleotide reverse-transcriptase inhibitor suppresses HIV replication (virustatic) and never eradicates it — the biology of why HIV needs lifelong combination therapy. The suppression ceiling is deliberately low and is a modelling anchor; the EC50 is sourced. Monotherapy modelled here is not how it is used, and resistance is not represented.',
    },
    notes: 'A reverse-transcriptase inhibitor and a backbone of HIV therapy and pre-exposure prophylaxis, given as the disoproxil prodrug for oral absorption. Modelled as a lone agent for teaching, though clinically it is never used alone — combination therapy and the emergence of resistance are stated limitations.',
  },
];
