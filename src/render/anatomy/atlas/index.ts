import type { PartBuilder } from '../parts';
import { parts as brain } from './brain.parts';
import { parts as eyes } from './eyes.parts';
import { parts as spinalCord } from './spinal_cord.parts';
import { parts as thyroid } from './thyroid.parts';
import { parts as thymus } from './thymus.parts';
import { parts as heart } from './heart.parts';
import { parts as lungL } from './lung_l.parts';
import { parts as lungR } from './lung_r.parts';
import { parts as trachea } from './trachea.parts';
import { parts as diaphragm } from './diaphragm.parts';
import { parts as oesophagus } from './oesophagus.parts';
import { parts as liver } from './liver.parts';
import { parts as gallbladder } from './gallbladder.parts';
import { parts as stomach } from './stomach.parts';
import { parts as pancreas } from './pancreas.parts';
import { parts as spleen } from './spleen.parts';
import { parts as adrenal } from './adrenal.parts';
import { parts as kidney } from './kidney.parts';
import { parts as ureters } from './ureters.parts';
import { parts as intestineSmall } from './intestine_small.parts';
import { parts as intestineLarge } from './intestine_large.parts';
import { parts as bladder } from './bladder.parts';
import { parts as prostate } from './prostate.parts';
import { parts as testes } from './testes.parts';
import { parts as penis } from './penis.parts';
import { parts as uterus } from './uterus.parts';
import { parts as ovaries } from './ovaries.parts';
import { parts as vagina } from './vagina.parts';
import { parts as breasts } from './breasts.parts';
import { parts as fetus } from './fetus.parts';

/**
 * The registry of organ interiors, keyed by ATLAS name (see src/data/anatomy/index.ts).
 * Each entry builds that atlas's parts in the organ's own frame - the same frame its
 * shell in models.ts is authored in - so a part sits inside the shell without either
 * knowing about the other. Imported by the geometry worker: nothing reachable from here
 * may touch a material, the DOM or the main thread.
 */
export const PART_BUILDERS: Record<string, PartBuilder> = {
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
