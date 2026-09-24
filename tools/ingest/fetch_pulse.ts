import { cachedFetch } from './cache';
import { cell, colToNumber, numberToCol, readXlsx, type Sheet } from './xlsx';
import { parseValueWithUnit } from './normalise';

/**
 * TIER-2 SOURCE: the Pulse Physiology Engine substance table.
 *
 * Pulse is Apache-2.0 — permissive, commercial-use-safe, no share-alike — and it
 * ships one substance definition per drug with physicochemical properties, PBPK
 * parameters, and a pharmacodynamic block whose Emax form is the same one this
 * engine uses (spec 5.6). We take the data and the equations; we do not compile the
 * engine (spec 7.6).
 *
 * The table lives in `data/Data.xlsx`, sheet "Substances", and it is TRANSPOSED:
 * column A holds property names and every substance occupies a four-column block
 * (value, reference id, reference source, notes) with the block's name repeated
 * across all four cells of row 2.
 */

const PROJECT = 1571; // gitlab.kitware.com/physiology/engine
const BLOB_URL = `https://gitlab.kitware.com/api/v4/projects/${PROJECT}/repository/files/data%2FData.xlsx/raw?ref=stable`;
export const PULSE_ATTRIBUTION =
  'Pulse Physiology Engine (Kitware Inc.), Apache License 2.0 — https://pulse.kitware.com';
export const PULSE_SOURCE_URL = 'https://gitlab.kitware.com/physiology/engine/-/blob/stable/data/Data.xlsx';

export interface PulseSubstance {
  name: string;
  values: Map<string, string>;
  /** Reference note per property, where the sheet supplies one. */
  references: Map<string, string>;
}

export interface PulseData {
  substances: Map<string, PulseSubstance>;
  /** Nutrition sheet: used by data/foods.json. */
  nutrition: Map<string, Map<string, string>>;
}

function blockStarts(sheet: Sheet): { name: string; col: string }[] {
  const row2 = sheet.grid.get(2);
  if (!row2) throw new Error('pulse: Substances sheet has no name row');

  const byNumber: { n: number; name: string }[] = [];
  for (const [col, value] of row2) {
    byNumber.push({ n: colToNumber(col), name: value.trim() });
  }
  byNumber.sort((a, b) => a.n - b.n);

  const out: { name: string; col: string }[] = [];
  let previous = '';
  for (const e of byNumber) {
    if (!e.name || e.name === 'Name') {
      previous = e.name;
      continue;
    }
    if (e.name !== previous) out.push({ name: e.name, col: numberToCol(e.n) });
    previous = e.name;
  }
  return out;
}

/**
 * Property names repeat down column A (FractionUnboundInPlasma appears in both the
 * clearance and the pharmacokinetics blocks), so the key carries its row when it is
 * a duplicate. Callers ask for the plain name and get the first non-empty match.
 */
function readBlock(sheet: Sheet, col: string): { values: Map<string, string>; references: Map<string, string> } {
  const values = new Map<string, string>();
  const references = new Map<string, string>();
  const refCol = numberToCol(colToNumber(col) + 2);

  for (let row = 3; row <= sheet.maxRow; row++) {
    const prop = cell(sheet, row, 'A');
    if (!prop) continue;
    const key = prop.trim();
    const v = cell(sheet, row, col);
    if (v === undefined) continue;
    // Section header rows carry the literal header text rather than a value.
    if (v === 'Reference Source' || v === 'Notes/Page') continue;
    if (!values.has(key)) values.set(key, v);
    const ref = cell(sheet, row, refCol);
    if (ref && ref !== 'Reference Source' && !references.has(key)) references.set(key, ref);
  }
  return { values, references };
}

export async function fetchPulse(offline: boolean): Promise<PulseData> {
  const buf = await cachedFetch(BLOB_URL, { label: 'Pulse Data.xlsx', offline, binary: true });
  const wb = readXlsx(buf);

  const substancesSheet = wb.sheets.get('Substances');
  if (!substancesSheet) throw new Error('pulse: workbook has no "Substances" sheet');

  const substances = new Map<string, PulseSubstance>();
  for (const { name, col } of blockStarts(substancesSheet)) {
    const { values, references } = readBlock(substancesSheet, col);
    substances.set(name.toLowerCase(), { name, values, references });
  }

  const nutrition = new Map<string, Map<string, string>>();
  const nutritionSheet = wb.sheets.get('Nutrition');
  if (nutritionSheet) {
    for (const { name, col } of blockStarts(nutritionSheet)) {
      nutrition.set(name.toLowerCase(), readBlock(nutritionSheet, col).values);
    }
  }

  return { substances, nutrition };
}

/** Numeric property with its unit stripped, or null when absent or non-finite. */
export function pulseNumber(sub: PulseSubstance | undefined, key: string): number | null {
  if (!sub) return null;
  const raw = sub.values.get(key);
  if (raw === undefined) return null;
  const parsed = parseValueWithUnit(raw);
  return parsed ? parsed.value : null;
}

export function pulseUnit(sub: PulseSubstance | undefined, key: string): string | null {
  if (!sub) return null;
  const raw = sub.values.get(key);
  if (raw === undefined) return null;
  const parsed = parseValueWithUnit(raw);
  return parsed ? parsed.unit : null;
}
