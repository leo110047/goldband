#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'goldband-mode-cli-'));
const SESSION = 'mode-cli-test';

try {
  for (const modeName of ['careful-mode', 'freeze-mode']) {
    verifyMissingStateIsInactive(modeName);
    verifyCorruptStateFails(modeName);
    verifyUnreadableStateFails(modeName);
    verifyEnableRoundTrip(modeName);
    verifySessionComesFromHost(modeName);
  }
  verifyFailedWriteLeavesNoTempFile();
  console.log('[OK] mode CLI state handling');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}

function stateFile(name) {
  return path.join(temp, `${name}.json`);
}

function spawnMode(modeName, args, env) {
  return spawnSync(
    process.execPath,
    [
      path.join(root, 'skills/global', modeName, 'scripts', `${modeName}.js`),
      ...args,
      '--json',
    ],
    { env, encoding: 'utf8' },
  );
}

function runMode(modeName, file, action) {
  return spawnMode(modeName, [action, '--session', SESSION], {
    ...process.env,
    CLAUDE_PLUGIN_DATA: path.join(temp, 'data'),
    HOOK_ROUTER_MODE_STATE_FILE: file,
  });
}

// The model's Bash carries Claude Code's session id; without --session the
// script must write the file the hooks read for that session.
function verifySessionComesFromHost(modeName) {
  const data = path.join(temp, `host-${modeName}`);
  const env = {
    ...process.env,
    CLAUDE_PLUGIN_DATA: data,
    CLAUDE_CODE_SESSION_ID: 'host-session',
  };
  delete env.HOOK_ROUTER_MODE_STATE_FILE;
  const result = spawnMode(modeName, ['enable'], env);
  assert.equal(result.status, 0, result.stderr);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.sessionId, 'host-session');
  assert.equal(
    summary.stateFile,
    path.join(data, 'hook-router/modes/session-host-session.json'),
  );
  assert.ok(fs.existsSync(summary.stateFile));

  // A caller that still exports CLAUDE_SESSION_ID names the same session.
  const legacyEnv = { ...env, CLAUDE_SESSION_ID: 'legacy-session' };
  delete legacyEnv.CLAUDE_CODE_SESSION_ID;
  const legacy = JSON.parse(spawnMode(modeName, ['status'], legacyEnv).stdout);
  assert.equal(legacy.sessionId, 'legacy-session');
}

function verifyMissingStateIsInactive(modeName) {
  const result = runMode(modeName, stateFile(`${modeName}-missing`), 'status');
  assert.equal(result.status, 0, result.stderr);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.active, false);
  assert.deepEqual(summary.activeModes, []);
}

function verifyCorruptStateFails(modeName) {
  for (const [label, content] of [
    ['truncated', '{"modes": {"careful-mode": {"active": true'],
    ['empty', ''],
    ['array', '[]'],
    ['no-modes', '{"sessionId": "x"}'],
  ]) {
    const file = stateFile(`${modeName}-${label}`);
    fs.writeFileSync(file, content);
    for (const action of ['status', 'enable', 'disable']) {
      const result = runMode(modeName, file, action);
      assert.notEqual(result.status, 0, `${label} ${action} must fail`);
      assert.equal(result.stdout, '', `${label} ${action} must not print JSON`);
      assert.match(result.stderr, /Mode state file/);
      assert.match(result.stderr, /delete it to reset/);
    }
    assert.equal(fs.readFileSync(file, 'utf8'), content, 'state preserved');
  }
}

function verifyUnreadableStateFails(modeName) {
  // A directory at the state path is unreadable as a file on every platform.
  const file = stateFile(`${modeName}-unreadable`);
  fs.mkdirSync(file);
  const result = runMode(modeName, file, 'status');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unable to read mode state file/);
}

function verifyEnableRoundTrip(modeName) {
  const file = stateFile(`${modeName}-roundtrip`);
  const enabled = runMode(modeName, file, 'enable');
  assert.equal(enabled.status, 0, enabled.stderr);
  assert.equal(JSON.parse(enabled.stdout).active, true);
  const status = runMode(modeName, file, 'status');
  assert.deepEqual(JSON.parse(status.stdout).activeModes, [modeName]);
  const disabled = runMode(modeName, file, 'disable');
  assert.equal(JSON.parse(disabled.stdout).active, false);
  const leftovers = fs
    .readdirSync(temp)
    .filter(
      (name) => name.startsWith(path.basename(file)) && name.endsWith('.tmp'),
    );
  assert.deepEqual(leftovers, [], 'atomic writes leave no temp files');
}

// A hook write replaces an unreadable file; when the rename itself fails (here
// a directory holds the state path), the temporary file must not stay behind.
function verifyFailedWriteLeavesNoTempFile() {
  const file = stateFile('rename-fails');
  fs.mkdirSync(file);
  const saved = process.env.HOOK_ROUTER_MODE_STATE_FILE;
  process.env.HOOK_ROUTER_MODE_STATE_FILE = file;
  try {
    const { setModeActive } = createRequire(import.meta.url)(
      path.join(root, 'hooks/scripts/lib/hook-router/mode-state.js'),
    );
    assert.throws(() => setModeActive(SESSION, 'careful-mode', true));
  } finally {
    if (saved === undefined) delete process.env.HOOK_ROUTER_MODE_STATE_FILE;
    else process.env.HOOK_ROUTER_MODE_STATE_FILE = saved;
  }
  const leftovers = fs
    .readdirSync(temp)
    .filter((name) => name.startsWith('rename-fails') && name.endsWith('.tmp'));
  assert.deepEqual(leftovers, [], 'a failed write removes its temp file');
}
