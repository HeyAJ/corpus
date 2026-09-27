import { useEffect, useMemo, useRef, useState } from 'react';
import drugsFile from '../../data/drugs.json';
import foodsFile from '../../data/foods.json';
import type { Drug, DrugsFile } from '../../data/pharma-types';
import type { Route, SimIntent } from '../../bridge/types';
import { useStore, type DrawerTab } from '../store';
import {
  DoseControl,
  formatAmount,
  formatMultiplier,
  isTimedRoute,
  routeLabel,
  routeNeedsIv,
  routeShort,
  useDose,
} from './DoseControl';
import styles from './drawer.module.css';

/**
 * THE ADMINISTRATION SHEET (spec 8.2, 10.3, 10.4).
 *
 * REBUILT 2026-09-26 AS A PHONE-FIRST SHEET. The old drawer was one long list in
 * which every drug row carried a button per preset, right-anchored: morphine alone had
 * four, adrenaline four, and on a 390 px phone they ran off the right edge of the
 * sheet, where they could not be reached (measured: a 264 px button strip beside a
 * 150 px name pill in a 370 px sheet). Expanding a drug then appended its notes, one
 * dose control per route, a fixed 420 px chart and a receptor table INTO the list, so
 * the Give button of the route you wanted was usually a long scroll below the thumb.
 *
 * It is now a navigation stack inside one sheet, the pattern a phone user already
 * knows from every settings screen:
 *
 *   LIST   a search field, a scrolling row of class filters, and grouped rows - one
 *          line per drug, its routes in grey underneath, a chevron. Nothing to aim at
 *          but the row itself.
 *   DRUG   the drug's own page, slid in from the right with a back button: every way
 *          to give it as a card (route + cited reference), the dose lever for the card
 *          you picked, its predicted plasma curve at the full width of the sheet, then
 *          what it is and where its numbers come from. ONE Give button, pinned to the
 *          bottom of the sheet, always under the thumb.
 *
 * The sheet can be dragged by its handle: up to fill the screen, down to shrink it,
 * down again to put it away.
 *
 * TWO GUARDRAILS ARE STRUCTURAL, NOT COSMETIC, and the rebuild keeps both.
 *
 * 1. THERE IS STILL NO DOSE FIELD. Every route card is a preset declared in the
 *    generated drugs.json, and the worker rejects an ADMINISTER intent whose amount
 *    is not a declared preset for that drug and route. The lever scales a preset - a
 *    multiple of a cited reference, bounded in the worker, always displayed next to the
 *    reference it multiplies. The only numbers the interface can send are "which cited
 *    dose" and "times what".
 *
 * 2. Every drug page shows its provenance. The affinities, the clearances and the
 *    preset itself each carry a citation, and the sheet surfaces them, because a
 *    simulation that will not tell you where its numbers came from is asking to be
 *    believed rather than checked.
 */

const DRUGS = (drugsFile as unknown as DrugsFile).drugs;

interface FoodDef {
  id: string;
  displayName: string;
  portionLabel: string;
  carb_g: number;
  fat_g: number;
  protein_g: number;
  source: string;
  sourceUrl: string;
  /** Relative to glucose = 100. Optional; absent means the model uses its default. */
  glycaemicIndex?: number;
  /** Unabsorbed bulk, grams per portion. */
  fibre_g?: number;
  /** Grams of ethanol per portion. Handed to the ethanol pharmacokinetics. */
  alcohol_g?: number;
  /** Milligrams of caffeine per portion. Handed to the caffeine pharmacokinetics. */
  caffeine_mg?: number;
}
const FOODS = (foodsFile as { foods: FoodDef[] }).foods;

type Preset = Drug['presetDoses'][number];

/** Icon colour by class, matching the reference grouping (VISUAL_AUDIT section 7). */
const CLASS_COLOR: Record<string, string> = {
  catecholamine: 'var(--accent-hot)',
  antiarrhythmic: 'var(--accent-cool)',
  electrolyte: 'var(--accent-blue)',
  fluid: 'var(--accent-lilac)',
  opioid: 'var(--accent-magenta)',
  sedative: 'var(--accent-violet)',
  anaesthetic: 'var(--accent-violet)',
  stimulant: 'var(--accent-hot)',
  psychedelic: 'var(--accent-magenta)',
  antihypertensive: 'var(--accent-mint)',
  other: 'var(--accent-mint)',
};

/**
 * Heading order. Anything not listed falls to the end in alphabetical order, so
 * adding a drug with a new group works without touching this list.
 */
const GROUP_ORDER = [
  'Catecholamine',
  'Inotropes',
  'Antiarrhythmics',
  'Beta blockers',
  'Calcium blockers',
  'Autonomic',
  'Electrolyte',
  'Fluids',
  'Opioids',
  'Analgesics',
  'Sedatives',
  'Anaesthetics',
  'Psychotropics',
  'Anticonvulsants',
  'Respiratory',
  'Steroids',
  'Gastrointestinal',
  'Antihistamines',
  'Endocrine',
  'Renal',
  'Stimulants',
  'Controlled',
  'Other',
];

/**
 * The group comes from the DATA, not from a switch on the drug class.
 *
 * It used to be re-derived here, and the switch had no case for half the classes the
 * manifest uses — so when the set grew from nineteen drugs to eighty-nine, eighty of
 * them landed under "Other". The manifest already declares where each drug belongs;
 * this reads it.
 */
function groupOf(d: Drug): string {
  return d.drawerGroup || 'Other';
}

function groupRank(name: string): number {
  const i = GROUP_ORDER.indexOf(name);
  return i === -1 ? GROUP_ORDER.length : i;
}

/** Every group that has a drug in it, in drawer order - the filter chips. */
const ALL_GROUPS = [...new Set(DRUGS.map(groupOf))].sort(
  (a, b) => groupRank(a) - groupRank(b) || a.localeCompare(b),
);

/** Whether the engine can run this drug at all (it has kinetics or a payload). */
function simulatable(d: Drug): boolean {
  return d.pk.V1_L !== null || d.payload !== undefined;
}

/** "IV · PO · IM" - the routes a drug offers, once each, in preset order. */
function routeSummary(d: Drug): string {
  return [...new Set(d.presetDoses.map((p) => routeShort(p.route)))].join(' · ');
}

function presetKey(p: Preset): string {
  return `${p.route}-${p.amount}-${p.unit}`;
}

export function DrugDrawer() {
  const open = useStore((s) => s.drawerOpen);
  const tab = useStore((s) => s.drawerTab);
  const snap = useStore((s) => s.drawerSnap);
  const setDrawer = useStore((s) => s.setDrawer);
  const setDrawerSnap = useStore((s) => s.setDrawerSnap);
  const dispatch = useStore((s) => s.dispatch);
  const pushLog = useStore((s) => s.pushLog);
  const pushEvent = useStore((s) => s.pushEvent);
  const [drugId, setDrugId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState<string | null>(null);
  const [dragY, setDragY] = useState(0);
  const drag = useRef<{ y0: number; moved: boolean } | null>(null);

  // A closed sheet forgets which page it was on: opening it again from the dock
  // should land on the list, not on whatever drug was open last time.
  useEffect(() => {
    if (!open) setDrugId(null);
  }, [open]);

  if (!open) return null;

  const drug = drugId ? DRUGS.find((d) => d.id === drugId) ?? null : null;

  const give = (d: Drug, route: Route, preset: Preset, multiplier = 1, durationMin?: number) => {
    const intent: SimIntent = {
      type: 'ADMINISTER',
      drugId: d.id,
      route,
      dose: preset.amount,
      unit: preset.unit,
      label: preset.label,
      ...(multiplier === 1 ? {} : { multiplier }),
      ...(durationMin === undefined ? {} : { durationMin }),
    };
    dispatch(intent);

    // The log records the scaled amount AND what it was a multiple of, so a session
    // transcript can be read back without the reference having to be guessed.
    const amount = formatAmount(preset.amount * multiplier, preset.unit);
    const suffix = multiplier === 1 ? '' : ` (${formatMultiplier(multiplier)} ${preset.label})`;
    const tone = multiplier > 3 ? 'warn' : 'info';
    pushLog(`${d.displayName} ${amount} ${routeShort(route)}${suffix}`, tone);
    pushEvent({
      kind: 'drug',
      label: `${d.displayName} ${amount} ${routeShort(route)}`,
      detail: multiplier === 1 ? preset.label : `${suffix.trim().replace(/^\(|\)$/g, '')}`,
      tone,
    });
  };

  /*
   * DRAG THE HANDLE. Up past 40 px fills the screen; down past 60 px shrinks a full
   * sheet, or puts away a half one. The sheet follows the finger downward while
   * dragging so the gesture visibly does something before it commits. A tap that
   * never moved toggles the size, which is what the handle did before it could be
   * dragged, so mouse users lose nothing.
   */
  const onHandleDown = (e: React.PointerEvent) => {
    drag.current = { y0: e.clientY, moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onHandleMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const dy = e.clientY - drag.current.y0;
    if (Math.abs(dy) > 4) drag.current.moved = true;
    setDragY(Math.max(0, dy));
  };
  const onHandleUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    setDragY(0);
    if (!d) return;
    const dy = e.clientY - d.y0;
    if (!d.moved) setDrawerSnap(snap === 0 ? 1 : 0);
    else if (dy < -40) setDrawerSnap(1);
    else if (dy > 60) {
      if (snap === 1) setDrawerSnap(0);
      else setDrawer(false);
    }
  };

  const openDrug = (id: string) => {
    setDrugId(id);
    // A drug page holds a lever, a chart and a pinned button: give it the room.
    setDrawerSnap(1);
  };

  return (
    <div
      className={`${styles.sheet} ${snap === 1 ? styles.sheetFull : ''}`}
      style={dragY > 0 ? { transform: `translateY(${dragY}px)`, transition: 'none' } : undefined}
      role="dialog"
      aria-label="Administration drawer"
      data-drawer
    >
      <div
        className={styles.handleZone}
        onPointerDown={onHandleDown}
        onPointerMove={onHandleMove}
        onPointerUp={onHandleUp}
        onPointerCancel={() => {
          drag.current = null;
          setDragY(0);
        }}
      >
        <button
          className={styles.grabber}
          aria-label={snap === 0 ? 'Expand drawer' : 'Collapse drawer'}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setDrawerSnap(snap === 0 ? 1 : 0);
            }
          }}
        />
      </div>

      {drug ? (
        <DrugPage key={drug.id} drug={drug} onBack={() => setDrugId(null)} onClose={() => setDrawer(false)} onGive={give} />
      ) : (
        <>
          <header className={styles.header}>
            <div className={styles.segmented} role="tablist" aria-label="What to give">
              {(['drugs', 'food', 'biologics'] as DrawerTab[]).map((t) => (
                <button
                  key={t}
                  role="tab"
                  aria-selected={tab === t}
                  className={`${styles.segment} ${tab === t ? styles.segmentOn : ''}`}
                  onClick={() => setDrawer(true, t)}
                >
                  {t === 'drugs' ? 'Drugs' : t === 'food' ? 'Food' : 'Biologics'}
                </button>
              ))}
            </div>
            <button className={styles.close} onClick={() => setDrawer(false)} aria-label="Close drawer">
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                <path d="M1.5 1.5l9 9M10.5 1.5l-9 9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </button>
          </header>

          {tab === 'drugs' && (
            <DrugList query={query} setQuery={setQuery} group={group} setGroup={setGroup} onOpen={openDrug} />
          )}
          {tab === 'food' && <FoodList />}
          {tab === 'biologics' && (
            <div className={styles.scroll}>
              <p className={styles.emptyNote}>
                Nothing here yet. A biologic needs the same standard of evidence as everything else in
                this drawer — a published affinity or a labelled pharmacokinetic parameter — and the
                ingestion pipeline has not been pointed at a source that provides them. Rather than
                show plausible numbers, this tab shows none.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ================================================================== the list */

function SearchField({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <label className={styles.search}>
      <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true" className={styles.searchIcon}>
        <circle cx="7" cy="7" r="5.2" fill="none" stroke="currentColor" strokeWidth="1.7" />
        <path d="M11 11l3.5 3.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
      <span className={styles.srOnly}>{placeholder}</span>
      <input type="search" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      {value !== '' && (
        <button className={styles.searchClear} onClick={() => onChange('')} aria-label="Clear search">
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="8" cy="8" r="8" fill="currentColor" />
            <path d="M5.3 5.3l5.4 5.4M10.7 5.3l-5.4 5.4" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      )}
    </label>
  );
}

function DrugList({
  query,
  setQuery,
  group,
  setGroup,
  onOpen,
}: {
  query: string;
  setQuery: (q: string) => void;
  group: string | null;
  setGroup: (g: string | null) => void;
  onOpen: (id: string) => void;
}) {
  const snapshot = useStore((s) => s.snapshot);
  const dispatch = useStore((s) => s.dispatch);
  const pushLog = useStore((s) => s.pushLog);
  const pushEvent = useStore((s) => s.pushEvent);

  /**
   * Filtered, then grouped. The search matches the name, the group and the drug's own
   * notes, because at this size the question is often "what have I got for X" rather
   * than "where is drug Y" — and the notes are where the mechanism words live.
   */
  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = (d: Drug) =>
      (group === null || groupOf(d) === group) &&
      (q === '' ||
        d.displayName.toLowerCase().includes(q) ||
        d.id.includes(q) ||
        groupOf(d).toLowerCase().includes(q) ||
        d.notes.toLowerCase().includes(q) ||
        d.targets.some((t) => t.receptorId.includes(q)));

    const map = new Map<string, Drug[]>();
    for (const d of DRUGS) {
      if (!matches(d)) continue;
      const g = groupOf(d);
      const list = map.get(g) ?? [];
      list.push(d);
      map.set(g, list);
    }
    return [...map.entries()].sort((a, b) => groupRank(a[0]) - groupRank(b[0]) || a[0].localeCompare(b[0]));
  }, [query, group]);

  const shown = grouped.reduce((n, [, list]) => n + list.length, 0);

  // "Running" is anything the body is still receiving: an infusion, a nebuliser, or
  // an extravascular depot that has not finished releasing. The last of those is the
  // one worth showing — a patch keeps delivering long after the decision to apply it,
  // and an interface that only lists infusions would hide exactly the dose you can
  // no longer take back.
  const active = (snapshot?.drugs ?? []).filter(
    (x) => x.infusionRate_mg_per_min > 0 || x.nebulising || x.depot_mg > 1e-4,
  );

  return (
    <>
      <div className={styles.listTools}>
        <SearchField value={query} onChange={setQuery} placeholder={`Search ${DRUGS.length} drugs, groups or mechanisms`} />
        {/*
          The class filters scroll sideways, one row, so 23 groups cost one line of
          height instead of a wall of chips - the pattern of a phone's category bar.
        */}
        <div className={styles.chips} role="group" aria-label="Filter by group">
          <button className={`${styles.chip} ${group === null ? styles.chipOn : ''}`} onClick={() => setGroup(null)} aria-pressed={group === null}>
            All
          </button>
          {ALL_GROUPS.map((g) => (
            <button
              key={g}
              className={`${styles.chip} ${group === g ? styles.chipOn : ''}`}
              onClick={() => setGroup(group === g ? null : g)}
              aria-pressed={group === g}
            >
              {g}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.scroll}>
        {active.length > 0 && (
          <section>
            <h3 className={styles.groupHeader}>Running now</h3>
            <div className={styles.card}>
              {active.map((x) => {
                const d = DRUGS.find((y) => y.id === x.drugId);
                if (!d) return null;
                return (
                  <div key={d.id} className={styles.runRow}>
                    <span className={styles.icon} style={{ background: CLASS_COLOR[d.class] }} aria-hidden="true">
                      {d.displayName.charAt(0)}
                    </span>
                    <span className={styles.rowText}>
                      <span className={styles.rowTitle}>{d.displayName}</span>
                      <span className={styles.rowSub}>
                        {[
                          x.infusionRate_mg_per_min > 0 ? `infusing ${formatAmount(x.infusionRate_mg_per_min, 'mg/min')}` : null,
                          x.nebulising ? 'nebuliser running' : null,
                          ...x.depots.map(
                            (dep) =>
                              `${routeShort(dep.route as Route)} depot ${formatAmount(dep.amount_mg, 'mg')}${
                                dep.releasing ? ', releasing' : `, starts in ${formatDelay(dep.lagRemaining_min)}`
                              }`,
                          ),
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </span>
                    {x.infusionRate_mg_per_min > 0 && (
                      <button
                        className={styles.stopButton}
                        onClick={() => {
                          dispatch({ type: 'STOP_INFUSION', drugId: d.id });
                          pushLog(`${d.displayName} infusion stopped`, 'warn');
                          pushEvent({ kind: 'drug', label: `${d.displayName} infusion stopped`, tone: 'warn' });
                        }}
                      >
                        Stop
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {(query !== '' || group !== null) && (
          <p className={styles.count}>
            {shown} of {DRUGS.length} drugs
          </p>
        )}

        {grouped.length === 0 && (
          <p className={styles.emptyNote}>
            Nothing matches {'“'}{query}{'”'}{group ? ` in ${group}` : ''}. The search covers drug
            names, drawer groups, receptor ids and the notes each drug carries.
          </p>
        )}

        {grouped.map(([g, drugs]) => (
          <section key={g}>
            <h3 className={styles.groupHeader}>{g}</h3>
            <div className={styles.card}>
              {drugs.map((d) => (
                <button key={d.id} className={styles.drugRow} onClick={() => onOpen(d.id)} data-drug={d.id}>
                  <span className={styles.icon} style={{ background: CLASS_COLOR[d.class] }} aria-hidden="true">
                    {d.displayName.charAt(0)}
                  </span>
                  <span className={styles.rowText}>
                    <span className={styles.rowTitle}>
                      {d.displayName}
                      {d.scheduled && <span className={styles.tag}>Controlled</span>}
                    </span>
                    <span className={styles.rowSub}>
                      {simulatable(d) && d.presetDoses.length > 0 ? routeSummary(d) : 'Not simulated — no cited kinetics'}
                    </span>
                  </span>
                  <Chevron />
                </button>
              ))}
            </div>
          </section>
        ))}

        <p className={styles.footnote}>
          Every dose here is a multiple of a cited reference dose, not dosing guidance. Open a drug to
          scale one; the reference and its source are shown with the lever.
        </p>
      </div>
    </>
  );
}

function Chevron() {
  return (
    <svg className={styles.chevron} width="8" height="14" viewBox="0 0 8 14" aria-hidden="true">
      <path d="M1.5 1.5L6.5 7l-5 5.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ============================================================= a drug's page */

function DrugPage({
  drug,
  onBack,
  onClose,
  onGive,
}: {
  drug: Drug;
  onBack: () => void;
  onClose: () => void;
  onGive: (d: Drug, r: Route, p: Preset, multiplier?: number, durationMin?: number) => void;
}) {
  const canRun = simulatable(drug) && drug.presetDoses.length > 0;
  const [presetIdx, setPresetIdx] = useState(0);
  const preset = drug.presetDoses[presetIdx] ?? null;

  return (
    <div className={styles.page}>
      <header className={styles.navBar}>
        <button className={styles.back} onClick={onBack}>
          <svg width="10" height="17" viewBox="0 0 10 17" aria-hidden="true">
            <path d="M8.5 1.5L2 8.5l6.5 7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Drugs
        </button>
        <button className={styles.close} onClick={onClose} aria-label="Close drawer">
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <path d="M1.5 1.5l9 9M10.5 1.5l-9 9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
      </header>

      {preset && canRun ? (
        // Keyed on the preset: a new route starts at ITS 1x, never at a multiple carried
        // over from a route whose reference was a different size.
        <DosePane key={presetKey(preset)} drug={drug} preset={preset} presetIdx={presetIdx} setPresetIdx={setPresetIdx} onGive={onGive} />
      ) : (
        <div className={styles.scroll}>
          <DrugHero drug={drug} />
          <p className={styles.emptyNote}>
            This drug is described but not simulated: it has no cited pharmacokinetics or reference
            dose for the engine to run, and none has been invented to fill the gap.
          </p>
          <DrugAbout drug={drug} />
        </div>
      )}
    </div>
  );
}

function DrugHero({ drug }: { drug: Drug }) {
  return (
    <div className={styles.hero}>
      <span className={styles.heroIcon} style={{ background: CLASS_COLOR[drug.class] }} aria-hidden="true">
        {drug.displayName.charAt(0)}
      </span>
      <div className={styles.heroText}>
        <h2 className={styles.heroTitle}>{drug.displayName}</h2>
        <span className={styles.heroSub}>
          {groupOf(drug)}
          {drug.scheduled && <span className={styles.tag}>Controlled</span>}
        </span>
      </div>
    </div>
  );
}

function DosePane({
  drug,
  preset,
  presetIdx,
  setPresetIdx,
  onGive,
}: {
  drug: Drug;
  preset: Preset;
  presetIdx: number;
  setPresetIdx: (i: number) => void;
  onGive: (d: Drug, r: Route, p: Preset, multiplier?: number, durationMin?: number) => void;
}) {
  const dose = useDose(preset);
  const ivAccess = useStore((s) => s.snapshot?.procedures.ivAccess ?? false);
  const dispatch = useStore((s) => s.dispatch);
  const pushLog = useStore((s) => s.pushLog);
  const pushEvent = useStore((s) => s.pushEvent);
  const [given, setGiven] = useState(false);
  const givenTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (givenTimer.current) clearTimeout(givenTimer.current);
  }, []);

  // The engine refuses an intravascular route without a line (dosing.ts), with a
  // notice; a Give button that silently did nothing would look exactly like a broken
  // drug. So the sheet says so BEFORE the tap, and offers the line in the same place.
  const blockedByIv = routeNeedsIv(preset.route) && !ivAccess;
  const timed = isTimedRoute(preset.route);
  const amount = formatAmount(preset.amount * dose.multiplier, preset.unit);

  const give = () => {
    onGive(drug, preset.route, preset, dose.multiplier, timed ? dose.duration : undefined);
    setGiven(true);
    if (givenTimer.current) clearTimeout(givenTimer.current);
    givenTimer.current = setTimeout(() => setGiven(false), 1400);
  };

  return (
    <>
      <div className={styles.scroll}>
        <DrugHero drug={drug} />

        {drug.scheduled && drug.scheduleNote && (
          <p className={styles.scheduleNote}>
            <strong>Controlled substance.</strong> {drug.scheduleNote}
          </p>
        )}

        <h3 className={styles.groupHeader}>How to give it</h3>
        <div className={styles.routeGrid} role="radiogroup" aria-label="Route and cited reference dose">
          {drug.presetDoses.map((p, i) => (
            <button
              key={presetKey(p)}
              role="radio"
              aria-checked={i === presetIdx}
              className={`${styles.routeCard} ${i === presetIdx ? styles.routeCardOn : ''}`}
              onClick={() => setPresetIdx(i)}
              title={`${p.label} ${routeShort(p.route)}`}
            >
              <span className={styles.routeShortName}>{routeShort(p.route)}</span>
              <span className={styles.routeLong}>{routeLabel(p.route)}</span>
              <span className={styles.routeRef}>{p.label}</span>
            </button>
          ))}
        </div>

        <h3 className={styles.groupHeader}>Dose</h3>
        <div className={styles.card}>
          <div className={styles.cardPad}>
            <DoseControl
              drug={drug}
              route={preset.route}
              preset={preset}
              presetSource={sourceForPreset(drug, preset)}
              disabled={false}
              dose={dose}
            />
          </div>
        </div>

        <DrugAbout drug={drug} />
      </div>

      {/* Pinned under the thumb, whatever is scrolled above it. */}
      <footer className={styles.giveBar}>
        {blockedByIv ? (
          <div className={styles.ivNeeded}>
            <span>{routeLabel(preset.route)} needs an IV line.</span>
            <button
              className={styles.ivButton}
              onClick={() => {
                dispatch({ type: 'IV_ACCESS', on: true });
                pushLog('IV access sited', 'info');
                pushEvent({ kind: 'state', label: 'IV access sited', tone: 'info' });
              }}
            >
              Place IV line
            </button>
          </div>
        ) : (
          <button className={`${styles.giveButton} ${given ? styles.giveDone : ''}`} onClick={give}>
            {given ? 'Given ✓' : `Give ${amount} ${routeShort(preset.route)}`}
          </button>
        )}
      </footer>
    </>
  );
}

function DrugAbout({ drug }: { drug: Drug }) {
  return (
    <>
      <h3 className={styles.groupHeader}>About</h3>
      <div className={styles.card}>
        <p className={styles.notes}>{drug.notes}</p>
      </div>

      {drug.targets.length > 0 && (
        <>
          <h3 className={styles.groupHeader}>Receptors</h3>
          <div className={styles.card}>
            {drug.targets.map((t) => (
              <div key={t.receptorId} className={styles.targetRow}>
                <span className={styles.targetName}>{t.receptorId}</span>
                <span className={styles.targetKi}>{t.Ki_nM === null ? '—' : formatNm(t.Ki_nM)}</span>
                <span className={styles.targetAct}>{activityWord(t.intrinsicActivity)}</span>
              </div>
            ))}
          </div>
        </>
      )}

      <details className={styles.sources}>
        <summary>Sources ({drug.sources.length})</summary>
        <ul>
          {drug.sources.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ul>
      </details>
    </>
  );
}

/* ================================================================== food */

function FoodList() {
  const dispatch = useStore((s) => s.dispatch);
  const pushLog = useStore((s) => s.pushLog);
  const pushEvent = useStore((s) => s.pushEvent);
  const [query, setQuery] = useState('');
  const [eaten, setEaten] = useState<string | null>(null);
  const eatenTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (eatenTimer.current) clearTimeout(eatenTimer.current);
  }, []);

  const q = query.trim().toLowerCase();
  const foods = q === '' ? FOODS : FOODS.filter((f) => f.displayName.toLowerCase().includes(q));

  return (
    <>
      <div className={styles.listTools}>
        <SearchField value={query} onChange={setQuery} placeholder={`Search ${FOODS.length} foods and drinks`} />
      </div>
      <div className={styles.scroll}>
        {foods.length === 0 && <p className={styles.emptyNote}>Nothing matches {'“'}{query}{'”'}.</p>}
        {foods.length > 0 && (
          <div className={styles.card}>
            {foods.map((f) => (
              <div key={f.id} className={styles.foodRow}>
                <span className={styles.icon} style={{ background: 'var(--accent-amber)' }} aria-hidden="true">
                  {f.displayName.charAt(0)}
                </span>
                <span className={styles.rowText}>
                  <span className={styles.rowTitle}>{f.displayName}</span>
                  <span className={styles.rowSub}>
                    {f.portionLabel} · {f.carb_g} g carb · {f.fat_g} g fat · {f.protein_g} g protein
                  </span>
                </span>
                <button
                  className={`${styles.eatButton} ${eaten === f.id ? styles.eatDone : ''}`}
                  onClick={() => {
                    dispatch({ type: 'EAT', foodId: f.id, portions: 1 });
                    pushLog(`Ate ${f.displayName} (${f.portionLabel})`);
                    pushEvent({
                      kind: 'food',
                      label: `Ate ${f.displayName}`,
                      detail: `${f.carb_g} g carb, ${f.fat_g} g fat, ${f.protein_g} g protein`,
                      tone: 'info',
                    });
                    setEaten(f.id);
                    if (eatenTimer.current) clearTimeout(eatenTimer.current);
                    eatenTimer.current = setTimeout(() => setEaten(null), 1400);
                  }}
                  aria-label={`Eat ${f.displayName}, ${f.portionLabel}`}
                >
                  {eaten === f.id ? '✓' : 'Eat'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

/* =============================================================== helpers */

/**
 * The citation behind a preset. The emitter folds every preset's source into the
 * drug's `sources` list, so the reference dose's provenance is findable without a
 * second lookup table — match on the label the preset was cited with.
 */
function sourceForPreset(drug: Drug, preset: Preset): string | undefined {
  const routeWords = routeLabel(preset.route).toLowerCase().split(/\s+/);
  // Prefer a source that names this route or this product; fall back to the guideline.
  const scored = drug.sources
    .map((src) => {
      const low = src.toLowerCase();
      let score = 0;
      for (const w of routeWords) if (w.length > 3 && low.includes(w)) score += 2;
      if (low.includes('guidelines for cpr')) score += 1;
      if (low.includes('structured product label')) score += 1;
      return { src, score };
    })
    .sort((a, b) => b.score - a.score);
  return scored[0]?.score > 0 ? scored[0].src : drug.sources[0];
}

function formatDelay(min: number): string {
  if (min >= 120) return `${(min / 60).toFixed(1)} h`;
  if (min >= 1) return `${min.toFixed(0)} min`;
  return `${(min * 60).toFixed(0)} s`;
}

function formatNm(nM: number): string {
  if (nM < 1) return `${(nM * 1000).toFixed(0)} pM`;
  if (nM < 1000) return `${nM.toFixed(1)} nM`;
  return `${(nM / 1000).toFixed(1)} µM`;
}

function activityWord(ia: number): string {
  if (ia >= 0.9) return 'agonist';
  if (ia > 0) return 'partial agonist';
  if (ia === 0) return 'antagonist';
  if (ia <= -0.9) return 'inverse / blocker';
  return 'inhibitor';
}
