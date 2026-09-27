import { useStore } from '../store';
import styles from './blood.module.css';

/**
 * WHAT THE BLOOD IS CARRYING.
 *
 * The legend for the vascular overlay, and useful on its own: a live list of every
 * substance currently circulating, at what fraction of its own reference scale.
 *
 * IT SHOWS ONLY WHAT IS THERE. A drug at zero concentration gets no row. A list of
 * nineteen zeroes would push the two things that are actually happening off the
 * bottom, and "nothing is circulating" is better expressed by an empty list than by
 * a wall of noughts.
 *
 * THE BAR IS THE SAME 0..1 THE RENDERER USES, so the length of a bar here and the
 * density of particles in the vascular view are the same number. They cannot
 * disagree, because neither of them computes it — `src/sim/derive/transport.ts` does,
 * once, where the reference scale can carry a citation.
 */

const COMPARTMENT_WORD: Record<string, string> = {
  arterial: 'arterial',
  venous: 'venous',
  both: 'whole circulation',
};

export function BloodContents() {
  const snapshot = useStore((s) => s.snapshot);
  const visible = useStore((s) => s.bloodPanelOpen);

  const t = snapshot?.transport;
  if (!visible || !t) return null;

  return (
    <aside className={styles.wrap} data-blood-contents aria-label="What the blood is carrying">
      <h2 className={styles.title}>In the blood</h2>

      <ul className={styles.list}>
        {t.markers.map((m) => (
          <li key={m.id} className={styles.row}>
            <span
              className={styles.swatch}
              style={{ background: `#${m.colour.toString(16).padStart(6, '0')}` }}
              aria-hidden="true"
            />
            <span className={styles.name}>{m.label}</span>
            <span className={styles.compartment}>{COMPARTMENT_WORD[m.compartment] ?? m.compartment}</span>
            <span
              className={styles.bar}
              role="img"
              aria-label={`${m.label}, ${(m.level * 100).toFixed(0)} per cent of its reference scale, ${COMPARTMENT_WORD[m.compartment] ?? m.compartment}`}
            >
              <span
                className={styles.fill}
                style={{
                  width: `${Math.round(m.level * 100)}%`,
                  background: `#${m.colour.toString(16).padStart(6, '0')}`,
                }}
              />
            </span>
            <span className={styles.pct}>{(m.level * 100).toFixed(0)}%</span>
          </li>
        ))}
      </ul>

      <div className={styles.flow}>
        <span>
          arterial O₂ {(t.arterialSat * 100).toFixed(0)}%{' · '}venous {(t.venousSat * 100).toFixed(0)}%
        </span>
        <span>{t.aorticFlow_mL_per_s.toFixed(0)} mL/s</span>
      </div>

      <p className={styles.note} data-note>
        Each bar is a fraction of that substance&rsquo;s own reference scale, not an absolute
        concentration. The scales are declared with their sources in{' '}
        <code>src/sim/derive/transport.ts</code>.
      </p>
    </aside>
  );
}
