import * as THREE from 'three';
import { buildModel, type ModelParams } from './models';
import { buildParts, type PartParams } from './parts';

/**
 * THE GEOMETRY WORKER'S PROTOCOL: what is asked, what comes back, and the one function
 * that turns a request into a reply.
 *
 * Kept apart from GeometryFactory.ts on purpose. The factory contains the expression
 * that SPAWNS the worker, and a worker that imported the file that spawns it would ask
 * the bundler to build a worker inside the worker, for ever. Both sides import this
 * file instead, and this file imports neither.
 *
 * WHAT CROSSES THE BOUNDARY is three typed arrays per geometry, transferred rather
 * than copied. A THREE.BufferGeometry is a class instance and does not survive
 * structured cloning, so the worker sends the buffers and the factory reassembles them.
 */

export interface GeometryData {
  position: Float32Array;
  normal: Float32Array;
  index: Uint16Array | Uint32Array | null;
}

export type GeometryRequest =
  | { kind: 'model'; model: string; params: ModelParams }
  | { kind: 'parts'; atlas: string; params: PartParams };

export type GeometryReply =
  | { id: number; ok: true; kind: 'model'; geometry: GeometryData }
  | { id: number; ok: true; kind: 'parts'; parts: { id: string; geometry: GeometryData }[] }
  | { id: number; ok: false; error: string };

export function serialiseGeometry(g: THREE.BufferGeometry): GeometryData {
  const index = g.getIndex();
  return {
    position: g.getAttribute('position').array as Float32Array,
    normal: g.getAttribute('normal').array as Float32Array,
    index: index ? (index.array as Uint16Array | Uint32Array) : null,
  };
}

export function deserialiseGeometry(d: GeometryData): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(d.position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(d.normal, 3));
  if (d.index) g.setIndex(new THREE.BufferAttribute(d.index, 1));
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

/** The buffers of a payload, for the transfer list. */
export function transferables(d: GeometryData): ArrayBufferLike[] {
  const out: ArrayBufferLike[] = [d.position.buffer, d.normal.buffer];
  if (d.index) out.push(d.index.buffer);
  return out;
}

/** Build the answer to one request. Runs in the worker, and inline as the fallback. */
export function answer(id: number, request: GeometryRequest): GeometryReply {
  try {
    if (request.kind === 'model') {
      return { id, ok: true, kind: 'model', geometry: serialiseGeometry(buildModel(request.model, request.params)) };
    }
    return {
      id,
      ok: true,
      kind: 'parts',
      parts: buildParts(request.atlas, request.params).map((p) => ({ id: p.id, geometry: serialiseGeometry(p.geometry) })),
    };
  } catch (e) {
    return { id, ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
