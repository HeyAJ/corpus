import { cachedFetch } from './cache';
import { hoursToMinutes, parseNumber } from './normalise';

/**
 * TIER-2 CROSS-CHECK: openFDA / DailyMed Structured Product Labels.
 *
 * Section 12.3 (Clinical Pharmacology - Pharmacokinetics) of every FDA label carries
 * volume of distribution, clearance, elimination half-life, protein binding and
 * bioavailability — in prose. Public US government resource, free, no API key
 * (spec 5.6).
 *
 * WHAT THIS PARSER IS FOR. It does not feed the engine directly. Prose extraction is
 * inherently unreliable — "half-life of 2 to 3 hours in adults but up to 10 hours in
 * neonates" has two numbers and only one of them is ours — so what it produces are
 * CANDIDATES, which the pipeline compares against the curated values in
 * pk_literature.ts. A mismatch is reported; it never silently overwrites a cited
 * value. openFDA's disclaimer is carried in CREDITS.md.
 */

export const OPENFDA_DISCLAIMER =
  'Data from openFDA (api.fda.gov). openFDA is a research tool. Its data has not been ' +
  'validated for clinical or production use. It does not constitute FDA endorsement, ' +
  'and should not be used to make decisions about medical care.';
export const OPENFDA_URL = 'https://open.fda.gov';

export interface SplCandidate {
  query: string;
  brandName: string | null;
  halfLife_min: number | null;
  /** True when the label quoted a bound ("less than 5 minutes"), not an estimate. */
  halfLifeIsBound: boolean;
  vd_L: number | null;
  vd_L_per_kg: number | null;
  clearance_L_per_min: number | null;
  proteinBound: number | null;
  bioavailability: number | null;
  /** The sentence each candidate was pulled from, for the provenance trail. */
  evidence: Record<string, string>;
  /** Sentences deliberately not parsed, and why. Reported, never silently dropped. */
  skipped: { reason: string; sentence: string }[];
  sourceUrl: string;
  found: boolean;
}

interface OpenFdaResult {
  results?: {
    openfda?: { brand_name?: string[]; generic_name?: string[] };
    clinical_pharmacology?: string[];
    pharmacokinetics?: string[];
    description?: string[];
  }[];
}

export async function fetchSpl(genericName: string, offline: boolean): Promise<SplCandidate> {
  const url =
    `https://api.fda.gov/drug/label.json?search=openfda.generic_name:%22${encodeURIComponent(genericName)}%22&limit=1`;

  const empty: SplCandidate = {
    query: genericName,
    brandName: null,
    halfLife_min: null,
    halfLifeIsBound: false,
    vd_L: null,
    vd_L_per_kg: null,
    clearance_L_per_min: null,
    proteinBound: null,
    bioavailability: null,
    evidence: {},
    skipped: [],
    sourceUrl: url,
    found: false,
  };

  let json: OpenFdaResult;
  try {
    const buf = await cachedFetch(url, { label: `openFDA label: ${genericName}`, offline });
    json = JSON.parse(buf.toString('utf8')) as OpenFdaResult;
  } catch {
    return empty;
  }

  const first = json.results?.[0];
  if (!first) return empty;

  const text = [
    ...(first.pharmacokinetics ?? []),
    ...(first.clinical_pharmacology ?? []),
  ].join('\n');
  if (!text) return { ...empty, brandName: first.openfda?.brand_name?.[0] ?? null };

  const out: SplCandidate = { ...empty, found: true, brandName: first.openfda?.brand_name?.[0] ?? null };
  extract(text, out);
  return out;
}

/** Split prose into sentences so each candidate can carry the one it came from. */
function sentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.;])\s+(?=[A-Z0-9])/)
    .filter((s) => s.length > 10);
}

/**
 * SENTENCES THIS PARSER MUST NOT READ.
 *
 * The model is one specific body: a 70 kg adult with normal renal and hepatic
 * function, given an intravenous or oral dose. Section 12.3 prose is not written for
 * that reader — it is written for every reader at once, so one paragraph will quote
 * the adult figure, the neonatal figure and the figure in cirrhosis, and a regex
 * cannot tell which is which from the number alone.
 *
 * Six cross-check disagreements were reported before this filter existed, and for
 * most of them the diagnosis was not that the curated value was wrong. It was that
 * the parse had picked up a different population, a different formulation, or a
 * different phase of the same curve. That is a false alarm, and a report full of
 * false alarms is a report nobody reads.
 *
 * So: skip the sentence, and record which rule skipped it. A filtered sentence goes
 * into `skipped` and is surfaced in MISSING_CONSTANTS, because "we chose not to read
 * this" has to stay auditable — otherwise this list quietly becomes a way of making
 * inconvenient evidence disappear, which is the opposite of what the cross-check is
 * for.
 */
const SCOPE_EXCLUSIONS: { reason: string; re: RegExp }[] = [
  {
    reason: 'a population other than the healthy adult the model represents',
    re: /(neonat|newborn|infant|pediatric|paediatric|children|adolescent|elderly|geriatric)/i,
  },
  {
    reason: 'impaired organ function, which the reference body does not have',
    re: /(renal impairment|renal failure|renal insufficiency|hepatic impairment|hepatic failure|hepatic insufficiency|cirrho|dialysis|end-stage|creatinine clearance|anuri|uremi|uraemi)/i,
  },
  {
    reason: 'pregnancy or obesity, neither of which the reference body represents',
    re: /(pregnan|parturien|obese|obesity|body mass index)/i,
  },
  {
    reason: 'a formulation or route this drug is not simulated with',
    re: /(extended[- ]release|sustained[- ]release|controlled[- ]release|modified[- ]release|transdermal|depot|implant|epidural|intrathecal|ophthalmic|buccal film)/i,
  },
];

/**
 * A half-life is only the model's half-life if it is the ELIMINATION half-life.
 * Labels quote the distribution phase in the same paragraph and in nearly the same
 * words, and that is exactly where "ketamine 12.5 min against a curated 150" came
 * from: 12.5 min is ketamine's alpha phase, quoted correctly by the label and read
 * by us as though it were beta.
 */
const DISTRIBUTION_PHASE =
  /(distribution half-?life|distributional half-?life|initial half-?life|redistribution|alpha half-?life|alpha phase|first phase|rapid distribution|distribution phase)/i;

/**
 * The opposite problem: a terminal half-life quoted for the deep peripheral
 * compartment after a prolonged infusion. Propofol's label carries one, and it is
 * where the 240-hour candidate came from. The model's terminal half-life is the one
 * that governs a single bolus, so a sentence explicitly about prolonged infusion is
 * describing a different quantity.
 */
const PROLONGED_INFUSION =
  /(prolonged infusion|long-?term infusion|after (a |an )?\d+[- ]?(day|hour|hr|h|week)[- ]?(long )?infusion|deep (peripheral )?compartment|slow(ly)? equilibrat)/i;

/**
 * A half-life measured after an ORAL dose is not necessarily an elimination
 * half-life. When absorption is slower than elimination the terminal slope is the
 * absorption rate wearing elimination's clothes — flip-flop kinetics — and for a
 * high-first-pass drug the two differ by a factor of several. Naloxone's label puts
 * the IV half-life near an hour and the oral one at 3.6 hours in the same section,
 * and the model's k10 is the intravenous constant.
 */
const EXTRAVASCULAR_SCOPE = /(after oral|following oral|oral administration|orally administered|after intramuscular|following intramuscular|subcutaneous administration)/i;

/**
 * "Less than 5 minutes" is a BOUND, not an estimate, and a curated value of 2 min
 * does not disagree with it — it satisfies it. Reading the bound as a point estimate
 * is how epinephrine came to be reported as drifting by a factor of 2.5 against a
 * label it actually complies with.
 *
 * Only UPPER bounds belong here. "Approximately 2 hours" is a point estimate with
 * uncertainty attached, and treating it as a ceiling turned morphine's exact
 * agreement (120 min against 120 min) into a reported violation.
 */
const BOUNDED = /(less than|fewer than|no more than|up to|<)\s*$/i;

function excludedBy(sentence: string): string | null {
  for (const x of SCOPE_EXCLUSIONS) if (x.re.test(sentence)) return x.reason;
  return null;
}

/** Does this sentence carry a number the cross-check would otherwise have taken? */
const CARRIES_A_QUANTITY =
  /(half-?life|volume of distribution|clearance|protein[- ]bound|protein binding|bioavailab)/i;

function extract(text: string, out: SplCandidate): void {
  for (const s of sentences(text)) {
    const lower = s.toLowerCase();

    const exclusion = excludedBy(s);
    if (exclusion !== null) {
      // Only worth recording when the sentence held a quantity. A label is full of
      // prose that mentions children and says nothing this parser wanted.
      if (CARRIES_A_QUANTITY.test(s)) {
        out.skipped.push({ reason: exclusion, sentence: s.trim().slice(0, 240) });
      }
      continue;
    }

    // --- elimination half-life ---------------------------------------------
    if (out.halfLife_min === null && /half-?life/.test(lower)) {
      const phase = DISTRIBUTION_PHASE.test(s)
        ? 'a distribution-phase half-life, not the elimination half-life'
        : PROLONGED_INFUSION.test(s)
          ? 'a terminal half-life quoted after prolonged infusion, not for the single dose the model gives'
          : EXTRAVASCULAR_SCOPE.test(s)
            ? 'a half-life measured after an extravascular dose, where the terminal slope can be absorption-limited'
            : null;

      if (phase !== null) {
        out.skipped.push({ reason: phase, sentence: s.trim().slice(0, 240) });
      } else {
        const m = /half-?life[^.]{0,90}?(\d+(?:\.\d+)?)\s*(?:to|-|–)?\s*(\d+(?:\.\d+)?)?\s*(hour|hr|h|minute|min|day)/i.exec(s);
        if (m) {
          const a = Number(m[1]);
          const b = m[2] ? Number(m[2]) : null;
          const value = b !== null ? (a + b) / 2 : a;
          const unit = m[3].toLowerCase();
          out.halfLife_min =
            unit.startsWith('d') ? value * 24 * 60 : unit.startsWith('h') ? hoursToMinutes(value) : value;
          out.halfLifeIsBound = BOUNDED.test(s.slice(0, m.index + m[0].indexOf(m[1])));
          out.evidence.halfLife = s.trim();
        }
      }
    }

    // --- volume of distribution --------------------------------------------
    if (out.vd_L === null && out.vd_L_per_kg === null && /volume of distribution/.test(lower)) {
      const perKg = /(\d+(?:\.\d+)?)\s*L\s*\/\s*kg/i.exec(s);
      if (perKg) {
        out.vd_L_per_kg = Number(perKg[1]);
        out.evidence.vd = s.trim();
      } else {
        const litres = /(\d+(?:\.\d+)?)\s*(?:L|liters?|litres?)\b/i.exec(s);
        if (litres) {
          out.vd_L = Number(litres[1]);
          out.evidence.vd = s.trim();
        }
      }
    }

    // --- clearance -----------------------------------------------------------
    if (out.clearance_L_per_min === null && /clearance/.test(lower)) {
      const mlMinKg = /(\d+(?:\.\d+)?)\s*mL\s*\/\s*min\s*\/\s*kg/i.exec(s);
      const lPerH = /(\d+(?:\.\d+)?)\s*L\s*\/\s*(?:h|hour)/i.exec(s);
      const mlMin = /(\d+(?:\.\d+)?)\s*mL\s*\/\s*min\b/i.exec(s);
      if (mlMinKg) out.clearance_L_per_min = (Number(mlMinKg[1]) * 70) / 1000;
      else if (lPerH) out.clearance_L_per_min = Number(lPerH[1]) / 60;
      else if (mlMin) out.clearance_L_per_min = Number(mlMin[1]) / 1000;
      if (out.clearance_L_per_min !== null) out.evidence.clearance = s.trim();
    }

    // --- protein binding -----------------------------------------------------
    if (out.proteinBound === null && /(protein[- ]bound|protein binding|bound to plasma protein)/.test(lower)) {
      // Labels write a range both ways round: "20 to 35%" and "20% to 35%". Taking
      // only the first number of the second form reported morphine as 20% bound
      // against a curated 35%, which is a disagreement the label never made.
      const both = /(\d+(?:\.\d+)?)\s*%\s*(?:to|-|–)\s*(\d+(?:\.\d+)?)\s*%/.exec(s);
      const m = both ?? /(\d+(?:\.\d+)?)\s*(?:to|-|–)?\s*(\d+(?:\.\d+)?)?\s*%/.exec(s);
      if (m) {
        const a = Number(m[1]);
        const b = m[2] ? Number(m[2]) : null;
        out.proteinBound = (b !== null ? (a + b) / 2 : a) / 100;
        out.evidence.proteinBound = s.trim();
      }
    }

    // --- bioavailability -----------------------------------------------------
    if (out.bioavailability === null && /bioavailab/.test(lower)) {
      const m = /(\d+(?:\.\d+)?)\s*(?:to|-|–)?\s*(\d+(?:\.\d+)?)?\s*%/.exec(s);
      if (m) {
        const a = Number(m[1]);
        const b = m[2] ? Number(m[2]) : null;
        out.bioavailability = (b !== null ? (a + b) / 2 : a) / 100;
        out.evidence.bioavailability = s.trim();
      }
    }
  }

  // Sanity gates. A parsed "bioavailability" above 1 or a negative half-life means
  // the regex matched the wrong number; drop it rather than emit nonsense.
  if (out.bioavailability !== null && (out.bioavailability <= 0 || out.bioavailability > 1)) out.bioavailability = null;
  if (out.proteinBound !== null && (out.proteinBound < 0 || out.proteinBound > 1)) out.proteinBound = null;
  if (out.halfLife_min !== null && out.halfLife_min <= 0) out.halfLife_min = null;
  if (out.vd_L_per_kg !== null && (out.vd_L_per_kg <= 0 || out.vd_L_per_kg > 200)) out.vd_L_per_kg = null;
}

/** Compare a curated value against an SPL candidate; used only to report drift. */
export function compare(label: string, curated: number | null, candidate: number | null, tolerance = 0.5): string | null {
  if (curated === null || candidate === null) return null;
  const ratio = candidate / curated;
  if (ratio > 1 + tolerance || ratio < 1 / (1 + tolerance)) {
    return `${label}: curated ${round(curated)} vs SPL-parsed ${round(candidate)} (ratio ${ratio.toFixed(2)})`;
  }
  return null;
}

function round(n: number): string {
  const v = parseNumber(String(n));
  if (v === null) return String(n);
  return Math.abs(v) >= 100 ? v.toFixed(0) : v.toPrecision(3);
}
