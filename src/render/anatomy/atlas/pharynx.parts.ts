import type { PartBuilder } from '../parts';
import { warpGeometry } from '../layout';
import type { V3 } from '../sdf';
import { rod } from './stub_shared';

/**
 * STUB INTERIOR OF THE PHARYNX, in body coordinates and bent by the same `warpGeometry` as
 * the shell (an axial organ). The three parts are the three consecutive stretches of the
 * shell's own centreline (shells/pharynx.ts): the laryngopharynx from the oesophagus's start
 * up to y 0.381, the oropharynx from there to 0.392 and the nasopharynx from there to the
 * top at 0.4. Each is a straight tube of radius 0.006, inside the shell's 0.0075 to 0.012.
 * Sizes are drawing choices; the content agent replaces this file with the muscles of the
 * wall and the openings.
 */
const P0: V3 = [0.002, 0.37, -0.014];
const P1: V3 = [0.002, 0.381, -0.012];
const P2: V3 = [0.001, 0.392, -0.01];
const P3: V3 = [0, 0.4, -0.008];

export const parts: PartBuilder = () => [
  { id: 'nasopharynx', geometry: warpGeometry(rod([P2, P3], 0.0065, 8, 8)) },
  { id: 'oropharynx', geometry: warpGeometry(rod([P1, P2], 0.0065, 8, 8)) },
  { id: 'laryngopharynx', geometry: warpGeometry(rod([P0, P1], 0.006, 8, 8)) },
];
