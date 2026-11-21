import { useCallback, useEffect, useState } from 'react';
import { useStore } from '../store';
import styles from './coachmark.module.css';

/**
 * THE FIRST-VISIT HINT: "Tap any organ to look inside".
 *
 * Nothing on the screen told a first-time visitor that the organs open, and opening them is
 * the point of the product. This is one small pill over the stage, shown once, after the
 * welcome dialog has been accepted (never under it). It goes away at the first of: an organ
 * being selected, a tap on the pill itself, or HINT_MS. Whichever happens, the fact is
 * remembered under a versioned key so a returning visitor is never told twice; bumping the
 * suffix would show it again. Storage is read and written inside try/catch because a private
 * window or blocked site data makes even reading it throw; then the hint simply shows again
 * next visit, the safe direction to fail.
 *
 * The wording follows the input: "Tap" with a touch screen, "Click" with a mouse
 * (`(pointer: coarse)`). The pill is a status message and not a button, so it is not a
 * control that a sheet or the menu could be reported as painting over, and it takes pointer
 * events only so that a tap on it dismisses it.
 */
const HINT_KEY = 'corpus.hintTapOrgan.v1';
/** How long the hint stays if nothing dismisses it, ms (a display choice). */
export const HINT_MS = 12000;

function alreadySeen(): boolean {
  try {
    return window.localStorage.getItem(HINT_KEY) === 'true';
  } catch {
    return false;
  }
}

function remember(): void {
  try {
    window.localStorage.setItem(HINT_KEY, 'true');
  } catch {
    /* Not persisted; the hint can show again next visit. */
  }
}

export function CoachMark({ covered }: { covered: boolean }) {
  const accepted = useStore((s) => s.firstRunAccepted);
  const selected = useStore((s) => s.selectedOrgan);
  const [seen, setSeen] = useState(alreadySeen);
  const [coarse] = useState(() => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
  const visible = accepted && !seen;

  const dismiss = useCallback(() => {
    remember();
    setSeen(true);
  }, []);

  useEffect(() => {
    if (!visible) return;
    const id = window.setTimeout(dismiss, HINT_MS);
    return () => window.clearTimeout(id);
  }, [visible, dismiss]);

  useEffect(() => {
    if (visible && selected) dismiss();
  }, [visible, selected, dismiss]);

  // On a phone the panels menu and the sheets do not span the whole width, so the hint used to
  // show beside and through them, and its text ran over the menu's last row. While anything
  // covers the stage the hint is simply not drawn. Its 12-second clock keeps running in the
  // meantime, so it never reappears later than a visitor would expect.
  if (!visible || covered) return null;
  return (
    <div className={styles.hint} role="status" data-coach-mark onPointerDown={dismiss}>
      {coarse ? 'Tap any organ to look inside' : 'Click any organ to look inside'}
    </div>
  );
}
