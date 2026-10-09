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
exports.runMapWorkerTask = runMapWorkerTask;
const worker_threads_1 = require("worker_threads");
const path = __importStar(require("path"));
const crypto_1 = require("crypto");
/**
 * Runs one map-worker.js task in a fresh worker thread (heavy parsing/zstd work never
 * blocks the Electron main/UI thread) and resolves with its result payload.
 */
function runMapWorkerTask(task, onProgress) {
    const taskId = (0, crypto_1.randomUUID)();
    const worker = new worker_threads_1.Worker(path.join(__dirname, 'map-worker.js'));
    return new Promise((resolve, reject) => {
        worker.on('message', (msg) => {
            if (msg.taskId !== taskId)
                return;
            if (msg.type === 'progress') {
                onProgress(msg.stage, msg.percent);
            }
            else if (msg.type === 'result') {
                resolve(msg.payload);
                worker.terminate();
            }
            else if (msg.type === 'error') {
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
