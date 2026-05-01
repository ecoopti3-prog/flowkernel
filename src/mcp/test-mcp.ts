import { Client } from 'pg';
import { optimizeQuery } from '../proxy/optimizer';
import { recordLineage } from '../proxy/lineage';
import { trackQuery } from '../proxy/chain-detector';
import { readLineage } from '../proxy/lineage';

function generateId(): string {
  return Math.random().toString(36).slice(2, 10);
}

const SESSION_ID = `mcp_test_${generateId()}`;
const DB_CONFIG = {
  host: 'localhost',
  port: 5432,
  database: 'testdb',
  user: 'postgres',
  password: 'dev123',
};

async function queryDatabase(sql: string) {
  console.log(`\n🔧 tool: query_database`);
  console.log(`   input: ${sql}`);

  if (!sql.trim().toUpperCase().startsWith('SELECT')) {
    console.log(`   ❌ Error: Only SELECT queries allowed`);
    return;
  }

  const client = new Client(DB_CONFIG);
  await client.connect();

  const optimized = optimizeQuery(sql, { users: 1000, orders: 5000 });
  const chain = trackQuery(SESSION_ID, sql);
  const result = await client.query(optimized.optimizedQuery);

  if (optimized.optimizationsApplied.length > 0) {
    recordLineage({
      lineageId: generateId(),
      timestamp: new Date().toISOString(),
      sessionId: SESSION_ID,
      originalQuery: sql,
      optimizedQuery: optimized.optimizedQuery,
      optimizationsApplied: optimized.optimizationsApplied,
      inversionHints: optimized.inversionHints,
      estimatedRowsSaved: optimized.estimatedRowsSaved,
    });
  }

  console.log(`   ✅ rows: ${result.rowCount}`);
  console.log(`   optimizations: ${optimized.optimizationsApplied.join(', ') || 'none'}`);
  console.log(`   executed: ${optimized.optimizedQuery}`);
  if (optimized.inversionHints.length > 0) {
    console.log(`   hint: ${optimized.inversionHints[0]}`);
  }
  if (chain) {
    console.log(`   🔗 chain: ${chain.pattern} — ${chain.hint}`);
  }

  await client.end();
}

async function getSchema(table: string) {
  console.log(`\n🔧 tool: get_schema`);
  console.log(`   input: ${table}`);

  const client = new Client(DB_CONFIG);
  await client.connect();

  const result = await client.query(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name = $1
    ORDER BY ordinal_position
  `, [table]);

  console.log(`   ✅ columns:`);
  for (const row of result.rows) {
    console.log(`      ${row.column_name} (${row.data_type})`);
  }

  await client.end();
}

async function getUsageStats() {
  console.log(`\n🔧 tool: get_usage_stats`);
  const records = readLineage(5);
  console.log(`   ✅ total optimizations today: ${records.length}`);
  const saved = records.reduce((sum, r) => sum + (r.estimatedRowsSaved ?? 0), 0);
  console.log(`   rows saved: ~${saved.toLocaleString()}`);
}

async function main() {
  console.log('🤖 Simulating MCP tool calls...\n');

  await queryDatabase('SELECT * FROM users');
  await queryDatabase('SELECT * FROM orders');
  await queryDatabase('SELECT * FROM users');
  await getSchema('users');
  await getUsageStats();

  console.log('\n✅ MCP simulation complete');
}

main().catch(console.error);