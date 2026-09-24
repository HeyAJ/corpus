import { describe, expect, it } from 'vitest';
import {
  REFERENCE_MASS_KG,
  actionToIntrinsicActivity,
  affinityKind,
  clearancePerKgToLitresPerMin,
  halfLifeFromK,
  hoursToMinutes,
  k10FromClearance,
  kFromHalfLife,
  litresPerHourToLitresPerMin,
  macroToMicro,
  mgPerLitreToNanomolar,
  mlPerMinToLitresPerMin,
  nanomolarToPx,
  ngPerMlToNanomolar,
  pXtoNanomolar,
  parseNumber,
  parseValueWithUnit,
  terminalHalfLifeOf,
  terminalHalfLifeOf3,
  twoCompartmentFromVss,
  ugPerMlToNanomolar,
  vAreaFrom,
  vdPerKgToLitres,
} from '../../tools/ingest/normalise';

/**
 * UNIT NORMALISATION (spec 5.6).
 *
 * "A silent L/kg -> L error will make a drug look 70x too potent and it will not be
 *  obvious."
 *
 * Which is exactly why these have their own tests. Every one of these conversions
 * is a place where being wrong produces a plausible number rather than an error.
 */

describe('affinity conversion', () => {
  it('converts pKi to nanomolar', () => {
    // pKi 9 is 1 nM by definition; each log unit is a factor of ten.
    expect(pXtoNanomolar(9)).toBeCloseTo(1, 9);
    expect(pXtoNanomolar(6)).toBeCloseTo(1000, 6);
    expect(pXtoNanomolar(7.5)).toBeCloseTo(31.62, 2);
    expect(pXtoNanomolar(10)).toBeCloseTo(0.1, 9);
  });

  it('round-trips', () => {
    for (const p of [4, 5.5, 6.1, 7.99, 9, 10.4]) {
      expect(nanomolarToPx(pXtoNanomolar(p))).toBeCloseTo(p, 10);
    }
  });

  it('classifies the affinity scales GtoPdb publishes', () => {
    expect(affinityKind('pKi')).toBe('Ki');
    expect(affinityKind('pEC50')).toBe('EC50');
    expect(affinityKind('pIC50')).toBe('IC50');
    expect(affinityKind('pKd')).toBe('Kd');
    expect(affinityKind('-')).toBe('unknown');
    expect(affinityKind('')).toBe('unknown');
  });

  it('never silently treats an unknown scale as a Ki', () => {
    // An unrecognised unit must not be converted at all: guessing the scale is how
    // a micromolar affinity becomes a nanomolar one.
    expect(affinityKind('log Ki')).toBe('unknown');
  });
});

describe('volume and clearance', () => {
  it('converts L/kg to litres for the reference adult', () => {
    expect(vdPerKgToLitres(1)).toBe(REFERENCE_MASS_KG);
    expect(vdPerKgToLitres(3.3)).toBeCloseTo(231, 6);
    // The error the spec warns about, made explicit: 3.3 L/kg is 231 L, not 3.3 L.
    expect(vdPerKgToLitres(3.3)).not.toBeCloseTo(3.3, 1);
  });

  it('converts mL/min/kg to L/min', () => {
    expect(clearancePerKgToLitresPerMin(15)).toBeCloseTo(1.05, 9);
    expect(clearancePerKgToLitresPerMin(68.66)).toBeCloseTo(4.8062, 4);
  });

  it('converts mL/min and L/h to L/min', () => {
    expect(mlPerMinToLitresPerMin(2130)).toBeCloseTo(2.13, 9);
    expect(litresPerHourToLitresPerMin(2.25)).toBeCloseTo(0.0375, 9);
  });

  it('converts hours to minutes', () => {
    expect(hoursToMinutes(2.5)).toBe(150);
  });

  it('derives k10 from clearance and V1', () => {
    expect(k10FromClearance(1.05, 15)).toBeCloseTo(0.07, 9);
    expect(() => k10FromClearance(1, 0)).toThrow();
  });

  it('round-trips rate constant and half-life', () => {
    for (const t of [0.1, 2, 64, 150, 83520]) {
      expect(halfLifeFromK(kFromHalfLife(t))).toBeCloseTo(t, 6);
    }
    expect(() => kFromHalfLife(0)).toThrow();
  });

  it('computes V_area from clearance and terminal half-life', () => {
    // Epinephrine: 4.81 L/min cleared with a 2 min half-life.
    expect(vAreaFrom(4.8062, 2)).toBeCloseTo(13.87, 2);
  });
});

describe('concentration conversion', () => {
  it('converts mg/L to nanomolar', () => {
    // Epinephrine, MW 183.2: 1 mg/L is 5458 nM.
    expect(mgPerLitreToNanomolar(1, 183.2)).toBeCloseTo(5458.5, 1);
    expect(ugPerMlToNanomolar(1, 183.2)).toBeCloseTo(5458.5, 1);
    expect(ngPerMlToNanomolar(1000, 183.2)).toBeCloseTo(5458.5, 1);
  });

  it('refuses a non-positive molecular weight rather than returning Infinity', () => {
    expect(() => mgPerLitreToNanomolar(1, 0)).toThrow();
  });

  it('scales inversely with molecular weight', () => {
    // Amiodarone is 3.5x heavier than epinephrine, so the same mass is 3.5x fewer
    // molecules. Getting this backwards is the classic potency error.
    const epi = mgPerLitreToNanomolar(1, 183.2);
    const amio = mgPerLitreToNanomolar(1, 645.31);
    expect(epi / amio).toBeCloseTo(645.31 / 183.2, 6);
  });
});

describe('two-compartment inversion', () => {
  it('solves micro-constants from V1, CL, Vss and the terminal half-life', () => {
    const r = twoCompartmentFromVss(15, 1.68, 231, 120)!;
    expect(r).not.toBeNull();
    expect(r.k10).toBeCloseTo(1.68 / 15, 9);
    expect(r.k12).toBeGreaterThan(0);
    expect(r.k21).toBeGreaterThan(0);
    expect(r.alpha).toBeGreaterThan(r.beta);
  });

  it('reproduces the terminal half-life it was given', () => {
    const r = twoCompartmentFromVss(15, 1.68, 231, 120)!;
    expect(terminalHalfLifeOf(r.k10, r.k12, r.k21)).toBeCloseTo(120, 3);
  });

  it('finds the DEEP compartment’s phase for a three-compartment drug', () => {
    // Shafer 1990's fentanyl parameter set. The published terminal half-life is
    // several hours; the two-compartment formula applied to the same drug returns
    // 52.6 min, because it is reading the second phase and calling it the last one.
    const k = { k10: 0.083, k12: 0.471, k21: 0.102, k13: 0.225, k31: 0.0067 };
    const t3 = terminalHalfLifeOf3(k.k10, k.k12, k.k21, k.k13, k.k31);

    expect(t3).toBeGreaterThan(3 * 60);
    expect(t3).toBeLessThan(8 * 60);
    expect(terminalHalfLifeOf(k.k10, k.k12, k.k21)).toBeLessThan(60);
  });

  it('returns a root of the characteristic polynomial, not an approximation', () => {
    const k = { k10: 0.083, k12: 0.471, k21: 0.102, k13: 0.225, k31: 0.0067 };
    const gamma = Math.LN2 / terminalHalfLifeOf3(k.k10, k.k12, k.k21, k.k13, k.k31);

    const a2 = k.k10 + k.k12 + k.k13 + k.k21 + k.k31;
    const a1 = k.k10 * k.k21 + k.k10 * k.k31 + k.k21 * k.k31 + k.k12 * k.k31 + k.k13 * k.k21;
    const a0 = k.k10 * k.k21 * k.k31;

    expect(((gamma - a2) * gamma + a1) * gamma - a0).toBeCloseTo(0, 12);
  });

  it('collapses to the two-compartment answer when the third compartment vanishes', () => {
    // k13 = 0 means nothing ever reaches the deep compartment, so the terminal phase
    // must be the two-compartment one. A solver that cannot pass this is picking
    // roots by position rather than by value.
    const t2 = terminalHalfLifeOf(0.083, 0.471, 0.102);
    const t3 = terminalHalfLifeOf3(0.083, 0.471, 0.102, 0, 1e6);
    expect(t3).toBeCloseTo(t2, 6);
  });

  it('reproduces the steady-state volume it was given', () => {
    const v1 = 15;
    const r = twoCompartmentFromVss(v1, 1.68, 231, 120)!;
    expect(v1 * (1 + r.k12 / r.k21)).toBeCloseTo(231, 3);
  });

  it('REFUSES an inconsistent trio rather than producing nonsense', () => {
    // V_area >= Vss is a theorem about two-compartment models. A label that quotes
    // its "volume of distribution" as V_area makes the system insoluble, and the
    // honest answer is null. Before this guard existed, the solver returned a
    // terminal half-life of ten billion minutes and the drug never left the body.
    expect(twoCompartmentFromVss(15, 1.05, 231, 120)).toBeNull();
    expect(twoCompartmentFromVss(15, 1.68, 10, 120)).toBeNull(); // Vss below V1
    expect(twoCompartmentFromVss(0, 1.68, 231, 120)).toBeNull();
    expect(twoCompartmentFromVss(15, 0, 231, 120)).toBeNull();
  });

  it('macro-to-micro matches the standard identities', () => {
    const { k10, k12, k21 } = macroToMicro(0.5, 0.02, 10, 2);
    expect(k10 * k21).toBeCloseTo(0.5 * 0.02, 9);
    expect(k10 + k12 + k21).toBeCloseTo(0.5 + 0.02, 9);
  });
});

describe('value parsing', () => {
  it('strips units from the Pulse substance table format', () => {
    expect(parseValueWithUnit('68.66 mL/min kg')).toEqual({ value: 68.66, unit: 'mL/min kg' });
    expect(parseValueWithUnit('183.2 g/mol')).toEqual({ value: 183.2, unit: 'g/mol' });
    expect(parseValueWithUnit('0.0009 ug/mL')).toEqual({ value: 0.0009, unit: 'ug/mL' });
    expect(parseValueWithUnit('-1.37')).toEqual({ value: -1.37, unit: '' });
  });

  it('returns null for INF and for non-numeric text', () => {
    // Pulse writes INF for an unbounded transport maximum. Treating that as a
    // number would silently give the kidney infinite reabsorptive capacity.
    expect(parseValueWithUnit('INF mg/min')).toBeNull();
    expect(parseValueWithUnit('Liquid')).toBeNull();
    expect(parseValueWithUnit('')).toBeNull();
    expect(parseNumber('')).toBeNull();
    expect(parseNumber('abc')).toBeNull();
    expect(parseNumber('4.5')).toBe(4.5);
  });
});

describe('GtoPdb action vocabulary', () => {
  it('maps receptor actions onto signed intrinsic activity', () => {
    expect(actionToIntrinsicActivity('Full agonist', 'Agonist', false)).toBe(1);
    expect(actionToIntrinsicActivity('Partial agonist', 'Agonist', false)).toBeCloseTo(0.35, 6);
    expect(actionToIntrinsicActivity('Antagonist', 'Antagonist', false)).toBe(0);
    expect(actionToIntrinsicActivity('Inverse agonist', 'Agonist', false)).toBe(-1);
  });

  it('INVERTS the sign convention for transporters', () => {
    // This is the distinction that makes a receptor panel show DAT and TAAR1
    // together and mean something: a reuptake inhibitor and a substrate/releaser
    // both raise synaptic monoamine, but by opposite mechanisms.
    expect(actionToIntrinsicActivity('Inhibition', 'Inhibitor', true)).toBe(-1);
    expect(actionToIntrinsicActivity('Substrate', 'Substrate', true)).toBe(1);
  });

  it('returns null for an action it cannot interpret, rather than guessing', () => {
    expect(actionToIntrinsicActivity('None', 'None', false)).toBeNull();
    expect(actionToIntrinsicActivity('', '', false)).toBeNull();
  });
});
