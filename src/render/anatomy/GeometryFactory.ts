import type * as THREE from 'three';
import type { ModelParams } from './models';
import type { PartGeometry, PartParams } from './parts';
import { answer, deserialiseGeometry, type GeometryReply, type GeometryRequest, type OutlineInfo } from './geometryProtocol';
import type { OutlineBody } from '../body/outlineModel';

/**
 * WHERE ORGAN GEOMETRY IS MADE: off the main thread.
 *
 * Every organ in this body is generated at load from a signed-distance recipe
 * (models.ts). That is about two hundred thousand triangles and, more to the point,
 * about one and a half seconds of arithmetic on a desktop and several times that on a
 * phone. Done synchronously in the page it is a frozen first frame - no heartbeat on
 * the monitor, no response to a touch - on exactly the devices least able to afford
 * it. So it is done in a worker: the page comes up at once, the simulation starts, and
 * the organs arrive one after another over the first second or two.
 *
 * The same worker builds the two shapes that change while the app is running - the
 * gravid uterus and the interior parts of whichever organ is selected - so neither a
 * pregnancy time-lapse nor a first tap on the brain can drop a frame.
 *
 * FALLBACK. Where there is no Worker - the test runner, a browser that refuses module
 * workers - the same builders run inline behind the same promise. Slower, identical
 * output: the recipes are pure functions, so there is nothing for the two paths to
 * disagree about.
 */

interface Pending {
  resolve: (reply: GeometryReply) => void;
  reject: (error: Error) => void;
}

export class GeometryFactory {
  private worker: Worker | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private disposed = false;

  constructor() {
    if (typeof Worker === 'undefined') return;
    try {
      this.worker = new Worker(new URL('./geometry.worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e: MessageEvent<GeometryReply>) => {
        const p = this.pending.get(e.data.id);
        if (!p) return;
        this.pending.delete(e.data.id);
        p.resolve(e.data);
      };
      this.worker.onerror = () => {
        // A worker that cannot start (blocked module workers, a bundling fault) must not
        // leave the body empty. Fail what was in flight; every later request goes inline.
        this.worker?.terminate();
        this.worker = null;
        for (const [, p] of this.pending) p.reject(new Error('geometry worker failed'));
        this.pending.clear();
      };
    } catch {
      this.worker = null;
    }
  }

  /** True while the off-thread path is in use. */
  get threaded(): boolean {
    return this.worker !== null;
  }

  /** Requests issued and not yet answered. */
  get inFlight(): number {
    return this.pending.size;
  }

  private send(request: GeometryRequest): Promise<GeometryReply> {
    if (this.disposed) return Promise.reject(new Error('geometry factory disposed'));
    const worker = this.worker;
    if (!worker) return Promise.resolve().then(() => answer(0, request));
    const id = this.nextId++;
    return new Promise<GeometryReply>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      worker.postMessage({ id, request });
    }).catch(() => {
      // The worker died with this request in it: build it here instead.
      return answer(0, request);
    });
  }

  async model(model: string, params: ModelParams = {}): Promise<THREE.BufferGeometry> {
    const reply = await this.send({ kind: 'model', model, params });
    if (!reply.ok) throw new Error(reply.error);
    if (reply.kind !== 'model') throw new Error('geometry factory: mismatched reply');
    return deserialiseGeometry(reply.geometry);
  }

  /**
   * The glass figure round the organs, fitted to the given points (x, y, z, radius per
   * point). Built here, in the same worker as the organs, because it is a few hundred
   * milliseconds of field evaluation and a pregnancy time-lapse asks for a new one every
   * half second. The samples are copied into the worker (a few hundred kilobytes), so the caller may reuse them.
   */
  async outline(samples: Float32Array, body: OutlineBody): Promise<{ geometry: THREE.BufferGeometry; info: OutlineInfo }> {
    const reply = await this.send({ kind: 'outline', samples, body });
    if (!reply.ok) throw new Error(reply.error);
    if (reply.kind !== 'outline') throw new Error('geometry factory: mismatched reply');
    return { geometry: deserialiseGeometry(reply.geometry), info: reply.info };
  }

  /** The interior parts of one atlas, built for one organ instance. */
  async parts(atlas: string, params: PartParams): Promise<PartGeometry[]> {
    const reply = await this.send({ kind: 'parts', atlas, params });
    if (!reply.ok) throw new Error(reply.error);
    if (reply.kind !== 'parts') throw new Error('geometry factory: mismatched reply');
    return reply.parts.map((p) => ({ id: p.id, geometry: deserialiseGeometry(p.geometry) }));
  }

  dispose(): void {
    this.disposed = true;
    this.worker?.terminate();
    this.worker = null;
    this.pending.clear();
  }
}
