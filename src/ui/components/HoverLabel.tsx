import { useEffect, useLayoutEffect, useRef } from 'react';
import { useStore } from '../store';
import { organDefs } from '../../render/organs/OrganSet';
import styles from './hoverlabel.module.css';

const ORGANS = organDefs();

/** Gap between the pointer and the label, px (a display choice: enough that it is never under the cursor). */
const OFFSET_PX = 16;

/**
 * THE HOVER LABEL (mouse only): the display name of the organ under the pointer, drawn beside it.
 *
 * `Viewer.onHoverChanged` fires only for a mouse (never touch) and only while no organ is open, so
 * this component shows nothing on a phone and nothing while an interior is being explored. App.tsx
 * stores the organ in `hoveredOrgan` and sets the canvas cursor to a pointer; this draws the name.
 *
 * The position is NOT React state: a pointer moves far faster than a render is worth, so a window
 * `pointermove` listener writes a transform straight onto the element. The label is clamped inside
 * the stage (its offset parent) so it flips to the other side of the pointer rather than leaving
 * the screen, and `pointer-events: none` keeps it from ever stealing the hover from the canvas.
 */
export function HoverLabel() {
  const organId = useStore((s) => s.hoveredOrgan);
  const ref = useRef<HTMLSpanElement | null>(null);
  const last = useRef({ x: 0, y: 0 });

  const place = () => {
    const el = ref.current;
    const stage = el?.parentElement;
    if (!el || !stage) return;
    const box = stage.getBoundingClientRect();
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let x = last.current.x - box.left + OFFSET_PX;
    let y = last.current.y - box.top + OFFSET_PX;
    if (x + w > box.width) x = last.current.x - box.left - OFFSET_PX - w;
    if (y + h > box.height) y = last.current.y - box.top - OFFSET_PX - h;
    x = Math.max(0, Math.min(box.width - w, x));
    y = Math.max(0, Math.min(box.height - h, y));
    el.style.transform = `translate(${x}px, ${y}px)`;
  };

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      last.current = { x: e.clientX, y: e.clientY };
      place();
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => window.removeEventListener('pointermove', onMove);
  }, []);

  // Place on appearance too: the pointer has not necessarily moved since the organ changed.
  useLayoutEffect(() => {
    if (organId) place();
  }, [organId]);

  const name = organId ? ORGANS.find((o) => o.id === organId)?.displayName : undefined;
  if (!name) return null;
  return (
    <span ref={ref} className={styles.label} aria-hidden="true" data-hover-label>
      {name}
    </span>
  );
}
