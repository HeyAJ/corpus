/* TEMPORARY reconnaissance helper for the receptor-mechanics fix. Deleted when done. */
import { Engine } from '../../src/sim/core/engine';
import { P } from '../../src/sim/core/constants';
import drugsFile from '../../src/data/drugs.json';
import type { DrugsFile } from '../../src/data/pharma-types';

const DRUGS = (drugsFile as unknown as DrugsFile).drugs;
const DT = P('sim.dt_s');

type Row = Record<string, number>;

interface Opts {
  seconds?: number;
  every?: number;
  receptor?: string;
  effect?: string;
  presetIndex?: number;
  /** Extra drug given at `at` seconds, by id + preset index. */
  then?: { drugId: string; presetIndex?: number; at: number };
}

function read(e: Engine, drugId: string | null, opts: Opts, t: number): Row {
  const s = e.snapshot();
  const st = e.state;
  const pk = drugId ? st.drugs.find((d) => d.drugId === drugId) : undefined;
  const ri = opts.receptor ? st.receptors.findIndex((r) => r.receptorId === opts.receptor) : -1;
  return {
    t,
    cp: pk?.cp ?? 0,
    occ: ri >= 0 ? st.receptors[ri].total : 0,
    act: ri >= 0 ? st.receptors[ri].activation : 0,
    eff: opts.effect ? (st.effects[opts.effect] ?? 0) : 0,
    hr: s.cardio.heartRate_bpm,
    map: s.cardio.map_mmHg,
    sbp: s.cardio.systolic_mmHg,
    co: s.cardio.cardiacOutput_L_per_min,
    rr: s.resp.rate_per_min,
    paco2: s.resp.paco2_mmHg,
    temp: s.metabolic.coreTemp_C,
    cons: s.neuro.consciousness,
    sed: s.neuro.sedationLevel,
    cbf: s.neuro.cerebralBloodFlow_mL_per_min,
    urine: s.renal.urineOutput_mL_per_min,
    gph: s.gi.gastricPh,
  };
}

function probe(drugId: string | null, opts: Opts = {}): Row[] {
  const seconds = opts.seconds ?? 900;
  const every = opts.every ?? 60;
  const e = new Engine(0x5eed);
  e.applyIntent({ type: 'IV_ACCESS', on: true } as never);
  if (drugId) {
    const drug = DRUGS.find((d) => d.id === drugId);
    if (!drug) throw new Error(`no drug ${drugId}`);
    const preset = drug.presetDoses[opts.presetIndex ?? 0];
    e.applyIntent({
      type: 'ADMINISTER', drugId, route: preset.route, dose: preset.amount,
      unit: preset.unit, durationMin: preset.durationMin,
    } as never);
  }

  const out: Row[] = [];
  const steps = Math.round(seconds / DT);
  const stride = Math.round(every / DT);
  let fired = false;
  for (let i = 0; i < steps; i++) {
    const t = i * DT;
    if (opts.then && !fired && t >= opts.then.at) {
      const d2 = DRUGS.find((d) => d.id === opts.then!.drugId)!;
      const p2 = d2.presetDoses[opts.then.presetIndex ?? 0];
      e.applyIntent({
        type: 'ADMINISTER', drugId: d2.id, route: p2.route, dose: p2.amount,
        unit: p2.unit, durationMin: p2.durationMin,
      } as never);
      fired = true;
    }
    e.tick(DT);
    e.pending.length = 0;
    if (i % stride === 0) out.push(read(e, drugId, opts, t));
  }
  return out;
}

function show(label: string, rows: Row[], keys: string[]): void {
  process.stdout.write(`\n## ${label}\n`);
  process.stdout.write('   t(s) ' + keys.map((k) => k.padStart(9)).join('') + '\n');
  for (const r of rows) {
    process.stdout.write(
      r.t.toFixed(0).padStart(7) + keys.map((k) => r[k].toFixed(3).padStart(9)).join('') + '\n',
    );
  }
}

const which = process.argv.slice(2);
const want = (s: string) => which.length === 0 || which.includes(s);
const V = ['cp', 'occ', 'act', 'eff'];

if (want('control')) show('CONTROL (no drug)', probe(null, { seconds: 3600, every: 600 }), ['hr', 'map', 'rr', 'paco2', 'temp', 'cons', 'sed', 'cbf', 'urine', 'gph']);
if (want('carvedilol')) show('carvedilol ORAL 12.5 mg', probe('carvedilol', { seconds: 7200, every: 900, receptor: 'beta1', effect: 'cardio.heartRate' }), [...V, 'hr', 'map', 'co']);
if (want('amfetamine')) show('amfetamine ORAL 10 mg', probe('amfetamine', { seconds: 7200, every: 900, receptor: 'net', effect: 'cardio.heartRate' }), [...V, 'hr', 'map', 'temp']);
if (want('duloxetine')) show('duloxetine ORAL 60 mg', probe('duloxetine', { seconds: 7200, every: 900, receptor: 'net', effect: 'cardio.heartRate' }), [...V, 'hr', 'map']);
if (want('risperidone')) show('risperidone ORAL 2 mg', probe('risperidone', { seconds: 7200, every: 900, receptor: 'ht2a', effect: 'thermal.heatProduction' }), [...V, 'cons', 'cbf', 'paco2', 'sed', 'temp']);
if (want('clozapine')) show('clozapine ORAL 100 mg', probe('clozapine', { seconds: 7200, every: 900, receptor: 'ht2a', effect: 'thermal.heatProduction' }), [...V, 'cons', 'cbf', 'paco2', 'sed']);
if (want('chlorpromazine')) show('chlorpromazine ORAL 50 mg', probe('chlorpromazine', { seconds: 7200, every: 900, receptor: 'ht2a', effect: 'thermal.heatProduction' }), [...V, 'cons', 'cbf', 'paco2']);
if (want('diazepam')) show('diazepam IV 5 mg', probe('diazepam', { seconds: 1800, every: 120, receptor: 'gaba_a_bz', effect: 'neuro.sedation' }), [...V, 'sed', 'cons', 'rr']);
if (want('midazolam')) show('midazolam IV 2 mg', probe('midazolam', { seconds: 1800, every: 120, receptor: 'gaba_a_bz', effect: 'neuro.sedation' }), [...V, 'sed', 'cons', 'rr']);
if (want('reversal')) show('midazolam IV 2 mg then flumazenil 0.2 mg at 300 s', probe('midazolam', { seconds: 900, every: 30, receptor: 'gaba_a_bz', effect: 'neuro.sedation', then: { drugId: 'flumazenil', at: 300 } }), [...V, 'sed', 'cons', 'rr']);
if (want('reversal-dz')) show('diazepam IV 5 mg then flumazenil 0.2 mg at 300 s', probe('diazepam', { seconds: 900, every: 30, receptor: 'gaba_a_bz', effect: 'neuro.sedation', then: { drugId: 'flumazenil', at: 300 } }), [...V, 'sed', 'cons', 'rr']);
if (want('reversal-pf')) show('propofol IV 140 mg then flumazenil 0.2 mg at 300 s', probe('propofol', { seconds: 900, every: 30, receptor: 'gaba_a_bz', effect: 'neuro.sedation', then: { drugId: 'flumazenil', at: 300 } }), [...V, 'sed', 'cons', 'rr']);
if (want('flumazenil')) show('flumazenil IV 0.2 mg alone', probe('flumazenil', { seconds: 900, every: 60, receptor: 'gaba_a_bz', effect: 'neuro.sedation' }), [...V, 'sed', 'cons', 'rr']);
if (want('milrinone')) show('milrinone IV_DRIP 5 mg/60 min', probe('milrinone', { seconds: 5400, every: 600, receptor: 'pde3', effect: 'cardio.contractility' }), [...V, 'hr', 'map', 'co']);
if (want('acetazolamide')) show('acetazolamide ORAL 250 mg', probe('acetazolamide', { seconds: 9000, every: 900, receptor: 'carbonic_anhydrase', effect: 'renal.waterReabsorption' }), [...V, 'urine', 'paco2', 'rr']);
if (want('ketorolac')) show('ketorolac IV 30 mg', probe('ketorolac', { seconds: 3600, every: 600, receptor: 'cox1', effect: 'gi.acidSecretion' }), [...V, 'gph', 'urine']);
if (want('ibuprofen')) show('ibuprofen ORAL', probe('ibuprofen', { seconds: 9000, every: 1200, receptor: 'cox1', effect: 'gi.acidSecretion' }), [...V, 'gph', 'urine']);
if (want('adenosine')) show('adenosine IV 6 mg', probe('adenosine', { seconds: 180, every: 5, receptor: 'a1', effect: 'cardio.avNodalBlock' }), [...V, 'hr', 'map']);
if (want('verapamil')) show('verapamil IV 5 mg', probe('verapamil', { seconds: 1800, every: 180, receptor: 'herg', effect: 'cardio.avNodalBlock' }), [...V, 'hr', 'map']);
if (want('dopamine')) show('dopamine IV_DRIP 21 mg/60 min', probe('dopamine', { seconds: 3600, every: 300, receptor: 'd1', effect: 'cardio.systemicResistance', presetIndex: 1 }), [...V, 'hr', 'map', 'co']);
if (want('mirtazapine')) show('mirtazapine ORAL 15 mg', probe('mirtazapine', { seconds: 9000, every: 1200, receptor: 'alpha2', effect: 'neuro.sedation' }), [...V, 'sed', 'hr', 'map']);
if (want('fluoxetine')) show('fluoxetine ORAL', probe('fluoxetine', { seconds: 9000, every: 1200, receptor: 'sert', effect: 'gi.motility' }), [...V, 'temp']);
if (want('amlodipine')) show('amlodipine ORAL 5 mg', probe('amlodipine', { seconds: 9000, every: 1200, receptor: 'cav', effect: 'cardio.systemicResistance' }), [...V, 'map', 'hr']);
if (want('phenytoin')) show('phenytoin', probe('phenytoin', { seconds: 3600, every: 600, receptor: 'nav', effect: 'cardio.conductionVelocity' }), [...V, 'hr', 'map']);
if (want('propranolol')) show('propranolol', probe('propranolol', { seconds: 3600, every: 600, receptor: 'beta1', effect: 'cardio.heartRate' }), [...V, 'hr', 'map', 'co']);
if (want('epinephrine')) show('epinephrine IV 1 mg', probe('epinephrine', { seconds: 600, every: 60, receptor: 'beta1', effect: 'cardio.heartRate' }), [...V, 'hr', 'map', 'co']);
if (want('albuterol')) show('albuterol', probe('albuterol', { seconds: 3600, every: 600, receptor: 'beta2', effect: 'resp.tidalVolume' }), [...V, 'hr', 'map']);
if (want('dobutamine')) show('dobutamine IV_DRIP', probe('dobutamine', { seconds: 3600, every: 600, receptor: 'beta1', effect: 'cardio.contractility' }), [...V, 'hr', 'map', 'co']);
if (want('dexmedetomidine')) show('dexmedetomidine', probe('dexmedetomidine', { seconds: 3600, every: 600, receptor: 'alpha2', effect: 'neuro.sedation' }), [...V, 'hr', 'map', 'sed']);
if (want('naloxone')) show('naloxone', probe('naloxone', { seconds: 1800, every: 300, receptor: 'mu', effect: 'resp.drive' }), [...V, 'rr', 'hr']);
if (want('atropine')) show('atropine IV', probe('atropine', { seconds: 1800, every: 300, receptor: 'm2', effect: 'cardio.heartRate' }), [...V, 'hr', 'map']);
if (want('furosemide')) show('furosemide IV', probe('furosemide', { seconds: 5400, every: 900, receptor: 'nkcc2', effect: 'renal.waterReabsorption' }), [...V, 'urine']);
if (want('celecoxib')) show('celecoxib ORAL', probe('celecoxib', { seconds: 9000, every: 1200, receptor: 'cox2', effect: 'thermal.setPoint' }), [...V, 'temp', 'gph']);
if (want('allopurinol')) show('allopurinol ORAL', probe('allopurinol', { seconds: 9000, every: 1200, receptor: 'xanthine_oxidase', effect: 'metabolic.urateProduction' }), [...V]);
if (want('haloperidol')) show('haloperidol', probe('haloperidol', { seconds: 7200, every: 900, receptor: 'd2', effect: 'cardio.qtInterval' }), [...V, 'hr', 'map', 'cons']);
if (want('olanzapine')) show('olanzapine', probe('olanzapine', { seconds: 7200, every: 900, receptor: 'ht2c', effect: 'thermal.heatProduction' }), [...V, 'cons', 'temp']);
if (want('sertraline')) show('sertraline', probe('sertraline', { seconds: 9000, every: 1200, receptor: 'sert', effect: 'gi.motility' }), [...V, 'temp']);
if (want('amitriptyline')) show('amitriptyline', probe('amitriptyline', { seconds: 9000, every: 1200, receptor: 'sert', effect: 'gi.motility' }), [...V, 'hr', 'map']);
if (want('spironolactone')) show('spironolactone', probe('spironolactone', { seconds: 9000, every: 1200, receptor: 'mineralocorticoid', effect: 'renal.sodiumReabsorption' }), [...V, 'urine']);
if (want('ketamine')) show('ketamine IV', probe('ketamine', { seconds: 1800, every: 300, receptor: 'nmda', effect: 'neuro.sedation' }), [...V, 'hr', 'map', 'cons']);
if (want('lidocaine')) show('lidocaine IV', probe('lidocaine', { seconds: 1800, every: 300, receptor: 'nav', effect: 'cardio.conductionVelocity' }), [...V, 'hr', 'map']);
if (want('nicotine')) show('nicotine', probe('nicotine', { seconds: 3600, every: 600, receptor: 'nachr', effect: 'cardio.heartRate' }), [...V, 'hr', 'map']);
if (want('theophylline')) show('theophylline', probe('theophylline', { seconds: 5400, every: 900, receptor: 'a1', effect: 'cardio.heartRate' }), [...V, 'hr', 'map']);
if (want('caffeine')) show('caffeine', probe('caffeine', { seconds: 5400, every: 900, receptor: 'a1', effect: 'cardio.heartRate' }), [...V, 'hr', 'map']);
if (want('montelukast')) show('montelukast', probe('montelukast', { seconds: 9000, every: 1200, receptor: 'cyslt1', effect: 'resp.bronchodilation' }), [...V]);
if (want('dexamethasone')) show('dexamethasone', probe('dexamethasone', { seconds: 9000, every: 1200, receptor: 'glucocorticoid', effect: 'immune.inflammation' }), [...V]);
if (want('thc')) show('thc', probe('thc', { seconds: 5400, every: 900, receptor: 'cb1', effect: 'neuro.sedation' }), [...V, 'hr', 'map']);
