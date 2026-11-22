import * as THREE from 'three';
import type { PartBuilder } from '../parts';
import { mergeParts, tubeAlong, type V3 } from '../sdf';
import { warpGeometry, warpPoints } from '../layout';
import { URETER_LEFT, URETER_RIGHT } from '../models';

/**
 * THE INSIDE OF THE URETERS.
 *
 * Each ureter is a narrow muscular tube that carries urine from the renal pelvis to the
 * bladder. It does not drip: its wall contracts in waves that squeeze a small bolus of urine
 * onward, so the picture is of spaced spurts and not a continuous trickle. Its lining of
 * transitional epithelium and its coat of smooth muscle are drawn as what they look like in
 * outline: a lumen, and a muscular coat shown as a few ring swellings along the tube. Three
 * places are narrower than the rest, where a stone is most likely to lodge: the junction
 * with the renal pelvis, the place where the ureter crosses the pelvic brim over the iliac
 * vessels, and the passage through the bladder wall (GRAYS42). They are drawn as collars.
 * At the bladder the ureter runs obliquely through the wall, so that the bladder filling and
 * squeezing presses the passage shut: a one-way valve, the vesicoureteric junction.
 *
 * FRAME. The ureters live in body coordinates (their organ position is the origin) and the
 * shell passes its tubes through `warpGeometry`; so do these, along the very same
 * centreline (`URETER_LEFT`, `URETER_RIGHT`), and the stream routes are passed through
 * `warpPoints`. A part is therefore inside the shell by construction: the lumen is 1 mm
 * narrower than the shell tube, and the swellings and collars stay within it.
 *
 * FINER STRUCTURES. The four layers of the wall are children of the peristaltic wall (see
 * `sleeve` in `parts`), and the pelviureteric junction and the pelvic-brim crossing are
 * level-1 parts drawn at the same fractions as the collars, with the iliac vessel the ureter
 * crosses in front of drawn as a short tube behind it.
 *
 * NOT DRAWN. The
 * peristaltic pacemaker cells, or the real calibre variations: the radii are
 * drawing choices chosen to sit inside the shell, not measurements. The positions of the
 * collars along the length are schematic.
 */

/** Shell tube radius in models.ts; every part here stays inside it. */
const SHELL_RADIUS = 0.0024;
const LUMEN_RADIUS = 0.0019;

/** Fractions along each ureter for the three constrictions and the muscular swellings. */
export const CONSTRICTIONS = [0.03, 0.55, 0.965];
/** Where the ureter crosses the pelvic brim, as a fraction of its length: the second constriction. */
const BRIM = CONSTRICTIONS[1];
const SWELLINGS = [0.1, 0.2, 0.3, 0.4, 0.5, 0.65, 0.75, 0.85];

const curveOf = (pts: readonly V3[]): THREE.CatmullRomCurve3 =>
  new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(p[0], p[1], p[2])), false, 'catmullrom', 0.5);

/** Sample the centreline between two fractions: `n + 1` points, body frame. */
function sample(curve: THREE.CatmullRomCurve3, t0: number, t1: number, n: number): V3[] {
  const out: V3[] = [];
  const v = new THREE.Vector3();
  for (let i = 0; i <= n; i++) {
    curve.getPointAt(t0 + ((t1 - t0) * i) / n, v);
    out.push([v.x, v.y, v.z]);
  }
  return out;
}

/** The route a bolus of urine follows down one ureter, warped like the shell. */
export function ureterRoute(side: 'left' | 'right'): V3[] {
  const curve = curveOf(side === 'left' ? URETER_LEFT : URETER_RIGHT);
  return warpPoints(sample(curve, 0, 1, 24));
}

const bump = (t: number, c: number, w: number): number => Math.exp(-(((t - c) / w) ** 2));

export const parts: PartBuilder = () => {
  const lumens: Record<'left' | 'right', THREE.BufferGeometry> = {
    left: warpGeometry(tubeAlong(URETER_LEFT, () => LUMEN_RADIUS, { tubular: 56, radial: 8 })),
    right: warpGeometry(tubeAlong(URETER_RIGHT, () => LUMEN_RADIUS, { tubular: 56, radial: 8 })),
  };

  const coat: THREE.BufferGeometry[] = [];
  const collars: THREE.BufferGeometry[] = [];
  const junctions: THREE.BufferGeometry[] = [];
  for (const pts of [URETER_LEFT, URETER_RIGHT]) {
    // The coat: thin where it is bare, swollen where a contraction ring is drawn. It is
    // narrower than the lumen between swellings, so only the swellings show outside it.
    coat.push(
      warpGeometry(
        tubeAlong(
          pts,
          (t) => {
            let r = 0;
            for (const c of SWELLINGS) r = Math.max(r, bump(t, c, 0.012));
            return 0.0016 + (SHELL_RADIUS - 0.0002 - 0.0016) * r;
          },
          { tubular: 150, radial: 8 },
        ),
      ),
    );
    const curve = curveOf(pts);
    for (const c of CONSTRICTIONS.slice(0, 2)) {
      const t0 = Math.max(0, c - 0.03);
      const t1 = Math.min(1, c + 0.03);
      collars.push(warpGeometry(tubeAlong(sample(curve, t0, t1, 8), (t) => 0.0016 + 0.0006 * Math.sin(Math.PI * t), { tubular: 8, radial: 8 })));
    }
    // The passage through the bladder wall: the last stretch, tapering as it goes in.
    junctions.push(warpGeometry(tubeAlong(sample(curve, 0.935, 1, 8), (t) => 0.0023 - 0.0009 * t, { tubular: 8, radial: 8 })));
  }

  /* FINER STRUCTURES (src/data/anatomy/ureters.json, `parent`). */

  // The wall's layers are four nested sleeves along the same centreline, each a little wider
  // than the last, so that with the muscular coat as glass the layers read from the lumen
  // outward: lining, loose connective tissue, muscle, outer coat. The outermost stays 0.4 mm
  // inside the shell tube. A real wall's layers are not separable like this and the radii are
  // drawing choices, not thicknesses.
  const sleeve = (r: number): THREE.BufferGeometry => mergeParts([URETER_LEFT, URETER_RIGHT].map((pts) => warpGeometry(tubeAlong(pts, () => r, { tubular: 30, radial: 7 }))));
  const flared: THREE.BufferGeometry[] = [];
  const brim: THREE.BufferGeometry[] = [];
  for (const pts of [URETER_LEFT, URETER_RIGHT]) {
    const curve = curveOf(pts);
    // The top of the ureter widens toward the pelvis: a funnel, the first narrow point.
    flared.push(warpGeometry(tubeAlong(sample(curve, 0, 0.06, 8), (t) => 0.0023 - 0.0007 * Math.sin(Math.PI * Math.min(1, t * 1.4)) , { tubular: 8, radial: 8 })));
    // The crossing of the pelvic brim: a collar, and the iliac vessel it passes in front of.
    const mp = curve.getPointAt(BRIM);
    const mid: V3 = [mp.x, mp.y, mp.z];
    brim.push(warpGeometry(tubeAlong(sample(curve, BRIM - 0.035, BRIM + 0.035, 8), (t) => 0.0017 + 0.0006 * Math.sin(Math.PI * t), { tubular: 8, radial: 8 })));
    brim.push(warpGeometry(tubeAlong([[mid[0] - 0.007, mid[1], mid[2] - 0.0036], [mid[0], mid[1], mid[2] - 0.0036], [mid[0] + 0.007, mid[1], mid[2] - 0.0036]], () => 0.0011, { tubular: 8, radial: 6 })));
  }

  return [
    { id: 'pelviureteric_junction', geometry: mergeParts(flared) },
    { id: 'pelvic_brim_crossing', geometry: mergeParts(brim) },
    { id: 'urothelium', geometry: sleeve(0.00197) },
    { id: 'lamina_propria', geometry: sleeve(0.00212) },
    { id: 'muscle_layers', geometry: sleeve(0.00226) },
    { id: 'adventitia', geometry: sleeve(0.00236) },
    { id: 'left_ureter', geometry: lumens.left },
    { id: 'right_ureter', geometry: lumens.right },
    { id: 'peristaltic_wall', geometry: mergeParts(coat) },
    { id: 'ureteric_constrictions', geometry: mergeParts(collars) },
    { id: 'vesicoureteric_junctions', geometry: mergeParts(junctions) },
  ];
};
