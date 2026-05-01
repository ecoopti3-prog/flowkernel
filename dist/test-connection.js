"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const pg_1 = require("pg");
const client = new pg_1.Client({
    host: 'localhost',
    port: 5433,
    database: 'testdb',
    user: 'postgres',
    password: 'dev123',
});
async function main() {
    await client.connect();
    console.log('✅ Connected via FlowKernel Proxy');
    const result = await client.query('SELECT * FROM users');
    console.log(`Rows returned: ${result.rows.length}`);
    console.log('Columns:', Object.keys(result.rows[0]));
    await client.end();
}
main().catch(console.error);
