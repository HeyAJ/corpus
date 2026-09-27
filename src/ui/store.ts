import { create } from 'zustand';
import { recordTrends } from './trends';
import type { OrganId } from '../data/types';
import type { SimSnapshot, SimIntent, Route } from '../bridge/types';

/**
 * LAYER C STATE (spec 2).
 *
 * One Zustand store for UI state. Simulation state does NOT live here — it arrives
 * as snapshots and is held in a single slot, because putting a 20 Hz object into a
 * reactive store means every subscriber re-renders 20 times a second whether or not
 * the field it reads has changed.
 *
 * Components that need one number subscribe with a selector; components that need
 * the whole snapshot at 60 fps (the ECG strip) read it imperatively instead.
 */

export type ToolMode = 'none' | 'body' | 'procedure' | 'drugs' | 'defib' | 'circulation';
export type DrawerTab = 'drugs' | 'food' | 'biologics';

export type EventKind = 'drug' | 'food' | 'procedure' | 'state';

export interface SessionEvent {
  id: number;
  /** Simulated seconds at which it happened. */
  t: number;
  kind: EventKind;
  label: string;
  /** Longer description for the tooltip and the accessible table. */
  detail?: string;
  tone: 'info' | 'warn' | 'critical';
}

export interface ShockOutcome {
  delivered: boolean;
  converted: boolean;
  probability: number;
  reason: string;
  at: number;
}

interface UiState {
  /* ---- simulation mirror ---- */
  snapshot: SimSnapshot | null;
  connected: boolean;
  sharedArrayBuffer: boolean;
  setSnapshot: (s: SimSnapshot) => void;
  setConnected: (v: boolean, sab: boolean) => void;

  /* ---- selection ---- */
  selectedOrgan: OrganId | null;
  hoveredOrgan: OrganId | null;
  labels: { id: OrganId; x: number; y: number; visible: boolean }[];
  setSelected: (id: OrganId | null) => void;
  setHovered: (id: OrganId | null) => void;
  setLabels: (l: { id: OrganId; x: number; y: number; visible: boolean }[]) => void;

  /* ---- tools ---- */
  tool: ToolMode;
  setTool: (t: ToolMode) => void;
  drawerOpen: boolean;
  drawerTab: DrawerTab;
  drawerSnap: 0 | 1;
  setDrawer: (open: boolean, tab?: DrawerTab) => void;
  setDrawerSnap: (s: 0 | 1) => void;

  receptorPanelOpen: boolean;
  toggleReceptorPanel: () => void;
  endocrinePanelOpen: boolean;
  toggleEndocrinePanel: () => void;
  labPanelOpen: boolean;
  toggleLabPanel: () => void;
  physiologyPanelOpen: boolean;
  togglePhysiologyPanel: () => void;
  /** The teaching centrepiece: what every action is doing to the body, by target. */
  impactPanelOpen: boolean;
  toggleImpactPanel: () => void;
  /** Where the body is: temperature, altitude, oxygen, posture, water, allergen. */
  environmentPanelOpen: boolean;
  toggleEnvironmentPanel: () => void;
  /** Inoculate, watch and clear infections. */
  infectionPanelOpen: boolean;
  toggleInfectionPanel: () => void;
  /** Blood vessels and the flow through them: OFF at start; the "Vessels" corner switch shows them. */
  vascularVisible: boolean;
  toggleVascular: () => void;
  /**
   * "In the blood": the legend of what the vessels are carrying. A panel of its own
   * since the vessels became part of the default body - it used to appear whenever the
   * overlay was on, and with the overlay always on it would have owned the sheet.
   */
  bloodPanelOpen: boolean;
  toggleBloodPanel: () => void;
  /** "What is happening": the plain-language status of the body. */
  statusPanelOpen: boolean;
  toggleStatusPanel: () => void;
  /** The launcher that lists every panel behind the dock's menu button. */
  menuOpen: boolean;
  setMenuOpen: (open: boolean) => void;
  /** Close every panel, the drawer and the launcher (the body gets the whole screen). */
  closePanels: () => void;

  /* ---- defibrillation flow ---- */
  padStep: 'idle' | 'placeRight' | 'placeLeft' | 'ready' | 'charged';
  defibEnergy: number;
  setPadStep: (s: UiState['padStep']) => void;
  setDefibEnergy: (j: number) => void;
  shock: ShockOutcome | null;
  setShock: (o: ShockOutcome | null) => void;
  /**
   * Clear the transient interface state that a body reset must not outlive. The shock
   * outcome and the pad-placement step are UI-only — they live here, not in the
   * snapshot, so a `RESET` intent that restarts the engine does not touch them, and a
   * stale "charged" or a shock verdict from the old run would otherwise sit there
   * describing a body that no longer exists. The reset path calls this so it does not.
   */
  resetUiState: () => void;

  /* ---- presentation ---- */
  timeScale: number;
  setTimeScale: (x: number) => void;
  reducedMotion: boolean;
  setReducedMotion: (v: boolean) => void;
  firstRunAccepted: boolean;
  acceptFirstRun: () => void;
  showProvenance: string | null;
  setProvenance: (key: string | null) => void;

  /* ---- intent dispatch, installed by the bridge ---- */
  dispatch: (i: SimIntent) => void;
  setDispatch: (fn: (i: SimIntent) => void) => void;

  /* ---- toast log and session timeline ---- */
  log: { id: number; text: string; tone: 'info' | 'warn' | 'critical' }[];
  /**
   * Everything that happened, stamped with the SIMULATED time it happened at.
   *
   * The toast log is three lines that scroll away; this is the record. A physiology
   * simulator without one can show you that the pressure rose but not that it rose
   * ninety seconds after you gave something, and the second fact is the one worth
   * having. Stamped with simulated time rather than wall-clock time so the record
   * still lines up after the time scale has been changed.
   */
  events: SessionEvent[];
  pushEvent: (e: Omit<SessionEvent, 'id' | 't'>) => void;
  clearEvents: () => void;
  pushLog: (text: string, tone?: 'info' | 'warn' | 'critical') => void;
}

let logId = 1;
/** How long an action's toast stays over the body. The CSS fade-out runs inside this. */
export const LOG_LIFETIME_MS = 2000;
let eventId = 1;

/** The longest history worth keeping; older entries fall off the front. */
const MAX_EVENTS = 300;

const CLOSED = {
  receptorPanelOpen: false,
  endocrinePanelOpen: false,
  labPanelOpen: false,
  physiologyPanelOpen: false,
  impactPanelOpen: false,
  environmentPanelOpen: false,
  infectionPanelOpen: false,
  statusPanelOpen: false,
  bloodPanelOpen: false,
  drawerOpen: false,
  menuOpen: false,
} as const;

/*
 * ONE PANEL AT A TIME. The panels used to stack in a docked rail that took a third of
 * the screen from the body on a desktop and half of it on a phone, and the body shrank
 * to fit whatever was left. Now the body always owns the whole screen and a single
 * floating sheet holds whichever panel is open; opening another replaces it. So panels
 * can never overlap each other, and the body is never resized by one. The body panel
 * and the procedure flow are tool modes, so opening a panel leaves the procedure tool
 * alone (its pads live on the chest) but closes the body panel, which shares the sheet.
 */
function openOnly<K extends keyof typeof CLOSED>(s: { tool: ToolMode } & Record<K, boolean>, key: K) {
  return { ...CLOSED, tool: s.tool === 'body' || s.tool === 'drugs' ? ('none' as ToolMode) : s.tool, [key]: !s[key] };
}

export const useStore = create<UiState>((set, get) => ({
  snapshot: null,
  connected: false,
  sharedArrayBuffer: false,
  setSnapshot: (s) => {
    // Feed the rolling history before the re-render, so a chip drawing its sparkline
    // this frame sees the sample that caused the frame.
    recordTrends(s);

    // THE BODY'S CLOCK CAN GO BACKWARDS. A reset restarts it at zero, and so does a
    // worker being recreated underneath a live page. Every event is stamped against
    // that clock, so anything stamped later than the clock now reads is a record of a
    // run that no longer exists — and it renders as "now", at a position off the end
    // of the track. Drop those rather than draw them.
    const previous = get().snapshot;
    if (previous && s.t < previous.t - 0.5) {
      set({ snapshot: s, events: [] });
      return;
    }
    set({ snapshot: s });
  },
  setConnected: (v, sab) => set({ connected: v, sharedArrayBuffer: sab }),

  selectedOrgan: null,
  hoveredOrgan: null,
  labels: [],
  setSelected: (id) => set({ selectedOrgan: id }),
  setHovered: (id) => set({ hoveredOrgan: id }),
  setLabels: (l) => set({ labels: l }),

  tool: 'none',
  setTool: (t) => set({ tool: t }),
  drawerOpen: false,
  drawerTab: 'drugs',
  drawerSnap: 0,
  setDrawer: (open, tab) => set((s) => (open ? { ...CLOSED, drawerOpen: true, drawerTab: tab ?? s.drawerTab } : { drawerOpen: false })),
  setDrawerSnap: (s) => set({ drawerSnap: s }),

  receptorPanelOpen: false,
  toggleReceptorPanel: () => set((s) => openOnly(s, 'receptorPanelOpen')),
  endocrinePanelOpen: false,
  toggleEndocrinePanel: () => set((s) => openOnly(s, 'endocrinePanelOpen')),
  labPanelOpen: false,
  toggleLabPanel: () => set((s) => openOnly(s, 'labPanelOpen')),
  physiologyPanelOpen: false,
  togglePhysiologyPanel: () => set((s) => openOnly(s, 'physiologyPanelOpen')),
  impactPanelOpen: false,
  toggleImpactPanel: () => set((s) => openOnly(s, 'impactPanelOpen')),
  environmentPanelOpen: false,
  toggleEnvironmentPanel: () => set((s) => openOnly(s, 'environmentPanelOpen')),
  infectionPanelOpen: false,
  toggleInfectionPanel: () => set((s) => openOnly(s, 'infectionPanelOpen')),
  vascularVisible: false,
  toggleVascular: () => set((s) => ({ vascularVisible: !s.vascularVisible })),
  bloodPanelOpen: false,
  toggleBloodPanel: () => set((s) => openOnly(s, 'bloodPanelOpen')),
  statusPanelOpen: false,
  toggleStatusPanel: () => set((s) => openOnly(s, 'statusPanelOpen')),
  menuOpen: false,
  setMenuOpen: (open) => set({ menuOpen: open }),
  closePanels: () => set((s) => ({ ...CLOSED, tool: s.tool === 'body' || s.tool === 'drugs' ? 'none' : s.tool })),

  padStep: 'idle',
  defibEnergy: 200,
  setPadStep: (s) => set({ padStep: s }),
  setDefibEnergy: (j) => set({ defibEnergy: j }),
  shock: null,
  setShock: (o) => set({ shock: o }),
  resetUiState: () => set({ shock: null, padStep: 'idle' }),

  timeScale: 1,
  setTimeScale: (x) => {
    set({ timeScale: x });
    get().dispatch({ type: 'SET_TIME_SCALE', x });
  },
  reducedMotion: typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false,
  setReducedMotion: (v) => set({ reducedMotion: v }),
  firstRunAccepted: false,
  acceptFirstRun: () => set({ firstRunAccepted: true }),
  showProvenance: null,
  setProvenance: (key) => set({ showProvenance: key }),

  dispatch: () => {
    /* replaced by the bridge once the worker is up */
  },
  setDispatch: (fn) => set({ dispatch: fn }),

  log: [],
  events: [],
  pushEvent: (e) =>
    set((s) => ({
      events: [
        ...s.events.slice(-(MAX_EVENTS - 1)),
        { ...e, id: eventId++, t: s.snapshot?.t ?? 0 },
      ],
    })),
  clearEvents: () => set({ events: [] }),
  pushLog: (text, tone = 'info') => {
    const id = logId++;
    set((s) => ({ log: [...s.log.slice(-2), { id, text, tone }] }));
    // A toast is a CONFIRMATION, not a record. They used to stay until three newer ones
    // pushed them out, so "Morphine 4 mg IV" sat in grey over the body for the rest of
    // the session (user report, 2026-09-26). Each now leaves after LOG_LIFETIME_MS; the
    // timeline keeps the permanent, time-stamped copy (every caller also pushes an event).
    setTimeout(() => set((s) => ({ log: s.log.filter((l) => l.id !== id) })), LOG_LIFETIME_MS);
  },
}));

/**
 * Convenience: administer a cited reference dose, optionally scaled.
 *
 * `dose` and `unit` must name a preset this drug declares for this route — the worker
 * refuses anything else — and `multiplier` scales that cited reference within the
 * bounds the worker enforces. There is deliberately no parameter for an absolute
 * amount, because there is nowhere in the system that would accept one.
 */
export function administerPreset(
  dispatch: (i: SimIntent) => void,
  drugId: string,
  route: Route,
  dose: number,
  unit: string,
  label: string,
  multiplier?: number,
  durationMin?: number,
): void {
  dispatch({
    type: 'ADMINISTER',
    drugId,
    route,
    dose,
    unit,
    label,
    ...(multiplier === undefined ? {} : { multiplier }),
    ...(durationMin === undefined ? {} : { durationMin }),
  });
}
