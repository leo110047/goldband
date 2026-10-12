#!/usr/bin/env bun

import { spawnSync } from 'node:child_process';

export const WORKFLOW_TESTS = [
  'test/workflows-registry.test.ts',
  'test/workflows-runtime.test.ts',
  'test/work-map.test.ts',
  'test/work-map-store.test.ts',
  'test/verification-receipt.test.ts',
  'test/goldband-plan-cli.test.ts',
  'test/goldband-plan-sync-cli.test.ts',
  'test/tracker-projection.test.ts',
  'test/tracker-config.test.ts',
  'test/tracker-github.test.ts',
  'test/tracker-gitlab.test.ts',
  'test/tracker-runtime.test.ts',
  'test/tracker-import.test.ts',
  'test/review-impact.test.ts',
  'test/review-semantic.test.ts',
  'test/goldband-review-cli.test.ts',
  'test/codex-review-launcher-install.test.ts',
  'test/codex-workflow-status.test.ts',
] as const;

export function workflowTestsForPlatform(): string[] {
  return [...WORKFLOW_TESTS];
}

function main(): number {
  const args = process.argv.slice(2);
  const listOnly = args.length === 1 && args[0] === '--list';
  if (args.length > 0 && !listOnly) {
    throw new Error(`Unknown argument: ${args.join(' ')}`);
  }
  const files = workflowTestsForPlatform();
  console.log(
    `[test:workflows] ${process.platform} owns ${files.length} tests`,
  );
  if (listOnly) {
    for (const file of files) console.log(`  ${file}`);
    return 0;
  }
  const testArgs = ['test'];
  testArgs.push(...files);
  const result = spawnSync(process.execPath, testArgs, {
    stdio: 'inherit',
    env: process.env,
  });
  return result.status ?? 1;
}

if (import.meta.main) {
  process.exitCode = main();
}
