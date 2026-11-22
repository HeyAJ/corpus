import * as THREE from 'three';
import type { PartBuilder } from '../parts';
import { capsule, ellipsoid, mergeParts, polygonise, smoothUnion, tubeAlong, type Sdf, type V3 } from '../sdf';

/**
 * THE INSIDE OF THE FETUS: ITS ORGANS, ITS CIRCULATION AND ITS UMBILICAL CORD.
 *
 * The fetal circulation is the one place in the body where the most oxygenated blood runs
 * in a VEIN, and where three shunts carry blood past organs that are not yet in use: the
 * ductus venosus (umbilical vein past the liver to the inferior vena cava), the foramen
 * ovale (right atrium to left atrium) and the ductus arteriosus (pulmonary trunk to the
 * aorta, past the unexpanded lungs). The placenta, not the lungs, is the organ of gas
 * exchange before birth, and the vessels are arranged so that its blood reaches the heart
 * and brain first (GH14, the chapter on fetal and neonatal physiology; GRAYS42 for the
 * structure). Everything here is drawn as anatomy; the engine models no fetal circulation.
 *
 * WHAT THE SHELL IS, AND WHY NOTHING HERE DEPENDS ON THE WEEK. `models.ts` `fetus()` takes
 * no parameters and always builds the term-sized, head-down figure. The week enters in
 * ONE place: OrganSet scales and moves the WHOLE organ uniformly (`fetalFit`, models.ts)
 * to sit inside the week's amniotic sac, and OrganDetail copies that live transform onto
 * the interior group. So these parts and their particle streams, authored in the term
 * frame, shrink and travel with the shell and stay lined up with each other without being
 * re-authored; `gestationWeeks` is accepted and deliberately ignored. (This note used to
 * say the shell was never scaled, which was why a term-sized fetus hung out of a
 * 24-week uterus.)
 *
 * FRAME AND THE FLIP. The shell is head DOWN: the head is at y = -0.13 and the pelvis at
 * y = +0.10, so the fetal "up" is the frame's -y, and, because the front stays +z, the
 * fetal right is the frame's -x. Authoring a chest in the frame's flipped axes is how
 * hearts end up mirrored, so every coordinate below is written in FETAL axes (fx to the
 * fetus's right, fy towards its head, fz to its front) and mapped once by `f`.
 *
 * THE CORD ENDS AT THE SHELL'S BOUNDARY on the side nearest the uterine fundus (the
 * frame's +y, the breech end), at [0, 0.2, -0.05], exactly where the shell's own cord ends;
 * the placenta, drawn on the uterine wall by another module, is out there. The cord leaves
 * the abdomen at the umbilicus, [0, 0.02, 0.05]. Its centreline is the shell's, so the three
 * vessels lie inside the shell's cord tube (radius 6 mm): the vessels twist round each other
 * on a helix of 2.8 mm radius, and the vein is thicker than the two arteries, as it is.
 *
 * FINER STRUCTURES (T2; src/data/anatomy/fetus.json). Four new level-1 parts that have a plausible
 * place in the existing figure: the two kidneys, the two adrenals, the stomach and the vertebral
 * column; and the four chambers of the heart as children of `heart`. The chambers are the same
 * four lumps that make the heart, drawn a little smaller so they sit inside it, so they follow
 * the beat (a child rides its parent's pose). Positions are written in fetal axes like the rest,
 * chosen to sit behind the liver and beside the aorta and the vena cava without touching a
 * stream, and are drawing proportions, not measurements.
 *
 * NOT DRAWN. The heart valves, the vessels of the limbs, the hepatic and portal tree, the
 * pulmonary vessels beyond the first branches, the cord's Wharton's jelly (a sheath would
 * be a fifteenth part), the placenta. Sizes are chosen to read clearly, not measured. The
 * lower body's own venous return to the IVC is part of the vessel but carries no stream.
 */

/** Fetal axes to the shell's frame: head down (fy -> -y), so the fetal right is -x. */
const f = (x: number, y: number, z: number): V3 => [-x, -y, z];
const fl = (pts: readonly V3[]): V3[] => pts.map((p) => f(p[0], p[1], p[2]));

/* ---------------------------------------------------------------- the cord */

/** The shell's own cord centreline, copied from models.ts `fetus()`. */
const CORD_CENTRE: readonly V3[] = [
  [0, 0.02, 0.05],
  [0.03, 0.06, 0.08],
  [0.05, 0.12, 0.05],
  [0.03, 0.17, 0.0],
  [0, 0.2, -0.05],
];
const CORD_TURNS = 5;
const CORD_SAMPLES = 64;
const HELIX_R = 0.0028;
const VEIN_R = 0.002;
const ARTERY_R = 0.0015;

let strandCache: V3[][] | null = null;

/** Three helices round the cord centreline, from the umbilicus (t = 0) to the cord's end. */
function cordStrands(): V3[][] {
  if (strandCache) return strandCache;
  const curve = new THREE.CatmullRomCurve3(
    CORD_CENTRE.map((p) => new THREE.Vector3(p[0], p[1], p[2])),
    false,
    'catmullrom',
    0.5,
  );
  const frames = curve.computeFrenetFrames(CORD_SAMPLES, false);
  const phase = [0, (2 * Math.PI) / 3, (4 * Math.PI) / 3];
  const out: V3[][] = [[], [], []];
  const p = new THREE.Vector3();
  for (let i = 0; i <= CORD_SAMPLES; i++) {
    const u = i / CORD_SAMPLES;
    curve.getPointAt(u, p);
    const n = frames.normals[i];
    const b = frames.binormals[i];
    for (let k = 0; k < 3; k++) {
      const a = phase[k] + CORD_TURNS * 2 * Math.PI * u;
      const c = Math.cos(a) * HELIX_R;
      const s = Math.sin(a) * HELIX_R;
      out[k].push([p.x + n.x * c + b.x * s, p.y + n.y * c + b.y * s, p.z + n.z * c + b.z * s]);
    }
  }
  strandCache = out;
  return out;
}

/** A point a little inside the abdominal wall of a strand's start. */
const inward = (s: V3): V3 => [s[0], s[1], s[2] - 0.008];

/* ------------------------------------------------------------- the vessels */

/** Every centreline, in the shell's frame, in the direction the blood runs. */
export interface FetalPaths {
  veinFull: V3[];
  ductusVenosus: V3[];
  ivc: V3[];
  ivcStream: V3[];
  svc: V3[];
  foramenOvale: V3[];
  foramenStream: V3[];
  leftHeartStream: V3[];
  aorticArch: V3[];
  carotid: V3[];
  descendingAorta: V3[];
  trunk: V3[];
  trunkBranches: V3[][];
  rightHeartStream: V3[];
  ductusArteriosus: V3[];
  arteries: V3[][];
}

let pathCache: FetalPaths | null = null;

export function fetalPaths(): FetalPaths {
  if (pathCache) return pathCache;
  const strands = cordStrands();

  const veinFull: V3[] = [
    ...strands[0].slice().reverse(),
    inward(strands[0][0]),
    ...fl([
      [0, -0.014, 0.034],
      [0.002, -0.006, 0.026],
      [0.004, 0.0, 0.02], // the portal sinus, inside the liver
    ]),
  ];
  const ductusVenosus = fl([
    [0.004, 0.0, 0.02],
    [0.008, 0.008, 0.008],
    [0.0115, 0.016, -0.006], // joins the inferior vena cava just below the diaphragm
  ]);
  const ivc = fl([
    [0.008, -0.05, -0.002],
    [0.012, -0.02, -0.008],
    [0.012, 0.0, -0.01],
    [0.0115, 0.016, -0.006],
    [0.01, 0.03, -0.002],
    [0.0105, 0.044, 0.014],
    [0.0102, 0.053, 0.02],
  ]);
  const ivcStream = fl([
    [0.0115, 0.016, -0.006],
    [0.01, 0.03, -0.002],
    [0.0105, 0.044, 0.014],
    [0.0102, 0.053, 0.02],
    [0.01, 0.057, 0.022],
  ]);
  const svc = fl([
    [0.006, 0.112, 0.01],
    [0.007, 0.1, 0.014],
    [0.008, 0.088, 0.018],
    [0.01, 0.074, 0.021],
    [0.01, 0.062, 0.022],
    [0.011, 0.058, 0.022],
  ]);
  const foramenOvale = fl([
    [0.007, 0.058, 0.018],
    [0.001, 0.061, 0.012],
  ]);
  const foramenStream = fl([
    [0.01, 0.057, 0.022],
    [0.007, 0.058, 0.018],
    [0.001, 0.061, 0.012],
    [-0.002, 0.062, 0.01],
  ]);
  const aortaAll = fl([
    [-0.005, 0.054, 0.023],
    [-0.002, 0.066, 0.022],
    [-0.006, 0.08, 0.018],
    [-0.012, 0.082, 0.01],
    [-0.014, 0.074, 0.002],
    [-0.012, 0.06, -0.004],
    [-0.01, 0.04, -0.006],
    [-0.006, 0.01, -0.006],
    [-0.002, -0.035, -0.004],
    [0, -0.056, -0.003],
  ]);
  const aorticArch = aortaAll.slice(0, 5);
  const descendingAorta = aortaAll.slice(4);
  const carotid = fl([
    [-0.006, 0.08, 0.018],
    [-0.004, 0.092, 0.017],
    [-0.004, 0.106, 0.016],
    [-0.003, 0.12, 0.014], // ends inside the brain
  ]);
  const leftHeartStream = [
    ...fl([
      [-0.002, 0.062, 0.01],
      [-0.007, 0.053, 0.017],
      [-0.012, 0.041, 0.02],
      [-0.006, 0.05, 0.025],
    ]),
    ...aortaAll.slice(0, 3),
    ...carotid.slice(1),
  ];
  const trunk = fl([
    [0.0, 0.054, 0.036],
    [-0.004, 0.064, 0.032],
    [-0.009, 0.071, 0.02],
  ]);
  const trunkBranches = [
    fl([
      [-0.009, 0.071, 0.02],
      [0.006, 0.068, 0.012],
      [0.021, 0.066, 0.008],
    ]),
    fl([
      [-0.009, 0.071, 0.02],
      [-0.018, 0.069, 0.014],
      [-0.026, 0.066, 0.008],
    ]),
  ];
  const rightHeartStream = fl([
    [0.011, 0.058, 0.022],
    [0.006, 0.05, 0.03],
    [0.003, 0.043, 0.034],
    [0.0, 0.052, 0.036],
    [-0.004, 0.064, 0.032],
    [-0.009, 0.071, 0.02],
  ]);
  const ductusArteriosus = fl([
    [-0.009, 0.071, 0.02],
    [-0.012, 0.073, 0.011],
    [-0.014, 0.074, 0.002],
  ]);
  const arteries = [1, -1].map((s, k) => [
    ...fl([
      [0, -0.056, -0.003],
      [s * 0.006, -0.066, 0.002],
      [s * 0.011, -0.068, 0.012],
      [s * 0.012, -0.058, 0.022],
      [s * 0.009, -0.044, 0.031],
      [s * 0.005, -0.03, 0.037],
    ]),
    inward(strands[k + 1][0]),
    ...strands[k + 1],
  ]);

  pathCache = {
    veinFull, ductusVenosus, ivc, ivcStream, svc, foramenOvale, foramenStream, leftHeartStream, aorticArch,
    carotid, descendingAorta, trunk, trunkBranches, rightHeartStream, ductusArteriosus, arteries,
  };
  return pathCache;
}

/* ------------------------------------------------------------- the solids */

interface Lump {
  c: V3;
  r: V3;
}
const lump = (x: number, y: number, z: number, rx: number, ry: number, rz: number): Lump => ({ c: f(x, y, z), r: [rx, ry, rz] });

function fieldAndBox(lumps: Lump[], k: number, pad: number): { field: Sdf; min: V3; max: V3 } {
  const field = smoothUnion(k, ...lumps.map((l) => ellipsoid(l.c, l.r)));
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const l of lumps) {
    for (let a = 0; a < 3; a++) {
      min[a] = Math.min(min[a], l.c[a] - l.r[a] - pad);
      max[a] = Math.max(max[a], l.c[a] + l.r[a] + pad);
    }
  }
  return { field, min, max };
}

function lumpsToGeometry(lumps: Lump[], k: number, cell: number): THREE.BufferGeometry {
  const { field, min, max } = fieldAndBox(lumps, k, 0.003);
  return polygonise(field, min, max, { cell });
}

const tube = (pts: readonly V3[], r0: number, r1: number, radial = 8, tubular = 0): THREE.BufferGeometry =>
  tubeAlong(pts, (t) => r0 + (r1 - r0) * t, { tubular: tubular || Math.max(12, pts.length * 6), radial });

export const parts: PartBuilder = () => {
  const p = fetalPaths();
  const out: { id: string; geometry: THREE.BufferGeometry }[] = [];

  // Brain: the cerebrum, the cerebellum behind and below it, and the brainstem, all inside
  // the head sphere of the shell.
  {
    const cerebrum = lump(0, 0.138, 0.016, 0.036, 0.03, 0.036);
    const cerebellum = lump(0, 0.114, -0.008, 0.024, 0.014, 0.014);
    const { min, max } = fieldAndBox([cerebrum, cerebellum], 0, 0.003);
    const field = smoothUnion(
      0.004,
      ellipsoid(cerebrum.c, cerebrum.r),
      ellipsoid(cerebellum.c, cerebellum.r),
      capsule(f(0, 0.112, 0.004), f(0, 0.098, 0.004), 0.006),
    );
    out.push({ id: 'brain', geometry: polygonise(field, [min[0], min[1] - 0.006, min[2]], max, { cell: 0.0036 }) });
  }

  // Heart: four chambers, near enough to touch, so two atria (behind and above) and two
  // ventricles (in front and below) can be told apart. The right atrium and the left atrium
  // meet at the atrial septum, which is where the foramen ovale is drawn.
  out.push({
    id: 'heart',
    geometry: lumpsToGeometry(
      [
        lump(0.01, 0.056, 0.022, 0.009, 0.01, 0.009), // right atrium
        lump(-0.002, 0.062, 0.01, 0.008, 0.008, 0.008), // left atrium
        lump(0.002, 0.044, 0.034, 0.01, 0.011, 0.007), // right ventricle, in front
        lump(-0.012, 0.04, 0.024, 0.01, 0.013, 0.009), // left ventricle, apex to the fetal left
      ],
      0.0015,
      0.0018,
    ),
  });

  // Lungs: collapsed, so small and set well back in the chest either side of the heart.
  out.push({
    id: 'lungs',
    geometry: lumpsToGeometry([lump(0.028, 0.055, 0.0, 0.01, 0.03, 0.022), lump(-0.028, 0.055, 0.0, 0.01, 0.03, 0.022)], 0.0001, 0.0027),
  });

  // Liver: large for the body, as it is before birth; a big right lobe and a smaller left.
  out.push({
    id: 'liver',
    geometry: lumpsToGeometry([lump(0.01, -0.002, 0.012, 0.026, 0.022, 0.024), lump(-0.016, 0.004, 0.016, 0.016, 0.016, 0.018)], 0.006, 0.0026),
  });

  // The vessels. The aorta tapers; the arch part also carries the head vessels.
  out.push({ id: 'aortic_arch', geometry: mergeParts([tube(p.aorticArch, 0.0036, 0.0032, 8, 40), tube(p.carotid, 0.0017, 0.0017, 6, 24)]) });
  out.push({ id: 'descending_aorta', geometry: tube(p.descendingAorta, 0.003, 0.0024, 8, 60) });
  out.push({ id: 'inferior_vena_cava', geometry: tube(p.ivc, 0.0034, 0.0036, 8, 48) });
  out.push({ id: 'superior_vena_cava', geometry: tube(p.svc, 0.0022, 0.0033, 8, 30) });
  out.push({ id: 'pulmonary_trunk', geometry: mergeParts([tube(p.trunk, 0.0036, 0.0036, 8, 20), ...p.trunkBranches.map((b) => tube(b, 0.0017, 0.0017, 6, 16))]) });

  // The cord: the vein runs from the cord's end through the umbilicus to the liver; the two
  // arteries run from the aortic bifurcation round the pelvis and out through the umbilicus.
  out.push({ id: 'umbilical_vein', geometry: tube(p.veinFull, VEIN_R, VEIN_R, 8, 90) });
  out.push({ id: 'umbilical_arteries', geometry: mergeParts(p.arteries.map((a) => tube(a, ARTERY_R, ARTERY_R, 6, 80))) });

  // The three shunts: short, thick, solid, and so pickable through the glass round them.
  out.push({ id: 'ductus_venosus', geometry: tube(p.ductusVenosus, 0.0026, 0.0026, 8, 16) });
  out.push({ id: 'foramen_ovale', geometry: tube(p.foramenOvale, 0.0028, 0.0028, 8, 10) });
  out.push({ id: 'ductus_arteriosus', geometry: tube(p.ductusArteriosus, 0.0028, 0.0028, 8, 12) });

  // The four chambers, as children of the heart: the same lumps, drawn at 85 % so they sit inside it.
  const chamber = (id: string, c: V3, r: V3): void => {
    const l = lump(c[0], c[1], c[2], r[0] * 0.85, r[1] * 0.85, r[2] * 0.85);
    out.push({ id, geometry: lumpsToGeometry([l], 0.0001, 0.0016) });
  };
  chamber('fetal_right_atrium', [0.01, 0.056, 0.022], [0.009, 0.01, 0.009]);
  chamber('fetal_left_atrium', [-0.002, 0.062, 0.01], [0.008, 0.008, 0.008]);
  chamber('fetal_right_ventricle', [0.002, 0.044, 0.034], [0.01, 0.011, 0.007]);
  chamber('fetal_left_ventricle', [-0.012, 0.04, 0.024], [0.01, 0.013, 0.009]);

  // Kidneys and adrenals: behind the abdomen, either side of the aorta; the adrenal sits on the
  // top of its kidney and is drawn large, as it is before birth.
  const kid = [1, -1].map((s) => lump(s * 0.022, -0.014, -0.018, 0.0065, 0.013, 0.007));
  out.push({ id: 'fetal_kidneys', geometry: lumpsToGeometry(kid, 0.0001, 0.0016) });
  const adr = [1, -1].map((s) => lump(s * 0.021, 0.002, -0.018, 0.0055, 0.004, 0.0035));
  out.push({ id: 'fetal_adrenals', geometry: lumpsToGeometry(adr, 0.0001, 0.0012) });

  // Stomach: on the fetal left, under the left lobe of the liver.
  out.push({ id: 'fetal_stomach', geometry: lumpsToGeometry([lump(-0.026, -0.012, 0.006, 0.01, 0.013, 0.008)], 0.0001, 0.0018) });

  // Vertebral column: a row of bodies along the back, behind the aorta, from the sacrum to the neck.
  const bodies: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 17; i++) {
    const y = -0.052 + i * 0.0095;
    const c = f(0, y, -0.0125);
    const g = new THREE.SphereGeometry(1, 8, 5);
    g.scale(0.0045, 0.0036, 0.0036);
    g.translate(c[0], c[1], c[2]);
    bodies.push(g);
  }
  out.push({ id: 'spine', geometry: mergeParts(bodies) });
  return out;
};
