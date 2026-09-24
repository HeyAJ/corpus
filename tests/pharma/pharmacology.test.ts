import { describe, expect, it } from 'vitest';
import drugsFile from '../../src/data/drugs.json';
import type { DrugsFile } from '../../src/data/pharma-types';
import { terminalHalfLife_min } from '../../src/sim/pharma/pk';
import { hillResponse, deriveKinetics } from '../../src/sim/pharma/pd';
import { run, DT } from '../sim/harness';
import { Engine } from '../../src/sim/core/engine';

const DRUGS = (drugsFile as unknown as DrugsFile).drugs;
const byId = (id: string) => DRUGS.find((d) => d.id === id)!;

/**
 * PHARMACOLOGY GOLDEN TESTS (spec 12).
 *
 * "For each drug, assert Cmax, Tmax, and terminal half-life fall within the
 *  published range cited in its sources. Any drug failing its own citation is a bug
 *  in the drug entry or the engine — fail the build."
 *
 * That last clause is the important one. These tests do not check that the engine
 * is self-consistent; they check it against the literature the data claims to come
 * from. A drug that cannot reproduce its own citation is worse than a missing drug.
 */

function simulate(drugId: string, route: 'IV_PUSH' | 'IV_DRIP' | 'ORAL' | 'IM' | 'INHALED', seconds: number) {
  const drug = byId(drugId);
  const preset = drug.presetDoses.find((p) => p.route === route)!;
  const samples: { t: number; cp: number; free: number | null }[] = [];

  const engine = new Engine(1);
  const steps = Math.round(seconds / DT);
  const doseAt = Math.round(30 / DT);
  for (let i = 0; i < steps; i++) {
    if (i === doseAt) {
      engine.applyIntent({
        type: 'ADMINISTER',
        drugId,
        route,
        dose: preset.amount,
        unit: preset.unit,
        label: preset.label,
      });
    }
    engine.tick(DT);
    engine.pending.length = 0;
    if (i % 100 === 0) {
      const d = engine.state.drugs.find((x) => x.drugId === drugId);
      samples.push({ t: i * DT - 30, cp: d?.cp ?? 0, free: d?.freeNM ?? null });
    }
  }
  const peak = samples.reduce((a, b) => (b.cp > a.cp ? b : a));
  return { samples, cmax_mg_per_L: peak.cp, tmax_s: peak.t, engine };
}

describe('terminal half-life matches the cited value', () => {
  const CITED_HALF_LIFE_MIN: Record<string, [number, number]> = {
    // [lower, upper] of the range the drug's own sources give.
    epinephrine: [1, 4],
    norepinephrine: [1, 4],
    dopamine: [1, 4],
    adenosine: [0.05, 0.2],
    fentanyl: [180, 480],
    morphine: [90, 240],
    naloxone: [30, 120],
    propofol: [180, 900],
    midazolam: [90, 400],
    ketamine: [100, 220],
    atropine: [120, 300],
    phenylephrine: [100, 220],
    albuterol: [200, 400],
    furosemide: [60, 150],
  };

  for (const [id, [lo, hi]] of Object.entries(CITED_HALF_LIFE_MIN)) {
    it(`${id}: terminal half-life within ${lo}-${hi} min`, () => {
      const t = terminalHalfLife_min(byId(id));
      expect(t).not.toBeNull();
      expect(t!).toBeGreaterThanOrEqual(lo);
      expect(t!).toBeLessThanOrEqual(hi);
    });
  }
});

describe('IV push kinetics', () => {
  it('epinephrine 1 mg peaks immediately and is gone within minutes', () => {
    const r = simulate('epinephrine', 'IV_PUSH', 900);
    // 1 mg into a 13.9 L central volume is about 72 ug/L at the instant of push.
    expect(r.cmax_mg_per_L).toBeGreaterThan(0.05);
    expect(r.cmax_mg_per_L).toBeLessThan(0.09);
    expect(r.tmax_s).toBeLessThan(2);

    const at10min = r.samples.find((s) => s.t >= 600)!;
    // Five half-lives of 2 min leaves about 3 % of the peak.
    expect(at10min.cp).toBeLessThan(r.cmax_mg_per_L * 0.05);
  });

  it('adenosine is gone within a minute, which is its entire clinical point', () => {
    const r = simulate('adenosine', 'IV_PUSH', 180);
    const at1min = r.samples.find((s) => s.t >= 60)!;
    // One minute is ten half-lives at a 6 s half-life, so essentially nothing is
    // left. Asserting a specific tiny fraction would just be testing float
    // underflow; a quarter of one per cent of the peak makes the point.
    expect(at1min.cp).toBeLessThan(r.cmax_mg_per_L * 0.005);
  });

  it('fentanyl shows a three-compartment shape: fast fall then a long tail', () => {
    const r = simulate('fentanyl', 'IV_PUSH', 7200);
    const peak = r.cmax_mg_per_L;
    const at5min = r.samples.find((s) => s.t >= 300)!.cp;
    const at60min = r.samples.find((s) => s.t >= 3600)!.cp;

    // Distribution dominates early: a large fall in the first five minutes.
    expect(at5min).toBeLessThan(peak * 0.45);
    // Then the terminal phase is slow: the fall from 5 to 60 min is proportionally
    // much smaller than the fall in the first five. A one-compartment model cannot
    // produce this, which is why the spec insists on integrated ODEs.
    const earlyDrop = 1 - at5min / peak;
    const lateDrop = 1 - at60min / at5min;
    expect(lateDrop).toBeLessThan(earlyDrop);
  });

  it('free concentration is a strict fraction of total when protein binding is known', () => {
    const r = simulate('fentanyl', 'IV_PUSH', 600);
    const s = r.samples.find((x) => x.t >= 10)!;
    const drug = byId('fentanyl');
    const expectedFree = (s.cp * (1 - drug.pk.proteinBound!) * 1e6) / drug.pk.MW_gmol!;
    expect(s.free!).toBeCloseTo(expectedFree, 6);
    // 33.6 % unbound: the free concentration must be well below the total.
    expect(s.free!).toBeLessThan((s.cp * 1e6) / drug.pk.MW_gmol!);
  });
});

describe('routes (spec 5.1)', () => {
  it('ORAL peaks later and lower than IV for the same drug', () => {
    const iv = simulate('morphine', 'IV_PUSH', 7200);
    const oral = simulate('morphine', 'ORAL', 7200);
    expect(oral.tmax_s).toBeGreaterThan(iv.tmax_s + 300);
    // 15 mg oral vs 4 mg IV, and oral still peaks lower: first-pass extraction and
    // gastric-emptying-limited absorption together cost more than the dose gains.
    expect(oral.cmax_mg_per_L).toBeLessThan(iv.cmax_mg_per_L);
  });

  it('IM releases from a depot more slowly than an IV push', () => {
    const iv = simulate('naloxone', 'IV_PUSH', 3600);
    const im = simulate('naloxone', 'IM', 3600);
    expect(im.tmax_s).toBeGreaterThan(iv.tmax_s);
  });

  it('INHALED applies the pulmonary bioavailability factor', () => {
    const r = simulate('albuterol', 'INHALED', 3600);
    const drug = byId('albuterol');
    const delivered = 2.5 * (drug.pk.bioavailability ?? 1);
    expect(r.cmax_mg_per_L).toBeCloseTo(delivered / drug.pk.V1_L!, 3);
  });

  it('IV_DRIP is a zero-order infusion and is cancellable', () => {
    const drug = byId('norepinephrine');
    const preset = drug.presetDoses.find((p) => p.route === 'IV_DRIP')!;
    const engine = new Engine(1);

    for (let i = 0; i < 6000; i++) {
      if (i === 100) {
        engine.applyIntent({
          type: 'ADMINISTER',
          drugId: 'norepinephrine',
          route: 'IV_DRIP',
          dose: preset.amount,
          unit: preset.unit,
          label: preset.label,
        });
      }
      engine.tick(DT);
      engine.pending.length = 0;
    }
    const running = engine.state.drugs.find((d) => d.drugId === 'norepinephrine')!;
    expect(running.infusionRate).toBeGreaterThan(0);
    const cpWhileRunning = running.cp;
    expect(cpWhileRunning).toBeGreaterThan(0);

    engine.applyIntent({ type: 'STOP_INFUSION', drugId: 'norepinephrine' });
    // Four minutes is two half-lives for noradrenaline, so about a quarter should
    // remain. Expecting less than that would be expecting the drug to disappear
    // faster than its own cited clearance allows.
    for (let i = 0; i < 24000; i++) {
      engine.tick(DT);
      engine.pending.length = 0;
    }
    expect(running.infusionRate).toBe(0);
    expect(running.cp).toBeLessThan(cpWhileRunning * 0.35);
    expect(running.cp).toBeGreaterThan(0);
  });
});

describe('dose guardrails (spec 10.3)', () => {
  it('rejects an amount that is not a declared preset', () => {
    const engine = new Engine(1);
    engine.applyIntent({
      type: 'ADMINISTER',
      drugId: 'epinephrine',
      route: 'IV_PUSH',
      dose: 100,
      unit: 'mg',
      label: 'made up',
    });
    expect(engine.state.drugs.find((d) => d.drugId === 'epinephrine')).toBeUndefined();
  });

  it('rejects a route the drug does not declare', () => {
    const engine = new Engine(1);
    engine.applyIntent({
      type: 'ADMINISTER',
      drugId: 'epinephrine',
      route: 'ORAL',
      dose: 1,
      unit: 'mg',
      label: '1 mg',
    });
    expect(engine.state.drugs.find((d) => d.drugId === 'epinephrine')).toBeUndefined();
  });

  it('refuses an intravenous route with no IV access', () => {
    const engine = new Engine(1);
    engine.applyIntent({ type: 'IV_ACCESS', on: false });
    engine.applyIntent({
      type: 'ADMINISTER',
      drugId: 'epinephrine',
      route: 'IV_PUSH',
      dose: 1,
      unit: 'mg',
      label: '1 mg',
    });
    const st = engine.state.drugs.find((d) => d.drugId === 'epinephrine');
    expect(st === undefined || st.a1 === 0).toBe(true);
  });
});

describe('pharmacodynamics (spec 5.3)', () => {
  it('binding kinetics have a visible rise time, not an instant step', () => {
    // The receptor chart in the reference has a sigmoid ramp. If occupancy tracked
    // plasma concentration instantly, the chart would be a scaled copy of the
    // plasma curve, which is both wrong and uninformative.
    const { samples } = run({
      seconds: 120,
      sampleEvery: 1,
      intents: [
        { at: 10, intent: { type: 'ADMINISTER', drugId: 'fentanyl', route: 'IV_PUSH', dose: 500, unit: 'mcg', label: '500 mcg' } },
      ],
    });
    const mu = (s: (typeof samples)[number]) => s.receptors.find((r) => r.receptorId === 'mu')!.occupancy;
    const atDose = samples.find((s) => s.t >= 10)!;
    const peak = samples.reduce((a, b) => (mu(b) > mu(a) ? b : a));

    expect(mu(peak)).toBeGreaterThan(0.05);
    // The occupancy peak must lag the dose by a measurable interval.
    expect(peak.t).toBeGreaterThan(atDose.t + 1);
  });

  it('Gaddum competition: occupancies at one receptor never sum above 1', () => {
    const { samples } = run({
      seconds: 300,
      sampleEvery: 5,
      intents: [
        { at: 10, intent: { type: 'ADMINISTER', drugId: 'fentanyl', route: 'IV_PUSH', dose: 500, unit: 'mcg', label: '500 mcg' } },
        { at: 20, intent: { type: 'ADMINISTER', drugId: 'morphine', route: 'IV_PUSH', dose: 4, unit: 'mg', label: '4 mg' } },
        { at: 30, intent: { type: 'ADMINISTER', drugId: 'naloxone', route: 'IV_PUSH', dose: 0.4, unit: 'mg', label: '0.4 mg' } },
      ],
    });
    for (const s of samples) {
      for (const r of s.receptors) {
        expect(r.occupancy).toBeLessThanOrEqual(1.0000001);
        expect(r.occupancy).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('naloxone displaces fentanyl from the mu receptor', () => {
    const withoutNaloxone = run({
      seconds: 400,
      sampleEvery: 5,
      intents: [{ at: 10, intent: { type: 'ADMINISTER', drugId: 'fentanyl', route: 'IV_PUSH', dose: 500, unit: 'mcg', label: '500 mcg' } }],
    });
    const withNaloxone = run({
      seconds: 400,
      sampleEvery: 5,
      intents: [
        { at: 10, intent: { type: 'ADMINISTER', drugId: 'fentanyl', route: 'IV_PUSH', dose: 500, unit: 'mcg', label: '500 mcg' } },
        { at: 120, intent: { type: 'ADMINISTER', drugId: 'naloxone', route: 'IV_PUSH', dose: 0.4, unit: 'mg', label: '0.4 mg' } },
      ],
    });

    const fentanylMu = (r: typeof withoutNaloxone) => {
      const s = r.samples[r.samples.length - 1];
      const mu = s.receptors.find((x) => x.receptorId === 'mu')!;
      return mu;
    };

    // With naloxone present, the fentanyl share of mu occupancy must be lower.
    const a = fentanylMu(withoutNaloxone);
    const b = fentanylMu(withNaloxone);
    expect(b.dominantLigand === 'naloxone' || b.activation < a.activation).toBe(true);
    expect(b.activation).toBeLessThan(a.activation);
  });

  it('the Hill transform is odd, normalised and monotonic', () => {
    expect(hillResponse(0, 0.3, 1.2)).toBe(0);
    expect(hillResponse(1, 0.3, 1.2)).toBeCloseTo(1, 9);
    expect(hillResponse(-1, 0.3, 1.2)).toBeCloseTo(-1, 9);
    let previous = -Infinity;
    for (let a = 0; a <= 1; a += 0.05) {
      const v = hillResponse(a, 0.35, 1.3);
      expect(v).toBeGreaterThan(previous);
      previous = v;
    }
  });

  it('derives koff from Ki so that equilibrium occupancy depends only on Ki', () => {
    const k = deriveKinetics(10, null, null, 0.6)!;
    expect(k.kon).toBe(0.6);
    expect(k.koff / k.kon).toBeCloseTo(10, 9);
    // No affinity means no binding entry at all — never a guessed Ki.
    expect(deriveKinetics(null, null, null, 0.6)).toBeNull();
  });
});
