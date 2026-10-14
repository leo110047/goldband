#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const ROOT_DIR = path.resolve(path.dirname(__filename), '..');
const CHECKER = path.join(ROOT_DIR, 'scripts', 'check-eval-budget-cap.mjs');

function run(args, env = {}) {
  return spawnSync(process.execPath, [CHECKER, ...args], {
    cwd: ROOT_DIR,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

function withFixture(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-cap-test.'));
  try {
    fs.writeFileSync(
      path.join(root, 'ok.json'),
      JSON.stringify({
        tier: 'e2e',
        timestamp: '2026-10-13T00:00:00.000Z',
        total_cost_usd: 1.25,
      }),
    );
    fs.mkdirSync(path.join(root, 'nested'));
    fs.writeFileSync(
      path.join(root, 'nested', 'more.json'),
      JSON.stringify({ total_cost_usd: 0.25 }),
    );
    fs.writeFileSync(path.join(root, 'broken.json'), '{');
    fs.writeFileSync(
      path.join(root, '_partial-e2e.json'),
      JSON.stringify({
        tier: 'e2e',
        timestamp: '2026-10-14T00:00:00.000Z',
        total_cost_usd: 0.25,
        _partial: true,
      }),
    );
    fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

withFixture((root) => {
  const result = run(['--max-cost-usd', '2', '--root', root]);
  assert.equal(result.status, 0, result.stderr);
  // A partial snapshot is an unfinished run's cost unless a final run covers it.
  assert.match(result.stdout, /Eval cost: \$1\.7500 \/ cap \$2\.0000/);
  assert.match(result.stderr, /Skipping unreadable eval JSON/);
});

withFixture((root) => {
  const result = run(['--max-cost-usd', '1', '--root', root]);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /Eval cost exceeded max_cost_usd/);
});

// A partial snapshot is skipped only when a final run of the same tier, in the
// same directory, at or after it covers it.
function partialCost(finalRun, finalDir = '') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-cap-partial.'));
  try {
    fs.mkdirSync(path.join(root, 'evals'));
    fs.mkdirSync(path.join(root, 'other'));
    fs.writeFileSync(
      path.join(root, finalDir || 'evals', '0.1.0-main-run.json'),
      JSON.stringify({
        total_cost_usd: 1,
        tests: [{ name: 'a' }, { name: 'b' }],
        ...finalRun,
      }),
    );
    fs.writeFileSync(
      path.join(root, 'evals', '_partial-e2e.json'),
      JSON.stringify({
        tier: 'e2e',
        timestamp: '2026-10-14T00:00:00.000Z',
        total_cost_usd: 1,
        tests: [{ name: 'a' }],
        _partial: true,
      }),
    );
    const result = run(['--max-cost-usd', '5', '--root', root]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    return result.stdout.match(/Eval cost: \$(\d+\.\d+)/)[1];
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}
const later = '2026-10-14T00:01:00.000Z';
assert.equal(partialCost({ tier: 'e2e', timestamp: later }), '1.0000');
assert.equal(partialCost({ tier: 'llm-judge', timestamp: later }), '2.0000');
assert.equal(partialCost({ tier: 'e2e', timestamp: later }, 'other'), '2.0000');
// A final run earlier than the snapshot cannot be the run that wrote it.
assert.equal(
  partialCost({ tier: 'e2e', timestamp: '2026-10-13T00:00:00.000Z' }),
  '2.0000',
);
// A later final run of a different run does not cover the snapshot.
assert.equal(
  partialCost({ tier: 'e2e', timestamp: later, tests: [] }),
  '2.0000',
);

const invalid = run(['--max-cost-usd', 'not-money']);
assert.equal(invalid.status, 2, invalid.stdout + invalid.stderr);
assert.match(invalid.stderr, /max_cost_usd must be a non-negative decimal/);

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-cap-home.'));
try {
  const legacyEvalDir = path.join(home, '.goldband-dev', 'evals');
  const projectDir = path.join(home, '.goldband', 'projects', 'sample-project');
  const projectEvalDir = path.join(projectDir, 'evals');
  fs.mkdirSync(legacyEvalDir, { recursive: true });
  fs.mkdirSync(projectEvalDir, { recursive: true });
  fs.writeFileSync(
    path.join(legacyEvalDir, 'legacy.json'),
    JSON.stringify({ total_cost_usd: 0.5 }),
  );
  fs.writeFileSync(
    path.join(projectEvalDir, 'run.json'),
    JSON.stringify({ total_cost_usd: 0.75 }),
  );
  fs.writeFileSync(
    path.join(projectDir, 'state.json'),
    JSON.stringify({ total_cost_usd: 100 }),
  );

  const result = run([], { HOME: home, MAX_COST_USD: '2' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /Eval cost: \$1\.2500 \/ cap \$2\.0000/);
} finally {
  fs.rmSync(home, { recursive: true, force: true });
}

console.log('[OK] eval budget cap checker tests passed');
