#!/usr/bin/env node
import * as net from 'net';
import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

const args = process.argv.slice(2);
const command = args[0];

function printBanner() {
  console.log(`
███████╗██╗      ██████╗ ██╗    ██╗██╗  ██╗███████╗██████╗ ███╗   ██╗███████╗██╗
██╔════╝██║     ██╔═══██╗██║    ██║██║ ██╔╝██╔════╝██╔══██╗████╗  ██║██╔════╝██║
█████╗  ██║     ██║   ██║██║ █╗ ██║█████╔╝ █████╗  ██████╔╝██╔██╗ ██║█████╗  ██║
██╔══╝  ██║     ██║   ██║██║███╗██║██╔═██╗ ██╔══╝  ██╔══██╗██║╚██╗██║██╔══╝  ██║
██║     ███████╗╚██████╔╝╚███╔███╔╝██║  ██╗███████╗██║  ██║██║ ╚████║███████╗███████╗
╚═╝     ╚══════╝ ╚═════╝  ╚══╝╚══╝ ╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝╚═╝  ╚═══╝╚══════╝╚══════╝
  `);
  console.log('  AI Data Movement Optimizer\n');
}

function parseDbArg(): string | null {
  const dbIndex = args.indexOf('--db');
  if (dbIndex !== -1 && args[dbIndex + 1]) {
    return args[dbIndex + 1];
  }
  return null;
}

function parsePortArg(defaultPort: number): number {
  const portIndex = args.indexOf('--port');
  if (portIndex !== -1 && args[portIndex + 1]) {
    return parseInt(args[portIndex + 1]);
  }
  return defaultPort;
}

function isDryRun(): boolean {
  return args.includes('--dry-run');
}

function saveConfig(db: string, proxyPort: number, dryRun: boolean) {
  const config = {
    db,
    proxy_port: proxyPort,
    dry_run: dryRun,
    created_at: new Date().toISOString(),
    optimizations: {
      column_pruning: true,
      auto_limit: true,
      auto_limit_value: 1000,
      query_cache_ttl_seconds: 30,
      chain_detection: true,
    },
  };
  fs.writeFileSync('flowkernel.config.json', JSON.stringify(config, null, 2));
}

async function checkPort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const tester = net.createServer()
      .once('error', () => resolve(false))
      .once('listening', () => {
        tester.close(() => resolve(true));
      })
      .listen(port);
  });
}

async function checkDbConnection(connectionString: string): Promise<boolean> {
  const { Client } = await import('pg');
  const client = new Client({ connectionString });
  try {
    await client.connect();
    await client.query('SELECT 1');
    await client.end();
    return true;
  } catch {
    return false;
  }
}

async function commandStart() {
  printBanner();

  const db = parseDbArg();
  const proxyPort = parsePortArg(5433);
  const dryRun = isDryRun();

  if (!db) {
    console.error('❌ Missing --db flag\n');
    console.error('Usage: npx flowkernel start --db postgres://user:pass@host:5432/dbname');
    process.exit(1);
  }

  // Step 1: Check DB connection
  process.stdout.write('  Checking DB connection... ');
  const dbOk = await checkDbConnection(db);
  if (!dbOk) {
    console.log('❌');
    console.error('\n❌ Cannot connect to database. Check your connection string.');
    process.exit(1);
  }
  console.log('✅');

  // Step 2: Check proxy port
  process.stdout.write(`  Checking port ${proxyPort}... `);
  const portOk = await checkPort(proxyPort);
  if (!portOk) {
    console.log('❌');
    console.error(`\n❌ Port ${proxyPort} is already in use. Use --port to specify another.`);
    process.exit(1);
  }
  console.log('✅');

  // Step 3: Save config
  saveConfig(db, proxyPort, dryRun);
  process.stdout.write('  Writing flowkernel.config.json... ✅\n');

  // Step 4: Start proxy
  console.log(`\n✅ FlowKernel running`);
  console.log(`   Proxy:    localhost:${proxyPort}`);
  console.log(`   DB:       ${db.replace(/:\/\/.*@/, '://***@')}`);
  console.log(`   Dry run:  ${dryRun}`);
  console.log(`   Config:   ./flowkernel.config.json`);
  console.log(`\n   Connect your app to localhost:${proxyPort}`);
  console.log(`   CLI: npx tsx src/cli/index.ts status\n`);

  if (dryRun) {
    console.log('  [DRY RUN MODE — queries will be logged but not modified]\n');
  }

  // Start the proxy inline
  const { startDashboard } = await import('./dashboard/server');
const { startProxy } = await import('./proxy/start');

await startDashboard(3000);

// Open browser automatically
const { exec } = await import('child_process');
exec('start http://localhost:3000');

await startProxy(db, proxyPort, dryRun);
}

function commandStop() {
  console.log('Stopping FlowKernel...');
  // Read PID from config if exists
  try {
    const config = JSON.parse(fs.readFileSync('flowkernel.config.json', 'utf8'));
    if (config.pid) {
      process.kill(config.pid, 'SIGTERM');
      console.log('✅ Stopped');
    } else {
      console.log('No running instance found in config.');
    }
  } catch {
    console.log('No config file found. Is FlowKernel running?');
  }
}

function commandStatus() {
  // Delegate to CLI
  const { execSync } = require('child_process');
  execSync('npx tsx src/cli/index.ts status', { stdio: 'inherit' });
}

function printHelp() {
  printBanner();
  console.log(`Commands:
  start --db <connection_string>   Start the proxy
  stop                             Stop the proxy
  status                           Show optimization stats
  help                             Show this help

Options:
  --port <number>                  Proxy port (default: 5433)
  --dry-run                        Log optimizations without applying

Examples:
  npx tsx src/index.ts start --db postgres://user:pass@localhost:5432/mydb
  npx tsx src/index.ts start --db postgres://user:pass@localhost:5432/mydb --dry-run
  npx tsx src/index.ts status
  `);
}

switch (command) {
  case 'start':  commandStart();  break;
  case 'stop':   commandStop();   break;
  case 'status': commandStatus(); break;
  case 'help':   printHelp();     break;
  default:
    printHelp();
}