import { describe, expect, it } from 'vitest';
import { run, type ScheduledIntent } from '../sim/harness';
import drugsFile from '../../src/data/drugs.json';
import routesFile from '../../src/data/routes.json';
import type { Drug, DrugsFile } from '../../src/data/pharma-types';
import type { Route } from '../../src/bridge/types';
import { MAX_DOSE_MULTIPLIER, MIN_DOSE_MULTIPLIER } from '../../src/bridge/types';
import { ROUTE_IDS, depotParamsFor, routeSpec } from '../../src/sim/pharma/routes';
import { horizonFor, predict } from '../../src/sim/pharma/predict';
import { toMilligrams } from '../../src/sim/core/engine';

const DRUGS = (drugsFile as unknown as DrugsFile).drugs;
const byId = (id: string): Drug => {
  const d = DRUGS.find((x) => x.id === id);
  if (!d) throw new Error(`no drug ${id}`);
  return d;
};

/** IV access first, then the dose. Most routes do not need it; IV and drip do. */
function giveAt(
  t: number,
  drugId: string,
  route: Route,
  multiplier?: number,
): ScheduledIntent {
  const drug = byId(drugId);
  const preset = drug.presetDoses.find((p) => p.route === route);
  if (!preset) throw new Error(`${drugId} has no preset for ${route}`);
  return {
    at: t,
    intent: {
      type: 'ADMINISTER',
      drugId,
      route,
      dose: preset.amount,
      unit: preset.unit,
      label: preset.label,
      ...(multiplier === undefined ? {} : { multiplier }),
    },
  };
}

const IV: ScheduledIntent = { at: 0, intent: { type: 'IV_ACCESS', on: true } };
const NO_IV: ScheduledIntent = { at: 0, intent: { type: 'IV_ACCESS', on: false } };

/** Total exposure: a trapezoidal AUC over the sampled curve, ng/mL x min. */
function aucOf(
  samples: { t: number; drugs: { drugId: string; plasma_ng_per_mL: number }[] }[],
  drugId: string,
): number {
  let auc = 0;
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1].drugs.find((x) => x.drugId === drugId)?.plasma_ng_per_mL ?? 0;
    const b = samples[i].drugs.find((x) => x.drugId === drugId)?.plasma_ng_per_mL ?? 0;
    auc += ((a + b) / 2) * ((samples[i].t - samples[i - 1].t) / 60);
  }
  return auc;
}

/** Peak plasma concentration and when it happened, in minutes. */
function peakOf(samples: { t: number; drugs: { drugId: string; plasma_ng_per_mL: number }[] }[], drugId: string) {
  let best = -1;
  let at = 0;
  for (const s of samples) {
    const d = s.drugs.find((x) => x.drugId === drugId);
    const c = d?.plasma_ng_per_mL ?? 0;
    if (c > best) {
      best = c;
      at = s.t / 60;
    }
  }
  return { peak: best, tmax_min: at };
}

describe('the route table', () => {
  it('declares every route the Route union names, and no others', () => {
    const declared = Object.keys((routesFile as { routes: Record<string, unknown> }).routes).sort();
    expect(ROUTE_IDS.slice().sort()).toEqual(declared);
  });

  it('cites a source and explains itself for every route', () => {
    const sources = (routesFile as unknown as { sources: Record<string, { label: string; url: string }> }).sources;
    for (const id of ROUTE_IDS) {
      const spec = routeSpec(id);
      expect(sources[spec.source], `${id} source key`).toBeTruthy();
      expect(spec.note.length, `${id} note`).toBeGreaterThan(80);
      expect(['measured', 'derived', 'assumed']).toContain(spec.confidence);
    }
  });

  it('expresses every depot route relative to the intramuscular one', () => {
    // IM is the reference by construction. If it ever stops being 1.0 the whole table
    // silently changes meaning, because every other scale is a ratio against it.
    expect(routeSpec('IM').kaScale).toBe(1);
    for (const id of ROUTE_IDS) {
      const spec = routeSpec(id);
      if (spec.kind === 'depot') expect(spec.kaScale, id).toBeGreaterThan(0);
      else expect(spec.kaScale, id).toBeNull();
    }
  });

  it('every preset names a route its drug actually declares', () => {
    for (const d of DRUGS) {
      for (const p of d.presetDoses) {
        expect(d.routes, `${d.id} ${p.label}`).toContain(p.route);
      }
    }
  });

  it('refuses a depot route for a drug with no measured absorption rate', () => {
    // The honest failure. Without a ka to scale there is no rate to release at, and
    // inventing one would be inventing pharmacokinetics.
    const noKa = DRUGS.find((d) => d.pk.ka_min === null && !d.routePk);
    expect(noKa, 'expected at least one drug without a measured ka').toBeTruthy();
    expect(depotParamsFor(noKa!, 'SUBCUTANEOUS')).toBeNull();
  });
});

describe('routes behave differently from each other', () => {
  it('subcutaneous is slower and lower-peaking than intramuscular', () => {
    const im = run({ seconds: 3600, sampleEvery: 10, intents: [giveAt(10, 'morphine', 'IM')] });
    const sc = run({ seconds: 3600, sampleEvery: 10, intents: [giveAt(10, 'morphine', 'SUBCUTANEOUS')] });

    const a = peakOf(im.samples, 'morphine');
    const b = peakOf(sc.samples, 'morphine');

    expect(b.tmax_min).toBeGreaterThan(a.tmax_min);
    expect(b.peak).toBeLessThan(a.peak);
    expect(b.peak).toBeGreaterThan(0);
  });

  it('intraosseous reaches essentially the same peak as intravenous', () => {
    const iv = run({ seconds: 600, sampleEvery: 2, intents: [IV, giveAt(10, 'epinephrine', 'IV_PUSH')] });
    const io = run({ seconds: 600, sampleEvery: 2, intents: [giveAt(10, 'epinephrine', 'INTRAOSSEOUS')] });

    const a = peakOf(iv.samples, 'epinephrine');
    const b = peakOf(io.samples, 'epinephrine');

    // Same dose, same destination, one transit delay apart.
    expect(b.peak / a.peak).toBeGreaterThan(0.85);
    expect(b.peak / a.peak).toBeLessThan(1.05);
  });

  it('but the intraosseous delay costs a drug whose half-life is shorter than it', () => {
    // Adenosine has a six-second half-life, so fifteen seconds of transit is more than
    // two of them. The model says an intraosseous adenosine push lands at about half
    // the peak of an intravenous one, and that is not an artefact — it is the reason
    // adenosine is pushed fast, as close to the heart as possible, and chased with a
    // flush. A route that were modelled as simply "IV but later" would hide this.
    const iv = run({ seconds: 600, sampleEvery: 2, intents: [IV, giveAt(10, 'adenosine', 'IV_PUSH')] });
    const io = run({ seconds: 600, sampleEvery: 2, intents: [giveAt(10, 'adenosine', 'INTRAOSSEOUS')] });

    const ratio = peakOf(io.samples, 'adenosine').peak / peakOf(iv.samples, 'adenosine').peak;
    expect(ratio).toBeGreaterThan(0.3);
    expect(ratio).toBeLessThan(0.75);
  });

  it('intraosseous works with no intravenous access, which is its entire point', () => {
    // The reference body starts with a line in, so access has to be removed first.
    const io = run({ seconds: 300, sampleEvery: 5, intents: [NO_IV, giveAt(10, 'epinephrine', 'INTRAOSSEOUS')] });
    const ivNoAccess = run({ seconds: 300, sampleEvery: 5, intents: [NO_IV, giveAt(10, 'epinephrine', 'IV_PUSH')] });

    expect(peakOf(io.samples, 'epinephrine').peak).toBeGreaterThan(0);
    // The IV push is refused outright without access, so nothing reaches the plasma.
    expect(peakOf(ivNoAccess.samples, 'epinephrine').peak).toBe(0);
  });

  it('rectal delivers more of the dose than oral, and less than intramuscular', () => {
    // The comparison has to be TOTAL EXPOSURE, not peak. Rectal absorption is slow
    // enough for this drug that its peak is flatter than the oral one even though
    // more of the dose arrives — comparing peaks would report the opposite of the
    // truth, which is what bioavailability actually means.
    const pr = run({ seconds: 7200, sampleEvery: 60, intents: [giveAt(10, 'morphine', 'RECTAL')] });
    const po = run({ seconds: 7200, sampleEvery: 60, intents: [giveAt(10, 'morphine', 'ORAL')] });
    const im = run({ seconds: 7200, sampleEvery: 60, intents: [giveAt(10, 'morphine', 'IM')] });

    const rectal = aucOf(pr.samples, 'morphine');
    const oral = aucOf(po.samples, 'morphine');
    const intramuscular = aucOf(im.samples, 'morphine');

    expect(rectal).toBeGreaterThan(0);
    expect(oral).toBeLessThan(rectal);
    expect(rectal).toBeLessThan(intramuscular);
  });

  it('a transdermal patch delivers nothing at all until its lag has run', () => {
    // The lag is the point. A decision made now has no visible consequence until
    // long after the person who made it has stopped watching, and there is no way to
    // take it back once it starts. Six hours in, the patch has delivered nothing.
    const s = run({ seconds: 6 * 3600, sampleEvery: 600, intents: [giveAt(10, 'fentanyl', 'TRANSDERMAL')] });
    expect(peakOf(s.samples, 'fentanyl').peak).toBe(0);

    const d = s.final.drugs.find((x) => x.drugId === 'fentanyl');
    const patch = d?.depots.find((x) => x.route === 'TRANSDERMAL');
    expect(patch, 'the patch should still be on').toBeTruthy();
    expect(patch!.releasing).toBe(false);
    expect(patch!.lagRemaining_min).toBeGreaterThan(5 * 60);
    // Nothing has left it: the whole dose is still sitting in the skin.
    expect(patch!.amount_mg).toBeCloseTo(1.8, 3);
  });

  it('a nebuliser delivers over its run time rather than all at once', () => {
    const neb = run({ seconds: 3600, sampleEvery: 15, intents: [giveAt(10, 'albuterol', 'NEBULISED')] });
    const mdi = run({ seconds: 3600, sampleEvery: 15, intents: [giveAt(10, 'albuterol', 'INHALED')] });

    const n = peakOf(neb.samples, 'albuterol');
    const m = peakOf(mdi.samples, 'albuterol');

    expect(n.peak).toBeGreaterThan(0);
    // Spread over ten minutes, so the peak arrives later than a single breath's.
    expect(n.tmax_min).toBeGreaterThan(m.tmax_min);
  });

  it('nasal naloxone reproduces the time to peak its label states', () => {
    // NARCAN's label gives a median Tmax near 30 min. The ka in route_presets.ts was
    // solved against the model's own disposition to land there, so this test is what
    // makes that a claim rather than an assertion.
    const s = run({ seconds: 5400, sampleEvery: 15, intents: [giveAt(10, 'naloxone', 'INTRANASAL')] });
    const { tmax_min, peak } = peakOf(s.samples, 'naloxone');
    expect(peak).toBeGreaterThan(0);
    expect(tmax_min).toBeGreaterThan(15);
    expect(tmax_min).toBeLessThan(50);
  });

  it('keeps two depots on the same drug separate', () => {
    // An injection and a patch absorb three orders of magnitude apart. A single
    // shared depot would release the patch at the injection's rate.
    const both = run({
      seconds: 3 * 3600,
      sampleEvery: 60,
      intents: [giveAt(10, 'fentanyl', 'TRANSDERMAL'), giveAt(20, 'fentanyl', 'IM')],
    });

    const last = both.final.drugs.find((d) => d.drugId === 'fentanyl');
    expect(last).toBeTruthy();
    const patch = last!.depots.find((d) => d.route === 'TRANSDERMAL');
    const shot = last!.depots.find((d) => d.route === 'IM');

    // Three hours in: the intramuscular dose is gone and the patch has barely started.
    expect(patch, 'patch depot should still exist').toBeTruthy();
    expect(patch!.amount_mg).toBeGreaterThan(1.0);
    expect(shot === undefined || shot.amount_mg < 0.02).toBe(true);
  });
});

describe('custom dosing is bounded, and the bound is in the worker', () => {
  it('scales the response with the multiplier', () => {
    const low = run({ seconds: 600, sampleEvery: 5, intents: [IV, giveAt(10, 'fentanyl', 'IV_PUSH', 0.25)] });
    const ref = run({ seconds: 600, sampleEvery: 5, intents: [IV, giveAt(10, 'fentanyl', 'IV_PUSH', 1)] });
    const high = run({ seconds: 600, sampleEvery: 5, intents: [IV, giveAt(10, 'fentanyl', 'IV_PUSH', 4)] });

    const a = peakOf(low.samples, 'fentanyl').peak;
    const b = peakOf(ref.samples, 'fentanyl').peak;
    const c = peakOf(high.samples, 'fentanyl').peak;

    expect(a).toBeLessThan(b);
    expect(c).toBeGreaterThan(b);
    // Linear kinetics, so the ratios should track the multipliers closely.
    expect(a / b).toBeCloseTo(0.25, 1);
    expect(c / b).toBeCloseTo(4, 0);
  });

  it('clamps a multiplier beyond the declared range instead of honouring it', () => {
    const atMax = run({ seconds: 300, sampleEvery: 5, intents: [IV, giveAt(10, 'fentanyl', 'IV_PUSH', MAX_DOSE_MULTIPLIER)] });
    const absurd = run({ seconds: 300, sampleEvery: 5, intents: [IV, giveAt(10, 'fentanyl', 'IV_PUSH', 10_000)] });

    expect(peakOf(absurd.samples, 'fentanyl').peak).toBeCloseTo(peakOf(atMax.samples, 'fentanyl').peak, 5);
  });

  it('clamps upward too, so a zero or negative multiplier cannot erase the dose', () => {
    const atMin = run({ seconds: 300, sampleEvery: 5, intents: [IV, giveAt(10, 'fentanyl', 'IV_PUSH', MIN_DOSE_MULTIPLIER)] });
    const zero = run({ seconds: 300, sampleEvery: 5, intents: [IV, giveAt(10, 'fentanyl', 'IV_PUSH', 0)] });
    const negative = run({ seconds: 300, sampleEvery: 5, intents: [IV, giveAt(10, 'fentanyl', 'IV_PUSH', -5)] });

    const floor = peakOf(atMin.samples, 'fentanyl').peak;
    expect(peakOf(zero.samples, 'fentanyl').peak).toBeCloseTo(floor, 5);
    expect(peakOf(negative.samples, 'fentanyl').peak).toBeCloseTo(floor, 5);
  });

  it('survives a NaN multiplier by falling back to the reference dose', () => {
    // A NaN reaching the PK integrator poisons every compartment silently and
    // permanently, so this is a containment test, not a politeness one.
    const nan = run({ seconds: 300, sampleEvery: 5, intents: [IV, giveAt(10, 'fentanyl', 'IV_PUSH', Number.NaN)] });
    const ref = run({ seconds: 300, sampleEvery: 5, intents: [IV, giveAt(10, 'fentanyl', 'IV_PUSH', 1)] });

    const p = peakOf(nan.samples, 'fentanyl').peak;
    expect(Number.isFinite(p)).toBe(true);
    expect(p).toBeCloseTo(peakOf(ref.samples, 'fentanyl').peak, 5);
  });

  it('STILL refuses an amount that is not a declared preset', () => {
    // The original guardrail, unchanged. The multiplier scales a cited reference; it
    // does not open a path for an arbitrary absolute dose.
    const forged = run({
      seconds: 300,
      sampleEvery: 5,
      intents: [
        IV,
        {
          at: 10,
          intent: {
            type: 'ADMINISTER',
            drugId: 'fentanyl',
            route: 'IV_PUSH',
            dose: 12_345,
            unit: 'mcg',
            label: 'forged',
          },
        },
      ],
    });
    expect(peakOf(forged.samples, 'fentanyl').peak).toBe(0);
  });
});

describe('the dose control shows the curve the engine will actually produce', () => {
  /**
   * The preview exists to make a multiplier mean something. It is worth exactly as
   * much as its agreement with the engine, so that agreement is asserted rather than
   * assumed — a preview that quietly drifts from the simulation is worse than no
   * preview, because it is believed.
   */
  const cases: [string, Route][] = [
    ['fentanyl', 'IV_PUSH'],
    ['fentanyl', 'IM'],
    ['naloxone', 'INTRANASAL'],
    ['morphine', 'SUBCUTANEOUS'],
    ['atropine', 'IM'],
  ];

  for (const [drugId, route] of cases) {
    it(`agrees with the engine for ${drugId} ${route}`, () => {
      const drug = byId(drugId);
      const preset = drug.presetDoses.find((p) => p.route === route)!;
      const horizon = horizonFor(drug, route);

      const predicted = predict(drug, route, toMilligrams(preset.amount, preset.unit), horizon);
      const actual = run({
        seconds: horizon * 60,
        sampleEvery: 10,
        intents: [IV, giveAt(5, drugId, route)],
      });

      const measured = peakOf(actual.samples, drugId);
      // Snapshot concentration is ng/mL; the predictor works in mg/L. 1 mg/L = 1000 ng/mL.
      const measuredPeak = measured.peak / 1000;

      expect(predicted.peak).toBeGreaterThan(0);
      expect(predicted.peak / measuredPeak).toBeGreaterThan(0.9);
      expect(predicted.peak / measuredPeak).toBeLessThan(1.1);

      if (predicted.tmax_min > 1) {
        expect(Math.abs(predicted.tmax_min - measured.tmax_min)).toBeLessThan(
          Math.max(1.5, predicted.tmax_min * 0.2),
        );
      }
    });
  }

  it('scales the predicted peak linearly with the dose, as the kinetics do', () => {
    const drug = byId('fentanyl');
    const h = horizonFor(drug, 'IV_PUSH');
    const a = predict(drug, 'IV_PUSH', 0.1, h);
    const b = predict(drug, 'IV_PUSH', 1.0, h);
    expect(b.peak / a.peak).toBeCloseTo(10, 4);
  });

  it('says so rather than guessing when a route cannot be predicted', () => {
    const noKa = DRUGS.find((d) => d.pk.ka_min === null && !d.routePk)!;
    const p = predict(noKa, 'SUBCUTANEOUS', 1, 60);
    expect(p.points).toHaveLength(0);
    expect(p.reason).toBeTruthy();
  });

  it('marks the oral curve as approximate, because the gut model is not in it', () => {
    const p = predict(byId('morphine'), 'ORAL', 15, 480);
    expect(p.approximate).toBe(true);
  });
});
