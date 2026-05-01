import * as net from 'net';
import { Client } from 'pg';
import { optimizeQuery } from './optimizer';
import { recordLineage } from './lineage';
import { trackQuery } from './chain-detector';

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

function parseConnectionString(cs: string) {
  const url = new URL(cs);
  return {
    host: url.hostname,
    port: parseInt(url.port) || 5432,
    database: url.pathname.slice(1),
    user: url.username,
    password: url.password,
  };
}

export async function startProxy(
  connectionString: string,
  proxyPort: number,
  dryRun: boolean
): Promise<void> {
  const dbConfig = parseConnectionString(connectionString);
  const tableStats: Record<string, number> = {};
  const knownColumns: Record<string, string[]> = {};

  // Load schema from DB
  const schemaClient = new Client(dbConfig);
  try {
    await schemaClient.connect();

    const tables = await schemaClient.query(`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public'
    `);

    for (const row of tables.rows) {
      const table = row.tablename;
      try {
        // Row count estimate
        const count = await schemaClient.query(
          `SELECT reltuples::bigint AS estimate FROM pg_class WHERE relname = $1`,
          [table]
        );
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
          .filter((r: { column_name: string; data_type: string }) => {
            const isHeavyType = HEAVY_TYPES.includes(r.data_type);
            const isHeavyName = HEAVY_NAMES.includes(r.column_name.toLowerCase());
            return !isHeavyType && !isHeavyName;
          })
          .map((r: { column_name: string }) => r.column_name);

        knownColumns[table] = lightColumns;
      } catch {
        // skip table on error
      }
    }

    await schemaClient.end();

    log(`Schema loaded: ${Object.keys(knownColumns).join(', ')}`);
    for (const [table, cols] of Object.entries(knownColumns)) {
      log(`  ${table}: ${cols.join(', ')}`);
    }

  } catch (err) {
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

    clientSocket.on('data', (data: Buffer) => {
      const query = extractQuery(data);

      if (query) {
        const start = Date.now();
        const result = optimizeQuery(query, tableStats, knownColumns);
        const executionTimeMs = Date.now() - start;

        const chain = trackQuery(sessionId, query);
        if (chain) {
          log(`[${sessionId}] CHAIN: ${chain.pattern} — ${chain.description}`);
          log(`[${sessionId}] HINT:  ${chain.hint}`);
        }

        if (result.optimizationsApplied.length > 0) {
          log(`[${sessionId}] ORIGINAL:  ${result.originalQuery}`);

          if (!dryRun) {
            log(`[${sessionId}] OPTIMIZED: ${result.optimizedQuery}`);
            log(`[${sessionId}] APPLIED:   ${result.optimizationsApplied.join(', ')}`);

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
          } else {
            log(`[${sessionId}] [DRY RUN] Would apply: ${result.optimizationsApplied.join(', ')}`);
          }
        }
      }

      dbSocket.write(data);
    });

    dbSocket.on('data', (data: Buffer) => clientSocket.write(data));
    clientSocket.on('end', () => { log(`[${sessionId}] Disconnected`); dbSocket.end(); });
    dbSocket.on('end', () => clientSocket.end());
    clientSocket.on('error', () => dbSocket.destroy());
    dbSocket.on('error', () => clientSocket.destroy());
  });

  server.listen(proxyPort);
}