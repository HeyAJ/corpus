import * as THREE from 'three';

/**
 * THE COLOUR BLOOD IS DRAWN IN, INSIDE AN ORGAN.
 *
 * Every interior that carries blood (the heart's two sides, a lung's arteries and veins, a
 * kidney's, a liver's portal and hepatic trees) has to answer the same question: this
 * blood has this oxygen saturation, what colour is it? Each answering it for itself is how
 * a pulmonary artery in the lung ends up a different purple from the right ventricle that
 * fills it. So the answer lives here, once.
 *
 * THE TWO COLOURS ARE THE ATLAS CONVENTION, NOT A PHOTOGRAPH. Real venous blood is dark
 * red, never blue or violet. Anatomy atlases have drawn it blue for as long as they have
 * been printed in colour because the reader needs to tell at a glance which vessels carry
 * blood towards the lungs, and this simulator's vessel overlay already uses the same two
 * colours (render/vascular/VascularSystem.ts). The colour says which blood this is; it does
 * not claim that is what it looks like.
 *
 * THE RAMP IS A DISPLAY CHOICE, AND IT IS ANCHORED TO THE MODEL, NOT TO A TEXTBOOK. Blood
 * is drawn fully in the venous colour at and below RAMP_VENOUS and fully in the arterial
 * colour at and above RAMP_ARTERIAL. The two ends were chosen from what this engine's own
 * resting body reports (mixed venous saturation about 0.72, arterial about 0.97), so that
 * a healthy body shows the two sides of its heart in plainly different colours, and a
 * hypoxaemic one shows its arterial blood sliding towards the venous colour, which is
 * exactly what cyanosis is. They are not physiological constants and nothing in the
 * simulation reads them. (The vessel overlay uses a longer ramp, 0.5 to 1.0, calibrated
 * against its own reference frames; inside an organ, where the two bloods lie side by
 * side, that ramp left them too alike to tell apart.)
 */

/** Hex of fully oxygenated blood, for a FlowSpec's `color`. */
export const OXYGENATED = 0xc8323a;
/** Hex of deoxygenated blood, for a FlowSpec's `color`. */
export const DEOXYGENATED = 0x6a4a7a;

const OXY = new THREE.Color(OXYGENATED);
const DEOXY = new THREE.Color(DEOXYGENATED);

/** Saturation drawn fully in the venous colour. A display anchor; see the header. */
const RAMP_VENOUS = 0.65;
/** Saturation drawn fully in the arterial colour. A display anchor; see the header. */
const RAMP_ARTERIAL = 0.95;

/** Write the colour of blood at this saturation (0..1) into `out` and return it. */
export function bloodColour(out: THREE.Color, saturation: number): THREE.Color {
  const s = Number.isFinite(saturation) ? saturation : RAMP_ARTERIAL;
  const t = (s - RAMP_VENOUS) / (RAMP_ARTERIAL - RAMP_VENOUS);
  return out.copy(DEOXY).lerp(OXY, t < 0 ? 0 : t > 1 ? 1 : t);
}
