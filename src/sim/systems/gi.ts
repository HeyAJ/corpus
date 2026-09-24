import { P, PMap } from '../core/constants';
import type { Digesta, SimState } from '../core/state';
import { effect } from '../core/effects';

/**
 * GASTROINTESTINAL TRACT (spec 4.6).
 *
 * An ordered chain of segments, each holding a list of `Digesta` objects that move
 * along it and are transformed on the way:
 *
 *   mouth -> oesophagus -> stomach -> duodenum -> jejunum -> ileum
 *          -> caecum -> colon(asc/trans/desc/sigmoid) -> rectum
 *
 * Gastric emptying is the Elashoff power-exponential, f(t) = 2^(-(t/t_half)^beta),
 * with t_half raised by the fat content of the meal. That is not decoration: a fatty
 * meal genuinely delays oral drug absorption, and because the drug payload rides on
 * the digesta, you can watch the plasma curve flatten out for it.
 */

export const SEGMENTS = [
  'mouth',
  'oesophagus',
  'stomach',
  'duodenum',
  'jejunum',
  'ileum',
  'caecum',
  'colon_ascending',
  'colon_transverse',
  'colon_descending',
  'colon_sigmoid',
  'rectum',
] as const;

export type SegmentId = (typeof SEGMENTS)[number];

export const STOMACH_INDEX = SEGMENTS.indexOf('stomach');
const DUODENUM_INDEX = SEGMENTS.indexOf('duodenum');
const ILEUM_INDEX = SEGMENTS.indexOf('ileum');

const TRANSIT = PMap('gi.transitTime_min');

/** Where in the tract each segment absorbs glucose, 0..1 of the SGLT1 maximum. */
const GLUCOSE_ABSORPTION_PROFILE: Record<string, number> = {
  duodenum: 0.85,
  jejunum: 1.0,
  ileum: 0.45,
  caecum: 0.05,
};

/** Fraction of an orally-administered drug that each segment can absorb per minute. */
const DRUG_ABSORPTION_PROFILE: Record<string, number> = {
  stomach: 0.02,
  duodenum: 0.35,
  jejunum: 0.30,
  ileum: 0.18,
  colon_ascending: 0.03,
  colon_transverse: 0.02,
};

export interface GutAbsorption {
  /** mg of each drug id delivered to the portal circulation this tick. */
  drugs: Record<string, number>;
  glucose_mg: number;
}

const ABSORBED: GutAbsorption = { drugs: {}, glucose_mg: 0 };

/**
 * Remaining whole-gut glucose transport capacity for this tick, mg.
 *
 * SGLT1 capacity belongs to the intestinal epithelium, not to each bolus. Letting
 * every parcel absorb at the maximum independently made ten parcels deliver ten
 * times the physiological maximum, and a two-slice pizza produced a glucose of 208.
 */
let glucoseBudget = 0;

export function stepGi(s: SimState, dt: number): GutAbsorption {
  const g = s.gi;
  const dtMin = dt / 60;

  for (const k in ABSORBED.drugs) delete ABSORBED.drugs[k];
  ABSORBED.glucose_mg = 0;
  g.glucoseAbsorptionRate = 0;

  // Peristaltic phase drives the travelling-wave displacement in the renderer.
  g.peristalsisPhase = (g.peristalsisPhase + dt * 0.18) % 1;

  const motility = 1 + effect(s, 'gi.motility');
  glucoseBudget = P('gi.glucoseAbsorption_mg_per_min_max') * dtMin;

  for (let i = g.digesta.length - 1; i >= 0; i--) {
    const d = g.digesta[i];
    d.residence += dt;

    const segment = SEGMENTS[d.segmentIndex];

    // --- absorption --------------------------------------------------------
    absorbGlucose(s, d, segment, dtMin);
    absorbDrugs(d, segment, dtMin);

    // --- water handling ----------------------------------------------------
    if (d.segmentIndex >= DUODENUM_INDEX) {
      // The small bowel absorbs most of the water; the colon takes the rest, which
      // is what turns chyme into stool and is why solidFraction rises along the tract.
      //
      // The rates are PER MINUTE and dtMin is already in minutes. An earlier version
      // multiplied by 60 as well, which made them per-second: a 12 mL parcel lost
      // 1.2 % of itself every second and vanished before it left the jejunum, so
      // nothing ever reached the colon.
      const rate = d.segmentIndex <= ILEUM_INDEX ? 0.012 : 0.006;
      const water = Math.min(d.volume * 0.85, d.volume * rate * dtMin);
      d.volume -= water;
      s.cardio.veins.V += water * 0.92;
      s.fluids.balance_mL += water * 0.92;
      d.solidFraction = Math.min(0.95, d.solidFraction + rate * dtMin * 0.12);
    }

    // --- transit -----------------------------------------------------------
    if (d.segmentIndex === STOMACH_INDEX) {
      advanceStomach(s, d);
    } else {
      const transitMin = TRANSIT[segment];
      if (transitMin === null || transitMin === undefined) {
        d.s = Math.min(1, d.s + dtMin);
      } else {
        d.s += (dtMin / transitMin) * motility;
      }
    }

    if (d.s >= 1) {
      if (d.segmentIndex >= SEGMENTS.length - 1) {
        g.digesta.splice(i, 1);
        continue;
      }
      d.segmentIndex += 1;
      d.s = 0;
      d.residence = 0;
      if (d.segmentIndex === STOMACH_INDEX) {
        // The emptying curve is a fraction of the volume on ARRIVAL.
        d.stomachEntryVolume = d.volume;
        d.pendingTransfer = 0;
      }
      if (d.segmentIndex === DUODENUM_INDEX) {
        // Leaving the stomach neutralises its acid load with pancreatic bicarbonate.
        d.solidFraction = Math.max(0.12, d.solidFraction * 0.6);
      }
    }
    if (d.volume <= 0.5 && d.carb_g <= 0.01 && !hasPayload(d)) {
      g.digesta.splice(i, 1);
    }
  }

  stepGastricAcid(s, dt);
  return ABSORBED;
}

function hasPayload(d: Digesta): boolean {
  for (const k in d.drugPayload) if (d.drugPayload[k] > 1e-6) return true;
  return false;
}

/**
 * Elashoff power-exponential gastric emptying.
 *
 *   remaining(t) = 2^(-(t / t_half)^beta)
 *
 * with t_half raised by the fat content of the meal. beta > 1 produces the initial
 * lag a real stomach shows; a plain exponential would empty fastest at t = 0.
 *
 * The emptied fraction is applied to the volume the bolus had ON ARRIVAL, not to
 * whatever is left. That distinction is the whole bug this function was rewritten
 * to fix: the first version differentiated the curve and transferred a share of the
 * REMAINING volume each tick, gated behind a "only bother if at least 2 % moved"
 * threshold. At a 10 ms tick the per-step change is about a thousandth of a per
 * cent, so the gate never opened, and a meal sat in the stomach for six simulated
 * hours without moving. The 24-hour homeostasis test could not see it; the GI
 * transit test found it immediately.
 *
 * Emptied volume accumulates and is handed to the duodenum in discrete parcels,
 * because the renderer animates parcels along a centreline and a continuous
 * infinitesimal trickle would give it nothing to draw.
 */
function advanceStomach(s: SimState, d: Digesta): void {
  const beta = P('gi.gastricEmptyingBeta');
  const halfBase = P('gi.gastricEmptyingHalfTime_min');
  // Duodenal feedback responds to the fat content of everything leaving the
  // stomach, so a drug swallowed with a fatty meal is delayed by that meal's fat
  // and not by its own (of which a tablet has none). Using the parcel's own fat
  // made an oral dose taken with a fatty breakfast absorb exactly as fast as one
  // taken fasted, which is the opposite of the effect being modelled.
  let gastricFat = 0;
  for (const other of s.gi.digesta) {
    if (other.segmentIndex === STOMACH_INDEX) gastricFat += other.fat_g;
  }
  const fatDelay = 1 + P('gi.fatEmptyingDelayFactor_per_gram') * gastricFat;
  const motility = Math.max(0.2, 1 + effect(s, 'gi.motility'));
  const tHalf = (halfBase * fatDelay) / motility;

  const tMin = d.residence / 60;
  const remaining = Math.pow(2, -Math.pow(Math.max(0, tMin) / tHalf, beta));

  // d.s doubles as the emptied fraction and as the renderer's position along the
  // gastric centreline.
  d.s = Math.max(0, Math.min(1, 1 - remaining));

  const target = d.stomachEntryVolume * remaining;
  const transfer = d.volume - target;
  if (transfer <= 0) return;

  const fraction = transfer / Math.max(1e-9, d.volume);
  d.pendingTransfer += transfer;
  d.volume = target;

  // Macronutrients and any drug payload leave with the chyme, proportionally.
  const carb = d.carb_g * fraction;
  const fat = d.fat_g * fraction;
  const protein = d.protein_g * fraction;
  d.carb_g -= carb;
  d.fat_g -= fat;
  d.protein_g -= protein;
  d.pendingCarb += carb;
  d.pendingFat += fat;
  d.pendingProtein += protein;

  for (const k in d.drugPayload) {
    const moved = d.drugPayload[k] * fraction;
    d.drugPayload[k] -= moved;
    d.pendingPayload[k] = (d.pendingPayload[k] ?? 0) + moved;
  }

  const PARCEL_ML = 12;
  if (d.pendingTransfer >= PARCEL_ML || remaining < 0.02) {
    spawnChyme(s, d);
  }
}

function spawnChyme(s: SimState, from: Digesta): void {
  const vol = from.pendingTransfer;
  if (vol <= 0.01) return;

  const payload: Record<string, number> = {};
  for (const k in from.pendingPayload) {
    if (from.pendingPayload[k] > 1e-9) payload[k] = from.pendingPayload[k];
    delete from.pendingPayload[k];
  }

  // Fibre travels with the carbohydrate it accompanies, and is CONSERVED: what leaves
  // the parent is removed from it. Apportioning by carbohydrate rather than by volume
  // matters because a parcel of liquid can empty from a solid meal and carry no fibre
  // with it, which is exactly what happens to the liquid phase of a real mixed meal.
  const totalCarb = from.carb_g + from.pendingCarb;
  const carbFraction = totalCarb > 1e-9 ? from.pendingCarb / totalCarb : 0;
  const fibreMoved = from.fibre_g * carbFraction;
  from.fibre_g -= fibreMoved;

  s.gi.digesta.push({
    id: s.gi.nextId++,
    segmentIndex: DUODENUM_INDEX,
    s: 0,
    volume: vol,
    carb_g: from.pendingCarb,
    fat_g: from.pendingFat,
    protein_g: from.pendingProtein,
    solidFraction: Math.max(0.1, from.solidFraction * 0.7),
    // Inherited from the parent bolus: a parcel leaving the stomach is still the same
    // food, so it carries the same absorption characteristics into the duodenum.
    glycaemicIndex: from.glycaemicIndex,
    fibre_g: fibreMoved,
    drugPayload: payload,
    label: from.label,
    residence: 0,
    stomachEntryVolume: vol,
    pendingTransfer: 0,
    pendingCarb: 0,
    pendingFat: 0,
    pendingProtein: 0,
    pendingPayload: {},
  });

  from.pendingTransfer = 0;
  from.pendingCarb = 0;
  from.pendingFat = 0;
  from.pendingProtein = 0;
}

function absorbGlucose(s: SimState, d: Digesta, segment: string, dtMin: number): void {
  const profile = GLUCOSE_ABSORPTION_PROFILE[segment];
  if (!profile || d.carb_g <= 0) return;

  // Carbohydrate must first be hydrolysed to monosaccharide; that is fast relative
  // to absorption, so the rate limit is SGLT1 transport capacity.
  const available = d.carb_g * 1000;

  // GLYCAEMIC INDEX CHANGES THE SHAPE, NOT THE AREA.
  //
  // It is a measured property of a food: the same grams of carbohydrate from lentils
  // and from a glucose drink both end up absorbed, but one arrives over hours and the
  // other over minutes, and only the second produces a spike. So it scales the RATE and
  // nothing else — the parcel still gives up all of its carbohydrate eventually, which
  // is what keeps this a model of absorption rather than a fudge factor on energy.
  //
  // Normalised against 55, which is what an undeclared food gets, so nothing that
  // existed before these fields behaves differently because of them.
  const giScale = Math.max(0.25, Math.min(2.0, d.glycaemicIndex / 55));

  // FIBRE SLOWS IT FURTHER. Viscous fibre thickens the intestinal contents and impedes
  // contact with the brush border. Expressed against the parcel's OWN carbohydrate,
  // because 5 g of fibre alongside 10 g of carbohydrate is a quite different food from
  // 5 g alongside 80 g.
  const fibreRatio = d.carb_g > 0.01 ? d.fibre_g / d.carb_g : 0;
  const fibreScale = 1 / (1 + 1.6 * Math.min(1.5, fibreRatio));

  // Bounded by this parcel's site in the tract AND by what is left of the gut's whole
  // transport capacity for this tick.
  const absorbed = Math.min(
    available,
    glucoseBudget * profile * giScale * fibreScale,
    glucoseBudget,
  );
  if (absorbed <= 0) return;
  glucoseBudget -= absorbed;

  d.carb_g -= absorbed / 1000;
  ABSORBED.glucose_mg += absorbed;
  s.gi.glucoseAbsorptionRate += dtMin > 0 ? absorbed / dtMin : 0;
}

function absorbDrugs(d: Digesta, segment: string, dtMin: number): void {
  const profile = DRUG_ABSORPTION_PROFILE[segment];
  if (!profile) return;
  for (const drugId in d.drugPayload) {
    const amount = d.drugPayload[drugId];
    if (amount <= 1e-9) continue;
    // First-order absorption from this segment. The drug's own ka scales this in
    // pharma/pk.ts; here the segment only decides *whether* and *how fast* relative
    // to the rest of the tract.
    const fraction = 1 - Math.exp(-profile * dtMin);
    const moved = amount * fraction;
    d.drugPayload[drugId] = amount - moved;
    ABSORBED.drugs[drugId] = (ABSORBED.drugs[drugId] ?? 0) + moved;
  }
}

/**
 * Gastric acid balance. Free acid in mEq against the buffering capacity of whatever
 * is in the stomach; pH is derived from the resulting free H+ concentration, so the
 * pH chip in the UI is a computed output, not a stored value.
 */
function stepGastricAcid(s: SimState, dt: number): void {
  const g = s.gi;
  const dtMin = dt / 60;

  const secretion = (P('gi.gastricAcidSecretion_mEq_per_h') / 60) *
    (1 + effect(s, 'gi.acidSecretion')) * dtMin;
  g.gastricAcid_mEq += secretion;

  // Buffer is consumed as it neutralises acid.
  if (g.gastricBuffer_mEq > 0) {
    const neutralised = Math.min(g.gastricBuffer_mEq, g.gastricAcid_mEq, secretion * 3 + 0.02 * dtMin * 60);
    g.gastricBuffer_mEq -= neutralised;
    g.gastricAcid_mEq -= neutralised;
  }

  // Acid leaves with the emptied chyme.
  const vol = gastricVolume(s);
  if (vol > 0) {
    const emptyingFraction = Math.min(0.5, dtMin * 0.04);
    g.gastricAcid_mEq *= 1 - emptyingFraction;
  }
  g.gastricAcid_mEq = Math.max(1e-6, g.gastricAcid_mEq);
}

export function gastricVolume(s: SimState): number {
  let v = 30; // resting gastric juice
  for (const d of s.gi.digesta) {
    if (d.segmentIndex === STOMACH_INDEX) v += d.volume;
  }
  return v;
}

/** Derived gastric pH: -log10 of free H+ concentration in the current volume. */
export function gastricPh(s: SimState): number {
  const volume_L = gastricVolume(s) / 1000;
  const h = s.gi.gastricAcid_mEq / Math.max(0.005, volume_L); // mEq/L == mmol/L
  const molar = h / 1000;
  return Math.max(0.8, Math.min(8.5, -Math.log10(Math.max(1e-9, molar))));
}

export function swallow(
  s: SimState,
  opts: {
    volume_mL: number;
    carb_g: number;
    fat_g: number;
    protein_g: number;
    solidFraction: number;
    label: string;
    drugPayload?: Record<string, number>;
    /**
     * Relative to glucose = 100. Changes the SHAPE of the glucose curve, not the area
     * under it: the same grams absorbed faster give a higher, earlier peak. Defaults to
     * 55, the middle of the range, for anything that does not declare one.
     */
    glycaemicIndex?: number;
    /** Unabsorbed bulk, grams. Slows carbohydrate absorption. */
    fibre_g?: number;
  },
): void {
  s.gi.digesta.push({
    id: s.gi.nextId++,
    segmentIndex: 0,
    s: 0,
    volume: opts.volume_mL,
    carb_g: opts.carb_g,
    fat_g: opts.fat_g,
    protein_g: opts.protein_g,
    solidFraction: opts.solidFraction,
    // Optional, and absent for a swallowed tablet. The defaults are chosen so a parcel
    // that declares neither behaves exactly as it did before these fields existed.
    glycaemicIndex: opts.glycaemicIndex ?? 55,
    fibre_g: opts.fibre_g ?? 0,
    drugPayload: opts.drugPayload ? { ...opts.drugPayload } : {},
    label: opts.label,
    residence: 0,
    stomachEntryVolume: opts.volume_mL,
    pendingTransfer: 0,
    pendingCarb: 0,
    pendingFat: 0,
    pendingProtein: 0,
    pendingPayload: {},
  });

  // Meals buffer gastric acid; protein is the dominant dietary buffer.
  s.gi.gastricBuffer_mEq += opts.protein_g * P('gi.mealBufferCapacity_mEq_per_g_protein');
}
