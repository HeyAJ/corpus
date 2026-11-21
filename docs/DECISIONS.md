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

---

## ADR-028 — Organ interiors are data-driven atlases, and walls are glass

Selecting an organ used to show a shell with telemetry beside it. Every organ now has an
interior, and there are thirty of them, so a per-organ bespoke pipeline was never an option.

**The decision.** One atlas per organ (`src/data/anatomy/<atlas>.json`), with the same
fields everywhere: part id, label, summary, function, colour, a resting activity, a list of
weighted drives and a source. Geometry and animation sit in two render files per atlas
(`src/render/anatomy/atlas/<atlas>.parts.ts` builds the parts in a worker,
`<atlas>.detail.ts` supplies the flow streams and the per-frame animation) and
`OrganDetail.ts` shows them while the organ is selected. The Structures panel is generated
from the same JSON, so the text a person reads and the part they see cannot disagree. The two
kidneys share one atlas and so do the two adrenals; the uterus atlas is rebuilt per
gestational week. Part geometry is procedural and illustrative.

Any part with opacity below 0.98 is GLASS: it stops writing depth and is drawn after the
solid parts. Walls, capsules, lobes and lumen-bearing tubes are glass, and what they
contain is solid, so a chamber can be seen into and a stream seen inside it. Picking prefers
the nearest solid part through glass. Neighbouring organs recede while one is selected.
Stream particles are alpha-blended droplets, and arterial and venous colours come from one
shared ramp (`detail/blood.ts`) so no organ draws its own.

**Rejected.** Hand-writing each organ's panel: thirty copies of the same logic, each able
to drift from the model. Additive-blended particles: they were invisible on the pale page.
Depth-writing walls: they hid the very thing the interior exists to show. Traced anatomical
meshes: the repository deliberately has no binary assets (see `CREDITS.md`), so the
geometry is stated to be a drawing, and counts such as breast lobes or splenic follicles are
schematic.

## ADR-029 — Anatomy activity is a departure from the settled resting body

Each part's activity is `clamp01(rest + sum(weight x signal))`. If the signals were
absolute levels, a perfectly healthy resting body would light parts up, because a resting
body is not a body with every quantity at zero.

**The decision.** Signals are departures from the settled resting body. `captureAnatomyRest`
records them once at the end of the engine warm-up (ADR-022), so a resting part sits at its
JSON `rest` and anything above it means something happened. Cortisol is referenced to its
circadian expectation for the clock hour, as the hormone drivers were in ADR-027. Some
signals are legitimately non-zero at rest and are left so: night, bladder filling,
ADH and dehydration in a body that has not drunk, and the menstrual-cycle state.
`tests/sim/anatomy.test.ts` encodes this.

**Rejected.** Absolute signals with a per-part fudge: it hides, rather than states, what the
body is being compared with. Forcing every signal to zero at rest: it would erase real state
(it is night; the bladder is filling). **The cost.** The reference is the boot-time body
(male, 08:00), so a change of sex, a pregnancy or a cycle day reads its difference from that
body as activity. This is recorded in `docs/MODEL_LIMITATIONS.md` section 17.

## ADR-030 — The reproductive clock, `slowClockScale`, and a jump that is coherent

A menstrual cycle is a month and a pregnancy is forty weeks. Watching either at real
time is impossible, so `src/sim/systems/reproductive.ts` keeps a reproductive clock that
`SET_REPRODUCTIVE_LAPSE` can run ahead of real time. Two things followed.

**The kidney.** Renal acid-base compensation and creatinine run on a day-scale clock. A
pregnancy that arrives in seconds with a kidney that notices in days is an incoherent body.
`slowClockScale(s)` makes those clocks follow the reproductive clock in a female body, and
runs them at 20000x for a catch-up window of 90 s after a jump. **The side effect, stated
plainly:** a jump also corrects, at once, any metabolic acid-base disturbance that happened to
be present. Related, the kidney's compensation is now referenced to the model's own resting
PaCO2 (`resp.restingPaco2_mmHg`) rather than 40, because the 40-referenced version made a
healthy resting body drift over simulated days, which the time-lapse made visible within
seconds.

**The jump.** Plasma expansion is paced over seconds, while vasodilation, venous capacity,
the heart-rate trim and the renal vascular terms used to apply at once, so a jump to
36 weeks presented hypotension, tachycardia and renal hypoperfusion for about a minute.
The circulatory terms are now scaled by the plasma expansion actually realised, and drain
with the volume after a pregnancy ends.

**Rejected.** Running the day-scale clocks at real time (the body would be wrong for days of
simulated time). Applying the catch-up factor permanently (it would break every
non-reproductive scenario). Applying the pregnancy terms at their settled size from the first
tick: that was the bug.

## ADR-031 — The sexual response is fitted through the set point, venous tone and vasodilation, not a forced heart rate

The cited response to orgasm raises systolic and diastolic pressure and heart rate
together. The first calibration wrote heart rate directly, against a baroreflex that was
trying to slow it; mean pressure then rose above the shifted set point and the excess landed
in diastolic.

**The decision.** The response reaches the body the way exercise does: a baroreflex
set-point shift (`reflex.setpointShift`), sympathetic venous tone (`cardio.venousTone`), a
FALL in systemic resistance, with the direct heart-rate gain kept small. The reflex then
holds mean pressure at the shifted set point and supplies the tachycardia itself. At the
start of orgasm, model against cited (dSBP / dDBP / dHR): male +21.1 / +18.0 / +21.2 against
+21.3 / +18.2 / +21.0, female +11.6 / +11.3 / +19.6 against +12.3 / +10.2 / +18.8.

**Rejected.** Forcing the rate (diastolic too high). Vasodilation alone (heart rate above
200). A more negative resistance or larger venous push to cure the remaining male diastolic
error (about 12 mmHg high at the peak): it only moves heart rate out of the cited band, so
the best fit is reported rather than forced. See `docs/MODEL_LIMITATIONS.md` sections 16
and 17.

## ADR-032 — The fetus is sized by an isometric rule from the cited weight, and is not shrunk silently

The repository cites fetal WEIGHT by week and no fetal length. The fetus is therefore drawn
at a linear scale of (W(w) / W(40))^(1/3): isometric scaling, a drawing rule derived from
the cited weight and not a measured length. Before 10 weeks the weight table does not apply,
so the fetus is held at the 10-week size rather than extrapolated. It is centred in the
amniotic sac and clamped to the largest uniform scale at which it lies inside the sac. The
scale asked for and the scale allowed are both kept, so the shortfall can be reported
(`docs/MODEL_LIMITATIONS.md` section 17). The fetus stays at full density while the uterus
is selected, because it is the uterus's content.

**Rejected.** A term-sized fetus at every week: it hung out of a smaller uterus. Shrinking
the fetus to fit without saying so. Inventing a length-by-week table that the data does not
hold.

## ADR-033 — Overlays and the brain scan are honest diagrams

The nerve, hormone and scan displays are the easiest place to show a measurement that
does not exist.

**The decision.** Each is labelled for what it is. Nerve courses are derived from the vessel
centrelines and are illustrative, and impulse speed is a display constant, not a conduction
velocity; rate follows autonomic tone. Hormone arcs are a diagram, since hormones travel in
the blood, and droplet rate follows level over resting level. The brain scan is a
maximum-intensity projection of the activity index (ADR-029) through a thermal ramp, cool at
rest and warm when active, captioned "activity index, not temperature", with nothing on the
card in degrees. Hormones, Nerves and Vessels are three labelled switches, all off at start (a fourth, Activity, was added in ADR-035).

**Rejected.** A ramp that reads as a temperature or BOLD signal: neither is simulated.
Showing a conduction speed: none is modelled. Always-on overlays: they would bury the body.

## ADR-034 — The fetal heart beats at a cited mean rate, replayed

The fetal heart used to be drawn still because no cited rate was in the data. Three studies,
each read on the retrieved source, now supply one.

**The decision.** `fetalHeartRate(w)` in `src/sim/systems/reproductive.ts` returns null for a
male body, a non-pregnant woman and gestational age under 10 weeks. From 10 to 14 weeks it is
the straight line between the two Hyett (1996) means, 171 bpm at 10 weeks and 156 bpm at 14
(6903 normal singleton pregnancies). From 14 to 20 weeks it is 156 plus Ursem's (1999) slope of
-2.52 per week times the weeks since 14 (55 healthy women; the paper prints no unit, and weeks
is the only reading that is physiologically possible). From 20 weeks it is the midpoint of the
Pildner (2013) 95 percent confidence interval of the mean baseline rate for the band
containing the week (13,015 cardiotocograph tracings); the paper prints the interval and not
the mean, and the midpoint of a symmetric interval is the sample mean. The last band
continues past 42 weeks. The result is a snapshot field, `fetalHeartRate_bpm`, shown in the
Reproduction panel and as an FHR chip for the uterus and the fetus, and the fetal heart part
pulses at it with a quick contraction and a slower filling, its phase accumulated from the
rate so a change of rate never makes the beat jump. The amplitude is a display amplitude, not
a wall motion. It is not on the effect bus, because nothing in the mother consumes it.

**Why the 14-20 join is acceptable.** It is two cited numbers combined, labelled derived in the
code. It reaches 140.88 bpm at 20 weeks, and the independent Pildner band that starts there has
midpoint 141.348: they differ by less than 0.5 bpm, and a test asserts that they differ by
less than 1. Two studies of different design that meet within that margin are better evidence
than either alone.

**Why nothing is shown below 10 weeks.** No source retrieved covers 9 to 10 weeks, and
extending Hyett's line backwards would be an invented number. The fetus is drawn at its
10-week size below 10 weeks (ADR-032) for the same reason.

**Rejected.** Simulating a fetal circulation: nothing here would constrain it. Beat-to-beat
variability or accelerations: no cited model of them is in the data. Putting the rate on the
effect bus: the mother does not read it. A sine beat: a heart contracts faster than it fills.

## ADR-035 — Organ colour is a pale tint, and Activity mode is one amber ramp

The unselected organs were pink. `REST_TINT_MIX` was 0.84, so an organ's own hue was mixed
almost completely into the page-coloured shell, and the body read as one pink mass in which the
organs could not be told apart; the active tint, `ACTIVE_TINT_MIX`, was 0.5. Both are in
`src/render/organs/OrganSet.ts`.

**The decision.** The mixes are now 0.45 at rest and 0.2 when active. Three pairs were rendered
before this was chosen: 0.6 and 0.3 was still pink, 0.45 and 0.2 kept each organ's identity
without saturating, and 0.3 and 0.1 went muddy and lilac. A fourth overlay switch, **Activity**,
is off at start. While it is on, every unselected shell takes its colour from ONE sequential
amber ramp, indexed by the organ's eased engagement above its own rest
(`snapshot.anatomy.organs[id]`, which is `clamp01(1.6 x max over parts of (activity - rest))`
and was not changed). The ramp lives in `src/render/organs/activityRamp.ts` with no three.js
import so that a test and the legend can read it: 0 is #f6ece0, 0.2 #f4d8b0, 0.4 #efbd78, 0.6
#e29a3a, 0.8 #c0731a and 1 #8a4a0a. Density in Activity mode is 0.55 + 0.9 x activity, so an
engaged organ is both darker and denser. The legend, "Activity above rest", carries the ramp bar
and says in words that the colour is an index of how far each organ is from its own resting
state, not a measurement.

**Why one amber hue.** Red is already the alarm colour and the colour of arterial blood, and
blue already means venous; a red or blue activity ramp would be read as a warning or as a
vessel. A single hue also lets the eye rank organs by lightness alone. The ramp is a display
choice, not a measured quantity.

**Why tint and density, not glow.** The page is pale. An additive glow brightens toward white
and therefore vanishes on it, which is the same reason the stream particles stopped being
additive (see the anatomy notes in `CLAUDE.md`). Darkening a tint and raising the density of the
multiply-blended absorption (ADR-002) is the direction in which a pale page can show a change.

**Measured.** The liver's rendered centre luminance at activity 0, 0.25, 0.5, 0.75 and 1 was
230.3, 212.2, 185.3, 154.9 and 126.7, strictly falling, so a darker organ always means a more
engaged one.

**Rejected.** A red-to-yellow thermal ramp (it reads as temperature and as an alarm; the brain
scan already uses a thermal ramp and has to say it is not a temperature, ADR-033). Additive glow,
for the reason above.

## ADR-036 — The alarm pulse is a table from condition to organ, and an unlisted condition fails a test

A condition that fires should be visible on the body as well as in the pills, but the body must
not be lit by guesswork.

**The decision.** `src/render/organs/alarmOrgans.ts` holds two explicit tables. `CONDITION_ORGANS`
maps a condition to the organs that carry it: the heart for afib, arrest, asystole,
bradycardia, pea, tachycardia, vfib and vt; both lungs for hypoxemia, hypercapnia and
resp_depression; both kidneys for renal_failure; the brain for unconscious.
`SYSTEMIC_CONDITIONS` lists the ones that belong to no single organ and therefore light none:
hypovolemia, hypotension, hypertension, hypoglycemia, hyperglycemia, hyperkalemia, hypokalemia,
lactic_acidosis, hyperthermia and hypothermia. (`oxygen`, `glucose` and `lactate` appear in
`transport.ts` as blood-channel ids and are not conditions.) A warn or critical condition makes
its organs pulse at about 1 Hz, mixing 0.75 toward `ALARM_HEX` (#c8433a, copied from
`--severity-critical-bg`) with a density gain of 0.6; a `watch` condition never pulses, and
under reduced motion the pulse is a steady 0.6. The 1 Hz is a display rhythm, not the heart rate,
and a tachycardic heart does not pulse faster. `viewer.alarmOrgans` lists the organs pulsing now.

**The guard.** `tests/render/activity.test.ts` reads `conditions.ts` and fails if a condition id
is in neither table. A new condition therefore cannot ship silently unlit, and cannot be put on
an organ without someone deciding that it belongs there.

**Rejected.** Pulsing the whole body for a systemic
condition: hypotension has no single organ, and a pulsing body would hide the one organ that
is failing. Defaulting an unlisted condition to some organ: that is a plausible guess, and the house
rule is that a documented absence beats one.

## ADR-037 — The glass body outline is fitted to the model's own organs and vessels

The organs float in empty space, and a visitor cannot tell which way up they are or where the
body ends.

**The decision.** `src/render/body/outlineModel.ts` is a pure signed-distance model built
from THIS body: a loft of ellipses, one per 12 mm of height, fitted to the organ vertices and
vessel centreline points (`organSamples.ts`), with the arms and legs as capsule chains along the
subclavian and brachial and the femoral and popliteal centrelines, joined by a smooth union and
checked by an enclosure guard that evaluates the field at every point it is meant to enclose
(a 6 mm margin).
`outlineMesh.ts` polygonises it (15k triangle cap, per-vertex fade), `BodyOutline.ts` owns the
scene object, and `src/render/materials/BodyGlass.ts` draws it as a Fresnel-alpha ink. It is
built in the geometry worker, rebuilt at most every 500 ms and one at a time, fades to 0.33
while an organ is open and is never picked. Margins are display choices: 0.03 m of skin on the
trunk, 0.014 m on the head and neck. In a pregnancy the abdomen follows the week only through
the uterus model's own `gravidBody(weeks)`; no growth curve was added. The trunk loft ends at the
pelvic floor; the external genitalia have their own blob; the thighs are separate capsule chains
offset outward so that their outer edge meets the hip's; the legs fade over the lower half of the
femoral centreline with a linear ramp.

**Why fitted.** Typed-in body proportions would be a second description of the body that
disagrees with the first one wherever the organ layout differs from them, and would then cut
through organs. Fitting to the model's own geometry means the outline cannot contradict it, and
the enclosure guard checks it (`tests/render/body-outline.test.ts`).

**The floor shadow.** A contact shadow under the figure was tried and removed. A torso that
dissolves at mid-thigh touches no floor, and the shadow read as a smudge about 4 cm below the
fade.

**Rejected.** A smoothstep leg fade: it was nearly flat at its top. The outline has no interface
switch; it is always on.

## ADR-038 — A readability contract: one type scale, ink tokens, WCAG AA, 44 px touch areas

The interface had grown 16 to 18 different font sizes, text as small as 9 px rendering at 2:1
contrast, and controls too small to tap. Each panel had been right locally.

**The decision.** `src/ui/tokens.css` defines the contract. Seven type steps, `--text-xs` 11,
`--text-sm` 12, `--text-md` 13, `--text-lg` 15, `--text-xl` 18, `--text-2xl` 24 and
`--text-display` 32 px; the older `--size-chip/tag/label/body` point at them so there is one scale
and not two. Ink tokens: `--ink` #141414, `--ink-mid` #4a4a4a, `--ink-dim` #595959 (it was
#6e6e6e, which failed), `--ink-inverse` #fff for dark fills only, and the coloured inks
`--ink-alarm` #a8322c, `--ink-warn` #8a5a00, `--ink-ok` #1f6b3a and `--ink-info` #1d5fa8.
`--ink-faint` #a8a8a8 is for NON-TEXT only (hairlines, ticks), because it does not reach 4.5:1.
An `--accent-*` is never used as text. Text meets WCAG AA, 4.5:1 on every light surface. Any
tappable control has a 44 x 44 px effective area; where the drawn control is smaller, an
invisible hit area supplies the rest. Hierarchy is carried by size and weight, not by paleness.
The top readouts are one block drawn with a single `transform: scale(0.86)` at every width,
because the phone's earlier 0.78 rendered 12 px text at 9.4 px; the smallest readout text is
`--text-md`, which renders at 11.2 px. Panels share `PanelHeader.tsx` (title exactly as in the
menu, an optional meta chip, a close button drawn at 32 px with a 44 x 44 hit area), and every
selected chip, segment and tab is `--accent-selected` #c8433a (white on it 4.86:1). Blue is kept
only where it means venous.

**How it is measured.** A script walks 27 interface states and reports, for the phone (390 x
844) and the desktop (1440 x 900), text rendered below 11 px, WCAG AA failures, distinct font
sizes and touch areas under 44 x 44. Before: phone 125, 206, 18 and 57; desktop 196, 281 and 16
sizes. After: 0, 0, 7 and 1 on the phone (the one touch offender, `.more` in the Structures panel, has since been given a 44 px invisible hit area), and 0, 0
and 7 on the desktop. The Playwright layout checks (ADR-041) also fail on any covered control
and any text painted over text.

**The measurement had a false positive.** The first audit's Food tab reported 1.3:1 contrast.
That was not a defect: under software WebGL on a loaded machine the sheet's 300 ms fade had not
advanced, so the capture photographed it mid-fade. Both capture tools now wait for every finite
CSS animation to finish before measuring (`settle` in `tests/e2e/helpers.ts`).

**Rejected.** A per-panel size for each need (the cause of the 18 sizes). Making the faint ink
darker: it exists so that hairlines can be quiet, and its rule is that text never uses it.
Keeping 11 px for reference ranges, units, sources and the Structures summaries: it
measured 10.8 to 10.9 px rendered, so they are `--text-sm`, 12 px.

## ADR-039 — The slice plane: semantics, picking through the cut, and a cut-edge contour

An organ's interior is easier to read in section, and a glass organ cut open shows nothing
unless the cut is marked.

**The decision.** `Viewer.setSlice(axis, depth)` with `axis` one of `'front'`, `'side'`, `'top'`
or null and `depth` from 0 to 1. It applies to the selected organ's parts, streams and shell and
never to the body outline, and it returns to null on any selection change. Depth 0 removes
nothing, 0.5 passes through the centre of the organ's bounding sphere and 1 removes everything.
`'front'` removes from the patient's front, a coronal section. `'side'` removes from scene +x,
which is the patient's LEFT, because the body is mirrored in x; orbit to azimuth +90 degrees to
face the cut. `'top'` removes from the top down; orbit over the top to face it. The plane is
fixed when it is set, so a beating heart moves slightly against it. Picking ignores cut-away
tissue: a click inside a cut kidney picks `renal_pelvis` or `renal_cortex`, not the part that
was removed. Back faces of cut solid parts are drawn flat at 0.55 x the part's colour so that a
hollow organ reads as hollow.

**The cut-edge contour.** `src/render/materials/sliceCut.ts` patches each fragment shader: the
original `main` becomes `cutMain`, and a wrapper redraws kept-side fragments that lie within
`uCutEdge` of the plane at `SLICE_EDGE_DARKEN` 0.35 x their colour with alpha 1, for parts, walls
and the organ shell; streams opt out. The width is the larger of `SLICE_EDGE_WIDTH` (1.2 percent of
the organ's bounding radius) and `SLICE_EDGE_MIN_PX` (3 px at the framing distance), computed in
`Viewer.setSlice`. A glass organ cut open needed this: its walls are drawn after the solids at
low opacity, so the cut had no visible edge and the wall appeared to end for no reason. With the
contour, the kidney's capsule and cortex boundary read as rings. The dither pass makes the
contour dotted rather than solid; that is stated as a limitation.

**Accepted costs.** The plane does not follow the heart, and the contour is dotted by the
dither pass. Both are stated in `docs/MODEL_LIMITATIONS.md`.

## ADR-040 — The drug database is loaded on demand, and fetched, not imported

The entry chunk carried all 152 drugs although most visits never open the drug sheet.

**The decision.** `src/ui/drugData.ts` holds `loadDrugData()`, one shared promise that is
memoised on success only, `drugDataIfLoaded()` and `useDrugData(enabled)`, so a closed sheet
loads nothing. The first engine snapshot arms a prefetch that runs 3 s later at browser idle
(`requestIdleCallback`, 10 s timeout, a `setTimeout` fallback); boot never waits for it. The
sheet shows "Loading the drug list..." while it waits and "The drug list could not be loaded"
with a Retry button on failure. `causeOf` in `explanations.ts` reads the loaded map and skips
the drug-group step if it is absent; the invariant, kept in a comment, is that a drug can only be
in the blood after the sheet or a scenario has loaded the data, so `causeOf` stays synchronous.
`resolveIntents(sc)` in `scenarios.ts` awaits the loader, and the Body panel's `runScenario`
awaits it before RESET. The simulation worker still bundles all 152 drugs.

**Measured.** The main script went from 1,764.63 kB (346 kB gzip) to 867.22 kB (255.69 kB gzip).
The data is its own file, `drugs-<hash>.json`, 1,178.84 kB (103.36 kB gzip), served as
application/json with the COOP and COEP headers.

**Why fetch and not `import()`.** The first version was a dynamic `import()` and it worked until a
download failed. After one failed download Retry did nothing, because Chromium caches a failed
dynamic import of a module and returns the same rejection. The data is now
`import drugsUrl from '../data/drugs.json?url'` and a `fetch`, which is not cached on failure.
Anything that must be retryable is fetched. The orchestrator reproduced it by failing the download
once and pressing Retry, and the list then appeared.

**Rejected.** Leaving it in the entry chunk (the size above). Importing it dynamically (the
cached failure). `tests/sim/scenarios.test.ts` stubs `fetch` to read `src/data/drugs.json` from disk,
because the asset URL does not exist under node.

## ADR-041 — CI is split into shards, and the built app is tested in a browser under software GL

One CI job ran the whole suite in about 36 minutes, and no test ever loaded the production build.
A page that was blank while `tsc` was clean has happened before (see the Vite cache trap in
`CLAUDE.md`).

**The decision.** `.github/workflows/ci.yml` has three jobs. `verify` runs npm ci, lint,
typecheck, build, the ingest idempotence check and the placeholder triangle budget. `test` is a
six-way matrix running `npm test -- --shard=N/6` with `fail-fast: false`; Vitest assigns each file
to a shard by a hash of its path, so a new test file is always picked up. `e2e` installs
Chromium, builds, runs `npm run e2e`, and uploads `playwright-report/` and `test-results/` for
7 days on failure. A run takes about 15 minutes end to end (the slowest shard was 14), against
about 36. To make the shards balance, `tests/sim/nutrition.test.ts` (45 simulated hours, about
19 minutes on one runner) was split into `nutrition-glycaemic`, `nutrition-absorption`,
`nutrition-ethanol` and `nutrition-caffeine` test files with shared helpers in
`nutrition-helpers.ts`: 11 tests and 21 assertions, moved verbatim.

**The browser tests.** `playwright.config.ts` has a `desktop` project (1440 x 900) and a `phone`
project (390 x 844, touch), Chromium with software-GL flags (`--use-gl=angle
--use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist`), 120 s per test, one
retry and two workers on CI, and `vite preview` on port 4173. `@playwright/test` is pinned to
1.63.0 to match the browser preinstalled in the cloud sandbox. The specs are `tests/e2e/*.spec.ts`
(Vitest collects only `*.test.ts`, so neither runner sees the other's files): boot (title, banner,
cross-origin isolation, no "degraded waveform transport", clean console), welcome (shown once),
select, layout (no covered control, no text over text, over rest, the menu, panels, the drug sheet
and a selected organ) and nogl (the fallback card). `settle()` in `helpers.ts` waits for every
finite CSS animation first, because on a loaded runner a 300 ms fade was still at opacity 0
after 1.5 s. Two local runs of the final code passed 9 tests with 1 skipped (nogl runs on the
desktop project only), in about 4.4 minutes with one worker.

**Why the production build.** The tests run against `vite preview`, so they see the built
chunks and the COOP and COEP headers that the boot spec asserts; the dev server would not.

## ADR-042 — A share link restores the body and the view, through a strict whitelist

A visitor should be able to send someone the same body, looking at the same organ, and the
address bar is the only thing both browsers share. It is also text that anyone can edit by hand
and that a stranger can send, so every value in it is untrusted input to a simulation.

**The decision.** `src/ui/shareLink.ts` is pure: `buildShareHash(state)` writes the link and
`parseShareHash(hash, catalogue)` reads it. The format is
`#v=1&sex=female&weeks=28&organ=uterus&part=placenta&layers=vessels,nerves,hormones,activity&cut=front:0.5`.
The parser is a whitelist, and a value that fails its rule is dropped, never repaired:

- `v` must be 1. Without `v=1` nothing at all is applied, so a link from a future format is
  ignored instead of half understood.
- `sex` is `male` or `female`.
- `weeks` is an integer from 0 to `pregnancy.maxWeeks`, read from `reproduction.json` and not
  typed again here, and only for a female body.
- `organ` must exist in the catalogue of that body (a prostate in a female link is dropped), and
  `part` must belong to that organ's atlas.
- `layers` must be a subset of the four overlay names; one bad name drops the whole key.
- `cut` is `axis:number` with the number in [0, 1].
- Unknown keys are ignored, a duplicated key is dropped, any value longer than 64 characters is
  dropped, and values are limited to a safe character set.

A link is applied once the engine is ready, on load and again on `hashchange`, in this order:
`SET_BODY`, then `SET_PREGNANCY` with the parsed numbers only, then the layers, the organ, the
part and the cut. A field that is absent leaves that part of the view as it was. The welcome
dialog still shows to a first-time visitor who arrives by a link, because the not-for-clinical-use
notice must be read before anything. "Copy link to this view" sits at the end of the panels menu
(the clipboard, with a read-only field as the fallback). The toasts say what a link is:
"Link copied. It opens this body and this view, not what has happened to it." and "Link opened. It
restores this body and this view, not what has happened to it."

**A link restores the body and the view, never the history.** Drugs given and events are not in
it. The toasts say so in words, so that two people opening the same link do not expect to see the
same history. Nothing in a link can carry a dose.

**Rejected.** Applying a link before the engine is ready: it is applied once the engine is ready, so
its intents reach a running engine. A permissive parser that clamps a bad number: a clamped value is a
body nobody asked for, and a dropped one leaves the visitor's own state. Encoding the whole
snapshot: it would be long, and most of it is not the visitor's to set. `tests/ui/shareLink.test.ts`
has 38 tests, 28 of them malformed inputs, and none throws.

## ADR-043 — Search finds organs and structures, and Reset view appears only when the view has moved

With 32 organs and 301 parts in the atlases, finding the renal medulla meant opening the kidney
and scrolling.

**The decision.** `src/ui/search.ts` is pure and builds a catalogue of the organs and parts THIS
body has, because sex and pregnancy decide which exist. Paired organs list a part once per side
("Medullary Pyramids, left kidney"). Ranking is label prefix, then word start, then substring; on
a tie an organ comes before a part; at most 8 results; matching ignores case and accents
(`tests/ui/search.test.ts`, 8 tests). `SearchBox.tsx`, "Find an organ or structure", is at the
top of the panels menu and its results replace the list while it has text. Arrows move, Enter
opens the highlighted result, Escape clears the text and a second Escape closes the menu.
Choosing a part selects its organ, then the part, then flies the camera to it
(`viewer.focusPart`) once `viewer.interiorReady`; `App` re-applies the part because selecting an
organ clears the picked part.

**Reset view.** `ResetViewButton.tsx` is a pill shown only while `viewer.viewAtHome` is false
(store `viewAtHome`, fed by `viewer.onViewChanged`), so it appears when the camera has been moved
and offers the way back, and is absent when there is nothing to reset. On a phone it is hidden
while a sheet or the menu is open; on a wide screen it stays visible beside an open sheet.

**Hover.** A mouse hover sets the store's `hoveredOrgan` (from `viewer.onHoverChanged`) and the
canvas cursor becomes a pointer. A separate name tag beside the pointer was built and removed:
the viewer already draws the hovered organ's name as its big label, and the two names sat side
by side.

**Rejected.** Searching only the organ names (the parts are the reason to search). Showing the
Reset view pill always (it would be a control that does nothing at rest). A second name tag, for
the reason above.
