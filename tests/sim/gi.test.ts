import { describe, expect, it } from 'vitest';
import { run } from './harness';
import { SEGMENTS } from '../../src/sim/systems/gi';
import { P } from '../../src/sim/core/constants';

/**
 * GASTROINTESTINAL TRACT (spec 4.6, 11 Phase 5).
 *
 * Phase 5 DoD: "eat a meal, watch it traverse, see glucose rise and fall."
 *
 * The part worth testing hardest is the fat effect on gastric emptying. It is the
 * one piece of this module that changes a *pharmacological* outcome — a fatty meal
 * genuinely delays oral drug absorption — so it is the difference between a GI
 * animation and a GI model.
 */

describe('a meal traverses the tract (Phase 5 DoD)', () => {
  const { samples, final } = run({
    seconds: 4 * 3600,
    sampleEvery: 60,
    intents: [{ at: 60, intent: { type: 'EAT', foodId: 'pizza_slice', portions: 2 } }],
  });

  it('enters the mouth and reaches the colon', () => {
    const segmentsSeen = new Set<string>();
    for (const s of samples) for (const d of s.gi.digesta) segmentsSeen.add(d.segment);
    expect(segmentsSeen.has('stomach')).toBe(true);
    expect(segmentsSeen.has('duodenum')).toBe(true);
    expect(segmentsSeen.has('jejunum')).toBe(true);
    // Four hours is enough to reach the ileum or beyond, but not to be excreted.
    expect([...segmentsSeen].some((x) => x.startsWith('colon') || x === 'caecum' || x === 'ileum')).toBe(true);
  });

  it('visits the segments in anatomical order, never backwards', () => {
    const index = (seg: string) => SEGMENTS.indexOf(seg as (typeof SEGMENTS)[number]);
    const furthest = new Map<number, number>();
    for (const s of samples) {
      for (const d of s.gi.digesta) {
        const i = index(d.segment);
        const previous = furthest.get(d.id) ?? -1;
        expect(i).toBeGreaterThanOrEqual(previous);
        furthest.set(d.id, i);
      }
    }
  });

  it('fills the stomach and then empties it', () => {
    const volumes = samples.map((s) => s.gi.gastricVolume_mL);
    const peak = Math.max(...volumes);
    expect(peak).toBeGreaterThan(200);
    expect(final.gi.gastricVolume_mL).toBeLessThan(peak * 0.25);
  });

  it('raises blood glucose and then brings it back down', () => {
    const glucose = samples.map((s) => s.metabolic.glucose_mg_per_dL);
    const baseline = glucose[0];
    const peak = Math.max(...glucose);
    const end = glucose[glucose.length - 1];

    expect(peak).toBeGreaterThan(baseline + 15);
    // A post-prandial excursion, not a pathological one.
    expect(peak).toBeLessThan(200);
    expect(end).toBeLessThan(baseline + 12);
  });

  it('raises insulin in response, and insulin follows glucose', () => {
    const peakG = samples.reduce((a, b) => (b.metabolic.glucose_mg_per_dL > a.metabolic.glucose_mg_per_dL ? b : a));
    const peakI = samples.reduce((a, b) => (b.metabolic.insulin_uU_per_mL > a.metabolic.insulin_uU_per_mL ? b : a));
    expect(peakI.metabolic.insulin_uU_per_mL).toBeGreaterThan(20);
    // Insulin's peak must not precede glucose's.
    expect(peakI.t).toBeGreaterThanOrEqual(peakG.t - 120);
  });

  it('turns bolus into chyme: solid fraction rises along the tract', () => {
    const early = samples.find((s) => s.gi.digesta.some((d) => d.segment === 'stomach'))!;
    const late = [...samples].reverse().find((s) => s.gi.digesta.some((d) => d.segment.startsWith('colon')));
    if (late) {
      const stomach = early.gi.digesta.find((d) => d.segment === 'stomach')!;
      const colon = late.gi.digesta.find((d) => d.segment.startsWith('colon'))!;
      expect(colon.solidFraction).toBeGreaterThan(stomach.solidFraction);
    }
  });
});

describe('gastric pH is a computed output, not a stored value', () => {
  it('sits at the fasted value with an empty stomach', () => {
    const { final } = run({ seconds: 600 });
    expect(final.gi.gastricPh).toBeGreaterThan(1.0);
    expect(final.gi.gastricPh).toBeLessThan(3.0);
  });

  it('rises when a protein meal buffers the acid, then falls again', () => {
    const { samples } = run({
      seconds: 3 * 3600,
      sampleEvery: 60,
      intents: [{ at: 60, intent: { type: 'EAT', foodId: 'grilled_chicken', portions: 3 } }],
    });
    const fasted = samples[0].gi.gastricPh;
    const peak = Math.max(...samples.map((s) => s.gi.gastricPh));
    const end = samples[samples.length - 1].gi.gastricPh;

    expect(peak).toBeGreaterThan(fasted + 0.5);
    expect(end).toBeLessThan(peak);
  });
});

describe('THE FAT EFFECT: a fatty meal delays gastric emptying (spec 4.6)', () => {
  /**
   * "Fat content raises t-half — a fatty meal genuinely delays oral drug absorption,
   *  and that will be visible in the plasma curve. Ship it."
   */
  const lean = run({
    seconds: 3 * 3600,
    sampleEvery: 60,
    intents: [{ at: 60, intent: { type: 'EAT', foodId: 'white_rice', portions: 2 } }],
  });
  const fatty = run({
    seconds: 3 * 3600,
    sampleEvery: 60,
    intents: [{ at: 60, intent: { type: 'EAT', foodId: 'butter_heavy_meal', portions: 1 } }],
  });

  const emptyingTime = (r: typeof lean) => {
    const peak = Math.max(...r.samples.map((s) => s.gi.gastricVolume_mL));
    const half = r.samples.find((s) => s.t > 120 && s.gi.gastricVolume_mL < peak * 0.5);
    return half ? half.t : Infinity;
  };

  it('the fatty meal takes longer to leave the stomach', () => {
    expect(emptyingTime(fatty)).toBeGreaterThan(emptyingTime(lean));
  });

  it('and that delay is visible in an oral drug plasma curve', () => {
    // The educational payoff: the same oral dose, on an empty stomach and on a
    // fatty one, gives a visibly different absorption curve.
    const withFat = run({
      seconds: 3 * 3600,
      sampleEvery: 30,
      intents: [
        { at: 30, intent: { type: 'EAT', foodId: 'butter_heavy_meal', portions: 1 } },
        { at: 60, intent: { type: 'ADMINISTER', drugId: 'morphine', route: 'ORAL', dose: 15, unit: 'mg', label: '15 mg' } },
      ],
    });
    const empty = run({
      seconds: 3 * 3600,
      sampleEvery: 30,
      intents: [
        { at: 60, intent: { type: 'ADMINISTER', drugId: 'morphine', route: 'ORAL', dose: 15, unit: 'mg', label: '15 mg' } },
      ],
    });

    const tmax = (r: typeof withFat) => {
      const peak = r.samples.reduce((a, b) => {
        const av = a.drugs.find((d) => d.drugId === 'morphine')?.plasma_ng_per_mL ?? 0;
        const bv = b.drugs.find((d) => d.drugId === 'morphine')?.plasma_ng_per_mL ?? 0;
        return bv > av ? b : a;
      });
      return peak.t;
    };

    expect(tmax(withFat)).toBeGreaterThan(tmax(empty));
  });
});

describe('gastric emptying follows the Elashoff power-exponential', () => {
  it('shows an initial lag rather than an immediate exponential fall', () => {
    // beta > 1 is what produces the lag phase. A plain exponential would start
    // falling at its fastest at t = 0, which is not what a stomach does.
    expect(P('gi.gastricEmptyingBeta')).toBeGreaterThan(1);

    const { samples } = run({
      seconds: 2 * 3600,
      sampleEvery: 30,
      intents: [{ at: 60, intent: { type: 'EAT', foodId: 'white_rice', portions: 2 } }],
    });
    const volumes = samples.filter((s) => s.t > 120).map((s) => s.gi.gastricVolume_mL);
    const peakIndex = volumes.indexOf(Math.max(...volumes));
    const rateAt = (i: number) => volumes[peakIndex + i] - volumes[peakIndex + i + 1];
    const early = rateAt(0);
    const middle = Math.max(rateAt(8), rateAt(12), rateAt(16));
    // The emptying rate accelerates after the lag rather than starting at maximum.
    expect(middle).toBeGreaterThan(early);
  });
});

describe('fluid absorbed from the gut reaches the circulation', () => {
  it('a large drink raises circulating volume', () => {
    const dry = run({ seconds: 1.5 * 3600 });
    const wet = run({
      seconds: 1.5 * 3600,
      intents: [
        { at: 60, intent: { type: 'EAT', foodId: 'water', portions: 4 } },
        { at: 120, intent: { type: 'EAT', foodId: 'water', portions: 4 } },
      ],
    });
    expect(wet.final.renal.bladderVolume_mL).toBeGreaterThanOrEqual(dry.final.renal.bladderVolume_mL);
    // Total body water, not just the intravascular share: an absorbed drink lands in
    // the circulation and is then redistributed to the interstitium.
    const totalWater = (r: typeof dry) => r.final.cardio.bloodVolume_mL + r.engine.state.fluids.interstitial;
    expect(totalWater(wet)).toBeGreaterThan(totalWater(dry) + 500);
  });
});
