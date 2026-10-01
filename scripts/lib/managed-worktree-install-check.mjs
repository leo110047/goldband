import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export function assertInstalledManagedWorktreeSurface(home) {
  for (const host of ['.claude', '.codex']) {
    const binary = path.join(
      home,
      host,
      'skills',
      'goldband',
      'bin',
      'goldband',
    );
    const result = spawnSync(binary, ['--help'], {
      encoding: 'utf8',
      env: { ...process.env, HOME: home },
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /goldband review code \[--semantic-only\]/);
    assert.match(result.stdout, /resolved automatically/);
    assert.match(result.stdout, /Advanced: --host <claude\|codex>/);
    assert.match(result.stdout, /goldband worktree create <name>/);
    assert.match(result.stdout, /goldband worktree finish <name>/);
  }

  const launcher = fs.readFileSync(
    path.join(home, '.claude', 'shell', 'goldband-launchers.sh'),
    'utf8',
  );
  assert.match(launcher, /^goldband\(\) \{/m);
  assert.match(launcher, /\.codex\/goldband\/workflow-runtime\/bin\/goldband/);
  assert.match(launcher, /\.claude\/skills\/goldband\/bin\/goldband/);
  assertShellRuntimeSelection(home);
}

function assertShellRuntimeSelection(home) {
  for (const [host, context] of [
    ['.codex', { CODEX_THREAD_ID: 'fixture', CLAUDECODE: '' }],
    ['.claude', { CLAUDECODE: '1', CODEX_THREAD_ID: '' }],
  ]) {
    const expected =
      host === '.codex'
        ? path.join(
            home,
            '.codex',
            'goldband',
            'workflow-runtime',
            'bin',
            'goldband',
          )
        : path.join(home, '.claude', 'skills', 'goldband', 'bin', 'goldband');
    const selected = spawnSync(
      'bash',
      [
        '-c',
        'source "$1"; _goldband_runtime_bin',
        'goldband-test',
        path.join(home, '.claude', 'shell', 'goldband-launchers.sh'),
      ],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          HOME: home,
          ...context,
          CLAUDE_PLUGIN_ROOT: '',
          CODEX_HOME: '',
          GOLDBAND_SHELL_LAUNCHERS_LOADED: '',
        },
      },
    );
    assert.equal(selected.status, 0, selected.stderr);
    assert.equal(selected.stdout.trim(), expected);
  }
}
