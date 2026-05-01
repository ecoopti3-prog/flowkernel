import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import { readLineage } from '../proxy/lineage';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

const app = express();
const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer });

const clients = new Set<WebSocket>();

// Broadcast to all connected browsers
export function broadcast(event: string, data: unknown) {
  const message = JSON.stringify({ event, data, timestamp: new Date().toISOString() });
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}

wss.on('connection', (ws) => {
  clients.add(ws);

  // Send current stats on connect
  const records = readLineage(50);
  ws.send(JSON.stringify({
    event: 'init',
    data: {
      records,
      totalOptimizations: records.length,
      totalRowsSaved: records.reduce((sum, r) => sum + (r.estimatedRowsSaved ?? 0), 0),
    },
    timestamp: new Date().toISOString(),
  }));

  ws.on('close', () => clients.delete(ws));
});

// Serve dashboard HTML
app.get('/', (_req, res) => {
  const htmlPath = path.join(__dirname, 'index.html');
  if (fs.existsSync(htmlPath)) {
    res.sendFile(htmlPath);
  } else {
    res.send(getDashboardHTML());
  }
});

app.get('/api/stats', (_req, res) => {
  const records = readLineage(50);
  res.json({
    totalOptimizations: records.length,
    totalRowsSaved: records.reduce((sum, r) => sum + (r.estimatedRowsSaved ?? 0), 0),
    records,
  });
});

export function startDashboard(port = 3000): Promise<void> {
  return new Promise((resolve) => {
    httpServer.listen(port, () => {
      console.log(`[FlowKernel] Dashboard: http://localhost:${port}`);
      resolve();
    });
  });
}

function getDashboardHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>FlowKernel</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    
    body {
      background: #0a0a0a;
      color: #e2e8f0;
      font-family: 'SF Mono', 'Fira Code', monospace;
      min-height: 100vh;
      padding: 24px;
    }

    .header {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 32px;
      padding-bottom: 16px;
      border-bottom: 1px solid #1e1e1e;
    }

    .logo {
      font-size: 18px;
      font-weight: 700;
      color: #a78bfa;
      letter-spacing: 2px;
    }

    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #22c55e;
      box-shadow: 0 0 8px #22c55e;
      animation: pulse 2s infinite;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.4; }
    }

    .status-text {
      font-size: 12px;
      color: #4b5563;
    }

    .stats-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 16px;
      margin-bottom: 32px;
    }

    .stat-card {
      background: #111111;
      border: 1px solid #1e1e1e;
      border-radius: 8px;
      padding: 20px;
    }

    .stat-label {
      font-size: 11px;
      color: #4b5563;
      text-transform: uppercase;
      letter-spacing: 1px;
      margin-bottom: 8px;
    }

    .stat-value {
      font-size: 32px;
      font-weight: 700;
      color: #a78bfa;
    }

    .stat-sub {
      font-size: 11px;
      color: #374151;
      margin-top: 4px;
    }

    .section-title {
      font-size: 11px;
      color: #4b5563;
      text-transform: uppercase;
      letter-spacing: 1px;
      margin-bottom: 12px;
    }

    .feed {
      display: flex;
      flex-direction: column;
      gap: 8px;
      max-height: 600px;
      overflow-y: auto;
    }

    .feed-item {
      background: #111111;
      border: 1px solid #1e1e1e;
      border-radius: 6px;
      padding: 14px 16px;
      animation: slideIn 0.3s ease;
    }

    .feed-item.chain {
      border-left: 2px solid #f59e0b;
    }

    .feed-item.optimization {
      border-left: 2px solid #a78bfa;
    }

    @keyframes slideIn {
      from { opacity: 0; transform: translateY(-8px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .feed-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
    }

    .feed-badges {
      display: flex;
      gap: 6px;
    }

    .badge {
      font-size: 10px;
      padding: 2px 8px;
      border-radius: 4px;
      font-weight: 600;
    }

    .badge-purple {
      background: #2d1f5e;
      color: #a78bfa;
    }

    .badge-yellow {
      background: #2d1f00;
      color: #f59e0b;
    }

    .badge-green {
      background: #052e16;
      color: #22c55e;
    }

    .feed-time {
      font-size: 10px;
      color: #374151;
    }

    .query-row {
      display: grid;
      grid-template-columns: 60px 1fr;
      gap: 8px;
      margin-bottom: 4px;
      font-size: 12px;
    }

    .query-label {
      color: #4b5563;
      font-size: 10px;
      padding-top: 2px;
    }

    .query-before {
      color: #6b7280;
      text-decoration: line-through;
    }

    .query-after {
      color: #e2e8f0;
    }

    .hint {
      font-size: 11px;
      color: #4b5563;
      margin-top: 8px;
      padding-top: 8px;
      border-top: 1px solid #1a1a1a;
    }

    .hint span {
      color: #a78bfa;
    }

    .saved {
      font-size: 11px;
      color: #22c55e;
      margin-top: 4px;
    }

    ::-webkit-scrollbar { width: 4px; }
    ::-webkit-scrollbar-track { background: #0a0a0a; }
    ::-webkit-scrollbar-thumb { background: #1e1e1e; border-radius: 2px; }
  </style>
</head>
<body>
  <div class="header">
    <div class="logo">FLOWKERNEL</div>
    <div class="status-dot" id="statusDot"></div>
    <div class="status-text" id="statusText">connecting...</div>
  </div>

  <div class="stats-grid">
    <div class="stat-card">
      <div class="stat-label">Optimizations</div>
      <div class="stat-value" id="totalOpt">0</div>
      <div class="stat-sub">today</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Rows Saved</div>
      <div class="stat-value" id="totalRows">0</div>
      <div class="stat-sub">estimated</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Sessions</div>
      <div class="stat-value" id="totalSessions">0</div>
      <div class="stat-sub">active today</div>
    </div>
  </div>

  <div class="section-title">Live Feed</div>
  <div class="feed" id="feed"></div>

  <script>
    let totalOpt = 0;
    let totalRows = 0;
    const sessions = new Set();

    const ws = new WebSocket('ws://localhost:3000');

    ws.onopen = () => {
      document.getElementById('statusDot').style.background = '#22c55e';
      document.getElementById('statusText').textContent = 'proxy connected';
    };

    ws.onclose = () => {
      document.getElementById('statusDot').style.background = '#ef4444';
      document.getElementById('statusText').textContent = 'disconnected';
    };

    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);

      if (msg.event === 'init') {
        totalOpt = msg.data.totalOptimizations;
        totalRows = msg.data.totalRowsSaved;
        msg.data.records.forEach(r => sessions.add(r.sessionId));
        updateStats();

        // Show last 10 records
        const recent = msg.data.records.slice(0, 10);
        recent.forEach(r => addFeedItem(r, false));
      }

      if (msg.event === 'optimization') {
        totalOpt++;
        totalRows += msg.data.estimatedRowsSaved || 0;
        sessions.add(msg.data.sessionId);
        updateStats();
        addFeedItem(msg.data, true);
      }

      if (msg.event === 'chain') {
        addChainItem(msg.data, true);
      }
    };

    function updateStats() {
      document.getElementById('totalOpt').textContent = totalOpt;
      document.getElementById('totalRows').textContent = totalRows.toLocaleString();
      document.getElementById('totalSessions').textContent = sessions.size;
    }

    function addFeedItem(record, isNew) {
      const feed = document.getElementById('feed');
      const item = document.createElement('div');
      item.className = 'feed-item optimization';

      const time = new Date(record.timestamp).toLocaleTimeString();
      const saved = record.estimatedRowsSaved
        ? '<div class="saved">~' + record.estimatedRowsSaved.toLocaleString() + ' rows saved</div>'
        : '';
      const hint = record.inversionHints && record.inversionHints[0]
        ? '<div class="hint"><span>hint</span> ' + record.inversionHints[0] + '</div>'
        : '';

      const badges = record.optimizationsApplied
        .map(o => '<span class="badge badge-purple">' + o + '</span>')
        .join('');

      item.innerHTML = \`
        <div class="feed-header">
          <div class="feed-badges">\${badges}</div>
          <div class="feed-time">\${time}</div>
        </div>
        <div class="query-row">
          <div class="query-label">before</div>
          <div class="query-before">\${record.originalQuery}</div>
        </div>
        <div class="query-row">
          <div class="query-label">after</div>
          <div class="query-after">\${record.optimizedQuery}</div>
        </div>
        \${saved}
        \${hint}
      \`;

      if (isNew) {
        feed.insertBefore(item, feed.firstChild);
      } else {
        feed.appendChild(item);
      }
    }

    function addChainItem(data, isNew) {
      const feed = document.getElementById('feed');
      const item = document.createElement('div');
      item.className = 'feed-item chain';

      const time = new Date(data.timestamp).toLocaleTimeString();

      item.innerHTML = \`
        <div class="feed-header">
          <div class="feed-badges">
            <span class="badge badge-yellow">chain: \${data.pattern}</span>
          </div>
          <div class="feed-time">\${time}</div>
        </div>
        <div class="query-row">
          <div class="query-label">tables</div>
          <div class="query-after">\${data.tables.join(' → ')}</div>
        </div>
        <div class="hint"><span>hint</span> \${data.hint}</div>
      \`;

      if (isNew) {
        feed.insertBefore(item, feed.firstChild);
      } else {
        feed.appendChild(item);
      }
    }
  </script>
</body>
</html>`;
}