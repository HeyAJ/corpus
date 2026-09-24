import physiology from '../../data/physiology.json';

/**
 * Typed access to data/physiology.json (spec 13: "every magic number in sim/ must be
 * a named constant in data/ with a source").
 *
 * `P('key')` returns the number and throws if the key is missing or null, so a
 * missing constant fails loudly in the engine instead of silently becoming NaN.
 * The UI uses `sourced('key')` to show provenance, and `isKnown('key')` to decide
 * between rendering a value and rendering an em-dash (spec 0.4).
 */

export interface SourcedEntry {
  value: number | number[] | null;
  unit: string;
  source: string;
  confidence: 'measured' | 'derived' | 'assumed';
  note?: string;
}

export interface SourceRef {
  label: string;
  url: string;
}

type RawConstants = Record<string, unknown>;

const RAW = physiology.constants as RawConstants;
const SOURCES = physiology.sources as Record<string, SourceRef>;

function entry(key: string): SourcedEntry | undefined {
  const e = RAW[key];
  if (e === undefined) return undefined;
  return e as SourcedEntry;
}

/** Numeric constant. Throws if absent or null — a null constant must never reach the engine. */
export function P(key: string): number {
  const e = entry(key);
  if (!e) throw new Error(`physiology.json: unknown constant "${key}"`);
  if (e.value === null) {
    throw new Error(
      `physiology.json: constant "${key}" has no sourced value. ` +
        `It must not be used by the engine; see docs/MISSING_CONSTANTS.md.`,
    );
  }
  if (Array.isArray(e.value)) {
    throw new Error(`physiology.json: constant "${key}" is an array; use PArray().`);
  }
  return e.value;
}

export function PArray(key: string): number[] {
  const e = entry(key);
  if (!e || !Array.isArray(e.value)) throw new Error(`physiology.json: "${key}" is not an array constant`);
  return e.value;
}

/** True when the constant exists and carries a real sourced value. */
export function isKnown(key: string): boolean {
  const e = entry(key);
  return !!e && e.value !== null;
}

/** Provenance for the UI's "where did this number come from" affordance. */
export function sourced(key: string): (SourcedEntry & { ref: SourceRef | undefined }) | undefined {
  const e = entry(key);
  if (!e) return undefined;
  return { ...e, ref: SOURCES[e.source] };
}

export function allConstantKeys(): string[] {
  return Object.keys(RAW);
}

export function sourceTable(): Record<string, SourceRef> {
  return SOURCES;
}

/** Nested sub-object constant (e.g. gi.transitTime_min), returned as a plain record. */
export function PMap(key: string): Record<string, number | null> {
  const e = RAW[key] as Record<string, unknown> | undefined;
  if (!e) throw new Error(`physiology.json: unknown constant map "${key}"`);
  const out: Record<string, number | null> = {};
  for (const [k, v] of Object.entries(e)) {
    if (k === 'unit' || k === 'source' || k === 'confidence' || k === 'note') continue;
    out[k] = typeof v === 'number' ? v : null;
  }
  return out;
}
