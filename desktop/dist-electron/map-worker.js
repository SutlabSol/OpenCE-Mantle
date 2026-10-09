"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const worker_threads_1 = require("worker_threads");
const fs = __importStar(require("fs"));
const index_1 = require("../../core/dist/index");
function progress(taskId, stage, percent) {
    worker_threads_1.parentPort?.postMessage({ type: 'progress', taskId, stage, percent });
}
async function runInspect(task) {
    progress(task.taskId, 'Reading file', 10);
    const buffer = fs.readFileSync(task.filePath);
    progress(task.taskId, 'Parsing header and tag index', 50);
    const result = (0, index_1.inspectCustomEditionMap)(buffer);
    let payload;
    if (result.status === 'ok') {
        const footprints = (0, index_1.estimateTagFootprints)(result.header, result.tagIndex);
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
    }
    else if (result.status === 'compressed') {
        payload = { status: 'compressed', filePath: task.filePath };
    }
    else {
        payload = { status: 'unsupported', filePath: task.filePath, message: result.message };
    }
    progress(task.taskId, 'Done', 100);
    worker_threads_1.parentPort?.postMessage({ type: 'result', taskId: task.taskId, payload });
}
async function runCompression(task) {
    progress(task.taskId, 'Reading file', 10);
    const buffer = fs.readFileSync(task.filePath);
    progress(task.taskId, task.type === 'decompress' ? 'Decompressing (zstd)' : 'Compressing (zstd level 19)', 35);
    const output = task.type === 'decompress' ? await (0, index_1.decompressCustomEditionMap)(buffer) : await (0, index_1.compressCustomEditionMap)(buffer, 19);
    progress(task.taskId, 'Writing output file', 85);
    fs.writeFileSync(task.outputPath, output);
    progress(task.taskId, 'Done', 100);
    worker_threads_1.parentPort?.postMessage({
        type: 'result',
        taskId: task.taskId,
        payload: { outputPath: task.outputPath, originalSize: buffer.length, newSize: output.length },
    });
}
worker_threads_1.parentPort?.on('message', async (task) => {
    try {
        if (task.type === 'inspect') {
            await runInspect(task);
        }
        else {
            await runCompression(task);
        }
    }
    catch (err) {
        worker_threads_1.parentPort?.postMessage({
            type: 'error',
            taskId: task.taskId,
            message: err instanceof Error ? err.message : String(err),
        });
    }
});
