import * as net from 'net';
import { optimizeQuery } from './optimizer';
import { recordLineage } from './lineage';
import { trackQuery } from './chain-detector';

const DB_HOST = 'localhost';
const DB_PORT = 5432;
const PROXY_PORT = 5433;

function log(msg: string) {
  console.log(`[FlowKernel] ${new Date().toISOString()} ${msg}`);
}

function generateId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function extractQuery(data: Buffer): string | null {
  if (data[0] !== 0x51) return null;
  const query = data.slice(5, data.length - 1).toString('utf8');
  return query.trim();
}

function rewritePacket(data: Buffer, newQuery: string): Buffer {
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

  clientSocket.on('data', (data: Buffer) => {
    const query = extractQuery(data);

    if (query) {
      const start = Date.now();
      const result = optimizeQuery(query, { users: 1000, orders: 5000 });
      const executionTimeMs = Date.now() - start;

      // Chain detection
      const chainResult = trackQuery(sessionId, query);
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

        recordLineage({
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

  dbSocket.on('data', (data: Buffer) => {
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