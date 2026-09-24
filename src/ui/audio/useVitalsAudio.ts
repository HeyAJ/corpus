import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { VitalsAudio } from './VitalsAudio';

/**
 * Wiring for the body's sounds.
 *
 * THE FEED IS NOT REACTIVE, deliberately. `useStore.subscribe` hands every snapshot
 * straight to the audio engine without going through React, because the alternative is
 * re-rendering a component twenty times a second to do something that touches no DOM at
 * all. The store's own comment makes the same point about sparklines; this is the same
 * argument for sound.
 *
 * The one piece of React state here is whether sound is ON, which really is a piece of
 * interface state and does belong in a render.
 *
 * Starting HAS to come from a user gesture or the browser refuses the AudioContext, so
 * `toggle` is designed to be handed straight to a button's onClick and nothing starts
 * audio on its own.
 */
export function useVitalsAudio(): { on: boolean; toggle: () => void; available: boolean } {
  const engine = useRef<VitalsAudio | null>(null);
  const [on, setOn] = useState(false);
  const [available] = useState(
    () => typeof window !== 'undefined' && 'AudioContext' in window,
  );

  useEffect(() => {
    const audio = new VitalsAudio();
    engine.current = audio;

    const unsubscribe = useStore.subscribe((state) => {
      if (state.snapshot) audio.update(state.snapshot);
    });

    return () => {
      unsubscribe();
      audio.dispose();
      engine.current = null;
    };
  }, []);

  // A tab in the background should not be beeping at someone. Suspend on hide and
  // resume on show, but only if it was on in the first place.
  useEffect(() => {
    if (!on) return;
    const onVisibility = () => {
      const audio = engine.current;
      if (!audio) return;
      if (document.hidden) void audio.stop();
      else void audio.start();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [on]);

  const toggle = useCallback(() => {
    const audio = engine.current;
    if (!audio) return;
    setOn((wasOn) => {
      if (wasOn) void audio.stop();
      else void audio.start();
      return !wasOn;
    });
  }, []);

  return { on, toggle, available };
}
