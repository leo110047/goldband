// Per-call Gate G analysis budgets, run by test-gate-protection.mjs through
// both native hook adapters.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  bash,
  check,
  runClaude,
  runCodex,
  temp,
} from './gate-protection-harness.mjs';

// Gate G stops analyzing a call that exceeds its per-call budget and gives
// the Gate G response, before the Codex hook timeout lets the call continue.
export function verifyAnalysisLimits() {
  const deep = path.join(temp, 'deep');
  for (let index = 0; index < 200; index += 1)
    fs.mkdirSync(path.join(deep, `d${index}`), { recursive: true });
  const changes = Array.from({ length: 9 }, (_, index) => `cd c${index}`);
  for (const command of [
    // Every cd doubles the working directories a later target resolves in.
    `${changes.join(' && ')} && echo x > out.txt`,
    // Brace words share one path budget.
    'touch a{1..10000} b{1..10000} c',
    // Glob walks share one directory-visit budget.
    `touch ${deep}/*/x{1..101}`,
  ]) {
    const claude = runClaude({ ...bash(command), permission_mode: 'auto' });
    check(`claude ${command.slice(0, 40)}`, claude, 'ask');
    assert.match(claude.message, /Gate G could not analyze this call/);
    check(`codex ${command.slice(0, 40)}`, runCodex(bash(command)), 'deny');
  }
  for (const command of [
    `${changes.slice(0, 7).join(' && ')} && echo x > out.txt`,
    `touch ${deep}/*/x{1..90}`,
  ])
    check(`codex ${command.slice(0, 40)}`, runCodex(bash(command)), 'none');
  // apply_patch input from a pipe or file is unknown; a glob walk past the
  // call's deadline stops. Each gets the Gate G response.
  for (const [command, env] of [
    ['printf x | apply_patch', {}],
    ['apply_patch < patch.txt', {}],
    ['echo x > docs/*.md', { GOLDBAND_GATE_GLOB_MS: '1' }],
  ]) {
    const claude = runClaude(
      { ...bash(command), permission_mode: 'auto' },
      { env },
    );
    check(`claude ${command}`, claude, 'ask');
    assert.match(claude.message, /Gate G could not analyze this call/);
    check(`codex ${command}`, runCodex(bash(command), { env }), 'deny');
  }
  // A Gate A bypass after the directory budget still denies in Claude.
  for (const bypass of [
    `${changes.join(' && ')} && git commit -n -m x`,
    'printf x | apply_patch; git commit -n -m x',
  ]) {
    const claude = runClaude({ ...bash(bypass), permission_mode: 'auto' });
    check(`claude Gate A after a limit: ${bypass.slice(-30)}`, claude, 'deny');
    assert.match(claude.message, /\(git-no-verify\)/);
  }
  console.log(
    '[OK] Gate G: working-directory, path, glob-visit, and glob-time budgets and unknown patch input',
  );
}
