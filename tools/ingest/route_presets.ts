import type { PresetDose } from '../../src/data/pharma-types';
import type { Route } from '../../src/bridge/types';

/**
 * ADDITIONAL ROUTES AND THEIR REFERENCE DOSES.
 *
 * Kept out of drug_manifest.ts so the manifest stays readable, and structured per
 * drug so every entry can be read against its own label.
 *
 * EACH ENTRY IS A REFERENCE POINT, NOT A RECOMMENDATION. The interface scales a
 * simulated dose relative to these, so what matters about them is that they are
 * REAL published figures with a citation attached — a labelled adult dose that a
 * reader can go and check. They are landmarks on an axis, and the axis is what the
 * user manipulates.
 *
 * `routePk` carries absorption figures measured for a specific licensed product.
 * Those override the generic route defaults in src/data/routes.json, because a
 * ratio scaled off the intramuscular route is a reasonable guess and a label is a
 * measurement.
 */

export interface RouteAddition {
  routes: Route[];
  presets: (PresetDose & { source: string; sourceUrl: string })[];
  routePk?: Partial<Record<Route, {
    ka_min?: number;
    bioavailability?: number;
    lagMin?: number;
    source: string;
    sourceUrl: string;
    confidence: 'measured' | 'derived' | 'assumed';
    note: string;
  }>>;
}

const ACLS = {
  source: 'Panchal AR, et al. Part 3: Adult Basic and Advanced Life Support: 2020 AHA Guidelines for CPR and ECC. Circulation 142(16_suppl_2), 2020.',
  sourceUrl: 'https://doi.org/10.1161/CIR.0000000000000916',
};

const dailymed = (q: string) => ({
  source: `FDA Structured Product Label via DailyMed — ${q}`,
  sourceUrl: `https://dailymed.nlm.nih.gov/dailymed/search.cfm?labeltype=all&query=${encodeURIComponent(q)}`,
});

const ANAPHYLAXIS = {
  source: 'Shaker MS, et al. Anaphylaxis—a 2020 practice parameter update. J Allergy Clin Immunol 145(4):1082-1123, 2020.',
  sourceUrl: 'https://doi.org/10.1016/j.jaci.2020.01.017',
};

export const ROUTE_ADDITIONS: Record<string, RouteAddition> = {
  epinephrine: {
    routes: ['IM', 'SUBCUTANEOUS', 'INTRAOSSEOUS', 'NEBULISED'],
    presets: [
      { route: 'IM', amount: 0.5, unit: 'mg', label: '0.5 mg IM', ...ANAPHYLAXIS },
      { route: 'SUBCUTANEOUS', amount: 0.3, unit: 'mg', label: '0.3 mg SC', ...ANAPHYLAXIS },
      { route: 'INTRAOSSEOUS', amount: 1, unit: 'mg', label: '1 mg IO', ...ACLS },
      { route: 'NEBULISED', amount: 5, unit: 'mg', label: '5 mg nebulised', ...dailymed('epinephrine inhalation') },
    ],
    routePk: {
      SUBCUTANEOUS: {
        ka_min: 0.00668,
        source: 'Simons FE, Gu X, Simons KJ. Epinephrine absorption in adults: intramuscular versus subcutaneous injection. J Allergy Clin Immunol 108(5):871-873, 2001.',
        sourceUrl: 'https://doi.org/10.1067/mai.2001.119409',
        confidence: 'derived',
        note:
          'Exactly a quarter of the intramuscular rate constant for this drug, which is the four-fold difference ' +
          'Simons measured directly: the same adults peaked at 8 +/- 2 min in the thigh and 34 +/- 14 min ' +
          'subcutaneously. It is a PER-DRUG override rather than a route default because the mechanism is ' +
          'specific to adrenaline: it constricts the vessels around its own depot, so it throttles its own ' +
          'absorption in a way that an inert molecule does not. This is the study that moved anaphylaxis ' +
          'guidance to the intramuscular route. ' +
          'THE MODEL REPRODUCES THE RATE CONSTANT, NOT THE TIME TO PEAK: adrenaline is modelled in one ' +
          'compartment with a 2 min disposition half-life, and such a drug peaks no later than about 30 min ' +
          'however slowly it is absorbed, so the simulated subcutaneous peak lands near 12 min rather than 34. ' +
          'Later and lower than intramuscular, which is the decisive part, but compressed. See ' +
          'docs/MODEL_LIMITATIONS.md.',
      },
    },
  },

  norepinephrine: {
    routes: ['INTRAOSSEOUS'],
    presets: [
      { route: 'INTRAOSSEOUS', amount: 100, unit: 'mcg', label: '100 mcg IO', ...ACLS },
    ],
  },

  dopamine: {
    routes: ['INTRAOSSEOUS'],
    presets: [
      { route: 'INTRAOSSEOUS', amount: 2, unit: 'mg', label: '2 mg IO', ...ACLS },
    ],
  },

  adenosine: {
    routes: ['INTRAOSSEOUS'],
    presets: [
      { route: 'INTRAOSSEOUS', amount: 6, unit: 'mg', label: '6 mg IO', ...ACLS },
    ],
  },

  amiodarone: {
    routes: ['INTRAOSSEOUS'],
    presets: [
      { route: 'INTRAOSSEOUS', amount: 300, unit: 'mg', label: '300 mg IO', ...ACLS },
    ],
  },

  calcium_chloride: {
    routes: ['INTRAOSSEOUS'],
    presets: [
      { route: 'INTRAOSSEOUS', amount: 1, unit: 'g', label: '1 g IO', ...ACLS },
    ],
  },

  normal_saline: {
    routes: ['INTRAOSSEOUS'],
    presets: [
      { route: 'INTRAOSSEOUS', amount: 500, unit: 'mL', label: '500 mL IO', ...ACLS },
    ],
  },

  fentanyl: {
    routes: ['IM', 'INTRANASAL', 'SUBLINGUAL', 'TRANSDERMAL'],
    presets: [
      { route: 'IM', amount: 100, unit: 'mcg', label: '100 mcg IM', ...dailymed('fentanyl citrate injection') },
      { route: 'INTRANASAL', amount: 100, unit: 'mcg', label: '100 mcg IN', ...dailymed('fentanyl citrate nasal spray') },
      { route: 'SUBLINGUAL', amount: 100, unit: 'mcg', label: '100 mcg SL', ...dailymed('fentanyl sublingual tablet') },
      {
        route: 'TRANSDERMAL', amount: 1.8, unit: 'mg',
        label: '25 mcg/h patch',
        ...dailymed('duragesic fentanyl transdermal system'),
      },
    ],
    routePk: {
      TRANSDERMAL: {
        ka_min: 0.0004,
        bioavailability: 0.92,
        lagMin: 720,
        ...dailymed('duragesic fentanyl transdermal system'),
        confidence: 'derived',
        note:
          'The label states that serum concentrations rise for 12 to 24 hours after application, that ' +
          'bioavailability is about 92%, and that a depot remains in the skin after the system is removed. ' +
          'The 12-hour lag is read directly from the first of those; ka is solved so the 1.8 mg contained in a ' +
          '25 mcg/h system releases over roughly three days, which is the labelled wear time. ' +
          'THIS IS THE ROUTE WITH THE LONGEST GAP BETWEEN A DECISION AND ITS CONSEQUENCE, which is why it is ' +
          'worth simulating: remove the patch and the skin depot keeps delivering for hours.',
      },
      SUBLINGUAL: {
        ka_min: 0.0115,
        bioavailability: 0.54,
        ...dailymed('fentanyl sublingual tablet'),
        confidence: 'derived',
        note:
          'Absolute bioavailability of about 54% is measured and taken from the label. ka is solved so the ' +
          'model peaks between thirty and sixty minutes, which is what the label reports and which is far ' +
          'slower than the generic sublingual default - the tablet has to dissolve before any of it can be ' +
          'absorbed, so this route is fast only for drugs that are already in solution.',
      },
      INTRANASAL: {
        ka_min: 0.0321,
        ...dailymed('fentanyl citrate nasal spray'),
        confidence: 'derived',
        note: 'Solved for the labelled time to peak of roughly 15 to 21 min for the nasal spray.',
      },
    },
  },

  morphine: {
    routes: ['IM', 'SUBCUTANEOUS', 'RECTAL'],
    presets: [
      { route: 'IM', amount: 10, unit: 'mg', label: '10 mg IM', ...dailymed('morphine sulfate injection') },
      { route: 'SUBCUTANEOUS', amount: 10, unit: 'mg', label: '10 mg SC', ...dailymed('morphine sulfate injection') },
      { route: 'RECTAL', amount: 10, unit: 'mg', label: '10 mg PR', ...dailymed('morphine sulfate suppository') },
    ],
  },

  naloxone: {
    routes: ['INTRANASAL', 'INTRAOSSEOUS', 'SUBCUTANEOUS'],
    presets: [
      { route: 'INTRANASAL', amount: 4, unit: 'mg', label: '4 mg IN', ...dailymed('narcan naloxone nasal spray') },
      { route: 'INTRAOSSEOUS', amount: 0.4, unit: 'mg', label: '0.4 mg IO', ...ACLS },
      { route: 'SUBCUTANEOUS', amount: 0.4, unit: 'mg', label: '0.4 mg SC', ...dailymed('naloxone hydrochloride injection') },
    ],
    routePk: {
      INTRANASAL: {
        ka_min: 0.00829,
        bioavailability: 0.47,
        ...dailymed('narcan naloxone nasal spray'),
        confidence: 'derived',
        note:
          'The nasal spray label gives a median time to peak of about 30 minutes and an absolute ' +
          'bioavailability near 47%. ka is solved against the model\'s own disposition to reproduce that ' +
          'time to peak, and tests/pharma/routes.test.ts asserts it. ' +
          'NOTE THAT THIS IS SLOWER THAN THE INTRAMUSCULAR ROUTE, not faster: the advantage of a nasal spray ' +
          'is that a bystander can give it without a needle, and the simulation should not flatter it beyond ' +
          'what the label supports.',
      },
    },
  },

  midazolam: {
    routes: ['INTRANASAL', 'RECTAL', 'ORAL'],
    presets: [
      { route: 'INTRANASAL', amount: 5, unit: 'mg', label: '5 mg IN', ...dailymed('midazolam nasal spray') },
      { route: 'RECTAL', amount: 10, unit: 'mg', label: '10 mg PR', ...dailymed('midazolam hydrochloride syrup') },
      { route: 'ORAL', amount: 7.5, unit: 'mg', label: '7.5 mg PO', ...dailymed('midazolam hydrochloride syrup') },
    ],
    routePk: {
      INTRANASAL: {
        bioavailability: 0.44,
        ...dailymed('midazolam nasal spray'),
        confidence: 'measured',
        note: 'Label reports absolute bioavailability of about 44% for the nasal spray.',
      },
    },
  },

  ketamine: {
    routes: ['INTRANASAL'],
    presets: [
      { route: 'INTRANASAL', amount: 50, unit: 'mg', label: '50 mg IN', ...dailymed('ketamine hydrochloride injection') },
    ],
  },

  atropine: {
    routes: ['IM', 'INTRAOSSEOUS'],
    presets: [
      { route: 'IM', amount: 2, unit: 'mg', label: '2 mg IM', ...dailymed('atropine sulfate auto-injector') },
      { route: 'INTRAOSSEOUS', amount: 1, unit: 'mg', label: '1 mg IO', ...ACLS },
    ],
  },

  albuterol: {
    routes: ['NEBULISED'],
    presets: [
      { route: 'NEBULISED', amount: 2.5, unit: 'mg', label: '2.5 mg nebulised', ...dailymed('albuterol sulfate inhalation solution') },
    ],
  },

  furosemide: {
    routes: ['IM'],
    presets: [
      { route: 'IM', amount: 40, unit: 'mg', label: '40 mg IM', ...dailymed('furosemide injection') },
    ],
  },
};
