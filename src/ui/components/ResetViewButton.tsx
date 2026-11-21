import type { RefObject } from 'react';
import type { Viewer } from '../../render/scene/Viewer';
import { useStore } from '../store';
import styles from './resetview.module.css';

/**
 * THE "RESET VIEW" PILL. After a visitor has orbited, panned or zoomed there was no way back
 * to the whole body except a double-tap on empty space, which nothing on screen mentions.
 * This pill appears only while the camera is away from the home view of the current state
 * (the viewer reports that through `onViewChanged`, which App.tsx mirrors into the store as
 * `viewAtHome`) and goes again once the view is home. It calls `Viewer.resetView`, which
 * returns to the whole body, or to the open organ's framing when one is open.
 *
 * WHERE IT SITS (see the stylesheet): one row above the bottom bar, clear of the corner
 * switches and the first-visit hint, centred on a wide screen and at the right on a phone.
 * `covered` hides it while a sheet or the panels menu is over the stage, because on a phone
 * the sheet would paint straight over it and a control that cannot be tapped must not be drawn.
 */
export function ResetViewButton({ viewerRef, covered }: { viewerRef: RefObject<Viewer | null>; covered: boolean }) {
  const atHome = useStore((s) => s.viewAtHome);
  if (atHome || covered) return null;
  return (
    <button type="button" className={styles.pill} onClick={() => viewerRef.current?.resetView()} data-reset-view>
      Reset view
    </button>
  );
}
