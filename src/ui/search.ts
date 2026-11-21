import organsFile from '../data/organs.json';
import { ANATOMY, atlasOf } from '../data/anatomy';
import type { OrganDef } from '../data/types';

/**
 * FIND AN ORGAN OR A STRUCTURE: the pure half of the panels menu's search box.
 *
 * This file has no React and no DOM so that the catalogue and the ranking can be tested
 * in a bare node process, and so that the share-link parser (shareLink.ts) can validate an
 * organ or a part against the very same list the search offers. There is therefore ONE
 * definition of "what this body has".
 *
 * WHAT THIS BODY HAS. An organ carries `sex` (the reproductive organs one sex has) and
 * `pregnancyOnly` (the fetus). A male body must never be offered the uterus, nor any of its
 * parts, and a non-pregnant body never the fetus: finding something that is not there would
 * select an organ the viewer has hidden, which looks exactly like a broken search.
 *
 * PAIRED ORGANS. The two kidneys share the atlas `kidney`, and so do the two adrenals; the
 * atlas lists each part once because it describes the structure, not the side. A search that
 * listed "Renal Cortex" once would have to pick a side for the visitor, so a part of an atlas
 * that more than one organ reads appears ONCE PER SIDE, labelled "Renal Cortex, left kidney".
 * The lungs are two atlases (`lung_l`, `lung_r`), each already on one side, so their parts
 * are not suffixed.
 *
 * RANKING (documented because it is the visible behaviour): case- and accent-insensitive;
 * a label that STARTS with the query beats a label with a WORD that starts with it, which
 * beats a label that merely CONTAINS it; on a tie an organ beats a part; after that the
 * catalogue order (organs.json order, then atlas order) decides, so the list never shuffles
 * between keystrokes. At most MAX_RESULTS are returned.
 */

export interface SearchEntry {
  kind: 'organ' | 'part';
  /** The organ to select (for a part, the organ it belongs to). */
  organId: string;
  /** The part's id within its atlas; absent for an organ. */
  partId?: string;
  /** What the result list prints. */
  label: string;
  /** The secondary line: the organ's name for a part, the body system for an organ. */
  sub: string;
  /** The folded form the matcher compares against (lower case, accents removed). */
  folded: string;
}

/** What the catalogue needs to know about the body. */
export interface BodyKind {
  sex: 'male' | 'female';
  pregnant: boolean;
}

/** The most results the menu ever shows (a display choice: it must fit above the dock on a phone). */
export const MAX_RESULTS = 8;

const ORGANS = (organsFile as unknown as { organs: OrganDef[] }).organs;

/** Lower case with accents removed, so "oesophagus", "Oesophagus" and "Œsophagus" meet. */
export function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .toLowerCase();
}

/** The organs this body has, in organs.json order. */
export function organsOf(body: BodyKind): OrganDef[] {
  return ORGANS.filter((o) => (!o.sex || o.sex === body.sex) && (!o.pregnancyOnly || body.pregnant));
}

/** The qualifier a shared-atlas part gets: "Left Kidney" becomes "left kidney". */
function sideQualifier(organ: OrganDef): string {
  return organ.displayName.toLowerCase();
}

export function buildCatalogue(body: BodyKind): SearchEntry[] {
  const organs = organsOf(body);
  // How many organs of THIS body read each atlas: more than one means a paired organ.
  const readers = new Map<string, number>();
  for (const o of organs) readers.set(atlasOf(o), (readers.get(atlasOf(o)) ?? 0) + 1);

  const entries: SearchEntry[] = [];
  for (const o of organs) {
    entries.push({ kind: 'organ', organId: o.id, label: o.displayName, sub: 'Organ', folded: fold(o.displayName) });
  }
  for (const o of organs) {
    const atlas = ANATOMY[atlasOf(o)];
    if (!atlas) continue;
    const paired = (readers.get(atlasOf(o)) ?? 0) > 1;
    for (const p of atlas.parts) {
      const label = paired ? `${p.label}, ${sideQualifier(o)}` : p.label;
      entries.push({ kind: 'part', organId: o.id, partId: p.id, label, sub: o.displayName, folded: fold(label) });
    }
  }
  return entries;
}

/** 0 = label prefix, 1 = a word starts with it, 2 = substring, -1 = no match. */
function tier(folded: string, q: string): number {
  if (folded.startsWith(q)) return 0;
  // A word start: the query follows a space, hyphen, bracket or comma.
  if (new RegExp('[\\s\\-(,/]' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(folded)) return 1;
  return folded.includes(q) ? 2 : -1;
}

/** Ranked matches for a query, at most `limit`. An empty or blank query matches nothing. */
export function search(catalogue: readonly SearchEntry[], query: string, limit = MAX_RESULTS): SearchEntry[] {
  const q = fold(query).trim().replace(/\s+/g, ' ');
  if (q === '') return [];
  const scored: { e: SearchEntry; tier: number; order: number }[] = [];
  catalogue.forEach((e, order) => {
    const t = tier(e.folded, q);
    if (t >= 0) scored.push({ e, tier: t, order });
  });
  scored.sort((a, b) => a.tier - b.tier || (a.e.kind === b.e.kind ? 0 : a.e.kind === 'organ' ? -1 : 1) || a.order - b.order);
  return scored.slice(0, limit).map((s) => s.e);
}

/** True when `partId` is a part of the atlas that `organId` reads (the share-link check). */
export function partBelongsTo(organId: string, partId: string): boolean {
  const organ = ORGANS.find((o) => o.id === organId);
  const atlas = organ ? ANATOMY[atlasOf(organ)] : undefined;
  return !!atlas && atlas.parts.some((p) => p.id === partId);
}
