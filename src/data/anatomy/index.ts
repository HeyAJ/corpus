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
import mouth from './mouth.json';
import salivaryGlands from './salivary_glands.json';
import pharynx from './pharynx.json';
import nasalCavity from './nasal_cavity.json';
import ears from './ears.json';
import skull from './skull.json';
import vertebralColumn from './vertebral_column.json';
import thoracicCage from './thoracic_cage.json';
import upperLimbBones from './upper_limb_bones.json';
import headNeckMuscles from './head_neck_muscles.json';
import chestWallMuscles from './chest_wall_muscles.json';
import abdominalWallMuscles from './abdominal_wall_muscles.json';
import backMuscles from './back_muscles.json';
import shoulderArmMuscles from './shoulder_arm_muscles.json';
import hipThighMuscles from './hip_thigh_muscles.json';
import pelvicFloorMuscles from './pelvic_floor_muscles.json';
import pelvicFloorMusclesFemale from './pelvic_floor_muscles_female.json';
import lowerLimbBones from './lower_limb_bones.json';

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
  mouth: mouth as unknown as AnatomyFile,
  salivary_glands: salivaryGlands as unknown as AnatomyFile,
  pharynx: pharynx as unknown as AnatomyFile,
  nasal_cavity: nasalCavity as unknown as AnatomyFile,
  ears: ears as unknown as AnatomyFile,
  skull: skull as unknown as AnatomyFile,
  vertebral_column: vertebralColumn as unknown as AnatomyFile,
  thoracic_cage: thoracicCage as unknown as AnatomyFile,
  upper_limb_bones: upperLimbBones as unknown as AnatomyFile,
  lower_limb_bones: lowerLimbBones as unknown as AnatomyFile,
  head_neck_muscles: headNeckMuscles as unknown as AnatomyFile,
  chest_wall_muscles: chestWallMuscles as unknown as AnatomyFile,
  abdominal_wall_muscles: abdominalWallMuscles as unknown as AnatomyFile,
  back_muscles: backMuscles as unknown as AnatomyFile,
  shoulder_arm_muscles: shoulderArmMuscles as unknown as AnatomyFile,
  hip_thigh_muscles: hipThighMuscles as unknown as AnatomyFile,
  pelvic_floor_muscles: pelvicFloorMuscles as unknown as AnatomyFile,
  pelvic_floor_muscles_female: pelvicFloorMusclesFemale as unknown as AnatomyFile,
};

export const ANATOMY_ATLASES: readonly string[] = Object.keys(ANATOMY);

/** The atlas an organ reads: its own id unless organs.json names another. */
export function atlasOf(organ: { id: string; atlas?: string }): string {
  return organ.atlas ?? organ.id;
}
