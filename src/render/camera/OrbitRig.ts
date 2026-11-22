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

/**
 * Half-height of the whole exploded body, metres, and the height of its middle. The body
 * now runs from the crown of the brain (y about 0.545) to the lowest of the pelvic organs
 * (about -0.39), where it used to stop at the bladder; framed on the old centre the
 * reproductive organs sat under the dock.
 */
export const BODY_FRAMING_RADIUS = 0.49;
export const BODY_CENTRE_Y = 0.08;

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
  // 0.45 was a leftover from when the smallest organ was a kidney. At that floor an adrenal
  // (bounding radius a couple of centimetres) could never be framed closer than about 6 %
  // of the frame width, so its cortical layers were unreadable. 0.07 lets the rig get in
  // to a thyroid lobe or an ovary; the user can still dolly out to the whole body.
  minDistance: 0.07,
  maxDistance: 3.6,
};

/**
 * DISPLAY CONSTANT: the share of the smaller free viewport dimension a focused organ's
 * bounding sphere should span. 40-60 % was asked for, for every organ. A bounding sphere
 * is looser than an elongated organ's own silhouette, so 0.55 lands the organ itself in
 * that band.
 */
const FOCUS_FILL = 0.68;

/**
 * The camera never frames a target nearer than this many of its radii, whatever the viewport
 * says. The fill rule already lands at about 7.9 radii on the 21 degree lens, so this is a floor
 * for odd viewports (a tall free area, a wide lens), not the usual answer: closer than about
 * 4 radii a target no longer fits its free area and its children lie outside the frame. A
 * DISPLAY constant.
 */
export const FOCUS_MIN_RADII = 4;

/**
 * DISPLAY CONSTANTS for panning and double-tap zoom. None of them is a physiological
 * quantity; each is a feel choice.
 *
 * PAN_HALF_EXTENTS is the half-size, per axis, of the box the orbit TARGET may wander in:
 * the body is about 0.5 m from its centre to the crown or the pelvis (BODY_FRAMING_RADIUS)
 * and a little over a quarter of a metre either side of the midline at the shoulders and
 * hips, with the arms-length reproductive and abdominal organs inside that. PAN_MARGIN is
 * added on every side so an organ at the edge can still be centred on screen. Past the
 * box the target is clamped, which is what keeps a runaway two-finger drag from carrying
 * the whole body off the stage with no way to know where it went.
 *
 * DOUBLE_TAP_ZOOM is the share of the current distance a double-tap closes to, 55 %.
 */
export const PAN_HALF_EXTENTS = { x: 0.3, y: BODY_FRAMING_RADIUS, z: 0.25 } as const;
export const PAN_MARGIN = 0.08;
export const DOUBLE_TAP_ZOOM = 0.55;
/** The azimuth and polar of the home view: the patient's front, level with the target. */
export const HOME_AZIMUTH = 0;
export const HOME_POLAR = 90 * DEG;

/**
 * Clamp a point into the pan box (body bounds plus PAN_MARGIN), in place, and return it.
 * Pure arithmetic so the test can drive it without a camera.
 */
export function clampToPanBounds(v: THREE.Vector3): THREE.Vector3 {
  const hx = PAN_HALF_EXTENTS.x + PAN_MARGIN;
  const hy = PAN_HALF_EXTENTS.y + PAN_MARGIN;
  const hz = PAN_HALF_EXTENTS.z + PAN_MARGIN;
  v.x = THREE.MathUtils.clamp(v.x, -hx, hx);
  v.y = THREE.MathUtils.clamp(v.y, BODY_CENTRE_Y - hy, BODY_CENTRE_Y + hy);
  v.z = THREE.MathUtils.clamp(v.z, -hz, hz);
  return v;
}

/** Distance after a double-tap: 55 % of the current one, never closer than the rig's floor. */
export function doubleTapDistance(current: number, minDistance: number): number {
  return Math.max(minDistance, current * DOUBLE_TAP_ZOOM);
}

export class OrbitRig {
  readonly camera: THREE.PerspectiveCamera;
  readonly target = new THREE.Vector3(0, BODY_CENTRE_Y, 0);

  private azimuth = 0;
  private polar = 90 * DEG;
  private distance = 2.63;

  private azimuthVel = 0;
  private polarVel = 0;
  private distanceVel = 0;

  private desiredTarget = new THREE.Vector3(0, BODY_CENTRE_Y, 0);
  private focusFrom = new THREE.Vector3();
  private focusTo = new THREE.Vector3();
  private focusFromDistance = 2.63;
  private focusToDistance = 2.63;
  private focusT = 1;
  private focusDurationMs = 600;
  /** Bounding radius of the organ being framed, 0 once the user has moved the camera or reset. */
  private focusRadius = 0;
  /** Canvas size and the strips a panel covers, in CSS px (see setViewport). */
  private viewW = 0;
  private viewH = 0;
  private insetRight = 0;
  private insetBottom = 0;

  limits: OrbitLimits = { ...DEFAULT_LIMITS };

  /**
   * True while the camera is at its whole-body framing and the user has not moved it.
   * Only then does a change of screen shape re-frame it: a resize must never undo a zoom
   * the user made on purpose.
   */
  private atHome = true;

  /**
   * True once the visitor has orbited, panned or zoomed away from the framing the current
   * state calls home (the whole body, or the selected organ). It is the inverse of
   * `viewAtHome`. A selection or a deselection re-frames and drops any pan and zoom, but it
   * does not turn the body, so it leaves this set only if the angles are off the front view.
   */
  private moved = false;
  private reportedAtHome = true;
  /** Called only when `viewAtHome` flips (checked once per update). */
  onHomeChanged: ((atHome: boolean) => void) | null = null;

  /** Angle targets of the running flight; used only when `focusAngles` is set (a reset). */
  private focusFromAzimuth = 0;
  private focusToAzimuth = 0;
  private focusFromPolar = HOME_POLAR;
  private focusToPolar = HOME_POLAR;
  private focusAngles = false;

  // Scratch for pan(); the rig allocates nothing per frame.
  private readonly panShift = new THREE.Vector3();

  constructor(aspect: number, fovDegrees = 21) {
    // Near plane 0.02: the closest framing is now 0.07 m from the target, and an organ's
    // near wall must not be clipped at that range.
    this.camera = new THREE.PerspectiveCamera(fovDegrees, aspect, 0.02, 50);
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
    this.focusRadius = 0;
    this.atHome = false;
    this.moved = true;
  }

  dolly(delta: number): void {
    // The step scales with the distance below 1.2 m. A fixed 0.9 m/s per notch was right
    // for the whole body but threw the camera clean through a 0.1 m organ in one notch.
    // Whole-body distances (2.6 m) are unchanged. Floor 0.3 so zooming out stays brisk.
    const step = THREE.MathUtils.clamp(this.distance / 1.2, 0.3, 1);
    this.distanceVel += delta * 0.9 * step;
    this.focusRadius = 0;
    this.focusT = 1; // likewise: a running focus animation would overwrite the distance
    this.atHome = false;
    this.moved = true;
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
    this.focusRadius = 0;
    this.atHome = false;
    this.moved = true;
  }

  /**
   * Focus an organ: lerp the target to its bounding-sphere centre over 600 ms with
   * an ease-out cubic, and dolly to frame it. Never cut (spec 6.1).
   */
  focus(centre: THREE.Vector3, boundingRadius: number, durationMs = 600, resetAngles = false): void {
    this.fly(centre, this.focusDistance(boundingRadius), boundingRadius, durationMs, resetAngles);
    this.atHome = false;
    // Selecting an organ is the home framing of the selected state, not a departure from
    // it, so the visitor's Reset button should not appear for it. It does not turn the
    // body, though: if they had orbited away, that is still a departure.
    this.moved = resetAngles ? false : this.anglesOffHome();
  }

  /** Return to whole-body framing. */
  reset(durationMs = 600, resetAngles = false): void {
    this.fly(new THREE.Vector3(0, BODY_CENTRE_Y, 0), this.homeDistance(), 0, durationMs, resetAngles);
    this.atHome = true;
    this.moved = resetAngles ? false : this.anglesOffHome();
  }

  /**
   * Fly the target to a point and the distance to a value, as a user move: the double-tap
   * zoom and the framing of a single part both come through here. `boundingRadius` > 0 asks
   * for the framing to be re-fitted if a panel arrives mid-flight (see setViewport). The
   * point is clamped to the pan box so a tap near the edge cannot strand the target.
   */
  flyTo(point: THREE.Vector3, distance: number, boundingRadius = 0, durationMs = 600): void {
    this.fly(clampToPanBounds(this.panShift.copy(point)), distance, boundingRadius, durationMs, false);
    this.atHome = false;
    this.moved = true;
  }

  /** Distance the double-tap zoom would reach from here (the rig's own floor applied). */
  get doubleTapTarget(): number {
    return doubleTapDistance(this.distance, this.limits.minDistance);
  }

  /** Distance that frames a sphere of this radius in the free part of the stage. */
  framingDistance(boundingRadius: number): number {
    return this.focusDistance(boundingRadius);
  }

  private fly(
    centre: THREE.Vector3,
    distance: number,
    boundingRadius: number,
    durationMs: number,
    resetAngles: boolean,
  ): void {
    this.focusFrom.copy(this.target);
    this.focusTo.copy(centre);
    this.focusFromDistance = this.distance;
    // Frame the bounding sphere so it fills FILL of the viewport half-height. At a
    // 21 degree FOV the tangent is small, so the distance is large and the
    // projection is nearly orthographic — which is the point of the low FOV.
    this.focusRadius = boundingRadius;
    this.focusToDistance = THREE.MathUtils.clamp(distance, this.limits.minDistance, this.limits.maxDistance);
    this.focusT = 0;
    this.focusDurationMs = durationMs;
    this.focusAngles = resetAngles;
    if (resetAngles) {
      this.focusFromAzimuth = this.azimuth;
      this.focusFromPolar = this.polar;
      // The shortest way round: an azimuth of 350 degrees returns through 360, not back
      // through 180.
      this.focusToAzimuth = this.azimuth - wrapPi(this.azimuth - HOME_AZIMUTH);
      this.focusToPolar = HOME_POLAR;
      this.azimuthVel = 0;
      this.polarVel = 0;
    }
    this.distanceVel = 0;
    // Zero length is an instant cut (reduced motion). The animation maths would divide by
    // zero, so the end state is applied here, exactly.
    if (!(durationMs > 0)) this.finishFlight();
  }

  /** Apply the end of the running flight exactly and stop it. */
  private finishFlight(): void {
    this.focusT = 1;
    this.desiredTarget.copy(this.focusTo);
    this.target.copy(this.focusTo);
    this.distance = this.focusToDistance;
    if (this.focusAngles) {
      this.azimuth = this.focusToAzimuth;
      this.polar = this.focusToPolar;
    }
    this.apply();
  }

  private anglesOffHome(): boolean {
    return Math.abs(wrapPi(this.azimuth - HOME_AZIMUTH)) > 1e-3 || Math.abs(this.polar - HOME_POLAR) > 1e-3;
  }

  /** False once the visitor has orbited, panned or zoomed away from the current home view. */
  get viewAtHome(): boolean {
    return !this.moved;
  }

  get currentAzimuth(): number {
    return this.azimuth;
  }

  get currentPolar(): number {
    return this.polar;
  }

  /**
   * Pan: move the orbit target in the plane of the screen, by a drag in normalised screen
   * units (the canvas spans -1..1 on each axis, y up). The content follows the finger one
   * to one at the target's depth: a unit of drag is half the canvas, which at this
   * distance is `tan(fov/2) * distance` metres vertically and that times the aspect
   * horizontally. The target is then clamped to the body's bounds plus a margin, and the
   * pan cancels any running flight (as an orbit does) and keeps the camera's angles.
   */
  pan(dx: number, dy: number): void {
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
    const halfH = Math.tan((this.camera.fov * DEG) / 2) * this.distance;
    const halfW = halfH * this.camera.aspect;
    const e = this.camera.matrixWorld.elements;
    // Camera right is column 0 of its world matrix, camera up column 1.
    this.panShift.set(
      -dx * halfW * e[0] - dy * halfH * e[4],
      -dx * halfW * e[1] - dy * halfH * e[5],
      -dx * halfW * e[2] - dy * halfH * e[6],
    );
    this.target.add(this.panShift);
    clampToPanBounds(this.target);
    this.desiredTarget.copy(this.target);
    this.focusT = 1;
    this.focusRadius = 0;
    this.atHome = false;
    this.moved = true;
  }

  /**
   * Distance at which a sphere of this radius spans FOCUS_FILL of the smaller free
   * dimension. Its projected diameter in pixels is r * H / (d * tan(halfFov)), H being the
   * full canvas height the vertical FOV spans, so d follows directly. "Free" means not
   * under the open panel: the old rule fitted the radius to the whole canvas HEIGHT, which
   * on a portrait phone filled the height while the organ was still narrow, and made every
   * small organ tiny because the 0.45 distance floor stopped it getting closer.
   */
  private focusDistance(boundingRadius: number): number {
    const halfFov = (this.camera.fov * DEG) / 2;
    const H = this.viewH || 1;
    const freeMin = Math.max(1, Math.min(this.viewW - this.insetRight, H - this.insetBottom));
    const fill = (boundingRadius * H) / (Math.tan(halfFov) * FOCUS_FILL * freeMin);
    const d = Math.max(fill, FOCUS_MIN_RADII * boundingRadius);
    return THREE.MathUtils.clamp(d, this.limits.minDistance, this.limits.maxDistance);
  }

  /**
   * Tell the rig the canvas size and how much of it an open panel covers (right strip on a
   * wide screen, bottom strip on a phone). The camera's view offset shifts the principal
   * point so the TARGET lands in the middle of the uncovered area, and a focused organ is
   * re-fitted if the panel arrived after the focus began (the panel opens a React render
   * after the selection, so the first fit was made against the wrong free area).
   */
  setViewport(width: number, height: number, insetRight: number, insetBottom: number): void {
    const same =
      width === this.viewW && height === this.viewH && insetRight === this.insetRight && insetBottom === this.insetBottom;
    if (same) return;
    this.viewW = width;
    this.viewH = height;
    this.insetRight = insetRight;
    this.insetBottom = insetBottom;
    if (insetRight > 0 || insetBottom > 0) {
      // A window of the full image, starting half the covered strip in, puts the target
      // at the centre of the free rectangle.
      this.camera.setViewOffset(width, height, insetRight / 2, insetBottom / 2, width, height);
    } else {
      this.camera.clearViewOffset();
    }
    if (this.focusRadius > 0) {
      // focusTo is kept as the organ's centre. (desiredTarget is NOT it: it still holds the
      // old target until the first animation frame, so re-fitting from it sent the camera
      // to the wrong place whenever the panel arrived before that frame.)
      this.focusFrom.copy(this.target);
      this.focusFromDistance = this.distance;
      this.focusToDistance = this.focusDistance(this.focusRadius);
      // A reset that is still turning the body keeps turning it, from where it is now.
      this.focusFromAzimuth = this.azimuth;
      this.focusToAzimuth = this.azimuth - wrapPi(this.azimuth - HOME_AZIMUTH);
      this.focusFromPolar = this.polar;
      this.focusT = 0;
      this.focusDurationMs = 400;
    }
  }

  update(dtMs: number): void {
    const dt = Math.min(dtMs, 50) / 1000;

    if (this.focusT < 1) {
      this.focusT = Math.min(1, this.focusT + dtMs / this.focusDurationMs);
      const e = 1 - Math.pow(1 - this.focusT, 3);
      this.desiredTarget.lerpVectors(this.focusFrom, this.focusTo, e);
      this.distance = this.focusFromDistance + (this.focusToDistance - this.focusFromDistance) * e;
      if (this.focusAngles) {
        this.azimuth = this.focusFromAzimuth + (this.focusToAzimuth - this.focusFromAzimuth) * e;
        this.polar = this.focusFromPolar + (this.focusToPolar - this.focusFromPolar) * e;
      }
      // The last frame lands exactly on the end pose (the damped target would otherwise
      // trail it by a hair, and a reset must return the SAME pose every time).
      if (this.focusT >= 1) this.finishFlight();
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

    const home = !this.moved;
    if (home !== this.reportedAtHome) {
      this.reportedAtHome = home;
      this.onHomeChanged?.(home);
    }
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

/** Wrap an angle in radians into (-pi, pi]. */
function wrapPi(a: number): number {
  return ((a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
}
