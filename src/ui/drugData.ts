import { useSyncExternalStore } from 'react';
import type { Drug, DrugsFile } from '../data/pharma-types';
import drugsUrl from '../data/drugs.json?url';
import { useStore } from './store';

/**
 * THE DRUG DATABASE, LOADED WHEN IT IS FIRST NEEDED.
 *
 * src/data/drugs.json is about 1.2 MB. Three interface modules used to import it
 * statically, which put all of it inside the entry script, so every visitor downloaded
 * and parsed it before the body appeared although most never open the drug sheet. The
 * simulation worker still imports it itself (it is a separate chunk and needs it to
 * refuse undeclared doses); only the interface side is lazy.
 *
 * WHY FETCH AND NOT import(). Vite emits the JSON as its own hashed asset and hands us its
 * URL. A dynamic import() of a module that failed to download is CACHED as a failure by
 * Chromium, so a second import() rejected at once without sending a request and the
 * Retry button did nothing until the visitor reloaded. A failed fetch is not cached, so
 * Retry really asks again; and JSON.parse of the file is cheaper than parsing the same
 * data as a JavaScript module.
 *
 * CONTRACT. `loadDrugData()` fetches the file once, and every
 * caller shares the one promise. A failed import is NOT cached: the next call tries
 * again, which is what the sheet's Retry button relies on. `drugDataIfLoaded()` is the
 * synchronous read for code that cannot wait (it returns null until the import has
 * resolved). `useDrugData()` re-renders a component when the data arrives.
 *
 * PREFETCH. The first snapshot from the engine is the moment the body is on screen.
 * A few seconds after it, when the browser is idle, the data is fetched in the
 * background so that a visitor who opens the sheet later usually finds it already
 * there. The delay and the idle timeout are display-side scheduling choices, not
 * physiology. Boot never waits for any of it.
 *
 * THE INVARIANT THAT LETS causeOf STAY SYNCHRONOUS (see explanations.ts): a drug can
 * only be in the blood after the sheet or a scenario has given it, and both of those
 * wait for this data before they dispatch. So whenever a drug could be the cause of a
 * condition, the map is already here.
 */

export interface DrugData {
  drugs: Drug[];
  byId: Map<string, Drug>;
}

let loaded: DrugData | null = null;
let pending: Promise<DrugData> | null = null;
let lastError: Error | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const l of listeners) l();
}

export function loadDrugData(): Promise<DrugData> {
  if (loaded) return Promise.resolve(loaded);
  if (pending) return pending;
  pending = fetch(drugsUrl)
    .then((res) => {
      if (!res.ok) throw new Error(`drug list: HTTP ${res.status}`);
      return res.json() as Promise<DrugsFile>;
    })
    .then(
      (file) => {
        loaded = { drugs: file.drugs, byId: new Map(file.drugs.map((d) => [d.id, d])) };
        lastError = null;
        pending = null;
        notify();
        return loaded;
      },
      (err: unknown) => {
        // Not cached: a dropped connection must not poison the session.
        pending = null;
        lastError = err instanceof Error ? err : new Error(String(err));
        notify();
        throw lastError;
      },
    );
  return pending;
}

export function drugDataIfLoaded(): DrugData | null {
  return loaded;
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/**
 * The data, or null while it loads, plus the last failure (if any) and a retry. Calling
 * the hook starts the load unless `enabled` is false (the drug sheet is always mounted but
 * must not load anything while it is closed), so a component never has to ask twice.
 */
export function useDrugData(enabled = true): { data: DrugData | null; error: Error | null; retry: () => void } {
  const data = useSyncExternalStore(subscribe, drugDataIfLoaded, drugDataIfLoaded);
  const error = useSyncExternalStore(subscribe, () => lastError, () => lastError);
  if (enabled && !data && !pending && !error) loadDrugData().catch(() => undefined);
  return {
    data,
    error: data ? null : error,
    retry: () => {
      lastError = null;
      notify();
      loadDrugData().catch(() => undefined);
    },
  };
}

/** Display-side scheduling: wait this long after the first snapshot, then wait for idle. */
const PREFETCH_DELAY_MS = 3000;
const PREFETCH_IDLE_TIMEOUT_MS = 10000;

function startPrefetch(): void {
  const go = () => {
    loadDrugData().catch(() => undefined);
  };
  setTimeout(() => {
    const ric = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number })
      .requestIdleCallback;
    if (ric) ric(go, { timeout: PREFETCH_IDLE_TIMEOUT_MS });
    else setTimeout(go, 0);
  }, PREFETCH_DELAY_MS);
}

// Armed once, by the first snapshot the engine delivers.
if (typeof window !== 'undefined') {
  const unsub = useStore.subscribe((s) => {
    if (s.snapshot) {
      unsub();
      startPrefetch();
    }
  });
}
