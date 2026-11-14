import { useEffect, useMemo, useRef, useState } from 'react';
import { organDefs } from '../../render/organs/OrganSet';
import { ANATOMY, atlasOf } from '../../data/anatomy';
import type { AnatomyFile, AnatomyPartDef } from '../../data/anatomy-types';
import type { BodySystem, OrganDef, OrganId } from '../../data/types';
import { useStore } from '../store';
import styles from './anatomy.module.css';

/**
 * STRUCTURES PANEL — what is inside each organ, and how hard each part is working now.
 *
 * Two states, one sheet. With no organ selected it is a list of every organ, grouped by
 * body system, because the other way into an organ (tapping the 3D body) needs you to know
 * where it is. With an organ selected it is that organ's atlas: every drawn part as a row
 * with a live activity meter, and a tap opens the row in place to say what the part does,
 * what drives it up or down, and where that is documented.
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

function PartRow({ organId, part, atlas, open }: { organId: string; part: AnatomyPartDef; atlas: AnatomyFile; open: boolean }) {
  const setSelectedPart = useStore((s) => s.setSelectedPart);

  // The atlas entries this part leans on: its own source and one per drive, once each.
  const sourceKeys = useMemo(() => {
    const keys = [part.source, ...part.drives.map((d) => d.source)];
    return keys.filter((k, i) => keys.indexOf(k) === i && atlas.sources[k]);
  }, [part, atlas]);

  return (
    <li className={styles.partItem} data-part={part.id} data-open={open}>
      <button
        className={styles.partRow}
        aria-expanded={open}
        onClick={() => setSelectedPart(open ? null : part.id)}
      >
        <span className={styles.swatch} style={{ background: part.color }} aria-hidden="true" />
        <span className={styles.partText}>
          <span className={styles.partTop}>
            <span className={styles.partLabel}>{part.label}</span>
            <PartMeter organId={organId} partId={part.id} label={part.label} />
          </span>
          <span className={styles.partSummary}>{part.summary}</span>
        </span>
      </button>
      {open && (
        <div className={styles.detail}>
          <p className={styles.prose}>{part.function}</p>
          {part.drives.length > 0 && (
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
    </li>
  );
}

function OrganList() {
  const setSelected = useStore((s) => s.setSelected);
  const sex = useStore((s) => s.snapshot?.reproductive?.sex);
  const pregnant = useStore((s) => s.snapshot?.reproductive?.pregnancy?.pregnant ?? false);

  const groups = useMemo(() => {
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

function OrganAtlas({ organ }: { organ: OrganDef }) {
  const setSelected = useStore((s) => s.setSelected);
  const selectedPart = useStore((s) => s.selectedPart);
  const reducedMotion = useStore((s) => s.reducedMotion);
  const atlas = atlasFor(organ);
  const [more, setMore] = useState(false);
  const listRef = useRef<HTMLUListElement | null>(null);

  // A new organ starts with its description folded again.
  useEffect(() => setMore(false), [organ.id]);

  // When the part was picked by tapping the 3D body, its row may be below the fold of
  // the sheet; bring it into view. `nearest` leaves a row that is already visible alone.
  useEffect(() => {
    if (!selectedPart || !listRef.current) return;
    const row = Array.from(listRef.current.children).find((el) => (el as HTMLElement).dataset.part === selectedPart);
    row?.scrollIntoView({ block: 'nearest', behavior: reducedMotion ? 'auto' : 'smooth' });
  }, [selectedPart, reducedMotion]);

  return (
    <>
      <div className={styles.organHead}>
        <button className={styles.back} onClick={() => setSelected(null)} aria-label="Back to the list of organs">
          {'‹'}
        </button>
        <h3 className={styles.organTitle}>{organ.displayName}</h3>
      </div>

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
          <MostActive organId={organ.id} parts={atlas.parts} />
          <ul className={styles.parts} ref={listRef}>
            {atlas.parts.map((p) => (
              <PartRow key={p.id} organId={organ.id} part={p} atlas={atlas} open={selectedPart === p.id} />
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

  if (!open) return null;

  return (
    <section className={styles.panel} role="region" aria-label="Structures" data-panel="anatomy">
      <header className={styles.header}>
        <h2 className={styles.title}>Structures</h2>
        <button
          className={styles.close}
          onClick={() => {
            // Closing by hand while an organ is selected means "stop opening this for me":
            // the store reopens the panel on every organ tap unless told otherwise.
            if (organ) setAnatomyAuto(false);
            toggle();
          }}
          aria-label="Close structures panel"
        >
          {'×'}
        </button>
      </header>
      {organ ? <OrganAtlas organ={organ} /> : <OrganList />}
    </section>
  );
}
