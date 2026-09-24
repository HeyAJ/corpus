# CORPUS

A real-time, browser-based simulation of adult human physiology and pharmacology,
rendered as a stack of translucent 3D organs.

> **NOT FOR CLINICAL USE — EDUCATIONAL SIMULATION.**
> Nothing here is patient-specific and nothing here is dosing guidance. The fidelity
> target is *"a medical student says that's roughly right"*, not *"a cardiologist
> says that's clinically valid"*. See [`docs/MODEL_LIMITATIONS.md`](docs/MODEL_LIMITATIONS.md).

Select an organ to read live telemetry from it. Administer any of **89 drugs** and
**46 foods** by any of **twelve routes** — intravenous, intraosseous, intramuscular,
subcutaneous, intranasal, sublingual, rectal, transdermal, inhaled, nebulised or oral —
and watch the body respond through pharmacokinetics, receptor binding kinetics, hormonal
feedback and downstream physiology.

Turn on the vascular overlay and watch the blood move: arteries and veins as real
geometry, flow pulsing with the cardiac cycle, particles coloured by what is actually
circulating. Give a drug and watch its colour appear in the stream.

Run an arrest, do CPR, and find out why shocking asystole does nothing.

---

## Running it

```bash
npm install
npm run dev            # http://localhost:5173
npm test               # the whole suite
npm run build          # production bundle
```

The app builds and runs from a clean checkout with **no binary assets**. Organ
geometry is generated procedurally at load.

```bash
npm run ingest         # regenerate data/drugs.json + data/receptors.json from source
npm run ingest:offline # the same, from the disk cache; fails if anything is missing
npm run organs         # triangle-budget report + public/organ-manifest.json
npm run lint           # includes the layer-isolation rules
npm run typecheck
```

---

## What is actually being simulated

Everything on screen is a computed output of one state vector, integrated at a fixed
100 Hz timestep in a Web Worker. Ejection fraction is derived from the elastance
model's end-diastolic and end-systolic volumes; it is not a stored number. The ECG's
angular frequency is the cardiovascular heart rate, so the trace and the numeric rate
cannot disagree.

| System | Model |
|---|---|
| **Cardiovascular** | Eight-compartment closed loop. Time-varying ventricular elastance with a double-Hill activation, four-element Windkessel arterial tree, Ursino two-limb baroreflex with a fast vagal limb and a slow sympathetic one. |
| **Electrocardiogram** | McSharry–Clifford dynamical model. Sinus, tachycardia, bradycardia, atrial fibrillation, VT, VF, asystole and PEA, with respiratory sinus arrhythmia. |
| **Respiratory** | Single alveolar compartment, alveolar ventilation equation, Severinghaus dissociation, two-limb chemoreceptor drive. |
| **Renal** | Myogenic autoregulation flat across MAP 80–180 then falling off a cliff, with renal drug clearance scaling on live GFR. |
| **Gastrointestinal** | Twelve segments, Elashoff power-exponential gastric emptying with fat delay, site-specific absorption, derived gastric pH. Glycaemic index and fibre scale the RATE of glucose absorption without changing the total, so a food changes the shape of the curve rather than its area. |
| **Metabolic** | Bergman minimal model with glucagon counter-regulation, anaerobic lactate, defended core temperature. |
| **Endocrine** | Six hormones as first-order compartments with closed feedback loops: cortisol with a circadian term, aldosterone driven by renin *and independently by serum potassium*, vasopressin with separate osmotic and volume limbs at deliberately different sensitivities. Hormones reach physiology through the same effect bus every drug uses, so a drug and a hormone can oppose each other. |
| **Pharmacokinetics** | Two- and three-compartment ODEs with time-varying clearance. Twelve routes, each an independent depot with its own rate constant, lag and bioavailability. Saturable Michaelis-Menten elimination where a drug declares it — ethanol and phenytoin both do. |
| **Vascular rendering** | Thirty-one named vessel segments with anatomical centrelines, flow pulsing with the real cardiac phase, and particles coloured by what the blood is carrying. Vessel colour comes from oxygen saturation, so the pulmonary artery is drawn dark and the pulmonary veins bright — the opposite of every red-and-blue diagram, and the right way round. |
| **Pharmacodynamics** | Explicit binding kinetics with Gaddum competition, endogenous tone, receptor reserve and blood–brain-barrier gating. |
| **Resuscitation** | CPR as a thoracic pump; probabilistic, seeded defibrillation conditioned on rhythm, downtime and coronary perfusion pressure. |

### Three loops worth watching

1. **Give epinephrine 1 mg.** Systolic pressure spikes, the fast vagal limb produces
   a brief bradycardia, and then direct β1 chronotropy asserts itself and the rate
   climbs. Nothing scripts that sequence; it falls out of measured binding affinities
   and two reflex limbs with different time constants.

2. **Bleed a litre, then give furosemide.** Mean pressure falls below 80, GFR falls
   off its plateau, renal clearance falls with it, and the drug now lasts
   measurably longer. Give a second dose and it accumulates.

3. **Eat a fatty meal, then take an oral dose.** Duodenal feedback from the meal's
   fat slows gastric emptying, and the drug's plasma peak arrives visibly later.

4. **Give adrenaline intramuscularly, then subcutaneously.** The intramuscular peak
   arrives at eight minutes and the subcutaneous one later and lower. That ratio is not
   a style choice: it is Simons' 2001 measurement of the same two routes in the same
   adults, and it is the study that moved anaphylaxis guidance from one to the other.

5. **Put on a fentanyl patch and watch nothing happen.** For twelve hours there is no
   drug in the plasma at all, because the stratum corneum is a rate-limiting membrane.
   Then it arrives, and it keeps arriving for days. The route exists in this simulation
   because it has the longest gap of any between a decision and its consequence.

6. **Open the receptor panel and give clozapine.** Seventeen receptors light up at once.
   That is not a bug in the data — it is the most effective antipsychotic there is, and
   nobody is certain which of the seventeen is doing the work. It is the best argument
   this application makes for having a receptor panel at all.

7. **Give two standard drinks and watch the elimination refuse to be exponential.**
   Alcohol dehydrogenase is saturated at any meaningful concentration, so the body
   removes a fixed *amount* per hour rather than a fixed fraction. Doubling the dose
   more than doubles the time to sober, and the curve visibly has a straight section.

8. **Compare propranolol and atenolol.** Same class, same receptor, and one of them
   reaches the brain. The difference is entirely physicochemical, and the
   blood-brain-barrier rule derives it from PubChem descriptors rather than being
   told.

9. **Drink three beers and watch the elimination refuse to be exponential.** Alcohol and
   caffeine in the food data are not macronutrients — they are handed to the same
   pharmacokinetics an oral tablet uses, so a drink interacts with a benzodiazepine
   because both reach the same sedation target by the same effect bus. Trebling the dose more
   than trebles the time to clear, because alcohol dehydrogenase is saturated.

---

## Where the numbers come from

**Nothing in this application is a number somebody made up.** Every physiological
constant lives in `src/data/physiology.json` with a `source`, a `unit` and a
`confidence` of `measured`, `derived` or `assumed`. A `derived` value must explain
how it was derived; an `assumed` value must declare itself an engineering default
rather than a physiological claim. `tests/data/provenance.test.ts` fails the build
if any of that is missing.

The drug data is **generated**, not typed. `tools/ingest/` is a real pipeline:

```
fetch_gtopdb.ts   IUPHAR/BPS binding affinities        (ODbL / CC BY-SA 4.0)
fetch_pubchem.ts  computed physicochemical descriptors  (US public domain)
fetch_pulse.ts    Pulse substance table, via a         (Apache-2.0)
                  dependency-free XLSX reader
parse_spl.ts      openFDA section 12.3 prose, as a     (US public domain)
                  cross-check, never as an override
normalise.ts      pKi→nM, L/kg→L, mL/min/kg→L/min,     (unit-tested, 24 tests)
                  two-compartment inversion
emit.ts           merge with per-field provenance
report.ts         docs/MISSING_CONSTANTS.md
```

Where a number could not be sourced it is `null`. A null contributes **zero** to the
engine, renders as an em-dash in the interface, and appears in
[`docs/MISSING_CONSTANTS.md`](docs/MISSING_CONSTANTS.md) — which also lists every
receptor interaction the model knows exists and deliberately does not simulate.

A wrong number that looks right is worse than a missing one, because it teaches
something false with full confidence.

The cross-check earns its keep. Filtering the label parser down to sentences that
describe *this* body — adult, normal organ function, the route being simulated — took
six reported disagreements to one, and the one that survived was real: the terminal
half-life calculation was reading a three-compartment drug's second phase and calling it
the last one, reporting fentanyl at 52.6 minutes against a published 219. Five false
alarms had been hiding it.

**Every candidate drug was checked against the GtoPdb cache before being added.** A
drug with no sourceable affinity and no sourceable pharmacokinetics renders as a row of
em-dashes and teaches nothing, so the set is what could be sourced rather than what could
be named. Where a drug's real mechanism has no published human affinity — amiodarone at
hERG, metformin at AMPK, omeprazole's covalent proton-pump binding — the effect is
carried by a cited direct effect and `MISSING_CONSTANTS.md` says exactly why the receptor
list is empty. Sixteen of the eighty-nine are in that position, and each one explains
itself.

**Controlled substances are modelled pharmacologically.** THC, methamphetamine, MDMA,
cocaine, nicotine and ethanol are in the set because their pharmacology is taught in every
curriculum and because their toxicity is the educational content — a methamphetamine
overdose produces the hyperthermia, tachycardia and lowered fibrillation threshold it
really produces, emerging from occupancy rather than from a script. Reference amounts are
exposures from published human laboratory studies, cited and labelled as such. There is
no usage guidance anywhere in the application, and the interface says plainly why each
compound is present.

Full attribution and licence terms: [`CREDITS.md`](CREDITS.md).

---

## The rendering architecture

Fifteen nested translucent organs is normally the hardest problem in a project like
this. It is not a problem here, because of what the aesthetic actually is: the
background is light, the tissue is *darker* than it, and overlaps get more saturated.
That is absorption — tinted glass on a bright backdrop — not emissive glass.

Absorption is multiplication, and multiplication is commutative:

> **Multiply blending is exactly order-independent. Not approximately.**

Per-channel transmittance `T = exp(−σd)` composited by multiplication gives
`T₁·T₂·…·Tₙ = exp(−Σσᵢdᵢ)`, so the product *is* Beer–Lambert integrated through the
whole stack. Zero render targets, zero composite passes, zero sorting.

`tests/render/order-independence.test.ts` proves it: it rasterises the real organ
geometry on the CPU, shuffles the draw order with a seeded PRNG, and asserts the
framebuffers are bit-identical. It also asserts the *bucket boundary* matters —
multiplication does not commute with addition — so the guarantee cannot be misread.

Details, including why the tone curve is not ACES and why `OutputPass` was removed,
are in [`docs/DECISIONS.md`](docs/DECISIONS.md). The measurement that established the
blend mode in the first place — background ratios at one, two and four overlap depths,
constant under multiplication — is in
[`docs/VISUAL_AUDIT.md`](docs/VISUAL_AUDIT.md) §2, along with the extracted token set.

---

## Layers

```
src/
  sim/       LAYER A   pure TypeScript. No DOM, no three, no React, no Math.random
  render/    LAYER B   three.js only. Reads snapshots, never writes sim state
  ui/        LAYER C   React + CSS Modules. HUD only; never touches the canvas
  data/      LAYER D   JSON + types. Zero logic
  bridge/              snapshot schema, Comlink setup, SharedArrayBuffer ring
```

The boundaries are ESLint rules, not conventions — added before the first module was
written, because a layer violation is not discovered, it is accumulated.

The contract is a `SimSnapshot` at 20 Hz plus a 250 Hz `Float32Array` ring for the
waveforms, and discrete `SimIntent` messages in the other direction. Never a direct
state write. Without cross-origin isolation the ring degrades to a transferred chunk
every 50 ms, and the footer says so.

---

## Tests

```
tests/render/order-independence.test.ts   the blend guarantee, on real geometry
tests/render/shader-mirror.test.ts        keeps the GLSL and its TS mirror honest
tests/sim/determinism.test.ts             same seed + same intents = same bytes
tests/sim/homeostasis.test.ts             24 simulated hours, no drift
tests/sim/step-response.test.ts           haemorrhage, and the shape of the reflex
tests/sim/renal.test.ts                   the autoregulation cliff and its feedback
tests/sim/arrest.test.ts                  CPR, defibrillation, and asystole
tests/sim/gi.test.ts                      transit, glucose, and the fat effect
tests/sim/waveforms.test.ts               rate agreement, morphologies, the ring
tests/pharma/normalise.test.ts            every unit conversion
tests/pharma/pharmacology.test.ts         golden tests against each drug's citation
tests/pharma/epinephrine.test.ts          the Phase-3 definition of done
tests/perf/budget.test.ts                 the 2 ms tick budget and 300x headroom
tests/pharma/routes.test.ts               twelve routes, dose bounds, preview accuracy
tests/data/provenance.test.ts             every number has a source
```

`tests/pharma/routes.test.ts` carries the two guarantees that make the dose control
trustworthy: that the bound is enforced in the worker and survives a forged, negative
or `NaN` multiplier, and that the plasma curve the control draws agrees with the curve
the engine actually produces, to within 10% on peak across five drug-route pairs.

The 24-hour homeostasis test takes about four minutes and is worth every second of
it: it found a slow fluid leak that nothing else could see, and the fix was the
interstitial compartment the model was missing.

---

## Guardrails

- `NOT FOR CLINICAL USE` is in the page title, permanently in the footer, and in a
  first-run modal that names the model's major limitations specifically rather than
  waving at them.
- **There is still no dose input field.** Every administration names a preset declared
  in the generated data, and the worker *rejects* an intent whose amount is not a
  declared preset for that drug and route.

  What the interface adds on top is a **bounded multiplier**: 0.1x to 10x of that cited
  reference, clamped in the worker rather than in the component that draws the slider.
  You still cannot express an absolute dose, because the only two things the interface
  can send are *which cited dose* and *times what* — and the control never shows an
  amount without showing what it is a multiple of, with the source one tap away.

  The distinction is the point. A free mg/kg field is a prescribing interface: the
  number that comes out of it is transcribable onto a drug chart and carries no context.
  "0.4x the labelled adult dose" is a simulation parameter. Same exploratory power,
  and it cannot be mistaken for advice.
- Every metric has a text equivalent; colour is never the only signal for a condition
  tag; `prefers-reduced-motion` freezes the organ pulse and leaves the numbers live.

---

## Further reading

| | |
|---|---|
| [`docs/MODEL_LIMITATIONS.md`](docs/MODEL_LIMITATIONS.md) | every approximation, by system |
| [`docs/MISSING_CONSTANTS.md`](docs/MISSING_CONSTANTS.md) | generated: every null, and why |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | the architectural decision records |
| [`docs/ENDOCRINE.md`](docs/ENDOCRINE.md) | the hormone model and its open loops |
| [`docs/VASCULAR.md`](docs/VASCULAR.md) | the vessel tree and how it fits the blend architecture |
| [`docs/VISUAL_AUDIT.md`](docs/VISUAL_AUDIT.md) | the reference-screenshot measurements |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | what this could become, and what to build next |

---

## Where it could go

[`docs/ROADMAP.md`](docs/ROADMAP.md) argues that CORPUS is not a patient simulator and
should not become one — a patient simulator asks *what would you do* and grades you;
this asks *what happens if* and has no correct answer, only consequences — and lists
twenty-three features that follow from that, plus an honest audit of where the
interface and the rendering are not yet finished.

The short version of what to build next: **a second body**. Everything else on the list
makes the model deeper; a second body makes it an instrument, because it turns every
question from "what does this do" into "what does this do compared to that". The
determinism guarantee, the pure state vector and the worker isolation were all built
for it already.

---

## Status

Phases 0–7 of the specification are implemented, with real meshes deferred: organ
geometry is procedural, and `tools/prep-assets/clean_organ.py` implements the
voxel-remesh → smooth → decimate pipeline for when real meshes are chosen. The
share-alike decision that choice forces is recorded in `CREDITS.md` **before** any
asset enters the repository, not after.
