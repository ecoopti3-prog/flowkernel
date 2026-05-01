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
exports.startProxy = startProxy;
const net = __importStar(require("net"));
const pg_1 = require("pg");
const optimizer_1 = require("./optimizer");
const lineage_1 = require("./lineage");
const chain_detector_1 = require("./chain-detector");
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
function parseConnectionString(cs) {
    const url = new URL(cs);
    return {
        host: url.hostname,
        port: parseInt(url.port) || 5432,
        database: url.pathname.slice(1),
        user: url.username,
        password: url.password,
    };
}
async function startProxy(connectionString, proxyPort, dryRun) {
    const dbConfig = parseConnectionString(connectionString);
    const tableStats = {};
    const knownColumns = {};
    // Load schema from DB
    const schemaClient = new pg_1.Client(dbConfig);
    try {
        await schemaClient.connect();
        const tables = await schemaClient.query(`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public'
    `);
        for (const row of tables.rows) {
            const table = row.tablename;
            try {
                // Row count estimate
                const count = await schemaClient.query(`SELECT reltuples::bigint AS estimate FROM pg_class WHERE relname = $1`, [table]);
                tableStats[table] = parseInt(count.rows[0]?.estimate ?? '0');
                // Columns — exclude heavy types
                const cols = await schemaClient.query(`
          SELECT column_name, data_type
          FROM information_schema.columns
          WHERE table_name = $1 AND table_schema = 'public'
          ORDER BY ordinal_position
        `, [table]);
                const HEAVY_TYPES = ['jsonb', 'json'];
                const HEAVY_NAMES = ['bio', 'metadata', 'description', 'content', 'body', 'raw'];
                const lightColumns = cols.rows
                    .filter((r) => {
                    const isHeavyType = HEAVY_TYPES.includes(r.data_type);
                    const isHeavyName = HEAVY_NAMES.includes(r.column_name.toLowerCase());
                    return !isHeavyType && !isHeavyName;
                })
                    .map((r) => r.column_name);
                knownColumns[table] = lightColumns;
            }
            catch {
                // skip table on error
            }
        }
        await schemaClient.end();
        log(`Schema loaded: ${Object.keys(knownColumns).join(', ')}`);
        for (const [table, cols] of Object.entries(knownColumns)) {
            log(`  ${table}: ${cols.join(', ')}`);
        }
    }
    catch (err) {
        log('Warning: Could not load schema. Using defaults.');
    }
    // Start proxy server
    const server = net.createServer((clientSocket) => {
        const sessionId = generateId();
        log(`New connection [${sessionId}]`);
        const dbSocket = net.createConnection({
            host: dbConfig.host,
            port: dbConfig.port,
        });
        clientSocket.on('data', (data) => {
            const query = extractQuery(data);
            if (query) {
                const start = Date.now();
                const result = (0, optimizer_1.optimizeQuery)(query, tableStats, knownColumns);
                const executionTimeMs = Date.now() - start;
                const chain = (0, chain_detector_1.trackQuery)(sessionId, query);
                if (chain) {
                    log(`[${sessionId}] CHAIN: ${chain.pattern} — ${chain.description}`);
                    log(`[${sessionId}] HINT:  ${chain.hint}`);
                }
                if (result.optimizationsApplied.length > 0) {
                    log(`[${sessionId}] ORIGINAL:  ${result.originalQuery}`);
                    if (!dryRun) {
                        log(`[${sessionId}] OPTIMIZED: ${result.optimizedQuery}`);
                        log(`[${sessionId}] APPLIED:   ${result.optimizationsApplied.join(', ')}`);
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
                    else {
                        log(`[${sessionId}] [DRY RUN] Would apply: ${result.optimizationsApplied.join(', ')}`);
                    }
                }
            }
            dbSocket.write(data);
        });
        dbSocket.on('data', (data) => clientSocket.write(data));
        clientSocket.on('end', () => { log(`[${sessionId}] Disconnected`); dbSocket.end(); });
        dbSocket.on('end', () => clientSocket.end());
        clientSocket.on('error', () => dbSocket.destroy());
        dbSocket.on('error', () => clientSocket.destroy());
    });
    server.listen(proxyPort);
}
