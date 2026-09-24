/* TEMPORARY reconnaissance helper. Deleted before the pipeline change is finished. */
import { readFileSync } from 'node:fs';
import { parseTable } from './csv';
import { cleanName } from './fetch_gtopdb';

const INTERACTIONS =
  '.cache/ingest/www.guidetopharmacology.org_DATA_interactions.csv.3d6c7aef4e3469c4.txt';
const TARGETS =
  '.cache/ingest/www.guidetopharmacology.org_DATA_targets_and_families.csv.966ec49320118d41.txt';

const mode = process.argv[2];
const args = process.argv.slice(3);

const t = parseTable(readFileSync(INTERACTIONS, 'utf8'), 'Ligand ID');

interface Row {
  ligand: string;
  target: string;
  species: string;
  type: string;
  action: string;
  units: string;
  median: string;
  high: string;
  low: string;
}

const rows: Row[] = t.rows.map((r) => ({
  ligand: t.get(r, 'Ligand'),
  target: t.get(r, 'Target'),
  species: t.get(r, 'Target Species'),
  type: t.get(r, 'Type'),
  action: t.get(r, 'Action'),
  units: t.get(r, 'Affinity Units'),
  median: t.get(r, 'Affinity Median'),
  high: t.get(r, 'Affinity High'),
  low: t.get(r, 'Affinity Low'),
}));

function aff(r: Row): string {
  const p = r.median || r.high || r.low;
  return p ? `${r.units} ${p}` : '(no value)';
}

if (mode === 'ligand') {
  for (const name of args) {
    const key = cleanName(name);
    const hits = rows.filter((r) => cleanName(r.ligand) === key);
    const human = hits.filter((r) => r.species.toLowerCase() === 'human');
    const valued = human.filter((r) => r.median || r.high || r.low);
    process.stdout.write(`\n## ${name} — ${hits.length} rows, ${human.length} human, ${valued.length} with a value\n`);
    for (const r of valued) {
      process.stdout.write(`   ${cleanName(r.target).padEnd(34)} ${aff(r).padEnd(14)} ${r.type} / ${r.action}\n`);
    }
  }
} else if (mode === 'ligand-raw') {
  for (const name of args) {
    const key = cleanName(name);
    const human = rows.filter((r) => cleanName(r.ligand) === key && r.species.toLowerCase() === 'human');
    process.stdout.write(`\n## ${name}\n`);
    for (const r of human) {
      process.stdout.write(`   TARGET="${r.target}" ${aff(r)} ${r.type} / ${r.action}\n`);
    }
  }
} else if (mode === 'find-ligand') {
  const seen = new Set<string>();
  for (const r of rows) {
    for (const a of args) {
      if (r.ligand.toLowerCase().includes(a.toLowerCase()) && !seen.has(r.ligand)) {
        seen.add(r.ligand);
      }
    }
  }
  process.stdout.write([...seen].sort().join('\n') + '\n');
} else if (mode === 'find-target') {
  const counts = new Map<string, number>();
  for (const r of rows) {
    if (r.species.toLowerCase() !== 'human') continue;
    for (const a of args) {
      if (r.target.toLowerCase().includes(a.toLowerCase())) {
        counts.set(r.target, (counts.get(r.target) ?? 0) + 1);
      }
    }
  }
  for (const [k, v] of [...counts].sort((x, y) => y[1] - x[1])) {
    process.stdout.write(`${String(v).padStart(5)}  "${k}"  -> ${cleanName(k)}\n`);
  }
} else if (mode === 'target-ligands') {
  const key = cleanName(args[0]);
  const hits = rows.filter((r) => cleanName(r.target) === key && r.species.toLowerCase() === 'human');
  for (const r of hits) {
    process.stdout.write(`${r.ligand.padEnd(34)} ${aff(r).padEnd(14)} ${r.type} / ${r.action}\n`);
  }
} else if (mode === 'target-id') {
  const tt = parseTable(readFileSync(TARGETS, 'utf8'), 'Target id');
  for (const r of tt.rows) {
    for (const col of ['Target name', 'HGNC name', 'HGNC symbol']) {
      const n = tt.get(r, col);
      if (!n) continue;
      for (const a of args) {
        if (n.toLowerCase().includes(a.toLowerCase())) {
          process.stdout.write(`${tt.get(r, 'Target id')}  ${col}="${n}" -> ${cleanName(n)}\n`);
        }
      }
    }
  }
} else {
  process.stdout.write('modes: ligand | ligand-raw | find-ligand | find-target | target-ligands | target-id\n');
}
