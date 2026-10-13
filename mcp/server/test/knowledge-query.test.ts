import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { runKnowledgeQuery } from '../src/knowledge-query.js';

test('knowledge-query returns matching entry paths and summaries', () => {
  const knowledgeHome = writeKnowledgeIndex([
    entry({
      id: 'qa-fixture-replay',
      domains: ['qa', 'browser'],
      confidence: 8,
      summary: 'Use synthetic browser fixtures before staging QA.',
      source_evidence: 'workflow-runs/qa.jsonl#event-1',
      path: '/tmp/knowledge/qa-fixture-replay.md',
    }),
    entry({
      id: 'review-race-check',
      domains: ['review'],
      confidence: 9,
      summary: 'Check status transition races outside the diff.',
      path: '/tmp/knowledge/review-race-check.md',
    }),
  ]);

  const result = runKnowledgeQuery({
    knowledgeHome,
    domain: 'qa',
    keyword: 'fixture staging',
  });

  assert.equal(result.structuredContent.count, 1);
  assert.deepEqual(result.structuredContent.results[0], {
    id: 'qa-fixture-replay',
    path: '/tmp/knowledge/qa-fixture-replay.md',
    summary: 'Use synthetic browser fixtures before staging QA.',
    type: 'practice',
    domains: ['qa', 'browser'],
    status: 'active',
    confidence: 8,
    updated: '2026-07-06',
    last_verified: '2026-07-06',
    source_evidence: 'workflow-runs/qa.jsonl#event-1',
    trust_level: 'verified',
    reviewed_by: 'workflow',
    staleness: 'fresh',
  });
});

test('knowledge-query handles missing index as empty result set', () => {
  const knowledgeHome = fs.mkdtempSync(
    path.join(os.tmpdir(), 'goldband-mcp-kb-'),
  );
  const result = runKnowledgeQuery({ knowledgeHome, keyword: 'anything' });

  assert.equal(result.structuredContent.count, 0);
  assert.deepEqual(result.structuredContent.results, []);
});

test('knowledge-query sorts by confidence then last_verified freshness', () => {
  const knowledgeHome = writeKnowledgeIndex([
    entry({
      id: 'older-verified',
      confidence: 8,
      updated: '2026-07-08',
      last_verified: '2026-01-01',
      summary: 'Older verified result.',
    }),
    entry({
      id: 'newer-verified',
      confidence: 8,
      updated: '2026-07-01',
      last_verified: '2026-07-07',
      summary: 'Newer verified result.',
    }),
  ]);

  const result = runKnowledgeQuery({ knowledgeHome, keyword: 'verified' });

  assert.equal(result.structuredContent.results[0].id, 'newer-verified');
});

test('knowledge-query follows CLI recall semantics for retired and project entries', () => {
  const knowledgeHome = writeKnowledgeIndex([
    entry({ id: 'active-entry', summary: 'Shared recall result.' }),
    entry({
      id: 'retired-entry',
      status: 'retired',
      summary: 'Shared recall result.',
    }),
    entry({
      id: 'project-entry',
      scope: 'project',
      project_slug: 'checkout-service',
      summary: 'Project specific note.',
    }),
  ]);
  const ids = (input: Record<string, unknown>) =>
    runKnowledgeQuery({ knowledgeHome, ...input })
      .structuredContent.results.map((row: { id: string }) => row.id)
      .sort();

  assert.deepEqual(ids({ status: 'all', keyword: 'shared' }), ['active-entry']);
  assert.deepEqual(ids({ status: 'retired' }), ['retired-entry']);
  assert.deepEqual(ids({ keyword: 'checkout-service' }), ['project-entry']);
});

function writeKnowledgeIndex(entries: object[]) {
  const knowledgeHome = fs.mkdtempSync(
    path.join(os.tmpdir(), 'goldband-mcp-kb-'),
  );
  const knowledgeDir = path.join(knowledgeHome, 'knowledge');
  fs.mkdirSync(knowledgeDir, { recursive: true });
  fs.writeFileSync(
    path.join(knowledgeDir, 'index.json'),
    JSON.stringify(
      {
        schema_version: 1,
        generated_at: '2026-07-06T00:00:00.000Z',
        entries,
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );
  return knowledgeHome;
}

function entry(overrides: Record<string, unknown>) {
  return {
    id: 'default-entry',
    title: 'Default entry',
    type: 'practice',
    domains: ['general'],
    scope: 'global',
    status: 'active',
    confidence: 5,
    updated: '2026-07-06',
    last_verified: '2026-07-06',
    source_evidence: 'workflow-runs/default.jsonl#event-1',
    trust_level: 'verified',
    reviewed_by: 'workflow',
    staleness: 'fresh',
    summary: 'Default summary.',
    path: '/tmp/knowledge/default.md',
    ...overrides,
  };
}
