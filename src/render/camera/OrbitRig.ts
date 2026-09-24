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
 * The polar range is constrained to the front hemisphere (+/-35 deg). That is not a
 * usability compromise: the flat, unlit material and the exploded stack only read
 * correctly from the front, and letting the user get underneath the body would show
 * them the inside of a hollow shell.
 *
 * Damped orbit is hand-rolled rather than three's OrbitControls because the focus
 * animation needs to drive the same target the user is dragging, and fighting
 * OrbitControls for ownership of that is more code than owning it outright.
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

/** Half-height of the whole exploded body, metres: brain crown to pelvic floor. */
export const BODY_FRAMING_RADIUS = 0.40;

export const DEFAULT_LIMITS: OrbitLimits = {
  minAzimuth: -35 * DEG,
  maxAzimuth: 35 * DEG,
  // Polar measured from +Y. 90 deg is level with the target.
  minPolar: 58 * DEG,
  maxPolar: 122 * DEG,
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

  constructor(aspect: number, fovDegrees = 21) {
    this.camera = new THREE.PerspectiveCamera(fovDegrees, aspect, 0.05, 50);
    this.apply();
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** Pointer drag, in normalised screen units. */
  orbit(dx: number, dy: number): void {
    this.azimuthVel += dx * 2.4;
    this.polarVel += dy * 1.8;
    this.focusT = 1; // a manual drag cancels any running focus animation
  }

  dolly(delta: number): void {
    this.distanceVel += delta * 0.9;
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
    const FILL = 0.82;
    const halfFov = (this.camera.fov * DEG) / 2;
    const fit = boundingRadius / (Math.tan(halfFov) * FILL);
    this.focusToDistance = THREE.MathUtils.clamp(fit, this.limits.minDistance, this.limits.maxDistance);
    this.focusT = 0;
    this.focusDurationMs = durationMs;
  }

  /** Return to whole-body framing. */
  reset(durationMs = 600): void {
    this.focus(new THREE.Vector3(0, 0.16, 0), BODY_FRAMING_RADIUS, durationMs);
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

    this.azimuth = THREE.MathUtils.clamp(this.azimuth, this.limits.minAzimuth, this.limits.maxAzimuth);
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
