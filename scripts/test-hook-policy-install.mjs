#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'goldband-hook-install-'));
try {
  for (const mode of ['link', 'copy']) verifyInstall(mode);
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}

function verifyInstall(mode) {
  const home = path.join(temp, mode);
  fs.mkdirSync(home, { recursive: true });
  const env = { ...process.env, HOME: home };
  if (mode === 'copy') {
    const bin = path.join(home, 'test-bin');
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, 'ln'), '#!/bin/sh\nexit 1\n', {
      mode: 0o755,
    });
    env.PATH = `${bin}${path.delimiter}${process.env.PATH}`;
  }
  const install = spawnSync('./install.sh', ['hooks', 'codex-hooks'], {
    cwd: root,
    env,
    encoding: 'utf8',
  });
  assert.equal(install.status, 0, install.stdout + install.stderr);
  const codex = path.join(home, '.codex/hooks');
  assert.equal(fs.lstatSync(codex).isSymbolicLink(), mode === 'link');
  for (const file of [
    'secret-patterns.js',
    'shell-commands.js',
    'shell-policy.js',
    'shell-output.js',
    'shell-invocation.js',
    'style-gate-advisory.js',
  ]) {
    assert.equal(
      fs.readFileSync(path.join(codex, file), 'utf8'),
      fs.readFileSync(
        path.join(root, 'hooks/scripts/lib/hook-router', file),
        'utf8',
      ),
    );
  }
  const replay = spawnSync(
    process.execPath,
    [
      'scripts/test-hook-policy-parity.mjs',
      path.join(home, '.claude/hooks/scripts/hooks/hook-router.js'),
      path.join(codex, 'hook-router.js'),
    ],
    { cwd: root, env, encoding: 'utf8' },
  );
  assert.equal(replay.status, 0, replay.stdout + replay.stderr);
  verifyInstalledStyleAdvisory(home, env, mode);
  console.log(
    `[OK] ${mode} install preserves shared hook policy in a temporary HOME`,
  );
}

// Installed routers must reach the checker: linked installs through the source
// path, copied installs through the Git style gate source record.
function verifyInstalledStyleAdvisory(home, env, mode) {
  const project = path.join(home, 'project');
  fs.mkdirSync(project, { recursive: true });
  const init = spawnSync('git', ['init', '--quiet'], {
    cwd: project,
    encoding: 'utf8',
  });
  assert.equal(init.status, 0, init.stderr);
  fs.writeFileSync(
    path.join(project, 'notes.md'),
    '<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> branch\n',
  );
  // Only copied installs get the source record, so a linked install must find
  // the checker through its own source path.
  const gitHooks = path.join(home, 'git-hooks');
  fs.mkdirSync(gitHooks, { recursive: true });
  if (mode === 'copy') {
    fs.writeFileSync(path.join(gitHooks, '.goldband-source'), `${root}\n`);
  }
  const routers = [
    [path.join(home, '.claude/hooks/scripts/hooks/hook-router.js'), 'Edit'],
    [path.join(home, '.codex/hooks/hook-router.js'), 'apply_patch'],
  ];
  for (const [router, toolName] of routers) {
    const result = spawnSync(process.execPath, [router], {
      cwd: project,
      encoding: 'utf8',
      env: {
        ...env,
        GOLDBAND_DATA_DIR: path.join(home, 'data'),
        GOLDBAND_GIT_HOOKS_DIR: gitHooks,
      },
      input: JSON.stringify({
        hook_event_name: 'PostToolUse',
        tool_name: toolName,
        tool_input:
          toolName === 'Edit'
            ? { file_path: 'notes.md' }
            : { command: '*** Update File: notes.md\n+x' },
      }),
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(
      JSON.parse(result.stdout).hookSpecificOutput.additionalContext,
      /\[merge-conflict\] notes\.md:1/,
      router,
    );
  }
}
