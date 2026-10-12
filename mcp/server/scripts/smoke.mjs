#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(scriptDir, '..');

async function main() {
  const foreignGitRepo = createForeignGitRepo();
  const knowledgeHome = createKnowledgeHome();
  const client = new Client({ name: 'goldband-mcp-smoke', version: '0.1.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(serverRoot, 'dist', 'index.js')],
    cwd: foreignGitRepo,
    env: { ...process.env, GOLDBAND_HOME: knowledgeHome },
    stderr: 'pipe',
  });

  await client.connect(transport);
  try {
    const tools = await client.listTools();
    const names = tools.tools.map((tool) => tool.name).sort();
    assert.deepEqual(names, [
      'goldband_health_check',
      'goldband_policy_check',
      'goldband_telemetry_query',
      'knowledge-query',
    ]);

    const policyResult = await client.callTool({
      name: 'goldband_policy_check',
      arguments: { command: 'npm run dev' },
    });
    assert.equal(policyResult.structuredContent?.outcome, 'allow');
    assert.deepEqual(policyResult.structuredContent?.matchedRules, []);

    const knowledgeResult = await client.callTool({
      name: 'knowledge-query',
      arguments: { domain: 'qa', keyword: 'fixture staging' },
    });
    assert.equal(knowledgeResult.structuredContent?.count, 1);
    assert.equal(
      knowledgeResult.structuredContent?.results?.[0]?.id,
      'qa-fixture-replay',
    );
    console.log(
      JSON.stringify(
        {
          tools: names,
          policyCheck: policyResult,
          knowledgeQuery: knowledgeResult,
        },
        null,
        2,
      ),
    );
  } finally {
    await client.close();
  }
}

function createForeignGitRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'goldband-mcp-cwd-'));
  const result = spawnSync('git', ['init'], {
    cwd: dir,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  return dir;
}

function createKnowledgeHome() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'goldband-mcp-kb-'));
  const knowledgeDir = path.join(dir, 'knowledge');
  fs.mkdirSync(knowledgeDir, { recursive: true });
  fs.writeFileSync(
    path.join(knowledgeDir, 'index.json'),
    JSON.stringify(
      {
        schema_version: 1,
        generated_at: '2026-07-06T00:00:00.000Z',
        entries: [
          {
            id: 'qa-fixture-replay',
            title: 'QA fixture replay before staging',
            type: 'practice',
            domains: ['qa', 'browser'],
            scope: 'global',
            status: 'active',
            confidence: 8,
            updated: '2026-07-06',
            summary: 'Use synthetic browser fixtures before staging QA.',
            path: '/tmp/knowledge/qa-fixture-replay.md',
          },
        ],
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );
  return dir;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
