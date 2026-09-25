import { useMemo } from 'react';
import type { HormoneSnapshot, SimSnapshot } from '../../bridge/types';
import { useStore } from '../store';
import styles from './impact.module.css';

/**
 * IMPACT PANEL — what everything you have done is doing to the body, right now.
 *
 * This is the teaching centrepiece, and it reads the one thing in the snapshot that
 * every other panel is downstream of: the EFFECT BUS. Every drug, every hormone, every
 * reflex, every insult writes a fractional modifier onto a named target — `adrenaline`
 * pushes `cardio.contractility` up, `propranolol` pushes it down, a fright pushes it up
 * again — and the body only ever sees the SUM. That is what lets a beta blocker blunt
 * both an adrenaline infusion and a startle without knowing either exists, and it is
 * invisible everywhere else in the interface: you can watch the heart rate move, but not
 * see the argument between the things moving it.
 *
 * So this panel shows the argument. For every active target it shows the net modifier,
 * a diverging bar so the sign and size read without the number, and — the part that
 * turns a number into an explanation — WHO is pushing, broken out from `effectSources`:
 * "adrenaline +30 %, propranolol −45 %, fright +12 %". A student's question is almost
 * never "what is the heart rate"; it is "why did it do that", and the why is here in
 * plain arithmetic before it ever reaches an organ.
 *
 * Targets are grouped by system so the eye can find the one it wants, and the hormones
 * follow at the foot with their reference ranges, because a hormone at its baseline
 * contributes nothing to the bus — what acts is the deviation, and you cannot read the
 * deviation without the baseline beside it.
 *
 * NOTHING HERE IS STORED. Every row is read from the snapshot the engine already
 * produces; this panel cannot disagree with the vital signs because it is looking at the
 * same bus that moved them.
 */

/* ---- which system a target belongs to, by its prefix ---------------------- */

interface Group {
  key: string;
  label: string;
}

const GROUPS: Group[] = [
  { key: 'cardio', label: 'Cardiovascular' },
  { key: 'resp', label: 'Respiratory' },
  { key: 'neuro', label: 'Neurological' },
  { key: 'metabolic', label: 'Metabolic' },
  { key: 'renal', label: 'Renal' },
  { key: 'gi', label: 'Gastrointestinal' },
  { key: 'blood', label: 'Blood' },
  { key: 'immune', label: 'Immune' },
  { key: 'thermal', label: 'Thermal' },
  { key: 'other', label: 'Other' },
];

/** Several prefixes fold into one displayed system. */
const PREFIX_TO_GROUP: Record<string, string> = {
  cardio: 'cardio',
  vascular: 'cardio',
  resp: 'resp',
  airway: 'resp',
  neuro: 'neuro',
  mind: 'neuro',
  cns: 'neuro',
  metabolic: 'metabolic',
  thermal: 'thermal',
  renal: 'renal',
  gi: 'gi',
  gut: 'gi',
  blood: 'blood',
  coag: 'blood',
  immune: 'immune',
};

function groupOf(target: string): string {
  const prefix = target.split('.')[0];
  return PREFIX_TO_GROUP[prefix] ?? 'other';
}

/* ---- humanising target names --------------------------------------------- */

/**
 * The good names, spelled out. Everything else falls through to a mechanical
 * prettifier so a target added to the engine tomorrow still reads sensibly here
 * without an edit — it just will not read quite as well as one that is listed.
 */
const TARGET_NAMES: Record<string, string> = {
  'cardio.heartRate': 'Heart rate',
  'cardio.contractility': 'Contractility',
  'cardio.svr': 'Systemic vascular resistance',
  'cardio.venousTone': 'Venous tone',
  'cardio.preload': 'Preload',
  'vascular.permeability': 'Capillary permeability',
  'vascular.tone': 'Vascular tone',
  'resp.drive': 'Respiratory drive',
  'resp.rate': 'Respiratory rate',
  'resp.shunt': 'Pulmonary shunt',
  'resp.cough': 'Cough',
  'resp.bronchoconstriction': 'Bronchoconstriction',
  'renal.gfr': 'Glomerular filtration',
  'renal.sodiumReabsorption': 'Sodium reabsorption',
  'renal.waterReabsorption': 'Water reabsorption',
  'metabolic.heatProduction': 'Heat production',
  'metabolic.hepaticGlucoseOutput': 'Hepatic glucose output',
  'metabolic.metabolicRate': 'Metabolic rate',
  'thermal.heatProduction': 'Heat production',
  'thermal.heatLoss': 'Heat loss',
  'gi.motility': 'Gut motility',
  'gi.nausea': 'Nausea',
  'gi.diarrhoea_mL_per_min': 'Diarrhoea',
  'immune.inflammation': 'Inflammation',
  'blood.plateletCount': 'Platelet count',
  'blood.haemolysis_per_h': 'Haemolysis',
  'neuro.sedation': 'Sedation',
  'neuro.consciousness': 'Consciousness',
  'mind.pupil': 'Pupil size',
  'mind.seizureMargin': 'Seizure margin',
};

/** Suffixes that mean the value is an absolute rate, not a fraction. */
const UNIT_SUFFIX: { match: RegExp; unit: string; scale: number }[] = [
  { match: /_mL_per_min$/, unit: 'mL/min', scale: 12 },
  { match: /_per_min$/, unit: '/min', scale: 10 },
  { match: /_per_h$/, unit: '/h', scale: 1 },
  { match: /_mmHg$/, unit: 'mmHg', scale: 20 },
  { match: /_mL$/, unit: 'mL', scale: 200 },
  { match: /_mEq$/, unit: 'mEq', scale: 10 },
];

/** A short handful of targets carry an absolute meaning without a unit suffix. */
const ABSOLUTE_BY_NAME = new Set(['resp.drive']);

interface TargetKind {
  absolute: boolean;
  unit: string;
  /** Denominator that maps this target's value onto a −1..1 bar. */
  scale: number;
}

function kindOf(target: string): TargetKind {
  for (const s of UNIT_SUFFIX) {
    if (s.match.test(target)) return { absolute: true, unit: s.unit, scale: s.scale };
  }
  if (ABSOLUTE_BY_NAME.has(target)) return { absolute: true, unit: '', scale: 1 };
  return { absolute: false, unit: '', scale: 1 };
}

function humaniseTarget(target: string): string {
  if (TARGET_NAMES[target]) return TARGET_NAMES[target];
  // Strip a known unit suffix, take the part after the dot, split camelCase and
  // underscores, and capitalise the first word. Deliberately dumb, so it degrades
  // gracefully rather than throwing on a target it has never seen.
  let tail = target.includes('.') ? target.slice(target.indexOf('.') + 1) : target;
  for (const s of UNIT_SUFFIX) tail = tail.replace(s.match, '');
  const words = tail
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .trim()
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/* ---- humanising source labels -------------------------------------------- */

const SOURCE_PREFIX: Record<string, string> = {
  drug: '',
  hormone: '',
  pathogen: '',
  receptor: '',
};

function humaniseSource(source: string): string {
  const colon = source.indexOf(':');
  if (colon >= 0) {
    const prefix = source.slice(0, colon);
    const rest = source.slice(colon + 1).replace(/_/g, ' ');
    if (prefix in SOURCE_PREFIX) return rest;
    return `${prefix} ${rest}`;
  }
  return source.replace(/_/g, ' ');
}

/* ---- formatting ---------------------------------------------------------- */

function fmtValue(value: number, kind: TargetKind): string {
  if (kind.absolute) {
    const a = Math.abs(value);
    const digits = a >= 100 ? 0 : a >= 10 ? 1 : 2;
    const n = value.toFixed(digits);
    return `${value > 0 ? '+' : ''}${n}${kind.unit ? ` ${kind.unit}` : ''}`;
  }
  const pct = value * 100;
  const digits = Math.abs(pct) >= 10 ? 0 : 1;
  return `${pct > 0 ? '+' : ''}${pct.toFixed(digits)}%`;
}

function fmtSource(value: number, kind: TargetKind): string {
  return fmtValue(value, kind);
}

/* ---- hormones ------------------------------------------------------------ */

function classifyHormone(h: HormoneSnapshot): { word: string; cls: string } {
  if (h.level < h.refLow) {
    const d = (h.refLow - h.level) / Math.max(1e-9, h.refHigh - h.refLow);
    return { word: d > 0.5 ? 'very low' : 'low', cls: d > 0.5 ? styles.hVeryLow : styles.hLow };
  }
  if (h.level > h.refHigh) {
    const d = (h.level - h.refHigh) / Math.max(1e-9, h.refHigh - h.refLow);
    return { word: d > 0.5 ? 'very high' : 'high', cls: d > 0.5 ? styles.hVeryHigh : styles.hHigh };
  }
  return { word: 'in range', cls: styles.hNormal };
}

function fmtHormone(v: number): string {
  if (!Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a >= 100) return v.toFixed(0);
  if (a >= 10) return v.toFixed(1);
  if (a >= 1) return v.toFixed(2);
  return v.toPrecision(2);
}

/* ---- the panel ----------------------------------------------------------- */

interface Row {
  target: string;
  name: string;
  value: number;
  kind: TargetKind;
  sources: { label: string; value: number }[];
}

function buildRows(s: SimSnapshot): Map<string, Row[]> {
  const byGroup = new Map<string, Row[]>();
  const entries = Object.entries(s.effects ?? {});
  for (const [target, value] of entries) {
    if (!Number.isFinite(value) || Math.abs(value) < 1e-4) continue;
    const kind = kindOf(target);
    const sourceObj = s.effectSources?.[target] ?? {};
    const sources = Object.entries(sourceObj)
      .filter(([, v]) => Number.isFinite(v) && Math.abs(v) > 1e-4)
      .map(([label, v]) => ({ label: humaniseSource(label), value: v }))
      .sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
    const g = groupOf(target);
    const list = byGroup.get(g) ?? [];
    list.push({ target, name: humaniseTarget(target), value, kind, sources });
    byGroup.set(g, list);
  }
  for (const list of byGroup.values()) {
    list.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  }
  return byGroup;
}

/** A centre-origin diverging bar: negative fills left in red, positive right in green. */
function DivergingBar({ value, scale }: { value: number; scale: number }) {
  const frac = Math.max(-1, Math.min(1, value / scale));
  const width = Math.abs(frac) * 50; // half the track, at most
  const positive = frac >= 0;
  return (
    <span className={styles.bar} aria-hidden="true">
      <span className={styles.barAxis} />
      <span
        className={`${styles.barFill} ${positive ? styles.barPos : styles.barNeg}`}
        style={positive ? { left: '50%', width: `${width}%` } : { right: '50%', width: `${width}%` }}
      />
    </span>
  );
}

export function ImpactPanel() {
  const open = useStore((s) => s.impactPanelOpen);
  const toggle = useStore((s) => s.toggleImpactPanel);
  const snapshot = useStore((s) => s.snapshot);

  const byGroup = useMemo(() => (snapshot ? buildRows(snapshot) : new Map<string, Row[]>()), [snapshot]);
  const hormones = useMemo(() => {
    const list = snapshot?.endocrine.hormones ?? [];
    // Movers first: the hormone furthest from its own baseline leads, because that is
    // the one doing something to the bus above.
    return [...list].sort((a, b) => {
      const da = a.level < a.refLow || a.level > a.refHigh ? 1 : 0;
      const db = b.level < b.refLow || b.level > b.refHigh ? 1 : 0;
      return db - da || a.label.localeCompare(b.label);
    });
  }, [snapshot]);

  if (!open) return null;

  const activeTargets = [...byGroup.values()].reduce((n, l) => n + l.length, 0);

  return (
    <aside className={styles.panel} role="dialog" aria-label="Impact of your actions" data-panel="impact">
      <header className={styles.header}>
        <h2 className={styles.title}>Impact</h2>
        <span className={styles.count}>
          {activeTargets === 0 ? 'nothing acting' : `${activeTargets} target${activeTargets === 1 ? '' : 's'} moving`}
        </span>
        <button className={styles.close} onClick={() => toggle()} aria-label="Close impact panel">
          {'×'}
        </button>
      </header>

      <p className={styles.lede}>
        Everything reaches the body through one bus: each drug, hormone, reflex and insult pushes a
        named target, and the body sees only the sum. Here is that sum, and who is arguing over it.
      </p>

      <div className={styles.scroll} data-dense>
        {activeTargets === 0 && (
          <p className={styles.empty}>
            The effect bus is quiet. Give a drug, run, take fright or set an environment, and the
            targets it pushes will appear here with the reason they moved.
          </p>
        )}

        {GROUPS.map((g) => {
          const rows = byGroup.get(g.key);
          if (!rows || rows.length === 0) return null;
          return (
            <section key={g.key} className={styles.group}>
              <h3 className={styles.groupTitle}>{g.label}</h3>
              <ul className={styles.rows}>
                {rows.map((r) => (
                  <li key={r.target} className={styles.row}>
                    <div className={styles.rowHead}>
                      <span className={styles.rowName}>{r.name}</span>
                      <span className={`${styles.rowValue} ${r.value >= 0 ? styles.up : styles.down}`}>
                        {fmtValue(r.value, r.kind)}
                      </span>
                    </div>
                    <DivergingBar value={r.value} scale={r.kind.scale} />
                    {r.sources.length > 0 && (
                      <p className={styles.sources}>
                        {r.sources.map((s, i) => (
                          <span key={s.label + i} className={styles.source}>
                            <span className={styles.sourceName}>{s.label}</span>
                            <span className={s.value >= 0 ? styles.up : styles.down}>
                              {' '}
                              {fmtSource(s.value, r.kind)}
                            </span>
                            {i < r.sources.length - 1 ? <span className={styles.sourceSep}>·</span> : null}
                          </span>
                        ))}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          );
        })}

        {/* Hormones: the levels themselves, with the range that makes them mean something. */}
        <section className={styles.group}>
          <h3 className={styles.groupTitle}>Hormones</h3>
          <ul className={styles.hormones}>
            {hormones.map((h) => {
              const { word, cls } = classifyHormone(h);
              const scaleMax = Math.max(h.refHigh * 2, h.level * 1.05, 1e-9);
              const bandLeft = (h.refLow / scaleMax) * 100;
              const bandWidth = ((h.refHigh - h.refLow) / scaleMax) * 100;
              const needle = Math.max(0, Math.min(100, (h.level / scaleMax) * 100));
              return (
                <li key={h.id} className={styles.hRow}>
                  <div className={styles.hHead}>
                    <span className={styles.hName}>{h.label}</span>
                    <span className={styles.hValue}>
                      {fmtHormone(h.level)} <span className={styles.hUnit}>{h.unit}</span>
                    </span>
                    <span className={`${styles.hBadge} ${cls}`}>{word}</span>
                  </div>
                  <div
                    className={styles.hBar}
                    role="img"
                    aria-label={`${h.label} ${fmtHormone(h.level)} ${h.unit}, ${word}, reference ${fmtHormone(h.refLow)} to ${fmtHormone(h.refHigh)}`}
                  >
                    <span className={styles.hBand} style={{ left: `${bandLeft}%`, width: `${bandWidth}%` }} />
                    <span className={`${styles.hNeedle} ${cls}`} style={{ left: `${needle}%` }} />
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      </div>

      <p className={styles.footnote}>
        A value is a fraction of the resting target unless its name carries a unit. The breakdown is
        the same bus split by source; a source at its baseline is not shown, because zero is not an
        argument.
      </p>
    </aside>
  );
}
