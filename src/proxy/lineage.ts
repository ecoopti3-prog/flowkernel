import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface LineageRecord {
  lineageId: string;
  timestamp: string;
  sessionId: string;
  originalQuery: string;
  optimizedQuery: string;
  optimizationsApplied: string[];
  inversionHints: string[];
  estimatedRowsSaved?: number;
  executionTimeMs?: number;
}

function getLogPath(): string {
  const dir = path.join(os.homedir(), '.flowkernel', 'lineage');
  fs.mkdirSync(dir, { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  return path.join(dir, `${date}.jsonl`);
}

export function recordLineage(record: LineageRecord): void {
  try {
    const logPath = getLogPath();
    console.log(`[Lineage] Writing to: ${logPath}`);
    const line = JSON.stringify(record) + '\n';
    fs.appendFileSync(logPath, line, 'utf8');
    console.log(`[Lineage] Written successfully`);
  } catch (err) {
    console.error(`[Lineage] ERROR:`, err);
  }
}

export function readLineage(last = 20): LineageRecord[] {
  try {
    const filePath = getLogPath();
    if (!fs.existsSync(filePath)) return [];

    const lines = fs.readFileSync(filePath, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map(line => JSON.parse(line) as LineageRecord);

    return lines.slice(-last).reverse();
  } catch {
    return [];
  }
}