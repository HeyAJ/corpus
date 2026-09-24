import { useStore } from '../store';
import styles from './physiology.module.css';

/**
 * WHAT IS HAPPENING TO THIS BODY, APART FROM DRUGS.
 *
 * Until this panel existed, the only way to move this body was to inject something into
 * it. The engine could already run, sleep, be frightened, hurt and bleed — all of it
 * computed every tick — and none of it could be reached, because nothing in the
 * interface sent the intents and nothing on the monitors showed the result.
 *
 * THESE ARE CONTROLS THAT READ BACK, NOT READINGS. Deliberately styled apart from the
 * vital-sign clusters: nobody has a sensor for "frightened", and a number that looks
 * like a measurement implies the body reported it when in fact the operator set it.
 * Every row shows the value you asked for and, where they differ, the value the body
 * has actually reached — because the gap between them is the physiology. Ask for 70 %
 * exertion and the body takes a minute to get there; stop, and it takes longer still to
 * pay back the oxygen it borrowed.
 *
 * The one row that is a genuine readout is PAIN, because it is the only one the body
 * computes rather than receives: you set nociception, and what is felt is that minus
 * whatever analgesia is on board. Give morphine and watch the stimulus stay where it is
 * while the experience falls to nothing. That distinction is the most instructive thing
 * in this panel and it is why the two numbers are shown side by side.
 */

interface RowProps {
  label: string;
  hint: string;
  value: number;
  onChange: (v: number) => void;
  /** What the body has actually reached, when it lags what was asked for. */
  actual?: number;
  max?: number;
  step?: number;
  unit?: string;
}

function Slider({ label, hint, value, onChange, actual, max = 1, step = 0.05, unit }: RowProps) {
  const show = (v: number) => (unit ? `${v.toFixed(0)}${unit}` : v.toFixed(2));
  const lagging = actual !== undefined && Math.abs(actual - value) > 0.02;
  return (
    <div className={styles.row}>
      <div className={styles.head}>
        <span className={styles.label}>{label}</span>
        <span className={styles.value}>
          {show(value)}
          {lagging && <span className={styles.actual}> → {show(actual)}</span>}
        </span>
      </div>
      <input
        className={styles.slider}
        type="range"
        min={0}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={label}
      />
      <p className={styles.hint}>{hint}</p>
    </div>
  );
}

export function PhysiologyPanel() {
  const dispatch = useStore((s) => s.dispatch);
  const snapshot = useStore((s) => s.snapshot);
  if (!snapshot) return null;

  const b = snapshot.behaviour;
  const p = snapshot.pathology;
  const asleep = b.sleepDepth > 0.01;

  return (
    <section className={styles.panel} data-panel="physiology" aria-label="Physiology and pathology">
      <header className={styles.header}>
        <h2 className={styles.title}>Physiology</h2>
        <p className={styles.sub}>
          What the body is doing, feeling and suffering. Everything here reaches the body by
          the same route a drug does, so a beta blocker blunts fright and morphine blunts
          pain without either knowing the other happened.
        </p>
      </header>

      <div className={styles.group}>
        <h3 className={styles.groupTitle}>Doing</h3>

        <Slider
          label="Exertion"
          hint="Effort the person is attempting. The body takes time to reach it, and longer to pay back the oxygen debt afterwards."
          value={b.exertionTarget}
          actual={b.exertion}
          onChange={(v) => dispatch({ type: 'SET_EXERTION', level: v })}
        />

        <button
          className={`${styles.toggle} ${asleep ? styles.toggleOn : ''}`}
          onClick={() => dispatch({ type: 'SET_SLEEP', asleep: !asleep })}
        >
          {asleep ? `Asleep — depth ${b.sleepDepth.toFixed(2)}` : 'Go to sleep'}
        </button>
        <p className={styles.hint}>
          Sleep lowers metabolic rate, heart rate and ventilatory drive, and blunts the CO₂
          response as it deepens. Give an opioid on top and the two depressions compose.
        </p>

        {b.oxygenDebt_L > 0.01 && (
          <p className={styles.debt}>Oxygen debt {b.oxygenDebt_L.toFixed(2)} L — still repaying</p>
        )}
      </div>

      <div className={styles.group}>
        <h3 className={styles.groupTitle}>Feeling</h3>

        <div className={styles.row}>
          <div className={styles.head}>
            <span className={styles.label}>Fright</span>
            <span className={styles.value}>{b.fright.toFixed(2)}</span>
          </div>
          <div className={styles.buttons}>
            {[0.3, 0.6, 0.9].map((v) => (
              <button key={v} className={styles.small} onClick={() => dispatch({ type: 'FRIGHTEN', intensity: v })}>
                {v === 0.3 ? 'Startle' : v === 0.6 ? 'Alarm' : 'Terror'}
              </button>
            ))}
          </div>
          <p className={styles.hint}>A discharge, not a level — it fires and then decays over minutes.</p>
        </div>

        <Slider
          label="Stress"
          hint="Sustained psychological load. Drives the HPA axis and cortisol over hours, not seconds."
          value={b.stress}
          onChange={(v) => dispatch({ type: 'SET_AFFECT', stress: v })}
        />

        <Slider
          label="Low mood"
          hint="Shifts set points rather than causing events. The crudest thing in this panel — read the limitations."
          value={b.depression}
          onChange={(v) => dispatch({ type: 'SET_AFFECT', depression: v })}
        />
      </div>

      <div className={styles.group}>
        <h3 className={styles.groupTitle}>Suffering</h3>

        <div className={styles.row}>
          <div className={styles.head}>
            <span className={styles.label}>Pain</span>
            <span className={styles.value}>
              stimulus {p.nociception.toFixed(2)}
              <span className={styles.felt}> · felt {p.pain.toFixed(2)}</span>
            </span>
          </div>
          <input
            className={styles.slider}
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={p.nociception}
            onChange={(e) => dispatch({ type: 'SET_PAIN', level: Number(e.target.value) })}
            aria-label="Pain stimulus"
          />
          <p className={styles.hint}>
            The stimulus is what you set; what is FELT is that minus any analgesia on board.
            Give morphine and the stimulus stays put while the experience falls away.
          </p>
        </div>

        <Slider
          label="Bleeding"
          hint="Continuous blood loss. The baroreflex, transcapillary refill and the rest follow on their own."
          value={p.bleedRate_mL_per_min}
          onChange={(v) => dispatch({ type: 'SET_BLEED', rate_mL_per_min: v })}
          max={200}
          step={5}
          unit=" mL/min"
        />
        {p.bloodLost_mL > 1 && (
          <p className={styles.debt}>{p.bloodLost_mL.toFixed(0)} mL lost</p>
        )}

        <Slider
          label="Vertigo"
          hint="Vestibular disturbance. Currently the thinnest thing in the model: its autonomic term has no sourced value, so it is deliberately inert rather than guessed."
          value={p.vertigo}
          onChange={(v) => dispatch({ type: 'SET_VERTIGO', level: v })}
        />

        {p.inflammation > 0.01 && (
          <p className={styles.debt}>Inflammation {p.inflammation.toFixed(2)}</p>
        )}
      </div>
    </section>
  );
}
