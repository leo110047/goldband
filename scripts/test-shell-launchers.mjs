#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const launcher = path.join(root, 'shell', 'goldband-launchers.sh');
const fixtureRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), 'goldband-launchers-'),
);
const binDir = path.join(fixtureRoot, 'bin');
const claudeRuntime = path.join(
  fixtureRoot,
  '.claude',
  'skills',
  'goldband',
  'bin',
  'goldband',
);
const codexRuntime = path.join(
  fixtureRoot,
  '.codex',
  'goldband',
  'workflow-runtime',
  'bin',
  'goldband',
);
const cliArgs = ['--fixture', 'two words', '', 'literal;*'];
const shells = [
  { name: 'bash', command: bashCommand(), flags: ['--noprofile', '--norc'] },
  { name: 'zsh', command: 'zsh', flags: ['-f'] },
];

function bashCommand() {
  if (process.platform !== 'win32') return 'bash';
  return (
    process.env.GOLDBAND_TEST_BASH || 'C:\\Program Files\\Git\\bin\\bash.exe'
  );
}

function executable(file, name, exitCode) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    `#!/bin/sh\nprintf '%s\\n' '${name}'\nprintf '<%s>\\n' "$@"\nexit ${exitCode}\n`,
    { mode: 0o755 },
  );
}

function fixtureEnv(context = {}) {
  return {
    ...process.env,
    HOME: fixtureRoot,
    PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
    BASH_ENV: '',
    ENV: '',
    ZDOTDIR: fixtureRoot,
    CLAUDECODE: '',
    CLAUDE_PLUGIN_ROOT: '',
    CODEX_THREAD_ID: '',
    CODEX_HOME: '',
    GOLDBAND_SHELL_LAUNCHERS_LOADED: '',
    GOLDBAND_SELF_UPDATE_BIN: path.join(binDir, 'updater'),
    ...context,
  };
}

function run(shell, script, args, context) {
  const result = spawnSync(
    shell.command,
    [...shell.flags, '-c', script, 'launcher-test', ...args],
    { env: fixtureEnv(context), encoding: 'utf8' },
  );
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  return result;
}

function snapshot(shell) {
  // Versioned regression fixture for Claude Code 2.1.296's name filter.
  // This does not verify snapshot generation by the currently installed CLI.
  const list =
    shell.name === 'zsh' ? 'typeset +f' : "declare -F | cut -d' ' -f3";
  const declare = shell.name === 'zsh' ? 'typeset -f' : 'declare -f';
  const result = run(
    shell,
    `
source "$1"
${list} | grep -vE '^_[^_]' | while read -r func; do
  ${declare} "$func"
done
`,
    [launcher],
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  const file = path.join(fixtureRoot, `${shell.name}-snapshot.sh`);
  fs.writeFileSync(file, result.stdout);
  return file;
}

function assertInvocation(shell, source, testCase) {
  const result = run(
    shell,
    'source "$1"; shift; "$@"',
    [source, testCase.command, ...cliArgs],
    testCase.context,
  );
  assert.equal(result.status, testCase.exitCode, result.stderr);
  assert.equal(result.stderr, '');
  const expected = [
    ...(testCase.command === 'goldband'
      ? []
      : ['update', `<${testCase.command}>`]),
    testCase.target,
    ...cliArgs.map((arg) => `<${arg}>`),
    '',
  ].join('\n');
  assert.equal(result.stdout, expected);
}

function writeRuntimes() {
  executable(claudeRuntime, 'claude-runtime', 29);
  executable(codexRuntime, 'codex-runtime', 23);
}

function assertRuntimeUnavailable(shell, source, context = {}) {
  const result = run(
    shell,
    'source "$1"; goldband --fixture',
    [source],
    context,
  );
  assert.equal(result.status, 127, result.stderr);
  assert.equal(result.stdout, '');
  assert.equal(
    result.stderr,
    'goldband: workflow runtime is not installed; run ./install.sh workflow-auto\n',
  );
}

function testMissingRuntimes(shell, source) {
  fs.rmSync(codexRuntime);
  // CODEX_HOME alone must select Codex, even when Claude's runtime is available.
  assertRuntimeUnavailable(shell, source, { CODEX_HOME: fixtureRoot });
  fs.rmSync(claudeRuntime);
  assertRuntimeUnavailable(shell, source);
  writeRuntimes();
}

function testShell(shell) {
  const cases = [
    { command: 'claude', target: 'claude', exitCode: 17 },
    { command: 'codex', target: 'codex', exitCode: 19 },
    { command: 'goldband', target: 'codex-runtime', exitCode: 23 },
    {
      command: 'goldband',
      target: 'codex-runtime',
      exitCode: 23,
      context: { CODEX_THREAD_ID: 'fixture' },
    },
    {
      command: 'goldband',
      target: 'codex-runtime',
      exitCode: 23,
      context: { CODEX_HOME: fixtureRoot },
    },
    {
      command: 'goldband',
      target: 'claude-runtime',
      exitCode: 29,
      context: { CLAUDECODE: '1' },
    },
    {
      command: 'goldband',
      target: 'claude-runtime',
      exitCode: 29,
      context: { CLAUDE_PLUGIN_ROOT: fixtureRoot },
    },
  ];
  for (const source of [launcher, snapshot(shell)]) {
    for (const testCase of cases) assertInvocation(shell, source, testCase);
    testMissingRuntimes(shell, source);
  }
  console.log(
    `[OK] ${shell.name}: direct and fixture-restored launcher behavior`,
  );
}

try {
  executable(path.join(binDir, 'claude'), 'claude', 17);
  executable(path.join(binDir, 'codex'), 'codex', 19);
  // An optional updater failure must not swallow the CLI's exit status.
  executable(path.join(binDir, 'updater'), 'update', 7);
  writeRuntimes();
  for (const shell of shells) {
    const available = spawnSync(shell.command, ['--version']);
    if (shell.name === 'zsh' && available.error?.code === 'ENOENT') {
      assert.ok(
        !process.env.CI,
        'zsh is required in CI; install zsh before running launcher tests',
      );
      console.log(
        '[SKIP] zsh is unavailable; bash snapshot coverage still runs',
      );
      continue;
    }
    assert.ifError(available.error);
    assert.equal(available.status, 0);
    testShell(shell);
  }
} finally {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
}
