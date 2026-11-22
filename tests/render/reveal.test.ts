import { describe, expect, it } from 'vitest';
import {
  PARENT_GLASS_DROP,
  REVEAL_FADE_IN_S,
  REVEAL_FLOOR_M,
  REVEAL_ORGAN_CAP,
  REVEAL_RADII,
  buildRevealTree,
  revealReach,
  revealedSet,
  selectionReveals,
  stepReveal,
} from '../../src/render/anatomy/detail/reveal';
import { ANATOMY } from '../../src/data/anatomy';
import { buildParts } from '../../src/render/anatomy/parts';

/**
 * THE REVEAL RULE: when a part's finer structures are shown. Pure: no three.js, no DOM.
 *
 * The toy tree: `ventricle` has children `muscle` and `cords`; `muscle` has a child `tip`;
 * `valve` has `cusp`. `lone` has none.
 */
const TREE = buildRevealTree([
  { id: 'ventricle', parent: null },
  { id: 'valve', parent: null },
  { id: 'lone', parent: null },
  { id: 'tip', parent: 'muscle' }, // listed before its parent on purpose: order must not matter
  { id: 'muscle', parent: 'ventricle' },
  { id: 'cords', parent: 'ventricle' },
  { id: 'cusp', parent: 'valve' },
]);

const nobody = () => false;
const shown = (selected: string | null, near: (p: string, l: number) => boolean = nobody) => [...revealedSet(TREE, selected, near)].sort();

describe('reveal tree', () => {
  it('works out depth and ancestors whatever the file order', () => {
    expect(TREE.depth.get('ventricle')).toBe(1);
    expect(TREE.depth.get('muscle')).toBe(2);
    expect(TREE.depth.get('tip')).toBe(3);
    expect(TREE.ancestors.get('tip')).toEqual(['muscle', 'ventricle']);
    expect(TREE.children.get('ventricle')).toEqual(['muscle', 'cords']);
    expect(TREE.order.map((n) => n.id).slice(0, 3).sort()).toEqual(['lone', 'valve', 'ventricle']);
  });

  it('does not throw on a missing parent or a cycle', () => {
    const t = buildRevealTree([
      { id: 'a', parent: 'ghost' },
      { id: 'b', parent: 'c' },
      { id: 'c', parent: 'b' },
    ]);
    expect(t.depth.get('a')).toBe(1);
    expect(t.depth.get('b')).toBeLessThan(4);
  });
});

describe('reveal by selection', () => {
  it('shows nothing when nothing is selected', () => {
    expect(shown(null)).toEqual([]);
  });

  it('shows a part’s children, and theirs, when the part is selected', () => {
    expect(shown('ventricle')).toEqual(['cords', 'muscle', 'tip']);
    expect(shown('valve')).toEqual(['cusp']);
  });

  it('does not show the children of a part that is not selected', () => {
    expect(shown('valve')).not.toContain('muscle');
    expect(shown('lone')).toEqual([]);
  });

  it('keeps the siblings of a selected child on show, and the child itself', () => {
    expect(shown('muscle')).toEqual(['cords', 'muscle', 'tip']);
    expect(selectionReveals(TREE, 'cords', 'muscle')).toBe(true);
    expect(selectionReveals(TREE, 'cusp', 'muscle')).toBe(false);
  });

  it('a grandchild picked alone shows its parent, its siblings and the parent’s siblings', () => {
    expect(shown('tip')).toEqual(['cords', 'muscle', 'tip']);
  });
});

describe('reveal by proximity', () => {
  it('shows a part’s children when the camera is within reach of it', () => {
    expect(shown(null, (p) => p === 'valve')).toEqual(['cusp']);
  });

  it('asks about a level-3 child only through a revealed parent', () => {
    // The ventricle is near, the muscle is near, so both levels show.
    expect(shown(null, () => true)).toEqual(['cords', 'cusp', 'muscle', 'tip']);
    // Only the muscle is near: its child cannot appear because the muscle is not itself on show.
    expect(shown(null, (p) => p === 'muscle')).toEqual([]);
  });

  it('is asked for the CHILDREN’s level (2 or 3)', () => {
    const asked: [string, number][] = [];
    revealedSet(TREE, null, (p, l) => {
      asked.push([p, l]);
      return true;
    });
    expect(asked).toContainEqual(['ventricle', 2]);
    expect(asked).toContainEqual(['muscle', 3]);
  });
});

describe('reach and fade constants', () => {
  it('scales with the parent but never drops below the floor', () => {
    expect(revealReach(2, 0.04)).toBeCloseTo(REVEAL_RADII[2] * 0.04, 10);
    expect(revealReach(2, 0.004)).toBe(REVEAL_FLOOR_M);
    expect(revealReach(3, 0)).toBe(REVEAL_FLOOR_M);
    expect(revealReach(3, 0.05)).toBeCloseTo(REVEAL_RADII[3] * 0.05, 10);
  });

  it('never exceeds the cap set by the open organ, except to honour the floor', () => {
    expect(revealReach(2, 0.0837, 0.0937)).toBeCloseTo(REVEAL_ORGAN_CAP * 0.0937, 10);
    expect(revealReach(2, 0.0837, 0.0001)).toBe(REVEAL_FLOOR_M);
    expect(revealReach(2, 0.04, 0.0937)).toBeCloseTo(REVEAL_RADII[2] * 0.04, 10);
  });

  it('keeps the floor reachable by an orbit rig whose minimum distance is 0.07 m', () => {
    expect(REVEAL_FLOOR_M).toBeGreaterThan(0.07);
    expect(PARENT_GLASS_DROP).toBeLessThan(1);
  });

  it('fades in over the fade time and jumps under reduced motion', () => {
    expect(stepReveal(0, 1, REVEAL_FADE_IN_S / 2, false)).toBeCloseTo(0.5, 10);
    expect(stepReveal(0.9, 1, 10, false)).toBe(1);
    expect(stepReveal(1, 0, 0.1, false)).toBeLessThan(1);
    expect(stepReveal(0, 1, 0.001, true)).toBe(1);
    expect(stepReveal(1, 0, 0.001, true)).toBe(0);
  });
});

describe('the heart atlas under the rule', () => {
  const tree = buildRevealTree(ANATOMY.heart.parts.map((p) => ({ id: p.id, parent: p.parent ?? null })));

  it('hides every child until its parent is selected, then shows exactly that parent’s children', () => {
    expect([...revealedSet(tree, null, nobody)]).toEqual([]);
    const lv = [...revealedSet(tree, 'left_ventricle', nobody)].sort();
    expect(lv).toEqual(['chordae_tendineae_lv', 'papillary_muscles_lv', 'trabeculae_carneae_lv']);
  });

  it('shows the cusps of a valve with the valve and not with the other valves', () => {
    expect([...revealedSet(tree, 'mitral_valve', nobody)].sort()).toEqual(['anterior_mitral_cusp', 'posterior_mitral_cusp']);
  });
});

describe('the heart builder against the heart data', () => {
  // A part in the data with no geometry cannot be flown to or picked; a geometry with no data
  // is drawn in a neutral colour with no words. Children are built by the same builder, so
  // the same two-way check covers them. The triangle ceiling is the lazy-build threshold in
  // the contract: the interior went from 24,276 triangles to 47,864, just under twice.
  const built = buildParts('heart', { organ: 'heart', gestationWeeks: 0 } as never);

  it('draws every part the data lists, and only those', () => {
    expect(built.map((b) => b.id).sort()).toEqual(ANATOMY.heart.parts.map((p) => p.id).sort());
  });

  it('stays within twice the triangles the heart had before it had children', () => {
    let triangles = 0;
    for (const b of built) triangles += b.geometry.index ? b.geometry.index.count / 3 : b.geometry.getAttribute('position').count / 3;
    expect(triangles).toBeLessThanOrEqual(2 * 24276);
  });
});
