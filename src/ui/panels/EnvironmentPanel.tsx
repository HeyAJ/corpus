import { useEffect, useState } from 'react';
import { useStore } from '../store';
import styles from './environment.module.css';

/**
 * ENVIRONMENT PANEL — where the body is, and what it is breathing.
 *
 * These are the settings of the WORLD around the body, not of the body itself, and the
 * distinction is the whole reason this panel exists. You cannot set the barometric
 * pressure of the blood or the PO₂ of the alveolus; you set the altitude and the oxygen
 * fraction, and the body answers with the pressure and the PO₂ it can reach. So every
 * control here is a cause with its consequence shown beside it: raise the altitude and
 * watch the inspired PO₂ fall, turn up the oxygen and watch it climb back.
 *
 * Like the physiology panel, these are controls that read back — the value you set on
 * the left, the value the body reached on the right — because the gap between them is
 * the physiology and hiding it would waste the most instructive thing on the screen.
 */

interface SliderProps {
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}

function Slider({ label, hint, value, min, max, step, format, onChange }: SliderProps) {
  return (
    <div className={styles.row}>
      <div className={styles.head}>
        <span className={styles.label}>{label}</span>
        <span className={styles.value}>{format(value)}</span>
      </div>
      <input
        className={styles.slider}
        type="range"
        min={min}
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

const POSTURES = [
  { id: 'supine', label: 'Supine' },
  { id: 'sitting', label: 'Sitting' },
  { id: 'standing', label: 'Standing' },
] as const;

export function EnvironmentPanel() {
  const open = useStore((s) => s.environmentPanelOpen);
  const toggle = useStore((s) => s.toggleEnvironmentPanel);
  const dispatch = useStore((s) => s.dispatch);
  const pushLog = useStore((s) => s.pushLog);
  // Every action lands on the timeline as well as the toast: the toast is gone after two
  // seconds, and the timeline is where the user goes back to find it.
  const pushEvent = useStore((s) => s.pushEvent);
  const snapshot = useStore((s) => s.snapshot);

  const env = snapshot?.environment;

  // The three continuous settings are operator-owned, so the sliders keep their own
  // value rather than chasing a 20 Hz readback that would make the thumb stutter as it
  // is dragged. They seed from the engine when the panel opens, and re-seed if the
  // engine's value diverges (a reset returns the world to sea level and room air).
  const [ambient, setAmbient] = useState(() => env?.ambientTemp_C ?? 22);
  const [altitude, setAltitude] = useState(() => env?.altitude_m ?? 0);
  const [fio2, setFio2] = useState(() => env?.fio2 ?? 0.21);
  const [broncho, setBroncho] = useState(() => snapshot?.fluids.bronchoconstriction ?? 0);

  // Re-seed the sliders only when the engine's value has DIVERGED from what this panel
  // last set — which in practice means a reset has returned the world to sea level and
  // room air. A small threshold keeps the 20 Hz readback from fighting a live drag.
  const engAmbient = env?.ambientTemp_C;
  const engAltitude = env?.altitude_m;
  const engFio2 = env?.fio2;
  useEffect(() => {
    if (engAmbient !== undefined && Math.abs(engAmbient - ambient) > 3) setAmbient(engAmbient);
    if (engAltitude !== undefined && Math.abs(engAltitude - altitude) > 400) setAltitude(engAltitude);
    if (engFio2 !== undefined && Math.abs(engFio2 - fio2) > 0.05) setFio2(engFio2);
  }, [engAmbient, engAltitude, engFio2, ambient, altitude, fio2]);

  if (!open || !snapshot || !env) return null;

  return (
    <section className={styles.panel} role="region" aria-label="Environment" data-panel="environment">
      <header className={styles.header}>
        <h2 className={styles.title}>Environment</h2>
        <button className={styles.close} onClick={() => toggle()} aria-label="Close environment panel">
          {'×'}
        </button>
      </header>

      <div className={styles.group}>
        <h3 className={styles.groupTitle}>Air</h3>

        <Slider
          label="Ambient temperature"
          hint="The air around the body. Cold drives shivering and vasoconstriction; heat drives sweating and its fluid loss."
          value={ambient}
          min={-20}
          max={50}
          step={1}
          format={(v) => `${v.toFixed(0)} °C`}
          onChange={(v) => {
            setAmbient(v);
            dispatch({ type: 'SET_ENVIRONMENT', ambientTemp_C: v });
          }}
        />

        <Slider
          label="Altitude"
          hint="Height above sea level. It sets the barometric pressure, and through it the inspired oxygen — the only thing altitude changes, and enough to matter."
          value={altitude}
          min={0}
          max={9000}
          step={100}
          format={(v) => `${v.toFixed(0)} m`}
          onChange={(v) => {
            setAltitude(v);
            dispatch({ type: 'SET_ENVIRONMENT', altitude_m: v });
          }}
        />

        <div className={styles.readouts}>
          <span>Barometric {env.barometric_mmHg.toFixed(0)} mmHg</span>
          <span>Inspired PO₂ {env.inspiredPo2_mmHg.toFixed(0)} mmHg</span>
        </div>

        <Slider
          label="Supplemental oxygen (FiO₂)"
          hint="The oxygen fraction being delivered: room air 0.21, a mask about 0.6, a ventilator up to 1.0. A setting of the equipment, not of the body."
          value={fio2}
          min={0.21}
          max={1.0}
          step={0.01}
          format={(v) => `${(v * 100).toFixed(0)} %`}
          onChange={(v) => {
            setFio2(v);
            dispatch({ type: 'SET_ENVIRONMENT', fio2: v });
          }}
        />
        <p className={styles.readouts}>
          <span>SpO₂ {(snapshot.resp.spo2 * 100).toFixed(1)} %</span>
          <span>PaO₂ {snapshot.resp.pao2_mmHg.toFixed(0)} mmHg</span>
        </p>
      </div>

      <div className={styles.group}>
        <h3 className={styles.groupTitle}>Posture</h3>
        <div className={styles.buttons}>
          {POSTURES.map((p) => (
            <button
              key={p.id}
              className={env.posture === p.id ? styles.toggleOn : styles.toggle}
              aria-pressed={env.posture === p.id}
              onClick={() => dispatch({ type: 'SET_POSTURE', posture: p.id })}
            >
              {p.label}
            </button>
          ))}
        </div>
        <p className={styles.hint}>
          Standing pools blood in the legs and the baroreflex answers; lying down returns it. The
          orthostatic drop is the difference between these.
        </p>
      </div>

      <div className={styles.group}>
        <h3 className={styles.groupTitle}>Airway</h3>
        <Slider
          label="Bronchospasm"
          hint="Airway narrowing from an asthma attack. Bronchodilators oppose it; anaphylaxis adds to it."
          value={broncho}
          min={0}
          max={1}
          step={0.05}
          format={(v) => v.toFixed(2)}
          onChange={(v) => {
            setBroncho(v);
            dispatch({ type: 'SET_BRONCHOSPASM', level: v });
          }}
        />
        <p className={styles.readouts}>
          <span>Airway narrowing {(snapshot.fluids.bronchoconstriction * 100).toFixed(0)} %</span>
        </p>
        <div className={styles.buttons}>
          {[
            { s: 0.3, label: 'Mild allergen' },
            { s: 0.6, label: 'Moderate' },
            { s: 0.9, label: 'Severe' },
          ].map((a) => (
            <button
              key={a.s}
              className={styles.toggle}
              onClick={() => {
                dispatch({ type: 'ALLERGEN_EXPOSURE', severity: a.s });
                const label = `Allergen exposure — ${a.label.toLowerCase()}`;
                const tone = a.s >= 0.6 ? 'critical' : 'warn';
                pushLog(label, tone);
                pushEvent({ kind: 'state', label, tone });
              }}
            >
              {a.label}
            </button>
          ))}
        </div>
        <p className={styles.hint}>
          A mast-cell discharge in a sensitised body: bronchospasm, capillary leak and vasodilation
          together. Severe exposure is anaphylaxis.
        </p>
      </div>

      <div className={styles.group}>
        <h3 className={styles.groupTitle}>Fluid</h3>
        <div className={styles.buttons}>
          <button className={styles.toggle} onClick={() => { dispatch({ type: 'DRINK_WATER', volume_mL: 250 }); pushLog('Drank 250 mL water'); pushEvent({ kind: 'food', label: 'Drank 250 mL water', tone: 'info' }); }}>
            Drink 250 mL
          </button>
          <button className={styles.toggle} onClick={() => { dispatch({ type: 'DRINK_WATER', volume_mL: 500 }); pushLog('Drank 500 mL water'); pushEvent({ kind: 'food', label: 'Drank 500 mL water', tone: 'info' }); }}>
            Drink 500 mL
          </button>
          <button className={styles.toggle} onClick={() => { dispatch({ type: 'VOID_BLADDER' }); pushLog('Bladder voided'); pushEvent({ kind: 'state', label: 'Bladder voided', tone: 'info' }); }}>
            Void bladder
          </button>
        </div>
        <div className={styles.readouts}>
          <span>Bladder {snapshot.renal.bladderVolume_mL.toFixed(0)} mL</span>
          <span>Balance {snapshot.fluids.balance_mL >= 0 ? '+' : ''}{snapshot.fluids.balance_mL.toFixed(0)} mL</span>
          <span>Osm {snapshot.fluids.osmolality_mOsm_per_kg.toFixed(0)} mOsm/kg</span>
        </div>
      </div>
    </section>
  );
}
