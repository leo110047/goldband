#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const routerPath = path.join(repoDir, 'codex', 'hooks', 'hook-router.js');
const hooksConfigPath = path.join(repoDir, 'codex', 'hooks.json');
const telemetryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-hook-'));
const usageFile = path.join(telemetryDir, 'usage-events.jsonl');

process.on('exit', () => {
  fs.rmSync(telemetryDir, { recursive: true, force: true });
});

function runHook(input, options = {}) {
  const { cwd = repoDir, env: extraEnv = {} } = options;
  const result = spawnSync(process.execPath, [routerPath], {
    cwd,
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: {
      ...process.env,
      GOLDBAND_DATA_DIR: telemetryDir,
      GOLDBAND_USAGE_FILE: usageFile,
      ...extraEnv,
    },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');

  const stdout = result.stdout.trim();
  assert.notEqual(stdout, '', 'hook must emit valid JSON on stdout');
  const output = JSON.parse(stdout);
  assertCodexPreToolUseSchema(input, output);
  return output;
}

function assertCodexPreToolUseSchema(input, output) {
  if (input.hook_event_name !== 'PreToolUse' || !output.hookSpecificOutput) {
    return;
  }
  const allowed = new Set([
    'hookEventName',
    'permissionDecision',
    'permissionDecisionReason',
    'additionalContext',
    'updatedInput',
  ]);
  for (const key of Object.keys(output.hookSpecificOutput)) {
    assert.ok(allowed.has(key), `Codex PreToolUse schema rejects ${key}`);
  }
}

function assertNoopOutput(output) {
  assert.deepEqual(output, {});
}

function testHighRiskBashDenied() {
  const commands = [
    ['rm -rf /', /Recursive force deletion/, 'recursive-force-delete'],
    ['rm -rf ./*', /Recursive force deletion/, 'recursive-force-delete'],
    [
      'rm -rf ~/Documents',
      /Recursive force deletion/,
      'recursive-force-delete',
    ],
    ['git clean -fd', /git clean/, 'destructive-git-clean'],
    ['git clean -f -d', /git clean/, 'destructive-git-clean'],
    ['git clean -x -f -d', /git clean/, 'destructive-git-clean'],
    ['git clean -f', /git clean/, 'destructive-git-clean'],
  ];

  for (const [command, reasonPattern] of commands) {
    const output = runHook({
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command },
    });

    assert.equal(
      output.hookSpecificOutput.hookEventName,
      'PreToolUse',
      command,
    );
    assert.equal(output.hookSpecificOutput.permissionDecision, 'deny', command);
    assert.match(
      output.hookSpecificOutput.permissionDecisionReason,
      reasonPattern,
      command,
    );
    assert.equal(output.hookSpecificOutput.telemetryName, undefined);
    assert.equal(output.internalTelemetry, undefined);
  }
}

function testGitCleanDryRunAllowed() {
  const output = runHook({
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'git clean -n -fd' },
  });

  assertNoopOutput(output);
}

function testNormalBashAllowedWithNoopJson() {
  const output = runHook({
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'npm test' },
  });

  assertNoopOutput(output);
}

function testDevServerAllowedWithoutInterruption() {
  assertNoopOutput(
    runHook({
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'npm run dev' },
    }),
  );
}

function testPermissionRequestOnlyDeniesHighRisk() {
  const safeOutput = runHook({
    hook_event_name: 'PermissionRequest',
    tool_name: 'Bash',
    tool_input: { command: 'git status' },
  });
  assertNoopOutput(safeOutput);

  const riskyOutput = runHook({
    hook_event_name: 'PermissionRequest',
    tool_name: 'Bash',
    tool_input: { command: 'git reset --hard HEAD' },
  });
  assert.equal(
    riskyOutput.hookSpecificOutput.hookEventName,
    'PermissionRequest',
  );
  assert.equal(riskyOutput.hookSpecificOutput.decision.behavior, 'deny');
  assert.equal(riskyOutput.hookSpecificOutput.telemetryName, undefined);
}

function testPatchSecretDenied() {
  const fakeToken = 'github_pat_' + 'a'.repeat(64);
  const output = runHook({
    hook_event_name: 'PreToolUse',
    tool_name: 'apply_patch',
    tool_input: {
      command: [
        '*** Begin Patch',
        '*** Add File: leaked.txt',
        `+${fakeToken}`,
        '*** End Patch',
      ].join('\n'),
    },
  });

  assert.equal(output.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.equal(output.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(output.hookSpecificOutput.permissionDecisionReason, /secret/);
}

function testPatchAdvisorySecretWarnsOnly() {
  const output = runHook({
    hook_event_name: 'PreToolUse',
    tool_name: 'apply_patch',
    tool_input: {
      command: [
        '*** Begin Patch',
        '*** Add File: fixtures/openai-example.txt',
        '+sk-proj-' + 'a'.repeat(32),
        '*** End Patch',
      ].join('\n'),
    },
  });

  assert.equal(output.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.equal(output.hookSpecificOutput.permissionDecision, undefined);
  assert.match(
    output.hookSpecificOutput.additionalContext,
    /credential-shaped/,
  );
}

function testGitPatchDenied() {
  const output = runHook({
    hook_event_name: 'PreToolUse',
    tool_name: 'apply_patch',
    tool_input: {
      command: [
        '*** Begin Patch',
        '*** Add File: .git/config',
        '+[core]',
        '*** End Patch',
      ].join('\n'),
    },
  });

  assert.equal(output.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.equal(output.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(output.hookSpecificOutput.permissionDecisionReason, /\.git/);
}

function testPostToolUseFailureContext() {
  const output = runHook({
    hook_event_name: 'PostToolUse',
    tool_name: 'Bash',
    tool_response: { exit_code: 1 },
  });

  assert.equal(output.hookSpecificOutput.hookEventName, 'PostToolUse');
  assert.match(
    output.hookSpecificOutput.additionalContext,
    /systematic debugging/,
  );
}

function testRegisteredNoopHooksEmitJson() {
  assertNoopOutput(
    runHook({
      hook_event_name: 'UserPromptSubmit',
      prompt: 'please explain this file',
    }),
  );
  assertNoopOutput(
    runHook({
      hook_event_name: 'PostToolUse',
      tool_name: 'Bash',
      tool_response: { exit_code: 0 },
    }),
  );
  assertNoopOutput(
    runHook({
      hook_event_name: 'Stop',
      last_assistant_message: 'I checked the current files.',
    }),
  );
  assertNoopOutput(
    runHook({
      hook_event_name: 'SubagentStop',
      last_assistant_message:
        'Checked. Evidence: node scripts/test-codex-hook-router.mjs passed.',
    }),
  );
}

function testPostToolUseStyleGateAdvisory() {
  const projectDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'goldband-style-gate-'),
  );
  const fixtureFile = path.join(projectDir, 'fixture.ts');
  const relativeFixture = path.relative(projectDir, fixtureFile);
  try {
    const init = spawnSync('git', ['init', '--quiet'], {
      cwd: projectDir,
      encoding: 'utf8',
    });
    assert.equal(init.status, 0, init.stderr);
    fs.writeFileSync(fixtureFile, 'console.log("debug");\n', 'utf8');
    const output = runHook(
      {
        hook_event_name: 'PostToolUse',
        tool_name: 'apply_patch',
        tool_input: {
          command: [
            '*** Begin Patch',
            `*** Update File: ${relativeFixture}`,
            '@@',
            '+con' + 'sole.log("debug");',
            '*** End Patch',
          ].join('\n'),
        },
      },
      { cwd: projectDir },
    );

    assert.equal(output.hookSpecificOutput.hookEventName, 'PostToolUse');
    assert.match(
      output.hookSpecificOutput.additionalContext,
      /goldband style gate advisory/,
    );
    assert.match(output.hookSpecificOutput.additionalContext, /console-log/);
  } finally {
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
}

function testPostToolUseStyleGateAdvisoryUsesExplicitProjectRoot() {
  const originalCwd = process.cwd();
  const externalRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-cwd-'));
  try {
    const init = spawnSync('git', ['init', '--quiet'], {
      cwd: externalRepo,
      encoding: 'utf8',
    });
    assert.equal(init.status, 0, init.stderr);
    process.chdir(externalRepo);
    testPostToolUseStyleGateAdvisory();
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(externalRepo, { recursive: true, force: true });
  }
}

function testPassiveLifecycleHooksAreNotRegistered() {
  const hooksConfig = JSON.parse(fs.readFileSync(hooksConfigPath, 'utf8'));
  assert.equal(hooksConfig.hooks.SessionStart, undefined);
  assert.equal(hooksConfig.hooks.PreCompact, undefined);
  assert.equal(hooksConfig.hooks.PostCompact, undefined);
  assertNoopOutput(runHook({ hook_event_name: 'SessionStart' }));
  assertNoopOutput(runHook({ hook_event_name: 'PreCompact' }));
  assertNoopOutput(runHook({ hook_event_name: 'PostCompact' }));
}

function testMutatingMcpWarnsOnly() {
  const output = runHook({
    hook_event_name: 'PreToolUse',
    tool_name: 'mcp__github__create_issue',
    tool_input: { title: 'test' },
  });

  assert.equal(output.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.equal(output.hookSpecificOutput.permissionDecision, undefined);
  assert.match(output.hookSpecificOutput.additionalContext, /mutating/);
}

function testPromptWorkflowHint() {
  const output = runHook({
    hook_event_name: 'UserPromptSubmit',
    prompt: 'please review this diff and debug the failing test',
  });

  assert.equal(output.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
  assert.match(
    output.hookSpecificOutput.additionalContext,
    /\$goldband review/,
  );
  assert.match(
    output.hookSpecificOutput.additionalContext,
    /\$goldband investigate/,
  );
}

function testPromptWorkflowHintRequiresTriggerBoundaries() {
  const output = runHook({
    hook_event_name: 'UserPromptSubmit',
    prompt: 'Please give me an explanation of this file.',
  });

  assertNoopOutput(output);
}

function testDirectWorkflowInvocationSuppressesHints() {
  for (const prompt of [
    '$goldband plan create 重構認證邏輯',
    '/plan 重構認證邏輯',
  ]) {
    assertNoopOutput(
      runHook({
        hook_event_name: 'UserPromptSubmit',
        prompt,
      }),
    );
  }
}

function testWorkflowHintsLoadOnlyForPromptRouting() {
  const routingPath = path.join(
    repoDir,
    'codex',
    'hooks',
    'capability-routing.generated.json',
  );
  const program = `
    const assert = require('node:assert/strict');
    const routerPath = ${JSON.stringify(routerPath)};
    const routingPath = require.resolve(${JSON.stringify(routingPath)});
    const router = require(routerPath);
    assert.equal(require.cache[routingPath], undefined);
    router.evaluateInput({ hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: {} });
    assert.equal(require.cache[routingPath], undefined);
    router.evaluateInput({ hook_event_name: 'Stop' });
    assert.equal(require.cache[routingPath], undefined);
    router.evaluateInput({ hook_event_name: 'UserPromptSubmit', prompt: 'please review this diff' });
    assert.ok(require.cache[routingPath]);
  `;
  const result = spawnSync(process.execPath, ['-e', program], {
    cwd: repoDir,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

function testWorkflowTelemetry() {
  runHook({
    hook_event_name: 'PreToolUse',
    tool_name: 'Skill',
    tool_input: { name: 'goldband-review' },
  });
  runHook({
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'rm -rf /' },
  });

  const events = fs
    .readFileSync(usageFile, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  assert.ok(
    events.some(
      (event) =>
        event.category === 'workflow-entry' &&
        event.name === 'goldband-review' &&
        event.host === 'codex' &&
        event.confidence === 'confirmed',
    ),
  );
  assert.ok(
    events.some(
      (event) =>
        event.category === 'hook-decision' &&
        event.name === 'recursive-force-delete' &&
        event.detail?.host === 'codex',
    ),
  );
}

function testCompletionClaimsDoNotUseRegex() {
  const conversationalClaims = [
    'Done, everything is complete.',
    'Done, verified.',
    'Fixed. I checked the file.',
    'Audit 已完成，接下來說明設計取捨。',
  ];

  for (const lastAssistantMessage of conversationalClaims) {
    assertNoopOutput(
      runHook({
        hook_event_name: 'Stop',
        last_assistant_message: lastAssistantMessage,
      }),
    );
    assertNoopOutput(
      runHook({
        hook_event_name: 'SubagentStop',
        last_assistant_message: lastAssistantMessage,
      }),
    );
  }
}

function testStopDoesNotSuggestKnowledgeCapture() {
  const messages = [
    'Implemented the fix. Verified with bun test test/goldband-knowledge.test.ts. Root cause was a stale candidate lifecycle pattern reusable in future sessions.',
    'Fixed. Verified with node scripts/test-codex-hook-router.mjs. 根因是 Stop hook 不該用 regex 判斷，下次應該放在 workflow footer。',
  ];

  for (const lastAssistantMessage of messages) {
    assertNoopOutput(
      runHook({
        hook_event_name: 'Stop',
        session_id: 'stop-semantic-noop-test',
        last_assistant_message: lastAssistantMessage,
      }),
    );
  }
}

testHighRiskBashDenied();
testGitCleanDryRunAllowed();
testNormalBashAllowedWithNoopJson();
testDevServerAllowedWithoutInterruption();
testPermissionRequestOnlyDeniesHighRisk();
testPatchSecretDenied();
testPatchAdvisorySecretWarnsOnly();
testGitPatchDenied();
testPostToolUseFailureContext();
testRegisteredNoopHooksEmitJson();
testPostToolUseStyleGateAdvisory();
testPostToolUseStyleGateAdvisoryUsesExplicitProjectRoot();
testPassiveLifecycleHooksAreNotRegistered();
testMutatingMcpWarnsOnly();
testPromptWorkflowHint();
testPromptWorkflowHintRequiresTriggerBoundaries();
testDirectWorkflowInvocationSuppressesHints();
testWorkflowHintsLoadOnlyForPromptRouting();
testWorkflowTelemetry();
testCompletionClaimsDoNotUseRegex();
testStopDoesNotSuggestKnowledgeCapture();

console.log('[OK] Codex hook router behavior verified');
