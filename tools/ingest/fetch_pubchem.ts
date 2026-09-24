import { cachedFetch } from './cache';

/**
 * PUBCHEM PUG-REST — computed physicochemical descriptors.
 *
 * WHY THIS TIER EXISTS.
 *
 * The Pulse substance table carries a LogP for eight of the nineteen drugs and for
 * nobody else, so `bbbPenetration` was null for eleven of them. A null there does not
 * mean "no central effect" — it means the model cannot tell peripheral from central
 * access, so it applies central effects at full strength. That is the conservative
 * choice, and it is also wrong in a specific and embarrassing direction: it let
 * circulating dopamine sedate the simulated subject, when the single most famous fact
 * about dopamine is that it does not cross the blood-brain barrier.
 *
 * PubChem publishes computed descriptors for every one of these compounds, in the
 * public domain, from a stable REST endpoint. Four of them matter here:
 *
 *   XLogP            octanol-water partition coefficient (XLogP3-AA)
 *   TPSA             topological polar surface area, A^2
 *   HBondDonorCount  hydrogen-bond donors
 *   MolecularWeight  g/mol
 *
 * LICENCE. PubChem data is produced by the US National Library of Medicine and is
 * in the public domain (https://www.ncbi.nlm.nih.gov/home/about/policies/). The
 * individual depositor records may carry their own terms; the four computed
 * properties used here are calculated by PubChem itself, not deposited.
 */

const BASE = 'https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name';
const PROPS = 'XLogP,MolecularWeight,TPSA,HBondDonorCount';

export const PUBCHEM_ATTRIBUTION =
  'PubChem (Kim S, et al. Nucleic Acids Res 2023;51:D1373-D1380). Computed molecular ' +
  'descriptors, US National Library of Medicine, public domain.';

export interface PubchemRecord {
  cid: number;
  queriedAs: string;
  xlogP: number | null;
  tpsa: number | null;
  hBondDonorCount: number | null;
  MW_gmol: number | null;
}

export type PubchemData = Map<string, PubchemRecord>;

interface PugProperty {
  CID: number;
  XLogP?: number;
  TPSA?: number;
  HBondDonorCount?: number;
  MolecularWeight?: string | number;
}

function num(v: unknown): number | null {
  if (v === undefined || v === null) return null;
  const n = typeof v === 'string' ? Number.parseFloat(v) : (v as number);
  return Number.isFinite(n) ? n : null;
}

/**
 * Fetch descriptors for each name, trying the aliases in order until one resolves.
 * A compound that resolves to nothing is simply absent from the map; the emitter
 * treats that as "unsourced" and records it, exactly as it treats a missing Pulse row.
 *
 * Mixtures and simple salts (sodium chloride solution, ferrous sulfate) are expected
 * to miss or to return a descriptor set that says nothing useful about membrane
 * permeability. That is handled at the point of use, not here.
 */
export async function fetchPubchem(
  queries: { id: string; names: string[] }[],
  offline: boolean,
  force = false,
): Promise<PubchemData> {
  const out: PubchemData = new Map();

  for (const q of queries) {
    for (const name of q.names) {
      if (!name) continue;
      const url = `${BASE}/${encodeURIComponent(name)}/property/${PROPS}/JSON`;
      let text: string;
      try {
        text = (await cachedFetch(url, { label: `pubchem ${name}`, offline, force })).toString('utf8');
      } catch {
        // A 404 here is an ordinary outcome: the name is not a PubChem synonym.
        // Try the next alias rather than failing the run.
        continue;
      }

      let parsed: { PropertyTable?: { Properties?: PugProperty[] } };
      try {
        parsed = JSON.parse(text) as typeof parsed;
      } catch {
        continue;
      }

      const row = parsed.PropertyTable?.Properties?.[0];
      if (!row) continue;

      out.set(q.id, {
        cid: row.CID,
        queriedAs: name,
        xlogP: num(row.XLogP),
        tpsa: num(row.TPSA),
        hBondDonorCount: num(row.HBondDonorCount),
        MW_gmol: num(row.MolecularWeight),
      });
      break;
    }
  }

  return out;
}

export function pubchemUrl(cid: number): string {
  return `https://pubchem.ncbi.nlm.nih.gov/compound/${cid}`;
}

/* ------------------------------------------------------------------------- */
/* Blood-brain barrier access                                                 */
/* ------------------------------------------------------------------------- */

export interface BbbEstimate {
  penetration: number;
  /** Human-readable breakdown, written into the provenance note. */
  explanation: string;
}

/**
 * PASSIVE CENTRAL ACCESS FROM THREE DESCRIPTORS.
 *
 * The old rule was `penetration = (logP + 1) / 4`, a single monotone ramp on
 * lipophilicity. It has the right instinct and the wrong shape, and it fails on the
 * cases that matter most: it rated furosemide — a drug whose entire point is that it
 * acts in the nephron — at 0.76, because furosemide is moderately lipophilic. What
 * keeps furosemide out of the brain is not its logP, it is 122 A^2 of polar surface.
 *
 * Three descriptors, each a published cut-off, multiplied:
 *
 *   POLAR SURFACE   Kelder (1999) found orally-active CNS drugs cluster below
 *                   60-70 A^2 and that passive penetration is essentially gone by
 *                   120 A^2. Ramp: 1 below 60, 0 above 120.
 *
 *   LIPOPHILICITY   A molecule has to partition into the membrane at all. Below
 *                   logP -1 it does not; by logP 2 that term saturates and the
 *                   limit becomes something else. Ramp: 0 below -1, 1 above 2.
 *
 *   H-BOND DONORS   Each donor costs desolvation energy at the membrane face.
 *                   Pajouhesh & Lenz (2005) put the CNS ceiling at three.
 *                   Ramp: 1 at or below 2, 0 at or above 4.
 *
 * The product is a 0..1 PASSIVE PERMEABILITY LIKELIHOOD, not a measured brain-plasma
 * ratio, and it is labelled that way in the provenance of every value it produces.
 * It knows nothing about active efflux (P-glycoprotein) or carrier-mediated uptake;
 * see docs/MODEL_LIMITATIONS.md.
 *
 * It reproduces the textbook cases unprompted, which is the reason to trust it as far
 * as it goes: dopamine 0.00 against L-DOPA's whole reason for existing, fentanyl 1.00
 * against morphine 0.60 — the exact ratio that makes fentanyl fast and morphine slow —
 * and furosemide 0.00, which the ramp it replaced got wrong by three quarters.
 */
export function bbbPenetrationFrom(
  xlogP: number | null,
  tpsa: number | null,
  hbd: number | null,
): BbbEstimate | null {
  if (xlogP === null || tpsa === null || hbd === null) return null;

  const ramp = (x: number, lo: number, hi: number) => Math.max(0, Math.min(1, (x - lo) / (hi - lo)));

  const polar = 1 - ramp(tpsa, 60, 120);
  const lipo = ramp(xlogP, -1, 2);
  const donor = 1 - ramp(hbd, 2, 4);

  const penetration = polar * lipo * donor;

  const limiting = polar <= lipo && polar <= donor
    ? `polar surface ${tpsa} A^2`
    : lipo <= donor
      ? `lipophilicity XLogP ${xlogP}`
      : `${hbd} hydrogen-bond donors`;

  return {
    penetration,
    explanation:
      `XLogP ${xlogP}, TPSA ${tpsa} A^2, ${hbd} H-bond donors -> ` +
      `lipophilicity ${lipo.toFixed(2)} x polar-surface ${polar.toFixed(2)} x donor ${donor.toFixed(2)} ` +
      `= ${penetration.toFixed(2)}. Limiting term: ${limiting}.`,
  };
}

export const BBB_RULE_SOURCES = [
  {
    label: 'Kelder J, et al. Polar molecular surface as a dominating determinant for oral absorption and brain penetration of drugs. Pharm Res 16(10):1514-1519, 1999.',
    url: 'https://doi.org/10.1023/A:1015040217741',
  },
  {
    label: 'Pajouhesh H, Lenz GR. Medicinal chemical properties of successful central nervous system drugs. NeuroRx 2(4):541-553, 2005.',
    url: 'https://doi.org/10.1602/neurorx.2.4.541',
  },
] as const;
