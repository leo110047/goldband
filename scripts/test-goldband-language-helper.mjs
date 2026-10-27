#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const helper = path.join(root, 'commands/scripts/set-goldband-language.sh');
const realConfig = path.join(root, 'goldband-loop/bin/goldband-config');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'goldband-language-'));

try {
  verifyUnsetDefaultsToZhTw();
  verifySetReadsBack();
  verifyEveryAliasNormalizes();
  verifyUnsupportedExitsTwo();
  verifyGetFailureIsError();
  verifySetReadbackFailureIsError();
  verifySetReadbackMismatchIsError();
  verifySetWriteFailureIsError();
  verifyMissingConfigExitsThree();
  console.log('[OK] goldband language helper');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}

// The helper prefers ~/.claude/skills/goldband/bin/goldband-config, so each
// case installs a config binary there under its own HOME.
function makeHome(name, configScript) {
  const home = path.join(temp, name);
  const bin = path.join(home, '.claude/skills/goldband/bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, 'goldband-config'), configScript, {
    mode: 0o755,
  });
  return home;
}

function realConfigHome(name) {
  return makeHome(
    name,
    `#!/usr/bin/env bash\nGOLDBAND_HOME="$HOME/.goldband" exec "${realConfig}" "$@"\n`,
  );
}

// Delegates to the real config binary except for the listed failing calls.
function failingConfigHome(name, failingCall) {
  return makeHome(
    name,
    [
      '#!/usr/bin/env bash',
      `if [ "$1 $2" = "${failingCall}" ]; then echo "config read failed" >&2; exit 3; fi`,
      `GOLDBAND_HOME="$HOME/.goldband" exec "${realConfig}" "$@"`,
      '',
    ].join('\n'),
  );
}

function runHelper(home, ...args) {
  return spawnSync('bash', [helper, ...args], {
    env: { ...process.env, HOME: home },
    encoding: 'utf8',
  });
}

function verifyUnsetDefaultsToZhTw() {
  const result = runHelper(realConfigHome('unset'), 'get');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'zh-TW\n');
}

function verifySetReadsBack() {
  const home = realConfigHome('roundtrip');
  for (const [requested, expected] of [
    ['english', 'en'],
    ['繁中', 'zh-TW'],
  ]) {
    const set = runHelper(home, 'set', requested);
    assert.equal(set.status, 0, set.stderr);
    assert.equal(set.stdout, `${expected}\n`);
    assert.equal(runHelper(home, 'get').stdout, `${expected}\n`);
  }
}

function verifyEveryAliasNormalizes() {
  const home = realConfigHome('aliases');
  for (const [alias, expected] of [
    ['zh-TW', 'zh-TW'],
    ['zh', 'zh-TW'],
    ['tw', 'zh-TW'],
    ['中文', 'zh-TW'],
    ['繁中', 'zh-TW'],
    ['en', 'en'],
    ['english', 'en'],
    ['英文', 'en'],
  ]) {
    const set = runHelper(home, 'set', alias);
    assert.equal(set.status, 0, `${alias}: ${set.stderr}`);
    assert.equal(set.stdout, `${expected}\n`, alias);
  }
}

function verifyUnsupportedExitsTwo() {
  const home = realConfigHome('unsupported');
  for (const value of ['fr', '']) {
    const set = runHelper(home, 'set', value);
    assert.equal(set.status, 2, `${value || '<empty>'} must exit 2`);
    assert.match(set.stderr, /unsupported language/);
  }
  assert.equal(runHelper(home, 'get').stdout, 'zh-TW\n', 'value unchanged');
}

function verifyGetFailureIsError() {
  const result = runHelper(
    failingConfigHome('get-fails', 'get goldband_language'),
    'get',
  );
  // The config binary's own exit 3 must not read as "not installed".
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /failed to read goldband_language/);
}

function verifySetReadbackFailureIsError() {
  // zh-TW equals the unset default, so a failed readback must not pass as it.
  const result = runHelper(
    failingConfigHome('readback-fails', 'get goldband_language'),
    'set',
    'zh-TW',
  );
  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, '');
}

function verifySetReadbackMismatchIsError() {
  const home = makeHome(
    'readback-mismatch',
    ['#!/usr/bin/env bash', 'if [ "$1" = "get" ]; then printf en; fi', ''].join(
      '\n',
    ),
  );
  const result = runHelper(home, 'set', 'zh-TW');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /readback is en, expected zh-TW/);
}

function verifySetWriteFailureIsError() {
  const result = runHelper(
    failingConfigHome('write-fails', 'set goldband_language'),
    'set',
    'en',
  );
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /failed to write goldband_language/);
}

function verifyMissingConfigExitsThree() {
  // A copy outside the repo has no repo-local config binary to fall back to.
  const scripts = path.join(temp, 'no-config/plugin/commands/scripts');
  fs.mkdirSync(scripts, { recursive: true });
  const copy = path.join(scripts, path.basename(helper));
  fs.copyFileSync(helper, copy);
  const home = path.join(temp, 'no-config/home');
  fs.mkdirSync(home);
  const result = spawnSync('bash', [copy, 'get'], {
    env: { ...process.env, HOME: home },
    encoding: 'utf8',
  });
  assert.equal(result.status, 3);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /config binary not found/);
}
