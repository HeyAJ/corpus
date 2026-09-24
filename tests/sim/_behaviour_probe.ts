import { Engine } from '../../src/sim/core/engine';
import { P } from '../../src/sim/core/constants';
import { effect } from '../../src/sim/core/effects';
import type { SimIntent } from '../../src/bridge/types';
import type { SimState } from '../../src/sim/core/state';

const DT = P('sim.dt_s');

interface Row {
  t: number;
  hr: number;
  map: number;
  sbp: number;
  dbp: number;
  co: number;
  rr: number;
  vt: number;
  ve: number;
  paco2: number;
  pao2: number;
  spo2: number;
  temp: number;
  glucose: number;
  cortisol: number;
  exertion: number;
  debt: number;
  depth: number;
  fright: number;
}

function probe(label: string, intents: { at: number; intent: SimIntent }[], seconds: number, every: number): Row[] {
  const e = new Engine(0x5eed);
  const pending = [...intents].sort((a, b) => a.at - b.at);
  let cursor = 0;
  const rows: Row[] = [];
  const steps = Math.round(seconds / DT);
  const stride = Math.round(every / DT);
  for (let i = 0; i < steps; i++) {
    const t = i * DT;
    while (cursor < pending.length && pending[cursor].at <= t) {
      e.applyIntent(pending[cursor].intent);
      cursor++;
    }
    e.tick(DT);
    e.pending.length = 0;
    if (i % stride === 0) {
      const s = e.state;
      rows.push({
        t,
        hr: s.cardio.hr,
        map: s.cardio.map,
        sbp: s.cardio.sbp,
        dbp: s.cardio.dbp,
        co: s.cardio.co,
        rr: s.resp.rate,
        vt: s.resp.tidalVolume,
        ve: (s.resp.rate * s.resp.tidalVolume) / 1000,
        paco2: s.resp.arterialPco2,
        pao2: s.resp.arterialPo2,
        spo2: s.resp.spo2,
        temp: s.metabolic.coreTemp,
        glucose: s.metabolic.G,
        cortisol: s.endocrine.hormones['cortisol']?.level ?? 0,
        exertion: s.activity.exertion,
        debt: s.activity.oxygenDebt_L,
        depth: s.activity.sleepDepth,
        fright: s.affect.fright,
      });
    }
  }
  console.log(`\n=== ${label} ===`);
  for (const r of rows) {
    console.log(
      `t=${r.t.toFixed(0).padStart(5)}s hr=${r.hr.toFixed(1).padStart(5)} map=${r.map.toFixed(0).padStart(3)} ` +
        `sbp/dbp=${r.sbp.toFixed(0)}/${r.dbp.toFixed(0)} co=${r.co.toFixed(1)} rr=${r.rr.toFixed(1).padStart(4)} ` +
        `vt=${r.vt.toFixed(0).padStart(4)} ve=${r.ve.toFixed(1).padStart(5)} paco2=${r.paco2.toFixed(1)} ` +
        `pao2=${r.pao2.toFixed(0)} spo2=${(r.spo2 * 100).toFixed(1)} T=${r.temp.toFixed(2)} ` +
        `glu=${r.glucose.toFixed(0)} cort=${r.cortisol.toFixed(1)} | x=${r.exertion.toFixed(3)} ` +
        `debt=${r.debt.toFixed(2)}L depth=${r.depth.toFixed(2)} fright=${r.fright.toFixed(2)}`,
    );
  }
  return rows;
}

// SCRATCH PROBE - not a test (no assertions; see tests/sim/behaviour.test.ts for those).
// Run with: npx vite-node tests/sim/_behaviour_probe.ts
// Each call below used to be wrapped in a vitest `it(...)` so it would only ever run
// under the test runner; it never carried an assertion, so that wrapping bought nothing
// but the ability to execute it by accident as part of `npm test`. Plain calls, run via
// vite-node, are what this file actually is: an eyeball probe.

probe('BASELINE 10 min', [], 600, 120);

probe(
  'EXERTION 1.0 for 5 min then stop',
  [
    { at: 5, intent: { type: 'SET_EXERTION', level: 1 } },
    { at: 305, intent: { type: 'SET_EXERTION', level: 0 } },
  ],
  900,
  30,
);

probe(
  'EXERTION 0.5 for 10 min',
  [{ at: 5, intent: { type: 'SET_EXERTION', level: 0.5 } }],
  700,
  60,
);

probe(
  'SLEEP for 60 min',
  [{ at: 10, intent: { type: 'SET_SLEEP', asleep: true } }],
  3700,
  300,
);

probe(
  'SLEEP for 20 min, then 4 mg IV morphine at t=20 min',
  [
    { at: 10, intent: { type: 'SET_SLEEP', asleep: true } },
    {
      at: 1200,
      intent: { type: 'ADMINISTER', drugId: 'morphine', route: 'IV_PUSH', dose: 4, unit: 'mg', label: '4 mg' },
    },
  ],
  3600,
  300,
);

probe(
  'FRIGHTEN 1.0',
  [{ at: 30, intent: { type: 'FRIGHTEN', intensity: 1 } }],
  600,
  20,
);

probe(
  'STRESS 1.0 for 60 min',
  [{ at: 10, intent: { type: 'SET_AFFECT', stress: 1 } }],
  3600,
  600,
);

/* ======================================================================
 * TARGETED COMPARISONS. Each one runs two or three engines with the same
 * seed and diffs them at matching timestamps, which is the only honest way
 * to answer "did this do anything" - a single trace can be circadian drift,
 * baroreflex ripple or respiratory sinus arrhythmia wearing a costume.
 * ====================================================================== */

function runTo(intents: { at: number; intent: SimIntent }[], seconds: number): Engine {
  const e = new Engine(0x5eed);
  const pending = [...intents].sort((a, b) => a.at - b.at);
  let cursor = 0;
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) {
    const t = i * DT;
    while (cursor < pending.length && pending[cursor].at <= t) {
      e.applyIntent(pending[cursor].intent);
      cursor++;
    }
    e.tick(DT);
    e.pending.length = 0;
  }
  return e;
}

function sampleSeries(
  intents: { at: number; intent: SimIntent }[],
  seconds: number,
  every: number,
  pick: (s: SimState) => number,
): number[] {
  const e = new Engine(0x5eed);
  const pending = [...intents].sort((a, b) => a.at - b.at);
  let cursor = 0;
  const steps = Math.round(seconds / DT);
  const stride = Math.round(every / DT);
  const out: number[] = [];
  for (let i = 0; i < steps; i++) {
    const t = i * DT;
    while (cursor < pending.length && pending[cursor].at <= t) {
      e.applyIntent(pending[cursor].intent);
      cursor++;
    }
    e.tick(DT);
    e.pending.length = 0;
    if (i % stride === 0) out.push(pick(e.state));
  }
  return out;
}

console.log('\n\n########## TARGETED COMPARISONS ##########');

// --- 1. SET_EXERTION 0.7, exactly the task's own test level -----------------
{
  console.log('\n--- SET_EXERTION 0.7: VO2/VCO2 multiple (from the thermal.heatProduction bus value), CO, HR, VE ---');
  const rest = new Engine(0x5eed);
  rest.tick(DT);
  const vo2Rest = P('resp.vo2_mL_per_min');
  const vco2Rest = P('resp.vco2_mL_per_min');
  const e = new Engine(0x5eed);
  e.applyIntent({ type: 'SET_EXERTION', level: 0.7 });
  const steps = Math.round(360 / DT);
  for (let i = 0; i < steps; i++) {
    e.tick(DT);
    e.pending.length = 0;
    if (i % Math.round(30 / DT) === 0) {
      const s = e.state;
      const met = 1 + effect(s, 'thermal.heatProduction');
      console.log(
        `t=${(i * DT).toFixed(0).padStart(4)}s x=${s.activity.exertion.toFixed(3)} met x${met.toFixed(2)} ` +
          `VO2=${(vo2Rest * met).toFixed(0)}mL/min VCO2=${(vco2Rest * met).toFixed(0)}mL/min ` +
          `hr=${s.cardio.hr.toFixed(0)} co=${s.cardio.co.toFixed(2)} ve=${((s.resp.rate * s.resp.tidalVolume) / 1000).toFixed(1)} ` +
          `debt=${s.activity.oxygenDebt_L.toFixed(2)}L`,
      );
    }
  }
}

// --- 2. STRESS -> cortisol: isolate the HPA claim from circadian settling ---
{
  console.log('\n--- STRESS=1 vs NO STRESS, same seed/duration/sampling: cortisol, HR, MAP ---');
  const every = 600;
  const seconds = 3600;
  const base = {
    hr: sampleSeries([], seconds, every, (s) => s.cardio.hr),
    map: sampleSeries([], seconds, every, (s) => s.cardio.map),
    cort: sampleSeries([], seconds, every, (s) => s.endocrine.hormones['cortisol']?.level ?? 0),
    stressAxis: sampleSeries([], seconds, every, (s) => s.endocrine.stressAxis),
  };
  const stressed = {
    hr: sampleSeries([{ at: 10, intent: { type: 'SET_AFFECT', stress: 1 } }], seconds, every, (s) => s.cardio.hr),
    map: sampleSeries([{ at: 10, intent: { type: 'SET_AFFECT', stress: 1 } }], seconds, every, (s) => s.cardio.map),
    cort: sampleSeries(
      [{ at: 10, intent: { type: 'SET_AFFECT', stress: 1 } }],
      seconds,
      every,
      (s) => s.endocrine.hormones['cortisol']?.level ?? 0,
    ),
    stressAxis: sampleSeries(
      [{ at: 10, intent: { type: 'SET_AFFECT', stress: 1 } }],
      seconds,
      every,
      (s) => s.endocrine.stressAxis,
    ),
  };
  for (let i = 0; i < base.hr.length; i++) {
    const t = i * every;
    console.log(
      `t=${t.toString().padStart(4)}s  ` +
        `HR base=${base.hr[i].toFixed(1)} stress=${stressed.hr[i].toFixed(1)} (d=${(stressed.hr[i] - base.hr[i]).toFixed(1)})  ` +
        `MAP base=${base.map[i].toFixed(1)} stress=${stressed.map[i].toFixed(1)} (d=${(stressed.map[i] - base.map[i]).toFixed(1)})  ` +
        `cortisol base=${base.cort[i].toFixed(2)} stress=${stressed.cort[i].toFixed(2)} (d=${(stressed.cort[i] - base.cort[i]).toFixed(3)})  ` +
        `endocrine.stressAxis base=${base.stressAxis[i].toFixed(4)} stress=${stressed.stressAxis[i].toFixed(4)}`,
    );
  }
  console.log(
    'If endocrine.stressAxis is identical between the two columns, `neuro.stressAxis` (written by ' +
      'affect.ts) is not reaching systems/endocrine.ts, and any cortisol difference above is circadian ' +
      'settling, not a stress effect.',
  );
}

// --- 3. Sleep + morphine: does the depression COMPOSE, or just coincide? ---
{
  console.log('\n--- Respiratory depression: sleep alone vs morphine alone vs both together ---');
  const give: { at: number; intent: SimIntent } = {
    at: 1200,
    intent: { type: 'ADMINISTER', drugId: 'morphine', route: 'IV_PUSH', dose: 4, unit: 'mg', label: '4 mg' },
  };
  const sleepOn: { at: number; intent: SimIntent } = { at: 10, intent: { type: 'SET_SLEEP', asleep: true } };

  const measure = (intents: { at: number; intent: SimIntent }[]) => {
    const seconds = 2700; // 45 min: 20 min to let sleep depth develop, then 25 min post-dose
    const every = 10;
    const rr = sampleSeries(intents, seconds, every, (s) => s.resp.rate);
    const co2 = sampleSeries(intents, seconds, every, (s) => s.resp.arterialPco2);
    // Only look from the moment morphine is (or would be) given onward, matching the
    // ADR-021-style test in tests/sim/integrity.test.ts: measure the post-dose window.
    const fromIdx = Math.round(1200 / every);
    const post = rr.slice(fromIdx);
    const postCo2 = co2.slice(fromIdx);
    return { lowestRate: Math.min(...post), peakCo2: Math.max(...postCo2) };
  };

  const control = measure([]);
  const sleepAlone = measure([sleepOn]);
  const morphineAlone = measure([give]);
  const both = measure([sleepOn, give]);

  console.log(`control (no sleep, no drug):     lowest RR=${control.lowestRate.toFixed(1)}/min  peak PaCO2=${control.peakCo2.toFixed(1)} mmHg`);
  console.log(`sleep alone:                      lowest RR=${sleepAlone.lowestRate.toFixed(1)}/min  peak PaCO2=${sleepAlone.peakCo2.toFixed(1)} mmHg`);
  console.log(`morphine alone (4 mg IV):         lowest RR=${morphineAlone.lowestRate.toFixed(1)}/min  peak PaCO2=${morphineAlone.peakCo2.toFixed(1)} mmHg`);
  console.log(`sleep + morphine together:        lowest RR=${both.lowestRate.toFixed(1)}/min  peak PaCO2=${both.peakCo2.toFixed(1)} mmHg`);
  console.log(
    `composition holds iff both.lowestRate < min(sleepAlone, morphineAlone) AND both.peakCo2 > max(sleepAlone, morphineAlone): ` +
      `${both.lowestRate < Math.min(sleepAlone.lowestRate, morphineAlone.lowestRate) && both.peakCo2 > Math.max(sleepAlone.peakCo2, morphineAlone.peakCo2)}`,
  );
}

void runTo; // kept for ad hoc use when extending this probe
