import * as THREE from 'three';
import type { DetailContext, FlowSpec, OrganDetailSpec } from '../detail/types';
import type { SimSnapshot } from '../../../bridge/types';
import { DEOXYGENATED, OXYGENATED, bloodColour } from '../detail/blood';
import type { V3 } from '../sdf';
import { arteryPath, efferentPath, epididymisPoints, retePath, tubulePath, vasPath, veinPath } from './testes.parts';

/**
 * THE TESTES' INTERIOR IN MOTION.
 *
 * Six streams, one pair for each testis (the patient's right and left):
 *
 *   - ARTERIAL BLOOD IN. Down the spermatic cord along the testicular artery and into the
 *     mediastinum, coloured from `transport.arterialSat`.
 *   - VENOUS BLOOD OUT. From the mediastinum up through one vein of the pampiniform plexus,
 *     coloured from `transport.venousSat`.
 *   - SPERM. A slow stream that starts in a seminiferous tubule, passes through the rete
 *     testis and an efferent ductule, winds through the whole epididymis and goes on up the
 *     vas deferens. It runs slowly (the passage through the epididymis really takes days;
 *     the speed is a drawing choice, not a measurement) and runs faster, as the muscle of the
 *     duct contracts, while `reproductive.sexual.orgasm` is above zero.
 *
 * GLOW. The interstitial cells glow with the `testosterone` hormone's receptor-level
 * `activity` from `endocrine.hormones`; if the hormone is missing from the snapshot the
 * glow the atlas data gives (the activity drive) is left as it is.
 *
 * GLASS. The capsule and lobules, which enclose the rest, are drawn as glass with an opacity
 * that follows their own activity; the ducts and vessels that carry streams are glass too,
 * so the particles in them show. The seminiferous tubules are drawn semi-transparent for the
 * same reason, and the interstitial cells stay solid, as the things a viewer taps.
 */

const SPERM_COLOUR = 0xe8e0c0;
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

const arterialSat = (s: SimSnapshot): number => s.transport.arterialSat;
const venousSat = (s: SimSnapshot): number => s.transport.venousSat;
const orgasmOf = (s: SimSnapshot): number => s.reproductive.sexual.orgasm;

const scratch = new THREE.Color();

function testosteroneActivity(snapshot: SimSnapshot): number {
  const hs = snapshot.endocrine.hormones;
  for (let i = 0; i < hs.length; i++) if (hs[i].id === 'testosterone') return hs[i].activity;
  return -1;
}

/** The path a sperm takes on one side: tubule, rete, efferent ductule, epididymis, vas. */
function spermRoute(s: number): V3[] {
  const rete = retePath(s);
  return [...tubulePath(s, 2), rete[1], rete[2], ...efferentPath(s, 2), ...epididymisPoints(s), ...vasPath(s).slice(1)];
}

const DUCTS = ['rete_testis', 'efferent_ductules', 'epididymis_head', 'epididymis_body', 'epididymis_tail', 'vas_deferens'];

const SIDES: { s: number; tag: string }[] = [
  { s: 1, tag: 'r' },
  { s: -1, tag: 'l' },
];

export const detail: OrganDetailSpec = {
  flows: () => {
    const out: FlowSpec[] = [];
    for (const { s, tag } of SIDES) {
      out.push({ id: `artery_${tag}`, path: arteryPath(s), count: 36, size: 0.0008, color: OXYGENATED, speed: 0.014, spread: 0.0002 });
      out.push({ id: `vein_${tag}`, path: veinPath(s, 0), count: 30, size: 0.0008, color: DEOXYGENATED, speed: 0.01, spread: 0.0002 });
      out.push({ id: `sperm_${tag}`, path: spermRoute(s), count: 80, size: 0.0007, color: SPERM_COLOUR, speed: 0.006, spread: 0.0002 });
    }
    return out;
  },

  animate: (ctx: DetailContext) => {
    // Glass walls: the capsule and lobules vivid with their own activity.
    ctx.part('tunica_albuginea')?.setOpacity(0.2 + 0.25 * ctx.activity('tunica_albuginea'));
    ctx.part('lobules')?.setOpacity(0.2 + 0.2 * ctx.activity('lobules'));
    ctx.part('seminiferous_tubules')?.setOpacity(0.55);
    // Ducts and vessels that carry a stream.
    for (let i = 0; i < DUCTS.length; i++) ctx.part(DUCTS[i])?.setOpacity(0.4);
    ctx.part('testicular_artery')?.setOpacity(0.45);
    ctx.part('pampiniform_plexus')?.setOpacity(0.45);

    // The interstitial cells glow with testosterone.
    const t = testosteroneActivity(ctx.snapshot);
    if (t >= 0) ctx.part('interstitial_cells')?.setGlow(clamp01(0.15 + 0.85 * t));

    // Blood colours from the live saturations: never a ramp of our own.
    const artSat = ctx.lerp(arterialSat);
    const venSat = ctx.lerp(venousSat);
    ctx.part('testicular_artery')?.setColor(bloodColour(scratch, artSat));
    for (const { tag } of SIDES) ctx.flow(`artery_${tag}`)?.setColor(bloodColour(scratch, artSat));
    ctx.part('pampiniform_plexus')?.setColor(bloodColour(scratch, venSat));
    for (const { tag } of SIDES) ctx.flow(`vein_${tag}`)?.setColor(bloodColour(scratch, venSat));

    // Sperm move slowly, and faster while the ducts contract at orgasm.
    const orgasm = clamp01(ctx.lerp(orgasmOf));
    for (const { tag } of SIDES) {
      const f = ctx.flow(`sperm_${tag}`);
      f?.setRate(0.4 + 2.5 * orgasm);
      f?.setDensity(1);
    }
  },
};
