import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = process.cwd();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'goldband-guidance-'));
try {
  const claude = path.join(tmp, '.claude');
  fs.mkdirSync(claude);
  const config = JSON.parse(fs.readFileSync('hooks/hooks.json', 'utf8'));
  const expanded = JSON.parse(
    JSON.stringify(config.hooks).replaceAll('${HOOKS_DIR}', `${claude}/hooks`),
  );
  const router = expanded.PreToolUse[0].hooks[0];
  const external = { type: 'command', command: 'echo user-hook' };
  const retired = JSON.parse(
    fs.readFileSync('hooks/claude-retired-hooks.json', 'utf8'),
  );
  const oldCommands = retired.commands.map((command) => ({
    type: 'command',
    command: command.replaceAll('${HOOKS_DIR}', `${claude}/hooks`),
  }));
  const existing = {
    SessionStart: [{ hooks: [router, external] }],
    CustomEvent: [{ hooks: [external] }],
    SubagentStop: [{ hooks: [{ type: 'prompt', prompt: retired.prompts[0] }] }],
    PostToolUse: [{ matcher: 'Edit', hooks: oldCommands }],
  };
  function merge(value, newHooks = expanded, mode = 'install') {
    const result = spawnSync(
      'bash',
      [
        '-c',
        'source shell/install/profiles.sh; merge_claude_hooks_json "$1" "$2" "$3"',
        'test',
        JSON.stringify(value),
        JSON.stringify(newHooks),
        mode,
      ],
      {
        cwd: root,
        env: { ...process.env, REPO_DIR: root, CLAUDE_DIR: claude },
        encoding: 'utf8',
      },
    );
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  }
  const merged = merge(existing);
  assert.deepEqual(merged.SessionStart, [{ hooks: [external] }]);
  assert.deepEqual(merged.CustomEvent, existing.CustomEvent);
  assert.deepEqual(merged.SubagentStop, expanded.SubagentStop);
  assert.deepEqual(merged.PostToolUse, expanded.PostToolUse);
  assert.deepEqual(merge(merged), merged, 'reinstallation must be idempotent');
  // Retiring removes only retired commands; user hooks, current hooks, retired
  // prompts (replaced only by a hooks install), and empty entries stay.
  const emptyEntry = { matcher: 'Write', hooks: [] };
  assert.deepEqual(
    merge(
      { ...existing, PostToolUse: [...existing.PostToolUse, emptyEntry] },
      {},
      'retire',
    ),
    {
      SessionStart: existing.SessionStart,
      CustomEvent: existing.CustomEvent,
      SubagentStop: existing.SubagentStop,
      PostToolUse: [emptyEntry],
    },
  );
  assert.match(expanded.SubagentStop[0].hooks[0].prompt, /"ok": true/);
  assert.match(
    expanded.SubagentStop[0].hooks[0].prompt,
    /"ok": false, "reason"/,
  );
  // Without jq, a retired command left in settings.json is reported, not
  // silently kept, by both the skipped-refresh cleanup and a hooks install.
  const nodeOnly = path.join(tmp, 'node-only-bin');
  fs.mkdirSync(nodeOnly);
  fs.symlinkSync(process.execPath, path.join(nodeOnly, 'node'));
  const settingsFile = path.join(claude, 'settings.json');
  function runSettings(settings, command, PATH = nodeOnly) {
    fs.writeFileSync(settingsFile, settings);
    return spawnSync(
      '/bin/bash',
      [
        '-c',
        `source shell/install/common.sh; source shell/install/profiles.sh; ${command}`,
      ],
      {
        cwd: root,
        env: { PATH, REPO_DIR: root, CLAUDE_DIR: claude },
        encoding: 'utf8',
      },
    );
  }
  // The cleanup fails so auto-refresh records it; an install (under `set -e`)
  // prints the hint and continues with its other components.
  for (const [command, status] of [
    ['retire_claude_hooks', 1],
    ['set -e; merge_hooks_config; echo continued', 0],
    ['GOLDBAND_AUTO_REFRESH=1 merge_hooks_config', 1],
  ]) {
    const stale = runSettings(JSON.stringify({ hooks: existing }), command);
    assert.equal(stale.status, status, `${command} ${stale.stderr}`);
    assert.match(stale.stdout, /claude-retired-hooks\.json/);
    const current = runSettings(JSON.stringify({ hooks: merged }), command);
    assert.equal(current.status, 0, `${command} ${current.stderr}`);
  }
  assert.match(
    runSettings(
      JSON.stringify({ hooks: existing }),
      'set -e; merge_hooks_config; echo continued',
    ).stdout,
    /continued/,
  );
  // jq alone decides retirement; node is not required.
  const jqOnlyBin = path.join(tmp, 'jq-only-bin');
  fs.mkdirSync(jqOnlyBin);
  for (const tool of ['jq', 'mktemp', 'cmp', 'cp', 'mv', 'rm']) {
    const resolved = spawnSync('/bin/sh', ['-c', `command -v ${tool}`], {
      encoding: 'utf8',
    }).stdout.trim();
    assert.ok(resolved, `${tool} must be installed`);
    fs.symlinkSync(resolved, path.join(jqOnlyBin, tool));
  }
  const jqOnly = runSettings(
    JSON.stringify({ hooks: existing }),
    'retire_claude_hooks',
    jqOnlyBin,
  );
  assert.equal(jqOnly.status, 0, jqOnly.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(settingsFile, 'utf8')).hooks, {
    SessionStart: existing.SessionStart,
    CustomEvent: existing.CustomEvent,
    SubagentStop: existing.SubagentStop,
  });
  // With nothing retired, settings.json is left byte-for-byte unchanged.
  for (const settings of [
    '',
    '{"model": "x"}',
    '{"hooks": {"Notification": []}}',
    '{"hooks": {"PostToolUse": [{"matcher": "Edit", "hooks": []}]}}',
  ]) {
    const result = runSettings(
      settings,
      'retire_claude_hooks',
      process.env.PATH,
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.readFileSync(settingsFile, 'utf8'), settings);
  }
  fs.rmSync(settingsFile);

  const legacy = path.join(claude, 'rules');
  function retire() {
    const result = spawnSync(
      'bash',
      [
        '-c',
        `source shell/install/profiles.sh
repo_link_points_to() { [ -L "$1" ] && [ "$(readlink "$1")" = "$2" ]; }
retire_claude_rule_autoload`,
      ],
      {
        cwd: root,
        env: { ...process.env, REPO_DIR: root, CLAUDE_DIR: claude },
        encoding: 'utf8',
      },
    );
    assert.equal(result.status, 0, result.stderr);
  }
  fs.symlinkSync(path.join(root, 'rules'), legacy);
  retire();
  assert.equal(fs.existsSync(legacy), false);
  fs.mkdirSync(legacy);
  fs.copyFileSync('rules/security.md', path.join(legacy, 'security.md'));
  fs.writeFileSync(path.join(legacy, 'change-scope.md'), 'customized policy');
  fs.writeFileSync(path.join(legacy, 'personal.md'), 'personal policy');
  // A known previous managed version must retire even after the source changes.
  const fixtureRepo = path.join(tmp, 'fixture');
  fs.mkdirSync(path.join(fixtureRepo, 'shell/install'), { recursive: true });
  fs.symlinkSync(path.join(root, 'rules'), path.join(fixtureRepo, 'rules'));
  const oldContent = 'previous managed policy';
  fs.writeFileSync(path.join(legacy, 'escalation.md'), oldContent);
  fs.writeFileSync(
    path.join(fixtureRepo, 'shell/install/retired-rule-hashes.json'),
    JSON.stringify({
      'escalation.md': [createHash('sha256').update(oldContent).digest('hex')],
    }),
  );
  const migration = spawnSync(
    'bash',
    [
      '-c',
      `source shell/install/profiles.sh
repo_link_points_to() { [ -L "$1" ] && [ "$(readlink "$1")" = "$2" ]; }
retire_claude_rule_autoload`,
    ],
    {
      cwd: root,
      env: { ...process.env, REPO_DIR: fixtureRepo, CLAUDE_DIR: claude },
      encoding: 'utf8',
    },
  );
  assert.equal(migration.status, 0, migration.stderr);
  assert.equal(fs.existsSync(path.join(legacy, 'escalation.md')), false);

  retire();
  assert.equal(fs.existsSync(path.join(legacy, 'security.md')), false);
  assert.equal(
    fs.readFileSync(path.join(legacy, 'change-scope.md'), 'utf8'),
    'customized policy',
  );
  assert.equal(
    fs.readFileSync(path.join(legacy, 'personal.md'), 'utf8'),
    'personal policy',
  );
  console.log(
    '[OK] hook migration, idempotency, JSON response contract and rule preservation',
  );
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
