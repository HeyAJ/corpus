import { describe, expect, it } from 'vitest';
import { ANATOMY, atlasOf } from '../../src/data/anatomy';
import { ANATOMY_SIGNALS } from '../../src/data/anatomy-types';
import organsFile from '../../src/data/organs.json';

/**
 * THE ANATOMY ATLAS, AS DATA.
 *
 * Pure data checks, no engine. Many atlas files are written by different people at
 * different times and some are still `parts: []`, so every rule here is a rule about
 * what a file contains and none of them requires a file to contain anything: an empty
 * atlas must pass, and a half-written one must fail only for what it actually says.
 *
 * The sanity bound on weights is not physiology. A part's activity is
 * `clamp01(rest + sum(weight * signal))` with every signal in 0..1, so the largest
 * reachable value is rest plus the positive weights and the smallest is rest minus the
 * negative ones. A file whose weights could swing the index by more than the whole
 * 0..1 range twice over is almost certainly a typo (a weight of 10 for 1.0).
 */

const SIGNALS = new Set<string>(ANATOMY_SIGNALS);
const COLOUR = /^#[0-9a-fA-F]{6}$/;
const PART_ID = /^[a-z][a-z0-9_]*$/;

describe('anatomy atlas files', () => {
  for (const [key, file] of Object.entries(ANATOMY)) {
    describe(key, () => {
      it('names itself after its key', () => {
        expect(file.atlas).toBe(key);
      });

      it('has sources that each carry a label and a url', () => {
        for (const [id, src] of Object.entries(file.sources ?? {})) {
          expect(src.label, `source ${id} label`).toBeTruthy();
          expect(src.url, `source ${id} url`).toBeTruthy();
        }
      });

      it('has unique, well-formed part ids', () => {
        const seen = new Set<string>();
        for (const p of file.parts) {
          expect(p.id, `part id ${p.id}`).toMatch(PART_ID);
          expect(seen.has(p.id), `duplicate part id ${p.id}`).toBe(false);
          seen.add(p.id);
        }
      });

      it('cites only sources it declares, and drives only signals that exist', () => {
        const sources = file.sources ?? {};
        for (const p of file.parts) {
          expect(sources[p.source], `${p.id}: source "${p.source}"`).toBeDefined();
          for (const d of p.drives) {
            expect(SIGNALS.has(d.signal), `${p.id}: unknown signal "${d.signal}"`).toBe(true);
            expect(sources[d.source], `${p.id}/${d.signal}: source "${d.source}"`).toBeDefined();
          }
        }
      });

      it('has valid colours and a resting activity in 0..1', () => {
        for (const p of file.parts) {
          expect(p.color, `${p.id} colour`).toMatch(COLOUR);
          expect(p.rest, `${p.id} rest`).toBeGreaterThanOrEqual(0);
          expect(p.rest, `${p.id} rest`).toBeLessThanOrEqual(1);
        }
      });

      it('keeps the weights inside the sanity bound', () => {
        for (const p of file.parts) {
          let up = 0;
          let down = 0;
          for (const d of p.drives) {
            expect(Number.isFinite(d.weight), `${p.id}/${d.signal} weight`).toBe(true);
            up += Math.max(0, d.weight);
            down += Math.max(0, -d.weight);
          }
          expect(p.rest + up, `${p.id} upper reach`).toBeLessThanOrEqual(2);
          expect(p.rest - down, `${p.id} lower reach`).toBeGreaterThanOrEqual(-1);
        }
      });
    });
  }
});

describe('organs.json against the atlas', () => {
  it('resolves every organ to an existing atlas', () => {
    for (const o of organsFile.organs as unknown as Array<{ id: string; atlas?: string }>) {
      const name = atlasOf(o);
      expect(ANATOMY[name], `organ ${o.id} -> atlas ${name}`).toBeDefined();
    }
  });
});
