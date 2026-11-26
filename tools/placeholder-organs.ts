import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import organsFile from '../src/data/organs.json';
import type { OrgansFile } from '../src/data/types';
import { buildPlaceholderGeometry, triangleCount } from '../src/render/organs/placeholder';

/**
 * PLACEHOLDER ORGAN GENERATOR (spec 7.2).
 *
 * "Commit the generator so the app still builds from a clean checkout with no
 *  binary assets."
 *
 * The app does not need this script to run — `src/render/organs/placeholder.ts` is
 * imported directly by the renderer and builds the geometry at load. What this
 * script is for is the BUDGET REPORT: it prints the triangle count of every organ
 * against the budget in spec 7.5, so that when real meshes replace these in Phase 7
 * there is a like-for-like number to compare against.
 *
 *   npm run organs
 */

const FILE = organsFile as unknown as OrgansFile;

/**
 * Triangle budgets.
 *
 * Spec 7.5 budgeted fifteen organs at 140 k triangles in total. The body now has more
 * than twice as many structures, and each is authored anatomy rather than a deformed
 * sphere, so the budgets are restated for what is actually drawn. What they protect is
 * unchanged: the absorption material shows silhouette and nothing else, so triangles
 * beyond what a smooth outline needs buy only load time and memory.
 *
 * The total counts EVERY organ in the data, both sexes' reproductive organs and the
 * fetus included. No body has all of them: a male body draws about 165 k and a
 * non-pregnant female body about the same.
 */
const BUDGET: Record<string, number> = {
  brain: 26000,
  heart: 16000,
  lung_l: 16000,
  lung_r: 16000,
  fetus: 16000,
  uterus: 16000,
  trachea: 11000,
  liver: 11000,
  intestine_small: 9000,
  intestine_large: 9000,
  stomach: 8500,
  testes: 9000,
  // The two limb skeletons are LAYER organs (see LAYER_BUDGET below). Measured at 14,720 and
  // 10,712 triangles, they were reported OVER against the 8,000 single-organ default although
  // the bones layer as a whole sits at 46,500 of its 60,000. The default exists to stop one
  // ordinary organ growing unchecked in the always-built body; a limb skeleton is a long chain
  // of separate bones built only when the Bones layer is on or the organ is selected, so it is
  // judged by the layer total. These per-organ figures are LOAD AND PERFORMANCE CHOICES (a
  // little above what is drawn, so a regression shows), not anatomical numbers, and neither
  // TOTAL_BUDGET nor LAYER_BUDGET was raised to make the report green.
  lower_limb_bones: 16000,
  upper_limb_bones: 12000,
  // The muscles are LAYER organs too (LAYER_BUDGET below), and these figures are PROVISIONAL LOAD
  // AND PERFORMANCE CHOICES set when the seven stub shells were scaffolded (each is well under
  // 1,500 triangles today). They give the three content agents room to draw real muscles: the
  // regions with the most separate muscles (the back, the shoulder and arm, the hip and thigh)
  // get a little more than the 8,000 default, the rest keep the default. Content agents report
  // their counts and these are revised from what is measured, not from anatomy.
  back_muscles: 10000,
  shoulder_arm_muscles: 10000,
  hip_thigh_muscles: 12000,
};
const DEFAULT_BUDGET = 8000;
const TOTAL_BUDGET = 240000;

/**
 * One budget per LAYER (`layer` in organs.json), kept apart from the total above.
 *
 * A layer organ is built only while its layer is on or it is selected (OrganSet), so what it
 * costs is paid by the visitor who asks for it and not by every load. It therefore must not
 * count against TOTAL_BUDGET, which protects the default body's load time. It still has to be
 * bounded, because a layer with everything switched on is a body with its layer's triangles
 * added. The figure is a LOAD AND PERFORMANCE CHOICE, not an anatomical or physiological
 * number: it says how many triangles the bones may add to the screen before frame rate on a
 * phone is put at risk, and it is raised or lowered by measuring that, not by looking up bones.
 */
const LAYER_BUDGET: Record<string, number> = {
  bones: 60000,
  // PROVISIONAL, like the per-organ muscle figures above: the sum of those figures and the 8,000
  // default for the other four organs (4 x 8,000 + 10,000 + 10,000 + 12,000 = 64,000). It says how
  // many triangles the muscles may add to the screen before a phone's frame rate is at risk; with
  // Bones and Muscles both on the two layers add up, so revise this by measuring on a phone with
  // both layers on, not by looking up muscle.
  muscles: 64000,
};

interface Row {
  id: string;
  triangles: number;
  budget: number;
  radius: number;
  centre: [number, number, number];
}

function main(): void {
  const rows: Row[] = [];
  let total = 0;
  const layerTotals = new Map<string, number>();

  for (const def of FILE.organs) {
    const geometry = buildPlaceholderGeometry(def.placeholder);
    geometry.computeBoundingSphere();
    const tris = triangleCount(geometry);
    // Layer organs are counted per layer, never in the default body's total.
    if (def.layer) layerTotals.set(def.layer, (layerTotals.get(def.layer) ?? 0) + tris);
    else total += tris;

    const group = FILE.groupLayout[def.group];
    const sphere = geometry.boundingSphere!;
    rows.push({
      id: def.id,
      triangles: tris,
      budget: BUDGET[def.id] ?? DEFAULT_BUDGET,
      radius: sphere.radius,
      centre: [
        def.position[0] + def.layoutOffset[0] + group.offset[0] + sphere.center.x,
        def.position[1] + def.layoutOffset[1] + group.offset[1] + sphere.center.y,
        def.position[2] + def.layoutOffset[2] + group.offset[2] + sphere.center.z,
      ],
    });
    geometry.dispose();
  }

  process.stdout.write('ORGAN GEOMETRY (all organs in the data, both sexes)\n\n');
  process.stdout.write('  organ              tris    budget   status   radius(m)  centre(m)\n');
  process.stdout.write('  ' + '-'.repeat(74) + '\n');

  let over = 0;
  for (const r of rows.sort((a, b) => b.triangles - a.triangles)) {
    const status = r.triangles > r.budget ? 'OVER' : 'ok';
    if (r.triangles > r.budget) over++;
    process.stdout.write(
      `  ${r.id.padEnd(17)}${String(r.triangles).padStart(6)}${String(r.budget).padStart(10)}` +
        `${status.padStart(8)}   ${r.radius.toFixed(4).padStart(8)}   ` +
        `${r.centre.map((v) => v.toFixed(3).padStart(7)).join(' ')}\n`,
    );
  }

  process.stdout.write('  ' + '-'.repeat(74) + '\n');
  process.stdout.write(`  TOTAL            ${String(total).padStart(6)}${String(TOTAL_BUDGET).padStart(10)}` +
    `${(total > TOTAL_BUDGET ? 'OVER' : 'ok').padStart(8)}\n`);
  if (layerTotals.size > 0) process.stdout.write('  (the total above excludes layer organs, which have a budget of their own:)\n');
  for (const [layer, tris] of layerTotals) {
    const budget = LAYER_BUDGET[layer] ?? 0;
    process.stdout.write(
      `  LAYER ${layer.padEnd(11)}${String(tris).padStart(6)}${String(budget).padStart(10)}` +
        `${(tris > budget ? 'OVER' : 'ok').padStart(8)}\n`,
    );
  }
  process.stdout.write('\n');

  if (over > 0) {
    process.stdout.write(
      `  ${over} organ(s) over budget. Decimate harder before optimising anything else:\n` +
        '  the absorption material has no diffuse or specular term, so surface detail is\n' +
        '  invisible and triangles buy nothing but memory (spec 7.1, 7.5).\n\n',
    );
  }

  // The manifest is the contract Phase 7's real meshes must satisfy: same ids, same
  // pivots, same bounding spheres. Writing it now means the swap can be verified
  // rather than eyeballed.
  const manifest = {
    generatedBy: 'tools/placeholder-organs.ts',
    note:
      'Bounding spheres and centroids of the authored organ shells, in the BODY frame ' +
      '(+x = the patient\'s right; the renderer mirrors x). Anything that replaces a shell ' +
      'must match these within a few millimetres, or the camera focus animation and the ' +
      'sim-driven pulse scaling will be framed on the wrong point.',
    totalTriangles: total,
    organs: rows.map((r) => ({
      id: r.id,
      triangles: r.triangles,
      budget: r.budget,
      boundingRadius_m: Number(r.radius.toFixed(5)),
      worldCentre_m: r.centre.map((v) => Number(v.toFixed(4))),
    })),
  };

  const dir = join(process.cwd(), 'public');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'organ-manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  process.stdout.write('  wrote public/organ-manifest.json\n');
}

main();
