/**
 * WHEN A FINER STRUCTURE IS SHOWN: the pure rule behind "structures within structures".
 *
 * An atlas part may name a `parent` (src/data/anatomy-types.ts): the papillary muscles of the
 * left ventricle, the cusps of a valve. Drawing all of them the moment an organ is opened would
 * bury the thing the visitor came to see (the chambers and the blood) under several dozen small
 * solids, and none of them could be read at that distance anyway. So a child is REVEALED only
 * when somebody is plainly looking for it, by either of two routes:
 *
 *   (a) SELECTION. The selected part (a tap on the body, a row in the Structures panel, a
 *       search result, `Viewer.focusPart`) is the child's parent or any ancestor of it, or is
 *       the child itself, or is a part somewhere beneath the child's parent (so picking one
 *       papillary muscle keeps its siblings in view instead of making them vanish).
 *   (b) PROXIMITY. The camera has come within REACH of the parent's centre: `REVEAL_RADII[level]`
 *       times the parent's bounding radius, but never less than `REVEAL_FLOOR_M`. The floor
 *       exists because the orbit rig will not come closer than 0.07 m to its target, and a valve
 *       (radius about 0.01 m) would otherwise need a distance it can never reach.
 *
 * A child at level 3 also needs its own parent to be revealed: a chord cannot appear on a
 * papillary muscle that is not there. Parts of level 1 are always shown (they are what the
 * organ looked like before the field existed). Nothing here knows about three.js or the DOM,
 * so tests/render/reveal.test.ts can run the rule in a bare node process.
 *
 * Every number below is a DISPLAY choice, not an anatomical or physiological one: how close is
 * "close", how long a fade lasts, how much a parent lets its children show through.
 */

/**
 * Camera reach, in units of the parent's bounding radius, at which the children of a part at
 * level 1 (key 2 = its children's level) and of a part at level 2 (key 3) appear. The rig frames
 * a sphere at about four radii, so 5 means "a little before the part fills the view". A display
 * constant.
 */
export const REVEAL_RADII: Readonly<Record<2 | 3, number>> = { 2: 5.0, 3: 4.5 };

/**
 * The smallest reach, metres of scene, whatever the parent's size. The orbit rig's floor is
 * 0.07 m, so 0.1 m means "zoomed right in" for a part too small to be framed at five radii.
 * A display constant.
 */
export const REVEAL_FLOOR_M = 0.1;

/** Seconds for a child to fade in, and out. Instant under reduced motion. Display constants. */
export const REVEAL_FADE_IN_S = 0.35;
export const REVEAL_FADE_OUT_S = 0.25;

/**
 * How transparent a part becomes while its children are on show: its own opacity is multiplied
 * by `1 - PARENT_GLASS_DROP * (the strongest child's reveal)`. A solid septum or valve would
 * otherwise hide the finer structures drawn inside it, and a picked part is never glass (see
 * OrganDetail), so the picked ventricle would have been the one part that hid its own children.
 * A display constant.
 */
export const PARENT_GLASS_DROP = 0.55;

/** Reveals below this are treated as hidden for picking and labels (the child is only fading). */
export const REVEAL_PICKABLE = 0.5;

/** What the rule needs to know about one part: its id and its parent's id (null at level 1). */
export interface RevealNode {
  readonly id: string;
  readonly parent: string | null;
}

/** The static shape of an atlas's tree, worked out once per interior. */
export interface RevealTree {
  /** Every node, parents before children (sorted by depth, then by file order). */
  readonly order: readonly RevealNode[];
  /** 1 for a part with no parent, 2 for its children, 3 for theirs. */
  readonly depth: ReadonlyMap<string, number>;
  /** The ancestors of each part, nearest first. Empty at level 1. */
  readonly ancestors: ReadonlyMap<string, readonly string[]>;
  /** The direct children of each part that has any, in file order. */
  readonly children: ReadonlyMap<string, readonly string[]>;
}

/**
 * Build the tree from the atlas's parts. A part naming a parent that is missing, or sitting in a
 * cycle, is treated as level 1 rather than thrown on: the DATA test is where such a file is
 * rejected, and a renderer that threw would take the whole interior down with one typo.
 */
export function buildRevealTree(parts: readonly RevealNode[]): RevealTree {
  const byId = new Map(parts.map((p) => [p.id, p] as const));
  const ancestors = new Map<string, readonly string[]>();
  const depth = new Map<string, number>();
  for (const p of parts) {
    const chain: string[] = [];
    const seen = new Set<string>([p.id]);
    let cursor = p.parent;
    while (cursor !== null && byId.has(cursor) && !seen.has(cursor)) {
      chain.push(cursor);
      seen.add(cursor);
      cursor = byId.get(cursor)?.parent ?? null;
    }
    // A broken link (missing parent or a cycle) leaves the chain short: level 1 or the depth
    // reached so far, never an exception.
    ancestors.set(p.id, chain);
    depth.set(p.id, chain.length + 1);
  }
  const order = parts
    .map((p, i) => ({ p, i }))
    .sort((a, b) => (depth.get(a.p.id) ?? 1) - (depth.get(b.p.id) ?? 1) || a.i - b.i)
    .map((x) => x.p);
  const children = new Map<string, string[]>();
  for (const p of parts) {
    const chain = ancestors.get(p.id) ?? [];
    if (chain.length === 0) continue;
    const list = children.get(chain[0]) ?? [];
    list.push(p.id);
    children.set(chain[0], list);
  }
  return { order, depth, ancestors, children };
}

/**
 * The camera reach for the children of a parent: how close the camera must be to the parent's
 * centre. `childLevel` is the level of the CHILDREN (2 or 3).
 */
export function revealReach(childLevel: number, parentRadius: number): number {
  const mult = childLevel >= 3 ? REVEAL_RADII[3] : REVEAL_RADII[2];
  return Math.max(REVEAL_FLOOR_M, mult * Math.max(0, parentRadius));
}

/**
 * Is the child wanted by SELECTION (route a)? `selected` is the picked or focused part id.
 */
export function selectionReveals(tree: RevealTree, childId: string, selected: string | null): boolean {
  if (selected === null) return false;
  const up = tree.ancestors.get(childId);
  if (!up || up.length === 0) return false;
  if (selected === childId) return true;
  // The selection is the parent or any ancestor of the child.
  if (up.includes(selected)) return true;
  // The selection is something beneath the child's parent (a sibling, or a sibling's child),
  // so its siblings stay on show while it is picked.
  const sel = tree.ancestors.get(selected);
  return !!sel && sel.includes(up[0]);
}

/**
 * Which children are revealed, as a set of ids. `withinReach(parentId, childLevel)` answers
 * route (b); it is only asked about a parent that is itself on show. Level-1 parts are never in
 * the set (they are always shown).
 */
export function revealedSet(
  tree: RevealTree,
  selected: string | null,
  withinReach: (parentId: string, childLevel: number) => boolean,
  out: Set<string> = new Set<string>(),
): Set<string> {
  out.clear();
  for (const node of tree.order) {
    const level = tree.depth.get(node.id) ?? 1;
    if (level < 2) continue;
    const up = tree.ancestors.get(node.id) ?? [];
    const parent = up[0];
    // A level-3 child cannot be on show unless its parent is.
    if (level >= 3 && !out.has(parent)) continue;
    if (selectionReveals(tree, node.id, selected) || withinReach(parent, level)) out.add(node.id);
  }
  return out;
}

/** One step of a fade towards `target` (0 or 1) at `dt` seconds; `reduced` jumps at once. */
export function stepReveal(current: number, target: 0 | 1, dt: number, reduced: boolean): number {
  if (reduced) return target;
  if (target > current) return Math.min(1, current + dt / REVEAL_FADE_IN_S);
  return Math.max(0, current - dt / REVEAL_FADE_OUT_S);
}
