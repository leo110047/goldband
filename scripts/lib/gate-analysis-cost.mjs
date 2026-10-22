// In-process cost checks for the shared Gate A/G analysis, run by
// test-gate-protection.mjs against the source modules.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { bash, root } from './gate-protection-harness.mjs';

const require = createRequire(import.meta.url);

function loadWithCounters(counts) {
  const dirs = ['hooks/scripts/lib/hook-router', 'codex/hooks'].map((dir) =>
    path.join(root, dir),
  );
  for (const key of Object.keys(require.cache)) {
    if (dirs.some((dir) => key.startsWith(dir + path.sep)))
      delete require.cache[key];
  }
  const count = (file, name) => {
    for (const dir of dirs) {
      const module = require(path.join(dir, file));
      const original = module[name];
      module[name] = (...args) => {
        counts[name] += 1;
        return original(...args);
      };
    }
  };
  count('shell-commands.js', 'shellCommands');
  count('protected-surfaces.js', 'protectionAnchors');
  const lib = path.join(dirs[0], 'gate-protection.js');
  return {
    evaluateGateProtection: require(lib).evaluateGateProtection,
    inspectShellCommand: require(path.join(dirs[0], 'shell-policy.js'))
      .inspectShellCommand,
    classifyHighRiskToolUse: require(path.join(dirs[1], 'high-risk-policy.js'))
      .classifyHighRiskToolUse,
  };
}

// One Bash evaluation parses its command once across policies, and the
// protected-path anchors are read only when a write target or possible
// installer run needs them.
export function verifyAnalysisCost() {
  const counts = { shellCommands: 0, protectionAnchors: 0 };
  const policies = loadWithCounters(counts);
  const measure = (evaluate) => {
    counts.shellCommands = 0;
    counts.protectionAnchors = 0;
    evaluate();
    return [counts.shellCommands, counts.protectionAnchors];
  };
  const claudeBash = bash('git status && npm test');
  const write = { tool_name: 'Edit', tool_input: { file_path: 'a.js' } };
  for (const [label, evaluate, expected] of [
    [
      'claude gate and mode policy',
      () => {
        policies.evaluateGateProtection(claudeBash);
        policies.inspectShellCommand(
          claudeBash.tool_input.command,
          () => false,
          () => null,
        );
      },
      [1, 0],
    ],
    [
      'codex risk and gate policies',
      () => policies.classifyHighRiskToolUse(bash('ls -la && git log')),
      [1, 0],
    ],
    [
      'read tool',
      () => policies.evaluateGateProtection({ tool_name: 'Read' }),
      [0, 0],
    ],
    [
      'shell write',
      () => policies.evaluateGateProtection(bash('echo x > out.txt')),
      [1, 1],
    ],
    ['file tool write', () => policies.evaluateGateProtection(write), [0, 1]],
  ])
    assert.deepEqual(measure(evaluate), expected, label);
  console.log(
    '[OK] Gate analysis parses each Bash command once and reads anchors only for candidate targets',
  );
  verifyLinearParse(policies.evaluateGateProtection);
}

// Unmatched braces and glob groups are parsed in linear time, or the parse
// stops at its work limit, well inside the Codex hook timeout.
function verifyLinearParse(evaluateGateProtection) {
  for (const command of [
    `echo ${'{'.repeat(90000)}`,
    `echo ${'{a,'.repeat(30000)}`,
    'x=('.repeat(40000),
  ]) {
    const started = Date.now();
    evaluateGateProtection(bash(command));
    const elapsed = Date.now() - started;
    assert.ok(elapsed < 1000, `${command.slice(0, 12)}: ${elapsed}ms`);
  }
}
