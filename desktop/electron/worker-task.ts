import { Worker } from 'worker_threads';
import * as path from 'path';
import { randomUUID } from 'crypto';

export type TaskProgressListener = (stage: string, percent: number) => void;

/**
 * Runs one map-worker.js task in a fresh worker thread (heavy parsing/zstd work never
 * blocks the Electron main/UI thread) and resolves with its result payload.
 */
export function runMapWorkerTask<TResult>(task: Record<string, unknown>, onProgress: TaskProgressListener): Promise<TResult> {
  const taskId = randomUUID();
  const worker = new Worker(path.join(__dirname, 'map-worker.js'));

  return new Promise<TResult>((resolve, reject) => {
    worker.on('message', (msg: any) => {
      if (msg.taskId !== taskId) return;
      if (msg.type === 'progress') {
        onProgress(msg.stage, msg.percent);
      } else if (msg.type === 'result') {
        resolve(msg.payload as TResult);
        worker.terminate();
      } else if (msg.type === 'error') {
        reject(new Error(msg.message));
        worker.terminate();
      }
    });
    worker.on('error', (err) => {
      reject(err);
      worker.terminate();
    });
    worker.postMessage({ ...task, taskId });
  });
}
