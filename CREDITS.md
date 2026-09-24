# CREDITS AND LICENCES

CORPUS is an educational simulation. **NOT FOR CLINICAL USE.**

Every number in this application comes from a cited source. This file records those
sources and the licence terms under which they are used. `docs/MISSING_CONSTANTS.md`
records every place we could not find one.

---

## Data sources

### IUPHAR/BPS Guide to PHARMACOLOGY (GtoPdb)

Ligand–target binding affinities and action classifications for every receptor
interaction in `src/data/drugs.json`.

- <https://www.guidetopharmacology.org>
- **Database licence: ODbL.** **Contents: CC BY-SA 4.0.**
- Attribution is required and is carried in `drugs.json` and `receptors.json` under
  `attribution`, and shown in the drug drawer's per-drug source list.
- Files used: `interactions.csv`, `targets_and_families.csv`.

> Harding SD, Armstrong JF, Faccenda E, et al. The IUPHAR/BPS Guide to PHARMACOLOGY
> in 2024. *Nucleic Acids Research* 52(D1):D1438–D1449, 2024.
> <https://doi.org/10.1093/nar/gkad944>

**Share-alike note.** CC BY-SA applies to the *contents*. `src/data/drugs.json` and
`src/data/receptors.json` are derived from those contents and are therefore
distributed under CC BY-SA 4.0. The application code is not a derivative work of the
data and is not affected.

### Pulse Physiology Engine (Kitware)

Molecular weights, plasma protein binding, systemic and renal clearances, logP, and
the pharmacodynamic EC₅₀/modifier blocks. Also the methodology documentation behind
several cardiovascular, renal, respiratory and energy parameters.

- <https://pulse.kitware.com>
- <https://gitlab.kitware.com/physiology/engine>
- **Apache License 2.0.** Permissive, commercial-use-safe, no share-alike.
- File used: `data/Data.xlsx`, sheet `Substances`.

Per spec §7.6 the data and the equations are used; the engine itself is not compiled
or linked. The models are reimplemented in TypeScript.

### openFDA / DailyMed

Structured Product Labels, section 12.3 (Clinical Pharmacology — Pharmacokinetics),
used to cross-check the curated pharmacokinetic values and as the primary source for
several of them.

- <https://open.fda.gov>
- <https://dailymed.nlm.nih.gov>
- Public US government resource. No attribution licence; the disclaimer below is
  required and is carried in `drugs.json`.

> Data from openFDA (api.fda.gov). openFDA is a research tool. Its data has not been
> validated for clinical or production use. It does not constitute FDA endorsement,
> and should not be used to make decisions about medical care.

### USDA FoodData Central

Macronutrient composition for every item in `src/data/foods.json`.

- <https://fdc.nal.usda.gov>
- US public-domain government data.

### PubChem

Molecular weights for compounds absent from the Pulse substance table.

- <https://pubchem.ncbi.nlm.nih.gov>
- US public-domain government data.

---

## Published models reimplemented

| Model | Used for | Reference |
|---|---|---|
| McSharry–Clifford dynamical ECG | `sim/derive/waveforms/ecg.ts` | McSharry PE, Clifford GD, Tarassenko L, Smith LA. *IEEE Trans Biomed Eng* 50(3):289–294, 2003. [doi:10.1109/TBME.2003.808805](https://doi.org/10.1109/TBME.2003.808805) |
| Ursino baroreflex | `sim/systems/baroreflex.ts` | Ursino M. *Am J Physiol* 275(5):H1733–H1747, 1998. [doi:10.1152/ajpheart.1998.275.5.H1733](https://doi.org/10.1152/ajpheart.1998.275.5.H1733) |
| Time-varying elastance | `sim/systems/cardio.ts` | Suga H, Sagawa K. *Circ Res* 35(1):117–126, 1974. [doi:10.1161/01.RES.35.1.117](https://doi.org/10.1161/01.RES.35.1.117) |
| Double-Hill activation | `sim/systems/cardio.ts` | Mynard JP, Davidson MR, Penny DJ, Smolich JJ. *Int J Numer Method Biomed Eng* 28(6–7):626–641, 2012. [doi:10.1002/cnm.1466](https://doi.org/10.1002/cnm.1466) |
| 4-element Windkessel | `sim/systems/cardio.ts` | Stergiopulos N, Westerhof BE, Westerhof N. *Am J Physiol* 276(1):H81–H88, 1999. [doi:10.1152/ajpheart.1999.276.1.H81](https://doi.org/10.1152/ajpheart.1999.276.1.H81) |
| O₂ dissociation | `sim/systems/respiratory.ts` | Severinghaus JW. *J Appl Physiol* 46(3):599–602, 1979. [doi:10.1152/jappl.1979.46.3.599](https://doi.org/10.1152/jappl.1979.46.3.599) |
| Bergman minimal model | `sim/systems/metabolic.ts` | Bergman RN, Phillips LS, Cobelli C. *J Clin Invest* 68(6):1456–1467, 1981. [doi:10.1172/JCI110398](https://doi.org/10.1172/JCI110398) |
| Power-exponential gastric emptying | `sim/systems/gi.ts` | Elashoff JD, Reedy TJ, Meyer JH. *Gastroenterology* 83(6):1306–1312, 1982. [doi:10.1016/S0016-5085(82)80145-5](https://doi.org/10.1016/S0016-5085(82)80145-5) |
| Transcapillary refill | `sim/systems/fluids.ts` | Lundvall J, Länne T. *Acta Physiol Scand* 165(2):181–187, 1999. [doi:10.1046/j.1365-201x.1999.00493.x](https://doi.org/10.1046/j.1365-201x.1999.00493.x) |
| Fentanyl TCI parameters | `tools/ingest/pk_literature.ts` | Shafer SL, Varvel JR, Aziz N, Scott JC. *Anesthesiology* 73(6):1091–1102, 1990. [doi:10.1097/00000542-199012000-00005](https://doi.org/10.1097/00000542-199012000-00005) |
| Propofol TCI parameters (Marsh) | `tools/ingest/pk_literature.ts` | Marsh B, White M, Morton N, Kenny GN. *Br J Anaesth* 67(1):41–48, 1991. [doi:10.1093/bja/67.1.41](https://doi.org/10.1093/bja/67.1.41) |
| Dopamine pharmacokinetics | `tools/ingest/pk_literature.ts` | MacGregor DA, Smith TE, Prielipp RC, et al. *Anesthesiology* 92(2):338–346, 2000. [doi:10.1097/00000542-200002000-00013](https://doi.org/10.1097/00000542-200002000-00013) |
| Adrenaline clearance and thresholds | `tools/ingest/pk_literature.ts` | Clutter WE, Bier DM, Shah SD, Cryer PE. *J Clin Invest* 66(1):94–101, 1980. [doi:10.1172/JCI109840](https://doi.org/10.1172/JCI109840) |
| VF frequency spectrum | `src/data/ecg_morphologies.json` | Clayton RH, Murray A, Campbell RWF. *Eur Heart J* 16(8):1112–1118, 1995. [doi:10.1093/oxfordjournals.eurheartj.a061055](https://doi.org/10.1093/oxfordjournals.eurheartj.a061055) |
| Resuscitation parameters | `sim/systems/procedures.ts` | Panchal AR, et al. 2020 AHA Guidelines for CPR and ECC. *Circulation* 142(16_suppl_2), 2020. [doi:10.1161/CIR.0000000000000916](https://doi.org/10.1161/CIR.0000000000000916) |

## Textbooks cited for physiological and pharmacological reasoning

Read and cited; never scraped.

- Hall JE, Hall ME. *Guyton and Hall Textbook of Medical Physiology*, 14th ed. Elsevier, 2021.
- West JB, Luks AM. *West's Respiratory Physiology: The Essentials*, 10th ed. Wolters Kluwer, 2016.
- Brunton LL, Knollmann BC (eds). *Goodman & Gilman's The Pharmacological Basis of Therapeutics*, 14th ed. McGraw Hill, 2023.
- Ritter JM, Flower R, Henderson G, et al. *Rang & Dale's Pharmacology*, 10th ed. Elsevier, 2023.
- Alexander SPH, et al. THE CONCISE GUIDE TO PHARMACOLOGY 2023/24. *Br J Pharmacol* 180(S2), 2023. [doi:10.1111/bph.16177](https://doi.org/10.1111/bph.16177)
- Schomer DL, Lopes da Silva FH (eds). *Niedermeyer's Electroencephalography*, 7th ed. Oxford University Press, 2017.
- Alberts B, et al. *Molecular Biology of the Cell*, 7th ed. W. W. Norton, 2022.
- Standring S (ed). *Gray's Anatomy: The Anatomical Basis of Clinical Practice*, 41st ed. Elsevier, 2016. — vessel centrelines and luminal radii in `src/data/vasculature.json`.
- Melmed S, Auchus RJ, Goldfine AB, Koenig RJ, Rosen CJ (eds). *Williams Textbook of Endocrinology*, 14th ed. Elsevier, 2020. — hormone baselines and reference ranges in `src/data/hormones.json`.

## Primary literature cited per drug

The expanded drug set is sourced drug by drug in `tools/ingest/pk_literature_2.ts` and
`tools/ingest/drug_manifest_2.ts`, overwhelmingly from FDA Structured Product Labels
(section 12.3) via DailyMed, which are free, stable and in the US public domain. Where a
label was insufficient, a primary paper is cited in that drug's own entry.

Laboratory reference intervals used by the laboratory panel:

- Kratz A, Ferraro M, Sluss PM, Lewandrowski KB. Laboratory reference values. *New England Journal of Medicine* 351:1548-1563, 2004.

Glycaemic indices:

- Atkinson FS, Brand-Miller JC, Foster-Powell K, Buyken AE, Goletzke J. International tables of glycemic index and glycemic load values 2021. *Am J Clin Nutr* 114(5):1625-1632, 2021. [doi:10.1093/ajcn/nqab233](https://doi.org/10.1093/ajcn/nqab233)

Standard drink definition:

- US National Institute on Alcohol Abuse and Alcoholism. *What is a standard drink?* A US standard drink contains 14 g of pure ethanol.

## Controlled substances

Six controlled or recreational compounds are modelled: THC, methamphetamine, MDMA,
cocaine, nicotine and ethanol. They are present because their pharmacology is taught in
every medical and pharmacology curriculum, and because their toxicity is the educational
content — a methamphetamine overdose produces the hyperthermia, tachycardia and lowered
fibrillation threshold it really produces, emerging from receptor and transporter
occupancy rather than from a script.

Reference amounts for these are **exposures from published human pharmacology studies**,
cited individually and labelled in the interface as study exposures. They exist for the
same reason every other reference amount in this project exists: so that a simulated
dose is anchored to a figure a reader can go and check.

- Cruickshank CC, Dyer KR. A review of the clinical pharmacology of methamphetamine. *Addiction* 104(7):1085-1099, 2009.
- de la Torre R, et al. Human pharmacology of MDMA. *Ther Drug Monit* 26(2):137-144, 2004.
- Jeffcoat AR, et al. Cocaine disposition in humans. *J Anal Toxicol* 13(1):A1-A7, 1989.
- Huestis MA. Human cannabinoid pharmacokinetics. *Chem Biodivers* 4(8):1770-1804, 2007.
- Schwartz BG, Rezkalla S, Kloner RA. Cardiovascular effects of cocaine. *Circulation* 122(24):2558-2569, 2010.
- Cederbaum AI. Alcohol metabolism. *Clin Liver Dis* 16(4):667-685, 2012.
- Vonghia L, et al. Acute alcohol intoxication. *Eur J Intern Med* 19(8):561-567, 2008.

**Nothing in this application constitutes usage guidance of any kind**, for these or for
anything else. What is modelled is receptor binding, pharmacokinetics and the resulting
physiology. There is no synthesis, sourcing, preparation or route-of-use information
anywhere in the codebase, including in comments.

## Deliberately NOT used

**DrugBank.** Its free tier is academic-use-only and commercial use requires a paid
licence. It is the obvious first hit for this kind of data and it is a licensing
trap (spec §5.6).

**ChEMBL.** Named in spec §5.6 as the secondary affinity source. It was attempted:
the public REST API returned HTTP 500 for both the molecule-search and activity
endpoints at build time. Rather than ship an adapter that is always skipped, the
pipeline relies on GtoPdb and the Pulse pharmacodynamic block, and
`MISSING_CONSTANTS.md` records the resulting gaps. See `docs/DECISIONS.md` ADR-013.

---

## Software

| Dependency | Licence |
|---|---|
| [three.js](https://threejs.org) | MIT |
| [React](https://react.dev) | MIT |
| [Zustand](https://github.com/pmndrs/zustand) | MIT |
| [Comlink](https://github.com/GoogleChromeLabs/comlink) | Apache-2.0 |
| [Vite](https://vitejs.dev) | MIT |
| [Vitest](https://vitest.dev) | MIT |
| [TypeScript](https://www.typescriptlang.org) | Apache-2.0 |
| [Nunito](https://fonts.google.com/specimen/Nunito) (webfont) | SIL Open Font License 1.1 |

No other runtime dependency is used. The XLSX reader, the CSV parser, the ZIP
inflater, the Bayer dither, the ECG renderer and the sparklines are all written here
rather than pulled in, per spec §2 and §0.5.

---

## 3D assets

**Phase 7 has not been reached.** All organ geometry is procedurally generated by
`src/render/organs/placeholder.ts` and is original to this project. There are no
binary assets in the repository, and the application builds and runs from a clean
checkout with none.

### The share-alike decision, recorded before Phase 7 (spec §7.3)

When real meshes are introduced, the licence of the source determines what may be
distributed:

| Source | Licence | Implication |
|---|---|---|
| [Z-Anatomy](https://www.z-anatomy.com) | CC BY-SA 4.0 | Derivative *assets* must be released under CC BY-SA 4.0. Application code is unaffected. |
| [BodyParts3D](https://lifesciencedb.jp/bp3d/) (DBCLS) | CC BY-SA 2.1 JP | As above. The upstream source for Z-Anatomy; raw and noisy. |
| [NIH 3D](https://3d.nih.gov) | Per-model, often public domain | The only route to a fully proprietary asset set without payment. |
| Commercial marketplaces | Per-asset | The other route. |

**The decision for CORPUS:** if the project ships as an open educational tool, use
Z-Anatomy and release the processed `.glb` files under CC BY-SA 4.0 with attribution
here. If it ever ships as a closed commercial product, the CC BY-SA sources are
unusable for the *assets* and NIH public-domain or paid commercial models are the
only options. This is recorded now rather than after the meshes are already in the
repository, because share-alike is much harder to unwind than to plan for.

`tools/prep-assets/clean_organ.py` implements the voxel-remesh → smooth → decimate
pipeline the meshes will need, and is ready for whichever source is chosen.

---

## The reference product

The visual and interaction target was thirteen frames captured from the marketing
site of **"LIFE" by thix.co**, supplied with the specification and kept in
`reference/`. They are used as a design target and are documented frame by frame in
`docs/VISUAL_AUDIT.md`.

**No asset, mesh, texture, icon, shader or copy text from that product is reproduced
here.** Every string, every icon and every line of shader code in CORPUS is original.
The name "LIFE", the thix.co branding and their hero layout are not used. Where the
reference's behaviour and the specification disagreed, `docs/DECISIONS.md` records
which was followed and why.
