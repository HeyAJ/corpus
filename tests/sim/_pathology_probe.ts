import { Engine } from '../../src/sim/core/engine';
import { P } from '../../src/sim/core/constants';
import type { SimIntent } from '../../src/bridge/types';

/**
 * SCRATCH PROBE, NOT A TEST. Run with `npx vite-node tests/sim/_pathology_probe.ts`.
 *
 * Nobody has ever run stepPathology. This prints numbers so a human can look at them,
 * rather than asserting anything - the assertions live in tests/sim/pathology.test.ts
 * once these numbers are understood. See ADR-020/ADR-024 for why behaviour, not data
 * shape, is what actually catches a dead subsystem.
 */

const DT = P('sim.dt_s');

function loop(
  seconds: number,
  intents: { at: number; intent: SimIntent }[],
  onSample?: (e: Engine, t: number) => void,
  sampleEvery = 10,
): Engine {
  const e = new Engine(0x5eed);
  const pending = [...intents].sort((a, b) => a.at - b.at);
  let cursor = 0;
  const steps = Math.round(seconds / DT);
  const stride = Math.max(1, Math.round(sampleEvery / DT));
  for (let i = 0; i < steps; i++) {
    const t = i * DT;
    while (cursor < pending.length && pending[cursor].at <= t) {
      e.applyIntent(pending[cursor].intent);
      cursor++;
    }
    e.tick(DT);
    e.pending.length = 0;
    if (onSample && i % stride === 0) onSample(e, t);
  }
  return e;
}

function fmt(n: number, d = 2): string {
  return n.toFixed(d);
}

/* ========================================================================== */
console.log('\n\n################ 0. BASELINE (10 min, no intents) ################');
{
  const e = loop(600, []);
  const s = e.state;
  const cond = e.snapshot().conditions;
  console.log(
    `HR=${fmt(s.cardio.hr)} MAP=${fmt(s.cardio.map)} CO=${fmt(s.cardio.co)} RR=${fmt(s.resp.rate)} ` +
      `SpO2=${fmt(s.resp.spo2 * 100, 1)} temp=${fmt(s.metabolic.coreTemp)} glucose=${fmt(s.metabolic.G, 0)} ` +
      `lactate=${fmt(s.chem.lactate)} svrScale=${fmt(s.cardio.svrScale, 3)}`,
  );
  console.log(`conditions firing: ${cond.length === 0 ? 'NONE' : JSON.stringify(cond.map((c) => c.id))}`);
  console.log(
    `pathology at rest: nociception=${s.pathology.nociception} pain=${s.pathology.pain} ` +
      `inflammation=${s.pathology.inflammation} bleedRate=${s.pathology.bleedRate_mL_per_min} ` +
      `bloodLost=${s.pathology.bloodLost_mL} vertigo=${s.pathology.vertigo}`,
  );
}

/* ========================================================================== */
console.log('\n\n################ 1. CONTINUOUS HAEMORRHAGE (150 mL/min from t=30) ################');
{
  const BLEED_AT = 30;
  const RATE = 150;
  const rows: string[] = [];
  const e = loop(
    1800,
    [{ at: BLEED_AT, intent: { type: 'SET_BLEED', rate_mL_per_min: RATE } }],
    (eng, t) => {
      const s = eng.state;
      rows.push(
        `t=${t.toFixed(0).padStart(5)}s hr=${fmt(s.cardio.hr, 1).padStart(6)} map=${fmt(s.cardio.map, 0).padStart(4)} ` +
          `bloodVol=${fmt(s.cardio.bloodVolume, 0).padStart(5)} bloodLost=${fmt(s.pathology.bloodLost_mL, 0).padStart(5)} ` +
          `interstitial=${fmt(s.fluids.interstitial, 0).padStart(6)} lactate=${fmt(s.chem.lactate, 2)} ` +
          `svrScale=${fmt(s.cardio.svrScale, 3)} symp=${fmt(s.reflex.symp, 3)}`,
      );
    },
    120,
  );
  console.log(rows.join('\n'));
  const s = e.state;
  const expectedLost = RATE * ((1800 - BLEED_AT) / 60);
  console.log(`\nexpected volume asked-for over the run: ${fmt(expectedLost, 0)} mL`);
  console.log(
    `bloodLost_mL actually recorded: ${fmt(s.pathology.bloodLost_mL, 0)} mL (should be <= asked-for once the vein floor bites)`,
  );
  console.log(`final conditions: ${JSON.stringify(e.snapshot().conditions.map((c) => c.id))}`);

  // Stop the bleed and confirm it actually stops.
  const before = s.pathology.bloodLost_mL;
  e.applyIntent({ type: 'SET_BLEED', rate_mL_per_min: 0 });
  for (let i = 0; i < Math.round(60 / DT); i++) {
    e.tick(DT);
    e.pending.length = 0;
  }
  console.log(
    `60 s after SET_BLEED 0: bloodLost_mL went from ${fmt(before, 0)} to ${fmt(s.pathology.bloodLost_mL, 0)} (should be unchanged)`,
  );
}

/* ========================================================================== */
console.log('\n\n################ 2. UNRELIEVED PAIN vs CONTROL (SET_PAIN 0.8 at t=30) ################');
{
  const control = loop(180, []);
  const painOnly = loop(180, [{ at: 30, intent: { type: 'SET_PAIN', level: 0.8 } }]);
  const cs = control.state;
  const ps = painOnly.state;
  console.log(
    `CONTROL  : hr=${fmt(cs.cardio.hr)} map=${fmt(cs.cardio.map)} rr=${fmt(cs.resp.rate)} svrScale=${fmt(cs.cardio.svrScale, 3)}`,
  );
  console.log(
    `PAIN=0.8 : hr=${fmt(ps.cardio.hr)} map=${fmt(ps.cardio.map)} rr=${fmt(ps.resp.rate)} svrScale=${fmt(ps.cardio.svrScale, 3)}`,
  );
  console.log(`nociception=${ps.pathology.nociception} pain=${ps.pathology.pain} (equal => no analgesia on board, correct)`);
  console.log(
    `delta hr=${fmt(ps.cardio.hr - cs.cardio.hr, 2)} delta map=${fmt(ps.cardio.map - cs.cardio.map, 2)} delta rr=${fmt(ps.resp.rate - cs.resp.rate, 2)}`,
  );
}

/* ========================================================================== */
console.log('\n\n################ 3. PAIN + MORPHINE - the analgesia claim, tested ################');
{
  const PAIN_AT = 30;
  const rows: string[] = [];
  const e = loop(
    300,
    [
      { at: PAIN_AT, intent: { type: 'SET_PAIN', level: 0.8 } },
      {
        at: PAIN_AT,
        intent: { type: 'ADMINISTER', drugId: 'morphine', route: 'IV_PUSH', dose: 4, unit: 'mg', label: '4 mg' },
      },
    ],
    (eng, t) => {
      const s = eng.state;
      const mu = s.receptors.find((r) => r.receptorId === 'mu');
      // Read the SAME bus target stepPathology reads, at the point a caller can
      // observe it: right after tick() returns, which is AFTER this tick's PD ran.
      // If this is non-zero while pain === nociception, pathology read a stale
      // (pre-PD) value earlier in this same tick, exactly as the code comment warns.
      const analgesiaBusNow = s.effects['neuro.analgesia'] ?? 0;
      rows.push(
        `t=${t.toFixed(0).padStart(4)}s muOcc=${fmt(mu?.total ?? -1, 3)} analgesiaBus=${fmt(analgesiaBusNow, 3)} ` +
          `nociception=${fmt(s.pathology.nociception, 3)} pain=${fmt(s.pathology.pain, 3)} hr=${fmt(s.cardio.hr, 1)} map=${fmt(s.cardio.map, 0)}`,
      );
    },
    15,
  );
  console.log(rows.join('\n'));

  // The direct comparison: does giving morphine change `pain` AT ALL relative to
  // giving nothing? Same nociceptive stimulus, same duration, morphine or not.
  const painOnly = loop(300, [{ at: PAIN_AT, intent: { type: 'SET_PAIN', level: 0.8 } }]);
  console.log(`\nfinal pain WITHOUT morphine: ${painOnly.state.pathology.pain}`);
  console.log(`final pain WITH    morphine: ${e.state.pathology.pain}`);
  console.log(
    `identical? ${e.state.pathology.pain === painOnly.state.pathology.pain} (mu occupancy at end: ${fmt(
      e.state.receptors.find((r) => r.receptorId === 'mu')?.total ?? -1,
      3,
    )})`,
  );
}

/* ========================================================================== */
console.log('\n\n################ 4. INFLAMMATION / FEVER (sustained nociception=1, 4 h) ################');
{
  const rows: string[] = [];
  const HOURS = 4;
  const e = loop(
    HOURS * 3600,
    [{ at: 30, intent: { type: 'SET_PAIN', level: 1.0 } }],
    (eng, t) => {
      const s = eng.state;
      rows.push(
        `t=${(t / 60).toFixed(0).padStart(4)}min inflammation=${fmt(s.pathology.inflammation, 4)} ` +
          `temp=${fmt(s.metabolic.coreTemp, 2)} hr=${fmt(s.cardio.hr, 1)} map=${fmt(s.cardio.map, 0)} ` +
          `svrScale=${fmt(s.cardio.svrScale, 3)} rr=${fmt(s.resp.rate, 1)} paco2=${fmt(s.resp.arterialPco2, 1)} ` +
          `permeabilityBus=${fmt(s.effects['vascular.permeability'] ?? 0, 3)}`,
      );
    },
    600,
  );
  console.log(rows.join('\n'));
  const s = e.state;
  console.log(`\nfinal conditions: ${JSON.stringify(e.snapshot().conditions.map((c) => c.id))}`);
  console.log(`SIRS temp criterion (38.0 C) crossed? ${s.metabolic.coreTemp >= 38.0}`);
  console.log(`SIRS hr criterion (90 bpm) crossed? ${s.cardio.hr >= 90}`);
}

/* ========================================================================== */
console.log('\n\n################ 5. VERTIGO (SET_VERTIGO 0.8 at t=30) ################');
{
  const control = loop(120, []);
  const vert = loop(120, [{ at: 30, intent: { type: 'SET_VERTIGO', level: 0.8 } }]);
  const cs = control.state;
  const vs = vert.state;
  console.log(
    `CONTROL : hr=${fmt(cs.cardio.hr)} gi.motility bus=${fmt(cs.effects['gi.motility'] ?? 0, 3)} gi.nausea bus=${fmt(
      cs.effects['gi.nausea'] ?? 0,
      3,
    )}`,
  );
  console.log(
    `VERTIGO : hr=${fmt(vs.cardio.hr)} gi.motility bus=${fmt(vs.effects['gi.motility'] ?? 0, 3)} gi.nausea bus=${fmt(
      vs.effects['gi.nausea'] ?? 0,
      3,
    )}`,
  );
  console.log(`delta hr = ${fmt(vs.cardio.hr - cs.cardio.hr, 4)} (should be exactly 0: heartRateChange constant is null)`);
}

console.log('\n\ndone.');
