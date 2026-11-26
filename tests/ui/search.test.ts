import { describe, expect, it } from 'vitest';
import { buildCatalogue, search, fold, MAX_RESULTS } from '../../src/ui/search';
import { ANATOMY } from '../../src/data/anatomy';
import { activitySourceOf, ancestorIds, buildPartTree, countBeneath } from '../../src/ui/anatomyTree';

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

  it('finds the five head and neck organs and their parts', () => {
    for (const [query, organId] of [['mouth', 'mouth'], ['salivary', 'salivary_glands'], ['pharynx', 'pharynx'], ['nasal cav', 'nasal_cavity'], ['ears', 'ears']] as const) {
      expect(search(male, query).some((e) => e.kind === 'organ' && e.organId === organId), query).toBe(true);
    }
    expect(search(male, 'tongue').some((e) => e.organId === 'mouth' && e.partId === 'tongue')).toBe(true);
  });

  it('finds the five skeleton organs by name (layer organs are built on demand when selected)', () => {
    for (const [query, organId] of [['skull', 'skull'], ['rib cage', 'thoracic_cage'], ['vertebral', 'vertebral_column'], ['shoulder and arm', 'upper_limb_bones'], ['hip and thigh', 'lower_limb_bones']] as const) {
      expect(search(male, query).some((e) => e.kind === 'organ' && e.organId === organId), query).toBe(true);
    }
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

describe('finer structures (parts with a parent)', () => {
  it('finds a child like any other part and names its parent in the subtitle', () => {
    const out = search(male, 'papillary');
    const left = out.find((e) => e.partId === 'papillary_muscles_lv');
    expect(left?.organId).toBe('heart');
    expect(left?.sub).toBe('Left Ventricle, Heart');
  });

  it('names the organ alone for a level-1 part', () => {
    const lv = search(male, 'left ventricle').find((e) => e.partId === 'left_ventricle');
    expect(lv?.sub).toBe('Heart');
  });

  it('lists every part of the atlas, children included, exactly once', () => {
    const heart = male.filter((e) => e.kind === 'part' && e.organId === 'heart');
    expect(heart.length).toBe(ANATOMY.heart.parts.length);
    expect(new Set(heart.map((e) => e.partId)).size).toBe(heart.length);
  });
});

describe('the part tree the panel shows', () => {
  const parts = ANATOMY.heart.parts;

  it('nests each child under its parent and keeps file order', () => {
    const roots = buildPartTree(parts);
    const lv = roots.find((n) => n.part.id === 'left_ventricle');
    expect(lv?.children.map((c) => c.part.id)).toEqual(['papillary_muscles_lv', 'chordae_tendineae_lv', 'trabeculae_carneae_lv']);
    expect(lv?.children.every((c) => c.level === 2)).toBe(true);
    expect(roots.every((n) => n.level === 1 && !n.part.parent)).toBe(true);
  });

  it('counts the whole tree once', () => {
    const roots = buildPartTree(parts);
    const total = roots.reduce((n, r) => n + 1 + countBeneath(r), 0);
    expect(total).toBe(parts.length);
  });

  it('lists ancestors nearest first and shows a parent\u2019s activity for a child with no drives', () => {
    expect(ancestorIds(parts, 'chordae_tendineae_lv')).toEqual(['left_ventricle']);
    expect(activitySourceOf(parts, 'chordae_tendineae_lv')).toBe('left_ventricle');
    expect(activitySourceOf(parts, 'papillary_muscles_lv')).toBe('papillary_muscles_lv');
    expect(activitySourceOf(parts, 'left_ventricle')).toBe('left_ventricle');
  });

  it('does not crash on a missing parent or a cycle: those parts become level 1', () => {
    const base = { label: '', summary: '', function: '', color: '#000000', rest: 0, drives: [], source: 's' };
    const broken = [
      { ...base, id: 'a', parent: 'nowhere' },
      { ...base, id: 'b', parent: 'c' },
      { ...base, id: 'c', parent: 'b' },
      { ...base, id: 'd', parent: 'd' },
    ];
    expect(buildPartTree(broken).map((n) => n.part.id).sort()).toEqual(['a', 'b', 'c', 'd']);
    expect(ancestorIds(broken, 'b').length).toBeLessThan(3);
  });
});

