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

export function ToolDock() {
  const audio = useVitalsAudio();
  const tool = useStore((s) => s.tool);
  const setTool = useStore((s) => s.setTool);
  const setDrawer = useStore((s) => s.setDrawer);
  const toggleReceptors = useStore((s) => s.toggleReceptorPanel);
  const receptorsOpen = useStore((s) => s.receptorPanelOpen);
  const toggleEndocrine = useStore((s) => s.toggleEndocrinePanel);
  const endocrineOpen = useStore((s) => s.endocrinePanelOpen);
  const toggleLab = useStore((s) => s.toggleLabPanel);
  const togglePhysiology = useStore((s) => s.togglePhysiologyPanel);
  const physiologyOpen = useStore((s) => s.physiologyPanelOpen);
  const labOpen = useStore((s) => s.labPanelOpen);
  const toggleVascular = useStore((s) => s.toggleVascular);
  const vascularOn = useStore((s) => s.vascularVisible);
  const drawerOpen = useStore((s) => s.drawerOpen);
  const setPadStep = useStore((s) => s.setPadStep);

  const pick = (t: ToolMode) => {
    if (t === 'drugs') {
      setDrawer(!drawerOpen, 'drugs');
      setTool(drawerOpen ? 'none' : 'drugs');
      return;
    }
    if (t === 'procedure') {
      const next = tool === 'procedure' ? 'none' : 'procedure';
      setTool(next);
      setPadStep(next === 'procedure' ? 'placeRight' : 'idle');
      return;
    }
    setTool(tool === t ? 'none' : t);
  };

  return (
    <nav className={styles.dock} aria-label="Tools">
      <div className={styles.cluster}>
        {/*
          The blood drop now drives the VASCULAR OVERLAY rather than the old circulation
          tool mode: arteries, veins, and what the blood is carrying. It is the same
          idea the icon always meant, finally with something behind it.
        */}
        <DockButton label="Vascular overlay — arteries, veins and what the blood is carrying" active={vascularOn} onClick={toggleVascular}>
          <BloodDrop filled={vascularOn} />
        </DockButton>
        <DockButton label="Receptor panel" active={receptorsOpen} onClick={toggleReceptors}>
          <Menu />
        </DockButton>
        <DockButton label="Endocrine panel" active={endocrineOpen} onClick={toggleEndocrine}>
          <Flask filled={endocrineOpen} />
        </DockButton>
        <DockButton label="Laboratory panel" active={labOpen} onClick={toggleLab}>
          <Tube filled={labOpen} />
        </DockButton>
        {/*
          Sound is OFF until asked for, and the button is the gesture that starts it:
          browsers refuse an AudioContext without one, and a page that starts beeping at
          you unprompted is a page you close.
        */}
        {audio.available && (
          <DockButton
            label={audio.on ? 'Mute the heartbeat, breathing and monitor' : 'Hear the heartbeat, breathing and monitor'}
            active={audio.on}
            onClick={audio.toggle}
          >
            <Speaker filled={audio.on} />
          </DockButton>
        )}
      </div>

      <div className={styles.cluster}>
        {/*
          Sleep, exertion, fright, stress, pain, bleeding. Sits beside the body and
          procedure tools rather than with the readout panels, because it is a way of
          DOING something to the body, not a way of reading one.
        */}
        <DockButton
          label="Physiology — sleep, exertion, fright, stress, pain, bleeding"
          active={physiologyOpen}
          onClick={togglePhysiology}
        >
          <Runner filled={physiologyOpen} />
        </DockButton>
        <DockButton label="Body configuration" active={tool === 'body'} onClick={() => pick('body')}>
          <Person filled={tool === 'body'} />
        </DockButton>
        <DockButton label="Procedures and defibrillation" active={tool === 'procedure'} onClick={() => pick('procedure')}>
          <Scalpel filled={tool === 'procedure'} />
        </DockButton>
        <DockButton label="Administer" active={drawerOpen} onClick={() => pick('drugs')}>
          <Syringe filled={drawerOpen} />
        </DockButton>
      </div>
    </nav>
  );
}
