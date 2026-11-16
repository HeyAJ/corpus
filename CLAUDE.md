# CORPUS — working notes

Browser-based real-time human physiology simulator. Vite + TypeScript strict + three.js r170 + React 18 + Zustand + Comlink/SharedArrayBuffer + Vitest. Now tracked in git, but generated data and long probes are easy to clobber — read before you overwrite.

**Read this file instead of exploring the repo.** It exists so you do not have to re-derive the architecture from 34 ADRs and 40 source files. If something here is wrong, fix it here as well as in the code.

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
- **`src/data/drugs.json` and `receptors.json` are GENERATED.** Never hand-edit. Change `tools/ingest/*` then run `npm run ingest:offline`. It must still report 152 drugs, 56 receptors, **0 unadjudicated cross-check disagreements** (ADR-018).
- **A dead effect-bus target is invisible.** A target written by a drug but read by no system makes that drug silently inert, with every test passing. Ten of these existed. Before adding a target, grep `effect(s, '<target>')` under `src/sim/` and confirm something consumes it.
- **Heredocs mangle TypeScript.** Backticks and `\n` inside `bash <<'EOF'` get eaten. Use the Write tool for any file containing template literals.
- **Several Vite dev servers at once corrupt `node_modules/.vite`.** Two copies of React, "Invalid hook call", a blank page while `tsc` is clean. Delete `node_modules/.vite` and start the servers one at a time, loading a page between starts.
- **A git worktree created by the agent tool starts from the DEFAULT branch, not the working branch.** Reset it to the branch head before use.
- **The snapshot's hormone list is runtime data.** `snapshot.endocrine.hormones` has different ids for different bodies; reading only the TypeScript type will make you conclude the sex hormones do not exist. Probe a male, a non-pregnant female and a pregnant female.
- **A resting body is not a body with every signal at zero.** Anatomy state signals are legitimately non-zero at rest (see "The anatomy atlases"); read that before "fixing" one.
- **`npx tsc --noEmit -p .` checks NOTHING.** The root `tsconfig.json` has `"files": []` and only project references, so without `-b` it type-checks zero files and exits 0 whatever the code looks like. The real check is `npm run typecheck` (`tsc -b --force`). The production build (`npm run build` = `tsc -b && vite build`, which is what Vercel runs) fails on any type error AND on any file the node project reaches by import but does not list in `tsconfig.node.json` (TS6307): `tools/placeholder-organs.ts` imports `src/render/organs/placeholder.ts`, so anything that file imports must be listed there. This let a broken production build sit on the branch behind a green "tsc exit 0".

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

The body owns the WHOLE screen and is never resized by a panel. The dock is four floating chips (panels menu | body, procedures, drugs); every other panel is one tap into the menu. **Only one panel is open at a time** (`openOnly` in `store.ts`) in a single floating sheet — a right-hand card on wide screens, a bottom sheet (≤46vh) on phones — so panels can never overlap each other. The drawer and sheet stop above the MEASURED bottom bar. Portrait screens pull the camera back (`OrbitRig.homeDistance`) so the whole body sits between HUD and dock. Smoothness rules: React gets snapshots at ≤10 Hz (the viewer gets all 20), the viewer sends organ labels only when they move, and render resolution adapts to hold the frame rate (touch devices start at 1.5×). Do not reintroduce a layout column that shrinks the stage. On phones the HUD folds to its first line while a sheet is open (`data-folded` on `.hud` in `src/ui/App.tsx`, rule in `src/ui/app.module.css`), so the selected organ is not covered (user choice 2026-11-16).

**Vessels are OFF at start** (`vascularVisible: false`, user choice 2026-09-26); a labelled **"Vessels" switch in the bottom-left corner** of the stage (`VesselToggle` in `ToolDock.tsx`, positioned above the measured bar) shows them — it is no longer a chip in the dock. `centrelines.ts` `growFineBranches` grows ~475 deterministic twigs (seeded PRNG, two generations) off the 60 named segments; `VascularSystem` merges them into ONE mesh per blood type (a handful of draw calls, not 475) in the same multiply bucket 12, and gives them sparse flow particles (`FINE_PARTICLE_DENSITY`). The twigs are illustrative microvasculature, not a traced anatomical atlas. The blood-contents legend is now its own panel ("In the blood" in the menu) — it used to auto-show with the overlay and would have owned the sheet. The top HUD is drawn with `transform: scale()` (0.86 desktop, 0.78 phone) so it shrinks without re-wrapping; its layout `max-width` is divided by the scale. **Action toasts** ("Morphine 4 mg IV") leave after 2 s (`LOG_LIFETIME_MS` in `store.ts`, CSS fade inside it); every toast caller also pushes a timeline event, so the record lives in the timeline. The timeline collapses to a small "Timeline N" pill; ticks, traces and the list appear only when it is opened.

**Administration sheet (rebuilt 2026-09-26, phone-first, iOS vocabulary).** `DrugDrawer.tsx` is a navigation stack inside one sheet: LIST (segmented Drugs/Food/Biologics, search, a sideways-scrolling row of group chips, inset-grouped rows with icon + routes subtitle + chevron, a "Running now" card) → DRUG PAGE (hero, every preset as a route card, the dose lever, a full-width predicted curve, About/Receptors/Sources) with ONE Give button pinned in a footer. The lever's state is lifted (`useDose` in `DoseControl.tsx`, keyed on the preset) so the pinned button can read it; quick steps ¼×…4× are multiples of the cited reference inside the worker's 0.1–10× bound. `DoseCurve` fills its container when `width` is omitted (ResizeObserver) — the fixed 420 px overflowed phones. An intravascular route with no IV line shows "needs an IV line · Place IV line" instead of a Give that the engine would refuse (the body STARTS with an IV line, `state.ts`). Drag the handle: up = full, down = half, down again = close; tap toggles. Guardrails unchanged: no dose field, presets only, provenance on every page.

## Deployment (Vercel, 2026-09-27)

Vercel builds the repo's DEFAULT BRANCH (`main`) to the production domain; every other pushed branch gets only a preview URL, so work on a feature branch is not live until it is merged. `vercel.json` sends the same COOP/COEP headers as `vite.config.ts` (without them there is no SharedArrayBuffer and the waveform channel degrades to 50 ms chunks — the footer then says "degraded waveform transport"), and `/docs/*` as text/plain. The `ship-limitations-doc` plugin in `vite.config.ts` copies `docs/MODEL_LIMITATIONS.md` into `dist/docs/` — a static host serves only `dist/`, and the footer's limitations link was a 404 on the live site.

## The anatomy atlases (every organ has an interior)

One **atlas** per organ, as data plus two render files. List them with `ls src/data/anatomy`; the two kidneys share one atlas (`kidney`), so do the two adrenals (`adrenal`), and the uterus atlas is rebuilt per gestational week.

`src/data/anatomy/<atlas>.json` (parts: `id, label, summary, function, color, rest, drives, source`) -> the deriver `src/sim/derive/anatomy.ts` computes `activity = clamp01(rest + sum(weight x signal))` into `snapshot.anatomy.parts['<organId>.<partId>']` (plus `snapshot.anatomy.glands` and `snapshot.anatomy.nerves`) -> the renderer builds part geometry in a worker from `src/render/anatomy/atlas/<atlas>.parts.ts` and animates it with `<atlas>.detail.ts` (`flows(organId)`, `animate(ctx)`) -> `src/render/anatomy/detail/OrganDetail.ts` shows it while the organ is selected -> the Structures panel (`src/ui/panels/AnatomyPanel.tsx`) lists the parts.

- **Glass parts.** A part whose opacity is below 0.98 (`GLASS_BELOW` in `OrganDetail.ts`) stops writing depth and is drawn after the solid parts. Walls, capsules, lobes and lumen-bearing tubes are glass; what they contain is solid. Picking prefers the nearest solid part through glass. Neighbouring organs recede (`RECEDE_DENSITY` = 0.22 in `src/render/organs/OrganSet.ts`) while any organ is selected, except the fetus while the uterus is open. Stream particles are alpha-blended droplets: additive ones were invisible on the pale page. Arterial and venous colours come from one shared ramp, `src/render/anatomy/detail/blood.ts`.
- **Signals are departures from the settled resting body.** `captureAnatomyRest` (defined in `src/sim/derive/anatomy.ts`, called at the end of the engine warm-up in `src/sim/core/engine.ts`) records the rest once, so a resting part sits at its JSON `rest` and anything above it means something happened. Cortisol is referenced to its circadian expectation for the clock hour. **State signals are legitimately non-zero at rest:** night, bladder filling, ADH/dehydration in a body that has not drunk, and the menstrual-cycle state. `tests/sim/anatomy.test.ts` encodes this.
- Part geometry is procedural and illustrative, not a traced atlas; counts such as breast lobes or splenic follicles are schematic.
- The fetus is sized from the cited fetal weight by an isometric drawing rule, (W(w)/W(40))^(1/3), centred in the amniotic sac and clamped to fit it (`fetalFit` / `fetalScale` in `src/render/anatomy/models.ts`). ADR-032.

## State as of 2026-11-15 (organ interiors, reproduction, overlays)

**Reproductive engine** (`src/sim/systems/reproductive.ts`, data `src/data/reproduction.json`, `tests/sim/reproductive.test.ts`, 20 tests). Intents: `SET_BODY` (sex), `SET_CYCLE_DAY`, `SET_PREGNANCY` (`pregnant`, `weeks`), `SET_REPRODUCTIVE_LAPSE` (`days_per_s`), `SET_SEXUAL_STIMULATION` (`level`).
- Male and female bodies; a menstrual cycle replayed from cited daily hormone medians; pregnancy by gestational week; a reproductive clock that can run ahead of real time (time-lapse); a sexual response (arousal, plateau, orgasm, resolution, a 10.8 min male refractory period, oxytocin, a post-orgasmic prolactin state).
- All through the effect bus: `blood.plasmaVolume` and `blood.redCellMass` (consumed in `src/sim/systems/fluids.ts` as an isotonic expansion), `reflex.setpointShift` (consumed in `baroreflex.ts`), `cardio.venousTone`, `cardio.systemicResistance`, `cardio.heartRate`, `cardio.contractility`.
- **`slowClockScale(s)`** makes the kidney's day-scale clocks (renal acid-base compensation, creatinine) follow the reproductive clock in a female body, at 20000x for a 90 s catch-up window after a jump. Side effect, stated plainly: **a jump also corrects, at once, any metabolic acid-base disturbance that happened to be present.** ADR-030.
- **A jump to a gestational age is coherent:** the circulatory terms of pregnancy are scaled by the plasma expansion actually realised, so no condition fires after a jump (a jump to 36 weeks used to show hypotension, tachycardia and renal hypoperfusion for about a minute).
- Acid-base compensation is referenced to the model's own resting PaCO2 (`resp.restingPaco2_mmHg`), not to 40, with a cited chronic respiratory-alkalosis slope of 0.4 mEq/L per mmHg; the acute alkalosis slope is unsourced so the acute term is unchanged. Pregnancy at 24 weeks reads PaCO2 29.6, HCO3 20.9, pH 7.47.
- Sexual response, model vs cited at the start of orgasm (dSBP / dDBP / dHR): male +21.1 / +18.0 / +21.2 vs +21.3 / +18.2 / +21.0; female +11.6 / +11.3 / +19.6 vs +12.3 / +10.2 / +18.8. It is fitted with a baroreflex set-point shift, venous tone and a FALL in systemic resistance, not a forced heart rate (ADR-031). Do not "fix" it by forcing the rate: the excess pressure lands in diastolic.
- **`pregnancy.fetalHeartRate_bpm`** (`fetalHeartRate(w)` in `reproductive.ts`, ADR-034): a replay of cited population means, `null` for a male body, a non-pregnant woman or under 10 weeks. Hyett 1996 line 171 to 156 bpm over 10-14 weeks, then Ursem 1999's -2.52 bpm/week from 14 to 20 (a DERIVED join, 140.88 at 20 weeks against the independent Pildner midpoint 141.348), then Pildner 2013 CI midpoints by band. Display only: not on the effect bus, no variability. The fetal heart part pulses at it (`fetus.detail.ts`, phase accumulated from the rate, display amplitude).
- Hormone ids in `snapshot.endocrine.hormones` depend on the body: always cortisol, aldosterone, adh, thyroxine, glucagon, epo, oxytocin; male adds testosterone; non-pregnant female adds lh, fsh, estradiol, progesterone; pregnant female adds hcg, progesterone, estradiol, prolactin, testosterone. Insulin is `snapshot.metabolic.insulin_uU_per_mL`.

**Overlays and interface.**
- `src/render/nervous/NervousSystem.ts`: somatic, sympathetic and parasympathetic pathways in three colours with travelling impulses whose rate follows autonomic tone. Courses are derived from the vessel centrelines (neurovascular bundles) and are illustrative; impulse speed is a display constant, not a conduction velocity.
- `src/render/endocrine/HormoneTraffic.ts`: gland rings, source-to-target arcs and droplets whose rate follows level over resting level. The arcs are a diagram (hormones travel in the blood); a legend lists the hormones present.
- Three labelled switches in the bottom-left corner: **Hormones, Nerves, Vessels** (`src/ui/components/ToolDock.tsx`), all off at start.
- `src/render/scan/BrainScan.ts` with `src/ui/components/BrainScanInset.tsx`: a small rotating "glass brain" while the brain is selected (it can be pinned). A maximum-intensity projection of the activity index through a thermal ramp, captioned "activity index, not temperature"; it prints the region furthest above its own resting level. ADR-033.
- The Structures panel and part labels; the selected organ's own big label is hidden; every organ has a live readout in `src/ui/panels/OrganPanels.tsx`; a Reproduction panel (`src/ui/panels/ReproductionPanel.tsx`).
- With the heart selected, `Viewer.applyVascularVisibility` (`src/render/scene/Viewer.ts`) forces the vascular overlay on, so the blood is seen going round the body.
- The camera frames the selected organ's bounding sphere (`FOCUS_FILL`, `minDistance` 0.07 in `src/render/camera/OrbitRig.ts`), small enough now to get in to an adrenal or a thyroid lobe. `Viewer.measureViewport` measures how much of the stage the open panel covers (right strip on a wide screen, bottom strip on a phone) and hands it to `OrbitRig.setViewport`, so a selected organ is framed in the free part of the stage instead of behind the panel.
- The diaphragm's phrenic streams are gated by the breath (`diaphragm.detail.ts`). The whole organ, shell and parts together, is carried down on inspiration and up on expiration by a rigid display offset from `resp.inflation` in `Viewer.applySnapshotToScene` (`DIAPHRAGM_DISPLAY_TRAVEL_M`, 0.016 m of scene height: a display amplitude, not a measured excursion; frozen at zero under reduced motion, with the lungs). The dome is NOT reshaped, so do not describe it as flattening or contracting.
- The vessel overlay takes its colours from the one shared blood ramp: `src/render/vascular/VascularSystem.ts` imports `bloodColour` from `src/render/anatomy/detail/blood.ts` for both flow particles and vessel-wall tint (its private OXY/DEOXY pair and 0.5-1.0 ramp were deleted), so a vessel and the heart stream that feeds it are the same colour at the aorta and the venae cavae.
- The placenta is NOT part of the uterus's outer shell (`uterus` in `src/render/anatomy/models.ts`; a merged disc read as a white ring and was removed). It is drawn only by the uterus atlas, as a solid dark-red part (`PLACENTA_RED` in `src/render/anatomy/atlas/uterus.detail.ts`), so it is visible only while the uterus is selected, not on the unselected body.
- In dev builds only, `window.__corpus = { viewer, store }` exists for render probes.

## Docs worth reading, when relevant

`docs/DECISIONS.md` (34 ADRs — the reasoning behind every non-obvious choice) · `docs/MODEL_LIMITATIONS.md` (what the model does *not* do; §15 is the tone for any new limitation) · `docs/MISSING_CONSTANTS.md` (generated; every unsourced field and every adjudicated data disagreement) · `docs/VISUAL_AUDIT.md` (the reference frames the renderer is calibrated against).
