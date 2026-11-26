import type { OrganDetailSpec } from '../detail/types';

/**
 * NO STREAMS AND NO MOTION, ON PURPOSE. Hearing and balance are not simulated: the engine
 * has no sound and no head movement. A basilar membrane that rippled, a cupula that bent or
 * an ossicle chain that rocked would show a function that is not happening, so every part
 * here is still. The only live thing is the existing vertigo signal on the vestibular
 * apparatus, which the defaults already turn into glow.
 *
 * GLASS. Anything that wraps or contains another part is drawn as glass so its contents can be
 * seen: the canal, the cavity and recess, the mastoid spaces, the cochlear tube and the
 * three scalae, the vestibule and its sacs, the semicircular canals and their ampullae, the
 * auditory tube, the internal meatus, the bony canal of the facial nerve, and the membranes.
 * The values are display choices tuned so the nesting stays readable, not measured transparency.
 */
const GLASS: Readonly<Record<string, number>> = {
  external_canal: 0.16,
  cartilaginous_meatus: 0.35,
  bony_meatus: 0.35,
  tympanic_membrane: 0.32,
  pars_tensa: 0.45,
  pars_flaccida: 0.5,
  middle_ear: 0.05,
  tympanic_cavity: 0.14,
  epitympanic_recess: 0.18,
  mastoid_antrum: 0.2,
  mastoid_air_cells: 0.28,
  pharyngotympanic_tube: 0.22,
  facial_nerve_canal: 0.25,
  oval_window: 0.5,
  round_window: 0.5,
  vestibular_apparatus: 0.06,
  vestibule: 0.16,
  utricle: 0.3,
  saccule: 0.3,
  maculae: 0.5,
  otolithic_membrane: 0.4,
  anterior_semicircular_canal: 0.25,
  posterior_semicircular_canal: 0.25,
  lateral_semicircular_canal: 0.25,
  anterior_ampulla: 0.35,
  posterior_ampulla: 0.35,
  lateral_ampulla: 0.35,
  anterior_cupula: 0.5,
  posterior_cupula: 0.5,
  lateral_cupula: 0.5,
  cochlea: 0.12,
  scala_vestibuli: 0.35,
  cochlear_duct: 0.35,
  scala_tympani: 0.35,
  vestibular_membrane: 0.45,
  basilar_membrane: 0.5,
  tectorial_membrane: 0.45,
  internal_acoustic_meatus: 0.2,
  vestibulocochlear_nerve: 0.5,
  endolymphatic_duct_and_sac: 0.4,
};

export const detail: OrganDetailSpec = {
  animate: (ctx) => {
    for (const id of Object.keys(GLASS)) ctx.part(id)?.setOpacity(GLASS[id]);
  },
};
