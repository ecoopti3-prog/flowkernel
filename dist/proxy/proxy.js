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
const net = __importStar(require("net"));
const optimizer_1 = require("./optimizer");
const lineage_1 = require("./lineage");
const chain_detector_1 = require("./chain-detector");
const DB_HOST = 'localhost';
const DB_PORT = 5432;
const PROXY_PORT = 5433;
function log(msg) {
    console.log(`[FlowKernel] ${new Date().toISOString()} ${msg}`);
}
function generateId() {
    return Math.random().toString(36).slice(2, 10);
}
function extractQuery(data) {
    if (data[0] !== 0x51)
        return null;
    const query = data.slice(5, data.length - 1).toString('utf8');
    return query.trim();
}
function rewritePacket(data, newQuery) {
    const queryBytes = Buffer.from(newQuery + '\0', 'utf8');
    const header = Buffer.alloc(5);
    header[0] = 0x51;
    header.writeUInt32BE(queryBytes.length + 4, 1);
    return Buffer.concat([header, queryBytes]);
}
const server = net.createServer((clientSocket) => {
    const sessionId = generateId();
    log(`New connection [${sessionId}]`);
    const dbSocket = net.createConnection({ host: DB_HOST, port: DB_PORT });
    clientSocket.on('data', (data) => {
        const query = extractQuery(data);
        if (query) {
            const start = Date.now();
            const result = (0, optimizer_1.optimizeQuery)(query, { users: 1000, orders: 5000 });
            const executionTimeMs = Date.now() - start;
            // Chain detection
            const chainResult = (0, chain_detector_1.trackQuery)(sessionId, query);
            if (chainResult) {
                log(`[${sessionId}] 🔗 CHAIN DETECTED: ${chainResult.pattern}`);
                log(`[${sessionId}]    Tables: ${chainResult.tables.join(', ')}`);
                log(`[${sessionId}]    ${chainResult.description}`);
                log(`[${sessionId}]    HINT: ${chainResult.hint}`);
            }
            if (result.optimizationsApplied.length > 0) {
                log(`[${sessionId}] ORIGINAL:  ${result.originalQuery}`);
                log(`[${sessionId}] OPTIMIZED: ${result.optimizedQuery}`);
                log(`[${sessionId}] APPLIED:   ${result.optimizationsApplied.join(', ')}`);
                if (result.inversionHints.length > 0) {
                    log(`[${sessionId}] HINT:      ${result.inversionHints[0]}`);
                }
                (0, lineage_1.recordLineage)({
                    lineageId: generateId(),
                    timestamp: new Date().toISOString(),
                    sessionId,
                    originalQuery: result.originalQuery,
                    optimizedQuery: result.optimizedQuery,
                    optimizationsApplied: result.optimizationsApplied,
                    inversionHints: result.inversionHints,
                    estimatedRowsSaved: result.estimatedRowsSaved,
                    executionTimeMs,
                });
                const rewritten = rewritePacket(data, result.optimizedQuery);
                dbSocket.write(rewritten);
                return;
            }
        }
        dbSocket.write(data);
    });
    dbSocket.on('data', (data) => {
        clientSocket.write(data);
    });
    clientSocket.on('end', () => {
        log(`[${sessionId}] Client disconnected`);
        dbSocket.end();
    });
    dbSocket.on('end', () => {
        clientSocket.end();
    });
    clientSocket.on('error', (err) => {
        log(`[${sessionId}] Client error: ${err.message}`);
        dbSocket.destroy();
    });
    dbSocket.on('error', (err) => {
        log(`[${sessionId}] DB error: ${err.message}`);
        clientSocket.destroy();
    });
});
server.listen(PROXY_PORT, () => {
    log(`✅ Proxy running on localhost:${PROXY_PORT}`);
    log(`   Forwarding to ${DB_HOST}:${DB_PORT}`);
});
