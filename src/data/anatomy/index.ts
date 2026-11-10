import type { AnatomyFile } from '../anatomy-types';
import brain from './brain.json';
import eyes from './eyes.json';
import spinalCord from './spinal_cord.json';
import thyroid from './thyroid.json';
import thymus from './thymus.json';
import heart from './heart.json';
import lungL from './lung_l.json';
import lungR from './lung_r.json';
import trachea from './trachea.json';
import diaphragm from './diaphragm.json';
import oesophagus from './oesophagus.json';
import liver from './liver.json';
import gallbladder from './gallbladder.json';
import stomach from './stomach.json';
import pancreas from './pancreas.json';
import spleen from './spleen.json';
import adrenal from './adrenal.json';
import kidney from './kidney.json';
import ureters from './ureters.json';
import intestineSmall from './intestine_small.json';
import intestineLarge from './intestine_large.json';
import bladder from './bladder.json';
import prostate from './prostate.json';
import testes from './testes.json';
import penis from './penis.json';
import uterus from './uterus.json';
import ovaries from './ovaries.json';
import vagina from './vagina.json';
import breasts from './breasts.json';
import fetus from './fetus.json';

/**
 * Every anatomy atlas file, keyed by atlas name. Assembly only: this module imports the
 * JSON beside it and hands it out typed. An organ finds its atlas by `atlas ?? id` in
 * organs.json, so both kidneys read `kidney` and both adrenals read `adrenal`.
 */
export const ANATOMY: Record<string, AnatomyFile> = {
  brain: brain as unknown as AnatomyFile,
  eyes: eyes as unknown as AnatomyFile,
  spinal_cord: spinalCord as unknown as AnatomyFile,
  thyroid: thyroid as unknown as AnatomyFile,
  thymus: thymus as unknown as AnatomyFile,
  heart: heart as unknown as AnatomyFile,
  lung_l: lungL as unknown as AnatomyFile,
  lung_r: lungR as unknown as AnatomyFile,
  trachea: trachea as unknown as AnatomyFile,
  diaphragm: diaphragm as unknown as AnatomyFile,
  oesophagus: oesophagus as unknown as AnatomyFile,
  liver: liver as unknown as AnatomyFile,
  gallbladder: gallbladder as unknown as AnatomyFile,
  stomach: stomach as unknown as AnatomyFile,
  pancreas: pancreas as unknown as AnatomyFile,
  spleen: spleen as unknown as AnatomyFile,
  adrenal: adrenal as unknown as AnatomyFile,
  kidney: kidney as unknown as AnatomyFile,
  ureters: ureters as unknown as AnatomyFile,
  intestine_small: intestineSmall as unknown as AnatomyFile,
  intestine_large: intestineLarge as unknown as AnatomyFile,
  bladder: bladder as unknown as AnatomyFile,
  prostate: prostate as unknown as AnatomyFile,
  testes: testes as unknown as AnatomyFile,
  penis: penis as unknown as AnatomyFile,
  uterus: uterus as unknown as AnatomyFile,
  ovaries: ovaries as unknown as AnatomyFile,
  vagina: vagina as unknown as AnatomyFile,
  breasts: breasts as unknown as AnatomyFile,
  fetus: fetus as unknown as AnatomyFile,
};

export const ANATOMY_ATLASES: readonly string[] = Object.keys(ANATOMY);

/** The atlas an organ reads: its own id unless organs.json names another. */
export function atlasOf(organ: { id: string; atlas?: string }): string {
  return organ.atlas ?? organ.id;
}
