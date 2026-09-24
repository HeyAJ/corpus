# What CORPUS could become

Two things live here: an argument about what this simulator is *for*, and a list of
features that follow from it. The list is long; the argument is short, and it is the
part that matters, because it decides which items on the list are worth building.

---

## The argument

CORPUS is not a patient simulator and should not try to become one. A patient
simulator asks *what would you do?* — it has a correct answer, and its job is to grade
you against it. This is a different instrument. It asks **what happens if?** and it has
no correct answer at all, only consequences.

That framing explains why the guardrails are not a tax on the design. A free-text mg/kg
field belongs to the first kind of tool, because a number you type is a decision you are
being judged on. A multiplier on a cited reference dose belongs to the second, because
it is a *parameter you are sweeping*. The guardrail and the feature turn out to want the
same shape.

So the test for everything below is: **does it let you see a mechanism you could not see
before?** Not "is it realistic", not "is it impressive" — is there a causal chain in the
body that this makes visible.

---

## Part 1 — What was just built

Recorded here because the rest of the list is written against it.

| | |
|---|---|
| **Twelve routes** | IV push, IV infusion, intraosseous, intramuscular, subcutaneous, intranasal, sublingual, rectal, transdermal, inhaled, nebulised, oral. Each is a cited entry in `src/data/routes.json`; each drug's absorption is scaled from its own measured intramuscular constant, with per-product overrides where a label publishes real figures. |
| **Dose as a bounded parameter** | 0.1x to 10x of a cited reference dose, logarithmic, detented at 1x, clamped **in the worker**. Never an absolute amount: the only thing the interface can send is *which cited dose* and *times what*. |
| **A predicted plasma curve** | Drawn live as you move the slider, from the engine's own pharmacokinetics — `tests/pharma/routes.test.ts` asserts the preview and the engine agree within 10% on peak. The reference dose's curve stays underneath as a dashed ghost, so the control is a comparison rather than a number. |
| **Multi-depot absorption** | Each extravascular dose keeps its own rate constant, lag and bioavailability. A fentanyl patch and a fentanyl injection coexist with rate constants three orders of magnitude apart. |
| **Trend sparklines** | Sixty seconds of simulated history behind every vital sign, with the direction spelled out in words for the accessible name. |
| **A session timeline** | What you did and what happened, on one axis, in simulated time. |

Four data gaps closed on the way: sixteen missing constants down to three, six
cross-check disagreements down to zero — and the one real disagreement the filtering
exposed turned out to be a genuine bug in the terminal-half-life calculation.

### And then, a second round

| | |
|---|---|
| **89 drugs** | Up from 19. 184 receptor targets, 56 receptors. Every candidate was checked against the GtoPdb cache before being added, so the set is what could be sourced rather than what could be named. Sixteen drugs have no receptor targets and each one says why. |
| **Controlled substances** | THC, methamphetamine, MDMA, cocaine, nicotine, ethanol — modelled pharmacologically, with the toxicity intact, from cited human-study exposures. |
| **An endocrine system** | Six hormones with closed feedback loops, sharing the drug effect bus so spironolactone competes with the body's own aldosterone at one receptor. |
| **A vascular overlay** | 31 named vessels, flow pulsing with the real cardiac phase, particles coloured by what is circulating. Vessel colour from oxygen saturation, so the pulmonary artery draws dark. |
| **A laboratory panel** | ABG, chemistry, renal and haematology against reference intervals, with derived values marked as derived. |
| **46 foods** | USDA-sourced with FDC identifiers, plus glycaemic index and fibre that scale the RATE of glucose absorption without changing the total — and alcohol and caffeine handed to the drug pharmacokinetics rather than modelled twice. |

Five bugs found by building it, which is the argument for building things:

1. A **circular import** that broke the ingestion pipeline at runtime while typechecking
   cleanly — the shared citation table was needed at module-evaluation time by both
   halves of a registry that imported each other.
2. The drawer **re-derived its grouping** from a switch on drug class that had no case
   for half the classes, so eighty of the eighty-nine new drugs landed under "Other".
3. GtoPdb's **HTML entities** meant nicotine matched nothing at the receptor named after
   it: the real target name contains `&alpha;3`, which decodes to `alpha3`, and the
   alias said `3`.
4. A **1000x unit error** in the transport markers — the reference concentration used
   the raw preset amount instead of converting to milligrams, so every microgram-dosed
   drug had a marker that could never leave zero.
5. **Drugs arriving only through food never reached plasma.** The pharmacokinetics loop
   iterates the drugs that have a compartment, and a compartment is only created by
   `administer()`. Every previous route went through it; food was the first that did
   not, so the gut absorbed the ethanol correctly, handed it over correctly, and the
   engine dropped it. With the fix, one standard drink produces 0.021% blood alcohol
   and a cup of coffee 2 mg/L of caffeine — neither fitted, both right.

---

## Part 2 — Features, in order of what they would teach

### Tier 1 — the mechanisms currently invisible

**1. A second body.** The single highest-value feature in the list, and the one the
architecture is already shaped for. The sim is a pure function of one state vector; a
second engine instance costs one more worker. Two bodies side by side, given different
doses or different routes, is how you see a dose-response relationship rather than a
dose-response *number*. Everything about the current design — determinism, seeded RNG,
no wall-clock dependence — exists to make this possible.

**2. Forward projection: "and then what?"** The predictor in `src/sim/pharma/predict.ts`
does this for one drug's plasma curve. The same trick applied to the whole state vector
— run the engine forward 10 simulated minutes at 300x in a spare worker, draw the
result as a ghost trace ahead of the live one — would let you see a trajectory before
you are committed to it. *Watch the ghost bend as you move the dose slider.* The engine
already runs 300x faster than real time, so the compute exists.

**3. Rewind and branch.** Snapshot the state vector every simulated minute, and let the
user scrub back and take a different action. This is what turns a simulator into an
instrument: the question is never "what happened", it is "what would have happened
instead". Determinism makes it exact rather than approximate.

**4. Disease as a parameter set, not a scripted event.** Sepsis is not a script — it is
low systemic resistance, high cardiac output, raised lactate and a leaky capillary bed.
Haemorrhagic shock is a volume state. Anaphylaxis is mast-cell mediators acting on
receptors that are already modelled. Each is a handful of parameter offsets on a model
that already has the machinery, and each turns the drug set from a list into a set of
answers to a specific question.

**5. The drug interaction that the receptor model already implies.** Gaddum competition
is implemented; what is missing is showing it. Give fentanyl, then naloxone, and watch
mu occupancy transfer from one ligand to the other on the receptor panel — the model
computes this every tick and the interface currently averages it away.

### Tier 2 — depth in what exists

**6. Extravasation, a missed vein, a patch that falls off.** Every administration
currently succeeds perfectly. Route failure is an ordinary clinical event and the reason
routes have redundancy at all.

**7. A depot with a volume.** Absorption should slow as the injection site fills, and
there should be a volume it will not take. This is what makes "give it all
intramuscularly" a bad idea in a way the model cannot currently express.

**8. Metabolites.** Morphine-6-glucuronide is a more potent analgesic than morphine.
Modelling one metabolite for one drug would make renal failure change a drug's
*effect* and not just its concentration.

**9. Enzyme induction and inhibition.** The mechanism behind most clinically important
drug interactions, and completely absent.

**10. Tolerance and receptor downregulation.** Sustained occupancy should reduce the
response. It is a single extra state per receptor and it makes infusions behave
correctly over hours.

**11. Saturable everything.** Protein binding that saturates, absorption that saturates,
elimination that saturates. Right now a 10x dose gives exactly 10x the concentration,
and for most real drugs it would not.

**12. Paediatric and geriatric bodies.** Not as a safety feature — as the clearest
possible demonstration that pharmacokinetics are a property of a *body*, not of a drug.
Clearance scales with body surface area, volumes with body water.

### Tier 3 — new territory

**13. An acid-base model that closes.** pH, bicarbonate and CO2 exist as separate
readouts; a Stewart or Henderson-Hasselbalch treatment would make them one system, and
would make respiratory compensation for a metabolic acidosis emerge rather than be
scripted.

**14. Regional perfusion.** One systemic resistance becomes a handful of parallel beds.
Then a vasopressor can raise the pressure and reduce the gut's blood flow at the same
time, which is the actual clinical trade-off and is currently unrepresentable.

**15. Coronary circulation as its own loop.** Coronary perfusion pressure is already
computed for the arrest model. Closing the loop — flow feeding contractility, ischaemia
feeding arrhythmogenicity — would let an infarct be a consequence rather than a mode.

**16. Temperature as a real system.** Shivering, vasoconstriction, sweating, and
therapeutic hypothermia after arrest.

**17. Mechanical ventilation with settings that matter.** Currently a boolean. Tidal
volume, rate, PEEP and FiO2 as controls would make the respiratory model interactive
rather than observed.

**18. A lab panel that has to be requested.** Results arrive after a delay, and are
therefore *stale* — which is the single most under-taught fact about laboratory
medicine. A number on a screen is a measurement of the past.

**19. Session export.** The event record plus the vitals as CSV, and a permalink that
reconstructs a run from its seed and intent log. The determinism guarantee makes a
permalink exact, which is unusual and worth exploiting.

**20. A scripted-scenario format.** A JSON file of timed intents that replays
deterministically — enough for a lecturer to hand out a case, and enough for the test
suite to grow without new code.

### Tier 4 — pedagogy

**21. "Why did that happen?"** Click a moving number and get its causal chain from the
model: *MAP rose because systemic resistance rose 34%, because alpha-1 occupancy rose to
41%, because free adrenaline reached 180 nM.* Every link already exists in the state; it
just needs to be walkable.

**22. Sensitivity mode.** Sweep one constant across its plausible range and show how
much the output moves. It answers "how much does this number matter", which is the
question every `assumed` value in `MISSING_CONSTANTS.md` implicitly raises.

**23. A confidence overlay.** Tint every readout by the weakest confidence in its
dependency chain — measured, derived, assumed. The provenance data to do this already
exists on every constant. It would make the honesty structural rather than documentary.

---

## Part 3 — Aesthetics and interaction

The visual identity is strong and should not be redesigned. It earns its look from a
real physical model — absorption through tinted tissue on a bright ground — and the
multiply-blend architecture is a genuine idea, not a style. What follows are the places
where it is not yet finished.

### The rendering

**A. The stack has no depth cue beyond overlap.** Fifteen organs occupying the same
silhouette read as a flat pile. Two cheap fixes, both consistent with an absorption
model: make the absorption coefficient rise slightly with distance from the camera —
aerial perspective, which is what real translucent media do — and add a very slight
depth-of-field falloff on everything outside the selected organ's plane. Both cost one
uniform.

**B. The tone curve is doing a lot of work and nothing shows it.** The absorption
differences this aesthetic trades in are small — a 13% transmittance difference is five
levels out of 255, which is why ACES was removed and a custom soft shoulder put in its
place. That leaves almost no headroom. A subtle per-organ hue shift, rather than one
tissue tint for everything, would buy separation that luminance alone cannot: liver
browner, lung cooler, kidney deeper. It stays inside the absorption model, because a
tint is exactly what a coloured absorber does.

**C. Selection needs a transition, not a switch.** An organ currently jumps between
bucket 1 and bucket 3. Cross-fading the two materials over ~180 ms would make selection
feel like focusing rather than like toggling.

**D. The organ labels float unanchored.** A 1px leader line from the label to the
projected centroid would tie each to its organ, which matters most in the abdomen where
four labels compete for the same area.

**E. Nothing marks the moment of a dose in the 3D view.** A brief bloom travelling the
venous path from the injection site would connect the drawer to the body. It is decorative
— but it is decoration in service of the one relationship the app is about.

**F. The background is inert.** A whisper of vignette, and a barely-perceptible
brightness pulse locked to the cardiac cycle, would make the whole frame feel alive
rather than the organs alone. Strictly behind `prefers-reduced-motion`.

### The interface

**G. The HUD has one hierarchy level too few.** Heart rate, blood pressure and
saturation are the three numbers that matter and they currently sit at the same weight
as EDV and ESV. The reference screenshots are more ruthless than this build is.

**H. Everything is discoverable only by clicking.** There is no keyboard path to the
common actions and no command palette. For a tool whose whole loop is *do a thing, watch
the body*, the input latency of finding a drug in a drawer is the dominant cost.

**I. Panels do not remember anything.** Which organ was selected, which drug was
expanded, whether the timeline was open — all reset on reload. `localStorage` for
per-viewer preferences would remove a repeated tax.

**J. The provenance is one tap away and feels like a footnote.** Given that
"every number has a source" is the project's central claim, the citation deserves to be
a first-class object — hover any value, see its source and its confidence, inline.

**K. The waveform strip is an ECG and not a monitor.** Real bedside monitors stack
several traces on one time axis. Pulse pressure and capnography already exist in the
ring and are not drawn.

**L. The condition tags are a stack, not a triage.** They appear in computation order
rather than severity order, and nothing indicates that a tag *just* appeared, which is
the only time a tag is interesting.

**M. Mobile is supported but not designed.** The drawer, the panels and the new dose
control all reflow, but the 3D view is the thing that suffers on a small screen and
nothing adapts the camera framing to it.

### Accessibility

Already handled well — em-dashes for missing values, text equivalents for every metric,
colour never load-bearing, `prefers-reduced-motion` respected. The gaps:

**N. Focus order is DOM order**, which for an absolutely-positioned HUD is close to
random.
**O. No live region announces a condition tag appearing.** A screen-reader user learns
that the body has gone into VF only by going and reading.
**P. The 3D view is one `img` with one label.** Individual organs are not reachable by
keyboard at all, so organ selection — the primary interaction — has no non-pointer path.

---

## What I would build next, if it were one thing

**The second body.** Everything else on this list makes the model deeper. A second body
makes it an *instrument*, because it turns every question from "what does this do" into
"what does this do *compared to that*" — and comparison is where understanding actually
comes from. The determinism guarantee, the pure state vector and the worker isolation
were all built for it already. It is mostly a layout problem.

After that, **rewind**, for the same reason and with the same architecture behind it.
