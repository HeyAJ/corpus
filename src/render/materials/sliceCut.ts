import * as THREE from 'three';

/**
 * THE SLICE PLANE: ONE FLAT CUT THROUGH THE SELECTED ORGAN.
 *
 * WHAT IT IS FOR. An organ with an interior is a glass shell around parts that sit inside
 * one another (cortex around pyramids around a pelvis, a ventricle's muscle around its
 * blood). Orbiting and zooming shows the outside of that arrangement and the section shows
 * the inside of it, which is what an anatomy plate does. The plane is a viewing aid and
 * says nothing about physiology.
 *
 * WHY A SHADER TERM AND NOT three's clippingPlanes. The organ materials are hand-written
 * ShaderMaterials with their own vertex shaders (and a Points material for the streams),
 * so three's clipping chunks would have to be hand-included in every one of them, and the
 * renderer-wide `localClippingEnabled` switch would have to be thrown for the whole scene.
 * One discard term, spliced into each material the cut must reach and into no other, is
 * smaller and cannot leak: the rest of the body (and the glass figure around it) never
 * receives the uniform, so it cannot be cut by mistake. An earlier design that shared one
 * uniform object between every material was dropped for exactly that reason: the shell of
 * a previously selected organ stayed cut after the selection moved on.
 *
 * SPACE. The plane is in SCENE (world) space, after the renderer's x-mirror, because the
 * vertex shaders compute `modelMatrix * position`, which already includes it. The viewer
 * therefore builds the plane from the organ's mirrored bounding-sphere centre.
 *
 * Everything in this file except `patchForCut` is pure arithmetic, so the tests can check
 * the plane without a GL context.
 */

export type SliceAxis = 'front' | 'side' | 'top';

/**
 * DISPLAY CONSTANT. The plane sweeps from SLICE_MARGIN x radius beyond the near side of the
 * bounding sphere to the same distance beyond the far side, rather than exactly +/- radius.
 * An organ's bounding sphere is built from its vertices, so a vertex can lie exactly on it;
 * with a plane that only just touched the sphere at depth 0 and 1, floating-point rounding
 * could shave a sliver off an untouched organ or leave a sliver of a fully cut one. The 2 %
 * margin makes depth 0 remove nothing and depth 1 remove everything with room to spare.
 */
export const SLICE_MARGIN = 1.02;

/**
 * DISPLAY CONSTANTS for the CUT-EDGE CONTOUR. Slicing alone only makes things disappear:
 * most parts of an organ are glass walls, and a glass wall with its front half discarded
 * leaves nothing to look at, so the organ merely looked fainter and nobody could tell a
 * section from a dim organ. A section drawing shows the line where the plane crosses every
 * surface, so every fragment on the KEPT side within an edge width of the plane is redrawn
 * in a dark tone (SLICE_EDGE_DARKEN x its own colour) at full opacity. Each surface the
 * plane crosses (capsule, cortex boundary, pyramids, chamber walls, septum, ventricles)
 * then shows as a line in its own hue.
 *
 * The width is a fraction of the organ's bounding radius (SLICE_EDGE_WIDTH, 1.2 %) but is
 * never less than SLICE_EDGE_MIN_PX screen pixels at the selection's framing, or a small
 * organ framed large would get a hairline that aliases away. All three are display choices.
 */
export const SLICE_EDGE_WIDTH = 0.012;
export const SLICE_EDGE_MIN_PX = 3;
export const SLICE_EDGE_DARKEN = 0.35;

/**
 * The world-space width of the contour: SLICE_EDGE_WIDTH of the radius, or SLICE_EDGE_MIN_PX
 * pixels at the given viewing distance, whichever is larger. Pure, so it can be tested.
 */
export function sliceEdgeWidth(radius: number, distance: number, fovDegrees: number, heightPx: number): number {
  const perPixel = (2 * Math.tan((fovDegrees * Math.PI) / 360) * distance) / Math.max(1, heightPx);
  return Math.max(radius * SLICE_EDGE_WIDTH, SLICE_EDGE_MIN_PX * perPixel);
}

/**
 * The direction in which the plane advances, in scene space, per axis. A fragment is REMOVED
 * when dot(normal, position) exceeds the plane offset, so each normal points at the side of
 * the organ that goes first.
 *
 *  - 'front' (coronal): +z. The camera at azimuth 0 sits on +z looking at the patient's
 *    front, so the front of the organ goes first and the cut face looks straight at the
 *    default view. This is the section a visitor sees without touching the camera.
 *  - 'side' (sagittal): +x in SCENE space. The body is mirrored in x so that the patient's
 *    right is drawn on the viewer's left, which makes scene +x the PATIENT'S LEFT. The
 *    patient's left half goes first and the right half is kept. The cut face then looks
 *    towards the patient's left, which is where a viewer stands to see the conventional
 *    midsagittal plate (the face pointing to the viewer's left, the medial surface of the
 *    right half showing). Orbit a quarter turn to azimuth +90 degrees to face it.
 *  - 'top' (transverse): +y. The top of the organ goes first and the section looks up, so
 *    it is read from above, as a CT slice is read looking up from the feet. Orbit the
 *    camera over the top to face it.
 */
const AXIS_NORMAL: Record<SliceAxis, readonly [number, number, number]> = {
  front: [0, 0, 1],
  side: [1, 0, 0],
  top: [0, 1, 0],
};

export interface SlicePlane {
  nx: number;
  ny: number;
  nz: number;
  /** A point p is KEPT when nx*px + ny*py + nz*pz <= w. */
  w: number;
}

/**
 * The plane for an axis and a depth in 0..1 across a bounding sphere (scene-space centre,
 * radius in metres). Depth 0 removes nothing, 0.5 passes through the centre, 1 removes all.
 * A depth outside 0..1 or not finite is clamped, so a slider can never overshoot.
 */
export function slicePlane(
  axis: SliceAxis,
  depth: number,
  centre: { x: number; y: number; z: number },
  radius: number,
  out: SlicePlane = { nx: 0, ny: 0, nz: 0, w: 0 },
): SlicePlane {
  const d = Number.isFinite(depth) ? Math.max(0, Math.min(1, depth)) : 0;
  const n = AXIS_NORMAL[axis];
  out.nx = n[0];
  out.ny = n[1];
  out.nz = n[2];
  out.w = n[0] * centre.x + n[1] * centre.y + n[2] * centre.z + radius * SLICE_MARGIN * (1 - 2 * d);
  return out;
}

/** Whether a scene-space point survives the cut. Used by picking so a tap ignores removed tissue. */
export function sliceKeeps(plane: SlicePlane, x: number, y: number, z: number): boolean {
  return plane.nx * x + plane.ny * y + plane.nz * z <= plane.w;
}

/** The uniforms a patched material reads. Each material owns its own pair. */
export interface CutUniforms {
  uCutPlane: { value: THREE.Vector4 };
  uCutOn: { value: number };
  /** Contour width in metres; 0 draws none (streams, which keep their look). */
  uCutEdge: { value: number };
}

const VERT_DECL = /* glsl */ `
varying vec3 vCutPos;
`;
const VERT_MAIN = /* glsl */ `
  vCutPos = (modelMatrix * vec4(position, 1.0)).xyz;
`;
const FRAG_DECL = /* glsl */ `
uniform vec4 uCutPlane;
uniform float uCutOn;
uniform float uCutEdge;
varying vec3 vCutPos;
`;
const FRAG_MAIN = /* glsl */ `
  if (uCutOn > 0.5 && dot(uCutPlane.xyz, vCutPos) > uCutPlane.w) discard;
`;
// The material's own main becomes cutMain; the new main runs it and then redraws the
// fragments that lie within the edge width of the plane (the contour, see SLICE_EDGE_*).
const FRAG_WRAP = /* glsl */ `
void main() {
  cutMain();
  if (uCutOn > 0.5 && uCutEdge > 0.0 && uCutPlane.w - dot(uCutPlane.xyz, vCutPos) < uCutEdge) {
    gl_FragColor = vec4(gl_FragColor.rgb * ${SLICE_EDGE_DARKEN.toFixed(2)}, 1.0);
  }
}
`;

const MAIN = /void\s+main\s*\(\s*\)\s*\{/;

/**
 * Splice the cut into a ShaderMaterial, once, and return its uniforms. Safe to call again:
 * the second call returns the same uniforms and changes nothing. The discard is the first
 * statement of the fragment `main`, so it also skips the work of shading what is removed.
 * The material is flagged for recompilation, which is a one-off per distinct shader source
 * (the programs are cached by their text, so the nineteen shells of one kind share one).
 */
export function patchForCut(material: THREE.ShaderMaterial, contour = true): CutUniforms {
  const existing = material.userData.cut as CutUniforms | undefined;
  if (existing) return existing;
  const cut: CutUniforms = { uCutPlane: { value: new THREE.Vector4(0, 0, 0, 0) }, uCutOn: { value: 0 }, uCutEdge: { value: 0 } };
  material.uniforms.uCutPlane = cut.uCutPlane;
  material.uniforms.uCutOn = cut.uCutOn;
  material.uniforms.uCutEdge = cut.uCutEdge;
  material.vertexShader = VERT_DECL + material.vertexShader.replace(MAIN, (m) => m + VERT_MAIN);
  if (contour) {
    material.fragmentShader =
      FRAG_DECL + material.fragmentShader.replace(MAIN, (m) => 'void cutMain() {' + m.slice(m.indexOf('{') + 1) + FRAG_MAIN) + FRAG_WRAP;
  } else {
    material.fragmentShader = FRAG_DECL + material.fragmentShader.replace(MAIN, (m) => m + FRAG_MAIN);
  }
  material.userData.cut = cut;
  material.needsUpdate = true;
  return cut;
}

/** Point a patched material's cut at a plane, or switch it off with null. No allocation. */
export function setCut(cut: CutUniforms, plane: SlicePlane | null, edge = 0): void {
  if (plane) {
    cut.uCutEdge.value = edge;
    cut.uCutPlane.value.set(plane.nx, plane.ny, plane.nz, plane.w);
    cut.uCutOn.value = 1;
  } else {
    cut.uCutOn.value = 0;
  }
}
