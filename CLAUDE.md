# CORPUS — working notes

Browser-based real-time human physiology simulator. Vite + TypeScript strict + three.js r170 + React 18 + Zustand + Comlink/SharedArrayBuffer + Vitest. Now tracked in git, but generated data and long probes are easy to clobber — read before you overwrite.

**Read this file instead of exploring the repo.** It exists so you do not have to re-derive the architecture from 27 ADRs and 40 source files. If something here is wrong, fix it here as well as in the code.

---

## The four rules that get work rejected

1. **NEVER INVENT A PHYSIOLOGICAL OR PHARMACOLOGICAL NUMBER.** Every constant carries `{value, unit, source, sourceUrl, confidence, note}` or is `null`. Enforced by `tests/data/provenance.test.ts`. **A `null` with a documented reason, or a corrected comment, always beats a plausible guess.** If a drug's `notes` claim something the data cannot do, fixing the prose is a legitimate and preferred outcome.
2. **Everything reaches the body through the EFFECT BUS** — `addEffect(s.effects, target, value)` in `src/sim/core/effects.ts` — never by writing another system's state directly. That is what lets adrenaline-the-infusion and adrenaline-from-fright arrive at `cardio.contractility` by the same path, and lets a beta blocker blunt both without knowing either exists.
3. **`NOT FOR CLINICAL USE — EDUCATIONAL SIMULATION`** stays permanently visible and in the page title. Nothing is framed as clinical or dosing advice. Controlled substances may be modelled pharmacologically, but no synthesis, sourcing, preparation or route-of-use content appears anywhere — *including in comments*. `tools/ingest/drug_manifest_2.ts` models methamphetamine in full clinical detail and holds that line; match it.
4. **Comments explain WHY, at length, and record what went wrong.** This codebase is written in prose. Terse code looks wrong here. Read any file in `src/sim/systems/` for the register.

## Layers (ESLint-enforced, do not cross)

| layer | may import |
|---|---|
| `src/sim` | pure TypeScript only — no DOM, no three, no React |
| `src/render` | three.js only |
| `src/ui` | React + CSS Modules |
| `src/data` | zero logic, data only |

## Traps that have each cost hours

- **The engine SILENTLY REJECTS any dose that is not a declared preset.** A refused dose looks *exactly* like a broken drug. Always read `presetDoses` from `src/data/drugs.json` and use `route`/`amount`/`unit` verbatim, then confirm `e.state.drugs.find(d => d.drugId === id)?.cp > 0` before trusting any measurement. This has fooled several people.
- **Never run `npx vitest` across the whole suite.** The machine is memory-constrained; the worker pool gets OOM-killed and takes concurrent work with it. Use `npx vite-node <script>` for probes (single process, lightest). If you must use vitest: one file, with `--pool=threads --poolOptions.threads.minThreads=1 --poolOptions.threads.maxThreads=2`.
- **`src/data/drugs.json` and `receptors.json` are GENERATED.** Never hand-edit. Change `tools/ingest/*` then run `npm run ingest:offline`. It must still report 89 drugs, 56 receptors, **0 unadjudicated cross-check disagreements** (ADR-018).
- **A dead effect-bus target is invisible.** A target written by a drug but read by no system makes that drug silently inert, with every test passing. Ten of these existed. Before adding a target, grep `effect(s, '<target>')` under `src/sim/` and confirm something consumes it.
- **Heredocs mangle TypeScript.** Backticks and `\n` inside `bash <<'EOF'` get eaten. Use the Write tool for any file containing template literals.

## Running a probe — the standard pattern

```ts
import { Engine } from '../../src/sim/core/engine';
import { P } from '../../src/sim/core/constants';
const DT = P('sim.dt_s');                                  // 0.01 s, 100 Hz fixed step
const e = new Engine(0x5eed);                              // boots ALREADY SETTLED at rest
e.applyIntent({ type: 'IV_ACCESS', on: true } as never);   // required before any IV route
e.applyIntent({ type: 'ADMINISTER', drugId, route, dose, unit, label } as never);
for (let i = 0; i < Math.round(seconds / DT); i++) { e.tick(DT); e.pending.length = 0; }
```
`tests/sim/inert-sweep.ts` is a complete worked example. Always compare against a no-drug control run of the same length.

**Resting baseline — check this after ANY change to `src/sim`:**
HR ~66, MAP ~94, CO ~4.8, RR ~12, SpO₂ ~97–98, PaCO₂ ~36–37, pH ~7.43, HCO₃ ~24, temp 37.0, glucose ~94 (flat from t = 0), cortisol ~17 µg/dL at the 08:00 start, rhythm `nsr`, consciousness 1.0, **no conditions firing — for 24 simulated hours** (`tests/sim/homeostasis.test.ts`).
If a resting body stops looking like this, you broke something. (Probe scripts: `.cache/probes/*.ts` — `baseline.ts`, `verify.ts` for heart–lung/acid–base/exercise, `newmech.ts` for the new drug mechanisms.)

## Key concepts you will need

- **Receptor reserve** (`ec50Occupancy`): 5 % occupancy can give 50 % effect. Dose–response curves look wrong until you know this. ADR-007.
- **`activationModel`** on each receptor, three cases in `src/sim/pharma/pd.ts`: `endogenous-agonist` (43) where `intrinsicActivity` is efficacy vs the endogenous ligand; `transporter` (4) where there is no tone to displace; `inhibition` (9) where gains are written for the *inhibited* state and `intrinsicActivity` is a direction, not an efficacy. Getting this wrong inverts a drug's action. A bound receptor contributes `max(0, IA)`: inverse agonists silence what they hold, no more (ADR-025).
- **Central vs peripheral is per EFFECT** (`central` flag on every receptor effect, decided in `tools/ingest/central_effects.ts`). A drug reaches central effects through `bbbPenetration` only — including the tone an antagonist displaces — and peripheral effects fully. `centralFraction` is now descriptive only (ADR-026). If you add a receptor effect whose target is central for one receptor and peripheral for another, add an explicit exception there.
- **Multiply-blend Beer–Lambert absorption** is order-independent *because multiplication commutes*. Buckets: 10 absorption (multiply), 20 rim (additive), 30 solid, 12 vessel walls, 22 flow particles. ADR-002.
- **Fixed 10 ms step**, cardio/ECG sub-stepped at dt/5. Determinism depends on it.

## The wider body (added 2026-09-24) — nine new subsystems, all through the bus

The model grew from a pharmacology bench into a body that has an environment, an
acid–base status, an immune system and a mind. Every one reaches physiology through
the **same effect bus** every drug uses, so a drug and a state argue in one place.

- **`systems/acidbase.ts`** — pH is no longer a frozen constant. It is Henderson–Hasselbalch on the live PaCO₂ and a metabolic bicarbonate pool; lactate and ketoacids buffer 1:1; the kidney compensates over days. Metabolic acidosis drives ventilation (Kussmaul), calibrated to Winters' formula. `tests/sim/acidbase.test.ts`.
- **`systems/myocardium.ts`** — THE HEART–LUNG LINK. A supply/demand oxygen ratio (arterial O₂ content × coronary reserve × perfusion pressure vs the rate-pressure product). Hypoxaemia and acidaemia weaken the pump; profound myocardial hypoxia degenerates an organised rhythm to PEA then asystole, and re-oxygenation returns a pulse (ROSC). This is why the lungs can now kill the heart, not only the reverse.
- **`systems/respiratory.ts`** was rewritten: oxygen is a STATE (alveolar + arterial + venous stores), so an apnoeic body desaturates on its real timescale instead of freezing. Shunt equation, Bohr shift, altitude/FiO₂ through inspired PO₂. The old apnoea CO₂ bug (dt² rise, 60× too slow) is fixed with a mass-balance CO₂ store.
- **`systems/environment.ts`** — room temperature, altitude, FiO₂, posture (standing pools blood → orthostatic drop). Operator-set; each consumed by the system it changes.
- **`systems/infection.ts`** — was a no-op; now a real pathogen engine reading `src/data/pathogens.json` (10 cited pathogens). Logistic burden checked by innate then adaptive immunity; fever/shunt/leak/diarrhoea/thrombocytopenia/haemolysis all onto the bus; antimicrobials kill via Emax on free concentration vs MIC (only in-spectrum). WBC, CRP, CD4, sepsis flag.
- **`systems/mind.ts`** — consumes the formerly-dead sign targets: pupils, muscle tone (flaccid paralysis stops ventilation), nausea→vomiting (empties stomach, loses acid → alkalosis), seizures (a huge brief metabolic event + lactate).
- **`systems/coagulation.ts`** — `blood.coagulation`/`plateletAggregation`/`plateletCount` now drive INR, aPTT, platelet count and the rate a bleed actually stops (haemostasis, read by pathology's bleed).
- **`systems/airway.ts`** — asthma + anaphylaxis. Histamine raises H1/H2 tone (so an antihistamine competes for it); the non-histamine mediators do the shock and bronchospasm an antihistamine can't touch.
- **Effect-bus attribution** (`core/effects.ts` `setEffectSource`/`effectBreakdown`) records WHO pushed each target, surfaced in `snapshot.effectSources` for the Impact panel. Display-only; the sum is unchanged.

New snapshot blocks: `environment, acidBase, mind, coagulation, infection, fluids, effects, effectSources, notices`. New intents: `SET_ENVIRONMENT, SET_POSTURE, DRINK_WATER, VOID_BLADDER, SET_BRONCHOSPASM, ALLERGEN_EXPOSURE, STOP_ALL_BLEEDING`. New drug data fields: `payload.glucose_g`/`hco3_mEq`, `hormoneAnalogue` (insulin/cortisol/glucagon/ADH/thyroxine given as drugs join the endogenous pool), `antimicrobial`.

**152 drugs** now (was 89): +63 including insulin, glucagon, vasopressin, neuromuscular blockers, vasodilators, anticoagulants, antibiotics/antivirals/antimalarial, dextrose, bicarbonate. Regenerate with `npm run ingest` (still 0 unadjudicated disagreements).

## State as of 2026-09-24

**Recently fixed — do not revert or re-investigate:**
- Receptor binding uses the exact exponential solution. Explicit Euler was unstable at `koff·dt > 2` and pinned occupancy at *exactly zero* for aspirin, paracetamol, caffeine/A1, phenytoin/Naᵥ.
- `directEffects` are normalised to each drug's own reference dose with a saturating ceiling.
- Respiratory drive is gated on cerebral perfusion pressure, the chemoreflex saturates, and CO₂ narcosis exists. ADR-021, ADR-022, ADR-024.
- **Isotonic volume changes no longer concentrate serum electrolytes.** A 1.5 L bleed used to drive serum Na 142→161 in one tick; whole blood is now tagged isotonic and excluded from the concentration step (only free-water fluxes move concentrations).
- **Resting consciousness is 1.0**, not 0.87: the CBF CO₂-reactivity term references the model's own resting PaCO₂ and there is a dead-zone at the top of the perfusion curve.
- **Exercise HR reaches the Karvonen/Tanaka max (~183), not the 240 clamp.** Central command attenuates the baroreflex chronotropy so the two no longer stack, and the baroreflex resets its operating pressure upward during exercise.
- **`neuro.stressAxis` reaches cortisol** — psychological stress now drives the HPA axis.
- **CaCl₂ antagonises hyperkalaemia** at the myocardium; NaN guards on `SET_TIME_SCALE` and `SET_BODY`; refused doses surface in `snapshot.notices`.
- All ten `renal.*`/dead targets from the old note are wired; the 30-odd dead targets the 2026-09-24 testers found are now consumed by the nine new subsystems above.

## State as of 2026-09-25 (round-2 testing)

**Fixed — do not revert:** every intent is refused whole if any numeric field is non-finite (`applyIntent`, four self-guarding intents exempt); 24 h rest is now flat (the evening cortisol trough was driving fever/sweat/plasma leak — cortisol's anti-inflammatory effect is `aboveBaselineOnly`); ADH and aldosterone drivers referenced to the model's own resting osmolality/K; glucose–insulin loop and circadian cortisol settled before t = 0 (ADR-027); consciousness is full above the syncope CBF threshold (no more 25–50 % "sedation" from mild hypocapnia); upright posture lowers brain CPP by a sourced hydrostatic column; vasopressin dosed in mg (label: 530 units/mg — it had been 530× overdosed); hormone drugs with their own receptors act once (receptor), not twice; `metabolic.glycogenolysis` was dead and is now consumed (additive, insulin-independent) with the glucagon gain calibrated to the GlucaGen label (1 mg SC → 136, IM → 138 mg/dL) and SC/IM absorption solved from the label's plasma peaks; adenosine/esmolol/remifentanil/succinylcholine marked `bloodClearance`; per-effect BBB gate + label/PET overrides (caffeine, theophylline, cetirizine); the acetazolamide `resp.drive` shortcut removed. UI: HUD no longer swallows touch gestures (one-finger orbit and pinch now work on phones), drag is direct manipulation, drawer clears the MEASURED bottom bar (`--corpus-bar-actual`), phone dock wraps instead of hiding tools, 44 px touch targets for speed and close buttons. Engine is ~30 % faster (memoised `P()`, no Hill evaluation for receptors at rest).

**Known outstanding / accepted limitations** (all in `docs/MODEL_LIMITATIONS.md`): central antimuscarinic arousal gain too strong (atropine 1 mg → consciousness ~0.57); glucose model's insulin brake is double-counted (glucagon gain is a model calibration); water load barely raises urine (renal water gain tiny); AV-nodal block is a rate cut even in sinus rhythm; no HPA negative feedback; acetazolamide's metabolic acidosis not modelled; psychedelic mydriasis absent (no sourced magnitude); resting H1 vascular tone overstated; circulation is reference-sized for any body mass; exercise consciousness dips slightly with hyperventilation; metabolic-alkalosis respiratory compensation deliberately weak; HIV/thyroxine act too slowly to see in one session (stated, not faked).

## UI layout (2026-09-25, after user review)

The body owns the WHOLE screen and is never resized by a panel. The dock is four floating chips (panels menu | body, procedures, drugs); every other panel is one tap into the menu. **Only one panel is open at a time** (`openOnly` in `store.ts`) in a single floating sheet — a right-hand card on wide screens, a bottom sheet (≤46vh) on phones — so panels can never overlap each other. The drawer and sheet stop above the MEASURED bottom bar. Portrait screens pull the camera back (`OrbitRig.homeDistance`) so the whole body sits between HUD and dock. Smoothness rules: React gets snapshots at ≤10 Hz (the viewer gets all 20), the viewer sends organ labels only when they move, and render resolution adapts to hold the frame rate (touch devices start at 1.5×). Do not reintroduce a layout column that shrinks the stage.

**Vessels are OFF at start** (`vascularVisible: false`, user choice 2026-09-26); a labelled **"Vessels" switch in the bottom-left corner** of the stage (`VesselToggle` in `ToolDock.tsx`, positioned above the measured bar) shows them — it is no longer a chip in the dock. `centrelines.ts` `growFineBranches` grows ~475 deterministic twigs (seeded PRNG, two generations) off the 60 named segments; `VascularSystem` merges them into ONE mesh per blood type (a handful of draw calls, not 475) in the same multiply bucket 12, and gives them sparse flow particles (`FINE_PARTICLE_DENSITY`). The twigs are illustrative microvasculature, not a traced anatomical atlas. The blood-contents legend is now its own panel ("In the blood" in the menu) — it used to auto-show with the overlay and would have owned the sheet. The top HUD is drawn with `transform: scale()` (0.86 desktop, 0.78 phone) so it shrinks without re-wrapping; its layout `max-width` is divided by the scale. **Action toasts** ("Morphine 4 mg IV") leave after 2 s (`LOG_LIFETIME_MS` in `store.ts`, CSS fade inside it); every toast caller also pushes a timeline event, so the record lives in the timeline. The timeline collapses to a small "Timeline N" pill; ticks, traces and the list appear only when it is opened.

**Administration sheet (rebuilt 2026-09-26, phone-first, iOS vocabulary).** `DrugDrawer.tsx` is a navigation stack inside one sheet: LIST (segmented Drugs/Food/Biologics, search, a sideways-scrolling row of group chips, inset-grouped rows with icon + routes subtitle + chevron, a "Running now" card) → DRUG PAGE (hero, every preset as a route card, the dose lever, a full-width predicted curve, About/Receptors/Sources) with ONE Give button pinned in a footer. The lever's state is lifted (`useDose` in `DoseControl.tsx`, keyed on the preset) so the pinned button can read it; quick steps ¼×…4× are multiples of the cited reference inside the worker's 0.1–10× bound. `DoseCurve` fills its container when `width` is omitted (ResizeObserver) — the fixed 420 px overflowed phones. An intravascular route with no IV line shows "needs an IV line · Place IV line" instead of a Give that the engine would refuse (the body STARTS with an IV line, `state.ts`). Drag the handle: up = full, down = half, down again = close; tap toggles. Guardrails unchanged: no dose field, presets only, provenance on every page.

## Docs worth reading, when relevant

`docs/DECISIONS.md` (27 ADRs — the reasoning behind every non-obvious choice) · `docs/MODEL_LIMITATIONS.md` (what the model does *not* do; §15 is the tone for any new limitation) · `docs/MISSING_CONSTANTS.md` (generated; every unsourced field and every adjudicated data disagreement) · `docs/VISUAL_AUDIT.md` (the reference frames the renderer is calibrated against).
