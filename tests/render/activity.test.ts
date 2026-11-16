import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import organsFile from '../../src/data/organs.json';
import { CONDITION_ORGANS, SYSTEMIC_CONDITIONS, collectAlarmOrgans } from '../../src/render/organs/alarmOrgans';
import { ACTIVITY_RAMP, activityColour } from '../../src/render/organs/activityRamp';

/**
 * An organ that cannot show an alarm, and an activity colour that lies.
 *
 * Every condition id the engine can produce must be either mapped to organs or declared
 * systemic, so that adding a condition to `conditions.ts` without deciding where it shows
 * fails here instead of silently leaving the body calm. The ramp must be a true
 * sequential scale: lightness strictly falling with t, and neither red nor blue.
 */
const CONDITIONS_SRC = readFileSync(join(__dirname, '../../src/sim/derive/conditions.ts'), 'utf8');
const ids = [...CONDITIONS_SRC.matchAll(/\bid:\s*'([a-z_]+)'/g)].map((m) => m[1]);
const organIds = new Set((organsFile as { organs: { id: string }[] }).organs.map((o) => o.id));

describe('alarm organ table', () => {
  it('finds the condition ids in the source', () => {
    expect(ids.length).toBeGreaterThan(20);
  });
  it('puts every condition id in exactly one table', () => {
    for (const id of ids) {
      const inMap = id in CONDITION_ORGANS ? 1 : 0;
      const inSystemic = SYSTEMIC_CONDITIONS.includes(id) ? 1 : 0;
      expect({ id, tables: inMap + inSystemic }).toEqual({ id, tables: 1 });
    }
  });
  it('maps only to organs that exist', () => {
    for (const list of Object.values(CONDITION_ORGANS)) {
      for (const o of list) expect(organIds.has(o)).toBe(true);
    }
  });
  it('pulses on warn and critical but not on watch, and without duplicates', () => {
    const out: string[] = [];
    expect(collectAlarmOrgans([{ id: 'tachycardia', severity: 'watch' }], out)).toEqual([]);
    expect(collectAlarmOrgans([{ id: 'vfib', severity: 'critical' }, { id: 'arrest', severity: 'critical' }], out)).toEqual(['heart']);
    expect(collectAlarmOrgans([{ id: 'hypoxemia', severity: 'warn' }, { id: 'hypotension', severity: 'critical' }], out)).toEqual(['lung_l', 'lung_r']);
  });
});

describe('activity ramp', () => {
  const lum = (t: number): number => {
    const c = activityColour(t, { r: 0, g: 0, b: 0 });
    return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  };
  it('has 5 to 7 stops from 0 to 1', () => {
    expect(ACTIVITY_RAMP.length).toBeGreaterThanOrEqual(5);
    expect(ACTIVITY_RAMP.length).toBeLessThanOrEqual(7);
    expect(ACTIVITY_RAMP[0].t).toBe(0);
    expect(ACTIVITY_RAMP[ACTIVITY_RAMP.length - 1].t).toBe(1);
  });
  it('gets strictly darker with t', () => {
    for (let i = 1; i <= 100; i++) expect(lum(i / 100)).toBeLessThan(lum((i - 1) / 100));
  });
  it('is warm: red above green above blue at every stop, so neither red-alarm nor venous blue', () => {
    for (let i = 0; i <= 10; i++) {
      const c = activityColour(i / 10, { r: 0, g: 0, b: 0 });
      expect(c.r).toBeGreaterThan(c.g);
      expect(c.g).toBeGreaterThan(c.b);
      // Amber, not red: green stays within reach of red at the dark end.
      expect(c.g / c.r).toBeGreaterThan(0.5);
    }
  });
  it('clamps and tolerates NaN', () => {
    const o = { r: 0, g: 0, b: 0 };
    expect(activityColour(NaN, o).r).toBeCloseTo(activityColour(0, { r: 0, g: 0, b: 0 }).r);
    expect(activityColour(9, o).r).toBeCloseTo(activityColour(1, { r: 0, g: 0, b: 0 }).r);
  });
});
