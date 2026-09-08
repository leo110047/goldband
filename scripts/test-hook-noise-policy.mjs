#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const require = createRequire(import.meta.url);
const claudeRouter = path.join(repoDir, 'hooks/scripts/hooks/hook-router.js');
const codexRouter = path.join(repoDir, 'codex/hooks/hook-router.js');
const suggestionHook = path.join(
  repoDir,
  'hooks/scripts/hooks/skill-activation-suggestions.js',
);
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'goldband-hook-noise-'));

process.on('exit', () => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function runNode(script, input, extraEnv = {}) {
  return spawnSync(process.execPath, [script], {
    cwd: repoDir,
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: {
      ...process.env,
      GOLDBAND_DATA_DIR: tmpDir,
      GOLDBAND_HOME: path.join(tmpDir, 'goldband-home'),
      CLAUDE_PLUGIN_DATA: path.join(tmpDir, 'plugin-data'),
      ...extraEnv,
    },
  });
}

function assertSilentClaudeLifecycle(eventName) {
  const result = runNode(claudeRouter, {
    hook_event_name: eventName,
    session_id: `noise-${eventName}`,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '', `${eventName} must not inject context`);
  assert.equal(result.stderr, '', `${eventName} must not print reminders`);
}

function testPassiveLifecycleHooksAreNotRegistered() {
  const claude = JSON.parse(
    fs.readFileSync(path.join(repoDir, 'hooks/hooks.json'), 'utf8'),
  ).hooks;
  const plugin = JSON.parse(
    fs.readFileSync(path.join(repoDir, 'hooks/plugin-hooks.json'), 'utf8'),
  );
  const codex = JSON.parse(
    fs.readFileSync(path.join(repoDir, 'codex/hooks.json'), 'utf8'),
  ).hooks;
  const passiveEvents = [
    'SessionStart',
    'PreCompact',
    'PostCompact',
    'SessionEnd',
  ];

  for (const eventName of passiveEvents) {
    assert.equal(claude[eventName], undefined, `${eventName} is passive noise`);
    assert.equal(plugin[eventName], undefined, `${eventName} is plugin noise`);
  }
  assert.equal(claude.PostToolUseFailure[0].matcher, 'Bash');
  assert.equal(plugin.PostToolUseFailure[0].matcher, 'Bash');
  assert.equal(
    codex.SessionStart,
    undefined,
    'Codex SessionStart is passive noise',
  );
  assert.equal(
    codex.SubagentStop,
    undefined,
    'A no-op Codex SubagentStop must not be registered',
  );
}

function testPassiveLifecycleEvaluationIsSilent() {
  for (const eventName of [
    'SessionStart',
    'PostToolUseFailure',
    'PreCompact',
    'PostCompact',
    'SessionEnd',
  ]) {
    assertSilentClaudeLifecycle(eventName);
  }

  const codex = runNode(codexRouter, {
    hook_event_name: 'SessionStart',
    session_id: 'noise-codex-session-start',
  });
  assert.equal(codex.status, 0, codex.stderr);
  assert.deepEqual(JSON.parse(codex.stdout), {});
}

function testPromptHookDoesNotInjectGenericPolicy() {
  const hello = runNode(suggestionHook, {
    hook_event_name: 'UserPromptSubmit',
    session_id: 'noise-hello',
    prompt: 'hello',
  });
  assert.equal(hello.status, 0, hello.stderr);
  assert.deepEqual(JSON.parse(hello.stdout), {});

  const genericCheck = runNode(codexRouter, {
    hook_event_name: 'UserPromptSubmit',
    session_id: 'noise-generic-check',
    prompt: '請檢查一下還有沒有其他太吵的 hook',
  });
  assert.equal(genericCheck.status, 0, genericCheck.stderr);
  assert.doesNotMatch(genericCheck.stdout, /goldband review code/);
}

function testContextMonitorOnlyEmitsOnSeverityChanges() {
  const { evaluatePostToolUse } = require(
    path.join(repoDir, 'hooks/scripts/lib/hook-router/posttool-policy.js'),
  );
  const stateFile = path.join(tmpDir, 'context-state.json');
  const previous = {
    state: process.env.HOOK_ROUTER_CONTEXT_STATE_FILE,
    warn: process.env.CONTEXT_WARN_THRESHOLD,
    critical: process.env.CONTEXT_CRIT_THRESHOLD,
  };
  process.env.HOOK_ROUTER_CONTEXT_STATE_FILE = stateFile;
  process.env.CONTEXT_WARN_THRESHOLD = '2';
  process.env.CONTEXT_CRIT_THRESHOLD = '10';

  try {
    const messages = Array.from(
      { length: 8 },
      () =>
        evaluatePostToolUse({
          hook_event_name: 'PostToolUse',
          session_id: 'noise-context-monitor',
          tool_name: 'Read',
          tool_input: {},
        }).logs,
    ).flat();
    assert.equal(messages.length, 1);
    assert.match(messages[0], /WARNING: 2 tool calls/);
  } finally {
    if (previous.state === undefined) {
      delete process.env.HOOK_ROUTER_CONTEXT_STATE_FILE;
    } else {
      process.env.HOOK_ROUTER_CONTEXT_STATE_FILE = previous.state;
    }
    if (previous.warn === undefined) delete process.env.CONTEXT_WARN_THRESHOLD;
    else process.env.CONTEXT_WARN_THRESHOLD = previous.warn;
    if (previous.critical === undefined) {
      delete process.env.CONTEXT_CRIT_THRESHOLD;
    } else {
      process.env.CONTEXT_CRIT_THRESHOLD = previous.critical;
    }
  }
}

function testOrdinaryStopHasNoDesktopNotification() {
  const { notificationMessageForInput } = require(
    path.join(repoDir, 'hooks/scripts/lib/hook-router/stop-policy.js'),
  );
  assert.equal(notificationMessageForInput({ hook_event_name: 'Stop' }), null);
  assert.equal(
    notificationMessageForInput({ notification_type: 'permission_prompt' }),
    '需要你的同意才能繼續',
  );
}

testPassiveLifecycleHooksAreNotRegistered();
testPassiveLifecycleEvaluationIsSilent();
testPromptHookDoesNotInjectGenericPolicy();
testContextMonitorOnlyEmitsOnSeverityChanges();
testOrdinaryStopHasNoDesktopNotification();

console.log(
  '[OK] passive hooks stay silent and actionable advisories remain scoped',
);
