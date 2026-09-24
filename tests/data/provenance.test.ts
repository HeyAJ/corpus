import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import physiology from '../../src/data/physiology.json';
import drugsFile from '../../src/data/drugs.json';
import receptorsFile from '../../src/data/receptors.json';
import organsFile from '../../src/data/organs.json';
import foodsFile from '../../src/data/foods.json';
import type { DrugsFile, ReceptorsFile } from '../../src/data/pharma-types';
import type { OrgansFile } from '../../src/data/types';
import { allConstantKeys, sourced, sourceTable } from '../../src/sim/core/constants';

/**
 * DATA INTEGRITY (spec 0.4, 5.5, 5.6, 13).
 *
 * "Never invent a physiological or pharmacological number. Every constant goes in a
 *  data/ file with a source field."
 * "sources: REQUIRED. DOI or database accession. No source, no entry."
 *
 * This test is what turns those instructions into a build failure instead of an
 * intention. It is deliberately strict: it is easier to add a citation than to
 * discover later that one number in two hundred was made up.
 */

const ROOT = join(import.meta.dirname ?? process.cwd(), '..', '..');
const DRUGS = (drugsFile as unknown as DrugsFile).drugs;
const RECEPTORS = (receptorsFile as unknown as ReceptorsFile).receptors;
const ORGANS = organsFile as unknown as OrgansFile;

describe('physiology constants', () => {
  it('every constant carries a source that resolves to a real reference', () => {
    const sources = sourceTable();
    const bad: string[] = [];
    for (const key of allConstantKeys()) {
      const entry = sourced(key);
      if (!entry) {
        bad.push(`${key}: no entry`);
        continue;
      }
      if (!entry.source) bad.push(`${key}: no source field`);
      else if (!sources[entry.source]) bad.push(`${key}: source "${entry.source}" is not in the source table`);
      if (!entry.confidence) bad.push(`${key}: no confidence field`);
      if (!entry.unit) bad.push(`${key}: no unit`);
    }
    expect(bad.join('\n')).toBe('');
  });

  it('every reference in the source table has a label and a URL', () => {
    for (const [key, ref] of Object.entries(sourceTable())) {
      expect(ref.label, key).toBeTruthy();
      expect(ref.url, key).toBeTruthy();
    }
  });

  it('every "assumed" constant says it is an engineering default, not physiology', () => {
    // The distinction that matters: an engineering default is a choice about
    // numerics or pacing. Labelling a physiological claim as "assumed" would be
    // exactly the thing the spec forbids, so assumed values must point at the
    // ENGINEERING reference or explain themselves in a note.
    for (const key of allConstantKeys()) {
      const e = sourced(key);
      if (e?.confidence !== 'assumed') continue;
      const ok = e.source === 'ENGINEERING' || (e.note ?? '').length > 20;
      expect(ok, `${key} is "assumed" but does not explain itself`).toBe(true);
    }
  });

  it('every "derived" constant explains how it was derived', () => {
    for (const key of allConstantKeys()) {
      const e = sourced(key);
      if (e?.confidence !== 'derived') continue;
      expect((e.note ?? '').length, `${key} is "derived" with no explanation`).toBeGreaterThan(10);
    }
  });

  it('no constant is silently null without appearing in MISSING_CONSTANTS.md', () => {
    const report = existsSync(join(ROOT, 'docs', 'MISSING_CONSTANTS.md'))
      ? readFileSync(join(ROOT, 'docs', 'MISSING_CONSTANTS.md'), 'utf8')
      : '';
    for (const key of allConstantKeys()) {
      const e = sourced(key);
      if (e && e.value === null) {
        expect(report, `${key} is null but is not reported`).toContain(key);
      }
    }
  });
});

describe('drugs.json', () => {
  it('is generated, not hand-typed', () => {
    const file = drugsFile as unknown as DrugsFile;
    expect(file.generatedBy).toContain('tools/ingest');
    expect(file.attribution.length).toBeGreaterThan(0);
  });

  it('carries the attribution its licences require', () => {
    const attribution = (drugsFile as unknown as DrugsFile).attribution.join(' ');
    // GtoPdb contents are CC BY-SA 4.0; Pulse is Apache-2.0; openFDA requires its
    // disclaimer be carried.
    expect(attribution).toMatch(/guidetopharmacology/i);
    expect(attribution).toMatch(/CC BY-SA/i);
    expect(attribution).toMatch(/Pulse Physiology Engine/i);
    expect(attribution).toMatch(/Apache/i);
    expect(attribution).toMatch(/openFDA/i);
  });

  it('every drug has at least one source', () => {
    for (const d of DRUGS) {
      expect(d.sources.length, d.id).toBeGreaterThan(0);
    }
  });

  it('EVERY receptor affinity cites where it came from', () => {
    for (const d of DRUGS) {
      for (const t of d.targets) {
        expect(t.source, `${d.id}/${t.receptorId}`).toBeTruthy();
        expect(t.sourceUrl, `${d.id}/${t.receptorId}`).toMatch(/^https?:\/\//);
        // An affinity with no value must not exist at all: no source, no entry.
        expect(t.Ki_nM, `${d.id}/${t.receptorId}`).not.toBeNull();
        expect(t.Ki_nM!, `${d.id}/${t.receptorId}`).toBeGreaterThan(0);
      }
    }
  });

  it('every non-null pharmacokinetic field has provenance', () => {
    for (const d of DRUGS) {
      for (const [field, value] of Object.entries(d.pk)) {
        if (field === 'provenance' || value === null) continue;
        expect(
          d.pk.provenance[field],
          `${d.id}.pk.${field} = ${value} has no provenance entry`,
        ).toBeTruthy();
      }
    }
  });

  it('every provenance entry names a source and a URL', () => {
    for (const d of DRUGS) {
      for (const [field, p] of Object.entries(d.pk.provenance)) {
        expect(p.source, `${d.id}.${field}`).toBeTruthy();
        expect(p.confidence, `${d.id}.${field}`).toMatch(/measured|derived|assumed/);
      }
    }
  });

  it('every preset dose is positive and carries a unit', () => {
    for (const d of DRUGS) {
      expect(d.presetDoses.length, d.id).toBeGreaterThan(0);
      for (const p of d.presetDoses) {
        expect(p.amount, `${d.id} ${p.label}`).toBeGreaterThan(0);
        expect(p.unit, `${d.id} ${p.label}`).toBeTruthy();
        expect(d.routes, `${d.id} ${p.label}`).toContain(p.route);
      }
    }
  });

  it('every declared route has at least one preset, so no button is dead', () => {
    for (const d of DRUGS) {
      for (const route of d.routes) {
        const has = d.presetDoses.some((p) => p.route === route);
        expect(has, `${d.id} declares ${route} but offers no preset for it`).toBe(true);
      }
    }
  });

  it('an absorbed route has an absorption constant, or the drug cannot use it', () => {
    // An IM or oral route with no ka means the depot never empties and the dose
    // silently disappears. Found by tests/pharma/pharmacology.test.ts when naloxone
    // IM produced no plasma concentration at all.
    for (const d of DRUGS) {
      if (!d.routes.includes('IM')) continue;
      expect(d.pk.ka_min, `${d.id} offers IM with no absorption rate constant`).not.toBeNull();
    }
  });

  it('every direct effect names a real effect target and cites a source', () => {
    for (const d of DRUGS) {
      for (const e of d.directEffects) {
        expect(e.target, d.id).toMatch(/^[a-z]+\.[A-Za-z]+/);
        expect(e.source, d.id).toBeTruthy();
        expect(e.note.length, `${d.id} ${e.target}`).toBeGreaterThan(20);
      }
    }
  });

  it('every Pulse pharmacodynamic block has an EC50 and at least one modifier', () => {
    for (const d of DRUGS) {
      if (!d.pulsePd) continue;
      expect(d.pulsePd.ec50_mg_per_L, d.id).toBeGreaterThan(0);
      expect(d.pulsePd.emaxShape, d.id).toBeGreaterThan(0);
      expect(Object.keys(d.pulsePd.modifiers).length, d.id).toBeGreaterThan(0);
      expect(d.pulsePd.sourceUrl, d.id).toMatch(/^https?:\/\//);
    }
  });

  it('drug ids are unique', () => {
    const ids = DRUGS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('receptors.json', () => {
  it('covers the minimum registry the spec names', () => {
    // spec 5.4's minimum set, by our ids.
    const required = [
      'alpha1', 'alpha2', 'beta1', 'beta2', 'beta3', 'd1', 'd2', 'm2', 'm3',
      'h1', 'h2', 'ht1a', 'ht2a', 'ht2c', 'ht3', 'gabaa', 'mu', 'kappa',
      'nachr', 'nmda', 'cb1', 'dat', 'net', 'sert', 'taar1', 'v1a', 'at1', 'insulin_r',
    ];
    const present = new Set(RECEPTORS.map((r) => r.id));
    const missing = required.filter((r) => !present.has(r));
    expect(missing.join(', ')).toBe('');
  });

  /**
   * A receptor is allowed to carry no effect vector, but only by saying so in its own
   * notes and saying where its consequence is computed instead. NKCC2 is the case:
   * blocking it produces a diuresis, and that diuresis is already computed by the
   * tubular permeability model from a published EC50, so a second path to
   * renal.waterReabsorption would double-count the same block.
   *
   * The exemption is deliberately narrow. Without the notes requirement this becomes
   * a way to add a receptor that does nothing and never notice.
   */
  const EMPTY_EFFECTS_MUST_EXPLAIN = /DELIBERATELY EMPTY/;

  it('a receptor with no effects declares that in its notes and says why', () => {
    for (const r of RECEPTORS) {
      if (r.effects.length > 0) continue;
      expect(r.notes, `${r.id} has no effects and must explain that`).toMatch(EMPTY_EFFECTS_MUST_EXPLAIN);
      expect(r.notes.length, r.id).toBeGreaterThan(120);
    }
  });

  it('every receptor effect cites a source and explains itself', () => {
    for (const r of RECEPTORS) {
      if (r.effects.length === 0) continue; // covered by the test above
      for (const e of r.effects) {
        expect(e.source, `${r.id} ${e.target}`).toBeTruthy();
        expect(e.sourceUrl, `${r.id} ${e.target}`).toMatch(/^https?:\/\//);
        expect((e.note ?? '').length, `${r.id} ${e.target}`).toBeGreaterThan(20);
      }
    }
  });

  it('every receptor has sane binding parameters', () => {
    for (const r of RECEPTORS) {
      expect(r.baselineTone, r.id).toBeGreaterThanOrEqual(0);
      expect(r.baselineTone, r.id).toBeLessThanOrEqual(1);
      expect(r.ec50Occupancy, r.id).toBeGreaterThan(0);
      expect(r.ec50Occupancy, r.id).toBeLessThanOrEqual(1);
      expect(r.hill, r.id).toBeGreaterThan(0);
      expect(r.centralFraction, r.id).toBeGreaterThanOrEqual(0);
      expect(r.centralFraction, r.id).toBeLessThanOrEqual(1);
      expect(r.notes.length, r.id).toBeGreaterThan(10);
    }
  });

  it('the default association rate is declared as an assumption and justified', () => {
    const k = (receptorsFile as unknown as ReceptorsFile).defaultKon;
    expect(k.confidence).toBe('assumed');
    expect(k.note).toMatch(/equilibrium/i);
    expect(k.value).toBeGreaterThan(0);
  });

  it('a transporter carries a resting tone of zero: nothing blocks it at rest', () => {
    for (const r of RECEPTORS) {
      if (r.group !== 'transporter') continue;
      expect(r.baselineTone, r.id).toBe(0);
    }
  });

  it('every drug target names a receptor that exists', () => {
    const ids = new Set(RECEPTORS.map((r) => r.id));
    for (const d of DRUGS) {
      for (const t of d.targets) {
        expect(ids.has(t.receptorId), `${d.id} -> ${t.receptorId}`).toBe(true);
      }
    }
  });
});

describe('organs.json', () => {
  it('every organ has a sourced volume or an explicit null', () => {
    for (const o of ORGANS.organs) {
      if (o.volume_mL !== null) {
        expect(o.volumeSource, o.id).toBeTruthy();
        expect(o.volume_mL, o.id).toBeGreaterThan(0);
      }
    }
  });

  it('organ ids are unique and match the naming scheme', () => {
    const ids = ORGANS.organs.map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z_]+$/);
  });

  it('every organ names a panel that the UI implements', () => {
    const panels = ['cardiac', 'neuro', 'respiratory', 'renal', 'gastric', 'hepatic', 'gi', 'bladder', 'generic'];
    for (const o of ORGANS.organs) expect(panels, o.id).toContain(o.panel);
  });

  it('the GI centrelines form a connected chain', () => {
    const lines = ORGANS.giCentrelines;
    for (let i = 1; i < lines.length; i++) {
      const previousEnd = lines[i - 1].points[lines[i - 1].points.length - 1];
      const nextStart = lines[i].points[0];
      const d = Math.hypot(
        previousEnd[0] - nextStart[0],
        previousEnd[1] - nextStart[1],
        previousEnd[2] - nextStart[2],
      );
      // A gap here would make the bolus teleport between segments.
      expect(d, `${lines[i - 1].segment} -> ${lines[i].segment}`).toBeLessThan(0.05);
    }
  });

  it('every group offset is declared, so the exploded stack stays data-driven', () => {
    for (const o of ORGANS.organs) {
      expect(ORGANS.groupLayout[o.group], o.id).toBeTruthy();
    }
  });
});

describe('foods.json', () => {
  it('every food cites a nutrition source and states its portion', () => {
    const foods = (foodsFile as { foods: { id: string; portionLabel: string; source: string; sourceUrl: string; carb_g: number }[] }).foods;
    for (const f of foods) {
      expect(f.source, f.id).toBeTruthy();
      expect(f.sourceUrl, f.id).toMatch(/^https?:\/\//);
      // "A slice of pizza" is not a unit; the portion must be stated.
      expect(f.portionLabel, f.id).toBeTruthy();
      expect(f.carb_g, f.id).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('the generated report exists and is current', () => {
  it('MISSING_CONSTANTS.md is present and non-trivial', () => {
    const path = join(ROOT, 'docs', 'MISSING_CONSTANTS.md');
    expect(existsSync(path)).toBe(true);
    const text = readFileSync(path, 'utf8');
    expect(text).toContain('MISSING CONSTANTS');
    expect(text).toContain('Generated by');
    expect(text.length).toBeGreaterThan(800);
  });

  it('physiology.json parses and declares its unit conventions', () => {
    expect(physiology.unitConventions).toBeTruthy();
    expect(Object.keys(physiology.constants).length).toBeGreaterThan(80);
  });

  it('leaves no cross-check disagreement unruled on', () => {
    // The SPL cross-check is advisory and never overwrites a cited value, which makes it
    // easy to leave sitting there: six disagreements accumulated in this report and were
    // indistinguishable, at a glance, from six unfixed bugs.
    //
    // Every one of them is now ruled on in tools/ingest/drift_adjudication.ts, with the
    // reasoning printed in section 5.1. This asserts the UNEXPLAINED list is empty - not
    // that there are no disagreements. Nothing is suppressed: the comparisons still run
    // and the disagreements are still printed, and if a curated value changes or the
    // parser starts matching a different sentence, its ruling stops applying and the row
    // comes back here as unexplained.
    const text = readFileSync(join(ROOT, 'docs', 'MISSING_CONSTANTS.md'), 'utf8');
    const section = text.slice(text.indexOf('## 5. Cross-check drift'), text.indexOf('### 5.1'));
    expect(section, 'an unadjudicated cross-check disagreement is in the report').toContain(
      '_No unadjudicated disagreements._',
    );
    // ...and the rulings are actually present, so an empty list cannot come from the
    // comparison silently having stopped running.
    expect(text).toContain('### 5.1 Adjudicated disagreements');
    expect(text.slice(text.indexOf('### 5.1')), 'the rulings vanished').toContain('curated stands');
  });
});
