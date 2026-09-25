import { useMemo } from 'react';
import type { SimSnapshot } from '../../bridge/types';
import { useStore } from '../store';
import { Sparkline } from '../components/Sparkline';
import styles from './lab.module.css';

/**
 * LABORATORY PANEL.
 *
 * Every derived number the model carries, arranged the way a results screen is
 * arranged: arterial blood gas, chemistry, haematology, renal, endocrine summary.
 *
 * WHY THIS IS WORTH BUILDING. The organ panels each show a handful of numbers about
 * one organ. A student's question is almost never "what is the stomach doing" — it is
 * "what has changed", and that question is answered by a panel that shows everything
 * at once against its reference range. Giving a drug and then reading a full profile
 * is the loop this panel exists for.
 *
 * NOTHING HERE IS STORED. Every value is read from the snapshot the engine already
 * produces, and the derived ones (anion gap, osmolality, A-a gradient, corrected
 * calcium) are computed here from those. That keeps the panel from becoming a second
 * source of truth — if it disagrees with an organ panel, one of them has a bug, and
 * it will be this one.
 *
 * THE REFERENCE RANGES ARE THE CONTENT. A potassium of 6.1 means nothing without
 * 3.5-5.0 next to it. Each range below carries a citation in `source`.
 */

type Band = 'low' | 'normal' | 'high' | 'critical-low' | 'critical-high' | 'unknown';

interface Row {
  id: string;
  label: string;
  value: number | null;
  unit: string;
  low: number;
  high: number;
  /** Outside these, the value is flagged as critical rather than merely abnormal. */
  criticalLow?: number;
  criticalHigh?: number;
  digits: number;
  trendKey?: string;
  note?: string;
}

interface Section {
  title: string;
  source: string;
  rows: Row[];
  /** A plain-language line the engine computed, shown under the title (e.g. the ABG read). */
  caption?: string;
}

function band(r: Row): Band {
  if (r.value === null || !Number.isFinite(r.value)) return 'unknown';
  if (r.criticalLow !== undefined && r.value < r.criticalLow) return 'critical-low';
  if (r.criticalHigh !== undefined && r.value > r.criticalHigh) return 'critical-high';
  if (r.value < r.low) return 'low';
  if (r.value > r.high) return 'high';
  return 'normal';
}

const BAND_WORD: Record<Band, string> = {
  low: 'low',
  high: 'high',
  normal: '',
  'critical-low': 'critically low',
  'critical-high': 'critically high',
  unknown: 'not available',
};

const BAND_CLASS: Record<Band, string> = {
  low: styles.abnormal,
  high: styles.abnormal,
  normal: styles.normal,
  'critical-low': styles.critical,
  'critical-high': styles.critical,
  unknown: styles.unknown,
};

/**
 * Reference intervals. Adult, and taken from one source per section so they are
 * internally consistent — mixing intervals from different laboratories is how a panel
 * ends up flagging a value that its own neighbour considers normal.
 */
function buildSections(s: SimSnapshot): Section[] {
  const c = s.chem;
  const r = s.resp;
  const k = s.renal;
  const m = s.metabolic;
  const ab = s.acidBase;
  const coag = s.coagulation;
  const inf = s.infection;
  const fl = s.fluids;

  // --- derived quantities, computed here from snapshot values only ----------
  // Anion gap: Na - (Cl + HCO3). The classic discriminator for a metabolic acidosis.
  const anionGap = c.na_mEq_per_L - (c.cl_mEq_per_L + c.hco3_mEq_per_L);

  // Calculated osmolality. Sodium dominates; glucose and urea contribute.
  const osmolality = 2 * c.na_mEq_per_L + m.glucose_mg_per_dL / 18 + 5;

  // Alveolar-arterial oxygen gradient at the current inspired fraction.
  const fio2 = r.intubated ? 1.0 : 0.2095;
  const pAO2 = fio2 * (760 - 47) - r.paco2_mmHg / 0.8;
  const aaGradient = pAO2 - r.pao2_mmHg;

  // Haemoglobin from haematocrit at the reference ratio; the model has no separate
  // haemoglobin state, and inventing one would be inventing a measurement.
  const haemoglobin = (c.haematocrit / 0.45) * 15;

  return [
    {
      title: 'Arterial blood gas',
      source: 'Reference intervals: Kratz A, et al. Laboratory reference values. N Engl J Med 351:1548-1563, 2004.',
      rows: [
        { id: 'ph', label: 'pH', value: c.ph, unit: '', low: 7.35, high: 7.45, criticalLow: 7.2, criticalHigh: 7.6, digits: 3, trendKey: 'ph' },
        { id: 'paco2', label: 'PaCO₂', value: r.paco2_mmHg, unit: 'mmHg', low: 35, high: 45, criticalHigh: 70, digits: 0, trendKey: 'paco2' },
        { id: 'pao2', label: 'PaO₂', value: r.pao2_mmHg, unit: 'mmHg', low: 80, high: 100, criticalLow: 55, digits: 0, trendKey: 'pao2' },
        { id: 'hco3', label: 'Bicarbonate', value: c.hco3_mEq_per_L, unit: 'mEq/L', low: 22, high: 28, digits: 1 },
        { id: 'sat', label: 'SaO₂', value: r.spo2 * 100, unit: '%', low: 95, high: 100, criticalLow: 88, digits: 1, trendKey: 'spo2' },
        { id: 'lactate', label: 'Lactate', value: c.lactate_mmol_per_L, unit: 'mmol/L', low: 0.5, high: 2.0, criticalHigh: 4.0, digits: 1, trendKey: 'lactate' },
        {
          id: 'aa', label: 'A–a gradient', value: aaGradient, unit: 'mmHg', low: 5, high: 20, digits: 0,
          note: 'Derived here from PaO₂, PaCO₂ and the inspired fraction. Widens with shunt.',
        },
      ],
    },
    {
      title: 'Chemistry',
      source: 'Reference intervals: Kratz A, et al. N Engl J Med 351:1548-1563, 2004.',
      rows: [
        { id: 'na', label: 'Sodium', value: c.na_mEq_per_L, unit: 'mEq/L', low: 135, high: 145, criticalLow: 120, criticalHigh: 160, digits: 0, trendKey: 'na' },
        { id: 'k', label: 'Potassium', value: c.k_mEq_per_L, unit: 'mEq/L', low: 3.5, high: 5.0, criticalLow: 2.5, criticalHigh: 6.5, digits: 1, trendKey: 'k' },
        { id: 'cl', label: 'Chloride', value: c.cl_mEq_per_L, unit: 'mEq/L', low: 98, high: 107, digits: 0 },
        { id: 'ca', label: 'Calcium (ionised)', value: c.caIonised_mmol_per_L, unit: 'mmol/L', low: 1.15, high: 1.33, criticalLow: 0.8, criticalHigh: 1.6, digits: 2 },
        { id: 'glu', label: 'Glucose', value: m.glucose_mg_per_dL, unit: 'mg/dL', low: 70, high: 100, criticalLow: 50, criticalHigh: 400, digits: 0, trendKey: 'glucose' },
        {
          id: 'gap', label: 'Anion gap', value: anionGap, unit: 'mEq/L', low: 8, high: 16, criticalHigh: 25, digits: 0,
          note: 'Na − (Cl + HCO₃). Derived here; a raised gap points at an unmeasured acid.',
        },
        {
          id: 'osm', label: 'Osmolality (calc)', value: osmolality, unit: 'mOsm/kg', low: 275, high: 295, digits: 0,
          note: '2×Na + glucose/18 + 5. The same figure the ADH driver reads.',
        },
      ],
    },
    {
      title: 'Renal',
      source: 'Reference intervals: Kratz A, et al. N Engl J Med 351:1548-1563, 2004.',
      rows: [
        { id: 'gfr', label: 'GFR', value: k.gfr_mL_per_min, unit: 'mL/min', low: 90, high: 140, criticalLow: 30, digits: 0, trendKey: 'gfr' },
        { id: 'creat', label: 'Creatinine', value: k.creatinine_mg_per_dL, unit: 'mg/dL', low: 0.6, high: 1.2, criticalHigh: 4.0, digits: 2, trendKey: 'creatinine' },
        { id: 'urine', label: 'Urine output', value: k.urineOutput_mL_per_min, unit: 'mL/min', low: 0.5, high: 2.0, criticalLow: 0.3, digits: 2, trendKey: 'urine' },
        { id: 'rbf', label: 'Renal blood flow', value: k.renalBloodFlow_mL_per_min, unit: 'mL/min', low: 900, high: 1300, digits: 0 },
      ],
    },
    {
      title: 'Haematology',
      source: 'Haemoglobin derived from haematocrit at the reference ratio; the model has no separate haemoglobin state.',
      rows: [
        { id: 'hct', label: 'Haematocrit', value: c.haematocrit * 100, unit: '%', low: 39, high: 50, criticalLow: 21, digits: 1, trendKey: 'hct' },
        {
          id: 'hgb', label: 'Haemoglobin', value: haemoglobin, unit: 'g/dL', low: 13.5, high: 17.5, criticalLow: 7, digits: 1,
          note: 'Derived from haematocrit, not independently modelled.',
        },
        { id: 'alb', label: 'Albumin', value: c.albumin_g_per_dL, unit: 'g/dL', low: 3.5, high: 5.0, digits: 1 },
      ],
    },
    {
      // The engine integrates the acid-base state directly (Henderson-Hasselbalch on the
      // live PaCO2 and bicarbonate), so these are ITS numbers, not this panel's — and its
      // own plain-language read of them travels with the section as the caption.
      title: 'Acid–base',
      source: 'Base excess and interpretation computed by the engine; standard base excess after Siggaard-Andersen.',
      caption: ab.interpretation,
      rows: [
        { id: 'be', label: 'Base excess', value: ab.baseExcess_mEq_per_L, unit: 'mEq/L', low: -2, high: 2, criticalLow: -10, criticalHigh: 10, digits: 1 },
        { id: 'agap', label: 'Anion gap', value: ab.anionGap_mEq_per_L, unit: 'mEq/L', low: 8, high: 16, criticalHigh: 25, digits: 0 },
        { id: 'ket', label: 'Ketones (β-OHB)', value: ab.ketones_mmol_per_L, unit: 'mmol/L', low: 0, high: 0.6, criticalHigh: 3.0, digits: 2 },
      ],
    },
    {
      title: 'Coagulation',
      source: 'Reference intervals: Kratz A, et al. N Engl J Med 351:1548-1563, 2004. INR and aPTT are engine outputs of the clotting state.',
      rows: [
        { id: 'inr', label: 'INR', value: coag.inr, unit: '', low: 0.8, high: 1.2, criticalHigh: 4.5, digits: 2 },
        { id: 'aptt', label: 'aPTT', value: coag.aptt_s, unit: 's', low: 25, high: 38, criticalHigh: 100, digits: 0 },
        { id: 'plt', label: 'Platelets', value: coag.platelets_10e9_per_L, unit: '×10⁹/L', low: 150, high: 400, criticalLow: 50, digits: 0 },
        {
          id: 'pltf', label: 'Platelet function', value: coag.plateletFunction, unit: '', low: 0.8, high: 1.2, criticalLow: 0.3, digits: 2,
          note: 'Aggregation relative to normal. Aspirin and clopidogrel lower it without touching the count.',
        },
      ],
    },
    {
      title: 'Infection markers',
      source: 'Reference intervals: Kratz A, et al. N Engl J Med 351:1548-1563, 2004; CD4 after WHO HIV staging.',
      rows: [
        { id: 'wbc', label: 'White cells', value: inf.wbc_10e9_per_L, unit: '×10⁹/L', low: 4, high: 11, criticalLow: 2, criticalHigh: 25, digits: 1 },
        { id: 'crp', label: 'C-reactive protein', value: inf.crp_mg_per_L, unit: 'mg/L', low: 0, high: 5, criticalHigh: 100, digits: 0 },
        { id: 'cd4', label: 'CD4+ count', value: inf.cd4_per_uL, unit: '/µL', low: 500, high: 1500, criticalLow: 200, digits: 0 },
      ],
    },
    {
      title: 'Fluid and osmolality',
      source: 'Osmolality integrated by the engine (2·Na + glucose/18 + urea/2.8); balance is net since the run began.',
      rows: [
        { id: 'osm-eng', label: 'Osmolality', value: fl.osmolality_mOsm_per_kg, unit: 'mOsm/kg', low: 275, high: 295, criticalLow: 250, criticalHigh: 320, digits: 0 },
        {
          id: 'bal', label: 'Fluid balance', value: fl.balance_mL, unit: 'mL', low: -1000, high: 1000, digits: 0,
          note: 'Net gain (+) or loss (−) since the run began: intake minus urine and every extra loss.',
        },
        {
          id: 'loss', label: 'Extra losses', value: fl.extraLosses_mL_per_min, unit: 'mL/min', low: 0, high: 0.5, criticalHigh: 5, digits: 2,
          note: 'Diarrhoea, vomiting, sweat and capillary leak — everything leaving that is not urine.',
        },
      ],
    },
  ];
}

function fmt(v: number | null, digits: number): string {
  if (v === null || !Number.isFinite(v)) return '—';
  return v.toFixed(digits);
}

export function LabPanel() {
  const open = useStore((s) => s.labPanelOpen);
  const toggle = useStore((s) => s.toggleLabPanel);
  const snapshot = useStore((s) => s.snapshot);

  const sections = useMemo(() => (snapshot ? buildSections(snapshot) : []), [snapshot]);

  const abnormal = useMemo(
    () => sections.flatMap((s) => s.rows).filter((r) => band(r) !== 'normal' && band(r) !== 'unknown').length,
    [sections],
  );

  if (!open) return null;

  return (
    <aside className={styles.panel} role="dialog" aria-label="Laboratory panel"
      data-panel="lab">
      <header className={styles.header}>
        <h2 className={styles.title}>Laboratory</h2>
        <span className={styles.count}>
          {abnormal === 0 ? 'all in range' : `${abnormal} abnormal`}
        </span>
        <button className={styles.close} onClick={() => toggle()} aria-label="Close laboratory panel">
          {'×'}
        </button>
      </header>

      <div className={styles.scroll} data-dense>
        {sections.map((section) => (
          <section key={section.title} className={styles.section}>
            <h3 className={styles.sectionTitle}>{section.title}</h3>
            {section.caption && <p className={styles.sectionCaption}>{section.caption}</p>}
            <table className={styles.table}>
              <tbody>
                {section.rows.map((row) => {
                  const b = band(row);
                  const word = BAND_WORD[b];
                  return (
                    <tr key={row.id} className={BAND_CLASS[b]}>
                      <th scope="row" className={styles.rowLabel} title={row.note}>
                        {row.label}
                        {row.note && <span className={styles.derived} aria-hidden="true"> ƒ</span>}
                      </th>
                      <td className={styles.rowValue}>
                        <span
                          aria-label={`${row.label} ${fmt(row.value, row.digits)} ${row.unit}${word ? `, ${word}` : ', in range'}`}
                        >
                          {fmt(row.value, row.digits)}
                        </span>
                      </td>
                      <td className={styles.rowUnit}>{row.unit}</td>
                      <td className={styles.rowTrend}>
                        {row.trendKey && (
                          <Sparkline
                            trendKey={row.trendKey}
                            width={36}
                            height={12}
                            minSpan={Math.max(1e-6, (row.high - row.low) * 0.25)}
                          />
                        )}
                      </td>
                      <td className={styles.rowRef}>
                        {row.low}–{row.high}
                      </td>
                      {/* Colour is never the only signal: the flag is a word. */}
                      <td className={styles.rowFlag}>{word}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className={styles.sectionSource}>{section.source}</p>
          </section>
        ))}
      </div>

      <p className={styles.footnote}>
        <span aria-hidden="true">ƒ</span> marks a value derived in this panel from others in the
        snapshot rather than integrated by the engine. Nothing here is stored: every figure is
        recomputed from the same state the organ panels read.
      </p>
    </aside>
  );
}
