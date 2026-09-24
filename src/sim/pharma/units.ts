/**
 * DOSE UNITS.
 *
 * One conversion, shared. It lived in engine.ts and `src/sim/derive/transport.ts` grew
 * its own arithmetic without it, which meant every microgram-dosed drug had its
 * transport marker computed a thousand times too large — so fentanyl's reference
 * concentration came out at 7.9 mg/L instead of 0.0079, and its marker could never
 * leave zero however much was given. A second copy of a conversion is a second place
 * for it to be wrong.
 */

export function toMilligrams(amount: number, unit: string): number {
  switch (unit) {
    case 'mg':
      return amount;
    case 'mcg':
    case 'ug':
      return amount / 1000;
    case 'g':
      return amount * 1000;
    case 'mEq':
    case 'mmol':
    case 'mL':
    case 'unit':
      // Payload drugs (electrolytes, fluids) carry their amount in their own unit;
      // dosing.ts interprets it through the drug's `payload` block. Returning it
      // unchanged is correct: there is no milligram to convert to.
      return amount;
    default:
      return amount;
  }
}

/**
 * True when the unit is a real mass, so a concentration can be computed from it.
 *
 * A saline bolus measured in millilitres has no plasma concentration, and treating its
 * "500" as 500 mg would put a meaningless number on a chart. Callers that divide by a
 * volume of distribution must check this first.
 */
export function isMassUnit(unit: string): boolean {
  return unit === 'mg' || unit === 'mcg' || unit === 'ug' || unit === 'g';
}
