import * as THREE from 'three';
import type { PartBuilder } from '../parts';
import { giSegment, organDef } from '../layout';
import { mulberry32 } from '../noise';
import { halfSpace, intersect, mergeParts, polygonise, sphere, tubeAlong } from '../sdf';
import type { V3 } from '../sdf';
import { blob, blobAlong, cone, placed, ribbon, ringAcross as ring, stick } from './gi_shared';

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
 * FINER STRUCTURES (textbook-depth pass). Outside in: a serosa (glass sleeve), the muscularis
 * externa (glass sleeve) holding its three layers as children (circular rings, longitudinal
 * strips, and oblique strips that wind over the body and arch over the fundus), and a
 * submucosa. Fractions of the shell radius, in the order the layers lie: wall regions 0.78,
 * submucosa 0.82, circular 0.845, oblique 0.865, longitudinal 0.885, muscularis externa 0.905,
 * serosa 0.96. They are drawing proportions that keep layers apart, NOT real thicknesses.
 * Outside the wall: the lesser and greater omenta (flat sheets hung from the two curvatures),
 * the arteries that run along the curvatures, the short gastric twigs, and the two vagal
 * trunks. The GASTRIC GLAND children are cells of the one enlarged gland (the original
 * parietal and chief cells moved out of the parent into their own parts, so each can be
 * picked) plus a second, smaller enlarged gland in the antrum that carries the gastrin (G)
 * cells, because G cells live in the antrum and the body gland is in the body. Cells are drawn
 * many times life size and their counts and arrangement are schematic: the textbook says which
 * cell types a gland has and roughly where, not how many. The vagal trunks end at the pylorus
 * here; their branches to the liver and coeliac region are not drawn. The omenta are flat
 * ribbons, not the real fat-laden folds, and their lower edges are drawn at a display length.
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

/** Where the enlarged body gland stands (its base), in the stomach frame; the same place the old drawing used. */
const GLAND_X = -0.002;
const GLAND_Y0 = 0.007;
const GLAND_Z = 0.012;
/** The antral gland is drawn at this fraction of the body gland's (display choice, so it fits the narrower antrum). */
const ANTRAL_SCALE = 0.6;
/** Height of the enlarged gland, mouth to base, in its local frame: a drawing size, many times life size. */
const GLAND_H = 0.019;

/** Flask radius at local height y (0 = base): a display taper, wider at the base than the mouth. */
const flaskR = (y: number): number => 0.0026 - 0.0008 * (y / GLAND_H);

/** The enlarged gland's duct: a flask, local frame (base at y = 0, mouth at y = GLAND_H). */
function glandFlask(): THREE.BufferGeometry {
  return tubeAlong([[0, GLAND_H, 0], [0, 0.0135, 0], [0, 0.0065, 0], [0, 0, 0]], (t) => 0.0018 + 0.0008 * t, { tubular: 16, radial: 7 });
}

/**
 * The cells of one enlarged gland in its local frame, returned by type. The ring helper puts
 * `n` copies of a cell round the flask at height y and distance `rad` from its axis.
 * Arrangement follows the textbook's description (mucous cells at the pit and neck, parietal
 * cells in the middle, chief cells at the base, endocrine cells scattered); counts are schematic.
 * `antral` selects the antral gland (G cells) in place of the body gland (parietal, chief and
 * ECL cells), because those two cell populations live in different parts of the stomach.
 */
function glandCells(antral: boolean): Record<string, THREE.BufferGeometry[]> {
  const out: Record<string, THREE.BufferGeometry[]> = { pit: [], surface: [], neck: [], parietal: [], chief: [], ecl: [], d: [], g: [] };
  const ringOf = (key: string, n: number, y: number, rad: number, phase: number, make: (c: V3, a: number) => THREE.BufferGeometry): void => {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + phase;
      out[key].push(make([rad * Math.cos(a), y, rad * Math.sin(a)], a));
    }
  };
  // The pit: a funnel down from the surface to the mouth of the gland (body gland only).
  if (!antral) out.pit.push(tubeAlong([[0, GLAND_H + 0.0025, 0], [0, GLAND_H + 0.0005, 0], [0, GLAND_H - 0.002, 0]], (t) => 0.0034 - 0.0016 * t, { tubular: 8, radial: 8 }));
  if (!antral) {
    ringOf('surface', 8, GLAND_H + 0.0016, 0.0042, 0, (c) => blob(c, [0.0011, 0.0009, 0.0011], 6, 4));
    ringOf('neck', 6, 0.0155, flaskR(0.0155) + 0.0010, 0.2, (c) => blob(c, [0.0009, 0.0013, 0.0009], 6, 4));
    // Parietal cells alternate a little in height so the ring does not read as a washer.
    ringOf('parietal', 6, 0.0105, 0.0045, 0, (c, a) => blob([c[0], c[1] - (Math.round((a / (Math.PI * 2)) * 6) % 2) * 0.0016, c[2]], 0.0021, 7, 5));
    ringOf('chief', 5, 0.0015, 0.0032, 0.3, (c) => blob(c, 0.0012, 6, 4));
    ringOf('ecl', 4, 0.0058, 0.0036, 0.4, (c, a) => mergeParts([blob(c, 0.0007, 5, 4), stick(c, [c[0] + 0.0012 * Math.cos(a + 0.6), c[1] + 0.0008, c[2] + 0.0012 * Math.sin(a + 0.6)], 0.00018)]));
    ringOf('d', 3, 0.0088, flaskR(0.0088) + 0.0006, 0.9, (c) => blobAlong(c, [0, 1, 0], 0.0011, 0.0005, 5, 4));
  } else {
    // G cells: flask-shaped, a rounded body with a narrow neck reaching toward the lumen.
    ringOf('g', 6, 0.009, flaskR(0.009) + 0.0012, 0, (c) => blobAlong(c, [0, 1, 0], 0.0017, 0.0009, 6, 4));
    ringOf('g', 6, 0.0105, flaskR(0.0105) + 0.0008, 0.5, (c) => cone([c[0], c[1], c[2]], [c[0] * 0.55, c[1] + 0.0025, c[2] * 0.55], 0.0005, 5));
    ringOf('d', 3, 0.005, flaskR(0.005) + 0.0006, 0.9, (c) => blobAlong(c, [0, 1, 0], 0.0011, 0.0005, 5, 4));
  }
  return out;
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
  glands.push(placed(glandFlask(), [GLAND_X, GLAND_Y0, GLAND_Z], [0, 1, 0], 1));
  // The parietal and chief cells that used to be merged in here are now their own child parts
  // (below), so each can be picked. The antral gland's flask, which carries the G cells, is drawn
  // here with the other gland geometry.
  const antralFrame = ((): { origin: V3; up: V3 } => {
    const p = curve.getPoint(0.8);
    const t = curve.getTangent(0.8).normalize();
    const n = new THREE.Vector3().crossVectors(t, Z_AXIS).normalize();
    const bb = new THREE.Vector3().crossVectors(t, n).normalize();
    const a = 1.0;
    const out = n.clone().multiplyScalar(Math.cos(a)).addScaledVector(bb, Math.sin(a)).normalize();
    const r = 0.74 * stomachShellR(0.8);
    return { origin: [p.x + out.x * r, p.y + out.y * r, p.z + out.z * r], up: [-out.x, -out.y, -out.z] };
  })();
  glands.push(placed(glandFlask(), antralFrame.origin, antralFrame.up, ANTRAL_SCALE));

  // ===================================================================================
  // FINER STRUCTURES
  // ===================================================================================
  const lineOn = (u0: number, u1: number, count: number, angleAt: (u: number, i: number) => number, frac: number): V3[] => {
    const line: V3[] = [];
    for (let i = 0; i < count; i++) {
      const u = u0 + ((u1 - u0) * i) / (count - 1);
      const p = curve.getPoint(u);
      const t = curve.getTangent(u).normalize();
      const n = new THREE.Vector3().crossVectors(t, Z_AXIS).normalize();
      const b2 = new THREE.Vector3().crossVectors(t, n).normalize();
      const r = frac * stomachShellR(u);
      const a2 = angleAt(u, i);
      line.push([p.x + (n.x * Math.cos(a2) + b2.x * Math.sin(a2)) * r, p.y + (n.y * Math.cos(a2) + b2.y * Math.sin(a2)) * r, p.z + (n.z * Math.cos(a2) + b2.z * Math.sin(a2)) * r]);
    }
    return line;
  };

  const serosa = layer(curve, 0.0, 0.97, 0.96, 44, 14);
  const muscularisExterna = layer(curve, 0.02, 0.96, 0.905, 44, 14);
  const submucosa = layer(curve, 0.04, 0.95, 0.82, 40, 14);

  const circular: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 24; k++) {
    const u = 0.1 + (0.84 * k) / 23;
    circular.push(ring(curve.getPoint(u), curve.getTangent(u).normalize(), 0.845 * stomachShellR(u), 0.0006, 3, 12));
  }
  const longitudinal: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2 + 0.3;
    longitudinal.push(tubeAlong(lineOn(0.04, 0.96, 30, () => a, 0.885), () => 0.0008, { tubular: 40, radial: 3 }));
  }
  // Oblique fibres: half a turn round the body, and arcs that sweep over the fundal dome.
  const oblique: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 4; k++) {
    const a0 = (k / 4) * Math.PI * 2;
    oblique.push(tubeAlong(lineOn(0.08, 0.5, 24, (u) => a0 + ((u - 0.08) / 0.42) * Math.PI, 0.865), () => 0.0008, { tubular: 32, radial: 3 }));
  }
  for (let k = 0; k < 5; k++) {
    const arc: V3[] = [];
    const ph0 = (k / 5) * Math.PI * 2;
    for (let i = 0; i < 12; i++) {
      const th = 0.15 + (0.95 * i) / 11;
      const ph = ph0 + 0.9 * th;
      arc.push([
        d.centre[0] + 0.0245 * Math.sin(th) * Math.cos(ph),
        d.centre[1] + 0.0245 * Math.cos(th),
        d.centre[2] + 0.0245 * Math.sin(th) * Math.sin(ph),
      ]);
    }
    oblique.push(tubeAlong(arc, () => 0.0008, { tubular: 14, radial: 3 }));
  }

  // --- outside the wall: curvature arteries, short gastric twigs, omenta, vagal trunks.
  const alongCurve = (sign: number, u0: number, u1: number, frac: number, extra: V3 = [0, 0, 0]): V3[] => {
    const line: V3[] = [];
    for (let i = 0; i < 20; i++) {
      const u = u0 + ((u1 - u0) * i) / 19;
      const p = curve.getPoint(u);
      const v = inward(curve, u, centroid);
      const r = frac * stomachShellR(u) * sign;
      line.push([p.x + v.x * r + extra[0], p.y + v.y * r + extra[1], p.z + extra[2]]);
    }
    return line;
  };
  const artery = (line: V3[]): THREE.BufferGeometry => tubeAlong(line, () => 0.0009, { tubular: 26, radial: 4 });
  const leftGastric = artery(alongCurve(1, 0.02, 0.5, 1.08));
  const rightGastric = artery(alongCurve(1, 0.95, 0.5, 1.08));
  const rightOmental = artery(alongCurve(-1, 0.95, 0.5, 1.08));
  const leftOmental = artery(alongCurve(-1, 0.14, 0.5, 1.08));
  const shortGastric: THREE.BufferGeometry[] = [];
  for (const u of [0.1, 0.15, 0.2, 0.26]) {
    const p = curve.getPoint(u);
    const v = inward(curve, u, centroid);
    const r = 1.02 * stomachShellR(u);
    const s0: V3 = [p.x - v.x * r, p.y - v.y * r, p.z];
    shortGastric.push(tubeAlong([s0, [s0[0] - v.x * 0.005, s0[1] - v.y * 0.005 + 0.002, s0[2] + 0.001], [s0[0] - v.x * 0.01, s0[1] - v.y * 0.01 + 0.003, s0[2] + 0.002]], () => 0.0006, { tubular: 8, radial: 3 }));
  }
  const vagus = (zs: number): THREE.BufferGeometry => {
    const line: V3[] = [];
    for (let i = 0; i < 24; i++) {
      const u = 0.0 + (0.95 * i) / 23;
      const p = curve.getPoint(u);
      const v = inward(curve, u, centroid);
      const R = stomachShellR(u);
      line.push([p.x + v.x * 0.85 * R, p.y + v.y * 0.85 * R, p.z + zs * 0.5 * R]);
    }
    return tubeAlong(line, () => 0.0009, { tubular: 30, radial: 4 });
  };
  const lesserTop = alongCurve(1, 0.1, 0.93, 1.0);
  const lesserBottom = lesserTop.map((q, i): V3 => {
    const u = 0.1 + (0.83 * i) / 19;
    const v = inward(curve, u, centroid);
    return [q[0] + v.x * 0.016, q[1] + v.y * 0.016 + 0.006, q[2] - 0.002];
  });
  const greaterTop = alongCurve(-1, 0.2, 0.9, 1.0);
  const greaterBottom = greaterTop.map((q, i): V3 => [q[0], q[1] - 0.045 - 0.004 * Math.sin(i * 1.3), q[2] + 0.012]);

  // --- pyloric canal, sphincter and the angular incisure.
  const pyloricCanal = layer(curve, 0.9, 0.995, 0.55, 12, 10);
  const pylSphincter = ring(curve.getPoint(0.988), curve.getTangent(0.988).normalize(), 0.5 * stomachShellR(0.988), 0.0028, 6, 14);
  const incisure = ((): THREE.BufferGeometry => {
    const u = 0.66;
    const p = curve.getPoint(u);
    const v = inward(curve, u, centroid);
    const R = stomachShellR(u);
    return cone([p.x + v.x * 0.8 * R, p.y + v.y * 0.8 * R, p.z], [p.x + v.x * 0.45 * R, p.y + v.y * 0.45 * R, p.z], 0.0034, 6);
  })();

  // --- cells of the two enlarged glands, built in gland-local coordinates (see glandCells).
  const bodyCells = glandCells(false);
  const onBodyGland = (g: THREE.BufferGeometry[]): THREE.BufferGeometry => mergeParts(g.map((x) => placed(x, [GLAND_X, GLAND_Y0, GLAND_Z], [0, 1, 0], 1)));
  const antral = (g: THREE.BufferGeometry[]): THREE.BufferGeometry => mergeParts(g.map((x) => placed(x, antralFrame.origin, antralFrame.up, ANTRAL_SCALE)));
  const gCells = glandCells(true);

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
    // --- finer structures
    { id: 'angular_incisure', geometry: incisure },
    { id: 'pyloric_canal', geometry: pyloricCanal },
    { id: 'pyloric_sphincter', geometry: pylSphincter },
    { id: 'lesser_omentum', geometry: ribbon(lesserTop, lesserBottom) },
    { id: 'greater_omentum', geometry: ribbon(greaterTop, greaterBottom) },
    { id: 'left_gastric_artery', geometry: leftGastric },
    { id: 'right_gastric_artery', geometry: rightGastric },
    { id: 'right_gastro_omental_artery', geometry: rightOmental },
    { id: 'left_gastro_omental_artery', geometry: leftOmental },
    { id: 'short_gastric_arteries', geometry: mergeParts(shortGastric) },
    { id: 'anterior_vagal_trunk', geometry: vagus(1) },
    { id: 'posterior_vagal_trunk', geometry: vagus(-1) },
    { id: 'serosa', geometry: serosa },
    { id: 'muscularis_externa', geometry: muscularisExterna },
    { id: 'submucosa', geometry: submucosa },
    { id: 'circular_muscle_layer', geometry: mergeParts(circular) },
    { id: 'longitudinal_muscle_layer', geometry: mergeParts(longitudinal) },
    { id: 'oblique_muscle_layer', geometry: mergeParts(oblique) },
    { id: 'gastric_pits', geometry: onBodyGland(bodyCells.pit) },
    { id: 'surface_mucous_cells', geometry: onBodyGland(bodyCells.surface) },
    { id: 'mucous_neck_cells', geometry: onBodyGland(bodyCells.neck) },
    { id: 'parietal_cells', geometry: onBodyGland(bodyCells.parietal) },
    { id: 'chief_cells', geometry: onBodyGland(bodyCells.chief) },
    { id: 'ecl_cells', geometry: onBodyGland(bodyCells.ecl) },
    { id: 'd_cells', geometry: mergeParts([...bodyCells.d.map((x) => placed(x, [GLAND_X, GLAND_Y0, GLAND_Z], [0, 1, 0], 1)), ...gCells.d.map((x) => placed(x, antralFrame.origin, antralFrame.up, ANTRAL_SCALE))]) },
    { id: 'g_cells', geometry: antral(gCells.g) },
  ];
};
