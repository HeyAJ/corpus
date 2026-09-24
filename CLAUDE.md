# CORPUS — working notes

Browser-based real-time human physiology simulator. Vite + TypeScript strict + three.js r170 + React 18 + Zustand + Comlink/SharedArrayBuffer + Vitest. **Not a git repo** — there is no undo, so read before you overwrite.

**Read this file instead of exploring the repo.** It exists so you do not have to re-derive the architecture from 24 ADRs and 40 source files. If something here is wrong, fix it here as well as in the code.

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
HR ~69, MAP ~93, CO ~5.0, RR ~12.6, SpO₂ ~97.2, temp 37.0, glucose ~99, rhythm `nsr`, **no conditions firing**.
If a resting body stops looking like this, you broke something.

## Key concepts you will need

- **Receptor reserve** (`ec50Occupancy`): 5 % occupancy can give 50 % effect. Dose–response curves look wrong until you know this. ADR-007.
- **`activationModel`** on each receptor, three cases in `src/sim/pharma/pd.ts`: `endogenous-agonist` (43) where `intrinsicActivity` is efficacy vs the endogenous ligand; `transporter` (4) where there is no tone to displace; `inhibition` (9) where gains are written for the *inhibited* state and `intrinsicActivity` is a direction, not an efficacy. Getting this wrong inverts a drug's action.
- **Multiply-blend Beer–Lambert absorption** is order-independent *because multiplication commutes*. Buckets: 10 absorption (multiply), 20 rim (additive), 30 solid, 12 vessel walls, 22 flow particles. ADR-002.
- **Fixed 10 ms step**, cardio/ECG sub-stepped at dt/5. Determinism depends on it.

## State as of 2026-09-22

**Recently fixed — do not revert or re-investigate:**
- Receptor binding uses the exact exponential solution. Explicit Euler was unstable at `koff·dt > 2` and pinned occupancy at *exactly zero* for aspirin, paracetamol, caffeine/A1, phenytoin/Naᵥ.
- `directEffects` are normalised to each drug's own reference dose with a saturating ceiling. Raw `gain × cp` was 40× too large for ethanol (one drink → MAP 43) and 100× too small for oxycodone.
- Payload drugs (saline, KCl, CaCl₂) deliver over their route and duration. The whole litre used to land in one 10 ms tick.
- Respiratory drive is gated on cerebral perfusion pressure, the chemoreflex saturates, and CO₂ narcosis exists. A pulseless body used to keep breathing at 12/min. ADR-021, ADR-022, ADR-024.
- Metoclopramide was modelled backwards — prokinetic drug, constipating effect. ADR-023.
- 7 of 10 dead effect-bus targets wired; the three `renal.*` ones may still be dead.

**Known outstanding:** carvedilol `intrinsicActivity: 0.35` makes a beta blocker raise HR to 184; several drugs' `notes` claim mechanisms absent from their data (verapamil, dopamine, mirtazapine, tramadol, amitriptyline); adenosine lasts ~15× too long; `src/sim/systems/infection.ts` is a deliberate no-op scaffold.

## Docs worth reading, when relevant

`docs/DECISIONS.md` (24 ADRs — the reasoning behind every non-obvious choice) · `docs/MODEL_LIMITATIONS.md` (what the model does *not* do; §15 is the tone for any new limitation) · `docs/MISSING_CONSTANTS.md` (generated; every unsourced field and every adjudicated data disagreement) · `docs/VISUAL_AUDIT.md` (the reference frames the renderer is calibrated against).
