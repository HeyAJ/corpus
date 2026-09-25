import { useMemo, useState } from 'react';
import drugsFile from '../../data/drugs.json';
import foodsFile from '../../data/foods.json';
import type { Drug, DrugsFile } from '../../data/pharma-types';
import type { Route, SimIntent } from '../../bridge/types';
import { useStore, type DrawerTab } from '../store';
import { DoseControl, formatAmount, routeLabel, routeShort } from './DoseControl';
import styles from './drawer.module.css';

/**
 * DRUG DRAWER (spec 8.2, 10.3, 10.4).
 *
 * Bottom sheet with two snap points, grouped rows, and per-route buttons anchored
 * to the right so the rightmost column lines up whether a drug offers one route or
 * five.
 *
 * TWO GUARDRAILS ARE STRUCTURAL, NOT COSMETIC.
 *
 * 1. THERE IS STILL NO DOSE FIELD. Every button gives a preset declared in the
 *    generated drugs.json, and the worker rejects an ADMINISTER intent whose amount
 *    is not a declared preset for that drug and route. What the expanded row adds is
 *    a control that scales a preset — a multiple of a cited reference, bounded in the
 *    worker, always displayed next to the reference it multiplies. You still cannot
 *    express an absolute dose here, because there is nowhere to express one: the only
 *    number the interface can send is "which cited dose" and "times what".
 *
 * 2. Every row can show its provenance. The affinities, the clearances and the
 *    preset itself each carry a citation, and the drawer surfaces them, because a
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

/** Pill colour by class, matching the reference grouping (VISUAL_AUDIT section 7). */
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

export function DrugDrawer() {
  const open = useStore((s) => s.drawerOpen);
  const tab = useStore((s) => s.drawerTab);
  const snap = useStore((s) => s.drawerSnap);
  const setDrawer = useStore((s) => s.setDrawer);
  const setDrawerSnap = useStore((s) => s.setDrawerSnap);
  const dispatch = useStore((s) => s.dispatch);
  const pushLog = useStore((s) => s.pushLog);
  const pushEvent = useStore((s) => s.pushEvent);
  const snapshot = useStore((s) => s.snapshot);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  /**
   * Filtered, then grouped. The search matches the name, the group and the drug's own
   * notes, because at this size the question is often "what have I got for X" rather
   * than "where is drug Y" — and the notes are where the mechanism words live.
   */
  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = (d: Drug) =>
      q === '' ||
      d.displayName.toLowerCase().includes(q) ||
      d.id.includes(q) ||
      groupOf(d).toLowerCase().includes(q) ||
      d.notes.toLowerCase().includes(q) ||
      d.targets.some((t) => t.receptorId.includes(q));

    const map = new Map<string, Drug[]>();
    for (const d of DRUGS) {
      if (!matches(d)) continue;
      const g = groupOf(d);
      const list = map.get(g) ?? [];
      list.push(d);
      map.set(g, list);
    }
    return [...map.entries()].sort((a, b) => groupRank(a[0]) - groupRank(b[0]) || a[0].localeCompare(b[0]));
  }, [query]);

  const shown = useMemo(() => grouped.reduce((n, [, list]) => n + list.length, 0), [grouped]);

  if (!open) return null;

  // "Running" is anything the body is still receiving: an infusion, a nebuliser, or
  // an extravascular depot that has not finished releasing. The last of those is the
  // one worth showing — a patch keeps delivering long after the decision to apply it,
  // and an interface that only lists infusions would hide exactly the dose you can
  // no longer take back.
  const active = (snapshot?.drugs ?? []).filter(
    (x) => x.infusionRate_mg_per_min > 0 || x.nebulising || x.depot_mg > 1e-4,
  );

  const give = (
    drug: Drug,
    route: Route,
    preset: Drug['presetDoses'][number],
    multiplier = 1,
    durationMin?: number,
  ) => {
    const intent: SimIntent = {
      type: 'ADMINISTER',
      drugId: drug.id,
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
    const suffix = multiplier === 1 ? '' : ` (${multiplier.toPrecision(2).replace(/0+$/, '').replace(/\.$/, '')}x ${preset.label})`;
    const tone = multiplier > 3 ? 'warn' : 'info';
    pushLog(`${drug.displayName} ${amount} ${routeShort(route)}${suffix}`, tone);
    pushEvent({
      kind: 'drug',
      label: `${drug.displayName} ${amount} ${routeShort(route)}`,
      detail: multiplier === 1 ? preset.label : `${suffix.trim().replace(/^\(|\)$/g, '')}`,
      tone,
    });
  };

  return (
    <div
      className={`${styles.sheet} ${snap === 1 ? styles.sheetFull : ''}`}
      role="dialog"
      aria-label="Administration drawer"
      data-drawer
    >
      <button
        className={styles.grabber}
        onClick={() => setDrawerSnap(snap === 0 ? 1 : 0)}
        aria-label={snap === 0 ? 'Expand drawer' : 'Collapse drawer'}
      />

      <div className={styles.tabs} role="tablist">
        {(['drugs', 'food', 'biologics'] as DrawerTab[]).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            className={tab === t ? styles.tabActive : styles.tab}
            onClick={() => setDrawer(true, t)}
          >
            {t === 'drugs' ? 'Drugs' : t === 'food' ? 'Food' : 'Biologics'}
          </button>
        ))}
        {tab === 'drugs' && (
          <label className={styles.search}>
            <span className={styles.srOnly}>Search drugs</span>
            <input
              type="search"
              value={query}
              placeholder={`Search ${DRUGS.length} drugs, groups or mechanisms`}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query !== '' && (
              <span className={styles.searchCount}>
                {shown} of {DRUGS.length}
              </span>
            )}
          </label>
        )}
        <button className={styles.close} onClick={() => setDrawer(false)} aria-label="Close drawer">
          {'×'}
        </button>
      </div>

      <div className={styles.scroll}>
        {active.length > 0 && (
          <>
            <h3 className={styles.groupHeader}>Still being absorbed</h3>
            {active.map((x) => {
              const d = DRUGS.find((y) => y.id === x.drugId);
              if (!d) return null;
              return (
                <div key={d.id} className={styles.rowGroup}>
                  <div className={styles.row}>
                    <span className={styles.drugPill} style={{ background: CLASS_COLOR[d.class] }}>
                      {d.displayName}
                    </span>
                    <span className={styles.routes}>
                      {x.infusionRate_mg_per_min > 0 && (
                        <button
                          className={styles.stopButton}
                          onClick={() => {
                            dispatch({ type: 'STOP_INFUSION', drugId: d.id });
                            pushLog(`${d.displayName} infusion stopped`, 'warn');
                          }}
                        >
                          Stop drip
                        </button>
                      )}
                    </span>
                  </div>
                  <div className={styles.depotList}>
                    {x.infusionRate_mg_per_min > 0 && (
                      <span className={styles.depotItem}>
                        infusing {formatAmount(x.infusionRate_mg_per_min, 'mg/min')}
                      </span>
                    )}
                    {x.nebulising && <span className={styles.depotItem}>nebuliser running</span>}
                    {x.depots.map((dep, i) => (
                      <span
                        key={`${dep.route}-${i}`}
                        className={`${styles.depotItem} ${dep.releasing ? '' : styles.depotWaiting}`}
                      >
                        {routeLabel(dep.route as Route)} depot {formatAmount(dep.amount_mg, 'mg')}
                        {dep.releasing
                          ? ' — releasing'
                          : ` — not releasing yet, ${formatDelay(dep.lagRemaining_min)} to go`}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </>
        )}

        {tab === 'drugs' && grouped.length === 0 && (
          <p className={styles.emptyNote}>
            Nothing matches {'\u201c'}{query}{'\u201d'}. The search covers drug names, drawer groups,
            receptor ids and the notes each drug carries.
          </p>
        )}

        {tab === 'drugs' &&
          grouped.map(([group, drugs]) => (
            <section key={group}>
              <h3 className={styles.groupHeader}>{group}</h3>
              {drugs.map((d) => (
                <DrugRow
                  key={d.id}
                  drug={d}
                  onGive={give}
                  expanded={expanded === d.id}
                  onToggle={() => setExpanded(expanded === d.id ? null : d.id)}
                />
              ))}
            </section>
          ))}

        {tab === 'food' && (
          <section>
            <h3 className={styles.groupHeader}>Food and drink</h3>
            {FOODS.map((f) => (
              <div key={f.id} className={styles.row}>
                <span className={styles.drugPill} style={{ background: 'var(--accent-amber)' }}>
                  {f.displayName}
                </span>
                <span className={styles.foodMacros}>
                  {f.carb_g}C {f.fat_g}F {f.protein_g}P
                </span>
                <span className={styles.routes}>
                  <button
                    className={styles.routeButton}
                    onClick={() => {
                      dispatch({ type: 'EAT', foodId: f.id, portions: 1 });
                      pushLog(`Ate ${f.displayName} (${f.portionLabel})`);
                      pushEvent({
                        kind: 'food',
                        label: `Ate ${f.displayName}`,
                        detail: `${f.carb_g} g carb, ${f.fat_g} g fat, ${f.protein_g} g protein`,
                        tone: 'info',
                      });
                    }}
                  >
                    Eat
                  </button>
                </span>
              </div>
            ))}
          </section>
        )}

        {tab === 'biologics' && (
          <section>
            <h3 className={styles.groupHeader}>Biologics</h3>
            <p className={styles.emptyNote}>
              Nothing here yet. A biologic needs the same standard of evidence as everything else in
              this drawer — a published affinity or a labelled pharmacokinetic parameter — and the
              ingestion pipeline has not been pointed at a source that provides them. Rather than
              show plausible numbers, this tab shows none.
            </p>
          </section>
        )}
      </div>

      <p className={styles.footnote}>
        Every dose here is a multiple of a cited reference dose, not dosing guidance. Expand a drug
        to scale one; the reference and its source are shown with the control.
      </p>
    </div>
  );
}

function DrugRow({
  drug,
  onGive,
  expanded,
  onToggle,
}: {
  drug: Drug;
  onGive: (
    d: Drug,
    r: Route,
    p: Drug['presetDoses'][number],
    multiplier?: number,
    durationMin?: number,
  ) => void;
  expanded: boolean;
  onToggle: () => void;
}) {
  const simulatable = drug.pk.V1_L !== null || drug.payload !== undefined;
  return (
    <div className={styles.rowGroup}>
      <div className={styles.row}>
        <button
          className={styles.drugPill}
          style={{ background: CLASS_COLOR[drug.class] }}
          onClick={onToggle}
          aria-expanded={expanded}
        >
          {drug.displayName}
        </button>
        <span className={styles.routes}>
          {drug.routes.map((route) => {
            const presets = drug.presetDoses.filter((p) => p.route === route);
            return presets.map((p) => (
              <button
                key={`${route}-${p.amount}-${p.unit}`}
                className={styles.routeButton}
                onClick={() => onGive(drug, route, p)}
                disabled={!simulatable}
                title={`${p.label} ${routeShort(route)}`}
              >
                <span className={styles.routeName}>{routeShort(route)}</span>
                <span className={styles.routeDose}>{p.label}</span>
              </button>
            ));
          })}
        </span>
      </div>

      {expanded && (
        <div className={styles.details}>
          {drug.scheduled && drug.scheduleNote && (
            <p className={styles.scheduleNote}>
              <strong>Controlled substance.</strong> {drug.scheduleNote}
            </p>
          )}
          <p className={styles.notes}>{drug.notes}</p>

          {simulatable && drug.presetDoses.length > 0 && (
            <section className={styles.doseSection}>
              <h4 className={styles.doseHeading}>Simulated dose</h4>
              <p className={styles.doseIntro}>
                Each control scales the cited reference dose for that route. The reference is
                marked on the track; the simulation accepts between one tenth and ten times it.
              </p>
              {drug.presetDoses.map((p) => (
                <DoseControl
                  key={`dc-${p.route}-${p.amount}-${p.unit}`}
                  drug={drug}
                  route={p.route}
                  preset={p}
                  presetSource={sourceForPreset(drug, p)}
                  disabled={!simulatable}
                  onGive={(multiplier, durationMin) => onGive(drug, p.route, p, multiplier, durationMin)}
                />
              ))}
            </section>
          )}
          {drug.targets.length > 0 && (
            <table className={styles.targets}>
              <thead>
                <tr>
                  <th>Receptor</th>
                  <th>Ki</th>
                  <th>Activity</th>
                </tr>
              </thead>
              <tbody>
                {drug.targets.map((t) => (
                  <tr key={t.receptorId}>
                    <td>{t.receptorId}</td>
                    <td>{t.Ki_nM === null ? '—' : formatNm(t.Ki_nM)}</td>
                    <td>{activityWord(t.intrinsicActivity)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <details className={styles.sources}>
            <summary>Sources ({drug.sources.length})</summary>
            <ul>
              {drug.sources.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          </details>
        </div>
      )}
    </div>
  );
}

/**
 * The citation behind a preset. The emitter folds every preset's source into the
 * drug's `sources` list, so the reference dose's provenance is findable without a
 * second lookup table — match on the label the preset was cited with.
 */
function sourceForPreset(drug: Drug, preset: Drug['presetDoses'][number]): string | undefined {
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
