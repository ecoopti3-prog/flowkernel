import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { Client } from 'pg';
import { optimizeQuery } from '../proxy/optimizer';
import { recordLineage } from '../proxy/lineage';
import { trackQuery } from '../proxy/chain-detector';
import { readLineage } from '../proxy/lineage';

const DB_CONFIG = {
  host: 'localhost',
  port: 5432,
  database: 'testdb',
  user: 'postgres',
  password: 'dev123',
};

function generateId(): string {
  return Math.random().toString(36).slice(2, 10);
}

const MCP_SESSION_ID = `mcp_${generateId()}`;

const server = new Server(
  { name: 'flowkernel', version: '0.1.0' },
  { capabilities: { tools: {} } }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'query_database',
      description: 'Run a read-only SQL query through FlowKernel proxy with automatic optimization and chain detection',
      inputSchema: {
        type: 'object',
        properties: {
          sql: {
            type: 'string',
            description: 'The SQL SELECT query to execute',
          },
        },
        required: ['sql'],
      },
    },
    {
      name: 'get_schema',
      description: 'Get table schema and column information',
      inputSchema: {
        type: 'object',
        properties: {
          table: {
            type: 'string',
            description: 'Table name to inspect',
          },
        },
        required: ['table'],
      },
    },
    {
      name: 'get_usage_stats',
      description: 'Get optimization stats and lineage for recent queries',
      inputSchema: {
        type: 'object',
        properties: {
          last_n: {
            type: 'number',
            description: 'Number of recent records to return (default: 10)',
          },
        },
      },
    },
    {
      name: 'get_inversion_hints',
      description: 'Get specific query rewrites suggested by FlowKernel based on actual optimization data',
      inputSchema: {
        type: 'object',
        properties: {
          last_n: {
            type: 'number',
            description: 'Number of recent hints to return (default: 5)',
          },
        },
      },
    },
  ],
}));

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === 'query_database') {
    const sql = args?.sql as string;

    // Block non-SELECT
    if (!sql.trim().toUpperCase().startsWith('SELECT')) {
      return {
        content: [{ type: 'text', text: 'Error: Only SELECT queries are allowed.' }],
        isError: true,
      };
    }

    const client = new Client(DB_CONFIG);
    try {
      await client.connect();

      // Optimize
      const optimized = optimizeQuery(sql, { users: 1000, orders: 5000 });

      // Chain detection
      const chain = trackQuery(MCP_SESSION_ID, sql);

      // Execute optimized query
      const result = await client.query(optimized.optimizedQuery);

      // Record lineage
      if (optimized.optimizationsApplied.length > 0) {
        recordLineage({
          lineageId: generateId(),
          timestamp: new Date().toISOString(),
          sessionId: MCP_SESSION_ID,
          originalQuery: sql,
          optimizedQuery: optimized.optimizedQuery,
          optimizationsApplied: optimized.optimizationsApplied,
          inversionHints: optimized.inversionHints,
          estimatedRowsSaved: optimized.estimatedRowsSaved,
        });
      }

      const response: Record<string, unknown> = {
        rows: result.rows,
        rowCount: result.rowCount,
        optimizations: optimized.optimizationsApplied,
        originalQuery: sql,
        executedQuery: optimized.optimizedQuery,
      };

      if (optimized.inversionHints.length > 0) {
        response.hints = optimized.inversionHints;
      }

      if (chain) {
        response.chainDetected = {
          pattern: chain.pattern,
          tables: chain.tables,
          hint: chain.hint,
        };
      }

      return {
        content: [{ type: 'text', text: JSON.stringify(response, null, 2) }],
      };

    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: 'text', text: `Error: ${message}` }],
        isError: true,
      };
    } finally {
      await client.end();
    }
  }

  if (name === 'get_schema') {
    const table = args?.table as string;
    const client = new Client(DB_CONFIG);
    try {
      await client.connect();
      const result = await client.query(`
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_name = $1
        ORDER BY ordinal_position
      `, [table]);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ table, columns: result.rows }, null, 2),
        }],
      };
    } finally {
      await client.end();
    }
  }

  if (name === 'get_usage_stats') {
    const lastN = (args?.last_n as number) ?? 10;
    const records = readLineage(lastN);

    const stats = {
      totalOptimizations: records.length,
      totalRowsSaved: records.reduce((sum, r) => sum + (r.estimatedRowsSaved ?? 0), 0),
      records: records.map(r => ({
        timestamp: r.timestamp,
        originalQuery: r.originalQuery,
        optimizedQuery: r.optimizedQuery,
        optimizationsApplied: r.optimizationsApplied,
        estimatedRowsSaved: r.estimatedRowsSaved,
      })),
    };

    return {
      content: [{ type: 'text', text: JSON.stringify(stats, null, 2) }],
    };
  }

  if (name === 'get_inversion_hints') {
    const lastN = (args?.last_n as number) ?? 5;
    const records = readLineage(lastN);

    const hints = records
      .filter(r => r.inversionHints.length > 0)
      .map(r => ({
        originalQuery: r.originalQuery,
        hints: r.inversionHints,
        optimizationsApplied: r.optimizationsApplied,
      }));

    return {
      content: [{ type: 'text', text: JSON.stringify(hints, null, 2) }],
    };
  }

  return {
    content: [{ type: 'text', text: `Unknown tool: ${name}` }],
    isError: true,
  };
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[FlowKernel MCP] Server running');
}

main().catch(console.error);