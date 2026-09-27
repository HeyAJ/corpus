# The vascular overlay

Arteries and veins as geometry, with blood visibly moving through them carrying
whatever the simulation says is in it.

> This is a **drawing**, not a model. The haemodynamics are lumped-compartment and live
> in `src/sim/systems/cardio.ts`; nothing in `src/data/vasculature.json` affects a
> single computed number. The vessels exist so the circulation can be *seen*.

---

## What it shows

Turn it on with the labelled "Vessels" switch in the bottom-left corner of the body view (it starts off).

- **Thirty-one named vessel segments**, arterial and venous, with centrelines placed in
  the same body-local space as the organs in `src/data/organs.json` — so the renal
  artery ends where the kidney is.
- **Flow**, as particles moving along each centreline. Speed comes from real cardiac
  output and surges in systole with the real cardiac phase.
- **What the blood is carrying**, as particle colour. Oxygen, carbon dioxide, glucose,
  lactate and every drug currently circulating, each at its own normalised level.
- **Vessel colour from real oxygen saturation.** Desaturate the body and the arterial
  tree visibly darkens.

The `In the blood` panel is the legend, and works as a readout on its own.

---

## Three things it gets right that a diagram usually does not

**The pulmonary vessels are the wrong colour, correctly.** Vessel colour here comes from
the oxygen saturation of the blood inside it, not from the word "artery". So the
pulmonary artery is drawn dark and the pulmonary veins bright — the opposite of every
red-and-blue diagram, and the right way round. `saturationFor()` in
`src/render/vascular/centrelines.ts` returns a value per *side*, never per name.

**The vena cava is on the right.** The IVC lies to the right of the aorta, the left
renal vein is longer than the right because it crosses the midline, and the right
coronary artery supplies the sinoatrial node. Those asymmetries are what make the two
trees distinguishable at a glance, and they are cited to Gray's.

**The portal vein is in it.** It is the most important vessel in this particular
simulation: it carries everything absorbed from the gut to the liver before the body
sees it, which is first-pass metabolism, which is why an oral dose and an intravenous
dose of the same drug are different drugs.

---

## Where it sits in the render architecture

The project's central rendering claim is that the organ stack is **exactly**
order-independent, because absorption is multiplication and multiplication commutes.
That claim is proved by `tests/render/order-independence.test.ts` and it must survive
anything added to the scene.

Multiply does not commute with add, so the buckets must stay separated — but *within* a
bucket any number of objects can be added without touching the guarantee. So:

| | bucket | blend | renderOrder |
|---|---|---|---|
| vessel walls | 1 | multiply | 12 |
| flow particles | 2 | additive | 22 |

Vessels are tinted tissue, so they are absorption. Particles are something glowing as it
moves, so they are additive. Both land in a bucket that already existed, and the
order-independence test passes unchanged.

The vessel shader uses the same Beer–Lambert path-length reasoning as the organ shells —
a grazing ray crosses more wall, so it absorbs more — with a harder cap on the path
length. A tube seen edge-on presents a near-infinite path through a wall a millimetre
thick, and without the cap every vessel silhouette became an opaque brown outline that
read as plumbing.

---

## Limitations

- **The vessel tree is not connected.** A particle reaching the end of the aorta wraps
  to its start rather than continuing into the iliac. Modelling continuity would need a
  connectivity graph this file does not have, and would claim a continuity the lumped
  haemodynamics do not actually model. What you see is each vessel flowing, not a
  circuit being traced.

- **Flow is uniform along a segment and identical between segments.** Real flow divides
  at every branch according to downstream resistance, and this model has one systemic
  resistance. A renal artery therefore carries particles at the same speed as the aorta,
  which is wrong — renal blood flow is about a fifth of cardiac output through a vessel
  a fifth of the radius.

- **Radii are luminal radii at rest and never change.** Vasoconstriction is a number in
  the cardiovascular model and is not drawn. That is a missed opportunity: giving
  adrenaline and watching the arterioles narrow would be worth seeing, and it is not
  currently possible because the model has no arterioles.

- **A drug is shown in the whole circulation at once.** `transport.ts` marks an
  intravenous drug as `both` rather than tracing venous-then-pulmonary-then-arterial,
  because that sequence is shorter than one 20 Hz snapshot interval — claiming to show
  it would be claiming resolution the snapshot does not have.

- **No capillaries, no microcirculation, no lymphatics.** Thirty-one segments is the
  named macroscopic tree, and the exchange that actually matters physiologically all
  happens below its resolution.

- **Several radii are marked `assumed`.** Where Gray's gives a diameter it is halved and
  cited; where a vessel is drawn for continuity rather than measured, the entry says so.
  A radius that was invented would be exactly the thing this project forbids, so every
  entry declares which it is.

---

## Files

```
src/data/vasculature.json          the tree: centrelines, radii, citations
src/render/vascular/centrelines.ts resampling, arc length, saturation by side
src/render/vascular/VascularSystem.ts  geometry, materials, particle advection
src/sim/derive/transport.ts        what the blood is carrying, normalised
src/ui/components/BloodContents.tsx the legend
```

The Viewer exposes `setVascularVisible(on)`; the tool dock drives it through
`vascularVisible` in the UI store.
