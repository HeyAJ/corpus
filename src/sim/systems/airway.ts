import { P } from '../core/constants';
import type { SimState } from '../core/state';
import { addEffect, prevEffect } from '../core/effects';

/**
 * AIRWAYS AND MAST CELLS: ASTHMA AND ANAPHYLAXIS.
 *
 * Two operator-set insults share one file because they share the effector: smooth
 * muscle narrowing the airways, which bronchodilators relieve.
 *
 * ASTHMA is a level the scenario sets (0..1 of the airway closed). What the lungs see is
 * that narrowing minus whatever airway calibre the drugs on board are adding - beta-2
 * agonism and adrenaline on `resp.tidalVolume`, steroids on `resp.bronchodilation` - so
 * salbutamol visibly opens an asthmatic's airway and does nothing much to a healthy one.
 * The spending of that calibre on the constriction is done in respiratory.ts, where
 * the tidal volume is built; this file computes the constriction itself.
 *
 * ANAPHYLAXIS is an exposure: a mast-cell population discharging over minutes. Its
 * mediators are split on purpose.
 *
 *   - HISTAMINE acts at H1 and H2. That is modelled by raising the endogenous tone at
 *     those two receptors (pharma/pd.ts reads `s.airway.histamine`), so an
 *     antihistamine competes for it through the same binding kinetics as any other
 *     antagonist and removes exactly the histamine share - the itch, the flush, part of
 *     the hypotension.
 *   - EVERYTHING ELSE the mast cell releases - leukotrienes, platelet-activating factor,
 *     prostaglandin D2 - is NOT histamine and no antihistamine touches it. It is carried
 *     here as direct vasodilation, capillary leak and bronchoconstriction. That split is
 *     the whole reason adrenaline, not an antihistamine, is the treatment for
 *     anaphylactic shock, and the model has to be able to show it.
 */
export function stepAirway(s: SimState, dt: number): void {
  const a = s.airway;

  // Mast-cell release continues for minutes after the exposure; circulating mediator
  // activity follows that release and is cleared within minutes of it stopping.
  const releaseK = 1 - Math.exp(-dt / P('airway.mastCellReleaseTau_s'));
  a.releaseRemaining = Math.max(0, a.releaseRemaining - a.releaseRemaining * releaseK);
  const clearK = 1 - Math.exp((-Math.LN2 * dt) / P('airway.histamineHalfLife_s'));
  a.histamine += (Math.min(1, a.releaseRemaining) - a.histamine) * clearK;
  if (a.histamine < 1e-4 && a.releaseRemaining < 1e-4) {
    a.histamine = 0;
    a.releaseRemaining = 0;
  }

  const h = a.histamine;
  if (h > 0) {
    addEffect(s.effects, 'immune.histamineRelease', h);
    addEffect(s.effects, 'cardio.systemicResistance', -P('airway.histamineSystemicResistanceFall') * h);
    addEffect(s.effects, 'vascular.permeability', P('airway.histaminePermeabilityRise') * h);
  }

  // Raw narrowing: the asthma level plus the mediator bronchospasm. Steroid-type
  // bronchodilation (`resp.bronchodilation`, read from the completed previous tick
  // because steroids write it after this runs) lowers it here; beta-2 calibre is spent
  // against it in respiratory.ts.
  const raw = Math.min(1, a.asthma + P('airway.histamineBronchoconstriction') * h);
  const steroid = Math.max(0, prevEffect(s, 'resp.bronchodilation'));
  a.constriction = Math.max(0, Math.min(0.95, raw * (1 - Math.min(0.9, steroid))));
}
