import pathogensFile from '../../data/pathogens.json';
import type { PathogenSnapshot } from '../../bridge/types';
import { useStore } from '../store';
import styles from './infection.module.css';

/**
 * INFECTION PANEL — inoculate the body, watch the course, treat or clear it.
 *
 * The catalogue on the left comes from src/data/pathogens.json, the same sourced file
 * the engine reads, so the two can never fall out of step: a pathogen the model can run
 * is a pathogen this panel offers, and nothing else. Each is a coarse but cited model of
 * one infection — a growth rate, an immune-control rate, an incubation period, and an
 * effect vector onto the same bus every drug and hormone uses — which is why a fever
 * from influenza and a fever from a pyrogen arrive by one path and an antipyretic blunts
 * both.
 *
 * For an active infection the panel shows the burden against that pathogen's own
 * untreated peak, the phase it is in, and — the number that makes an antibiotic legible
 * — the kill the antimicrobials on board are currently applying. Give the right drug and
 * watch the kill exceed the growth; give the wrong one and watch nothing change. The
 * whole-body markers a clinician would order sit at the top: the white count, the CRP,
 * the CD4, and the sepsis flag the engine raises from the live signs.
 *
 * NOT A MODEL OF ANY INDIVIDUAL'S ILLNESS, and it carries the same not-for-clinical-use
 * line as the rest of CORPUS: a pathogen here is a set of rate constants and an effect
 * vector, with no transmission, no exposure route and nothing anyone could act on
 * outside a simulator.
 */

interface PathogenDef {
  id: string;
  label: string;
  kind: string;
  site: string;
}
const PATHOGENS = (pathogensFile as unknown as { pathogens: PathogenDef[] }).pathogens;

const PHASE_WORD: Record<PathogenSnapshot['phase'], string> = {
  incubating: 'Incubating',
  symptomatic: 'Symptomatic',
  resolving: 'Resolving',
  cleared: 'Cleared',
};

const PHASE_CLASS: Record<PathogenSnapshot['phase'], string> = {
  incubating: 'phaseIncubating',
  symptomatic: 'phaseSymptomatic',
  resolving: 'phaseResolving',
  cleared: 'phaseCleared',
};

const KIND_WORD: Record<string, string> = {
  virus: 'virus',
  bacterium: 'bacterium',
  parasite: 'parasite',
  toxin: 'toxin',
};

export function InfectionPanel() {
  const open = useStore((s) => s.infectionPanelOpen);
  const toggle = useStore((s) => s.toggleInfectionPanel);
  const dispatch = useStore((s) => s.dispatch);
  const pushLog = useStore((s) => s.pushLog);
  const pushEvent = useStore((s) => s.pushEvent);
  const snapshot = useStore((s) => s.snapshot);

  if (!open || !snapshot) return null;

  const inf = snapshot.infection;
  const activeIds = new Set(inf.active.map((a) => a.pathogenId));

  const inoculate = (p: PathogenDef) => {
    dispatch({ type: 'INOCULATE', pathogenId: p.id });
    pushLog(`Inoculated: ${p.label}`, 'warn');
    pushEvent({ kind: 'state', label: `Inoculated: ${p.label}`, tone: 'warn' });
  };

  const clear = (id: string, label: string) => {
    dispatch({ type: 'CLEAR_INFECTION', pathogenId: id });
    pushLog(`Cleared: ${label}`, 'info');
    pushEvent({ kind: 'state', label: `Cleared: ${label}`, tone: 'info' });
  };

  return (
    <aside className={styles.panel} role="dialog" aria-label="Infection panel" data-panel="infection">
      <header className={styles.header}>
        <h2 className={styles.title}>Infection</h2>
        {inf.sepsis && <span className={styles.sepsis}>SEPSIS</span>}
        <button className={styles.close} onClick={() => toggle()} aria-label="Close infection panel">
          {'×'}
        </button>
      </header>

      <div className={styles.markers}>
        <span><b>{inf.wbc_10e9_per_L.toFixed(1)}</b> WBC ×10⁹/L</span>
        <span><b>{inf.crp_mg_per_L.toFixed(0)}</b> CRP mg/L</span>
        <span><b>{inf.cd4_per_uL.toFixed(0)}</b> CD4 /µL</span>
        <span><b>{(inf.immuneActivation * 100).toFixed(0)}%</b> immune</span>
      </div>

      <div className={styles.scroll} data-dense>
        {inf.active.length > 0 && (
          <section className={styles.section}>
            <div className={styles.sectionHead}>
              <h3 className={styles.sectionTitle}>Active</h3>
              <button
                className={styles.clearAll}
                onClick={() => {
                  dispatch({ type: 'CLEAR_INFECTION' });
                  pushLog('All infections cleared', 'info');
                  pushEvent({ kind: 'state', label: 'All infections cleared', tone: 'info' });
                }}
              >
                Clear all
              </button>
            </div>

            {inf.active.map((a) => (
              <article key={a.pathogenId} className={styles.active}>
                <div className={styles.activeHead}>
                  <span className={styles.activeName}>{a.label}</span>
                  <span className={`${styles.phase} ${styles[PHASE_CLASS[a.phase]] ?? ''}`}>
                    {PHASE_WORD[a.phase]}
                  </span>
                  <button className={styles.clearOne} onClick={() => clear(a.pathogenId, a.label)}>
                    Clear
                  </button>
                </div>

                <div
                  className={styles.burdenBar}
                  role="img"
                  aria-label={`Burden ${(a.burden * 100).toFixed(0)} per cent of the untreated peak`}
                >
                  <span
                    className={`${styles.burdenFill} ${a.burden > 1 ? styles.burdenOver : ''}`}
                    style={{ width: `${Math.min(100, a.burden * 100)}%` }}
                  />
                </div>

                <div className={styles.activeStats}>
                  <span>burden {(a.burden * 100).toFixed(0)}%</span>
                  <span>growth ×10<sup>{a.load_log10.toFixed(1)}</sup></span>
                  <span>{a.t_h.toFixed(0)} h in</span>
                  <span className={a.drugKill_per_h > 0 ? styles.killOn : styles.killOff}>
                    drug kill {a.drugKill_per_h.toFixed(2)}/h
                  </span>
                </div>
              </article>
            ))}
          </section>
        )}

        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Inoculate</h3>
          <ul className={styles.catalogue}>
            {PATHOGENS.map((p) => {
              const isActive = activeIds.has(p.id);
              return (
                <li key={p.id} className={styles.cat}>
                  <span className={styles.catText}>
                    <span className={styles.catName}>{p.label}</span>
                    <span className={styles.catMeta}>
                      {KIND_WORD[p.kind] ?? p.kind} · {p.site}
                    </span>
                  </span>
                  <button
                    className={styles.inoculate}
                    disabled={isActive}
                    onClick={() => inoculate(p)}
                    title={isActive ? 'Already present' : `Inoculate ${p.label}`}
                  >
                    {isActive ? 'present' : 'Inoculate'}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      </div>

      <p className={styles.footnote}>
        Educational simulation only. Each pathogen is a set of sourced rate constants and an effect
        vector, cited in <code>src/data/pathogens.json</code>. No transmission or exposure is modelled.
      </p>
    </aside>
  );
}
