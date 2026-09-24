# MASTER PROMPT — "CORPUS": Real-Time Human Physiology Simulator (Web)

> Paste this entire file into Claude Code as `SPEC.md` at the repo root, and attach the 13 reference screenshots to the first message. Rename `CORPUS` to whatever you want.

---

## 0. HOW TO USE THIS DOCUMENT (instructions to you, Claude Code)

1. **Read this entire file before writing a single line of code.**
2. **Study the 13 attached screenshots.** They are the visual and interaction target, not decoration. Before Phase 0, write `docs/VISUAL_AUDIT.md` listing every UI element, colour, radius, and state transition you can extract from them. I will review it.
3. **Build in the phases defined in §11. Stop at the end of each phase and report.** Do not run ahead.
4. **Never invent a physiological or pharmacological number.** Every constant goes in a `data/` file with a `source` field. If you don't have a real value, set it to `null`, add it to `docs/MISSING_CONSTANTS.md`, and make the UI render `—` instead of a fake number.
5. **Do not add a dependency without asking.** The stack in §2 is fixed.
6. **No mock data dressed as real output.** If the engine isn't wired yet, render `--` not a plausible-looking number.
7. Maintain `docs/MODEL_LIMITATIONS.md` from Phase 1 onward — every approximation, every simplification, every place the model diverges from real physiology.

---

## 1. PRODUCT STATEMENT

CORPUS is a browser-based, real-time simulation of an adult human body, rendered as a stack of translucent 3D organs. The user selects an organ to read live medical telemetry from it (ECG, EEG, GFR, gastric pH, bladder volume). The user administers drugs, food, and fluids via IV push, IV drip, or oral routes, and watches the body respond — through pharmacokinetics (where the drug goes), pharmacodynamics (which receptors it binds), and downstream physiology (what the organs do about it). An emergency mode lets the user run CPR and defibrillation on a crashing body.

It is an **educational toy with a real engine underneath**. The fidelity target is "a med student says *that's roughly right*", not "a cardiologist says *that's clinically valid*".

### Non-goals (do not build these)
- Patient-specific modelling, diagnosis, or dosing guidance.
- Anything that could be read as clinical advice. `NOT FOR CLINICAL USE` must be permanently visible in the UI footer and in the page `<title>` metadata.
- Multiplayer, accounts, or a backend. This is a fully static client-side app.
- Recreational-drug dosing tables. Psychoactive compounds may be modelled pharmacologically (receptor binding, PK curves) but the UI must never present a "how to take this" framing. Doses are fixed simulation presets, not user-entered mg/kg for real-world use.

---

## 2. FIXED STACK

| Layer | Choice | Why |
|---|---|---|
| Build | Vite 5+, TypeScript 5+ (`strict: true`) | fast HMR, no config bloat |
| 3D | **three.js r170+, raw (no react-three-fiber)** | we need full control of the render graph for OIT + custom post-processing |
| UI | React 18 + CSS Modules | HUD only. React never touches the WebGL canvas |
| State | Zustand | one store for UI state; sim state arrives via worker snapshots |
| Sim | Plain TypeScript in a **Web Worker** | zero Three.js/DOM imports (enforce with an ESLint `no-restricted-imports` rule) |
| Worker bridge | Comlink + a `SharedArrayBuffer` ring for the high-rate waveform channel | 20 Hz object snapshots are too slow for a 250 Hz ECG |
| Charts | Hand-rolled Canvas2D | no chart library. The ECG strip and sparklines are custom |
| Assets | glTF 2.0 (`.glb`), Meshopt-compressed | Draco is fine too, Meshopt decodes faster |
| Test | Vitest | unit tests on the sim core are mandatory |

### Performance budget (hard, test it in CI)
- 60 fps on a 2021 desktop at 1440p; **30 fps minimum on iPhone 12-class hardware** at DPR 2.
- Initial JS bundle < 400 KB gzipped (excluding three.js chunk).
- Total organ mesh payload < 6 MB gzipped, progressively loaded.
- Sim worker tick must complete in < 2 ms at 100 Hz on mid-tier mobile.

---

## 3. ARCHITECTURE — FOUR STRICTLY SEPARATED LAYERS

```
src/
  sim/              ← LAYER A: pure TS. No DOM. No three. No React.
    core/           ← integrator, clock, state vector, event bus
    systems/        ← cardio, respiratory, renal, gi, metabolic, neuro, thermal
    pharma/         ← pk.ts, pd.ts, receptors.ts, dosing.ts
    derive/         ← conditions.ts (emits Hypovolemia, V Fib, ...), waveforms/
    worker.ts       ← entry; owns the fixed-step loop
  render/           ← LAYER B: three.js only. Reads snapshots. Never writes sim state.
    scene/  materials/  postfx/  organs/  camera/
  ui/               ← LAYER C: React. Reads snapshots + Zustand. Dispatches intents.
    components/  panels/  tokens.css
  data/             ← LAYER D: JSON + TS types. Zero logic.
    organs.json  drugs.json  receptors.json  foods.json  procedures.json
  bridge/           ← snapshot schema, Comlink setup, SAB ring buffer
```

### The contract between layers
- **Layer A → B/C**: a `SimSnapshot` object at **20 Hz** (structured clone), plus a **`Float32Array` ring buffer at 250 Hz** for ECG/EEG/pressure waveforms via `SharedArrayBuffer`. If `SharedArrayBuffer` is unavailable (no COOP/COEP headers), fall back to transferring a `Float32Array` chunk every 50 ms and document the degradation.
- **B/C → A**: discrete `SimIntent` messages only — `{type:'ADMINISTER', drugId, route, dose}`, `{type:'SET_TIME_SCALE', x}`, `{type:'DEFIBRILLATE', joules}`, `{type:'CPR_COMPRESSION'}`. Never a direct state write.
- The renderer **interpolates** between the last two snapshots. Never let a 20 Hz snapshot rate produce 20 fps visuals.

---

## 4. LAYER A — THE SIMULATION CORE

### 4.1 Time model
Fixed timestep, accumulator pattern. `dt = 10 ms` (100 Hz) for the physiology loop, with the ECG oscillator sub-stepped at `dt/4` because its ODEs are stiffer. Wall-clock is decoupled: `timeScale ∈ {1, 5, 30, 300}` so the user can watch a drug distribute over 4 hours in 48 seconds. **A time-scale change must never produce a discontinuity in any state variable** — scale the number of sub-steps, never the `dt`.

Determinism: one seeded PRNG (`mulberry32`) owned by the core. Same seed + same intent log = byte-identical output. Write a test that proves it.

### 4.2 Cardiovascular
Lumped-parameter circuit analogue (this is the same family of model Pulse/BioGears use — see §7 for references).

- **Ventricle**: time-varying elastance. `P_v(t) = E(t) · (V_v − V_0)`, with `E(t)` a double-Hill activation function over the cardiac cycle. This gives you EDV, ESV, and therefore **stroke volume and ejection fraction for free** — the screenshots show `EF 60%`, `EF 58%`, and `EF 9%` during arrest, so EF must be a *computed output*, not a stored number.
- **Arterial tree**: 4-element Windkessel (Rc, C, R, L). Outputs systolic/diastolic → the `126 | 77` chip.
- **Frank–Starling**: contractility scales with preload (end-diastolic volume).
- **Baroreflex**: MAP error → sympathetic/parasympathetic tone → modulates HR, contractility, systemic vascular resistance, and venous unstressed volume. Use an Ursino-style two-limb reflex with a sigmoid afferent and first-order efferent delays (~2 s vagal, ~7 s sympathetic). **This reflex is what makes the whole thing feel alive** — without it, drugs produce step changes instead of overshoot-and-settle curves.
- **Blood compartment**: total volume, haematocrit, Na⁺/K⁺/Ca²⁺/Cl⁻, pH, HCO₃⁻, glucose, lactate.

### 4.3 ECG generation
Use the **McSharry–Clifford dynamical model** (IEEE TBME 2003) — three coupled ODEs producing a trajectory around a limit cycle, with five Gaussian events P, Q, R, S, T:

```
θ  = atan2(y, x)
ẋ = αx − ωy
ẏ = αy + ωx
ż = −Σᵢ aᵢ·Δθᵢ·exp(−Δθᵢ²/2bᵢ²) − (z − z₀)
where α = 1 − √(x²+y²),  Δθᵢ = (θ − θᵢ) mod 2π,  ω = 2π·HR/60
```

Baseline parameters (60 bpm, lead II morphology) go in `data/ecg_morphologies.json`:

| Event | θ (rad) | a | b |
|---|---|---|---|
| P | −π/3 | 1.2 | 0.25 |
| Q | −π/12 | −5.0 | 0.1 |
| R | 0 | 30.0 | 0.1 |
| S | π/12 | −7.5 | 0.1 |
| T | π/2 | 0.75 | 0.4 |

Rhythm modes, each a parameter set + a modifier: **NSR, sinus tachycardia, sinus bradycardia, atrial fibrillation** (randomise RR interval, delete the P event), **VT** (wide monomorphic, no P), **VF** (replace the limit cycle with band-limited 4–7 Hz noise — the flat-ish chaotic trace in screenshot 11), **asystole** (z → baseline wander only), **PEA**. `ω` is driven live by the cardiovascular HR, so the ECG and the numeric HR can never disagree.

`z₀` carries respiratory sinus arrhythmia — modulate it at the respiratory rate. It's a one-line change that makes the trace look real.

### 4.4 Respiratory
Tidal volume, respiratory rate, dead space, alveolar ventilation. Gas exchange: alveolar O₂/CO₂ partial pressures → arterial pO₂ → SpO₂ via the **Severinghaus** O₂ dissociation approximation:

```
SO₂ = 1 / ( 23400/(pO₂³ + 150·pO₂) + 1 )
```

Chemoreceptor drive: pCO₂ (dominant) and pO₂ (backup, kicks in below ~60 mmHg) → RR and tidal volume. This is what makes an opioid overdose scenario behave correctly.

### 4.5 Renal
GFR from renal plasma flow with **myogenic autoregulation** — GFR holds flat across MAP 80–180 mmHg, then falls off a cliff. That cliff is the entire point of the GFR readout: the user gives enough of a vasodilator, MAP drops below 80, and GFR collapses visibly. Urine output accumulates into bladder volume (the screenshots explicitly mention urine in the bladder). Renal drug clearance is proportional to GFR — so a hypotensive body clears renally-eliminated drugs more slowly, and the second dose hits harder. **Wire that feedback; it's the most educational loop in the app.**

### 4.6 Gastrointestinal
Screenshot 10 and 12 define this: a bolus travels a ~30-ft tract, becomes chyme, is excreted.

- Model the tract as an ordered chain of segments: `mouth → oesophagus → stomach → duodenum → jejunum → ileum → caecum → colon(asc/trans/desc) → rectum`.
- Each segment holds a list of `Digesta` objects: `{ volume, macros:{carb,fat,protein}, solidFraction, pH, drugPayload }`.
- **Gastric emptying**: power-exponential (Elashoff), `f(t) = 2^(−(t/t½)^β)`. Fat content raises `t½` — a fatty meal genuinely delays oral drug absorption, and that will be visible in the plasma curve. Ship it.
- **Gastric pH**: baseline ~1.5–2, rises on meal buffering, falls back with acid secretion. Drives the `pH 3` slider chip in screenshot 4.
- **Volume**: the stomach's `179 mL` chip is the summed digesta volume. Render a liquid meniscus inside the stomach mesh (see §6.5).
- Absorption: carbohydrate → glucose into portal blood in duodenum/jejunum; drug absorption is site-specific per drug entry.

### 4.7 Metabolic / endocrine
Bergman minimal model for glucose–insulin (`G`, `X` remote insulin action, `I`). Glucagon counter-regulation below ~70 mg/dL. Core temperature with a simple heat-balance equation, because several receptors in the reference (5-HT2A, TAAR) affect thermoregulation and the marketing copy in screenshot 8 explicitly names body temperature.

### 4.8 Derived conditions
A pure function `deriveConditions(state) → ConditionTag[]`, evaluated every tick. These are the coloured tags in screenshots 10 and 11:

```
Hypovolemia    bloodVolume < 0.85 × baseline
Hypotension    MAP < 65 mmHg
Hypertension   SBP > 140 or DBP > 90
Hypoglycemia   glucose < 70 mg/dL
Hyperkalemia   K⁺ > 5.5 mEq/L
Hypoxemia      SpO₂ < 90%
V Fib          rhythm === 'vfib'
Cardiac Arrest no effective cardiac output (CI < 1.0 L/min/m²)
```

Each tag carries a severity (`watch | warn | critical`) that drives its colour. Tags must have **hysteresis** — a ±3% dead band — or they'll flicker on and off at the threshold and look broken.

---

## 5. THE PHARMACOLOGY ENGINE

This is the differentiator. Screenshots 6–9 show it clearly: a drug drawer with route buttons, and a live receptor-occupancy panel.

### 5.1 Routes
| Route | Model |
|---|---|
| `IV_PUSH` | instantaneous mass into central compartment |
| `IV_DRIP` | zero-order infusion at `rate` until stopped; must be cancellable |
| `ORAL` | first-order absorption from gut segment, with lag time and hepatic first-pass extraction `(1 − E_H)` |
| `IM` | first-order from depot, slower `ka` |
| `INHALED` | direct-to-arterial with a pulmonary bioavailability factor |

### 5.2 Pharmacokinetics
Two- or three-compartment, integrated as ODEs (**not** closed-form bi-exponential — closed form breaks the moment you add a second dose or an infusion):

```
dA₁/dt = −(k₁₀ + k₁₂ + k₁₃)·A₁ + k₂₁·A₂ + k₃₁·A₃ + input(t)
dA₂/dt =  k₁₂·A₁ − k₂₁·A₂
dA₃/dt =  k₁₃·A₁ − k₃₁·A₃
C_p = A₁ / V₁
```

- `k₁₀` splits into renal and hepatic fractions. Renal scales with live GFR. Hepatic scales with hepatic blood flow.
- Saturable metabolism (ethanol, phenytoin): Michaelis–Menten `−Vmax·C/(Km + C)` instead of first-order.
- Track free vs bound: `C_free = C_p × (1 − f_bound)`. **Only free drug binds receptors.**

### 5.3 Pharmacodynamics
Receptor occupancy with explicit binding *kinetics*, not instantaneous equilibrium — the animated ramp in screenshot 9 has a visible rise time, so:

```
dΩ/dt = k_on·C_free·(1 − Ω_total) − k_off·Ω
```

Where multiple ligands compete for one receptor, normalise so `Σ Ω ≤ 1` and apply the Gaddum competitive-antagonism correction. Effect from occupancy via Hill/Emax:

```
E = E₀ + (E_max · Ω^γ) / (EC₅₀^γ + Ω^γ)
```

Each drug entry declares `intrinsicActivity ∈ [−1, 1]` per receptor: `1` = full agonist, `0.3` = partial, `0` = neutral antagonist, `−1` = inverse agonist. For transporters (DAT, NET, SERT) `intrinsicActivity < 0` means reuptake inhibition and `> 0` means substrate/releaser — that distinction is exactly why the reference app shows DAT and TAAR together.

### 5.4 Receptor registry (`data/receptors.json`)
Minimum set, each with tissue distribution and downstream effect vector:

`α1, α2, β1, β2, β3, D1, D2, M2, M3, H1, H2, 5-HT1A, 5-HT2A, 5-HT2C, 5-HT3, GABA-A, μ-opioid, κ-opioid, nAChR, NMDA, CB1, DAT, NET, SERT, TAAR1, V1, AT1, insulin-R`

Effect mapping is a sparse matrix — receptor × organ-parameter × gain:

```json
{ "id":"beta1", "effects":[
  {"target":"cardio.contractility","gain": 0.9},
  {"target":"cardio.heartRate",    "gain": 0.7},
  {"target":"renal.reninRelease",  "gain": 0.4}]}
```

### 5.5 Drug schema (`data/drugs.json`)
```ts
interface Drug {
  id: string; displayName: string;
  class: 'catecholamine'|'antiarrhythmic'|'electrolyte'|'fluid'|'opioid'|
         'sedative'|'anaesthetic'|'stimulant'|'psychedelic'|'antihypertensive'|'other';
  routes: Route[];
  presetDoses: { route: Route; amount: number; unit: string; label: string }[];
  pk: { V1_L:number; V2_L?:number; V3_L?:number;
        k10_min:number; k12_min?:number; k21_min?:number; k13_min?:number; k31_min?:number;
        renalFraction:number; proteinBound:number; MW_gmol:number;
        ka_min?:number; lagTime_min?:number; bioavailability?:number;
        vmax?:number; km?:number };
  targets: { receptorId:string; Ki_nM:number|null; intrinsicActivity:number;
             kon?:number; koff?:number; source:string }[];
  directEffects?: { target:string; gain:number; note:string }[]; // e.g. amiodarone on channels
  notes: string;
  sources: string[];      // REQUIRED. DOI or database accession. No source, no entry.
}
```

**Phase-3 drug set** (matches the reference screenshots exactly): Epinephrine, Norepinephrine, Dopamine, Adenosine, Amiodarone, Iron, Potassium, Calcium, Normal Saline. Then expand.

### 5.6 DATA SOURCING — REAL NUMBERS, WHERE THEY COME FROM

Every number in this app exists in a free, legally clean, machine-readable source. Typing JSON by hand is not the plan — **build an ingestion pipeline in `tools/ingest/` and generate `data/*.json` from it**, with per-field provenance. That is what turns "9 drugs" into "200 drugs" without it becoming a data-entry job.

#### Tier 1 — Receptor binding (Ki, EC₅₀, IC₅₀, Kd)
**IUPHAR/BPS Guide to PHARMACOLOGY (GtoPdb)** — `guidetopharmacology.org`. Expert-curated ligand–target affinities, exactly the dataset behind the receptor panel in the reference screenshots.
- Database licensed **ODbL**; contents **CC BY-SA 4.0**. Attribution required in `CREDITS.md`.
- Bulk downloads: `interactions.csv`, `ligands.csv`, `targets_and_families.csv`.
- REST/JSON web services at `/services/` for targeted lookups.
- Gives you `affinity` (usually pKi or pEC₅₀ — **convert: `Ki_nM = 10^(9 − pKi)`**), `action` (agonist / antagonist / inhibitor / channel blocker), `ligand_id`, `target_id`, and the primary literature reference. Map `action` → the `intrinsicActivity` sign in the drug schema.

Secondary, when GtoPdb is thin: **ChEMBL** (CC BY-SA 3.0, REST API + bulk) and the **PDSP Ki Database** (UNC, free, strong on CNS targets — 5-HT subtypes, TAAR, monoamine transporters).

#### Tier 2 — Pharmacokinetics (V_d, CL, t½, protein binding, F, EC₅₀ for effects)
**Start with the Pulse Physiology Engine substance files.** This is the highest-leverage source in the whole project and almost nobody knows it exists:
- Pulse is **Apache 2.0** — permissive, commercial-use-safe, no share-alike.
- It ships one **substance file per drug** containing physicochemical properties, PBPK parameters, and a pharmacodynamic block with `EC50`, `EMaxShapeParameter` (the Hill slope η), and per-effect modifiers for heart rate, contractility, systemic vascular resistance, respiration rate, tidal volume, sedation, and more. Its drug and endocrine methodology docs cite the literature for every value.
- Its PD equation is the same Emax form as §5.3, so the values drop almost directly into our schema.
- **Take the data and the equations. Do not compile the engine.** (See §7.)

Then extend with **DailyMed / openFDA**:
- DailyMed (US National Library of Medicine) and the openFDA `drug/label` API expose every FDA Structured Product Label. Public US government resource, free, no API key, bulk download available.
- The **Clinical Pharmacology (SPL section 12.3)** block of each label contains volume of distribution, clearance, elimination half-life, plasma protein binding, and bioavailability — in prose, so you'll need a parser, but it is authoritative and free.
- openFDA requires its standard disclaimer be carried; it imposes no attribution licence.

Then published population-PK literature via the PubMed Central open-access subset. Put the DOI in the `sources` array.

**Do NOT use DrugBank.** Its free tier is academic-only; commercial use requires a paid licence. It is the obvious first hit and it is a licensing trap.

#### Tier 3 — Physiology baselines and system equations
Pulse's methodology documentation covers cardiovascular, respiratory, renal, GI, endocrine, and drug systems with literature references for every parameter. Read it, cite it, reimplement in TypeScript. Supplement with standard references for normal ranges (Guyton, West) — read and cite, never scrape.

#### The ingestion pipeline (`tools/ingest/`)
```
tools/ingest/
  fetch_gtopdb.ts      → downloads CSVs, caches under .cache/
  fetch_pulse.ts       → pulls substance files from the Pulse repo
  parse_spl.ts         → openFDA/DailyMed SPL 12.3 → PK candidates
  normalise.ts         → unit conversion, pKi→Ki_nM, target-name → our receptorId
  emit.ts              → writes data/drugs.json + data/receptors.json
  report.ts            → writes docs/MISSING_CONSTANTS.md
```
Rules the pipeline must enforce:
- Every emitted numeric field carries `{ value, unit, source, sourceUrl, confidence }`.
- **Unit normalisation is not optional.** GtoPdb gives log-scale affinities; SPL gives L/kg and mL/min; our engine wants nM, L, and min⁻¹. Do the conversion in `normalise.ts`, once, with unit tests. A silent L/kg → L error will make a drug look 70× too potent and it will not be obvious.
- A field with no source is `null`. It renders as `—` in the UI, contributes zero to the engine, and is listed in `MISSING_CONSTANTS.md`.
- **Never interpolate, average, or estimate a plausible-looking Ki or clearance.** A wrong number that looks right is worse than a missing one, because it teaches the user something false with full confidence.
- Re-running the pipeline must be idempotent and must diff cleanly against the committed `data/*.json`.

---

## 6. LAYER B — RENDERING SPEC

The look in the screenshots is specific and achievable. Break it into six pieces.

### 6.1 Scene & camera
- Perspective camera, **low FOV (18–24°)** — this gives the near-orthographic, flattened look in every screenshot. A default 50° FOV will immediately look wrong.
- **Exploded vertical stack layout**: brain detached and floating above the thorax with a gap; thoracic group; abdominal group. This is a deliberate design choice, not anatomy. Put per-organ-group `layoutOffset` vectors in `data/organs.json` so the explosion is data-driven and animatable.
- Camera: damped orbit with a **constrained polar range** (±35° from front). Never let the user get under or behind the body — the OIT and the flat lighting only look right from the front hemisphere.
- Organ focus: on selection, `lerp` the camera target to the organ's bounding-sphere centre over 600 ms with an ease-out cubic, and dolly to frame it. Never cut.

### 6.2 TRANSPARENCY — THE CORE ARCHITECTURE (read this twice)

Fifteen nested translucent organs is normally the hardest problem in the project. Sorted alpha blending fails because the meshes interpenetrate; depth peeling needs 6–10 passes; weighted-blended OIT works but is an approximation that goes milky and flat with many low-alpha layers.

**None of that is needed here, because of what the reference aesthetic actually is.** Look at the screenshots: the background is light cream, the tissue is *darker* than the background, and overlapping organs get *more* saturated. That is not emissive glass. That is **absorption** — tinted glass on a bright backdrop.

Absorption means multiplication. And **multiplication is commutative**, so:

> **Multiply blending is exactly order-independent. Not approximately. Exactly.**

Better still, per-channel transmittance `T = exp(−σd)` composited by multiplication gives
`T₁·T₂·…·Tₙ = exp(−Σσᵢdᵢ)` — the product of transmittances **is** Beer–Lambert accumulated through the whole stack. You get physically correct optical absorption, in any draw order, with **zero render targets, zero composite passes, zero sorting, and WebGL1 compatibility.**

This is strictly better than OIT for this look. Do not implement weighted-blended OIT. Implement this.

#### The four render buckets

| # | Bucket | Blend | Depth | Order-independent? |
|---|---|---|---|---|
| 0 | Opaque (future: skin, skeleton) | Normal | write ✓ test ✓ | n/a |
| 1 | **Organ absorption shells** (all organs) | **Multiply** | write ✗ test ✗ | ✅ exact (commutative) |
| 2 | **Fresnel rim / glow** (all organs) | **Additive** | write ✗ test ✗ | ✅ exact (commutative) |
| 3 | **Selected organ + interior contents** | Normal alpha | write ✓ test ✓ | manual sort, ≤5 objects |

Each organ is **two `THREE.Mesh` instances sharing one `BufferGeometry`** (zero extra memory), one per material, with `renderOrder` 10 and 20. Fifteen organs = 30 draw calls. Irrelevant on any GPU made this decade.

#### Bucket 1 — absorption material

```js
// src/render/materials/OrganAbsorption.ts
new THREE.ShaderMaterial({
  uniforms: {
    uTint:      { value: new THREE.Color(0.95, 0.72, 0.74) }, // pale pink
    uDensity:   { value: 0.12 },   // dormant 0.12 | hovered 0.25
    uEdgeGain:  { value: 2.5 },
    uEdgePower: { value: 2.0 },
  },
  side: THREE.DoubleSide,          // front AND back wall both absorb — physically right
  transparent: true,
  depthWrite: false,
  depthTest: false,                // organs never occlude each other
  blending: THREE.CustomBlending,
  blendEquation: THREE.AddEquation,
  blendSrc: THREE.DstColorFactor,  // result = srcColor × dstColor
  blendDst: THREE.ZeroFactor,
  vertexShader, fragmentShader,
});
```

```glsl
// organ_absorption.frag
uniform vec3  uTint;
uniform float uDensity;
uniform float uEdgeGain;
uniform float uEdgePower;
varying vec3  vNormalW;
varying vec3  vViewDirW;

void main() {
  vec3  N   = normalize(vNormalW);
  vec3  V   = normalize(vViewDirW);
  float ndv = abs(dot(N, V));              // abs() => front and back faces behave alike

  // Grazing rays travel further through the shell wall.
  float path = 1.0 / max(ndv, 0.08);
  float edge = pow(1.0 - ndv, uEdgePower);
  float sigma = uDensity * (path + uEdgeGain * edge);

  // Per-channel absorption coefficient. uTint=white => no absorption => identity for multiply.
  vec3 absorption = vec3(1.0) - uTint;
  vec3 T = exp(-sigma * absorption);

  gl_FragColor = vec4(T, 1.0);             // multiply blend consumes .rgb only
}
```

`uTint = white` is the identity element for multiply, so an organ fading out is a clean `uDensity → 0` tween with no popping and no sorting change.

#### Bucket 2 — rim material

```js
blending: THREE.AdditiveBlending,   // dst += src·srcAlpha  — also commutative
side: THREE.DoubleSide, depthWrite: false, depthTest: false, transparent: true
```
```glsl
// organ_rim.frag
uniform vec3  uRimColor;    // near-white, slight warm bias
uniform float uRimPower;    // 3.0
uniform float uRimGain;     // 0.55  (selected organ: 1.0)
void main() {
  float ndv = abs(dot(normalize(vNormalW), normalize(vViewDirW)));
  float f = pow(1.0 - ndv, uRimPower);
  gl_FragColor = vec4(uRimColor * f * uRimGain, 1.0);
}
```
This produces the bright white organ outlines visible in every screenshot. Bloom (§6.6) then blooms the rim, not the body — which is exactly the reference's soft halo.

#### Bucket 3 — selected organ and interior contents
The selected organ (0.92 alpha), heart chamber cavities, and gastric/bladder fluid are at most ~5 objects. Render them last with normal alpha blending, `depthWrite: true`, manually sorted back-to-front by camera distance each frame. Five objects sort trivially and correctly. **You may use `MeshPhysicalMaterial.transmission` here** — one transmissive hero object is affordable; fifteen is not.

#### Why this also solves lighting
Notice there is no diffuse or specular term anywhere above. Form reads entirely from absorption thickness plus fresnel. That is deliberate, and it is the second reason this design works: **with no diffuse shading, surface detail is invisible.** Mesh quality stops mattering. Hold that thought for §7.

#### Verify it
Write `tests/render/order-independence.test.ts`: render the organ set, shuffle the draw order with a seeded PRNG, render again, assert the two framebuffers are **bit-identical**. If they aren't, something in bucket 1 or 2 is writing depth or using a non-commutative blend. This test is cheap and it will catch the single class of bug that destroys this look.

### 6.4 Organ selection states
Three states, driven by store, animated with a 250 ms tween on the uniforms:

| State | Opacity | Colour | Rim | Emissive |
|---|---|---|---|---|
| `dormant` | 0.10–0.15 | pale pink `#F2C4C4` | 0.3 | 0 |
| `hovered` | 0.25 | pale pink | 0.6 | 0.05 |
| `selected` | 0.92 | saturated organ colour (heart `#B0232A`, lung `#5B3A8C`, stomach `#C8433A`, colon `#8E2020`) | 1.0 | 0.15 |

The label (`Lung`, `Large Intestine`, `Stomach`) is a screen-space DOM element anchored to the projected organ centroid, **not** a 3D sprite — it must stay pixel-crisp and never scale with distance.

### 6.5 Rendering what's *inside* organs
This is the feature the reference copy brags about, so it can't be faked.
- **Stomach/bladder fluid**: a clipped mesh inside the organ. Compute a world-space Y plane from `fillVolume / organVolume`, pass it as a uniform, and discard fragments above it in the fluid shader. Add a slightly brighter elliptical meniscus band at the cut plane (clearly visible in screenshots 4 and 12).
- **Chyme/bolus**: a small capsule mesh translated along a `CatmullRomCurve3` that traces the GI centreline. `t` = the digesta object's fractional position in its segment. Scale and colour it by `solidFraction`. One curve per GI segment, defined once in `data/organs.json`.
- **Blood in the heart**: two inner meshes (LV/RV cavity) scaled by live chamber volume from the elastance model. The heart's visual pulse is then *driven by the sim*, not by a CSS animation. That is the whole trick.

### 6.6 Post-processing chain (order matters)
```
Scene → OIT composite → UnrealBloom (radius .4, threshold .85, strength .35)
      → ACES-ish tone map + warm colour grade
      → ORDERED DITHER / HALFTONE  ← the signature effect
      → subtle vignette
```
The dot grid visible across every screenshot is an **ordered dither / halftone screen**. Implement as a `ShaderPass`:
- 8×8 Bayer matrix, or a rotated dot screen at ~15° for a print-halftone feel.
- Grid sampled in **device pixels**: `vec2 cell = floor(gl_FragCoord.xy / dotSize)`. Expose `dotSize` (start at 3.0) and `strength` (start at 0.12).
- **Apply at native DPR, as the last pass before vignette.** If you dither before an upscale, it turns to mush. This is the single most common way to get this effect wrong.

### 6.7 Motion
- Heart: scale pulse driven by the elastance waveform phase — systolic contraction is fast, diastolic filling is slow. A symmetric sine looks immediately fake.
- Lungs: scale on the respiratory tidal waveform.
- Peristalsis: a travelling sine displacement along the GI curve parameter.
- All of it reads from the sim snapshot. **Zero CSS/GSAP animation on anything physiological.**

---

## 7. ANATOMY ASSETS — READ THIS BEFORE PHASE 0

### 7.1 The aesthetic is not in the geometry

The reference look cannot be copied by obtaining their meshes, and does not need to be. Decompose what actually produces that image:

| Variable | Contribution to the look |
|---|---|
| Multiply-blend Beer–Lambert absorption (§6.2) | ~35% |
| Camera at 18–24° FOV, front hemisphere only | ~15% |
| Palette: cream ground, one pale tissue tint, one saturated accent | ~15% |
| Additive fresnel rim + bloom on the rim only | ~15% |
| Halftone / Bayer dither at native DPR | ~10% |
| Exploded vertical stack with detached floating brain | ~7% |
| **Mesh detail** | **~3%** |

**There is no diffuse or specular shading anywhere in this design.** Form is carried entirely by absorption thickness and fresnel. When you are not lighting a surface, surface detail is invisible — a 6,000-triangle smoothed organ and a 200,000-triangle scan-accurate organ render *identically* through this material. The reference app's art direction is, whether by intent or luck, one that hides mesh quality completely.

So the answer on aesthetics is: **yes, exactly matchable, and the geometry is the easy part.** Get §6.2, §6.1, §6.6 and the palette right and it will look like the screenshots on placeholder spheres. Prove that in Phase 0 before anyone touches an OBJ file.

### 7.2 Phases 0–6: placeholder geometry, no exceptions

Procedural approximations — lathed profiles, metaballs, capsules — correct in **position, scale, pivot, and bounding sphere**, wrong in every detail. Every shader, interaction, camera move, and layout is developed against these. Asset acquisition must never block engineering. Commit the generator (`tools/placeholder-organs.ts`) so the app still builds from a clean checkout with no binary assets.

### 7.3 Phase 7: real meshes

| Source | Licence | Coverage | Verdict |
|---|---|---|---|
| **Z-Anatomy** | CC BY-SA 4.0 | full body, named, organised in Blender | **start here** — BodyParts3D already cleaned and labelled |
| **BodyParts3D** (DBCLS, Univ. of Tokyo) | CC BY-SA 2.1 JP | ~1,500 organs, OBJ, 127 MB reduced / 521 MB full | the upstream source; raw and noisy |
| **NIH 3D** (`3dprint.nih.gov`) | per-model: CC or public domain | strong heart library (MRI-derived), patchy elsewhere | good for a hero heart if you need PD-licensed assets |
| Commercial (TurboSquid / CGTrader / Sketchfab) | per-asset | varies | the only route to a fully proprietary asset set |

**Share-alike is a real constraint, decide it now.** CC BY-SA obliges you to release derivative *assets* under the same licence. Your application code is unaffected — the meshes are not your code, and linking to them is not a derivative work of them. If CORPUS is a commercial closed product and you cannot publish the processed `.glb` files under CC BY-SA, your only options are NIH public-domain models or paid commercial models. Record the decision in `CREDITS.md` **before** Phase 7, not after.

### 7.4 Why BodyParts3D meshes need work

They are segmentations of volumetric scan data, not modelled assets. Expect: non-manifold edges, inconsistent normals, interior faces, stair-step artefacts from voxel segmentation, loose geometry, and origins at the global body centre rather than the organ's own centroid. Dropping them straight into three.js gives you jagged silhouettes that read as "medical scan", not "designed object" — and silhouette is the *only* thing our material renders, so the fresnel rim will expose every one of those defects.

The fix is **voxel remesh → smooth → decimate**, in that order. Voxel remeshing discards the original topology entirely and rebuilds a watertight manifold at a uniform resolution; smoothing then removes the voxel stair-stepping; decimation gets you to budget. That sequence converts scan noise into the clean, idealised organ shapes the reference uses.

### 7.5 The pipeline — script it, don't click it

Write `tools/prep-assets/clean_organ.py`, run headless: `blender --background --python clean_organ.py -- --in raw/heart.obj --out dist/organ_heart.glb --tris 15000 --voxel 0.003`

```
 1. import OBJ
 2. Merge by Distance          threshold 0.0001
 3. Delete Loose (verts/edges), then Select Non-Manifold → report count
 4. VOXEL REMESH               voxel_size 0.002–0.004 m, adaptivity 0
                               ← the critical step; kills scan noise, guarantees watertight
 5. Shade Smooth + Smooth modifier   factor 0.5, 10–15 iterations
                               ← removes voxel stair-stepping
 6. DECIMATE (Collapse) to triangle budget
 7. Recalculate Normals Outside
 8. Origin → Geometry (Median)  ← REQUIRED for focus animation and pulse scaling
 9. Apply all transforms; scale to metres; Y-up; body centred at world origin
10. Export .glb, Meshopt-compressed
11. Append to manifest.json: bounding sphere, centroid, tri count, source, licence
```

Triangle budgets: heart 15 k · lungs 12 k each · brain 20 k · liver 10 k · GI tract 25 k total · stomach 8 k · everything else ≤ 6 k. **Total scene budget 140 k triangles.** These are generous *because* the material hides detail — if you are over budget, decimate harder before you optimise anything else.

Naming: `organ_<id>.glb`, ids matching `data/organs.json`: `heart`, `lung_l`, `lung_r`, `stomach`, `liver`, `kidney_l`, `kidney_r`, `bladder`, `brain`, `intestine_small`, `intestine_large`, `spleen`, `pancreas`, `oesophagus`, `trachea`.

**Interior meshes**: heart chamber cavities (LV/RV) and the gastric fluid volume are separate meshes. Generate them from the organ shell with a Solidify modifier at negative offset, then separate — do not model them by hand.

**GI centrelines**: hand-author nine Bezier curves through the GI segments in Blender, export as point arrays in the manifest, rebuild as `CatmullRomCurve3` at runtime. Mesh skeletonisation is the clever approach and it is not worth the time for nine one-off curves.

### 7.6 Physiology reference — borrow the physics, write the code

The **Pulse Physiology Engine** (Kitware, Apache 2.0, a fork of BioGears) has literature-referenced lumped-parameter models for every system in §4, plus the PBPK/PD substance data in §5.6. Read its methodology docs, take its parameters, reimplement the equations in TypeScript.

**Do not Emscripten-compile Pulse to WASM.** It is C++ with a protobuf-based common data model and a CMake build chain; getting it into a browser is a multi-week detour with a large bundle penalty and an opaque debugging story, and you would still need to write the entire rendering and UI layer against its API. It is a reference implementation, not a dependency.

---

## 8. LAYER C — UI SPEC

### 8.1 Design tokens (`src/ui/tokens.css`)
Extract exact values from the screenshots. Starting point:
```css
--bg-cream:   #F6F4E4;   /* active/simulating background */
--bg-neutral: #F0F0F0;   /* idle background */
--bg-arrest:  #FBF3D0;   /* emergency tint */
--chip-bg:    rgba(0,0,0,0.05);
--chip-dark:  #5C5C57;   /* the dark sparkline chips */
--organ-active:#C8433A;  /* selected-organ chip fill */
--accent-hot: #FF2D6B;   /* catecholamine pills */
--accent-cool:#38C6F4;   /* antiarrhythmic pills */
--accent-blue:#A9BCF5;   /* electrolyte pills */
--accent-violet:#8B5CF6; /* H1 / receptor group */
--radius-pill: 999px;
--radius-card: 22px;
--radius-chip: 12px;
```
Typography: a **rounded geometric sans with tabular figures** (Nunito, Varela Round, or M PLUS Rounded 1c). `font-variant-numeric: tabular-nums` on every metric chip — without it, `126 | 77` jitters its width every heartbeat and the whole HUD looks cheap.

### 8.2 Component inventory
`OrganChip` · `MetricPill` · `ECGStrip` · `EEGStrip` · `SparklineChip` (the dark ↑/↓ multi-series chips) · `PhScale` (gradient track + handle) · `ConditionTag` · `DrugDrawer` (tabs: Drugs / Food / Biologics; grouped rows; per-route buttons) · `ReceptorPanel` · `ToolDock` · `DefibPadPlacer` · `TimeScaleControl` · `DisclaimerBar`

### 8.3 Layout
HUD metric cluster: **top-left, vertical stack, left-aligned, never overlapping the body**. Tool dock: bottom, split — blood/menu left, body/scalpel/syringe right. Drawer: bottom sheet, snap points at 45% and 90%, swipe to dismiss. Respect `env(safe-area-inset-*)`.

### 8.4 ECGStrip implementation
Canvas2D. Ring buffer of 250 Hz samples. Sweep-style: draw left→right, erase a ~20 px band ahead of the write head (the classic monitor look), with a short alpha-fade trail. Calibrate to **25 mm/s** so the trace has clinically familiar proportions. Redraw only the dirty column range, never the whole canvas — this is a 60 fps component and full redraws will show up in your frame budget.

### 8.5 ReceptorPanel
- Dot-matrix occupancy bar: 20 dots = 5% each, filled left to right, tinted by receptor group. Match screenshot 9 exactly.
- Live multi-series line chart above it, 60-second rolling window, one line per receptor, autoscaled.
- Sort receptors by current occupancy descending, with a **500 ms reorder tween** so rows don't teleport.

### 8.6 Interaction map
| Input | Action |
|---|---|
| Tap organ | select → focus camera → open organ panel |
| Tap background | deselect → return to body framing |
| Drag | orbit (constrained) |
| Pinch / wheel | dolly |
| Blood-drop icon | toggle circulatory overlay |
| Body icon | body/patient config (sex, mass, age, baselines) |
| Scalpel icon | procedure mode |
| Syringe icon | open drug drawer |
| Defib mode | tap R pad zone → tap L pad zone → CHARGE → SHOCK |

---

## 9. PROCEDURES

- **CPR**: each compression intent injects a stroke volume ≈ 25–30% of normal for one beat and decays over ~1.2 s. Compression rate quality feedback at 100–120/min. Maintains *some* coronary perfusion, which gates defibrillation success.
- **Defibrillation**: pad placement (anterolateral R/L as in screenshot 11) → charge (120/150/200 J) → shock. Conversion outcome is **probabilistic**, seeded, and conditioned on rhythm, downtime, and coronary perfusion pressure. Shocking asystole does nothing — model that correctly, it is the single most valuable teaching moment in the whole app.
- **IV access**, **fluid bolus**, **intubation** (secures airway, enables ventilation control).

---

## 10. GUARDRAILS

1. `NOT FOR CLINICAL USE — EDUCATIONAL SIMULATION` permanently visible, not dismissible.
2. First-run modal explaining the model is an approximation and naming its major limitations.
3. No free-text dose entry in mg/kg for real-world scenarios. Preset doses only, labelled as simulation values.
4. Psychoactive compounds: pharmacology may be modelled; the UI must present receptor science, never usage guidance. No "how to take", no route optimisation, no potency comparison framing.
5. `docs/MODEL_LIMITATIONS.md` linked from the UI.
6. Accessibility: every metric has a text equivalent; colour is never the only signal for a condition tag; respect `prefers-reduced-motion` (freeze organ pulse, keep numbers live).

---

## 11. BUILD PHASES — EXECUTE IN ORDER, STOP AFTER EACH

**Phase 0 — Skeleton + the look.** Vite/TS/React scaffold. Three.js scene, low-FOV camera, constrained orbit. **Placeholder organ primitives only** (§7.2). The full four-bucket blend architecture from §6.2 — absorption material, rim material, selection bucket. Post chain with working dither. **DoD: a static body on placeholder geometry that already reads as the reference screenshots, plus a passing `order-independence.test.ts`. If it doesn't look right on spheres, it will not look right on real organs — fix the shading, not the meshes.**

**Phase 1 — Sim core + vitals.** Worker, fixed-step integrator, SAB waveform ring. Cardiovascular + baroreflex + McSharry ECG. HUD: HR, BP, EF, ECGStrip. Time-scale control. **DoD: a beating heart whose mesh, ECG trace, and numbers are all driven by one state vector, holding 60 fps.**

**Phase 2 — Organ selection + panels.** Raycast selection, three material states, focus camera, screen-space labels, per-organ panel layouts. Respiratory + renal systems so lungs and kidneys have real telemetry. **DoD: every organ selectable with live, non-fake data.**

**Phase 3 — Pharmacology.** Build `tools/ingest/` **first** (§5.6) — GtoPdb + Pulse substance files → generated `data/drugs.json` with provenance and unit tests on every conversion. Then the PK/PD engine, drug drawer, the 9 reference drugs, all routes. **DoD: (a) every drug constant traces to a real source via the pipeline, with `MISSING_CONSTANTS.md` generated; (b) epinephrine 1 mg IV push produces a physiologically sensible HR/BP/contractility trajectory that a pharmacology textbook would recognise, and a unit test asserts it.** Do not hand-type `drugs.json` — the pipeline is the deliverable, the JSON is its output.

**Phase 4 — Receptors.** Receptor registry, binding kinetics, occupancy panel with dot matrix and live chart. **DoD: occupancy curves rise and decay with correct time constants relative to the plasma curve.**

**Phase 5 — GI + food.** Segment chain, gastric emptying, pH, glucose absorption, animated bolus→chyme along the centreline, fluid-level shader. **DoD: eat a meal, watch it traverse, see glucose rise and fall.**

**Phase 6 — Emergency mode.** Arrest rhythms, condition tags, CPR, defibrillation, the emergency tint. **DoD: a full arrest → CPR → shock → ROSC cycle runs end to end.**

**Phase 7 — Real assets + polish.** Mesh pipeline, LOD, progressive load, mobile perf pass, accessibility, full CREDITS/licence compliance.

---

## 12. TESTING

- **Determinism**: same seed + same intent log → identical snapshot hashes at t=60 s.
- **Homeostasis**: with no intervention, all vitals stay within physiological range for 24 simulated hours. No drift. This catches integrator bugs nothing else will.
- **Pharmacology golden tests**: for each drug, assert `Cmax`, `Tmax`, and terminal half-life fall within the published range cited in its `sources`. Any drug failing its own citation is a bug in the drug entry or the engine — fail the build.
- **Step-response sanity**: haemorrhage 1 L → MAP falls, HR rises (baroreflex), GFR falls. Assert direction and rough magnitude.
- **Perf**: headless frame-time budget test; fail CI if the sim tick exceeds 2 ms or the 95th-percentile frame exceeds 33 ms at 1080p.

---

## 13. YOUR WORKING RULES

- Write `docs/VISUAL_AUDIT.md` before Phase 0 code. Write `docs/DECISIONS.md` as an ADR log.
- Keep `sim/` free of `three` and `react` imports — add the ESLint rule in Phase 0 so it's enforced from day one, not retrofitted.
- Every magic number in `sim/` must be a named constant in `data/` with a `source`.
- If a phase's Definition of Done isn't met, say so plainly and stop. Do not proceed to the next phase with known breakage.
- If something in this spec is wrong, physiologically or technically, **say so and propose the correction.** Don't silently implement something you know is broken.

---

*Reference screenshots: 13 frames from thix.co "LIFE". Used as visual and functional target. Build an original implementation — do not copy their assets, code, or copy text.*
