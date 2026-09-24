# VISUAL AUDIT — reference frames

Source: 13 frames captured from the thix.co "LIFE" marketing site, supplied as
`reference/01…13_*.webp`. They are used as a **visual and functional target only**.
No asset, shader, or copy text from that product is reproduced here.

Every value below is read off the frames (eyedropper / pixel measurement on the
1170 px-wide iPhone captures, DPR 3 → CSS px = device px / 3). Where a value is
inferred rather than measured it is marked **(inferred)**.

---

## 0. Frame index

| # | File | What it shows |
|---|---|---|
| 01 | `01_hero_heart.webp` | Hero card: isolated heart, rim-lit, on a saturated pink plate |
| 02 | `02_heart_selected_hud.webp` | Full app, heart selected, HUD cluster top-left, tool dock bottom |
| 03 | `03_lung_selected.webp` | Lung selected — saturated violet, screen-space label, other organs dimmed |
| 04 | `04_stomach_selected.webp` | Stomach selected — volume chip, pH scale chip, two dark sparkline chips |
| 05 | `05_large_intestine_marketing.webp` | Large intestine selected (deep red) + marketing copy + second HUD state |
| 06 | `06_tooldock_drawer_peek.webp` | Tool dock detail + drug drawer peeking in |
| 07 | `07_drug_drawer.webp` | Drug drawer, full: tabs, group headers, drug pills, route buttons |
| 08 | `08_receptor_copy.webp` | Receptor marketing copy (no UI) |
| 09 | `09_receptor_panel.webp` | Receptor panel: dark card, line chart, receptor pills + dot-matrix bars |
| 10 | `10_gi_transit_emergency.webp` | GI transit still + emergency HUD with condition tags |
| 11 | `11_defib_vfib.webp` | V Fib + Cardiac Arrest, defib pad placement overlay, Cancel button |
| 12 | `12_stomach_fluid_closeup.webp` | Close-up: gastric fluid level + meniscus ellipse inside stomach |
| 13 | `13_cancel_tooldock.webp` | Cancel button + tool dock in defib mode (blood-drop icon swapped in) |

---

## 1. Global canvas / background

| Property | Value | Evidence |
|---|---|---|
| Idle background | `#F0F0F0` – `#F2F1EF` | frames 02, 03, 11 — flat, very slightly warm grey |
| Active/simulating background | `#F6F4E4` warm cream | frame 10 (the GI still) has a visible yellow-green cast vs. 02 |
| Emergency tint | `#FBF3D0` | frame 10's right half + frame 11's upper band, pale-yellow wash |
| Dither/halftone grid | visible across **the entire canvas**, including background | frames 02, 10, 11 at 1:1 — regular dot lattice |
| Dot pitch | ≈ **3 device px** (≈1 CSS px at DPR 3) | counted 1170/≈390 cells across frame 02 |
| Dot pattern | axis-aligned square lattice, not rotated | no moiré-rotation visible; Bayer 8×8 is the right implementation |
| Dither strength | subtle — ≈ 3–5 % luminance swing | background never reads as texture at arm's length |
| Vignette | very slight, corners ≈ 2 % darker | frame 03's corners vs. centre |

**Conclusion:** the dither is applied to the *composited frame*, at native device
resolution, after tone mapping — it sits on top of both body and background.

---

## 2. The organ material — what the pixels prove

Read frames 02 and 03 carefully:

1. The background is **light** (`#F0F0F0`); the tissue is **darker** than the
   background everywhere.
2. Where two organs overlap (lung over intestine in 02; stomach over lung in 04)
   the overlap is **darker and more saturated**, never brighter.
3. Silhouette edges carry a **bright, near-white** line that is *lighter* than the
   background — i.e. additive, not absorptive.
4. There is **no specular highlight and no diffuse terminator** anywhere. A sphere
   lit by a light would show a bright side and a dark side; these organs do not.
   Form is read purely from thickness (silhouette + overlap) and the edge line.

So: **multiplicative absorption + additive fresnel rim.** This confirms §6.2 of the
spec. Measured values:

| Quantity | Measured | Notes |
|---|---|---|
| Dormant organ tint (thin region) | `#F2C4C4` → `#EFB9BA` | frame 02 intestines, single-layer area |
| Dormant organ, 2 layers overlapping | `#E39FA1` | frame 02 lung ∩ intestine |
| Dormant organ, ~4 layers | `#D2797C` | frame 03 lower abdomen |
| Ratio check | 0.95, 0.90, 0.81 of bg per channel at 1/2/4 layers | consistent with `T^n`, i.e. Beer–Lambert **product** |
| Rim line colour | `#FFFDFB` – `#FFFFFF` | frame 01 heart outline, frame 03 lung outline |
| Rim line width | 1.5 – 3 CSS px, wider at grazing angles | classic `pow(1-NdV, ~3)` |
| Rim bloom halo | ≈ 8 CSS px radius, ≈ 6 % strength | frame 01, clearly around the outline only, not the body |

The ratio check is the important one: three overlap depths give per-layer
transmittance that is *constant when multiplied*, not constant when added. That is
the signature of multiply blending and it is why order-independence is exact here.

### 2.1 Selected-organ colours (measured, interior, away from rim)

| Organ | Frame | Hex | Note |
|---|---|---|---|
| Heart | 02, 11 | `#B0232A` core → `#C8433A` edge falloff | deep arterial red |
| Lung | 03 | `#5B3A8C` core, `#7E5AB3` thinner | violet — *not* pink |
| Stomach | 04, 12 | `#C8433A` | orange-red |
| Large intestine | 05 | `#8E2020` | dark maroon |
| Selected alpha | ~0.92 | selected organ occludes what is behind it |

Selected organs **do** occlude (frame 03: the lung hides the heart behind it; frame
05: the colon hides small bowel). Dormant organs never occlude. That is exactly the
bucket-1 / bucket-3 split: dormant = depth-test off + multiply, selected = normal
alpha + depth write.

### 2.2 State table read off the frames

| State | Fill | Rim | Evidence |
|---|---|---|---|
| dormant | tint `#F2C4C4`, density low (T≈0.95/layer) | ~0.3 gain | frame 02 all non-heart organs |
| hovered | ~2× density, tint unchanged | ~0.6 gain | frame 06 — the dock-adjacent organ is slightly darker |
| selected | organ colour, α 0.92, depth-writing | 1.0 gain | frames 02/03/04/05 |

### 2.3 Recalibration for contrast (supersedes the gains in 2.2)

The table in 2.2 records what was *measured* off the reference frames and does not
change. What changed is how those measurements were turned into shader constants,
because the first pass matched the reference's **overlap ratios** without matching its
**contrast**, and the result looked dark and muddy rather than like the frames.

| Constant | Was | Now | Why |
|---|---|---|---|
| dormant density | 0.42 | 1.15 | at 0.42 a single unoverlapped organ sat ~10 levels off the `#F0F0F0` ground; the abdomen read as one pink smudge instead of distinguishable loops of bowel |
| hovered density | — | 1.55 | keeps the hover step visible against the raised dormant level |
| dormant / hovered rim gain | ~1.0 | **0.12 / 0.30** | see below — 0.42 was still saturating past white and drawing a scribble over the whole abdomen |
| selected rim gain | 1.0 | 0.30 | see below — this is now a specular term, not an additive one |
| selected opacity | 0.92 | 0.97 | the selected organ is meant to occlude (2.1); at 0.92 the dormant organs behind it bled through and desaturated it |
| selected depth gain | 0.45 | 0.62 | restores the core-to-edge falloff measured in 2.1 at the higher opacity |
| dormant tint | flat `#F2C4C4` | per-organ, 0.84 toward `#FFD2CC` | the reference keeps dormant organs in one pink family while letting hue survive; a flat tint lost the liver/lung distinction entirely |

**The ratio calibration survives.** Multiplying the density scales every layer count
together, so the `T^n` relationship that 2.2 verifies across 1, 2 and 4 layers is
preserved exactly; only the absolute level moves. The arithmetic is carried in a comment
in `OrganSet.ts`: at the tint's absorption coefficient of 0.453, the new density gives
204 / 171 / 120 against the reference's measured 196 / 159 / 121.

**The dormant rim gain comes from headroom arithmetic, not from taste.** The rim is
additive near-white, so at the silhouette it adds about `gain × 255` levels. A dormant
organ body sits near 204 on a 240 background, leaving ~36 levels of headroom — about
0.14 normalised. At 0.42 the rim added ~107, saturated past white, and gave every
organ an outline *brighter than the background*; with the placeholder ellipsoid
geometry that reads as a tangle of overlapping glowing loops, and it was the single
biggest reason the anatomy looked wrong. At 0.12 the edge lands just under the
background — a soft lightening inside the tissue rather than a line drawn on top of it.
The near-white rim this document measures at `#FFFDFB` is on the **selected** organ's
silhouette, separating a deep saturated body from the field; it was never on the pale
field itself.

**What is still not matched, and will not be until the meshes are.** The rendered
abdomen remains more saturated than the reference frames. The tempting fix is to thin
the tissue, and it is wrong: at density 1.15 a *single* layer renders 204 against the
reference's measured 196, so one isolated organ already matches and is if anything
slightly too light. The abdomen is dark because the placeholder organs are fat
ellipsoids that stack many more wall crossings than the reference's thin anatomical
shells. Thinning every layer would drag an isolated organ further from the reference in
order to pull a pile of overlapping ones towards it. This is a geometry gap, closed by
Phase 7 meshes (`organs.json` still carries a `placeholder` descriptor for all 15
organs), not a material one. Tried at 0.72 and reverted.

**The selected-organ rim is now a specular highlight, not an additive rim.** This is the
one place the implementation departs from the reading in 2. Item 3 of that list is
correct for *dormant* organs — the bright silhouette line really is additive. But
applying the same additive white rim to a selected organ washed it out: white added to a
deep arterial red is pink, and the heart read as salmon rather than as the `#B0232A`
measured in 2.1. The selected material therefore uses `pow(ndv, 8.0)` — a tinted
highlight that peaks where the surface faces the camera — instead of `pow(1-ndv, 3)`
white. Item 4 of the list ("no specular highlight") still holds for the dormant field,
which is where it was measured.

Verified by reading pixels back from the bladder: solid gold interior with the fluid
meniscus visible through it, dormant neighbours pale pink with legible edges.
Order-independence is unaffected and still asserted — `assertOrderIndependent` and
`assertRimOrderIndependent` run on every material at construction.

---

## 3. Camera and layout

| Property | Value | Evidence |
|---|---|---|
| Projection | perspective, **very low FOV** | parallel-looking silhouette edges; lung left/right edges are near-parallel, not splayed |
| FOV estimate | **18–24°** | brain (top) and pelvis (bottom) show almost no perspective size difference across ~0.7 m of vertical extent |
| View direction | dead-on anterior, ±small yaw | frames 02/03/04/10/11 all front-on; frame 12 is a slight left yaw (~12°) and slight pitch |
| Body framing | body occupies ~52 % of viewport height, centred horizontally, centred slightly below optical centre | frame 02 |
| **Exploded stack** | brain floats **detached**, ~1 brain-height gap above the thorax | frames 02, 03, 04, 10, 11 — unmistakable, and anatomically impossible: this is deliberate |
| Thoracic group | lungs + heart + trachea + oesophagus, joined | frame 04 |
| Abdominal group | stomach/liver/intestines/bladder, slight gap under the diaphragm | frames 02, 03 |
| Focus behaviour | on select, camera dollies in and re-centres on the organ | frame 12 (stomach close-up) vs frame 04 (stomach at body framing) |
| Focus transition | smooth, no cut | **(inferred)** |

Frame 03's crop shows the body pushed left of centre with the label overlaid — i.e.
the label is drawn in screen space at the organ's projected centroid, and the
composition tolerates it overlapping the organ.

---

## 4. Typography

| Property | Value |
|---|---|
| Family | rounded geometric sans, single-storey `a`, very round `o`/`e`, short descenders. Consistent with **Nunito / Varela Round / M PLUS Rounded 1c** |
| Weight | 700 for all chip values and labels; 400–500 for marketing body copy |
| Figures | **tabular** — `126 \| 77`, `123 \| 74`, `80 \| 11` all occupy identical widths; `61.5%`/`65.4%`/`69.4%` never shift the chip |
| Letter-spacing | slightly positive on labels (`Large Intestine`, `Cardiac Arrest`) ≈ +0.02 em |
| Chip value size | ≈ 17 CSS px |
| Organ chip label size | ≈ 17 CSS px, white on red |
| Condition tag size | ≈ 15 CSS px |
| Screen-space organ label | ≈ 34 CSS px, near-black `#111`, bold, +0.03 em tracking |
| Marketing copy | ≈ 19 CSS px, `#4A4A4A`, line-height ≈ 1.5, centred |

---

## 5. HUD metric cluster (top-left)

Read from frames 02, 05, 10, 11. Vertical stack, left-aligned, ~12 CSS px gap,
inset ≈ 16 CSS px from the left and ≈ 30 px below the safe-area top.

| Row | Content | Shape | Colours |
|---|---|---|---|
| 1 | `Heart` pill + `69.4%` chip, side by side | pill `r=999px`; chip `r≈12px` | pill `#C8433A` bg / white text; chip `rgba(0,0,0,0.05)` bg / `#1A1A1A` text |
| 2 | heart glyph + `75` | chip `r≈12px`, width hugs content | same neutral chip; the glyph is a small pink `#E9868A` heart in frame 05 |
| 3 | ECG strip | chip `r≈12px`, ≈ 200 × 38 CSS px | bg `rgba(0,0,0,0.04)`; trace `#C0392B`–`#D0452F`, ~1.5 px stroke |
| 4 | `EF 60%` | chip | label `EF` slightly lighter than the number |
| 5 | `126 \| 77` | chip | the `\|` separator is lighter (`#9A9A9A`) than the digits |
| 6 | dark sparkline chip, leading badge `R` | chip `r≈12px`, bg `#5C5C57`, ≈ 130 × 34 CSS px | badge letter white; series lines cyan `#7FD6EE`, violet `#8B5CF6`, orange `#F0A93B` |

Frame 02's row 1 value `69.4%` sits next to `Heart`, with `EF 60%` separately on row 4:
these are **two different numbers**, so row 1 is not EF. Across frames it reads
`69.4 / 61.5 / 65.4 / 61.3` while EF reads `60 / 58 / 9`. Frame 11 shows `65.4%`
alongside `EF 9%` during arrest — so row 1 degrades far more slowly than EF,
consistent with some composite "health" score.

**Design decision for CORPUS:** we will not invent a "health %" with no physiological
definition (spec §0.4). Row 1 becomes **SpO₂ %**, which is a real, computed,
single-number readout and fits the same chip. Recorded in `docs/DECISIONS.md`.

### 5.1 Stomach panel (frame 04)

| Row | Content |
|---|---|
| 1 | `Stomach` pill (`#C8433A`) |
| 2 | `179 mL` chip — note the thin warm underline at the chip's bottom edge, a fill-level indicator |
| 3 | `pH` label + gradient track + handle + value `3`. Track ≈ 110 × 10 CSS px, `r=999px`, gradient **red → orange → yellow-green** left→right; handle is a small white-ringed dark dot near the left (pH 3 of a 0–8 range → ~37 %) |
| 4 | dark chip with a **↓** arrow badge and a 3-series sparkline (blue/violet/pink, near-flat rising) |
| 5 | dark chip with a **↑** arrow badge and a 2-series sparkline |

The ↓/↑ badges read as *absorption* (into the body) and *secretion/emptying* (out).

### 5.2 Emergency HUD (frames 10, 11)

- Condition tags are **right-aligned**, top-right, stacked, ~8 px gap.
- `V Fib` and `Cardiac Arrest`: filled `#C8433A`, white text, `r=999px`.
- `Hypovolemia`, `Hypotension`, `Hypoglycemia`: pale `#F6D8D6` fill, dark red `#A8322C` text — a lower severity tier.
- So **at least two severity tiers are colour-encoded**; the spec's three (`watch/warn/critical`) is a superset. Critical = solid fill, warn = tinted fill, watch = neutral chip.
- HR reads `00` during arrest (frame 11) — i.e. **zero is rendered, not blanked**.
- `EF 9%` and `80 | 11` during VF: diastolic is near-zero. Numbers keep updating during arrest.
- The ECG chip in frame 11 shows a **low-amplitude chaotic trace** filling the strip — VF.

---

## 6. Tool dock (frames 02, 06, 13)

- Bottom of the viewport, ~20 CSS px above the safe-area bottom.
- **Split into two clusters**: left = 2 buttons, right = 3 buttons. Not one centred bar.
- Left: blood drop (red `#D63A2F`, on a `rgba(0,0,0,0.05)` round chip) and hamburger.
- Right: body/person outline, scalpel, syringe — all thin black line icons.
- Frame 13 (defib mode): the right cluster changes — the middle icon becomes a **filled blood drop**, i.e. the active tool is indicated by a filled variant.
- Button: ≈ 44 × 34 CSS px, `r≈12px`, bg `rgba(0,0,0,0.05)`.
- Frame 06 shows the dock hosted on a slightly lighter rounded card — the dock sits on the page, not on a bar.
- Icon order differs between frames 02 and 04 (`scalpel, person, syringe` vs `person, scalpel, syringe`), so ordering is not load-bearing. We fix ours as **person · scalpel · syringe**.

---

## 7. Drug drawer (frames 06, 07)

Bottom sheet, `r≈22px` top corners, bg ≈ `#E8E8E8` at ~92 % over a blurred backdrop.

| Element | Spec |
|---|---|
| Tabs | `Drugs` / `Food` / `Biologics`, left-aligned, ≈ 19 CSS px, active `#111` bold, inactive `#A8A8A8` |
| Group header | `Catecholamine`, `Antiarrhythmics`, `Electrolyte`, `Fluids` — ≈ 17 px, `#B0B0B0`, above each group |
| Drug pill | `r=999px`, height ≈ 40 CSS px, padding ≈ 16 px, **bold black text on a saturated fill** |
| — catecholamine fill | `#FF2D6B` hot pink/magenta |
| — antiarrhythmic fill | `#38C6F4` cyan |
| — electrolyte fill | `#A9BCF5` periwinkle |
| — fluids fill | `#C3B9F0` pale violet (partially cut off at frame bottom) |
| Route buttons | right-aligned on the same row, `r≈12px`, bg `rgba(0,0,0,0.06)`, dark bold label |
| Route right-alignment | buttons are **right-anchored**, so a drug with one route shows one button at the far right and a drug with two shows both — the rightmost column always lines up |
| Row height | ≈ 62 CSS px |
| Routes shown | Epinephrine → IV Push · Norepinephrine → IV Push, IV Drip · Dopamine → IV Push, IV Drip · Adenosine → IV Push · Amiodarone → IV Drip · Iron → Oral · Potassium → Oral, IV Push · Calcium → Oral |

Note: the drawer renders a **pink glow** behind the sheet in frames 06/07 — that is the
blurred body showing through, not a decoration.

---

## 8. Receptor panel (frame 09)

A **dark** card — the only dark surface in the app.

| Element | Spec |
|---|---|
| Card | bg `#3D3D3D`, `r≈22px`, title `Receptors` centred, white bold ≈ 17 px |
| Chart well | bg `#141414`, `r≈16px`, inset ≈ 12 px, ≈ 300 × 100 CSS px |
| Chart | multi-series line, ~1.5 px, no axes, no grid, no labels. Colours: hot pink `#FF2D6B`, crimson `#E8354F`, warm yellow `#F0B24B`, white `#F2F2F2` |
| Chart shape | flat → **sharp sigmoid rise** ≈ 40 % across → new plateau. This is a binding-kinetics ramp, not a step: the rise takes visible time |
| Receptor pill | `r=999px`, ≈ 34 px tall, bold black text |
| — DAT / TAAR / SERT | `#FF2D6B` → `#F0284C` (transporters, hot) |
| — 5-HT2A / 5-HT2C | `#E24BE8` magenta |
| — H1 | `#8B5CF6` violet |
| Occupancy bar | **dot matrix**, right-aligned, ≈ 20 columns × 3 rows of small dots |
| Dot states | filled = white `#FFFFFF`; empty = `#5A5A5A` |
| Readings | DAT ≈ 1 col filled (~5 %); TAAR ≈ 13 cols (~65 %); SERT ≈ 2 cols (~10 %); 5-HT2A 0; 5-HT2C 0; H1 ≈ 1 col |
| Sort | descending by occupancy? **No** — TAAR (65 %) sits below DAT (5 %). The panel is sorted by target class, not live occupancy |

**Decision:** the spec (§8.5) asks for occupancy-descending sort with a reorder tween.
That is more useful than the reference's fixed order and does not conflict with the
look, so we implement the spec's sort. Recorded in `docs/DECISIONS.md`.

The dot matrix is 3 rows tall in the reference but the spec asks for 20 dots at 5 %
each. We render **20 columns × 3 rows = 60 dots, filling column-major**, so one
column = 5 % and the visual matches while the semantics stay clean.

---

## 9. Defibrillation overlay (frame 11)

| Element | Spec |
|---|---|
| Pad zone | rounded rect, `r≈14px`, ≈ 62 × 96 CSS px, **stroke only** `#B4342C` ~2 px, no fill |
| Labels | `R` and `L` centred in each, `#B4342C`, bold ≈ 17 px |
| Placement | R pad upper-right of the sternum (viewer's left), L pad lower-left lateral (viewer's right) — i.e. **anterolateral**, mirrored because we view the body from the front |
| Cancel | centred below the body, chip `r≈12px`, bg `rgba(0,0,0,0.06)`, dark bold text |
| Background | emergency cream `#FBF3D0` wash is visible top and right |
| Body state | organs stay dormant-pink; heart is **selected red** and visibly small (no effective filling) |

Frame 13 confirms `Cancel` persists while the dock stays interactive.

---

## 10. Inside-the-organ rendering (frames 12, 04, 02)

- **Frame 12** is the money shot: the stomach shows a *flat horizontal fluid surface*
  with a distinctly **brighter elliptical ring** at the cut plane — a meniscus band.
  The fluid below is more saturated than the stomach wall above it.
- The cut plane is **world-axis-aligned horizontal**, and the ellipse is the plane ∩ mesh
  cross-section projected under the low-FOV camera. That matches "discard fragments
  above `y = yPlane`" plus a rim band at `|y − yPlane| < ε`.
- **Frame 02**: the selected heart shows internal structure — darker chambers inside a
  lighter wall. Two nested surfaces, consistent with separate LV/RV cavity meshes.
- **Frames 11/12**: the oesophagus is rendered as a saturated red tube running the full
  thoracic height, so a *tube* geometry exists for the GI path and the bolus travels it.

---

## 11. Motion (inferred from stills plus the reference's own claims)

Not directly measurable from stills, but two things are provable:

- Frames 02 and 05 show the same heart at **different scales** relative to the
  thorax (frame 05's heart is larger) — the heart mesh scales with the cardiac cycle.
- Frame 11's arrested heart is **visibly smaller** than frames 02/05 — consistent with
  scale being driven by chamber volume, which collapses in VF.

That is enough to confirm the spec's §6.7 requirement: pulse is sim-driven, not a CSS keyframe.

---

## 12. Extracted token set (goes straight into `src/ui/tokens.css`)

```
--bg-neutral      #F0F0F0
--bg-cream        #F6F4E4
--bg-arrest       #FBF3D0
--ink             #141414
--ink-dim         #6E6E6E
--ink-faint       #A8A8A8
--chip-bg         rgba(0,0,0,0.05)
--chip-bg-strong  rgba(0,0,0,0.08)
--chip-dark       #5C5C57
--chip-darker     #3D3D3D
--well-black      #141414
--organ-active    #C8433A
--organ-heart     #B0232A
--organ-lung      #5B3A8C
--organ-stomach   #C8433A
--organ-colon     #8E2020
--tissue-tint     #F2C4C4
--accent-hot      #FF2D6B
--accent-cool     #38C6F4
--accent-blue     #A9BCF5
--accent-violet   #8B5CF6
--accent-magenta  #E24BE8
--accent-amber    #F0A93B
--severity-crit-bg   #C8433A      (white text)
--severity-warn-bg   #F6D8D6      (text #A8322C)
--severity-watch-bg  rgba(0,0,0,0.05)  (text #6E6E6E)
--radius-pill   999px
--radius-card    22px
--radius-chip    12px
--radius-well    16px
--dot-size        3.0   (device px)
--dither-strength 0.12
```

---

## 13. What we deliberately do **not** copy

- No asset, mesh, texture, icon, or shader from the reference product.
- No marketing copy. All strings in CORPUS are written fresh.
- The name "LIFE", the thix.co logo, and the hero card layout are not reproduced.
- The reference's undefined "health %" metric is replaced with SpO₂ (§5 above).
