import { ACTIVITY_RAMP, ACTIVITY_RAMP_BELOW } from '../../render/organs/activityRamp';
import { useStore } from '../store';
import styles from './activitylegend.module.css';

/**
 * THE ACTIVITY LEGEND, shown while the Activity switch is on.
 *
 * It draws the very ramps the renderer paints organs with (`ACTIVITY_RAMP`, pure data in
 * `src/render/organs/activityRamp.ts`), each stop at `t * 100 %`, so the bar and the body
 * can never drift apart (the teal arm is `ACTIVITY_RAMP_BELOW`, laid out to the left of the
 * neutral stop so the bar is a diverging scale). Change a stop there and both change. The
 * ends are named in words instead of numbers on purpose, because the index is a display quantity (an organ's
 * engagement above its own resting level, 0 to 1), not a measured physiological one, and
 * the one-line caption says so plainly. It sits in the legends column with the Hormones
 * legend (ToolDock.tsx `LegendStack`) and is styled like it.
 */
/*
 * DIVERGING: the neutral at-rest stop sits in the middle, the teal (suppressed) arm runs
 * left from it and the amber (engaged) arm right, each stop at 50 % -/+ t * 50 %. The below
 * arm is listed from its strongest stop down to rest, so the gradient reads left to right.
 */
const stops = [
  ...[...ACTIVITY_RAMP_BELOW].reverse().map((s) => `${s.hex} ${(50 - s.t * 50).toFixed(0)}%`),
  ...ACTIVITY_RAMP.slice(1).map((s) => `${s.hex} ${(50 + s.t * 50).toFixed(0)}%`),
];
const GRADIENT = `linear-gradient(90deg, ${stops.join(', ')})`;

export function ActivityLegend() {
  const on = useStore((s) => s.activityVisible);
  if (!on) return null;
  return (
    <div className={styles.legend} role="group" aria-label="Change from rest" data-activity-legend>
      <div className={styles.title}>Change from rest</div>
      <div className={styles.bar} style={{ background: GRADIENT }} aria-hidden="true" />
      <div className={styles.ends}>
        <span>suppressed</span>
        <span>at rest</span>
        <span>engaged</span>
      </div>
      <p className={styles.note}>An index of how far each organ is from its own resting state, not a measurement.</p>
    </div>
  );
}
