/**
 * THE GLYPHS OF THE LAYERS CONTROL (and the blood drop the panels menu also uses).
 *
 * Each is the icon the corner switch of the same name used to carry, moved here when the four
 * switches became one Layers popover, so the chip, the rows and the menu draw the same picture.
 * Every colour is the hue of the thing it switches on (red for blood, amber for the nerves, violet
 * for the hormones, the ramp's amber for Activity, ivory-brown for bone); they are decoration
 * beside a word, never the only carrier of meaning.
 */

const S = 20;

export function BloodDrop({ filled }: { filled: boolean }) {
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

export function NerveGlyph({ on }: { on: boolean }) {
  const c = '#d08a1c';
  return (
    <svg width={S} height={S} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3v7m0 0-6 5m6-5 6 5m-6-5v11" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="12" cy="10" r="2.2" fill={on ? c : 'none'} stroke={c} strokeWidth="1.6" />
    </svg>
  );
}

export function HormoneGlyph({ on }: { on: boolean }) {
  const c = '#7a4fb0';
  return (
    <svg width={S} height={S} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="8" cy="9" r="3.2" fill={on ? c : 'none'} stroke={c} strokeWidth="1.6" />
      <circle cx="16.5" cy="7" r="2" fill={on ? c : 'none'} stroke={c} strokeWidth="1.6" />
      <circle cx="15" cy="16.5" r="2.6" fill={on ? c : 'none'} stroke={c} strokeWidth="1.6" />
    </svg>
  );
}

export function ActivityGlyph({ on }: { on: boolean }) {
  // Amber, the hue of the ramp itself (activityRamp.ts), so the switch and what it paints agree.
  const c = '#c0731a';
  return (
    <svg width={S} height={S} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 12h4l2-5 4 10 2-5h6" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="9" fill={on ? c : 'none'} fillOpacity={on ? 0.18 : 0} stroke={c} strokeWidth="1.4" />
    </svg>
  );
}

/** A bone: a shaft with a knob at each end, drawn as one outline. */
export function BoneGlyph({ on }: { on: boolean }) {
  // A darker ivory than the bone's tint so the outline reads on the pale chip (a display choice).
  const c = '#8a7440';
  return (
    <svg width={S} height={S} viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M6.2 4.2a2.4 2.4 0 0 0-2.6 3.2 2.4 2.4 0 0 0 3.2 1.1l7.6 7.6a2.4 2.4 0 0 0 1.1 3.2 2.4 2.4 0 0 0 3.2-2.6 2.4 2.4 0 0 0 .6-3.2 2.4 2.4 0 0 0-3.2-1.1L9.4 5.2A2.4 2.4 0 0 0 6.2 4.2Z"
        fill={on ? c : 'none'}
        fillOpacity={on ? 0.22 : 0}
        stroke={c}
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** A muscle: a spindle belly with a tendon at each end, drawn as one outline. */
export function MuscleGlyph({ on }: { on: boolean }) {
  // A deep red so the outline reads on the pale chip and is not mistaken for the blood drop's
  // brighter red (a display choice).
  const c = '#9a3b34';
  return (
    <svg width={S} height={S} viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M3.2 12h3.1c1.5-3.6 4-5 7-5 2.2 0 3.7 1.1 3.7 5s-1.5 5-3.7 5c-3 0-5.5-1.4-7-5M17 12h3.8"
        fill={on ? c : 'none'}
        fillOpacity={on ? 0.22 : 0}
        stroke={c}
        strokeWidth="1.6"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** A standing figure's outline: the see-through skin the Glass body row switches. */
export function GlassGlyph({ on }: { on: boolean }) {
  // A cool grey-blue, the glass's own cast, dark enough to read on the pale chip (a display choice).
  const c = '#5b7a8c';
  return (
    <svg width={S} height={S} viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 2.6a2.6 2.6 0 1 1 0 5.2 2.6 2.6 0 0 1 0-5.2ZM7 11c0-1.5 1.1-2.4 2.6-2.4h4.8c1.5 0 2.6.9 2.6 2.4v4.2h-1.9V21.4h-3.2v-4.6h-1.8v4.6H8.9v-6.2H7Z"
        fill={on ? c : 'none'}
        fillOpacity={on ? 0.22 : 0}
        stroke={c}
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Stacked sheets: what the Layers chip shows. */
export function LayersGlyph() {
  return (
    <svg width={S} height={S} viewBox="0 0 24 24" aria-hidden="true">
      <g fill="none" stroke="#141414" strokeWidth="1.7" strokeLinejoin="round" strokeLinecap="round">
        <path d="M12 3.5 20.5 8 12 12.5 3.5 8Z" />
        <path d="M3.5 12 12 16.5 20.5 12" />
        <path d="M3.5 16 12 20.5 20.5 16" />
      </g>
    </svg>
  );
}
