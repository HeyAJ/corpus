import { useStore } from '../store';
import { clearTrends } from '../trends';
import styles from './body.module.css';

/**
 * BODY / SCENARIO PANEL (spec 8.6, "body icon").
 *
 * Baselines and scenario triggers. The haemorrhage and rhythm controls are here
 * rather than in the drug drawer because they are not treatments — they are the
 * insults you are learning to treat.
 *
 * Every scenario is a single `SimIntent`; none of them writes state directly.
 */

const RHYTHMS = [
  { id: 'nsr', label: 'Sinus' },
  { id: 'afib', label: 'A Fib' },
  { id: 'vt', label: 'V Tach' },
  { id: 'vfib', label: 'V Fib' },
  { id: 'asystole', label: 'Asystole' },
  { id: 'pea', label: 'PEA' },
] as const;

export function BodyPanel() {
  const tool = useStore((s) => s.tool);
  const dispatch = useStore((s) => s.dispatch);
  const snapshot = useStore((s) => s.snapshot);
  const pushLog = useStore((s) => s.pushLog);
  const pushEvent = useStore((s) => s.pushEvent);
  const clearEvents = useStore((s) => s.clearEvents);
  const reduced = useStore((s) => s.reducedMotion);
  const setReduced = useStore((s) => s.setReducedMotion);

  if (tool !== 'body' || !snapshot) return null;

  return (
    <div className={styles.panel} role="region" aria-label="Body and scenario"
      data-panel="body">
      <h2 className={styles.title}>Body</h2>

      <dl className={styles.stats}>
        <div>
          <dt>Blood volume</dt>
          <dd>{snapshot.cardio.bloodVolume_mL.toFixed(0)} mL</dd>
        </div>
        <div>
          <dt>Core temp</dt>
          <dd>{snapshot.metabolic.coreTemp_C.toFixed(1)} C</dd>
        </div>
        <div>
          <dt>Potassium</dt>
          <dd>{snapshot.chem.k_mEq_per_L.toFixed(1)} mEq/L</dd>
        </div>
        <div>
          <dt>Lactate</dt>
          <dd>{snapshot.chem.lactate_mmol_per_L.toFixed(1)} mmol/L</dd>
        </div>
        <div>
          <dt>Glucose</dt>
          <dd>{snapshot.metabolic.glucose_mg_per_dL.toFixed(0)} mg/dL</dd>
        </div>
        <div>
          <dt>Tick cost</dt>
          <dd>{snapshot.tickCost_ms.toFixed(2)} ms</dd>
        </div>
      </dl>

      <h3 className={styles.subtitle}>Scenario</h3>
      <div className={styles.buttons}>
        <button
          onClick={() => {
            dispatch({ type: 'HAEMORRHAGE', volume_mL: 500 });
            pushLog('Haemorrhage 500 mL', 'warn');
              pushEvent({ kind: 'state', label: 'Haemorrhage 500 mL', tone: 'warn' });
          }}
        >
          Bleed 500 mL
        </button>
        <button
          onClick={() => {
            dispatch({ type: 'HAEMORRHAGE', volume_mL: 1000 });
            pushLog('Haemorrhage 1 L', 'critical');
              pushEvent({ kind: 'state', label: 'Haemorrhage 1 L', tone: 'critical' });
          }}
        >
          Bleed 1 L
        </button>
        <button
          onClick={() => {
            dispatch({ type: 'INTUBATE', on: !snapshot.resp.intubated });
            pushLog(snapshot.resp.intubated ? 'Extubated' : 'Intubated, ventilating', 'info');
              pushEvent({ kind: 'state', label: snapshot.resp.intubated ? 'Extubated' : 'Intubated, ventilating', tone: 'info' });
          }}
        >
          {snapshot.resp.intubated ? 'Extubate' : 'Intubate'}
        </button>
        <button
          onClick={() => {
            dispatch({ type: 'IV_ACCESS', on: !snapshot.procedures.ivAccess });
            pushLog(snapshot.procedures.ivAccess ? 'IV access removed' : 'IV access sited', 'info');
              pushEvent({ kind: 'state', label: snapshot.procedures.ivAccess ? 'IV access removed' : 'IV access sited', tone: 'info' });
          }}
        >
          {snapshot.procedures.ivAccess ? 'Remove IV' : 'Site IV'}
        </button>
      </div>

      <h3 className={styles.subtitle}>Force rhythm</h3>
      <div className={styles.buttons}>
        {RHYTHMS.map((r) => (
          <button
            key={r.id}
            className={snapshot.cardio.rhythm === r.id ? styles.active : undefined}
            onClick={() => {
              dispatch({ type: 'FORCE_RHYTHM', rhythm: r.id });
              const tone = r.id === 'nsr' ? 'info' : 'critical';
              pushLog(`Rhythm forced to ${r.label}`, tone);
              pushEvent({ kind: 'state', label: `Rhythm forced to ${r.label}`, tone });
            }}
          >
            {r.label}
          </button>
        ))}
      </div>

      <h3 className={styles.subtitle}>Accessibility</h3>
      <label className={styles.toggle}>
        <input type="checkbox" checked={reduced} onChange={(e) => setReduced(e.target.checked)} />
        <span>
          Reduce motion {'—'} freezes the organ pulse. Numbers and traces stay live.
        </span>
      </label>

      <button
        className={styles.reset}
        onClick={() => {
          dispatch({ type: 'RESET' });
          // The body's clock restarts, so anything stamped against the old one would
          // be drawn at a time that no longer exists. Clear the record and the trend
          // buffers with it rather than plotting across the discontinuity.
          clearEvents();
          clearTrends();
          pushLog('Simulation reset', 'info');
          pushEvent({ kind: 'state', label: 'Simulation reset', tone: 'info' });
        }}
      >
        Reset body
      </button>
    </div>
  );
}
