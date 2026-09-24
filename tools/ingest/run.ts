import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { fetchGtopdb } from './fetch_gtopdb';
import { fetchPulse } from './fetch_pulse';
import { fetchPubchem } from './fetch_pubchem';
import { fetchSpl, type SplCandidate } from './parse_spl';
import { MANIFEST } from './drug_manifest';
import { emit, DEFAULT_KON } from './emit';
import { writeMissingConstants } from './report';
import type { DrugsFile, ReceptorsFile } from '../../src/data/pharma-types';

/**
 * INGESTION PIPELINE ORCHESTRATOR (spec 5.6).
 *
 *   npm run ingest            fetch (with disk cache) and regenerate
 *   npm run ingest:offline    regenerate from cache only; fails if anything is missing
 *
 * Re-running must be idempotent and must diff cleanly against the committed
 * data/*.json. `generatedAt` is therefore NOT a timestamp — a timestamp would make
 * every run produce a diff and would destroy the only signal that matters, which is
 * "did the upstream data change". The GtoPdb version string is recorded instead.
 */

const ROOT = join(import.meta.dirname ?? process.cwd(), '..', '..');

async function main(): Promise<void> {
  const offline = process.argv.includes('--offline');

  process.stdout.write('CORPUS ingestion pipeline\n');
  process.stdout.write(offline ? '  mode: offline (cache only)\n\n' : '  mode: online (cached)\n\n');

  process.stdout.write('Tier 1 — receptor binding\n');
  const gtopdb = await fetchGtopdb(offline);
  process.stdout.write(`  GtoPdb version ${gtopdb.version}, ${gtopdb.interactions.length} human interactions\n\n`);

  process.stdout.write('Tier 2 — pharmacokinetics\n');
  const pulse = await fetchPulse(offline);
  process.stdout.write(`  Pulse substance table: ${pulse.substances.size} substances\n`);

  // Computed physicochemical descriptors. These decide central versus peripheral
  // receptor access, so a drug missing here has its central effects applied in full.
  const pubchem = await fetchPubchem(
    MANIFEST.map((m) => ({
      id: m.id,
      names: [m.pulseName ?? '', m.displayName, m.id.replace(/_/g, ' '), ...(m.pubchemAliases ?? [])].filter(Boolean),
    })),
    offline,
  );
  process.stdout.write(`  PubChem descriptors: ${pubchem.size}/${MANIFEST.length} compounds resolved
`);

  const spl = new Map<string, SplCandidate>();
  for (const m of MANIFEST) {
    const generic = m.displayName.toLowerCase().replace(/\s+/g, ' ');
    try {
      spl.set(m.id, await fetchSpl(generic, offline));
    } catch (e) {
      process.stdout.write(`  (skip) SPL for ${m.id}: ${(e as Error).message}\n`);
    }
  }
  const found = [...spl.values()].filter((s) => s.found).length;
  process.stdout.write(`  openFDA labels: ${found}/${MANIFEST.length} parsed\n\n`);

  process.stdout.write('Merging and emitting\n');
  const result = emit(gtopdb, pulse, spl, pubchem);

  const drugsFile: DrugsFile = {
    version: 1,
    generatedBy: 'tools/ingest/run.ts',
    generatedAt: `GtoPdb ${gtopdb.version}`,
    attribution: result.attribution,
    drugs: result.drugs,
  };

  const receptorsFile: ReceptorsFile = {
    version: 1,
    generatedBy: 'tools/ingest/run.ts',
    generatedAt: `GtoPdb ${gtopdb.version}`,
    attribution: result.attribution,
    defaultKon: DEFAULT_KON as ReceptorsFile['defaultKon'],
    receptors: result.receptors,
  };

  writeFileSync(join(ROOT, 'src', 'data', 'drugs.json'), JSON.stringify(drugsFile, null, 2) + '\n', 'utf8');
  writeFileSync(join(ROOT, 'src', 'data', 'receptors.json'), JSON.stringify(receptorsFile, null, 2) + '\n', 'utf8');
  writeMissingConstants(ROOT, result);

  /* ------------------------------------------------------------- summary */
  const withTargets = result.drugs.filter((d) => d.targets.length > 0).length;
  const totalTargets = result.drugs.reduce((n, d) => n + d.targets.length, 0);
  const simulatable = result.drugs.filter((d) => d.pk.V1_L !== null || d.payload).length;
  const mappedReceptors = result.receptors.filter((r) => r.gtopdbTargetId !== null).length;

  process.stdout.write(`  src/data/drugs.json      ${result.drugs.length} drugs, ${totalTargets} receptor targets\n`);
  process.stdout.write(`  src/data/receptors.json  ${result.receptors.length} receptors (${mappedReceptors} resolved to a GtoPdb target id)\n`);
  process.stdout.write(`  docs/MISSING_CONSTANTS.md  ${result.missing.length} missing fields, ${result.drift.length} unadjudicated cross-check disagreements (${result.adjudicatedDrift.length} adjudicated)\n\n`);

  process.stdout.write(`  ${withTargets}/${result.drugs.length} drugs have at least one sourced receptor affinity\n`);
  process.stdout.write(`  ${simulatable}/${result.drugs.length} drugs are simulatable (have V1 or a direct payload)\n`);

  for (const d of result.drugs) {
    const flag = d.pk.V1_L === null && !d.payload ? ' !!' : '';
    process.stdout.write(
      `    ${d.id.padEnd(20)} targets=${String(d.targets.length).padStart(2)}  V1=${fmt(d.pk.V1_L)}  k10=${fmt(d.pk.k10_min)}${flag}\n`,
    );
  }

  if (result.drift.length > 0) {
    process.stdout.write('\n  UNADJUDICATED cross-check disagreements - rule on these in drift_adjudication.ts:\n');
    for (const d of result.drift) process.stdout.write(`    ${d.drugId}: ${d.message}\n`);
  } else {
    process.stdout.write('\n  No unadjudicated cross-check disagreements.\n');
  }
  if (result.adjudicatedDrift.length > 0) {
    process.stdout.write(`  ${result.adjudicatedDrift.length} adjudicated (reasoning in docs/MISSING_CONSTANTS.md section 5.1):\n`);
    for (const d of result.adjudicatedDrift) process.stdout.write(`    ${d.drugId}: ${d.verdict}\n`);
  }
}

function fmt(v: number | null): string {
  if (v === null) return '   —  ';
  if (v >= 1000) return v.toExponential(2);
  if (v < 0.001) return v.toExponential(2);
  return v.toPrecision(4).padStart(6);
}

main().catch((e) => {
  process.stderr.write(`\nINGEST FAILED: ${(e as Error).stack ?? e}\n`);
  process.exit(1);
});
