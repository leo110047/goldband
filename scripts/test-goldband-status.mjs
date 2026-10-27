#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = path.join(root, 'hooks/scripts/tools/goldband-status.js');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'goldband-status-'));
const HOUR_MS = 60 * 60 * 1000;

try {
  verifyNothingWrittenIsInactive();
  verifyActiveModes();
  verifyCorruptModeStateIsUnavailable();
  verifyCrossReviewContracts();
  verifyCorruptContractIsUnavailable();
  verifyDisplayMatchesCoreGate();
  console.log('[OK] goldband status reports each source through its owner');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}

// Each case gets its own plugin data directory, laid out as the hooks write it.
function dataDir(name) {
  const dir = path.join(temp, name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function writeFile(dir, relative, content) {
  const file = path.join(dir, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function writeModes(dir, content) {
  writeFile(dir, 'hook-router/modes/session-s1.json', content);
}

function writeContract(dir, content) {
  writeFile(dir, 'cross-review/s1.json', content);
}

// Only CLAUDE_PLUGIN_DATA locates state; the repository's own runtime core
// answers for cross-review.
function status(dir) {
  const env = { ...process.env, CLAUDE_PLUGIN_DATA: dir };
  for (const name of [
    'GOLDBAND_ROOT',
    'GOLDBAND_HOME',
    'GOLDBAND_CROSS_REVIEW_ROOT',
    'GOLDBAND_CROSS_REVIEW_DIR',
    'HOOK_ROUTER_MODE_STATE_FILE',
  ]) {
    delete env[name];
  }
  const result = spawnSync(process.execPath, [script, '--session', 's1'], {
    env,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  return Object.fromEntries(
    JSON.parse(result.stdout).sources.map(({ name, ...rest }) => [name, rest]),
  );
}

function verifyNothingWrittenIsInactive() {
  assert.deepEqual(status(dataDir('empty')), {
    'careful-mode': { available: true, active: false },
    'freeze-mode': { available: true, active: false },
    'cross-review': { available: true, active: false },
  });
}

function verifyActiveModes() {
  const dir = dataDir('modes');
  writeModes(
    dir,
    JSON.stringify({
      sessionId: 's1',
      modes: { 'careful-mode': { active: true }, 'freeze-mode': {} },
    }),
  );
  const sources = status(dir);
  assert.deepEqual(sources['careful-mode'], { available: true, active: true });
  assert.deepEqual(sources['freeze-mode'], { available: true, active: false });
}

function verifyCorruptModeStateIsUnavailable() {
  const dir = dataDir('corrupt-modes');
  writeModes(dir, '{"modes": {"careful-mode": {"active": true');
  const sources = status(dir);
  for (const name of ['careful-mode', 'freeze-mode']) {
    assert.equal(sources[name].available, false, name);
    assert.match(sources[name].reason, /Mode state file/);
  }
  assert.equal(sources['cross-review'].available, true);
}

function contractCases() {
  const now = Date.now();
  return [
    ['active, unexpired', { status: 'active', expiresAt: now + HOUR_MS }, true],
    ['active, no expiry', { status: 'active' }, true],
    ['active, expired', { status: 'active', expiresAt: now - HOUR_MS }, false],
    ['passed', { status: 'passed', expiresAt: now + HOUR_MS }, false],
    ['overridden', { status: 'overridden' }, false],
    ['expired', { status: 'expired' }, false],
  ];
}

function contractJson(contract) {
  return JSON.stringify({
    sessionId: 's1',
    status: contract.status,
    ...(contract.expiresAt
      ? { expiresAt: new Date(contract.expiresAt).toISOString() }
      : {}),
  });
}

function verifyCrossReviewContracts() {
  for (const [label, contract, active] of contractCases()) {
    const dir = dataDir(`contract-${label.replace(/\W+/g, '-')}`);
    writeContract(dir, contractJson(contract));
    assert.deepEqual(
      status(dir)['cross-review'],
      { available: true, active },
      label,
    );
  }
}

function verifyCorruptContractIsUnavailable() {
  const dir = dataDir('corrupt-contract');
  writeContract(dir, '{"status": "active"');
  const sources = status(dir);
  assert.equal(sources['cross-review'].available, false);
  assert.equal(sources['careful-mode'].available, true);
}

// The display rule lives beside the core's gate, which this feature leaves
// unchanged, so it is held to the gate: a contract with no plan bound blocks
// Stop exactly when the gate is armed, and the display must agree.
function verifyDisplayMatchesCoreGate() {
  const require = createRequire(import.meta.url);
  const core = require(path.join(root, 'goldband-loop/cross-review/core.cjs'));
  const { isCrossReviewGateActive } = require(
    path.join(root, 'hooks/scripts/lib/hook-router/cross-review-gate.js'),
  );
  const saved = process.env.GOLDBAND_CROSS_REVIEW_DIR;
  try {
    for (const [label, contract] of contractCases()) {
      const dir = dataDir(`parity-${label.replace(/\W+/g, '-')}`);
      process.env.GOLDBAND_CROSS_REVIEW_DIR = dir;
      const env = { ...process.env, GOLDBAND_USAGE_TELEMETRY_ENABLED: '0' };
      const armed = core.createContract(
        { sessionId: 's1', implementer: 'claude', baseCommit: 'base' },
        env,
      );
      const { expiresAt: _armedExpiry, ...withoutExpiry } = armed;
      core.writeContract(
        {
          ...withoutExpiry,
          status: contract.status,
          ...(contract.expiresAt
            ? { expiresAt: new Date(contract.expiresAt).toISOString() }
            : {}),
        },
        env,
      );
      // Read first: the gate rewrites an expired contract as it evaluates.
      const displayed = isCrossReviewGateActive('s1');
      const gate = core.evaluateCrossReviewGate({ session_id: 's1' }, { env });
      assert.equal(displayed, gate.decision !== 'allow', label);
    }
  } finally {
    if (saved === undefined) delete process.env.GOLDBAND_CROSS_REVIEW_DIR;
    else process.env.GOLDBAND_CROSS_REVIEW_DIR = saved;
  }
}
