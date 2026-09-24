import type { SimState } from '../core/state';
import type { TransportSnapshot } from '../../bridge/types';
import type { Drug } from '../../data/pharma-types';
import { isMassUnit, toMilligrams } from '../pharma/units';

/**
 * WHAT THE BLOOD IS CARRYING — derived, never stored.
 *
 * The vascular renderer draws particles moving along the arterial and venous trees.
 * This decides what they are and how many there should be, and it is a pure function
 * of state the engine already has. Nothing here is a second source of truth: delete
 * this file and the simulation is unchanged, which is the property that makes it safe
 * for the renderer to depend on.
 *
 * EVERYTHING IS NORMALISED HERE, not in the renderer. A marker at 0.8 means "80% of
 * this substance's own reference scale", and that reference is a number with a source
 * next to it. The alternative — handing the renderer milligrams per litre and letting
 * it pick a scale — puts a physiological judgement in a file that draws triangles.
 *
 * WHICH SIDE OF THE CIRCULATION. Oxygen is arterial, carbon dioxide is venous, and a
 * drug given intravenously is venous first and then both. That distinction is the
 * whole reason the vascular view is worth drawing: you can watch an injected drug
 * reach the right heart, cross the lungs and appear in the arterial tree, which is a
 * sequence every student is told about and almost none has seen.
 */

/** Reference scales. A marker reaches 1.0 at these values. */
interface MarkerSpec {
  id: string;
  label: string;
  colour: number;
  compartment: 'arterial' | 'venous' | 'both';
  /** The value at which this marker reads 1.0. */
  fullScale: number;
  source: string;
}

const PHYSIOLOGICAL: MarkerSpec[] = [
  {
    id: 'oxygen',
    label: 'Oxygen',
    colour: 0xd43b3b,
    compartment: 'arterial',
    fullScale: 1.0,
    source: 'Fractional haemoglobin saturation, already 0..1.',
  },
  {
    id: 'co2',
    label: 'Carbon dioxide',
    colour: 0x6b7fb5,
    compartment: 'venous',
    fullScale: 60,
    source: 'Venous PCO2 of 60 mmHg as full scale; normal mixed venous is about 46.',
  },
  {
    id: 'glucose',
    label: 'Glucose',
    colour: 0xe0a53a,
    compartment: 'both',
    fullScale: 200,
    source: 'Plasma glucose, mg/dL. Full scale at 200, the conventional upper marker.',
  },
  {
    id: 'lactate',
    label: 'Lactate',
    colour: 0x9a5fb8,
    compartment: 'venous',
    fullScale: 8,
    source: 'Plasma lactate, mmol/L. Full scale at 8, well into shock territory.',
  },
];

/**
 * A drug reaches 1.0 at ten times the concentration its reference dose produces. That
 * is a deliberate choice rather than a clinical threshold: the dose control allows up
 * to ten times a cited reference, so a full-scale marker means "the most this
 * simulation will let you give". Anything tied to a therapeutic range would need a
 * therapeutic range for every drug, and most of them do not have one.
 */
const DRUG_FULL_SCALE_MULTIPLE = 10;

const DRUG_COLOURS = [0xe24be8, 0x38c6f4, 0x7fd6ee, 0xf0a93b, 0x8b5cf6, 0xff2d6b];

export function buildTransport(s: SimState, drugById: Map<string, Drug>): TransportSnapshot {
  const markers: TransportSnapshot['markers'] = [];

  const sat = s.resp.spo2;
  const venousSat = Math.max(0, Math.min(1, sat - 0.25));

  for (const m of PHYSIOLOGICAL) {
    let raw: number;
    switch (m.id) {
      case 'oxygen':
        raw = sat;
        break;
      case 'co2':
        raw = s.resp.venousPco2;
        break;
      case 'glucose':
        raw = s.metabolic.G;
        break;
      default:
        raw = s.chem.lactate;
        break;
    }
    markers.push({
      id: m.id,
      label: m.label,
      level: clamp01(raw / m.fullScale),
      compartment: m.compartment,
      colour: m.colour,
    });
  }

  // Only drugs actually present get a marker. A list of nineteen zeroes would make
  // the renderer draw nothing nineteen times and would push the interesting ones off
  // the end of any legend.
  let colourIndex = 0;
  for (const d of s.drugs) {
    if (d.cp <= 0) continue;
    const drug = drugById.get(d.drugId);
    if (!drug) continue;

    const v1 = drug.pk.V1_L;
    // The first preset declared in a MASS unit. A saline bolus measured in millilitres
    // has no plasma concentration, so a reference taken from it would be meaningless —
    // and taking presetDoses[0] blindly is how a 500 mL bolus became a 500 mg dose.
    const reference = drug.presetDoses.find((p) => isMassUnit(p.unit));
    if (v1 === null || v1 <= 0 || !reference) continue;

    // toMilligrams, not the raw amount. Without it every microgram-dosed drug had its
    // reference concentration computed a thousand times too large, so its marker could
    // never leave zero however much was given.
    const referenceCp = toMilligrams(reference.amount, reference.unit) / v1;
    const full = referenceCp * DRUG_FULL_SCALE_MULTIPLE;
    if (!(full > 0)) continue;

    markers.push({
      id: d.drugId,
      label: drug.displayName,
      level: clamp01(d.cp / full),
      // A drug in the central compartment is in both sides of the circulation; the
      // brief venous-only phase immediately after an injection is shorter than a
      // snapshot interval, so claiming to show it would be claiming resolution the
      // 20 Hz snapshot does not have.
      compartment: 'both',
      colour: DRUG_COLOURS[colourIndex % DRUG_COLOURS.length],
    });
    colourIndex++;
  }

  return {
    markers,
    // cycleT/rr rather than a stored phase: the phase is derivable and a second copy
    // of it would be one more thing that can disagree with the heartbeat.
    pulsePhase: s.cardio.rr > 0 ? (s.cardio.cycleT / s.cardio.rr) % 1 : 0,

    // MEAN flow, not instantaneous. The aortic valve is shut for most of the cycle,
    // so `qAortic` is genuinely zero most of the time — a 20 Hz snapshot samples it
    // essentially at random and reports "0 mL/s" from a perfectly well perfused body.
    // Mean flow is cardiac output, which is the quantity that should drive how fast
    // the blood appears to move; `pulsePhase` supplies the surge on top of it.
    aorticFlow_mL_per_s: (s.cardio.co * 1000) / 60,
    arterialSat: sat,
    venousSat,
  };
}

function clamp01(x: number): number {
  return !Number.isFinite(x) ? 0 : Math.max(0, Math.min(1, x));
}
