import type { AnatomyPartDef } from '../data/anatomy-types';

/**
 * THE PART TREE, AS THE STRUCTURES PANEL SEES IT.
 *
 * An atlas lists its parts flat, and a part may name a `parent` (anatomy-types.ts). The panel
 * shows them nested: level-1 rows, each with the finer structures that belong to it indented
 * beneath. This file is that grouping and nothing else, with no React in it so the rule can be
 * tested in a bare node process (tests/ui/anatomyTree.test.ts).
 *
 * The renderer keeps its own copy of the same idea (src/render/anatomy/detail/reveal.ts) because
 * the render layer may not import from the UI. The two must agree and the data test
 * (tests/data/anatomy.test.ts) is what guarantees there is only one valid shape of tree: a
 * parent that exists, no cycle, depth at most three. A file that breaks those rules is rejected
 * there; this module, like the renderer's, simply does not crash on one, and treats a part whose
 * parent is missing or circular as level 1.
 */

export interface PartNode {
  part: AnatomyPartDef;
  /** 1 for a part with no parent, 2 for its children, 3 for theirs. */
  level: number;
  children: PartNode[];
}

/** The level-1 nodes of an atlas, in file order, each carrying its children. */
export function buildPartTree(parts: readonly AnatomyPartDef[]): PartNode[] {
  const byId = new Map(parts.map((p) => [p.id, p] as const));
  const nodes = new Map<string, PartNode>();
  for (const p of parts) nodes.set(p.id, { part: p, level: 1, children: [] });
  const roots: PartNode[] = [];
  for (const p of parts) {
    const node = nodes.get(p.id) as PartNode;
    const parentId = p.parent;
    // A missing parent, a self-parent or a loop: treat as level 1 (see the header).
    if (!parentId || !byId.has(parentId) || inLoop(parts, p.id)) {
      roots.push(node);
      continue;
    }
    nodes.get(parentId)?.children.push(node);
  }
  const setLevel = (node: PartNode, level: number): void => {
    node.level = level;
    for (const c of node.children) setLevel(c, level + 1);
  };
  for (const r of roots) setLevel(r, 1);
  return roots;
}

function inLoop(parts: readonly AnatomyPartDef[], id: string): boolean {
  const byId = new Map(parts.map((p) => [p.id, p] as const));
  const seen = new Set<string>([id]);
  let cursor = byId.get(id)?.parent;
  while (cursor) {
    if (seen.has(cursor)) return true;
    seen.add(cursor);
    cursor = byId.get(cursor)?.parent;
  }
  return false;
}

/** The ids of a part's ancestors, nearest first; empty at level 1 or for an unknown id. */
export function ancestorIds(parts: readonly AnatomyPartDef[], id: string): string[] {
  const byId = new Map(parts.map((p) => [p.id, p] as const));
  const out: string[] = [];
  const seen = new Set<string>([id]);
  let cursor = byId.get(id)?.parent;
  while (cursor && byId.has(cursor) && !seen.has(cursor)) {
    out.push(cursor);
    seen.add(cursor);
    cursor = byId.get(cursor)?.parent;
  }
  return out;
}

/** How many parts lie anywhere beneath a node. */
export function countBeneath(node: PartNode): number {
  return node.children.reduce((n, c) => n + 1 + countBeneath(c), 0);
}

/**
 * The id whose live activity a part displays: its own when it has drives, else its nearest
 * ancestor's that does (the renderer does the same, src/render/anatomy/detail/OrganDetail.ts),
 * so a child with nothing driving it of its own moves with its parent and not with a constant.
 * A part with no drives and no ancestor with drives shows its own (resting) value.
 */
export function activitySourceOf(parts: readonly AnatomyPartDef[], id: string): string {
  const byId = new Map(parts.map((p) => [p.id, p] as const));
  for (const candidate of [id, ...ancestorIds(parts, id)]) {
    if ((byId.get(candidate)?.drives.length ?? 0) > 0) return candidate;
  }
  return id;
}
