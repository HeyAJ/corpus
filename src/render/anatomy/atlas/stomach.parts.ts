import * as THREE from 'three';
import type { PartBuilder } from '../parts';
import { giSegment, organDef } from '../layout';
import { mulberry32 } from '../noise';
import { halfSpace, intersect, mergeParts, polygonise, sphere, tubeAlong } from '../sdf';
import type { V3 } from '../sdf';

/**
 * INTERIOR PARTS OF THE STOMACH.
 *
 * WHAT THIS DRAWS. The shell in models.ts is a J swept along the authored stomach
 * centreline (the same one the swallowed bolus follows) with a fundal dome added above the
 * cardia. Inside that shell we draw the regions a physiology text names - cardia, fundus,
 * body, antrum - as thin inner wall layers (drawn as GLASS by the detail module, because
 * they enclose the lumen and the streams in it), the pylorus as a thick solid ring at the
 * outlet, the rugae as solid longitudinal folds, the two curvatures as thin cords, and the
 * gastric glands as a scatter of surface pits plus ONE enlarged gland showing parietal and
 * chief cells.
 *
 * HOW IT STAYS INSIDE THE SHELL. The shell is a chain of capsules whose radii (copied
 * below as SHELL_RADII, with the same caveat as the oesophagus: models.ts does not export
 * them) are given at the seven centreline points. Every layer is a fixed fraction of that
 * radius, measured along the SPLINE through those points rather than the shell's polyline,
 * which differ by a couple of millimetres at the bend; the 0.78 fraction leaves room for
 * that. The verification probe checks every vertex against the shell's own field.
 *
 * WHAT IT DOES NOT DO. The enlarged gland is drawn far larger than life and is a cartoon
 * of one gland, not a histological section; the other pits are only marks. The real
 * wall's layers are not separated, and the stomach's contents are not drawn here at all:
 * the renderer already shows the fluid level, and a second fill would fight it.
 *
 * Frame: the stomach's OWN frame (origin at its organs.json position), as the shell is.
 */

/** Shell radii at the seven centreline points. Copied from models.ts `stomach()`. */
const SHELL_RADII = [0.011, 0.022, 0.031, 0.032, 0.028, 0.02, 0.009];
/** The fundal dome's centre in the stomach's frame, and its shell radius. Same source. */
const FUNDUS_CENTRE: V3 = [-0.052 + 0.044, 0.094 - 0.055, 0.002 - 0.002];

/** Fraction of the shell radius the glass wall layers are drawn at. */
const WALL = 0.78;

/** Shell radius at curve parameter u (0..1 through the seven points). */
export function stomachShellR(u: number): number {
  const f = Math.min(5.9999, Math.max(0, u * 6));
  const i = Math.floor(f);
  return SHELL_RADII[i] + (SHELL_RADII[i + 1] - SHELL_RADII[i]) * (f - i);
}

/** The stomach centreline as a spline in the stomach's own frame. */
export function stomachCurve(): THREE.CatmullRomCurve3 {
  const o = organDef('stomach').position;
  return new THREE.CatmullRomCurve3(
    giSegment('stomach').map((p) => new THREE.Vector3(p[0] - o[0], p[1] - o[1], p[2] - o[2])),
    false,
    'catmullrom',
    0.5,
  );
}

/** Fundal dome geometry shared with the detail module: centre and inner radius (the shell's own dome is 0.027). */
export const FUNDUS_DOME = { centre: FUNDUS_CENTRE, radius: 0.0215, floorY: 0.032 };

const Z_AXIS = new THREE.Vector3(0, 0, 1);

function ringAcross(centre: THREE.Vector3, tangent: THREE.Vector3, major: number, minor: number): THREE.BufferGeometry {
  const g = new THREE.TorusGeometry(major, minor, 6, 16);
  const q = new THREE.Quaternion().setFromUnitVectors(Z_AXIS, tangent);
  g.applyMatrix4(new THREE.Matrix4().compose(centre, q, new THREE.Vector3(1, 1, 1)));
  return g;
}

/** Points of a sleeve of the curve between u0 and u1, uniformly in parameter. */
function sleeve(curve: THREE.CatmullRomCurve3, u0: number, u1: number, n: number): V3[] {
  const out: V3[] = [];
  for (let i = 0; i < n; i++) {
    const p = curve.getPoint(u0 + ((u1 - u0) * i) / (n - 1));
    out.push([p.x, p.y, p.z]);
  }
  return out;
}

/** A wall layer: a tube between u0 and u1 at a fraction of the shell radius. */
function layer(curve: THREE.CatmullRomCurve3, u0: number, u1: number, fraction: number, tubular: number, radial: number): THREE.BufferGeometry {
  return tubeAlong(sleeve(curve, u0, u1, 14), (t) => fraction * stomachShellR(u0 + (u1 - u0) * t), { tubular, radial });
}

/** In-plane unit vector from a curve point towards the J's centroid: the concave (lesser) side. */
function inward(curve: THREE.CatmullRomCurve3, u: number, centroid: THREE.Vector3): THREE.Vector3 {
  const p = curve.getPoint(u);
  const v = centroid.clone().sub(p);
  v.z = 0;
  return v.normalize();
}

export const parts: PartBuilder = () => {
  const curve = stomachCurve();
  const centroid = new THREE.Vector3();
  const samples = curve.getPoints(40);
  for (const p of samples) centroid.add(p);
  centroid.multiplyScalar(1 / samples.length);

  // --- regions of the wall (glass in the detail module).
  const cardia = layer(curve, 0.0, 0.14, 0.74, 20, 10);
  const body = layer(curve, 0.12, 0.7, WALL, 40, 14);
  const antrum = layer(curve, 0.68, 0.92, WALL, 24, 14);

  // The fundus: a dome, the part of a sphere above a plane. Kept short of the shell's
  // own sphere (0.0215 against 0.027) so it clears it whatever the smooth union did.
  const d = FUNDUS_DOME;
  const fundusField = intersect(sphere(d.centre, d.radius), halfSpace([0, d.floorY, 0], [0, 1, 0]));
  const fundus = polygonise(
    fundusField,
    [d.centre[0] - 0.024, d.floorY - 0.003, d.centre[2] - 0.024],
    [d.centre[0] + 0.024, d.centre[1] + 0.024, d.centre[2] + 0.024],
    { cell: 0.0016 },
  );

  // --- pylorus: two thick solid rings at the outlet, narrower than the antrum.
  const pyl: THREE.BufferGeometry[] = [];
  for (const [u, k, minor] of [[0.945, 0.5, 0.0026], [0.975, 0.5, 0.0022]] as const) {
    const p = curve.getPoint(u);
    pyl.push(ringAcross(p, curve.getTangent(u).normalize(), k * stomachShellR(u), minor));
  }

  // --- rugae: nine longitudinal folds on the inside of the body, solid.
  const rugae: THREE.BufferGeometry[] = [];
  const ts = 20;
  for (let k = 0; k < 9; k++) {
    const a = (k / 9) * Math.PI * 2;
    const line: V3[] = [];
    for (let i = 0; i < ts; i++) {
      const u = 0.2 + (0.46 * i) / (ts - 1);
      const p = curve.getPoint(u);
      const t = curve.getTangent(u).normalize();
      const n = new THREE.Vector3().crossVectors(t, Z_AXIS).normalize();
      const b = new THREE.Vector3().crossVectors(t, n).normalize();
      const r = 0.74 * stomachShellR(u);
      // The folds wander a little so they read as folds, not as railway lines.
      const aa = a + 0.18 * Math.sin(u * 40 + k);
      line.push([
        p.x + (n.x * Math.cos(aa) + b.x * Math.sin(aa)) * r,
        p.y + (n.y * Math.cos(aa) + b.y * Math.sin(aa)) * r,
        p.z + (n.z * Math.cos(aa) + b.z * Math.sin(aa)) * r,
      ]);
    }
    rugae.push(tubeAlong(line, () => 0.0015, { tubular: 24, radial: 4 }));
  }

  // --- curvatures: the lesser on the concave side, the greater on the convex side.
  const curvature = (sign: number, u0: number, u1: number): THREE.BufferGeometry => {
    const line: V3[] = [];
    for (let i = 0; i < 24; i++) {
      const u = u0 + ((u1 - u0) * i) / 23;
      const p = curve.getPoint(u);
      const v = inward(curve, u, centroid);
      const r = 0.8 * stomachShellR(u) * sign;
      line.push([p.x + v.x * r, p.y + v.y * r, p.z]);
    }
    return tubeAlong(line, () => 0.0016, { tubular: 30, radial: 4 });
  };

  // --- gastric glands: surface pits plus one enlarged gland.
  const rand = mulberry32(0x57a0);
  const glands: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 70; i++) {
    const u = 0.2 + 0.38 * rand();
    const a = rand() * Math.PI * 2;
    const p = curve.getPoint(u);
    const t = curve.getTangent(u).normalize();
    const n = new THREE.Vector3().crossVectors(t, Z_AXIS).normalize();
    const b = new THREE.Vector3().crossVectors(t, n).normalize();
    const r = WALL * stomachShellR(u) - 0.0003;
    const pit = new THREE.SphereGeometry(0.0011, 5, 3);
    pit.translate(p.x + (n.x * Math.cos(a) + b.x * Math.sin(a)) * r, p.y + (n.y * Math.cos(a) + b.y * Math.sin(a)) * r, p.z + (n.z * Math.cos(a) + b.z * Math.sin(a)) * r);
    glands.push(pit);
  }
  for (let i = 0; i < 40; i++) {
    // Pits on the dome: upper hemisphere directions only.
    const th = rand() * 1.0;
    const ph = rand() * Math.PI * 2;
    const pit = new THREE.SphereGeometry(0.0011, 5, 3);
    pit.translate(
      d.centre[0] + 0.0212 * Math.sin(th) * Math.cos(ph),
      d.centre[1] + 0.0212 * Math.cos(th),
      d.centre[2] + 0.0212 * Math.sin(th) * Math.sin(ph),
    );
    glands.push(pit);
  }
  // The enlarged gland: a flask-shaped duct with parietal cells (large) and chief cells
  // (small) round its base. Drawn about ten times life size, floating in the body lumen.
  const gx = -0.002;
  const gz = 0.012;
  const flask = tubeAlong(
    [[gx, 0.026, gz], [gx, 0.02, gz], [gx, 0.013, gz], [gx, 0.007, gz]],
    (t) => 0.0018 + 0.0008 * t,
    { tubular: 16, radial: 7 },
  );
  glands.push(flask);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const cell = new THREE.SphereGeometry(0.0021, 6, 4);
    cell.translate(gx + 0.0045 * Math.cos(a), 0.017 - 0.0016 * (i % 2), gz + 0.0045 * Math.sin(a));
    glands.push(cell);
  }
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.3;
    const cell = new THREE.SphereGeometry(0.0012, 5, 3);
    cell.translate(gx + 0.0032 * Math.cos(a), 0.0085, gz + 0.0032 * Math.sin(a));
    glands.push(cell);
  }

  return [
    { id: 'cardia', geometry: cardia },
    { id: 'fundus', geometry: fundus },
    { id: 'body', geometry: body },
    { id: 'antrum', geometry: antrum },
    { id: 'pylorus', geometry: mergeParts(pyl) },
    { id: 'rugae', geometry: mergeParts(rugae) },
    { id: 'gastric_glands', geometry: mergeParts(glands) },
    { id: 'lesser_curvature', geometry: curvature(1, 0.08, 0.95) },
    { id: 'greater_curvature', geometry: curvature(-1, 0.1, 0.95) },
  ];
};
