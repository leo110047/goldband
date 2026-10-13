#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const tests = [
  ['hook config triggers hook reference check', testHookReferenceSelection],
  ['codex rules trigger portability check', testCodexPortabilitySelection],
  ['style gate files trigger self-test', testStyleGateSelection],
  ['source files trigger the unused export check', testUnusedExportSelection],
  ['unrelated files trigger no checks', testUnrelatedSelection],
];

for (const [name, test] of tests) {
  test();
  console.log(`ok - ${name}`);
}

function testHookReferenceSelection() {
  const result = dryRun(['hooks/hooks.json']);
  assert.deepEqual(result.checks, [
    'plugin-distribution',
    'hook-script-references',
  ]);
}

function testCodexPortabilitySelection() {
  const result = dryRun(['codex/rules/default.rules']);
  assert.deepEqual(result.checks, ['codex-portability']);
}

function testStyleGateSelection() {
  const result = dryRun(['scripts/lib/code-style/checks.mjs']);
  assert.deepEqual(result.checks, ['unused-exports', 'style-gate-self-test']);
}

function testUnusedExportSelection() {
  assert.deepEqual(dryRun(['goldband-loop/lib/knowledge.ts']).checks, [
    'unused-exports',
  ]);
  assert.deepEqual(
    dryRun(['plugin-assets/claude-code-plugin/hooks/scripts/lib/utils.js'])
      .checks,
    ['plugin-distribution'],
  );
}

function testUnrelatedSelection() {
  const result = dryRun(['docs/observability.md']);
  assert.deepEqual(result.checks, []);
}

function dryRun(files) {
  const result = spawnSync(
    process.execPath,
    [
      'scripts/check-goldband-project-style-gate.mjs',
      '--files',
      ...files,
      '--dry-run',
      '--format',
      'json',
    ],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}
