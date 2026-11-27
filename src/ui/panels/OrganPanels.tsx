import { useEffect, useRef, useState } from 'react';
import type { SimSnapshot } from '../../bridge/types';
import type { OrganDef } from '../../data/types';
import type { WaveformRing } from '../../bridge/ring';
import { WaveformStrip } from '../components/WaveformStrip';
import {
  BloodPressurePill,
  ConditionTag,
  DotMatrix,
  MetricPill,
  OrganChip,
  PhScale,
  SparklineChip,
  formatMetric,
} from '../components/primitives';
import styles from './panels.module.css';

/**
 * PER-ORGAN PANELS (spec 8.2, 8.3).
 *
 * The HUD metric cluster is top-left, a vertical stack, left-aligned, and it never
 * overlaps the body. Which rows appear is decided by the selected organ's `panel`
 * field in data/organs.json, so adding an organ does not mean editing a switch here.
 *
 * Every number shown is a computed output of the state vector. Nothing on this
 * screen is a stored display value, and anything the engine does not have renders as
 * an em-dash rather than a plausible number.
 */

/** Rolling history for the sparkline chips, sampled at snapshot rate. */
function useSeries(value: number | null | undefined, length = 48): number[] {
  const ref = useRef<number[]>([]);
  const [, force] = useState(0);
  useEffect(() => {
    if (value === null || value === undefined || !Number.isFinite(value)) return;
    ref.current.push(value);
    if (ref.current.length > length) ref.current.shift();
    force((n) => (n + 1) % 1000);
  }, [value, length]);
  return ref.current;
}

export interface PanelProps {
  snapshot: SimSnapshot;
  organ: OrganDef;
  ring: WaveformRing | null;
  channelIndex: (c: 'ecg' | 'eeg' | 'abp' | 'resp') => number;
}

/* --------------------------------------------------------------- cardiac */

export function CardiacPanel({ snapshot, organ, ring, channelIndex }: PanelProps) {
  const c = snapshot.cardio;
  const co = useSeries(c.cardiacOutput_L_per_min);
  const map = useSeries(c.map_mmHg);
  const cpp = useSeries(c.coronaryPerfusionPressure_mmHg);

  return (
    <>
      <div className={styles.row}>
        <OrganChip name={organ.displayName} />
        <MetricPill
          value={snapshot.resp.spo2 * 100}
          digits={1}
          unit="%"
          ariaLabel={`Oxygen saturation ${(snapshot.resp.spo2 * 100).toFixed(1)} per cent`}
        />
      </div>

      <div className={styles.row}>
        <MetricPill value={c.heartRateDisplay_bpm} digits={0} trendKey="hr" trendMinSpan={8} ariaLabel={`Heart rate ${formatMetric(c.heartRateDisplay_bpm)} beats per minute`}>
          <span className={styles.heartGlyph} aria-hidden="true">{'♥'}</span>
        </MetricPill>
        <span className={styles.rhythm}>{RHYTHM_LABEL[c.rhythm]}</span>
      </div>

      <WaveformStrip
        ring={ring}
        channel="ecg"
        channelIndex={channelIndex('ecg')}
        range={1.6}
        color="#c0392b"
        width={208}
        height={40}
        calibration
        label={`Electrocardiogram, lead two, ${RHYTHM_LABEL[c.rhythm]}, rate ${formatMetric(c.heartRateDisplay_bpm)} per minute`}
      />

      <div className={styles.row}>
        <MetricPill label="EF" value={c.ejectionFraction * 100} digits={0} unit="%" trendKey="ef" trendMinSpan={0.05} ariaLabel={`Ejection fraction ${(c.ejectionFraction * 100).toFixed(0)} per cent`} />
        <BloodPressurePill systolic={c.systolic_mmHg} diastolic={c.diastolic_mmHg} />
      </div>

      <div className={styles.row}>
        <SparklineChip
          badge="R"
          label={`Cardiac output ${c.cardiacOutput_L_per_min.toFixed(1)} litres per minute, mean arterial pressure ${c.map_mmHg.toFixed(0)}, coronary perfusion pressure ${c.coronaryPerfusionPressure_mmHg.toFixed(0)}`}
          series={[
            { color: '#7fd6ee', points: co },
            { color: '#8b5cf6', points: map },
            { color: '#f0a93b', points: cpp },
          ]}
        />
      </div>

      <div className={styles.detail}>
        <span>CO {formatMetric(c.cardiacOutput_L_per_min, 1)} L/min</span>
        <span>SV {formatMetric(c.strokeVolume_mL, 0)} mL</span>
        <span>EDV {formatMetric(c.edv_mL, 0)}</span>
        <span>ESV {formatMetric(c.esv_mL, 0)}</span>
        <span>CVP {formatMetric(c.centralVenousPressure_mmHg, 0)}</span>
        <span>CPP {formatMetric(c.coronaryPerfusionPressure_mmHg, 0)}</span>
      </div>
    </>
  );
}

const RHYTHM_LABEL: Record<SimSnapshot['cardio']['rhythm'], string> = {
  nsr: 'Sinus rhythm',
  sinus_tach: 'Sinus tachycardia',
  sinus_brad: 'Sinus bradycardia',
  afib: 'Atrial fibrillation',
  vt: 'Ventricular tachycardia',
  vfib: 'Ventricular fibrillation',
  asystole: 'Asystole',
  pea: 'Pulseless electrical activity',
};

/* ----------------------------------------------------------- respiratory */

function LungPanel({ snapshot, organ, ring, channelIndex }: PanelProps) {
  const r = snapshot.resp;
  const spo2 = useSeries(r.spo2 * 100);
  const paco2 = useSeries(r.paco2_mmHg);
  const mv = useSeries(r.minuteVentilation_L_per_min);

  return (
    <>
      <div className={styles.row}>
        <OrganChip name={organ.displayName} />
        <MetricPill value={r.spo2 * 100} digits={1} unit="%" trendKey="spo2" trendMinSpan={0.02} ariaLabel={`Oxygen saturation ${(r.spo2 * 100).toFixed(1)} per cent`} />
      </div>

      <div className={styles.row}>
        <MetricPill label="RR" value={r.rate_per_min} digits={0} unit="/min" trendKey="rr" trendMinSpan={3} />
        <MetricPill label="Vt" value={r.tidalVolume_mL} digits={0} unit="mL" trendKey="tidalVolume" trendMinSpan={60} />
      </div>

      <WaveformStrip
        ring={ring}
        channel="resp"
        channelIndex={channelIndex('resp')}
        range={1.2}
        color="#3b7ea1"
        width={208}
        height={36}
        label={`Respiratory waveform, rate ${r.rate_per_min.toFixed(0)} per minute, tidal volume ${r.tidalVolume_mL.toFixed(0)} millilitres`}
      />

      <div className={styles.row}>
        <MetricPill label="PaO2" value={r.pao2_mmHg} digits={0} unit="mmHg" trendKey="pao2" trendMinSpan={8} />
        <MetricPill label="PaCO2" value={r.paco2_mmHg} digits={0} unit="mmHg" trendKey="paco2" trendMinSpan={4} />
      </div>

      <div className={styles.row}>
        <SparklineChip
          badge={r.apnoeic ? '!' : '↑'}
          label={`Saturation ${(r.spo2 * 100).toFixed(0)} per cent, arterial carbon dioxide ${r.paco2_mmHg.toFixed(0)}, minute ventilation ${r.minuteVentilation_L_per_min.toFixed(1)} litres per minute`}
          series={[
            { color: '#7fd6ee', points: spo2 },
            { color: '#e24be8', points: paco2 },
            { color: '#f0a93b', points: mv },
          ]}
        />
      </div>

      <div className={styles.detail}>
        <span>MV {formatMetric(r.minuteVentilation_L_per_min, 1)} L/min</span>
        <span>EtCO2 {formatMetric(r.etco2_mmHg, 0)}</span>
        {r.intubated && <span className={styles.badge}>Intubated</span>}
        {r.apnoeic && <span className={styles.badgeWarn}>Apnoeic</span>}
      </div>
    </>
  );
}

/* ----------------------------------------------------------------- renal */

export function RenalPanel({ snapshot, organ }: PanelProps) {
  const r = snapshot.renal;
  const gfr = useSeries(r.gfr_mL_per_min);
  const uo = useSeries(r.urineOutput_mL_per_min * 60);

  return (
    <>
      <div className={styles.row}>
        <OrganChip name={organ.displayName} />
        <MetricPill label="GFR" value={r.gfr_mL_per_min} digits={0} unit="mL/min" trendKey="gfr" trendMinSpan={10} />
      </div>

      <div className={styles.row}>
        <MetricPill
          value={r.bladderVolume_mL}
          digits={0}
          unit="mL"
          fill={r.bladderFillFraction}
          ariaLabel={`Bladder volume ${r.bladderVolume_mL.toFixed(0)} millilitres, ${(r.bladderFillFraction * 100).toFixed(0)} per cent of capacity`}
        />
      </div>

      <div className={styles.row}>
        <SparklineChip
          badge={'↓'}
          label={`Glomerular filtration rate ${r.gfr_mL_per_min.toFixed(0)} millilitres per minute, urine output ${(r.urineOutput_mL_per_min * 60).toFixed(0)} millilitres per hour`}
          series={[
            { color: '#7fd6ee', points: gfr },
            { color: '#f0a93b', points: uo },
          ]}
        />
      </div>

      <div className={styles.detail}>
        <span>RBF {formatMetric(r.renalBloodFlow_mL_per_min, 0)} mL/min</span>
        <span>UO {formatMetric(r.urineOutput_mL_per_min * 60, 0)} mL/h</span>
        <span>Cr {formatMetric(r.creatinine_mg_per_dL, 2)}</span>
        <span
          className={r.autoregulationFactor < 0.98 ? styles.badgeWarn : styles.badge}
          title="Autoregulation holds GFR flat between MAP 80 and 180. Below 80 it falls away, and renal drug clearance falls with it."
        >
          Autoreg {(r.autoregulationFactor * 100).toFixed(0)} %
        </span>
      </div>
    </>
  );
}

/* --------------------------------------------------------------- gastric */

export function GastricPanel({ snapshot, organ }: PanelProps) {
  const g = snapshot.gi;
  const glucose = useSeries(snapshot.metabolic.glucose_mg_per_dL);
  const insulin = useSeries(snapshot.metabolic.insulin_uU_per_mL);
  const absorption = useSeries(g.glucoseAbsorption_mg_per_min);
  const volume = useSeries(g.gastricVolume_mL);
  const ph = useSeries(g.gastricPh);

  return (
    <>
      <div className={styles.row}>
        <OrganChip name={organ.displayName} />
      </div>

      <div className={styles.row}>
        <MetricPill
          value={g.gastricVolume_mL}
          digits={0}
          unit="mL"
          fill={g.gastricFillFraction}
          ariaLabel={`Gastric volume ${g.gastricVolume_mL.toFixed(0)} millilitres`}
        />
      </div>

      <div className={styles.row}>
        <PhScale ph={g.gastricPh} />
      </div>

      <div className={styles.row}>
        <SparklineChip
          badge={'↓'}
          label={`Absorption: plasma glucose ${snapshot.metabolic.glucose_mg_per_dL.toFixed(0)} milligrams per decilitre, insulin ${snapshot.metabolic.insulin_uU_per_mL.toFixed(0)} microunits per millilitre, glucose appearance ${g.glucoseAbsorption_mg_per_min.toFixed(0)} milligrams per minute`}
          series={[
            { color: '#7fd6ee', points: glucose },
            { color: '#8b5cf6', points: insulin },
            { color: '#ff2d6b', points: absorption },
          ]}
        />
      </div>
      <div className={styles.row}>
        <SparklineChip
          badge={'↑'}
          label={`Emptying: gastric volume ${g.gastricVolume_mL.toFixed(0)} millilitres, pH ${g.gastricPh.toFixed(1)}`}
          series={[
            { color: '#a9bcf5', points: volume },
            { color: '#f0a93b', points: ph },
          ]}
        />
      </div>

      <div className={styles.detail}>
        <span>Glucose {formatMetric(snapshot.metabolic.glucose_mg_per_dL, 0)} mg/dL</span>
        <span>In transit {g.digesta.length}</span>
      </div>
    </>
  );
}

/* ----------------------------------------------------------------- neuro */

export function NeuroPanel({ snapshot, organ, ring, channelIndex }: PanelProps) {
  const n = snapshot.neuro;
  return (
    <>
      <div className={styles.row}>
        <OrganChip name={organ.displayName} />
        <MetricPill value={n.consciousness * 100} digits={0} unit="%" ariaLabel={`Consciousness index ${(n.consciousness * 100).toFixed(0)} per cent`} />
      </div>

      <WaveformStrip
        ring={ring}
        channel="eeg"
        channelIndex={channelIndex('eeg')}
        range={45}
        color="#6b4fa8"
        width={208}
        height={40}
        label={`Electroencephalogram, dominant band ${n.eegBand}`}
      />

      <div className={styles.row}>
        <MetricPill label="Band" value={null} ariaLabel={`Dominant electroencephalogram band ${n.eegBand}`}>
          <span aria-hidden="true" className={styles.bandValue}>{n.eegBand}</span>
        </MetricPill>
        <MetricPill label="CBF" value={n.cerebralBloodFlow_mL_per_min} digits={0} unit="mL/min" trendMinSpan={40} />
      </div>

      <div className={styles.detail}>
        <span>Sedation {(n.sedationLevel * 100).toFixed(0)} %</span>
      </div>
    </>
  );
}

/* --------------------------------------------------------------- hepatic */

function LiverPanel({ snapshot, organ }: PanelProps) {
  const m = snapshot.metabolic;
  const glucose = useSeries(m.glucose_mg_per_dL);
  const lactate = useSeries(snapshot.chem.lactate_mmol_per_L);
  return (
    <>
      <div className={styles.row}>
        <OrganChip name={organ.displayName} />
        <MetricPill label="Glu" value={m.glucose_mg_per_dL} digits={0} unit="mg/dL" trendKey="glucose" trendMinSpan={10} />
      </div>
      <div className={styles.row}>
        <MetricPill label="Ins" value={m.insulin_uU_per_mL} digits={1} unit="uU/mL" trendKey="insulin" trendMinSpan={2} />
        <MetricPill label="Lac" value={snapshot.chem.lactate_mmol_per_L} digits={1} unit="mmol/L" trendKey="lactate" trendMinSpan={0.4} />
      </div>
      <div className={styles.row}>
        <SparklineChip
          badge="M"
          label={`Glucose ${m.glucose_mg_per_dL.toFixed(0)}, lactate ${snapshot.chem.lactate_mmol_per_L.toFixed(1)}`}
          series={[
            { color: '#7fd6ee', points: glucose },
            { color: '#ff2d6b', points: lactate },
          ]}
        />
      </div>
      <div className={styles.detail}>
        <span>Glucagon drive {(m.glucagonDrive * 100).toFixed(0)} %</span>
        <span>Temp {formatMetric(m.coreTemp_C, 1)} C</span>
      </div>
    </>
  );
}

/* -------------------------------------------------------------------- gi */

function TractPanel({ snapshot, organ }: PanelProps) {
  const g = snapshot.gi;
  return (
    <>
      <div className={styles.row}>
        <OrganChip name={organ.displayName} />
        <MetricPill value={g.digesta.length} digits={0} ariaLabel={`${g.digesta.length} parcels in transit`} />
      </div>
      <ul className={styles.transitList}>
        {g.digesta.length === 0 && <li className={styles.transitEmpty}>Tract empty</li>}
        {g.digesta.slice(0, 6).map((d) => (
          <li key={d.id}>
            <span className={styles.transitLabel}>{d.label}</span>
            <span className={styles.transitSegment}>{d.segment.replace(/_/g, ' ')}</span>
            <span className={styles.transitBar}>
              <span style={{ width: `${Math.round(d.s * 100)}%` }} />
            </span>
            <span className={styles.transitVolume}>{d.volume_mL.toFixed(0)} mL</span>
          </li>
        ))}
      </ul>
      <div className={styles.detail}>
        <span>Glucose in {formatMetric(g.glucoseAbsorption_mg_per_min, 0)} mg/min</span>
      </div>
    </>
  );
}

/* --------------------------------------------------------------- bladder */

export function BladderPanel({ snapshot, organ }: PanelProps) {
  const r = snapshot.renal;
  return (
    <>
      <div className={styles.row}>
        <OrganChip name={organ.displayName} />
        <MetricPill
          value={r.bladderVolume_mL}
          digits={0}
          unit="mL"
          fill={r.bladderFillFraction}
          ariaLabel={`Bladder volume ${r.bladderVolume_mL.toFixed(0)} millilitres`}
        />
      </div>
      <div className={styles.detail}>
        <span>Filling at {formatMetric(r.urineOutput_mL_per_min * 60, 0)} mL/h</span>
        {r.bladderVolume_mL > 300 && <span className={styles.badgeWarn}>Urge</span>}
      </div>
    </>
  );
}

/* ------------------------------------------------- organs without a rig of their own */

/**
 * ORGAN TELEMETRY FOR THE ORGANS THAT HAVE NO DEDICATED PANEL.
 *
 * Most organs used to show one apologetic sentence. The engine does know something
 * about almost all of them, just not in a block named after the organ: the pupil lives
 * in `mind`, the thyroid's hormone in `endocrine.hormones`, the ovary's follicle in
 * `reproductive.cycle`. This table says which existing snapshot fields speak for
 * which organ. A field appears here only if SimSnapshot really carries it, with the
 * unit the type documents; where the engine has no number (oestradiol, testosterone,
 * LH, FSH, oxytocin, adrenaline levels, metabolic rate) the panel leaves it out
 * rather than inventing one, and says so in one line where that is the main story.
 * No reference ranges are drawn: none were supplied for these fields.
 */
interface Chip {
  label: string;
  value: number | null | undefined;
  digits?: number;
  unit?: string;
}
interface Telemetry {
  /** At most four, shown two to a row. */
  chips: Chip[];
  /** State words (a phase, not an enum code), shown in the small detail line. */
  words?: string[];
  caption?: string;
}

const CYCLE_WORD: Record<SimSnapshot['reproductive']['cycle']['phase'], string> = {
  menstrual: 'menstrual',
  follicular: 'follicular',
  ovulation: 'ovulatory',
  luteal: 'luteal',
};

function hormone(s: SimSnapshot, id: string): { level: number; unit: string } | null {
  const h = s.endocrine.hormones.find((x) => x.id === id);
  return h ? { level: h.level, unit: h.unit } : null;
}

function hormoneChip(s: SimSnapshot, id: string, label: string, digits: number): Chip {
  const h = hormone(s, id);
  return { label, value: h ? h.level : null, digits, unit: h?.unit };
}

/**
 * Hormone chips for the ids that exist in THIS body. The hormone list is runtime data:
 * a male body carries testosterone but no LH, FSH or oestradiol; a cycling female
 * carries LH, FSH, oestradiol and progesterone; a pregnant one swaps in hCG and
 * prolactin. A hormone the list lacks is simply not drawn, never shown as a dash.
 */
function presentHormones(s: SimSnapshot, spec: [id: string, label: string, digits: number][]): Chip[] {
  return spec.filter(([id]) => hormone(s, id) !== null).map(([id, label, d]) => hormoneChip(s, id, label, d));
}

function telemetryFor(id: string, s: SimSnapshot): Telemetry | null {
  const repro = s.reproductive;
  const sex = repro.sexual;
  const cycle = repro.cycle;
  const preg = repro.pregnancy;
  const glands = s.anatomy.glands;
  const nerves = s.anatomy.nerves;
  const pct = (x: number) => x * 100;
  switch (id) {
    case 'eyes':
      return {
        chips: [
          { label: 'Pupil', value: s.mind.pupil_mm, digits: 1, unit: 'mm' },
          { label: 'Consc', value: pct(s.neuro.consciousness), digits: 0, unit: '%' },
        ],
      };
    case 'mouth':
      return {
        chips: [
          { label: 'Osm', value: s.fluids.osmolality_mOsm_per_kg, digits: 0, unit: 'mOsm/kg' },
          { label: 'Nausea', value: pct(s.mind.nausea), digits: 0, unit: '%' },
        ],
        caption: 'Chewing, taste, speech and saliva volume are not simulated. The swallow is drawn as a gesture when the engine signals swallowing. Plasma osmolality is shown because it is what thirst would follow.',
      };
    case 'salivary_glands':
      return {
        chips: [
          { label: 'Para', value: pct(nerves.parasympathetic), digits: 0, unit: '%' },
          { label: 'Symp', value: pct(nerves.sympathetic), digits: 0, unit: '%' },
        ],
        caption: 'Saliva flow is not simulated. The glands are shown against autonomic outflow above rest, and the droplets in the ducts move faster as parasympathetic drive rises (a display, not a flow rate).',
      };
    case 'pharynx':
      return {
        chips: [
          { label: 'RR', value: s.resp.rate_per_min, digits: 0, unit: '/min' },
          { label: 'Nausea', value: pct(s.mind.nausea), digits: 0, unit: '%' },
        ],
        caption: 'Air and food share this passage. The swallow is drawn as a squeezing wave when the engine signals swallowing; its timing is a display choice. Breathing rate and nausea are the live readings.',
      };
    case 'nasal_cavity':
      return {
        chips: [
          { label: 'RR', value: s.resp.rate_per_min, digits: 0, unit: '/min' },
          { label: 'FiO2', value: pct(s.environment.fio2), digits: 0, unit: '%' },
        ],
        caption: 'Smell and the resistance of the nasal airway are not simulated. Air moves with each breath; the cilia sweep at a fixed display pace.',
      };
    case 'ears':
      return {
        chips: [],
        caption: 'Hearing and balance are not simulated, so no ear reading is shown. The vestibular apparatus lights only while vertigo is active in the engine.',
      };
    case 'skull':
    case 'vertebral_column':
    case 'thoracic_cage':
    case 'upper_limb_bones':
    case 'lower_limb_bones':
      return {
        chips: [hormoneChip(s, 'epo', 'EPO', 1), { label: 'Hct', value: pct(s.chem.haematocrit), digits: 0, unit: '%' }],
        caption: 'Bone itself, calcium and bone remodelling are not simulated. Red cells are made in the marrow in response to EPO, so those two readings are shown.',
      };
    case 'head_neck_muscles':
    case 'chest_wall_muscles':
    case 'abdominal_wall_muscles':
    case 'back_muscles':
    case 'shoulder_arm_muscles':
    case 'hip_thigh_muscles':
    case 'pelvic_floor_muscles':
    case 'pelvic_floor_muscles_female':
      // ONE honest set of readings for every muscle group, because the engine has no per-muscle
      // state: only whole-body skeletal muscle tone, the exertion the body is performing, and the
      // somatic motor outflow (which the engine raises for voluntary effort, shivering and a
      // seizure alike, so it is the only place shivering shows). A group-specific reading
      // would be invented. The words line says when a seizure is under way.
      return {
        chips: [
          { label: 'Tone', value: s.mind.muscleTone, digits: 2 },
          { label: 'Exertion', value: pct(s.behaviour.exertion), digits: 0, unit: '%' },
          { label: 'Motor', value: pct(nerves.motor), digits: 0, unit: '%' },
        ],
        words: s.mind.seizing ? ['Seizing'] : undefined,
        caption: 'Tone: -1 flaccid, 0 normal, +1 rigid, for the whole body. Motor outflow is above rest and includes effort, shivering and a seizure. Muscle force, fatigue and the metabolism of each muscle are not simulated, so no reading is shown for them.',
      };
    case 'spinal_cord':
      return {
        chips: [
          { label: 'Tone', value: s.mind.muscleTone, digits: 2 },
          { label: 'Motor', value: pct(nerves.motor), digits: 0, unit: '%' },
          { label: 'Symp', value: pct(nerves.sympathetic), digits: 0, unit: '%' },
          { label: 'Para', value: pct(nerves.parasympathetic), digits: 0, unit: '%' },
        ],
        caption: 'Tone: -1 flaccid, 0 normal, +1 rigid. Outflow is above rest.',
      };
    case 'trachea':
      return {
        chips: [
          { label: 'Narrowing', value: pct(s.fluids.bronchoconstriction), digits: 0, unit: '%' },
          { label: 'FiO2', value: pct(s.environment.fio2), digits: 0, unit: '%' },
          { label: 'RR', value: s.resp.rate_per_min, digits: 0, unit: '/min' },
        ],
      };
    case 'diaphragm':
      return {
        chips: [
          { label: 'RR', value: s.resp.rate_per_min, digits: 0, unit: '/min' },
          { label: 'Vt', value: s.resp.tidalVolume_mL, digits: 0, unit: 'mL' },
          { label: 'MV', value: s.resp.minuteVentilation_L_per_min, digits: 1, unit: 'L/min' },
          { label: 'Tone', value: s.mind.muscleTone, digits: 2 },
        ],
        words: s.resp.apnoeic ? ['apnoeic'] : undefined,
      };
    case 'oesophagus':
      return {
        chips: [
          { label: 'Nausea', value: pct(s.mind.nausea), digits: 0, unit: '%' },
          { label: 'Vomited', value: s.mind.vomitus_mL, digits: 0, unit: 'mL' },
        ],
        words: [s.mind.vomiting ? 'vomiting now' : 'not vomiting'],
      };
    case 'pancreas':
      return {
        chips: [
          { label: 'Glu', value: s.metabolic.glucose_mg_per_dL, digits: 0, unit: 'mg/dL' },
          { label: 'Ins', value: s.metabolic.insulin_uU_per_mL, digits: 1, unit: 'uU/mL' },
          hormoneChip(s, 'glucagon', 'Glucagon', 0),
        ],
      };
    case 'spleen':
      return {
        chips: [
          { label: 'Plt', value: s.coagulation.platelets_10e9_per_L, digits: 0, unit: 'x10^9/L' },
          { label: 'Hct', value: pct(s.chem.haematocrit), digits: 0, unit: '%' },
          { label: 'WBC', value: s.infection.wbc_10e9_per_L, digits: 1, unit: 'x10^9/L' },
        ],
      };
    case 'thyroid':
      return {
        chips: [
          hormoneChip(s, 'thyroxine', 'fT4', 2),
          { label: 'Output', value: glands.thyroid, digits: 2, unit: 'x basal' },
          { label: 'Core', value: s.metabolic.coreTemp_C, digits: 1, unit: 'C' },
        ],
      };
    case 'thymus':
      return {
        chips: [
          { label: 'WBC', value: s.infection.wbc_10e9_per_L, digits: 1, unit: 'x10^9/L' },
          { label: 'CD4', value: s.infection.cd4_per_uL, digits: 0, unit: '/uL' },
          { label: 'Immune', value: pct(s.infection.immuneActivation), digits: 0, unit: '%' },
        ],
        words: [`${s.infection.active.length} active infection${s.infection.active.length === 1 ? '' : 's'}`],
      };
    case 'adrenal_l':
    case 'adrenal_r':
      return {
        chips: [
          hormoneChip(s, 'cortisol', 'Cortisol', 1),
          hormoneChip(s, 'aldosterone', 'Aldo', 1),
          { label: 'Medulla', value: glands.adrenal_medulla, digits: 2, unit: 'x basal' },
        ],
        caption: 'Catecholamine levels are not reported; medulla is secretion against its own rest.',
      };
    case 'ureters':
      return {
        chips: [
          { label: 'Urine', value: s.renal.urineOutput_mL_per_min * 60, digits: 0, unit: 'mL/h' },
          { label: 'GFR', value: s.renal.gfr_mL_per_min, digits: 0, unit: 'mL/min' },
        ],
      };
    case 'ovaries':
      return {
        chips: presentHormones(s, [['estradiol', 'E2', 0], ['progesterone', 'P4', 1], ['lh', 'LH', 1], ['fsh', 'FSH', 1]]),
        // Follicle and corpus luteum are 0..1 growth states, so they sit in the detail line
        // to keep the chips to two rows.
        words: cycle.active
          ? [`day ${cycle.day.toFixed(0)}`, `phase: ${CYCLE_WORD[cycle.phase]}`, `follicle ${pct(cycle.follicle).toFixed(0)} %`, `luteum ${pct(cycle.corpusLuteum).toFixed(0)} %`]
          : [preg.pregnant ? 'cycle suspended: pregnant' : 'cycle not active'],
      };
    case 'uterus':
      return preg.pregnant
        ? {
            chips: [
              ...presentHormones(s, [['hcg', 'hCG', 0], ['progesterone', 'P4', 1], ['oxytocin', 'Oxt', 1]]),
              { label: 'FHR', value: preg.fetalHeartRate_bpm, digits: 0, unit: '/min' },
            ],
            words: [`${preg.gestationWeeks.toFixed(1)} wk`, `trimester ${preg.trimester}`, ...(preg.amnioticFluid_mL === null ? [] : [`amniotic ${preg.amnioticFluid_mL.toFixed(0)} mL`])],
          }
        : {
            chips: [
              { label: 'Endometrium', value: cycle.active ? pct(cycle.endometrium) : null, digits: 0, unit: '%' },
              ...presentHormones(s, [['oxytocin', 'Oxt', 1]]),
            ],
            words: [cycle.active ? `day ${cycle.day.toFixed(0)}` : 'cycle not active', ...(cycle.active ? [`phase: ${CYCLE_WORD[cycle.phase]}`] : []), ...(cycle.menstruating ? ['menstruating'] : [])],
          };
    case 'vagina':
      return {
        chips: [
          { label: 'Vasocongestion', value: pct(sex.vasocongestion), digits: 0, unit: '%' },
          ...presentHormones(s, [['estradiol', 'E2', 0]]),
        ],
        words: [`phase: ${sex.phase}`, `arousal ${pct(sex.arousal).toFixed(0)} %`],
      };
    case 'breasts':
      return {
        chips: presentHormones(s, [['prolactin', 'PRL', 1], ['oxytocin', 'Oxt', 1], ['estradiol', 'E2', 0], ['progesterone', 'P4', 1]]),
        words: [
          cycle.active ? `cycle: ${CYCLE_WORD[cycle.phase]}` : preg.pregnant ? `gestation ${preg.gestationWeeks.toFixed(0)} wk` : 'cycle not active',
          ...(sex.prolactinRaised === undefined ? [] : [`post-orgasmic prolactin rise ${pct(sex.prolactinRaised).toFixed(0)} %`]),
        ],
      };
    case 'testes':
      return {
        chips: presentHormones(s, [['testosterone', 'T', 0], ['lh', 'LH', 1], ['fsh', 'FSH', 1]]),
      };
    case 'prostate':
      return {
        chips: [
          ...presentHormones(s, [['testosterone', 'T', 0]]),
          { label: 'Arousal', value: pct(sex.arousal), digits: 0, unit: '%' },
        ],
        words: [`phase: ${sex.phase}`, `orgasms ${sex.orgasms}`],
      };
    case 'penis':
      return {
        chips: [
          { label: 'Vasocongestion', value: pct(sex.vasocongestion), digits: 0, unit: '%' },
          { label: 'Refractory', value: sex.refractory_s, digits: 0, unit: 's' },
        ],
        words: [`phase: ${sex.phase}`],
      };
    case 'fetus':
      return {
        chips: [
          { label: 'Gestation', value: preg.gestationWeeks, digits: 1, unit: 'wk' },
          { label: 'Weight', value: preg.fetalWeight_g, digits: 0, unit: 'g' },
          { label: 'FHR', value: preg.fetalHeartRate_bpm, digits: 0, unit: '/min' },
        ],
        caption: 'Fetal circulation is drawn, not simulated.',
      };
    default:
      return null;
  }
}

/** Shown for organs the snapshot says nothing specific about. */
const QUIET_NOTE: Record<string, string> = {
  gallbladder: 'No bile or gallbladder state is simulated. Digestive load shows in the stomach and gut panels.',
};

export function OrganTelemetryPanel({ snapshot, organ }: PanelProps) {
  const t = telemetryFor(organ.id, snapshot);
  if (!t) {
    return (
      <>
        <div className={styles.row}>
          <OrganChip name={organ.displayName} />
        </div>
        <div className={styles.detail}>
          <span>MAP {formatMetric(snapshot.cardio.map_mmHg, 0)} mmHg</span>
          <span>SpO2 {formatMetric(snapshot.resp.spo2 * 100, 0)} %</span>
          <span className={styles.noteText}>
            {QUIET_NOTE[organ.id] ?? 'Nothing organ-specific is simulated; perfusion and oxygenation above apply.'}
          </span>
        </div>
      </>
    );
  }
  // Two chips to a row keeps this to two rows at 390 px, as the heart and lung panels do.
  const rows: Chip[][] = [];
  for (let i = 0; i < t.chips.length; i += 2) rows.push(t.chips.slice(i, i + 2));
  return (
    <>
      <div className={styles.row}>
        <OrganChip name={organ.displayName} />
      </div>
      {rows.map((r) => (
        <div className={styles.row} key={r[0].label}>
          {r.map((c) => (
            <MetricPill key={c.label} label={c.label} value={c.value} digits={c.digits ?? 0} unit={c.unit} />
          ))}
        </div>
      ))}
      {(t.words?.length || t.caption) && (
        <div className={styles.detail}>
          {t.words?.map((w) => (
            <span key={w}>{w}</span>
          ))}
          {t.caption && <span>{t.caption}</span>}
        </div>
      )}
    </>
  );
}

/** Organs that share a panel name with a richer sibling choose by id. */
const TELEMETRY_ONLY = new Set(['trachea', 'diaphragm', 'oesophagus', 'gallbladder']);

export function RespiratoryPanel(p: PanelProps) {
  return TELEMETRY_ONLY.has(p.organ.id) ? <OrganTelemetryPanel {...p} /> : <LungPanel {...p} />;
}
export function HepaticPanel(p: PanelProps) {
  return TELEMETRY_ONLY.has(p.organ.id) ? <OrganTelemetryPanel {...p} /> : <LiverPanel {...p} />;
}
export function GiPanel(p: PanelProps) {
  return TELEMETRY_ONLY.has(p.organ.id) ? <OrganTelemetryPanel {...p} /> : <TractPanel {...p} />;
}

export const GenericPanel = OrganTelemetryPanel;

export const PANELS = {
  cardiac: CardiacPanel,
  respiratory: RespiratoryPanel,
  renal: RenalPanel,
  gastric: GastricPanel,
  neuro: NeuroPanel,
  hepatic: HepaticPanel,
  gi: GiPanel,
  bladder: BladderPanel,
  generic: GenericPanel,
  // Panel names organs.json uses that had no entry and so fell to generic.
  ocular: OrganTelemetryPanel,
  spinal: OrganTelemetryPanel,
  endocrine: OrganTelemetryPanel,
  pancreatic: OrganTelemetryPanel,
  reproductive: OrganTelemetryPanel,
  fetal: OrganTelemetryPanel,
  headneck: OrganTelemetryPanel,
  skeletal: OrganTelemetryPanel,
  muscular: OrganTelemetryPanel,
} as const;

export function ConditionStack({ conditions }: { conditions: SimSnapshot['conditions'] }) {
  return (
    <div className={styles.conditions} data-conditions>
      {conditions.map((c) => (
        <ConditionTag key={c.id} tag={c} />
      ))}
    </div>
  );
}

export { DotMatrix };
