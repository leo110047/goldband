#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'goldband-plugin-status-'));

try {
  const withMod = runStatus('with-mod', {
    readFromFolder: path.join(root, 'plugin-assets/claude-code-plugin'),
  });
  assert.match(withMod.stdout, /\[OK\].* Claude mod/);
  assert.equal(withMod.status, 0, withMod.stdout);

  // An empty installPath must not shift the fields after it.
  const noInstallPath = statusFor('no-install-path', {
    readFromFolder: path.join(root, 'plugin-assets/claude-code-plugin'),
    installPath: '',
  });
  assert.match(noInstallPath, /\[OK\].* Claude mod/);

  // A disabled install listed first (another project's) does not hide the
  // enabled one.
  const disabledFirst = runStatus(
    'disabled-first',
    { readFromFolder: path.join(root, 'plugin-assets/claude-code-plugin') },
    [
      {
        id: 'goldband@goldband',
        version: '0.0.9',
        enabled: false,
        scope: 'project',
      },
    ],
  );
  assert.match(
    disabledFirst.stdout,
    /\[OK\] goldband@goldband plugin \(0\.1\.0\)/,
  );

  const oldPlugin = path.join(temp, 'old-plugin');
  fs.mkdirSync(path.join(oldPlugin, 'hooks'), { recursive: true });
  fs.writeFileSync(path.join(oldPlugin, 'hooks/hooks.json'), '{"hooks":{}}');
  const withoutMod = statusFor('without-mod', { installPath: oldPlugin });
  assert.match(withoutMod, /\[缺少\].* Claude mod/);

  // A declared module that is missing, or an unreadable hooks.json, is a
  // broken install: reported as an error and reflected in the exit code.
  for (const [label, hooksJson] of [
    ['missing-module', '{"modules":["./mod/register.ts"]}'],
    ['unreadable-hooks', '{"modules":'],
  ]) {
    const broken = path.join(temp, `${label}-plugin`);
    fs.mkdirSync(path.join(broken, 'hooks'), { recursive: true });
    fs.writeFileSync(path.join(broken, 'hooks/hooks.json'), hooksJson);
    const result = runStatus(label, { installPath: broken });
    assert.match(result.stdout, /\[錯誤\].* Claude mod/, label);
    assert.equal(result.status, 2, label);
  }
  console.log('[OK] Claude plugin status reports the mod');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}

function statusFor(name, location) {
  return runStatus(name, location).stdout;
}

// Runs `install.sh status` with a fake `claude` that lists a goldband plugin
// after any `listedBefore` entries.
function runStatus(name, location, listedBefore = []) {
  const home = path.join(temp, name);
  const bin = path.join(home, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  const listed = JSON.stringify([
    ...listedBefore,
    {
      id: 'goldband@goldband',
      version: '0.1.0',
      enabled: true,
      installPath: location.installPath ?? path.join(home, 'cache'),
      ...location,
    },
  ]);
  fs.writeFileSync(
    path.join(bin, 'claude'),
    `#!/bin/sh\nif [ "$1 $2" = "plugin list" ]; then printf '%s' '${listed}'; fi\n`,
    { mode: 0o755 },
  );
  const result = spawnSync('./install.sh', ['status'], {
    cwd: root,
    env: {
      ...process.env,
      HOME: home,
      PATH: `${bin}${path.delimiter}${process.env.PATH}`,
    },
    encoding: 'utf8',
  });
  return {
    status: result.status,
    stdout: result.stdout.replace(/\x1b\[[0-9;]*m/g, ''),
  };
}
