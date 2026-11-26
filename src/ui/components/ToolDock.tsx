import { useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { Viewer } from '../../render/scene/Viewer';
import { LEGEND_HIGH, LEGEND_LOW, type HormoneLegendEntry } from '../../render/endocrine/HormoneTraffic';
import { useStore, type ToolMode } from '../store';
import { SearchBox } from './SearchBox';
import { buildShareHash, LINK_COPIED_TOAST, LAYER_NAMES, type LayerName } from '../shareLink';
import { ActivityLegend } from './ActivityLegend';
import { BloodDrop } from './layerGlyphs';
import styles from './dock.module.css';
import { useVitalsAudio } from '../audio/useVitalsAudio';

/**
 * TOOL DOCK (spec 8.3, 8.6).
 *
 * Split into two clusters: blood/menu on the left, body/scalpel/syringe on the
 * right. That split is in the reference and it is not decorative — the left cluster
 * is view state, the right cluster is intervention, and putting them in one bar
 * would invite a mis-tap between the two.
 *
 * The active tool is shown as a filled icon rather than by colour alone.
 */

interface DockButtonProps {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

function DockButton({ label, active, onClick, children }: DockButtonProps) {
  return (
    <button
      className={`${styles.button} ${active ? styles.buttonActive : ''}`}
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      title={label}
    >
      {children}
    </button>
  );
}

const S = 20;

/**
 * THE HORMONE LEGEND. Shown whenever the Hormones layer is on, above the Layers chip.
 * It lists every hormone present in the snapshot right now (the overlay's own legend()), so
 * the list follows the body: a woman's shows oestradiol, a man's testosterone. A colour dot
 * says which colour on the body is which; the mark says whether the level is above (up
 * arrow), below (down arrow) or near (dash) its own resting value. It states no reference
 * range and no advice. It polls twice a second: levels move over minutes, and a React
 * render per frame would be waste. Two columns, at most 170 px, so at 390 px it stays left
 * of the body's midline.
 */
export function HormoneLegend({ viewerRef, ready }: { viewerRef: React.MutableRefObject<Viewer | null>; ready: boolean }) {
  const on = useStore((s) => s.hormonesVisible);
  const [rows, setRows] = useState<HormoneLegendEntry[]>([]);
  useEffect(() => {
    if (!on || !ready) return;
    const read = () => setRows(viewerRef.current?.hormoneLegend() ?? []);
    read();
    const id = window.setInterval(read, 500);
    return () => window.clearInterval(id);
  }, [on, ready, viewerRef]);
  if (!on || rows.length === 0) return null;
  return (
    <div className={styles.hormLegend} role="list" aria-label="Hormone colours">
      {rows.map((r) => {
        const mark = r.ratio > LEGEND_HIGH ? '\u2191' : r.ratio < LEGEND_LOW ? '\u2193' : '\u2013';
        const word = r.ratio > LEGEND_HIGH ? 'above its resting level' : r.ratio < LEGEND_LOW ? 'below its resting level' : 'near its resting level';
        return (
          <div key={r.id} className={styles.hormRow} role="listitem" title={`${r.label}: ${word}`}>
            <span className={styles.hormDot} style={{ background: r.colour }} />
            <span className={styles.hormName}>{r.label}</span>
            <span className={`${styles.hormMark} ${mark === '\u2013' ? '' : styles.hormMarkOn}`} aria-label={word}>{mark}</span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * The legends column: the Hormones legend and the Activity legend, stacked so that both
 * switches on at once cannot make them collide (see .legends in dock.module.css).
 */
export function LegendStack({ viewerRef, ready }: { viewerRef: React.MutableRefObject<Viewer | null>; ready: boolean }) {
  return (
    <div className={styles.legends}>
      <HormoneLegend viewerRef={viewerRef} ready={ready} />
      <ActivityLegend />
    </div>
  );
}

function Speaker({ filled }: { filled: boolean }) {
  return (
    <svg width={S} height={S} viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M4 9.5h3.2L11.5 6v12L7.2 14.5H4Z"
        fill={filled ? '#1a1a1a' : 'none'}
        stroke="#1a1a1a"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      {filled ? (
        <g stroke="#1a1a1a" strokeWidth="1.6" strokeLinecap="round" fill="none">
          <path d="M14.6 9.2a4 4 0 0 1 0 5.6" />
          <path d="M17 6.8a7.4 7.4 0 0 1 0 10.4" />
        </g>
      ) : (
        <g stroke="#1a1a1a" strokeWidth="1.6" strokeLinecap="round">
          <path d="M15 9.5l4.5 5M19.5 9.5l-4.5 5" />
        </g>
      )}
    </svg>
  );
}

function Runner({ filled }: { filled: boolean }) {
  return (
    <svg width={S} height={S} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="14.5" cy="4.6" r="2.1" fill={filled ? '#1a1a1a' : 'none'} stroke="#1a1a1a" strokeWidth="1.5" />
      <g stroke="#1a1a1a" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" fill="none">
        <path d="M15.4 9.1 11.6 11l1.7 3.4 1.1 5.6" />
        <path d="M13.3 14.4 9.6 16.7 7.4 20.6" />
        <path d="M11.6 11 7.9 12.1 5.6 15" />
        <path d="M15.4 9.1 19 11.3l1.2 3.1" />
      </g>
    </svg>
  );
}

/** The view as a link: this body, the open organ and part, the layers and the section. */
function currentShareHash(): string {
  const s = useStore.getState();
  const repro = s.snapshot?.reproductive;
  const layersOn: Record<LayerName, boolean> = {
    bones: s.bonesVisible,
    vessels: s.vascularVisible,
    nerves: s.nervesVisible,
    hormones: s.hormonesVisible,
    activity: s.activityVisible,
  };
  return buildShareHash({
    sex: repro?.sex,
    weeks: repro?.pregnancy?.pregnant ? Math.round(repro.pregnancy.gestationWeeks) : undefined,
    organ: s.selectedOrgan ?? undefined,
    part: s.selectedOrgan && s.selectedPart ? s.selectedPart : undefined,
    layers: LAYER_NAMES.filter((n) => layersOn[n]),
    cut: s.selectedOrgan && s.cutAxis ? { axis: s.cutAxis, depth: s.cutDepth } : undefined,
  });
}

/**
 * Copy the link to the clipboard. Resolves null when it was copied (and the toast has been
 * shown), or with the URL when the clipboard refused (an insecure origin, a blocked
 * permission), so the menu can show it in a read-only field that is already selected.
 */
async function copyViewLink(): Promise<string | null> {
  const url = window.location.origin + window.location.pathname + window.location.search + currentShareHash();
  try {
    await navigator.clipboard.writeText(url);
    useStore.getState().pushLog(LINK_COPIED_TOAST, 'info');
    return null;
  } catch {
    return url;
  }
}

function LinkGlyph() {
  return (
    <svg width={S} height={S} viewBox="0 0 24 24" aria-hidden="true">
      <g fill="none" stroke="#1a1a1a" strokeWidth="1.8" strokeLinecap="round">
        <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
        <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
      </g>
    </svg>
  );
}

function Menu() {
  return (
    <svg width={S} height={S} viewBox="0 0 24 24" aria-hidden="true">
      <g stroke="#1a1a1a" strokeWidth="1.8" strokeLinecap="round">
        <line x1="4" y1="7" x2="20" y2="7" />
        <line x1="4" y1="12" x2="20" y2="12" />
        <line x1="4" y1="17" x2="20" y2="17" />
      </g>
    </svg>
  );
}

function Person({ filled }: { filled: boolean }) {
  return (
    <svg width={S} height={S} viewBox="0 0 24 24" aria-hidden="true">
      <g stroke="#1a1a1a" strokeWidth="1.6" fill={filled ? '#1a1a1a' : 'none'} strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="5" r="2.6" />
        <path d="M8.4 10.5c0-1.4 1.6-2.4 3.6-2.4s3.6 1 3.6 2.4v4.2h-1.9l-.5 6.2h-2.4l-.5-6.2H8.4Z" />
      </g>
    </svg>
  );
}

function Scalpel({ filled }: { filled: boolean }) {
  return (
    <svg width={S} height={S} viewBox="0 0 24 24" aria-hidden="true">
      <g stroke="#1a1a1a" strokeWidth="1.6" fill={filled ? '#1a1a1a' : 'none'} strokeLinecap="round" strokeLinejoin="round">
        <path d="M4.5 19.5 10 14l4.2-8.2 4.6 2.4-6 7.2-4.2 4.1Z" />
        <line x1="4.5" y1="19.5" x2="7.5" y2="16.5" />
      </g>
    </svg>
  );
}

function Syringe({ filled }: { filled: boolean }) {
  return (
    <svg width={S} height={S} viewBox="0 0 24 24" aria-hidden="true">
      <g stroke="#1a1a1a" strokeWidth="1.6" fill={filled ? '#1a1a1a' : 'none'} strokeLinecap="round" strokeLinejoin="round">
        <path d="m13.6 5.2 5.2 5.2-7.4 7.4-5.2-5.2 7.4-7.4Z" />
        <line x1="16.2" y1="2.6" x2="21.4" y2="7.8" />
        <line x1="5.4" y1="15.4" x2="2.6" y2="18.2" />
        <line x1="10.5" y1="8.3" x2="15.7" y2="13.5" />
      </g>
    </svg>
  );
}

/** A flask: the Hormone levels panel (the measured levels, not the Hormones overlay switch). */
function Flask({ filled }: { filled: boolean }) {
  return (
    <svg width={S} height={S} viewBox="0 0 24 24" aria-hidden="true">
      <g stroke="#1a1a1a" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9.5 3v6.2L4.9 17.4A2 2 0 0 0 6.6 20.5h10.8a2 2 0 0 0 1.7-3.1L14.5 9.2V3" />
        <line x1="8.6" y1="3" x2="15.4" y2="3" />
        <path d="M7.2 14.2h9.6" fill={filled ? '#1a1a1a' : 'none'} />
      </g>
      {filled && <path d="M6.2 15.8h11.6l1.3 2.1a1.4 1.4 0 0 1-1.2 2.1H6.1a1.4 1.4 0 0 1-1.2-2.1Z" fill="#1a1a1a" />}
    </svg>
  );
}

/** A specimen tube: the laboratory panel. */
function Tube({ filled }: { filled: boolean }) {
  return (
    <svg width={S} height={S} viewBox="0 0 24 24" aria-hidden="true">
      <g stroke="#1a1a1a" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path d="M8.6 3h6.8v13.4a3.4 3.4 0 0 1-6.8 0Z" />
        <line x1="7.6" y1="3" x2="16.4" y2="3" />
      </g>
      {filled && <path d="M8.6 11.5h6.8v4.9a3.4 3.4 0 0 1-6.8 0Z" fill="#1a1a1a" />}
    </svg>
  );
}

/** Diverging bars: the impact panel — what your actions are doing to the body. */
function Impact({ filled }: { filled: boolean }) {
  return (
    <svg width={S} height={S} viewBox="0 0 24 24" aria-hidden="true">
      <line x1="12" y1="3.5" x2="12" y2="20.5" stroke="#1a1a1a" strokeWidth="1.4" strokeLinecap="round" opacity="0.5" />
      <g fill={filled ? '#1a1a1a' : 'none'} stroke="#1a1a1a" strokeWidth="1.5" strokeLinejoin="round">
        <rect x="12" y="5" width="6.5" height="3.4" rx="1" />
        <rect x="6" y="10" width="6" height="3.4" rx="1" />
        <rect x="12" y="15" width="4.5" height="3.4" rx="1" />
      </g>
    </svg>
  );
}

/** Stacked slices: the structures panel (what is inside an organ). */
function Layers({ filled }: { filled: boolean }) {
  return (
    <svg width={S} height={S} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 4 21 9l-9 5-9-5Z" fill={filled ? '#1a1a1a' : 'none'} stroke="#1a1a1a" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="m3 13 9 5 9-5" fill="none" stroke="#1a1a1a" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/** A mountain under a sun: the environment panel — altitude, temperature, oxygen. */
function Mountain({ filled }: { filled: boolean }) {
  return (
    <svg width={S} height={S} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="17.5" cy="6" r="2.2" fill={filled ? '#1a1a1a' : 'none'} stroke="#1a1a1a" strokeWidth="1.4" />
      <path
        d="M3 19.5 9 9l3.6 5.6 2-3.1L20.8 19.5Z"
        fill={filled ? '#1a1a1a' : 'none'}
        stroke="#1a1a1a"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** A ring with a phase dot on it: the reproduction panel (the cycle). */
function Cycle({ filled }: { filled: boolean }) {
  return (
    <svg width={S} height={S} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="7.5" fill={filled ? '#1a1a1a' : 'none'} stroke="#1a1a1a" strokeWidth="1.6" />
      <circle cx="12" cy="4.5" r="2.4" fill={filled ? '#fff' : '#1a1a1a'} stroke="#1a1a1a" strokeWidth="1" />
    </svg>
  );
}

/** A microbe: the infection panel. */
function Microbe({ filled }: { filled: boolean }) {
  return (
    <svg width={S} height={S} viewBox="0 0 24 24" aria-hidden="true">
      <g stroke="#1a1a1a" strokeWidth="1.5" strokeLinecap="round">
        <line x1="12" y1="2.5" x2="12" y2="5" />
        <line x1="12" y1="19" x2="12" y2="21.5" />
        <line x1="2.5" y1="12" x2="5" y2="12" />
        <line x1="19" y1="12" x2="21.5" y2="12" />
        <line x1="5.5" y1="5.5" x2="7.3" y2="7.3" />
        <line x1="16.7" y1="16.7" x2="18.5" y2="18.5" />
        <line x1="18.5" y1="5.5" x2="16.7" y2="7.3" />
        <line x1="7.3" y1="16.7" x2="5.5" y2="18.5" />
      </g>
      <circle cx="12" cy="12" r="5" fill={filled ? '#1a1a1a' : 'none'} stroke="#1a1a1a" strokeWidth="1.6" />
      {filled ? (
        <g fill="#fff">
          <circle cx="10.4" cy="11" r="0.9" />
          <circle cx="13.4" cy="13.2" r="0.9" />
        </g>
      ) : (
        <g fill="#1a1a1a">
          <circle cx="10.4" cy="11" r="0.9" />
          <circle cx="13.4" cy="13.2" r="0.9" />
        </g>
      )}
    </svg>
  );
}

/** A pulse line: "what is happening" (the status panel). */
function Pulse() {
  return (
    <svg width={S} height={S} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 12h4l2-5 4 10 2-5h6" fill="none" stroke="#1a1a1a" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Receptor grid: the receptor panel (the menu glyph now opens the launcher). */
function Receptors() {
  return (
    <svg width={S} height={S} viewBox="0 0 24 24" aria-hidden="true">
      <g fill="none" stroke="#1a1a1a" strokeWidth="1.6">
        <circle cx="7" cy="7" r="2.6" />
        <circle cx="17" cy="7" r="2.6" />
        <circle cx="7" cy="17" r="2.6" />
        <circle cx="17" cy="17" r="2.6" />
      </g>
    </svg>
  );
}

interface LauncherItem {
  key: string;
  label: string;
  hint: string;
  icon: React.ReactNode;
  active: boolean;
  onClick: () => void;
}

/**
 * THE DOCK IS FIVE BUTTONS. It had grown to twelve, which on a phone either scrolled
 * half of them out of sight or wrapped onto a second row that took height from the
 * body. Now it is the reference's shape: view state on the left (vascular overlay, and
 * a menu that lists every readout and control panel), intervention on the right (body,
 * procedures, drugs). Everything else is one tap into the menu, and only one panel is
 * ever open at a time (store.ts), so nothing can cover anything else.
 */
export function ToolDock() {
  const audio = useVitalsAudio();
  const tool = useStore((s) => s.tool);
  const setTool = useStore((s) => s.setTool);
  const setDrawer = useStore((s) => s.setDrawer);
  const drawerOpen = useStore((s) => s.drawerOpen);
  const setPadStep = useStore((s) => s.setPadStep);
  const closePanels = useStore((s) => s.closePanels);
  const menuOpen = useStore((s) => s.menuOpen);
  const setMenuOpen = useStore((s) => s.setMenuOpen);
  // The search text lives here, not in SearchBox, because the menu must swap its own list for the
  // results while there is text, and must forget the text when it closes.
  const [query, setQuery] = useState('');
  // Set only when the clipboard refused the copy: the link is then shown in a read-only field.
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!menuOpen) {
      setQuery('');
      setFallbackUrl(null);
    }
  }, [menuOpen]);

  // Only the panel flags and their toggles - a bare useStore() would re-render the dock
  // on every snapshot, twenty times a second, for nothing.
  const st = useStore(
    useShallow((s) => ({
      anatomyPanelOpen: s.anatomyPanelOpen,
      toggleAnatomyPanel: s.toggleAnatomyPanel,
      statusPanelOpen: s.statusPanelOpen,
      toggleStatusPanel: s.toggleStatusPanel,
      impactPanelOpen: s.impactPanelOpen,
      toggleImpactPanel: s.toggleImpactPanel,
      physiologyPanelOpen: s.physiologyPanelOpen,
      togglePhysiologyPanel: s.togglePhysiologyPanel,
      environmentPanelOpen: s.environmentPanelOpen,
      toggleEnvironmentPanel: s.toggleEnvironmentPanel,
      reproductionPanelOpen: s.reproductionPanelOpen,
      toggleReproductionPanel: s.toggleReproductionPanel,
      infectionPanelOpen: s.infectionPanelOpen,
      toggleInfectionPanel: s.toggleInfectionPanel,
      endocrinePanelOpen: s.endocrinePanelOpen,
      toggleEndocrinePanel: s.toggleEndocrinePanel,
      labPanelOpen: s.labPanelOpen,
      toggleLabPanel: s.toggleLabPanel,
      bloodPanelOpen: s.bloodPanelOpen,
      toggleBloodPanel: s.toggleBloodPanel,
      receptorPanelOpen: s.receptorPanelOpen,
      toggleReceptorPanel: s.toggleReceptorPanel,
    })),
  );
  const items: LauncherItem[] = [
    { key: 'status', label: 'What is happening', hint: 'the body in plain words', icon: <Pulse />, active: st.statusPanelOpen, onClick: st.toggleStatusPanel },
    { key: 'impact', label: 'Impact', hint: 'what your actions changed', icon: <Impact filled={st.impactPanelOpen} />, active: st.impactPanelOpen, onClick: st.toggleImpactPanel },
    { key: 'physiology', label: 'Physiology', hint: 'sleep, exercise, stress, pain, bleeding', icon: <Runner filled={st.physiologyPanelOpen} />, active: st.physiologyPanelOpen, onClick: st.togglePhysiologyPanel },
    { key: 'anatomy', label: 'Structures', hint: 'what is inside each organ', icon: <Layers filled={st.anatomyPanelOpen} />, active: st.anatomyPanelOpen, onClick: st.toggleAnatomyPanel },
    { key: 'environment', label: 'Environment', hint: 'temperature, altitude, oxygen, posture', icon: <Mountain filled={st.environmentPanelOpen} />, active: st.environmentPanelOpen, onClick: st.toggleEnvironmentPanel },
    { key: 'reproduction', label: 'Reproduction', hint: 'cycle, pregnancy, sexual response', icon: <Cycle filled={st.reproductionPanelOpen} />, active: st.reproductionPanelOpen, onClick: st.toggleReproductionPanel },
    { key: 'infection', label: 'Infection', hint: 'inoculate, watch and clear', icon: <Microbe filled={st.infectionPanelOpen} />, active: st.infectionPanelOpen, onClick: st.toggleInfectionPanel },
    { key: 'endocrine', label: 'Hormone levels', hint: 'cortisol, ADH, glucagon and more', icon: <Flask filled={st.endocrinePanelOpen} />, active: st.endocrinePanelOpen, onClick: st.toggleEndocrinePanel },
    { key: 'blood', label: 'In the blood', hint: 'what the vessels are carrying', icon: <BloodDrop filled={st.bloodPanelOpen} />, active: st.bloodPanelOpen, onClick: st.toggleBloodPanel },
    { key: 'lab', label: 'Laboratory', hint: 'blood gas and chemistry', icon: <Tube filled={st.labPanelOpen} />, active: st.labPanelOpen, onClick: st.toggleLabPanel },
    { key: 'receptors', label: 'Receptors', hint: 'what each drug is binding', icon: <Receptors />, active: st.receptorPanelOpen, onClick: st.toggleReceptorPanel },
  ];
  if (audio.available) {
    items.push({
      key: 'sound',
      label: audio.on ? 'Sound on' : 'Sound off',
      hint: 'heartbeat, breathing and monitor',
      icon: <Speaker filled={audio.on} />,
      active: audio.on,
      onClick: audio.toggle,
    });
  }

  const pick = (t: ToolMode) => {
    if (t === 'drugs') {
      setDrawer(!drawerOpen, 'drugs');
      setTool(drawerOpen ? 'none' : 'drugs');
      return;
    }
    if (t === 'procedure') {
      const next = tool === 'procedure' ? 'none' : 'procedure';
      closePanels();
      setTool(next);
      setPadStep(next === 'procedure' ? 'placeRight' : 'idle');
      return;
    }
    const next = tool === t ? 'none' : t;
    closePanels();
    setTool(next);
  };

  const anyPanel = items.some((i) => i.active && i.key !== 'sound');

  return (
    <nav className={styles.dock} aria-label="Tools">
      <div className={styles.cluster}>
        <DockButton label="Panels" active={menuOpen || anyPanel} onClick={() => setMenuOpen(!menuOpen)}>
          <Menu />
        </DockButton>
      </div>

      <div className={styles.cluster}>
        <DockButton label="Body configuration and scenarios" active={tool === 'body'} onClick={() => pick('body')}>
          <Person filled={tool === 'body'} />
        </DockButton>
        <DockButton label="Procedures and defibrillation" active={tool === 'procedure'} onClick={() => pick('procedure')}>
          <Scalpel filled={tool === 'procedure'} />
        </DockButton>
        <DockButton label="Administer" active={drawerOpen} onClick={() => pick('drugs')}>
          <Syringe filled={drawerOpen} />
        </DockButton>
      </div>

      {menuOpen && (
        <>
          {/* Tapping anywhere outside the list closes it. */}
          <button className={styles.scrim} aria-label="Close panels menu" onClick={() => setMenuOpen(false)} />
          <ul className={styles.launcher} role="menu" aria-label="Panels">
            <li role="none" className={styles.searchRow}>
              <SearchBox query={query} onQuery={setQuery} onChosen={() => setMenuOpen(false)} />
            </li>
            {query.trim() === '' && items.map((i) => (
              <li key={i.key}>
                <button
                  role="menuitemcheckbox"
                  aria-checked={i.active}
                  className={`${styles.item} ${i.active ? styles.itemActive : ''}`}
                  onClick={() => {
                    i.onClick();
                    setMenuOpen(false);
                  }}
                >
                  <span className={styles.itemIcon}>{i.icon}</span>
                  <span className={styles.itemText}>
                    <strong>{i.label}</strong>
                    <small>{i.hint}</small>
                  </span>
                </button>
              </li>
            ))}
            {query.trim() === '' && (
              <li>
                <button
                  role="menuitem"
                  className={styles.item}
                  onClick={() => {
                    void copyViewLink().then((url) => {
                      if (url === null) setMenuOpen(false);
                      else setFallbackUrl(url);
                    });
                  }}
                >
                  <span className={styles.itemIcon} aria-hidden="true">
                    <LinkGlyph />
                  </span>
                  <span className={styles.itemText}>
                    <strong>Copy link to this view</strong>
                    <small>this body, organ, layers and cut</small>
                  </span>
                </button>
              </li>
            )}
            {fallbackUrl !== null && query.trim() === '' && (
              <li className={styles.fallback}>
                <label>
                  <small>Copy this link by hand</small>
                  <input
                    className={styles.fallbackField}
                    readOnly
                    value={fallbackUrl}
                    onFocus={(e) => e.currentTarget.select()}
                    ref={(el) => el?.select()}
                  />
                </label>
              </li>
            )}
            <li className={styles.phoneOnly} hidden={query.trim() !== ''}>
              <a className={styles.item} href="docs/MODEL_LIMITATIONS.md" target="_blank" rel="noreferrer">
                <span className={styles.itemIcon} aria-hidden="true">
                  !
                </span>
                <span className={styles.itemText}>
                  <strong>Model limitations</strong>
                  <small>what this simulation does not do</small>
                </span>
              </a>
            </li>
          </ul>
        </>
      )}
    </nav>
  );
}
