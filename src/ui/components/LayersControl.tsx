import { useCallback, useEffect, useId, useRef } from 'react';
import { useStore } from '../store';
import type { LayerName } from '../shareLink';

/** The glass row's id: it is a row of the control but NOT a share-link `layers` name (it has its own `glass` key). */
type RowId = LayerName | 'glass';
import { ActivityGlyph, BloodDrop, BoneGlyph, GlassGlyph, HormoneGlyph, LayersGlyph, MuscleGlyph, NerveGlyph } from './layerGlyphs';
import styles from './layers.module.css';

/**
 * THE LAYERS CONTROL: one chip in the bottom-left corner, one popover.
 *
 * WHY ONE CONTROL. The corner held four labelled switches (Vessels, Nerves, Hormones, Activity)
 * stacked on a 48 px pitch. At 390 px wide that stack already reached mid-abdomen over the body,
 * and the skeleton, the muscles and the lymph vessels are all coming; five, six, seven switches
 * would have buried it. The chip costs one row at any width and says how many layers are on.
 *
 * WHAT IT IS. A small popover anchored to the chip, NOT a sheet: it is not part of `openOnly` in
 * store.ts, so it never replaces a panel and a panel never replaces it. It closes on a press
 * outside it, on Escape, and when any panel, sheet or the menu opens (the key below changes);
 * when it closes while focus is inside it, focus goes back to the chip. Opening it moves focus to
 * the first row so a keyboard visitor lands in it.
 *
 * THE ROWS keep each old switch's accessible name and `aria-pressed` ("Show blood vessels" /
 * "Hide blood vessels", and so on), so a visitor's habits and the tests' locators carry over.
 * Order: Glass body, Bones, Muscles, Vessels, Nerves, Hormones, Activity. Each row is a 44 px-high switch with a
 * one-line plain description.
 *
 * THE GLASS BODY ROW comes first and starts ON (it is the see-through skin that has always been
 * drawn, so the default view is unchanged). The chip's count deliberately EXCLUDES it: the count
 * says how many layers a visitor has ADDED to the default view, so the default still reads
 * "Layers" with no badge; a glass switched off is shown by its own row, not by the number.
 */

/** Which panel, sheet or menu is open, as one string: it changes when any of them opens or swaps. */
function panelKey(s: ReturnType<typeof useStore.getState>): string {
  const open: string[] = [];
  if (s.menuOpen) open.push('menu');
  if (s.drawerOpen) open.push('drawer');
  if (s.tool !== 'none') open.push(`tool:${s.tool}`);
  if (s.statusPanelOpen) open.push('status');
  if (s.impactPanelOpen) open.push('impact');
  if (s.physiologyPanelOpen) open.push('physiology');
  if (s.environmentPanelOpen) open.push('environment');
  if (s.infectionPanelOpen) open.push('infection');
  if (s.endocrinePanelOpen) open.push('endocrine');
  if (s.labPanelOpen) open.push('lab');
  if (s.receptorPanelOpen) open.push('receptor');
  if (s.bloodPanelOpen) open.push('blood');
  if (s.reproductionPanelOpen) open.push('reproduction');
  if (s.anatomyPanelOpen) open.push('anatomy');
  return open.join('|');
}

interface RowSpec {
  id: RowId;
  label: string;
  /** One line, plain words: kept short enough not to wrap at the 320 px popover width. */
  blurb: string;
  on: boolean;
  toggle: () => void;
  ariaLabel: string;
  title: string;
  glyph: React.ReactNode;
}

export function LayersControl() {
  const open = useStore((s) => s.layersOpen);
  const setOpen = useStore((s) => s.setLayersOpen);
  const glass = useStore((s) => s.glassVisible);
  const toggleGlass = useStore((s) => s.toggleGlass);
  const bones = useStore((s) => s.bonesVisible);
  const toggleBones = useStore((s) => s.toggleBones);
  const muscles = useStore((s) => s.musclesVisible);
  const toggleMuscles = useStore((s) => s.toggleMuscles);
  const vesselsUser = useStore((s) => s.vascularVisible);
  const toggleVessels = useStore((s) => s.toggleVascular);
  // The Viewer forces the vessels on while the heart is open (Viewer.applyVascularVisibility), so
  // the row must read ON then, with the reason, rather than claim "off" over a screen full of
  // vessels. Pressing it still flips the visitor's own state underneath.
  const withHeart = useStore((s) => s.selectedOrgan === 'heart') && !vesselsUser;
  const vessels = vesselsUser || withHeart;
  const nerves = useStore((s) => s.nervesVisible);
  const toggleNerves = useStore((s) => s.toggleNerves);
  const hormones = useStore((s) => s.hormonesVisible);
  const toggleHormones = useStore((s) => s.toggleHormones);
  const activity = useStore((s) => s.activityVisible);
  const toggleActivity = useStore((s) => s.toggleActivity);
  const key = useStore(panelKey);

  const chipRef = useRef<HTMLButtonElement | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);
  const popId = useId();

  const rows: RowSpec[] = [
    {
      id: 'glass',
      label: 'Glass body',
      blurb: 'See-through skin outline',
      on: glass,
      toggle: toggleGlass,
      ariaLabel: glass ? 'Hide glass body' : 'Show glass body',
      title: glass ? 'Hide glass body' : 'Show glass body',
      glyph: <GlassGlyph on={glass} />,
    },
    {
      id: 'bones',
      label: 'Bones',
      blurb: 'Skeleton, over the organs',
      on: bones,
      toggle: toggleBones,
      ariaLabel: bones ? 'Hide bones' : 'Show bones',
      title: bones ? 'Hide bones' : 'Show bones',
      glyph: <BoneGlyph on={bones} />,
    },
    {
      id: 'muscles',
      label: 'Muscles',
      blurb: 'Muscle groups, over the organs',
      on: muscles,
      toggle: toggleMuscles,
      ariaLabel: muscles ? 'Hide muscles' : 'Show muscles',
      title: muscles ? 'Hide muscles' : 'Show muscles',
      glyph: <MuscleGlyph on={muscles} />,
    },
    {
      id: 'vessels',
      label: 'Vessels',
      blurb: withHeart ? 'On while the heart is open' : 'Blood moving through vessels',
      on: vessels,
      toggle: toggleVessels,
      ariaLabel: withHeart ? 'Blood vessels shown while the heart is open' : vessels ? 'Hide blood vessels' : 'Show blood vessels',
      title: withHeart ? 'Shown while the heart is open' : vessels ? 'Hide blood vessels' : 'Show blood vessels',
      glyph: <BloodDrop filled={vessels} />,
    },
    {
      id: 'nerves',
      label: 'Nerves',
      blurb: 'Nerve pathways and impulses',
      on: nerves,
      toggle: toggleNerves,
      ariaLabel: nerves ? 'Hide nervous system' : 'Show nervous system',
      title: nerves ? 'Hide nervous system' : 'Show nervous system',
      glyph: <NerveGlyph on={nerves} />,
    },
    {
      id: 'hormones',
      label: 'Hormones',
      blurb: 'Hormone traffic from glands',
      on: hormones,
      toggle: toggleHormones,
      ariaLabel: hormones ? 'Hide hormone traffic' : 'Show hormone traffic',
      title: hormones ? 'Hide hormone traffic' : 'Show hormone traffic',
      glyph: <HormoneGlyph on={hormones} />,
    },
    {
      id: 'activity',
      label: 'Activity',
      blurb: 'Colour by change from rest',
      on: activity,
      toggle: toggleActivity,
      // Today's name does not flip with the state (the title does); the tests and habits read it.
      ariaLabel: 'Show organ activity',
      title: activity ? 'Hide organ activity' : 'Show organ activity',
      glyph: <ActivityGlyph on={activity} />,
    },
  ];
  const count = rows.filter((r) => r.id !== 'glass' && r.on).length;

  /** Close; if focus is inside the popover, hand it back to the chip so it is never lost to <body>. */
  const close = useCallback(() => {
    if (popRef.current?.contains(document.activeElement)) chipRef.current?.focus();
    setOpen(false);
  }, [setOpen]);

  // Opening moves focus to the first row.
  useEffect(() => {
    if (open) popRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
  }, [open]);

  // Outside press and Escape. The press is listened for in the CAPTURE phase on the document so
  // the canvas (which handles its own pointer events) cannot swallow it.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (target && (popRef.current?.contains(target) || chipRef.current?.contains(target))) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close, setOpen]);

  // Opening a panel, a sheet or the menu closes the popover. Skipped on the first run so a popover
  // opened while a panel is already showing (wide screens) is not shut by the effect that mounts it.
  const lastKey = useRef(key);
  useEffect(() => {
    if (lastKey.current === key) return;
    lastKey.current = key;
    if (useStore.getState().layersOpen) setOpen(false);
  }, [key, setOpen]);

  return (
    <div className={styles.layers} data-layers-root>
      {open && (
        <div ref={popRef} id={popId} className={styles.popover} role="group" aria-label="Layers">
          {rows.map((r) => (
            <button
              key={r.id}
              type="button"
              className={`${styles.row} ${r.on ? styles.rowOn : ''}`}
              onClick={r.toggle}
              aria-pressed={r.on}
              aria-label={r.ariaLabel}
              title={r.title}
            >
              <span className={styles.glyph}>{r.glyph}</span>
              <span className={styles.text}>
                <span className={styles.name}>{r.label}</span>
                <span className={styles.blurb}>{r.blurb}</span>
              </span>
              <span className={styles.track} aria-hidden="true">
                <span className={styles.knob} />
              </span>
            </button>
          ))}
        </div>
      )}
      <button
        ref={chipRef}
        type="button"
        className={`${styles.chip} ${open ? styles.chipOpen : ''}`}
        onClick={() => (open ? close() : setOpen(true))}
        aria-expanded={open}
        aria-controls={open ? popId : undefined}
        aria-label={count > 0 ? `Layers, ${count} on` : 'Layers'}
        title="Layers"
      >
        <LayersGlyph />
        <span>Layers</span>
        <span className={`${styles.count} ${count > 0 ? styles.countOn : ''}`}>{count}</span>
      </button>
    </div>
  );
}
