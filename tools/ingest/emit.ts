import type {
  Drug,
  DrugTarget,
  PkParams,
  Provenance,
  PulsePd,
  Receptor,
  ReceptorActivationModel,
} from '../../src/data/pharma-types';
import { MANIFEST, type ManifestEntry } from './drug_manifest';
import { ROUTE_ADDITIONS } from './route_presets';
import { BLOOD_CLEARED, PK_BY_ID, type PkLiteratureEntry } from './pk_literature';
import { REGISTRY, SOURCES as REGISTRY_SOURCES } from './receptor_registry';
import { isCentralEffect } from './central_effects';
import {
  GTOPDB_ATTRIBUTION,
  cleanName,
  interactionsForLigand,
  type GtopdbData,
  type GtopdbInteraction,
} from './fetch_gtopdb';
import { PULSE_ATTRIBUTION, PULSE_SOURCE_URL, pulseNumber, type PulseData, type PulseSubstance } from './fetch_pulse';
import {
  BBB_RULE_SOURCES,
  PUBCHEM_ATTRIBUTION,
  bbbPenetrationFrom,
  pubchemUrl,
  type PubchemData,
  type PubchemRecord,
} from './fetch_pubchem';
import { OPENFDA_DISCLAIMER, compare, type SplCandidate } from './parse_spl';
import { adjudicateDrift, type DriftAdjudication } from './drift_adjudication';
import {
  REFERENCE_MASS_KG,
  actionToIntrinsicActivity,
  clearancePerKgToLitresPerMin,
  k10FromClearance,
  kFromHalfLife,
  terminalHalfLifeOf,
  terminalHalfLifeOf3,
  twoCompartmentFromVss,
  vAreaFrom,
  vdPerKgToLitres,
} from './normalise';

/**
 * EMIT — merge the tiers and write data/drugs.json and data/receptors.json.
 *
 * Merge order, most authoritative first, per quantity:
 *   affinity / action  : GtoPdb only. No fallback. No value, no binding entry.
 *   MW, protein bound  : Pulse, then the curated literature table.
 *   clearance          : the curated literature table (it carries the citation),
 *                        cross-checked against the SPL parse.
 *   volumes            : the curated literature table only.
 *
 * Every field that reaches the output carries `{ source, sourceUrl, confidence }`
 * in `pk.provenance`, and anything that could not be sourced is emitted as `null`.
 */

export interface MissingField {
  drugId: string;
  field: string;
  reason: string;
}

export interface Drift {
  drugId: string;
  message: string;
}

/** A disagreement that has been ruled on; carries the ruling with it. */
export interface AdjudicatedDrift extends Drift {
  verdict: DriftAdjudication['verdict'];
  because: string;
}

/**
 * Route a disagreement to the adjudicated list if someone has ruled on it, and to the
 * unexplained list if not. Every comparison still runs and every disagreement is still
 * reported; the split is only about whether a reason is attached.
 */
function pushDrift(ctx: DriftSink, drugId: string, message: string): void {
  const ruling = adjudicateDrift(drugId, message);
  if (ruling) ctx.adjudicated.push({ drugId, message, verdict: ruling.verdict, because: ruling.because });
  else ctx.drift.push({ drugId, message });
}

interface DriftSink {
  drift: Drift[];
  adjudicated: AdjudicatedDrift[];
}

export interface EmitResult {
  drugs: Drug[];
  receptors: Receptor[];
  missing: MissingField[];
  /** Disagreements nobody has ruled on. Expected to be empty. */
  drift: Drift[];
  /** Disagreements with a recorded ruling, in `drift_adjudication.ts`. */
  adjudicatedDrift: AdjudicatedDrift[];
  attribution: string[];
  /** Ligand-target pairs GtoPdb has that our registry does not model. */
  unmappedTargets: { drugId: string; target: string; nM: number | null }[];
}

const DEFAULT_KON = {
  value: 0.6,
  unit: '1/(nM*min)',
  source:
    'Diffusion-limited association for a small molecule at a membrane receptor, 1e7 M^-1 s^-1 ' +
    '(Alberts B et al., Molecular Biology of the Cell, 7th ed., ch. 3).',
  sourceUrl: 'https://wwnorton.com/books/9780393884821',
  confidence: 'assumed',
  note:
    'Applied only where a target has a measured Ki but no measured association rate. ' +
    'kon sets how FAST equilibrium is approached; the equilibrium occupancy itself is ' +
    'C/(C+Ki) and depends only on the measured Ki. That is why a default kon is ' +
    'defensible where a default Ki would not be.',
};

export function emit(
  gtopdb: GtopdbData,
  pulse: PulseData,
  spl: Map<string, SplCandidate>,
  pubchem: PubchemData,
): EmitResult {
  const missing: MissingField[] = [];
  const drift: DriftSink = { drift: [], adjudicated: [] };
  const unmappedTargets: { drugId: string; target: string; nM: number | null }[] = [];

  const receptors = buildReceptors(gtopdb);
  const receptorKeys = buildReceptorNameIndex();

  const drugs = MANIFEST.map((m) =>
    buildDrug(m, gtopdb, pulse, spl.get(m.id), pubchem.get(m.id), receptorKeys, missing, drift, unmappedTargets),
  );

  return {
    drugs,
    receptors,
    missing,
    drift: drift.drift,
    adjudicatedDrift: drift.adjudicated,
    unmappedTargets,
    attribution: [
      GTOPDB_ATTRIBUTION,
      PULSE_ATTRIBUTION,
      PUBCHEM_ATTRIBUTION,
      OPENFDA_DISCLAIMER,
      `Receptor effect vectors are curated from: ${Object.values(REGISTRY_SOURCES).map((s) => s.label).join(' | ')}`,
    ],
  };
}

/* ------------------------------------------------------------- receptors */

function buildReceptors(gtopdb: GtopdbData): Receptor[] {
  return REGISTRY.map((r) => {
    const id =
      gtopdb.targetIds.get(cleanName(r.gtopdbName)) ??
      r.gtopdbAliases.map((a) => gtopdb.targetIds.get(cleanName(a))).find((x) => x !== undefined) ??
      null;

    return {
      id: r.id,
      label: r.label,
      group: r.group,
      tissues: r.tissues,
      activationModel: r.activationModel,
      baselineTone: r.baselineTone,
      endogenousDriver: r.endogenousDriver,
      centralFraction: r.centralFraction,
      ec50Occupancy: r.ec50Occupancy,
      hill: r.hill,
      // Each effect says whether it happens behind the blood-brain barrier, which is
      // what pd.ts gates on a drug's penetration. See central_effects.ts for why the
      // old per-receptor blend (centralFraction) was replaced.
      effects: r.effects.map((e) => ({ ...e, central: isCentralEffect(r.id, e.target) })),
      gtopdbTargetId: id ?? null,
      notes: r.notes,
    };
  });
}

/** Map every GtoPdb target spelling we accept onto one of our receptor ids. */
function buildReceptorNameIndex(): Map<string, string> {
  const index = new Map<string, string>();
  for (const r of REGISTRY) {
    index.set(cleanName(r.gtopdbName), r.id);
    index.set(cleanName(r.label), r.id);
    index.set(cleanName(r.id), r.id);
    for (const a of r.gtopdbAliases) index.set(cleanName(a), r.id);
  }
  return index;
}

/**
 * The activation model a receptor id declares. An id the registry does not carry is
 * never emitted as a target, so the fallback is unreachable in practice; it is the
 * conservative one, because `endogenous-agonist` is the model that reads
 * `intrinsicActivity` as an efficacy rather than as a direction.
 */
export function activationModelFor(id: string): ReceptorActivationModel {
  return REGISTRY.find((r) => r.id === id)?.activationModel ?? 'endogenous-agonist';
}

/* ----------------------------------------------------------------- drugs */

function buildDrug(
  m: ManifestEntry,
  gtopdb: GtopdbData,
  pulse: PulseData,
  spl: SplCandidate | undefined,
  pubchem: PubchemRecord | undefined,
  receptorKeys: Map<string, string>,
  missing: MissingField[],
  drift: DriftSink,
  unmapped: { drugId: string; target: string; nM: number | null }[],
): Drug {
  const lit = PK_BY_ID.get(m.id);
  const pulseSub = m.pulseName ? pulse.substances.get(m.pulseName.toLowerCase()) : undefined;

  const sourcesFromPd = new Set<string>();
  const targets = m.gtopdbLigand
    ? buildTargets(m, gtopdb, receptorKeys, unmapped)
    : [];

  appendLiteratureTargets(m, targets);

  if (m.gtopdbLigand && targets.length === 0 && (m.literatureTargets?.length ?? 0) === 0) {
    // An empty target list has two very different causes, and reporting them
    // identically made a deliberate modelling decision look like a pipeline failure.
    // Distinguish them: GtoPdb having nothing to say is an upstream gap; the
    // allow-list rejecting everything GtoPdb offered is a choice, with a reason.
    const offered = unmapped.filter((u) => u.drugId === m.id).length;
    const reason = m.targetsNote
      ? m.targetsNote
      : offered > 0
        ? `GtoPdb has ${offered} human affinity row(s) for "${m.gtopdbLigand}", but none is for a receptor this drug is allowed to bind (see the allow-list in tools/ingest/drug_manifest.ts). They are listed in section 6.`
        : `GtoPdb has no human affinity rows at all for ligand "${m.gtopdbLigand}".`;
    missing.push({ drugId: m.id, field: 'targets', reason });
  }

  const pk = buildPk(m, lit, pulseSub ? pulse : undefined, m.pulseName, pulse, spl, pubchem, missing, drift);
  const pulsePd = buildPulsePd(pulseSub, m.pulseName, m.pulsePdMediatedBy ?? null);
  if (pulsePd) sourcesFromPd.add(`${pulsePd.source} (${pulsePd.sourceUrl})`);

  const sources = new Set<string>(sourcesFromPd);
  for (const t of targets) sources.add(`${t.source} (${t.sourceUrl})`);
  for (const p of Object.values(pk.provenance)) sources.add(`${p.source} (${p.sourceUrl})`);
  for (const d of m.presetDoses) sources.add(`${d.source} (${d.sourceUrl})`);
  for (const d of m.directEffects ?? []) sources.add(`${d.source} (${d.sourceUrl})`);

  // Additional routes, merged in from route_presets.ts. Route order follows the table
  // in src/data/routes.json rather than insertion order, so the drawer is stable.
  const extra = ROUTE_ADDITIONS[m.id];
  const allRoutes = [...new Set([...m.routes, ...(extra?.routes ?? [])])];
  const allPresets = [...m.presetDoses, ...(extra?.presets ?? [])];

  for (const p of allPresets) {
    if (!allRoutes.includes(p.route)) {
      throw new Error(`${m.id}: preset "${p.label}" is for route ${p.route}, which the drug does not declare.`);
    }
  }

  const routePk = extra?.routePk
    ? Object.fromEntries(
        Object.entries(extra.routePk).map(([route, v]) => [
          route,
          {
            ...(v!.ka_min === undefined ? {} : { ka_min: v!.ka_min }),
            ...(v!.bioavailability === undefined ? {} : { bioavailability: v!.bioavailability }),
            ...(v!.lagMin === undefined ? {} : { lagMin: v!.lagMin }),
            provenance: { source: v!.source, sourceUrl: v!.sourceUrl, confidence: v!.confidence, note: v!.note },
          },
        ]),
      )
    : undefined;

  for (const p of allPresets) sources.add(`${p.source} (${p.sourceUrl})`);
  for (const v of Object.values(extra?.routePk ?? {})) sources.add(`${v!.source} (${v!.sourceUrl})`);

  return {
    id: m.id,
    displayName: m.displayName,
    class: m.class,
    // The manifest already states which drawer heading a drug belongs under, and the
    // interface was re-deriving it from the class with a switch that had no case for
    // half the classes — so eighty drugs landed in "Other". Emit the declared value
    // and let the interface read it.
    drawerGroup: m.drawerGroup,
    ...(m.scheduled ? { scheduled: true, scheduleNote: m.scheduleNote } : {}),
    routes: allRoutes,
    presetDoses: allPresets.map(({ route, amount, unit, label, durationMin }) => ({
      route,
      amount,
      unit,
      label,
      ...(durationMin === undefined ? {} : { durationMin }),
    })),
    ...(routePk ? { routePk } : {}),
    pk,
    targets,
    pulsePd,
    directEffects: (m.directEffects ?? []).map((d) => ({
      target: d.target,
      gain: d.gain,
      note: d.note,
      source: d.source,
      sourceUrl: d.sourceUrl,
    })),
    ...(m.payload ? { payload: m.payload } : {}),
    ...(m.hormoneAnalogue ? { hormoneAnalogue: m.hormoneAnalogue } : {}),
    ...(m.antimicrobial ? { antimicrobial: m.antimicrobial } : {}),
    notes: m.notes,
    sources: [...sources].sort(),
  };
}


/**
 * Pulse's pharmacodynamic block. Only emitted when the substance actually declares
 * an EC50 — a modifier without an EC50 has no concentration scale and is therefore
 * unusable, so it is dropped rather than paired with a guessed one.
 */
function buildPulsePd(
  sub: PulseSubstance | undefined,
  pulseName: string | null,
  mediatedBy: string | null,
): PulsePd | null {
  if (!sub) return null;
  const ec50 = pulseNumber(sub, 'EC50');
  const shape = pulseNumber(sub, 'EMaxShapeParameter');
  if (ec50 === null || ec50 <= 0 || shape === null || shape <= 0) return null;

  const pick = (key: string): number | undefined => {
    const v = pulseNumber(sub, key);
    return v === null || v === 0 ? undefined : v;
  };

  const modifiers: PulsePd['modifiers'] = {
    heartRate: pick('HeartRateModifier'),
    systolicPressure: pick('SystolicPressureModifier'),
    diastolicPressure: pick('DiastolicPressureModifier'),
    respirationRate: pick('RespirationRateModifier'),
    tidalVolume: pick('TidalVolumeModifier'),
    sedation: pick('Sedation'),
    bronchodilation: pick('Bronchodilation'),
    neuromuscularBlock: pick('NeuromuscularBlock'),
    tubularPermeability: pick('TubularPermeabilityModifier'),
  };
  for (const k of Object.keys(modifiers) as (keyof PulsePd['modifiers'])[]) {
    if (modifiers[k] === undefined) delete modifiers[k];
  }
  if (Object.keys(modifiers).length === 0) return null;

  return {
    ec50_mg_per_L: ec50,
    emaxShape: shape,
    modifiers,
    mediatedBy,
    source: `Pulse Physiology Engine substance table (Apache-2.0): ${pulseName} pharmacodynamics block`,
    sourceUrl: PULSE_SOURCE_URL,
  };
}

function buildTargets(
  m: ManifestEntry,
  gtopdb: GtopdbData,
  receptorKeys: Map<string, string>,
  unmapped: { drugId: string; target: string; nM: number | null }[],
): DrugTarget[] {
  const names = [m.gtopdbLigand!, ...m.gtopdbAliases];
  const rows = interactionsForLigand(gtopdb, names);

  // Best row per receptor: prefer Ki, then Kd, then EC50, then IC50; within a kind,
  // prefer a row that actually carries an affinity.
  const rank: Record<string, number> = { Ki: 0, Kd: 1, EC50: 2, IC50: 3, unknown: 9 };
  const best = new Map<string, GtopdbInteraction>();

  for (const row of rows) {
    const receptorId = receptorKeys.get(cleanName(row.targetName));
    if (!receptorId) {
      if (row.nM !== null) unmapped.push({ drugId: m.id, target: row.targetName, nM: row.nM });
      continue;
    }
    if (m.receptorAllowList && !m.receptorAllowList.includes(receptorId)) continue;
    if (row.nM === null) continue;

    const current = best.get(receptorId);
    if (!current || rank[row.affinityKind] < rank[current.affinityKind]) {
      best.set(receptorId, row);
    } else if (rank[row.affinityKind] === rank[current.affinityKind] && (row.nM ?? Infinity) < (current.nM ?? Infinity)) {
      // Same evidence class: take the tighter affinity, which is the convention
      // GtoPdb itself uses when reporting a primary target.
      best.set(receptorId, row);
    }
  }

  const out: DrugTarget[] = [];
  for (const [receptorId, row] of best) {
    const model = activationModelFor(receptorId);
    const fromLabel = actionToIntrinsicActivity(row.action, row.type, model);

    // CURATED EFFICACY BEATS THE RAW ASSAY LABEL, WITH A CITATION (ADR-025).
    //
    // GtoPdb's `Action` column records what a ligand did in the assay a curator read.
    // That is not always the drug's published efficacy class, and where the two
    // disagree the published statement wins — carried here with its own source, exactly
    // as a direct effect is (ADR-023), never as a bare number in the manifest.
    const override = m.intrinsicActivity?.[receptorId];
    const ia = override ? override.value : fromLabel;
    // No interpretable action AND no curated one: do not guess. The affinity is real,
    // but a target whose direction is unknown would be a coin toss on the sign.
    if (ia === null) continue;

    out.push({
      receptorId,
      Ki_nM: row.nM,
      intrinsicActivity: ia,
      kon: null,
      koff: null,
      source:
        `IUPHAR/BPS Guide to PHARMACOLOGY ${gtopdb.version}: ${row.ligandName} at ${row.targetName}, ` +
        `${row.affinityKind} ${row.pValue?.toFixed(2)} (${row.action}${row.actionComment ? '; ' + row.actionComment : ''})` +
        (override
          ? `. Intrinsic activity ${override.value} curated, NOT from the assay label above: ` +
            `${override.note} [${override.source}]`
          : '') +
        (row.pubmedId ? `, PMID ${row.pubmedId.split('|')[0]}` : ''),
      sourceUrl: row.ligandId
        ? `https://www.guidetopharmacology.org/GRAC/LigandDisplayForward?ligandId=${row.ligandId}`
        : 'https://www.guidetopharmacology.org',
      confidence: row.affinityKind === 'Ki' || row.affinityKind === 'Kd' ? 'measured' : 'derived',
    });
  }

  out.sort((a, b) => (a.Ki_nM ?? Infinity) - (b.Ki_nM ?? Infinity));
  return out;
}

/** Set of receptor ids the registry actually carries; a literature target for anything else is a mistake. */
const KNOWN_RECEPTOR_IDS = new Set(REGISTRY.map((r) => r.id));

/**
 * Append CITED LITERATURE affinities for targets GtoPdb has no human row for. A GtoPdb
 * row always wins: a literature target for a receptor already built from GtoPdb is
 * dropped, never duplicated, so the automatic source stays authoritative wherever it
 * has something to say. See ManifestEntry.literatureTargets.
 */
function appendLiteratureTargets(m: ManifestEntry, targets: DrugTarget[]): void {
  if (!m.literatureTargets?.length) return;
  const present = new Set(targets.map((t) => t.receptorId));
  for (const lt of m.literatureTargets) {
    if (!KNOWN_RECEPTOR_IDS.has(lt.receptorId)) {
      throw new Error(`${m.id}: literatureTarget names receptor "${lt.receptorId}", which the registry does not carry.`);
    }
    if (present.has(lt.receptorId)) continue; // GtoPdb already covered it; do not double-count.
    if (!(lt.Ki_nM > 0)) throw new Error(`${m.id}: literatureTarget for ${lt.receptorId} has no positive Ki.`);
    targets.push({
      receptorId: lt.receptorId,
      Ki_nM: lt.Ki_nM,
      intrinsicActivity: lt.intrinsicActivity,
      kon: null,
      koff: null,
      source: `Curated literature affinity (NOT from GtoPdb, which has no human row for this pair): ${lt.source}. ${lt.note}`,
      sourceUrl: lt.sourceUrl,
      confidence: lt.confidence ?? 'measured',
    });
    present.add(lt.receptorId);
  }
  targets.sort((a, b) => (a.Ki_nM ?? Infinity) - (b.Ki_nM ?? Infinity));
}

function buildPk(
  m: ManifestEntry,
  lit: PkLiteratureEntry | undefined,
  _hasPulse: PulseData | undefined,
  pulseName: string | null,
  pulse: PulseData,
  spl: SplCandidate | undefined,
  pubchem: PubchemRecord | undefined,
  missing: MissingField[],
  drift: DriftSink,
): PkParams {
  const provenance: Record<string, Provenance> = {};
  const sub = pulseName ? pulse.substances.get(pulseName.toLowerCase()) : undefined;

  const pk: PkParams = {
    logP: null, bbbPenetration: null,
    V1_L: null, V2_L: null, V3_L: null,
    k10_min: null, k12_min: null, k21_min: null, k13_min: null, k31_min: null,
    renalFraction: null, proteinBound: null, MW_gmol: null,
    ka_min: null, lagTime_min: null, bioavailability: null, hepaticExtraction: null,
    bloodClearance: null,
    vmax_mg_per_min: null, km_mg_per_L: null,
    provenance,
  };

  const cite = (field: string, source: string, url: string, confidence: Provenance['confidence'], note?: string) => {
    provenance[field] = { source, sourceUrl: url, confidence, ...(note ? { note } : {}) };
  };

  /* --- molecular weight ---------------------------------------------------- */
  const pulseMw = pulseNumber(sub, 'MolarMass');
  if (pulseMw !== null) {
    pk.MW_gmol = pulseMw;
    cite('MW_gmol', `Pulse substance table: ${pulseName} MolarMass`, PULSE_SOURCE_URL, 'measured');
  } else if (lit?.MW_gmol !== undefined) {
    pk.MW_gmol = lit.MW_gmol;
    const c = lit.citations.find((x) => x.quantity.startsWith('MW'));
    cite('MW_gmol', c?.source ?? 'curated', c?.url ?? '', 'measured');
  } else if (pubchem?.MW_gmol != null) {
    pk.MW_gmol = pubchem.MW_gmol;
    cite('MW_gmol', `PubChem CID ${pubchem.cid} (queried as "${pubchem.queriedAs}"), MolecularWeight`, pubchemUrl(pubchem.cid), 'measured');
  } else if (lit?.shape !== 'none') {
    missing.push({ drugId: m.id, field: 'MW_gmol', reason: 'No molecular weight in Pulse, the literature table or PubChem; free concentration in nM cannot be computed, so this drug binds no receptor.' });
  }

  /* --- blood-brain barrier access ------------------------------------------ */
  // Which receptors a circulating drug can actually reach. A molecule that does not
  // cross is not a weaker central drug, it is a peripheral drug, and getting this
  // wrong changes the sign of whole responses: without it, a dopamine infusion
  // sedates the subject, when the single most famous fact about dopamine is that it
  // does not cross the blood-brain barrier at all.
  //
  // Three descriptors from PubChem, three published cut-offs, multiplied. The rule
  // and its limits are documented in fetch_pubchem.bbbPenetrationFrom.
  const pulseLogP = pulseNumber(sub, 'LogP');
  const bbb = pubchem ? bbbPenetrationFrom(pubchem.xlogP, pubchem.tpsa, pubchem.hBondDonorCount) : null;

  if (pubchem && bbb) {
    pk.logP = pubchem.xlogP;
    pk.bbbPenetration = bbb.penetration;
    cite('logP', `PubChem CID ${pubchem.cid} (queried as "${pubchem.queriedAs}"), XLogP3-AA`, pubchemUrl(pubchem.cid), 'measured');
    cite('bbbPenetration',
      `Computed from PubChem CID ${pubchem.cid} descriptors by the polar-surface/lipophilicity/donor rule of ` +
        BBB_RULE_SOURCES.map((r) => r.label).join(' and '),
      BBB_RULE_SOURCES[0].url, 'derived',
      `${bbb.explanation} A passive-permeability likelihood, not a measured brain-plasma ratio; ` +
        'active efflux and carrier-mediated uptake are not modelled.');

    // The Pulse table is an independent source for logP where it has one. Disagreement
    // is advisory, exactly as the SPL cross-check is.
    if (pulseLogP !== null && pubchem.xlogP !== null && Math.abs(pulseLogP - pubchem.xlogP) > 1.0) {
      pushDrift(drift, m.id, `logP: Pulse substance table ${pulseLogP} vs PubChem XLogP3-AA ${pubchem.xlogP} (using PubChem).`);
    }
  } else if (pulseLogP !== null) {
    // PubChem had no descriptor set. Fall back to the old lipophilicity-only ramp,
    // and say plainly in the provenance that it is the weaker of the two rules.
    pk.logP = pulseLogP;
    pk.bbbPenetration = Math.max(0, Math.min(1, (pulseLogP + 1) / 4));
    cite('logP', `Pulse substance table: ${pulseName} LogP`, PULSE_SOURCE_URL, 'measured');
    cite('bbbPenetration',
      `Derived from the Pulse substance table LogP of ${pulseLogP} for ${pulseName}`,
      PULSE_SOURCE_URL, 'derived',
      'Fallback rule, used only where PubChem has no descriptor set: penetration = (logP + 1)/4, clamped. ' +
        'Lipophilicity alone, with no polar-surface or hydrogen-bond term. Not a measured permeability.');
  } else if (lit?.shape !== 'none') {
    // Without descriptors we cannot say whether the drug reaches the brain, so central
    // receptor effects are left at full strength rather than silently suppressed.
    missing.push({ drugId: m.id, field: 'bbbPenetration', reason: 'No physicochemical descriptors in PubChem or the Pulse substance table, so central versus peripheral receptor access cannot be distinguished. Central effects are applied in full, which may overstate the central action of a hydrophilic drug.' });
  }

  // A CITED override of the computed penetration, for a drug the passive-permeability
  // rule scores wrongly because it cannot see active efflux or a permanent charge.
  // Applied last so it beats whatever PubChem or Pulse produced above, and it carries
  // its own citation. See ManifestEntry.bbbPenetration.
  if (m.bbbPenetration) {
    pk.bbbPenetration = m.bbbPenetration.value;
    cite('bbbPenetration', m.bbbPenetration.source, m.bbbPenetration.sourceUrl, 'derived', m.bbbPenetration.note);
  }

  /* --- protein binding ----------------------------------------------------- */
  const pulseFu = pulseNumber(sub, 'FractionUnboundInPlasma');
  if (lit?.proteinBound !== undefined) {
    pk.proteinBound = lit.proteinBound;
    const c = lit.citations.find((x) => /protein/i.test(x.quantity));
    cite('proteinBound', c?.source ?? 'curated literature table', c?.url ?? '', c?.confidence ?? 'measured');
  } else if (pulseFu !== null) {
    pk.proteinBound = 1 - pulseFu;
    cite('proteinBound', `Pulse substance table: ${pulseName} FractionUnboundInPlasma = ${pulseFu}`, PULSE_SOURCE_URL, 'measured');
  } else if (lit?.shape !== 'none') {
    pk.proteinBound = 0;
    cite('proteinBound', 'No sourced value; treated as unbound so free concentration equals total. Listed in MISSING_CONSTANTS.md.', 'docs/MISSING_CONSTANTS.md', 'assumed');
    missing.push({ drugId: m.id, field: 'proteinBound', reason: 'No plasma protein binding in Pulse, the SPL parse or the literature table. Free fraction assumed 1.0, which will over-estimate receptor occupancy.' });
  }

  if (spl) {
    const d = compare('protein binding', pk.proteinBound, spl.proteinBound, 0.4);
    if (d) pushDrift(drift, m.id, d);
  }

  /* --- absorption ---------------------------------------------------------- */
  if (lit?.ka_min !== undefined) {
    pk.ka_min = lit.ka_min;
    const c = lit.citations.find((x) => /absorption rate|absorption/i.test(x.quantity)) ?? lit.citations[0];
    cite('ka_min', c.source, c.url, c.confidence, c.note);
  }
  if (lit?.lagTime_min !== undefined) {
    pk.lagTime_min = lit.lagTime_min;
    const c = lit.citations.find((x) => /lag|absorption/i.test(x.quantity)) ?? lit.citations[0];
    cite('lagTime_min', c.source, c.url, c.confidence, c.note);
  }
  if (lit?.bioavailability !== undefined) {
    pk.bioavailability = lit.bioavailability;
    const c = lit.citations.find((x) => /bioavail/i.test(x.quantity));
    cite('bioavailability', c?.source ?? 'curated literature table', c?.url ?? '', c?.confidence ?? 'measured');
  }
  if (lit?.hepaticExtraction !== undefined) {
    pk.hepaticExtraction = lit.hepaticExtraction;
    cite('hepaticExtraction', lit.citations[0].source, lit.citations[0].url, 'derived');
  }
  const blood = BLOOD_CLEARED[m.id];
  if (blood) {
    pk.bloodClearance = true;
    cite('bloodClearance', blood.source, blood.url, 'measured', blood.note);
  }
  if (lit?.vmax_mg_per_min !== undefined) {
    pk.vmax_mg_per_min = lit.vmax_mg_per_min;
    cite('vmax_mg_per_min', lit.citations[0].source, lit.citations[0].url, lit.citations[0].confidence);
  }
  if (lit?.km_mg_per_L !== undefined) {
    pk.km_mg_per_L = lit.km_mg_per_L;
    cite('km_mg_per_L', lit.citations[0].source, lit.citations[0].url, lit.citations[0].confidence);
  }

  /* --- renal fraction ------------------------------------------------------ */
  if (lit?.renalFraction !== undefined) {
    pk.renalFraction = lit.renalFraction;
    const c = lit.citations.find((x) => /renal/i.test(x.quantity));
    cite('renalFraction', c?.source ?? 'curated literature table', c?.url ?? '', c?.confidence ?? 'measured');
  }

  /* --- compartments -------------------------------------------------------- */
  if (!lit) {
    missing.push({ drugId: m.id, field: 'pk', reason: 'No entry in the literature table; the drug appears in the drawer but cannot be simulated.' });
    return pk;
  }

  switch (lit.shape) {
    case 'none':
      cite('V1_L', lit.citations[0]?.source ?? 'no compartmental PK', lit.citations[0]?.url ?? '', 'derived');
      break;

    case 'micro': {
      const mi = lit.micro!;
      pk.V1_L = mi.V1_L;
      pk.V2_L = mi.V2_L ?? null;
      pk.V3_L = mi.V3_L ?? null;
      pk.k10_min = mi.k10;
      pk.k12_min = mi.k12 ?? null;
      pk.k21_min = mi.k21 ?? null;
      pk.k13_min = mi.k13 ?? null;
      pk.k31_min = mi.k31 ?? null;
      const c = lit.citations[0];
      for (const f of ['V1_L', 'V2_L', 'V3_L', 'k10_min', 'k12_min', 'k21_min', 'k13_min', 'k31_min']) {
        cite(f, c.source, c.url, c.confidence, c.note);
      }
      break;
    }

    case 'one': {
      const cl = resolveClearance(lit);
      if (lit.halfLife_min === undefined || (cl === null && lit.v1_L === undefined)) {
        missing.push({
          drugId: m.id,
          field: 'V1_L',
          reason: 'One-compartment model needs a terminal half-life plus either a clearance or a directly-cited central volume; neither pair is available.',
        });
        break;
      }
      const k10 = kFromHalfLife(lit.halfLife_min);
      pk.k10_min = k10;
      pk.V1_L = lit.v1_L ?? cl! / k10;
      const clCite = lit.citations.find((x) => /clearance/i.test(x.quantity)) ?? lit.citations[0];
      const hlCite = lit.citations.find((x) => /half-?life/i.test(x.quantity)) ?? lit.citations[0];
      const v1Cite = lit.citations.find((x) => /^V1/i.test(x.quantity)) ?? clCite;
      cite('k10_min', hlCite.source, hlCite.url, hlCite.confidence, hlCite.note);
      if (lit.v1_L !== undefined) {
        cite('V1_L', v1Cite.source, v1Cite.url, v1Cite.confidence, v1Cite.note);
      } else {
        cite('V1_L', `${clCite.source} (clearance) with ${hlCite.source} (half-life)`, clCite.url, 'derived',
          'V1 = CL / (ln2 / t-half). An identity, not an independent measurement.');
      }
      break;
    }

    case 'two': {
      const cl = resolveClearance(lit);
      const vss = lit.vss_L ?? (lit.vd_L_per_kg !== undefined ? vdPerKgToLitres(lit.vd_L_per_kg, REFERENCE_MASS_KG) : undefined);
      if (cl === null || vss === undefined || lit.v1_L === undefined || lit.halfLife_min === undefined) {
        missing.push({ drugId: m.id, field: 'pk', reason: 'Two-compartment model needs clearance, Vss, V1 and a terminal half-life; at least one is missing.' });
        break;
      }
      const c = lit.citations[0];
      const micro = twoCompartmentFromVss(lit.v1_L, cl, vss, lit.halfLife_min);

      if (micro) {
        pk.V1_L = lit.v1_L;
        pk.V2_L = vss - lit.v1_L;
        pk.k10_min = micro.k10;
        pk.k12_min = micro.k12;
        pk.k21_min = micro.k21;
        for (const f of ['V1_L', 'V2_L', 'k10_min', 'k12_min', 'k21_min']) {
          cite(f, c.source, c.url, f === 'V1_L' ? 'derived' : c.confidence, c.note);
        }
        provenance.k10_min = {
          source: `${c.source}; micro-constants solved from V1, CL, Vss and the terminal half-life (normalise.twoCompartmentFromVss)`,
          sourceUrl: c.url,
          confidence: 'derived',
          note: `Implied distribution half-life ${(Math.LN2 / micro.alpha).toFixed(1)} min.`,
        };
      } else {
        // Vss >= V_area: the published trio cannot describe a two-compartment model.
        // Drop to one compartment at V_area rather than adjust a cited number.
        const vArea = vAreaFrom(cl, lit.halfLife_min);
        pk.V1_L = vArea;
        pk.k10_min = kFromHalfLife(lit.halfLife_min);
        cite('V1_L', `${c.source}; V_area = CL / (ln2 / t-half)`, c.url, 'derived',
          'The published volume of distribution is at least as large as V_area, so it is V_area rather than Vss and no distribution phase is identifiable from it. Modelled as one compartment.');
        cite('k10_min', c.source, c.url, c.confidence, c.note);
        missing.push({
          drugId: m.id,
          field: 'V2_L / k12 / k21',
          reason: `The published Vss (${vss.toFixed(0)} L) is not smaller than V_area (${vAreaFrom(cl, lit.halfLife_min).toFixed(0)} L), so a two-compartment model is not identifiable from the cited values. Collapsed to one compartment at V_area; the early distribution phase after a bolus is therefore not reproduced.`,
        });
      }

      if (micro) {
        const implied = terminalHalfLifeOf(micro.k10, micro.k12, micro.k21);
        const d = compare('terminal half-life (min)', lit.halfLife_min, implied, 0.25);
        if (d) pushDrift(drift, m.id, `${d} - the solved micro-constants do not reproduce the published terminal phase.`);
      }
      break;
    }
  }

  if (spl?.found) {
    const modelled = impliedHalfLife(pk);
    if (spl.halfLifeIsBound && spl.halfLife_min !== null && modelled !== null) {
      // The label quoted a bound, so the only way to disagree with it is to exceed it.
      if (modelled > spl.halfLife_min) {
        pushDrift(
          drift,
          m.id,
          `terminal half-life (min): the model's ${modelled.toPrecision(3)} exceeds the bound of ` +
            `${spl.halfLife_min.toPrecision(3)} the label states ("${(spl.evidence.halfLife ?? '').slice(0, 120)}").`,
        );
      }
    } else {
      const d1 = compare('terminal half-life (min) vs the SPL prose parse', modelled, spl.halfLife_min, 1.0);
      if (d1) {
        pushDrift(drift, m.id, `${d1}. Label sentence: "${(spl.evidence.halfLife ?? '').slice(0, 160)}"`);
      }
    }
  }

  void k10FromClearance;
  return pk;
}

function resolveClearance(lit: PkLiteratureEntry): number | null {
  if (lit.clearance_L_per_min !== undefined) return lit.clearance_L_per_min;
  if (lit.clearance_mL_per_min_kg !== undefined) {
    return clearancePerKgToLitresPerMin(lit.clearance_mL_per_min_kg, REFERENCE_MASS_KG);
  }
  return null;
}

function impliedHalfLife(pk: PkParams): number | null {
  if (pk.k10_min === null) return null;
  if (pk.k12_min === null || pk.k21_min === null) return Math.LN2 / pk.k10_min;
  // A three-compartment drug's terminal phase belongs to the DEEP compartment, so
  // computing it from k10/k12/k21 alone does not approximate the answer — it reports
  // the wrong phase of the curve. Fentanyl came out at 52.6 min instead of 7 h.
  if (pk.k13_min !== null && pk.k31_min !== null) {
    return terminalHalfLifeOf3(pk.k10_min, pk.k12_min, pk.k21_min, pk.k13_min, pk.k31_min);
  }
  return terminalHalfLifeOf(pk.k10_min, pk.k12_min, pk.k21_min);
}

export { DEFAULT_KON };
