/**
 * WHICH ORGAN IS BEHIND AN ALARM.
 *
 * A condition pill says WHAT is wrong; a pulsing organ says WHERE. Only the obvious
 * single-organ meanings are mapped. Everything else is systemic and is listed explicitly
 * in SYSTEMIC_CONDITIONS, so that tests/render/activity.test.ts can demand that every id
 * `src/sim/derive/conditions.ts` can produce sits in exactly one of the two tables. A
 * condition added to the engine later therefore cannot be silently ignored by the body.
 *
 * The pulse itself is a DISPLAY RHYTHM of about 1 Hz (ALARM_PULSE_HZ in OrganSet.ts). It
 * is not the heart rate and not a physiological frequency.
 */

/**
 * The shell colour the pulse swings toward. This is the interface's alarm red, copied from
 * the `--severity-critical-bg` token in `src/ui/tokens.css` so that a pill and the organ
 * behind it are the same red. `src/render` may not import CSS, hence the copy; if the token
 * changes, change this.
 */
export const ALARM_HEX = '#c8433a';

/** Condition id to the organ ids it points at. Only `warn` and `critical` pulse. */
export const CONDITION_ORGANS: Readonly<Record<string, readonly string[]>> = {
  // Rhythm and arrest: the heart is the organ that is failing.
  afib: ['heart'],
  arrest: ['heart'],
  asystole: ['heart'],
  bradycardia: ['heart'],
  pea: ['heart'],
  tachycardia: ['heart'],
  vfib: ['heart'],
  vt: ['heart'],
  // Gas exchange and ventilatory failure: both lungs, because the model does not
  // localise a lung.
  hypoxemia: ['lung_l', 'lung_r'],
  hypercapnia: ['lung_l', 'lung_r'],
  resp_depression: ['lung_l', 'lung_r'],
  // Renal failure: both kidneys.
  renal_failure: ['kidney_l', 'kidney_r'],
  // Loss of consciousness is a brain state.
  unconscious: ['brain'],
};

/**
 * Conditions that deliberately point at no single organ, each with the reason.
 *  - hypovolemia, hypotension, hypertension: a whole-circulation pressure or volume state;
 *    the heart, vessels and kidneys all take part, so blaming one would mislead.
 *  - hypoglycemia, hyperglycemia: blood glucose is set by liver, pancreas, muscle and fat
 *    together.
 *  - hyperkalemia, hypokalemia: a plasma electrolyte; it acts on the heart but is set by
 *    the kidney, gut and cells, so no one organ owns it.
 *  - lactic_acidosis: lactate is made by every hypoperfused tissue and cleared by liver
 *    and kidney; it is a whole-body acid-base state.
 *  - hyperthermia, hypothermia: core temperature belongs to the whole body.
 * (The ids `oxygen`, `glucose` and `lactate` that exist in `src/sim/derive/transport.ts`
 * are blood-contents channels, not conditions, and never appear in `snapshot.conditions`.)
 */
export const SYSTEMIC_CONDITIONS: readonly string[] = [
  'hypovolemia',
  'hypotension',
  'hypertension',
  'hypoglycemia',
  'hyperglycemia',
  'hyperkalemia',
  'hypokalemia',
  'lactic_acidosis',
  'hyperthermia',
  'hypothermia',
];

/**
 * Fill `out` (cleared first) with the distinct organ ids behind the `warn` and `critical`
 * conditions in `conditions`. `watch` is advisory and never pulses. Allocation-free apart
 * from growing `out` the first time.
 */
export function collectAlarmOrgans(
  conditions: readonly { id: string; severity: string }[],
  out: string[],
): string[] {
  out.length = 0;
  for (let i = 0; i < conditions.length; i++) {
    const c = conditions[i];
    if (c.severity !== 'warn' && c.severity !== 'critical') continue;
    const organs = CONDITION_ORGANS[c.id];
    if (!organs) continue;
    for (let j = 0; j < organs.length; j++) {
      if (out.indexOf(organs[j]) < 0) out.push(organs[j]);
    }
  }
  return out;
}
