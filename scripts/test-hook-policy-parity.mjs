#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import secretPatterns from '../hooks/scripts/lib/hook-router/secret-patterns.js';
import {
  shellAnalysisFailureCases,
  shellPolicyCases,
} from './fixtures/shell-policy-cases.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'goldband-hook-parity-'));
const routers = {
  claude:
    process.argv[2] || path.join(root, 'hooks/scripts/hooks/hook-router.js'),
  codex: process.argv[3] || path.join(root, 'codex/hooks/hook-router.js'),
};
process.on('exit', () => fs.rmSync(dataDir, { recursive: true, force: true }));

function run(host, input, extraEnv = {}) {
  const result = spawnSync(process.execPath, [routers[host]], {
    input: JSON.stringify({ hook_event_name: 'PreToolUse', ...input }),
    encoding: 'utf8',
    timeout: 5000,
    cwd: root,
    env: {
      ...process.env,
      GOLDBAND_DATA_DIR: dataDir,
      CLAUDE_PLUGIN_DATA: dataDir,
      ...extraEnv,
    },
  });
  if (host === 'claude') {
    assert.ok([0, 2].includes(result.status), result.stderr);
    return {
      decision: result.status === 2 ? 'block' : 'allow',
      message: result.stderr,
    };
  }
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout).hookSpecificOutput || {};
  return {
    decision:
      output.permissionDecision === 'deny' ||
      output.decision?.behavior === 'deny'
        ? 'block'
        : 'allow',
    message:
      output.permissionDecisionReason ||
      output.decision?.message ||
      output.additionalContext ||
      '',
  };
}

function patch(file, content) {
  return [
    '*** Begin Patch',
    `*** Add File: ${file}`,
    ...content.split('\n').map((line) => `+${line}`),
    '*** End Patch',
  ].join('\n');
}

function assertWriteParity(file, content, expected, name = null) {
  const claude = run('claude', {
    tool_name: 'Write',
    tool_input: { file_path: file, content },
  });
  const codex = run('codex', {
    tool_name: 'apply_patch',
    tool_input: { command: patch(file, content) },
  });
  for (const result of [claude, codex]) {
    assert.equal(result.decision, expected, `${file}: ${result.message}`);
    if (name) assert.ok(result.message.includes(name), result.message);
  }
  assert.equal(claude.message.replace(/^\[Hook\] /, '').trim(), codex.message);
}

const fixtureSource = fs.readFileSync(
  path.join(root, 'hooks/fixtures/router/replay-fixtures.json'),
  'utf8',
);
assert.deepEqual(
  secretPatterns.detectSecrets(fixtureSource),
  [],
  'Synthetic secret fixtures must not contain complete token signatures in source',
);
const fixtures = JSON.parse(fixtureSource);
const secrets = fixtures.filter(
  (item) => item.coverage.category === 'secret-patterns',
);
assert.ok(secrets.length >= 34);
for (const fixture of secrets) {
  const { file_path: file } = fixture.input.tool_input;
  const content =
    fixture.input.tool_input.content ?? fixture.input.tool_input.new_string;
  assertWriteParity(
    file,
    content,
    fixture.coverage.expectedDecision,
    fixture.coverage.variant === 'positive' ? fixture.coverage.policy : null,
  );
}

for (const file of [
  'notes/new.md',
  'docs/guide.md',
  '/tmp/project/docs/guide.md',
  'notes/existing.txt',
]) {
  assertWriteParity(file, '# Requested documentation', 'allow');
}
for (const file of [
  'fixtures/token.ts',
  '__tests__/token.ts',
  '__mocks__/token.ts',
  'token.test.ts',
  '.env.example',
  'src/token.ts',
]) {
  assertWriteParity(file, 'ghp_' + 'a'.repeat(36), 'block', 'GitHub Token');
  assertWriteParity(file, 'process.env.GITHUB_TOKEN', 'allow');
}
for (const command of [
  'npm run dev',
  'pnpm dev',
  'yarn dev',
  'bun run dev',
  'tmux new-session -d "npm run dev"',
]) {
  for (const host of Object.keys(routers)) {
    assert.deepEqual(
      run(host, { tool_name: 'Bash', tool_input: { command } }),
      { decision: 'allow', message: '' },
    );
  }
}

const token = 'ghp_' + 'b'.repeat(36);
const cleanup = [
  '*** Begin Patch',
  '*** Update File: src/key.ts',
  '@@',
  `-${token}`,
  '+process.env.KEY',
  '*** End Patch',
].join('\n');
assert.equal(
  run('codex', { tool_name: 'apply_patch', tool_input: { command: cleanup } })
    .decision,
  'allow',
);
assert.equal(
  run('claude', {
    tool_name: 'Edit',
    tool_input: {
      file_path: 'src/key.ts',
      old_string: token,
      new_string: 'process.env.KEY',
    },
  }).decision,
  'allow',
);
assert.equal(
  run('claude', {
    tool_name: 'MultiEdit',
    tool_input: { file_path: 'src/key.ts', edits: [{ new_string: token }] },
  }).decision,
  'block',
);
assert.equal(
  run('codex', {
    tool_name: 'apply_patch',
    tool_input: {
      command:
        patch('safe.ts', 'safe') + '\n' + patch('fixtures/key.ts', token),
    },
  }).decision,
  'block',
);
console.log(
  `[OK] Shared hook policy parity: ${secrets.length} secret cases, document/server guidance, fixture paths, and credential cleanup`,
);

const carefulState = path.join(dataDir, 'careful.json');
fs.writeFileSync(
  carefulState,
  JSON.stringify({ modes: { 'careful-mode': { active: true } } }),
);
for (const hook_event_name of ['PreToolUse', 'PermissionRequest']) {
  for (const command of [
    'env',
    '/usr/bin/env',
    'env MODE=test',
    'cat < ~/.aws/credentials',
    'cat < ~/.netrc',
    "bash <<< 'git reset --hard HEAD'",
  ]) {
    assert.equal(
      run('codex', {
        hook_event_name,
        tool_name: 'Bash',
        tool_input: { command },
      }).decision,
      'block',
      command,
    );
  }
  for (const command of [
    'command -v sudo',
    'env MODE=test git status',
    'cat < package.json',
    "cat <<< 'git reset --hard HEAD'",
  ]) {
    assert.equal(
      run('codex', {
        hook_event_name,
        tool_name: 'Bash',
        tool_input: { command },
      }).decision,
      'allow',
      command,
    );
  }
}
for (const [command, decision] of [
  ["bash <<< 'git reset --hard HEAD'", 'block'],
  ['sudo rm -rf /', 'block'],
  ["cat <<< 'git reset --hard HEAD'", 'allow'],
  ['command -v sudo', 'allow'],
]) {
  assert.equal(
    run(
      'claude',
      { tool_name: 'Bash', tool_input: { command } },
      { HOOK_ROUTER_MODE_STATE_FILE: carefulState },
    ).decision,
    decision,
    command,
  );
}
console.log(
  '[OK] Native hook adapters preserve shell data and execution boundaries',
);

for (const client of ['psql', 'mysql']) {
  for (const [sql, decision] of [
    ['DROP TABLE users;', 'block'],
    ['SELECT 1;', 'allow'],
  ]) {
    for (const command of [
      `${client} <<'SQL'\n${sql}\nSQL`,
      `${client} <<< '${sql}'`,
    ]) {
      assert.equal(
        run(
          'claude',
          { tool_name: 'Bash', tool_input: { command } },
          { HOOK_ROUTER_MODE_STATE_FILE: carefulState },
        ).decision,
        decision,
        command,
      );
    }
  }
}
for (const action of ['-exec', '-execdir']) {
  for (const [child, decision] of [
    ['git reset --hard HEAD', 'block'],
    ['git status', 'allow'],
  ]) {
    const command = `find README.md -exec true \\; ${action} ${child} \\;`;
    for (const hook_event_name of ['PreToolUse', 'PermissionRequest']) {
      assert.equal(
        run('codex', {
          hook_event_name,
          tool_name: 'Bash',
          tool_input: { command },
        }).decision,
        decision,
        command,
      );
    }
    assert.equal(
      run(
        'claude',
        { tool_name: 'Bash', tool_input: { command } },
        { HOOK_ROUTER_MODE_STATE_FILE: carefulState },
      ).decision,
      decision,
      command,
    );
  }
}
console.log('[OK] Native hooks check SQL stdin and multiple find actions');

for (const [command, codex, careful] of shellPolicyCases) {
  for (const hook_event_name of ['PreToolUse', 'PermissionRequest']) {
    assert.equal(
      run('codex', {
        hook_event_name,
        tool_name: 'Bash',
        tool_input: { command },
      }).decision,
      codex ? 'block' : 'allow',
      command,
    );
  }
  assert.equal(
    run(
      'claude',
      {
        tool_name: 'Bash',
        tool_input: { command },
      },
      { HOOK_ROUTER_MODE_STATE_FILE: carefulState },
    ).decision,
    careful ? 'block' : 'allow',
    command,
  );
}
console.log(
  `[OK] ${shellPolicyCases.length} shell regressions through both native hook adapters`,
);

const inactiveState = path.join(dataDir, 'inactive.json');
fs.writeFileSync(inactiveState, JSON.stringify({ modes: {} }));
for (const [name, command] of shellAnalysisFailureCases) {
  for (const hook_event_name of ['PreToolUse', 'PermissionRequest']) {
    const result = run('codex', {
      hook_event_name,
      tool_name: 'Bash',
      tool_input: { command },
    });
    assert.equal(result.decision, 'block', name);
    assert.match(result.message, /Unable to analyze/, name);
  }
  const input = { tool_name: 'Bash', tool_input: { command } };
  const active = run('claude', input, {
    HOOK_ROUTER_MODE_STATE_FILE: carefulState,
  });
  assert.equal(active.decision, 'block', name);
  assert.match(active.message, /Unable to analyze/, name);
  assert.equal(
    run('claude', input, { HOOK_ROUTER_MODE_STATE_FILE: inactiveState })
      .decision,
    'allow',
    name,
  );
}
console.log(
  '[OK] Analysis failures return native denial; inactive careful mode stays inactive',
);
