import { Worker } from 'worker_threads';
import * as path from 'path';
import { randomUUID } from 'crypto';
import type { WorkerRequest, WorkerResponse } from './shared-types';

type ProgressListener = (stage: string, percent: number) => void;
type LogFn = (level: 'info' | 'warn' | 'error', message: string) => void;
/** Distributes `Omit` over the `WorkerRequest` union so each variant keeps its own shape (minus `requestId`). */
type WorkerRequestWithoutId = WorkerRequest extends infer T ? (T extends { requestId: string } ? Omit<T, 'requestId'> : never) : never;

/**
 * Exactly one `map-worker.js` thread lives for the whole app session (started eagerly at
 * launch, see `main.ts`). It parses the open map once and keeps the buffer/header/tagIndex in
 * its own memory - callers only ever send small requests (file paths, tag indices), never the
 * map buffer itself, and never spawn a second worker per task.
 */
let worker: Worker | null = null;
const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error & { code?: string }) => void; onProgress: ProgressListener }>();

function ensureWorker(onLog: LogFn): Worker {
  if (worker) return worker;
  const instance = new Worker(path.join(__dirname, 'map-worker.js'));
  worker = instance;

  instance.on('message', (msg: WorkerResponse) => {
    if (msg.type === 'ready') {
      onLog('info', msg.info);
      return;
    }
    const entry = pending.get(msg.requestId);
    if (!entry) return;
    if (msg.type === 'progress') {
      entry.onProgress(msg.stage, msg.percent);
    } else if (msg.type === 'result') {
      entry.resolve(msg.payload);
      pending.delete(msg.requestId);
    } else if (msg.type === 'error') {
      entry.reject(Object.assign(new Error(msg.message), { code: msg.code }));
      pending.delete(msg.requestId);
    }
  });
  instance.on('error', (err: Error) => {
    onLog('error', `Worker thread crashed: ${err.message}`);
    for (const [id, entry] of pending) {
      entry.reject(new Error('Worker thread crashed.'));
      pending.delete(id);
    }
    worker = null;
  });
  instance.on('exit', (code) => {
    if (code !== 0) onLog('warn', `Worker thread exited unexpectedly (code ${code}).`);
    worker = null;
  });
  return instance;
}

/** Starts the persistent worker (idempotent) and reports its self-check via `onLog`. */
export function startWorker(onLog: LogFn): void {
  ensureWorker(onLog);
}

/** Sends one typed request to the persistent worker; resolves/rejects with that request's own result/error. */
export function sendWorkerRequest<TResult>(
  request: WorkerRequestWithoutId,
  onLog: LogFn,
  onProgress: ProgressListener = () => {},
): { requestId: string; promise: Promise<TResult> } {
  const requestId = randomUUID();
  const instance = ensureWorker(onLog);
  const promise = new Promise<TResult>((resolve, reject) => {
    pending.set(requestId, { resolve: resolve as (v: unknown) => void, reject, onProgress });
    instance.postMessage({ ...request, requestId } as WorkerRequest);
  });
  return { requestId, promise };
}

export function cancelWorkerRequest(requestId: string, onLog: LogFn): void {
  ensureWorker(onLog).postMessage({ type: 'cancel', requestId } satisfies WorkerRequest);
}
