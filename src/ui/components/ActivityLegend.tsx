import { ACTIVITY_RAMP } from '../../render/organs/activityRamp';
import { useStore } from '../store';
import styles from './activitylegend.module.css';

/**
 * THE ACTIVITY LEGEND, shown while the Activity switch is on.
 *
 * It draws the very ramp the renderer paints organs with (`ACTIVITY_RAMP`, pure data in
 * `src/render/organs/activityRamp.ts`), each stop at `t * 100 %`, so the bar and the body
 * can never drift apart: change a stop there and both change. The ends are named in words
 * instead of numbers on purpose, because the index is a display quantity (an organ's
 * engagement above its own resting level, 0 to 1), not a measured physiological one, and
 * the one-line caption says so plainly. It sits in the legends column with the Hormones
 * legend (ToolDock.tsx `LegendStack`) and is styled like it.
 */
const GRADIENT = `linear-gradient(90deg, ${ACTIVITY_RAMP.map((s) => `${s.hex} ${(s.t * 100).toFixed(0)}%`).join(', ')})`;

export function ActivityLegend() {
  const on = useStore((s) => s.activityVisible);
  if (!on) return null;
  return (
    <div className={styles.legend} role="group" aria-label="Activity above rest" data-activity-legend>
      <div className={styles.title}>Activity above rest</div>
      <div className={styles.bar} style={{ background: GRADIENT }} aria-hidden="true" />
      <div className={styles.ends}>
        <span>at rest</span>
        <span>strongly engaged</span>
      </div>
      <p className={styles.note}>An index of how far each organ is from its own resting state, not a measurement.</p>
    </div>
  );
}
