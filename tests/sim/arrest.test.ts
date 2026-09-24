import { describe, expect, it } from 'vitest';
import { run, DT } from './harness';
import { Engine } from '../../src/sim/core/engine';
import { defibrillate, compress, chargeDefib } from '../../src/sim/systems/procedures';
import { P } from '../../src/sim/core/constants';
import { Rng } from '../../src/sim/core/rng';

/**
 * EMERGENCY MODE (spec 9, 11 Phase 6).
 *
 * The single most valuable teaching moment in the whole application is that
 * SHOCKING ASYSTOLE DOES NOTHING. A defibrillator does not start a heart; it stops
 * a chaotic one and lets the intrinsic pacemaker resume. There is nothing to stop
 * in asystole. A button that always works would actively teach the opposite, so
 * this is tested first and tested hardest.
 */

function arrestedEngine(seed = 11): Engine {
  const engine = new Engine(seed);
  engine.applyIntent({ type: 'FORCE_RHYTHM', rhythm: 'vfib' });
  for (let i = 0; i < 300; i++) {
    engine.tick(DT);
    engine.pending.length = 0;
  }
  return engine;
}

describe('cardiac arrest', () => {
  it('ventricular fibrillation abolishes cardiac output', () => {
    const { final } = run({
      seconds: 30,
      intents: [{ at: 2, intent: { type: 'FORCE_RHYTHM', rhythm: 'vfib' } }],
    });
    expect(final.cardio.cardiacOutput_L_per_min).toBeLessThan(0.7);
    expect(final.cardio.cardiacIndex).toBeLessThan(1.0);
    expect(final.conditions.some((c) => c.id === 'arrest')).toBe(true);
    expect(final.conditions.some((c) => c.id === 'vfib')).toBe(true);
  });

  it('arterial pressure decays toward the venous pressure without compressions', () => {
    const { samples } = run({
      seconds: 60,
      sampleEvery: 5,
      intents: [{ at: 2, intent: { type: 'FORCE_RHYTHM', rhythm: 'vfib' } }],
    });
    const end = samples[samples.length - 1];
    expect(end.cardio.map_mmHg).toBeLessThan(30);
    expect(end.cardio.coronaryPerfusionPressure_mmHg).toBeLessThan(10);
  });

  it('drives lactate up and consciousness down', () => {
    const { final } = run({
      seconds: 300,
      intents: [{ at: 2, intent: { type: 'FORCE_RHYTHM', rhythm: 'vfib' } }],
    });
    expect(final.chem.lactate_mmol_per_L).toBeGreaterThan(3);
    expect(final.neuro.consciousness).toBeLessThan(0.15);
  });

  it('untreated fine VF degenerates to asystole', () => {
    const { final } = run({
      seconds: 1500,
      intents: [{ at: 2, intent: { type: 'FORCE_RHYTHM', rhythm: 'vfib' } }],
    });
    expect(final.cardio.rhythm).toBe('asystole');
  });

  it('pulseless electrical activity has a rhythm but no output', () => {
    const { final } = run({
      seconds: 20,
      intents: [{ at: 2, intent: { type: 'FORCE_RHYTHM', rhythm: 'pea' } }],
    });
    expect(final.cardio.heartRate_bpm).toBeGreaterThan(20);
    expect(final.cardio.cardiacIndex).toBeLessThan(1.0);
  });
});

describe('CPR (spec 9)', () => {
  it('generates a cardiac output of 25-30 % of normal', () => {
    // This is the number the compression pressure amplitude is calibrated against,
    // and the UNIT matters. CPR is modelled as a thoracic pump — each compression
    // raises intrathoracic pressure and blood moves through the existing valve
    // equations — so the resulting flow is an OUTPUT of the circuit rather than a
    // constant, and this assertion is what pins it to the AHA figure.
    //
    // The figure is a fraction of normal cardiac OUTPUT, not of stroke volume. At
    // 110 compressions per minute against a resting 66 beats per minute, 27 % of
    // normal output is about 13 mL per compression: 17 % of a normal stroke volume.
    // Reading it as 27 % of stroke volume would double the flow.
    const engine = arrestedEngine();
    const NORMAL_CO_L_PER_MIN = 5.4;
    const RATE = 110;

    let ejected = 0;
    let beats = 0;
    const period = Math.round(60 / RATE / DT);
    for (let i = 0; i < 3000; i++) {
      if (i % period === 0) {
        compress(engine.state);
        beats++;
      }
      const before = engine.state.cardio.beatEjectedVolume;
      engine.tick(DT);
      engine.pending.length = 0;
      const after = engine.state.cardio.beatEjectedVolume;
      if (after > before) ejected += after - before;
    }

    const perCompression = ejected / beats;
    const outputFraction = (perCompression * RATE) / 1000 / NORMAL_CO_L_PER_MIN;
    expect(outputFraction).toBeGreaterThan(0.22);
    expect(outputFraction).toBeLessThan(0.34);
  });

  it('raises coronary perfusion pressure past the threshold that gates a shock', () => {
    const engine = arrestedEngine();
    for (let i = 0; i < 1200; i++) {
      if (i % Math.round(60 / 110 / DT) === 0) compress(engine.state);
      engine.tick(DT);
      engine.pending.length = 0;
    }
    // Above the 15 mmHg that predicts return of spontaneous circulation, and inside
    // a plausible band. The model sits at the top of the reported human range
    // because its right atrium does not distend as much as a real one does during
    // arrest; that is recorded in docs/MODEL_LIMITATIONS.md.
    expect(engine.state.cardio.cpp).toBeGreaterThan(P('arrest.cppRosc_mmHg'));
    expect(engine.state.cardio.cpp).toBeLessThan(60);
  });

  it('leaves coronary perfusion below the threshold when nobody compresses', () => {
    // The contrast is the lesson: without compressions a shock has almost no chance.
    const engine = arrestedEngine();
    for (let i = 0; i < 1200; i++) {
      engine.tick(DT);
      engine.pending.length = 0;
    }
    expect(engine.state.cardio.cpp).toBeLessThan(P('arrest.cppRosc_mmHg'));
  });

  it('reports compression quality against the AHA rate band', () => {
    const engine = arrestedEngine();
    const at = (rate: number) => {
      const period = Math.round(60 / rate / DT);
      for (let i = 0; i < 900; i++) {
        if (i % period === 0) compress(engine.state);
        engine.tick(DT);
        engine.pending.length = 0;
      }
      return engine.snapshot().procedures.cprQuality;
    };
    expect(at(110)).toBe('good');
    expect(at(70)).toBe('slow');
    expect(at(160)).toBe('fast');
  });

  it('stops being effective within a few seconds of compressions stopping', () => {
    const engine = arrestedEngine();
    for (let i = 0; i < 900; i++) {
      if (i % Math.round(60 / 110 / DT) === 0) compress(engine.state);
      engine.tick(DT);
      engine.pending.length = 0;
    }
    const withCpr = engine.state.cardio.cpp;
    for (let i = 0; i < 1000; i++) {
      engine.tick(DT);
      engine.pending.length = 0;
    }
    expect(engine.state.procedures.cprActive).toBe(false);
    expect(engine.state.cardio.cpp).toBeLessThan(withCpr);
  });
});

describe('defibrillation (spec 9)', () => {
  function readyToShock(seed = 3, joules = 200): Engine {
    const engine = arrestedEngine(seed);
    engine.state.procedures.padsPlaced = true;
    // Good compressions, so coronary perfusion is adequate.
    for (let i = 0; i < 1500; i++) {
      if (i % Math.round(60 / 110 / DT) === 0) compress(engine.state);
      engine.tick(DT);
      engine.pending.length = 0;
    }
    chargeDefib(engine.state, joules);
    return engine;
  }

  it('SHOCKING ASYSTOLE DOES NOTHING, and says why', () => {
    const engine = arrestedEngine();
    engine.state.cardio.rhythm = 'asystole';
    engine.state.procedures.padsPlaced = true;
    chargeDefib(engine.state, 200);

    const result = defibrillate(engine.state, new Rng(1));
    expect(result.delivered).toBe(true);
    expect(result.converted).toBe(false);
    expect(result.probability).toBe(0);
    expect(result.reason).toMatch(/not a shockable rhythm/i);
    expect(engine.state.cardio.rhythm).toBe('asystole');
  });

  it('shocking PEA does nothing either', () => {
    const engine = arrestedEngine();
    engine.state.cardio.rhythm = 'pea';
    engine.state.procedures.padsPlaced = true;
    chargeDefib(engine.state, 200);
    const result = defibrillate(engine.state, new Rng(1));
    expect(result.converted).toBe(false);
    expect(result.probability).toBe(0);
    expect(engine.state.cardio.rhythm).toBe('pea');
  });

  it('refuses to fire without pads or a charge', () => {
    const engine = arrestedEngine();
    expect(defibrillate(engine.state, new Rng(1)).reason).toMatch(/pads/i);
    engine.state.procedures.padsPlaced = true;
    expect(defibrillate(engine.state, new Rng(1)).reason).toMatch(/charged/i);
  });

  it('only accepts the biphasic energies the guideline lists', () => {
    const engine = arrestedEngine();
    expect(chargeDefib(engine.state, 200)).toBe(true);
    expect(chargeDefib(engine.state, 999)).toBe(false);
  });

  it('converts VF often when compressions have been good', () => {
    let converted = 0;
    const TRIALS = 40;
    for (let i = 0; i < TRIALS; i++) {
      const engine = readyToShock(100 + i);
      if (defibrillate(engine.state, new Rng(i)).converted) converted++;
    }
    // Probabilistic, seeded and conditioned on downtime and perfusion — not a
    // coin flip, and not a certainty either.
    expect(converted / TRIALS).toBeGreaterThan(0.4);
    expect(converted / TRIALS).toBeLessThan(1.0);
  });

  it('converts far less often after a long downtime with no compressions', () => {
    const early = () => {
      const engine = arrestedEngine(5);
      engine.state.procedures.padsPlaced = true;
      for (let i = 0; i < 1500; i++) {
        if (i % Math.round(60 / 110 / DT) === 0) compress(engine.state);
        engine.tick(DT);
        engine.pending.length = 0;
      }
      chargeDefib(engine.state, 200);
      return engine;
    };
    const late = () => {
      const engine = arrestedEngine(5);
      engine.state.procedures.padsPlaced = true;
      for (let i = 0; i < 40000; i++) {
        engine.tick(DT);
        engine.pending.length = 0;
      }
      chargeDefib(engine.state, 200);
      return engine;
    };

    const earlyProb = defibrillate(early().state, new Rng(1)).probability;
    const lateEngine = late();
    // After six minutes with no compressions the rhythm may already have degenerated
    // to asystole, which is itself the lesson.
    const lateProb = lateEngine.state.cardio.rhythm === 'asystole'
      ? 0
      : defibrillate(lateEngine.state, new Rng(1)).probability;

    expect(lateProb).toBeLessThan(earlyProb * 0.6);
  });

  it('is deterministic for a given seed', () => {
    const a = defibrillate(readyToShock(42).state, new Rng(7));
    const b = defibrillate(readyToShock(42).state, new Rng(7));
    expect(b.converted).toBe(a.converted);
    expect(b.probability).toBeCloseTo(a.probability, 12);
  });

  it('a successful shock with poor perfusion gives PEA, not a perfusing rhythm', () => {
    // Terminating the arrhythmia is not the same as restoring circulation. A
    // myocardium that has not been perfused resumes electrical activity without
    // effective contraction, and the correct next action is more compressions.
    const engine = arrestedEngine(9);
    engine.state.procedures.padsPlaced = true;
    chargeDefib(engine.state, 200);
    engine.state.cardio.cpp = 2; // no compressions have been given
    engine.state.cardio.fibAmplitude = 1;
    engine.state.procedures.arrestStartT = engine.state.t;

    let sawPea = false;
    for (let i = 0; i < 60 && !sawPea; i++) {
      const e = arrestedEngine(200 + i);
      e.state.procedures.padsPlaced = true;
      chargeDefib(e.state, 200);
      e.state.cardio.cpp = 2;
      const r = defibrillate(e.state, new Rng(i));
      if (r.converted && e.state.cardio.rhythm === 'pea') sawPea = true;
    }
    expect(sawPea).toBe(true);
  });
});

describe('full arrest to ROSC cycle (spec 11, Phase 6 DoD)', () => {
  it('runs end to end: arrest, CPR, shock, return of circulation', () => {
    // Try a handful of seeds; the shock is probabilistic by design, so requiring one
    // specific seed to succeed would be testing the RNG rather than the sequence.
    let succeeded = false;
    let attempts = 0;

    for (let seed = 0; seed < 25 && !succeeded; seed++) {
      attempts++;
      const engine = new Engine(seed);
      engine.applyIntent({ type: 'FORCE_RHYTHM', rhythm: 'vfib' });

      // 30 s of arrest, then compressions.
      for (let i = 0; i < 3000; i++) {
        engine.tick(DT);
        engine.pending.length = 0;
      }
      expect(engine.state.cardio.co).toBeLessThan(1);

      engine.applyIntent({ type: 'PLACE_PADS' });
      for (let i = 0; i < 2000; i++) {
        if (i % Math.round(60 / 110 / DT) === 0) engine.applyIntent({ type: 'CPR_COMPRESSION' });
        engine.tick(DT);
        engine.pending.length = 0;
      }
      expect(engine.state.cardio.cpp).toBeGreaterThan(5);

      engine.applyIntent({ type: 'CHARGE_DEFIB', joules: 200 });
      engine.applyIntent({ type: 'DEFIBRILLATE' });

      if (engine.state.cardio.rhythm === 'nsr') {
        // Let the circulation re-establish itself.
        for (let i = 0; i < 6000; i++) {
          engine.tick(DT);
          engine.pending.length = 0;
        }
        const s = engine.snapshot();
        expect(s.cardio.cardiacOutput_L_per_min).toBeGreaterThan(3);
        expect(s.cardio.map_mmHg).toBeGreaterThan(55);
        expect(s.conditions.some((c) => c.id === 'arrest')).toBe(false);
        succeeded = true;
      }
    }

    expect(succeeded).toBe(true);
    expect(attempts).toBeLessThan(25);
  });
});
