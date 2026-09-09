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
  const oldPrompt = JSON.parse(
    fs.readFileSync('hooks/claude-retired-hook-prompts.json', 'utf8'),
  )[0];
  const existing = {
    SessionStart: [{ hooks: [router, external] }],
    CustomEvent: [{ hooks: [external] }],
    SubagentStop: [{ hooks: [{ type: 'prompt', prompt: oldPrompt }] }],
  };
  function merge(value) {
    const result = spawnSync(
      'bash',
      [
        '-c',
        'source shell/install/profiles.sh; merge_claude_hooks_json "$1" "$2"',
        'test',
        JSON.stringify(value),
        JSON.stringify(expanded),
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
  assert.deepEqual(merge(merged), merged, 'reinstallation must be idempotent');
  assert.match(expanded.SubagentStop[0].hooks[0].prompt, /"ok": true/);
  assert.match(
    expanded.SubagentStop[0].hooks[0].prompt,
    /"ok": false, "reason"/,
  );
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
