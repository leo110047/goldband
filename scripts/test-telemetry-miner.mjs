#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  buildSummary,
  classifyTelemetry,
  defaultWorkflowRunsDir,
  extractEvalCandidates,
  extractFixtureCandidates,
  extractKnowledgeCandidates,
  readUsageTelemetry,
  sanitizeEvent,
} from './lib/telemetry-miner/index.mjs';
import { parseArgs, run } from './mine-telemetry.mjs';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'goldband-miner-test-'));
const usageFile = path.join(tmpDir, 'usage-events.jsonl');
const rotatedFile = `${usageFile}.1`;
const workflowRunsDir = path.join(tmpDir, 'workflow-runs');
const reviewDir = path.join(tmpDir, 'review');

process.on('exit', () => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

fs.mkdirSync(workflowRunsDir, { recursive: true });

const base = Date.now();
const docDeny = usageEvent({
  event_id: 'evt-doc-deny',
  run_id: 'run-1',
  category: 'hook-decision',
  name: 'doc-file-blocker',
  action: 'deny',
  detail: { host: 'claude', hookEventName: 'PreToolUse', toolName: 'Write' },
  recordedAt: iso(base, -5),
});
const devDeny = usageEvent({
  event_id: 'evt-dev-deny',
  run_id: 'run-2',
  category: 'hook-decision',
  name: 'dev-server-blocker',
  action: 'deny',
  detail: { host: 'claude', hookEventName: 'PreToolUse', toolName: 'Bash' },
  recordedAt: iso(base, -4),
});
const laterSignal = usageEvent({
  event_id: 'evt-doc-later',
  run_id: 'run-1',
  category: 'hook-advisory',
  name: 'PreToolUse',
  action: 'emit',
  detail: { host: 'claude', hookEventName: 'PreToolUse', toolName: 'Write' },
  recordedAt: iso(base, -3),
});
const modeBlock = usageEvent({
  event_id: 'evt-mode',
  run_id: 'run-3',
  category: 'mode-enforcement',
  name: 'careful-mode',
  action: 'block',
  detail: {
    rule: 'risky-command',
    toolName: 'Bash',
    commandPreview: '/Users/leo/project/scripts/deploy.sh',
  },
  recordedAt: iso(base, -2),
});
const crossReview = usageEvent({
  event_id: 'evt-cross',
  run_id: 'run-4',
  category: 'hook-decision',
  name: 'cross-review-round',
  action: 'record',
  detail: { verdict: 'CHANGES_REQUESTED', blockingCount: 1 },
  recordedAt: iso(base, -1),
});
const crossReviewDeny = usageEvent({
  event_id: 'evt-cross-deny',
  run_id: 'run-5',
  category: 'hook-decision',
  name: 'cross-review-required',
  action: 'deny',
  detail: { host: 'codex', hookEventName: 'Stop', toolName: null },
  recordedAt: iso(base, -1),
});

writeJsonl(rotatedFile, [docDeny, devDeny]);
fs.writeFileSync(
  usageFile,
  `${JSON.stringify(laterSignal)}\nnot-json\n${JSON.stringify(modeBlock)}\n${JSON.stringify(crossReview)}\n${JSON.stringify(crossReviewDeny)}\n`,
  'utf8',
);
writeJsonl(path.join(workflowRunsDir, 'goldband-review.jsonl'), [
  {
    runId: 'workflow-run-1',
    workflow: 'goldband-review',
    step: 'run-review',
    startedAt: iso(base, -1),
    durationMs: 1,
    status: 'failed',
    outputDigest: 'abc',
    artifacts: ['/private/tmp/goldband-workflow/artifact.md'],
    error: 'review failed',
  },
]);

const options = {
  usageFile,
  workflowRunsDir,
  outDir: reviewDir,
  days: 1,
  limit: 20,
};

const usage = readUsageTelemetry(options);
assert.equal(usage.files.length, 2);
assert.equal(usage.events.length, 6);
assert.equal(usage.badLineCount, 1);
assert.ok(usage.events.every((event) => event.__sourceFile));

assert.equal(
  defaultWorkflowRunsDir({
    CLAUDE_PLUGIN_DATA: path.join(tmpDir, 'plugin-data'),
    CLAUDE_PLUGIN_ROOT: path.join(tmpDir, 'goldband-plugin'),
  }),
  path.join(tmpDir, 'plugin-data', 'workflow-runs'),
);

const summary = buildSummary(options);
assert.equal(summary.sample_status, 'ok');
assert.equal(summary.totals.usageEvents, 6);
assert.equal(summary.inputs.usageBadLineCount, 1);
assert.ok(
  summary.denyBlockByRule.some((row) => row.name === 'doc-file-blocker'),
);
assert.ok(summary.workflowEvidence.some((row) => row.status === 'failed'));

const classified = classifyTelemetry(options);
assert.ok(
  classified.classifications.some(
    (item) => item.category === 'false-positive-deny',
  ),
);
assert.ok(
  classified.classifications.some((item) => item.category === 'true-deny'),
);
assert.ok(
  classified.classifications.some((item) => item.category === 'workflow-drift'),
);
assert.equal(
  classified.classifications.find(
    (item) =>
      item.sanitized_example.name === 'cross-review-required' &&
      item.sanitized_example.action === 'deny',
  )?.category,
  'cross-review-rejection',
);
for (const item of classified.classifications) {
  assert.equal(item.confidence, 'inferred');
  assert.equal(item.needs_human_label, true);
  assert.ok(Array.isArray(item.evidence_fields));
}
const limitedClassified = classifyTelemetry({ ...options, limit: 1 });
assert.equal(limitedClassified.classifications.length, 1);
assert.equal(
  limitedClassified.totals.reduce((sum, item) => sum + item.count, 0),
  1,
);
assert.ok(limitedClassified.totalClassifications > 1);

const secretSanitize = sanitizeEvent({
  event_id: 'secret-event',
  detail: {
    content: `token = "${'ghp_'}abcdefghijklmnopqrstuvwxyz0123456789"`,
  },
});
assert.equal(secretSanitize.retained, false);

const pathSanitize = sanitizeEvent(modeBlock);
assert.equal(pathSanitize.retained, true);
assert.equal(
  pathSanitize.value.detail.commandPreview,
  '/repo/project/scripts/deploy.sh',
);
assert.equal(sanitizeEvent({ cwd: '/Users/leo' }).value.cwd, '/repo');
assert.equal(
  sanitizeEvent({ cwd: String.raw`C:\Users\leo\project\file.txt` }).value.cwd,
  '/repo/project/file.txt',
);

const fixtures = extractFixtureCandidates({ ...options, limit: 2 });
assert.equal(fixtures.candidates.length, 2);
assert.equal(fixtures.source.usageFiles.length, 2);
for (const file of fixtures.source.usageFiles) {
  assert.equal(file.includes(tmpDir), false);
  assert.ok(file.startsWith('/tmp/sanitized') || file.startsWith('/repo'));
}
for (const candidate of fixtures.candidates) {
  assert.ok(
    ['retired-doc-file-blocker', 'retired-dev-server-blocker'].includes(
      candidate.fixture.coverage.policy,
    ),
  );
  assert.equal(candidate.replay_verification.verified, true);
  assert.equal(candidate.replay_verification.decision, 'allow');
  assert.equal(candidate.replay_verification.exitCodeMatches, true);
  assert.equal(candidate.replay_verification.decisionMatches, true);
  assert.equal(candidate.replay_verification.stderrIncludesMatch, true);
}
assert.ok(fs.existsSync(fixtures.outputPath));

const evals = extractEvalCandidates({ ...options, limit: 3 });
assert.equal(evals.paid_eval_status, 'not-run');
assert.ok(evals.cases.length >= 1);
assert.ok(fs.existsSync(evals.outputPath));

const knowledgeHome = path.join(tmpDir, 'knowledge-home');
writeExistingKnowledgeIndex(knowledgeHome);
const knowledge = extractKnowledgeCandidates({
  ...options,
  knowledgeHome,
  limit: 2,
});
assert.equal(knowledge.count, 2);
assert.ok(fs.existsSync(knowledge.indexPath));
const knowledgeIndex = JSON.parse(fs.readFileSync(knowledge.indexPath, 'utf8'));
const existingKnowledgeRow = knowledgeIndex.entries.find(
  (entry) => entry.id === 'existing-curated-entry',
);
assert.equal(
  existingKnowledgeRow.summary,
  'Do not drop curated knowledge when mining candidates.',
);
for (const entry of knowledge.entries) {
  assert.equal(entry.status, 'candidate');
  assert.equal(entry.source, 'telemetry-miner');
  assert.match(entry.id, /^telemetry-miner-\d{8}-[a-f0-9]{8}$/);
  assert.equal(entry.trust_level, 'telemetry-derived');
  assert.equal(entry.reviewed_by, '');
  assert.equal(entry.staleness, 'needs-review');
  assert.ok(entry.source_evidence);
  assert.ok(fs.existsSync(entry.path));
  const rawEntry = fs.readFileSync(entry.path, 'utf8');
  assert.match(rawEntry, /title: "Telemetry candidate:/);
  assert.match(rawEntry, /trust_level: telemetry-derived/);
  assert.match(rawEntry, /staleness: needs-review/);
  assert.match(rawEntry, /## 情境/);
}

const reviewKnowledgeOutDir = path.join(reviewDir, 'knowledge-default');
const reviewKnowledge = extractKnowledgeCandidates({
  ...options,
  outDir: reviewKnowledgeOutDir,
  limit: 1,
});
assert.equal(
  reviewKnowledge.knowledgeRoot,
  path.join(reviewKnowledgeOutDir, 'knowledge-candidates', 'knowledge'),
);
assert.ok(
  reviewKnowledge.entries[0].path.startsWith(reviewKnowledge.knowledgeRoot),
);

assert.equal(parseArgs(['node', 'script', '--help']).command, 'help');
assert.match(run(parseArgs(['node', 'script', '--help'])), /^Usage:/);

const cliSummary = runCli([
  'summary',
  '--json',
  '--usage-file',
  usageFile,
  '--workflow-runs-dir',
  workflowRunsDir,
]);
assert.equal(JSON.parse(cliSummary).totals.usageEvents, 6);

const cliClassify = runCli([
  'classify',
  '--usage-file',
  usageFile,
  '--workflow-runs-dir',
  workflowRunsDir,
  '--limit',
  '2',
]);
assert.equal(JSON.parse(cliClassify).classifications.length, 2);

const cliFixtures = runCli([
  'extract-fixtures',
  '--usage-file',
  usageFile,
  '--workflow-runs-dir',
  workflowRunsDir,
  '--out-dir',
  path.join(reviewDir, 'cli-fixtures'),
  '--limit',
  '2',
]);
assert.equal(JSON.parse(cliFixtures).candidates.length, 2);

const cliEvals = runCli([
  'extract-evals',
  '--usage-file',
  usageFile,
  '--workflow-runs-dir',
  workflowRunsDir,
  '--out-dir',
  path.join(reviewDir, 'cli-evals'),
  '--limit',
  '2',
]);
assert.equal(JSON.parse(cliEvals).paid_eval_status, 'not-run');

const cliKnowledge = runCli([
  'extract-knowledge',
  '--usage-file',
  usageFile,
  '--workflow-runs-dir',
  workflowRunsDir,
  '--knowledge-home',
  path.join(tmpDir, 'cli-knowledge-home'),
  '--limit',
  '2',
]);
assert.equal(JSON.parse(cliKnowledge).count, 2);

console.log('[OK] telemetry miner behavior verified');

function usageEvent(overrides) {
  return {
    schema_version: 'goldband.telemetry.v1',
    parent_event_id: null,
    sessionId: overrides.run_id,
    source: 'fixture',
    host: 'claude',
    confidence: 'inferred',
    ...overrides,
  };
}

function writeJsonl(file, rows) {
  fs.writeFileSync(
    file,
    rows.map((row) => JSON.stringify(row)).join('\n') + '\n',
    'utf8',
  );
}

function writeExistingKnowledgeIndex(knowledgeHome) {
  const knowledgeDir = path.join(knowledgeHome, 'knowledge');
  const entriesDir = path.join(knowledgeDir, 'entries');
  fs.mkdirSync(entriesDir, { recursive: true });
  const entryPath = path.join(entriesDir, 'existing-curated-entry.md');
  fs.writeFileSync(
    entryPath,
    `---
id: existing-curated-entry
title: Existing curated entry
type: practice
domains: [qa]
scope: global
project_slug: ""
canonical_remote: ""
status: active
confidence: 9
created: 2026-07-01
updated: 2026-07-01
source: manual
last_verified: null
graduated_to: ""
links: []
summary: Do not drop curated knowledge when mining candidates.
---

## 做法
Keep curated rows when adding telemetry candidates.

## 適用情境
Use this when telemetry mining writes candidates near existing knowledge.

## 驗證證據
The miner rebuilds the index from entry markdown files.
`,
    'utf8',
  );
  fs.writeFileSync(
    path.join(knowledgeDir, 'index.json'),
    `${JSON.stringify(
      {
        schema_version: 1,
        generated_at: '2026-07-06T00:00:00.000Z',
        entries: [
          {
            id: 'existing-curated-entry',
            title: 'Existing curated entry',
            type: 'practice',
            domains: ['qa'],
            scope: 'global',
            status: 'active',
            confidence: 9,
            updated: '2026-07-01',
            summary: 'STALE index row should not be preserved.',
            path: entryPath,
          },
        ],
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
}

function iso(baseMs, minuteOffset) {
  return new Date(baseMs + minuteOffset * 60 * 1000).toISOString();
}

function runCli(args) {
  const result = spawnSync(
    process.execPath,
    [path.join(import.meta.dirname, 'mine-telemetry.mjs'), ...args],
    {
      encoding: 'utf8',
    },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
}
