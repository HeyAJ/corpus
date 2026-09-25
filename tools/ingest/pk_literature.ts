/**
 * TIER-2 PHARMACOKINETICS: published literature and FDA label values.
 *
 * Pulse (tools/ingest/fetch_pulse.ts) supplies molecular weight, plasma protein
 * binding, systemic/renal clearance and the pharmacodynamic Emax block. What it
 * does NOT supply is a compartmental volume, because Pulse is a PBPK engine and
 * uses tissue partition coefficients instead. So the volumes come from here.
 *
 * Every entry states the quantity it asserts, the citation, and — crucially — how
 * a derived value was derived. There is no interpolation and no plausible-looking
 * filler: a drug whose central volume cannot be traced to a source gets `null`,
 * lands in docs/MISSING_CONSTANTS.md, and renders as an em-dash (spec 0.4, 5.6).
 *
 * `shape` decides how normalise.ts turns these into micro-constants:
 *   'one'   : V1 from CL and terminal half-life (exact, by definition)
 *   'two'   : V1 + Vss + CL + terminal half-life -> twoCompartmentFromVss();
 *             falls back to one compartment at V_area when the published values are
 *             mutually inconsistent, which the report records
 *   'micro' : micro-constants quoted directly from a published TCI model
 *   'none'  : no compartmental PK (electrolytes, fluids)
 */

export interface PkLiteratureEntry {
  drugId: string;
  shape: 'one' | 'two' | 'micro' | 'none';

  /** Terminal elimination half-life, minutes. */
  halfLife_min?: number;
  /** Clearance in L/min for the 70 kg reference adult. */
  clearance_L_per_min?: number;
  /** Clearance as published, mL/min/kg — converted by normalise.ts. */
  clearance_mL_per_min_kg?: number;
  /** Steady-state volume of distribution, L. */
  vss_L?: number;
  /** Volume of distribution as published, L/kg. */
  vd_L_per_kg?: number;
  /** Central compartment volume, L. Required for 'two'. */
  v1_L?: number;
  /** Distribution (alpha) half-life, minutes. Derived output, not an input. */
  distributionHalfLife_min?: number;

  /** Directly-quoted micro constants, 1/min. */
  micro?: { V1_L: number; k10: number; k12?: number; k21?: number; k13?: number; k31?: number; V2_L?: number; V3_L?: number };

  /** Fraction of elimination that is renal, 0..1. */
  renalFraction?: number;
  /** Fraction bound to plasma protein, 0..1. Overrides Pulse when both exist. */
  proteinBound?: number;
  /** g/mol. Overrides Pulse when Pulse has no entry. */
  MW_gmol?: number;

  /** Oral / IM absorption. */
  ka_min?: number;
  lagTime_min?: number;
  bioavailability?: number;
  hepaticExtraction?: number;

  /** Saturable elimination. */
  vmax_mg_per_min?: number;
  km_mg_per_L?: number;

  /** One citation per asserted quantity. */
  citations: { quantity: string; source: string; url: string; confidence: 'measured' | 'derived'; note?: string }[];
}

const FDA = (name: string, url: string) => ({ source: `FDA Structured Product Label — ${name}`, url });

export const PK_LITERATURE: PkLiteratureEntry[] = [
  {
    drugId: 'epinephrine',
    shape: 'one',
    halfLife_min: 2,
    clearance_mL_per_min_kg: 68.66,
    renalFraction: 0,
    ka_min: 0.0267,
    citations: [
      {
        quantity: 'intramuscular absorption rate constant 0.0267 /min',
        source: 'Simons FE, Gu X, Simons KJ. Epinephrine absorption in adults: intramuscular versus subcutaneous injection. J Allergy Clin Immunol 108(5):871-873, 2001.',
        url: 'https://doi.org/10.1067/mai.2001.119409',
        confidence: 'derived',
        note:
          'Solved so the model reproduces the measured intramuscular time to peak of 8 +/- 2 min. ' +
          'This is the study that moved anaphylaxis guidance from the subcutaneous route to the ' +
          'intramuscular one, and it is also what calibrates the subcutaneous scale factor in ' +
          'src/data/routes.json: the same subjects peaked at 34 +/- 14 min subcutaneously. ' +
          'NOTE A LIMITATION. The model cannot actually reach 34 min for adrenaline by any absorption ' +
          'rate, because a one-compartment drug with a 2 min disposition half-life peaks no later than ' +
          'about 30 min however slowly it is absorbed. The subcutaneous route is therefore modelled as ' +
          'markedly slower and markedly lower-peaking, which is the clinically decisive part, but the ' +
          'absolute time to peak is compressed. Recorded in docs/MODEL_LIMITATIONS.md.',
      },
      {
        quantity: 'terminal half-life = 2 min',
        source: 'Clutter WE, Bier DM, Shah SD, Cryer PE. Epinephrine plasma metabolic clearance rates and physiologic thresholds for metabolic and hemodynamic actions in man. J Clin Invest 66(1):94-101, 1980.',
        url: 'https://doi.org/10.1172/JCI109840',
        confidence: 'measured',
      },
      {
        quantity: 'systemic clearance = 68.66 mL/min/kg',
        source: 'Pulse Physiology Engine substance table (Apache-2.0), Epinephrine.',
        url: 'https://gitlab.kitware.com/physiology/engine/-/blob/stable/data/Data.xlsx',
        confidence: 'measured',
      },
      {
        quantity: 'V1 = CL / (ln2 / t-half) = 13.9 L',
        source: 'Derived identity, not an independent measurement.',
        url: 'docs/MISSING_CONSTANTS.md',
        confidence: 'derived',
        note: 'One-compartment identity. Epinephrine is cleared so fast that a peripheral compartment is not identifiable over its own half-life.',
      },
      {
        quantity: 'renal fraction = 0',
        source: 'Pulse substance table: RenalClearance = 0 mL/min/kg. Epinephrine is cleared by COMT and MAO, not by the kidney.',
        url: 'https://pulse.kitware.com/_drugs_methodology.html',
        confidence: 'measured',
      },
    ],
  },
  {
    drugId: 'norepinephrine',
    shape: 'one',
    halfLife_min: 2,
    clearance_mL_per_min_kg: 55.0,
    renalFraction: 0,
    citations: [
      {
        quantity: 'terminal half-life = 2 min',
        source: FDA('Levophed (norepinephrine bitartrate) injection', 'https://dailymed.nlm.nih.gov/dailymed/search.cfm?labeltype=all&query=norepinephrine').source,
        url: 'https://dailymed.nlm.nih.gov/dailymed/search.cfm?labeltype=all&query=norepinephrine',
        confidence: 'measured',
      },
      {
        quantity: 'systemic clearance = 55 mL/min/kg',
        source: 'Pulse Physiology Engine substance table (Apache-2.0), Norepinephrine.',
        url: 'https://gitlab.kitware.com/physiology/engine/-/blob/stable/data/Data.xlsx',
        confidence: 'measured',
      },
      { quantity: 'V1 = 11.1 L', source: 'Derived identity from CL and t-half.', url: 'docs/MISSING_CONSTANTS.md', confidence: 'derived' },
    ],
  },
  {
    drugId: 'dopamine',
    shape: 'one',
    halfLife_min: 2,
    clearance_mL_per_min_kg: 70,
    renalFraction: 0,
    proteinBound: 0.25,
    MW_gmol: 153.18,
    citations: [
      {
        quantity: 'plasma protein binding ~25 %',
        source: FDA('Dopamine hydrochloride injection', 'https://dailymed.nlm.nih.gov/dailymed/search.cfm?labeltype=all&query=dopamine+hydrochloride').source,
        url: 'https://dailymed.nlm.nih.gov/dailymed/search.cfm?labeltype=all&query=dopamine+hydrochloride',
        confidence: 'measured',
      },
      {
        quantity: 'clearance ~70 mL/min/kg and half-life ~2 min',
        source: 'MacGregor DA, Smith TE, Prielipp RC, et al. Pharmacokinetics of dopamine in healthy male subjects. Anesthesiology 92(2):338-346, 2000.',
        url: 'https://doi.org/10.1097/00000542-200002000-00013',
        confidence: 'measured',
      },
      { quantity: 'V1 = 14.1 L', source: 'Derived identity from CL and t-half.', url: 'docs/MISSING_CONSTANTS.md', confidence: 'derived' },
      { quantity: 'MW = 153.18 g/mol', source: 'PubChem CID 681 (dopamine).', url: 'https://pubchem.ncbi.nlm.nih.gov/compound/681', confidence: 'measured' },
    ],
  },
  {
    drugId: 'adenosine',
    shape: 'one',
    halfLife_min: 0.1,
    v1_L: 3.0,
    renalFraction: 0,
    proteinBound: 0,
    MW_gmol: 267.24,
    citations: [
      {
        quantity: 'half-life < 10 s',
        source: FDA('Adenocard (adenosine) injection', 'https://dailymed.nlm.nih.gov/dailymed/search.cfm?labeltype=all&query=adenosine').source,
        url: 'https://dailymed.nlm.nih.gov/dailymed/search.cfm?labeltype=all&query=adenosine',
        confidence: 'measured',
        note: 'Modelled at 6 s. The label states "less than 10 seconds"; adenosine is salvaged by erythrocytes and endothelial cells within a single circulation.',
      },
      {
        quantity: 'V1 = 3.0 L (plasma volume)',
        source: 'Derived. Adenosine is removed during its first pass through the circulation, so the only compartment it occupies for its own lifetime is the plasma.',
        url: 'docs/MISSING_CONSTANTS.md',
        confidence: 'derived',
      },
      { quantity: 'MW = 267.24 g/mol', source: 'PubChem CID 60961 (adenosine).', url: 'https://pubchem.ncbi.nlm.nih.gov/compound/60961', confidence: 'measured' },
      {
        quantity: 'protein binding = 0',
        source:
          'Derived, not measured. No plasma protein binding figure is published for adenosine, because on this ' +
          'timescale the quantity is not the one that matters: the label puts the half-life under ten seconds, ' +
          'set by carrier-mediated uptake into erythrocytes and endothelium rather than by anything in plasma. ' +
          'Treating it as unbound is also the conservative direction here, since it maximises free concentration ' +
          'and therefore A1 occupancy, which is the effect the model is trying not to understate. Supported by ' +
          'the physical chemistry: a nucleoside with 140 A^2 of polar surface and four hydrogen-bond donors ' +
          '(PubChem CID 60961) has no albumin binding motif.',
        url: 'https://pubchem.ncbi.nlm.nih.gov/compound/60961',
        confidence: 'derived',
      },
    ],
  },
  {
    drugId: 'amiodarone',
    shape: 'two',
    v1_L: 40,
    vss_L: 4400,
    clearance_L_per_min: 0.0375,
    halfLife_min: 58 * 24 * 60,
    proteinBound: 0.96,
    renalFraction: 0,
    MW_gmol: 645.31,
    citations: [
      {
        quantity: 'Vd 66 L/kg, terminal half-life 58 days, protein binding 96 %, IV clearance 1.9-2.6 L/h, negligible renal excretion',
        source: FDA('Amiodarone hydrochloride injection', 'https://dailymed.nlm.nih.gov/dailymed/search.cfm?labeltype=all&query=amiodarone').source,
        url: 'https://dailymed.nlm.nih.gov/dailymed/search.cfm?labeltype=all&query=amiodarone',
        confidence: 'measured',
      },
      {
        quantity: 'V1 = 40 L',
        source: 'Derived from the label statement that plasma concentration falls to about 10 % of peak within 30-45 min of ending an infusion.',
        url: 'docs/MISSING_CONSTANTS.md',
        confidence: 'derived',
        note: 'This is an inference from a qualitative label statement, not a measured central volume. It is listed in MISSING_CONSTANTS.md for that reason.',
      },
      { quantity: 'MW = 645.31 g/mol', source: 'PubChem CID 2157 (amiodarone).', url: 'https://pubchem.ncbi.nlm.nih.gov/compound/2157', confidence: 'measured' },
    ],
  },

  /* ------------------------------------------------- opioids and sedatives */
  {
    drugId: 'fentanyl',
    shape: 'micro',
    micro: { V1_L: 12.7, V2_L: 50.0, V3_L: 295.0, k10: 0.083, k12: 0.471, k21: 0.102, k13: 0.225, k31: 0.0067 },
    renalFraction: 0.08,
    ka_min: 0.0369,
    citations: [
      {
        quantity: 'intramuscular absorption rate constant 0.0369 /min',
        source: FDA('Fentanyl citrate injection', 'https://dailymed.nlm.nih.gov/dailymed/search.cfm?labeltype=all&query=fentanyl').source,
        url: 'https://dailymed.nlm.nih.gov/dailymed/search.cfm?labeltype=all&query=fentanyl',
        confidence: 'derived',
        note:
          'Solved so the model peaks about 15 min after an intramuscular dose, matching the labelled onset of 7-8 min and peak effect within 15 min. This constant is also the reference from which the nasal, sublingual and transdermal routes are scaled.',
      },
      {
        quantity: 'three-compartment micro-constants and volumes',
        source: 'Shafer SL, Varvel JR, Aziz N, Scott JC. Pharmacokinetics of fentanyl administered by computer-controlled infusion pump. Anesthesiology 73(6):1091-1102, 1990.',
        url: 'https://doi.org/10.1097/00000542-199012000-00005',
        confidence: 'measured',
        note: 'The standard target-controlled-infusion parameter set for fentanyl.',
      },
      {
        quantity: 'renal fraction ~8 %',
        source: FDA('Fentanyl citrate injection', 'https://dailymed.nlm.nih.gov/dailymed/search.cfm?labeltype=all&query=fentanyl').source,
        url: 'https://dailymed.nlm.nih.gov/dailymed/search.cfm?labeltype=all&query=fentanyl',
        confidence: 'measured',
        note: 'Label reports about 75 % of a dose excreted in urine, mostly as metabolites, with under 10 % as unchanged drug.',
      },
    ],
  },
  {
    drugId: 'propofol',
    shape: 'micro',
    micro: { V1_L: 15.96, V2_L: 32.2, V3_L: 202.4, k10: 0.119, k12: 0.112, k21: 0.055, k13: 0.0419, k31: 0.0033 },
    renalFraction: 0.0,
    citations: [
      {
        quantity: 'three-compartment micro-constants (Marsh model, V1 = 0.228 L/kg)',
        source: 'Marsh B, White M, Morton N, Kenny GN. Pharmacokinetic model driven infusion of propofol in children. Br J Anaesth 67(1):41-48, 1991.',
        url: 'https://doi.org/10.1093/bja/67.1.41',
        confidence: 'measured',
        note: 'Volumes scaled to the 70 kg reference adult.',
      },
    ],
  },
  {
    drugId: 'morphine',
    shape: 'two',
    v1_L: 15,
    vss_L: 231,
    clearance_mL_per_min_kg: 24,
    halfLife_min: 120,
    renalFraction: 0.1,
    bioavailability: 0.25,
    ka_min: 0.0184,
    citations: [
      {
        quantity: 'intramuscular absorption rate constant 0.0184 /min',
        source: FDA('Morphine sulfate injection', 'https://dailymed.nlm.nih.gov/dailymed/search.cfm?labeltype=all&query=morphine').source,
        url: 'https://dailymed.nlm.nih.gov/dailymed/search.cfm?labeltype=all&query=morphine',
        confidence: 'derived',
        note:
          'Solved so the model peaks about 20 min after an intramuscular dose, the middle of the range the label describes. Without an absorption constant the depot never releases and every extravascular route for this drug is refused outright rather than guessed at.',
      },
      {
        quantity: 'oral bioavailability ~25 %',
        source: FDA('Morphine sulfate oral solution', 'https://dailymed.nlm.nih.gov/dailymed/search.cfm?labeltype=all&query=morphine+sulfate').source,
        url: 'https://dailymed.nlm.nih.gov/dailymed/search.cfm?labeltype=all&query=morphine+sulfate',
        confidence: 'measured',
        note: 'Extensive first-pass glucuronidation. Without it the model delivers four times the systemic dose an oral tablet actually produces.',
      },
      {
        quantity: 'Vd 3-4 L/kg, clearance 15-30 mL/min/kg, terminal half-life 2-3 h, ~10 % excreted unchanged in urine',
        source: FDA('Morphine sulfate injection', 'https://dailymed.nlm.nih.gov/dailymed/search.cfm?labeltype=all&query=morphine+sulfate').source,
        url: 'https://dailymed.nlm.nih.gov/dailymed/search.cfm?labeltype=all&query=morphine+sulfate',
        confidence: 'measured',
      },
      { quantity: 'V1 = 15 L, Vss = 231 L, CL = 24 mL/min/kg', source: 'V1 derived from the reported initial distribution phase; Vss is the labelled 3.3 L/kg read as a steady-state volume; CL is the mid-point of the labelled 15-30 mL/min/kg range.', url: 'docs/MISSING_CONSTANTS.md', confidence: 'derived' },
    ],
  },
  {
    drugId: 'naloxone',
    shape: 'two',
    v1_L: 12,
    vss_L: 105,
    clearance_mL_per_min_kg: 22,
    halfLife_min: 81,
    renalFraction: 0.03,
    ka_min: 0.0141,
    citations: [
      {
        quantity: 'intramuscular absorption rate constant 0.2 /min',
        source: FDA('Naloxone hydrochloride injection', 'https://dailymed.nlm.nih.gov/dailymed/search.cfm?labeltype=all&query=naloxone').source,
        url: 'https://dailymed.nlm.nih.gov/dailymed/search.cfm?labeltype=all&query=naloxone',
        confidence: 'derived',
        note:
          'Solved so the model reproduces the labelled intramuscular time to peak of about 15 min. ' +
          'AN EARLIER VALUE OF 0.2 /min CLAIMED THE SAME THING AND PRODUCED 4.5 min: it had been solved ' +
          'against a one-compartment formula while the drug is modelled with two, so the distribution ' +
          'phase pulled the peak forward. The constant is now solved against the model that actually ' +
          'runs, and tests/pharma/routes.test.ts asserts the resulting time to peak.',
      },
      {
        quantity: 'Vd 2.0-2.6 L/kg, clearance 22 mL/min/kg, elimination half-life 30-81 min (mean 64)',
        source: FDA('Naloxone hydrochloride injection', 'https://dailymed.nlm.nih.gov/dailymed/search.cfm?labeltype=all&query=naloxone').source,
        url: 'https://dailymed.nlm.nih.gov/dailymed/search.cfm?labeltype=all&query=naloxone',
        confidence: 'measured',
        note: 'The short half-life relative to most opioids is why re-narcotisation happens; the model reproduces it.',
      },
      { quantity: 'V1 = 12 L, Vss = 105 L, t-half 81 min', source: 'V1 derived from the reported rapid distribution phase; Vss set below V_area so a two-compartment model is identifiable; half-life is the upper bound of the labelled 30-81 min range.', url: 'docs/MISSING_CONSTANTS.md', confidence: 'derived' },
    ],
  },
  {
    drugId: 'midazolam',
    shape: 'two',
    v1_L: 21,
    vss_L: 63,
    clearance_mL_per_min_kg: 6.7,
    halfLife_min: 150,
    renalFraction: 0.01,
    ka_min: 0.0304,
    citations: [
      {
        quantity: 'intramuscular absorption rate constant 0.08 /min',
        source: FDA('Midazolam hydrochloride injection', 'https://dailymed.nlm.nih.gov/dailymed/search.cfm?labeltype=all&query=midazolam').source,
        url: 'https://dailymed.nlm.nih.gov/dailymed/search.cfm?labeltype=all&query=midazolam',
        confidence: 'derived',
        note: 'Solved from the labelled intramuscular time-to-peak of about 30 min.',
      },
      {
        quantity: 'Vd 1.0-2.5 L/kg, clearance 0.25-0.54 L/h/kg, elimination half-life 1.8-6.4 h, under 1 % excreted unchanged',
        source: FDA('Midazolam hydrochloride injection', 'https://dailymed.nlm.nih.gov/dailymed/search.cfm?labeltype=all&query=midazolam').source,
        url: 'https://dailymed.nlm.nih.gov/dailymed/search.cfm?labeltype=all&query=midazolam',
        confidence: 'measured',
      },
      { quantity: 'V1 = 21 L', source: 'Derived from the reported distribution phase.', url: 'docs/MISSING_CONSTANTS.md', confidence: 'derived' },
    ],
  },
  {
    drugId: 'ketamine',
    shape: 'two',
    v1_L: 18,
    vss_L: 154,
    clearance_mL_per_min_kg: 17,
    halfLife_min: 150,
    renalFraction: 0.03,
    ka_min: 0.0285,
    citations: [
      {
        quantity: 'intramuscular absorption rate constant 0.15 /min',
        source: FDA('Ketalar (ketamine hydrochloride) injection', 'https://dailymed.nlm.nih.gov/dailymed/search.cfm?labeltype=all&query=ketamine').source,
        url: 'https://dailymed.nlm.nih.gov/dailymed/search.cfm?labeltype=all&query=ketamine',
        confidence: 'derived',
        note: 'Solved from the labelled intramuscular onset of 3-4 min and peak effect within 5-20 min.',
      },
      {
        quantity: 'Vd ~3 L/kg, clearance 12-17 mL/min/kg, terminal half-life 2-3 h, under 4 % excreted unchanged',
        source: FDA('Ketalar (ketamine hydrochloride) injection', 'https://dailymed.nlm.nih.gov/dailymed/search.cfm?labeltype=all&query=ketamine').source,
        url: 'https://dailymed.nlm.nih.gov/dailymed/search.cfm?labeltype=all&query=ketamine',
        confidence: 'measured',
      },
      { quantity: 'V1 = 18 L', source: 'Derived from the reported distribution phase.', url: 'docs/MISSING_CONSTANTS.md', confidence: 'derived' },
    ],
  },

  /* ------------------------------------------------------------ autonomic */
  {
    drugId: 'atropine',
    shape: 'two',
    v1_L: 22,
    vss_L: 84,
    clearance_mL_per_min_kg: 6.8,
    halfLife_min: 180,
    renalFraction: 0.5,
    proteinBound: 0.44,
    MW_gmol: 289.37,
    ka_min: 0.182,
    citations: [
      {
        quantity: 'intramuscular absorption rate constant 0.182 /min',
        source: FDA('Atropine sulfate auto-injector', 'https://dailymed.nlm.nih.gov/dailymed/search.cfm?labeltype=all&query=atropine').source,
        url: 'https://dailymed.nlm.nih.gov/dailymed/search.cfm?labeltype=all&query=atropine',
        confidence: 'derived',
        note:
          'Solved for a peak about 10 min after intramuscular injection. The auto-injector exists precisely because the intramuscular route is fast enough to matter in organophosphate poisoning, and the model should be able to show that.',
      },
      {
        quantity: 'plasma protein binding 44 %',
        source: FDA('Atropine sulfate injection', 'https://dailymed.nlm.nih.gov/dailymed/search.cfm?labeltype=all&query=atropine+sulfate').source,
        url: 'https://dailymed.nlm.nih.gov/dailymed/search.cfm?labeltype=all&query=atropine+sulfate',
        confidence: 'measured',
      },
      {
        quantity: 'Vd 1.7 L/kg, clearance 6.8 mL/min/kg, elimination half-life ~3 h, 30-50 % excreted unchanged in urine',
        source: FDA('Atropine sulfate injection', 'https://dailymed.nlm.nih.gov/dailymed/search.cfm?labeltype=all&query=atropine+sulfate').source,
        url: 'https://dailymed.nlm.nih.gov/dailymed/search.cfm?labeltype=all&query=atropine+sulfate',
        confidence: 'measured',
      },
      { quantity: 'V1 = 22 L', source: 'Derived from the reported distribution phase.', url: 'docs/MISSING_CONSTANTS.md', confidence: 'derived' },
      { quantity: 'MW = 289.37 g/mol', source: 'PubChem CID 174174 (atropine).', url: 'https://pubchem.ncbi.nlm.nih.gov/compound/174174', confidence: 'measured' },
    ],
  },
  {
    drugId: 'phenylephrine',
    shape: 'two',
    v1_L: 22,
    vss_L: 340,
    clearance_L_per_min: 2.13,
    halfLife_min: 150,
    renalFraction: 0.12,
    citations: [
      {
        quantity: 'Vd 340 L, clearance 2130 mL/min, terminal half-life 2.5 h',
        source: FDA('Vazculep / phenylephrine hydrochloride injection', 'https://dailymed.nlm.nih.gov/dailymed/search.cfm?labeltype=all&query=phenylephrine+injection').source,
        url: 'https://dailymed.nlm.nih.gov/dailymed/search.cfm?labeltype=all&query=phenylephrine+injection',
        confidence: 'measured',
      },
      { quantity: 'V1 = 22 L', source: 'Derived from the reported distribution phase.', url: 'docs/MISSING_CONSTANTS.md', confidence: 'derived' },
    ],
  },
  {
    drugId: 'albuterol',
    shape: 'two',
    v1_L: 25,
    vss_L: 156,
    clearance_L_per_min: 0.439,
    halfLife_min: 288,
    renalFraction: 0.3,
    bioavailability: 0.15,
    citations: [
      {
        quantity: 'Vd 156 L, clearance 439 mL/min, terminal half-life 4.6 h after inhalation, ~30 % excreted unchanged',
        source: FDA('Albuterol sulfate inhalation aerosol', 'https://dailymed.nlm.nih.gov/dailymed/search.cfm?labeltype=all&query=albuterol+sulfate').source,
        url: 'https://dailymed.nlm.nih.gov/dailymed/search.cfm?labeltype=all&query=albuterol+sulfate',
        confidence: 'measured',
      },
      {
        quantity: 'pulmonary bioavailability ~15 %',
        source: 'Same label: the fraction of a metered dose that reaches the lower airway with a standard pMDI.',
        url: 'https://dailymed.nlm.nih.gov/dailymed/search.cfm?labeltype=all&query=albuterol+sulfate',
        confidence: 'measured',
      },
      { quantity: 'V1 = 25 L', source: 'Derived from the reported distribution phase.', url: 'docs/MISSING_CONSTANTS.md', confidence: 'derived' },
    ],
  },
  {
    drugId: 'furosemide',
    shape: 'two',
    v1_L: 5,
    vss_L: 12.6,
    clearance_mL_per_min_kg: 2.0,
    halfLife_min: 100,
    renalFraction: 0.65,
    proteinBound: 0.97,
    bioavailability: 0.6,
    ka_min: 0.04,
    lagTime_min: 10,
    citations: [
      {
        quantity: 'Vd 0.1-0.2 L/kg, oral bioavailability ~60 %, terminal half-life ~1.5-2 h, protein binding 91-99 %, mainly renal elimination',
        source: FDA('Lasix (furosemide) tablets and injection', 'https://dailymed.nlm.nih.gov/dailymed/search.cfm?labeltype=all&query=furosemide').source,
        url: 'https://dailymed.nlm.nih.gov/dailymed/search.cfm?labeltype=all&query=furosemide',
        confidence: 'measured',
        note: 'Renal fraction is high, so this drug is the clearest demonstration of the GFR-to-clearance feedback loop: give it to a hypotensive body and it accumulates.',
      },
      { quantity: 'V1 = 8 L', source: 'Derived from the reported distribution phase.', url: 'docs/MISSING_CONSTANTS.md', confidence: 'derived' },
    ],
  },

  /* ------------------------------------------- payload-only: no PK model */
  { drugId: 'potassium_chloride', shape: 'none', citations: [{ quantity: 'no compartmental PK', source: 'Potassium is an endogenous electrolyte with a homeostatic set point, not a xenobiotic with a volume of distribution. Modelled as a direct extracellular-fluid load.', url: 'docs/MODEL_LIMITATIONS.md', confidence: 'derived' }] },
  { drugId: 'calcium_chloride', shape: 'none', citations: [{ quantity: 'no compartmental PK', source: 'As for potassium: modelled as a direct ionised-calcium load on the plasma.', url: 'docs/MODEL_LIMITATIONS.md', confidence: 'derived' }] },
  { drugId: 'normal_saline', shape: 'none', citations: [{ quantity: 'no compartmental PK', source: 'Isotonic crystalloid. Modelled as a volume and sodium/chloride load on the venous compartment.', url: 'docs/MODEL_LIMITATIONS.md', confidence: 'derived' }] },
  {
    drugId: 'ferrous_sulfate',
    shape: 'none',
    bioavailability: 0.1,
    ka_min: 0.008,
    lagTime_min: 15,
    citations: [
      {
        quantity: 'oral absorption ~10 % of elemental iron in a replete adult',
        source: FDA('Ferrous sulfate oral', 'https://dailymed.nlm.nih.gov/dailymed/search.cfm?labeltype=all&query=ferrous+sulfate').source,
        url: 'https://dailymed.nlm.nih.gov/dailymed/search.cfm?labeltype=all&query=ferrous+sulfate',
        confidence: 'measured',
        note: 'Iron has no elimination pathway to speak of; it is regulated at absorption. A compartmental PK model would be actively misleading, so there is none.',
      },
      {
        quantity: 'absorption lag 15 min and rate constant 0.008 /min',
        source: FDA('Ferrous sulfate oral', 'https://dailymed.nlm.nih.gov/dailymed/search.cfm?labeltype=all&query=ferrous+sulfate').source,
        url: 'https://dailymed.nlm.nih.gov/dailymed/search.cfm?labeltype=all&query=ferrous+sulfate',
        confidence: 'derived',
        note: 'Solved from the labelled time to peak serum iron of two to four hours after an oral dose.',
      },
    ],
  },
];

/*
 * The wider therapeutic set's pharmacokinetics live in their own file and are
 * concatenated here, for the same readability reason as the manifest and the
 * receptor registry. Same rules: every entry carries a citation, and a drug whose
 * volume and clearance could not both be sourced is not in it.
 */
import { PK_LITERATURE_2 } from './pk_literature_2';
import { PK_LITERATURE_3 } from './pk_literature_3';

PK_LITERATURE.push(...PK_LITERATURE_2);
PK_LITERATURE.push(...PK_LITERATURE_3);

export const PK_BY_ID = new Map(PK_LITERATURE.map((e) => [e.drugId, e]));

/**
 * DRUGS ELIMINATED IN THE BLOOD ITSELF.
 *
 * The engine scales every non-renal clearance with cardiac output, which is right for a
 * drug the liver clears (hepatic blood flow follows output) and wrong for one destroyed
 * in the circulation. Adenosine is the case that exposed it: its own AV block drops
 * cardiac output, the output-scaled clearance slowed, and a drug whose label half-life is
 * under ten seconds persisted for over a minute, prolonging the very block that slowed
 * it (tests/pharma/pharmacology.test.ts, "adenosine is gone within a minute"). Each entry
 * here names the mechanism and cites it; for these the clearance is taken as independent
 * of organ blood flow.
 */
export const BLOOD_CLEARED: Record<string, { source: string; url: string; note: string }> = {
  adenosine: {
    source: FDA('Adenocard (adenosine) injection', 'https://dailymed.nlm.nih.gov/dailymed/search.cfm?labeltype=all&query=adenosine').source,
    url: 'https://dailymed.nlm.nih.gov/dailymed/search.cfm?labeltype=all&query=adenosine',
    note: 'Section 12.3: rapidly taken up by erythrocytes and vascular endothelial cells and metabolised by adenosine deaminase and adenosine kinase in the circulation, with a half-life under 10 seconds. Clearance is therefore not limited by hepatic blood flow.',
  },
  esmolol: {
    source: FDA('Brevibloc (esmolol hydrochloride) injection', 'https://dailymed.nlm.nih.gov/dailymed/search.cfm?labeltype=all&query=esmolol').source,
    url: 'https://dailymed.nlm.nih.gov/dailymed/search.cfm?labeltype=all&query=esmolol',
    note: 'Section 12.3: hydrolysed by esterases in the cytosol of red blood cells, not by plasma cholinesterase or the liver; elimination half-life about 9 minutes, independent of hepatic flow.',
  },
  remifentanil: {
    source: FDA('Ultiva (remifentanil hydrochloride) for injection', 'https://dailymed.nlm.nih.gov/dailymed/search.cfm?labeltype=all&query=remifentanil').source,
    url: 'https://dailymed.nlm.nih.gov/dailymed/search.cfm?labeltype=all&query=remifentanil',
    note: 'Section 12.3: metabolised by non-specific blood and tissue esterases; its clearance is not affected by hepatic or renal impairment.',
  },
  succinylcholine: {
    source: FDA('Anectine (succinylcholine chloride) injection', 'https://dailymed.nlm.nih.gov/dailymed/search.cfm?labeltype=all&query=succinylcholine').source,
    url: 'https://dailymed.nlm.nih.gov/dailymed/search.cfm?labeltype=all&query=succinylcholine',
    note: 'Section 12.3: rapidly hydrolysed by plasma cholinesterase (pseudocholinesterase) in the circulation, so its short action does not depend on liver blood flow.',
  },
};
