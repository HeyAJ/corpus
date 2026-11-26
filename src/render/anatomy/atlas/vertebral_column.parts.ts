import * as THREE from 'three';
import type { PartBuilder, PartGeometry } from '../parts';
import { warpOffsetY } from '../layout';
import {
  COCCYX_BOTTOM,
  COLUMN_LEVELS,
  SACRUM_BOTTOM,
  SACRUM_TOP,
  axisZ,
  bodyFaces,
  coccyxField,
  discSpec,
  placement,
  sacrumField,
  shapeOf,
  vertebraBox,
  vertebraParts,
  type Level,
} from '../shells/vertebral_column';
import { ellipsoid, intersect, mergeParts, polygonise, tubeAlong, type Sdf, type V3 } from '../sdf';

/**
 * INTERIOR PARTS OF THE VERTEBRAL COLUMN (atlas `vertebral_column`), in body coordinates, the
 * frame of the shell (shells/vertebral_column.ts, which says how the vertebrae are placed: each
 * rigid, tilted to the cord's tangent, and the discs open the exploded gaps).
 *
 * LEVELS. One mesh per vertebra is built once (`mesh(level, cell)`) and used for the region parts
 * (all seven cervical in one part, and so on) and for each vertebra as a child of its region. The
 * region parts are coarser than the single vertebrae they contain, because a parent is drawn as
 * glass behind its children and the budget counts both.
 *
 * ILLUSTRATIVE: the "typical vertebra" is a thoracic-shaped vertebra drawn twice life size and
 * moved out to the patient's right, in front of the column, so that its body, pedicles, laminae and
 * processes can be told apart; it is not a vertebra of the column. The costal facets, the
 * intervertebral foramina, the ligaments and the curvature guides are markers and ribbons, thinner
 * or thicker than the real structures; the discs are plain elliptical cylinders (an annulus, a
 * nucleus and two end plates inside each) without the wedge a lordosis gives them. Nothing here is
 * a measured size.
 *
 * RED MARROW is a core drawn inside each vertebral body from the axis down: the cited textbook
 * (Guyton and Hall) names the vertebrae among the membranous bones that make red cells in the
 * adult; the atlas has no body and the sacrum is not named, so neither is drawn with marrow.
 */

const CELL_PART = 0.0042;
const CELL_REGION = 0.0052;

const L = COLUMN_LEVELS;
const byName = (n: string): Level => L.find((l) => l.name === n)!;

function blob(c: V3, r: V3, w = 8, h = 6): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, w, h);
  g.deleteAttribute('uv');
  g.scale(r[0], r[1], r[2]);
  g.translate(c[0], c[1], c[2]);
  return g;
}

/** A point in a vertebra's own frame, placed in the exploded body. */
function at(level: Level, p: V3): V3 {
  const v = new THREE.Vector3(p[0], p[1], p[2]).applyMatrix4(placement(level));
  return [v.x, v.y, v.z];
}

function rod(pts: readonly V3[], r: number, tubular = 14, radial = 5): THREE.BufferGeometry {
  return tubeAlong(pts, () => r, { tubular, radial });
}

function fieldMesh(field: Sdf, box: { min: V3; max: V3 }, cell: number, m?: THREE.Matrix4): THREE.BufferGeometry | null {
  const g = polygonise(field, box.min, box.max, { cell });
  if (!g.index || g.index.count === 0) {
    g.dispose();
    return null;
  }
  if (m) g.applyMatrix4(m);
  return g;
}

function vert(level: Level, pick: (p: ReturnType<typeof vertebraParts>) => Sdf, cell: number, grow = 0): THREE.BufferGeometry | null {
  const p = vertebraParts(level);
  const f = pick(p);
  return fieldMesh(grow ? (x, y, z) => f(x, y, z) - grow : f, vertebraBox(level), cell, placement(level));
}

function merge(list: (THREE.BufferGeometry | null)[], at0: V3): THREE.BufferGeometry {
  const g = list.filter((x): x is THREE.BufferGeometry => x !== null);
  return g.length ? mergeParts(g) : blob(at0, [0.002, 0.002, 0.002], 6, 4);
}

/** The enlarged typical vertebra: a thoracic shape at 2.4 times, on the patient's right behind the lung. */
const TV_SCALE = 2;
const TV_CENTRE: V3 = [0.065, 0.2, -0.015];
const TV_LEVEL: Level = byName('T6');

function typical(pick: (p: ReturnType<typeof vertebraParts>) => Sdf): THREE.BufferGeometry | null {
  const p = vertebraParts(TV_LEVEL);
  const f = pick(p);
  const box = vertebraBox(TV_LEVEL);
  const g = polygonise(f, box.min, box.max, { cell: CELL_PART / 1.5 });
  if (!g.index || g.index.count === 0) return null;
  g.scale(TV_SCALE, TV_SCALE, TV_SCALE);
  g.translate(TV_CENTRE[0], TV_CENTRE[1], TV_CENTRE[2]);
  return g;
}

export const parts: PartBuilder = () => {
  const out: PartGeometry[] = [];
  const push = (id: string, g: THREE.BufferGeometry): void => {
    out.push({ id, geometry: g });
  };
  const cache = new Map<string, THREE.BufferGeometry>();
  const mesh = (l: Level, cell: number): THREE.BufferGeometry => {
    const key = `${l.name}:${cell}`;
    let g = cache.get(key);
    if (!g) {
      g = vert(l, (p) => p.whole, cell) ?? blob([0, l.y, 0], [0.01, 0.01, 0.01]);
      cache.set(key, g);
    }
    return g.clone();
  };
  const cerv = L.filter((l) => l.kind === 'atlas' || l.kind === 'axis' || l.kind === 'cervical');
  const thor = L.filter((l) => l.kind === 'thoracic');
  const lumb = L.filter((l) => l.kind === 'lumbar');

  /* ---- regions and single vertebrae ------------------------------------------------------ */
  push('cervical_vertebrae', mergeParts(cerv.map((l) => mesh(l, CELL_REGION))));
  push('thoracic_vertebrae', mergeParts(thor.map((l) => mesh(l, CELL_REGION))));
  push('lumbar_vertebrae', mergeParts(lumb.map((l) => mesh(l, CELL_REGION))));
  push('atlas_c1', mesh(byName('C1'), CELL_PART));
  push('axis_c2', mesh(byName('C2'), CELL_PART));
  push('typical_cervical_vertebrae', mergeParts(['C3', 'C4', 'C5', 'C6'].map((n) => mesh(byName(n), CELL_PART))));
  push('vertebra_prominens', mesh(byName('C7'), CELL_PART));
  for (const l of thor) push(l.id, mesh(l, CELL_PART));
  for (const l of lumb) push(l.id, mesh(l, CELL_PART));

  /* ---- the atlas's parts, the axis's dens, the cervical vertebrae's features ----------------- */
  {
    const c1 = byName('C1');
    const s1 = shapeOf(c1);
    const a = s1.canalR + s1.archR + 0.0006;
    const whole = vertebraParts(c1).whole;
    const box = vertebraBox(c1);
    const place = placement(c1);
    // The atlas has no body: a front arch, a back arch and a lump of bone at each side (the lateral mass), cut from its one ring by position.
    push('anterior_arch_atlas', merge([fieldMesh((x, y, z) => Math.max(whole(x, y, z), 0.0105 - z), box, CELL_PART * 0.7, place)], at(c1, [0, 0, 0.014])));
    push('posterior_arch_atlas', merge([fieldMesh((x, y, z) => Math.max(whole(x, y, z), z + 0.0105, Math.abs(x) - 0.011), box, CELL_PART, place)], at(c1, [0, 0, -0.014])));
    push('lateral_masses_atlas', merge([fieldMesh((x, y, z) => Math.max(whole(x, y, z), 0.011 - Math.abs(x), Math.abs(z) - 0.0105, Math.abs(x) - a - 0.004), box, CELL_PART * 0.8, place)], at(c1, [a, 0, 0])));
    // The dens: a peg rising from the body of the axis into the front of the atlas's ring.
    const c2 = byName('C2');
    const s2 = shapeOf(c2);
    const dens = ellipsoid([0, c2.h / 2 + 0.003, s2.bodyZ - 0.001 + 0.0], [0.0042, 0.0085, 0.0042]);
    push('dens', merge([fieldMesh(dens, { min: [-0.008, c2.h / 2 - 0.007, s2.bodyZ - 0.008], max: [0.008, c2.h / 2 + 0.016, s2.bodyZ + 0.008] }, CELL_PART * 0.6, placement(c2))], at(c2, [0, 0.012, 0.01])));
    // Transverse foramina and the forked spinous tips of C3 to C6, as the vertebra pieces.
    const t: (THREE.BufferGeometry | null)[] = [];
    const sp: (THREE.BufferGeometry | null)[] = [];
    for (const n of ['C3', 'C4', 'C5', 'C6']) {
      const l = byName(n);
      const sh = shapeOf(l);
      const aa = sh.canalR + sh.archR + 0.0006;
      for (const sd of [1, -1]) {
        const g = new THREE.TorusGeometry(0.0028, 0.0008, 5, 10);
        g.deleteAttribute('uv');
        g.rotateX(Math.PI / 2);
        const [x, y, z] = at(l, [sd * (aa + 0.006), 0, 0]);
        g.translate(x, y, z);
        t.push(g);
      }
      sp.push(vert(l, (p) => p.spinous, CELL_PART * 0.8));
    }
    push('transverse_foramina', merge(t, at(byName('C4'), [0.015, 0, 0])));
    push('bifid_spinous_processes', merge(sp, at(byName('C4'), [0, 0, -0.025])));
  }

  /* ---- costal facets: where the ribs' heads and tubercles meet the thoracic vertebrae ----- */
  {
    const gs: THREE.BufferGeometry[] = [];
    for (const l of thor) {
      const sh = shapeOf(l);
      const a = sh.canalR + sh.archR + 0.0006;
      const n = Number(l.name.slice(1));
      for (const sd of [1, -1]) {
        // The facet on the side of the body, at its back corner: where a rib's head rests.
        gs.push(blob(at(l, [sd * sh.hw, n >= 10 ? 0 : sh.hh * 0.55, sh.bodyZ - sh.hd * 0.45]), [0.0016, 0.0035, 0.0035], 6, 4));
        if (n >= 2 && n <= 9) gs.push(blob(at(l, [sd * sh.hw, -sh.hh * 0.55, sh.bodyZ - sh.hd * 0.45]), [0.0016, 0.0035, 0.0035], 6, 4));
        // The facet on the front of the tip of the transverse process (the first ten): the rib's tubercle.
        if (n <= 10) gs.push(blob(at(l, [sd * (a + 0.015), 0, -0.002]), [0.0028, 0.0028, 0.0017], 6, 4));
      }
    }
    push('costal_facets', mergeParts(gs));
  }

  /* ---- sacrum and its parts, coccyx -------------------------------------------------------- */
  {
    const sac = sacrumField();
    const shift = warpOffsetY((SACRUM_TOP + SACRUM_BOTTOM) / 2);
    const box = { min: [-0.045, SACRUM_BOTTOM - 0.004, -0.08] as V3, max: [0.045, SACRUM_TOP + 0.004, 0.03] as V3 };
    const place = new THREE.Matrix4().makeTranslation(0, shift, 0);
    const sacrum = fieldMesh(sac, box, 0.0052, place);
    push('sacrum', merge([sacrum], [0, SACRUM_TOP, 0]));
    const proud = (f: Sdf): Sdf => (x, y, z) => f(x, y, z) - 0.0004;
    const top = SACRUM_TOP;
    const zT = axisZ(top);
    push(
      'sacral_promontory',
      merge(
        [fieldMesh(intersect(proud(sac), (x, y, z) => Math.hypot((x) / 0.017, (y - (top - 0.003)) / 0.0075, (z - (zT + 0.0255)) / 0.01) - 1), box, 0.0032, place)],
        [0, top, zT + 0.025],
      ),
    );
    push(
      'sacral_ala',
      merge([fieldMesh(intersect(proud(sac), (x, y) => Math.min(0.0165 - Math.abs(x), y - (top - 0.034))), box, 0.0042, place)], [0.027, top - 0.014, zT]),
    );
    // The auricular surface: the roughened patch on the outer face of each ala, where the hip bone meets the sacrum.
    push(
      'auricular_surface',
      merge(
        [1, -1].map((s) => {
          const g = blob([s * 0.0385, top - 0.0165 + shift, zT + 0.0042], [0.0012, 0.0115, 0.0095], 8, 6);
          return g;
        }),
        [0.038, top, zT],
      ),
    );
    // The sacral foramina: a ring at the front of each of the four pairs of openings.
    const rings: THREE.BufferGeometry[] = [];
    for (let k = 1; k <= 4; k++) {
      const y = top - (k / 5) * (top - SACRUM_BOTTOM);
      for (const s of [1, -1]) {
        const t = new THREE.TorusGeometry(0.0024, 0.0007, 5, 10);
        t.deleteAttribute('uv');
        t.translate(s * 0.0125, y + shift, axisZ(y) + 0.0225 - 0.007 * (k / 5));
        rings.push(t);
      }
    }
    push('sacral_foramina', mergeParts(rings));
    // The canal: the continuation of the vertebral canal down the sacrum, a thin glass tube along the axis.
    const axis: V3[] = [];
    for (let i = 0; i <= 8; i++) {
      const y = top - (i / 8) * (top - SACRUM_BOTTOM + 0.02);
      axis.push([0, y + shift, axisZ(y)]);
    }
    push('sacral_canal', tubeAlong(axis, (t) => 0.0058 - 0.0032 * t, { tubular: 16, radial: 8 }));
    // The hiatus: the opening at the lower end of the canal, drawn as a small ring on the back.
    const hy = SACRUM_BOTTOM + 0.004;
    const hr = new THREE.TorusGeometry(0.0042, 0.0009, 5, 12);
    hr.deleteAttribute('uv');
    hr.translate(0, hy + shift, axisZ(hy) - 0.0105);
    push('sacral_hiatus', hr);

    const cox = fieldMesh(coccyxField(), { min: [-0.015, COCCYX_BOTTOM - 0.004, -0.07], max: [0.015, SACRUM_BOTTOM + 0.002, 0.0] }, 0.0034, new THREE.Matrix4().makeTranslation(0, warpOffsetY(SACRUM_BOTTOM - 0.01), 0));
    push('coccyx', merge([cox], [0, COCCYX_BOTTOM, 0]));
  }

  /* ---- discs: an annulus, a nucleus and two end plates in each --------------------------------- */
  {
    const ann: THREE.BufferGeometry[] = [];
    const nuc: THREE.BufferGeometry[] = [];
    const end: THREE.BufferGeometry[] = [];
    for (let i = 1; i < L.length - 1; i++) {
      const d = discSpec(L[i], L[i + 1]);
      const h = Math.max(0.0008, d.yTop - d.yBot);
      const c = new THREE.CylinderGeometry(1, 1, h, 18, 1, false);
      c.deleteAttribute('uv');
      c.scale(d.hw, 1, d.hd);
      c.translate(0, (d.yTop + d.yBot) / 2, d.zc);
      ann.push(c);
      // the nucleus sits a little behind the middle of the disc
      nuc.push(blob([0, (d.yTop + d.yBot) / 2, d.zc - d.hd * 0.12], [d.hw * 0.45, h * 0.4, d.hd * 0.45], 8, 5));
      for (const [y, s] of [[d.yTop - 0.0004, 1], [d.yBot + 0.0004, -1]] as const) {
        void s;
        const p = new THREE.CylinderGeometry(1, 1, 0.0007, 12, 1, false);
        p.deleteAttribute('uv');
        p.scale(d.hw * 0.97, 1, d.hd * 0.97);
        p.translate(0, y, d.zc);
        end.push(p);
      }
    }
    push('intervertebral_discs', mergeParts(ann.map((g) => g.clone())));
    push('annulus_fibrosus', mergeParts(ann));
    push('nucleus_pulposus', mergeParts(nuc));
    push('vertebral_end_plates', mergeParts(end));
  }

  /* ---- foramina between the vertebrae, curvature guides, ligaments ---------------------------- */
  {
    const fs: THREE.BufferGeometry[] = [];
    for (let i = 1; i < L.length - 1; i++) {
      const d = discSpec(L[i], L[i + 1]);
      const sh = shapeOf(L[i + 1]);
      const yc = (d.yTop + d.yBot) / 2;
      for (const s of [1, -1]) {
        const t = new THREE.TorusGeometry(0.0034, 0.0008, 4, 7);
        t.deleteAttribute('uv');
        t.rotateY(Math.PI / 2);
        t.translate(s * (sh.canalR + sh.archR + 0.004), yc, d.zc - d.hd - 0.002);
        fs.push(t);
      }
    }
    push('intervertebral_foramina', mergeParts(fs));

    const bodyLine = (levels: Level[], dz: number): V3[] => levels.map((l) => at(l, [0, 0, shapeOf(l).bodyZ + shapeOf(l).hd + dz]));
    const guide = (levels: Level[]): THREE.BufferGeometry => rod(bodyLine(levels, 0.004), 0.0016, 24, 6);
    push('cervical_lordosis', guide(cerv));
    push('thoracic_kyphosis', guide(thor));
    push('lumbar_lordosis', guide(lumb));
    const sk = [SACRUM_TOP - 0.004, (SACRUM_TOP + SACRUM_BOTTOM) / 2, SACRUM_BOTTOM, COCCYX_BOTTOM + 0.006].map((y): V3 => [0, y + warpOffsetY(y), axisZ(y) + 0.0275 - 0.006 * ((SACRUM_TOP - y) / 0.12)]);
    push('sacral_kyphosis', rod(sk, 0.0016, 12, 6));

    // Longitudinal ligaments: bands down the front of the bodies and down the back of them (the front of the canal).
    const front = L.slice(1).map((l) => at(l, [0, 0, shapeOf(l).bodyZ + shapeOf(l).hd + 0.0006]));
    const back = L.slice(1).map((l) => at(l, [0, 0, shapeOf(l).canalR + 0.0006]));
    push('anterior_longitudinal_ligament', rod(front, 0.0013, 40, 6));
    push('posterior_longitudinal_ligament', rod(back, 0.0011, 40, 6));

    // Ligamenta flava: a pair of small pads between the laminae of each pair of neighbouring vertebrae.
    const fl: THREE.BufferGeometry[] = [];
    const isp: THREE.BufferGeometry[] = [];
    const tips: V3[] = [];
    for (let i = 1; i < L.length; i++) {
      const lv = L[i];
      const sh = shapeOf(lv);
      const aa = sh.canalR + sh.archR + 0.0006;
      const tip = at(lv, [0, -sh.spineDrop, -(aa + sh.archR + sh.spineLen)]);
      tips.push(tip);
      if (i < L.length - 1) {
        const d = discSpec(lv, L[i + 1]);
        const yc = (d.yTop + d.yBot) / 2;
        const z = axisZ((lv.y + L[i + 1].y) / 2);
        for (const s of [1, -1]) fl.push(blob([s * 0.0042, yc, z - (sh.canalR + 0.0035)], [0.0034, Math.max(0.0012, (d.yTop - d.yBot) * 0.6), 0.0012], 6, 4));
        const nx = at(L[i + 1], [0, -shapeOf(L[i + 1]).spineDrop, -(aa + sh.archR + shapeOf(L[i + 1]).spineLen)]);
        isp.push(rod([tip, nx], 0.0011, 4, 4));
      }
    }
    push('ligamenta_flava', mergeParts(fl));
    push('interspinous_ligaments', mergeParts(isp));
    push('supraspinous_ligament', rod(tips.slice(5), 0.0012, 40, 5));
    // The nuchal ligament: a sheet from the back of the occipital bone down the neck to the spine of C7.
    const c7 = tips[5];
    const top: V3 = [0, 0.405, -0.0905];
    const mid: V3 = [0, 0.36, tips[1][2] - 0.002];
    const sheet = tubeAlong([top, mid, c7], () => 0.0013, { tubular: 14, radial: 4 });
    sheet.scale(7, 1, 1);
    // scaled about x = 0 (the sheet lies on the midline), so it is a thin blade, wide side to side
    push('nuchal_ligament', sheet);
  }

  /* ---- red bone marrow: a core inside each vertebral body ----------------------------------------- */
  {
    const ms: THREE.BufferGeometry[] = [];
    for (const l of L) {
      if (l.kind === 'atlas') continue;
      const sh = shapeOf(l);
      const [x, y, z] = at(l, [0, 0, sh.bodyZ]);
      const g = blob([0, 0, 0], [sh.hw * 0.62, sh.hh * 0.7, Math.max(0.0015, sh.hd * 0.62)], 8, 5);
      g.applyMatrix4(placement(l).clone().setPosition(x, y, z));
      ms.push(g);
    }
    push('red_bone_marrow', mergeParts(ms));
  }

  /* ---- the enlarged typical vertebra and its parts ------------------------------------------------ */
  {
    const tv = (id: string, pick: (p: ReturnType<typeof vertebraParts>) => Sdf): void => push(id, merge([typical(pick)], TV_CENTRE));
    tv('typical_vertebra', (p) => p.whole);
    tv('tv_body', (p) => p.body);
    tv('tv_pedicles', (p) => p.pedicles);
    tv('tv_laminae', (p) => p.laminae);
    tv('tv_spinous_process', (p) => p.spinous);
    tv('tv_transverse_processes', (p) => p.transverse);
    tv('tv_superior_articular_processes', (p) => p.superior);
    tv('tv_inferior_articular_processes', (p) => p.inferior);
    // The vertebral foramen: a thin ring round the lumen, at the same enlargement.
    const s = shapeOf(TV_LEVEL);
    const ring = new THREE.TorusGeometry(s.canalR * TV_SCALE, 0.0012, 5, 20);
    ring.deleteAttribute('uv');
    ring.rotateX(Math.PI / 2);
    ring.translate(TV_CENTRE[0], TV_CENTRE[1], TV_CENTRE[2]);
    push('tv_vertebral_foramen', ring);
  }

  void bodyFaces;
  return out;
};
