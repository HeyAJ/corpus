/**
 * PREGNANCY DISPLACEMENT: how the organs around the uterus make room for it. Pure, no three.js.
 *
 * WHAT WAS WRONG. The gravid uterus was drawn on top of the abdomen as if nothing else were
 * there. Measured on the model's own meshes (auditor aur, 2026-11): at 28 and 40 weeks it
 * reached 40 and 43 mm into the small intestine, 55 and 56 mm into the large, 25 and 42 mm into
 * the gallbladder, 8 and 21 mm into the stomach, 49 mm into the diaphragm and 29 mm into the
 * liver at term, and 62 and 87 mm through the muscles of the abdominal wall.
 *
 * WHAT THE FIELD IS. A smooth displacement of every vertex of a listed organ, as a function of the
 * gestational week alone. It is applied ON TOP of each organ's own base geometry (OrganSet keeps
 * the base positions and rewrites the live ones), so the organs' shape files are untouched and a
 * non-pregnant body is bit-for-bit what it was.
 *
 * THE RULE. The gravid body is the ellipsoid `gravidShape(weeks)`. A point moves along its own ray
 * from a SOURCE point low inside the uterus (SOURCE_HEIGHT; see the function), rho -> G(rho), where rho
 * is the point's distance along its ray as a fraction of the distance at which the ray leaves
 * the uterus (rho = 1 is the uterine surface), with
 *
 *     G(rho) = rho0 + (rhoE - rho0) * (rho / rhoE)^m,      m = rhoE / (rhoE - rho0),   rho < rhoE
 *     G(rho) = rho                                         rho >= rhoE
 *
 * where rho0 puts the inflated surface (the uterus plus `DISPLAY_MARGIN_M`) at 1 and rhoE is the
 * reach of the push. Three properties make it safe, and the unit test checks each. (1) CLEARANCE:
 * G(rho) >= rho0 for every rho, so a vertex anywhere inside the uterus ends on or outside the
 * inflated surface; it cannot be missed by an organ that is deeper than anyone expected.
 * (2) NO FOLDING: G'(rho) = (rho / rhoE)^(m - 1) is positive and reaches 1 at rhoE where G meets
 * the identity, so the radial map is a monotone, C1 join with the unmoved body: a shell cannot tear
 * or turn inside out, and the push dies out smoothly with distance. (3) HONEST COMPRESSION. Where
 * an organ lay deep inside the uterus's footprint it is not slid out whole (the model's abdomen is
 * only 15 cm from front to back and the term uterus is 16 cm across, so there is nowhere to slide
 * it to); it is draped round the uterus, thinner than before, which is what the bowel does at
 * term. G' is the thinning factor: 0.2 to 0.3 at rho 0.5, 1 at the edge of the reach.
 *
 * DIRECTIONS (what the obstetric texts describe). Moving every point along its own ray from the
 * centre carries the bowel, stomach, liver, gallbladder and diaphragm up and out, the wall forward
 * and sideways, and a point behind the uterus backward; the bladder is a special case: it lies
 * below the uterus, where a radial push would drive it into the pelvic floor, so it is carried up
 * and forward along a fixed direction instead (Williams Obstetrics 25e, ch. 4: the bladder is
 * displaced upward and anteriorly as the uterus rises out of the pelvis). The appendix is part of
 * the large-intestine shell here, so it is carried up and laterally with the caecum, which is what
 * Baer, JAMA 1932 98:1359 describes (the appendix rises and rotates as the uterus enlarges).
 *
 * WHAT IS CITED AND WHAT IS NOT. The SIZE of every push comes from the model's own uterus
 * (the push-out-of-the-uterus rule), not from a textbook number: no source was found that gives a
 * displacement in millimetres for each organ, and none was invented. The one literature magnitude
 * that exists is for the diaphragm, a cross-check and not an input: the resting diaphragm ends
 * pregnancy displaced upward by 1.5 to 4 cm (LoMauro et al., J Appl Physiol 2019, summarising
 * early chest radiographs) or about 5 cm (LoMauro and Aliverti, Breathe 2015;11:297). The rule
 * pushes the model's diaphragm by whatever its uterus needs (a few cm at term; see the DOCS NOTE
 * for the measured value), which is the same order, and it is not tuned to either figure. The
 * Williams Obstetrics statement of the diaphragm's rise was not retrieved and is not quoted.
 * `DISPLAY_MARGIN_M` and `REACH` are DISPLAY choices.
 */

type V3 = readonly [number, number, number];

/** The ellipsoid the uterus occupies, in the same frame as the points passed in (the world). */
export interface UterusBody {
  centre: V3;
  radii: V3;
}

/** Which family of organs a point belongs to. It chooses the direction of the push, nothing else. */
export type DisplacedKind = 'bowel' | 'stomach' | 'liver' | 'gallbladder' | 'diaphragm' | 'bladder' | 'wall';

/** The organs this module moves, by organ id. The appendix and caecum travel with the large intestine. */
export const DISPLACED_ORGANS: Readonly<Record<string, DisplacedKind>> = {
  intestine_small: 'bowel',
  intestine_large: 'bowel',
  stomach: 'stomach',
  liver: 'liver',
  gallbladder: 'gallbladder',
  pancreas: 'stomach',
  diaphragm: 'diaphragm',
  bladder: 'bladder',
  abdominal_wall_muscles: 'wall',
};

/** Gap left between a displaced organ and the uterus, metres. A DISPLAY choice. */
export const DISPLAY_MARGIN_M = 0.004;
/**
 * Reach of the push, in uterus radii: beyond this normalised distance from the centre nothing
 * moves. A DISPLAY choice. Larger reaches thin a deep organ less and move distant organs a little
 * more; 2.4 puts the edge of the push about 1.4 uterus radii (15 cm at term) beyond the surface.
 */
export const REACH = 2.4;
/** Where the rays start, as a fraction of the ellipsoid's vertical semi-axis below its centre. A DISPLAY choice; see `pregnancyDisplacement`. */
export const SOURCE_HEIGHT = 0.6;
/** The uterus leaves the true pelvis, and so starts to push, between these weeks. */
export const PUSH_FROM_WEEK = 6;
export const PUSH_FULL_WEEK = 10;

/** How much of the push is applied at a week: 0 before the uterus is a gravid body, 1 once it is. */
export function pushFraction(weeks: number): number {
  const c = Math.max(0, Math.min(1, (weeks - PUSH_FROM_WEEK) / (PUSH_FULL_WEEK - PUSH_FROM_WEEK)));
  return c * c * (3 - 2 * c);
}

/**
 * The displacement of the point (x, y, z) of an organ of `kind`, written to `out`.
 * Zero outside the uterus's reach and before the uterus is a gravid body.
 */
export function pregnancyDisplacement(weeks: number, body: UterusBody, kind: DisplacedKind, x: number, y: number, z: number, out: [number, number, number]): void {
  out[0] = 0;
  out[1] = 0;
  out[2] = 0;
  const fraction = pushFraction(weeks);
  if (fraction <= 0) return;
  const [cx, cy, cz] = body.centre;
  const [rx, ry, rz] = body.radii;
  // The source of the rays is not the ellipsoid's centre but a point low in it (SOURCE_HEIGHT of
  // the way from the centre to the bottom). From the centre, everything below the middle of the
  // uterus would be driven DOWN into the pelvis, where the bladder, the pelvic floor and the
  // sacrum are; from a low source only what lies below the uterus's bottom goes down, and that
  // is hardly pushed because it is outside the ellipsoid.
  const sx = cx;
  const sy = cy - SOURCE_HEIGHT * ry;
  const sz = cz;
  const dx = x - sx;
  const dy = y - sy;
  const dz = z - sz;
  const d = Math.hypot(dx, dy, dz);
  if (d < 1e-9) return;
  const ux = dx / d;
  const uy = dy / d;
  const uz = dz / d;
  // Distance along the ray from the source to the ellipsoid: positive root of |s + t u - c| = 1 in q.
  const ox = (sx - cx) / rx;
  const oy = (sy - cy) / ry;
  const oz = (sz - cz) / rz;
  const vx = ux / rx;
  const vy = uy / ry;
  const vz = uz / rz;
  const qa = vx * vx + vy * vy + vz * vz;
  const qb = 2 * (vx * ox + vy * oy + vz * oz);
  const qc = ox * ox + oy * oy + oz * oz - 1;
  const t = (-qb + Math.sqrt(qb * qb - 4 * qa * qc)) / (2 * qa);
  const rho = d / t;
  if (rho >= REACH) return;
  const rho0 = 1 + DISPLAY_MARGIN_M / t;
  const m = REACH / (REACH - rho0);
  const g = rho0 + (REACH - rho0) * Math.pow(rho / REACH, m);
  const move = fraction * (g - rho) * t;
  if (kind === 'bladder') {
    // Up and forward by the distance the radial rule asks, along a fixed direction.
    out[1] = 0.85 * move;
    out[2] = 0.53 * move;
    return;
  }
  out[0] = ux * move;
  out[1] = uy * move;
  out[2] = uz * move;
}
