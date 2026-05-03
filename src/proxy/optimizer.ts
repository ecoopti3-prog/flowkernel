export interface OptimizationResult {
  originalQuery: string;
  optimizedQuery: string;
  optimizationsApplied: string[];
  inversionHints: string[];
  estimatedRowsSaved?: number;
  estimatedMonthlyCostUsd?: number;
}

const BYTES_PER_TOKEN = 4;
const COST_PER_1K_TOKENS = 0.003;
const TOKENS_PER_ROW = 10;

export function rowsToDollars(rowsSaved: number): number {
  // Realistic: 1 row ≈ 10 tokens when sent to LLM
  // Claude Sonnet: $0.003 per 1K input tokens
  // Conservative: query runs 3x/day × 30 days
  const costPerQuery = (rowsSaved * TOKENS_PER_ROW / 1000) * COST_PER_1K_TOKENS;
  return Math.round(costPerQuery * 3 * 30 * 100) / 100;
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
    let rowsSaved = 0;

    // Rule 1: SELECT * pruning
    const selectStarMatch = optimized.match(/^SELECT\s+\*\s+FROM\s+(\w+)(.*)/is);
    if (selectStarMatch) {
      const tableName = selectStarMatch[1].toLowerCase();
      const rest = selectStarMatch[2];
      const cols = knownColumns[tableName];

      if (cols && cols.length > 0) {
        // Estimate all columns in table vs what we keep
        const allColsEstimate = cols.length + 4; // assume 4 heavy cols removed
        const colsSaved = allColsEstimate - cols.length;
        const estimatedRows = tableStats[tableName] ?? 1000;

        // Rows-equivalent saved = rows × fraction of data removed
        const fractionSaved = colsSaved / allColsEstimate;
        rowsSaved += Math.round(estimatedRows * fractionSaved);

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
        rowsSaved += rowCount - 1000;
      }
    }

    // Rule 3: ORDER BY without LIMIT
    const hasOrderBy = /\bORDER BY\b/i.test(optimized);
    const hasLimitNow = /\bLIMIT\b/i.test(optimized);
    if (hasOrderBy && !hasLimitNow && !hasAggregate) {
      optimized = `${optimized} LIMIT 1000`;
      result.optimizationsApplied.push('order_without_limit');
      result.inversionHints.push(
        `ORDER BY without LIMIT sorts entire table — added LIMIT 1000`
      );
    }

    // Rule 4: Leading wildcard LIKE (warn only)
    const leadingWildcard = /LIKE\s+['"]%[^'"]+['"]/i.test(optimized);
    if (leadingWildcard) {
      result.optimizationsApplied.push('leading_wildcard_detected');
      result.inversionHints.push(
        `LIKE '%...' causes full table scan — consider full-text search or prefix match`
      );
    }

    // Rule 5: COUNT(*) > 0 — suggest EXISTS (warn only)
    const countStar = /COUNT\s*\(\s*\*\s*\)\s*(>|>=)\s*[01]/i.test(optimized);
    if (countStar) {
      result.optimizationsApplied.push('count_star_exists');
      result.inversionHints.push(
        `COUNT(*) > 0 is wasteful — use EXISTS(...) instead for better performance`
      );
    }

    result.optimizedQuery = optimized;

    // Dollar translation
    if (rowsSaved > 0) {
      result.estimatedRowsSaved = rowsSaved;
      result.estimatedMonthlyCostUsd = rowsToDollars(rowsSaved);
    }

  } catch {
    result.optimizedQuery = result.originalQuery;
    result.optimizationsApplied = [];
  }

  return result;
}