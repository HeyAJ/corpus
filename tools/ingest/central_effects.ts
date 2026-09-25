/**
 * WHICH RECEPTOR EFFECTS HAPPEN BEHIND THE BLOOD-BRAIN BARRIER.
 *
 * Every receptor effect is emitted with a `central` flag, and pd.ts lets a drug reach a
 * central effect only through its blood-brain barrier penetration, while it reaches a
 * peripheral effect fully. This file decides the flag.
 *
 * WHY IT EXISTS (2026-09-25). The engine used to give each drug ONE access factor per
 * receptor, `1 - centralFraction x (1 - penetration)`, and apply it to every effect that
 * receptor has. That blend was wrong at both ends at once:
 *
 *   - A drug that cannot enter the brain still got a fifth to a quarter of the receptor's
 *     central action. Adrenaline (penetration 0) sedated through the central alpha-2
 *     receptor, and dopamine and adenosine changed arousal, none of which they can do
 *     from the blood.
 *   - For an ANTAGONIST the factor was never applied at all: the endogenous tone a
 *     blocker displaces was computed from raw occupancy. So glycopyrrolate, a quaternary
 *     amine chosen clinically precisely because it stays out of the brain, took exactly
 *     as much consciousness away as atropine (both 0.53, round-2 tester) - the one
 *     contrast the pair exists to teach.
 *   - And the same factor under-dosed the receptor's genuinely peripheral effects: a
 *     peripherally restricted drug's peripheral action was scaled down as though part of
 *     the periphery were behind the barrier.
 *
 * Whether an effect is central is a property of the (receptor, effect) pair, not of the
 * target alone - alpha-2's fall in vascular resistance is brainstem sympatholysis, while
 * its suppression of insulin is in the pancreas. So the rule is a default by target, plus
 * explicit exceptions, each of which says why.
 */

/**
 * Targets that only the brain (or spinal cord) produces: wakefulness, sedation, anxiety,
 * reward, seizure threshold, the brainstem's respiratory drive, and analgesia (opioid
 * analgesia is supraspinal and spinal; the peripheral exceptions are listed below).
 */
const CENTRAL_TARGETS = new Set([
  'neuro.sedation',
  'neuro.arousal',
  'neuro.anxiety',
  'neuro.dependence',
  'neuro.seizureThreshold',
  'neuro.analgesia',
  'resp.drive',
]);

/** Per-receptor exceptions to the target default. true = central, false = peripheral. */
const EXCEPTIONS: Record<string, Record<string, boolean>> = {
  // Clonidine and dexmedetomidine lower pressure and heart rate by acting on alpha-2A
  // receptors in the brainstem (nucleus tractus solitarius / rostral ventrolateral
  // medulla), withdrawing sympathetic outflow. That is why adrenaline and noradrenaline,
  // which also activate alpha-2 but cannot cross the barrier, do not do it. The receptor's
  // insulin suppression is pancreatic and stays peripheral.
  alpha2: { 'cardio.systemicResistance': true, 'cardio.heartRate': true },
  // Opioid miosis is the Edinger-Westphal nucleus, and opioid bradycardia is brainstem
  // vagal activation. A peripherally restricted opioid (loperamide) causes neither, while
  // the enteric mu receptors that slow the gut are outside the barrier (so gi.motility
  // keeps the default).
  mu: { 'neuro.pupilDiameter': true, 'cardio.heartRate': true },
  // Benzodiazepine muscle relaxation is spinal and supraspinal GABA-A modulation.
  gaba_a_bz: { 'neuro.muscleTone': true },
  // Ketamine's rise in blood pressure is centrally mediated sympathetic stimulation.
  nmda: { 'cardio.systemicResistance': true },
  // NSAID analgesia is chiefly the loss of prostaglandin sensitisation at the inflamed
  // site, and local-anaesthetic analgesia is conduction block in the peripheral nerve.
  // Both are outside the barrier, so both are exempt from the analgesia default.
  cox2: { 'neuro.analgesia': false },
  nav: { 'neuro.analgesia': false },
};

export function isCentralEffect(receptorId: string, target: string): boolean {
  const exception = EXCEPTIONS[receptorId]?.[target];
  if (exception !== undefined) return exception;
  return CENTRAL_TARGETS.has(target);
}
