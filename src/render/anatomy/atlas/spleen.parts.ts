import * as THREE from 'three';
import type { PartBuilder } from '../parts';
import { ellipsoid, mergeParts, polygonise, smoothSubtract, sphere, tubeAlong, type Sdf, type V3 } from '../sdf';
import { fbm, mulberry32 } from '../noise';

/**
 * THE INSIDE OF THE SPLEEN: capsule, trabeculae, red pulp, white pulp with its marginal
 * zone, the splenic artery and vein, and the hilum.
 *
 * Authored in the frame of the spleen's shell in models.ts: origin at the organ's position,
 * +x towards the patient's right and so towards the MIDLINE (the spleen lies on the left),
 * +y up, +z forward. The visceral surface, with the hilum, faces +x and forward; the
 * convex diaphragmatic surface faces -x and back (GRAYS42).
 *
 * THE FIELD IS THE SHELL'S. `shellField()` repeats the shell's ellipsoid, its scooped
 * visceral surface and its two superior notches exactly, so every part can be pulled
 * inwards from the true surface. The hilum is where the surface is scooped: at the middle
 * of the organ its wall lies at about x = 0.0098 m, so the hilum line and the vessel stems
 * are drawn at x = 0.0065 m, a few millimetres inside it.
 *
 * WHAT THE STRUCTURES ARE (GRAYS42; GH14 ch. 33). The spleen is wrapped in a fibrous
 * capsule whose extensions, the trabeculae, run in from the hilum and capsule and carry the
 * vessels. The artery divides at the hilum into branches that follow the trabeculae; each
 * small branch that leaves a trabecula is a central arteriole, sheathed in lymphoid tissue,
 * and that sheath is the WHITE PULP follicle. Around it lies the MARGINAL ZONE, where blood
 * from the arteriole first meets the immune cells. The rest of the organ is the RED PULP,
 * a meshwork of blood-filled cords and sinuses in which old red cells are removed, and
 * blood drains from it into veins that follow the arteries out at the hilum.
 *
 * WHAT IS A DRAWING CHOICE. Everything. Branch paths, the number (a couple of dozen) and
 * size of the follicles, the thickness of the capsule and the radii of vessels are chosen
 * to read clearly and to stay inside the shell; none is measured, and the real follicles
 * are far smaller and far more numerous. The artery and vein are drawn in three branches
 * each; the real hilum has more.
 */

const HILUM_X = 0.0065;
const HILUM_Z = 0.011;

export function shellField(): Sdf {
  let f: Sdf = ellipsoid([0, 0, 0], [0.027, 0.05, 0.021]);
  f = smoothSubtract(0.012, f, ellipsoid([0.03, 0, 0.012], [0.02, 0.04, 0.016]));
  f = smoothSubtract(0.003, f, sphere([-0.004, 0.03, 0.022], 0.006));
  f = smoothSubtract(0.003, f, sphere([-0.006, 0.012, 0.024], 0.005));
  return f;
}

function inward(f: Sdf, d: number): Sdf {
  return (x, y, z) => f(x, y, z) + d;
}

/** The three arterial branches, hilum to the far pulp: superior, middle and inferior. */
export function arteryBranches(): V3[][] {
  return [
    [[HILUM_X, 0.004, HILUM_Z], [0.004, 0.016, 0.008], [-0.002, 0.028, 0.004], [-0.006, 0.036, 0.0]],
    [[HILUM_X, 0.0, HILUM_Z], [0.0, 0.0, 0.007], [-0.01, 0.0, 0.002], [-0.015, -0.004, -0.004]],
    [[HILUM_X, -0.004, HILUM_Z], [0.004, -0.016, 0.008], [-0.002, -0.028, 0.004], [-0.006, -0.036, 0.0]],
  ];
}

/** The veins run beside the arteries, a little behind them, and leave through the hilum. Flow runs towards the hilum. */
export function veinBranches(): V3[][] {
  return arteryBranches().map((b) => b.map((p) => [p[0], p[1], p[2] - 0.0035] as V3).reverse());
}

/** Where the hilum stem of the vein leaves the organ (flow ends here). */
export const VEIN_EXIT: V3 = [0.0095, 0, 0.0075];
/** Where the artery enters (flow starts here). */
export const ARTERY_ENTRY: V3 = [0.0085, 0, 0.011];

const FOLLICLE_R = 0.0021;
const MARGINAL_R = 0.0036;

/** Twigs and follicles, deterministic: central arterioles leaving each branch, a follicle round each. */
function twigsAndFollicles(f: Sdf): { twigs: V3[][]; centres: V3[] } {
  const rnd = mulberry32(0x5b1ee);
  const curves = arteryBranches().map(
    (b) => new THREE.CatmullRomCurve3(b.map((p) => new THREE.Vector3(p[0], p[1], p[2]))),
  );
  const twigs: V3[][] = [];
  const centres: V3[] = [];
  const v = new THREE.Vector3();
  for (const curve of curves) {
    for (let i = 0; i < 8; i++) {
      const t = 0.3 + (0.7 * i) / 8;
      curve.getPointAt(t, v);
      for (let attempt = 0; attempt < 8; attempt++) {
        const ang = rnd() * Math.PI * 2;
        const dir: V3 = [Math.cos(ang) * 0.8, 0.25 * (rnd() - 0.5), Math.sin(ang)];
        const n = Math.hypot(dir[0], dir[1], dir[2]);
        const c: V3 = [v.x + (dir[0] / n) * 0.0075, v.y + (dir[1] / n) * 0.0075, v.z + (dir[2] / n) * 0.0075];
        if (f(c[0], c[1], c[2]) > -(MARGINAL_R + 0.0015)) continue;
        twigs.push([[v.x, v.y, v.z], [(v.x + c[0]) / 2, (v.y + c[1]) / 2, (v.z + c[2]) / 2], c]);
        centres.push(c);
        break;
      }
    }
  }
  return { twigs, centres };
}

function beads(centres: V3[], r: number, w: number, h: number): THREE.BufferGeometry {
  return mergeParts(
    centres.map((c) => {
      const s = new THREE.SphereGeometry(r, w, h);
      s.translate(c[0], c[1], c[2]);
      return s;
    }),
  );
}

export const parts: PartBuilder = () => {
  const out: { id: string; geometry: THREE.BufferGeometry }[] = [];
  const f = shellField();
  const min: V3 = [-0.03, -0.054, -0.025];
  const max: V3 = [0.03, 0.054, 0.025];

  // CAPSULE: a skin just inside the shell. Glass.
  out.push({ id: 'capsule', geometry: polygonise(inward(f, 0.0008), min, max, { cell: 0.0024 }) });

  // RED PULP: the blood-filled bulk, a slightly lumpy volume inside the capsule. Glass.
  const pulp: Sdf = (x, y, z) => f(x, y, z) + 0.0028 - 0.0008 * fbm(x, y, z, 220, 2);
  out.push({ id: 'red_pulp', geometry: polygonise(pulp, min, max, { cell: 0.0026 }) });

  // HILUM: the line where vessels enter and leave, a thin solid cord on the visceral surface.
  out.push({
    id: 'hilum',
    geometry: tubeAlong(
      [[HILUM_X, -0.024, HILUM_Z - 0.001], [HILUM_X, -0.008, HILUM_Z], [HILUM_X, 0.008, HILUM_Z], [HILUM_X, 0.024, HILUM_Z - 0.001]],
      () => 0.0013,
      { tubular: 24, radial: 8 },
    ),
  });

  // VESSELS. Glass: each carries a stream. The stem outside the pulp reaches the hilum.
  const arteries = arteryBranches().map((b) => tubeAlong([ARTERY_ENTRY, ...b], (t) => 0.0014 - 0.0006 * t, { tubular: 36, radial: 8 }));
  const { twigs, centres } = twigsAndFollicles(f);
  const twigTubes = twigs.map((p) => tubeAlong(p, () => 0.0005, { tubular: 6, radial: 5 }));
  out.push({ id: 'splenic_artery', geometry: mergeParts([...arteries, ...twigTubes]) });
  out.push({
    id: 'splenic_vein',
    geometry: mergeParts(veinBranches().map((b) => tubeAlong([...b, VEIN_EXIT], (t) => 0.0008 + 0.0008 * t, { tubular: 36, radial: 8 }))),
  });

  // WHITE PULP: a solid follicle round the end of each central arteriole.
  out.push({ id: 'white_pulp', geometry: beads(centres, FOLLICLE_R, 9, 6) });
  // MARGINAL ZONE: a glass sphere round each follicle, so the follicle shows through it.
  out.push({ id: 'marginal_zone', geometry: beads(centres, MARGINAL_R, 12, 8) });

  // TRABECULAE: thin solid cords running from the hilum out to the capsule, carrying the vessels.
  const rnd = mulberry32(0x7ab5);
  const cords: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 10; i++) {
    const y0 = -0.022 + (0.044 * i) / 9;
    const ux = -(0.45 + 0.5 * rnd());
    const uy = (y0 / 0.024) * 0.7 + 0.2 * (rnd() - 0.5);
    const uz = 0.9 * (rnd() - 0.5);
    const n = Math.hypot(ux, uy, uz);
    const end: V3 = [(0.86 * 0.027 * ux) / n, (0.86 * 0.05 * uy) / n, (0.86 * 0.021 * uz) / n];
    const start: V3 = [HILUM_X, y0, HILUM_Z - 0.001];
    const mid: V3 = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2, (start[2] + end[2]) / 2];
    cords.push(tubeAlong([start, mid, end], (t) => 0.0007 * (1 - 0.4 * t), { tubular: 14, radial: 5 }));
  }
  out.push({ id: 'trabeculae', geometry: mergeParts(cords) });
  return out;
};
