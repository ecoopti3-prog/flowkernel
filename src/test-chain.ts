import { Client } from 'pg';

async function query(client: Client, sql: string) {
  const result = await client.query(sql);
  console.log(`✓ ${sql} → ${result.rows.length} rows`);
}

async function main() {
  const client = new Client({
    host: 'localhost',
    port: 5433,
    database: 'testdb',
    user: 'postgres',
    password: 'dev123',
  });

  await client.connect();
  console.log('🤖 Simulating AI agent bulk prefetch...\n');

  // Simulate agent that pulls everything before starting
  await query(client, 'SELECT * FROM users');
  await query(client, 'SELECT * FROM orders');
  await query(client, 'SELECT * FROM users');

  await client.end();
}

main().catch(console.error);