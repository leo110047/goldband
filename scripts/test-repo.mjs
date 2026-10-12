#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { dirname, join, relative } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import {
  formatRepoTestPreflightFailure,
  inspectRepoTestEnvironment,
} from './lib/repo-test-environment.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const bunCmd = process.platform === 'win32' ? 'bun.exe' : 'bun';

export const TEST_SUITES = [
  suite({
    id: 'root:test-environment',
    label: 'Root repository test environment contract',
    cwd: ROOT,
    command: 'node',
    args: ['scripts/test-repo-environment.mjs'],
  }),
  suite({
    id: 'root:manifest',
    label: 'Root generated capability surfaces',
    cwd: ROOT,
    command: npmCmd,
    args: ['run', 'check:manifest'],
  }),
  suite({
    id: 'root:capability-invocations',
    label: 'Root capability invocation validation',
    cwd: ROOT,
    command: npmCmd,
    args: ['run', 'test:capability-invocations'],
  }),
  suite({
    id: 'root:workflow-contracts',
    label: 'Root workflow contract tests',
    cwd: ROOT,
    command: npmCmd,
    args: ['run', 'test:workflow-contracts'],
  }),
  suite({
    id: 'root:decision-guidance',
    label: 'Root decision guidance and installer readback',
    cwd: ROOT,
    command: npmCmd,
    args: ['run', 'test:decision-guidance'],
  }),
  suite({
    id: 'root:app-support',
    label: 'Root app support tests',
    cwd: ROOT,
    command: npmCmd,
    args: ['run', 'test:app-support'],
  }),
  suite({
    id: 'root:plugin-distribution',
    label: 'Root plugin distribution tests',
    cwd: ROOT,
    command: npmCmd,
    args: ['run', 'test:plugin-distribution'],
  }),
  suite({
    id: 'root:style-gate',
    label: 'Root style gate tests',
    cwd: ROOT,
    command: npmCmd,
    args: ['run', 'test:style-gate'],
  }),
  suite({
    id: 'root:project-style-gate',
    label: 'Root project style gate tests',
    cwd: ROOT,
    command: npmCmd,
    args: ['run', 'test:project-style-gate'],
  }),
  suite({
    id: 'root:sandbox-image-lifecycle',
    label: 'Sandbox test image lifecycle',
    cwd: ROOT,
    command: npmCmd,
    args: ['run', 'test:sandbox-image-lifecycle'],
  }),
  suite({
    id: 'root:codex-portability',
    label: 'Root Codex portability tests',
    cwd: ROOT,
    command: npmCmd,
    args: ['run', 'test:codex-portability'],
  }),
  suite({
    id: 'root:hook-router',
    label: 'Root hook router tests',
    cwd: ROOT,
    command: npmCmd,
    args: ['run', 'test:hook-router'],
  }),
  suite({
    id: 'root:telemetry',
    label: 'Root telemetry tests',
    cwd: ROOT,
    command: npmCmd,
    args: ['run', 'test:telemetry'],
  }),
  suite({
    id: 'root:hook-router-coverage',
    label: 'Root hook router coverage matrix',
    cwd: ROOT,
    command: npmCmd,
    args: ['run', 'test:hook-router:coverage'],
  }),
  suite({
    id: 'root:eval-budget-cap',
    label: 'Root eval budget cap tests',
    cwd: ROOT,
    command: npmCmd,
    args: ['run', 'test:eval-budget-cap'],
  }),
  suite({
    id: 'root:auto-update',
    label: 'Root auto-update tests',
    cwd: ROOT,
    command: npmCmd,
    args: ['run', 'test:auto-update'],
  }),
  suite({
    id: 'root:config-preservation',
    label: 'Root personal settings and optional status line preservation',
    cwd: ROOT,
    command: npmCmd,
    args: ['run', 'test:config-preservation'],
  }),
  suite({
    id: 'root:launchers',
    label: 'Root shell launcher tests',
    cwd: ROOT,
    command: npmCmd,
    args: ['run', 'test:launchers'],
  }),
  suite({
    id: 'mcp:test',
    label: 'MCP server tests',
    cwd: join(ROOT, 'mcp', 'server'),
    command: npmCmd,
    args: ['test'],
  }),
  suite({
    id: 'mcp:smoke',
    label: 'MCP server smoke test',
    cwd: join(ROOT, 'mcp', 'server'),
    command: npmCmd,
    args: ['run', 'smoke'],
  }),
  suite({
    id: 'goldband-loop:source',
    label: 'Goldband Loop source quality',
    cwd: join(ROOT, 'goldband-loop'),
    command: bunCmd,
    args: ['run', 'check:source'],
  }),
  suite({
    id: 'goldband-loop:inventory',
    label: 'Goldband Loop inventory check',
    cwd: ROOT,
    command: 'node',
    args: ['scripts/check-goldband-loop-inventory.mjs'],
  }),
  suite({
    id: 'goldband-loop:workflows',
    label: 'Goldband Loop workflow runtime tests',
    cwd: join(ROOT, 'goldband-loop'),
    command: bunCmd,
    args: ['run', 'test:workflows'],
  }),
  suite({
    id: 'goldband-loop:free',
    label: 'Goldband Loop free test suite',
    cwd: join(ROOT, 'goldband-loop'),
    command: bunCmd,
    args: ['run', 'test:free'],
  }),
];

function suite(options) {
  return options;
}

function parseArgs(argv) {
  const options = {
    dryRun: false,
    list: false,
    suites: new Set(),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    if (arg === '--list') {
      options.list = true;
      continue;
    }
    if (arg === '--suite') {
      const value = argv[index + 1];
      if (!value) throw new Error('--suite requires a suite id');
      options.suites.add(value);
      index += 1;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}

function selectedSuites(options) {
  if (options.suites.size === 0) return TEST_SUITES;
  const known = new Set(TEST_SUITES.map((item) => item.id));
  const unknown = [...options.suites].filter((id) => !known.has(id));
  if (unknown.length > 0) {
    throw new Error(`unknown suite id(s): ${unknown.join(', ')}`);
  }
  return TEST_SUITES.filter((item) => options.suites.has(item.id));
}

export function formatCommand(item) {
  return [item.command, ...item.args].join(' ');
}

export function formatSuiteLine(status, item, detail = '') {
  const suffix = detail ? ` ${detail}` : '';
  return `[test:repo] ${status} ${item.id} - ${item.label}${suffix}`;
}

function printSuiteList(suites) {
  for (const item of suites) {
    console.log(
      `${item.id}\t${relative(ROOT, item.cwd) || '.'}\t${formatCommand(item)}`,
    );
  }
}

function runSuite(item) {
  const started = performance.now();
  console.log(formatSuiteLine('RUN', item, `(${formatCommand(item)})`));
  const result = spawnSync(item.command, item.args, {
    cwd: item.cwd,
    env: process.env,
    stdio: 'inherit',
  });
  const durationMs = Math.round(performance.now() - started);
  const exitCode = result.status ?? 1;
  return {
    item,
    exitCode,
    durationMs,
  };
}

function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function printFinalSummary(results) {
  console.log('[test:repo] Final summary');
  for (const result of results) {
    const status = result.exitCode === 0 ? 'PASS' : 'FAIL';
    const detail = `(${formatDuration(result.durationMs)}${result.exitCode === 0 ? '' : `, exit ${result.exitCode}`})`;
    console.log(formatSuiteLine(status, result.item, detail));
  }
  const failed = results.filter((result) => result.exitCode !== 0);
  if (failed.length === 0) {
    console.log(`[test:repo] PASS ${results.length} suites`);
    return 0;
  }
  console.error(
    `[test:repo] FAIL ${failed.length}/${results.length} suites failed`,
  );
  return 1;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const suites = selectedSuites(options);
  if (options.list || options.dryRun) {
    printSuiteList(suites);
    return 0;
  }
  if (options.suites.size === 0) {
    const problems = inspectRepoTestEnvironment(ROOT);
    if (problems.length > 0) {
      console.error(formatRepoTestPreflightFailure(problems));
      return 2;
    }
  }
  const results = suites.map(runSuite);
  return printFinalSummary(results);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(
      `[test:repo] ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 2;
  }
}
