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
function lineTube(y0: number, y1: number, fx: number, fz: number, radiusFraction: number, taperEnd = 0): THREE.BufferGeometry {
  const n = Math.max(8, Math.round(Math.abs(y1 - y0) / 0.004));
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
  const ext = ganglion ? 0.0022 : 0.0018;
  const p0: V3 = [c.x + side * startX * r, y, c.z + startZ * r];
  const p1: V3 = [c.x + side * (r * 0.9 + ext * 0.35), y - 0.0006, c.z + (startZ + endZ) * 0.5 * r];
  const p2: V3 = [c.x + side * (r * endX + ext), y - 0.0016, c.z + endZ * r];
  return tubeAlong(
    [p0, p1, p2],
    (t) => (ganglion ? 0.00035 + 0.0006 * Math.exp(-Math.pow((t - 0.92) / 0.14, 2)) : 0.00035),
    { tubular: 10, radial: 6 },
  );
}

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
    grey.push(lineTube(TOP_Y - 0.004, CONUS_Y + 0.004, fx, fz, radiusFraction, 0.1));
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
      pts.push([c.x + side * (r + 0.0018), y, c.z + 0.0008]);
    }
    chains.push(
      tubeAlong(
        pts,
        (_t, p) => {
          const phase = ((chainTop - p.y) / spacing) % 1;
          return 0.00028 + 0.0006 * Math.exp(-Math.pow((phase - 0.5) / 0.2, 2));
        },
        { tubular: 160, radial: 6 },
      ),
    );
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
  ];
};
