import { createWorkerHandler, type ToWorker } from './workerHandler.ts';

const handle = createWorkerHandler();
const scope = self as unknown as { onmessage: (e: MessageEvent<ToWorker>) => void; postMessage: (m: unknown) => void };
scope.onmessage = (e) => scope.postMessage(handle(e.data));
