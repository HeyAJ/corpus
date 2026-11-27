import { describe, expect, it } from 'vitest';
import { Engine } from '../../src/sim/core/engine';
import { P } from '../../src/sim/core/constants';
import { inr, aptt } from '../../src/sim/systems/coagulation';
import drugs from '../../src/data/drugs.json';
import type { SimState } from '../../src/sim/core/state';

/**
 * FLUID PAYLOADS OBEY MASS BALANCE, AND TRANEXAMIC ACID LEAVES THE CLOTTING TESTS ALONE.
 *
 * Two measured defects. A litre of normal saline used to raise serum sodium from 142 to
 * 157 mEq/L in an hour because its sodium and chloride arrived without its water, and
 * the fluid then left the circulation as if it were plasma water. And tranexamic acid, an
 * antifibrinolytic, read INR 0.60 and aPTT 18.1 s because its positive sign on
 * `blood.coagulation` was taken as extra clotting factors.
 *
 * The prediction is the infusate mixing relation computed from THIS model's own pool
 * (extracellular volume 0.2 x body mass): c' = (c E + C_in V) / (E + V), the
 * Adrogue-Madias infusate formula (N Engl J Med 2000;342:1581). It is a check, not a
 * model constant. Each case is compared with a no-drug control run of the same length,
 * because the resting body drifts by a few tenths of a mEq/L an hour on its own.
 */

const DT = P('sim.dt_s');
type DrugRow = { id: string; presetDoses: { route: string; amount: number; unit: string; label: string }[] };
const list = ((drugs as unknown as { drugs?: DrugRow[] }).drugs ?? (drugs as unknown as DrugRow[])) as DrugRow[];

function run(drugId: string | null, presetIndex: number, seconds: number) {
  const e = new Engine(0x5eed);
  e.applyIntent({ type: 'IV_ACCESS', on: true } as never);
  if (drugId) {
    const p = list.find((x) => x.id === drugId)!.presetDoses[presetIndex];
    e.applyIntent({ type: 'ADMINISTER', drugId, route: p.route, dose: p.amount, unit: p.unit, label: p.label } as never);
  }
  const s: SimState = e.state;
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    e.tick(DT);
    e.pending.length = 0;
  }
  return { e, s };
}

const SECONDS = 20 * 60;

describe('payload drugs mix water and solute together', () => {
  const ctl = run(null, 0, SECONDS).s;
  const E = ctl.body.mass_kg * 0.2;
  const osm = (s: SimState) => 2 * s.chem.na + s.metabolic.G / 18 + 5;

  it('500 mL of normal saline moves sodium, chloride, potassium and bicarbonate only by the infusate difference', () => {
    const { s } = run('normal_saline', 0, SECONDS);
    const V = 0.5;
    const f = V / (E + V);
    // The drip arrives over 15 minutes, so the exact mixing is the exponential form; the
    // two differ by far less than the 0.5 mEq/L tolerance for a half litre.
    expect(s.chem.na - ctl.chem.na).toBeCloseTo((154 - ctl.chem.na) * f, 0);
    expect(Math.abs(s.chem.na - ctl.chem.na - (154 - ctl.chem.na) * f)).toBeLessThan(0.5);
    expect(Math.abs(s.chem.cl - ctl.chem.cl - (154 - ctl.chem.cl) * f)).toBeLessThan(0.5);
    expect(Math.abs(s.chem.k - ctl.chem.k + ctl.chem.k * f)).toBeLessThan(0.5);
    expect(Math.abs(s.acidBase.metabolicHco3 - ctl.acidBase.metabolicHco3 + ctl.acidBase.metabolicHco3 * f)).toBeLessThan(0.5);
    // Osmolality follows sodium at this glucose, and an isotonic litre must not move it by 30.
    expect(Math.abs(osm(s) - osm(ctl) - 2 * (154 - ctl.chem.na) * f)).toBeLessThan(1);
    // The old defect: sodium rose by 8 mEq/L from the same half litre.
    expect(s.chem.na - ctl.chem.na).toBeLessThan(2);
  });

  it('50 mEq of sodium bicarbonate adds its sodium and bicarbonate once, with its 50 mL of water', () => {
    const { s } = run('sodium_bicarbonate', 0, SECONDS);
    const V = 0.05;
    const f = V / (E + V);
    expect(Math.abs(s.chem.na - ctl.chem.na - (1000 - ctl.chem.na) * f)).toBeLessThan(0.5);
    expect(Math.abs(s.acidBase.metabolicHco3 - ctl.acidBase.metabolicHco3 - (1000 - ctl.acidBase.metabolicHco3) * f)).toBeLessThan(0.5);
    expect(Math.abs(osm(s) - osm(ctl) - 2 * (1000 - ctl.chem.na) * f)).toBeLessThan(1);
  });

  it('dextrose adds its glucose once and its water dilutes the sodium', () => {
    const { s } = run('dextrose_10', 0, SECONDS);
    const V = 0.25;
    const f = V / (E + V);
    expect(Math.abs(s.chem.na - ctl.chem.na + ctl.chem.na * f)).toBeLessThan(0.5);
    // 25 g of glucose in the Bergman volume would be +21 mg/dL if it were all still there
    // (and 42 if counted twice); insulin has cleared most of it by 20 minutes, so the
    // only thing asserted is that it is not counted twice.
    const gain = (25 * 1000) / P('metabolic.glucoseDistributionVolume_dL');
    expect(s.metabolic.G - ctl.metabolic.G).toBeLessThan(gain);
  });

  it('potassium chloride, which carries no water, still lands as before', () => {
    const { s } = run('potassium_chloride', 1, SECONDS);
    expect(s.chem.k - ctl.chem.k).toBeGreaterThan(0.4);
    expect(Math.abs(s.chem.na - ctl.chem.na)).toBeLessThan(0.05);
  });
});

describe('tranexamic acid and the clotting screen', () => {
  const screen = (id: string | null) => {
    const { s } = run(id, 0, 600);
    return { inr: inr(s), aptt: aptt(s) };
  };

  it('leaves the INR and aPTT at normal', () => {
    const t = screen('tranexamic_acid');
    expect(t.inr).toBeGreaterThan(0.98);
    expect(t.inr).toBeLessThan(1.02);
    expect(Math.abs(t.aptt - 30)).toBeLessThan(0.5);
  });

  it('still lengthens the screen for an anticoagulant', () => {
    expect(screen('heparin').inr).toBeGreaterThan(1.5);
  });

  it('stops a bleed sooner than no drug', () => {
    const bleed = (id: string | null) => {
      const e = new Engine(0x5eed);
      e.applyIntent({ type: 'IV_ACCESS', on: true } as never);
      if (id) {
        const p = list.find((x) => x.id === id)!.presetDoses[0];
        e.applyIntent({ type: 'ADMINISTER', drugId: id, route: p.route, dose: p.amount, unit: p.unit, label: p.label } as never);
      }
      e.applyIntent({ type: 'SET_BLEED', rate_mL_per_min: 10 } as never);
      for (let i = 0; i < Math.round(300 / DT); i++) {
        e.tick(DT);
        e.pending.length = 0;
      }
      return e.state.coagulation.haemostasis;
    };
    expect(bleed('tranexamic_acid')).toBeGreaterThan(bleed(null) + 0.05);
  });
});
