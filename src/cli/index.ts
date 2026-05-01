import { readLineage } from '../proxy/lineage';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const args = process.argv.slice(2);
const command = args[0];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function printLineage() {
  const last = parseInt(args[1] ?? '20');
  const records = readLineage(last);

  if (records.length === 0) {
    console.log('No lineage records found. Run the proxy first.');
    return;
  }

  console.log(`\n📋 Last ${records.length} optimizations:\n`);

  for (const r of records) {
    const time = new Date(r.timestamp).toLocaleTimeString();
    const saved = r.estimatedRowsSaved
      ? `~${r.estimatedRowsSaved.toLocaleString()} rows saved`
      : '';

    console.log(`  ${time} [${r.sessionId}]`);
    console.log(`  Before: ${r.originalQuery}`);
    console.log(`  After:  ${r.optimizedQuery}`);
    console.log(`  Applied: ${r.optimizationsApplied.join(', ')} ${saved}`);
    if (r.inversionHints.length > 0) {
      console.log(`  Hint:   ${r.inversionHints[0]}`);
    }
    console.log();
  }
}

function printChains() {
  const dir = join(homedir(), '.flowkernel', 'lineage');
  const date = new Date().toISOString().slice(0, 10);
  const filePath = join(dir, `${date}.jsonl`);

  if (!existsSync(filePath)) {
    console.log('No chain data found. Run the proxy first.');
    return;
  }

  const lines = readFileSync(filePath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(l => JSON.parse(l));

  // Group by session
  const sessions: Record<string, typeof lines> = {};
  for (const r of lines) {
    if (!sessions[r.sessionId]) sessions[r.sessionId] = [];
    sessions[r.sessionId].push(r);
  }

  console.log(`\n🔗 Chain summary (today):\n`);

  for (const [sessionId, records] of Object.entries(sessions)) {
    const tables = [...new Set(records.map((r: any) => {
      const m = r.originalQuery.match(/FROM\s+(\w+)/i);
      return m?.[1] ?? '?';
    }))];

    const totalRows = records.reduce((sum: number, r: any) => {
      return sum + (r.estimatedRowsSaved ?? 0);
    }, 0);

    console.log(`  Session: ${sessionId}`);
    console.log(`  Queries: ${records.length}`);
    console.log(`  Tables:  ${tables.join(' → ')}`);
    if (totalRows > 0) {
      console.log(`  Saved:   ~${totalRows.toLocaleString()} rows`);
    }
    console.log();
  }
}

function printStatus() {
  const dir = join(homedir(), '.flowkernel', 'lineage');
  const date = new Date().toISOString().slice(0, 10);
  const filePath = join(dir, `${date}.jsonl`);

  if (!existsSync(filePath)) {
    console.log('No data yet. Start the proxy: npx tsx src/proxy/proxy.ts');
    return;
  }

  const lines = readFileSync(filePath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(l => JSON.parse(l));

  const totalOptimizations = lines.length;
  const totalRowsSaved = lines.reduce((sum: number, r: any) => {
    return sum + (r.estimatedRowsSaved ?? 0);
  }, 0);
  const uniqueSessions = new Set(lines.map((r: any) => r.sessionId)).size;
  const appliedCounts: Record<string, number> = {};
  for (const r of lines) {
    for (const opt of r.optimizationsApplied) {
      appliedCounts[opt] = (appliedCounts[opt] ?? 0) + 1;
    }
  }

  console.log(`\n📊 FlowKernel Status (today)\n`);
  console.log(`  Optimizations:  ${totalOptimizations}`);
  console.log(`  Sessions:       ${uniqueSessions}`);
  console.log(`  Rows saved:     ~${totalRowsSaved.toLocaleString()}`);
  console.log(`\n  Breakdown:`);
  for (const [opt, count] of Object.entries(appliedCounts)) {
    console.log(`    ${opt}: ${count}x`);
  }
  console.log();
}

function printHelp() {
  console.log(`
FlowKernel CLI

Commands:
  status              Show today's optimization summary
  lineage [n]         Show last N optimizations (default: 20)
  chains              Show chain patterns detected today
  help                Show this help

Examples:
  npx tsx src/cli/index.ts status
  npx tsx src/cli/index.ts lineage 10
  npx tsx src/cli/index.ts chains
  `);
}

switch (command) {
  case 'status':   printStatus();  break;
  case 'lineage':  printLineage(); break;
  case 'chains':   printChains();  break;
  case 'help':     printHelp();    break;
  default:
    console.log(`Unknown command: ${command ?? '(none)'}`);
    printHelp();
}