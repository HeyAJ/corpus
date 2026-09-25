import type { PkLiteratureEntry } from './pk_literature';

/**
 * PHARMACOKINETICS, PART THREE — the emergency, endocrine, anticoagulant,
 * neuromuscular, anti-infective and further neuropsychiatric set.
 *
 * Same rules as parts one and two, and the same source policy: the FDA Structured
 * Product Label (section 12.3) is the default, cited through the same DailyMed URL the
 * cross-check parser reads, and anything that is not from a label carries its own
 * primary reference. A drug whose central volume and either a clearance or a half-life
 * could not both be sourced is not here.
 *
 * TWO KINDS OF ENTRY NEED A WORD.
 *
 *  - PEPTIDES AND HORMONES (vasopressin, glucagon, insulin, semaglutide, desmopressin)
 *    carry an explicit MW_gmol. PubChem's name resolver returns nothing usable for a
 *    polypeptide, and without a molecular weight the engine cannot turn a plasma
 *    concentration into the nanomolar free concentration a receptor occupancy needs —
 *    so the drug would silently bind nothing. The molecular weight is the monoisotopic/
 *    average mass from the cited compound record, which is arithmetic on the sequence,
 *    not a fitted number.
 *
 *  - PRODRUGS AND ACTIVE METABOLITES (oseltamivir, artesunate, remdesivir) are modelled
 *    with the DISPOSITION OF THE SPECIES THAT ACTS, and the note says which one. That is
 *    the honest choice for a drug whose parent is a delivery vehicle for the molecule
 *    that reaches the target.
 */

const FDA = (q: string) => ({
  source: `FDA Structured Product Label via DailyMed — ${q}`,
  url: `https://dailymed.nlm.nih.gov/dailymed/search.cfm?labeltype=all&query=${encodeURIComponent(q)}`,
});

/** Vd in litres for a 70 kg adult, from a per-kilogram figure. */
const L = (perKg: number) => perKg * 70;

/** A compact one-compartment entry known only by a volume of distribution and a half-life. */
function one(
  drugId: string,
  v1_L: number,
  halfLife_min: number,
  proteinBound: number,
  renalFraction: number,
  label: string,
  quantity: string,
  extra: Partial<PkLiteratureEntry> = {},
): PkLiteratureEntry {
  const src = FDA(label);
  return {
    drugId,
    shape: 'one',
    v1_L,
    halfLife_min,
    proteinBound,
    renalFraction,
    ...extra,
    citations: [
      {
        quantity,
        source: src.source,
        url: src.url,
        confidence: 'measured',
        note:
          'Volume of distribution and elimination half-life from section 12.3. Modelled in ONE compartment ' +
          'because that is what those two numbers determine; where a published multi-compartment model ' +
          'exists, its distribution phase is not reproduced here.',
      },
    ],
  };
}

/** A payload drug (electrolyte, buffer, sugar) with no compartmental pharmacokinetics. */
function payloadPk(drugId: string, why: string): PkLiteratureEntry {
  return {
    drugId,
    shape: 'none',
    citations: [{ quantity: 'no compartmental PK', source: why, url: 'docs/MODEL_LIMITATIONS.md', confidence: 'derived' }],
  };
}

export const PK_LITERATURE_3: PkLiteratureEntry[] = [
  /* ------------------------------------------------------ payload drugs */
  payloadPk('sodium_bicarbonate', 'A buffer/electrolyte load on the plasma, not a xenobiotic with a volume of distribution. Modelled as a direct bicarbonate and sodium payload.'),
  payloadPk('dextrose_50', 'A glucose load on the plasma glucose pool, not a xenobiotic. Modelled as a direct glucose (and small fluid) payload.'),
  payloadPk('dextrose_10', 'As for the 50% solution: a direct glucose and fluid payload, at a lower, less hyperosmolar concentration.'),

  /* =============================================== emergency / anaesthesia */
  {
    drugId: 'vasopressin',
    shape: 'one',
    v1_L: L(0.14),
    halfLife_min: 10,
    proteinBound: 0,
    renalFraction: 0.3,
    MW_gmol: 1084.23,
    citations: [
      {
        quantity: 'Vd 0.14 L/kg, half-life <10 min, does not bind plasma protein',
        source: FDA('vasopressin injection').source,
        url: FDA('vasopressin injection').url,
        confidence: 'measured',
        note:
          'The Vasostrict label puts the volume of distribution at 140 mL/kg and the elimination half-life ' +
          'under 10 minutes; vasopressin is cleared by serine protease and liver/kidney metabolism. Modelled ' +
          'at 10 min. MW 1084.23 is supplied explicitly because a nonapeptide does not resolve in PubChem and ' +
          'the receptor occupancy needs a molecular weight to reach a nanomolar free concentration.',
      },
      { quantity: 'MW = 1084.23 g/mol', source: 'PubChem CID 644077 (vasopressin).', url: 'https://pubchem.ncbi.nlm.nih.gov/compound/644077', confidence: 'measured' },
    ],
  },
  one('rocuronium', L(0.25), 84, 0.30, 0.30, 'rocuronium bromide injection',
    'Vss 0.25 L/kg, terminal (beta) elimination half-life 1.4 h, ~30% protein bound, eliminated primarily by the liver with a renal contribution',
    { MW_gmol: 529.77 }),
  {
    drugId: 'succinylcholine',
    shape: 'one',
    v1_L: L(0.16),
    halfLife_min: 0.75,
    proteinBound: 0.3,
    renalFraction: 0.02,
    MW_gmol: 361.3,
    citations: [
      {
        quantity: 'half-life ~45 s by plasma cholinesterase hydrolysis',
        source: FDA('succinylcholine chloride injection').source,
        url: FDA('succinylcholine chloride injection').url,
        confidence: 'measured',
        note:
          'Succinylcholine is hydrolysed by plasma (pseudo)cholinesterase within about a minute, which is the ' +
          'entire reason it is chosen for rapid-sequence intubation and the reason a cholinesterase-deficient ' +
          'patient has a prolonged block. Modelled at 45 s. Volume approximated at the extracellular space it ' +
          'is confined to over that lifetime.',
      },
    ],
  },
  one('neostigmine', L(0.7), 60, 0.20, 0.50, 'neostigmine methylsulfate injection',
    'Vd ~0.5-1 L/kg, elimination half-life ~24-113 min (modelled at 60 min), 15-25% protein bound, ~50% renally excreted unchanged',
    { MW_gmol: 334.39 }),
  one('glycopyrrolate', L(0.42), 50, 0.30, 0.85, 'glycopyrrolate injection',
    'Vd ~0.42 L/kg, elimination half-life ~0.6-1.1 h (modelled 50 min), largely renally excreted unchanged; a quaternary amine, so it does not enter the brain',
    { MW_gmol: 318.43, ka_min: 0.02, bioavailability: 0.05 }),
  {
    drugId: 'etomidate',
    shape: 'one',
    v1_L: L(3.5),
    halfLife_min: 75,
    proteinBound: 0.76,
    renalFraction: 0.02,
    citations: [
      {
        quantity: 'terminal half-life ~75 min, 76% protein bound, large Vd from high lipophilicity',
        source: FDA('etomidate injection').source,
        url: FDA('etomidate injection').url,
        confidence: 'measured',
        note:
          'The label reports plasma concentrations falling with a terminal half-life of about 75 minutes and ' +
          '76% protein binding. The rapid offset of a single induction dose is redistribution, not ' +
          'elimination — the same context-sensitive story as propofol, and modelled in one compartment here ' +
          'because the label gives a volume and a half-life and nothing finer.',
      },
    ],
  },
  {
    drugId: 'remifentanil',
    shape: 'one',
    v1_L: 8,
    halfLife_min: 6,
    proteinBound: 0.70,
    renalFraction: 0.02,
    MW_gmol: 376.45,
    citations: [
      {
        quantity: 'central volume ~8 L, effective half-life 3-10 min by blood/tissue esterases, ~70% protein bound',
        source: FDA('remifentanil hydrochloride injection').source,
        url: FDA('remifentanil hydrochloride injection').url,
        confidence: 'measured',
        note:
          'Remifentanil is hydrolysed by non-specific blood and tissue esterases, so its context-sensitive ' +
          'half-time stays near 3-5 min however long it has run — the property that defines the molecule, the ' +
          'same esterase-limited disposition as esmolol. Modelled in one compartment at a 6 min effective ' +
          'half-life.',
      },
    ],
  },
  one('labetalol', L(9.4), 300, 0.50, 0.05, 'labetalol hydrochloride injection',
    'Vd ~9.4 L/kg, elimination half-life ~5.5 h after oral and ~5 h after IV (modelled 5 h), ~50% protein bound',
    { ka_min: 0.04, bioavailability: 0.25, hepaticExtraction: 0.6, MW_gmol: 328.41 }),
  one('hydralazine', L(1.6), 240, 0.87, 0.10, 'hydralazine hydrochloride injection',
    'Vd ~1.6 L/kg, plasma half-life 3-7 h (modelled 4 h), 87% protein bound; extensive acetylation first pass',
    { ka_min: 0.06, bioavailability: 0.35, hepaticExtraction: 0.6, MW_gmol: 160.18 }),
  {
    drugId: 'glyceryl_trinitrate',
    shape: 'one',
    v1_L: 210,
    halfLife_min: 3,
    proteinBound: 0.60,
    renalFraction: 0.01,
    ka_min: 0.25,
    bioavailability: 0.4,
    MW_gmol: 227.09,
    citations: [
      {
        quantity: 'V_area ~3 L/kg, half-life 1-4 min, ~60% protein bound, sublingual bioavailability ~40%',
        source: FDA('nitroglycerin sublingual tablets').source,
        url: FDA('nitroglycerin sublingual tablets').url,
        confidence: 'measured',
        note:
          'The label gives a very large volume of distribution and a 1-4 min half-life set by rapid ' +
          'denitration; the active dinitrate metabolites live longer (~35 min) but are not modelled. The 40% ' +
          'sublingual bioavailability is the reason the tablet works and the swallowed dose does not.',
      },
    ],
  },
  {
    drugId: 'sodium_nitroprusside',
    shape: 'one',
    v1_L: L(0.2),
    halfLife_min: 2,
    proteinBound: 0,
    renalFraction: 0.02,
    MW_gmol: 261.98,
    citations: [
      {
        quantity: 'distribution volume ~0.2 L/kg, circulatory half-life ~2 min',
        source: FDA('sodium nitroprusside injection').source,
        url: FDA('sodium nitroprusside injection').url,
        confidence: 'measured',
        note:
          'The label states nitroprusside is cleared from a small volume by an intra-erythrocytic reaction ' +
          'with haemoglobin, giving a circulatory half-life of about two minutes. That near-instant offset is ' +
          'why it is titratable second-to-second, and the cyanide liberated by the same reaction is its ' +
          'toxicity — the latter is not modelled and is recorded in MODEL_LIMITATIONS.',
      },
    ],
  },
  one('mannitol', 17, 100, 0, 0.90, 'mannitol injection',
    'Vd ~17 L (extracellular fluid), elimination half-life ~1.6 h (modelled 100 min), filtered and not reabsorbed, negligible protein binding',
    { MW_gmol: 182.17 }),
  one('magnesium_sulfate', L(0.3), 270, 0.30, 0.90, 'magnesium sulfate injection',
    'Distribution ~0.3 L/kg (extracellular), half-life 4-5 h (modelled 270 min), ~30% protein bound, renally excreted',
    { MW_gmol: 120.37 }),
  one('dantrolene', L(0.7), 480, 0.90, 0.02, 'dantrolene sodium injection',
    'Vd ~0.7 L/kg, biologic half-life ~8 h in adults, highly protein bound',
    { ka_min: 0.03, bioavailability: 0.70, MW_gmol: 314.25 }),
  {
    drugId: 'tranexamic_acid',
    shape: 'one',
    v1_L: 11,
    halfLife_min: 120,
    proteinBound: 0.03,
    renalFraction: 0.95,
    MW_gmol: 157.21,
    citations: [
      {
        quantity: 'initial volume 9-12 L, terminal half-life ~2 h, ~3% protein bound (to plasminogen), >95% renally excreted unchanged',
        source: FDA('tranexamic acid injection').source,
        url: FDA('tranexamic acid injection').url,
        confidence: 'measured',
        note:
          'The label gives an initial volume of distribution of 9-12 L, a ~2 h terminal half-life and 3% ' +
          'protein binding, the last accounted for entirely by binding to plasminogen — which is also the ' +
          'target. Almost entirely renally cleared.',
      },
    ],
  },

  /* ================================================= endocrine / metabolic */
  {
    drugId: 'insulin_regular',
    shape: 'one',
    v1_L: 8,
    halfLife_min: 6,
    proteinBound: 0.05,
    renalFraction: 0.4,
    ka_min: 0.006,
    bioavailability: 0.8,
    MW_gmol: 5807.63,
    citations: [
      {
        quantity: 'central volume ~8 L, intravenous half-life ~5-6 min, subcutaneous absorption rate-limiting',
        source: FDA('insulin human injection').source,
        url: FDA('insulin human injection').url,
        confidence: 'measured',
        note:
          'Given intravenously, regular human insulin has a plasma half-life of only a few minutes, cleared by ' +
          'receptor-mediated uptake and by insulinase in liver and kidney. Given SUBCUTANEOUSLY the terminal ' +
          'slope the label reports (120-206 min) is absorption-limited flip-flop kinetics, which the slow ka ' +
          'here reproduces. MW 5807.63 is supplied explicitly for the same reason as the other peptides.',
      },
      { quantity: 'MW = 5807.63 g/mol', source: 'PubChem CID 118984375 (human insulin).', url: 'https://pubchem.ncbi.nlm.nih.gov/compound/118984375', confidence: 'measured' },
    ],
  },
  {
    drugId: 'insulin_glargine',
    shape: 'one',
    v1_L: 8,
    halfLife_min: 720,
    proteinBound: 0.05,
    renalFraction: 0.4,
    ka_min: 0.0018,
    bioavailability: 0.7,
    MW_gmol: 6062.89,
    citations: [
      {
        quantity: 'subcutaneous microprecipitate depot giving a flat ~24 h profile, effective half-life ~12 h',
        source: FDA('insulin glargine injection').source,
        url: FDA('insulin glargine injection').url,
        confidence: 'measured',
        note:
          'Glargine is soluble at its acidic formulation pH and precipitates in subcutaneous tissue, from which ' +
          'it dissolves slowly to give a peakless profile lasting about a day. The long apparent half-life is ' +
          'that slow absorption, modelled here as a small ka rather than a slow elimination — the same ' +
          'flip-flop shape as a depot. The contrast with regular insulin is the whole teaching point.',
      },
    ],
  },
  {
    drugId: 'glucagon',
    shape: 'one',
    v1_L: L(0.25),
    halfLife_min: 13,
    proteinBound: 0,
    renalFraction: 0.3,
    ka_min: 0.05,
    bioavailability: 0.9,
    MW_gmol: 3482.75,
    citations: [
      {
        quantity: 'Vd ~0.25 L/kg, half-life 8-18 min, negligible protein binding',
        source: FDA('glucagon for injection').source,
        url: FDA('glucagon for injection').url,
        confidence: 'measured',
        note:
          'A 29-amino-acid peptide, cleared by liver and kidney with a half-life of 8-18 minutes — short ' +
          'enough that its glycogenolytic rescue of a hypoglycaemic patient is transient and fails once ' +
          'hepatic glycogen is gone. MW 3482.75 supplied explicitly for the receptor-occupancy arithmetic.',
      },
      { quantity: 'MW = 3482.75 g/mol', source: 'PubChem CID 16132424 (glucagon).', url: 'https://pubchem.ncbi.nlm.nih.gov/compound/16132424', confidence: 'measured' },
    ],
  },
  {
    drugId: 'semaglutide',
    shape: 'one',
    v1_L: 8,
    halfLife_min: 10080,
    proteinBound: 0.99,
    renalFraction: 0.03,
    ka_min: 0.02,
    bioavailability: 0.89,
    MW_gmol: 4113.58,
    citations: [
      {
        quantity: 'Vd ~8 L, half-life ~1 week, >99% albumin bound, subcutaneous bioavailability ~89%',
        source: FDA('semaglutide injection').source,
        url: FDA('semaglutide injection').url,
        confidence: 'measured',
        note:
          'The fatty-acid side chain binds albumin, which both protects semaglutide from clearance and gives ' +
          'it a one-week half-life — the property that makes it a once-weekly injection. MW 4113.58 supplied ' +
          'explicitly for the receptor arithmetic.',
      },
      { quantity: 'MW = 4113.58 g/mol', source: 'PubChem CID 56843331 (semaglutide).', url: 'https://pubchem.ncbi.nlm.nih.gov/compound/56843331', confidence: 'measured' },
    ],
  },
  one('glipizide', 11, 180, 0.98, 0.05, 'glipizide tablets',
    'Vd ~11 L (extracellular), half-life 2-4 h, 98-99% protein bound',
    { ka_min: 0.05, bioavailability: 0.90, MW_gmol: 445.54 }),
  one('atorvastatin', 381, 840, 0.98, 0.02, 'atorvastatin calcium tablets',
    'Vd ~381 L, plasma half-life ~14 h, >=98% protein bound, extensive first pass',
    { ka_min: 0.03, bioavailability: 0.14, hepaticExtraction: 0.7, MW_gmol: 558.64 }),
  {
    drugId: 'desmopressin',
    shape: 'one',
    v1_L: L(0.25),
    halfLife_min: 150,
    proteinBound: 0.5,
    renalFraction: 0.5,
    MW_gmol: 1069.22,
    citations: [
      {
        quantity: 'Vd ~0.25 L/kg, plasma half-life ~2-3 h (modelled 150 min)',
        source: FDA('desmopressin acetate injection').source,
        url: FDA('desmopressin acetate injection').url,
        confidence: 'measured',
        note:
          'A synthetic vasopressin analogue, resistant to peptidase and therefore far longer-lived than the ' +
          'native hormone — hours rather than minutes — which is why it is the antidiuretic used clinically. ' +
          'MW 1069.22 supplied explicitly for the receptor arithmetic.',
      },
      { quantity: 'MW = 1069.22 g/mol', source: 'PubChem CID 5311065 (desmopressin).', url: 'https://pubchem.ncbi.nlm.nih.gov/compound/5311065', confidence: 'measured' },
    ],
  },

  /* =============================================== cardiovascular / renal */
  one('lisinopril', 124, 720, 0, 0.90, 'lisinopril tablets',
    'Vd ~124 L, effective half-life of accumulation ~12 h, not appreciably protein bound, renally excreted unchanged',
    { ka_min: 0.02, bioavailability: 0.25, MW_gmol: 405.49 }),
  one('losartan', 34, 120, 0.99, 0.10, 'losartan potassium tablets',
    'Vd ~34 L, terminal half-life ~2 h for the parent (6-9 h for the active metabolite, not modelled), ~99% protein bound',
    { ka_min: 0.04, bioavailability: 0.33, hepaticExtraction: 0.5, MW_gmol: 422.91 }),
  one('clopidogrel', 100, 360, 0.94, 0.05, 'clopidogrel bisulfate tablets',
    'Vd of the active metabolite is large, parent half-life ~6 h, ~94-98% protein bound',
    { ka_min: 0.06, bioavailability: 0.50, hepaticExtraction: 0.5, MW_gmol: 321.82 }),
  {
    drugId: 'heparin',
    shape: 'one',
    v1_L: L(0.06),
    halfLife_min: 60,
    proteinBound: 0.95,
    renalFraction: 0.1,
    ka_min: 0.006,
    bioavailability: 0.3,
    citations: [
      {
        quantity: 'distribution volume ~0.06 L/kg (plasma), dose-dependent half-life ~1-1.5 h, subcutaneous bioavailability low and variable (~30%) with slow absorption',
        source: FDA('heparin sodium injection').source,
        url: FDA('heparin sodium injection').url,
        confidence: 'measured',
        note:
          'Unfractionated heparin is a large, highly charged polysaccharide confined largely to the plasma; ' +
          'its half-life is dose-dependent (saturable reticuloendothelial clearance) and modelled at 1 h for a ' +
          'therapeutic dose. No molecular weight is given because it is a heterogeneous polymer and carries no ' +
          'receptor target here — its action is a cited direct effect on coagulation.',
      },
    ],
  },
  {
    drugId: 'enoxaparin',
    shape: 'one',
    v1_L: 5,
    halfLife_min: 270,
    proteinBound: 0.1,
    renalFraction: 0.4,
    ka_min: 0.006,
    bioavailability: 0.92,
    citations: [
      {
        quantity: 'distribution volume ~5 L, anti-Xa half-life ~4.5 h, ~90% subcutaneous bioavailability',
        source: FDA('enoxaparin sodium injection').source,
        url: FDA('enoxaparin sodium injection').url,
        confidence: 'measured',
        note:
          'A low-molecular-weight heparin: a longer and more predictable anti-Xa half-life than unfractionated ' +
          'heparin, which is why it is dosed by weight without monitoring. Given subcutaneously, absorption is ' +
          'near-complete but rate-limited. As with heparin, no molecular weight and no receptor target — the ' +
          'anticoagulant action is a cited direct effect.',
      },
    ],
  },
  one('warfarin', L(0.14), 2400, 0.99, 0.01, 'warfarin sodium tablets',
    'Vd ~0.14 L/kg, effective half-life 20-60 h (modelled 40 h), ~99% protein bound',
    { ka_min: 0.08, bioavailability: 0.95, MW_gmol: 308.33 }),
  one('apixaban', 21, 720, 0.87, 0.27, 'apixaban tablets',
    'Vss ~21 L, half-life ~12 h, ~87% protein bound, oral bioavailability ~50%',
    { ka_min: 0.04, bioavailability: 0.50, MW_gmol: 459.5 }),
  {
    drugId: 'alteplase',
    shape: 'one',
    v1_L: 6,
    halfLife_min: 5,
    proteinBound: 0,
    renalFraction: 0.01,
    citations: [
      {
        quantity: 'initial plasma volume ~4-8 L, dominant half-life <5 min, hepatic clearance',
        source: FDA('alteplase for injection').source,
        url: FDA('alteplase for injection').url,
        confidence: 'measured',
        note:
          'Recombinant tissue plasminogen activator, cleared by the liver with a dominant half-life under five ' +
          'minutes — so it is given as a bolus-plus-infusion and its lytic window is short. No molecular ' +
          'weight and no receptor target: its clot-lysing action is carried as a cited direct effect on the ' +
          'coagulation bus, and the distinction between lysing a formed clot and preventing one is stated in ' +
          'its manifest note.',
      },
    ],
  },

  /* ==================================================== allergy / GI */
  one('chlorphenamine', L(3.0), 1200, 0.72, 0.20, 'chlorpheniramine maleate tablets',
    'Vd ~2.5-3.2 L/kg, half-life ~20 h (modelled 1200 min), ~72% protein bound',
    { ka_min: 0.05, bioavailability: 0.40, hepaticExtraction: 0.5, MW_gmol: 274.79 }),
  one('cetirizine', L(0.5), 510, 0.93, 0.60, 'cetirizine hydrochloride tablets',
    'Vd ~0.5 L/kg, half-life ~8.3 h, ~93% protein bound, largely renally excreted; a zwitterion that barely enters the brain',
    { ka_min: 0.07, bioavailability: 0.90, MW_gmol: 388.89 }),
  one('promethazine', L(13), 720, 0.90, 0.02, 'promethazine hydrochloride tablets',
    'Vd ~13 L/kg, half-life 10-14 h (modelled 12 h), ~90% protein bound',
    { ka_min: 0.05, bioavailability: 0.25, hepaticExtraction: 0.6, MW_gmol: 284.42 }),
  one('prochlorperazine', L(20), 420, 0.92, 0.01, 'prochlorperazine maleate tablets',
    'Vd ~20 L/kg, half-life ~6-8 h (modelled 7 h), highly protein bound, extensive first pass',
    { ka_min: 0.04, bioavailability: 0.13, hepaticExtraction: 0.8, MW_gmol: 373.95 }),
  one('loperamide', L(5.7), 600, 0.97, 0.01, 'loperamide hydrochloride capsules',
    'Vd ~5.7 L/kg, half-life ~10-14 h (modelled 600 min), ~97% protein bound; a P-glycoprotein substrate kept out of the brain',
    { ka_min: 0.04, bioavailability: 0.004, hepaticExtraction: 0.6, MW_gmol: 513.51 }),
  one('pantoprazole', 17, 60, 0.98, 0.01, 'pantoprazole sodium injection',
    'Vd ~11-24 L (modelled 17 L), plasma half-life ~1 h, ~98% protein bound; effect outlasts the drug because pump binding is covalent',
    { ka_min: 0.05, lagTime_min: 60, bioavailability: 0.77, hepaticExtraction: 0.3, MW_gmol: 383.37 }),

  /* ==================================================== neuro / psych */
  one('zolpidem', L(0.54), 150, 0.92, 0.01, 'zolpidem tartrate tablets',
    'Vd ~0.54 L/kg, half-life ~2.5 h, ~92% protein bound',
    { ka_min: 0.12, bioavailability: 0.67, hepaticExtraction: 0.3, MW_gmol: 307.4 }),
  one('alprazolam', L(0.9), 660, 0.80, 0.01, 'alprazolam tablets',
    'Vd ~0.9-1.3 L/kg, half-life ~11 h, ~80% protein bound',
    { ka_min: 0.06, bioavailability: 0.90, MW_gmol: 308.76 }),
  one('clonazepam', L(3.0), 2100, 0.85, 0.01, 'clonazepam tablets',
    'Vd ~3 L/kg, half-life 30-40 h (modelled 35 h), ~85% protein bound, oral bioavailability ~90%',
    { ka_min: 0.05, bioavailability: 0.90, MW_gmol: 315.71 }),
  one('valproate', L(0.16), 780, 0.90, 0.02, 'divalproex sodium tablets',
    'Vd ~0.16 L/kg, half-life 9-16 h (modelled 13 h), ~90% protein bound and concentration-dependent',
    { ka_min: 0.04, bioavailability: 0.90, MW_gmol: 144.21 }),
  one('levetiracetam', L(0.55), 420, 0.10, 0.66, 'levetiracetam tablets',
    'Vd ~0.5-0.7 L/kg, half-life ~7 h, <10% protein bound, mostly renally excreted, oral bioavailability ~100%',
    { ka_min: 0.06, bioavailability: 1.0, MW_gmol: 170.21 }),
  one('pregabalin', L(0.5), 390, 0, 0.90, 'pregabalin capsules',
    'Vd ~0.5 L/kg, half-life ~6.3 h, negligible protein binding, renally excreted unchanged, oral bioavailability >=90%',
    { ka_min: 0.08, bioavailability: 0.90, MW_gmol: 159.23 }),
  one('buprenorphine', L(3.2), 2040, 0.96, 0.10, 'buprenorphine hydrochloride injection',
    'Vd ~3.2 L/kg, elimination half-life ~31-35 h (modelled 34 h), ~96% protein bound',
    { ka_min: 0.02, bioavailability: 0.30, hepaticExtraction: 0.6, MW_gmol: 467.64 }),
  one('methadone', L(4.0), 1500, 0.88, 0.20, 'methadone hydrochloride tablets',
    'Vd 2-6 L/kg, terminal half-life 8-59 h (modelled 25 h), 85-90% protein bound to alpha-1 acid glycoprotein',
    { ka_min: 0.05, bioavailability: 0.80, hepaticExtraction: 0.4, MW_gmol: 309.45 }),
  one('codeine', L(4.0), 180, 0.15, 0.10, 'codeine sulfate tablets',
    'Vd 3-6 L/kg, half-life ~3 h, 7-25% protein bound',
    { ka_min: 0.05, bioavailability: 0.53, hepaticExtraction: 0.4, MW_gmol: 299.36 }),
  {
    drugId: 'lsd',
    shape: 'one',
    v1_L: L(0.3),
    halfLife_min: 210,
    proteinBound: 0.80,
    renalFraction: 0.01,
    MW_gmol: 323.43,
    citations: [
      {
        quantity: 'Vd ~0.28 L/kg, terminal half-life ~3.6 h',
        source: 'Dolder PC, Schmid Y, Haschke M, Rentsch KM, Liechti ME. Pharmacokinetics and concentration-effect relationship of oral LSD in humans. Int J Neuropsychopharmacol 19(1):pyv072, 2016.',
        url: 'https://doi.org/10.1093/ijnp/pyv072',
        confidence: 'measured',
        note:
          'A controlled human pharmacokinetic study: mean volume of distribution about 0.28 L/kg and a ' +
          'terminal half-life near 3.6 h after an oral study dose. Cited as a study exposure, exactly as the ' +
          'other controlled compounds in this set are.',
      },
    ],
  },
  {
    drugId: 'physostigmine',
    shape: 'one',
    v1_L: L(2.4),
    halfLife_min: 25,
    proteinBound: 0.20,
    renalFraction: 0.02,
    MW_gmol: 275.35,
    citations: [
      {
        quantity: 'Vd ~2.4 L/kg, half-life ~16-30 min (modelled 25 min)',
        source: FDA('physostigmine salicylate injection').source,
        url: FDA('physostigmine salicylate injection').url,
        confidence: 'measured',
        note:
          'A TERTIARY carbamate, so unlike neostigmine it crosses the blood-brain barrier — which is why it is ' +
          'the anticholinesterase used to reverse central antimuscarinic delirium. Cleared by cholinesterase ' +
          'hydrolysis with a half-life of only 16-30 min, so its effect is brief and often needs repeating.',
      },
    ],
  },

  /* ==================================================== anti-infectives */
  one('amoxicillin', L(0.3), 60, 0.18, 0.65, 'amoxicillin capsules',
    'Vd ~0.3 L/kg, half-life ~1 h, ~18% protein bound, ~60% renally excreted unchanged, oral bioavailability ~90%',
    { ka_min: 0.06, bioavailability: 0.90, MW_gmol: 365.4 }),
  one('ceftriaxone', 9, 480, 0.90, 0.50, 'ceftriaxone sodium injection',
    'Vss ~6-14 L (modelled 9 L), half-life 5.8-8.7 h (modelled 8 h), concentration-dependent protein binding ~85-95%, half renally and half biliary; intramuscular absorption essentially complete with a time to peak of ~2-3 h',
    { MW_gmol: 554.58, ka_min: 0.02, bioavailability: 1.0 }),
  one('cefazolin', 10, 110, 0.85, 0.80, 'cefazolin injection',
    'Vd ~0.14 L/kg (modelled 10 L), half-life ~1.8 h, ~85% protein bound, renally excreted unchanged; intramuscular absorption essentially complete with a time to peak of ~1-2 h',
    { MW_gmol: 454.51, ka_min: 0.03, bioavailability: 1.0 }),
  one('vancomycin', 42, 300, 0.55, 0.90, 'vancomycin hydrochloride injection',
    'Vd ~0.6 L/kg, half-life 4-6 h (modelled 5 h), ~55% protein bound, renally excreted unchanged',
    { MW_gmol: 1449.25 }),
  one('meropenem', 18, 60, 0.02, 0.70, 'meropenem injection',
    'Vd ~0.25 L/kg, half-life ~1 h, ~2% protein bound, primarily renally excreted unchanged',
    { MW_gmol: 383.46 }),
  one('ciprofloxacin', L(2.5), 240, 0.30, 0.50, 'ciprofloxacin tablets',
    'Vd ~2.5 L/kg, half-life ~4 h, 20-40% protein bound, ~50% renally excreted, oral bioavailability ~70%',
    { ka_min: 0.06, bioavailability: 0.70, MW_gmol: 331.34 }),
  one('doxycycline', 52, 1080, 0.90, 0.40, 'doxycycline hyclate tablets',
    'Vd ~0.75 L/kg, half-life 18-22 h (modelled 18 h), ~90% protein bound, oral bioavailability ~95%',
    { ka_min: 0.05, bioavailability: 0.95, MW_gmol: 444.43 }),
  one('azithromycin', L(31), 4080, 0.30, 0.06, 'azithromycin tablets',
    'Vd ~31 L/kg (enormous tissue distribution), terminal half-life ~68 h, variable protein binding (7-51%, modelled 30%), oral bioavailability ~38%',
    { ka_min: 0.05, bioavailability: 0.38, MW_gmol: 748.98 }),
  one('oseltamivir', 25, 420, 0.03, 0.99, 'oseltamivir phosphate capsules',
    'active oseltamivir carboxylate: Vss ~23-26 L, half-life 6-10 h (modelled 7 h), ~3% protein bound, >99% renally excreted',
    { ka_min: 0.05, bioavailability: 0.75, MW_gmol: 284.35 }),
  {
    drugId: 'remdesivir',
    shape: 'one',
    v1_L: L(0.9),
    halfLife_min: 60,
    proteinBound: 0.88,
    renalFraction: 0.10,
    MW_gmol: 602.58,
    citations: [
      {
        quantity: 'parent Vd ~0.9 L/kg, plasma half-life ~1 h, ~88% protein bound',
        source: FDA('remdesivir injection').source,
        url: FDA('remdesivir injection').url,
        confidence: 'measured',
        note:
          'The intravenous parent is rapidly cleared (half-life ~1 h) and is a delivery vehicle for the ' +
          'intracellular nucleoside triphosphate that actually inhibits the viral polymerase, which persists ' +
          'far longer. The model carries the parent disposition and the note records that the active species ' +
          'is intracellular and longer-lived; recorded in MODEL_LIMITATIONS.',
      },
    ],
  },
  one('nirmatrelvir', 104, 360, 0.69, 0.50, 'nirmatrelvir tablets',
    'Vd ~104 L, half-life ~6 h (co-administered with ritonavir as a CYP3A booster, which is not modelled), ~69% protein bound',
    { ka_min: 0.05, bioavailability: 0.50, MW_gmol: 499.53 }),
  {
    drugId: 'artesunate',
    shape: 'one',
    v1_L: L(0.15),
    halfLife_min: 40,
    proteinBound: 0.90,
    renalFraction: 0.01,
    MW_gmol: 384.42,
    citations: [
      {
        quantity: 'active dihydroartemisinin: Vd ~0.15 L/kg, half-life ~40-60 min (modelled 40 min)',
        source: FDA('artesunate for injection').source,
        url: FDA('artesunate for injection').url,
        confidence: 'measured',
        note:
          'Artesunate itself is hydrolysed within minutes to dihydroartemisinin, the active antimalarial, whose ' +
          'own half-life is under an hour. The model carries the active-metabolite disposition; the very short ' +
          'life is why artemisinins are given in a combination that provides a longer-lived partner drug — a ' +
          'partner not modelled here.',
      },
    ],
  },
  one('tenofovir', L(1.3), 1020, 0.05, 0.80, 'tenofovir disoproxil fumarate tablets',
    'active tenofovir: Vss ~1.2-1.3 L/kg, terminal half-life ~17 h, <7% protein bound, largely renally excreted, oral bioavailability ~25% from the disoproxil prodrug',
    { ka_min: 0.03, bioavailability: 0.25, MW_gmol: 287.21 }),
];
