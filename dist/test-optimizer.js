"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const optimizer_1 = require("./proxy/optimizer");
const queries = [
    'SELECT * FROM users',
    'SELECT * FROM orders',
    'SELECT id, name FROM users WHERE id = 1',
    'SELECT * FROM users LIMIT 10',
    'INSERT INTO users (name) VALUES (\'test\')',
];
for (const q of queries) {
    const result = (0, optimizer_1.optimizeQuery)(q, { users: 1000, orders: 5000 });
    console.log('\n─────────────────────────');
    console.log('Original: ', result.originalQuery);
    console.log('Optimized:', result.optimizedQuery);
    console.log('Applied:  ', result.optimizationsApplied);
    console.log('Hints:    ', result.inversionHints);
}
