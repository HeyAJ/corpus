import { useState } from 'react';
import { useStore } from '../store';
import { EXPLANATIONS, causeOf } from '../explanations';
import styles from './status.module.css';

/**
 * WHAT IS HAPPENING TO THIS BODY, IN ENGLISH.
 *
 * The condition tags along the top already said `Hyperkalemia` and `6.8 mEq/L`, which is
 * everything a clinician needs and nothing anyone else can use. Worse, organs would
 * quietly stop and the only trace of it was a red word appearing — the interface knew
 * exactly what was wrong and would not say.
 *
 * This panel answers four questions per problem, in the order people ask them: what has
 * gone wrong, what that measurement even is, WHY it is happening, and where it ends. The
 * why is assembled at runtime from what is actually in the blood, so it can say "the
 * fentanyl in the blood does this" rather than leaving the reader to connect the dose
 * they gave ninety seconds ago to the number moving now. That connection is the entire
 * subject of the simulator and it was being left as an exercise.
 *
 * IT DOES NOT HIDE WHEN EVERYTHING IS FINE. A panel that only appears in a crisis
 * teaches you to ignore the screen the rest of the time, and "nothing is wrong" is
 * genuinely useful information while you are waiting for a drug to arrive. When the body
 * is well it says so, in one line, and gets out of the way.
 *
 * Ordered by severity, worst first, because in an emergency the reading order is the
 * triage order.
 */

const SEVERITY_RANK: Record<string, number> = { critical: 0, warn: 1, watch: 2 };

const SEVERITY_WORD: Record<string, string> = {
  critical: 'Critical',
  warn: 'Serious',
  watch: 'Worth watching',
};

export function StatusPanel() {
  const snapshot = useStore((s) => s.snapshot);
  const panelOpen = useStore((s) => s.statusPanelOpen);
  const [open, setOpen] = useState(true);

  // Behind the dock's menu now, like every other panel: the conditions it explains are
  // already tagged on the stage, so it no longer needs to hold screen space by default.
  if (!snapshot || !panelOpen) return null;

  const conditions = [...snapshot.conditions].sort(
    (a, b) => (SEVERITY_RANK[a.severity] ?? 3) - (SEVERITY_RANK[b.severity] ?? 3),
  );

  const worst = conditions[0]?.severity ?? 'none';

  return (
    <section
      className={`${styles.wrap} ${styles[`edge_${worst}`] ?? ''}`}
      data-panel="status"
      aria-label="What is happening"
    >
      <button className={styles.header} onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className={styles.title}>What is happening</span>
        <span className={`${styles.count} ${styles[`dot_${worst}`] ?? ''}`}>
          {conditions.length === 0 ? 'stable' : conditions.length}
        </span>
      </button>

      {open && (
        <div className={styles.body}>
          {conditions.length === 0 && (
            <p className={styles.calm}>
              Nothing is wrong. Heart, lungs, kidneys and blood chemistry are all inside their
              normal range. Give a drug or a meal and watch what moves.
            </p>
          )}

          {conditions.map((c) => {
            const explanation = EXPLANATIONS[c.id];
            const why = causeOf(c.id, snapshot);

            // A condition with no written explanation still shows, with the numbers it
            // has. Silence is what this panel exists to fix, so it must never be the
            // thing that goes quiet when it meets something it does not recognise.
            return (
              <article key={c.id} className={styles.item}>
                <header className={styles.itemHead}>
                  <span className={`${styles.badge} ${styles[`badge_${c.severity}`] ?? ''}`}>
                    {SEVERITY_WORD[c.severity] ?? c.severity}
                  </span>
                  <h3 className={styles.plain}>{explanation?.plain ?? c.label}</h3>
                </header>

                <p className={styles.measure}>{c.detail}</p>

                {explanation && (
                  <>
                    <p className={styles.line}>
                      <span className={styles.lead}>What that is.</span> {explanation.meaning}
                    </p>
                    {why && (
                      <p className={styles.line}>
                        <span className={styles.lead}>Why it is happening.</span> {why}
                      </p>
                    )}
                    <p className={styles.line}>
                      <span className={styles.lead}>Where it goes.</span> {explanation.leadsTo}
                    </p>
                  </>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
