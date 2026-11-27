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
import { parts as mouth } from './mouth.parts';
import { parts as salivaryGlands } from './salivary_glands.parts';
import { parts as pharynx } from './pharynx.parts';
import { parts as nasalCavity } from './nasal_cavity.parts';
import { parts as ears } from './ears.parts';
import { parts as skull } from './skull.parts';
import { parts as vertebralColumn } from './vertebral_column.parts';
import { parts as thoracicCage } from './thoracic_cage.parts';
import { parts as upperLimbBones } from './upper_limb_bones.parts';
import { parts as headNeckMuscles } from './head_neck_muscles.parts';
import { parts as chestWallMuscles } from './chest_wall_muscles.parts';
import { parts as abdominalWallMuscles } from './abdominal_wall_muscles.parts';
import { parts as backMuscles } from './back_muscles.parts';
import { parts as shoulderArmMuscles } from './shoulder_arm_muscles.parts';
import { parts as hipThighMuscles } from './hip_thigh_muscles.parts';
import { parts as pelvicFloorMuscles } from './pelvic_floor_muscles.parts';
import { parts as pelvicFloorMusclesFemale } from './pelvic_floor_muscles_female.parts';
import { parts as lowerLimbBones } from './lower_limb_bones.parts';

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
