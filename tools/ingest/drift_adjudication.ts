/**
 * ADJUDICATED CROSS-CHECK DRIFT.
 *
 * The SPL cross-check reads section 12.3 prose with a regex and compares what it finds
 * against the curated value. A disagreement is advisory by design — it never overwrites
 * a cited number — but an advisory warning that nobody has ruled on is indistinguishable
 * from one nobody has read, and six of them sat in `MISSING_CONSTANTS.md` looking exactly
 * like six unfixed bugs.
 *
 * This table is the ruling. Each entry names a disagreement, says which value stands, and
 * says why. The report then separates disagreements that have been adjudicated from
 * those that have not, so the unexplained list is the one worth looking at and is
 * expected to be empty.
 *
 * WHAT THIS IS NOT. It is not a suppression list. Nothing here changes a number, silences
 * a comparison, or loosens a tolerance; the comparison still runs and the disagreement is
 * still printed, with its reasoning attached. If a curated value changes, or the parser
 * improves and finds a different sentence, the message stops matching and the entry stops
 * applying — the drift reappears as unexplained and has to be ruled on again.
 *
 * THE COMMON THREAD is worth stating plainly, because it is the argument for keeping the
 * curated values: in five of these six the curated figure and the parsed figure come from
 * THE SAME DOCUMENT. A human read the label and took the sentence about the drug; the
 * regex read the label and took a sentence about a metabolite, an enantiomer, a different
 * drug class, or a different experiment. That is a limitation of reading prose with a
 * pattern, not a sign the curated value is wrong.
 */

export interface DriftAdjudication {
  drugId: string;
  /**
   * Substring that must appear in the drift message for this ruling to apply. Keeping it
   * a substring rather than a structured key means a ruling cannot silently outlive the
   * disagreement it was written about.
   */
  matches: string;
  /** Which value the emitted data uses. */
  verdict: 'curated stands' | 'SPL adopted';
  because: string;
}

export const DRIFT_ADJUDICATIONS: DriftAdjudication[] = [
  {
    drugId: 'esmolol',
    matches: 'terminal half-life',
    verdict: 'curated stands',
    because:
      'The sentence the parser matched is about the ACID METABOLITE, not about esmolol: "The acid ' +
      'metabolite has an elimination half-life of about 3.7 hours." Esmolol itself is hydrolysed by ' +
      'red-cell esterases with a half-life near 9 minutes, and that ultra-short duration is the entire ' +
      'clinical point of the drug — it is why it is given as an infusion and why it is chosen when a ' +
      'beta blocker may need to be stopped in a hurry. A 3.7 hour esmolol would misrepresent the one ' +
      'property it is selected for.',
  },
  {
    drugId: 'ketorolac',
    matches: 'terminal half-life',
    verdict: 'curated stands',
    because:
      'The label reports the two enantiomers separately — "approximately 2.5 hours for the ' +
      'S-enantiomer compared with 5 hours for the R-enantiomer" — and the parser took the first ' +
      'number in the sentence. Ketorolac is administered as a racemate, and the slower R-enantiomer ' +
      'dominates the terminal phase, so the curated 5.5 hours describes the drug that was actually ' +
      'given. Neither number is wrong; they are half-lives of different molecules.',
  },
  {
    drugId: 'metformin',
    matches: 'protein binding',
    verdict: 'curated stands',
    because:
      'A parse error on a sentence whose subject is a different drug class. The label says metformin ' +
      'is negligibly bound to plasma proteins and draws a contrast with the sulfonylureas, which are ' +
      'more than 90% bound; the regex matched inside the contrast clause. Metformin being essentially ' +
      'unbound is not a marginal reading of the label, it is the point the sentence is making.',
  },
  {
    drugId: 'hydromorphone',
    matches: 'protein binding',
    verdict: 'curated stands',
    because:
      'Both figures sit inside the published 8-20% range and the disagreement is an artefact of the ' +
      'tolerance being proportionally tight at small values: 0.135 against 0.200 trips a 0.4 ratio ' +
      'test that 0.55 against 0.80 would not. What the model consumes is the FREE fraction, 0.865 ' +
      'versus 0.800 — under 9% apart, which is far inside the spread of the affinity data it feeds. ' +
      'Kept as the curated value for consistency with the other opioids in the set rather than ' +
      'because it is measurably better.',
  },
  {
    drugId: 'cannabidiol',
    matches: 'terminal half-life',
    verdict: 'curated stands',
    because:
      'The two numbers describe two different experiments and both are real. The label figure is ' +
      '"56 to 61 hours after twice-daily dosing for 7 days" — a steady-state terminal estimate ' +
      'dominated by slow redistribution out of adipose tissue once the deep compartment is loaded. ' +
      'CORPUS administers single doses, where the observed plasma phase is nearer the curated 18 ' +
      'hours. Adopting the repeat-dose figure would give a single dose of cannabidiol a two-and-a-half ' +
      'day tail that nobody would measure after one dose.',
  },
  {
    drugId: 'methamphetamine',
    matches: 'terminal half-life',
    verdict: 'curated stands',
    because:
      'The label sentence is about a different quantity: "The BIOLOGICAL half-life has been reported ' +
      'in the range of 4 to 5 hours" is a duration of effect, not a plasma elimination half-life, and ' +
      'the parser cannot tell the two phrases apart. The curated 10.5 hours comes from a peer-reviewed ' +
      'clinical pharmacology review (Cruickshank and Dyer, Addiction 2009, "half-life 10-12 h"), which ' +
      'is a stronger source for a plasma constant than a label sentence about how long the effect ' +
      'lasts. This is also the only one of the six where the curated value does not come from the ' +
      'same document as the parse.',
  },
];

/** The ruling for a disagreement, or `null` if nobody has ruled on it yet. */
export function adjudicateDrift(drugId: string, message: string): DriftAdjudication | null {
  return (
    DRIFT_ADJUDICATIONS.find((a) => a.drugId === drugId && message.includes(a.matches)) ?? null
  );
}
