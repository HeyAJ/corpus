import { useEffect, useMemo, useRef, useState } from 'react';
import { Viewer } from '../render/scene/Viewer';
import { SimClient } from '../bridge/client';
import { organDefs } from '../render/organs/OrganSet';
import type { OrganId } from '../data/types';
import { ANATOMY, atlasOf } from '../data/anatomy';
import type { WaveformChannel } from '../bridge/types';
import { useStore } from './store';
import { ToolDock, LegendStack } from './components/ToolDock';
import { LayersControl } from './components/LayersControl';
import { CoachMark } from './components/CoachMark';
import { ResetViewButton } from './components/ResetViewButton';
import { buildCatalogue } from './search';
import { parseShareHash, LINK_OPENED_TOAST, type ShareState } from './shareLink';
import { DrugDrawer } from './panels/DrugDrawer';
import { ReceptorPanel } from './panels/ReceptorPanel';
import { ProcedurePanel } from './panels/ProcedurePanel';
import { PANELS, ConditionStack } from './panels/OrganPanels';
import { CardiacPanel } from './panels/OrganPanels';
import { FirstRunModal } from './components/FirstRunModal';
import { BodyPanel } from './panels/BodyPanel';
import { EndocrinePanel } from './panels/EndocrinePanel';
import { LabPanel } from './panels/LabPanel';
import { BloodContents } from './components/BloodContents';
import { Timeline } from './components/Timeline';
import { TimeScaleControl } from './components/TimeScaleControl';
import styles from './app.module.css';
import { StatusPanel } from './panels/StatusPanel';
import { PhysiologyPanel } from './panels/PhysiologyPanel';
import { ImpactPanel } from './panels/ImpactPanel';
import { EnvironmentPanel } from './panels/EnvironmentPanel';
import { InfectionPanel } from './panels/InfectionPanel';
import { ReproductionPanel } from './panels/ReproductionPanel';
import { NoticeToasts } from './components/NoticeToasts';
import { AnatomyPanel } from './panels/AnatomyPanel';
import { BrainScanInset } from './components/BrainScanInset';

/**
 * LAYER C — the application shell.
 *
 * React owns the HUD and nothing else. It never touches the WebGL canvas: the
 * `Viewer` is created once in a ref and driven imperatively, because putting a 60 fps
 * render loop under React's reconciler is how you turn a 2 ms frame into a 12 ms one.
 *
 * Snapshots go two places: into the Zustand store for the HUD (20 Hz, which React
 * handles comfortably) and straight into the Viewer for interpolation.
 */

const ORGANS = organDefs();

/** Fastest the interface re-renders from snapshots, ms (the 3D view takes every one). */
const UI_SNAPSHOT_MS = 100;

/** How long to wait for a selected organ's interior before giving up on a cut or a flight, ms (a display choice). */
const INTERIOR_WAIT_MS = 8000;

/** How long a link waits for the engine to take the new body before showing the view anyway, ms (a display choice). */
const BODY_WAIT_MS = 5000;

/**
 * Apply the URL fragment, if it holds a valid share link (see shareLink.ts for the whitelist).
 * Order: the body first (SET_BODY, then SET_PREGNANCY), because the organ a link names may exist
 * only in that body; then, once a snapshot shows the body has changed, the layers, the organ, the
 * part (with the camera flight) and the cut. A field the link does not carry is left as it is.
 * Only parsed numbers are ever dispatched. Returns a function that cancels the wait.
 */
function applyShareLink(): () => void {
  const st = useStore.getState();
  const repro = st.snapshot?.reproductive;
  const parsed: ShareState = parseShareHash(window.location.hash, buildCatalogue, {
    sex: repro?.sex ?? 'male',
    pregnant: repro?.pregnancy?.pregnant ?? false,
  });
  if (Object.keys(parsed).length === 0) return () => undefined;

  if (parsed.sex) st.dispatch({ type: 'SET_BODY', sex: parsed.sex });
  if (parsed.weeks !== undefined) st.dispatch({ type: 'SET_PREGNANCY', pregnant: parsed.weeks > 0, weeks: parsed.weeks });

  let done = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let unsubscribe: (() => void) | null = null;
  const settle = () => {
    if (done) return;
    done = true;
    unsubscribe?.();
    if (timer !== null) clearTimeout(timer);
    const s = useStore.getState();
    if (parsed.layers) {
      useStore.setState({
        vascularVisible: parsed.layers.includes('vessels'),
        nervesVisible: parsed.layers.includes('nerves'),
        hormonesVisible: parsed.layers.includes('hormones'),
        activityVisible: parsed.layers.includes('activity'),
        bonesVisible: parsed.layers.includes('bones'),
        musclesVisible: parsed.layers.includes('muscles'),
      });
    }
    if (parsed.organ) {
      s.setSelected(parsed.organ as OrganId);
      if (parsed.part) {
        s.setSelectedPart(parsed.part);
        s.requestFocusPart(parsed.part);
      }
      if (parsed.cut) s.setCut(parsed.cut.axis, parsed.cut.depth);
    }
    s.pushLog(LINK_OPENED_TOAST, 'info');
  };
  const bodyIsReady = () => {
    const r = useStore.getState().snapshot?.reproductive;
    if (!r) return false;
    if (parsed.sex && r.sex !== parsed.sex) return false;
    if (parsed.weeks !== undefined && r.pregnancy.pregnant !== parsed.weeks > 0) return false;
    return true;
  };
  if (bodyIsReady() && parsed.sex === undefined && parsed.weeks === undefined) {
    settle();
  } else {
    unsubscribe = useStore.subscribe(() => {
      if (bodyIsReady()) settle();
    });
    timer = setTimeout(settle, BODY_WAIT_MS);
  }
  return () => {
    done = true;
    unsubscribe?.();
    if (timer !== null) clearTimeout(timer);
  };
}

export function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const bottomBarRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const clientRef = useRef<SimClient | null>(null);
  const [ready, setReady] = useState(false);

  const setSnapshot = useStore((s) => s.setSnapshot);
  const setDispatch = useStore((s) => s.setDispatch);
  const setConnected = useStore((s) => s.setConnected);
  const setSelected = useStore((s) => s.setSelected);
  const setLabels = useStore((s) => s.setLabels);
  const setSelectedPart = useStore((s) => s.setSelectedPart);
  const setPartLabels = useStore((s) => s.setPartLabels);
  const setHovered = useStore((s) => s.setHovered);
  const setViewAtHome = useStore((s) => s.setViewAtHome);
  const hoveredOrgan = useStore((s) => s.hoveredOrgan);
  const cutAxis = useStore((s) => s.cutAxis);
  const cutDepth = useStore((s) => s.cutDepth);
  const pendingFocusPart = useStore((s) => s.pendingFocusPart);
  const requestFocusPart = useStore((s) => s.requestFocusPart);
  const selectedPart = useStore((s) => s.selectedPart);
  const selectedOrgan = useStore((s) => s.selectedOrgan);
  const setShock = useStore((s) => s.setShock);
  const pushEvent = useStore((s) => s.pushEvent);
  const vascularVisible = useStore((s) => s.vascularVisible);
  const nervesVisible = useStore((s) => s.nervesVisible);
  const hormonesVisible = useStore((s) => s.hormonesVisible);
  const activityVisible = useStore((s) => s.activityVisible);
  const bonesVisible = useStore((s) => s.bonesVisible);
  const musclesVisible = useStore((s) => s.musclesVisible);
  const layersOpen = useStore((s) => s.layersOpen);
  const pushLog = useStore((s) => s.pushLog);
  // Why the 3D view is not showing, if it is not: it could not start, or it lost its context.
  const [glProblem, setGlProblem] = useState<null | 'unavailable' | 'lost'>(null);

  // The shell no longer subscribes to the snapshot or the organ labels: the HUD, the
  // labels and the condition tags are their own components below, so a tick of the
  // body re-renders the few things that show it rather than the whole interface.
  const anyPanelOpen = useStore(
    (s) =>
      s.statusPanelOpen ||
      s.impactPanelOpen ||
      s.physiologyPanelOpen ||
      s.environmentPanelOpen ||
      s.infectionPanelOpen ||
      s.endocrinePanelOpen ||
      s.labPanelOpen ||
      s.receptorPanelOpen ||
      s.bloodPanelOpen ||
      s.reproductionPanelOpen ||
      s.anatomyPanelOpen ||
      s.tool === 'body' ||
      // The administration sheet and the resuscitation card are docked cards now (wide) or bottom
      // sheets (phone) that cover the stage like a panel; the viewer frames an organ in the free
      // part only while data-sheet is open, so they must count here too.
      s.drawerOpen ||
      s.tool === 'procedure',
  );
  // The HUD folds to its first line while ANY floating sheet is showing (phones only, in
  // CSS). anyPanelOpen above covers the menu panels, Structures and the body tool; the
  // drug drawer is its own flag and the procedure / defib / circulation tools are the
  // remaining modes. Derived from the same store flags those components render from, so
  // the fold and the sheet can never disagree.
  const sheetOpen = useStore(
    (s) =>
      s.drawerOpen ||
      s.tool === 'body' ||
      s.tool === 'procedure' ||
      s.tool === 'defib' ||
      s.tool === 'circulation' ||
      s.statusPanelOpen ||
      s.impactPanelOpen ||
      s.physiologyPanelOpen ||
      s.environmentPanelOpen ||
      s.infectionPanelOpen ||
      s.endocrinePanelOpen ||
      s.labPanelOpen ||
      s.receptorPanelOpen ||
      s.bloodPanelOpen ||
      s.reproductionPanelOpen ||
      s.anatomyPanelOpen,
  );
  const menuOpen = useStore((s) => s.menuOpen);
  const drawerOpen = useStore((s) => s.drawerOpen);
  const reducedMotion = useStore((s) => s.reducedMotion);
  const firstRunAccepted = useStore((s) => s.firstRunAccepted);
  const sharedArrayBuffer = useStore((s) => s.sharedArrayBuffer);
  const log = useStore((s) => s.log);

  /* --------------------------------------------------- bottom bar height */

  // The drawer is anchored above the bottom bar by CSS, and CSS alone cannot know the
  // bar's height: it holds the dock, the toasts and the warning, and on a touch screen the
  // 44 px target rule makes its buttons taller than the nominal token assumes. So the bar
  // is measured and published as --corpus-bar-actual, which drawer.module.css reads (with
  // the token as a fallback). Guessing the height is what let the sheet overlap the dock.
  useEffect(() => {
    const bar = bottomBarRef.current;
    if (!bar) return;
    const root = document.documentElement;
    const publish = () => root.style.setProperty('--corpus-bar-actual', `${Math.ceil(bar.getBoundingClientRect().height)}px`);
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(bar);
    return () => {
      observer.disconnect();
      root.style.removeProperty('--corpus-bar-actual');
    };
  }, []);

  /* ------------------------------------------------------------ bootstrap */

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // THE 3D VIEW MAY NOT BE ABLE TO START. `new Viewer` throws when WebGL2 is unavailable
    // (a blocklisted GPU, hardware acceleration switched off, a locked-down browser) and
    // the stage used to be left blank with nothing to say why. The simulation does not need
    // the picture, so a failed start is caught, explained in a card, and everything else
    // (the banner, the readouts, the panels, the sim worker) carries on without a viewer.
    let viewer: Viewer | null = null;
    try {
      viewer = new Viewer(canvas);
    } catch (err) {
      console.error('CORPUS: the 3D view could not start', err);
      setGlProblem('unavailable');
    }
    viewerRef.current = viewer;

    // A lost GL context (the GPU driver reset, the tab was backgrounded under memory
    // pressure) used to freeze the picture silently while the numbers kept moving.
    const onContextLost = (e: Event) => {
      e.preventDefault();
      setGlProblem('lost');
    };
    const onContextRestored = () => setGlProblem((p) => (p === 'lost' ? null : p));
    canvas.addEventListener('webglcontextlost', onContextLost);
    canvas.addEventListener('webglcontextrestored', onContextRestored);

    viewer?.setCallbacks({
      onSelect: (id) => setSelected(id),
      onLabels: (l) => setLabels(l),
      // A tap on a structure INSIDE the selected organ, and where each structure sits on
      // screen. Both go to the store so the structures panel and the 3D view agree on
      // which part is picked whichever of the two the user touched.
      onPart: (p) => setSelectedPart(p ? p.part : null),
      onPartLabels: (l) => setPartLabels(l),
    });
    // The Reset view pill and the hover label read the store, so the viewer's two one-slot
    // callbacks are mirrored into it here (a pointer over an organ is reported for a MOUSE only).
    if (viewer) {
      viewer.onViewChanged = (atHome) => setViewAtHome(atHome);
      viewer.onHoverChanged = (id) => setHovered((id as OrganId | null) ?? null);
    }
    viewer?.start();

    // DEVELOPMENT ONLY. The browser probes that check the renderer (.cache/probes) need to
    // select an organ by name rather than by guessing where it is on screen, and to read
    // the store. Vite removes this branch from a production build, so the live site never
    // exposes the handle.
    if (import.meta.env.DEV && viewer) {
      (window as unknown as { __corpus?: unknown }).__corpus = { viewer, store: useStore };
    }

    const client = new SimClient();
    clientRef.current = client;
    let lastUiSnapshot = 0;
    let pendingSnapshot: Parameters<typeof setSnapshot>[0] | null = null;
    let flushTimer: ReturnType<typeof setTimeout> | null = null;

    void client
      .init(
        0x5eed,
        (s) => {
          // The viewer interpolates between every snapshot (20 Hz). The interface only
          // needs numbers a person can read, so it is refreshed at most ten times a second:
          // each refresh is a React render of every open readout, and halving them is
          // frame time handed back to the 3D body. The LAST snapshot of any burst is
          // always delivered, so a readout is never left showing a stale value.
          viewer?.pushSnapshot(s);
          pendingSnapshot = s;
          const now = performance.now();
          if (now - lastUiSnapshot >= UI_SNAPSHOT_MS) {
            lastUiSnapshot = now;
            setSnapshot(s);
            pendingSnapshot = null;
          } else if (flushTimer === null) {
            flushTimer = setTimeout(() => {
              flushTimer = null;
              if (pendingSnapshot) {
                lastUiSnapshot = performance.now();
                setSnapshot(pendingSnapshot);
                pendingSnapshot = null;
              }
            }, UI_SNAPSHOT_MS);
          }

          // Background mode follows the body's state (spec 8.1). Done here rather than in
          // a React effect so the shell does not have to subscribe to the snapshot.
          const arrested = s.conditions.some((c) => c.id === 'arrest' || c.id === 'vfib' || c.id === 'asystole');
          viewer?.setBackgroundMode(arrested ? 'arrest' : s.drugs.length > 0 || s.gi.digesta.length > 0 ? 'active' : 'idle');
        },
        (r) => {
          setShock({ ...r, at: Date.now() });
          const tone = r.converted ? 'info' : 'critical';
          const label = r.converted ? 'Shock converted the rhythm' : 'Shock did not convert';
          pushLog(label, tone);
          // The single most consequential event in an arrest, and the one whose
          // relationship to the preceding compressions is the whole teaching point.
          // The reason is carried too: the model reports the probability it rolled and
          // what set it, and a record that kept only the outcome would lose that.
          pushEvent({ kind: 'procedure', label, detail: r.reason, tone });
        },
      )
      .then(({ sharedArrayBuffer: sab }) => {
        setConnected(true, sab);
        setDispatch((intent) => client.dispatch(intent));
        setReady(true);
      });

    const onResize = () => viewer?.resize();
    window.addEventListener('resize', onResize);

    // The canvas fills the stage, which fills the screen; observing the box directly
    // (rather than trusting window `resize`) also catches mobile address-bar collapses
    // and orientation changes that resize the layout without a window resize event.
    const observer = new ResizeObserver(() => viewer?.resize());
    observer.observe(canvas);

    return () => {
      if (flushTimer !== null) clearTimeout(flushTimer);
      window.removeEventListener('resize', onResize);
      observer.disconnect();
      canvas.removeEventListener('webglcontextlost', onContextLost);
      canvas.removeEventListener('webglcontextrestored', onContextRestored);
      viewer?.dispose();
      client.dispose();
      viewerRef.current = null;
      clientRef.current = null;
    };
  }, [setConnected, setDispatch, setLabels, setSelected, setSelectedPart, setPartLabels, setShock, setSnapshot, pushLog, pushEvent, setHovered, setViewAtHome]);

  useEffect(() => {
    if (viewerRef.current) viewerRef.current.reducedMotion = reducedMotion;
  }, [reducedMotion]);

  /* ---- the picked structure is one fact with two views: the list and the body ---- */
  useEffect(() => {
    viewerRef.current?.highlightPart(selectedPart);
  }, [selectedPart]);

  /* ---- the list in the structures panel selects in the 3D view (select is a no-op when unchanged) ---- */
  useEffect(() => {
    viewerRef.current?.select(selectedOrgan);
  }, [selectedOrgan]);

  /* ---- the pointer cursor over an organ (mouse only: the viewer never reports hover for touch) ----
   * The viewer already shows the hovered organ's name as its big label; a second tag near the
   * pointer duplicated it and was removed, so the cursor is the only extra cue. */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) canvas.style.cursor = hoveredOrgan ? 'pointer' : '';
  }, [hoveredOrgan]);

  /* ---- the section and the camera flight wait for the organ's interior ----
   * `Viewer.select` clears the slice and builds the interior in a worker, and `focusPart` does
   * nothing before the interior exists. The cut is applied at once (it is harmless before the
   * interior is ready) and again, with the highlight and any requested flight, as soon as
   * `interiorReady` reads true. The poll gives up after INTERIOR_WAIT_MS so a failed build
   * cannot leave a timer running. */
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    if (!selectedOrgan) {
      viewer.setSlice(null, 0);
      return;
    }
    viewer.setSlice(cutAxis, cutDepth);
    const finish = () => {
      // The viewer reports "no part picked" when it selects an organ, which clears a part the
      // search or a link set a moment earlier (seen: a search for "pyr" ended with an open
      // kidney and no part). The requested part is therefore set again here, once the
      // interior exists, before the camera is sent to it.
      if (pendingFocusPart) useStore.getState().setSelectedPart(pendingFocusPart);
      viewer.highlightPart(useStore.getState().selectedPart);
      viewer.setSlice(cutAxis, cutDepth);
      if (pendingFocusPart) {
        viewer.focusPart(pendingFocusPart);
        requestFocusPart(null);
      }
    };
    if (viewer.interiorReady) {
      finish();
      return;
    }
    const started = performance.now();
    const timer = window.setInterval(() => {
      if (viewer.interiorReady) {
        window.clearInterval(timer);
        finish();
      } else if (performance.now() - started > INTERIOR_WAIT_MS) {
        window.clearInterval(timer);
      }
    }, 100);
    return () => window.clearInterval(timer);
  }, [selectedOrgan, cutAxis, cutDepth, pendingFocusPart, requestFocusPart]);

  /* ---- a shared link: restore a body and a view once the engine is up ---- */
  useEffect(() => {
    if (!ready) return;
    let stop: (() => void) | null = null;
    const apply = () => {
      stop?.();
      stop = applyShareLink();
    };
    apply();
    window.addEventListener('hashchange', apply);
    return () => {
      window.removeEventListener('hashchange', apply);
      stop?.();
    };
  }, [ready]);

  /* ---- vascular overlay follows the tool dock's blood-drop button ---- */
  useEffect(() => {
    viewerRef.current?.setVascularVisible(vascularVisible);
  }, [vascularVisible]);

  /* ---- nervous-system and hormone-traffic overlays follow their stage switches ---- */
  useEffect(() => {
    viewerRef.current?.setNervesVisible(nervesVisible);
  }, [nervesVisible]);
  useEffect(() => {
    viewerRef.current?.setHormonesVisible(hormonesVisible);
  }, [hormonesVisible]);
  useEffect(() => {
    viewerRef.current?.setActivityVisible(activityVisible);
  }, [activityVisible]);
  /* ---- the skeleton layer: built on first need, then shown and hidden (Viewer.setLayerVisible) ---- */
  useEffect(() => {
    viewerRef.current?.setLayerVisible('bones', bonesVisible);
  }, [bonesVisible]);
  useEffect(() => {
    viewerRef.current?.setLayerVisible('muscles', musclesVisible);
  }, [musclesVisible]);

  /* ---------------------------------------------------------------- input */

  const pointer = useRef({ down: false, moved: false, x: 0, y: 0 });

  const toNormalised = (e: React.PointerEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * 2 - 1,
      y: -((e.clientY - rect.top) / rect.height) * 2 + 1,
    };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const n = toNormalised(e);
    pointer.current = { down: true, moved: false, x: n.x, y: n.y };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const n = toNormalised(e);
    const dx = n.x - pointer.current.x;
    const dy = n.y - pointer.current.y;
    if (pointer.current.down && (Math.abs(dx) > 0.004 || Math.abs(dy) > 0.004)) pointer.current.moved = true;
    viewerRef.current?.handlePointerMove(n.x, n.y, pointer.current.down, dx, dy);
    pointer.current.x = n.x;
    pointer.current.y = n.y;
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const n = toNormalised(e);
    // A drag orbits; a tap selects. 0.004 of normalised space is about 2 px.
    if (!pointer.current.moved) viewerRef.current?.handleTap(n.x, n.y);
    pointer.current.down = false;
  };

  const onWheel = (e: React.WheelEvent) => {
    viewerRef.current?.handleWheel(Math.sign(e.deltaY) * Math.min(3, Math.abs(e.deltaY) / 100));
  };

  /* --------------------------------------------------------------- render */

  const client = clientRef.current;

  return (
    <div className={styles.root} data-sheet={anyPanelOpen ? 'open' : 'closed'} data-card={sheetOpen ? 'open' : 'closed'}
      data-menu={menuOpen ? 'open' : 'closed'} data-layers={layersOpen ? 'open' : 'closed'} data-drawer-open={drawerOpen ? 'open' : 'closed'}>
      {/*
        THE STAGE. The body and everything that must sit OVER the body: its own HUD,
        the screen-space labels, the condition tags, the speed control, the engine's
        toasts, the defib pad zones and the administration drawer. It is a positioning
        context of its own, so a label projected at canvas pixel (x, y) lands at (x, y)
        here and a pad placed at 50 % is centred on the body.
      */}
      <div className={styles.stage}>
        <canvas
          ref={canvasRef}
          className={styles.canvas}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={() => viewerRef.current?.handlePointerLeave()}
          onWheel={onWheel}
          aria-label="Three-dimensional body. Tap an organ to read its telemetry."
          role="img"
        />

        {glProblem && <GlProblemCard kind={glProblem} />}

        <OrganLabels />
        <PartLabel />
        <Hud ready={ready} client={client} folded={sheetOpen} />
        <Conditions />
        <TimeScaleControl />
        <LayersControl />
        <LegendStack viewerRef={viewerRef} ready={ready} />
        <CoachMark covered={sheetOpen || menuOpen || layersOpen} />
        <ResetViewButton viewerRef={viewerRef} covered={sheetOpen || menuOpen || layersOpen} />
        <NoticeToasts />
        <BrainScanInset viewerRef={viewerRef} ready={ready} />

        {/* The resuscitation flow is spatial — pads on the thorax, eyes on the chest —
            so it stays anchored to the body rather than joining the panel sheet. */}
        <ProcedurePanel />

        {/* The administration drawer is a confined modal sheet: it covers the body only,
            never the dock below it. */}
        <DrugDrawer />
      </div>

      {/*
        THE SHEET. At most one panel is open (store.ts), so this holds one card. The
        blood-contents legend is one of those panels now, opened from the menu, because
        the vessels it describes are always on and it would otherwise own the sheet.
      */}
      <aside className={styles.sheet} aria-label="Panels" data-stage-cover>
        <StatusPanel />
        <ImpactPanel />
        <PhysiologyPanel />
        <EnvironmentPanel />
        <ReproductionPanel />
        <AnatomyPanel />
        <InfectionPanel />
        <EndocrinePanel />
        <LabPanel />
        <ReceptorPanel />
        <BloodContents />
        <BodyPanel />
      </aside>

      {/*
        THE BOTTOM BAR. The timeline and its toasts, the tool dock and the permanent
        warning, floating over the bottom of the body. Its height is measured and
        published (--corpus-bar-actual) so the drawer and the panel sheet always stop
        above it.
      */}
      <div className={styles.bottomBar} ref={bottomBarRef}>
        <div className={styles.bottomStack}>
          {log.length > 0 && (
            <div className={styles.log} role="log" aria-live="polite">
              {log.slice(-3).map((l) => (
                <span key={l.id} className={styles[`log_${l.tone}`]}>
                  {l.text}
                </span>
              ))}
            </div>
          )}
          <Timeline />
        </div>

        <ToolDock />

        {/* Permanently visible, not dismissible (spec 10.1). */}
        <footer className={styles.disclaimer}>
          <strong>NOT FOR CLINICAL USE {'—'} EDUCATIONAL SIMULATION</strong>
          <a href="docs/MODEL_LIMITATIONS.md" target="_blank" rel="noreferrer">
            Model limitations
          </a>
          {!sharedArrayBuffer && ready && (
            <span className={styles.degraded} title="SharedArrayBuffer is unavailable, so waveforms arrive in 50 ms bursts instead of continuously. See docs/MODEL_LIMITATIONS.md.">
              degraded waveform transport
            </span>
          )}
        </footer>
      </div>

      {!firstRunAccepted && <FirstRunModal />}
    </div>
  );
}

/**
 * The plain-language card shown in place of the body when the 3D view cannot draw. It says
 * what happened and what to try, and promises nothing it cannot keep: the numbers and the
 * panels still run, so the card says so. The wording is documented in the report for the
 * documentation writer; change both together.
 */
function GlProblemCard({ kind }: { kind: 'unavailable' | 'lost' }) {
  return (
    <div className={styles.glCard} role="alert" data-gl-problem={kind}>
      {kind === 'unavailable' ? (
        <>
          <strong>The 3D body cannot be shown on this device.</strong>
          <p>
            Your browser did not give CORPUS the graphics support (WebGL 2) it needs to draw the
            body. The simulation itself is still running, so the readouts and panels work.
          </p>
          <p>
            To see the body, try another browser, turn on hardware acceleration in your browser
            settings, or open CORPUS on another device.
          </p>
        </>
      ) : (
        <>
          <strong>The 3D view stopped.</strong>
          <p>
            The browser took the graphics context away from this page, so the picture of the
            body froze. The readouts still update. Reloading the page brings the body back, but
            starts the simulation again from rest.
          </p>
          <button type="button" className={styles.glReload} onClick={() => window.location.reload()}>
            Reload
          </button>
        </>
      )}
    </div>
  );
}

/** Screen-space organ labels. Their own subscription, so moving labels re-render only them. */
function OrganLabels() {
  const labels = useStore((s) => s.labels);
  // The selected organ's own label is not drawn: the top-left chip already names it, and
  // the label sat on top of the interior that is now the point of selecting it.
  const selected = useStore((s) => s.selectedOrgan);
  return (
    <>
      {labels.map((l) =>
        l.visible && l.id !== selected ? (
          <span key={l.id} className={styles.organLabel} style={{ transform: `translate(${l.x}px, ${l.y}px) translate(-50%, -50%)` }} aria-hidden="true">
            {ORGANS.find((o) => o.id === l.id)?.displayName}
          </span>
        ) : null,
      )}
    </>
  );
}

/** The picked structure's name, pinned to its place in the interior. Its own subscription. */
function PartLabel() {
  const picked = useStore((s) => s.selectedPart);
  const organ = useStore((s) => s.selectedOrgan);
  const anchor = useStore((s) => (s.selectedPart ? s.partLabels.find((l) => l.id === s.selectedPart) : undefined));
  if (!picked || !organ || !anchor || !anchor.visible) return null;
  const organDef = ORGANS.find((o) => o.id === organ);
  const part = organDef ? ANATOMY[atlasOf(organDef)]?.parts.find((p) => p.id === picked) : undefined;
  if (!part) return null;
  return (
    <span className={styles.partLabel} style={{ transform: `translate(${anchor.x}px, ${anchor.y}px) translate(-50%, -50%)` }} aria-hidden="true">
      {part.label}
    </span>
  );
}

/** The metric cluster, top-left: the selected organ's readouts, or the heart's. */
function Hud({ ready, client, folded }: { ready: boolean; client: SimClient | null; folded: boolean }) {
  const snapshot = useStore((s) => s.snapshot);
  const selected = useStore((s) => s.selectedOrgan);
  const selectedDef = useMemo(() => ORGANS.find((o) => o.id === selected) ?? null, [selected]);
  // A panel kind the interface has no dedicated layout for falls back to the generic one
  // rather than to nothing, so adding an organ to the data can never blank the HUD.
  const Panel = selectedDef ? ((PANELS as Record<string, (typeof PANELS)['generic']>)[selectedDef.panel] ?? PANELS.generic) : null;
  const channelIndex = (c: WaveformChannel) => (client ? client.channelIndex(c) : 0);
  const heartDef = ORGANS.find((o) => o.id === 'heart')!;
  return (
    <div className={styles.hud} data-hud data-folded={folded ? 'true' : undefined}>
      {!ready && <div className={styles.booting}>Starting body engine{'…'}</div>}
      {ready && snapshot && (
        <>
          {Panel && selectedDef ? (
            <Panel snapshot={snapshot} organ={selectedDef} ring={client?.ring ?? null} channelIndex={channelIndex} />
          ) : (
            <CardiacPanel snapshot={snapshot} organ={heartDef} ring={client?.ring ?? null} channelIndex={channelIndex} />
          )}
        </>
      )}
    </div>
  );
}

/** Condition tags, top-right. */
function Conditions() {
  const conditions = useStore((s) => s.snapshot?.conditions);
  return conditions ? <ConditionStack conditions={conditions} /> : null;
}

export type { OrganId };
