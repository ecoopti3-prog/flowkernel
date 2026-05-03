import { readLineage } from '../proxy/lineage';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const args = process.argv.slice(2);
const command = args[0];

const DISCLAIMER = '* estimate: Claude Sonnet pricing × rows × 100 queries/day';

function formatCost(usd: number): string {
  return `~$${usd.toFixed(2)}/month*`;
}

function printStatus() {
  const dir = join(homedir(), '.flowkernel', 'lineage');
  const date = new Date().toISOString().slice(0, 10);
  const filePath = join(dir, `${date}.jsonl`);

  if (!existsSync(filePath)) {
    console.log('No data yet. Start the proxy: npx flowkernel start --db postgres://...');
    return;
  }

  const lines = readFileSync(filePath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(l => JSON.parse(l));

  const totalOptimizations = lines.length;
  const totalRowsSaved = lines.reduce((sum: number, r: any) => sum + (r.estimatedRowsSaved ?? 0), 0);
  const totalCostSaved = lines.reduce((sum: number, r: any) => sum + (r.estimatedMonthlyCostUsd ?? 0), 0);
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
  console.log(`  Cost saved:     ${formatCost(totalCostSaved)}`);
  console.log(`\n  Breakdown:`);
  for (const [opt, count] of Object.entries(appliedCounts)) {
    console.log(`    ${opt}: ${count}x`);
  }
  console.log(`\n  ${DISCLAIMER}`);
  console.log();
}

function printDoctor() {
  const records = readLineage(100);

  if (records.length === 0) {
    console.log('No data yet. Run the proxy first: npx flowkernel start --db postgres://...');
    return;
  }

  // Group by optimization type (triage logic from CyberSentinel)
  const groups: Record<string, {
    records: typeof records;
    totalRows: number;
    totalCost: number;
  }> = {};

  for (const r of records) {
    const key = r.optimizationsApplied[0] ?? 'unknown';
    if (!groups[key]) {
      groups[key] = { records: [], totalRows: 0, totalCost: 0 };
    }
    groups[key].records.push(r);
    groups[key].totalRows += r.estimatedRowsSaved ?? 0;
    groups[key].totalCost += r.estimatedMonthlyCostUsd ?? 0;
  }

  // Sort by cost — highest first
  const sorted = Object.entries(groups)
    .sort(([, a], [, b]) => b.totalCost - a.totalCost)
    .slice(0, 3);

  const totalCost = sorted.reduce((sum, [, g]) => sum + g.totalCost, 0);
  const totalRows = sorted.reduce((sum, [, g]) => sum + g.totalRows, 0);

  console.log(`\n🧠 Top Data Waste Issues (today)\n`);
  console.log('━'.repeat(50));

  const priority = ['Fix this first', 'Fix this week', 'Fix when ready'];
  const emoji = ['🔴', '🔴', '🟠'];

  sorted.forEach(([type, group], i) => {
    const sample = group.records[0];
    const hint = sample.inversionHints[0] ?? '';

    console.log(`\n#${i + 1} ${emoji[i]} ${priority[i]} — saves ${formatCost(group.totalCost)}`);
    console.log(`   Pattern:  ${type}`);
    console.log(`   Fetched:  ~${group.totalRows.toLocaleString()} rows`);
    console.log(`   Fix:`);
    console.log(`     ${hint}`);

    if (sample.originalQuery !== sample.optimizedQuery) {
      console.log(`\n     -- Instead of:`);
      console.log(`     ${sample.originalQuery}`);
      console.log(`\n     -- Use:`);
      console.log(`     ${sample.optimizedQuery}`);
    }

    console.log('\n' + '━'.repeat(50));
  });

  console.log(`\nTotal estimated waste: ${formatCost(totalCost)}`);
  console.log(`Rows analyzed:         ~${totalRows.toLocaleString()}`);
  console.log(`Sessions today:        ${new Set(records.map(r => r.sessionId)).size}`);
  console.log(`\n${DISCLAIMER}\n`);
}

function printLineage() {
  const last = parseInt(args[1] ?? '10');
  const records = readLineage(last);

  if (records.length === 0) {
    console.log('No lineage records found. Run the proxy first.');
    return;
  }

  console.log(`\n📋 Last ${records.length} optimizations:\n`);

  for (const r of records) {
    const time = new Date(r.timestamp).toLocaleTimeString();
    const cost = r.estimatedMonthlyCostUsd
      ? ` · ${formatCost(r.estimatedMonthlyCostUsd)}`
      : '';

    console.log(`  ${time} [${r.sessionId}]`);
    console.log(`  Before:  ${r.originalQuery}`);
    console.log(`  After:   ${r.optimizedQuery}`);
    console.log(`  Applied: ${r.optimizationsApplied.join(', ')}${cost}`);
    if (r.inversionHints.length > 0) {
      console.log(`  Hint:    ${r.inversionHints[0]}`);
    }
    console.log();
  }
  console.log(`${DISCLAIMER}\n`);
}

function printHelp() {
  console.log(`
FlowKernel CLI

Commands:
  status          Show today's optimization summary with cost savings
  doctor          Show top 3 waste issues with fixes and cost (recommended)
  lineage [n]     Show last N optimizations (default: 10)
  help            Show this help

Examples:
  npx flowkernel status
  npx flowkernel doctor
  npx flowkernel lineage 20
  `);
}

switch (command) {
  case 'status':  printStatus();  break;
  case 'doctor':  printDoctor();  break;
  case 'lineage': printLineage(); break;
  case 'help':    printHelp();    break;
  default:
    console.log(`Unknown command: ${command ?? '(none)'}`);
    printHelp();
}