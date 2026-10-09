import { parentPort } from 'worker_threads';
import * as fs from 'fs';
import {
  inspectCustomEditionMap,
  compressCustomEditionMap,
  decompressCustomEditionMap,
  estimateTagFootprints,
} from '../../core/src/index';
import type { LoadMapResult } from './shared-types';

interface InspectTask {
  type: 'inspect';
  taskId: string;
  filePath: string;
}
interface CompressTask {
  type: 'compress' | 'decompress';
  taskId: string;
  filePath: string;
  outputPath: string;
}
type Task = InspectTask | CompressTask;

function progress(taskId: string, stage: string, percent: number) {
  parentPort?.postMessage({ type: 'progress', taskId, stage, percent });
}

async function runInspect(task: InspectTask) {
  progress(task.taskId, 'Reading file', 10);
  const buffer = fs.readFileSync(task.filePath);
  progress(task.taskId, 'Parsing header and tag index', 50);
  const result = inspectCustomEditionMap(buffer);

  let payload: LoadMapResult;
  if (result.status === 'ok') {
    const footprints = estimateTagFootprints(result.header, result.tagIndex);
    const sizeByIndex = new Map(footprints.map((f) => [f.tagIndex, f.estimatedSize]));
    payload = {
      status: 'ok',
      filePath: task.filePath,
      header: {
        scenarioName: result.header.scenarioName,
        buildString: result.header.buildString,
        mapType: result.header.mapType,
        crc32: result.header.crc32,
        tagDataOffset: result.header.tagDataOffset,
        tagDataSize: result.header.tagDataSize,
        decompressedFileSize: result.header.decompressedFileSize,
        fileSizeOnDisk: buffer.length,
        tagCount: result.tagIndex.tagCount,
      },
      tags: result.tagIndex.entries.map((e) => ({
        index: e.index,
        tagId: e.tagId,
        primaryClassName: e.primaryClassName ?? '?',
        path: e.path,
        isExternal: e.isExternal,
        estimatedSize: sizeByIndex.get(e.index) ?? null,
      })),
    };
  } else if (result.status === 'compressed') {
    payload = { status: 'compressed', filePath: task.filePath };
  } else {
    payload = { status: 'unsupported', filePath: task.filePath, message: result.message };
  }
  progress(task.taskId, 'Done', 100);
  parentPort?.postMessage({ type: 'result', taskId: task.taskId, payload });
}

async function runCompression(task: CompressTask) {
  progress(task.taskId, 'Reading file', 10);
  const buffer = fs.readFileSync(task.filePath);
  progress(task.taskId, task.type === 'decompress' ? 'Decompressing (zstd)' : 'Compressing (zstd level 19)', 35);
  const output =
    task.type === 'decompress' ? await decompressCustomEditionMap(buffer) : await compressCustomEditionMap(buffer, 19);
  progress(task.taskId, 'Writing output file', 85);
  fs.writeFileSync(task.outputPath, output);
  progress(task.taskId, 'Done', 100);
  parentPort?.postMessage({
    type: 'result',
    taskId: task.taskId,
    payload: { outputPath: task.outputPath, originalSize: buffer.length, newSize: output.length },
  });
}

parentPort?.on('message', async (task: Task) => {
  try {
    if (task.type === 'inspect') {
      await runInspect(task);
    } else {
      await runCompression(task);
    }
  } catch (err) {
    parentPort?.postMessage({
      type: 'error',
      taskId: task.taskId,
      message: err instanceof Error ? err.message : String(err),
    });
  }
});
