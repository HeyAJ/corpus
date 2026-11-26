import type { ReactNode } from 'react';
import styles from './panelheader.module.css';

/**
 * THE ONE PANEL HEADER.
 *
 * Twelve panels used to write their own title: one in 15 px capitals, one in 13 px grey, one
 * a bare `<span>`, one in 18 px sentence case, and four with no way to close at all, so a
 * visitor learned a different header for every panel. This component is the single answer.
 *
 * CONTRACT
 *  - `title` is EXACTLY the panel's name in the panels menu (sentence case; the menu label
 *    and the title are one string, so the visitor never wonders whether "Hormones" and
 *    "Endocrine" are two panels). It is the accessible name of the close button too:
 *    `aria-label="Close <title>"`.
 *  - `meta` is an optional small chip on the right (the clock "08:00", "stable", a count).
 *    `metaTone` colours it when it carries severity; `metaTitle` is its tooltip.
 *  - `onClose` is whatever that panel's own close or toggle already did; this component
 *    never decides what closing means (the Structures panel, for one, also switches off
 *    its auto-open, and the resuscitation card also clears the pad step).
 *  - `before` is an optional control placed ahead of the title (the Structures panel's way
 *    back from an organ to the list).
 *  - `collapse` turns the title into a button that folds the panel's body (the "What is
 *    happening" panel always did that); the close button stays separate from it.
 *  - `className` lets a panel add placement rules only (sticky, a margin below); the type,
 *    colour and the 44 x 44 close area are not overridable on purpose.
 *
 * The close glyph is drawn 32 px square and its touch area is widened to 44 x 44 with an
 * invisible ::after, so the header row stays compact on a phone sheet that has 46 vh to
 * spend (readability rule 4).
 */
export interface PanelHeaderProps {
  title: string;
  onClose: () => void;
  meta?: ReactNode;
  metaTone?: 'critical' | 'warn' | 'watch';
  metaTitle?: string;
  before?: ReactNode;
  collapse?: { open: boolean; onToggle: () => void };
  className?: string;
}

export function PanelHeader({ title, onClose, meta, metaTone, metaTitle, before, collapse, className }: PanelHeaderProps) {
  const hasMeta = meta !== undefined && meta !== null && meta !== false && meta !== '';
  return (
    <header className={`${styles.header} ${className ?? ''}`} data-panel-header>
      {before}
      <h2 className={styles.title}>
        {collapse ? (
          <button type="button" className={styles.titleButton} onClick={collapse.onToggle} aria-expanded={collapse.open}>
            {title}
          </button>
        ) : (
          title
        )}
      </h2>
      {/* The chip can ellipsise on a narrow phone, so its full text must stay readable: the
          tooltip shows the whole string on hover or long-press. An explicit `metaTitle` wins;
          otherwise a plain-text meta is its own tooltip. A node meta has no text to offer, so
          it gets no tooltip rather than a wrong one. */}
      {hasMeta && (
        <span
          className={`${styles.meta} ${metaTone ? styles[`tone_${metaTone}`] : ''}`}
          title={metaTitle ?? (typeof meta === 'string' ? meta : undefined)}
        >
          {meta}
        </span>
      )}
      <button type="button" className={styles.close} onClick={onClose} aria-label={`Close ${title}`}>
        {'×'}
      </button>
    </header>
  );
}
