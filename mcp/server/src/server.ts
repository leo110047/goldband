import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { runHealthCheck } from './health-check.js';
import { runKnowledgeQuery } from './knowledge-query.js';
import { runPolicyCheck } from './policy-check.js';
import { runTelemetryQuery } from './telemetry-query.js';

export function createGoldbandMcpServer() {
  const server = new McpServer({
    name: 'goldband-mcp',
    version: '0.1.0',
  });
  registerPolicyTool(server);
  registerTelemetryTool(server);
  registerKnowledgeTool(server);
  registerHealthTool(server);
  return server;
}

function registerPolicyTool(server: McpServer) {
  server.registerTool(
    'goldband_policy_check',
    {
      title: 'Goldband policy check',
      description:
        'Dry-runs Claude PreToolUse policy for a command or file edit without executing it.',
      inputSchema: {
        command: z.string().default(''),
        toolName: z.enum(['Bash', 'Write', 'Edit']).default('Bash'),
        host: z.enum(['claude']).default('claude'),
        filePath: z.string().optional(),
        content: z.string().optional(),
        sessionId: z.string().optional(),
      },
    },
    async (input) => runPolicyCheck(input),
  );
}

function registerTelemetryTool(server: McpServer) {
  server.registerTool(
    'goldband_telemetry_query',
    {
      title: 'Goldband telemetry query',
      description:
        'Reads hook-router usage telemetry and returns count aggregations.',
      inputSchema: {
        days: z.number().int().positive().max(365).default(30),
        eventType: z
          .enum(['all', 'hook-decision', 'workflow-entry', 'prompt-trigger'])
          .default('all'),
        groupBy: z.enum(['rule', 'skill']).default('rule'),
        limit: z.number().int().positive().max(100).default(20),
      },
    },
    async (input) => runTelemetryQuery(input),
  );
}

function registerKnowledgeTool(server: McpServer) {
  server.registerTool(
    'knowledge-query',
    {
      title: 'Goldband knowledge query',
      description:
        'Reads the local curated goldband knowledge index and returns matching entry paths and summaries. Status "all" excludes retired entries; request them with status "retired".',
      inputSchema: {
        domain: z.string().optional(),
        type: z.enum(['problem-solution', 'decision', 'practice']).optional(),
        keyword: z.string().optional(),
        status: z
          .enum(['active', 'candidate', 'graduated', 'retired', 'all'])
          .default('active'),
        limit: z.number().int().positive().max(50).default(10),
      },
    },
    async (input) => runKnowledgeQuery(input),
  );
}

function registerHealthTool(server: McpServer) {
  server.registerTool(
    'goldband_health_check',
    {
      title: 'Goldband health check',
      description:
        'Runs a fixed read-only allowlist of goldband repo validation checks.',
      inputSchema: {},
    },
    async () => runHealthCheck(),
  );
}
