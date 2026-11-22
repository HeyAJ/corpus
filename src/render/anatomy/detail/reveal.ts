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
 *       times the parent's bounding radius, but never less than `REVEAL_FLOOR_M` and never more
 *       than `REVEAL_ORGAN_CAP` times the OPEN ORGAN's bounding radius. The floor exists because
 *       a valve (radius about 0.01 m) would otherwise need a distance the orbit rig, which will
 *       not come closer than 0.07 m to its target, can barely reach. The cap exists because the
 *       pericardium is as big as the heart: six and a half of its radii is farther than the camera sits
 *       when the heart is first opened, and its layers would have been on show from the start.
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
 * level 1 (key 2 = its children's level) and of a part at level 2 (key 3) appear. MEASURED, not
 * guessed: on a 1280 x 860 desktop the rig flies to a part at about nine of its radii (the left
 * ventricle, radius 0.052 m, is framed from 0.483 m, with the 21 degree field of view the camera
 * has), so 6.5 means "about a third closer than the part would be framed" and a visitor who zooms in by
 * hand gets the finer structures a clear step before the part fills the view (8 let the right
 * ventricle's children appear while the visitor was still being flown to the left one). A display
 * constant.
 */
export const REVEAL_RADII: Readonly<Record<2 | 3, number>> = { 2: 6.5, 3: 6.5 };

/**
 * The smallest reach, metres of scene, whatever the parent's size. A valve (radius about
 * 0.01 m) is framed from about 0.1 m, and the orbit rig's floor is 0.07 m, so 0.13 m means
 * "zoomed right in" for a part too small to be reached at eight radii. It is only half the test
 * now: the camera must also be zoomed in past the organ's own opening view (REVEAL_ZOOM_FRACTION),
 * because for an organ framed from inside 0.13 m this floor alone was met at once. A display constant.
 */
export const REVEAL_FLOOR_M = 0.13;

/**
 * The largest reach, in units of the OPEN ORGAN's bounding radius (the heart's is 0.094 m and
 * it is first framed from 0.74 m, about eight of those). 3.5 means the camera must have come
 * more than half of the way in from the opening view before the finer structures of a part as big
 * as the organ appear on their own. A display constant.
 */
export const REVEAL_ORGAN_CAP = 3.5;

/**
 * ZOOMING IN, whatever the organ's size. The reach above is an absolute distance, and that went
 * wrong for small organs: the right adrenal is framed on open from 0.119 m, which is already
 * inside the 0.13 m floor, so all nine of its children showed the instant it opened (and the left
 * adrenal, framed from 0.135 m because of the panel offset, showed none until a hand zoom). Progressive
 * disclosure means "closer than where the organ was framed when opened", so the proximity route
 * ALSO requires the camera to be nearer the open organ's centre than this fraction of the distance
 * the rig frames that organ at. 0.75 means a quarter of the way in from the opening view. A display
 * constant, not an anatomical one.
 */
export const REVEAL_ZOOM_FRACTION = 0.75;

/**
 * Has the visitor zoomed in on the open organ? `distanceToOrgan` is camera to the organ's centre,
 * `framingDistance` the distance the orbit rig frames that organ at on open. A non-finite or
 * non-positive framing distance (no organ, no rig yet) answers false, so nothing is revealed by
 * a number that does not exist.
 */
export function zoomedIn(distanceToOrgan: number, framingDistance: number): boolean {
  if (!(framingDistance > 0) || !Number.isFinite(framingDistance) || !Number.isFinite(distanceToOrgan)) return false;
  return distanceToOrgan < REVEAL_ZOOM_FRACTION * framingDistance;
}

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

/**
 * CLOSE-UP LEGIBILITY. While the visitor is looking at a part that has finer structures (or at one
 * of those structures), everything else is pushed back so the part and its family dominate. All
 * display choices, none of them anatomical:
 *
 *   FOCUS_FAINT_OPACITY    a part that is neither the focus, nor its family, nor its ancestor is
 *                          drawn at this fraction of its opacity (and as glass, so it does not
 *                          write depth and hide what lies behind it). Without it the right
 *                          ventricle stood in front of the left one's papillary muscles.
 *   FOCUS_PARENT_GLASS_DROP the focused part itself thins by this much while its children show
 *                          (PARENT_GLASS_DROP alone left a wall at 45 % over its own muscles).
 *   FOCUS_STREAM_FRACTION  the organ's stream droplets are drawn at this fraction of their
 *                          strength while a part is focused.
 *   FOCUS_OVERLAY_DIM      how much of the vessel overlay (walls and particles) is removed
 *                          inside the open organ while a part is focused; the vessels outside
 *                          the organ are untouched.
 *   FOCUS_EASE_S           the time constant of all of the above, so focus is a settle and not a
 *                          pop; under reduced motion it is instant.
 */
export const FOCUS_FAINT_OPACITY = 0.12;
/** The same for an ANCESTOR of the focused part (the chamber round a valve), a little firmer so the context still reads. Display constant. */
export const FOCUS_ANCESTOR_OPACITY = 0.25;
export const FOCUS_PARENT_GLASS_DROP = 0.8;
export const FOCUS_STREAM_FRACTION = 0.3;
export const FOCUS_OVERLAY_DIM = 0.85;
export const FOCUS_EASE_S = 0.15;

/**
 * Is a close look under way: the selected part has finer structures, or is one? A pick of a part
 * with nothing beneath it (a kidney's cortex) keeps the old, gentler dimming, so only the parts
 * whose children the reveal rule opens get the strong treatment.
 */
export function isCloseLook(tree: RevealTree | null, selected: string | null): boolean {
  if (!tree || selected === null) return false;
  return tree.children.has(selected) || (tree.depth.get(selected) ?? 1) > 1;
}

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
 * centre. `childLevel` is the level of the CHILDREN (2 or 3); `organRadius` is the open organ's
 * bounding radius, for the cap (omit it for no cap). The floor wins over the cap.
 */
export function revealReach(childLevel: number, parentRadius: number, organRadius = Infinity): number {
  const mult = childLevel >= 3 ? REVEAL_RADII[3] : REVEAL_RADII[2];
  const wanted = mult * Math.max(0, parentRadius);
  return Math.max(REVEAL_FLOOR_M, Math.min(wanted, REVEAL_ORGAN_CAP * organRadius));
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
    if (selectionReveals(tree, node.id, selected)) {
      out.add(node.id);
      continue;
    }
    // FOCUS NARROWS ATTENTION. While a part is selected or flown to, proximity may only open
    // that part's OWN descendants. Before this, the camera sitting close to a focused part was
    // also close to everybody else's centre: focusing the thalamus (5 children) showed 55, and
    // focusing the mitral valve showed all 33 heart children, including the pericardium's three
    // closed shells round the whole heart, a pink wash over the cusps (the very failure the
    // brain scan had with the meninges). With nothing focused (free zoom) proximity applies to
    // every part, as it always did.
    if (selected !== null && !up.includes(selected)) continue;
    if (withinReach(parent, level)) out.add(node.id);
  }
  return out;
}

/** One step of a fade towards `target` (0 or 1) at `dt` seconds; `reduced` jumps at once. */
export function stepReveal(current: number, target: 0 | 1, dt: number, reduced: boolean): number {
  if (reduced) return target;
  if (target > current) return Math.min(1, current + dt / REVEAL_FADE_IN_S);
  return Math.max(0, current - dt / REVEAL_FADE_OUT_S);
}
