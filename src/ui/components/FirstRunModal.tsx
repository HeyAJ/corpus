import { useStore } from '../store';
import styles from './modal.module.css';

/**
 * FIRST-RUN MODAL (spec 10.2).
 *
 * "Explaining the model is an approximation and naming its major limitations."
 *
 * Naming them, specifically — not a generic disclaimer. A user who is told "this is
 * approximate" learns nothing; a user who is told "the ventricle is one compartment
 * with no valve dynamics, so it cannot show you a regurgitant murmur" knows exactly
 * which conclusions this tool can and cannot support.
 */

export function FirstRunModal() {
  const accept = useStore((s) => s.acceptFirstRun);

  return (
    <div className={styles.backdrop} role="dialog" aria-modal="true" aria-labelledby="firstrun-title">
      <div className={styles.card}>
        {/*
          The scrollable body and the accept button are now SIBLINGS, not nested. When
          the whole card scrolled, a viewport shorter than the content (a laptop under
          ~984px tall) pushed "I understand" below the fold with no affordance that it
          was there, and the user could not dismiss the modal at all. The button is
          pinned as a footer outside the scroll region, always in view; the scroll shadow
          on the footer's top edge is the affordance that says there is more above it.
        */}
        <div className={styles.scroll}>
        <h1 id="firstrun-title" className={styles.title}>
          CORPUS
        </h1>
        <p className={styles.lede}>
          A real-time simulation of an adult human body. Read live telemetry from each organ,
          administer drugs and food, and watch the body respond through pharmacokinetics,
          receptor binding and downstream physiology.
        </p>

        <div className={styles.warning}>
          <strong>NOT FOR CLINICAL USE {'—'} EDUCATIONAL SIMULATION</strong>
          <p>
            Nothing here is patient-specific, and nothing here is dosing guidance. The fidelity
            target is {'“'}a medical student says that{'’'}s roughly right{'”'}, not
            {' “'}a cardiologist says that{'’'}s clinically valid{'”'}.
          </p>
        </div>

        <h2 className={styles.subtitle}>What this model actually is</h2>
        <ul className={styles.list}>
          <li>
            <strong>The circulation</strong> is eight lumped compartments with time-varying
            ventricular elastance and a four-element Windkessel. It gives you stroke volume and
            ejection fraction as real outputs. It has no valve lesions, no regional wall motion and
            no coronary anatomy.
          </li>
          <li>
            <strong>The lungs</strong> are a single alveolar compartment. Gas exchange is real;
            ventilation-perfusion mismatch, dead-space disease and diffusion limitation are not
            modelled separately.
          </li>
          <li>
            <strong>Drug data comes from published sources</strong> {'—'} IUPHAR/BPS binding
            affinities, the Pulse Physiology Engine and FDA product labels {'—'} through a
            pipeline that records where every number came from. Where a number could not be
            sourced, the interface shows an em-dash rather than a plausible guess.
          </li>
          <li>
            <strong>Receptor effect gains are calibrated, not measured.</strong> Their direction and
            relative size come from cited pharmacology; the absolute scale was fitted so that a
            reference dose produces a textbook-sized response.
          </li>
          <li>
            <strong>One body, one physiology.</strong> A 70 kg reference adult. Age, sex, disease
            and genetics do not change the parameters.
          </li>
        </ul>

        <p className={styles.footnote}>
          The full list, including every approximation and every place the model diverges from real
          physiology, is in <code>docs/MODEL_LIMITATIONS.md</code>.
        </p>
        </div>

        <div className={styles.footer}>
          <button className={styles.accept} onClick={accept}>
            I understand
          </button>
        </div>
      </div>
    </div>
  );
}
