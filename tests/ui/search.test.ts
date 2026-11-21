import { describe, expect, it } from 'vitest';
import { buildCatalogue, search, fold, MAX_RESULTS } from '../../src/ui/search';

const male = buildCatalogue({ sex: 'male', pregnant: false });
const female = buildCatalogue({ sex: 'female', pregnant: false });
const pregnant = buildCatalogue({ sex: 'female', pregnant: true });

describe('search catalogue and ranking', () => {
  it('folds case and accents', () => {
    expect(fold('Œsophagus')).toBe('oesophagus');
    expect(fold('Café')).toBe('cafe');
  });

  it('ranks a label prefix above a word start above a substring', () => {
    const cat = [
      { kind: 'part', organId: 'a', partId: 'p3', label: 'Skywalls', sub: '', folded: 'skywalls' },
      { kind: 'part', organId: 'a', partId: 'p2', label: 'Big wall', sub: '', folded: 'big wall' },
      { kind: 'part', organId: 'a', partId: 'p1', label: 'Wallace', sub: '', folded: 'wallace' },
    ] as const;
    const out = search(cat as never, 'wall');
    expect(out.map((e) => e.partId)).toEqual(['p1', 'p2', 'p3']);
  });

  it('puts an organ before a part on a tie', () => {
    const out = search(male, 'kidney');
    expect(out[0].kind).toBe('organ');
  });

  it('finds a pyramid and is case and accent blind', () => {
    const out = search(male, 'PYR');
    expect(out.some((e) => e.partId === 'renal_medulla')).toBe(true);
    expect(search(male, 'oesoph')[0].organId).toBe('oesophagus');
  });

  it('never returns more than the limit and nothing for a blank query', () => {
    expect(search(male, 'e').length).toBeLessThanOrEqual(MAX_RESULTS);
    expect(search(male, '   ')).toEqual([]);
  });

  it('a male body never lists the uterus or its parts', () => {
    expect(male.some((e) => e.organId === 'uterus')).toBe(false);
    expect(search(male, 'uterus')).toEqual([]);
    expect(search(male, 'endometrium')).toEqual([]);
    expect(female.some((e) => e.organId === 'uterus')).toBe(true);
  });

  it('a non-pregnant body never lists the fetus', () => {
    expect(male.some((e) => e.organId === 'fetus')).toBe(false);
    expect(female.some((e) => e.organId === 'fetus')).toBe(false);
    expect(pregnant.some((e) => e.organId === 'fetus')).toBe(true);
  });

  it('lists a part of a paired organ once per side', () => {
    const cortex = male.filter((e) => e.kind === 'part' && e.partId === 'renal_cortex');
    expect(cortex.map((e) => e.label)).toEqual(['Renal Cortex, left kidney', 'Renal Cortex, right kidney']);
    expect(new Set(cortex.map((e) => e.organId)).size).toBe(2);
  });
});
