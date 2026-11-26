import * as THREE from 'three';
import type { PartBuilder } from '../parts';
import { warpGeometry } from '../layout';
import { SPINAL_CORD_PATH, spinalCordRadius } from '../models';
import { mulberry32 } from '../noise';
import { mergeParts, tubeAlong, type V3 } from '../sdf';

/**
 * INTERIOR PARTS OF THE SPINAL CORD (atlas `spinal_cord`).
 *
 * The shell is a tube along SPINAL_CORD_PATH with the radius spinalCordRadius(y): a
 * cervical and a lumbar enlargement, a taper to the conus medullaris near L1-L2, and
 * below it one tapering bundle standing in for the cauda equina. Everything here follows
 * the same centreline and the same radius function, so each part is the right size at
 * every level by construction, and everything goes through `warpGeometry` exactly as the
 * shell does, because the cord is authored in unexploded body coordinates and the body is
 * drawn with its regions pulled apart.
 *
 * LEVELS. The shell has no vertebral levels, so three lengths of cord are cut at heights
 * in the same units as the path: cervical above y = 0.24, thoracic between 0.24 and 0.11,
 * lumbar from 0.11 down to the conus at 0.045. These cut heights are a drawing choice
 * (they put the two enlargements in the cervical and lumbar lengths where they belong);
 * they are not measured vertebral levels and the model does not claim them to be.
 *
 * FRONT AND BACK. The body's +z is anterior, so the front (ventral) of the cord is +z
 * and the back (dorsal) is -z. In the grey matter the dorsal horns are the slim ones
 * towards -z and the ventral horns the stout ones towards +z.
 *
 * WHAT STICKS OUT. Rootlets and the sympathetic chain are drawn a couple of millimetres
 * beyond the cord surface, and so are slightly outside the shell. They are short on
 * purpose: the real roots run centimetres to the intervertebral foramina, and drawing
 * them to scale would have them leave the glass shell entirely. They are a diagram of
 * "a root leaves here, with a ganglion on the sensory one", at about ten levels.
 *
 * SECOND PASS (the textbook-depth atlas). The first version drew the cord as three solid
 * lengths with the grey matter inside them, so the butterfly could not be seen at all: the
 * grey matter was entirely hidden by an opaque tube of white matter. The cord lengths, the
 * grey matter, the three funiculi and the membranes are now GLASS (the opacity is set in
 * spinal_cord.detail.ts) and what they hold - the horns, the tracts, the canal - is solid,
 * so each can be seen through the one outside it. The additions are all built the same way
 * as the first parts, from `cordLine`, so they follow the centreline and the radius.
 *
 * CROSS-SECTION POSITIONS. Anything that lies at a place in the cross-section is given as a
 * polar position in the cord's section: an angle measured from the dorsal midline round
 * towards the front, and a distance from the centre as a fraction of the shell radius (the
 * cord proper is drawn at 0.9 of it). `polar` turns that into the (fx, fz) offset that
 * `cordLine` takes. The tract positions follow the usual textbook cross-section (dorsal
 * columns between the dorsal horns, lateral corticospinal behind the denticulate line,
 * spinothalamic towards the front-side), but they are a SCHEMATIC, not a traced section:
 * real tracts are broad, overlapping and change shape from level to level, and the cut
 * heights used for where a tract begins and ends are drawing choices.
 *
 * COARSE ON PURPOSE. Each new part is a swept tube with a handful of segments; the atlas
 * was kept to about twice the triangles it had before it had children, and a hundred
 * tubes at the first version's resolution would have taken it far over that.
 *
 * Deterministic: the only randomness is `mulberry32` with a fixed seed, for the spread of
 * the cauda equina roots.
 */

const CORD_FRACTION = 0.9; // the cord proper is drawn slightly thinner than the shell
const CUT_CERVICAL = 0.24;
const CUT_LUMBAR = 0.11;
const CONUS_Y = 0.045;
const TOP_Y = 0.39;
const BOTTOM_Y = -0.1;

/** The centreline, sampled densely once, so a height can be turned into a point. */
const CURVE = new THREE.CatmullRomCurve3(
  SPINAL_CORD_PATH.map((p) => new THREE.Vector3(p[0], p[1], p[2])),
  false,
  'catmullrom',
  0.5,
);
const SAMPLE_N = 400;
const SAMPLES: THREE.Vector3[] = CURVE.getSpacedPoints(SAMPLE_N);

/** The centreline point at body height y (the path descends monotonically in y). */
export function centreAt(y: number, out: THREE.Vector3 = new THREE.Vector3()): THREE.Vector3 {
  let lo = 0;
  let hi = SAMPLES.length - 1;
  if (y >= SAMPLES[0].y) return out.copy(SAMPLES[0]);
  if (y <= SAMPLES[hi].y) return out.copy(SAMPLES[hi]);
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (SAMPLES[mid].y > y) lo = mid;
    else hi = mid;
  }
  const f = (SAMPLES[lo].y - y) / (SAMPLES[lo].y - SAMPLES[hi].y);
  return out.lerpVectors(SAMPLES[lo], SAMPLES[hi], f);
}

/**
 * Points down the cord from y0 to y1 at `n` steps, each displaced from the centreline by
 * (fx, fz) times the local shell radius. Used for flow paths as well as for tubes, so the
 * streams run exactly where the parts are.
 */
export function cordLine(y0: number, y1: number, n: number, fx: number, fz: number): V3[] {
  const out: V3[] = [];
  const c = new THREE.Vector3();
  for (let i = 0; i <= n; i++) {
    const y = y0 + ((y1 - y0) * i) / n;
    centreAt(y, c);
    const r = spinalCordRadius(c.y);
    out.push([c.x + fx * r, c.y, c.z + fz * r]);
  }
  return out;
}

/** A tube along a line of the cord, with the radius a fraction of the shell radius. */
function lineTube(y0: number, y1: number, fx: number, fz: number, radiusFraction: number, taperEnd = 0, segments = 0): THREE.BufferGeometry {
  // `segments` lets a caller ask for fewer rings than the default one per 5 mm: the grey
  // matter's five lobes were 6,700 triangles at the default, more than the budget allows
  // once the atlas has children, and the lobes are smooth tubes that need no more.
  const n = segments > 0 ? segments : Math.max(8, Math.round(Math.abs(y1 - y0) / 0.005));
  const pts = cordLine(y0, y1, 24, fx, fz);
  return tubeAlong(
    pts,
    (t, p) => {
      const taper = taperEnd > 0 && t > 1 - taperEnd ? 1 - 0.65 * ((t - (1 - taperEnd)) / taperEnd) : 1;
      return spinalCordRadius(p.y) * radiusFraction * taper;
    },
    { tubular: n, radial: 10 },
  );
}

/** The ten levels at which roots leave, high to low, in body height. */
const ROOT_LEVELS: readonly number[] = [0.36, 0.33, 0.3, 0.27, 0.235, 0.2, 0.165, 0.13, 0.095, 0.06];

/**
 * A short root from inside the cord to a little beyond its surface, running outwards and
 * a touch caudally. `ganglion` swells the outer end: the dorsal root ganglion.
 */
function root(y: number, side: 1 | -1, startX: number, startZ: number, endX: number, endZ: number, ganglion: boolean): THREE.BufferGeometry {
  const c = centreAt(y);
  const r = spinalCordRadius(y);
  const ext = ganglion ? 0.0015 : 0.0012;
  const p0: V3 = [c.x + side * startX * r, y, c.z + startZ * r];
  const p1: V3 = [c.x + side * (r * 0.9 + ext * 0.35), y - 0.0006, c.z + (startZ + endZ) * 0.5 * r];
  const p2: V3 = [c.x + side * (r * endX + ext), y - 0.0016, c.z + endZ * r];
  return tubeAlong(
    [p0, p1, p2],
    (t) => (ganglion ? 0.00035 + 0.0006 * Math.exp(-Math.pow((t - 0.92) / 0.14, 2)) : 0.00035),
    { tubular: 10, radial: 6 },
  );
}


/** Section position: angle from the dorsal midline towards the front (degrees), and distance as a fraction of the shell radius. */
function polar(angleDeg: number, distance: number, side: 1 | -1): [number, number] {
  const a = (angleDeg * Math.PI) / 180;
  return [side * Math.sin(a) * distance, -Math.cos(a) * distance];
}

/** A coarse tube down a line of the cord: the building block of everything added in the second pass. */
function col(
  y0: number,
  y1: number,
  fx: number,
  fz: number,
  frac: number,
  tubular = 28,
  radial = 5,
  radius?: (t: number, base: number) => number,
): THREE.BufferGeometry {
  const pts = cordLine(y0, y1, 16, fx, fz);
  return tubeAlong(pts, (t, p) => spinalCordRadius(p.y) * frac * (radius ? radius(t, 1) : 1), { tubular, radial });
}

/** The same tube on both sides of the midline, merged. */
function pair(y0: number, y1: number, angleDeg: number, distance: number, frac: number, tubular = 28, radial = 5, radius?: (t: number, base: number) => number): THREE.BufferGeometry {
  return mergeParts(
    ([1, -1] as const).map((side) => {
      const [fx, fz] = polar(angleDeg, distance, side);
      return col(y0, y1, fx, fz, frac, tubular, radial, radius);
    }),
  );
}

/** A tube straight between two points, as thin as a root or a ramus. */
function twig(a: V3, b: V3, radius: number, radial = 4): THREE.BufferGeometry {
  return tubeAlong([a, b], () => radius, { tubular: 3, radial });
}

/** A small ellipsoid: a ganglion. Low resolution on purpose; there are twenty of them. */
function bean(c: V3, rx: number, ry: number, rz: number): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, 6, 4);
  g.scale(rx, ry, rz);
  g.translate(c[0], c[1], c[2]);
  return g;
}

const NERVE_TOP = TOP_Y - 0.004;
const NERVE_BOTTOM = CONUS_Y + 0.004;

export const parts: PartBuilder = () => {
  // THE THREE LENGTHS OF CORD. A hair of overlap so no seam shows between them.
  const cervical = lineTube(TOP_Y, CUT_CERVICAL - 0.002, 0, 0, CORD_FRACTION);
  const thoracic = lineTube(CUT_CERVICAL, CUT_LUMBAR - 0.002, 0, 0, CORD_FRACTION);
  const lumbar = lineTube(CUT_LUMBAR, CONUS_Y, 0, 0, CORD_FRACTION, 0.18);

  // THE GREY MATTER: a central core with two slim dorsal and two stout ventral horns,
  // running the whole length of the cord down to the conus. Each lobe is its own thin tube
  // so the "butterfly" reads in the cut-across shape of the bundle.
  const grey: THREE.BufferGeometry[] = [];
  const lobe = (fx: number, fz: number, radiusFraction: number) => {
    grey.push(lineTube(TOP_Y - 0.004, CONUS_Y + 0.004, fx, fz, radiusFraction, 0.1, 44));
  };
  lobe(0, 0, 0.3); // the commissure and central region
  lobe(0.36, -0.42, 0.14); // dorsal horns: slim, towards the back
  lobe(-0.36, -0.42, 0.14);
  lobe(0.4, 0.3, 0.2); // ventral horns: stouter, towards the front
  lobe(-0.4, 0.3, 0.2);

  // THE CAUDA EQUINA: nine fine roots fanning out below the conus and falling together
  // to the sacrum. They share the centreline and are kept inside the shell's bundle radius.
  const rng = mulberry32(0x5ca1e);
  const cauda: THREE.BufferGeometry[] = [];
  const nRoots = 9;
  for (let k = 0; k < nRoots; k++) {
    const angle = (k / nRoots) * Math.PI * 2 + (rng() - 0.5) * 0.5;
    const reach = 0.45 + 0.4 * rng();
    const pts: V3[] = [];
    const steps = 8;
    for (let i = 0; i <= steps; i++) {
      const f = i / steps;
      const y = CONUS_Y - f * (CONUS_Y - (BOTTOM_Y + 0.004));
      const c = centreAt(y);
      const rb = spinalCordRadius(y);
      // Spread opens quickly below the conus and then follows the bundle's own taper.
      const open = Math.min(1, f * 5) * reach;
      pts.push([c.x + Math.cos(angle) * open * rb, y, c.z + Math.sin(angle) * open * rb]);
    }
    cauda.push(tubeAlong(pts, () => 0.00028, { tubular: 40, radial: 5 }));
  }

  // THE ROOTS. Dorsal ones leave towards the back with a ganglion on them; ventral ones
  // leave from the front. One of each, on each side, at each of the ten levels.
  const dorsal: THREE.BufferGeometry[] = [];
  const ventral: THREE.BufferGeometry[] = [];
  for (const y of ROOT_LEVELS) {
    for (const side of [1, -1] as const) {
      dorsal.push(root(y, side, 0.42, -0.62, 1.0, -0.5, true));
      ventral.push(root(y, side, 0.45, 0.58, 1.0, 0.5, false));
    }
  }

  // THE SYMPATHETIC CHAINS: a beaded chain each side, beside the thoracic and upper lumbar
  // cord. A single swept tube whose radius swells at regular intervals, which is cheaper
  // than a sphere per ganglion and reads the same as a string of beads.
  const chains: THREE.BufferGeometry[] = [];
  const chainTop = 0.265;
  const chainBottom = 0.065;
  const spacing = 0.0125;
  for (const side of [1, -1] as const) {
    const pts: V3[] = [];
    const c = new THREE.Vector3();
    for (let i = 0; i <= 40; i++) {
      const y = chainTop - ((chainTop - chainBottom) * i) / 40;
      centreAt(y, c);
      const r = spinalCordRadius(y);
      pts.push([c.x + side * (r + 0.0012), y, c.z + 0.0008]);
    }
    chains.push(
      tubeAlong(
        pts,
        (_t, p) => {
          const phase = ((chainTop - p.y) / spacing) % 1;
          return 0.00028 + 0.0006 * Math.exp(-Math.pow((phase - 0.5) / 0.2, 2));
        },
        { tubular: 110, radial: 6 },
      ),
    );
  }


  // ------------------------------------------------------------------ second pass

  // THE TWO ENLARGEMENTS, as a thin band round the cord where it swells. They are bands
  // over the cord rather than new lengths of it, because the swelling is already in the
  // shell and the cord lengths; the band picks the region out and names it.
  const cervicalEnl = col(0.365, 0.265, 0, 0, 0.98, 24, 8);
  const lumbarEnl = col(0.135, CONUS_Y, 0, 0, 0.98, 24, 8);
  // THE CONUS: the last of the cord, closing to a point. A drawing choice for how much of
  // the lower cord to call the cone.
  const conus = lineTube(0.075, CONUS_Y - 0.002, 0, 0, 0.98, 0.7, 16);
  // THE FILUM: a single thread down the middle of the cauda equina, beyond the conus.
  const filum = tubeAlong(cordLine(CONUS_Y - 0.002, BOTTOM_Y + 0.003, 16, 0, 0), () => 0.00022, { tubular: 40, radial: 4 });

  // THE MEMBRANES. The dura is the outer sac, the arachnoid lies just inside it, the pia
  // clings to the cord. They are sleeves along the whole length including the sac round the
  // cauda equina. The parent `meninges` is one sleeve between the dura and the arachnoid so
  // that it can be seen and picked when the children are hidden.
  const sleeve = (frac: number) => col(TOP_Y, BOTTOM_Y + 0.004, 0, 0, frac, 40, 8);
  const meninges = sleeve(1.14);
  const dura = sleeve(1.3);
  const arachnoid = sleeve(1.2);
  const pia = sleeve(0.94);

  // THE DENTICULATE LIGAMENTS: a continuous thin band down each side at the cord's surface
  // and a row of teeth from it out to the dura. The tooth spacing is a drawing choice.
  const dent: THREE.BufferGeometry[] = [];
  for (const side of [1, -1] as const) {
    dent.push(col(0.36, 0.065, side * 0.97, 0, 0.03, 24, 4));
    for (let i = 0; i < 22; i++) {
      const y = 0.36 - (0.295 * i) / 21;
      const c = centreAt(y);
      const r = spinalCordRadius(y);
      dent.push(twig([c.x + side * 0.97 * r, y, c.z], [c.x + side * 1.28 * r, y - 0.0015, c.z], 0.00018, 3));
    }
  }

  // THE CENTRAL CANAL: a narrow channel through the commissure.
  const canal = col(NERVE_TOP, NERVE_BOTTOM, 0, 0, 0.09, 40, 6);

  // THE GANGLIA, NERVES AND RAMI at the same ten levels as the roots. A ganglion is where the
  // dorsal root ends; the spinal nerve starts beyond it; the two rami start at the end of the
  // nerve and go back and forward. The distances are drawing choices (the real nerve leaves
  // through a gap between vertebrae, far further out than these few millimetres).
  const ganglia: THREE.BufferGeometry[] = [];
  const nerves: THREE.BufferGeometry[] = [];
  const dRami: THREE.BufferGeometry[] = [];
  const vRami: THREE.BufferGeometry[] = [];
  for (const y of ROOT_LEVELS) {
    const c = centreAt(y);
    const r = spinalCordRadius(y);
    for (const side of [1, -1] as const) {
      ganglia.push(bean([c.x + side * (r + 0.0022), y - 0.0016, c.z - 0.5 * r], 0.001, 0.0005, 0.0005));
      const a: V3 = [c.x + side * (r + 0.0032), y - 0.002, c.z - 0.1 * r];
      const b: V3 = [c.x + side * (r + 0.0095), y - 0.0045, c.z];
      nerves.push(twig(a, b, 0.00055, 5));
      dRami.push(twig(b, [c.x + side * (r + 0.0105), y - 0.0058, c.z - 0.0065], 0.0003));
      vRami.push(twig(b, [c.x + side * (r + 0.0115), y - 0.0068, c.z + 0.0075], 0.0004));
    }
  }

  // THE FUNICULI: glass bundles of white matter, each holding the tracts below.
  const dorsalF = pair(NERVE_TOP, NERVE_BOTTOM, 15, 0.66, 0.2, 28, 7);
  const lateralF = pair(NERVE_TOP, NERVE_BOTTOM, 95, 0.62, 0.26, 28, 7);
  const ventralF = pair(NERVE_TOP, NERVE_BOTTOM, 160, 0.62, 0.18, 28, 7);

  // THE TRACTS. Where a tract begins and ends is a drawing choice (the cuneate fascicle is
  // drawn only in the upper cord because it carries the upper body's signals, not at a
  // measured level).
  const gracilis = pair(NERVE_TOP, NERVE_BOTTOM, 7, 0.74, 0.07);
  const cuneatus = pair(NERVE_TOP, 0.17, 24, 0.74, 0.08);
  const lcst = pair(NERVE_TOP, NERVE_BOTTOM, 72, 0.68, 0.1);
  const dscst = pair(NERVE_TOP, 0.07, 98, 0.78, 0.065);
  const vscst = pair(NERVE_TOP, NERVE_BOTTOM, 124, 0.76, 0.065);
  const spinothal = pair(NERVE_TOP, NERVE_BOTTOM, 148, 0.74, 0.075);
  const acst = pair(NERVE_TOP, NERVE_BOTTOM, 172, 0.7, 0.06);

  // THE GREY MATTER'S REGIONS, each a little inside the lobe of the grey matter that holds it.
  const dHorn = mergeParts(([1, -1] as const).map((s) => col(NERVE_TOP, NERVE_BOTTOM, s * 0.36, -0.42, 0.115)));
  const subGel = mergeParts(([1, -1] as const).map((s) => col(NERVE_TOP, NERVE_BOTTOM, s * 0.41, -0.49, 0.045, 24, 5)));
  // The lateral horn exists only from the thoracic cord to the upper lumbar cord, where the
  // sympathetic outflow arises, so it is drawn from 0.26 to 0.09 only.
  const lHorn = mergeParts(([1, -1] as const).map((s) => col(0.26, 0.09, s * 0.52, 0, 0.08, 24, 5)));
  // The motor neurons are drawn as a beaded column (the radius swells at intervals) to read
  // as a row of cell bodies. Illustrative: the beads are not counted cells.
  const motor = mergeParts(
    ([1, -1] as const).map((s) =>
      col(NERVE_TOP, NERVE_BOTTOM, s * 0.44, 0.34, 0.1, 64, 6, (t) => 0.75 + 0.3 * Math.pow(Math.sin(t * Math.PI * 22), 2)),
    ),
  );
  // The laminae: four thin columns on each side, arranged from the back of the dorsal horn
  // to the front. Four stand for "layers numbered from the back forwards", not for a count.
  const laminae: THREE.BufferGeometry[] = [];
  for (const [fx, fz] of [[0.3, -0.6], [0.34, -0.45], [0.37, -0.29], [0.4, -0.12]] as const) {
    for (const s of [1, -1] as const) laminae.push(col(NERVE_TOP, NERVE_BOTTOM, s * fx, fz, 0.04, 20, 5));
  }

  const w = (g: THREE.BufferGeometry) => warpGeometry(g);
  return [
    { id: 'cervical_cord', geometry: w(cervical) },
    { id: 'thoracic_cord', geometry: w(thoracic) },
    { id: 'lumbar_cord', geometry: w(lumbar) },
    { id: 'grey_matter', geometry: w(mergeParts(grey)) },
    { id: 'cauda_equina', geometry: w(mergeParts(cauda)) },
    { id: 'dorsal_roots', geometry: w(mergeParts(dorsal)) },
    { id: 'ventral_roots', geometry: w(mergeParts(ventral)) },
    { id: 'sympathetic_chain', geometry: w(mergeParts(chains)) },
    { id: 'cervical_enlargement', geometry: w(cervicalEnl) },
    { id: 'lumbar_enlargement', geometry: w(lumbarEnl) },
    { id: 'conus_medullaris', geometry: w(conus) },
    { id: 'filum_terminale', geometry: w(filum) },
    { id: 'meninges', geometry: w(meninges) },
    { id: 'dura_mater', geometry: w(dura) },
    { id: 'arachnoid_mater', geometry: w(arachnoid) },
    { id: 'pia_mater', geometry: w(pia) },
    { id: 'denticulate_ligaments', geometry: w(mergeParts(dent)) },
    { id: 'central_canal', geometry: w(canal) },
    { id: 'dorsal_root_ganglia', geometry: w(mergeParts(ganglia)) },
    { id: 'spinal_nerves', geometry: w(mergeParts(nerves)) },
    { id: 'dorsal_rami', geometry: w(mergeParts(dRami)) },
    { id: 'ventral_rami', geometry: w(mergeParts(vRami)) },
    { id: 'dorsal_funiculus', geometry: w(dorsalF) },
    { id: 'lateral_funiculus', geometry: w(lateralF) },
    { id: 'ventral_funiculus', geometry: w(ventralF) },
    { id: 'fasciculus_gracilis', geometry: w(gracilis) },
    { id: 'fasciculus_cuneatus', geometry: w(cuneatus) },
    { id: 'lateral_corticospinal_tract', geometry: w(lcst) },
    { id: 'dorsal_spinocerebellar_tract', geometry: w(dscst) },
    { id: 'ventral_spinocerebellar_tract', geometry: w(vscst) },
    { id: 'spinothalamic_tract', geometry: w(spinothal) },
    { id: 'anterior_corticospinal_tract', geometry: w(acst) },
    { id: 'dorsal_horn', geometry: w(dHorn) },
    { id: 'substantia_gelatinosa', geometry: w(subGel) },
    { id: 'lateral_horn', geometry: w(lHorn) },
    { id: 'ventral_horn_motor_neurons', geometry: w(motor) },
    { id: 'rexed_laminae', geometry: w(mergeParts(laminae)) },
  ];
};
