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
  console.log(
    `[OK] ${mode} install preserves shared hook policy in a temporary HOME`,
  );
}
