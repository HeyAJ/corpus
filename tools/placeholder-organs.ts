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

/** Triangle budgets from spec 7.5. Total scene budget 140 k. */
const BUDGET: Record<string, number> = {
  heart: 15000,
  lung_l: 12000,
  lung_r: 12000,
  brain: 20000,
  liver: 10000,
  intestine_small: 15000,
  intestine_large: 10000,
  stomach: 8000,
};
const DEFAULT_BUDGET = 6000;
const TOTAL_BUDGET = 140000;

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

  for (const def of FILE.organs) {
    const geometry = buildPlaceholderGeometry(def.placeholder);
    geometry.computeBoundingSphere();
    const tris = triangleCount(geometry);
    total += tris;

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

  process.stdout.write('PLACEHOLDER ORGAN GEOMETRY\n\n');
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
    `${(total > TOTAL_BUDGET ? 'OVER' : 'ok').padStart(8)}\n\n`);

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
      'Bounding spheres and centroids of the procedural placeholders. A real mesh from ' +
      'Phase 7 must match these within a few millimetres, or the camera focus animation ' +
      'and the sim-driven pulse scaling will be framed on the wrong point.',
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
