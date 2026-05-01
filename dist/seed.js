"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const pg_1 = require("pg");
const client = new pg_1.Client({
    host: 'localhost',
    port: 5432,
    database: 'testdb',
    user: 'postgres',
    password: 'dev123',
});
async function seed() {
    await client.connect();
    console.log('🌱 Seeding database...');
    await client.query(`
    CREATE TABLE IF NOT EXISTS users (
      id          SERIAL PRIMARY KEY,
      name        TEXT NOT NULL,
      email       TEXT NOT NULL,
      last_login  TIMESTAMPTZ DEFAULT NOW(),
      bio         TEXT,
      metadata    JSONB,
      created_at  TIMESTAMPTZ DEFAULT NOW()
    );
  `);
    await client.query(`
    CREATE TABLE IF NOT EXISTS orders (
      id          SERIAL PRIMARY KEY,
      user_id     INTEGER REFERENCES users(id),
      product     TEXT NOT NULL,
      amount      FLOAT NOT NULL,
      status      TEXT DEFAULT 'pending',
      notes       TEXT,
      created_at  TIMESTAMPTZ DEFAULT NOW()
    );
  `);
    // Insert 1000 users
    for (let i = 1; i <= 1000; i++) {
        await client.query(`
      INSERT INTO users (name, email, bio, metadata)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT DO NOTHING
    `, [
            `User ${i}`,
            `user${i}@example.com`,
            `Bio of user ${i} — lots of text that nobody reads`,
            JSON.stringify({ score: i, active: i % 2 === 0 })
        ]);
    }
    // Insert 5000 orders
    for (let i = 1; i <= 5000; i++) {
        await client.query(`
      INSERT INTO orders (user_id, product, amount, status, notes)
      VALUES ($1, $2, $3, $4, $5)
    `, [
            Math.ceil(Math.random() * 1000),
            `Product ${i % 20}`,
            Math.random() * 500,
            ['pending', 'done', 'cancelled'][i % 3],
            `Note for order ${i} — extra data nobody uses`
        ]);
    }
    console.log('✅ Done: 1000 users, 5000 orders');
    await client.end();
}
seed().catch(console.error);
