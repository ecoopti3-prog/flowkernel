import { Client } from 'pg';
import { rowsToDollars } from '../proxy/optimizer';

const DISCLAIMER = '* estimate: Claude Sonnet pricing × rows × 3 queries/day';

interface TableInfo {
  name: string;
  rowCount: number;
  columns: { name: string; type: string }[];
  indexes: string[];
}

async function getTableInfo(client: Client): Promise<TableInfo[]> {
  const tables = await client.query(`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  `);

  const result: TableInfo[] = [];

  for (const row of tables.rows) {
    const table = row.tablename;

    // Row count estimate
    const countRes = await client.query(`
      SELECT reltuples::bigint AS estimate
      FROM pg_class WHERE relname = $1
    `, [table]);
    const rowCount = parseInt(countRes.rows[0]?.estimate ?? '0');

    // Columns
    const colRes = await client.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = $1 AND table_schema = 'public'
      ORDER BY ordinal_position
    `, [table]);
   const columns = colRes.rows.map(r => ({ name: r.column_name, type: r.data_type }));

    // Indexes
    const idxRes = await client.query(`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE tablename = $1 AND schemaname = 'public'
    `, [table]);
    const indexes = idxRes.rows.map(r => r.indexname);

    result.push({ name: table, rowCount, columns, indexes });
  }

  return result;
}

interface Finding {
  severity: 'critical' | 'high' | 'medium';
  pattern: string;
  table: string;
  description: string;
  estimatedMonthlyCost: number;
  fix: string;
  sqlBefore?: string;
  sqlAfter?: string;
}

function analyzeTable(table: TableInfo): Finding[] {
  const findings: Finding[] = [];
  const { name, rowCount, columns, indexes } = table;

  if (rowCount < 100) return []; // skip tiny tables

  // Finding 1: Wide table — SELECT * risk
  const heavyCols = columns.filter(c =>
    ['jsonb', 'json', 'text'].includes(c.type) ||
    ['bio', 'metadata', 'description', 'content', 'body', 'notes', 'raw'].includes(c.name)
  );
  const totalCols = columns.length;

  if (totalCols >= 8 || heavyCols.length >= 2) {
    const colsSaved = heavyCols.length + Math.max(0, totalCols - 6);
    const fractionSaved = colsSaved / totalCols;
    const rowsEquivalent = Math.round(rowCount * fractionSaved);
    const cost = rowsToDollars(rowsEquivalent);

    const safeCols = columns
      .filter(c => !heavyCols.find(h => h.name === c.name))
      .slice(0, 6)
      .map(c => c.name);

    findings.push({
      severity: cost > 20 ? 'critical' : 'high',
      pattern: 'wide_table_select_star',
      table: name,
      description: `${totalCols} columns — AI agents likely fetch all, use ~${Math.max(3, totalCols - heavyCols.length - 2)}`,
      estimatedMonthlyCost: cost,
      fix: `SELECT only the columns you need`,
      sqlBefore: `SELECT * FROM ${name};`,
      sqlAfter: `SELECT ${safeCols.join(', ')}\nFROM ${name}\nWHERE <condition>\nLIMIT 50;`,
    });
  }

  // Finding 2: Large table without LIMIT protection
  if (rowCount > 5000) {
    const rowsAtRisk = rowCount - 100;
    const cost = rowsToDollars(rowsAtRisk);

    findings.push({
      severity: rowCount > 50000 ? 'critical' : 'high',
      pattern: 'no_limit_protection',
      table: name,
      description: `${rowCount.toLocaleString()} rows — query without LIMIT fetches everything`,
      estimatedMonthlyCost: cost,
      fix: `Add LIMIT or use FlowKernel proxy (adds LIMIT automatically)`,
      sqlBefore: `SELECT id, name FROM ${name};`,
      sqlAfter: `SELECT id, name FROM ${name}\nWHERE <condition>\nLIMIT 50;`,
    });
  }

  // Finding 3: Missing index on likely filter columns
  const commonFilterCols = ['user_id', 'account_id', 'org_id', 'status', 'created_at', 'email'];
  const missingIndexes = columns
    .filter(c => commonFilterCols.includes(c.name))
    .filter(c => !indexes.some(idx => idx.toLowerCase().includes(c.name)));

  if (missingIndexes.length > 0 && rowCount > 1000) {
    const cost = rowsToDollars(Math.round(rowCount * 0.8));
    missingIndexes.slice(0, 2).forEach(col => {
      findings.push({
        severity: 'high',
        pattern: 'missing_index',
        table: name,
        description: `No index on '${col.name}' — queries filter on this column do full scan`,
        estimatedMonthlyCost: cost,
        fix: `CREATE INDEX idx_${name}_${col.name} ON ${name}(${col.name});`,
      });
    });
  }

  return findings;
}

export async function runDiagnose(connectionString: string): Promise<void> {
  const client = new Client({ connectionString });

  process.stdout.write('\n📁 Connecting to database...');

  try {
    await client.connect();
    process.stdout.write(' ✅\n');
  } catch {
    console.log(' ❌');
    console.error('Cannot connect to database. Check your connection string.');
    process.exit(1);
  }

  process.stdout.write('   Analyzing tables...');
  const tables = await getTableInfo(client);
  process.stdout.write(` ✅ (${tables.length} tables found)\n`);

  await client.end();

  const allFindings: Finding[] = [];
  for (const table of tables) {
    allFindings.push(...analyzeTable(table));
  }

  // Sort by cost — highest first (triage logic)
  allFindings.sort((a, b) => b.estimatedMonthlyCost - a.estimatedMonthlyCost);

  const top3 = allFindings.slice(0, 3);
  const totalCost = allFindings.reduce((sum, f) => sum + f.estimatedMonthlyCost, 0);

  if (top3.length === 0) {
    console.log('\n✅ No significant waste patterns detected.\n');
    return;
  }

  console.log('\n' + '━'.repeat(50));
  console.log(`\nFound ${allFindings.length} expensive patterns:\n`);

  const priorityLabel = ['Fix this first', 'Fix this week', 'Fix when ready'];
  const emoji = { critical: '🔴', high: '🔴', medium: '🟠' };

  top3.forEach((f, i) => {
    console.log(`  ${emoji[f.severity]} #${i + 1} — ${priorityLabel[i]}`);
    console.log(`     Table:   ${f.table} (${tables.find(t => t.name === f.table)?.rowCount.toLocaleString()} rows)`);
    console.log(`     Issue:   ${f.description}`);
    console.log(`     Cost:    ~$${f.estimatedMonthlyCost.toFixed(2)}/month*`);
    console.log(`     Fix:     ${f.fix}`);

    if (f.sqlBefore && f.sqlAfter) {
      console.log(`\n     -- Instead of:`);
      console.log(`     ${f.sqlBefore}`);
      console.log(`\n     -- Use:`);
      f.sqlAfter.split('\n').forEach(line => console.log(`     ${line}`));
    }

    console.log('\n' + '━'.repeat(50));
  });

  console.log(`
Summary: ~$${totalCost.toFixed(2)}/month in estimated waste.

Run: npx flowkernel start --db <connection_string>
     to fix automatically.

${DISCLAIMER}
`);
}