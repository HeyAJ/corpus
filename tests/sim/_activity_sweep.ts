import { Engine } from '../../src/sim/core/engine';
import { P } from '../../src/sim/core/constants';
import type { SimState } from '../../src/sim/core/state';

/**
 * SCRATCH PROBE - not a test (no assertions, see tests/sim/behaviour.test.ts for those).
 *
 * Run with: npx vite-node tests/sim/_activity_sweep.ts
 *
 * HISTORY. This file used to sweep the now-deleted `__override` debug hatch to find
 * what fraction `exercise.venousReturnRise` needed to be before the circulation
 * stopped being preload-limited (cardiac output could not rise because venous return
 * could not, no matter how far afterload fell or how hard the heart tried to contract).
 * That sweep found the answer - see src/data/behaviour.json's note on
 * `exercise.venousReturnRise`, sourced to the SAME full-sympathetic-drive unstressed-
 * volume figure (URSINO1998, 700 mL) this engine already trusts for the baroreflex's
 * own venous tone term - and the override hatch was deleted once a real number replaced
 * it, per the provenance rule: a runtime hook that can silently overwrite a cited
 * constant is a backdoor, not a feature, and it must not survive the sweep it was built
 * for.
 *
 * What is left here is the verification sweep, run against the real, sourced constant.
 */

const DT = P('sim.dt_s');

function line(label: string, s: SimState): string {
  return (
    `${label.padEnd(16)} hr=${s.cardio.hr.toFixed(0).padStart(3)} map=${s.cardio.map.toFixed(0).padStart(3)} ` +
    `sbp/dbp=${s.cardio.sbp.toFixed(0).padStart(3)}/${s.cardio.dbp.toFixed(0)} co=${s.cardio.co.toFixed(1).padStart(4)} ` +
    `sv=${s.cardio.beatSv.toFixed(0).padStart(3)} edv=${s.cardio.beatEdv.toFixed(0).padStart(3)} ` +
    `ef=${s.cardio.ef.toFixed(2)} symp=${s.reflex.symp.toFixed(2)} venousV0=${s.cardio.veins.V0.toFixed(0)} ` +
    `ve=${((s.resp.rate * s.resp.tidalVolume) / 1000).toFixed(1).padStart(4)} ` +
    `paco2=${s.resp.arterialPco2.toFixed(1)} spo2=${(s.resp.spo2 * 100).toFixed(1)}`
  );
}

function run(label: string, level: number, seconds: number): void {
  const e = new Engine(0x5eed);
  e.applyIntent({ type: 'SET_EXERTION', level });
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) {
    e.tick(DT);
    e.pending.length = 0;
  }
  console.log(line(label, e.state));
}

console.log('\n--- EXERTION SWEEP, real sourced exercise.venousReturnRise (300 s each, steady state) ---');
console.log(line('BASELINE', new Engine(0x5eed).state));
for (const lvl of [0.25, 0.5, 0.75, 1.0]) {
  run(`exertion=${lvl}`, lvl, 300);
}

console.log(
  '\nGuyton reference for exertion=1.0: CO 5.5 -> ~23 L/min (x4.2), MAP +~20%. ' +
    'This model will not reach that ceiling (no muscle pump, no baroreflex resetting - both named ' +
    'in src/data/behaviour.json) but CO should rise several-fold and visibly beat the pre-fix ' +
    'preload-limited number, which was barely above resting.',
);
