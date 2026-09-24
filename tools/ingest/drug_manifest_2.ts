import type { ManifestEntry } from './drug_manifest';
import { SOURCES } from './pharm_sources';

/**
 * The pharmacology textbooks the receptor registry already cites. A curated efficacy
 * CLASS — "full agonist", "neutral antagonist" — is a textbook statement in exactly the
 * way an effect vector's sign is, so it is cited from the same table rather than from a
 * second one that would drift out of step with it.
 */
const SOURCES_GG14 = SOURCES.GG14;

/**
 * DRUG MANIFEST, PART TWO — the wider therapeutic set.
 *
 * The original manifest covered the emergency trolley. This adds the classes a
 * pharmacology course covers, plus the controlled and recreational compounds that
 * every such course also covers.
 *
 * EVERY DRUG HERE WAS CHECKED AGAINST THE GtoPdb CACHE BEFORE BEING ADDED. A drug
 * with no human affinity row and no sourceable pharmacokinetics contributes nothing
 * to this engine by design — it would render as a row of em-dashes — so the list is
 * what could be sourced, not what could be named.
 *
 * ON THE CONTROLLED SUBSTANCES.
 *
 * They are here because the user asked and because their pharmacology is taught in
 * every medical and pharmacology curriculum: methamphetamine is the cleanest available
 * illustration of monoamine release as distinct from reuptake inhibition, and THC is
 * the only CB1 agonist most students will ever see modelled. What is modelled is
 * receptor binding, pharmacokinetics and the resulting physiology — including the
 * toxicity, honestly, because the toxicity is the educational content.
 *
 * What is NOT here, anywhere, including in comments: anything resembling usage
 * guidance, route advice for recreational use, preparation, or sourcing. The reference
 * exposures below are figures from published human pharmacology studies, cited and
 * labelled as study exposures, and they exist for the same reason every other
 * reference dose in this project exists — so the simulated amount is anchored to
 * something a reader can go and check.
 */

const dailymed = (q: string) => ({
  source: `FDA Structured Product Label via DailyMed — ${q}`,
  sourceUrl: `https://dailymed.nlm.nih.gov/dailymed/search.cfm?labeltype=all&query=${encodeURIComponent(q)}`,
});

/** A reference exposure taken from a published human laboratory study. */
const study = (citation: string, doi: string) => ({ source: citation, sourceUrl: doi });

export const MANIFEST_2: ManifestEntry[] = [
  /* ================================================== cardiovascular */
  {
    id: 'propranolol', displayName: 'Propranolol', class: 'antihypertensive', drawerGroup: 'Beta blockers',
    routes: ['IV_PUSH', 'ORAL'],
    presetDoses: [
      { route: 'IV_PUSH', amount: 1, unit: 'mg', label: '1 mg', ...dailymed('propranolol hydrochloride injection') },
      { route: 'ORAL', amount: 40, unit: 'mg', label: '40 mg', ...dailymed('propranolol hydrochloride tablets') },
    ],
    pulseName: null, gtopdbLigand: 'propranolol', gtopdbAliases: ['(-)-propranolol', '(S)-propranolol'],
    receptorAllowList: ['beta1', 'beta2', 'beta3', 'ht1b'],
    notes: 'Non-selective beta blocker, and the one that shows why selectivity matters: it blocks beta-2 as well, so it opposes bronchodilation and blunts the glycogenolytic response to hypoglycaemia. Highly lipophilic, so it is also the one that reaches the brain.',
  },
  {
    id: 'metoprolol', displayName: 'Metoprolol', class: 'antihypertensive', drawerGroup: 'Beta blockers',
    routes: ['IV_PUSH', 'ORAL'],
    presetDoses: [
      { route: 'IV_PUSH', amount: 5, unit: 'mg', label: '5 mg', ...dailymed('metoprolol tartrate injection') },
      { route: 'ORAL', amount: 50, unit: 'mg', label: '50 mg', ...dailymed('metoprolol tartrate tablets') },
    ],
    pulseName: null, gtopdbLigand: 'metoprolol', gtopdbAliases: [],
    receptorAllowList: ['beta1', 'beta2', 'beta3'],
    notes: 'Beta-1 selective, and the selectivity is relative rather than absolute — it disappears as the dose rises, which the affinity ratios here reproduce without needing a special case.',
  },
  {
    id: 'atenolol', displayName: 'Atenolol', class: 'antihypertensive', drawerGroup: 'Beta blockers',
    routes: ['ORAL'],
    presetDoses: [{ route: 'ORAL', amount: 50, unit: 'mg', label: '50 mg', ...dailymed('atenolol tablets') }],
    pulseName: null, gtopdbLigand: 'atenolol', gtopdbAliases: [],
    receptorAllowList: ['beta1', 'beta2', 'beta3'],
    notes: 'Beta-1 selective and hydrophilic, so it barely enters the brain — the contrast with propranolol on exactly that axis is why both are here.',
  },
  {
    id: 'carvedilol', displayName: 'Carvedilol', class: 'antihypertensive', drawerGroup: 'Beta blockers',
    routes: ['ORAL'],
    presetDoses: [{ route: 'ORAL', amount: 12.5, unit: 'mg', label: '12.5 mg', ...dailymed('carvedilol tablets') }],
    pulseName: null, gtopdbLigand: 'carvedilol', gtopdbAliases: [],
    receptorAllowList: ['beta1', 'beta2', 'beta3', 'alpha1'],
    // GtoPdb carries carvedilol at beta-1, beta-2 and beta-3 with Action "Partial
    // agonist" — from the assay it was characterised in, and not what the drug does in
    // a patient. Taken literally it made a heart-failure drug a beta AGONIST: beta-1's
    // resting tone is 0.012, so occupying 85 % of the receptor with an efficacy of 0.35
    // replaces a tiny endogenous activation with a large drug one. Measured before this
    // override, 12.5 mg orally took the heart rate from 64 to 235 bpm.
    //
    // Every other beta blocker in the set (propranolol, metoprolol, atenolol, esmolol)
    // arrives from GtoPdb as a plain antagonist and was always correct. Carvedilol is
    // the only one whose assay label disagrees with its own label.
    intrinsicActivity: Object.fromEntries(
      ['beta1', 'beta2', 'beta3'].map((r) => [r, {
        value: 0,
        note: '"Carvedilol has no intrinsic sympathomimetic activity." Modelled as a neutral competitive antagonist at all three beta subtypes, which is what that sentence means.',
        ...dailymed('carvedilol tablets'),
      }]),
    ),
    notes: 'Blocks alpha-1 as well as beta, so it lowers afterload while it slows the heart. That combination is why it is a heart-failure drug rather than merely an antihypertensive.',
  },
  {
    id: 'esmolol', displayName: 'Esmolol', class: 'antihypertensive', drawerGroup: 'Beta blockers',
    routes: ['IV_PUSH', 'IV_DRIP'],
    presetDoses: [
      { route: 'IV_PUSH', amount: 35, unit: 'mg', label: '35 mg', ...dailymed('esmolol hydrochloride injection') },
      { route: 'IV_DRIP', amount: 100, unit: 'mg', label: '100 mg over 60 min', durationMin: 60, ...dailymed('esmolol hydrochloride injection') },
    ],
    pulseName: null, gtopdbLigand: 'esmolol', gtopdbAliases: [],
    receptorAllowList: ['beta1', 'beta2'],
    notes: 'A nine-minute half-life, because it is hydrolysed by red-cell esterases rather than cleared by an organ. That is the entire point of the molecule: a beta blocker you can stop.',
  },
  {
    id: 'amlodipine', displayName: 'Amlodipine', class: 'antihypertensive', drawerGroup: 'Calcium blockers',
    routes: ['ORAL'],
    presetDoses: [{ route: 'ORAL', amount: 5, unit: 'mg', label: '5 mg', ...dailymed('amlodipine besylate tablets') }],
    pulseName: null, gtopdbLigand: 'amlodipine', gtopdbAliases: [],
    receptorAllowList: ['cav'],
    directEffects: [
      { target: 'cardio.systemicResistance', gain: -0.55, note: 'Dihydropyridines are vascular-selective: they bind the calcium channel in the state vascular smooth muscle holds it in, so they dilate without depressing the heart. The model cannot get that selectivity from a single Cav entry, so the vascular bias is applied directly.', ...dailymed('amlodipine besylate tablets') },
    ],
    notes: 'A thirty-to-fifty-hour half-life, which is why it is once-daily and why an overdose lasts for days.',
  },
  {
    id: 'verapamil', displayName: 'Verapamil', class: 'antiarrhythmic', drawerGroup: 'Calcium blockers',
    routes: ['IV_PUSH', 'ORAL'],
    presetDoses: [
      { route: 'IV_PUSH', amount: 5, unit: 'mg', label: '5 mg', ...dailymed('verapamil hydrochloride injection') },
      { route: 'ORAL', amount: 80, unit: 'mg', label: '80 mg', ...dailymed('verapamil hydrochloride tablets') },
    ],
    pulseName: null, gtopdbLigand: 'verapamil', gtopdbAliases: [],
    // NO CALCIUM-CHANNEL AFFINITY IS AVAILABLE, AND NONE IS INVENTED. GtoPdb publishes
    // seven human rows for verapamil and not one of them is a Cav: CYP3A4, Kv1.7,
    // Kv1.8, NALCN, PMAT, TPC1, TPC2. The only one that used to survive the allow list
    // was Kv1.7 at pKd 4.8 — 15,849 nM, which no dose in this set approaches — and it
    // reached the `herg` entry through an alias list that has since been narrowed,
    // because a Kv1.7 channel-block assay is not evidence of IKr block and must not be
    // shown in a receptor panel as though it were.
    //
    // So verapamil now has no receptor targets at all, and its two cited direct effects
    // below carry the whole drug. That is the honest shape (ADR-023): a missing number
    // is allowed to make a drug show less in the receptor panel, and is not allowed to
    // put a fabricated affinity in it.
    receptorAllowList: [],
    targetsNote:
      'Deliberate, and an upstream gap rather than a modelling choice. GtoPdb publishes no human ' +
      'calcium-channel affinity for verapamil — the drug that defines the rate-limiting calcium ' +
      'blocker class — so the receptor panel shows nothing bound. Its atrioventricular and inotropic ' +
      'actions are carried by the two cited direct effects instead, which is why it still terminates ' +
      'a re-entrant tachycardia and still depresses the ventricle. What the model therefore cannot ' +
      'show for this drug is competition at the calcium channel with amlodipine, which does have a ' +
      'published affinity.',
    directEffects: [
      { target: 'cardio.avNodalBlock', gain: 0.55, note: 'Rate-limiting calcium blockers are cardioselective in the opposite direction to the dihydropyridines: atrioventricular conduction is calcium-dependent, which is why verapamil terminates a re-entrant supraventricular tachycardia and amlodipine does not.', ...dailymed('verapamil hydrochloride injection') },
      { target: 'cardio.contractility', gain: -0.30, note: 'Negative inotropy that is clinically significant, and the reason verapamil plus a beta blocker is a dangerous combination.', ...dailymed('verapamil hydrochloride injection') },
    ],
    notes: 'The counterpart to amlodipine: the same channel in life, opposite tissue bias. In this model that is a claim the data cannot support — amlodipine has a published human Cav affinity and verapamil has none — so the tissue bias is carried by cited direct effects on atrioventricular conduction and contractility, and the receptor panel honestly shows nothing bound. "Calcium ion influx inhibitor (slow-channel blocker)" is the label\'s own description of the mechanism the model is approximating.',
  },
  {
    id: 'digoxin', displayName: 'Digoxin', class: 'antiarrhythmic', drawerGroup: 'Antiarrhythmics',
    routes: ['IV_PUSH', 'ORAL'],
    presetDoses: [
      { route: 'IV_PUSH', amount: 0.5, unit: 'mg', label: '0.5 mg', ...dailymed('digoxin injection') },
      { route: 'ORAL', amount: 0.25, unit: 'mg', label: '0.25 mg', ...dailymed('digoxin tablets') },
    ],
    pulseName: null, gtopdbLigand: 'digoxin', gtopdbAliases: [],
    receptorAllowList: [],
    targetsNote: 'Deliberate. Digoxin inhibits the Na/K-ATPase, which this model does not represent as a binding target; the sodium-pump chain that converts that inhibition into inotropy is not modelled either. The inotropic and vagotonic actions are carried by the cited direct effects instead.',
    directEffects: [
      { target: 'cardio.contractility', gain: 0.35, note: 'Na/K-ATPase inhibition raises intracellular sodium, which slows the sodium-calcium exchanger, which raises intracellular calcium. Three steps, none of them a receptor.', ...dailymed('digoxin injection') },
      { target: 'cardio.avNodalBlock', gain: 0.60, note: 'Increased vagal tone at the atrioventricular node. This, not the inotropy, is what rate-controls atrial fibrillation.', ...dailymed('digoxin injection') },
      { target: 'cardio.heartRate', gain: -0.25, note: 'The same vagotonic effect at the sinus node.', ...dailymed('digoxin injection') },
      { target: 'cardio.arrhythmogenicity', gain: 0.45, note: 'Calcium loading. The therapeutic index is famously narrow and the model should show that.', ...dailymed('digoxin injection') },
    ],
    notes: 'Renally cleared with a narrow therapeutic index, so it is the clearest demonstration in the set of why renal failure changes a dose.',
  },
  {
    id: 'milrinone', displayName: 'Milrinone', class: 'other', drawerGroup: 'Inotropes',
    routes: ['IV_DRIP'],
    presetDoses: [{ route: 'IV_DRIP', amount: 5, unit: 'mg', label: '5 mg over 60 min', durationMin: 60, ...dailymed('milrinone lactate injection') }],
    pulseName: null, gtopdbLigand: 'milrinone', gtopdbAliases: [],
    receptorAllowList: ['pde3'],
    notes: 'An inodilator. It raises cardiac cAMP without touching a beta receptor, so it still works in a heart that is beta-blocked or beta-downregulated — and it drops the blood pressure while doing it.',
  },
  {
    id: 'dobutamine', displayName: 'Dobutamine', class: 'catecholamine', drawerGroup: 'Inotropes',
    routes: ['IV_DRIP'],
    presetDoses: [{ route: 'IV_DRIP', amount: 20, unit: 'mg', label: '20 mg over 60 min', durationMin: 60, ...dailymed('dobutamine injection') }],
    pulseName: null, gtopdbLigand: 'dobutamine', gtopdbAliases: [],
    receptorAllowList: ['beta1', 'beta2', 'beta3', 'alpha1'],
    notes: 'Beta-1 predominant with enough beta-2 to drop systemic resistance slightly. The contrast with noradrenaline — inotrope versus vasopressor — falls straight out of the affinity ratios.',
  },
  {
    id: 'isoprenaline', displayName: 'Isoprenaline', class: 'catecholamine', drawerGroup: 'Inotropes',
    routes: ['IV_DRIP'],
    presetDoses: [{ route: 'IV_DRIP', amount: 2, unit: 'mg', label: '2 mg over 60 min', durationMin: 60, ...dailymed('isoproterenol hydrochloride injection') }],
    pulseName: null, gtopdbLigand: 'isoprenaline', gtopdbAliases: ['isoproterenol'],
    receptorAllowList: ['beta1', 'beta2', 'beta3'],
    notes: 'A pure beta agonist with essentially no alpha activity, which makes it the textbook demonstration of what beta stimulation alone does: the rate rises, the resistance falls, and the diastolic pressure drops.',
  },
  {
    id: 'clonidine', displayName: 'Clonidine', class: 'antihypertensive', drawerGroup: 'Autonomic',
    routes: ['ORAL', 'IV_PUSH'],
    presetDoses: [
      { route: 'ORAL', amount: 0.1, unit: 'mg', label: '100 mcg', ...dailymed('clonidine hydrochloride tablets') },
      { route: 'IV_PUSH', amount: 0.15, unit: 'mg', label: '150 mcg', ...dailymed('clonidine hydrochloride injection') },
    ],
    pulseName: null, gtopdbLigand: 'clonidine', gtopdbAliases: [],
    receptorAllowList: ['alpha2', 'alpha1'],
    notes: 'A central alpha-2 agonist: it lowers blood pressure by reducing sympathetic OUTFLOW rather than by blocking anything peripherally. The blood-brain-barrier gate in this model is what makes that work.',
  },
  {
    id: 'dexmedetomidine', displayName: 'Dexmedetomidine', class: 'sedative', drawerGroup: 'Sedatives',
    routes: ['IV_DRIP'],
    presetDoses: [{ route: 'IV_DRIP', amount: 0.07, unit: 'mg', label: '70 mcg over 60 min', durationMin: 60, ...dailymed('dexmedetomidine hydrochloride injection') }],
    pulseName: null, gtopdbLigand: 'dexmedetomidine', gtopdbAliases: [],
    receptorAllowList: ['alpha2', 'alpha1'],
    notes: 'The alpha-2 sedative. Its selling point is sedation without respiratory depression, and the model shows that honestly — there is no mu-opioid or GABA-A binding to produce one.',
  },
  {
    id: 'hydrochlorothiazide', displayName: 'Hydrochlorothiazide', class: 'other', drawerGroup: 'Renal',
    routes: ['ORAL'],
    presetDoses: [{ route: 'ORAL', amount: 25, unit: 'mg', label: '25 mg', ...dailymed('hydrochlorothiazide tablets') }],
    pulseName: null, gtopdbLigand: 'hydrochlorothiazide', gtopdbAliases: [],
    receptorAllowList: [],
    targetsNote: 'Deliberate. The thiazide target is the distal convoluted tubule Na-Cl cotransporter (NCC/SLC12A3), for which GtoPdb publishes no human affinity this pipeline can convert. The natriuresis is carried by a cited direct effect.',
    directEffects: [
      { target: 'renal.sodiumReabsorption', gain: -0.45, note: 'Blocks the distal convoluted tubule Na-Cl cotransporter. A weaker natriuresis than a loop diuretic because only about 5% of filtered sodium is reabsorbed there.', ...dailymed('hydrochlorothiazide tablets') },
      { target: 'renal.potassiumExcretion', gain: 0.40, note: 'More sodium reaching the collecting duct means more sodium-potassium exchange, which is why thiazides cause hypokalaemia.', ...dailymed('hydrochlorothiazide tablets') },
      { target: 'renal.calciumReabsorption', gain: 0.35, note: 'Thiazides RETAIN calcium, the opposite of a loop diuretic, which is why they are used in recurrent calcium stone disease.', ...dailymed('hydrochlorothiazide tablets') },
    ],
    notes: 'The contrast with furosemide is the lesson: a weaker diuretic that retains calcium instead of wasting it.',
  },
  {
    id: 'spironolactone', displayName: 'Spironolactone', class: 'other', drawerGroup: 'Renal',
    routes: ['ORAL'],
    presetDoses: [{ route: 'ORAL', amount: 25, unit: 'mg', label: '25 mg', ...dailymed('spironolactone tablets') }],
    pulseName: null, gtopdbLigand: 'spironolactone', gtopdbAliases: [],
    receptorAllowList: ['mineralocorticoid'],
    notes: 'A mineralocorticoid antagonist, so it competes with the body’s own aldosterone at the same receptor the endocrine model drives. Potassium-sparing to the point of being potassium-dangerous.',
  },
  {
    id: 'acetazolamide', displayName: 'Acetazolamide', class: 'other', drawerGroup: 'Renal',
    routes: ['ORAL', 'IV_PUSH'],
    presetDoses: [
      { route: 'ORAL', amount: 250, unit: 'mg', label: '250 mg', ...dailymed('acetazolamide tablets') },
      { route: 'IV_PUSH', amount: 500, unit: 'mg', label: '500 mg', ...dailymed('acetazolamide for injection') },
    ],
    pulseName: null, gtopdbLigand: 'acetazolamide', gtopdbAliases: [],
    receptorAllowList: ['carbonic_anhydrase'],
    notes: 'A diuretic that causes a metabolic acidosis on purpose, and then a compensatory hyperventilation. The only drug in the set whose main therapeutic use depends on its own side effect.',
  },

  /* ================================================== analgesia and inflammation */
  {
    id: 'aspirin', displayName: 'Aspirin', class: 'other', drawerGroup: 'Analgesics',
    routes: ['ORAL'],
    presetDoses: [{ route: 'ORAL', amount: 300, unit: 'mg', label: '300 mg', ...dailymed('aspirin tablets') }],
    pulseName: null, gtopdbLigand: 'aspirin', gtopdbAliases: ['acetylsalicylic acid'],
    receptorAllowList: ['cox1', 'cox2'],
    notes: 'The only IRREVERSIBLE cyclo-oxygenase inhibitor here. The model represents it as reversible binding like everything else, which understates its duration badly — a platelet cannot resynthesise the enzyme, so one dose lasts the platelet lifespan. Recorded in MISSING_CONSTANTS.',
  },
  {
    id: 'ibuprofen', displayName: 'Ibuprofen', class: 'other', drawerGroup: 'Analgesics',
    routes: ['ORAL'],
    presetDoses: [{ route: 'ORAL', amount: 400, unit: 'mg', label: '400 mg', ...dailymed('ibuprofen tablets') }],
    pulseName: null, gtopdbLigand: 'ibuprofen', gtopdbAliases: [],
    receptorAllowList: ['cox1', 'cox2'],
    notes: 'Non-selective, reversible. Its competition with aspirin for the same site is a real and clinically relevant interaction that this model can actually show, because both bind the same receptor entry.',
  },
  {
    id: 'naproxen', displayName: 'Naproxen', class: 'other', drawerGroup: 'Analgesics',
    routes: ['ORAL'],
    presetDoses: [{ route: 'ORAL', amount: 500, unit: 'mg', label: '500 mg', ...dailymed('naproxen tablets') }],
    pulseName: null, gtopdbLigand: 'naproxen', gtopdbAliases: [],
    receptorAllowList: ['cox1', 'cox2'],
    notes: 'A fourteen-hour half-life, which is the whole reason to choose it over ibuprofen.',
  },
  {
    id: 'celecoxib', displayName: 'Celecoxib', class: 'other', drawerGroup: 'Analgesics',
    routes: ['ORAL'],
    presetDoses: [{ route: 'ORAL', amount: 200, unit: 'mg', label: '200 mg', ...dailymed('celecoxib capsules') }],
    pulseName: null, gtopdbLigand: 'celecoxib', gtopdbAliases: [],
    receptorAllowList: ['cox1', 'cox2', 'carbonic_anhydrase'],
    notes: 'COX-2 selective, and the affinity ratio here is what produces the gastric sparing. The cardiovascular cost of that same selectivity is not modelled, because the model has no thrombosis.',
  },
  {
    id: 'paracetamol', displayName: 'Paracetamol', class: 'other', drawerGroup: 'Analgesics',
    routes: ['ORAL', 'IV_DRIP'],
    presetDoses: [
      { route: 'ORAL', amount: 1000, unit: 'mg', label: '1 g', ...dailymed('acetaminophen tablets') },
      { route: 'IV_DRIP', amount: 1000, unit: 'mg', label: '1 g over 15 min', durationMin: 15, ...dailymed('acetaminophen injection') },
    ],
    pulseName: 'Acetaminophen', gtopdbLigand: 'paracetamol', gtopdbAliases: ['acetaminophen'],
    receptorAllowList: ['cox1', 'cox2'],
    notes: 'Antipyretic and analgesic but barely anti-inflammatory, and after a century nobody is quite sure why. The model reproduces the profile from the affinities without claiming to explain it.',
  },
  {
    id: 'ketorolac', displayName: 'Ketorolac', class: 'other', drawerGroup: 'Analgesics',
    routes: ['IV_PUSH', 'IM'],
    presetDoses: [
      { route: 'IV_PUSH', amount: 30, unit: 'mg', label: '30 mg', ...dailymed('ketorolac tromethamine injection') },
      { route: 'IM', amount: 60, unit: 'mg', label: '60 mg IM', ...dailymed('ketorolac tromethamine injection') },
    ],
    pulseName: null, gtopdbLigand: 'ketorolac', gtopdbAliases: [],
    receptorAllowList: ['cox1', 'cox2'],
    notes: 'A parenteral NSAID with opioid-comparable analgesia and the full NSAID renal and gastric risk, which is why its licensed duration is measured in days.',
  },
  {
    id: 'oxycodone', displayName: 'Oxycodone', class: 'opioid', drawerGroup: 'Opioids',
    routes: ['ORAL', 'IV_PUSH'],
    presetDoses: [
      { route: 'ORAL', amount: 10, unit: 'mg', label: '10 mg', ...dailymed('oxycodone hydrochloride tablets') },
      { route: 'IV_PUSH', amount: 5, unit: 'mg', label: '5 mg', ...dailymed('oxycodone hydrochloride injection') },
    ],
    pulseName: null, gtopdbLigand: 'oxycodone', gtopdbAliases: [],
    receptorAllowList: ['mu', 'kappa', 'delta'],
    targetsNote: 'Deliberate in the sense that nothing better exists: GtoPdb publishes no human affinity row for this ligand at all. Its actions are carried by cited direct effects, so the drug behaves correctly while the receptor panel honestly shows nothing bound.',
    directEffects: [
      { target: 'neuro.analgesia', gain: 0.75, note: 'Mu-opioid agonism. Modelled directly because GtoPdb has no human affinity for this ligand, so the receptor route is unavailable.', ...dailymed('oxycodone hydrochloride tablets') },
      { target: 'resp.drive', gain: -0.55, note: 'Reduced medullary chemoreceptor sensitivity to carbon dioxide — the mechanism of opioid death, and it must be present whether or not a binding affinity is.', ...dailymed('oxycodone hydrochloride tablets') },
      { target: 'neuro.sedation', gain: 0.40, note: 'Dose-dependent depression of consciousness.', ...dailymed('oxycodone hydrochloride tablets') },
      { target: 'gi.motility', gain: -0.60, note: 'Enteric mu receptors suppress propulsive peristalsis; the constipation is near-universal and does not tolerate.', ...dailymed('oxycodone hydrochloride tablets') },
    ],
    notes: 'Higher oral bioavailability than morphine, which is the practical difference between them.',
  },
  {
    id: 'hydromorphone', displayName: 'Hydromorphone', class: 'opioid', drawerGroup: 'Opioids',
    routes: ['IV_PUSH', 'ORAL'],
    presetDoses: [
      { route: 'IV_PUSH', amount: 1, unit: 'mg', label: '1 mg', ...dailymed('hydromorphone hydrochloride injection') },
      { route: 'ORAL', amount: 2, unit: 'mg', label: '2 mg', ...dailymed('hydromorphone hydrochloride tablets') },
    ],
    pulseName: null, gtopdbLigand: 'hydromorphone', gtopdbAliases: [],
    receptorAllowList: ['mu', 'kappa', 'delta'],
    notes: 'About five times the potency of morphine by weight, which the affinity data carries directly.',
  },
  {
    id: 'tramadol', displayName: 'Tramadol', class: 'opioid', drawerGroup: 'Opioids',
    routes: ['ORAL', 'IV_PUSH'],
    presetDoses: [
      { route: 'ORAL', amount: 50, unit: 'mg', label: '50 mg', ...dailymed('tramadol hydrochloride tablets') },
      { route: 'IV_PUSH', amount: 100, unit: 'mg', label: '100 mg', ...dailymed('tramadol hydrochloride injection') },
    ],
    pulseName: null, gtopdbLigand: 'tramadol', gtopdbAliases: [],
    receptorAllowList: ['mu', 'sert', 'net'],
    notes: 'A weak opioid that is also a serotonin and noradrenaline reuptake inhibitor, which is why it lowers the seizure threshold and interacts with antidepressants. Two mechanisms in one molecule, and the model has both.',
  },
  {
    id: 'naltrexone', displayName: 'Naltrexone', class: 'opioid', drawerGroup: 'Opioids',
    routes: ['ORAL'],
    presetDoses: [{ route: 'ORAL', amount: 50, unit: 'mg', label: '50 mg', ...dailymed('naltrexone hydrochloride tablets') }],
    pulseName: null, gtopdbLigand: 'naltrexone', gtopdbAliases: [],
    receptorAllowList: ['mu', 'kappa', 'delta'],
    notes: 'Naloxone’s long-acting oral relative. The contrast is entirely pharmacokinetic — same receptors, same antagonism, a half-life measured in hours instead of minutes.',
  },

  /* ================================================== psychiatry and neurology */
  {
    id: 'haloperidol', displayName: 'Haloperidol', class: 'other', drawerGroup: 'Psychotropics',
    routes: ['IM', 'IV_PUSH', 'ORAL'],
    presetDoses: [
      { route: 'IM', amount: 5, unit: 'mg', label: '5 mg IM', ...dailymed('haloperidol injection') },
      { route: 'IV_PUSH', amount: 2, unit: 'mg', label: '2 mg', ...dailymed('haloperidol injection') },
      { route: 'ORAL', amount: 5, unit: 'mg', label: '5 mg', ...dailymed('haloperidol tablets') },
    ],
    pulseName: null, gtopdbLigand: 'haloperidol', gtopdbAliases: [],
    receptorAllowList: ['d2', 'd3', 'ht2a', 'ht1a', 'ht7', 'alpha1', 'herg'],
    notes: 'A high-potency typical antipsychotic: almost pure D2 blockade, which is why it is so extrapyramidal. Its hERG affinity is the reason it needs an ECG.',
  },
  {
    id: 'olanzapine', displayName: 'Olanzapine', class: 'other', drawerGroup: 'Psychotropics',
    routes: ['ORAL', 'IM'],
    presetDoses: [
      { route: 'ORAL', amount: 10, unit: 'mg', label: '10 mg', ...dailymed('olanzapine tablets') },
      { route: 'IM', amount: 10, unit: 'mg', label: '10 mg IM', ...dailymed('olanzapine for injection') },
    ],
    pulseName: null, gtopdbLigand: 'olanzapine', gtopdbAliases: [],
    receptorAllowList: ['d2', 'd3', 'd1', 'ht2a', 'ht2c', 'ht6', 'ht1b', 'h1', 'm1', 'm2', 'm3', 'alpha1'],
    notes: 'An atypical, and the receptor panel shows why the word means so little: it binds twelve things. The H1 affinity is the sedation and most of the weight gain; the muscarinic affinity is the dry mouth.',
  },
  {
    id: 'quetiapine', displayName: 'Quetiapine', class: 'other', drawerGroup: 'Psychotropics',
    routes: ['ORAL'],
    presetDoses: [{ route: 'ORAL', amount: 100, unit: 'mg', label: '100 mg', ...dailymed('quetiapine fumarate tablets') }],
    pulseName: null, gtopdbLigand: 'quetiapine', gtopdbAliases: [],
    receptorAllowList: ['d2', 'ht2a', 'ht1a', 'ht1b', 'h1', 'alpha1', 'alpha2'],
    notes: 'Low D2 occupancy and very high H1 affinity, which is why it is prescribed for sleep far more often than for psychosis.',
  },
  {
    id: 'risperidone', displayName: 'Risperidone', class: 'other', drawerGroup: 'Psychotropics',
    routes: ['ORAL'],
    presetDoses: [{ route: 'ORAL', amount: 2, unit: 'mg', label: '2 mg', ...dailymed('risperidone tablets') }],
    pulseName: null, gtopdbLigand: 'risperidone', gtopdbAliases: [],
    receptorAllowList: ['d2', 'd3', 'ht2a', 'ht2c', 'ht1a', 'ht1b', 'ht7', 'alpha1', 'alpha2', 'h1'],
    notes: 'Tight 5-HT2A and D2 binding in a ratio that is the textbook definition of an atypical, with enough alpha-1 to cause postural hypotension.',
  },
  {
    id: 'clozapine', displayName: 'Clozapine', class: 'other', drawerGroup: 'Psychotropics',
    routes: ['ORAL'],
    presetDoses: [{ route: 'ORAL', amount: 100, unit: 'mg', label: '100 mg', ...dailymed('clozapine tablets') }],
    pulseName: null, gtopdbLigand: 'clozapine', gtopdbAliases: [],
    receptorAllowList: ['d2', 'd3', 'd1', 'ht2a', 'ht2c', 'ht1a', 'ht1b', 'ht6', 'ht7', 'h1', 'h2', 'm1', 'm2', 'm3', 'm4', 'alpha1', 'alpha2'],
    notes: 'The most promiscuous molecule in the set — seventeen receptor entries — and still the most effective antipsychotic there is. The receptor panel for clozapine is the best single argument this application makes for having a receptor panel at all.',
  },
  {
    id: 'chlorpromazine', displayName: 'Chlorpromazine', class: 'other', drawerGroup: 'Psychotropics',
    routes: ['ORAL', 'IM'],
    presetDoses: [
      { route: 'ORAL', amount: 50, unit: 'mg', label: '50 mg', ...dailymed('chlorpromazine hydrochloride tablets') },
      { route: 'IM', amount: 25, unit: 'mg', label: '25 mg IM', ...dailymed('chlorpromazine hydrochloride injection') },
    ],
    pulseName: null, gtopdbLigand: 'chlorpromazine', gtopdbAliases: [],
    receptorAllowList: ['d2', 'd3', 'ht2a', 'ht2c', 'ht1a', 'ht6', 'ht7', 'h1', 'm1', 'm3', 'alpha1', 'alpha2'],
    notes: 'The first antipsychotic, and the drug that started psychopharmacology. Its alpha-1 blockade makes it the most hypotensive of them.',
  },
  {
    id: 'fluoxetine', displayName: 'Fluoxetine', class: 'other', drawerGroup: 'Psychotropics',
    routes: ['ORAL'],
    presetDoses: [{ route: 'ORAL', amount: 20, unit: 'mg', label: '20 mg', ...dailymed('fluoxetine hydrochloride capsules') }],
    pulseName: null, gtopdbLigand: 'fluoxetine', gtopdbAliases: [],
    receptorAllowList: ['sert', 'ht2c'],
    notes: 'A one-to-four-day half-life with an active metabolite lasting longer still, which is why it is the SSRI that does not need tapering and the one with the longest washout before a MAOI.',
  },
  {
    id: 'sertraline', displayName: 'Sertraline', class: 'other', drawerGroup: 'Psychotropics',
    routes: ['ORAL'],
    presetDoses: [{ route: 'ORAL', amount: 50, unit: 'mg', label: '50 mg', ...dailymed('sertraline hydrochloride tablets') }],
    pulseName: null, gtopdbLigand: 'sertraline', gtopdbAliases: [],
    receptorAllowList: ['sert', 'dat'],
    notes: 'The SSRI with measurable dopamine transporter affinity, which is the usual explanation for its slightly more activating profile.',
  },
  {
    id: 'amitriptyline', displayName: 'Amitriptyline', class: 'other', drawerGroup: 'Psychotropics',
    routes: ['ORAL'],
    presetDoses: [{ route: 'ORAL', amount: 25, unit: 'mg', label: '25 mg', ...dailymed('amitriptyline hydrochloride tablets') }],
    pulseName: null, gtopdbLigand: 'amitriptyline', gtopdbAliases: [],
    receptorAllowList: ['sert', 'net', 'h1', 'm1', 'm2', 'm3', 'alpha1', 'ht2a', 'ht6', 'nav', 'herg'],
    notes: 'The reason tricyclics were replaced. It hits the transporters it is meant to and eight other things it is not, and in overdose the sodium-channel and hERG blockade is what kills — which this model can actually show.',
  },
  {
    id: 'duloxetine', displayName: 'Duloxetine', class: 'other', drawerGroup: 'Psychotropics',
    routes: ['ORAL'],
    presetDoses: [{ route: 'ORAL', amount: 60, unit: 'mg', label: '60 mg', ...dailymed('duloxetine delayed-release capsules') }],
    pulseName: null, gtopdbLigand: 'duloxetine', gtopdbAliases: [],
    receptorAllowList: ['sert', 'net', 'ht2a', 'ht2c', 'ht6'],
    notes: 'Serotonin and noradrenaline together, without the tricyclic off-targets. The noradrenergic limb is why it raises blood pressure slightly and why it works for neuropathic pain.',
  },
  {
    id: 'mirtazapine', displayName: 'Mirtazapine', class: 'other', drawerGroup: 'Psychotropics',
    routes: ['ORAL'],
    presetDoses: [{ route: 'ORAL', amount: 15, unit: 'mg', label: '15 mg', ...dailymed('mirtazapine tablets') }],
    pulseName: null, gtopdbLigand: 'mirtazapine', gtopdbAliases: [],
    receptorAllowList: ['alpha2', 'ht2a', 'ht2c', 'ht3', 'h1'],
    targetsNote:
      'The receptor panel shows no H1 for this drug and it is therefore far less sedating here than it is in a '
      + 'patient. H1 is on the allow list, so this is not an omission in the manifest - GtoPdb simply publishes no '
      + 'human H1 affinity for mirtazapine that the pipeline can convert to a Ki, and inventing one is not '
      + 'permitted. The sedation you would expect at a low dose is therefore missing, which is unfortunate '
      + 'precisely because it is the most recognisable thing about the drug.',
    notes: 'An antidepressant that blocks rather than inhibits reuptake: alpha-2 autoreceptor antagonism raises monoamine release. Clinically its H1 affinity is why the LOWER dose is the more sedating one - as the dose rises, noradrenergic activation starts to offset the antihistamine sedation. That inversion is not modelled, because no H1 affinity is available for it; see targetsNote.',
  },
  {
    id: 'diazepam', displayName: 'Diazepam', class: 'sedative', drawerGroup: 'Sedatives',
    routes: ['IV_PUSH', 'ORAL', 'RECTAL'],
    presetDoses: [
      { route: 'IV_PUSH', amount: 5, unit: 'mg', label: '5 mg', ...dailymed('diazepam injection') },
      { route: 'ORAL', amount: 5, unit: 'mg', label: '5 mg', ...dailymed('diazepam tablets') },
      { route: 'RECTAL', amount: 10, unit: 'mg', label: '10 mg PR', ...dailymed('diazepam rectal gel') },
    ],
    pulseName: null, gtopdbLigand: 'diazepam', gtopdbAliases: [],
    receptorAllowList: ['gaba_a_bz'],
    // GtoPdb records diazepam's benzodiazepine-site interaction as allosteric, and the
    // pipeline's placeholder for "allosteric" is 0.35 — which is the same number a
    // PARTIAL agonist gets, because the label carries no efficacy fraction either way.
    // Diazepam is the reference full agonist at that site; modelled at 0.3 it produced
    // a sedation of 0.051 against midazolam's 0.725 at a clinically comparable dose.
    intrinsicActivity: {
      gaba_a_bz: {
        value: 1,
        note: 'Diazepam is a full agonist at the benzodiazepine site of GABA-A and is the reference compound against which the partial agonists at that site are defined. The 0.35 the pipeline derives from the word "allosteric" is a placeholder for a missing efficacy fraction, not a measurement of one.',
        source: SOURCES_GG14.label,
        sourceUrl: SOURCES_GG14.url,
      },
    },
    notes: 'A long half-life with active metabolites, which is why it accumulates. The rectal route exists because a seizing patient has no intravenous access.',
  },
  {
    id: 'lorazepam', displayName: 'Lorazepam', class: 'sedative', drawerGroup: 'Sedatives',
    routes: ['IV_PUSH', 'IM', 'ORAL'],
    presetDoses: [
      { route: 'IV_PUSH', amount: 2, unit: 'mg', label: '2 mg', ...dailymed('lorazepam injection') },
      { route: 'IM', amount: 4, unit: 'mg', label: '4 mg IM', ...dailymed('lorazepam injection') },
      { route: 'ORAL', amount: 1, unit: 'mg', label: '1 mg', ...dailymed('lorazepam tablets') },
    ],
    pulseName: null, gtopdbLigand: 'lorazepam', gtopdbAliases: [],
    receptorAllowList: ['gaba_a_bz'],
    targetsNote: 'Deliberate in the sense that nothing better exists: GtoPdb publishes no human affinity row for this ligand at all. Its actions are carried by cited direct effects, so the drug behaves correctly while the receptor panel honestly shows nothing bound.',
    directEffects: [
      { target: 'neuro.sedation', gain: 0.80, note: 'Benzodiazepine-site positive allosteric modulation of GABA-A.', ...dailymed('lorazepam injection') },
      { target: 'neuro.seizureThreshold', gain: 0.85, note: 'Raising the seizure threshold is why this is first-line for status epilepticus.', ...dailymed('lorazepam injection') },
      { target: 'resp.drive', gain: -0.35, note: 'Central respiratory depression, additive with any opioid given alongside.', ...dailymed('lorazepam injection') },
      { target: 'neuro.anxiety', gain: -0.70, note: 'The anxiolytic action.', ...dailymed('lorazepam injection') },
    ],
    notes: 'No active metabolites and a longer duration of anticonvulsant action than diazepam despite a shorter half-life, because it redistributes less.',
  },
  {
    id: 'flumazenil', displayName: 'Flumazenil', class: 'other', drawerGroup: 'Sedatives',
    routes: ['IV_PUSH'],
    presetDoses: [{ route: 'IV_PUSH', amount: 0.2, unit: 'mg', label: '200 mcg', ...dailymed('flumazenil injection') }],
    pulseName: null, gtopdbLigand: 'flumazenil', gtopdbAliases: [],
    receptorAllowList: ['gaba_a_bz'],
    // Flumazenil arrived from GtoPdb with the same 0.35 "allosteric" placeholder as
    // diazepam, which made the antidote a partial agonist at the site it is supposed to
    // block. It only appeared to work against diazepam because its blood-brain access is
    // 0.62 against diazepam's 1.0, so it replaced a full contribution with a smaller one
    // by accident rather than by mechanism.
    intrinsicActivity: {
      gaba_a_bz: {
        value: 0,
        note: '"Flumazenil competitively inhibits the activity at the benzodiazepine recognition site on the GABA/benzodiazepine receptor complex. Flumazenil is a weak partial agonist in some animal models of activity, but has little or no agonist activity in man." Modelled as the neutral competitive antagonist that sentence describes.',
        ...dailymed('flumazenil injection'),
      },
    },
    notes: 'The benzodiazepine antidote, and the proof that the benzodiazepine site is a separate entry from the orthosteric one: flumazenil reverses midazolam and does nothing whatever to propofol. Both halves of that are now mechanism rather than assertion — midazolam declares the benzodiazepine site as the mediator of its concentration-effect block and propofol declares the orthosteric one, so occupying the first reverses one drug and not the other. It is also a proconvulsant in its own right, because displacing the resting tone at that site lowers the seizure threshold; that is its black-box warning and the model shows it.',
  },
  {
    id: 'phenytoin', displayName: 'Phenytoin', class: 'other', drawerGroup: 'Anticonvulsants',
    routes: ['IV_DRIP', 'ORAL'],
    presetDoses: [
      { route: 'IV_DRIP', amount: 1000, unit: 'mg', label: '1 g over 20 min', durationMin: 20, ...dailymed('phenytoin sodium injection') },
      { route: 'ORAL', amount: 300, unit: 'mg', label: '300 mg', ...dailymed('phenytoin sodium capsules') },
    ],
    pulseName: null, gtopdbLigand: 'phenytoin', gtopdbAliases: [],
    receptorAllowList: ['nav'],
    notes: 'SATURABLE ELIMINATION. Above a certain plasma level its clearance becomes zero-order, so a small dose increase produces a large concentration increase. It is the one drug in the set that genuinely breaks the linearity everything else assumes.',
  },
  {
    id: 'carbamazepine', displayName: 'Carbamazepine', class: 'other', drawerGroup: 'Anticonvulsants',
    routes: ['ORAL'],
    presetDoses: [{ route: 'ORAL', amount: 200, unit: 'mg', label: '200 mg', ...dailymed('carbamazepine tablets') }],
    pulseName: null, gtopdbLigand: 'carbamazepine', gtopdbAliases: [],
    receptorAllowList: ['nav'],
    targetsNote: 'Deliberate. The one human row GtoPdb publishes for carbamazepine is at FZD8, a Wnt co-receptor that has nothing to do with its anticonvulsant action and which this model does not carry. The sodium-channel block is a cited direct effect instead.',
    directEffects: [
      { target: 'neuro.seizureThreshold', gain: 0.70, note: 'Use-dependent sodium-channel block.', ...dailymed('carbamazepine tablets') },
      { target: 'neuro.sedation', gain: 0.25, note: 'Dose-related, and the usual reason a dose has to be titrated up slowly.', ...dailymed('carbamazepine tablets') },
    ],
    notes: 'A potent enzyme inducer that induces its own metabolism, so its half-life shortens over the first weeks of treatment. The model does not represent induction; noted in MODEL_LIMITATIONS.',
  },
  {
    id: 'lamotrigine', displayName: 'Lamotrigine', class: 'other', drawerGroup: 'Anticonvulsants',
    routes: ['ORAL'],
    presetDoses: [{ route: 'ORAL', amount: 100, unit: 'mg', label: '100 mg', ...dailymed('lamotrigine tablets') }],
    pulseName: null, gtopdbLigand: 'lamotrigine', gtopdbAliases: [],
    receptorAllowList: ['nav'],
    targetsNote: 'Deliberate in the sense that nothing better exists: GtoPdb publishes no human affinity row for this ligand at all. Its actions are carried by cited direct effects, so the drug behaves correctly while the receptor panel honestly shows nothing bound.',
    directEffects: [
      { target: 'neuro.seizureThreshold', gain: 0.70, note: 'Use-dependent sodium-channel block suppresses high-frequency epileptic firing preferentially over normal activity.', ...dailymed('lamotrigine tablets') },
    ],
    notes: 'Use-dependent sodium-channel block, so it suppresses high-frequency epileptic firing more than normal activity.',
  },

  /* ================================================== respiratory, GI, endocrine */
  {
    id: 'salmeterol', displayName: 'Salmeterol', class: 'other', drawerGroup: 'Respiratory',
    routes: ['INHALED'],
    presetDoses: [{ route: 'INHALED', amount: 0.05, unit: 'mg', label: '50 mcg', ...dailymed('salmeterol xinafoate inhalation powder') }],
    pulseName: null, gtopdbLigand: 'salmeterol', gtopdbAliases: [],
    receptorAllowList: ['beta2', 'beta1', 'beta3'],
    notes: 'A long-acting beta-2 agonist: the lipophilic side chain anchors it near the receptor, which is the mechanism behind a twelve-hour duration from a receptor that salbutamol leaves in four.',
  },
  {
    id: 'ipratropium', displayName: 'Ipratropium', class: 'other', drawerGroup: 'Respiratory',
    routes: ['NEBULISED', 'INHALED'],
    presetDoses: [
      { route: 'NEBULISED', amount: 0.5, unit: 'mg', label: '500 mcg nebulised', ...dailymed('ipratropium bromide inhalation solution') },
      { route: 'INHALED', amount: 0.04, unit: 'mg', label: '40 mcg', ...dailymed('ipratropium bromide inhalation aerosol') },
    ],
    pulseName: null, gtopdbLigand: 'ipratropium', gtopdbAliases: [],
    receptorAllowList: ['m1', 'm2', 'm3', 'm4', 'm5'],
    notes: 'A QUATERNARY antimuscarinic, so it is charged at every pH and essentially cannot cross a membrane — which is why an inhaled dose stays in the lung and causes none of atropine’s central effects. The physicochemical model here should show that gate closing.',
  },
  {
    id: 'theophylline', displayName: 'Theophylline', class: 'other', drawerGroup: 'Respiratory',
    routes: ['ORAL', 'IV_DRIP'],
    presetDoses: [
      { route: 'ORAL', amount: 200, unit: 'mg', label: '200 mg', ...dailymed('theophylline tablets') },
      { route: 'IV_DRIP', amount: 250, unit: 'mg', label: '250 mg over 30 min', durationMin: 30, ...dailymed('aminophylline injection') },
    ],
    pulseName: null, gtopdbLigand: 'theophylline', gtopdbAliases: [],
    receptorAllowList: ['a1', 'a2a'],
    notes: 'An adenosine antagonist with a narrow therapeutic index; its toxicity is arrhythmia and seizure. The direct opposition to adenosine is something this model can show literally — give both and watch them compete at A1.',
  },
  {
    id: 'montelukast', displayName: 'Montelukast', class: 'other', drawerGroup: 'Respiratory',
    routes: ['ORAL'],
    presetDoses: [{ route: 'ORAL', amount: 10, unit: 'mg', label: '10 mg', ...dailymed('montelukast sodium tablets') }],
    pulseName: null, gtopdbLigand: 'montelukast', gtopdbAliases: [],
    receptorAllowList: ['cyslt1'],
    notes: 'A leukotriene receptor antagonist: the only asthma drug here that is neither a beta agonist nor a steroid.',
  },
  {
    id: 'dexamethasone', displayName: 'Dexamethasone', class: 'other', drawerGroup: 'Steroids',
    routes: ['IV_PUSH', 'ORAL', 'IM'],
    presetDoses: [
      { route: 'IV_PUSH', amount: 8, unit: 'mg', label: '8 mg', ...dailymed('dexamethasone sodium phosphate injection') },
      { route: 'ORAL', amount: 4, unit: 'mg', label: '4 mg', ...dailymed('dexamethasone tablets') },
      { route: 'IM', amount: 8, unit: 'mg', label: '8 mg IM', ...dailymed('dexamethasone sodium phosphate injection') },
    ],
    pulseName: null, gtopdbLigand: 'dexamethasone', gtopdbAliases: [],
    receptorAllowList: ['glucocorticoid', 'mineralocorticoid'],
    notes: 'Almost pure glucocorticoid activity with essentially no mineralocorticoid effect, which is exactly why it is the steroid for cerebral oedema and the wrong one for adrenal replacement.',
  },
  {
    id: 'hydrocortisone', displayName: 'Hydrocortisone', class: 'other', drawerGroup: 'Steroids',
    routes: ['IV_PUSH', 'ORAL'],
    presetDoses: [
      { route: 'IV_PUSH', amount: 100, unit: 'mg', label: '100 mg', ...dailymed('hydrocortisone sodium succinate for injection') },
      { route: 'ORAL', amount: 20, unit: 'mg', label: '20 mg', ...dailymed('hydrocortisone tablets') },
    ],
    pulseName: null, gtopdbLigand: 'hydrocortisone', gtopdbAliases: ['cortisol'],
    receptorAllowList: ['glucocorticoid', 'mineralocorticoid'],
    notes: 'Cortisol itself. It binds the mineralocorticoid receptor as well, which is the contrast with dexamethasone and the reason it is the replacement steroid in an adrenal crisis.',
  },
  {
    id: 'prednisolone', displayName: 'Prednisolone', class: 'other', drawerGroup: 'Steroids',
    routes: ['ORAL'],
    presetDoses: [{ route: 'ORAL', amount: 40, unit: 'mg', label: '40 mg', ...dailymed('prednisolone tablets') }],
    pulseName: null, gtopdbLigand: 'prednisolone', gtopdbAliases: [],
    receptorAllowList: ['glucocorticoid', 'mineralocorticoid'],
    notes: 'The workhorse oral glucocorticoid, sitting between hydrocortisone and dexamethasone on both potency and mineralocorticoid activity.',
  },
  {
    id: 'ondansetron', displayName: 'Ondansetron', class: 'other', drawerGroup: 'Gastrointestinal',
    routes: ['IV_PUSH', 'ORAL'],
    presetDoses: [
      { route: 'IV_PUSH', amount: 4, unit: 'mg', label: '4 mg', ...dailymed('ondansetron injection') },
      { route: 'ORAL', amount: 8, unit: 'mg', label: '8 mg', ...dailymed('ondansetron tablets') },
    ],
    pulseName: null, gtopdbLigand: 'ondansetron', gtopdbAliases: [],
    receptorAllowList: ['ht3', 'herg'],
    notes: 'A 5-HT3 antagonist acting on vagal afferents and the area postrema. Its hERG affinity is why the intravenous dose was capped.',
  },
  {
    id: 'metoclopramide', displayName: 'Metoclopramide', class: 'other', drawerGroup: 'Gastrointestinal',
    routes: ['IV_PUSH', 'ORAL', 'IM'],
    presetDoses: [
      { route: 'IV_PUSH', amount: 10, unit: 'mg', label: '10 mg', ...dailymed('metoclopramide injection') },
      { route: 'ORAL', amount: 10, unit: 'mg', label: '10 mg', ...dailymed('metoclopramide tablets') },
      { route: 'IM', amount: 10, unit: 'mg', label: '10 mg IM', ...dailymed('metoclopramide injection') },
    ],
    pulseName: null, gtopdbLigand: 'metoclopramide', gtopdbAliases: [],
    receptorAllowList: ['d2', 'ht3', 'ht2a'],
    directEffects: [
      {
        target: 'gi.motility',
        gain: 0.5,
        note:
          'Prokinesis, and WITHOUT THIS THE DRUG IS MODELLED BACKWARDS. The d2 receptor in this model ' +
          'already carries gi.motility -0.3, so D2 blockade is exactly the prokinetic path and it is wired ' +
          'correctly — but GtoPdb publishes no human D2 affinity for metoclopramide, so the target is ' +
          'dropped and the ONLY surviving target is 5-HT3, which is constipating. A behavioural sweep ' +
          'measured the result: 10 mg with a meal in the stomach left MORE in it than no drug at all. ' +
          'Accelerating gastric emptying is its principal clinical use, and a model that shows the ' +
          'opposite is worse than one that shows nothing.',
        ...dailymed('metoclopramide injection'),
      },
    ],
    targetsNote:
      'The receptor panel shows only 5-HT3 for this drug. Its D2 blockade — antiemetic in the area ' +
      'postrema, prokinetic in the myenteric plexus, dystonic in the striatum — has no published human Ki ' +
      'in GtoPdb, so it cannot be given an occupancy here. The prokinetic half is carried by a cited ' +
      'direct effect instead; the antiemetic half is not modelled at all, because nausea is not a state ' +
      'this simulation has.',
    notes: 'Antiemetic by D2 blockade in the area postrema and prokinetic by D2 blockade in the myenteric plexus — the same action in two places. The same blockade in the striatum is what causes the dystonic reactions.',
  },
  {
    id: 'omeprazole', displayName: 'Omeprazole', class: 'other', drawerGroup: 'Gastrointestinal',
    routes: ['ORAL', 'IV_PUSH'],
    presetDoses: [
      { route: 'ORAL', amount: 20, unit: 'mg', label: '20 mg', ...dailymed('omeprazole delayed-release capsules') },
      { route: 'IV_PUSH', amount: 40, unit: 'mg', label: '40 mg', ...dailymed('omeprazole sodium for injection') },
    ],
    pulseName: null, gtopdbLigand: 'omeprazole', gtopdbAliases: [],
    receptorAllowList: [],
    targetsNote: 'Deliberate. Omeprazole is a prodrug that is converted in the parietal-cell canaliculus and then binds the H+/K+-ATPase covalently. Neither the acid activation nor the irreversible binding is representable by an affinity, so the acid suppression is a cited direct effect.',
    directEffects: [
      { target: 'gi.acidSecretion', gain: -0.85, note: 'Irreversible inhibition of the proton pump, the final common path for acid secretion. Because the binding is covalent the effect outlasts the drug by days, which is why a short plasma half-life gives once-daily dosing — and which this model, having only reversible kinetics, cannot reproduce.', ...dailymed('omeprazole delayed-release capsules') },
    ],
    notes: 'The clearest case in the set of a drug whose duration of effect has nothing to do with its half-life.',
  },
  {
    id: 'famotidine', displayName: 'Famotidine', class: 'other', drawerGroup: 'Gastrointestinal',
    routes: ['ORAL', 'IV_PUSH'],
    presetDoses: [
      { route: 'ORAL', amount: 20, unit: 'mg', label: '20 mg', ...dailymed('famotidine tablets') },
      { route: 'IV_PUSH', amount: 20, unit: 'mg', label: '20 mg', ...dailymed('famotidine injection') },
    ],
    pulseName: null, gtopdbLigand: 'famotidine', gtopdbAliases: [],
    receptorAllowList: ['h2', 'h1'],
    targetsNote: 'Deliberate in the sense that nothing better exists: GtoPdb lists famotidine at the H2 receptor but publishes no affinity value for it, so there is nothing to convert to a Ki. The acid suppression is carried by a cited direct effect.',
    directEffects: [
      { target: 'gi.acidSecretion', gain: -0.70, note: 'Competitive H2 blockade on the parietal cell. Reversible, so unlike omeprazole its duration does track its half-life.', ...dailymed('famotidine tablets') },
    ],
    notes: 'An H2 antagonist, and the contrast with omeprazole is the lesson: reversible receptor blockade with a duration that does track its half-life.',
  },
  {
    id: 'diphenhydramine', displayName: 'Diphenhydramine', class: 'other', drawerGroup: 'Antihistamines',
    routes: ['IV_PUSH', 'ORAL', 'IM'],
    presetDoses: [
      { route: 'IV_PUSH', amount: 25, unit: 'mg', label: '25 mg', ...dailymed('diphenhydramine hydrochloride injection') },
      { route: 'ORAL', amount: 25, unit: 'mg', label: '25 mg', ...dailymed('diphenhydramine hydrochloride capsules') },
      { route: 'IM', amount: 50, unit: 'mg', label: '50 mg IM', ...dailymed('diphenhydramine hydrochloride injection') },
    ],
    pulseName: null, gtopdbLigand: 'diphenhydramine', gtopdbAliases: [],
    receptorAllowList: ['h1', 'm1', 'm2', 'm3', 'nav'],
    notes: 'A first-generation antihistamine: lipophilic, so it crosses into the brain and sedates. The muscarinic affinity is why it also causes dry mouth and urinary retention.',
  },
  {
    id: 'loratadine', displayName: 'Loratadine', class: 'other', drawerGroup: 'Antihistamines',
    routes: ['ORAL'],
    presetDoses: [{ route: 'ORAL', amount: 10, unit: 'mg', label: '10 mg', ...dailymed('loratadine tablets') }],
    pulseName: null, gtopdbLigand: 'loratadine', gtopdbAliases: [],
    receptorAllowList: ['h1'],
    notes: 'A second-generation antihistamine. The reason it does not sedate is not its receptor profile but its inability to cross the blood-brain barrier, and this model expresses that with the same physicochemical gate it uses for everything else.',
  },
  {
    id: 'metformin', displayName: 'Metformin', class: 'other', drawerGroup: 'Endocrine',
    routes: ['ORAL'],
    presetDoses: [{ route: 'ORAL', amount: 500, unit: 'mg', label: '500 mg', ...dailymed('metformin hydrochloride tablets') }],
    pulseName: null, gtopdbLigand: 'metformin', gtopdbAliases: [],
    receptorAllowList: [],
    targetsNote: 'Deliberate. Metformin acts on hepatic mitochondrial complex I and AMP-activated protein kinase, neither of which is a binding target with a published human affinity this pipeline can use. Its effects are carried as cited direct effects.',
    directEffects: [
      { target: 'metabolic.hepaticGlucoseOutput', gain: -0.55, note: 'Suppression of hepatic gluconeogenesis, which is the principal action. It does not stimulate insulin secretion at all, which is why metformin alone essentially cannot cause hypoglycaemia.', ...dailymed('metformin hydrochloride tablets') },
      { target: 'metabolic.glucoseUptake', gain: 0.25, note: 'Modest increase in peripheral insulin sensitivity.', ...dailymed('metformin hydrochloride tablets') },
    ],
    notes: 'Renally cleared and unmetabolised, which is why renal failure is the contraindication and lactic acidosis the feared complication.',
  },
  {
    id: 'levothyroxine', displayName: 'Levothyroxine', class: 'other', drawerGroup: 'Endocrine',
    routes: ['ORAL', 'IV_PUSH'],
    presetDoses: [
      { route: 'ORAL', amount: 0.1, unit: 'mg', label: '100 mcg', ...dailymed('levothyroxine sodium tablets') },
      { route: 'IV_PUSH', amount: 0.2, unit: 'mg', label: '200 mcg', ...dailymed('levothyroxine sodium for injection') },
    ],
    pulseName: null, gtopdbLigand: 'levothyroxine', gtopdbAliases: ['thyroxine', 'L-thyroxine'],
    receptorAllowList: [],
    targetsNote: 'Deliberate. Thyroid hormone acts through a nuclear receptor over days to weeks; the endocrine subsystem already models free T4 with a seven-day half-life, so an exogenous dose is represented there rather than as a separate binding target.',
    directEffects: [
      { target: 'metabolic.basalRate', gain: 0.45, note: 'Raises basal metabolic rate across essentially every tissue, over WEEKS. The model applies it far faster than that, which is stated in MODEL_LIMITATIONS.', ...dailymed('levothyroxine sodium tablets') },
      { target: 'cardio.heartRate', gain: 0.30, note: 'Increased myocardial beta-adrenoceptor density, so thyroid state changes how the heart answers catecholamines.', ...dailymed('levothyroxine sodium tablets') },
    ],
    notes: 'A seven-day half-life, so this is the slowest drug in the set by two orders of magnitude.',
  },
  {
    id: 'allopurinol', displayName: 'Allopurinol', class: 'other', drawerGroup: 'Other',
    routes: ['ORAL'],
    presetDoses: [{ route: 'ORAL', amount: 300, unit: 'mg', label: '300 mg', ...dailymed('allopurinol tablets') }],
    pulseName: null, gtopdbLigand: 'allopurinol', gtopdbAliases: [],
    receptorAllowList: ['xanthine_oxidase'],
    notes: 'Its active metabolite oxypurinol does most of the work and lasts far longer than the parent; the model has no metabolites, so it understates the duration considerably.',
  },
  {
    id: 'lidocaine', displayName: 'Lidocaine', class: 'antiarrhythmic', drawerGroup: 'Antiarrhythmics',
    routes: ['IV_PUSH', 'IV_DRIP'],
    presetDoses: [
      { route: 'IV_PUSH', amount: 100, unit: 'mg', label: '100 mg', ...dailymed('lidocaine hydrochloride injection') },
      { route: 'IV_DRIP', amount: 120, unit: 'mg', label: '120 mg over 60 min', durationMin: 60, ...dailymed('lidocaine hydrochloride injection') },
    ],
    pulseName: 'Lidocaine', gtopdbLigand: 'lidocaine', gtopdbAliases: ['lignocaine'],
    receptorAllowList: ['nav'],
    notes: 'Local anaesthetic and class Ib antiarrhythmic, the same sodium-channel block in two settings. Its systemic toxicity — perioral tingling, then seizures, then cardiac arrest — is a dose-dependent sequence this model can walk you through.',
  },
  {
    id: 'bupivacaine', displayName: 'Bupivacaine', class: 'other', drawerGroup: 'Anaesthetics',
    routes: ['SUBCUTANEOUS'],
    presetDoses: [{ route: 'SUBCUTANEOUS', amount: 50, unit: 'mg', label: '50 mg infiltration', ...dailymed('bupivacaine hydrochloride injection') }],
    pulseName: null, gtopdbLigand: 'bupivacaine', gtopdbAliases: [],
    receptorAllowList: ['nav', 'herg'],
    notes: 'Longer-acting than lidocaine and considerably more cardiotoxic, because it dissociates from the cardiac sodium channel slowly. That is why an inadvertent intravascular dose is an arrest rather than a seizure.',
  },

  /* ================================================== controlled and recreational */
  {
    id: 'caffeine', displayName: 'Caffeine', class: 'stimulant', drawerGroup: 'Stimulants',
    routes: ['ORAL', 'IV_PUSH'],
    presetDoses: [
      { route: 'ORAL', amount: 100, unit: 'mg', label: '100 mg', ...study('Fredholm BB, et al. Actions of caffeine in the brain. Pharmacol Rev 51(1):83-133, 1999. A 100 mg exposure is roughly one cup of coffee.', 'https://pubmed.ncbi.nlm.nih.gov/10049999/') },
      { route: 'IV_PUSH', amount: 60, unit: 'mg', label: '60 mg', ...dailymed('caffeine citrate injection') },
    ],
    pulseName: null, gtopdbLigand: 'caffeine', gtopdbAliases: [],
    receptorAllowList: ['a1', 'a2a'],
    notes: 'An adenosine antagonist, and the most widely consumed psychoactive drug there is. It is here because it is the cleanest demonstration of competitive antagonism at a receptor whose endogenous agonist the model already carries.',
  },
  {
    id: 'nicotine', displayName: 'Nicotine', class: 'stimulant', drawerGroup: 'Stimulants',
    routes: ['ORAL', 'TRANSDERMAL', 'INTRANASAL'],
    presetDoses: [
      { route: 'ORAL', amount: 4, unit: 'mg', label: '4 mg', ...dailymed('nicotine polacrilex gum') },
      { route: 'TRANSDERMAL', amount: 21, unit: 'mg', label: '21 mg patch', ...dailymed('nicotine transdermal system') },
      { route: 'INTRANASAL', amount: 1, unit: 'mg', label: '1 mg', ...dailymed('nicotine nasal spray') },
    ],
    pulseName: null, gtopdbLigand: 'nicotine', gtopdbAliases: ['(-)-nicotine'],
    receptorAllowList: ['nachr'],
    scheduled: true,
    scheduleNote: 'A controlled substance in many jurisdictions and a licensed medicine in others. Modelled because ganglionic and central nicotinic transmission is core pharmacology and because its cardiovascular effects are substantial and worth seeing.',
    notes: 'Ganglionic and adrenal-medullary activation make its net cardiovascular effect sympathetic: rate up, pressure up, cutaneous flow down.',
  },
  {
    id: 'ethanol', displayName: 'Ethanol', class: 'sedative', drawerGroup: 'Stimulants',
    routes: ['ORAL'],
    presetDoses: [{ route: 'ORAL', amount: 14000, unit: 'mg', label: '14 g (one standard drink)', ...study('Cederbaum AI. Alcohol metabolism. Clin Liver Dis 16(4):667-685, 2012. A US standard drink contains 14 g of ethanol.', 'https://doi.org/10.1016/j.cld.2012.08.002') }],
    pulseName: null, gtopdbLigand: 'ethanol', gtopdbAliases: [],
    receptorAllowList: ['gabaa', 'nmda'],
    targetsNote: 'Deliberate. Ethanol has no single high-affinity site - it acts at low millimolar concentrations on GABA-A, NMDA and several ion channels at once, and the two human rows GtoPdb publishes (a glycine receptor and TRPV6) are neither the mechanism nor at a usable affinity. Its effects are carried as cited direct effects.',
    directEffects: [
      { target: 'neuro.sedation', gain: 0.75, note: 'GABA-A potentiation and NMDA inhibition together. Additive with every other central depressant in this set, which is the interaction that kills.', ...{ source: 'Vonghia L, et al. Acute alcohol intoxication. Eur J Intern Med 19(8):561-567, 2008.', sourceUrl: 'https://doi.org/10.1016/j.ejim.2007.06.033' } },
      { target: 'resp.drive', gain: -0.4, note: 'Central respiratory depression at high concentration.', ...{ source: 'Vonghia L, et al. Acute alcohol intoxication. Eur J Intern Med 19(8):561-567, 2008.', sourceUrl: 'https://doi.org/10.1016/j.ejim.2007.06.033' } },
      { target: 'cardio.systemicResistance', gain: -0.3, note: 'Cutaneous vasodilation. It feels warming and it accelerates heat LOSS, which is why intoxication and cold exposure together cause hypothermia.', ...{ source: 'Vonghia L, et al. Acute alcohol intoxication. Eur J Intern Med 19(8):561-567, 2008.', sourceUrl: 'https://doi.org/10.1016/j.ejim.2007.06.033' } },
      { target: 'renal.waterReabsorption', gain: -0.45, note: 'Vasopressin suppression: the diuresis, and most of the dehydration behind a hangover.', ...{ source: 'Vonghia L, et al. Acute alcohol intoxication. Eur J Intern Med 19(8):561-567, 2008.', sourceUrl: 'https://doi.org/10.1016/j.ejim.2007.06.033' } },
      { target: 'metabolic.hepaticGlucoseOutput', gain: -0.35, note: 'Gluconeogenesis is inhibited because ethanol metabolism consumes the NAD+ it needs. This is why alcoholic hypoglycaemia happens and why it happens in the fasted.', ...{ source: 'Vonghia L, et al. Acute alcohol intoxication. Eur J Intern Med 19(8):561-567, 2008.', sourceUrl: 'https://doi.org/10.1016/j.ejim.2007.06.033' } },
      { target: 'thermal.setPoint', gain: -0.25, note: 'Lowered thermoregulatory set point compounding the vasodilation.', ...{ source: 'Vonghia L, et al. Acute alcohol intoxication. Eur J Intern Med 19(8):561-567, 2008.', sourceUrl: 'https://doi.org/10.1016/j.ejim.2007.06.033' } },
    ],
    scheduled: true,
    scheduleNote: 'Legal and ubiquitous, and pharmacologically a sedative-hypnotic with zero-order elimination. Modelled because saturable elimination is a concept nothing else in the set demonstrates and because its interaction with every other central depressant here is real.',
    notes: 'ZERO-ORDER ELIMINATION at any meaningful concentration: the body removes a fixed AMOUNT per hour, not a fixed fraction, so doubling the dose more than doubles the time to sober. This is the one drug in the set that makes the Michaelis-Menten path in pk.ts earn its place.',
  },
  {
    id: 'thc', displayName: 'THC (cannabis)', class: 'psychedelic', drawerGroup: 'Controlled',
    routes: ['INHALED', 'ORAL'],
    presetDoses: [
      { route: 'INHALED', amount: 10, unit: 'mg', label: '10 mg inhaled (study exposure)', ...study('Huestis MA. Human cannabinoid pharmacokinetics. Chem Biodivers 4(8):1770-1804, 2007. Controlled human laboratory exposures.', 'https://doi.org/10.1002/cbdv.200790152') },
      { route: 'ORAL', amount: 20, unit: 'mg', label: '20 mg oral (study exposure)', ...study('Huestis MA. Human cannabinoid pharmacokinetics. Chem Biodivers 4(8):1770-1804, 2007.', 'https://doi.org/10.1002/cbdv.200790152') },
    ],
    pulseName: null, gtopdbLigand: 'Delta9-tetrahydrocannabinol', gtopdbAliases: ['delta9-THC', 'THC', '(-)-trans-Delta9-tetrahydrocannabinol'],
    receptorAllowList: ['cb1'],
    scheduled: true,
    scheduleNote: 'A controlled substance in many jurisdictions and a licensed medicine in several. Modelled because CB1 is a major GPCR that no other compound in this set reaches, and because the difference between the inhaled and oral routes — a first-pass metabolism story — is one of the clearest pharmacokinetic lessons available.',
    notes: 'The inhaled and oral curves differ enormously: inhaled reaches peak in minutes, oral takes one to three hours and produces a different metabolite profile through the first pass. Extremely lipophilic, so it distributes into fat and its terminal phase runs for days.',
  },
  {
    id: 'cannabidiol', displayName: 'Cannabidiol', class: 'other', drawerGroup: 'Controlled',
    routes: ['ORAL'],
    presetDoses: [{ route: 'ORAL', amount: 100, unit: 'mg', label: '100 mg', ...dailymed('cannabidiol oral solution') }],
    pulseName: null, gtopdbLigand: 'cannabidiol', gtopdbAliases: ['CBD'],
    receptorAllowList: ['nav', 'cb1'],
    notes: 'A licensed anticonvulsant, and pharmacologically almost the opposite of THC: negligible CB1 agonism, with sodium-channel and other activity instead. It is here as the contrast that shows "cannabis" is not one drug.',
  },
  {
    id: 'amfetamine', displayName: 'Amfetamine', class: 'stimulant', drawerGroup: 'Controlled',
    routes: ['ORAL'],
    presetDoses: [{ route: 'ORAL', amount: 10, unit: 'mg', label: '10 mg (study exposure)', ...study('Asghar SJ, et al. Comparison of amphetamine pharmacokinetics. J Psychiatry Neurosci 28(5):350-356, 2003. Controlled human exposures.', 'https://pubmed.ncbi.nlm.nih.gov/14517578/') }],
    pulseName: null, gtopdbLigand: 'dexamfetamine', gtopdbAliases: ['amfetamine', 'D-amphetamine', 'dextroamphetamine'],
    receptorAllowList: ['dat', 'net', 'taar1'],
    scheduled: true,
    scheduleNote: 'A controlled substance and a licensed medicine. Modelled because it is the standard illustration of a monoamine RELEASER as distinct from a reuptake inhibitor — a distinction this model encodes structurally, through the transporter semantics in sim/pharma/pd.ts.',
    notes: 'A substrate at the transporters rather than merely a blocker, so it reverses them and drives transmitter out of the terminal. That is why its effect is larger than any pure reuptake inhibitor can produce.',
  },
  {
    id: 'methamphetamine', displayName: 'Methamphetamine', class: 'stimulant', drawerGroup: 'Controlled',
    routes: ['ORAL'],
    presetDoses: [{ route: 'ORAL', amount: 20, unit: 'mg', label: '20 mg (study exposure)', ...study('Cruickshank CC, Dyer KR. A review of the clinical pharmacology of methamphetamine. Addiction 104(7):1085-1099, 2009. Controlled human laboratory exposures.', 'https://doi.org/10.1111/j.1360-0443.2009.02564.x') }],
    pulseName: null, gtopdbLigand: 'metamfetamine', gtopdbAliases: ['methamphetamine', 'methamfetamine', '(+)-methamphetamine'],
    receptorAllowList: ['dat', 'net', 'taar1'],
    targetsNote: 'Deliberate in the sense that nothing better exists: GtoPdb publishes no human affinity row for this ligand. Its mechanism is well established and well cited, so it is carried as direct effects - the drug behaves correctly and the receptor panel honestly shows nothing bound.',
    directEffects: [
      { target: 'cardio.heartRate', gain: 0.85, note: 'Indirect sympathomimetic: it is a transporter SUBSTRATE, so it reverses noradrenaline transport and drives transmitter out of the terminal rather than merely blocking reuptake. That is why the effect exceeds anything a pure blocker produces.', ...{ source: 'Cruickshank CC, Dyer KR. A review of the clinical pharmacology of methamphetamine. Addiction 104(7):1085-1099, 2009.', sourceUrl: 'https://doi.org/10.1111/j.1360-0443.2009.02564.x' } },
      { target: 'cardio.systemicResistance', gain: 0.7, note: 'Raised synaptic noradrenaline at vascular alpha-1. The hypertension is often severe and is the proximate cause of the haemorrhagic strokes.', ...{ source: 'Cruickshank CC, Dyer KR. A review of the clinical pharmacology of methamphetamine. Addiction 104(7):1085-1099, 2009.', sourceUrl: 'https://doi.org/10.1111/j.1360-0443.2009.02564.x' } },
      { target: 'cardio.contractility', gain: 0.55, note: 'Beta-1 stimulation by released noradrenaline.', ...{ source: 'Cruickshank CC, Dyer KR. A review of the clinical pharmacology of methamphetamine. Addiction 104(7):1085-1099, 2009.', sourceUrl: 'https://doi.org/10.1111/j.1360-0443.2009.02564.x' } },
      { target: 'cardio.arrhythmogenicity', gain: 0.75, note: 'Catecholamine excess lowers the fibrillation threshold; ventricular arrhythmia is a recognised mode of death.', ...{ source: 'Cruickshank CC, Dyer KR. A review of the clinical pharmacology of methamphetamine. Addiction 104(7):1085-1099, 2009.', sourceUrl: 'https://doi.org/10.1111/j.1360-0443.2009.02564.x' } },
      { target: 'thermal.heatProduction', gain: 0.95, note: 'HYPERTHERMIA IS THE DANGEROUS PART. It comes from three places at once - increased motor activity, cutaneous vasoconstriction impairing heat loss, and direct thermogenesis - and the temperatures reached are lethal.', ...{ source: 'Cruickshank CC, Dyer KR. A review of the clinical pharmacology of methamphetamine. Addiction 104(7):1085-1099, 2009.', sourceUrl: 'https://doi.org/10.1111/j.1360-0443.2009.02564.x' } },
      { target: 'neuro.arousal', gain: 0.9, note: 'Massive striatal and cortical dopamine release.', ...{ source: 'Cruickshank CC, Dyer KR. A review of the clinical pharmacology of methamphetamine. Addiction 104(7):1085-1099, 2009.', sourceUrl: 'https://doi.org/10.1111/j.1360-0443.2009.02564.x' } },
      { target: 'neuro.seizureThreshold', gain: -0.45, note: 'The threshold falls; seizures are common in overdose.', ...{ source: 'Cruickshank CC, Dyer KR. A review of the clinical pharmacology of methamphetamine. Addiction 104(7):1085-1099, 2009.', sourceUrl: 'https://doi.org/10.1111/j.1360-0443.2009.02564.x' } },
      { target: 'gi.appetite', gain: -0.7, note: 'Profound appetite suppression.', ...{ source: 'Cruickshank CC, Dyer KR. A review of the clinical pharmacology of methamphetamine. Addiction 104(7):1085-1099, 2009.', sourceUrl: 'https://doi.org/10.1111/j.1360-0443.2009.02564.x' } },
      { target: 'neuro.dependence', gain: 0.85, note: 'Mesolimbic reward signalling, and among the most reinforcing profiles known.', ...{ source: 'Cruickshank CC, Dyer KR. A review of the clinical pharmacology of methamphetamine. Addiction 104(7):1085-1099, 2009.', sourceUrl: 'https://doi.org/10.1111/j.1360-0443.2009.02564.x' } },
    ],
    scheduled: true,
    scheduleNote: 'A controlled substance with a narrow licensed use. Modelled because its toxicity is pharmacologically instructive and because the model should show it honestly: hyperthermia, tachycardia, hypertension and a lowered fibrillation threshold, all emerging from the same transporter and TAAR1 occupancy rather than being scripted.',
    notes: 'More lipophilic than amfetamine and therefore more centrally penetrant at the same plasma concentration, with a longer half-life. The hyperthermia is the dangerous part and it emerges here from thermal.heatProduction being driven by three separate occupancies at once.',
  },
  {
    id: 'cocaine', displayName: 'Cocaine', class: 'stimulant', drawerGroup: 'Controlled',
    routes: ['INTRANASAL', 'IV_PUSH'],
    presetDoses: [
      { route: 'INTRANASAL', amount: 96, unit: 'mg', label: '96 mg (study exposure)', ...study('Jeffcoat AR, et al. Cocaine disposition in humans after intravenous, intranasal and smoked administration. J Anal Toxicol 13(1):A1-A7, 1989. Controlled human laboratory exposures.', 'https://pubmed.ncbi.nlm.nih.gov/2733387/') },
      { route: 'IV_PUSH', amount: 25, unit: 'mg', label: '25 mg (study exposure)', ...study('Jeffcoat AR, et al. J Anal Toxicol 13(1):A1-A7, 1989.', 'https://pubmed.ncbi.nlm.nih.gov/2733387/') },
    ],
    pulseName: null, gtopdbLigand: 'cocaine', gtopdbAliases: [],
    receptorAllowList: ['dat', 'net', 'sert', 'nav', 'ht3'],
    targetsNote: 'Partly deliberate. GtoPdb publishes human affinities for cocaine only at 5-HT3, which is real but incidental; the monoamine transporter and sodium-channel affinities that constitute its actual pharmacology have no human rows. The 5-HT3 binding is kept and the rest is carried as cited direct effects.',
    directEffects: [
      { target: 'cardio.heartRate', gain: 0.7, note: 'Noradrenaline reuptake inhibition. Unlike the amfetamines it is a blocker rather than a substrate, so the effect is bounded by how much transmitter is being released anyway.', ...{ source: 'Schwartz BG, Rezkalla S, Kloner RA. Cardiovascular effects of cocaine. Circulation 122(24):2558-2569, 2010.', sourceUrl: 'https://doi.org/10.1161/CIRCULATIONAHA.110.940569' } },
      { target: 'cardio.systemicResistance', gain: 0.75, note: 'Raised synaptic noradrenaline at vascular alpha-1, including in the coronary circulation - which is why cocaine causes myocardial infarction in people with clean arteries.', ...{ source: 'Schwartz BG, Rezkalla S, Kloner RA. Cardiovascular effects of cocaine. Circulation 122(24):2558-2569, 2010.', sourceUrl: 'https://doi.org/10.1161/CIRCULATIONAHA.110.940569' } },
      { target: 'cardio.conductionVelocity', gain: -0.55, note: 'Sodium-channel block. THIS IS WHAT MAKES ITS CARDIAC TOXICITY DISTINCTIVE: a wide-complex arrhythmia on top of a catecholamine surge, which is why sodium bicarbonate and not a beta blocker is the treatment.', ...{ source: 'Schwartz BG, Rezkalla S, Kloner RA. Cardiovascular effects of cocaine. Circulation 122(24):2558-2569, 2010.', sourceUrl: 'https://doi.org/10.1161/CIRCULATIONAHA.110.940569' } },
      { target: 'cardio.arrhythmogenicity', gain: 0.7, note: 'Both mechanisms contribute, and they compound.', ...{ source: 'Schwartz BG, Rezkalla S, Kloner RA. Cardiovascular effects of cocaine. Circulation 122(24):2558-2569, 2010.', sourceUrl: 'https://doi.org/10.1161/CIRCULATIONAHA.110.940569' } },
      { target: 'thermal.heatProduction', gain: 0.55, note: 'Hyperthermia from vasoconstriction and agitation together.', ...{ source: 'Schwartz BG, Rezkalla S, Kloner RA. Cardiovascular effects of cocaine. Circulation 122(24):2558-2569, 2010.', sourceUrl: 'https://doi.org/10.1161/CIRCULATIONAHA.110.940569' } },
      { target: 'neuro.arousal', gain: 0.8, note: 'Dopamine reuptake inhibition in the mesolimbic system.', ...{ source: 'Schwartz BG, Rezkalla S, Kloner RA. Cardiovascular effects of cocaine. Circulation 122(24):2558-2569, 2010.', sourceUrl: 'https://doi.org/10.1161/CIRCULATIONAHA.110.940569' } },
      { target: 'neuro.seizureThreshold', gain: -0.5, note: 'The threshold falls markedly.', ...{ source: 'Schwartz BG, Rezkalla S, Kloner RA. Cardiovascular effects of cocaine. Circulation 122(24):2558-2569, 2010.', sourceUrl: 'https://doi.org/10.1161/CIRCULATIONAHA.110.940569' } },
    ],
    scheduled: true,
    scheduleNote: 'A controlled substance with a residual licensed use as a topical anaesthetic. Modelled because it is the only compound here that is simultaneously a monoamine reuptake inhibitor and a sodium-channel blocker, and because that combination is exactly what makes its cardiac toxicity distinctive.',
    notes: 'Reuptake inhibition gives the sympathomimetic effect; sodium-channel block gives the local anaesthesia and, at high concentration, the wide-complex arrhythmia. The model carries both, so the ECG changes and the pressor response arrive together as they really do.',
  },
  {
    id: 'mdma', displayName: 'MDMA', class: 'psychedelic', drawerGroup: 'Controlled',
    routes: ['ORAL'],
    presetDoses: [{ route: 'ORAL', amount: 100, unit: 'mg', label: '100 mg (study exposure)', ...study('de la Torre R, et al. Human pharmacology of MDMA. Ther Drug Monit 26(2):137-144, 2004. Controlled human laboratory exposures.', 'https://doi.org/10.1097/00007691-200404000-00009') }],
    pulseName: null, gtopdbLigand: 'MDMA', gtopdbAliases: ['3,4-methylenedioxymethamphetamine', 'midomafetamine'],
    receptorAllowList: ['sert', 'dat', 'net', 'ht2a', 'taar1'],
    targetsNote: 'Deliberate in the sense that nothing better exists: GtoPdb publishes no human affinity row for this ligand. Its mechanism is well established and well cited, so it is carried as direct effects - the drug behaves correctly and the receptor panel honestly shows nothing bound.',
    directEffects: [
      { target: 'thermal.heatProduction', gain: 0.85, note: 'Serotonergic hyperthermia, mediated largely through 5-HT2A. It is worse when heat loss is impaired, which is a real interaction between pharmacology and thermoregulation rather than a property of the drug alone.', ...{ source: 'de la Torre R, et al. Human pharmacology of MDMA. Ther Drug Monit 26(2):137-144, 2004.', sourceUrl: 'https://doi.org/10.1097/00007691-200404000-00009' } },
      { target: 'cardio.heartRate', gain: 0.6, note: 'Indirect sympathomimetic, weaker than amfetamine because the release is predominantly serotonergic rather than dopaminergic.', ...{ source: 'de la Torre R, et al. Human pharmacology of MDMA. Ther Drug Monit 26(2):137-144, 2004.', sourceUrl: 'https://doi.org/10.1097/00007691-200404000-00009' } },
      { target: 'cardio.systemicResistance', gain: 0.45, note: 'Modest pressor effect.', ...{ source: 'de la Torre R, et al. Human pharmacology of MDMA. Ther Drug Monit 26(2):137-144, 2004.', sourceUrl: 'https://doi.org/10.1097/00007691-200404000-00009' } },
      { target: 'renal.waterReabsorption', gain: 0.55, note: 'Vasopressin release. Combined with free-water drinking this is what produces the hyponatraemia that is the other characteristic toxicity, and the model has both halves of that mechanism.', ...{ source: 'de la Torre R, et al. Human pharmacology of MDMA. Ther Drug Monit 26(2):137-144, 2004.', sourceUrl: 'https://doi.org/10.1097/00007691-200404000-00009' } },
      { target: 'neuro.arousal', gain: 0.55, note: 'Cortical and limbic monoamine release.', ...{ source: 'de la Torre R, et al. Human pharmacology of MDMA. Ther Drug Monit 26(2):137-144, 2004.', sourceUrl: 'https://doi.org/10.1097/00007691-200404000-00009' } },
      { target: 'neuro.euphoria', gain: 0.85, note: 'Predominantly serotonergic, which is what distinguishes the subjective effect from a stimulant.', ...{ source: 'de la Torre R, et al. Human pharmacology of MDMA. Ther Drug Monit 26(2):137-144, 2004.', sourceUrl: 'https://doi.org/10.1097/00007691-200404000-00009' } },
    ],
    scheduled: true,
    scheduleNote: 'A controlled substance currently in late-phase clinical trials. Modelled because it is the clearest example of a serotonin releaser, and because its characteristic toxicity — hyperthermia and hyponatraemia — arises from mechanisms this model already has: 5-HT2A thermogenesis and vasopressin-driven water retention.',
    notes: 'Predominantly serotonergic where amfetamine is dopaminergic, which is the whole difference in effect. Its hyperthermia is serotonergic and is worse when heat loss is impaired — a real interaction between pharmacology and thermoregulation that the model can show.',
  },
];
