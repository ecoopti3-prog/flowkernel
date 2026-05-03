import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';

interface QueryFrequency {
  queryHash: string;
  normalizedQuery: string;
  table: string;
  count: number;
  totalRowsSaved: number;
  firstSeen: string;
  lastSeen: string;
}

function getFrequencyPath(): string {
  const dir = path.join(os.homedir(), '.flowkernel', 'frequency');
  fs.mkdirSync(dir, { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  return path.join(dir, `${date}.json`);
}

function hashQuery(sql: string): string {
  const normalized = sql.trim().toLowerCase().replace(/\s+/g, ' ');
  return crypto.createHash('md5').update(normalized).digest('hex').slice(0, 8);
}

function extractTable(sql: string): string {
  const match = sql.match(/FROM\s+(\w+)/i);
  return match?.[1]?.toLowerCase() ?? 'unknown';
}

function loadFrequencies(): Record<string, QueryFrequency> {
  try {
    const filePath = getFrequencyPath();
    if (!fs.existsSync(filePath)) return {};
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return {};
  }
}

function saveFrequencies(data: Record<string, QueryFrequency>): void {
  try {
    fs.writeFileSync(getFrequencyPath(), JSON.stringify(data, null, 2));
  } catch {
    // never break proxy
  }
}

export function trackQueryFrequency(sql: string, rowsSaved: number): void {
  try {
    const hash = hashQuery(sql);
    const frequencies = loadFrequencies();

    if (frequencies[hash]) {
      frequencies[hash].count++;
      frequencies[hash].totalRowsSaved += rowsSaved;
      frequencies[hash].lastSeen = new Date().toISOString();
    } else {
      frequencies[hash] = {
        queryHash: hash,
        normalizedQuery: sql.trim(),
        table: extractTable(sql),
        count: 1,
        totalRowsSaved: rowsSaved,
        firstSeen: new Date().toISOString(),
        lastSeen: new Date().toISOString(),
      };
    }

    saveFrequencies(frequencies);
  } catch {
    // never break proxy
  }
}

export function getFrequencies(): QueryFrequency[] {
  const data = loadFrequencies();
  return Object.values(data).sort((a, b) => b.count - a.count);
}

export function calculateRealCost(rowsSaved: number, timesRunToday: number): number {
  // Real calculation based on actual frequency
  const TOKENS_PER_ROW = 10;
  const COST_PER_1K_TOKENS = 0.003;
  const costPerRun = (rowsSaved * TOKENS_PER_ROW / 1000) * COST_PER_1K_TOKENS;
  const dailyCost = costPerRun * timesRunToday;
  return Math.round(dailyCost * 30 * 100) / 100;
}