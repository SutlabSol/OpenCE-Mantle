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
exports.getRecentMaps = getRecentMaps;
exports.addRecentMap = addRecentMap;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const electron_1 = require("electron");
const MAX_RECENT = 10;
function storePath() {
    return path.join(electron_1.app.getPath('userData'), 'recent-maps.json');
}
function getRecentMaps() {
    try {
        const raw = fs.readFileSync(storePath(), 'utf-8');
        const list = JSON.parse(raw);
        return Array.isArray(list) ? list.filter((p) => typeof p === 'string' && fs.existsSync(p)) : [];
    }
    catch {
        return [];
    }
}
function addRecentMap(filePath) {
    const current = getRecentMaps().filter((p) => p !== filePath);
    const updated = [filePath, ...current].slice(0, MAX_RECENT);
    try {
        fs.writeFileSync(storePath(), JSON.stringify(updated, null, 2));
    }
    catch {
        // Non-fatal: recent maps list just won't persist.
    }
    return updated;
}
