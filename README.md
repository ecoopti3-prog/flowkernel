# FlowKernel

> AI Data Movement Optimizer — stops AI agents from moving data they don't need.

## The Problem

AI agents are terrible at fetching data:

```sql
SELECT * FROM users   -- 180,000 rows, 24 columns
SELECT * FROM orders  -- 50,000 rows, 12 columns  
SELECT * FROM products -- 5,000 rows, 8 columns
```

They fetch everything before they start thinking.
Most of it gets thrown away.

**FlowKernel sits between your agent and your database — and fixes this automatically.**

## How It Works

```
AI Agent
   ↓
FlowKernel Proxy  ← intercepts queries
   ↓
PostgreSQL
```

FlowKernel:
- Rewrites `SELECT *` to only the columns that matter
- Adds `LIMIT` when missing
- Detects when an agent bulk-fetches multiple tables
- Logs every optimization with before/after proof

## Quick Start

```bash
npx tsx src/index.ts start --db postgres://user:pass@localhost:5432/mydb
```

Output:
```
✅ FlowKernel running
   Proxy:    localhost:5433
   DB:       postgres://***@localhost:5432/mydb

Connect your app to localhost:5433 instead of localhost:5432
```

That's it. No code changes. Just point your app to port 5433.

## What You'll See

```
[FlowKernel] ORIGINAL:  SELECT * FROM users
[FlowKernel] OPTIMIZED: SELECT id, name, email FROM users LIMIT 1000
[FlowKernel] APPLIED:   select_star_pruning, auto_limit
[FlowKernel] CHAIN:     repeated_full_scan — agent fetched users twice
[FlowKernel] HINT:      Cache results or add WHERE clause
```

## CLI

```bash
# See what was optimized today
npx tsx src/cli/index.ts status

# Full optimization log with before/after
npx tsx src/cli/index.ts lineage

# Chain patterns detected (bulk fetches, N+1, repeated scans)
npx tsx src/cli/index.ts chains
```

Example output:
```
📊 FlowKernel Status (today)
  Optimizations:  9
  Sessions:       5
  Rows saved:     ~8,000

  Breakdown:
    select_star_pruning: 9x
    auto_limit: 9x
```

## MCP Integration (for AI agents)

Add to your `claude_desktop_config.json` or Cursor config:

```json
{
  "mcpServers": {
    "flowkernel": {
      "command": "npx",
      "args": ["tsx", "src/mcp/server.ts"]
    }
  }
}
```

Available tools:
- `query_database` — runs optimized read-only queries
- `get_schema` — returns table structure
- `get_usage_stats` — shows optimization history
- `get_inversion_hints` — suggests better query patterns

## Installation

```bash
git clone https://github.com/ecoopti3-prog/flowkernel.git
cd flowkernel
npm install
```

Requirements:
- Node.js >= 18
- PostgreSQL database

## What Gets Optimized

| Pattern | Before | After |
|---|---|---|
| SELECT * | all columns | only relevant columns |
| No LIMIT | full table scan | LIMIT 1000 |
| Bulk prefetch | 3 tables × 50K rows | detected + warned |
| Repeated scan | same table 3x | detected + warned |
| N+1 | 847 queries | detected + hint to batch |

## Why This Matters for AI Agents

Current tools optimize tokens — **after** data moves.

FlowKernel optimizes **before** data moves.

The proxy sees what your agent actually fetches vs. what it uses.
That gap is where the waste is.

## Roadmap

- [x] PostgreSQL proxy
- [x] SELECT * pruning
- [x] Auto LIMIT
- [x] Chain detection (bulk_prefetch, N+1, repeated_scan)
- [x] Lineage recording
- [x] CLI
- [x] MCP server
- [ ] Dashboard UI
- [ ] Shadow Learning Engine
- [ ] MySQL support
- [ ] Cloud mode

## License

MIT
