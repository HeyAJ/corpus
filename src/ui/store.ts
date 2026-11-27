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
/** Which side of the open organ a section removes; mirrors the viewer's SliceAxis. */
export type CutAxis = 'front' | 'side' | 'top';
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
  /**
   * "Structures": the parts of the selected organ, with what each does and how active
   * it is. Opens by itself when an organ is selected (unless the user has closed it for
   * this session - `anatomyAuto`), because seeing inside is the reason to tap an organ.
   */
  anatomyPanelOpen: boolean;
  toggleAnatomyPanel: () => void;
  setAnatomyPanel: (open: boolean) => void;
  anatomyAuto: boolean;
  setAnatomyAuto: (auto: boolean) => void;
  /** The part of the selected organ the user has picked, by its id within the organ. */
  selectedPart: string | null;
  setSelectedPart: (id: string | null) => void;
  /** Screen anchors of the selected organ's parts, from the viewer. */
  partLabels: { id: string; x: number; y: number; visible: boolean }[];
  setPartLabels: (l: { id: string; x: number; y: number; visible: boolean }[]) => void;
  /** Reproduction: sex, the menstrual cycle, pregnancy and the sexual response. */
  reproductionPanelOpen: boolean;
  toggleReproductionPanel: () => void;
  /**
   * The skeleton layer ("Bones" in the Layers control). Off at start; while off no bone geometry is
   * even built (OrganSet builds a layer organ on first need). Selecting a bone organ does NOT change
   * this flag: a selected organ is drawn because it is selected, not because its layer is on.
   */
  /** The see-through skin outline (BodyOutline). ON at start: it is today's look, not an added layer. */
  glassVisible: boolean;
  toggleGlass: () => void;
  bonesVisible: boolean;
  toggleBones: () => void;
  musclesVisible: boolean;
  toggleMuscles: () => void;
  /**
   * The Layers popover (ToolDock.tsx). It is NOT a panel and takes no part in `openOnly`: it is a
   * small anchored menu that closes on an outside tap, Escape, or the opening of any panel.
   */
  layersOpen: boolean;
  setLayersOpen: (open: boolean) => void;
  /** Body-wide overlays, like the vessels: the nerves, and hormones leaving their glands. */
  nervesVisible: boolean;
  toggleNerves: () => void;
  hormonesVisible: boolean;
  toggleHormones: () => void;
  /** Recolour every unselected organ by how far it is above its own rest (the Activity switch). */
  activityVisible: boolean;
  toggleActivity: () => void;
  /**
   * The section through the selected organ (Structures panel "Cut"). The viewer owns the real
   * state and clears it whenever the selection changes; this mirror exists so the panel, a
   * shared link and the viewer agree, and it is cleared by `setSelected` for the same reason.
   */
  cutAxis: CutAxis | null;
  cutDepth: number;
  setCut: (axis: CutAxis | null, depth?: number) => void;
  /**
   * A part the camera should fly to as soon as the selected organ's interior is built (the
   * interior takes a moment, and `Viewer.focusPart` does nothing before it exists). Set by
   * the search box and by a shared link; consumed (and cleared) by App.tsx.
   */
  pendingFocusPart: string | null;
  requestFocusPart: (id: string | null) => void;
  /** False once the visitor has moved the camera away from the home view (the Reset view pill). */
  viewAtHome: boolean;
  setViewAtHome: (atHome: boolean) => void;
  /** Keep the brain scan inset on screen when the brain is not the selected organ. */
  scanPinned: boolean;
  toggleScanPinned: () => void;
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
/**
 * THE WELCOME DIALOG IS ASKED ONCE PER BROWSER, NOT ONCE PER LOAD. `firstRunAccepted` used to
 * start false on every page load, so a returning visitor met the same dialog every time.
 * The acceptance is remembered under a VERSIONED key, so that a future change to what the
 * dialog says can ask again by bumping the suffix. Storage is wrapped in try/catch because a
 * private window, blocked site data or a sandboxed frame makes even reading it throw; in
 * that case the visitor is simply asked again, which is the safe direction to fail. The
 * permanent NOT FOR CLINICAL USE banner is a separate element and does not depend on this.
 */
const FIRST_RUN_KEY = 'corpus.firstRunAccepted.v1';

function readFirstRunAccepted(): boolean {
  try {
    return window.localStorage.getItem(FIRST_RUN_KEY) === 'true';
  } catch {
    return false;
  }
}

function writeFirstRunAccepted(): void {
  try {
    window.localStorage.setItem(FIRST_RUN_KEY, 'true');
  } catch {
    /* Not persisted; the dialog will be shown again next visit. */
  }
}

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
  anatomyPanelOpen: false,
  reproductionPanelOpen: false,
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
  // Selecting an organ clears the part picked in the previous one, and brings up its
  // structures unless the user has dismissed that panel; deselecting closes it.
  setSelected: (id) =>
    set((s) => {
      if (id === s.selectedOrgan) return {};
      // A section belongs to the organ it was made in (the viewer clears its own on every
      // selection change), so the mirror is cleared with it.
      if (id === null) return { selectedOrgan: null, selectedPart: null, partLabels: [], anatomyPanelOpen: false, cutAxis: null, cutDepth: 0.5 };
      if (!s.anatomyAuto) return { selectedOrgan: id, selectedPart: null, cutAxis: null, cutDepth: 0.5 };
      return {
        ...CLOSED,
        tool: s.tool === 'body' || s.tool === 'drugs' ? ('none' as ToolMode) : s.tool,
        selectedOrgan: id,
        selectedPart: null,
        cutAxis: null,
        cutDepth: 0.5,
        anatomyPanelOpen: true,
      };
    }),
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
  anatomyPanelOpen: false,
  toggleAnatomyPanel: () => set((s) => openOnly(s, 'anatomyPanelOpen')),
  setAnatomyPanel: (open) => set((s) => (open ? { ...openOnly({ ...s, anatomyPanelOpen: false }, 'anatomyPanelOpen') } : { anatomyPanelOpen: false })),
  anatomyAuto: true,
  setAnatomyAuto: (auto) => set({ anatomyAuto: auto }),
  selectedPart: null,
  setSelectedPart: (id) => set({ selectedPart: id }),
  partLabels: [],
  setPartLabels: (l) => set({ partLabels: l }),
  reproductionPanelOpen: false,
  toggleReproductionPanel: () => set((s) => openOnly(s, 'reproductionPanelOpen')),
  glassVisible: true,
  toggleGlass: () => set((s) => ({ glassVisible: !s.glassVisible })),
  bonesVisible: false,
  toggleBones: () => set((s) => ({ bonesVisible: !s.bonesVisible })),
  musclesVisible: false,
  toggleMuscles: () => set((s) => ({ musclesVisible: !s.musclesVisible })),
  layersOpen: false,
  setLayersOpen: (open) => set({ layersOpen: open }),
  nervesVisible: false,
  toggleNerves: () => set((s) => ({ nervesVisible: !s.nervesVisible })),
  hormonesVisible: false,
  toggleHormones: () => set((s) => ({ hormonesVisible: !s.hormonesVisible })),
  activityVisible: false,
  toggleActivity: () => set((s) => ({ activityVisible: !s.activityVisible })),
  cutAxis: null,
  cutDepth: 0.5,
  setCut: (axis, depth) => set((s) => ({ cutAxis: axis, cutDepth: depth === undefined ? s.cutDepth : Math.max(0, Math.min(1, Number.isFinite(depth) ? depth : 0.5)) })),
  pendingFocusPart: null,
  requestFocusPart: (id) => set({ pendingFocusPart: id }),
  viewAtHome: true,
  setViewAtHome: (atHome) => set({ viewAtHome: atHome }),
  scanPinned: false,
  toggleScanPinned: () => set((s) => ({ scanPinned: !s.scanPinned })),
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
  firstRunAccepted: readFirstRunAccepted(),
  acceptFirstRun: () => {
    writeFirstRunAccepted();
    set({ firstRunAccepted: true });
  },
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
