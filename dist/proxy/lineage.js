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
exports.recordLineage = recordLineage;
exports.readLineage = readLineage;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
function getLogPath() {
    const dir = path.join(os.homedir(), '.flowkernel', 'lineage');
    fs.mkdirSync(dir, { recursive: true });
    const date = new Date().toISOString().slice(0, 10);
    return path.join(dir, `${date}.jsonl`);
}
function recordLineage(record) {
    try {
        const logPath = getLogPath();
        console.log(`[Lineage] Writing to: ${logPath}`);
        const line = JSON.stringify(record) + '\n';
        fs.appendFileSync(logPath, line, 'utf8');
        console.log(`[Lineage] Written successfully`);
    }
    catch (err) {
        console.error(`[Lineage] ERROR:`, err);
    }
}
function readLineage(last = 20) {
    try {
        const filePath = getLogPath();
        if (!fs.existsSync(filePath))
            return [];
        const lines = fs.readFileSync(filePath, 'utf8')
            .split('\n')
            .filter(Boolean)
            .map(line => JSON.parse(line));
        return lines.slice(-last).reverse();
    }
    catch {
        return [];
    }
}
