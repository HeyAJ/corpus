import { answer, transferables, type GeometryReply, type GeometryRequest } from './geometryProtocol';

/**
 * The geometry worker: builds organ shells and organ interiors from their recipes and
 * posts the buffers back. See GeometryFactory.ts for why this is not done in the page.
 *
 * Requests are answered strictly in the order they arrive. That is deliberate: the
 * caller queues the organs in the order it wants them to appear (the heart and brain
 * first), and a worker that reordered them would make the body assemble differently
 * on every load.
 */

interface WorkerScope {
  onmessage: ((e: MessageEvent<{ id: number; request: GeometryRequest }>) => void) | null;
  postMessage(message: GeometryReply, transfer: Transferable[]): void;
}

const scope = self as unknown as WorkerScope;

scope.onmessage = (e) => {
  const reply = answer(e.data.id, e.data.request);
  const transfer: Transferable[] = [];
  if (reply.ok) {
    if (reply.kind === 'model') transfer.push(...(transferables(reply.geometry) as Transferable[]));
    else for (const p of reply.parts) transfer.push(...(transferables(p.geometry) as Transferable[]));
  }
  scope.postMessage(reply, transfer);
};
