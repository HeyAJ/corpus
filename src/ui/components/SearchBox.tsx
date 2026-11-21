import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store';
import { buildCatalogue, search, type SearchEntry } from '../search';
import type { OrganId } from '../../data/types';
import styles from './searchbox.module.css';

/**
 * "FIND AN ORGAN OR STRUCTURE": the field at the top of the panels menu.
 *
 * The 3D body is the only other way to an organ and it needs the visitor to know where the
 * organ is; 301 named structures are reachable at all only by opening their organ first.
 * Typing a few letters is the way in for someone who knows the word and not the place.
 *
 * The component is controlled (the menu owns the text) because the menu must replace its own
 * list with the results while there is text, and must close on a choice. Keys: arrows move
 * the highlight, Enter opens the highlighted result, and Escape clears the text; a second
 * Escape, with the text already empty, closes the panels menu from here. The ranking and what the body
 * has are in src/ui/search.ts; this file is only the interface to them.
 *
 * CHOOSING A PART selects its organ, then the part, then asks for the camera to fly to it
 * (`requestFocusPart`): the interior takes a moment to build and the viewer cannot focus a
 * part that does not exist yet, so App.tsx performs the flight once it is ready.
 */

/** Apply a search result to the store: the organ, then the part, then the flight to it. */
export function openEntry(entry: SearchEntry): void {
  const s = useStore.getState();
  s.setSelected(entry.organId as OrganId);
  if (entry.kind === 'part' && entry.partId) {
    s.setSelectedPart(entry.partId);
    s.requestFocusPart(entry.partId);
  }
}

export function SearchBox({
  query,
  onQuery,
  onChosen,
}: {
  query: string;
  onQuery: (q: string) => void;
  /** Called after a result has been opened, so the menu can close. */
  onChosen: () => void;
}) {
  const sex = useStore((s) => s.snapshot?.reproductive?.sex ?? 'male');
  const pregnant = useStore((s) => s.snapshot?.reproductive?.pregnancy?.pregnant ?? false);
  const catalogue = useMemo(() => buildCatalogue({ sex, pregnant }), [sex, pregnant]);
  const results = useMemo(() => search(catalogue, query), [catalogue, query]);
  const [active, setActive] = useState(0);

  // A new query starts at the best match again.
  useEffect(() => setActive(0), [query]);

  const choose = (e: SearchEntry) => {
    openEntry(e);
    onQuery('');
    onChosen();
  };

  const onKeyDown = (ev: React.KeyboardEvent<HTMLInputElement>) => {
    if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      if (results.length > 0) setActive((a) => (a + 1) % results.length);
    } else if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      if (results.length > 0) setActive((a) => (a - 1 + results.length) % results.length);
    } else if (ev.key === 'Enter') {
      ev.preventDefault();
      const hit = results[active];
      if (hit) choose(hit);
    } else if (ev.key === 'Escape') {
      // The first Escape clears the text; with the text already empty, a further Escape closes
      // the panels menu, which otherwise had no keyboard way out while the field had focus.
      ev.preventDefault();
      ev.stopPropagation();
      if (query !== '') onQuery('');
      else useStore.getState().setMenuOpen(false);
    }
  };

  const listId = 'corpus-search-results';
  return (
    <div className={styles.wrap}>
      <input
        className={styles.field}
        type="search"
        value={query}
        placeholder="Find an organ or structure"
        aria-label="Find an organ or structure"
        role="combobox"
        aria-expanded={query.trim() !== ''}
        aria-controls={listId}
        aria-activedescendant={results[active] ? `${listId}-${active}` : undefined}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="go"
        onChange={(e) => onQuery(e.target.value)}
        onKeyDown={onKeyDown}
        data-search-input
      />
      {query.trim() !== '' && (
        <ul className={styles.results} id={listId} role="listbox" aria-label="Search results" data-search-results>
          {results.length === 0 && <li className={styles.none}>Nothing in this body matches {'“'}{query.trim()}{'”'}.</li>}
          {results.map((r, i) => (
            <li key={`${r.organId}.${r.partId ?? ''}`} role="presentation">
              <button
                type="button"
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                className={`${styles.result} ${i === active ? styles.resultActive : ''}`}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(r)}
                data-result-kind={r.kind}
                data-result-organ={r.organId}
                data-result-part={r.partId}
              >
                <strong>{r.label}</strong>
                <small>{r.kind === 'part' ? `Structure in the ${r.sub.toLowerCase()}` : 'Organ'}</small>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
