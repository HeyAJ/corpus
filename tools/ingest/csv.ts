/**
 * RFC 4180 CSV parser. GtoPdb ships quoted fields containing commas, embedded
 * newlines and doubled quotes (assay descriptions are free prose), so a
 * `line.split(',')` is not an option — it silently shifts every column after the
 * first free-text field, which is exactly the class of error that produces a drug
 * that looks 70x too potent.
 */

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  // Strip a UTF-8 BOM if present.
  if (text.charCodeAt(0) === 0xfeff) i = 1;

  while (i < text.length) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ',') {
      row.push(field);
      field = '';
      i++;
      continue;
    }
    if (ch === '\r') {
      i++;
      continue;
    }
    if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i++;
      continue;
    }
    field += ch;
    i++;
  }

  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export interface Table {
  header: string[];
  rows: string[][];
  index: Map<string, number>;
  get(row: string[], column: string): string;
}

/**
 * Parse a CSV into a column-addressable table. `headerHint` names a column that
 * must be present, so a leading comment line (GtoPdb prefixes every download with
 * `# GtoPdb Version: ...`) is skipped rather than parsed as the header.
 */
export function parseTable(text: string, headerHint: string): Table {
  const raw = parseCsv(text);
  let headerRow = 0;
  for (let i = 0; i < Math.min(5, raw.length); i++) {
    if (raw[i].includes(headerHint)) {
      headerRow = i;
      break;
    }
  }
  const header = raw[headerRow];
  const index = new Map<string, number>();
  header.forEach((h, i) => index.set(h.trim(), i));
  if (!index.has(headerHint)) {
    throw new Error(`csv: expected a column named "${headerHint}"; found ${header.slice(0, 8).join(', ')}`);
  }
  const rows = raw.slice(headerRow + 1).filter((r) => r.length > 1);

  return {
    header,
    rows,
    index,
    get(row, column) {
      const i = index.get(column);
      return i === undefined ? '' : (row[i] ?? '').trim();
    },
  };
}
