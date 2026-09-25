import * as THREE from 'three';

/**
 * CAMERA RIG (spec 6.1).
 *
 * Low FOV (18-24 deg) is doing a lot of work here. It gives the near-orthographic,
 * flattened look that every reference frame has: silhouette edges stay nearly
 * parallel instead of splaying, and the brain floating a third of a metre above the
 * thorax reads as the same size as it would at chest height. A default 50 deg FOV
 * looks immediately wrong and no amount of shader work rescues it.
 *
 * AZIMUTH IS NOW FREE, 360 degrees. The rig was originally penned into a +/-35 deg
 * front arc on the argument that the flat, unlit material only reads correctly from
 * the front. That is true — from directly behind, the exploded stack of hollow shells
 * is plainly a set of hollow shells — but it was the wrong trade: people reach for a
 * 3D body expecting to turn it over, and a body that refuses to rotate reads as broken
 * long before it reads as tastefully constrained. So azimuth WRAPS rather than clamps:
 * you can spin all the way round and keep going, with no wall to hit at the back. The
 * back view being less flattering than the front is an accepted cost of that freedom.
 *
 * POLAR IS OPENED to a generous 15..165 deg — nearly pole to pole — so you can look
 * down onto the shoulders or up from below the pelvis, while still stopping short of
 * the singularities at 0 and 180 where the up-vector flips and the camera rolls. That
 * band is the one real constraint left, and it is a numerical one, not an aesthetic one.
 *
 * Damped orbit is hand-rolled rather than three's OrbitControls because the focus
 * animation needs to drive the same target the user is dragging, and fighting
 * OrbitControls for ownership of that is more code than owning it outright. The same
 * damped path serves the mouse and the touch handlers in Viewer, so a one-finger drag
 * and a click-drag feel identical.
 */

export interface OrbitLimits {
  minAzimuth: number;
  maxAzimuth: number;
  minPolar: number;
  maxPolar: number;
  minDistance: number;
  maxDistance: number;
}

const DEG = Math.PI / 180;

/** Radians of azimuth per normalised unit of drag: the canvas is 2 units wide, so a full-width drag is one turn. */
const AZIMUTH_PER_UNIT = Math.PI;
/** Radians of polar per normalised unit of drag: a full-height drag sweeps about the 150 deg polar band. */
const POLAR_PER_UNIT = (75 * Math.PI) / 180;
/**
 * Residual velocity as a multiple of each step's angle per second. With the 9/s decay
 * every step coasts on by FLING/9 of itself, and that happens during the drag as well
 * as after it, so the value is kept small: 1.5 makes a drag about a sixth longer than
 * the finger's travel and leaves a short, soft settle on release.
 */
const FLING = 1.5;

/** Half-height of the whole exploded body, metres: brain crown to pelvic floor. */
export const BODY_FRAMING_RADIUS = 0.40;

/** Screen aspect (width / height) below which the whole-body framing pulls back. */
const PORTRAIT_ASPECT = 0.55;

export const DEFAULT_LIMITS: OrbitLimits = {
  // Azimuth is WRAPPED, not clamped (see the header and update()), so these bounds
  // describe the full turn rather than a fence. They are kept in the struct so the
  // interface stays uniform and a future caller could re-fence a single axis.
  minAzimuth: -Math.PI,
  maxAzimuth: Math.PI,
  // Polar measured from +Y. 90 deg is level with the target. Opened almost pole to
  // pole; the 15 deg margin at each end keeps the camera clear of the gimbal
  // singularity where lookAt's up-vector flips and the view rolls.
  minPolar: 15 * DEG,
  maxPolar: 165 * DEG,
  minDistance: 0.45,
  maxDistance: 3.6,
};

export class OrbitRig {
  readonly camera: THREE.PerspectiveCamera;
  readonly target = new THREE.Vector3(0, 0.16, 0);

  private azimuth = 0;
  private polar = 90 * DEG;
  private distance = 2.63;

  private azimuthVel = 0;
  private polarVel = 0;
  private distanceVel = 0;

  private desiredTarget = new THREE.Vector3(0, 0.16, 0);
  private focusFrom = new THREE.Vector3();
  private focusTo = new THREE.Vector3();
  private focusFromDistance = 2.63;
  private focusToDistance = 2.63;
  private focusT = 1;
  private focusDurationMs = 600;

  limits: OrbitLimits = { ...DEFAULT_LIMITS };

  /**
   * True while the camera is at its whole-body framing and the user has not moved it.
   * Only then does a change of screen shape re-frame it: a resize must never undo a zoom
   * the user made on purpose.
   */
  private atHome = true;

  constructor(aspect: number, fovDegrees = 21) {
    this.camera = new THREE.PerspectiveCamera(fovDegrees, aspect, 0.05, 50);
    this.distance = this.homeDistance();
    this.focusFromDistance = this.focusToDistance = this.distance;
    this.apply();
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    if (this.atHome && this.focusT >= 1) this.distance = this.homeDistance();
  }

  /**
   * Whole-body distance for the current screen shape. Height-fitting alone (the FILL
   * rule in focus) is right on a landscape screen, but on a portrait phone the same
   * distance also fills the WIDTH, so the pelvis ended under the dock and the brain under
   * the HUD. Below an aspect of 0.55 the distance grows with the narrowness, which leaves
   * the body about seventy per cent of the height with a margin for both.
   */
  private homeDistance(): number {
    return this.fitDistance(BODY_FRAMING_RADIUS) / Math.min(1, this.camera.aspect / PORTRAIT_ASPECT);
  }

  private fitDistance(boundingRadius: number): number {
    const FILL = 0.82;
    const halfFov = (this.camera.fov * DEG) / 2;
    const fit = boundingRadius / (Math.tan(halfFov) * FILL);
    return THREE.MathUtils.clamp(fit, this.limits.minDistance, this.limits.maxDistance);
  }

  /**
   * Pointer drag, in normalised screen units (the canvas spans -1..1 on each axis).
   *
   * DIRECT MANIPULATION, with a little fling on release. The drag used to add only
   * VELOCITY (2.4 x dx), which then decayed at 9 per second, so the angle a drag could
   * produce was a ninth of that: a whole canvas-width drag turned the body about thirty
   * degrees, and a 300 px drag a few degrees - moving, but not visibly, which the round-2
   * tester (rightly) reported as "does not rotate at all". On a slow frame rate it was
   * worse, because the integrator clamps each step to 50 ms. Now the angle follows the
   * finger one-to-one - a full canvas-width drag is one full turn, a full-height drag
   * sweeps the polar band - and only a small residual velocity carries on after release,
   * so the weighty feel survives without the drag feeling disconnected.
   */
  orbit(dx: number, dy: number): void {
    this.azimuth += dx * AZIMUTH_PER_UNIT;
    this.polar += dy * POLAR_PER_UNIT;
    this.azimuthVel = dx * AZIMUTH_PER_UNIT * FLING;
    this.polarVel = dy * POLAR_PER_UNIT * FLING;
    this.focusT = 1; // a manual drag cancels any running focus animation
    this.atHome = false;
  }

  dolly(delta: number): void {
    this.distanceVel += delta * 0.9;
    this.focusT = 1; // likewise: a running focus animation would overwrite the distance
    this.atHome = false;
  }

  /**
   * Pinch: scale the viewing distance by the change in finger spread (fingers apart =
   * closer). Direct, like the drag, and it cancels a running focus animation - which
   * sets `distance` itself every frame and so silently undid a pinch made during it.
   */
  zoomBy(spreadRatio: number): void {
    if (!(spreadRatio > 0) || !Number.isFinite(spreadRatio)) return;
    this.distance = THREE.MathUtils.clamp(this.distance / spreadRatio, this.limits.minDistance, this.limits.maxDistance);
    this.distanceVel = 0;
    this.focusT = 1;
    this.atHome = false;
  }

  /**
   * Focus an organ: lerp the target to its bounding-sphere centre over 600 ms with
   * an ease-out cubic, and dolly to frame it. Never cut (spec 6.1).
   */
  focus(centre: THREE.Vector3, boundingRadius: number, durationMs = 600): void {
    this.focusFrom.copy(this.target);
    this.focusTo.copy(centre);
    this.focusFromDistance = this.distance;
    // Frame the bounding sphere so it fills FILL of the viewport half-height. At a
    // 21 degree FOV the tangent is small, so the distance is large and the
    // projection is nearly orthographic — which is the point of the low FOV.
    this.focusToDistance = this.fitDistance(boundingRadius);
    this.focusT = 0;
    this.atHome = false;
    this.focusDurationMs = durationMs;
  }

  /** Return to whole-body framing. */
  reset(durationMs = 600): void {
    this.focus(new THREE.Vector3(0, 0.16, 0), BODY_FRAMING_RADIUS, durationMs);
    this.focusToDistance = this.homeDistance();
    this.atHome = true;
  }

  update(dtMs: number): void {
    const dt = Math.min(dtMs, 50) / 1000;

    if (this.focusT < 1) {
      this.focusT = Math.min(1, this.focusT + dtMs / this.focusDurationMs);
      const e = 1 - Math.pow(1 - this.focusT, 3);
      this.desiredTarget.lerpVectors(this.focusFrom, this.focusTo, e);
      this.distance = this.focusFromDistance + (this.focusToDistance - this.focusFromDistance) * e;
    }

    // Critically-damped-ish velocity decay. A spring would overshoot; exponential
    // decay gives the weighty, settled feel the reference has.
    const decay = Math.exp(-dt * 9);
    this.azimuth += this.azimuthVel * dt;
    this.polar += this.polarVel * dt;
    this.distance += this.distanceVel * dt;
    this.azimuthVel *= decay;
    this.polarVel *= decay;
    this.distanceVel *= decay;

    // Azimuth WRAPS into (-pi, pi] so the body turns all the way round with no wall at
    // the back; polar and distance still clamp, because those bounds are real.
    this.azimuth = ((this.azimuth + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
    this.polar = THREE.MathUtils.clamp(this.polar, this.limits.minPolar, this.limits.maxPolar);
    this.distance = THREE.MathUtils.clamp(this.distance, this.limits.minDistance, this.limits.maxDistance);

    this.target.lerp(this.desiredTarget, Math.min(1, dt * 8));
    this.apply();
  }

  private apply(): void {
    const sinPolar = Math.sin(this.polar);
    this.camera.position.set(
      this.target.x + this.distance * sinPolar * Math.sin(this.azimuth),
      this.target.y + this.distance * Math.cos(this.polar),
      this.target.z + this.distance * sinPolar * Math.cos(this.azimuth),
    );
    this.camera.lookAt(this.target);
    this.camera.updateMatrixWorld();
  }

  get currentDistance(): number {
    return this.distance;
  }
}
