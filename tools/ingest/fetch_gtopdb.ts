import { cachedFetch } from './cache';
import { parseTable, type Table } from './csv';
import { affinityKind, parseNumber, pXtoNanomolar, type AffinityKind } from './normalise';

/**
 * TIER-1 SOURCE: IUPHAR/BPS Guide to PHARMACOLOGY (GtoPdb).
 *
 * Expert-curated ligand-target affinities — exactly the dataset behind a receptor
 * occupancy panel. Database is ODbL; contents are CC BY-SA 4.0, so attribution is
 * required and lives in CREDITS.md (spec 5.6).
 *
 * The affinity columns are negative-log-molar, so every value goes through
 * `pXtoNanomolar` in normalise.ts. Nothing else in this file does arithmetic on a
 * unit, and nothing anywhere invents one: a ligand-target pair with no published
 * affinity produces no binding entry at all rather than a plausible guess.
 */

const BASE = 'https://www.guidetopharmacology.org/DATA';
export const GTOPDB_ATTRIBUTION =
  'IUPHAR/BPS Guide to PHARMACOLOGY (guidetopharmacology.org). Database ODbL; contents CC BY-SA 4.0.';
export const GTOPDB_URL = 'https://www.guidetopharmacology.org';

export interface GtopdbInteraction {
  targetName: string;
  targetId: number | null;
  targetSpecies: string;
  ligandName: string;
  ligandId: number | null;
  type: string;
  action: string;
  actionComment: string;
  affinityKind: AffinityKind;
  /** Median of the published range, in the original negative-log units. */
  pValue: number | null;
  /** Converted to nanomolar by normalise.pXtoNanomolar. */
  nM: number | null;
  pubmedId: string;
  endogenous: boolean;
  primaryTarget: boolean;
}

export interface GtopdbData {
  interactions: GtopdbInteraction[];
  /** Target name (lower case) -> target id. */
  targetIds: Map<string, number>;
  version: string;
}

export async function fetchGtopdb(offline: boolean): Promise<GtopdbData> {
  const interactionsCsv = (
    await cachedFetch(`${BASE}/interactions.csv`, { label: 'GtoPdb interactions.csv', offline })
  ).toString('utf8');
  const targetsCsv = (
    await cachedFetch(`${BASE}/targets_and_families.csv`, { label: 'GtoPdb targets_and_families.csv', offline })
  ).toString('utf8');

  const version = /# GtoPdb Version:\s*([^"\r\n]+)/.exec(interactionsCsv)?.[1]?.trim() ?? 'unknown';

  const interactions = parseTable(interactionsCsv, 'Ligand ID');
  const targets = parseTable(targetsCsv, 'Target id');

  const targetIds = new Map<string, number>();
  for (const row of targets.rows) {
    const id = parseNumber(targets.get(row, 'Target id'));
    if (id === null) continue;
    for (const key of ['Target name', 'HGNC name', 'Human Entrez Gene', 'HGNC symbol']) {
      const name = targets.get(row, key);
      if (name) targetIds.set(cleanName(name), id);
    }
  }

  return { interactions: readInteractions(interactions), targetIds, version };
}

function readInteractions(t: Table): GtopdbInteraction[] {
  const out: GtopdbInteraction[] = [];
  for (const row of t.rows) {
    // Human data only. A rodent Ki is a different number and mixing them silently is
    // precisely the kind of error the spec warns about.
    const species = t.get(row, 'Target Species');
    if (species && species.toLowerCase() !== 'human') continue;

    const units = t.get(row, 'Affinity Units');
    const kind = affinityKind(units);
    const median = parseNumber(t.get(row, 'Affinity Median'));
    const high = parseNumber(t.get(row, 'Affinity High'));
    const low = parseNumber(t.get(row, 'Affinity Low'));
    const p = median ?? (high !== null && low !== null ? (high + low) / 2 : (high ?? low));
    // GtoPdb leaves Median empty when a target has a single citation; High/Low then
    // carry the only published value. Dropping those rows loses most of the dataset.

    out.push({
      targetName: t.get(row, 'Target'),
      targetId: parseNumber(t.get(row, 'Target ID')),
      targetSpecies: species,
      ligandName: t.get(row, 'Ligand'),
      ligandId: parseNumber(t.get(row, 'Ligand ID')),
      type: t.get(row, 'Type'),
      action: t.get(row, 'Action'),
      actionComment: t.get(row, 'Action comment'),
      affinityKind: kind,
      pValue: p,
      nM: p !== null && kind !== 'unknown' ? pXtoNanomolar(p) : null,
      pubmedId: t.get(row, 'PubMed ID'),
      endogenous: t.get(row, 'Endogenous').toLowerCase() === 'true',
      primaryTarget: t.get(row, 'Primary Target').toLowerCase() === 'true',
    });
  }
  return out;
}

/**
 * GtoPdb target and ligand names are HTML fragments, not plain text:
 * `&alpha;<sub>1A</sub>-adrenoceptor`, `D<sub>1</sub> receptor`, `<i>GPR35</i>`.
 * Decode the entities, strip the tags, then collapse to a compact alphanumeric key
 * so `D<sub>1</sub> receptor` and `D1 receptor` compare equal — the subscript tag
 * would otherwise introduce a word break and silently break every subtype match.
 */
const ENTITIES: Record<string, string> = {
  alpha: 'alpha', beta: 'beta', gamma: 'gamma', delta: 'delta', epsilon: 'epsilon',
  kappa: 'kappa', lambda: 'lambda', mu: 'mu', sigma: 'sigma', omega: 'omega',
  plusmn: '', amp: 'and', quot: '', apos: '', nbsp: ' ', minus: '-', ndash: '-', mdash: '-',
};

export function cleanName(s: string): string {
  return s
    .replace(/<[^>]*>/g, '')
    .replace(/&([a-zA-Z]+);/g, (_, e: string) => ENTITIES[e.toLowerCase()] ?? ' ')
    .replace(/&#\d+;/g, ' ')
    .toLowerCase()
    .replace(/α/g, 'alpha')
    .replace(/β/g, 'beta')
    .replace(/γ/g, 'gamma')
    .replace(/δ/g, 'delta')
    .replace(/κ/g, 'kappa')
    .replace(/μ/g, 'mu')
    .replace(/[^a-z0-9]+/g, '');
}

/** All interactions for one ligand, matched by name or alias. */
export function interactionsForLigand(data: GtopdbData, names: string[]): GtopdbInteraction[] {
  const keys = new Set(names.map(cleanName));
  return data.interactions.filter((i) => keys.has(cleanName(i.ligandName)));
}
