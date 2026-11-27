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
import { detail as mouth } from './mouth.detail';
import { detail as salivaryGlands } from './salivary_glands.detail';
import { detail as pharynx } from './pharynx.detail';
import { detail as nasalCavity } from './nasal_cavity.detail';
import { detail as ears } from './ears.detail';
import { detail as skull } from './skull.detail';
import { detail as vertebralColumn } from './vertebral_column.detail';
import { detail as thoracicCage } from './thoracic_cage.detail';
import { detail as upperLimbBones } from './upper_limb_bones.detail';
import { detail as headNeckMuscles } from './head_neck_muscles.detail';
import { detail as chestWallMuscles } from './chest_wall_muscles.detail';
import { detail as abdominalWallMuscles } from './abdominal_wall_muscles.detail';
import { detail as backMuscles } from './back_muscles.detail';
import { detail as shoulderArmMuscles } from './shoulder_arm_muscles.detail';
import { detail as hipThighMuscles } from './hip_thigh_muscles.detail';
import { detail as pelvicFloorMuscles } from './pelvic_floor_muscles.detail';
import { detail as pelvicFloorMusclesFemale } from './pelvic_floor_muscles_female.detail';
import { detail as lowerLimbBones } from './lower_limb_bones.detail';

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
  mouth: mouth,
  salivary_glands: salivaryGlands,
  pharynx: pharynx,
  nasal_cavity: nasalCavity,
  ears: ears,
  skull: skull,
  vertebral_column: vertebralColumn,
  thoracic_cage: thoracicCage,
  upper_limb_bones: upperLimbBones,
  lower_limb_bones: lowerLimbBones,
  head_neck_muscles: headNeckMuscles,
  chest_wall_muscles: chestWallMuscles,
  abdominal_wall_muscles: abdominalWallMuscles,
  back_muscles: backMuscles,
  shoulder_arm_muscles: shoulderArmMuscles,
  hip_thigh_muscles: hipThighMuscles,
  pelvic_floor_muscles: pelvicFloorMuscles,
  pelvic_floor_muscles_female: pelvicFloorMusclesFemale,
};
