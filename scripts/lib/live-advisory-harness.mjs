// Shared harness for the live advice tests: hook routers for both hosts, a
// temporary Git repository with one already-dirty file, and a runner for one
// PreToolUse / shell / PostToolUse tool call.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
);
export const routers = {
  claude: path.join(repoDir, 'hooks/scripts/hooks/hook-router.js'),
  codex: path.join(repoDir, 'codex/hooks/hook-router.js'),
};
export const CONFLICT = '<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> branch\n';
// Assembled at runtime so this source never contains a token-shaped literal.
export const FAKE_TOKEN = ['gh', 'p_', 'A'.repeat(36)].join('');
export const tmpDir = fs.mkdtempSync(
  path.join(os.tmpdir(), 'goldband-live-style-'),
);

process.on('exit', () => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

export function createRepo() {
  const dir = fs.mkdtempSync(path.join(tmpDir, 'repo-'));
  git(dir, ['init', '--quiet']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'Test']);
  fs.writeFileSync(path.join(dir, 'tracked.md'), 'clean\n');
  fs.writeFileSync(path.join(dir, 'app.ts'), 'export const value = 1;\n');
  git(dir, ['add', '.']);
  git(dir, ['commit', '--quiet', '-m', 'init']);
  // Dirty before every command: must never be re-reported by later commands.
  fs.writeFileSync(path.join(dir, 'already-dirty.md'), CONFLICT);
  return dir;
}

export function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}

export function hookEnv(extra = {}) {
  return {
    ...process.env,
    GOLDBAND_DATA_DIR: path.join(tmpDir, 'data'),
    GOLDBAND_USAGE_FILE: path.join(tmpDir, 'usage.jsonl'),
    CLAUDE_PLUGIN_DATA: path.join(tmpDir, 'plugin-data'),
    GOLDBAND_STYLE_SNAPSHOT_DIR: path.join(tmpDir, 'snapshots'),
    GOLDBAND_GIT_HOOKS_DIR: path.join(tmpDir, 'no-style-gate'),
    ...extra,
  };
}

export function runRouter(router, cwd, input, env = {}) {
  return spawnSync(process.execPath, [router], {
    cwd,
    input: JSON.stringify({ session_id: 'live-style', ...input }),
    encoding: 'utf8',
    env: hookEnv(env),
  });
}

export function contextOf(result) {
  assert.notEqual(result.status, null, result.stderr);
  if (!result.stdout.trim()) return '';
  return JSON.parse(result.stdout).hookSpecificOutput?.additionalContext || '';
}

// Runs PreToolUse, the real shell command, then PostToolUse for one tool call.
export function runShellTool(host, cwd, command, toolUseId) {
  const input = {
    tool_name: 'Bash',
    tool_use_id: toolUseId,
    tool_input: { command },
  };
  const pre = runRouter(routers[host], cwd, {
    ...input,
    hook_event_name: 'PreToolUse',
  });
  assert.equal(pre.status, 0, pre.stderr);
  const shell = spawnSync('bash', ['-c', command], { cwd, encoding: 'utf8' });
  assert.equal(shell.status, 0, shell.stderr);
  return contextOf(
    runRouter(routers[host], cwd, { ...input, hook_event_name: 'PostToolUse' }),
  );
}

export function snapshotFiles() {
  const snapshots = path.join(tmpDir, 'snapshots');
  return fs.existsSync(snapshots) ? fs.readdirSync(snapshots) : [];
}
