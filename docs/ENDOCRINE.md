# The endocrine system

Six hormones, each a first-order compartment with a secretion rate that is a function of
state the engine already computes, and an effect vector onto the same bus every drug
uses.

---

## Why hormones share the drug effect bus

Adrenaline the infusion and adrenaline the adrenal output should reach
`cardio.contractility` by the same path, or the model has two adrenalines. Routing
hormones through `addEffect` means a drug and a hormone can oppose each other without
either knowing the other exists — which is exactly what a beta blocker and a stress
response do.

It also means the receptor competition already implemented for drugs applies for free:
spironolactone and the body's own aldosterone compete at the same mineralocorticoid
receptor, because there is only one.

---

## Why the feedback is the point

A hormone with a fixed level is a constant, and a constant belongs in
`physiology.json`. What earns a subsystem is the **loop**: potassium rises, aldosterone
rises, potassium is excreted, aldosterone falls.

Every driver reads live state through a closed `driverValue` switch that **throws** on an
unknown signal. That is deliberate: a hormone whose feedback loop silently does nothing
is worse than an absent one, because it looks modelled.

| Hormone | Driven by | Reaches |
|---|---|---|
| Cortisol | stress axis + a circadian term | hepatic glucose output, protein catabolism, inflammation, vascular tone |
| Aldosterone | renin drive, **and independently serum potassium** | sodium reabsorption, potassium excretion, water |
| Vasopressin | plasma osmolality, and hypovolaemia past a threshold | water reabsorption, systemic resistance |
| Free T4 | TSH drive (see limitations) | basal rate, thermogenesis, heart rate, contractility |
| Glucagon | hypoglycaemia | glycogenolysis, hepatic glucose output, ketogenesis |
| Erythropoietin | hypoxia | erythropoiesis |

---

## Two details worth naming

**A hormone at its own baseline contributes zero.** The effect applied is the deviation
of activity from the activity the baseline produces, not the activity itself. Without
that subtraction every effect would be double-counted against physiology that is already
calibrated to include normal hormone tone — a resting body would behave as though it had
just been given six drugs.

**Effects scale on receptor activity, not on concentration.** Each hormone's level goes
through a Hill transform before it reaches the bus, because a hormone at ten times its
reference does not produce ten times its effect. It saturates, like everything else that
acts through a receptor.

**Vasopressin's two drivers have deliberately different sensitivities.** Osmolality moves
it over a 1% change; volume has to fall about 10% before it contributes at all — and then
it dominates. That asymmetry is why a hypovolaemic patient retains water at the cost of
becoming hyponatraemic, and it is a property of the numbers rather than a special case.

---

## Timescales span five orders of magnitude

Glucagon's half-life is six minutes. Thyroxine's is seven days. Both are integrated by
the same code at the same 100 Hz tick, and the seven-day one simply moves imperceptibly.

That is the honest representation, and it has a consequence worth stating plainly:
**changing thyroid state in this model does nothing you can see in a single session.**
The model is not broken when that happens. It is telling you something true about
thyroid physiology that a faster model would hide.

---

## Limitations

- **There is no pituitary.** `tshDrive` returns 0, so free T4 sits at its set point and
  the classic TSH ⊣ T4 negative feedback loop is **not closed**. Hypo- and
  hyperthyroidism are therefore not reachable states. This is the largest single gap.

- **Only six hormones.** Absent: ACTH, growth hormone, prolactin, the gonadotrophins,
  oxytocin, PTH, calcitonin, insulin as an endocrine entity (it lives in the Bergman
  minimal model in `systems/metabolic.ts` instead), somatostatin, the sex steroids,
  leptin, ghrelin, GLP-1, gastrin, CCK, melatonin, renin and angiotensin II as
  concentrations rather than drives.

- **Adrenaline and noradrenaline are not endocrine here.** Sympathetic drive acts through
  the baroreflex in `systems/baroreflex.ts` rather than through a circulating adrenal
  hormone, so an adrenal medullary output is not modelled and exogenous catecholamines
  do not compete with an endogenous one.

- **Renin and angiotensin II are drives, not concentrations.** `reninDrive` is computed
  from mean arterial pressure inside `driverValue`; there is no renin compartment, no
  angiotensinogen and no converting enzyme. An ACE inhibitor therefore has nothing to
  inhibit, which is why none is in the drug set.

- **Calcium is not regulated.** Serum calcium exists in `chem.ca` and can be moved by
  giving calcium chloride, but no PTH or calcitonin defends it, so it does not return.

- **The nuclear-receptor hormones act far too quickly.** Cortisol and thyroxine work by
  changing transcription, over hours to weeks. The model applies their effects with the
  same instantaneous occupancy every other receptor uses. The *direction* and *relative
  size* are right; the onset is not.

- **The circadian clock is a sine wave.** One term, one peak hour, and it starts at 08:00
  on a fresh body. Real cortisol has a pulsatile ultradian rhythm on top of the
  circadian one, and real melatonin responds to light, which this model does not have.

---

## Files

```
src/data/hormones.json           baselines, reference ranges, drivers, cited effects
src/sim/systems/endocrine.ts     the integrator and the closed driver list
src/ui/panels/EndocrinePanel.tsx the readout, with reference bands
```

Adding a hormone means adding an entry to `hormones.json`. The snapshot, the panel and
the sparklines all derive from `HORMONES`, so nothing else needs changing — which is the
property that makes the data a data file rather than a configuration file.
