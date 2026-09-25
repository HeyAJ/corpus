import { describe, expect, it } from 'vitest';
import { Engine, DRUGS } from '../../src/sim/core/engine';
import { P } from '../../src/sim/core/constants';

/**
 * ACID–BASE AND THE HEART–LUNG COUPLING.
 *
 * These are the two things the 2026-09-24 rebuild set out to fix: blood pH was a frozen
 * constant, and the lungs could not kill the heart. Both are behaviour, not data, so
 * they are tested by driving the engine and reading what comes out — never by asserting
 * a number in a file.
 */

const DT = P('sim.dt_s');

function settle(): Engine {
  const e = new Engine(0x5eed);
  e.applyIntent({ type: 'IV_ACCESS', on: true } as never);
  return e;
}
function run(e: Engine, seconds: number): void {
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    e.tick(DT);
    e.pending.length = 0;
  }
}
function presetOf(id: string): { route: string; amount: number; unit: string } {
  const d = DRUGS.find((x) => x.id === id)!;
  const p = d.presetDoses.find((x) => x.route === 'IV_PUSH') ?? d.presetDoses[0];
  return { route: p.route, amount: p.amount, unit: p.unit };
}

function giveFentanyl(e: Engine, multiplier: number): void {
  e.applyIntent({
    type: 'ADMINISTER', drugId: 'fentanyl', route: 'IV_PUSH', dose: 100, unit: 'mcg', label: 'x', multiplier,
  } as never);
}

describe('acid–base is computed, not stored', () => {
  it('resting pH and bicarbonate are physiological', () => {
    const e = settle();
    run(e, 60);
    const s = e.snapshot();
    expect(s.acidBase.ph).toBeGreaterThan(7.36);
    expect(s.acidBase.ph).toBeLessThan(7.46);
    expect(s.acidBase.hco3_mEq_per_L).toBeGreaterThan(21);
    expect(s.acidBase.hco3_mEq_per_L).toBeLessThan(27);
    expect(s.acidBase.interpretation).toMatch(/normal/i);
  });

  it('pH actually moves — a metabolic acidosis is not silently absorbed', () => {
    const e = settle();
    run(e, 30);
    // Hold a fixed metabolic acidosis and let the respiratory system answer.
    for (let i = 0; i < Math.round(600 / DT); i++) {
      e.state.acidBase.metabolicHco3 = 12;
      e.state.acidBase.renalCompensation = 0;
      e.tick(DT);
      e.pending.length = 0;
    }
    const s = e.snapshot();
    // Acidaemic, and compensated toward Winters' PaCO2 = 1.5*12 + 8 = 26 (+/-4).
    expect(s.acidBase.ph).toBeLessThan(7.32);
    expect(s.acidBase.paco2_mmHg).toBeLessThan(31);
    expect(s.acidBase.paco2_mmHg).toBeGreaterThan(21);
    expect(s.acidBase.interpretation).toMatch(/metabolic acidosis/i);
  });

  it('an opioid overdose produces a respiratory acidosis', () => {
    const e = settle();
    giveFentanyl(e, 8);
    run(e, 300);
    const s = e.snapshot();
    expect(s.resp.paco2_mmHg).toBeGreaterThan(45);
    expect(s.acidBase.ph).toBeLessThan(7.37);
    expect(s.acidBase.interpretation).toMatch(/respiratory acidosis/i);
  });
});

describe('the lungs can kill the heart', () => {
  it('a cardiac arrest desaturates the arterial blood instead of freezing it', () => {
    const e = settle();
    e.applyIntent({ type: 'FORCE_RHYTHM', rhythm: 'asystole' } as never);
    const before = e.snapshot().resp.spo2;
    run(e, 240);
    const after = e.snapshot();
    expect(before).toBeGreaterThan(0.9);
    // Without a circulation the blood is not re-oxygenated: saturation collapses.
    expect(after.resp.spo2).toBeLessThan(0.5);
    expect(after.chem.lactate_mmol_per_L).toBeGreaterThan(2.5);
  });

  it('an unventilated paralysed patient asphyxiates into a hypoxic bradycardia', () => {
    const e = settle();
    // A neuromuscular blocker with no ventilator: the diaphragm cannot move enough air,
    // alveolar ventilation collapses below the dead space, and the body asphyxiates.
    const roc = 'rocuronium';
    const d = e.state; void d;
    e.applyIntent({ type: 'ADMINISTER', drugId: roc, route: 'IV_PUSH', dose: presetOf(roc).amount, unit: presetOf(roc).unit, label: 'x', multiplier: 1 } as never);
    run(e, 480);
    const s = e.snapshot();
    expect(s.mind.muscleTone).toBeLessThan(-0.5); // paralysed
    expect(s.resp.spo2).toBeLessThan(0.4); // profound hypoxaemia
    // The heart answers hypoxia by slowing — the pre-terminal rhythm of asphyxia.
    const arrested = s.cardio.heartRateDisplay_bpm < 55 || s.cardio.cardiacOutput_L_per_min < 3.5 ||
      s.cardio.rhythm === 'pea' || s.cardio.rhythm === 'asystole';
    expect(arrested).toBe(true);
  });

  it('supplemental oxygen keeps a hypoventilating patient saturated', () => {
    const e = settle();
    giveFentanyl(e, 6);
    e.applyIntent({ type: 'SET_ENVIRONMENT', fio2: 1.0 } as never);
    run(e, 180);
    const s = e.snapshot();
    // Still hypercapnic (ventilation is depressed) but well oxygenated.
    expect(s.resp.spo2).toBeGreaterThan(0.97);
    expect(s.resp.pao2_mmHg).toBeGreaterThan(150);
  });
});

describe('altitude', () => {
  it('lowers inspired oxygen and hyperventilates into an alkalosis', () => {
    const e = settle();
    e.applyIntent({ type: 'SET_ENVIRONMENT', altitude_m: 8000 } as never);
    run(e, 180);
    const s = e.snapshot();
    expect(s.environment.inspiredPo2_mmHg).toBeLessThan(80);
    expect(s.resp.spo2).toBeLessThan(0.92);
    expect(s.resp.paco2_mmHg).toBeLessThan(34); // hypoxic hyperventilation
  });
});
