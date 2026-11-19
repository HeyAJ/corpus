import { expect, type Page } from '@playwright/test';

/**
 * Shared helpers for the browser tests. A production build has NO `window.__corpus` hook, so
 * everything here works the way a visitor does: by looking at the page and tapping it.
 */

/** The welcome dialog's remembered-acceptance key (src/ui/store.ts FIRST_RUN_KEY). */
export const FIRST_RUN_KEY = 'corpus.firstRunAccepted.v1';

export interface Problems {
  list: string[];
}

/**
 * Collects everything that should never happen on a healthy boot: console errors, uncaught
 * page errors, requests that failed outright and HTTP responses of 400 or more. Every spec
 * asserts the list is empty at its end, so a broken asset or a thrown error cannot hide.
 */
export function collectProblems(page: Page, allow: RegExp[] = []): Problems {
  const problems: Problems = { list: [] };
  const push = (s: string) => {
    if (!allow.some((re) => re.test(s))) problems.list.push(s);
  };
  page.on('console', (m) => {
    if (m.type() === 'error') push('console: ' + m.text().slice(0, 240));
  });
  page.on('pageerror', (e) => push('pageerror: ' + String(e).slice(0, 240)));
  page.on('requestfailed', (r) => push('requestfailed: ' + r.url() + ' ' + (r.failure()?.errorText ?? '')));
  page.on('response', (r) => {
    if (r.status() >= 400) push('http ' + r.status() + ': ' + r.url());
  });
  return problems;
}

/**
 * Go to the app and wait until it is drawn and running: the canvas exists and the
 * "Starting body engine" line has gone. With `accept` the welcome dialog is accepted so the
 * stage is reachable; without it the dialog is left up (the welcome spec needs to see it).
 */
export async function boot(page: Page, opts: { accept?: boolean } = {}): Promise<void> {
  const accept = opts.accept ?? true;
  await page.goto('/', { waitUntil: 'load' });
  await expect(page.locator('canvas').first()).toBeAttached({ timeout: 60_000 });
  await expect(page.getByText('Starting body engine')).toHaveCount(0, { timeout: 90_000 });
  if (accept) await acceptWelcome(page);
}

/** Press "I understand" if the dialog is up, and wait for it to go. */
export async function acceptWelcome(page: Page): Promise<void> {
  const btn = page.getByRole('button', { name: 'I understand' });
  if (await btn.isVisible().catch(() => false)) {
    await btn.click();
    await expect(btn).toHaveCount(0);
  }
}

/** Tap or click at a fraction of the viewport; a phone uses a real touch, as a visitor would. */
export async function tapAt(page: Page, fx: number, fy: number, touch: boolean): Promise<void> {
  const vp = page.viewportSize();
  if (!vp) throw new Error('no viewport');
  const x = vp.width * fx;
  const y = vp.height * fy;
  if (touch) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
}

/**
 * Wait until every FINITE CSS animation or transition has finished, then two animation frames.
 * Under software WebGL on a loaded runner the browser produces frames so rarely that a 300 ms
 * sheet fade can still be at opacity 0 more than a second after it starts, which makes text
 * look covered or unreadable when nothing is wrong. Infinite animations (pulses, spinners)
 * are skipped because they never finish; the wait gives up after `maxMs`.
 */
export async function settle(page: Page, maxMs = 8000): Promise<void> {
  await page
    .evaluate(async (limit) => {
      const finite = () =>
        document.getAnimations().filter((a) => {
          const it = a.effect && a.effect.getComputedTiming ? a.effect.getComputedTiming().iterations : 1;
          return it !== Infinity && a.playState !== 'finished' && a.playState !== 'idle';
        });
      const deadline = performance.now() + limit;
      while (performance.now() < deadline) {
        const running = finite();
        if (running.length === 0) break;
        await Promise.race([
          Promise.all(running.map((a) => a.finished.catch(() => undefined))),
          new Promise((r) => setTimeout(r, 250)),
        ]);
      }
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    }, maxMs)
    .catch(() => undefined);
}

export interface LayoutResult {
  covered: string[];
  textHit: string[];
  scrim?: number;
}

/**
 * Two automatic layout checks, ported in behaviour from the shared screenshot tool:
 *   covered - an interactive control whose visible part is painted over by something that is
 *             not itself: a control a visitor cannot tap.
 *   textHit - two pieces of text from different elements whose painted rectangles overlap:
 *             a label running through its value.
 * It runs inside the page, so it is written as one self-contained function.
 */
export async function layoutChecks(page: Page): Promise<LayoutResult> {
  await settle(page);
  return page.evaluate(() => {
    const out: { covered: string[]; textHit: string[]; scrim?: number } = { covered: [], textHit: [] };
    const vis = (el: Element): DOMRect | null => {
      // Content inside a collapsed <details> (or under content-visibility) keeps a layout box
      // but is never painted, so geometry alone reported it as covered or as text over text.
      // The browser knows what is actually painted; ask it first when the method exists.
      if (
        typeof el.checkVisibility === 'function' &&
        !el.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true })
      ) {
        return null;
      }
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return null;
      if (r.bottom <= 0 || r.top >= innerHeight || r.right <= 0 || r.left >= innerWidth) return null;
      for (let p: Element | null = el; p && p !== document.documentElement; p = p.parentElement) {
        const cs = getComputedStyle(p);
        if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity || '1') < 0.05) return null;
      }
      return r;
    };
    const name = (el: Element): string =>
      ((el.getAttribute('aria-label') || el.textContent || el.tagName).replace(/\s+/g, ' ').trim().slice(0, 40)) ||
      el.tagName.toLowerCase();
    const tag = (el: Element | null): string => {
      if (!el) return 'nothing';
      const cls = typeof el.className === 'string' ? el.className.split(/\s+/)[0].replace(/^_/, '').slice(0, 30) : '';
      return el.tagName.toLowerCase() + (cls ? '.' + cls : '') + ' "' + name(el).slice(0, 24) + '"';
    };

    // 1. Controls a visitor cannot reach.
    const controls = document.body.querySelectorAll(
      'button, a[href], input, select, summary, [role="button"], [role="switch"], [role="tab"]',
    );
    for (const el of Array.from(controls)) {
      const r = vis(el);
      if (!r) continue;
      if (getComputedStyle(el).pointerEvents === 'none') continue;
      // A control that itself spans the viewport is a modal's backdrop (tap outside to close);
      // the modal sitting on top of it is the design, not a defect.
      if (r.width * r.height >= 0.8 * innerWidth * innerHeight) continue;
      const pts: Array<[number, number]> = [
        [0.5, 0.5],
        [0.2, 0.3],
        [0.8, 0.3],
        [0.2, 0.7],
        [0.8, 0.7],
      ];
      let blocked = 0;
      let by: Element | null = null;
      let inside = 0;
      // The part of the control that its scrolling ancestors actually let through. A row that
      // is scrolled out of its list is CLIPPED, not covered, and must not be reported.
      let cl = r.left;
      let ct = r.top;
      let cr = r.right;
      let cb = r.bottom;
      for (let p = el.parentElement; p && p !== document.documentElement; p = p.parentElement) {
        const ps = getComputedStyle(p);
        if (ps.overflowX !== 'visible' || ps.overflowY !== 'visible') {
          const b = p.getBoundingClientRect();
          cl = Math.max(cl, b.left);
          ct = Math.max(ct, b.top);
          cr = Math.min(cr, b.right);
          cb = Math.min(cb, b.bottom);
        }
      }
      for (const [fx, fy] of pts) {
        const x = r.left + r.width * fx;
        const y = r.top + r.height * fy;
        if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue;
        if (x < cl || x > cr || y < ct || y > cb) continue; // scrolled out of its own container
        inside += 1;
        const hit = document.elementFromPoint(x, y);
        if (!hit) continue;
        if (hit === el || el.contains(hit) || hit.contains(el)) continue;
        // A modal scrim (a non-canvas layer over the whole viewport) blocks what is under it on
        // purpose; that is what a modal is. Count it separately instead of as a defect.
        const hr = hit.getBoundingClientRect();
        if (hit.tagName !== 'CANVAS' && hr.width * hr.height >= 0.8 * innerWidth * innerHeight) {
          out.scrim = (out.scrim || 0) + 1;
          continue;
        }
        // A label wrapping an input, or a sibling inside the same control, is not a cover.
        const ctl = hit.closest('button, a[href], label, [role="button"], [role="switch"], [role="tab"]');
        if (ctl && (ctl.contains(el) || el.contains(ctl))) continue;
        blocked += 1;
        by = by || hit;
      }
      if (blocked > 0) out.covered.push(name(el) + ' <- ' + blocked + '/' + inside + ' points under ' + tag(by));
    }

    // 2. Text painted over other text.
    type Box = { left: number; top: number; right: number; bottom: number };
    const clip = (el: Element, rect: Box): Box | null => {
      let { left, top, right, bottom } = rect;
      for (let p: Element | null = el; p && p !== document.documentElement; p = p.parentElement) {
        const cs = getComputedStyle(p);
        if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') {
          const b = p.getBoundingClientRect();
          left = Math.max(left, b.left);
          top = Math.max(top, b.top);
          right = Math.min(right, b.right);
          bottom = Math.min(bottom, b.bottom);
        }
      }
      return right - left > 1 && bottom - top > 1 ? { left, top, right, bottom } : null;
    };
    const pieces: Array<Box & { el: Element; text: string }> = [];
    for (const el of Array.from(document.body.querySelectorAll('*'))) {
      if (el.closest('svg')) continue;
      if (!vis(el)) continue;
      for (const n of Array.from(el.childNodes)) {
        if (n.nodeType !== 3) continue;
        const text = (n.textContent ?? '').replace(/\s+/g, ' ').trim();
        if (text.length < 2) continue;
        const range = document.createRange();
        range.selectNodeContents(n);
        for (const rr of Array.from(range.getClientRects())) {
          const c = clip(el, rr);
          if (!c) continue;
          if (c.bottom <= 0 || c.top >= innerHeight || c.right <= 0 || c.left >= innerWidth) continue;
          pieces.push({ el, text: text.slice(0, 30), ...c });
        }
      }
    }
    const seen = new Set<string>();
    for (let i = 0; i < pieces.length; i++) {
      for (let j = i + 1; j < pieces.length; j++) {
        const a = pieces[i];
        const b = pieces[j];
        if (a.el === b.el || a.el.contains(b.el) || b.el.contains(a.el)) continue;
        const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (w > 3 && h > 3) {
          const key = a.text + '|' + b.text;
          if (seen.has(key)) continue;
          seen.add(key);
          out.textHit.push('"' + a.text + '" x "' + b.text + '" (' + Math.round(w) + 'x' + Math.round(h) + ' px)');
        }
      }
    }
    return out;
  });
}
