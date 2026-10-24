// Gate A cases that depend on how Git is launched: privileged launchers,
// the directory and system configuration an alias is read from, and the
// per-call alias lookup budget. Run by test-gate-protection.mjs through both
// native hook adapters.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  gateAPrivilegedCases,
  gitConfigOverrideEnv,
  privilegedAllowCases,
} from '../fixtures/gate-protection-cases.mjs';
import {
  bash,
  check,
  runClaude,
  runCodex,
  temp,
} from './gate-protection-harness.mjs';

// Codex lets a call continue when its hook runs past 5 seconds.
const CODEX_HOOK_TIMEOUT_MS = 5000;

function verifyPrivilegedLaunchers(env) {
  for (const [command, rule] of gateAPrivilegedCases) {
    const claude = runClaude(bash(command), { env });
    check(`claude ${command}`, claude, 'deny');
    assert.match(claude.message, new RegExp(`Gate A .*\\(${rule}\\)`), command);
    check(`codex ${command}`, runCodex(bash(command), { env }), 'deny');
  }
  for (const command of privilegedAllowCases) {
    check(`claude ${command}`, runClaude(bash(command), { env }), 'none');
    const codex = runCodex(bash(command), { env });
    assert.doesNotMatch(codex.message, /Gate A/, command);
  }
}

function aliasFixtures() {
  const repo = path.join(temp, 'aliased');
  fs.mkdirSync(repo, { recursive: true });
  for (const args of [
    ['init', '-q'],
    ['config', 'alias.lc', 'commit'],
  ]) {
    const result = spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  }
  const system = path.join(temp, 'system.gitconfig');
  fs.writeFileSync(system, '[alias]\n\tsc = commit\n');
  return { repo, system };
}

// [command, expected]: an alias resolves in the directory and system
// configuration the launched Git reads.
function aliasSourceCases({ repo, system }) {
  return [
    [`env -C ${repo} git lc -n`, 'deny'],
    [`cd ${repo} && git lc -n`, 'deny'],
    ['git lc -n', 'none'],
    [`GIT_CONFIG_SYSTEM=${system} git sc -n`, 'deny'],
    [`export GIT_CONFIG_SYSTEM=${system}; git sc -n`, 'deny'],
    ['git sc -n', 'none'],
  ];
}

function verifyLookupBudget(env) {
  const calls = Array.from({ length: 300 }, (_, index) => `git zz${index} -x`);
  const command = calls.join('; ');
  const started = Date.now();
  const codex = runCodex(bash(command), { env });
  const elapsed = Date.now() - started;
  check('codex 300 alias lookups', codex, 'deny');
  assert.ok(elapsed < CODEX_HOOK_TIMEOUT_MS, `${elapsed}ms`);
  check('claude 300 alias lookups', runClaude(bash(command), { env }), 'deny');
}

export function verifyGitLaunches() {
  const env = gitConfigOverrideEnv;
  verifyPrivilegedLaunchers(env);
  for (const [command, expected] of aliasSourceCases(aliasFixtures())) {
    const claude = runClaude(bash(command), { env });
    check(`claude ${command}`, claude, expected);
    if (expected === 'deny')
      assert.match(claude.message, /\(git-alias-bypass\)/, command);
    check(`codex ${command}`, runCodex(bash(command), { env }), expected);
  }
  verifyLookupBudget(env);
  console.log(
    '[OK] Gate A: privileged launchers, alias sources, and the alias lookup budget',
  );
}
