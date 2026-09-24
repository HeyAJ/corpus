import { inflateRawSync } from 'node:zlib';

/**
 * Minimal XLSX reader — no dependencies (spec 0.5: the stack in section 2 is fixed).
 *
 * An .xlsx is a ZIP of XML. Node already ships raw-deflate in `zlib`, so the whole
 * reader is a central-directory walk plus enough of SpreadsheetML to pull a cell
 * grid out of a worksheet. That is a couple of hundred lines and it keeps
 * `tools/ingest` buildable from a clean checkout with nothing but Node.
 *
 * The one subtlety that will bite anyone writing this from scratch: a worksheet is
 * full of SELF-CLOSING cells (`<c r="AM8" s="89"/>`). A naive
 * `/<c r="..."[^>]*>(.*?)<\/c>/` regex skips straight past them and attributes a
 * later cell's value to an earlier cell's address, silently shifting entire
 * columns. The cell regex below matches both forms.
 */

interface ZipEntry {
  name: string;
  data: Buffer;
}

function readZip(buf: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>();

  // Locate the End Of Central Directory record by scanning backwards for its magic.
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 70000; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('xlsx: not a zip file (no end-of-central-directory record)');

  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);

  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('xlsx: bad central directory signature');
    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);

    // The local header repeats the name/extra lengths, and they can differ from the
    // central directory's, so read them from the local header.
    const lNameLen = buf.readUInt16LE(localOffset + 26);
    const lExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(dataStart, dataStart + compressedSize);

    const entry: ZipEntry = {
      name,
      data: method === 0 ? Buffer.from(raw) : inflateRawSync(raw),
    };
    out.set(entry.name, entry.data);

    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/** Matches both `<c .../>` and `<c ...>…</c>`. */
const CELL_RE = /<c r="([A-Z]+)(\d+)"((?:[^>"]|"[^"]*")*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
const ROW_RE = /<row[^>]*>([\s\S]*?)<\/row>/g;
const SI_RE = /<si>([\s\S]*?)<\/si>/g;
const T_RE = /<t[^>]*>([\s\S]*?)<\/t>/g;

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, '&');
}

export interface Sheet {
  name: string;
  /** `grid.get(row)?.get('AL')`. Empty cells are absent, never empty strings. */
  grid: Map<number, Map<string, string>>;
  maxRow: number;
}

export interface Workbook {
  sheets: Map<string, Sheet>;
}

export function readXlsx(buf: Buffer): Workbook {
  const files = readZip(buf);

  const sharedXml = files.get('xl/sharedStrings.xml')?.toString('utf8') ?? '';
  const shared: string[] = [];
  SI_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = SI_RE.exec(sharedXml))) {
    let text = '';
    T_RE.lastIndex = 0;
    let tm: RegExpExecArray | null;
    while ((tm = T_RE.exec(m[1]))) text += tm[1];
    shared.push(decodeEntities(text));
  }

  const relsXml = files.get('xl/_rels/workbook.xml.rels')?.toString('utf8') ?? '';
  const rels = new Map<string, string>();
  for (const rm of relsXml.matchAll(/Id="(rId\d+)"[^>]*?Target="([^"]+)"/g)) {
    rels.set(rm[1], rm[2].replace(/^\/?xl\//, '').replace(/^\//, ''));
  }

  const wbXml = files.get('xl/workbook.xml')?.toString('utf8') ?? '';
  const sheets = new Map<string, Sheet>();

  for (const sm of wbXml.matchAll(/<sheet[^>]*name="([^"]+)"[^>]*r:id="(rId\d+)"[^>]*\/?>/g)) {
    const name = decodeEntities(sm[1]);
    const target = rels.get(sm[2]);
    if (!target) continue;
    const xml = files.get('xl/' + target)?.toString('utf8');
    if (!xml) continue;
    sheets.set(name, parseSheet(name, xml, shared));
  }

  return { sheets };
}

function parseSheet(name: string, xml: string, shared: string[]): Sheet {
  const grid = new Map<number, Map<string, string>>();
  let maxRow = 0;

  ROW_RE.lastIndex = 0;
  let rm: RegExpExecArray | null;
  while ((rm = ROW_RE.exec(xml))) {
    CELL_RE.lastIndex = 0;
    let cm: RegExpExecArray | null;
    while ((cm = CELL_RE.exec(rm[1]))) {
      const col = cm[1];
      const row = Number(cm[2]);
      const attrs = cm[3] ?? '';
      const body = cm[4] ?? '';
      if (!body) continue;

      let value: string;
      const v = /<v>([\s\S]*?)<\/v>/.exec(body);
      if (v) {
        value = v[1];
        if (/\bt="s"/.test(attrs)) {
          const idx = Number(value);
          value = Number.isFinite(idx) ? (shared[idx] ?? '') : '';
        } else {
          value = decodeEntities(value);
        }
      } else {
        const t = /<t[^>]*>([\s\S]*?)<\/t>/.exec(body);
        value = t ? decodeEntities(t[1]) : '';
      }

      if (value === '') continue;
      let r = grid.get(row);
      if (!r) {
        r = new Map();
        grid.set(row, r);
      }
      r.set(col, value);
      if (row > maxRow) maxRow = row;
    }
  }
  return { name, grid, maxRow };
}

export function colToNumber(col: string): number {
  let n = 0;
  for (let i = 0; i < col.length; i++) n = n * 26 + (col.charCodeAt(i) - 64);
  return n;
}

export function numberToCol(n: number): string {
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export function cell(sheet: Sheet, row: number, col: string): string | undefined {
  return sheet.grid.get(row)?.get(col);
}
