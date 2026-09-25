import { useShallow } from 'zustand/react/shallow';
import { useStore, type ToolMode } from '../store';
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

function BloodDrop({ filled }: { filled: boolean }) {
  return (
    <svg width={S} height={S} viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 2.5c3.6 4.4 6.5 8 6.5 11.4A6.5 6.5 0 0 1 12 20.4a6.5 6.5 0 0 1-6.5-6.5C5.5 10.5 8.4 6.9 12 2.5Z"
        fill={filled ? '#d63a2f' : 'none'}
        stroke="#d63a2f"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
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

/** A flask: the endocrine panel. */
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
  const toggleVascular = useStore((s) => s.toggleVascular);
  const vascularOn = useStore((s) => s.vascularVisible);

  // Only the panel flags and their toggles - a bare useStore() would re-render the dock
  // on every snapshot, twenty times a second, for nothing.
  const st = useStore(
    useShallow((s) => ({
      statusPanelOpen: s.statusPanelOpen,
      toggleStatusPanel: s.toggleStatusPanel,
      impactPanelOpen: s.impactPanelOpen,
      toggleImpactPanel: s.toggleImpactPanel,
      physiologyPanelOpen: s.physiologyPanelOpen,
      togglePhysiologyPanel: s.togglePhysiologyPanel,
      environmentPanelOpen: s.environmentPanelOpen,
      toggleEnvironmentPanel: s.toggleEnvironmentPanel,
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
    { key: 'environment', label: 'Environment', hint: 'temperature, altitude, oxygen, posture', icon: <Mountain filled={st.environmentPanelOpen} />, active: st.environmentPanelOpen, onClick: st.toggleEnvironmentPanel },
    { key: 'infection', label: 'Infection', hint: 'inoculate, watch and clear', icon: <Microbe filled={st.infectionPanelOpen} />, active: st.infectionPanelOpen, onClick: st.toggleInfectionPanel },
    { key: 'endocrine', label: 'Hormones', hint: 'cortisol, ADH, glucagon and more', icon: <Flask filled={st.endocrinePanelOpen} />, active: st.endocrinePanelOpen, onClick: st.toggleEndocrinePanel },
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
        <DockButton label={vascularOn ? "Hide blood vessels" : "Show blood vessels"} active={vascularOn} onClick={toggleVascular}>
          <BloodDrop filled={vascularOn} />
        </DockButton>
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
            {items.map((i) => (
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
            <li className={styles.phoneOnly}>
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
