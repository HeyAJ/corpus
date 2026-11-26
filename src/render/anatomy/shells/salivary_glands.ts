import * as THREE from 'three';
import { ellipsoid, mergeParts, polygonise, smoothUnion, type Sdf, type V3 } from '../sdf';

/**
 * SALIVARY GLANDS, SHELL. Three pairs in one organ.
 *
 * Frame: origin at organs.json [0, 0.33, 0.02], which is y = 0.39 in the scene after the
 * cranial group's +0.06 lift, about the height of the mouth's floor. To go from the SKULL's
 * frame (origin scene (0, 0.48, 0), shells/skull.ts) to this one, add (0, +0.09, -0.02). Each
 * pair is placed from the neighbouring shells, never from a free guess:
 *
 *   - PAROTID: below the external acoustic meatus and in front of the mastoid process, in the
 *     groove behind the ramus of the mandible (Gray's 42nd). It has three parts drawn as
 *     three ellipsoids joined smoothly (see PAROTID below): a SUPERFICIAL lobe that lies on
 *     the outside of the ramus and the masseter, a DEEP lobe that lies behind the ramus's
 *     posterior border and in front of the mastoid, and a bridge under the mastoid tip that
 *     joins them, so the gland wraps the posterior border of the ramus. The plane between the
 *     two lobes is where the facial nerve's plexus runs. The top of the gland sits just under
 *     the canal's lower wall.
 *   - SUBMANDIBULAR: under the body of the mandible, below the mouth shell (whose floor is
 *     12 mm under its origin) and well to the side of the larynx (which is under 16 mm wide).
 *     Now medial to the mandible's inner surface, see SUBMANDIBULAR below.
 *   - SUBLINGUAL: the smallest, in the floor of the mouth beside the midline. It was first
 *     put at the mouth's centre height and too far forward (this frame sits 0.010 m above and
 *     0.022 m behind the mouth's, which the first placement forgot), so it floated inside the
 *     tongue; it now lies just under the floor the mouth atlas draws. Re-seated in its fossa by
 *     lv1 (see SUBLINGUAL below).
 *
 * Sizes are drawing choices: the parotid is the largest and the sublingual the smallest,
 * which is the one fact about them a student must come away with. The interior
 * (atlas/salivary_glands.parts.ts) draws the lobules, ducts and nerves inside these shapes.
 *
 * HISTORY OF THE PAROTID. It was one ellipsoid at local (+-0.058, 0.022, -0.015), placed
 * "2 to 3 cm below and a little in front of" the ear canal where it stood when the ears were
 * drawn at the eyes' height. The ears were then moved 24 mm down to the Frankfort plane and the
 * gland was left behind, with its top about 24 mm ABOVE the ear (agent ea measured it). It is
 * now placed from the canal as it is: the gland's top is 62.0 mm below the skull's origin, 3.7 mm
 * under the canal's axis at the same x (58.3 mm), and 1.2 mm clear of the canal's tube surface
 * (0.2 mm for the atlas's slightly fatter halves). Raising it any further runs it into the canal.
 */

/**
 * The right parotid's three ellipsoids (centre, radii), local frame. Converted from the skull's
 * frame as above. The superficial lobe's top (y -0.062 in the skull's frame) is under the lower
 * wall of the ears' canal (radius 3.6 mm); its front edge (z -0.0035 skull) stays 10 mm behind
 * the condyle so that the lobe does not touch the jaw joint; its inner face (x 0.058) is the outer
 * face of the ramus. The deep lobe is in the groove between the ramus's back border and the
 * mastoid. Every size is a drawing choice.
 */
export const PAROTID = {
  superficial: { c: [0.0625, 0.0086, -0.033] as V3, r: [0.0045, 0.0195, 0.0095] as V3 },
  deep: { c: [0.0495, 0.0121, -0.0415] as V3, r: [0.005, 0.016, 0.006] as V3 },
  bridge: { c: [0.0565, 0.0035, -0.0425] as V3, r: [0.0085, 0.0125, 0.006] as V3 },
  /** The plane between the superficial and deep lobes, where the facial plexus runs (x, local). */
  plexusPlaneX: 0.0565,
};

/** The right parotid as one field; `grow` fattens every lobe by that many metres (used for the halves in the atlas). */
export function parotidField(side: number, grow = 0): Sdf {
  const e = (g: { c: V3; r: V3 }): Sdf => ellipsoid([side * g.c[0], g.c[1], g.c[2]], [g.r[0] + grow, g.r[1] + grow, g.r[2] + grow]);
  return smoothUnion(0.002, e(PAROTID.superficial), e(PAROTID.deep), e(PAROTID.bridge));
}

/**
 * THE LOWER GLANDS IN THEIR FOSSAE (lv1). WHAT WENT WRONG: the submandibular ellipsoid was
 * centred 34 mm from the midline and the sublingual 12 mm, but the mandible's body in this
 * drawing is only a 40 mm arch: its inner surface (lowest 12 mm of the body, skull frame) is at
 * x 27.7 mm at z 0, 22 at z 10, 17.5 at z 20, 16 at z 30, 15 at z 40, 12.4 at z 50 (measured
 * from `mandibleField`). So the submandibular overlapped the bone by 0.7 mm, the sublingual by
 * 3.4 mm and the submandibular duct by 3.8 mm; the gland stood where Gray's has the bone.
 * Gray's: the submandibular gland's superficial part lies in the submandibular fossa on the
 * INNER surface of the body below the mylohyoid line, its deep part above the mylohyoid
 * wrapping that muscle's posterior border; the sublingual lies in the sublingual fossa above
 * the mylohyoid line, under the mucosa of the mouth's floor. Both are therefore MEDIAL to the
 * body's inner surface, which the narrow drawn arch leaves little room for, so the glands are
 * smaller and the submandibular is turned about the vertical axis to lie along the inner
 * surface (its long axis follows the arch, a drawing choice of 17.7 degrees, the surface's own
 * slope between z 0 and z 40). Sizes and centres are drawing choices fitted to the bone, the
 * hyoid's greater horn and the mouth atlas, not measurements.
 */
export const SUBMANDIBULAR = { c: [0.0115, -0.038, -0.016] as V3, r: [0.0075, 0.0062, 0.0125] as V3, tilt: 0.309 };
export const SUBLINGUAL = { c: [0.0058, -0.0215, 0.025] as V3, r: [0.0042, 0.0036, 0.0105] as V3 };

/**
 * A field turned about the vertical axis through `c` by `tilt` radians in the side's own
 * mirrored frame (so that the two sides stay mirror images): the long axis (local z) leans
 * toward the midline as it goes forward, as the inner surface of the mandible's body does.
 * The field is given in a frame centred on `c`; a rigid turn keeps distances true.
 */
export function tiltedAboutY(centred: Sdf, c: V3, tilt: number, side: number): Sdf {
  const cs = Math.cos(tilt);
  const sn = Math.sin(tilt);
  return (x, y, z) => {
    const X = side * (x - side * c[0]);
    const Z = z - c[2];
    return centred(X * cs + Z * sn, y - c[1], -X * sn + Z * cs);
  };
}

export function salivaryGlands(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const s of [1, -1]) {
    const field = smoothUnion(
      0.002,
      tiltedAboutY(ellipsoid([0, 0, 0], SUBMANDIBULAR.r), SUBMANDIBULAR.c, SUBMANDIBULAR.tilt, s), // submandibular
      ellipsoid([s * SUBLINGUAL.c[0], SUBLINGUAL.c[1], SUBLINGUAL.c[2]], SUBLINGUAL.r), // sublingual
    );
    // The two glands of one side are far from the parotid, so each side is polygonised on its
    // own box and the two sides are merged. The box is the one the three glands shared before
    // the parotid moved, so the submandibular and sublingual triangles are unchanged.
    const x0 = Math.min(s * 0.005, s * 0.07);
    const x1 = Math.max(s * 0.005, s * 0.07);
    parts.push(polygonise(field, [x0, -0.04, -0.034], [x1, 0.046, 0.056], { cell: 0.0055, maxCells: 120000 }));
    // The parotid is behind and above that box (z down to -0.052, y up to 0.034): its own.
    parts.push(
      polygonise(parotidField(s), [Math.min(s * 0.04, s * 0.072), -0.016, -0.052], [Math.max(s * 0.04, s * 0.072), 0.032, -0.012], {
        cell: 0.0045,
        maxCells: 60000,
      }),
    );
  }
  return mergeParts(parts);
}
