/**
 * NO EFFECT-BUS TARGET MAY BE SILENTLY DEAD.
 *
 * The bus is a flat accumulator keyed by strings. Writing a target nobody reads is not an
 * error anywhere: `addEffect` happily sums into a key, `effect()` is never called for it,
 * and the writer is inert on that axis while every other test stays green. About a dozen of
 * these accumulated (atorvastatin through `metabolic.lipidSynthesis` and allopurinol through
 * `metabolic.urateProduction` did nothing at all; thyroxine, glucagon's ketogenesis, EPO,
 * the beta-1 renin release and the cough of three pathogens were each inert on one axis),
 * and nothing noticed, because a drug that does nothing on an axis the model does not have
 * looks exactly like a drug that works.
 *
 * WHY A STATIC CHECK AND NOT A RUN. A behavioural sweep can only find a dead target for a
 * drug somebody thought to dose, in a body somebody thought to build, long enough for the
 * axis to move. A dead target is a property of the SOURCE: some text names it as an output
 * and no text names it as an input. So this reads the source and the data files as text,
 * which also makes it fast, deterministic and independent of the engine (no Engine is
 * constructed, so it is safe on the memory-constrained machine).
 *
 * The three rules:
 *   1. every target written by data or code is read by some system, or is on the honest
 *      not-modelled list (`src/data/notModelled.json`, which the interface shows on each
 *      drug's page, so a user is told rather than left to conclude the drug is broken);
 *   2. nothing on that list is read - so the list cannot go stale when somebody wires a
 *      target up and forgets to delete its apology;
 *   3. every target in the registry is written, read or listed, so a target cannot be
 *      declared ahead of any user at all.
 *
 * What counts as a READ: `effect(s, 'x')`, `prevEffect(s, 'x')` and the engine's
 * `effectValue(s, 'x')` and the anatomy deriver's `eff(s, 'x')`, which feed the snapshot's
 * display-only fields (the mind block, appetite, the cough drive). A display read is a read: the number is shown to a person, and
 * that is a stated, honest consumer. What does NOT count is `activeEffects`, which copies
 * every non-zero target into the Impact panel and would make every target look read.
 *
 * What counts as a WRITE: any quoted registry name in a `src/sim` source file outside the
 * registry itself and outside a read call (this catches `addEffect(s.effects, 'x', ...)`,
 * `addEffectFrom`, and the multi-line and table forms such as the seizure gains), plus any
 * quoted registry name in the data files that write targets (`drugs`, `receptors`,
 * `hormones`, `pathogens`, ...). Over-counting a mention as a write can only make the
 * check stricter, which is the safe direction for a guard.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { EFFECT_TARGETS } from '../../src/sim/core/effects';
import notModelledFile from '../../src/data/notModelled.json';

const ROOT = resolve(__dirname, '../..');
const REGISTRY = new Set<string>(EFFECT_TARGETS);
const NOT_MODELLED = new Set(Object.keys((notModelledFile as { targets: Record<string, unknown> }).targets));

function walk(dir: string, ext: RegExp, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, ext, out);
    else if (ext.test(name)) out.push(p);
  }
  return out;
}

/** Remove block and line comments so a target named in prose does not count as a use. */
function stripComments(src: string): string {
  // Line comments go FIRST. Done the other way round, a line comment that mentions a glob
  // such as src/data/** opens a "block comment" that swallows real code up to the next
  // star-slash, which hid renal.ts's reads of four targets and made them look dead.
  return src.replace(/(^|[^:'"`])\/\/.*$/gm, '$1').replace(/\/\*[\s\S]*?\*\//g, ' ');
}

const READ_CALL = /\b(?:effect|prevEffect|effectValue|eff)\(\s*[\w.]+\s*,\s*'([^']+)'/g;
const QUOTED = /'([a-z]+\.[A-Za-z0-9_]+)'/g;

function collect(): { written: Set<string>; read: Set<string> } {
  const written = new Set<string>();
  const read = new Set<string>();

  for (const file of walk(join(ROOT, 'src/sim'), /\.ts$/)) {
    if (file.endsWith(join('core', 'effects.ts'))) continue; // the registry names everything
    const src = stripComments(readFileSync(file, 'utf8'));
    for (const m of src.matchAll(READ_CALL)) read.add(m[1]);
    // Blank out the read calls, then every quoted registry name left is a write.
    const rest = src.replace(READ_CALL, ' ');
    for (const m of rest.matchAll(QUOTED)) if (REGISTRY.has(m[1])) written.add(m[1]);
  }

  // Data files: any quoted registry name. Anatomy atlases are skipped (their `drives` are
  // snapshot signals, not bus targets) and so are the constants file and the generated
  // manifests that merely echo targets already in drugs/receptors.
  for (const file of walk(join(ROOT, 'src/data'), /\.json$/)) {
    if (file.includes(join('src', 'data', 'anatomy'))) continue;
    if (/physiology\.json$/.test(file)) continue;
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/"([a-z]+\.[A-Za-z0-9_]+)"/g)) if (REGISTRY.has(m[1])) written.add(m[1]);
  }
  return { written, read };
}

describe('effect-bus targets: none may be silently dead', () => {
  const { written, read } = collect();

  it('every written target is read by a system or is on the not-modelled list', () => {
    const dead = [...written].filter((t) => !read.has(t) && !NOT_MODELLED.has(t)).sort();
    expect(dead, `written but read by nothing and not listed in notModelled.json: ${dead.join(', ')}`).toEqual([]);
  });

  it('nothing on the not-modelled list is read, so the list cannot go stale', () => {
    const stale = [...NOT_MODELLED].filter((t) => read.has(t)).sort();
    expect(stale, `listed as not modelled but now read (delete the entry): ${stale.join(', ')}`).toEqual([]);
  });

  it('every not-modelled entry is a registry target with a label and a reason', () => {
    const file = (notModelledFile as { targets: Record<string, { label?: string; reason?: string }> }).targets;
    for (const [t, v] of Object.entries(file)) {
      expect(REGISTRY.has(t), `${t} is not in EFFECT_TARGETS`).toBe(true);
      expect(typeof v.label === 'string' && v.label.length > 0, `${t} needs a label`).toBe(true);
      expect(typeof v.reason === 'string' && v.reason.length > 20, `${t} needs a reason`).toBe(true);
    }
  });

  it('every registry target is written, read or listed', () => {
    const orphan = EFFECT_TARGETS.filter((t) => !written.has(t) && !read.has(t) && !NOT_MODELLED.has(t));
    expect(orphan, `declared in the registry and used by nothing: ${orphan.join(', ')}`).toEqual([]);
  });

  it('every target read by a system is a registry target (no typo reads zero forever)', () => {
    const unknown = [...read].filter((t) => !REGISTRY.has(t)).sort();
    expect(unknown).toEqual([]);
  });
});
