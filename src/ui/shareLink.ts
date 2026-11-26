import reproduction from '../data/reproduction.json';
import { buildCatalogue, partBelongsTo, type BodyKind, type SearchEntry } from './search';

/**
 * SHAREABLE LINKS: build and parse the URL fragment that restores a BODY and a VIEW.
 *
 *   #v=1&sex=female&weeks=28&organ=uterus&part=placenta&layers=bones,muscles,vessels,nerves,hormones,activity&cut=front:0.5
 *
 * WHAT A LINK IS NOT. It restores who the body is (sex, gestational age) and how it is being
 * looked at (the open organ and part, the overlays, the section). It never carries, and
 * opening one never replays, anything that HAPPENED to the body: no drug, no procedure, no
 * environment, no event. The copy toast and the on-load toast both say so.
 *
 * THE PARSER IS A STRICT WHITELIST, because the fragment is attacker-controlled text that
 * lands in a page which dispatches intents to an engine. The rules:
 *   - `v` must be exactly 1; with no `v`, or another version, NOTHING is applied (a future
 *     format must not be half-understood by this reader);
 *   - only the keys v, sex, weeks, organ, part, layers, cut are read; every other key is
 *     ignored; a key that appears twice is ignored (neither copy can be trusted);
 *   - a value longer than MAX_VALUE_LENGTH is dropped before anything looks at it;
 *   - every value must also match a conservative character class, so even a string that is
 *     short enough can contain nothing but letters, digits and . _ , : - ;
 *   - `sex` is male or female; `weeks` is one or two digits, at most `pregnancy.maxWeeks`,
 *     read from reproduction.json, and only for a female body; `organ` must be an organ THIS
 *     body has (the search catalogue is the single definition of that); `part` must be a part
 *     of that organ's atlas; `layers` must be a comma list of the six layer names (bones, muscles, vessels, nerves, hormones, activity) (one bad
 *     name drops the whole key, not just the name); `cut` is an axis and a number in 0..1.
 *   - a parsed string is only ever COMPARED against the catalogue and the fixed name lists.
 *     The values that leave this module are members of those lists or numbers this file
 *     built itself, never a substring of the input.
 *   - nothing here throws: a parse failure is a missing field.
 *
 * No decodeURIComponent: every legal value is already inside the character class, and a
 * percent sign is outside it, so an encoded payload is simply dropped.
 */

export const LAYER_NAMES = ['bones', 'muscles', 'vessels', 'nerves', 'hormones', 'activity'] as const;
export type LayerName = (typeof LAYER_NAMES)[number];
export const CUT_AXES = ['front', 'side', 'top'] as const;
export type ShareAxis = (typeof CUT_AXES)[number];

/** The longest value read (a display-free safety limit; no legal value comes near it). */
export const MAX_VALUE_LENGTH = 64;
const SAFE_VALUE = /^[a-z0-9_.,:-]+$/;
const KNOWN_KEYS = ['v', 'sex', 'weeks', 'organ', 'part', 'layers', 'cut'] as const;

/** The view and body a link carries; every field is optional on the way in. */
export interface ShareState {
  sex?: 'male' | 'female';
  /** Gestational weeks; absent or 0 means not pregnant. */
  weeks?: number;
  organ?: string;
  part?: string;
  layers?: LayerName[];
  cut?: { axis: ShareAxis; depth: number };
}

/** The pregnancy ceiling the engine itself uses (a cited-or-assumed constant of the model). */
export function maxWeeks(): number {
  const entry = (reproduction as unknown as { constants?: Record<string, { value: number | null }> }).constants?.['pregnancy.maxWeeks'];
  const v = entry?.value;
  // A missing or null constant means no gestational age is accepted at all, never a guess.
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** Build the fragment (with its leading #) for a state. Fields that are unset are left out. */
export function buildShareHash(state: ShareState): string {
  const parts: string[] = ['v=1'];
  if (state.sex) parts.push(`sex=${state.sex}`);
  if (state.sex === 'female' && typeof state.weeks === 'number' && Number.isInteger(state.weeks) && state.weeks > 0) parts.push(`weeks=${state.weeks}`);
  if (state.organ) parts.push(`organ=${state.organ}`);
  if (state.organ && state.part) parts.push(`part=${state.part}`);
  if (state.layers && state.layers.length > 0) {
    const ordered = LAYER_NAMES.filter((n) => state.layers!.includes(n));
    parts.push(`layers=${ordered.join(',')}`);
  }
  if (state.organ && state.cut) parts.push(`cut=${state.cut.axis}:${Number(state.cut.depth.toFixed(2))}`);
  return '#' + parts.join('&');
}

/** Split a fragment into its first-seen key/value pairs; a key seen twice is removed. */
function readPairs(hash: string): Map<string, string> {
  const seen = new Map<string, string>();
  const dup = new Set<string>();
  const body = hash.startsWith('#') ? hash.slice(1) : hash;
  // A fragment of absurd length is not a link; stop before splitting it (a display-free limit).
  if (body.length > 1024) return seen;
  for (const piece of body.split('&')) {
    const eq = piece.indexOf('=');
    if (eq <= 0) continue;
    const key = piece.slice(0, eq);
    const value = piece.slice(eq + 1);
    if (!(KNOWN_KEYS as readonly string[]).includes(key)) continue;
    if (seen.has(key) || dup.has(key)) {
      seen.delete(key);
      dup.add(key);
      continue;
    }
    seen.set(key, value);
  }
  return seen;
}

/**
 * Parse a fragment. `catalogueFor` gives the search catalogue for a body (so an organ or part
 * is judged against what THAT body has) and `current` is the body the page has now, used when
 * the link names no sex. Returns only the valid fields; `{}` when nothing is valid.
 */
export function parseShareHash(
  hash: string,
  catalogueFor: (body: BodyKind) => SearchEntry[] = buildCatalogue,
  current: BodyKind = { sex: 'male', pregnant: false },
): ShareState {
  try {
    const raw = readPairs(typeof hash === 'string' ? hash : '');
    const get = (k: string): string | undefined => {
      const v = raw.get(k);
      return v !== undefined && v.length > 0 && v.length <= MAX_VALUE_LENGTH && SAFE_VALUE.test(v) ? v : undefined;
    };
    if (get('v') !== '1') return {};

    const out: ShareState = {};
    const sexRaw = get('sex');
    const sex: 'male' | 'female' = sexRaw === 'male' || sexRaw === 'female' ? sexRaw : current.sex;
    if (sexRaw === 'male' || sexRaw === 'female') out.sex = sexRaw;

    let pregnant = sexRaw === undefined ? current.pregnant : false;
    const weeksRaw = get('weeks');
    if (weeksRaw !== undefined && sex === 'female' && /^\d{1,2}$/.test(weeksRaw)) {
      const w = Number(weeksRaw);
      if (Number.isInteger(w) && w >= 0 && w <= maxWeeks()) {
        out.weeks = w;
        pregnant = w > 0;
      }
    }

    const body: BodyKind = { sex, pregnant };
    const catalogue = catalogueFor(body);
    const organRaw = get('organ');
    // The comparison against the catalogue is the only use of the parsed string; the value
    // kept is the catalogue's own.
    const organEntry = organRaw === undefined ? undefined : catalogue.find((e) => e.kind === 'organ' && e.organId === organRaw);
    if (organEntry) {
      out.organ = organEntry.organId;
      const partRaw = get('part');
      if (partRaw !== undefined && partBelongsTo(organEntry.organId, partRaw)) {
        const partEntry = catalogue.find((e) => e.kind === 'part' && e.organId === organEntry.organId && e.partId === partRaw);
        if (partEntry?.partId) out.part = partEntry.partId;
      }
    }

    const layersRaw = get('layers');
    if (layersRaw !== undefined) {
      const items = layersRaw.split(',');
      if (items.every((i) => (LAYER_NAMES as readonly string[]).includes(i))) {
        out.layers = LAYER_NAMES.filter((n) => items.includes(n));
      }
    }

    const cutRaw = get('cut');
    if (cutRaw !== undefined) {
      const m = /^([a-z]+):(\d(?:\.\d{1,3})?)$/.exec(cutRaw);
      const axis = m ? CUT_AXES.find((a) => a === m[1]) : undefined;
      const depth = m ? Number(m[2]) : NaN;
      if (axis && Number.isFinite(depth) && depth >= 0 && depth <= 1) out.cut = { axis, depth };
    }
    return out;
  } catch {
    return {};
  }
}

/** The text of the toasts, kept beside the format so they change together. */
export const LINK_COPIED_TOAST = 'Link copied. It opens this body and this view, not what has happened to it.';
export const LINK_OPENED_TOAST = 'Link opened. It restores this body and this view, not what has happened to it.';
