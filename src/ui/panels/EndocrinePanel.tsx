import { useMemo } from 'react';
import type { HormoneSnapshot } from '../../bridge/types';
import { useStore } from '../store';
import { Sparkline } from '../components/Sparkline';
import styles from './endocrine.module.css';

/**
 * ENDOCRINE PANEL.
 *
 * Every hormone the model carries, grouped by the gland that makes it, each against
 * its own reference range.
 *
 * THE REFERENCE RANGE IS THE WHOLE POINT. A cortisol of 22 ug/dL means nothing on its
 * own; "22 against a range of 5 to 25" means something immediately, and "22 at 23:00"
 * means something different again from "22 at 08:00". So the range travels with the
 * value, and it comes from the data file rather than from a lookup table in this
 * component — one source, and it is the one carrying the citation.
 *
 * POSITION, NOT JUST COLOUR. Each row draws a bar with the reference band marked and
 * a needle at the current value, so where the needle sits inside the band is legible
 * without reading the number, and the high/low word is always spelled out for anyone
 * who cannot see the bar at all.
 *
 * ORDERED BY DEVIATION, not alphabetically and not by gland. The hormone that is
 * furthest outside its range goes to the top, because that is the one that is
 * happening. Glands are shown as a label on each row rather than as a grouping, so
 * the ordering can stay meaningful.
 */

/** Where a value sits relative to its reference range, in words and in a class. */
function classify(h: HormoneSnapshot): { word: string; cls: string; deviation: number } {
  const span = Math.max(1e-9, h.refHigh - h.refLow);
  if (h.level < h.refLow) {
    const d = (h.refLow - h.level) / span;
    return { word: d > 0.5 ? 'very low' : 'low', cls: d > 0.5 ? styles.veryLow : styles.low, deviation: d };
  }
  if (h.level > h.refHigh) {
    const d = (h.level - h.refHigh) / span;
    return { word: d > 0.5 ? 'very high' : 'high', cls: d > 0.5 ? styles.veryHigh : styles.high, deviation: d };
  }
  return { word: 'in range', cls: styles.normal, deviation: 0 };
}

/**
 * Format to a sensible precision for the magnitude. A TSH of 1.8 and an EPO of 12
 * want different numbers of decimals, and neither wants six.
 */
function fmt(v: number): string {
  if (!Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a >= 1000) return v.toFixed(0);
  if (a >= 100) return v.toFixed(0);
  if (a >= 10) return v.toFixed(1);
  if (a >= 1) return v.toFixed(2);
  return v.toPrecision(2);
}

/**
 * The bar is drawn on a scale running from zero to twice the top of the reference
 * range, so the band always occupies the middle half and a value can go visibly off
 * the end. Auto-scaling to the value would move the band every tick and destroy the
 * one thing the bar is for.
 */
function barGeometry(h: HormoneSnapshot) {
  const scaleMax = Math.max(h.refHigh * 2, h.level * 1.05, 1e-9);
  return {
    bandLeft: (h.refLow / scaleMax) * 100,
    bandWidth: ((h.refHigh - h.refLow) / scaleMax) * 100,
    needle: Math.max(0, Math.min(100, (h.level / scaleMax) * 100)),
  };
}

function clockLabel(hour: number): string {
  const h = Math.floor(hour) % 24;
  const m = Math.floor((hour % 1) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function EndocrinePanel() {
  const open = useStore((s) => s.endocrinePanelOpen);
  const toggle = useStore((s) => s.toggleEndocrinePanel);
  const snapshot = useStore((s) => s.snapshot);

  const rows = useMemo(() => {
    const hormones = snapshot?.endocrine.hormones ?? [];
    return hormones
      .map((h) => ({ h, ...classify(h) }))
      .sort((a, b) => b.deviation - a.deviation || a.h.label.localeCompare(b.h.label));
  }, [snapshot]);

  if (!open) return null;

  const e = snapshot?.endocrine;
  const abnormal = rows.filter((r) => r.deviation > 0).length;

  return (
    <aside className={styles.panel} role="dialog" aria-label="Endocrine panel"
      data-panel="endocrine">
      <header className={styles.header}>
        <h2 className={styles.title}>Endocrine</h2>
        <span className={styles.clock} title="Simulated time of day. Several hormones carry a circadian term.">
          {e ? clockLabel(e.clockHour) : '—'}
        </span>
        <button className={styles.close} onClick={() => toggle()} aria-label="Close endocrine panel">
          {'×'}
        </button>
      </header>

      {e && (
        <p className={styles.summary}>
          {rows.length} hormones{' · '}
          {abnormal === 0 ? 'all in range' : `${abnormal} outside reference range`}
          {' · '}stress axis {(e.stressAxis * 100).toFixed(0)}%
        </p>
      )}

      {rows.length === 0 && (
        <p className={styles.empty}>
          No endocrine data in this snapshot. Hormones are defined in{' '}
          <code>src/data/hormones.json</code> and integrated by{' '}
          <code>src/sim/systems/endocrine.ts</code>.
        </p>
      )}

      <ol className={styles.list}>
        {rows.map(({ h, word, cls }) => {
          const g = barGeometry(h);
          return (
            <li key={h.id} className={styles.row}>
              <div className={styles.rowHead}>
                <span className={styles.name}>{h.label}</span>
                <span className={styles.gland}>{h.gland}</span>
                <span className={styles.value}>
                  {fmt(h.level)} <span className={styles.unit}>{h.unit}</span>
                </span>
                <Sparkline trendKey={`hormone.${h.id}`} minSpan={Math.max(1e-6, (h.refHigh - h.refLow) * 0.2)} />
                {/* Colour is never the only signal: the state is always a word too. */}
                <span className={`${styles.badge} ${cls}`}>{word}</span>
              </div>

              <div
                className={styles.bar}
                role="img"
                aria-label={`${h.label} ${fmt(h.level)} ${h.unit}, ${word}, reference range ${fmt(h.refLow)} to ${fmt(h.refHigh)}`}
              >
                <span
                  className={styles.band}
                  style={{ left: `${g.bandLeft}%`, width: `${g.bandWidth}%` }}
                />
                <span className={`${styles.needle} ${cls}`} style={{ left: `${g.needle}%` }} />
              </div>

              <div className={styles.rowFoot}>
                <span>
                  ref {fmt(h.refLow)}–{fmt(h.refHigh)} {h.unit}
                </span>
                <span title="Receptor-level activity after this hormone's own Hill transform. It saturates; the concentration does not.">
                  activity {(h.activity * 100).toFixed(0)}%
                </span>
              </div>
            </li>
          );
        })}
      </ol>

      <p className={styles.footnote}>
        Reference ranges and effect vectors are cited in <code>src/data/hormones.json</code>. A
        hormone sitting at its own baseline contributes nothing to the effect bus — what acts is
        the deviation from it.
      </p>
    </aside>
  );
}
