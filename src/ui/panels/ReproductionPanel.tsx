import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { HormoneSnapshot, SexualPhase } from '../../bridge/types';
import { useStore } from '../store';
import styles from './reproduction.module.css';

/**
 * REPRODUCTION PANEL — the body's sex, its menstrual cycle, pregnancy and sexual response.
 *
 * Written in the register of an anatomy and physiology textbook: the panel names organs,
 * hormones and phases and shows the numbers the engine computed; it does not describe
 * experience. Everything on it comes from `snapshot.reproductive` and the ordinary
 * snapshot blocks. Nothing is imported from the data files, so the panel builds and
 * renders whether or not the engine side has finished, and an absent hormone simply draws
 * no row rather than a row of dashes.
 *
 * THE SHEET IS SMALL. The panel lives in the single floating sheet (about 340 px on a
 * wide screen, at most 46vh on a phone), so each topic is a native <details> section and
 * only the one relevant to the current body is open to begin with. <details> gives
 * keyboard and screen-reader behaviour for free, which a hand-made accordion would have
 * to be taught.
 *
 * NO NUMBER ENTRY. Every control is a slider or a button, as everywhere in CORPUS: the
 * operator chooses a cause from a bounded range and reads the consequence back.
 *
 * SLIDERS THAT KEEP THEIR OWN VALUE. The cycle day, gestational age and stimulation are
 * all values the engine also moves by itself (the clock runs on in a time-lapse; arousal
 * is not the stimulation but the stimulation is operator-owned). If a slider simply
 * showed the 10 Hz readback it would stutter under the thumb, so a drag is held locally
 * for a moment after the last change and then the slider returns to following the engine.
 */

/* ---------------------------------------------------------------- pacing choices */

/**
 * TIME-LAPSE PRESETS. These three numbers are PACING CHOICES OF THE INTERFACE, not
 * physiology and not data: how long the operator is willing to watch a cycle or a
 * pregnancy. The only physiological quantities involved (a 29-day cycle, a 280-day
 * pregnancy) are the model's own, and the cycle length is read back from the snapshot
 * for display. The simulation speed is raised together with the reproductive clock
 * because the slow physiology that responds to the cycle and to pregnancy (plasma
 * volume, temperature, hormones) runs on the ordinary simulation clock and would
 * otherwise sit still while the calendar raced past.
 */
const REAL_TIME_DAYS_PER_S = 1 / 86400;
const LAPSE_TIME_SCALE = 300;
const CYCLE_MODEL_DAYS = 29;
const CYCLE_WALL_SECONDS = 60;
const PREGNANCY_MODEL_DAYS = 280;
const PREGNANCY_WALL_SECONDS = 180;

const LAPSES = [
  {
    id: 'real',
    label: 'Real time',
    scale: 1,
    daysPerS: REAL_TIME_DAYS_PER_S,
  },
  {
    id: 'cycle',
    label: 'One cycle in about a minute',
    scale: LAPSE_TIME_SCALE,
    daysPerS: CYCLE_MODEL_DAYS / (CYCLE_WALL_SECONDS * LAPSE_TIME_SCALE),
  },
  {
    id: 'pregnancy',
    label: '40 weeks in about 3 minutes',
    scale: LAPSE_TIME_SCALE,
    daysPerS: PREGNANCY_MODEL_DAYS / (PREGNANCY_WALL_SECONDS * LAPSE_TIME_SCALE),
  },
] as const;

/** How long a dragged slider keeps its own value before following the engine again. */
const HOLD_MS = 1500;
/** The cycle-day dispatch rate while dragging: about ten per second. */
const THROTTLE_MS = 100;
/** How long after the last slider change the single timeline entry is written. */
const ANNOUNCE_MS = 700;
/** Prolactin is called raised above this fraction of its development. */
const PROLACTIN_RAISED_ABOVE = 0.05;

const SEXUAL_PHASES: { id: SexualPhase; label: string }[] = [
  { id: 'rest', label: 'Rest' },
  { id: 'excitement', label: 'Excitement' },
  { id: 'plateau', label: 'Plateau' },
  { id: 'orgasm', label: 'Orgasm' },
  { id: 'resolution', label: 'Resolution' },
];

const PROLACTIN_TITLE =
  'The rise after orgasm lasts an hour or more; its size is not reported here because no source available to this project gives it.';

/* --------------------------------------------------------------------- hooks */

/**
 * A value the user is dragging: shown from local state while it is being changed and for
 * HOLD_MS afterwards, then handed back to the engine's own value.
 */
function useHeld(engine: number): [number, (v: number) => void] {
  const [held, setHeld] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const set = useCallback((v: number) => {
    setHeld(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setHeld(null), HOLD_MS);
  }, []);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return [held ?? engine, set];
}

/** Leading-and-trailing throttle: the first call goes out at once, the last is never lost. */
function useThrottled<A extends unknown[]>(fn: (...a: A) => void, ms: number): (...a: A) => void {
  const last = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return useCallback(
    (...a: A) => {
      const now = performance.now();
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
      const wait = ms - (now - last.current);
      if (wait <= 0) {
        last.current = now;
        fnRef.current(...a);
      } else {
        timer.current = setTimeout(() => {
          last.current = performance.now();
          timer.current = null;
          fnRef.current(...a);
        }, wait);
      }
    },
    [ms],
  );
}

/** One timeline entry per slider gesture rather than one per tick of the drag. */
function useAnnouncer(emit: (label: string) => void): (label: string) => void {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const emitRef = useRef(emit);
  emitRef.current = emit;
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return useCallback((label: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => emitRef.current(label), ANNOUNCE_MS);
  }, []);
}

/* ------------------------------------------------------------------ small parts */

function fmt(v: number): string {
  if (!Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a >= 100) return v.toFixed(0);
  if (a >= 10) return v.toFixed(1);
  if (a >= 1) return v.toFixed(2);
  return v.toPrecision(2);
}

function signedPercent(fraction: number): string {
  const p = fraction * 100;
  return `${p >= 0 ? '+' : '−'}${Math.abs(p).toFixed(0)} %`;
}

function mmss(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  disabled?: boolean;
  onChange: (v: number) => void;
}

function Slider({ label, value, min, max, step, format, disabled, onChange }: SliderProps) {
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
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={label}
      />
    </div>
  );
}

/** A 0..1 quantity drawn as a bar. The number is in the accessible name as well. */
function Meter({ label, value }: { label: string; value: number }) {
  const v = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  return (
    <div className={styles.meterRow}>
      <span className={styles.meterLabel}>{label}</span>
      <div
        className={styles.meter}
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={1}
        aria-valuenow={Number(v.toFixed(2))}
        aria-valuetext={`${(v * 100).toFixed(0)} %`}
      >
        <span className={styles.meterFill} style={{ width: `${v * 100}%` }} />
      </div>
      <span className={styles.meterValue}>{(v * 100).toFixed(0)} %</span>
    </div>
  );
}

function stateOf(h: HormoneSnapshot): { word: string; cls: string } {
  if (h.level < h.refLow) return { word: 'low', cls: styles.low };
  if (h.level > h.refHigh) return { word: 'high', cls: styles.high };
  return { word: 'in range', cls: styles.normal };
}

/**
 * A hormone row in the manner of the endocrine panel: the value, a bar on a scale of zero
 * to twice the top of the reference range with the band marked, and a needle. The state
 * is also a word, so colour is never the only signal. A hormone with no reference range
 * (for instance one whose range is sex- or phase-dependent and absent) still draws its
 * value.
 */
function HormoneRow({ h }: { h: HormoneSnapshot }) {
  const hasRange = h.refHigh > h.refLow;
  const scaleMax = Math.max(h.refHigh * 2, h.level * 1.05, 1e-9);
  const st = stateOf(h);
  return (
    <li className={styles.hormone}>
      <div className={styles.head}>
        {/* Some engine labels carry a parenthetical caveat; the row shows the name and keeps
            the whole label as the tooltip so the caveat is not lost. */}
        <span className={styles.label} title={h.label}>{h.label.split(' (')[0]}</span>
        <span className={styles.value}>
          {fmt(h.level)} <span className={styles.unit}>{h.unit}</span>
        </span>
        {hasRange && <span className={`${styles.badge} ${st.cls}`}>{st.word}</span>}
      </div>
      <div
        className={styles.hbar}
        role="img"
        aria-label={`${h.label} ${fmt(h.level)} ${h.unit}${hasRange ? `, ${st.word}, reference ${fmt(h.refLow)} to ${fmt(h.refHigh)}` : ''}`}
      >
        {hasRange && (
          <span
            className={styles.band}
            style={{ left: `${(h.refLow / scaleMax) * 100}%`, width: `${((h.refHigh - h.refLow) / scaleMax) * 100}%` }}
          />
        )}
        <span className={styles.needle} style={{ left: `${Math.max(0, Math.min(100, (h.level / scaleMax) * 100))}%` }} />
      </div>
    </li>
  );
}

function HormoneList({ ids, byId }: { ids: string[]; byId: Map<string, HormoneSnapshot> }) {
  const rows = ids.map((id) => byId.get(id)).filter((h): h is HormoneSnapshot => h !== undefined);
  if (rows.length === 0) return null;
  return (
    <ul className={styles.hormones}>
      {rows.map((h) => (
        <HormoneRow key={h.id} h={h} />
      ))}
    </ul>
  );
}

function Readout({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.readout}>
      <span className={styles.readoutLabel}>{label}</span>
      <span className={styles.readoutValue}>{value}</span>
    </div>
  );
}

/* --------------------------------------------------------------------- the panel */

export function ReproductionPanel() {
  const open = useStore((s) => s.reproductionPanelOpen);
  const toggle = useStore((s) => s.toggleReproductionPanel);
  const dispatch = useStore((s) => s.dispatch);
  const pushLog = useStore((s) => s.pushLog);
  // Every action also lands on the timeline: the toast is gone in two seconds.
  const pushEvent = useStore((s) => s.pushEvent);
  const setTimeScale = useStore((s) => s.setTimeScale);
  const snapshot = useStore((s) => s.snapshot);

  const rep = snapshot?.reproductive;
  const engineDay = rep?.cycle.day ?? 1;
  const engineWeeks = rep?.pregnancy.gestationWeeks ?? 0;
  const engineStim = rep?.sexual.stimulation ?? 0;

  const [day, setDay] = useHeld(engineDay);
  const [weeks, setWeeks] = useHeld(engineWeeks);
  const [stim, setStim] = useHeld(engineStim);

  const sendDay = useThrottled((d: number) => dispatch({ type: 'SET_CYCLE_DAY', day: d }), THROTTLE_MS);
  const sendWeeks = useThrottled(
    (w: number) => dispatch({ type: 'SET_PREGNANCY', pregnant: true, weeks: w }),
    THROTTLE_MS,
  );
  const sendStim = useThrottled((v: number) => dispatch({ type: 'SET_SEXUAL_STIMULATION', level: v }), THROTTLE_MS);

  const announce = useAnnouncer((label) => pushEvent({ kind: 'state', label, tone: 'info' }));

  // The strip learns which days were menstrual, and where the LH peak fell, from the
  // snapshot itself, because the snapshot carries the current phase but not the table of
  // phase boundaries, and inventing a "menses lasts five days" here would be a number
  // the panel has no source for. As the clock (or the slider) passes through the cycle the
  // strip fills in; until a day has been seen it is simply unshaded. The cycle is
  // replayed from the same table every time, so what is learned stays true.
  const menstrualDays = useRef<Set<number>>(new Set());
  const cycleLength = rep?.cycle.length_days ?? 0;
  const lastLength = useRef(cycleLength);
  const [seen, setSeen] = useState(0);
  const dayFloor = Math.floor(engineDay);
  const menstruating = rep?.cycle.menstruating ?? false;
  const cycleActive = rep?.cycle.active ?? false;
  useEffect(() => {
    if (lastLength.current !== cycleLength) {
      lastLength.current = cycleLength;
      menstrualDays.current.clear();
    }
    if (cycleActive && menstruating && !menstrualDays.current.has(dayFloor)) {
      menstrualDays.current.add(dayFloor);
      setSeen((n) => n + 1);
    }
  }, [cycleActive, menstruating, dayFloor, cycleLength]);

  const byId = useMemo(() => {
    const m = new Map<string, HormoneSnapshot>();
    for (const h of snapshot?.endocrine.hormones ?? []) m.set(h.id, h);
    return m;
  }, [snapshot?.endocrine.hormones]);

  if (!open || !snapshot || !rep) return null;

  const { cycle, pregnancy, sexual } = rep;
  const female = rep.sex === 'female';
  const pregnant = pregnancy.pregnant;
  const oxytocin = byId.get('oxytocin');
  const prolactinRaised = (sexual.prolactinRaised ?? 0) > PROLACTIN_RAISED_ABOVE;

  const setSex = (sex: 'male' | 'female') => {
    if (sex === rep.sex) return;
    dispatch({ type: 'SET_BODY', sex });
    const label = `Body set to ${sex}`;
    pushLog(label);
    pushEvent({ kind: 'state', label, tone: 'info' });
  };

  const setPregnant = (on: boolean) => {
    if (on === pregnant) return;
    dispatch(on ? { type: 'SET_PREGNANCY', pregnant: true, weeks: 4 } : { type: 'SET_PREGNANCY', pregnant: false });
    const label = on ? 'Pregnancy begun at 4 weeks' : 'Pregnancy ended';
    pushLog(label);
    pushEvent({ kind: 'state', label, tone: 'info' });
  };

  const applyLapse = (l: (typeof LAPSES)[number]) => {
    setTimeScale(l.scale);
    dispatch({ type: 'SET_REPRODUCTIVE_LAPSE', days_per_s: l.daysPerS });
    const label = `Reproductive clock: ${l.label.toLowerCase()}`;
    pushLog(label);
    pushEvent({ kind: 'state', label, tone: 'info' });
  };

  const activeLapse = LAPSES.find(
    (l) => Math.abs(rep.lapse_days_per_s - l.daysPerS) <= 0.02 * l.daysPerS,
  );

  const phaseIndex = SEXUAL_PHASES.findIndex((p) => p.id === sexual.phase);
  const lhPeakDay = cycle.day - cycle.dayFromLhPeak;

  // The relevant section is open to begin with. Keying on body and pregnancy re-applies
  // the default when either changes, which is when the relevant section changes too.
  const bodyKey = `${rep.sex}-${pregnant ? 'p' : 'n'}`;

  return (
    <section className={styles.panel} role="region" aria-label="Reproduction" data-panel="reproduction">
      <header className={styles.header}>
        <h2 className={styles.title}>Reproduction</h2>
        <button className={styles.close} onClick={() => toggle()} aria-label="Close reproduction panel">
          {'×'}
        </button>
      </header>

      {/* ------------------------------------------------------------- body */}
      <div className={styles.group}>
        <h3 className={styles.groupTitle}>Body</h3>
        <div className={styles.buttons} role="group" aria-label="Sex of the body">
          {(['male', 'female'] as const).map((sex) => (
            <button
              key={sex}
              className={rep.sex === sex ? styles.toggleOn : styles.toggle}
              aria-pressed={rep.sex === sex}
              onClick={() => setSex(sex)}
            >
              {titleCase(sex)}
            </button>
          ))}
        </div>
        <p className={styles.hint}>
          {female
            ? 'Shown: ovaries, uterine tubes, uterus, vagina and vulva.'
            : 'Shown: testes, epididymides, vasa deferentia, prostate and penis.'}
        </p>
      </div>

      {/* --------------------------------------------------- menstrual cycle */}
      {female && (
        <details className={styles.section} key={`cycle-${bodyKey}`} open={!pregnant}>
          <summary className={styles.summary}>Menstrual cycle</summary>
          <div className={styles.sectionBody}>
            {pregnant && (
              <p className={styles.hint}>The cycle is suspended while the body is pregnant.</p>
            )}

            <Slider
              label="Cycle day"
              value={Math.min(Math.max(1, day), Math.max(1, cycle.length_days))}
              min={1}
              max={Math.max(1, cycle.length_days)}
              step={1}
              disabled={pregnant || !cycle.active}
              format={(v) => `day ${v.toFixed(0)}`}
              onChange={(v) => {
                setDay(v);
                sendDay(v);
                announce(`Cycle day set to ${v.toFixed(0)}`);
              }}
            />
            <p className={styles.phaseLine}>
              Phase: <strong>{titleCase(cycle.phase)}</strong>
            </p>

            <CycleStrip
              length={cycle.length_days}
              day={cycle.day}
              menstrual={menstrualDays.current}
              lhPeakDay={lhPeakDay}
              dependsOn={seen}
              active={cycle.active}
            />

            <HormoneList ids={['lh', 'fsh', 'estradiol', 'progesterone']} byId={byId} />

            <div className={styles.meters}>
              <Meter label="Endometrium" value={cycle.endometrium} />
              <Meter label="Follicle" value={cycle.follicle} />
              <Meter label="Corpus luteum" value={cycle.corpusLuteum} />
            </div>

            <div className={styles.readouts}>
              <Readout label="Blood lost this period" value={`${cycle.bloodLoss_mL.toFixed(0)} mL`} />
              <Readout
                label="Luteal temperature shift"
                value={`${cycle.temperatureShift_C >= 0 ? '+' : '−'}${Math.abs(cycle.temperatureShift_C).toFixed(2)} °C`}
              />
            </div>
          </div>
        </details>
      )}

      {/* --------------------------------------------------------- pregnancy */}
      {female && (
        <details className={styles.section} key={`preg-${bodyKey}`} open={pregnant}>
          <summary className={styles.summary}>Pregnancy</summary>
          <div className={styles.sectionBody}>
            <button
              className={pregnant ? styles.switchOn : styles.switchOff}
              role="switch"
              aria-checked={pregnant}
              onClick={() => setPregnant(!pregnant)}
            >
              <span className={styles.switchLabel}>Pregnant</span>
              <span className={styles.switchState}>{pregnant ? 'On' : 'Off'}</span>
            </button>

            <Slider
              label="Gestational age"
              value={Math.min(40, Math.max(0, weeks))}
              min={0}
              max={40}
              step={1}
              disabled={!pregnant}
              format={(v) => `${v.toFixed(0)} weeks`}
              onChange={(v) => {
                setWeeks(v);
                sendWeeks(v);
                announce(`Gestational age set to ${v.toFixed(0)} weeks`);
              }}
            />

            {pregnant && (
              <>
                <div className={styles.readouts}>
                  <Readout label="Trimester" value={pregnancy.trimester === 0 ? '—' : String(pregnancy.trimester)} />
                  <Readout
                    label="Fetal weight"
                    value={pregnancy.fetalWeight_g === null ? '—' : `${pregnancy.fetalWeight_g.toFixed(0)} g`}
                  />
                  <Readout
                    label="Fetal heart rate"
                    value={pregnancy.fetalHeartRate_bpm === null ? '—' : `${pregnancy.fetalHeartRate_bpm.toFixed(0)} bpm`}
                  />
                  <Readout
                    label="Amniotic fluid"
                    value={pregnancy.amnioticFluid_mL === null ? '—' : `${pregnancy.amnioticFluid_mL.toFixed(0)} mL`}
                  />
                  <Readout label="Plasma volume" value={signedPercent(pregnancy.plasmaVolumeGain)} />
                  <Readout label="Red-cell mass" value={signedPercent(pregnancy.redCellMassGain)} />
                </div>

                <h4 className={styles.subTitle}>Mother now</h4>
                <table className={styles.table}>
                  <tbody>
                    <tr><th scope="row">Heart rate</th><td>{snapshot.cardio.heartRateDisplay_bpm.toFixed(0)} bpm</td></tr>
                    <tr><th scope="row">Cardiac output</th><td>{snapshot.cardio.cardiacOutput_L_per_min.toFixed(1)} L/min</td></tr>
                    <tr><th scope="row">Mean arterial pressure</th><td>{snapshot.cardio.map_mmHg.toFixed(0)} mmHg</td></tr>
                    <tr><th scope="row">Blood volume</th><td>{snapshot.cardio.bloodVolume_mL.toFixed(0)} mL</td></tr>
                    <tr><th scope="row">Haematocrit</th><td>{(snapshot.chem.haematocrit * 100).toFixed(1)} %</td></tr>
                    <tr><th scope="row">PaCO₂</th><td>{snapshot.acidBase.paco2_mmHg.toFixed(1)} mmHg</td></tr>
                    <tr><th scope="row">pH</th><td>{snapshot.acidBase.ph.toFixed(2)}</td></tr>
                    <tr><th scope="row">GFR</th><td>{snapshot.renal.gfr_mL_per_min.toFixed(0)} mL/min</td></tr>
                    <tr><th scope="row">Creatinine</th><td>{snapshot.renal.creatinine_mg_per_dL.toFixed(2)} mg/dL</td></tr>
                  </tbody>
                </table>

                <HormoneList ids={['hcg', 'progesterone', 'estradiol', 'prolactin']} byId={byId} />
              </>
            )}

            <p className={styles.hint}>Labour and lactation are not modelled.</p>
          </div>
        </details>
      )}

      {/* --------------------------------------------------------- time-lapse */}
      {female && (
        <details className={styles.section} key={`lapse-${bodyKey}`}>
          <summary className={styles.summary}>Time-lapse</summary>
          <div className={styles.sectionBody}>
            <p className={styles.hint}>
              A cycle takes a month and a pregnancy nine. These presets set the reproductive clock and the
              simulation speed together, so that the slow physiology keeps pace with the calendar.
            </p>
            <div className={styles.stack} role="group" aria-label="Reproductive time-lapse">
              {LAPSES.map((l) => (
                <button
                  key={l.id}
                  className={activeLapse?.id === l.id ? styles.toggleOn : styles.toggle}
                  aria-pressed={activeLapse?.id === l.id}
                  onClick={() => applyLapse(l)}
                >
                  {l.label}
                </button>
              ))}
            </div>
            <p className={styles.hint}>
              {activeLapse
                ? `Active: ${activeLapse.label.toLowerCase()}.`
                : 'No preset active: the clock is running at a custom rate.'}{' '}
              During a time-lapse the heartbeat on screen is also running {LAPSE_TIME_SCALE} times faster.
            </p>
          </div>
        </details>
      )}

      {/* ----------------------------------------------------- sexual response */}
      <details className={styles.section} key={`sexual-${bodyKey}`} open={!female}>
        <summary className={styles.summary}>Sexual response</summary>
        <div className={styles.sectionBody}>
          <Slider
            label="Stimulation"
            value={stim}
            min={0}
            max={1}
            step={0.05}
            format={(v) => v.toFixed(2)}
            onChange={(v) => {
              setStim(v);
              sendStim(v);
              announce(`Sexual stimulation set to ${v.toFixed(2)}`);
            }}
          />

          <ol className={styles.phases} aria-label="Phase of the sexual response">
            {SEXUAL_PHASES.map((p, i) => (
              <li
                key={p.id}
                className={i === phaseIndex ? styles.phaseOn : styles.phase}
                aria-current={i === phaseIndex ? 'step' : undefined}
              >
                {p.label}
              </li>
            ))}
          </ol>

          <div className={styles.meters}>
            <Meter label="Arousal" value={sexual.arousal} />
            <Meter label="Genital vasocongestion" value={sexual.vasocongestion} />
          </div>

          <div className={styles.readouts}>
            <Readout label="Heart rate" value={`${snapshot.cardio.heartRateDisplay_bpm.toFixed(0)} bpm`} />
            <Readout
              label="Blood pressure"
              value={`${snapshot.cardio.systolic_mmHg.toFixed(0)}/${snapshot.cardio.diastolic_mmHg.toFixed(0)} mmHg`}
            />
            <Readout label="Orgasms this session" value={String(sexual.orgasms)} />
            {!female && sexual.refractory_s > 0 && (
              <Readout label="Refractory time remaining" value={mmss(sexual.refractory_s)} />
            )}
          </div>

          {oxytocin && <HormoneList ids={['oxytocin']} byId={byId} />}

          <div className={styles.prolactin} title={PROLACTIN_TITLE}>
            <span className={styles.label}>Prolactin</span>
            {prolactinRaised ? (
              <>
                <span className={styles.value}>raised</span>
                <div
                  className={styles.meter}
                  role="meter"
                  aria-label="Prolactin rise developed"
                  aria-valuemin={0}
                  aria-valuemax={1}
                  aria-valuenow={Number(Math.min(1, sexual.prolactinRaised ?? 0).toFixed(2))}
                  title={PROLACTIN_TITLE}
                >
                  <span
                    className={styles.meterFill}
                    style={{ width: `${Math.min(1, sexual.prolactinRaised ?? 0) * 100}%` }}
                  />
                </div>
              </>
            ) : (
              <span className={styles.value}>baseline</span>
            )}
          </div>
        </div>
      </details>

      {/* ----------------------------------------------------- what is omitted */}
      <details className={styles.section}>
        <summary className={styles.summary}>What this does not model</summary>
        <div className={styles.sectionBody}>
          <ul className={styles.list}>
            <li>The breathing, pupil and muscle-tone changes that accompany sexual arousal.</li>
            <li>In pregnancy: compression of the great vessels when lying supine, nausea, labour and lactation.</li>
            <li>
              The cycle is replayed from published daily hormone medians; it is not generated by a
              feedback loop between brain and ovary.
            </li>
          </ul>
        </div>
      </details>
    </section>
  );
}

/* ------------------------------------------------------------------- cycle strip */

interface CycleStripProps {
  length: number;
  day: number;
  menstrual: Set<number>;
  lhPeakDay: number;
  /** A counter that changes when `menstrual` gains a day, so the memo-free draw refreshes. */
  dependsOn: number;
  active: boolean;
}

/**
 * The cycle drawn as a strip of days, one unit of width per day. Menstrual days (as the
 * panel has seen them go past), the day of the LH peak and a cursor at the present day.
 * Ovulation follows the LH peak, so the peak is what is marked, and it is read live from
 * the snapshot's own `dayFromLhPeak` rather than assumed. Drawn with a stretched viewBox
 * and no text inside it, so nothing distorts; the day numbers are HTML beneath.
 */
function CycleStrip({ length, day, menstrual, lhPeakDay, dependsOn, active }: CycleStripProps) {
  const n = Math.max(1, Math.round(length));
  const days: number[] = [];
  for (let d = 1; d <= n; d++) if (menstrual.has(d)) days.push(d);
  const cursor = Math.min(n, Math.max(1, day)) - 0.5;
  const peak = Math.round(lhPeakDay);
  const showPeak = active && peak >= 1 && peak <= n;
  return (
    <div className={styles.strip} data-seen={dependsOn}>
      <svg
        className={styles.stripSvg}
        viewBox={`0 0 ${n} 64`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`Cycle of ${n} days. Day ${Math.floor(day)} now.${showPeak ? ` LH peak on day ${peak}.` : ''}`}
      >
        <rect x="0" y="0" width={n} height="64" className={styles.stripBg} />
        {days.map((d) => (
          <rect key={d} x={d - 1} y="0" width="1" height="64" className={styles.stripMens} />
        ))}
        {showPeak && (
          <line x1={peak - 0.5} x2={peak - 0.5} y1="6" y2="58" className={styles.stripPeak} vectorEffect="non-scaling-stroke" />
        )}
        {active && (
          <line x1={cursor} x2={cursor} y1="0" y2="64" className={styles.stripCursor} vectorEffect="non-scaling-stroke" />
        )}
      </svg>
      <div className={styles.stripScale}>
        <span>Day 1</span>
        <span className={styles.stripKey}>
          <span className={styles.keyMens} /> menstrual <span className={styles.keyPeak} /> LH peak
        </span>
        <span>Day {n}</span>
      </div>
    </div>
  );
}
