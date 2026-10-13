#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const {
  SCHEMA_VERSION,
  validateUsageEvent,
} = require('../scripts/lib/telemetry-schema.cjs');
const repoDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'goldband-telemetry-'));
const usageFile = path.join(tmpDir, 'usage-events.jsonl');
const metricsFile = path.join(tmpDir, 'metrics.jsonl');
const claudeRouter = path.join(
  repoDir,
  'hooks',
  'scripts',
  'hooks',
  'hook-router.js',
);
const claudePromptHook = path.join(
  repoDir,
  'hooks',
  'scripts',
  'hooks',
  'skill-activation-suggestions.js',
);
const codexRouter = path.join(repoDir, 'codex', 'hooks', 'hook-router.js');

process.on('exit', () => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function runNode(script, input, extraEnv = {}, expectedStatus = 0) {
  const result = spawnSync(process.execPath, [script], {
    cwd: repoDir,
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: {
      ...process.env,
      GOLDBAND_USAGE_FILE: usageFile,
      GOLDBAND_DATA_DIR: path.join(tmpDir, 'runtime-data'),
      HOOK_ROUTER_METRICS_FILE: metricsFile,
      // Live style advice is out of scope; a missing checker writes no snapshots.
      GOLDBAND_STYLE_GATE_SCRIPT: path.join(tmpDir, 'no-style-checker'),
      CLAUDE_SESSION_ID: 'claude-session',
      CODEX_SESSION_ID: 'codex-session',
      ...extraEnv,
    },
  });

  assert.equal(result.status, expectedStatus, result.stderr);
  return result;
}

function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs
    .readFileSync(filePath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function runReportJson() {
  const result = spawnSync(
    process.execPath,
    ['hooks/scripts/tools/report-usage-summary.js', '--days', '30', '--json'],
    {
      cwd: repoDir,
      encoding: 'utf8',
      env: {
        ...process.env,
        GOLDBAND_USAGE_FILE: usageFile,
        HOOK_ROUTER_METRICS_FILE: metricsFile,
      },
    },
  );
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function hasEvent(events, expected) {
  return events.some((event) =>
    Object.entries(expected).every(([key, value]) => event[key] === value),
  );
}

function assertHasEvent(events, expected) {
  assert.equal(hasEvent(events, expected), true);
}

function assertV1TelemetryEvent(event, expectedRunId) {
  assert.equal(event.schema_version, SCHEMA_VERSION);
  assert.equal(event.run_id, expectedRunId);
  assert.equal(typeof event.event_id, 'string');
  assert.ok(event.event_id.length > 0);
  const validation = validateUsageEvent(event);
  assert.equal(validation.valid, true, validation.errors.join('; '));
}

function withEnv(updates, callback) {
  const previous = {};
  for (const key of Object.keys(updates)) {
    previous[key] = process.env[key];
    if (updates[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = updates[key];
    }
  }

  try {
    return callback();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

function testPersistentPathAndMetricsDefault() {
  const { getPersistentDataPath } = require('../hooks/scripts/lib/utils.js');
  const {
    metricsEnabled,
  } = require('../hooks/scripts/lib/hook-router/metrics.js');

  process.env.GOLDBAND_DATA_DIR = path.join(tmpDir, 'data-root');
  const persistentPath = getPersistentDataPath(
    'hook-router',
    'usage-events.jsonl',
  );
  assert.equal(
    persistentPath,
    path.join(tmpDir, 'data-root', 'hook-router', 'usage-events.jsonl'),
  );

  delete process.env.HOOK_ROUTER_METRICS_ENABLED;
  assert.equal(metricsEnabled(), true);
  process.env.HOOK_ROUTER_METRICS_ENABLED = '0';
  assert.equal(metricsEnabled(), false);
  delete process.env.HOOK_ROUTER_METRICS_ENABLED;
  delete process.env.GOLDBAND_DATA_DIR;
}

function testCodexPluginDataRoot() {
  const codexTelemetry = require('../codex/hooks/telemetry.js');
  const pluginRoot = path.join(tmpDir, 'plugin-data');

  withEnv(
    {
      CLAUDE_PLUGIN_DATA: pluginRoot,
      GOLDBAND_DATA_DIR: undefined,
      GOLDBAND_USAGE_FILE: undefined,
      XDG_DATA_HOME: undefined,
    },
    () => {
      assert.equal(
        codexTelemetry.usageFile(),
        path.join(pluginRoot, 'hook-router', 'usage-events.jsonl'),
      );
    },
  );
}

function testCodexDataRootFallbacks() {
  const codexTelemetry = require('../codex/hooks/telemetry.js');
  const badRoot = path.join(tmpDir, 'bad-data-root');
  const xdgRoot = path.join(tmpDir, 'xdg-data');
  fs.writeFileSync(badRoot, 'not a directory', 'utf8');

  withEnv(
    {
      CLAUDE_PLUGIN_DATA: undefined,
      GOLDBAND_DATA_DIR: badRoot,
      GOLDBAND_USAGE_FILE: undefined,
      XDG_DATA_HOME: xdgRoot,
    },
    () => {
      assert.equal(
        codexTelemetry.usageFile(),
        path.join(xdgRoot, 'goldband', 'hook-router', 'usage-events.jsonl'),
      );
      codexTelemetry.appendUsageEvent({ category: 'test', name: 'xdg' });
      const event = readJsonl(codexTelemetry.usageFile()).at(-1);
      assert.equal(event.name, 'xdg');
      assertV1TelemetryEvent(event, 'unknown');
    },
  );
}

function testCodexTempFallback() {
  const durableFile = path.join(tmpDir, 'durable-file');
  const xdgFile = path.join(tmpDir, 'xdg-file');
  const homeFile = path.join(tmpDir, 'home-file');
  const tempRoot = path.join(tmpDir, 'tmp-root');
  for (const filePath of [durableFile, xdgFile, homeFile]) {
    fs.writeFileSync(filePath, 'not a directory', 'utf8');
  }
  fs.mkdirSync(tempRoot, { recursive: true });

  const script = [
    "const fs = require('fs');",
    "const t = require('./codex/hooks/telemetry.js');",
    "t.appendUsageEvent({ category: 'test', name: 'temp-fallback' });",
    'console.log(JSON.stringify({',
    '  file: t.usageFile(),',
    '  events: fs.readFileSync(t.usageFile(), "utf8").trim().split("\\n").map(JSON.parse),',
    '}));',
  ].join('\n');
  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: repoDir,
    encoding: 'utf8',
    env: {
      ...process.env,
      CLAUDE_PLUGIN_DATA: '',
      GOLDBAND_DATA_DIR: durableFile,
      GOLDBAND_USAGE_FILE: '',
      XDG_DATA_HOME: xdgFile,
      HOME: homeFile,
      TMPDIR: tempRoot,
    },
  });

  assert.equal(result.status, 0, result.stderr);
  const observed = JSON.parse(result.stdout);
  assert.equal(
    observed.file,
    path.join(tempRoot, 'goldband', 'hook-router', 'usage-events.jsonl'),
  );
  const event = observed.events.at(-1);
  assert.equal(event.name, 'temp-fallback');
  assert.equal(event.schema_version, SCHEMA_VERSION);
  assert.equal(event.run_id, 'unknown');
}

function testCodexUsageRetention() {
  const codexTelemetry = require('../codex/hooks/telemetry.js');
  const retentionUsageFile = path.join(
    tmpDir,
    'retention',
    'usage-events.jsonl',
  );
  const oldRotatedFile = `${retentionUsageFile}.old`;

  withEnv(
    {
      GOLDBAND_USAGE_FILE: retentionUsageFile,
      GOLDBAND_USAGE_TELEMETRY_ENABLED: '1',
      GOLDBAND_USAGE_MAX_BYTES: '1048576',
      GOLDBAND_USAGE_RETENTION_DAYS: '1',
    },
    () => {
      fs.mkdirSync(path.dirname(retentionUsageFile), { recursive: true });
      fs.writeFileSync(oldRotatedFile, '{}\n', 'utf8');
      const oldDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
      fs.utimesSync(oldRotatedFile, oldDate, oldDate);
      codexTelemetry.appendUsageEvent({ category: 'test', name: 'cleanup' });
      assert.equal(fs.existsSync(oldRotatedFile), false);
    },
  );

  const rotationUsageFile = path.join(tmpDir, 'rotation', 'usage-events.jsonl');
  withEnv(
    {
      GOLDBAND_USAGE_FILE: rotationUsageFile,
      GOLDBAND_USAGE_TELEMETRY_ENABLED: '1',
      GOLDBAND_USAGE_MAX_BYTES: '1',
      GOLDBAND_USAGE_RETENTION_DAYS: '30',
    },
    () => {
      codexTelemetry.appendUsageEvent({ category: 'test', name: 'first' });
      codexTelemetry.appendUsageEvent({ category: 'test', name: 'second' });
    },
  );

  const rotatedFiles = fs
    .readdirSync(path.dirname(rotationUsageFile))
    .filter((entry) =>
      entry.startsWith(`${path.basename(rotationUsageFile)}.`),
    );
  assert.ok(rotatedFiles.length >= 1);
  assert.equal(readJsonl(rotationUsageFile).at(-1).name, 'second');
}

function testCodexStructuredDenyTelemetryName() {
  const { hookOutcomeUsageEvents } = require('../codex/hooks/telemetry.js');
  const events = hookOutcomeUsageEvents(
    { hook_event_name: 'PreToolUse', tool_name: 'Bash' },
    {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: 'copy changed without matching regex',
      },
      internalTelemetry: { name: 'recursive-force-delete' },
    },
  );

  assert.equal(events.length, 1);
  assert.equal(events[0].name, 'recursive-force-delete');
  assert.equal(events[0].run_id, 'unknown');
}

function testSchemaValidationAndLegacyCompatibility() {
  const usageSummary = require('../hooks/scripts/lib/hook-router/usage-summary.js');
  const oldUsageFile = path.join(tmpDir, 'legacy-usage-events.jsonl');
  fs.writeFileSync(
    oldUsageFile,
    `${JSON.stringify({
      category: 'workflow-entry',
      name: 'goldband-review',
      action: 'invoked',
      source: 'legacy-fixture',
      sessionId: 'legacy-session',
      confidence: 'confirmed',
      host: 'claude',
      detail: { host: 'claude' },
      recordedAt: new Date().toISOString(),
    })}\n`,
    'utf8',
  );
  const summary = usageSummary.summarizeEvents(
    { days: 30, limit: 20 },
    { usageFile: oldUsageFile, metricsFile },
    { usageEvents: usageSummary.loadJsonl(oldUsageFile), metrics: [] },
  );
  assert.equal(summary.usage.uniqueSessions, 1);
  assert.equal(summary.workflowEntries.confirmed[0].name, 'goldband-review');
}

function testCodexRunIdFileFallback() {
  const codexTelemetry = require('../codex/hooks/telemetry.js');
  const runIdFile = path.join(tmpDir, 'codex-run-id', 'run-id.txt');

  withEnv(
    {
      CODEX_SESSION_ID: undefined,
      GOLDBAND_RUN_ID: undefined,
      GOLDBAND_RUN_ID_FILE: runIdFile,
    },
    () => {
      const events = codexTelemetry.workflowUsageEvents({
        hook_event_name: 'PreToolUse',
        tool_name: 'Skill',
        tool_input: { name: 'goldband-review' },
      });
      assert.equal(events.length, 1);
      assert.equal(events[0].run_id, fs.readFileSync(runIdFile, 'utf8').trim());
    },
  );
}

function testWorkflowEventsMatchAcrossHosts() {
  const codexTelemetry = require('../codex/hooks/telemetry.js');
  const {
    claudeUsageContext,
  } = require('../hooks/scripts/lib/hook-router/usage-telemetry.js');
  const {
    buildWorkflowUsageEvents,
  } = require('../hooks/scripts/lib/hook-router/workflow-telemetry.js');
  const inputs = [
    {
      hook_event_name: 'PreToolUse',
      tool_name: 'Skill',
      tool_input: { name: '/goldband-review', skill: 'goldband-qa' },
    },
    {
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'FOO=1 env BAR=2 goldband-investigate --help' },
    },
    {
      hook_event_name: 'UserPromptSubmit',
      prompt: 'Run /goldband-plan then (/goldband-review)',
    },
  ];
  const comparable = (events) =>
    events.map(({ host, source, run_id, sessionId, ...rest }) => rest);

  withEnv(
    { CLAUDE_SESSION_ID: 'claude-session', CODEX_SESSION_ID: 'codex-session' },
    () => {
      for (const input of inputs) {
        const claude = buildWorkflowUsageEvents(
          input,
          claudeUsageContext(input, 'claude-source'),
        );
        const codex = codexTelemetry.workflowUsageEvents(input);
        assert.ok(claude.length > 0);
        assert.deepEqual(comparable(codex), comparable(claude));
        assert.ok(
          claude.every(
            (event) =>
              event.host === 'claude' && event.sessionId === 'claude-session',
          ),
        );
        assert.ok(
          codex.every(
            (event) =>
              event.host === 'codex' && event.sessionId === 'codex-session',
          ),
        );
      }
    },
  );
}

function testClaudeSessionStartIsSilent() {
  const result = runNode(claudeRouter, {
    hook_event_name: 'SessionStart',
    session_id: 'claude-session-start-silent',
  });
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
}

function runTelemetryFixtures() {
  runNode(claudeRouter, {
    hook_event_name: 'PreToolUse',
    tool_name: 'Skill',
    tool_input: { name: 'goldband-review' },
  });
  runNode(claudeRouter, {
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'goldband-investigate --help' },
  });
  runNode(claudeRouter, {
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'rg goldband-review' },
  });
  runNode(
    claudeRouter,
    {
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'touch review-mutates.txt' },
    },
    {},
    2,
  );
  runNode(codexRouter, {
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'echo goldband-review' },
  });
  runNode(codexRouter, {
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'cat docs/goldband-review-notes.md' },
  });
  runNode(codexRouter, {
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'git status && goldband-review --help' },
  });
  runNode(
    claudeRouter,
    {
      hook_event_name: 'PreToolUse',
      session_id: 'claude-secret-detector-session',
      tool_name: 'Write',
      tool_input: { file_path: 'scratch.md', content: 'ghp_' + 'a'.repeat(36) },
    },
    {},
    2,
  );
  runNode(claudePromptHook, {
    hook_event_name: 'UserPromptSubmit',
    prompt: '/goldband-qa check this',
  });
  runNode(codexRouter, {
    hook_event_name: 'PreToolUse',
    tool_name: 'Skill',
    tool_input: { skillName: 'goldband-cso' },
  });
  runNode(codexRouter, {
    hook_event_name: 'UserPromptSubmit',
    prompt: '/goldband-investigate',
  });
}

function assertTelemetryEvents() {
  const events = readJsonl(usageFile);
  for (const event of events) {
    assertV1TelemetryEvent(event, event.sessionId || 'unknown');
  }
  assertWorkflowTelemetryEvents(events);
  assertHookTelemetryEvents(events);
}

function assertWorkflowTelemetryEvents(events) {
  assertHasEvent(events, {
    category: 'workflow-entry',
    name: 'goldband-review',
    confidence: 'confirmed',
    host: 'claude',
  });
  assertHasEvent(events, {
    category: 'workflow-entry',
    name: 'goldband-investigate',
    confidence: 'inferred',
    host: 'claude',
  });
  assert.equal(
    events.filter(
      (event) =>
        event.category === 'workflow-entry' &&
        event.name === 'goldband-review' &&
        event.confidence === 'inferred',
    ).length,
    1,
  );
  assertHasEvent(events, {
    category: 'workflow-entry',
    name: 'goldband-cso',
    confidence: 'confirmed',
    host: 'codex',
  });
}

function assertHookTelemetryEvents(events) {
  assertHasEvent(events, {
    category: 'hook-decision',
    name: 'review-read-only',
    action: 'deny',
  });
  assertHasEvent(events, {
    category: 'mode-enforcement',
    name: 'review-read-only',
    action: 'block',
  });
  assertHasEvent(events, {
    category: 'hook-decision',
    name: 'secret-detector',
    action: 'deny',
  });
}

function testTelemetryCapture() {
  runTelemetryFixtures();
  assertTelemetryEvents();
}

function testReportSummary() {
  const summary = runReportJson();
  assert.equal(summary.paths.usageFile, usageFile);
  assert.equal(summary.paths.metricsFile, metricsFile);
  assert.ok(
    summary.workflowEntries.confirmed.some(
      (row) => row.host === 'claude' && row.name === 'goldband-review',
    ),
  );
  assert.ok(
    summary.workflowEntries.inferred.some(
      (row) => row.host === 'codex' && row.name === 'goldband-investigate',
    ),
  );
  assert.ok(summary.hooks.denies.some((row) => row.name === 'secret-detector'));
}

withEnv(
  {
    CLAUDE_SESSION_ID: undefined,
    CODEX_SESSION_ID: undefined,
    GOLDBAND_RUN_ID: undefined,
    GOLDBAND_RUN_ID_FILE: undefined,
  },
  () => {
    testPersistentPathAndMetricsDefault();
    testCodexPluginDataRoot();
    testCodexDataRootFallbacks();
    testCodexTempFallback();
    testCodexUsageRetention();
    testCodexStructuredDenyTelemetryName();
    testSchemaValidationAndLegacyCompatibility();
    testCodexRunIdFileFallback();
    testWorkflowEventsMatchAcrossHosts();
    testClaudeSessionStartIsSilent();
    testTelemetryCapture();
    testReportSummary();
  },
);

console.log('[OK] telemetry behavior verified');
