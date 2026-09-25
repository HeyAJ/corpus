# DECISIONS — architecture decision record

Each entry records a decision, the alternatives that were rejected, and why. Where a
decision departs from `CORPUS_MASTER_PROMPT.md`, that is stated explicitly and the
reasoning is given, per spec §13: *"If something in this spec is wrong,
physiologically or technically, say so and propose the correction."*

---

## ADR-001 — Four strictly separated layers, enforced by ESLint from day one

**Decision.** `src/sim` is pure TypeScript with no `three`, no React, no DOM, no
stylesheets. `src/render` reads snapshots and never writes simulation state.
`src/ui` dispatches intents and never touches the WebGL canvas. `src/data` has zero
logic. The boundaries are enforced by `no-restricted-imports` overrides in
`.eslintrc.cjs`, added before the first module was written.

**Rejected:** enforcing by convention and review. Layer violations are not
discovered, they are *accumulated* — one `import * as THREE` in a physiology file
and the simulation can no longer run headlessly, which silently deletes the
determinism test, the homeostasis test and the pharmacology golden tests along with
it. The rule is cheap; retrofitting it is not.

**Consequence.** `Math.random` and `Date.now` are also banned inside `src/sim` by
`no-restricted-properties`, because either one makes the run non-reproducible.

---

## ADR-002 — Multiply-blend Beer–Lambert absorption instead of OIT

**Decision.** Organs render in two commutative buckets: absorption shells with
`blendSrc: DstColorFactor, blendDst: ZeroFactor` (multiply), and fresnel rims with
additive blending. Both have `depthWrite` and `depthTest` off. No render targets, no
composite pass, no sorting.

**Rejected:** weighted-blended OIT, depth peeling, sorted alpha. All three solve a
problem this aesthetic does not have. The reference look is *tinted glass on a
bright backdrop*: the tissue is darker than the background and overlaps get more
saturated, which is absorption, not emission. Absorption is multiplication,
multiplication is commutative, and therefore the compositing is **exactly**
order-independent rather than approximately so. Per-channel transmittance
`T = exp(−σd)` composited by multiplication gives `T₁·T₂·…·Tₙ = exp(−Σσᵢdᵢ)`, so the
product *is* Beer–Lambert integrated through the whole stack.

**Evidence it is the right reading of the reference.** `docs/VISUAL_AUDIT.md` §2
measures the background at three overlap depths: one layer, two layers and four
layers give per-layer ratios that are constant under *multiplication*, not under
addition. The absorption density in `OrganSet.ts` is calibrated against those three
measurements and reproduces all three.

**What the tests actually guarantee.** `tests/render/order-independence.test.ts`
rasterises the real organ geometry on the CPU with three's `Raycaster`, shuffles the
organ order with a seeded PRNG, and asserts the framebuffers are bit-identical at 8
bits per channel and agree to 1e-12 in float64. Exact float64 equality is *not*
asserted, because floating-point multiplication is commutative but not associative;
claiming otherwise would be claiming something untrue of IEEE-754.

**Correction discovered by that test.** Order independence holds **per bucket**.
Multiplication does not commute with addition, so the boundary between bucket 1 and
bucket 2 is the one ordering that matters. The first version of the test interleaved
an absorption and a rim fragment per hit and failed with a 0.42 discrepancy. The
renderer was always correct — every shell is at `renderOrder` 10 and every rim at 20
— but the distinction is now explicit in `shaderMath.ts`, and a test asserts that
interleaving *does* differ, so "order-independent" can never be read as "order never
matters".

---

## ADR-003 — The ECG oscillator sub-steps at dt/5, not dt/4

**Departs from spec §4.1**, which suggests `dt/4`.

**Decision.** `ECG_SUBSTEPS = 5`, giving an internal rate of 500 Hz, and the 250 Hz
waveform ring is tapped every second sub-step.

**Why.** `dt/4` gives 400 Hz internally, and 400 Hz does not divide evenly into the
250 Hz output the spec also requires — every output sample would land on a
resampling boundary with sub-sample jitter. `dt/5` is both *finer* than the spec asks
and makes the output an exact 2:1 decimation. `tests/sim/waveforms.test.ts` asserts
the tap emits exactly `seconds × 250` samples.

---

## ADR-004 — The circulation is sub-stepped at dt/5 as well

**Decision.** `CV_SUBSTEPS = 5` inside the fixed 10 ms physiology step.

**Why.** The mitral and tricuspid time constant is `R_valve × atrial compliance` ≈
24 ms. Forward Euler at 10 ms sits at the edge of stability for that, and a valve
that rings is a valve that produces a wrong stroke volume. This is an integration
detail *inside* the spec's fixed timestep; the contract with the rest of the system
is unchanged.

**Bonus.** The sub-step grid is shared with the ECG, so the 250 Hz arterial pressure
channel gets a real pulse contour rather than one value held for 10 ms.

---

## ADR-005 — The reference's "health %" becomes SpO₂

**Departs from the reference product, not from the spec.**

The reference HUD's first row shows a percentage (`69.4 %`, `61.5 %`, `65.4 %`) that
is not ejection fraction — EF appears separately on the same screen — and that
degrades far more slowly than EF during arrest. It reads as a composite "health
score" with no stated definition.

**Decision.** That row shows **SpO₂**, which is a real, computed, single-number
readout.

**Why.** Spec §0.4 forbids inventing a physiological number. A composite index with
no definition is exactly that, and it would be the *first* number a user reads.

---

## ADR-006 — The receptor panel sorts by live occupancy

**Follows spec §8.5 over the reference.** The reference sorts by target class (TAAR
at 65 % occupancy sits below DAT at 5 %). Occupancy-descending puts the thing that
is happening at the top, which is more useful and does not change the look. A 500 ms
transform transition makes rows slide rather than teleport.

---

## ADR-007 — `ec50Occupancy` encodes receptor reserve

**Decision.** The occupancy at which a receptor's downstream effect is half-maximal
is a few per cent for heavily amplified GPCRs, not 0.5. `baselineTone` is on the same
scale.

**Why this is not a fudge.** GtoPdb publishes *binding* affinities. For amplified
GPCR signalling those are not functional potencies: adrenaline's β1 binding Ki is
4467 nM while its functional EC₅₀ for inotropy is nanomolar, because occupying a few
per cent of the receptors saturates the response. That is receptor reserve
(Goodman & Gilman ch. 3; Rang & Dale ch. 2, "spare receptors").

**What it looked like when this was wrong.** 1 mg of intravenous adrenaline — a
cardiac-arrest dose — moved systolic pressure by nine millimetres of mercury.

**Why `baselineTone` had to move with it.** Resting plasma noradrenaline is about
1–2 nM against a micromolar β1 Ki, so resting occupancy really is fractions of a per
cent. Keeping it there is also what lets a pure antagonist do anything at all: a
β-blocker has a resting effect precisely because there is a small resting occupancy
for it to displace.

---

## ADR-008 — Central receptor effects are gated by blood–brain barrier access

**Decision.** Each receptor declares a `centralFraction`; each drug carries a
`bbbPenetration` derived from the Pulse substance table's logP. A ligand's
contribution to a receptor's activation is scaled by
`1 − centralFraction × (1 − bbbPenetration)`.

**Why.** α2 has opposite effects depending on location: central presynaptic α2 causes
sympatholysis and sedation, peripheral postsynaptic α2 causes vasoconstriction.
Circulating catecholamines do not cross the blood–brain barrier, so modelling α2 as
one receptor with the central effect made intravenous adrenaline produce central
sympatholysis that cancelled its own pressor response.

**Honesty about the mapping.** `penetration = clamp((logP + 1) / 4)` is a coarse
monotone rule, not a measured permeability, and every emitted value says so. A drug
with no logP gets full access rather than a silent assumption of exclusion, and the
gap is listed in `MISSING_CONSTANTS.md`.

---

## ADR-009 — CPR is a thoracic pump, not a scripted stroke volume

**Decision.** Each compression raises intrathoracic pressure; blood moves through
the valve equations that already exist. Compression rate, volume status and vascular
tone therefore all feed into the output.

**Two corrections this forced.**

1. The compression pressure is applied to the intrathoracic *great vessels* as well
   as to the heart, at `cprArterialTransmission` and `cprVenousTransmission`. Applying
   it to the heart alone made CPR an implausibly good pump — a coronary perfusion
   pressure of 69 mmHg, about four times what optimal manual compressions achieve.

2. Coronary perfusion pressure is computed from the per-beat **minimum** of both
   aortic *and* right atrial pressure. Using a per-beat aortic minimum against an
   instantaneous right atrial pressure gave wildly swinging and even negative values,
   because a compression raises right atrial pressure by the full intrathoracic
   pressure at that instant. Coronary flow happens *between* compressions; the
   clinically measured quantity is diastolic-to-diastolic.

**Unit correction in the spec's own figure.** Spec §9 says compressions inject "a
stroke volume ≈ 25–30 % of normal". The well-supported figure is 25–30 % of normal
cardiac **output**. At 110 compressions per minute against a resting 66 beats per
minute, that is about 13 mL per compression — 17 % of a normal 78 mL stroke volume.
Reading it as 27 % of stroke volume doubles the delivered flow and produces coronary
pressures no manual CPR achieves. `tests/sim/arrest.test.ts` pins the output figure
and says why.

---

## ADR-010 — VF quivers, it does not pump

**Decision.** `mechanicalGain('vfib') = 0.004`.

**Why so small.** Fibrillating myocardium is not weakly contracting myocardium; it
is contracting out of phase with itself, so regional shortening cancels and chamber
volume barely changes. That distinction matters numerically, because *any* periodic
elastance swing against competent valves pumps — it is exactly how the CPR thoracic
pump works. At the initial value of 0.03 the model produced 0.86 L/min of cardiac
output in ventricular fibrillation, which is more than some patients have in
cardiogenic shock.

---

## ADR-011 — An interstitial compartment, added because a test demanded it

**Decision.** `src/sim/systems/fluids.ts` models an interstitial reservoir that
exchanges with plasma over a 30 min time constant, with obligate intake balancing
obligate output at baseline.

**Why it exists.** The 24-hour homeostasis test showed circulating volume falling
from 5000 mL to 3949 mL over a simulated day. The cause was not an integrator bug:
the kidney was correctly removing 1.4 L of urine and nothing was putting any water
back. The body was accurately dying of thirst.

**Why this is the right fix rather than a correction factor.** Plasma volume in a
real body is defended by the interstitium. Adding the compartment that prevents the
drift in reality also buys transcapillary refill after haemorrhage and a mechanism
for diuretic-induced hypovolaemia, both of which are now tested.

**Approximation, stated.** The body drinks to thirst rather than on a schedule:
obligate intake is a constant that matches obligate output at baseline.

---

## ADR-012 — Temperature is defended, not merely equilibrated

**Decision.** Heat loss scales with `1 + regulatoryGain × (T − 37)`, and the loss
coefficient is solved so 37.0 °C is an exact steady state.

**Why.** With a fixed loss coefficient the model has an equilibrium but no *set
point*: core temperature settled at 36.0 °C and drifted 0.6 °C across a simulated
day. A real body sweats above the set point and vasoconstricts below it. Adding the
proportional term is both more correct and what makes the 24-hour test pass.

---

## ADR-013 — ChEMBL was attempted and is not used

Spec §5.6 names ChEMBL as the secondary affinity source when GtoPdb is thin. It was
tried: `https://www.ebi.ac.uk/chembl/api/data/...` returned HTTP 500 for both the
molecule search and the activity endpoints at build time. Rather than ship an
adapter that is always skipped, the pipeline uses GtoPdb (Tier 1) plus the Pulse
pharmacodynamic block (Tier 2) — which is precisely what spec §5.6 says Pulse is
for — and `MISSING_CONSTANTS.md` records which receptor-level affinities are absent
as a result.

---

## ADR-014 — The Pulse PD block fills the gaps GtoPdb leaves, without double counting

**Decision.** A Pulse `EC50` + modifier block is applied **only** for effect targets
that the drug's own receptors do not already reach. `coveredTargets` is computed once
at load.

**Why it is needed.** GtoPdb publishes no GABA-A affinity for propofol or midazolam.
Without the Pulse block, two of the most important drugs in the set would do nothing
at all — and inventing a Ki is forbidden.

**Two translations, both approximations, both named.** Pulse modifies systolic and
diastolic pressure directly because its model exposes them as targets; ours computes
them from a circuit, so the mean modifier is routed to systemic resistance and the
pulse-pressure component to contractility. Recorded in `MODEL_LIMITATIONS.md`.

---

## ADR-015 — The tone curve is a highlight roll-off, not ACES

**Departs from spec §6.6**, which says "ACES-ish tone map".

**Decision.** An identity below 0.86 linear and a smooth shoulder above it.

**Why.** ACES compresses highlights hard, and this entire composition *lives* in the
highlights: the background is 0.86 linear and the tissue only a little below it.
Running it through ACES collapsed a 13 % transmittance difference into five 8-bit
levels and the body nearly vanished. This was found by screenshotting the running
app, not by reasoning.

**Related.** `OutputPass` was removed. The dither pass does its own linear-to-display
conversion; `OutputPass` after it applied a second sRGB encode and washed the frame
out.

---

## ADR-016 — No new dependencies, including for XLSX and ZIP

The Pulse substance table ships as `data/Data.xlsx`. Rather than add a spreadsheet
library, `tools/ingest/xlsx.ts` reads it directly: an .xlsx is a ZIP of XML and Node
already has raw-deflate in `zlib`.

**The subtlety worth recording**, because it silently corrupts data rather than
failing: a worksheet is full of self-closing cells (`<c r="AM8" s="89"/>`). A naive
`/<c r="..."[^>]*>(.*?)<\/c>/` regex skips past them and attributes a later cell's
value to an earlier cell's address, shifting entire columns. The first reconnaissance
pass hit exactly this and reported epinephrine's molar mass as 712.

Only `@types/node` was added beyond the §2 stack, and only as a build-time type
dependency for `tools/`.

---

## ADR-017 — `generatedAt` records the upstream version, not a timestamp

Spec §5.6 requires re-running the pipeline to be idempotent and to diff cleanly
against the committed `data/*.json`. A timestamp would make every run produce a diff
and would destroy the only signal that matters, which is whether the upstream data
changed. The GtoPdb version string is recorded instead.

---

## ADR-018 — Drug data is curated *input* to the pipeline, not pipeline *output*, where it must be

Spec §5.6 is emphatic that the pipeline is the deliverable. It is: `tools/ingest/`
fetches, normalises, merges and emits with per-field provenance, and `data/*.json`
is regenerated from scratch by `npm run ingest`.

Two of its inputs are hand-written, and could not be otherwise:

- `receptor_registry.ts` — the effect vectors. GtoPdb can tell you that a ligand
  binds β1 and how tightly. It cannot tell you that β1 occupancy raises cardiac
  contractility, because that is physiology, not a binding assay. Each vector carries
  a textbook citation.
- `pk_literature.ts` — compartmental volumes. Pulse is a PBPK engine and uses tissue
  partition coefficients, so it has no `V1`. Each entry states the quantity, the
  citation, and for a derived value exactly how it was derived.

Both are inputs in the same sense that a target list is an input. Neither contains a
number without a citation.

---

## ADR-019 — Preset doses are a structural guardrail, not a UI convention

There is no dose input field anywhere in the application, and the worker **rejects**
an `ADMINISTER` intent whose amount is not a declared preset for that drug and route
(`engine.ts`, asserted in `tests/pharma/pharmacology.test.ts`). You cannot type a
mg/kg figure into CORPUS because there is nowhere to type one and nothing would
accept it if there were.

---

## ADR-020 — Tests assert against the literature, not against the engine

The pharmacology golden tests check each drug's terminal half-life against the range
its own cited sources give. A drug that cannot reproduce its own citation fails the
build. That is the difference between a model that is self-consistent and one that is
right.

The same principle produced the three-compartment terminal half-life solver: the
two-compartment quadratic gave fentanyl 53 minutes against a published 3–8 hours,
because the slow peripheral compartment is exactly what produces the long tail.

---

## ADR-021 — A Pulse ventilation modifier acts on drive, not on breathing pattern

**Decision.** Pulse's `RespirationRateModifier` and `TidalVolumeModifier` are combined
into a single modifier on `resp.drive`. `bronchodilation` and `neuromuscularBlock`
stay on `resp.tidalVolume`.

**Why.** `resp.rate` and `resp.tidalVolume` are applied where ventilatory drive is
split into a rate and a depth — *downstream* of the chemoreceptor loop. Push on them
and the loop simply undoes it: rate falls, alveolar ventilation falls, PaCO₂ rises, the
central chemoreceptor raises drive, and the rate returns to where it started. Measured
result before the fix: 2 mg of midazolam produced a respiratory trace byte-for-byte
identical to giving nothing, with a −0.17 modifier sitting on the bus the whole time.
Midazolam is the only drug in the set with no receptor targets at all, so it had no
other path to physiology and was, in effect, an inert button.

**The rule is central drive versus mechanical capacity**, and the receptor data already
followed it — `mu` pushes `resp.drive` −0.85 and `gabaa` −0.45, while `beta2`, `m3` and
`h1`, which really are airway calibre, push `resp.tidalVolume`. The Pulse bridge was the
only place that disagreed. A bronchodilator changes airway calibre and a paralytic
changes whether the muscles can answer the drive — a paralysed patient has enormous
drive and no ventilation — so routing either through drive would model them backwards.

**No number was invented.** Minute ventilation is rate × depth, so a drug that
multiplies rate by (1+a) and depth by (1+b) multiplies ventilation by (1+a)(1+b). That
product is the drive modifier, derived from Pulse's own two figures. The model's
existing 0.55/0.45 exponents split it back into a rate and a depth.

**ADR-014 still applies and does the rest of the work.** Because the modifier now lands
on `resp.drive`, the `coveredTargets` check excludes it for every drug whose receptors
already reach drive — fentanyl, morphine and naloxone through `mu`, propofol through its
cited direct effect. Those four are unchanged. The fix reaches exactly the drug that
needed it.

**What it looks like now.** Depressing drive does not abolish the chemoreflex, which is
the physiologically important part: ventilation still settles where it must to clear
metabolic CO₂, but it settles at a higher PaCO₂. Hypercapnia, not a stopped clock, is
the signature of opioid and benzodiazepine respiratory depression, and it is what
`tests/sim/integrity.test.ts` now asserts — against a no-drug control run, because
breathing has a natural ripple of a few per cent and a bare threshold would be either
too loose to catch a real effect or too tight to survive noise.

---

## ADR-022 — The engine settles into its own resting state before t = 0

**Decision.** `Engine` starts from a state obtained by running the model 30 simulated
seconds from `createInitialState` and winding the clock back to zero. The result is
computed once per process, on a fixed seed, and cloned for every engine.

**Why.** `createInitialState` writes down a *plausible* resting body — 72 bpm, 92 mmHg,
both reflex limbs at 0.5 — but not this model's own equilibrium. The baroreflex afferent
is a sigmoid, so a pulsating pressure does not average to the sigmoid of the mean, and
the true fixed point sits nearer 66 bpm at 94 mmHg. Started off it, the loop had to
travel, and with a pure transport delay and a 7 s sympathetic lag it overshot badly:
heart rate fell to 41 bpm within four seconds, mean pressure reached 108 mmHg, and the
rhythm classifier reported **sinus bradycardia**. Every session opened on a bradycardia
alarm made entirely of startup transient, and every test read its "resting" baseline off
the same swinging number.

**Why not just write 66 bpm into the initial state.** Because 66 is not a number anyone
measured. It is an *output* of constants that already carry citations, and hard-coding it
would smuggle an uncited physiological constant into `state.ts` on the authority of a
debugger. Deriving it at runtime keeps the provenance rule intact. This is the same
reasoning as ADR-018: curated input stays input, and anything the model can compute, the
model computes.

**The fixed settle seed is not cosmetic.** A cache filled by whichever engine happened to
be constructed first would make the resting state depend on test ordering — exactly the
silent non-determinism this engine exists to rule out. Noise after t = 0 is driven by the
caller's own seed as usual.

**Cost.** 30 s of warm-up is about 460 ms, which is why it is cached rather than run per
engine; a single test file builds dozens. `structuredClone` round-trips `SimState`
bit-exactly, verified by evolving an original and a clone in lockstep.

---

## ADR-023 — A drug whose principal action has no Ki gets a cited direct effect, not a guessed Ki

**Decision.** Metoclopramide carries a cited `gi.motility` direct effect. Its D2 affinity
is not invented.

**The bug it fixes.** The `d2` receptor in this model already carries `gi.motility` −0.3,
so D2 blockade *is* the prokinetic path and it was wired correctly the whole time. But
GtoPdb publishes no human D2 affinity for metoclopramide, so that target was dropped at
ingestion and the only surviving target was 5-HT₃ at 596 nM — which is constipating.
The drug was therefore modelled **backwards**: a behavioural sweep measured 10 mg given
with a meal in the stomach leaving *more* in it than no drug at all, when accelerating
gastric emptying is its principal clinical use.

**Why not add the Ki.** Because nobody measured it, and inventing one would put a
fabricated number into the receptor panel where every other number is sourced. A direct
effect is the honest shape: it is labelled as a calibrated gain rather than an affinity,
it carries the label citation, and `targetsNote` says in the interface why the receptor
panel shows only 5-HT₃ for this drug. This is the same judgement as the propofol apnoea
effect (see the manifest) — Pulse had propofol's respiratory modifier *positive*, so an
induction agent did not stop anyone breathing until a cited direct effect was added.

**The general rule.** A missing number is allowed to make a drug do *less*. It is not
allowed to make a drug do the *opposite*. When the only surviving mechanism points the
wrong way, the model is not merely incomplete, it is teaching something false, and that
is worth a labelled approximation.

**How it was found.** Not by a test. `tests/sim/inert-sweep.ts` gives every drug its
first declared preset and measures whether any signal moves against a no-drug control.
Nothing in the data was wrong — every field populated, every citation resolving — and
the drug still did the opposite of the right thing. That class of bug is only visible
from behaviour.

---

## ADR-024 — Cerebral flow follows perfusion pressure, and the chemoreflex saturates

**The symptom.** A body in cardiac arrest went on breathing — twelve breaths a minute at
a normal tidal volume, indefinitely, with no pulse. A simulator that shows a pulseless
patient ventilating calmly teaches the most important recognition cue in an arrest
backwards: "not breathing normally" is a criterion for starting CPR.

**Three defects, stacked.** Each was invisible on its own and none would have been caught
by a data check.

1. **Respiratory drive had no perfusion term.** `r.driveScale` existed in the state,
   was initialised to 1, was read in exactly the right place, and was never written by
   anything in the codebase — a hook left for this job and never connected. Now driven
   from cerebral perfusion using the cited syncope threshold the neuro system already
   uses, so no new constant. Keyed to perfusion rather than to `rhythm === 'asystole'`,
   because profound shock fails the same way by the same route.

2. **The chemoreflex was unbounded**, and this is why the gate alone did nothing. Both
   limbs were linear ramps, so a PaCO₂ of 52 manufactured 30 L/min of drive and the two
   together could ask for more than fifty. *An unbounded reflex cannot be overcome by
   anything multiplicative* — not a drug, not a perfusion gate — because whatever
   fraction you multiply by, the reflex climbs until the product is back at baseline.
   Drive was being scaled by 0.14 and the reflex was generating fifty. Now a saturating
   hyperbola against a cited ceiling, so the slope near the origin is still the published
   one: it bends, it does not corner.

3. **Cerebral flow was computed from arterial pressure, not perfusion pressure.** This
   was the root cause. Flow through any bed is driven by the pressure *difference* across
   it. In arrest the arterial pressure decays *toward* the venous pressure, so the
   gradient collapses while the absolute number is still 12 mmHg — which left cerebral
   flow at 7.5 % of normal, enough to sustain a normal respiratory rate once the
   unbounded reflex was multiplied through it. As a gradient it is 0.6 %. This model has
   no intracranial pressure, so central venous pressure is the proxy, and the comment
   says so.

**CO₂ narcosis came with it.** The stimulant and the narcotic are the same molecule at
different tensions. Without the narcotic limb the model says the more CO₂ you retain the
harder you breathe, for ever, which gets the endgame of any hypercapnic respiratory
failure wrong. Cited to GH14: depression begins near 80 mmHg, drive is gone by 120.

**Measured, arrest at t = 30 s:**

| | before | after |
|---|---|---|
| cerebral perfusion pressure | (not computed) | 88 → 3.2 mmHg |
| cerebral flow fraction | 0.075 | 0.006 |
| respiratory rate | 11.6 /min | 1.7 /min |
| tidal volume | 487 mL | 103 mL |
| PaCO₂ | 43.9 | 107 |

Slow and shallow, which is what agonal respiration is — rather than the calm twelve a
minute it showed before.

**What is still not right.** The gasping plateaus rather than ceasing; real agonal
respiration fades over minutes and stops. Recorded in `MODEL_LIMITATIONS.md`.

## ADR-025 — A receptor declares how a drug's occupancy becomes activation

**Cited from `pd.ts` and the registries since it was introduced, and written down here
on 2026-09-25 because it never had been.** Every receptor carries an `activationModel`,
and the same occupancy means three different things under the three values:

1. **`endogenous-agonist`** — the receptor has a resting tone from its own ligand.
   Occupancy displaces that tone, and a bound ligand contributes `max(0, IA)` of full
   activation, where `intrinsicActivity` is efficacy relative to the endogenous agonist.
2. **`transporter`** — the readout is synaptic transmitter. An inhibitor and a releaser
   both raise it, so both signs of IA point the same way.
3. **`inhibition`** — an enzyme or channel with no tone to displace. The effect vector
   is written for the INHIBITED state, and IA is a direction, not an efficacy.

Getting the model wrong inverts a drug, which is why it is the first field to get right
on a new entry.

**Amended 2026-09-25: the floor at zero is per bound receptor, not per receptor.** The
engine used to add `occupancy x IA` and clamp the total, so an inverse agonist (IA = -1)
subtracted a whole full-agonist unit for every receptor it held. At high occupancy that
is indistinguishable from the floor; at low occupancy it is wildly too strong: 12 % brain
H1 occupancy by cetirizine (the PET value) removed 80 % of histaminergic tone. A bound
receptor cannot signal below nothing, so it now removes exactly its own share of tone.
Five drugs changed (four antipsychotics at serotonin receptors, and cetirizine); the
antipsychotics kept their sedation ranking.

## ADR-026 — Blood-brain barrier penetration gates central EFFECTS, not receptors

**The symptom.** Glycopyrrolate, a quaternary amine given precisely because it stays out
of the brain, took as much consciousness away as atropine. Adrenaline sedated. A 10 mg
tablet of cetirizine, a non-sedating antihistamine, dropped consciousness to 0.35.

**Two defects.** Each drug had ONE access factor per receptor,
`1 - centralFraction x (1 - penetration)`, applied to every effect of that receptor - so
a drug that cannot cross kept a quarter of the central action and lost part of its
peripheral one. And for antagonists the factor was never applied at all, because the
tone a blocker displaces was computed from raw occupancy.

**The decision.** Every receptor effect carries a `central` flag, decided in
`tools/ingest/central_effects.ts` by target (sedation, arousal, anxiety, dependence,
seizure threshold, analgesia, respiratory drive) with explicit, argued exceptions where
the same target is central for one receptor and peripheral for another (alpha-2's fall in
resistance is brainstem sympatholysis; its insulin suppression is pancreatic). Central
effects see each ligand scaled by its penetration - including the tone it displaces -
and peripheral effects see it fully. `centralFraction` survives as a descriptive number.

**The cost.** Penetration data now matters more, and the physicochemical rule was wrong
for three more drugs, each overridden with its source: caffeine and theophylline cross
freely (labels: CSF approximates plasma), cetirizine barely does (PET: 12.6 % brain H1
occupancy at 10 mg, penetration derived as 0.14).

## ADR-027 — Slow loops are settled before t = 0, from the model's own equations

ADR-022's thirty-second warm-up settles the circulation, but two loops run on clocks of
tens of minutes to hours, and both booted out of equilibrium. The glucose–insulin loop
started at textbook basal values with hepatic output already flowing, so every body's
glucose climbed from 93 to 100 mg/dL in its first quarter hour. Cortisol started at its
daily mean at 08:00 and spent three hours climbing to the morning peak.

Both are now settled from the model's own equations rather than from typed-in numbers:
`settleGlucoseInsulin` runs `stepMetabolic` itself for twelve simulated hours with the
warmed-up effect vector frozen (so the settle cannot disagree with the step), and a
circadian hormone is seeded at the exact periodic steady state of a first-order pool
driven by a sinusoid - 17.3 µg/dL for cortisol at 08:00, which is where a 24-hour run
arrives on its own. Every hormone driver is also referenced to the model's own resting
value (osmolality, potassium), so a hormone at rest stays at the baseline its basal
secretion is solved for.

**What the 24-hour test found on the way.** The cortisol trough was being read as an
inflammatory stimulus: cortisol's anti-inflammatory effect was applied symmetrically, so
every afternoon a resting body ran a low fever, sweated, leaked plasma and was
tachycardic by 21:00. Suppression by excess is now applied only above baseline.
