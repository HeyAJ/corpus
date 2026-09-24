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

export function RespiratoryPanel({ snapshot, organ, ring, channelIndex }: PanelProps) {
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

export function HepaticPanel({ snapshot, organ }: PanelProps) {
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

export function GiPanel({ snapshot, organ }: PanelProps) {
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

/* --------------------------------------------------------------- generic */

export function GenericPanel({ snapshot, organ }: PanelProps) {
  return (
    <>
      <div className={styles.row}>
        <OrganChip name={organ.displayName} />
      </div>
      <div className={styles.detail}>
        <span>MAP {formatMetric(snapshot.cardio.map_mmHg, 0)} mmHg</span>
        <span>SpO2 {formatMetric(snapshot.resp.spo2 * 100, 0)} %</span>
        <span className={styles.noteText}>
          No dedicated telemetry is modelled for this organ. It is shown so the anatomy is complete,
          and the whole-body numbers above still apply to it.
        </span>
      </div>
    </>
  );
}

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
} as const;

export function ConditionStack({ conditions }: { conditions: SimSnapshot['conditions'] }) {
  return (
    <div className={styles.conditions}>
      {conditions.map((c) => (
        <ConditionTag key={c.id} tag={c} />
      ))}
    </div>
  );
}

export { DotMatrix };
