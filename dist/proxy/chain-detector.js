"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.trackQuery = trackQuery;
exports.getSession = getSession;
const SESSION_TTL_MS = 5 * 60 * 1000; // 5 minutes
const sessions = new Map();
// Cleanup stale sessions
setInterval(() => {
    const now = Date.now();
    for (const [id, session] of sessions.entries()) {
        if (now - session.lastActivity > SESSION_TTL_MS) {
            sessions.delete(id);
        }
    }
}, 60_000);
function extractTable(query) {
    const match = query.match(/FROM\s+(\w+)/i);
    return match?.[1]?.toLowerCase() ?? null;
}
function hasLimit(query) {
    return /\bLIMIT\b/i.test(query);
}
function hasWhere(query) {
    return /\bWHERE\b/i.test(query);
}
function trackQuery(sessionId, query) {
    const trimmed = query.trim();
    if (!trimmed.toUpperCase().startsWith('SELECT'))
        return null;
    const table = extractTable(trimmed);
    if (!table)
        return null;
    // Get or create session
    let session = sessions.get(sessionId);
    if (!session) {
        session = { sessionId, events: [], lastActivity: Date.now() };
        sessions.set(sessionId, session);
    }
    // Add event
    const event = {
        timestamp: Date.now(),
        table,
        query: trimmed,
        hadLimit: hasLimit(trimmed),
        hadWhere: hasWhere(trimmed),
    };
    session.events.push(event);
    session.lastActivity = Date.now();
    // Need at least 2 events to detect patterns
    if (session.events.length < 2)
        return null;
    return detectPattern(session);
}
function detectPattern(session) {
    const events = session.events;
    const recentEvents = events.slice(-10); // last 10 queries
    // Pattern 1: bulk_prefetch
    // 3+ different tables fetched without WHERE in quick succession
    const recentWindow = recentEvents.filter(e => Date.now() - e.timestamp < 60_000);
    const uniqueTables = [...new Set(recentWindow.map(e => e.table))];
    const noWhereCount = recentWindow.filter(e => !e.hadWhere).length;
    if (uniqueTables.length >= 3 && noWhereCount >= 3) {
        return {
            pattern: 'bulk_prefetch',
            tables: uniqueTables,
            queryCount: recentWindow.length,
            description: `Agent fetched ${uniqueTables.length} full tables in quick succession`,
            hint: `Consider fetching only what you need. Instead of loading all tables upfront, fetch with WHERE clauses or JOIN on demand`,
        };
    }
    // Pattern 2: repeated_full_scan
    // Same table, no WHERE, called 2+ times
    const tableCounts = {};
    for (const e of recentEvents) {
        if (!e.hadWhere) {
            tableCounts[e.table] = (tableCounts[e.table] ?? 0) + 1;
        }
    }
    for (const [table, count] of Object.entries(tableCounts)) {
        if (count >= 2) {
            return {
                pattern: 'repeated_full_scan',
                tables: [table],
                queryCount: count,
                description: `Full scan on '${table}' repeated ${count} times`,
                hint: `Cache results or add WHERE clause to avoid repeated full table scans`,
            };
        }
    }
    // Pattern 3: n_plus_one
    // Same table queried many times with different WHERE values
    const tableQueryMap = {};
    for (const e of recentEvents) {
        if (!tableQueryMap[e.table])
            tableQueryMap[e.table] = [];
        tableQueryMap[e.table].push(e.query);
    }
    for (const [table, queries] of Object.entries(tableQueryMap)) {
        if (queries.length >= 3) {
            const normalized = queries.map(q => q.replace(/=\s*\$?\d+/g, '= ?').replace(/=\s*'\w+'/g, "= ?"));
            const uniquePatterns = new Set(normalized);
            if (uniquePatterns.size === 1 && queries.length >= 3) {
                return {
                    pattern: 'n_plus_one',
                    tables: [table],
                    queryCount: queries.length,
                    description: `N+1 detected: '${table}' queried ${queries.length} times with same pattern`,
                    hint: `Use WHERE ${table}.id IN (...) to batch into a single query`,
                };
            }
        }
    }
    return null;
}
function getSession(sessionId) {
    return sessions.get(sessionId);
}
