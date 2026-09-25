import { useStore } from '../store';
import { clearTrends } from '../trends';
import { SCENARIOS, type Scenario } from '../scenarios';
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
  const resetUiState = useStore((s) => s.resetUiState);
  const reduced = useStore((s) => s.reducedMotion);
  const setReduced = useStore((s) => s.setReducedMotion);
  const setTimeScale = useStore((s) => s.setTimeScale);

  if (tool !== 'body' || !snapshot) return null;

  const body = snapshot.body;

  /**
   * Run a scenario from a clean body. The subject's size, age and sex survive the reset,
   * because they describe WHO is being simulated rather than what has happened to them,
   * and a scenario run on a 50 kg subject should stay a 50 kg scenario.
   */
  const runScenario = (sc: Scenario) => {
    dispatch({ type: 'RESET' });
    clearEvents();
    clearTrends();
    resetUiState();
    dispatch({ type: 'SET_BODY', mass_kg: body.mass_kg, height_m: body.height_m, age_y: body.age_y, sex: body.sex });
    dispatch({ type: 'IV_ACCESS', on: true });
    for (const intent of sc.intents()) dispatch(intent);
    setTimeScale(sc.timeScale ?? 1);
    pushLog(`Scenario: ${sc.label}`, 'warn');
    pushEvent({ kind: 'state', label: `Scenario: ${sc.label}`, detail: sc.description, tone: 'warn' });
  };

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

      <h3 className={styles.subtitle}>Subject</h3>
      <p className={styles.note}>
        Who is being simulated. Body mass changes how a dose distributes and clears
        (volumes scale with mass, clearance with mass^0.75), so the same milligrams are a
        larger exposure for a smaller body. Age sets the maximal exercise heart rate. The
        circulation itself is modelled at reference-adult size.
      </p>
      <div className={styles.fields}>
        <label className={styles.field}>
          <span>Mass <b>{body.mass_kg.toFixed(0)} kg</b></span>
          <input type="range" min={40} max={150} step={1} value={body.mass_kg}
            onChange={(e) => dispatch({ type: 'SET_BODY', mass_kg: Number(e.target.value) })} aria-label="Body mass" />
        </label>
        <label className={styles.field}>
          <span>Height <b>{body.height_m.toFixed(2)} m</b></span>
          <input type="range" min={1.4} max={2.1} step={0.01} value={body.height_m}
            onChange={(e) => dispatch({ type: 'SET_BODY', height_m: Number(e.target.value) })} aria-label="Height" />
        </label>
        <label className={styles.field}>
          <span>Age <b>{body.age_y.toFixed(0)} y</b></span>
          <input type="range" min={18} max={90} step={1} value={body.age_y}
            onChange={(e) => dispatch({ type: 'SET_BODY', age_y: Number(e.target.value) })} aria-label="Age" />
        </label>
        <div className={styles.field}>
          <span>Sex</span>
          <div className={styles.buttons}>
            {(['male', 'female'] as const).map((sx) => (
              <button key={sx} className={body.sex === sx ? styles.active : undefined}
                onClick={() => dispatch({ type: 'SET_BODY', sex: sx })}>
                {sx === 'male' ? 'Male' : 'Female'}
              </button>
            ))}
          </div>
        </div>
        <p className={styles.note}>BSA {body.bsa_m2.toFixed(2)} m² (DuBois)</p>
      </div>

      <h3 className={styles.subtitle}>Scenarios</h3>
      <p className={styles.note}>
        Starting points, not treatments: each resets the body, keeps the subject above,
        and sets up an insult to explore. Doses come from the cited presets.
      </p>
      <div className={styles.scenarios}>
        {SCENARIOS.map((sc) => (
          <button key={sc.id} className={styles.scenario} onClick={() => runScenario(sc)} title={sc.description}>
            <strong>{sc.label}</strong>
            <span>{sc.description}</span>
          </button>
        ))}
      </div>

      <h3 className={styles.subtitle}>Quick insults</h3>
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
          // The defibrillator's charge and the last shock's verdict are interface state,
          // not simulation state, so the RESET intent does not reach them. A body that
          // has just been reset to a resting baseline must not still be showing "Charged
          // 200 J" or "No conversion" from the arrest that no longer happened — so clear
          // those here, on the same path.
          resetUiState();
          pushLog('Simulation reset', 'info');
          pushEvent({ kind: 'state', label: 'Simulation reset', tone: 'info' });
        }}
      >
        Reset body
      </button>
    </div>
  );
}
