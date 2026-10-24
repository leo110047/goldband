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
// stops at its work limit. Each parse is timed against a linear character
// scan of the same text on the same machine, never against a fixed budget,
// so a slow machine slows both; superlinear parsing at this length takes
// thousands of times longer than the scan.
const SCAN_FACTOR = 200;
const TRIALS = 5;

// The fastest of several runs; evaluating another command first evicts the
// shell policy's last-parse cache.
function fastest(evaluateGateProtection, run) {
  let best = Infinity;
  for (let trial = 0; trial < TRIALS; trial += 1) {
    evaluateGateProtection(bash('true'));
    const started = performance.now();
    run();
    best = Math.min(best, performance.now() - started);
  }
  return best;
}

function scanCharacters(text) {
  let count = 0;
  for (const char of text) if (/[{}()]/.test(char)) count += 1;
  return count;
}

function verifyLinearParse(evaluateGateProtection) {
  for (const command of [
    `echo ${'{'.repeat(90000)}`,
    `echo ${'{a,'.repeat(30000)}`,
    'x=('.repeat(40000),
  ]) {
    const scan = fastest(evaluateGateProtection, () => scanCharacters(command));
    const parse = fastest(evaluateGateProtection, () =>
      evaluateGateProtection(bash(command)),
    );
    assert.ok(
      parse < scan * SCAN_FACTOR,
      `${command.slice(0, 12)}: ${parse.toFixed(1)}ms parse vs ${scan.toFixed(1)}ms scan`,
    );
  }
}
