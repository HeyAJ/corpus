import { useEffect, useRef } from 'react';
import { useStore } from '../store';
import styles from './procedure.module.css';

/**
 * PROCEDURE MODE: CPR and defibrillation (spec 9, 8.6).
 *
 * The pad-placement flow is the reference's: tap the R zone, tap the L zone, charge,
 * shock. The zones are stroke-only rounded rectangles over the thorax, anterolateral,
 * mirrored because we are looking at the body from the front.
 *
 * THE TEACHING MOMENT. Shocking asystole does nothing, and the panel says why in
 * full rather than just refusing. Every shock reports the probability it rolled and
 * the two things that set it — downtime and coronary perfusion pressure — so the
 * user can see that good compressions are what make a shock work, which is the
 * single most valuable lesson in resuscitation and the one a button that always
 * works would actively teach against.
 */

const ENERGIES = [120, 150, 200];

export function ProcedurePanel() {
  const tool = useStore((s) => s.tool);
  const padStep = useStore((s) => s.padStep);
  const setPadStep = useStore((s) => s.setPadStep);
  const energy = useStore((s) => s.defibEnergy);
  const setEnergy = useStore((s) => s.setDefibEnergy);
  const dispatch = useStore((s) => s.dispatch);
  const snapshot = useStore((s) => s.snapshot);
  const setTool = useStore((s) => s.setTool);
  const shock = useStore((s) => s.shock);
  const setShock = useStore((s) => s.setShock);
  const pushLog = useStore((s) => s.pushLog);
  const pushEvent = useStore((s) => s.pushEvent);

  const holdRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (holdRef.current) clearInterval(holdRef.current);
    };
  }, []);

  if (tool !== 'procedure' || !snapshot) return null;

  const p = snapshot.procedures;
  const cpr = p.cprActive;

  const cancel = () => {
    setTool('none');
    setPadStep('idle');
    setShock(null);
  };

  const compress = () => dispatch({ type: 'CPR_COMPRESSION' });

  const startHold = () => {
    compress();
    if (holdRef.current) clearInterval(holdRef.current);
    // Holding gives compressions at the AHA midpoint of 110/min, so a user who does
    // not want to tap 110 times a minute still gets *correct* compressions rather
    // than a button that silently does something better than a human could.
    holdRef.current = setInterval(compress, 60000 / 110);
  };

  const stopHold = () => {
    if (holdRef.current) clearInterval(holdRef.current);
    holdRef.current = null;
  };

  return (
    <>
      {/* Pad placement zones, positioned over the thorax in screen space. */}
      {(padStep === 'placeRight' || padStep === 'placeLeft' || padStep === 'ready' || padStep === 'charged') && (
        <div className={styles.padLayer} aria-hidden={false}>
          <button
            className={`${styles.pad} ${styles.padRight} ${padStep === 'placeRight' ? styles.padPrompt : styles.padPlaced}`}
            onClick={() => padStep === 'placeRight' && setPadStep('placeLeft')}
            aria-label="Place right pad, upper right sternal border"
          >
            R
          </button>
          <button
            className={`${styles.pad} ${styles.padLeft} ${padStep === 'placeLeft' ? styles.padPrompt : padStep === 'placeRight' ? styles.padIdle : styles.padPlaced}`}
            onClick={() => {
              if (padStep !== 'placeLeft') return;
              setPadStep('ready');
              dispatch({ type: 'PLACE_PADS' });
              pushLog('Pads placed anterolateral', 'info');
              pushEvent({ kind: 'procedure', label: 'Pads placed anterolateral', tone: 'info' });
            }}
            aria-label="Place left pad, left mid-axillary line"
          >
            L
          </button>
        </div>
      )}

      <div className={styles.panel} role="region" aria-label="Resuscitation"
      data-panel="procedure">
        <div className={styles.headerRow}>
          <h2 className={styles.title}>Resuscitation</h2>
          <span className={styles.downtime}>
            {p.downtime_s > 0 ? `${Math.floor(p.downtime_s / 60)}:${String(Math.floor(p.downtime_s % 60)).padStart(2, '0')} down` : 'Perfusing'}
          </span>
        </div>

        <div className={styles.metrics}>
          <span>CPP {snapshot.cardio.coronaryPerfusionPressure_mmHg.toFixed(0)} mmHg</span>
          <span>CI {snapshot.cardio.cardiacIndex.toFixed(2)}</span>
          <span>Shocks {p.shocksDelivered}</span>
        </div>

        <div className={styles.cprRow}>
          <button
            className={`${styles.cprButton} ${cpr ? styles.cprActive : ''}`}
            onPointerDown={startHold}
            onPointerUp={stopHold}
            onPointerLeave={stopHold}
            aria-label="Compress. Hold for continuous compressions at 110 per minute."
          >
            Compress
          </button>
          <span className={`${styles.quality} ${styles[`quality_${p.cprQuality}`] ?? ''}`}>
            {p.cprQuality === 'none' ? 'No compressions' : `${p.cprRate_per_min.toFixed(0)}/min ${p.cprQuality}`}
          </span>
        </div>

        <div className={styles.energyRow}>
          {ENERGIES.map((j) => (
            <button
              key={j}
              className={`${styles.energy} ${energy === j ? styles.energyActive : ''}`}
              onClick={() => setEnergy(j)}
              aria-pressed={energy === j}
            >
              {j} J
            </button>
          ))}
        </div>

        <div className={styles.actionRow}>
          <button
            className={styles.charge}
            disabled={!p.padsPlaced || p.defibCharged}
            onClick={() => {
              dispatch({ type: 'CHARGE_DEFIB', joules: energy });
              setPadStep('charged');
              pushLog(`Charging to ${energy} J`, 'warn');
              pushEvent({ kind: 'procedure', label: `Charging to ${energy} J`, tone: 'warn' });
            }}
          >
            {p.defibCharged ? `Charged ${p.defibCharge_J} J` : 'Charge'}
          </button>
          <button
            className={styles.shock}
            disabled={!p.defibCharged}
            onClick={() => {
              dispatch({ type: 'DEFIBRILLATE' });
              setPadStep('ready');
            }}
          >
            Shock
          </button>
        </div>

        {shock && (
          <div className={`${styles.outcome} ${shock.converted ? styles.outcomeGood : styles.outcomeBad}`} role="status">
            <strong>{shock.converted ? 'Rhythm changed' : 'No conversion'}</strong>
            <p>{shock.reason}</p>
          </div>
        )}

        <button className={styles.cancel} onClick={cancel}>
          Cancel
        </button>
      </div>
    </>
  );
}
