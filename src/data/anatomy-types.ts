/**
 * THE ANATOMY ATLAS: the schema of src/data/anatomy/*.json.
 *
 * One file per organ (or per pair of organs that share a structure - both kidneys read
 * `kidney.json`). Each lists the organ's PARTS: the things a selected organ is shown to
 * be made of. A part is words (what it is, what it does), a colour, and a short list of
 * DRIVES that say which of the engine's own signals make it more or less active.
 *
 * Three consumers, one file:
 *   - src/sim/derive/anatomy.ts     turns the drives into a 0..1 activity per part;
 *   - src/render/anatomy/atlas/*    draws a shape for each part id and animates it;
 *   - src/ui/panels/AnatomyPanel    lists the parts with their words and live activity.
 *
 * WHAT A DRIVE IS, AND IS NOT. `activity = clamp01(rest + sum(weight * signal))`. The
 * SIGNALS are engine outputs (the closed list below; each is defined once, in
 * derive/anatomy.ts). The DIRECTION of a drive is physiology and carries a citation:
 * the amygdala responds to threat, the medulla to respiratory drive. The WEIGHT is not
 * physiology. It is a display scale - how far a bar moves and how bright a region
 * glows - and no weight is, or may be presented as, a measurement. Activity is an
 * index of how hard the model's own drives are pushing a structure. It is not a firing
 * rate, a BOLD signal, a blood flow or a metabolic rate, and it never feeds back into
 * the simulation. docs/MODEL_LIMITATIONS.md says so.
 *
 * STRUCTURES WITHIN STRUCTURES (`parent`). A part may name another part of the SAME file as
 * its parent, and is then a finer structure of that part: the papillary muscles of the left
 * ventricle, the cusps of a valve. A part without a `parent` is level 1, exactly as every part
 * was before the field existed; a part whose parent is level 1 is level 2; the deepest level
 * allowed is 3, because a fourth level would need a camera closer than the organ's own
 * framing can reach and a tree the Structures panel cannot show on a phone. The renderer shows
 * a child only when its parent (or an ancestor) is the part the visitor selected or flew to,
 * or when the camera has come close to the parent (src/render/anatomy/detail/reveal.ts), so a
 * child costs the opened organ nothing until somebody looks for it. A child with no drives
 * shows its parent's activity. tests/data/anatomy.test.ts checks that the parent exists, that
 * there is no cycle and that the depth is at most 3. Children are drawn by the atlas's own
 * `*.parts.ts` exactly like any other part (same builder, same id).
 */

/**
 * The signals a drive may name. CLOSED: derive/anatomy.ts switches over this union
 * exhaustively and a JSON file naming anything else fails tests/data/anatomy.test.ts.
 * Every signal is dimensionless, is 0 in a resting adult unless marked "(tonic)", and
 * lies in 0..1 unless marked otherwise.
 */
export type AnatomySignal =
  /* --- arousal and mind --- */
  | 'awake' // (tonic) 1 awake, 0 in deep sleep
  | 'sleep' // depth of sleep
  | 'consciousness' // (tonic) the engine's consciousness index, 1 when alert
  | 'unconscious' // 1 - consciousness
  | 'sedation' // central depressant load
  | 'night' // (tonic by clock) 1 in the small hours, 0 by day: the dark phase of the circadian clock
  | 'fright' // acute alarm
  | 'stress' // sustained psychological load
  | 'depression' // low mood
  | 'anxiety'
  | 'euphoria'
  | 'psychedelia'
  | 'reward' // the reinforcement signal a drug or an orgasm is producing
  | 'pain' // pain actually felt, after analgesia
  | 'nociception' // the stimulus, before analgesia
  | 'analgesia' // descending and opioid pain suppression
  | 'nausea'
  | 'vomiting' // 0 or 1
  | 'vertigo'
  | 'seizure' // 0 or 1
  | 'rigidity' // raised skeletal muscle tone
  | 'paralysis' // lost skeletal muscle tone
  | 'mydriasis' // pupil wider than at rest
  | 'miosis' // pupil narrower than at rest
  /* --- movement --- */
  | 'exertion' // fraction of aerobic capacity in use
  | 'shivering'
  /* --- autonomic outflow --- */
  | 'sympathetic' // sympathetic outflow above rest, all causes
  | 'parasympathetic' // vagal outflow above rest, all causes
  | 'baroreflex' // how far the baroreceptors are from their set point, either way
  /* --- heart and circulation --- */
  | 'beat' // (cyclic) ventricular activation within the current beat
  | 'heartRate' // rate above rest, as a fraction of the reserve to maximum
  | 'bradycardia'
  | 'inotropy' // contractility above rest
  | 'pumpFailure' // contractility below rest
  | 'outputRise' // cardiac output above rest
  | 'outputFall' // cardiac output below rest
  | 'hypertension'
  | 'hypotension'
  | 'arrest' // 0 or 1: no organised output (VF, asystole, PEA)
  | 'fibrillation' // 0 or 1: atrial or ventricular fibrillation
  | 'myocardialHypoxia'
  | 'vasoconstriction' // systemic resistance above rest
  | 'vasodilation' // systemic resistance below rest
  /* --- breathing and gas exchange --- */
  | 'inspiration' // (cyclic) lung inflation within the current breath
  | 'ventilation' // minute ventilation above rest
  | 'hypoventilation' // minute ventilation below rest
  | 'respDrive' // central respiratory drive above rest
  | 'apnoea' // 0 or 1
  | 'hypoxia' // arterial desaturation
  | 'hypercapnia'
  | 'hypocapnia'
  | 'bronchoconstriction'
  | 'shunt' // blood passing unventilated lung
  /* --- kidney, water and salt --- */
  | 'filtrationRise' // GFR above rest
  | 'filtrationFall' // GFR below rest
  | 'urineFlow'
  | 'bladderFill' // (tonic) fraction of bladder capacity
  | 'dehydration' // plasma osmolality above rest
  | 'hypovolaemia'
  | 'reninDrive'
  | 'adh' // vasopressin activity above its baseline
  | 'aldosterone' // aldosterone activity above its baseline
  /* --- gut and metabolism --- */
  | 'swallowing' // something is in the oesophagus
  | 'gastricFill' // fraction of gastric capacity
  | 'digestion' // food is in the stomach or small bowel
  | 'fatLoad' // fat is arriving in the duodenum
  | 'absorption' // glucose entering portal blood
  | 'intestinalTransit' // contents in the small bowel
  | 'colonTransit' // contents in the colon
  | 'motilityRise'
  | 'motilityFall'
  | 'hyperglycaemia'
  | 'hypoglycaemia'
  | 'insulin' // plasma insulin above basal
  | 'glucagon' // glucagon activity above its baseline
  | 'hepaticOutput' // hepatic glucose output above rest
  | 'lactate'
  | 'ketosis'
  | 'fever' // core temperature above normal
  | 'hypothermia'
  | 'sweating'
  /* --- endocrine --- */
  | 'stressAxis' // hypothalamic-pituitary-adrenal drive
  | 'cortisol' // cortisol activity above its baseline
  | 'thyroid' // thyroid hormone activity above its baseline
  | 'epo' // erythropoietin activity above its baseline
  /* --- blood and immunity --- */
  | 'bleeding'
  | 'anaemia'
  | 'haemolysis'
  | 'inflammation'
  | 'immune' // immune activation
  | 'infection' // pathogen burden
  | 'histamine' // mast-cell mediator activity
  | 'clotting' // haemostasis in progress
  /* --- reproduction --- */
  | 'estradiol' // each of these eight is the hormone's level on its own display scale
  | 'progesterone'
  | 'lh'
  | 'fsh'
  | 'testosterone'
  | 'prolactin'
  | 'oxytocin'
  | 'hcg'
  | 'follicle' // growth of the dominant follicle
  | 'corpusLuteum'
  | 'endometrium' // thickness of the endometrium, relative
  | 'menstruating' // 0 or 1
  | 'pregnancy' // fraction of a 40-week gestation completed
  | 'sexualArousal'
  | 'orgasm' // the orgasmic phase envelope
  | 'vasocongestion'; // genital engorgement

export interface AnatomyDrive {
  signal: AnatomySignal;
  /**
   * Display scale: how far a full-strength signal moves the part's activity index.
   * Signed. NOT a physiological constant.
   */
  weight: number;
  /** Why this signal moves this structure, in a sentence. */
  note: string;
  /** Key into the file's `sources`: where the DIRECTION of the relationship is documented. */
  source: string;
}

export interface AnatomyPartDef {
  /** Local to the organ: lower-case letters and underscores. Runtime id is `<organId>.<id>`. */
  id: string;
  /**
   * The id of the part (in the same file) this is a finer structure of; absent for a level-1
   * part. See "STRUCTURES WITHIN STRUCTURES" in the header. At most three levels deep.
   */
  parent?: string;
  label: string;
  /** One short line: what it is. Shown under the label in the list. */
  summary: string;
  /** Two to four plain sentences: what it does. Shown when the part is opened. */
  function: string;
  /** `#rrggbb`: the part's colour in the interior view. */
  color: string;
  /** Activity index of the part in a resting, awake adult, 0..1. A display anchor. */
  rest: number;
  drives: AnatomyDrive[];
  /** Key into the file's `sources`: where the anatomy and the function come from. */
  source: string;
}

export interface AnatomyFile {
  /** The atlas name: the file's own basename, and the `atlas` (or id) of the organs that use it. */
  atlas: string;
  /** One paragraph on what this file covers and what it leaves out. */
  about: string;
  sources: Record<string, { label: string; url: string }>;
  parts: AnatomyPartDef[];
}

/** Every signal, as a runtime list, for the tests and the derive switch. */
export const ANATOMY_SIGNALS: readonly AnatomySignal[] = [
  'awake', 'sleep', 'consciousness', 'unconscious', 'sedation', 'night', 'fright', 'stress', 'depression',
  'anxiety', 'euphoria', 'psychedelia', 'reward', 'pain', 'nociception', 'analgesia', 'nausea', 'vomiting',
  'vertigo', 'seizure', 'rigidity', 'paralysis', 'mydriasis', 'miosis',
  'exertion', 'shivering',
  'sympathetic', 'parasympathetic', 'baroreflex',
  'beat', 'heartRate', 'bradycardia', 'inotropy', 'pumpFailure', 'outputRise', 'outputFall', 'hypertension',
  'hypotension', 'arrest', 'fibrillation', 'myocardialHypoxia', 'vasoconstriction', 'vasodilation',
  'inspiration', 'ventilation', 'hypoventilation', 'respDrive', 'apnoea', 'hypoxia', 'hypercapnia', 'hypocapnia',
  'bronchoconstriction', 'shunt',
  'filtrationRise', 'filtrationFall', 'urineFlow', 'bladderFill', 'dehydration', 'hypovolaemia', 'reninDrive',
  'adh', 'aldosterone',
  'swallowing', 'gastricFill', 'digestion', 'fatLoad', 'absorption', 'intestinalTransit', 'colonTransit',
  'motilityRise', 'motilityFall', 'hyperglycaemia', 'hypoglycaemia', 'insulin', 'glucagon', 'hepaticOutput',
  'lactate', 'ketosis', 'fever', 'hypothermia', 'sweating',
  'stressAxis', 'cortisol', 'thyroid', 'epo',
  'bleeding', 'anaemia', 'haemolysis', 'inflammation', 'immune', 'infection', 'histamine', 'clotting',
  'estradiol', 'progesterone', 'lh', 'fsh', 'testosterone', 'prolactin', 'oxytocin', 'hcg', 'follicle',
  'corpusLuteum', 'endometrium', 'menstruating', 'pregnancy', 'sexualArousal', 'orgasm', 'vasocongestion',
];

/** The deepest level a part may sit at (level 1 = no `parent`). Checked by tests/data/anatomy.test.ts. */
export const MAX_PART_DEPTH = 3;
