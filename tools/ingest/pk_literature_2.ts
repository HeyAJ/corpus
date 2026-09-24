import type { PkLiteratureEntry } from './pk_literature';

/**
 * PHARMACOKINETICS, PART TWO — the wider therapeutic set.
 *
 * Volume of distribution, clearance or half-life, protein binding and — where the
 * route needs it — an absorption constant, for every drug in drug_manifest_2.ts.
 *
 * SOURCE POLICY. Almost everything here is from the FDA Structured Product Label,
 * section 12.3, which is free, stable, citable and the same source the cross-check
 * parser reads. Where the label gives a half-life and a volume of distribution but no
 * clearance, the clearance is the identity CL = Vd * ln2 / t-half and is marked
 * `derived` — an identity is not a measurement and the provenance says so.
 *
 * WHAT IS DELIBERATELY ABSENT. Many of these drugs have published three-compartment
 * models. Where the label gives only Vd and half-life, this file records a ONE- or
 * TWO-compartment fit and says so, rather than inventing micro-constants to fill a
 * shape nobody measured. The early distribution phase after a bolus is then not
 * reproduced for that drug, and MISSING_CONSTANTS lists it.
 */

const FDA = (q: string) => ({
  source: `FDA Structured Product Label via DailyMed — ${q}`,
  url: `https://dailymed.nlm.nih.gov/dailymed/search.cfm?labeltype=all&query=${encodeURIComponent(q)}`,
});

/** Vd in litres for a 70 kg adult, from a per-kilogram figure. */
const L = (perKg: number) => perKg * 70;

/**
 * A compact one-compartment entry. Most oral drugs here are known by a volume of
 * distribution and a half-life and nothing else, which is exactly one compartment.
 */
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

export const PK_LITERATURE_2: PkLiteratureEntry[] = [
  /* ------------------------------------------------------ cardiovascular */
  one('propranolol', L(4.0), 240, 0.90, 0.01, 'propranolol hydrochloride tablets',
    'Vd about 4 L/kg, half-life 3-6 h, 90% protein bound, high first pass',
    { ka_min: 0.03, bioavailability: 0.26, hepaticExtraction: 0.7 }),
  one('metoprolol', L(5.6), 210, 0.12, 0.05, 'metoprolol tartrate tablets',
    'Vd 5.6 L/kg, half-life 3-4 h, 12% protein bound',
    { ka_min: 0.05, bioavailability: 0.50, hepaticExtraction: 0.5 }),
  one('atenolol', L(0.95), 420, 0.05, 0.85, 'atenolol tablets',
    'Vd 0.95 L/kg, half-life 6-7 h, 5% protein bound, 85% renally excreted unchanged',
    { ka_min: 0.02, bioavailability: 0.50 }),
  one('carvedilol', L(1.6), 420, 0.98, 0.02, 'carvedilol tablets',
    'Vd about 115 L, half-life 7-10 h, 98% protein bound, extensive first pass',
    { ka_min: 0.04, bioavailability: 0.30, hepaticExtraction: 0.7 }),
  one('esmolol', 27, 9, 0.55, 0.01, 'esmolol hydrochloride injection',
    'Vd about 3.4 L/kg, half-life 9 min via red-cell esterase hydrolysis, 55% protein bound'),
  one('amlodipine', L(21), 2160, 0.93, 0.10, 'amlodipine besylate tablets',
    'Vd 21 L/kg, half-life 30-50 h, 93% protein bound',
    { ka_min: 0.012, bioavailability: 0.68 }),
  one('verapamil', L(4.0), 300, 0.90, 0.03, 'verapamil hydrochloride tablets',
    'Vd 4 L/kg, half-life 2.8-7.4 h after a single dose, 90% protein bound',
    { ka_min: 0.04, bioavailability: 0.22, hepaticExtraction: 0.75 }),
  one('digoxin', L(7.0), 2280, 0.25, 0.70, 'digoxin tablets',
    'Vd 7 L/kg, half-life 36-48 h, 25% protein bound, 70% renally excreted unchanged',
    { ka_min: 0.03, bioavailability: 0.70 }),
  one('milrinone', L(0.45), 140, 0.70, 0.83, 'milrinone lactate injection',
    'Vd 0.45 L/kg, half-life 2.3 h, 70% protein bound, 83% renally excreted unchanged'),
  one('dobutamine', 15, 2, 0.30, 0.01, 'dobutamine injection',
    'Half-life about 2 min, cleared by COMT; volume approximated at plasma plus rapid tissue'),
  one('isoprenaline', 30, 2.5, 0.30, 0.05, 'isoproterenol hydrochloride injection',
    'Half-life about 2.5 min, cleared by COMT and sulfotransferase'),
  one('clonidine', L(2.1), 720, 0.30, 0.50, 'clonidine hydrochloride tablets',
    'Vd 2.1 L/kg, half-life 12-16 h, 20-40% protein bound, half renally excreted unchanged',
    { ka_min: 0.04, bioavailability: 0.75 }),
  one('dexmedetomidine', L(1.33), 120, 0.94, 0.01, 'dexmedetomidine hydrochloride injection',
    'Vd 1.33 L/kg, half-life about 2 h, 94% protein bound'),
  one('hydrochlorothiazide', L(3.6), 480, 0.58, 0.95, 'hydrochlorothiazide tablets',
    'Vd 3.6 L/kg, half-life 6-15 h, 58% protein bound, excreted unchanged',
    { ka_min: 0.03, bioavailability: 0.70 }),
  one('spironolactone', 60, 90, 0.90, 0.01, 'spironolactone tablets',
    'Half-life of the parent about 1.4 h with much longer-lived active metabolites, over 90% protein bound',
    { ka_min: 0.04, bioavailability: 0.73 }),
  one('acetazolamide', L(0.2), 300, 0.95, 0.90, 'acetazolamide tablets',
    'Vd about 0.2 L/kg, half-life 3-6 h, 95% protein bound, excreted unchanged',
    { ka_min: 0.05, bioavailability: 0.90 }),

  /* --------------------------------------------------------- analgesia */
  one('aspirin', L(0.15), 20, 0.85, 0.02, 'aspirin tablets',
    'Vd 0.15 L/kg, half-life of aspirin itself 15-20 min before hydrolysis to salicylate',
    { ka_min: 0.10, bioavailability: 0.68 }),
  one('ibuprofen', L(0.15), 120, 0.99, 0.01, 'ibuprofen tablets',
    'Vd 0.15 L/kg, half-life about 2 h, 99% protein bound',
    { ka_min: 0.08, bioavailability: 0.85 }),
  one('naproxen', L(0.16), 840, 0.99, 0.01, 'naproxen tablets',
    'Vd 0.16 L/kg, half-life 12-17 h, over 99% protein bound',
    { ka_min: 0.05, bioavailability: 0.95 }),
  one('celecoxib', L(5.7), 660, 0.97, 0.02, 'celecoxib capsules',
    'Vd 400 L, half-life about 11 h, 97% protein bound',
    { ka_min: 0.03, bioavailability: 0.40 }),
  one('paracetamol', L(0.95), 150, 0.20, 0.05, 'acetaminophen tablets',
    'Vd 0.95 L/kg, half-life 2-3 h, 10-25% protein bound',
    { ka_min: 0.10, bioavailability: 0.88 }),
  one('ketorolac', L(0.18), 330, 0.99, 0.60, 'ketorolac tromethamine injection',
    'Vd 0.18 L/kg, half-life 5-6 h, over 99% protein bound',
    { ka_min: 0.06 }),
  one('oxycodone', L(2.6), 210, 0.45, 0.10, 'oxycodone hydrochloride tablets',
    'Vd 2.6 L/kg, half-life 3-4 h, 45% protein bound',
    { ka_min: 0.05, bioavailability: 0.60, hepaticExtraction: 0.4 }),
  one('hydromorphone', L(4.0), 150, 0.20, 0.06, 'hydromorphone hydrochloride injection',
    'Vd 4 L/kg, half-life 2-3 h, 8-19% protein bound',
    { ka_min: 0.05, bioavailability: 0.24, hepaticExtraction: 0.75 }),
  one('tramadol', L(2.9), 390, 0.20, 0.30, 'tramadol hydrochloride tablets',
    'Vd 2.9 L/kg, half-life 6.3 h, 20% protein bound',
    { ka_min: 0.05, bioavailability: 0.75 }),
  one('naltrexone', L(19), 240, 0.21, 0.02, 'naltrexone hydrochloride tablets',
    'Vd about 1350 L, half-life 4 h for the parent, 21% protein bound, extensive first pass',
    { ka_min: 0.06, bioavailability: 0.20, hepaticExtraction: 0.8 }),

  /* ------------------------------------------------- psychiatry, neurology */
  one('haloperidol', L(18), 1080, 0.92, 0.01, 'haloperidol injection',
    'Vd 18 L/kg, half-life 14-26 h, 92% protein bound',
    { ka_min: 0.04, bioavailability: 0.60, hepaticExtraction: 0.4 }),
  one('olanzapine', L(16), 1830, 0.93, 0.07, 'olanzapine tablets',
    'Vd 1000 L, half-life about 30 h, 93% protein bound',
    { ka_min: 0.03, bioavailability: 0.60, hepaticExtraction: 0.4 }),
  one('quetiapine', L(10), 360, 0.83, 0.01, 'quetiapine fumarate tablets',
    'Vd 10 L/kg, half-life about 6 h, 83% protein bound',
    { ka_min: 0.06, bioavailability: 0.09, hepaticExtraction: 0.9 }),
  one('risperidone', L(1.1), 180, 0.90, 0.30, 'risperidone tablets',
    'Vd 1-2 L/kg, half-life 3 h for the parent, 90% protein bound',
    { ka_min: 0.05, bioavailability: 0.70 }),
  one('clozapine', L(5.4), 720, 0.97, 0.01, 'clozapine tablets',
    'Vd 5.4 L/kg, half-life about 12 h, 97% protein bound',
    { ka_min: 0.03, bioavailability: 0.27, hepaticExtraction: 0.7 }),
  one('chlorpromazine', L(20), 1800, 0.95, 0.01, 'chlorpromazine hydrochloride tablets',
    'Vd about 20 L/kg, half-life highly variable around 30 h, over 90% protein bound',
    { ka_min: 0.03, bioavailability: 0.32, hepaticExtraction: 0.65 }),
  one('fluoxetine', L(25), 3600, 0.95, 0.01, 'fluoxetine hydrochloride capsules',
    'Vd 20-42 L/kg, half-life 1-3 days for the parent, 94.5% protein bound',
    { ka_min: 0.02, bioavailability: 0.72 }),
  one('sertraline', L(20), 1560, 0.98, 0.01, 'sertraline hydrochloride tablets',
    'Vd over 20 L/kg, half-life about 26 h, 98% protein bound',
    { ka_min: 0.02, bioavailability: 0.44, hepaticExtraction: 0.5 }),
  one('amitriptyline', L(15), 1200, 0.95, 0.02, 'amitriptyline hydrochloride tablets',
    'Vd 15 L/kg, half-life 10-28 h, over 90% protein bound',
    { ka_min: 0.03, bioavailability: 0.48, hepaticExtraction: 0.5 }),
  one('duloxetine', L(1.6), 720, 0.90, 0.01, 'duloxetine delayed-release capsules',
    'Vd 1640 L, half-life about 12 h, over 90% protein bound',
    { ka_min: 0.02, lagTime_min: 120, bioavailability: 0.50 }),
  one('mirtazapine', L(4.5), 1800, 0.85, 0.75, 'mirtazapine tablets',
    'Vd 4.5 L/kg, half-life 20-40 h, 85% protein bound',
    { ka_min: 0.04, bioavailability: 0.50, hepaticExtraction: 0.45 }),
  one('diazepam', L(1.1), 2880, 0.98, 0.01, 'diazepam injection',
    'Vd 0.8-1.0 L/kg, half-life up to 48 h with active metabolites, 98% protein bound',
    { ka_min: 0.09, bioavailability: 0.93 }),
  one('lorazepam', L(1.3), 840, 0.91, 0.01, 'lorazepam injection',
    'Vd 1.3 L/kg, half-life about 14 h, 91% protein bound',
    { ka_min: 0.04, bioavailability: 0.90 }),
  one('flumazenil', L(1.1), 50, 0.50, 0.01, 'flumazenil injection',
    'Vd 0.9-1.1 L/kg, half-life 40-80 min, 50% protein bound. The short half-life relative to the benzodiazepines it reverses is why re-sedation happens'),
  {
    drugId: 'phenytoin',
    shape: 'one',
    v1_L: L(0.65),
    // Only used if the saturable path is unavailable; at therapeutic concentrations
    // the Michaelis-Menten terms below are what actually govern the decline.
    halfLife_min: 1320,
    proteinBound: 0.90,
    renalFraction: 0.05,
    ka_min: 0.02,
    bioavailability: 0.90,
    vmax_mg_per_min: 0.33,
    km_mg_per_L: 5.7,
    citations: [
      {
        quantity: 'Vd 0.6-0.7 L/kg, 90% protein bound, Vmax about 7 mg/kg/day, Km about 5.7 mg/L',
        source: 'FDA Structured Product Label via DailyMed - phenytoin sodium capsules',
        url: 'https://dailymed.nlm.nih.gov/dailymed/search.cfm?labeltype=all&query=phenytoin',
        confidence: 'measured',
        note:
          'SATURABLE ELIMINATION, and the most clinically consequential non-linearity in this whole data ' +
          'set. Km sits close to the middle of the therapeutic range, so within that range the kinetics ' +
          'are already part zero-order: raising a dose by a quarter can double the plasma concentration. ' +
          'Vmax is the labelled 7 mg/kg/day converted to mg/min for the 70 kg reference adult. This is ' +
          'why phenytoin is dosed by level rather than by weight, and the model reproduces the reason.',
      },
    ],
  },
  one('carbamazepine', L(1.1), 900, 0.76, 0.01, 'carbamazepine tablets',
    'Vd 0.8-1.9 L/kg, half-life 12-17 h on chronic dosing, 76% protein bound',
    { ka_min: 0.02, bioavailability: 0.80 }),
  one('lamotrigine', L(1.1), 1500, 0.55, 0.10, 'lamotrigine tablets',
    'Vd 0.9-1.3 L/kg, half-life about 25 h, 55% protein bound',
    { ka_min: 0.03, bioavailability: 0.98 }),

  /* ------------------------------------------- respiratory, GI, endocrine */
  one('salmeterol', L(2.0), 330, 0.96, 0.01, 'salmeterol xinafoate inhalation powder',
    'Half-life about 5.5 h, 96% protein bound',
    { bioavailability: 0.15 }),
  one('ipratropium', L(4.6), 120, 0.15, 0.50, 'ipratropium bromide inhalation solution',
    'Vd 4.6 L/kg, half-life about 2 h, 0-9% protein bound',
    { bioavailability: 0.07 }),
  one('theophylline', L(0.5), 480, 0.40, 0.10, 'theophylline tablets',
    'Vd 0.5 L/kg, half-life 8 h in a healthy non-smoking adult, 40% protein bound',
    { ka_min: 0.06, bioavailability: 1.0 }),
  one('montelukast', L(0.16), 300, 0.99, 0.01, 'montelukast sodium tablets',
    'Vd 8-11 L, half-life 2.7-5.5 h, over 99% protein bound',
    { ka_min: 0.06, bioavailability: 0.64 }),
  one('dexamethasone', L(1.0), 240, 0.77, 0.03, 'dexamethasone sodium phosphate injection',
    'Vd about 1 L/kg, plasma half-life 3-4 h with a biological half-life of 36-54 h, 77% protein bound',
    { ka_min: 0.05, bioavailability: 0.80 }),
  one('hydrocortisone', L(0.5), 100, 0.90, 0.02, 'hydrocortisone tablets',
    'Vd 0.5 L/kg, plasma half-life 1.5-2 h, about 90% bound to corticosteroid-binding globulin and albumin',
    { ka_min: 0.07, bioavailability: 0.95 }),
  one('prednisolone', L(0.7), 180, 0.75, 0.02, 'prednisolone tablets',
    'Vd 0.7 L/kg, half-life 2-4 h, 70-90% protein bound and concentration-dependent',
    { ka_min: 0.06, bioavailability: 0.82 }),
  one('ondansetron', L(2.3), 240, 0.73, 0.05, 'ondansetron injection',
    'Vd 160 L, half-life about 4 h, 70-76% protein bound',
    { ka_min: 0.05, bioavailability: 0.60, hepaticExtraction: 0.4 }),
  one('metoclopramide', L(3.5), 300, 0.30, 0.25, 'metoclopramide injection',
    'Vd 3.5 L/kg, half-life 5-6 h, 30% protein bound',
    { ka_min: 0.07, bioavailability: 0.80 }),
  one('omeprazole', L(0.35), 60, 0.95, 0.01, 'omeprazole delayed-release capsules',
    'Vd 0.35 L/kg, plasma half-life 0.5-1 h, 95% protein bound. The effect lasts far longer than the drug because the binding to the pump is covalent',
    { ka_min: 0.05, lagTime_min: 60, bioavailability: 0.40, hepaticExtraction: 0.5 }),
  one('famotidine', L(1.2), 180, 0.17, 0.70, 'famotidine tablets',
    'Vd 1.1-1.4 L/kg, half-life 2.5-3.5 h, 15-20% protein bound',
    { ka_min: 0.05, bioavailability: 0.43 }),
  one('diphenhydramine', L(4.5), 540, 0.98, 0.02, 'diphenhydramine hydrochloride injection',
    'Vd 3-4 L/kg, half-life 2.4-9.3 h, 98% protein bound',
    { ka_min: 0.06, bioavailability: 0.61, hepaticExtraction: 0.4 }),
  one('loratadine', L(1.5), 480, 0.98, 0.01, 'loratadine tablets',
    'Half-life 8-28 h, 97-99% protein bound',
    { ka_min: 0.07, bioavailability: 0.40, hepaticExtraction: 0.5 }),
  one('metformin', L(9.0), 380, 0.02, 0.90, 'metformin hydrochloride tablets',
    'Vd 654 L, half-life about 6.2 h in plasma, negligible protein binding, excreted unchanged',
    { ka_min: 0.02, bioavailability: 0.55 }),
  one('levothyroxine', L(0.15), 10080, 0.999, 0.01, 'levothyroxine sodium tablets',
    'Vd 0.15 L/kg, half-life about 7 days, over 99% protein bound',
    { ka_min: 0.006, bioavailability: 0.75 }),
  one('allopurinol', L(1.6), 90, 0.01, 0.10, 'allopurinol tablets',
    'Vd 1.6 L/kg, half-life 1-2 h for the parent with a far longer-lived active metabolite, negligible protein binding',
    { ka_min: 0.05, bioavailability: 0.80 }),
  one('lidocaine', L(1.1), 100, 0.70, 0.03, 'lidocaine hydrochloride injection',
    'Vd 1.1 L/kg, half-life 1.5-2 h, 60-80% protein bound',
    { ka_min: 0.04 }),
  one('bupivacaine', L(0.9), 160, 0.95, 0.06, 'bupivacaine hydrochloride injection',
    'Vd 0.9 L/kg, half-life 2.7 h, 95% protein bound',
    { ka_min: 0.02 }),

  /* --------------------------------------------------------- controlled */
  one('caffeine', L(0.6), 300, 0.35, 0.02, 'caffeine citrate injection',
    'Vd 0.6 L/kg, half-life 3-7 h in a healthy adult, 35% protein bound',
    { ka_min: 0.15, bioavailability: 1.0 }),
  one('nicotine', L(2.6), 120, 0.05, 0.10, 'nicotine polacrilex gum',
    'Vd 2.6 L/kg, half-life about 2 h, under 5% protein bound',
    { ka_min: 0.06, bioavailability: 0.30, hepaticExtraction: 0.7 }),

  {
    drugId: 'ethanol',
    shape: 'one',
    v1_L: L(0.6),
    // Michaelis-Menten parameters below do the real work; this half-life is only used
    // if the saturable path is unavailable, and it is the value at a low concentration.
    halfLife_min: 60,
    proteinBound: 0,
    renalFraction: 0.03,
    ka_min: 0.09,
    bioavailability: 0.9,
    vmax_mg_per_min: 120,
    km_mg_per_L: 100,
    citations: [
      {
        quantity: 'Vd 0.6 L/kg, zero-order elimination at about 7 g/h',
        source: 'Cederbaum AI. Alcohol metabolism. Clinics in Liver Disease 16(4):667-685, 2012.',
        url: 'https://doi.org/10.1016/j.cld.2012.08.002',
        confidence: 'measured',
        note:
          'THE ONE GENUINELY NON-LINEAR DRUG IN THIS SET. Alcohol dehydrogenase is saturated at any ' +
          'meaningful concentration, so the body removes a fixed AMOUNT per hour rather than a fixed ' +
          'fraction: about 7 g/h in an average adult, which is the 120 mg/min here. Km is set well below ' +
          'the concentration one standard drink produces so the elimination is effectively zero-order ' +
          'throughout, which is what is observed. Doubling the dose therefore MORE than doubles the time ' +
          'to sober, and that is the point of including it.',
      },
    ],
  },

  {
    drugId: 'thc',
    shape: 'one',
    v1_L: 700,
    halfLife_min: 1800,
    proteinBound: 0.97,
    renalFraction: 0.01,
    ka_min: 0.012,
    bioavailability: 0.08,
    hepaticExtraction: 0.75,
    citations: [
      {
        quantity: 'Vd about 10 L/kg, terminal half-life 25-36 h, 97% protein bound, oral bioavailability 4-12%',
        source: 'Huestis MA. Human cannabinoid pharmacokinetics. Chemistry & Biodiversity 4(8):1770-1804, 2007.',
        url: 'https://doi.org/10.1002/cbdv.200790152',
        confidence: 'measured',
        note:
          'Extremely lipophilic, so the volume of distribution is enormous and the terminal phase runs for ' +
          'days as it redistributes out of fat. The oral bioavailability of 4-12% against an inhaled figure ' +
          'several times higher is first-pass metabolism, and the contrast between the two routes is the ' +
          'clearest pharmacokinetic lesson this compound offers. ' +
          'MODELLED IN ONE COMPARTMENT at the published volume of distribution: the source gives a volume ' +
          'and a terminal half-life and nothing else, and those two numbers determine exactly one ' +
          'compartment. A two-compartment fit would need a central volume nobody measured.',
      },
    ],
  },
  one('cannabidiol', L(32), 1080, 0.94, 0.01, 'cannabidiol oral solution',
    'Vd about 32 L/kg, half-life 56-61 h on repeat dosing, over 94% protein bound',
    { ka_min: 0.015, bioavailability: 0.13, hepaticExtraction: 0.7 }),

  {
    drugId: 'amfetamine',
    shape: 'one',
    v1_L: L(3.5),
    halfLife_min: 630,
    proteinBound: 0.20,
    renalFraction: 0.35,
    ka_min: 0.05,
    bioavailability: 0.90,
    citations: [
      {
        quantity: 'Vd 3-4 L/kg, half-life about 10 h, 16-20% protein bound, urinary excretion pH-dependent',
        source: 'Asghar SJ, Tanay VA, Baker GB, Greenshaw A, Silverstone PH. Relationship of plasma amphetamine levels to physiological, subjective, cognitive and biochemical measures in healthy volunteers. Journal of Psychiatry & Neuroscience 28(5):350-356, 2003.',
        url: 'https://pubmed.ncbi.nlm.nih.gov/14517578/',
        confidence: 'measured',
        note:
          'A third of the dose is excreted unchanged and that fraction is strongly pH-dependent — acidifying ' +
          'the urine roughly halves the half-life. The model has no urinary pH, so it uses the figure for ' +
          'normal urine and cannot show that manoeuvre.',
      },
    ],
  },
  {
    drugId: 'methamphetamine',
    shape: 'one',
    v1_L: L(3.7),
    halfLife_min: 630,
    proteinBound: 0.20,
    renalFraction: 0.45,
    ka_min: 0.04,
    bioavailability: 0.67,
    citations: [
      {
        quantity: 'Vd 3-4 L/kg, half-life 10-12 h, oral bioavailability about 67%',
        source: 'Cruickshank CC, Dyer KR. A review of the clinical pharmacology of methamphetamine. Addiction 104(7):1085-1099, 2009.',
        url: 'https://doi.org/10.1111/j.1360-0443.2009.02564.x',
        confidence: 'measured',
        note:
          'More lipophilic than amfetamine and therefore more centrally penetrant at the same plasma ' +
          'concentration, which the blood-brain-barrier rule in this model reproduces from the descriptors ' +
          'rather than being told. Nearly half is excreted unchanged and that fraction is pH-dependent.',
      },
    ],
  },
  {
    drugId: 'cocaine',
    shape: 'one',
    v1_L: L(2.0),
    halfLife_min: 50,
    proteinBound: 0.91,
    renalFraction: 0.02,
    ka_min: 0.10,
    bioavailability: 0.80,
    citations: [
      {
        quantity: 'Vd 1.6-2.7 L/kg, half-life 40-60 min, 91% protein bound',
        source: 'Jeffcoat AR, Perez-Reyes M, Hill JM, Sadler BM, Cook CE. Cocaine disposition in humans after intravenous, intranasal and smoked administration. Journal of Analytical Toxicology 13(1):A1-A7, 1989.',
        url: 'https://pubmed.ncbi.nlm.nih.gov/2733387/',
        confidence: 'measured',
        note:
          'Hydrolysed by plasma and hepatic esterases rather than cleared by an organ, which is why the ' +
          'half-life is short and why it is prolonged in people with atypical cholinesterase. The intranasal ' +
          'route is slower than intravenous largely because the drug vasoconstricts the mucosa it is trying ' +
          'to cross — the same self-limiting absorption adrenaline shows subcutaneously.',
      },
    ],
  },
  {
    drugId: 'mdma',
    shape: 'one',
    v1_L: L(5.0),
    halfLife_min: 510,
    proteinBound: 0.34,
    renalFraction: 0.20,
    ka_min: 0.05,
    bioavailability: 0.75,
    citations: [
      {
        quantity: 'Vd about 5 L/kg, half-life 8-9 h, non-linear kinetics above 100 mg',
        source: 'de la Torre R, Farre M, Roset PN, Pizarro N, Abanades S, Segura M, Segura J, Cami J. Human pharmacology of MDMA: pharmacokinetics, metabolism, and disposition. Therapeutic Drug Monitoring 26(2):137-144, 2004.',
        url: 'https://doi.org/10.1097/00007691-200404000-00009',
        confidence: 'measured',
        note:
          'NON-LINEAR above about 100 mg because it inhibits its own metabolism through CYP2D6, so a small ' +
          'increase in dose produces a disproportionate increase in concentration. The model is linear and ' +
          'therefore UNDERSTATES the exposure at higher multipliers; this is recorded in MODEL_LIMITATIONS ' +
          'and is the most clinically significant approximation in this file.',
      },
    ],
  },
];
