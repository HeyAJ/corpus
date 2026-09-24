import type { SimState } from '../core/state';

/**
 * WHAT THE BODY IS FIGHTING: PATHOGENS.
 *
 * SCAFFOLD. The state shape, the tick hook and the intent plumbing are in place; the
 * physiology is not yet. This function is deliberately a no-op rather than a guess:
 * this project treats a silent wrong number as worse than an honest absent one, and a
 * half-invented infection model would be exactly that.
 *
 * What belongs here: a viral or bacterial load with its own growth and clearance, an
 * incubation period before anything is felt, an immune response that itself causes much
 * of the illness, and organ-specific consequences - respiratory for COVID, progressive
 * CD4 depletion for HIV. Pathogen data belongs in `src/data/pathogens.json` with a
 * citation per number, exactly as drugs and physiology constants do.
 *
 * Everything this subsystem does must reach the body through the EFFECT BUS
 * (`addEffect` in `core/effects.ts`), never by writing another system's state directly.
 * That is what lets it compose with drugs and hormones instead of fighting them.
 */
export function stepInfection(s: SimState, dt: number): void {
  void s;
  void dt;
}
