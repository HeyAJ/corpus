/**
 * THE RESTING-BASELINE PROBE.
 *
 * CLAUDE.md tells everyone to "check the resting baseline after ANY change to src/sim", and
 * for a long time the script that prints it lived only in `.cache/probes/speed.ts`, which is
 * gitignored: it existed in one container and nowhere else, so the instruction pointed at a
 * file a fresh clone did not have. This is that script, checked in.
 *
 * Run it with:  npx vite-node tests/sim/baseline-probe.ts
 *
 * It boots the engine (which starts ALREADY SETTLED at rest), runs 600 simulated seconds
 * with no intents, and prints one line: the throughput, then the vitals. For the model as
 * it stands the vitals must read exactly
 *
 *   HR 65.1 MAP 93.0 CO 5.43 RR 12.6 SpO2 98.0 PaCO2 37.3 pH 7.425 T 37.00 glu 94.1 conds 0
 *
 * Anything else means a change has disturbed the resting body. The throughput figure
 * depends on the machine and is there only so a 2x slowdown is noticed.
 *
 * WHY THIS IS UNDER tests/ AND NOT tools/. tools/ is the node TypeScript project, which
 * deliberately sees only the DATA types from src; a script there that imports the Engine
 * would drag the whole simulation into that project (TS6307 for every file it reaches that
 * tsconfig.node.json does not list) and blur a layer boundary the build enforces. tests/
 * belongs to the app project, which already compiles the simulation, and tests/sim/
 * inert-sweep.ts sets the precedent. The name has no `.test.` in it, so vitest does not
 * collect it: it is a command, not a test.
 */
import { Engine } from '../../src/sim/core/engine';
import { P } from '../../src/sim/core/constants';

const DT = P('sim.dt_s');
const e = new Engine(0x5eed);
const N = 60000;
const t0 = performance.now();
for (let i = 0; i < N; i++) {
  e.tick(DT);
  e.pending.length = 0;
}
const ms = performance.now() - t0;
const s = e.snapshot();
const ticksPerSecond = N / (ms / 1000);
console.log(
  `ticks/s ${ticksPerSecond.toFixed(0)}  => max realtime factor ${(ticksPerSecond / 100).toFixed(0)}x; after 600 s: ` +
    `HR ${s.cardio.heartRateDisplay_bpm.toFixed(1)} MAP ${s.cardio.map_mmHg.toFixed(1)} ` +
    `CO ${s.cardio.cardiacOutput_L_per_min.toFixed(2)} RR ${s.resp.rate_per_min.toFixed(1)} ` +
    `SpO2 ${(s.resp.spo2 * 100).toFixed(1)} PaCO2 ${s.resp.paco2_mmHg.toFixed(1)} pH ${s.chem.ph.toFixed(3)} ` +
    `T ${s.metabolic.coreTemp_C.toFixed(2)} glu ${s.metabolic.glucose_mg_per_dL.toFixed(1)} conds ${s.conditions.length}`,
);
