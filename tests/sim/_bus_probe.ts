/* TEMPORARY SCRATCH PROBE — delete before finishing. */
import { Engine } from '../../src/sim/core/engine';
import { P } from '../../src/sim/core/constants';
import type { SimIntent } from '../../src/bridge/types';

const DT = P('sim.dt_s');

interface Give {
  id: string;
  route: string;
  dose: number;
  unit: string;
  label: string;
}

function give(g: Give, at = 10): { at: number; intent: SimIntent } {
  return {
    at,
    intent: {
      type: 'ADMINISTER',
      drugId: g.id,
      route: g.route,
      dose: g.dose,
      unit: g.unit,
      label: g.label,
    } as SimIntent,
  };
}

interface Row {
  t: number;
  eff: Record<string, number>;
  hr: number;
  map: number;
  co: number;
  urine: number;
  bladder: number;
  na: number;
  k: number;
  ca: number;
  temp: number;
  sedation: number;
  consciousness: number;
  rhythm: string;
  vol: number;
}

const WATCH = [
  'cardio.avNodalBlock',
  'cardio.arrhythmogenicity',
  'cardio.qtInterval',
  'cardio.conductionVelocity',
  'neuro.arousal',
  'neuro.sedation',
  'renal.sodiumReabsorption',
  'renal.potassiumExcretion',
  'renal.calciumReabsorption',
  'thermal.setPoint',
  'immune.inflammation',
];

export function probe(
  label: string,
  seconds: number,
  intents: { at: number; intent: SimIntent }[],
  sampleEvery = 5,
): Row[] {
  const engine = new Engine(0x5eed);
  const steps = Math.round(seconds / DT);
  const stride = Math.round(sampleEvery / DT);
  const pending = [...intents].sort((a, b) => a.at - b.at);
  let cursor = 0;
  const rows: Row[] = [];
  for (let i = 0; i < steps; i++) {
    const t = i * DT;
    while (cursor < pending.length && pending[cursor].at <= t) {
      engine.applyIntent(pending[cursor].intent);
      cursor++;
    }
    engine.tick(DT);
    engine.pending.length = 0;
    if (i % stride === 0) {
      const s = engine.state;
      const snap = engine.snapshot();
      const eff: Record<string, number> = {};
      for (const w of WATCH) eff[w] = s.effects[w] ?? 0;
      rows.push({
        t,
        eff,
        hr: snap.cardio.heartRate_bpm,
        map: snap.cardio.map_mmHg,
        co: snap.cardio.cardiacOutput_L_per_min,
        urine: snap.renal.urineOutput_mL_per_min,
        bladder: snap.renal.bladderVolume_mL,
        na: snap.chem.na_mEq_per_L,
        k: snap.chem.k_mEq_per_L,
        ca: snap.chem.caIonised_mmol_per_L,
        temp: snap.metabolic.coreTemp_C,
        sedation: snap.neuro.sedationLevel,
        consciousness: snap.neuro.consciousness,
        rhythm: snap.cardio.rhythm,
        vol: snap.cardio.bloodVolume_mL,
      });
    }
  }
  void label;
  return rows;
}

function peak(rows: Row[], key: string): number {
  let best = 0;
  for (const r of rows) if (Math.abs(r.eff[key]) > Math.abs(best)) best = r.eff[key];
  return best;
}

function extreme(rows: Row[], pick: (r: Row) => number, dir: 'min' | 'max'): number {
  const vals = rows.map(pick);
  return dir === 'min' ? Math.min(...vals) : Math.max(...vals);
}

const IV: { at: number; intent: SimIntent } = { at: 0, intent: { type: 'IV_ACCESS', on: true } as SimIntent };

const CASES: { name: string; g: Give; seconds: number }[] = [
  { name: 'adenosine 6 mg IV', g: { id: 'adenosine', route: 'IV_PUSH', dose: 6, unit: 'mg', label: '6 mg' }, seconds: 90 },
  { name: 'verapamil 5 mg IV', g: { id: 'verapamil', route: 'IV_PUSH', dose: 5, unit: 'mg', label: '5 mg' }, seconds: 600 },
  { name: 'digoxin 0.5 mg IV', g: { id: 'digoxin', route: 'IV_PUSH', dose: 0.5, unit: 'mg', label: '0.5 mg' }, seconds: 900 },
  { name: 'haloperidol 5 mg IM', g: { id: 'haloperidol', route: 'IM', dose: 5, unit: 'mg', label: '5 mg' }, seconds: 1800 },
  { name: 'olanzapine 10 mg IM', g: { id: 'olanzapine', route: 'IM', dose: 10, unit: 'mg', label: '10 mg' }, seconds: 3600 },
  { name: 'quetiapine 100 mg PO', g: { id: 'quetiapine', route: 'ORAL', dose: 100, unit: 'mg', label: '100 mg' }, seconds: 5400 },
  { name: 'diphenhydramine 25 mg IV', g: { id: 'diphenhydramine', route: 'IV_PUSH', dose: 25, unit: 'mg', label: '25 mg' }, seconds: 1800 },
  { name: 'mirtazapine 15 mg PO', g: { id: 'mirtazapine', route: 'ORAL', dose: 15, unit: 'mg', label: '15 mg' }, seconds: 5400 },
  { name: 'chlorpromazine 50 mg PO', g: { id: 'chlorpromazine', route: 'ORAL', dose: 50, unit: 'mg', label: '50 mg' }, seconds: 5400 },
  { name: 'chlorpromazine 25 mg IM', g: { id: 'chlorpromazine', route: 'IM', dose: 25, unit: 'mg', label: '25 mg IM' }, seconds: 3600 },
  { name: 'cocaine 25 mg IV', g: { id: 'cocaine', route: 'IV_PUSH', dose: 25, unit: 'mg', label: '25 mg' }, seconds: 900 },
  { name: 'bupivacaine 50 mg SC', g: { id: 'bupivacaine', route: 'SUBCUTANEOUS', dose: 50, unit: 'mg', label: '50 mg' }, seconds: 3600 },
  { name: 'phenytoin 1000 mg drip', g: { id: 'phenytoin', route: 'IV_DRIP', dose: 1000, unit: 'mg', label: '1000 mg' }, seconds: 3600 },
  { name: 'hydrochlorothiazide 25 mg PO', g: { id: 'hydrochlorothiazide', route: 'ORAL', dose: 25, unit: 'mg', label: '25 mg' }, seconds: 7200 },
  { name: 'spironolactone 25 mg PO', g: { id: 'spironolactone', route: 'ORAL', dose: 25, unit: 'mg', label: '25 mg' }, seconds: 7200 },
  { name: 'celecoxib 200 mg PO', g: { id: 'celecoxib', route: 'ORAL', dose: 200, unit: 'mg', label: '200 mg' }, seconds: 7200 },
  { name: 'caffeine 100 mg PO', g: { id: 'caffeine', route: 'ORAL', dose: 100, unit: 'mg', label: '100 mg' }, seconds: 3600 },
  { name: 'ketamine 140 mg IV', g: { id: 'ketamine', route: 'IV_PUSH', dose: 140, unit: 'mg', label: '2 mg/kg' }, seconds: 900 },
  { name: 'atropine 1 mg IV', g: { id: 'atropine', route: 'IV_PUSH', dose: 1, unit: 'mg', label: '1 mg' }, seconds: 900 },
  { name: 'epinephrine 1 mg IV', g: { id: 'epinephrine', route: 'IV_PUSH', dose: 1, unit: 'mg', label: '1 mg' }, seconds: 600 },
  { name: 'amitriptyline 25 mg PO', g: { id: 'amitriptyline', route: 'ORAL', dose: 25, unit: 'mg', label: '25 mg' }, seconds: 7200 },
];

function main(): void {
  const only = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const base = probe('control', 900, [IV], 5);
  process.stdout.write(
    `CONTROL  hr ${base[base.length - 1].hr.toFixed(1)}  map ${base[base.length - 1].map.toFixed(1)}  urine ${base[base.length - 1].urine.toFixed(3)}  na ${base[base.length - 1].na.toFixed(2)}  k ${base[base.length - 1].k.toFixed(3)}  ca ${base[base.length - 1].ca.toFixed(4)}  temp ${base[base.length - 1].temp.toFixed(3)}  sed ${base[base.length - 1].sedation.toFixed(3)}  cons ${base[base.length - 1].consciousness.toFixed(3)}\n\n`,
  );

  for (const c of CASES) {
    if (only.length > 0 && !only.some((o) => c.name.includes(o))) continue;
    const rows = probe(c.name, c.seconds, [IV, give(c.g)], 5);
    const last = rows[rows.length - 1];
    const parts: string[] = [];
    for (const w of WATCH) {
      const p = peak(rows, w);
      if (Math.abs(p) > 1e-6) parts.push(`${w.split('.')[1]}=${p.toFixed(3)}`);
    }
    const rhythms = [...new Set(rows.map((r) => r.rhythm))].join('/');
    process.stdout.write(
      `${c.name.padEnd(30)} ${parts.join(' ')}\n` +
        `   hrMin ${extreme(rows, (r) => r.hr, 'min').toFixed(1)} hrMax ${extreme(rows, (r) => r.hr, 'max').toFixed(1)}` +
        ` mapMin ${extreme(rows, (r) => r.map, 'min').toFixed(1)}` +
        ` urineMax ${extreme(rows, (r) => r.urine, 'max').toFixed(3)}` +
        ` bladder ${last.bladder.toFixed(1)}` +
        ` na ${last.na.toFixed(3)} k ${last.k.toFixed(4)} ca ${last.ca.toFixed(4)}` +
        ` temp ${last.temp.toFixed(3)} sedMax ${extreme(rows, (r) => r.sedation, 'max').toFixed(3)}` +
        ` consMin ${extreme(rows, (r) => r.consciousness, 'min').toFixed(3)} vol ${last.vol.toFixed(0)} rhythm ${rhythms}\n`,
    );
  }
}

main();
