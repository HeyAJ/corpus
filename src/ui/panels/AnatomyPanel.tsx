import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { organDefs } from '../../render/organs/OrganSet';
import { ANATOMY, atlasOf } from '../../data/anatomy';
import type { AnatomyFile, AnatomyPartDef } from '../../data/anatomy-types';
import type { BodySystem, OrganDef, OrganId } from '../../data/types';
import { useStore, type CutAxis } from '../store';
import styles from './anatomy.module.css';
import { PanelHeader } from '../components/PanelHeader';
import { activitySourceOf, ancestorIds, buildPartTree, countBeneath, type PartNode } from '../anatomyTree';

/**
 * STRUCTURES PANEL — what is inside each organ, and how hard each part is working now.
 *
 * Two states, one sheet. With no organ selected it is a list of every organ, grouped by
 * body system, because the other way into an organ (tapping the 3D body) needs you to know
 * where it is. With an organ selected it is that organ's atlas: every drawn part as a row
 * with a live activity meter, and a tap opens the row in place to say what the part does,
 * what drives it up or down, and where that is documented.
 *
 * FINER STRUCTURES. A part may have children (src/data/anatomy-types.ts, `parent`): the papillary
 * muscles of a ventricle, the cusps of a valve. They are listed nested under their parent. A row
 * that has children carries a disclosure button showing how many (it is a button of its own, so
 * folding the list never selects anything); tapping the row itself selects the part, flies the
 * camera to it (which is what makes its children appear in the 3D view) and unfolds its list.
 * The part the body reports as picked unfolds all of its ancestors, so a structure tapped in 3D
 * is never hidden inside a folded row. The list is plain nested lists: each row is one button
 * with a 44 px target, the disclosure is another, and the whole is a `ul` per level with the
 * level in `data-level`, which keeps it readable to a screen reader without the roving-focus
 * contract an ARIA tree would demand.
 *
 * The numbers in the meters are the engine's ACTIVITY INDEX (0..1), not a measurement in
 * any unit. The panel says so by drawing them as bars with no scale marks and no units.
 *
 * WHY THE PANEL DOES NOT SUBSCRIBE TO THE SNAPSHOT. The snapshot arrives ten times a
 * second, and re-rendering a few dozen rows with their prose at that rate is wasted work
 * when only a bar's width changes. So each meter (`PartMeter`) and the "most active" strip
 * (`MostActive`) select their own value from the store, and the panel itself selects only
 * slow things: the selected organ, the picked part, and the body's sex and pregnancy.
 */

const ORGANS = organDefs();

const SYSTEM_ORDER: { id: BodySystem; label: string }[] = [
  { id: 'nervous', label: 'Nervous' },
  { id: 'cardiovascular', label: 'Heart and circulation' },
  { id: 'respiratory', label: 'Respiratory' },
  { id: 'digestive', label: 'Digestive' },
  { id: 'urinary', label: 'Urinary' },
  { id: 'endocrine', label: 'Endocrine' },
  { id: 'lymphatic', label: 'Lymphatic' },
  { id: 'reproductive', label: 'Reproductive' },
  { id: 'skeletal', label: 'Skeleton' },
];

/** A part must beat its own resting value by this much to be called "most active". */
const ACTIVE_MARGIN = 0.08;

function atlasFor(organ: OrganDef): AnatomyFile | null {
  return ANATOMY[atlasOf(organ)] ?? null;
}

/** One live bar. Its own subscription: only this element re-renders when its part moves. */
function PartMeter({ organId, partId, label }: { organId: string; partId: string; label: string }) {
  const v = useStore((s) => s.snapshot?.anatomy?.parts[organId + '.' + partId] ?? 0);
  const clamped = Math.max(0, Math.min(1, v));
  return (
    <span
      className={styles.meter}
      role="meter"
      aria-label={`${label} activity index`}
      aria-valuemin={0}
      aria-valuemax={1}
      aria-valuenow={Number(clamped.toFixed(2))}
    >
      <span className={styles.meterFill} style={{ width: `${clamped * 100}%` }} />
    </span>
  );
}

/**
 * Up to three chips naming the parts furthest above their own rest. The selector returns a
 * joined string of ids, so zustand's equality check holds until the RANKING changes and the
 * strip re-renders a few times a minute rather than ten times a second.
 */
function MostActive({ organId, parts }: { organId: string; parts: AnatomyPartDef[] }) {
  const key = useStore((s) => {
    const live = s.snapshot?.anatomy?.parts;
    if (!live) return '';
    return parts
      .map((p) => ({ id: p.id, lift: (live[organId + '.' + p.id] ?? p.rest) - p.rest }))
      .filter((x) => x.lift >= ACTIVE_MARGIN)
      .sort((a, b) => b.lift - a.lift)
      .slice(0, 3)
      .map((x) => x.id)
      .join(',');
  });
  const setSelectedPart = useStore((s) => s.setSelectedPart);
  if (!key) return null;
  return (
    <div className={styles.active}>
      <span className={styles.activeTitle}>Most active now</span>
      <div className={styles.chips}>
        {key.split(',').map((id) => {
          const part = parts.find((p) => p.id === id);
          if (!part) return null;
          return (
            <button key={id} className={styles.chip} onClick={() => setSelectedPart(id)}>
              <span className={styles.swatchSmall} style={{ background: part.color }} aria-hidden="true" />
              {part.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function PartRow({
  organId,
  node,
  atlas,
  selectedPart,
  expanded,
  toggleExpanded,
  choose,
}: {
  organId: string;
  node: PartNode;
  atlas: AnatomyFile;
  selectedPart: string | null;
  expanded: ReadonlySet<string>;
  toggleExpanded: (id: string) => void;
  choose: (node: PartNode, open: boolean) => void;
}) {
  const part = node.part;
  const open = selectedPart === part.id;
  const kids = node.children;
  const unfolded = kids.length > 0 && expanded.has(part.id);
  const count = countBeneath(node);

  // The atlas entries this part leans on: its own source and one per drive, once each.
  const sourceKeys = useMemo(() => {
    const keys = [part.source, ...part.drives.map((d) => d.source)];
    return keys.filter((k, i) => keys.indexOf(k) === i && atlas.sources[k]);
  }, [part, atlas]);
  // A part with no drive of its own shows its parent's activity, as the 3D view does.
  const activityId = useMemo(() => activitySourceOf(atlas.parts, part.id), [atlas, part.id]);

  return (
    <li className={styles.partItem} data-part={part.id} data-open={open} data-level={node.level}>
      <div className={styles.rowLine}>
        <button className={styles.partRow} aria-expanded={open} onClick={() => choose(node, open)}>
          <span className={styles.swatch} style={{ background: part.color }} aria-hidden="true" />
          <span className={styles.partText}>
            <span className={styles.partTop}>
              <span className={styles.partLabel}>{part.label}</span>
              <PartMeter organId={organId} partId={activityId} label={part.label} />
            </span>
            <span className={styles.partSummary}>{part.summary}</span>
          </span>
        </button>
        {kids.length > 0 && (
          <button
            className={styles.disclose}
            aria-expanded={unfolded}
            aria-controls={`kids-${organId}-${part.id}`}
            aria-label={`${unfolded ? 'Hide' : 'Show'} ${count} finer ${count === 1 ? 'structure' : 'structures'} of ${part.label}`}
            onClick={() => toggleExpanded(part.id)}
            data-disclose={part.id}
          >
            <span className={styles.discloseCount}>{count}</span>
            <span className={styles.chevron} data-open={unfolded} aria-hidden="true">
              {'\u203A'}
            </span>
          </button>
        )}
      </div>
      {open && (
        <div className={styles.detail}>
          <p className={styles.prose}>{part.function}</p>
          {part.drives.length > 0 ? (
            <>
              <h4 className={styles.subTitle}>Responds to</h4>
              <ul className={styles.drives}>
                {part.drives.map((d, i) => (
                  <li key={i} className={styles.drive}>
                    <span className={d.weight >= 0 ? styles.up : styles.down} aria-label={d.weight >= 0 ? 'raises' : 'lowers'}>
                      {d.weight >= 0 ? '▲' : '▼'}
                    </span>
                    <span>{d.note}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            activityId !== part.id && (
              <p className={styles.prose}>
                Nothing drives this structure on its own, so its activity meter follows{' '}
                {atlas.parts.find((p) => p.id === activityId)?.label ?? 'its parent'}.
              </p>
            )
          )}
          {sourceKeys.length > 0 && (
            <>
              <h4 className={styles.subTitle}>Source</h4>
              <ul className={styles.sources}>
                {sourceKeys.map((k) => (
                  <li key={k}>
                    <a href={atlas.sources[k].url} target="_blank" rel="noopener noreferrer">
                      {atlas.sources[k].label}
                    </a>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
      {unfolded && (
        <ul className={styles.children} id={`kids-${organId}-${part.id}`} aria-label={`Finer structures of ${part.label}`}>
          {kids.map((k) => (
            <PartRow
              key={k.part.id}
              organId={organId}
              node={k}
              atlas={atlas}
              selectedPart={selectedPart}
              expanded={expanded}
              toggleExpanded={toggleExpanded}
              choose={choose}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function OrganList() {
  const setSelected = useStore((s) => s.setSelected);
  const sex = useStore((s) => s.snapshot?.reproductive?.sex);
  const pregnant = useStore((s) => s.snapshot?.reproductive?.pregnancy?.pregnant ?? false);

  const groups = useMemo(() => {
    // Layer organs (the bones) are listed like any other: choosing one selects it and OrganSet
    // builds and draws it on demand, with its layer off. Their group, `skeletal`, is in
    // SYSTEM_ORDER.
    const visible = ORGANS.filter((o) => (!o.sex || !sex || o.sex === sex) && (!o.pregnancyOnly || pregnant));
    return SYSTEM_ORDER.map((g) => ({ ...g, organs: visible.filter((o) => o.system === g.id) })).filter((g) => g.organs.length > 0);
  }, [sex, pregnant]);

  return (
    <>
      <p className={styles.lead}>Choose an organ</p>
      {groups.map((g) => (
        <div key={g.id} className={styles.group}>
          <h3 className={styles.groupTitle}>{g.label}</h3>
          <div className={styles.organs}>
            {g.organs.map((o) => (
              <button key={o.id} className={styles.organButton} onClick={() => setSelected(o.id as OrganId)}>
                {o.displayName}
              </button>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

/**
 * THE CUT ROW: a section through the open organ.
 *
 * One flat plane through the organ's bounding sphere removes one side of it, so the glass walls
 * and the parts inside them can be read as a section drawing. The panel only sets the store's
 * `cutAxis` and `cutDepth`; App.tsx hands them to `Viewer.setSlice`, which owns the real state and
 * resets itself whenever the selection changes (the store does the same, so the row returns to
 * Off with it). The one-line explanations name the side the viewer ACTUALLY removes, from the
 * JSDoc of materials/sliceCut.ts: the body is drawn mirrored in x, so the plane that removes
 * scene +x removes the patient's LEFT. The plane is a viewing aid and says nothing physiological.
 */
const CUT_CHOICES: { id: CutAxis | null; label: string }[] = [
  { id: null, label: 'Off' },
  { id: 'front', label: 'Front' },
  { id: 'side', label: 'Side' },
  { id: 'top', label: 'Top' },
];

const CUT_EXPLAIN: Record<CutAxis, string> = {
  front: 'Front: removes the front half, like a coronal section.',
  side: 'Side: removes the patient\u2019s left half, like a sagittal section.',
  top: 'Top: removes the top half, like a transverse section read from above.',
};

function CutRow() {
  const axis = useStore((s) => s.cutAxis);
  const depth = useStore((s) => s.cutDepth);
  const setCut = useStore((s) => s.setCut);
  return (
    <div className={styles.cut} data-cut-row>
      <span className={styles.activeTitle} id="cut-title">
        Cut
      </span>
      <div className={styles.segments} role="radiogroup" aria-labelledby="cut-title">
        {CUT_CHOICES.map((c) => (
          <button
            key={c.label}
            type="button"
            role="radio"
            aria-checked={axis === c.id}
            className={`${styles.segment} ${axis === c.id ? styles.segmentOn : ''}`}
            onClick={() => setCut(c.id)}
            data-cut={c.id ?? 'off'}
          >
            {c.label}
          </button>
        ))}
      </div>
      {axis && (
        <label className={styles.depth}>
          <span>Depth {Math.round(depth * 100)}%</span>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={Math.round(depth * 100)}
            onChange={(e) => setCut(axis, Number(e.target.value) / 100)}
            aria-label="Cut depth, percent"
            data-cut-depth
          />
        </label>
      )}
      <p className={styles.cutNote}>{axis ? CUT_EXPLAIN[axis] : 'Choose a side to slice the organ open and look at the section.'}</p>
    </div>
  );
}

function OrganAtlas({ organ }: { organ: OrganDef }) {
  const selectedPart = useStore((s) => s.selectedPart);
  const reducedMotion = useStore((s) => s.reducedMotion);
  const setSelectedPart = useStore((s) => s.setSelectedPart);
  const requestFocusPart = useStore((s) => s.requestFocusPart);
  const atlas = atlasFor(organ);
  const [more, setMore] = useState(false);
  const listRef = useRef<HTMLUListElement | null>(null);
  const roots = useMemo(() => (atlas ? buildPartTree(atlas.parts) : []), [atlas]);
  // Rows that are unfolded. Chosen by hand or by selecting a part that has children.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());

  // A new organ starts with its description folded again, and its list folded.
  useEffect(() => {
    setMore(false);
    setExpanded(new Set());
  }, [organ.id]);

  // A part picked in the 3D view (or from search) must not be hidden inside a folded row, so
  // its ancestors unfold. Only ever adds: a visitor's own folding is left alone.
  useEffect(() => {
    if (!selectedPart || !atlas) return;
    const up = ancestorIds(atlas.parts, selectedPart);
    if (up.length === 0) return;
    setExpanded((prev) => (up.every((id) => prev.has(id)) ? prev : new Set([...prev, ...up])));
  }, [selectedPart, atlas]);

  // When the part was picked by tapping the 3D body, its row may be below the fold of
  // the sheet; bring it into view. `nearest` leaves a row that is already visible alone.
  // The row is looked up by its data attribute because it may be nested several lists deep.
  useEffect(() => {
    if (!selectedPart || !listRef.current) return;
    const row = Array.from(listRef.current.querySelectorAll<HTMLElement>('[data-part]')).find((el) => el.dataset.part === selectedPart);
    row?.scrollIntoView({ block: 'nearest', behavior: reducedMotion ? 'auto' : 'smooth' });
  }, [selectedPart, reducedMotion, expanded]);

  const toggleExpanded = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Choosing a row selects it (or, if it is already selected, clears it). A row that has
  // children or is itself a child also flies the camera to the part: that flight is what
  // reveals the part's finer structures in the body, and it unfolds the row's own list.
  const choose = useCallback(
    (node: PartNode, open: boolean) => {
      if (open) {
        setSelectedPart(null);
        return;
      }
      setSelectedPart(node.part.id);
      if (node.children.length > 0 || node.level > 1) requestFocusPart(node.part.id);
      if (node.children.length > 0) setExpanded((prev) => (prev.has(node.part.id) ? prev : new Set([...prev, node.part.id])));
    },
    [setSelectedPart, requestFocusPart],
  );

  return (
    <>
      {!atlas || atlas.parts.length === 0 ? (
        <p className={styles.quiet}>The inside of this organ has not been drawn yet.</p>
      ) : (
        <>
          <div>
            <p className={more ? styles.about : `${styles.about} ${styles.clamped}`}>{atlas.about}</p>
            <button className={styles.more} onClick={() => setMore(!more)} aria-expanded={more}>
              {more ? 'less' : 'more'}
            </button>
          </div>
          <CutRow />
          <MostActive organId={organ.id} parts={atlas.parts} />
          <ul className={styles.parts} ref={listRef}>
            {roots.map((n) => (
              <PartRow
                key={n.part.id}
                organId={organ.id}
                node={n}
                atlas={atlas}
                selectedPart={selectedPart}
                expanded={expanded}
                toggleExpanded={toggleExpanded}
                choose={choose}
              />
            ))}
          </ul>
        </>
      )}
    </>
  );
}

export function AnatomyPanel() {
  const open = useStore((s) => s.anatomyPanelOpen);
  const toggle = useStore((s) => s.toggleAnatomyPanel);
  const selectedOrgan = useStore((s) => s.selectedOrgan);
  const setAnatomyAuto = useStore((s) => s.setAnatomyAuto);
  const organ = useMemo(() => ORGANS.find((o) => o.id === selectedOrgan) ?? null, [selectedOrgan]);

  const setSelected = useStore((s) => s.setSelected);
  const allParts = organ ? (atlasFor(organ)?.parts ?? []) : [];
  const finerCount = allParts.filter((p) => p.parent).length;
  const partCount = allParts.length - finerCount;

  if (!open) return null;

  return (
    <section className={styles.panel} role="region" aria-label="Structures" data-panel="anatomy">
      {/* One sticky header for both states: the panel itself is the scroll container, so the
          organ name, its part count, the way back and the close button stay put while the list
          scrolls (sticky + an opaque background; see .header in the stylesheet). */}
      <PanelHeader
        className={styles.header}
        title="Structures"
        before={
          organ ? (
            <button className={styles.back} onClick={() => setSelected(null)} aria-label="Back to the list of organs">
              {'‹'}
            </button>
          ) : undefined
        }
        meta={
          organ
            ? `${organ.displayName}${partCount > 0 ? ` \u00B7 ${partCount} parts` : ''}${finerCount > 0 ? ` \u00B7 ${finerCount} finer` : ''}`
            : undefined
        }
        onClose={() => {
          // Closing by hand while an organ is selected means "stop opening this for me":
          // the store reopens the panel on every organ tap unless told otherwise.
          if (organ) setAnatomyAuto(false);
          toggle();
        }}
      />
      {organ ? <OrganAtlas organ={organ} /> : <OrganList />}
    </section>
  );
}
