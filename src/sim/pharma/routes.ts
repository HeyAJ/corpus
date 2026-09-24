import routesFile from '../../data/routes.json';
import type { Drug } from '../../data/pharma-types';
import type { Route } from '../../bridge/types';

/**
 * ROUTE TABLE (Layer A, pure).
 *
 * A route is a description of a BARRIER, not of a drug. The nasal mucosa is thin and
 * well perfused for every molecule that crosses it; subcutaneous fat is poorly
 * perfused for every molecule that sits in it. So each extravascular route is
 * specified as a multiple of the drug's own measured intramuscular absorption
 * constant, which keeps the drug's chemistry in the drug's data and the anatomy in
 * the route's data, and means a lipophilic drug stays fast by every route without
 * anyone having to write that down twice.
 *
 * Per-drug overrides exist and take priority: where a label publishes a real figure
 * for a real product — naloxone nasal spray, fentanyl patch — that number beats the
 * generic default, and drugs.json carries it with its own citation.
 */

export type RouteKind = 'intravascular' | 'depot' | 'pulmonary' | 'gut';

export interface RouteSpec {
  id: Route;
  label: string;
  short: string;
  kind: RouteKind;
  requiresIvAccess: boolean;
  /** Multiple of the drug's intramuscular ka. null for non-depot routes. */
  kaScale: number | null;
  /** Generic route bioavailability; null means "use the drug's own". */
  bioavailability: number | null;
  lagMin: number;
  bypassesFirstPass: boolean;
  /** For a route that partly bypasses the liver, the share that does NOT. */
  firstPassFraction?: number;
  /** For a route delivered over time rather than at once, minutes. */
  durationMin?: number;
  source: string;
  confidence: 'measured' | 'derived' | 'assumed';
  note: string;
  requiresProcedure?: string;
}

interface RoutesFile {
  version: number;
  about: string;
  sources: Record<string, { label: string; url: string }>;
  routes: Record<string, Omit<RouteSpec, 'id'>>;
}

const FILE = routesFile as unknown as RoutesFile;

export const ROUTE_TABLE: Record<Route, RouteSpec> = Object.fromEntries(
  Object.entries(FILE.routes).map(([id, spec]) => [id, { ...spec, id: id as Route }]),
) as Record<Route, RouteSpec>;

export const ROUTE_IDS = Object.keys(ROUTE_TABLE) as Route[];

export function routeSpec(route: Route): RouteSpec {
  return ROUTE_TABLE[route];
}

export function routeSource(route: Route): { label: string; url: string } | null {
  return FILE.sources[ROUTE_TABLE[route].source] ?? null;
}

/**
 * The absorption parameters this drug actually gets by this route.
 *
 * Returns null when the route is a depot route and the drug has no measured
 * intramuscular ka — because without one there is nothing to scale, and inventing a
 * rate here would be inventing pharmacokinetics. A null means the dose is refused
 * rather than silently absorbed at a made-up rate; see docs/MISSING_CONSTANTS.md.
 */
export function depotParamsFor(
  drug: Drug,
  route: Route,
): { ka_min: number; lagMin: number; bioavailability: number } | null {
  const spec = ROUTE_TABLE[route];
  if (spec.kaScale === null) return null;

  const override = drug.routePk?.[route];

  const ka = override?.ka_min ?? (drug.pk.ka_min !== null ? drug.pk.ka_min * spec.kaScale : null);
  if (ka === null || !(ka > 0)) return null;

  // Bioavailability, most specific first: the figure published for this exact product,
  // then the route's own default.
  //
  // NOTE WHAT IS NOT IN THAT CHAIN. `drug.pk.bioavailability` is an ORAL figure — the
  // fraction of a swallowed dose that survives the gut wall and the first pass through
  // the liver — and it has no bearing on a parenteral route. Falling back to it made
  // an intramuscular injection of morphine deliver a quarter of its dose, because
  // morphine happens to be 25% orally bioavailable, and the model then reported that
  // a suppository delivered more drug than an injection. Every route's fraction now
  // comes from that route.
  const f = override?.bioavailability ?? spec.bioavailability ?? 1;

  // A route that only partly bypasses the liver loses a share of the surviving dose
  // to first-pass extraction. Rectal is the case that matters: about half the venous
  // drainage is portal, so about half the dose meets the liver before the body does.
  const eh = drug.pk.hepaticExtraction ?? 0;
  const portalShare = spec.bypassesFirstPass ? 0 : (spec.firstPassFraction ?? 1);
  const firstPassSurvival = 1 - portalShare * eh;

  return {
    ka_min: ka,
    lagMin: override?.lagMin ?? spec.lagMin,
    bioavailability: Math.max(0, Math.min(1, f * firstPassSurvival)),
  };
}

/** Routes this drug can be given by, in table order so the UI is stable. */
export function routesFor(drug: Drug): Route[] {
  return ROUTE_IDS.filter((r) => drug.routes.includes(r));
}
