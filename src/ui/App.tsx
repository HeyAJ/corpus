import { useEffect, useMemo, useRef, useState } from 'react';
import { Viewer } from '../render/scene/Viewer';
import { SimClient } from '../bridge/client';
import { organDefs } from '../render/organs/OrganSet';
import type { OrganId } from '../data/types';
import type { WaveformChannel } from '../bridge/types';
import { useStore } from './store';
import { ToolDock, VesselToggle } from './components/ToolDock';
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
import { NoticeToasts } from './components/NoticeToasts';

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
  const setShock = useStore((s) => s.setShock);
  const pushEvent = useStore((s) => s.pushEvent);
  const vascularVisible = useStore((s) => s.vascularVisible);
  const pushLog = useStore((s) => s.pushLog);

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
      s.tool === 'body',
  );
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

    const viewer = new Viewer(canvas);
    viewerRef.current = viewer;
    viewer.setCallbacks({
      onSelect: (id) => setSelected(id),
      onLabels: (l) => setLabels(l),
    });
    viewer.start();

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
          viewer.pushSnapshot(s);
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
          viewer.setBackgroundMode(arrested ? 'arrest' : s.drugs.length > 0 || s.gi.digesta.length > 0 ? 'active' : 'idle');
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

    const onResize = () => viewer.resize();
    window.addEventListener('resize', onResize);

    // The canvas fills the stage, which fills the screen; observing the box directly
    // (rather than trusting window `resize`) also catches mobile address-bar collapses
    // and orientation changes that resize the layout without a window resize event.
    const observer = new ResizeObserver(() => viewer.resize());
    observer.observe(canvas);

    return () => {
      if (flushTimer !== null) clearTimeout(flushTimer);
      window.removeEventListener('resize', onResize);
      observer.disconnect();
      viewer.dispose();
      client.dispose();
      viewerRef.current = null;
      clientRef.current = null;
    };
  }, [setConnected, setDispatch, setLabels, setSelected, setShock, setSnapshot, pushLog, pushEvent]);

  useEffect(() => {
    if (viewerRef.current) viewerRef.current.reducedMotion = reducedMotion;
  }, [reducedMotion]);

  /* ---- vascular overlay follows the tool dock's blood-drop button ---- */
  useEffect(() => {
    viewerRef.current?.setVascularVisible(vascularVisible);
  }, [vascularVisible]);

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
    <div className={styles.root} data-sheet={anyPanelOpen ? 'open' : 'closed'}>
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

        <OrganLabels />
        <Hud ready={ready} client={client} />
        <Conditions />
        <TimeScaleControl />
        <VesselToggle />
        <NoticeToasts />

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
      <aside className={styles.sheet} aria-label="Panels">
        <StatusPanel />
        <ImpactPanel />
        <PhysiologyPanel />
        <EnvironmentPanel />
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

/** Screen-space organ labels. Their own subscription, so moving labels re-render only them. */
function OrganLabels() {
  const labels = useStore((s) => s.labels);
  return (
    <>
      {labels.map((l) =>
        l.visible ? (
          <span key={l.id} className={styles.organLabel} style={{ transform: `translate(${l.x}px, ${l.y}px) translate(-50%, -50%)` }} aria-hidden="true">
            {ORGANS.find((o) => o.id === l.id)?.displayName}
          </span>
        ) : null,
      )}
    </>
  );
}

/** The metric cluster, top-left: the selected organ's readouts, or the heart's. */
function Hud({ ready, client }: { ready: boolean; client: SimClient | null }) {
  const snapshot = useStore((s) => s.snapshot);
  const selected = useStore((s) => s.selectedOrgan);
  const selectedDef = useMemo(() => ORGANS.find((o) => o.id === selected) ?? null, [selected]);
  const Panel = selectedDef ? PANELS[selectedDef.panel] : null;
  const channelIndex = (c: WaveformChannel) => (client ? client.channelIndex(c) : 0);
  const heartDef = ORGANS.find((o) => o.id === 'heart')!;
  return (
    <div className={styles.hud} data-hud>
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
