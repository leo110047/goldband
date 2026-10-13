#!/usr/bin/env node

// File selection and secret-scan scope of the checker: the staged gate keeps
// its path exemptions, staged symlinks are checked as themselves, and snapshot
// pruning touches only files the checker wrote.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const checker = path.join(process.cwd(), 'scripts', 'check-code-style.mjs');
// Assembled at runtime so this source never contains a token-shaped literal.
const FAKE_TOKEN = ['gh', 'p_', 'S'.repeat(36)].join('');

const tests = [
  [
    'staged gate exempts fixtures but blocks other secrets',
    testStagedSecretScope,
  ],
  ['a staged symlink is checked as itself', testStagedSymlink],
  [
    'staged style-excluded paths still get the secret scan',
    testStagedExcludedPathSecret,
  ],
  [
    'staged index paths ignore working-tree directory symlinks',
    testStagedPathNotResolved,
  ],
  ['snapshot pruning keeps foreign files', testSnapshotPruneScope],
  ['the secret-only scan skips dependency trees', testDependencyTreeSkipped],
];

for (const [name, test] of tests) {
  test();
  console.log(`ok - ${name}`);
}

function testStagedSecretScope() {
  const dir = createRepo();
  fs.mkdirSync(path.join(dir, 'fixtures'));
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'fixtures', 'x.txt'), `t=${FAKE_TOKEN}\n`);
  git(dir, ['add', 'fixtures/x.txt']);
  assertEqual(staged(dir).status, 0, 'fixture secret must stay exempt');

  fs.writeFileSync(path.join(dir, 'src', 'x.txt'), `t=${FAKE_TOKEN}\n`);
  git(dir, ['add', 'src/x.txt']);
  const result = staged(dir);
  assertEqual(result.status, 1, result.stdout);
  if (!result.stdout.includes('"rule": "secret-scan"')) {
    throw new Error(`missing secret-scan violation\n${result.stdout}`);
  }
}

function testStagedSymlink() {
  const dir = createRepo();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'goldband-outside-'));
  fs.writeFileSync(path.join(outside, 'shared.env'), 'A=1\n');
  fs.symlinkSync(path.join(outside, 'shared.env'), path.join(dir, '.env'));
  git(dir, ['add', '.env']);
  const result = staged(dir);
  assertEqual(result.status, 1, result.stdout);
  if (!result.stdout.includes('"rule": "sensitive-path"')) {
    throw new Error(`staged .env symlink was not checked\n${result.stdout}`);
  }
}

function testStagedExcludedPathSecret() {
  const dir = createRepo();
  fs.mkdirSync(path.join(dir, 'build'));
  fs.writeFileSync(path.join(dir, 'build', 'env.txt'), `t=${FAKE_TOKEN}\n`);
  git(dir, ['add', 'build/env.txt']);
  const result = staged(dir);
  assertEqual(result.status, 1, result.stdout);
  if (!result.stdout.includes('"file": "build/env.txt"')) {
    throw new Error(`build/ secret not reported\n${result.stdout}`);
  }
}

function testStagedPathNotResolved() {
  const dir = createRepo();
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src', 'x.txt'), `t=${FAKE_TOKEN}\n`);
  git(dir, ['add', 'src/x.txt']);
  fs.renameSync(path.join(dir, 'src'), path.join(dir, 'src-real'));
  fs.symlinkSync(path.join(dir, 'src-real'), path.join(dir, 'src'));
  const result = staged(dir);
  assertEqual(result.status, 1, result.stdout);
  if (!result.stdout.includes('"file": "src/x.txt"')) {
    throw new Error(`staged src/x.txt not checked\n${result.stdout}`);
  }
}

function testSnapshotPruneScope() {
  const dir = createRepo();
  const snapshots = fs.mkdtempSync(path.join(os.tmpdir(), 'goldband-snap-'));
  const old = Date.now() / 1000 - 3 * 24 * 60 * 60;
  for (const name of [
    'foreign.txt',
    'settings.json',
    'style-snapshot-old.json',
  ]) {
    fs.writeFileSync(path.join(snapshots, name), 'x');
    fs.utimesSync(path.join(snapshots, name), old, old);
  }
  const result = spawnSync(
    process.execPath,
    [checker, '--worktree', '--snapshot', 'fresh'],
    {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, GOLDBAND_STYLE_SNAPSHOT_DIR: snapshots },
    },
  );
  assertEqual(result.status, 0, result.stderr);
  assertEqual(fs.existsSync(path.join(snapshots, 'foreign.txt')), true);
  assertEqual(fs.existsSync(path.join(snapshots, 'settings.json')), true);
  assertEqual(
    fs.existsSync(path.join(snapshots, 'style-snapshot-old.json')),
    false,
  );
}

function testDependencyTreeSkipped() {
  const dir = createRepo();
  fs.mkdirSync(path.join(dir, 'node_modules', 'pkg'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'node_modules', 'pkg', 'fixture.txt'),
    `t=${FAKE_TOKEN}\n`,
  );
  const result = spawnSync(
    process.execPath,
    [checker, '--worktree', '--format', 'json'],
    { cwd: dir, encoding: 'utf8' },
  );
  assertEqual(result.status, 0, result.stdout);
}

function staged(cwd) {
  return spawnSync(
    process.execPath,
    [checker, '--staged', '--format', 'json'],
    { cwd, encoding: 'utf8' },
  );
}

function createRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'goldband-style-scope-'));
  git(dir, ['init', '--quiet']);
  return dir;
}

function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assertEqual(result.status, 0, result.stderr);
}

function assertEqual(actual, expected, message = '') {
  if (actual === expected) return;
  throw new Error(`expected ${expected}, got ${actual}\n${message}`);
}
