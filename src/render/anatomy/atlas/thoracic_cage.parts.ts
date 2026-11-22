import type { PartBuilder } from '../parts';
import { mergeParts, type V3 } from '../sdf';
import { bothSides, ringAt, rod } from './stub_shared';

/**
 * STUB INTERIOR OF THE RIB CAGE, in the organ's own frame (origin organs.json [0, 0.2, 0];
 * shells/thoracic_cage.ts has six rib loops and a sternum). The shell's loops are reproduced
 * here at 80 % of their tube radius: the upper three are the "true ribs", the lower three the
 * "false and floating ribs". Costal cartilages are short rods from the front of the upper loops
 * to the sternum. Spacing and sizes are drawing choices; the content agent replaces this file
 * with twelve ribs a side and real cartilages.
 */
const LEVELS = [0.115, 0.075, 0.035, -0.005, -0.045, -0.085];
const loopSize = (i: number): [number, number] => {
  const t = i / (LEVELS.length - 1);
  return [0.1 + 0.04 * Math.sin(Math.min(1, t * 1.4) * Math.PI * 0.5), 0.07 + 0.02 * t];
};

export const parts: PartBuilder = () => {
  const loops = (from: number, to: number) =>
    mergeParts(
      LEVELS.slice(from, to).map((y, k) => {
        const [hx, hz] = loopSize(from + k);
        return ringAt(y, hx, hz, 0.0028);
      }),
    );
  const sternum: V3[] = [
    [0, 0.125, 0.074],
    [0, 0.03, 0.09],
    [0, -0.05, 0.092],
  ];
  const cartilages = mergeParts(
    bothSides((s) => [0.115, 0.075, 0.035, -0.005].map((y) => rod([[s * 0.012, y, 0.088], [s * 0.045, y, 0.08]], 0.0025, 4, 4))),
  );
  return [
    { id: 'sternum', geometry: rod(sternum, 0.0055, 10, 6) },
    { id: 'true_ribs', geometry: loops(0, 3) },
    { id: 'false_and_floating_ribs', geometry: loops(3, 6) },
    { id: 'costal_cartilages', geometry: cartilages },
  ];
};
