#!/usr/bin/env bun

import { spawnSync } from 'node:child_process';

export const MACOS_REVIEW_HOST_TEST_NAMES = [
  'review contract resolution and runtime store > subdirectory default scope materializes repo-root paths',
  'review contract resolution and runtime store > subdirectory worktree scope materializes repo-root paths',
  'review contract resolution and runtime store > subdirectory staged scope materializes repo-root paths',
  'review contract resolution and runtime store > subdirectory base scope materializes repo-root paths',
  'review evidence contracts > attests Homebrew-style Mach-O rpath dependencies without widening directory reads',
  'review evidence contracts > preserves native LC_RPATH declaration and loader-chain precedence in projections',
  'review evidence contracts > rejects PATH script launchers and requires an explicit interpreter',
  'review evidence contracts > pre-main dyld load failure cannot satisfy an exact RED exit',
  'review evidence contracts > pre-main dyld symbol failure cannot satisfy an exact RED exit',
  'review evidence contracts > sealed Bun runtime can resolve the candidate cwd and a declared --cwd',
  'review evidence contracts > sealed child process inherits the sandbox without broker credentials',
  'review evidence contracts > sealed runtime projection cannot read source images or mutate projected images',
  'review evidence contracts > sealed runtime projection identity is stable across separate evidence plans',
  'review evidence contracts > evidence sandbox denies the system log socket inherited from the macOS process baseline',
  'review evidence contracts > evidence sandbox denies Mach service lookup inherited from the macOS process baseline',
  'review evidence contracts > applicability selects only scoped providers and excludes unrelated cells from completeness',
  'review evidence contracts > regression and property providers preserve RED/GREEN and replay metadata',
  'review evidence contracts > each operation receives an independent read-only snapshot',
  'review evidence contracts > compiler output denial cannot satisfy RED and redirecting the cache preserves the read-only snapshot',
  'review evidence contracts > each operation receives an independent HOME and TMPDIR',
  'review evidence contracts > successful output containing sandbox is not treated as launcher failure',
  'review evidence contracts > evidence sandbox denies reads outside declared runtime and candidate roots',
  'review evidence contracts > regression RED requires the declared exact exit code',
  'review evidence contracts > dyld sandbox denial cannot satisfy RED when caller output retention is one byte',
  'review evidence contracts > runtime integration evidence preserves its declared verification level',
  'review evidence contracts > diff-scoped evidence excludes out-of-scope dirty and untracked files',
  'review evidence contracts > exact candidate retains tracked content resembling a skipped-file diagnostic',
  'review evidence contracts > secret-like untracked code stays out of the prompt diff but executes in the bound candidate',
  'review evidence contracts > a failed deterministic gate is rendered as a verified blocker even if semantic review is separate',
  'review evidence contracts > runner summaries redact secret-like output while retaining the full output digest',
  'review evidence contracts > runner terminates descendants that outlive their root command',
  'review evidence contracts > mock runtime performs one initial host call and one separately scoped closure call',
  'Work Map review readback > review rejects an analysis artifact changed after the model pass',
  'Work Map review readback > review rejects a code candidate changed after the model pass',
  'Work Map review readback > verified deterministic failure remains blocking after semantic normalization',
  'Codex trusted workflow launcher install > materializes review and browser owners with exact allow rules outside source',
  'workflow runtime > core compatibility workflows emit evidence in mock mode',
  'workflow runtime > review/code typed flow renders validated report',
  'workflow runtime > CLI warns when max-iterations is provided without loop',
  'workflow runtime > worktree diff includes safe untracked files',
  'workflow runtime > worktree diff includes exact untracked paths containing newline and tab',
  'workflow runtime > review prompt template is resolved from the workflow runtime root',
  'goldband review code launcher > runs the real typed pipeline through the Codex host adapter',
] as const;

export const WORKFLOW_TESTS = [
  'test/workflows-registry.test.ts',
  'test/workflows-runtime.test.ts',
  'test/review-evidence.test.ts',
  'test/review-evidence-platform.test.ts',
  'test/review-contract-authoring.test.ts',
  'test/review-lineage.test.ts',
  'test/work-map.test.ts',
  'test/work-map-store.test.ts',
  'test/work-map-evidence.test.ts',
  'test/work-map-review.test.ts',
  'test/verification-receipt.test.ts',
  'test/review-receipt-authority-install.test.ts',
  'test/goldband-plan-cli.test.ts',
  'test/goldband-plan-sync-cli.test.ts',
  'test/tracker-projection.test.ts',
  'test/tracker-config.test.ts',
  'test/tracker-github.test.ts',
  'test/tracker-gitlab.test.ts',
  'test/tracker-runtime.test.ts',
  'test/tracker-import.test.ts',
  'test/review-impact.test.ts',
  'test/goldband-review-cli.test.ts',
  'test/codex-review-contract-authoring-install.test.ts',
  'test/codex-review-launcher-install.test.ts',
  'test/codex-workflow-status.test.ts',
] as const;

export function workflowTestsForPlatform(): string[] {
  return [...WORKFLOW_TESTS];
}

export function testNamePatternForPlatform(
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  if (platform === 'darwin') return undefined;
  const escaped = MACOS_REVIEW_HOST_TEST_NAMES.map((name) =>
    (name.split(' > ').at(-1) ?? name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return `^(?!.*(?:${escaped.join('|')})).*$`;
}

function main(): number {
  const args = process.argv.slice(2);
  const listOnly = args.length === 1 && args[0] === '--list';
  if (args.length > 0 && !listOnly) {
    throw new Error(`Unknown argument: ${args.join(' ')}`);
  }
  const files = workflowTestsForPlatform();
  const testNamePattern = testNamePatternForPlatform();
  console.log(
    `[test:workflows] ${process.platform} owns ${files.length} tests` +
      (testNamePattern ? ` (${MACOS_REVIEW_HOST_TEST_NAMES.length} macOS review-host cases excluded)` : ''),
  );
  if (listOnly) {
    for (const file of files) console.log(`  ${file}`);
    return 0;
  }
  const testArgs = ['test'];
  if (testNamePattern) testArgs.push('--test-name-pattern', testNamePattern);
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
