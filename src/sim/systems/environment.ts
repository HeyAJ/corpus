import { P } from '../core/constants';
import type { SimState } from '../core/state';
import { barometricPressure } from './respiratory';

/**
 * WHERE THE BODY IS.
 *
 * The operator sets the room: air temperature, altitude, the oxygen fraction being
 * breathed, and posture. None of those is a physiological value, and nothing here sets
 * one. Each is consumed by the system whose physics it changes:
 *
 *   - altitude and FiO2 by respiratory.ts, through the inspired PO2 (ICAO atmosphere);
 *   - air temperature by metabolic.ts, through the heat balance (shivering, sweating);
 *   - posture by cardio.ts, through the venous volume gravity holds in the legs.
 *
 * What this file owns is the TIME COURSE of the one of those that has one: blood
 * pooling on standing.
 *
 * POSTURE. Standing moves about half a litre of blood into the veins below the heart
 * within the first ten to thirty seconds (Smit 1999). It is not lost - it comes back
 * the moment you lie down - but for as long as it is there it is not returning to the
 * heart, so stroke volume falls and the baroreflex answers with a tachycardia. Nothing
 * about that response is scripted here: the pooled volume is handed to the circulation
 * as extra unstressed venous capacity and the reflex does the rest. In a body with a
 * good baroreflex the pressure barely moves; give it a vasodilator, a beta blocker or a
 * haemorrhage first and standing up produces orthostatic hypotension, which is the
 * teaching point of being able to change posture at all.
 */
export function stepEnvironment(s: SimState, dt: number): void {
  const env = s.environment;

  const standing = P('posture.standingPooling_mL');
  const target =
    env.posture === 'standing' ? standing : env.posture === 'sitting' ? standing * P('posture.sittingPoolingFraction') : 0;
  const k = 1 - Math.exp(-dt / P('posture.poolingTau_s'));
  env.pooled_mL += (target - env.pooled_mL) * k;
}

/** Inspired PO2 after humidification, mmHg: what altitude and oxygen therapy change. */
export function inspiredPo2(s: SimState): number {
  return s.environment.fio2 * Math.max(0, barometricPressure(s.environment.altitude_m) - P('resp.waterVapour_mmHg'));
}
