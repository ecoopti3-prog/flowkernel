export interface OptimizationResult {
  originalQuery: string;
  optimizedQuery: string;
  optimizationsApplied: string[];
  inversionHints: string[];
  estimatedRowsSaved?: number;
}

const DEFAULT_COLUMNS: Record<string, string[]> = {
  users:  ['id', 'name', 'email', 'last_login'],
  orders: ['id', 'user_id', 'product', 'amount', 'status'],
};

export function optimizeQuery(
  sql: string,
  tableStats: Record<string, number> = {},
  knownColumns: Record<string, string[]> = DEFAULT_COLUMNS
): OptimizationResult {
  const result: OptimizationResult = {
    originalQuery: sql,
    optimizedQuery: sql,
    optimizationsApplied: [],
    inversionHints: [],
  };

  try {
    const trimmed = sql.trim();
    if (!trimmed.toUpperCase().startsWith('SELECT')) return result;

    let optimized = trimmed;

    // Rule 1: SELECT * pruning
    const selectStarMatch = optimized.match(/^SELECT\s+\*\s+FROM\s+(\w+)(.*)/is);
    if (selectStarMatch) {
      const tableName = selectStarMatch[1].toLowerCase();
      const rest = selectStarMatch[2];
      const cols = knownColumns[tableName];

      if (cols && cols.length > 0) {
        optimized = `SELECT ${cols.join(', ')} FROM ${tableName}${rest}`;
        result.optimizationsApplied.push('select_star_pruning');
        result.inversionHints.push(
          `Use SELECT ${cols.join(', ')} FROM ${tableName} instead of SELECT *`
        );
      }
    }

    // Rule 2: Auto LIMIT
    const hasLimit = /\bLIMIT\b/i.test(optimized);
    const hasAggregate = /\b(COUNT|SUM|AVG|MAX|MIN|GROUP BY)\b/i.test(optimized);

    if (!hasLimit && !hasAggregate) {
      const tableMatch = optimized.match(/FROM\s+(\w+)/i);
      const tableName = tableMatch?.[1]?.toLowerCase() ?? '';
      const rowCount = tableStats[tableName] ?? 0;

      optimized = `${optimized} LIMIT 1000`;
      result.optimizationsApplied.push('auto_limit');
      result.inversionHints.push(
        `Add LIMIT to your query — table '${tableName}' can be large`
      );

      if (rowCount > 1000) {
        result.estimatedRowsSaved = rowCount - 1000;
      }
    }

    result.optimizedQuery = optimized;

  } catch {
    result.optimizedQuery = result.originalQuery;
    result.optimizationsApplied = [];
  }

  return result;
}