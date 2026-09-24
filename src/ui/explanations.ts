import type { SimSnapshot } from '../bridge/types';
import drugsFile from '../data/drugs.json';
import type { DrugsFile } from '../data/pharma-types';

/**
 * WHAT THE HELL IS HAPPENING.
 *
 * The simulator already knew that potassium was 6.8 and that this was critical. What it
 * could not say was what potassium *is*, why it had gone up, or what happens next — so
 * unless you already knew, the interface told you something was wrong and nothing else.
 * Organs would stop and the only clue was a red word.
 *
 * Three sentences per condition, in the order a person actually asks them:
 *
 *   plain    — what has gone wrong, in words with no Greek in them
 *   meaning  — what the measurement is, for someone who has never seen it
 *   leadsTo  — where this ends if nothing changes, which is the part that makes it matter
 *
 * and then a fourth, assembled at runtime: WHY. That one cannot be written in advance,
 * because the answer is usually "the drug you just gave", and which drug depends on what
 * is in the blood right now. `causeOf` looks for a drug on board whose class is known to
 * do this, and names it.
 *
 * This is interface copy, not physiology, so it carries no citations and states no
 * numbers — every number on screen comes from the model, where it has provenance. The
 * prose is here to make those numbers legible, and it is deliberately plain rather than
 * clinical: "the blood is not carrying enough oxygen" beats "hypoxaemia" for everyone
 * except the people who already knew.
 */

const DRUGS = (drugsFile as unknown as DrugsFile).drugs;
const GROUP_BY_ID = new Map(DRUGS.map((d) => [d.id, d.drawerGroup]));

export interface Explanation {
  plain: string;
  meaning: string;
  leadsTo: string;
  /** Drawer groups whose drugs commonly cause this, used to name a likely culprit. */
  causedBy?: string[];
  /** A non-drug cause worth naming when no culprit drug is on board. */
  otherwise?: string;
}

export const EXPLANATIONS: Record<string, Explanation> = {
  hypoxemia: {
    plain: 'The blood is not carrying enough oxygen',
    meaning: 'Oxygen saturation is how full of oxygen the blood leaving the lungs is. Healthy is about 95 to 100 per cent.',
    leadsTo: 'Organs run on oxygen delivered by blood. Below about 90 per cent the brain and heart start to struggle; well below that, they stop.',
    causedBy: ['Opioids', 'Sedatives'],
    otherwise: 'The lungs are not moving enough air, or the heart is not moving enough blood past them.',
  },
  hypercapnia: {
    plain: 'Carbon dioxide is building up',
    meaning: 'Breathing does two jobs: bring oxygen in and carry carbon dioxide out. This is the waste half, and it is rising.',
    leadsTo: 'Rising carbon dioxide makes the blood acidic and, high enough, sedates the very part of the brain that drives breathing — so it gets worse on its own.',
    causedBy: ['Opioids', 'Sedatives'],
    otherwise: 'Breathing is too shallow or too slow to clear it.',
  },
  resp_depression: {
    plain: 'Breathing has been suppressed',
    meaning: 'The brainstem sets how often and how deeply you breathe. Something is turning that down.',
    leadsTo: 'Oxygen falls and carbon dioxide rises. This is how opioid overdose kills, and it is silent — there is no struggle to watch for.',
    causedBy: ['Opioids', 'Sedatives'],
    otherwise: 'The drive to breathe has been suppressed at the brainstem.',
  },
  hypotension: {
    plain: 'Blood pressure is too low to push blood around',
    meaning: 'Pressure is what drives blood through organs. Without enough of it, blood arrives nowhere in useful amounts.',
    leadsTo: 'Kidneys and brain are the first to notice. Sustained, this becomes shock and then organ failure.',
    causedBy: ['Sedatives', 'Beta blockers', 'Calcium blockers', 'Opioids'],
    otherwise: 'There is either not enough blood, not enough pump, or the vessels are too wide.',
  },
  hypertension: {
    plain: 'Blood pressure is too high',
    meaning: 'The heart is pushing against more resistance than it should have to.',
    leadsTo: 'Over minutes this strains the heart. The danger is to vessels in the brain.',
    causedBy: ['Catecholamine', 'Autonomic', 'Controlled', 'Stimulants'],
  },
  hypovolemia: {
    plain: 'There is not enough blood in circulation',
    meaning: 'Volume, not pressure. The pipes are underfilled, so each beat has less to eject.',
    leadsTo: 'The body compensates by speeding the heart and tightening vessels — which works, until it does not, and then pressure falls suddenly.',
    otherwise: 'Blood or fluid has been lost and not replaced.',
  },
  tachycardia: {
    plain: 'The heart is beating too fast',
    meaning: 'A fast heart has less time to fill between beats, so beating faster can actually move less blood.',
    leadsTo: 'Sustained, the heart muscle runs short of its own blood supply, because it is fed between beats.',
    causedBy: ['Catecholamine', 'Inotropes', 'Autonomic', 'Stimulants', 'Controlled'],
    otherwise: 'Usually the body compensating for low volume, low oxygen or pain.',
  },
  bradycardia: {
    plain: 'The heart is beating too slowly',
    meaning: 'Output is rate times the volume of each beat. Too slow, and total flow falls even if each beat is strong.',
    leadsTo: 'Blood pressure follows the rate down, and at the bottom of that the heart stops.',
    causedBy: ['Beta blockers', 'Calcium blockers', 'Opioids', 'Antiarrhythmics', 'Autonomic'],
    otherwise: 'Often the reflex answer to a sudden RISE in pressure — the body correcting, and overshooting.',
  },
  hyperkalemia: {
    plain: 'Potassium in the blood is dangerously high',
    meaning: 'Potassium sets how easily heart muscle can fire. Too much and the electrical system becomes unstable.',
    leadsTo: 'This is a rhythm problem, not a strength problem. It ends in a heart that quivers instead of pumping.',
    causedBy: ['Electrolyte', 'Renal'],
    otherwise: 'Either it was given, or failing kidneys are not clearing it.',
  },
  hypokalemia: {
    plain: 'Potassium in the blood is too low',
    meaning: 'The same electrical balance, tipped the other way.',
    leadsTo: 'Also a rhythm problem. Low potassium makes the heart irritable and prone to extra beats.',
    causedBy: ['Renal'],
    otherwise: 'Usually lost through the kidneys.',
  },
  hypoglycemia: {
    plain: 'Blood sugar is too low',
    meaning: 'The brain cannot store fuel and cannot burn fat. It runs on sugar delivered continuously by blood.',
    leadsTo: 'Confusion first, then unconsciousness. The brain is affected before anything else.',
    causedBy: ['Endocrine'],
    otherwise: 'More is being used than is arriving.',
  },
  hyperglycemia: {
    plain: 'Blood sugar is too high',
    meaning: 'Sugar is in the blood but not getting into cells, or more has arrived than can be handled.',
    leadsTo: 'Over hours it pulls water out of cells and into the urine. This is a slow problem, not a sudden one.',
    causedBy: ['Steroids', 'Endocrine'],
  },
  lactic_acidosis: {
    plain: 'Tissues are running without enough oxygen',
    meaning: 'Lactate is what cells produce when they have to make energy without oxygen. It is a marker of debt, not a poison.',
    leadsTo: 'Rising lactate means the delivery problem has been going on for a while. It is the number that says how bad it really is.',
    otherwise: 'Blood is not reaching tissue fast enough — from low pressure, low output or low oxygen.',
  },
  renal_failure: {
    plain: 'The kidneys are not being fed enough blood',
    meaning: 'Kidneys filter blood, and filtering needs pressure. Below a threshold they simply stop.',
    leadsTo: 'Urine output falls first. Then drugs that leave through the kidneys start to accumulate, so the next dose lasts longer and hits harder.',
    otherwise: 'Blood pressure has fallen below what filtration needs.',
  },
  hyperthermia: {
    plain: 'The body is too hot',
    meaning: 'Core temperature, not skin temperature. The body normally holds this within a fraction of a degree.',
    leadsTo: 'Enzymes and proteins work in a narrow band. Far outside it, they stop working.',
    causedBy: ['Controlled', 'Stimulants'],
  },
  hypothermia: {
    plain: 'The body is too cold',
    meaning: 'Core temperature has fallen below the range the body defends.',
    leadsTo: 'A cold heart is an irritable heart, and clotting fails as well.',
  },
  unconscious: {
    plain: 'The person is not responsive',
    meaning: 'Consciousness here is a single number driven by blood flow to the brain, oxygen, and sedative drugs.',
    leadsTo: 'An unresponsive person cannot protect their own airway, which is a problem before anything else is.',
    causedBy: ['Sedatives', 'Opioids'],
    otherwise: 'The brain is short of blood, short of oxygen, or sedated.',
  },
  vfib: {
    plain: 'The heart is quivering instead of pumping',
    meaning: 'The electrical system has broken into chaos. The muscle is moving, but not together, so nothing is pushed anywhere.',
    leadsTo: 'There is no pulse. This is a cardiac arrest, and the treatment is compressions and a shock.',
  },
  vt: {
    plain: 'The heart is running a fast, dangerous rhythm',
    meaning: 'The beat is being driven from the ventricles rather than the normal pacemaker, and far too fast to fill.',
    leadsTo: 'It may produce a weak pulse or none, and it can collapse into fibrillation.',
  },
  asystole: {
    plain: 'The heart has stopped completely',
    meaning: 'No electrical activity at all. This is the flat line.',
    leadsTo: 'There is no pulse and no rhythm to shock. Compressions and adrenaline are the only things left.',
  },
  pea: {
    plain: 'There is electrical activity but no pulse',
    meaning: 'The monitor shows a rhythm that looks survivable. The heart is not actually moving blood.',
    leadsTo: 'A trace that looks reassuring and a patient who is in cardiac arrest. Never trust the monitor over the pulse.',
  },
};

/** The most concentrated drug on board whose class is known to cause this. */
export function causeOf(condition: string, snapshot: SimSnapshot): string | null {
  const explanation = EXPLANATIONS[condition];
  if (!explanation) return null;

  const groups = explanation.causedBy;
  if (groups && groups.length > 0) {
    const culprits = snapshot.drugs
      .filter((d) => d.plasma_ng_per_mL > 0)
      .filter((d) => {
        const group = GROUP_BY_ID.get(d.drugId);
        return group !== undefined && groups.includes(group);
      })
      .sort((a, b) => b.plasma_ng_per_mL - a.plasma_ng_per_mL);

    if (culprits.length === 1) return `The ${culprits[0].displayName} in the blood does this.`;
    if (culprits.length > 1) {
      const names = culprits.slice(0, 2).map((d) => d.displayName).join(' and ');
      return `${names} are both in the blood, and both do this. Together they do it harder than either alone.`;
    }
  }

  return explanation.otherwise ?? null;
}
