import type { OrganDetailSpec } from '../detail/types';
import { detail as brain } from './brain.detail';
import { detail as eyes } from './eyes.detail';
import { detail as spinalCord } from './spinal_cord.detail';
import { detail as thyroid } from './thyroid.detail';
import { detail as thymus } from './thymus.detail';
import { detail as heart } from './heart.detail';
import { detail as lungL } from './lung_l.detail';
import { detail as lungR } from './lung_r.detail';
import { detail as trachea } from './trachea.detail';
import { detail as diaphragm } from './diaphragm.detail';
import { detail as oesophagus } from './oesophagus.detail';
import { detail as liver } from './liver.detail';
import { detail as gallbladder } from './gallbladder.detail';
import { detail as stomach } from './stomach.detail';
import { detail as pancreas } from './pancreas.detail';
import { detail as spleen } from './spleen.detail';
import { detail as adrenal } from './adrenal.detail';
import { detail as kidney } from './kidney.detail';
import { detail as ureters } from './ureters.detail';
import { detail as intestineSmall } from './intestine_small.detail';
import { detail as intestineLarge } from './intestine_large.detail';
import { detail as bladder } from './bladder.detail';
import { detail as prostate } from './prostate.detail';
import { detail as testes } from './testes.detail';
import { detail as penis } from './penis.detail';
import { detail as uterus } from './uterus.detail';
import { detail as ovaries } from './ovaries.detail';
import { detail as vagina } from './vagina.detail';
import { detail as breasts } from './breasts.detail';
import { detail as fetus } from './fetus.detail';

/**
 * Flows and animation for each atlas, keyed by atlas name. The main-thread half of the
 * atlas: `index.ts` is the half the geometry worker imports.
 */
export const DETAIL_SPECS: Record<string, OrganDetailSpec> = {
  brain: brain,
  eyes: eyes,
  spinal_cord: spinalCord,
  thyroid: thyroid,
  thymus: thymus,
  heart: heart,
  lung_l: lungL,
  lung_r: lungR,
  trachea: trachea,
  diaphragm: diaphragm,
  oesophagus: oesophagus,
  liver: liver,
  gallbladder: gallbladder,
  stomach: stomach,
  pancreas: pancreas,
  spleen: spleen,
  adrenal: adrenal,
  kidney: kidney,
  ureters: ureters,
  intestine_small: intestineSmall,
  intestine_large: intestineLarge,
  bladder: bladder,
  prostate: prostate,
  testes: testes,
  penis: penis,
  uterus: uterus,
  ovaries: ovaries,
  vagina: vagina,
  breasts: breasts,
  fetus: fetus,
};
