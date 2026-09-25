import { useEffect, useMemo, useRef, useState } from 'react';
import { Viewer } from '../render/scene/Viewer';
import { SimClient } from '../bridge/client';
import { organDefs } from '../render/organs/OrganSet';
import type { OrganId } from '../data/types';
import type { WaveformChannel } from '../bridge/types';
import { useStore } from './store';
import { ToolDock } from './components/ToolDock';
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

  const snapshot = useStore((s) => s.snapshot);
  const selected = useStore((s) => s.selectedOrgan);
  const labels = useStore((s) => s.labels);
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

    void client
      .init(
        0x5eed,
        (s) => {
          setSnapshot(s);
          viewer.pushSnapshot(s);
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

    // The canvas no longer fills the window — it fills the STAGE column, which changes
    // width whenever the rail is toggled between the desktop and phone layouts, or when
    // a panel opening pushes the grid around. A window `resize` event never fires for
    // that, so observe the canvas box directly and reframe the body whenever it moves.
    const observer = new ResizeObserver(() => viewer.resize());
    observer.observe(canvas);

    return () => {
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

  /* ---- background mode follows the body's state (spec 8.1) ---- */
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !snapshot) return;
    const arrested = snapshot.conditions.some((c) => c.id === 'arrest' || c.id === 'vfib' || c.id === 'asystole');
    viewer.setBackgroundMode(arrested ? 'arrest' : snapshot.drugs.length > 0 || snapshot.gi.digesta.length > 0 ? 'active' : 'idle');
  }, [snapshot]);

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

  const selectedDef = useMemo(() => ORGANS.find((o) => o.id === selected) ?? null, [selected]);
  const Panel = selectedDef ? PANELS[selectedDef.panel] : null;
  const client = clientRef.current;
  const channelIndex = (c: WaveformChannel) => (client ? client.channelIndex(c) : 0);

  const heartDef = ORGANS.find((o) => o.id === 'heart')!;

  return (
    <div className={styles.root}>
      {/*
        THE STAGE. The body and everything that must sit OVER the body: its own HUD,
        the screen-space labels, the condition tags, the speed control, the engine's
        toasts, the defib pad zones and the administration drawer. It is a positioning
        context of its own, so a label projected at canvas pixel (x, y) lands at (x, y)
        here and a pad placed at 50 % is centred on the body, not on a viewport that now
        also contains the rail.
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

        {/* Screen-space organ labels, anchored to the projected centroid. Not 3D
            sprites: they must stay pixel-crisp and must not scale with distance. */}
        {labels.map((l) =>
          l.visible ? (
            <span key={l.id} className={styles.organLabel} style={{ left: l.x, top: l.y }} aria-hidden="true">
              {ORGANS.find((o) => o.id === l.id)?.displayName}
            </span>
          ) : null,
        )}

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

        {snapshot && <ConditionStack conditions={snapshot.conditions} />}
        <TimeScaleControl />
        <NoticeToasts />

        {/* The resuscitation flow is spatial — pads on the thorax, eyes on the chest —
            so it stays anchored to the body rather than joining the rail. */}
        <ProcedurePanel />

        {/* The administration drawer is a confined modal sheet: it covers the body only,
            never the rail beside it or the dock below it. */}
        <DrugDrawer />
      </div>

      {/*
        THE RAIL. Every readout and control panel is a plain card here, laid out top to
        bottom by a flex column that scrolls once the stack outgrows the viewport. Because
        a column cannot make two children share a line, no panel can ever hide another —
        the whole point of the rebuild. Each panel renders null when closed, so the rail
        holds exactly what is open, and the always-present "what is happening" leads it.
      */}
      <aside className={styles.rail} aria-label="Panels">
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
        THE BOTTOM BAR. A reserved row for the timeline and its toasts, the tool dock,
        and the permanent warning. Nothing in the stage or the rail can paint into it, so
        "the drawer covers the dock" is now a layout impossibility rather than a bug.
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

export type { OrganId };
