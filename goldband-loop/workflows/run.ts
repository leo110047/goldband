#!/usr/bin/env bun
import { assertValidReviewExecutionOptions } from '../lib/review-runtime-contract';
import { isAbsolute } from 'node:path';
import { getWorkflow } from './registry';
import { runWorkflowLoop } from './loop';
import { resolveReviewTimeoutPolicy } from './review-timeouts';
import { runWorkflow } from './runtime';
import type { WorkflowRunOptions } from './types';

async function main() {
  const { capability, action, options, loop } = parseArgs(process.argv.slice(2));
  const workflow = getWorkflow(`${capability}/${action}`);
  warnIgnoredOptions(options, loop);
  const result = loop ? await runWorkflowLoop(workflow, options) : await runWorkflow(workflow, options);
  console.log(JSON.stringify(result, null, 2));
}

function parseArgs(args: string[]): { capability: string; action: string; options: WorkflowRunOptions; loop: boolean } {
  const capability = args.shift();
  if (!capability || capability === '-h' || capability === '--help') {
    usage();
    process.exit(capability ? 0 : 2);
  }
  const action = args.shift();
  if (!action || action.startsWith('-')) usageError('both <capability> and <action> are required; legacy workflow names are not supported');

  const options: WorkflowRunOptions = {};
  let loop = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (setBooleanOption(arg, options)) continue;
    if (arg === '--input') options.inputFile = takeValue(args, ++index, arg);
    else if (arg === '--base') options.base = takeValue(args, ++index, arg);
    else if (arg === '--mode') options.mode = takeValue(args, ++index, arg) as WorkflowRunOptions['mode'];
    else if (arg === '--host') options.host = takeValue(args, ++index, arg) as WorkflowRunOptions['host'];
    else if (arg === '--diff-file') options.diffFile = takeValue(args, ++index, arg);
    else if (arg === '--specialists') options.specialists = takeValue(args, ++index, arg) as WorkflowRunOptions['specialists'];
    else if (arg === '--review-host-timeout-seconds') options.reviewHostTimeoutMs = takeSeconds(args, ++index, arg);
    else if (arg === '--review-pass-timeout-seconds') options.reviewPassTimeoutMs = takeSeconds(args, ++index, arg);
    else if (arg === '--review-claude-max-budget-usd') options.reviewClaudeMaxBudgetUsd = takeUsd(args, ++index, arg);
    else if (arg === '--evidence-manifest') options.evidenceManifestFile = takeValue(args, ++index, arg);
    else if (arg === '--closure-artifact') options.closureArtifactFile = takeValue(args, ++index, arg);
    else if (arg === '--work-id') options.workId = takeValue(args, ++index, arg);
    else if (arg === '--ticket-id') options.ticketId = takeValue(args, ++index, arg);
    else if (arg === '--goldband-home') options.goldbandHome = takeValue(args, ++index, arg);
    else if (arg === '--review-receipt-trusted-config') options.reviewReceiptTrustedConfig = takeValue(args, ++index, arg);
    else if (arg === '--loop') loop = true;
    else if (arg === '--max-iterations') options.maxIterations = takeNumber(args, ++index, arg);
    else usageError(`unknown argument: ${arg}`);
  }
  validateOptions(capability, action, options);

  return { capability, action, options, loop };
}

function setBooleanOption(arg: string | undefined, options: WorkflowRunOptions): boolean {
  const key = { '--staged': 'staged', '--worktree': 'worktree',
    '--include-untracked': 'includeUntracked', '--semantic-only': 'semanticOnly' }[arg ?? ''];
  if (!key) return false;
  options[key as 'staged' | 'worktree' | 'includeUntracked' | 'semanticOnly'] = true;
  return true;
}

function validateOptions(
  capability: string,
  action: string,
  options: WorkflowRunOptions,
): void {
  if (options.mode && !['mock', 'real'].includes(options.mode)) {
    usageError(`invalid --mode: ${options.mode}`);
  }
  if (options.host && !['mock', 'claude', 'codex'].includes(options.host)) {
    usageError(`invalid --host: ${options.host}`);
  }
  if (options.mode === 'real' && (!options.host || options.host === 'mock')) {
    usageError('--mode real requires --host claude or --host codex');
  }
  if (options.host && options.host !== 'mock' && options.mode !== 'real') {
    usageError('--host claude|codex requires --mode real');
  }
  if (options.goldbandHome && !isAbsolute(options.goldbandHome)) {
    usageError('--goldband-home requires an absolute path');
  }
  if (options.reviewReceiptTrustedConfig && !isAbsolute(options.reviewReceiptTrustedConfig)) {
    usageError('--review-receipt-trusted-config requires an absolute path');
  }
  if (options.specialists && !['off', 'auto', 'all'].includes(options.specialists)) {
    usageError(`invalid --specialists: ${options.specialists}`);
  }
  const hasReviewOnlyOverride =
    options.reviewHostTimeoutMs !== undefined ||
    options.reviewPassTimeoutMs !== undefined ||
    options.reviewClaudeMaxBudgetUsd !== undefined;
  if (hasReviewOnlyOverride && `${capability}/${action}` !== 'review/code') {
    usageError('review timeout and budget options are only valid for review/code');
  }
  if (
    (options.semanticOnly || options.evidenceManifestFile || options.closureArtifactFile) &&
    `${capability}/${action}` !== 'review/code'
  ) {
    usageError('evidence manifest and closure artifact options are only valid for review/code');
  }
  if (`${capability}/${action}` === 'review/code') {
    if (
      options.reviewClaudeMaxBudgetUsd !== undefined &&
      options.host !== 'claude'
    ) {
      usageError('--review-claude-max-budget-usd requires --host claude');
    }
    if (Boolean(options.workId) !== Boolean(options.ticketId)) {
      usageError('--work-id and --ticket-id must be supplied together');
    }
    try {
      assertValidReviewExecutionOptions(options);
      resolveReviewTimeoutPolicy(options);
    } catch (error) {
      usageError(error instanceof Error ? error.message : String(error));
    }
  }
}

function warnIgnoredOptions(options: WorkflowRunOptions, loop: boolean): void {
  if (!loop && options.maxIterations !== undefined) {
    console.error('--max-iterations is ignored without --loop');
  }
}

function takeValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value) usageError(`${flag} requires a value`);
  return value;
}

function takeNumber(args: string[], index: number, flag: string): number {
  const value = Number.parseInt(takeValue(args, index, flag), 10);
  if (!Number.isInteger(value) || value < 1) usageError(`${flag} requires a positive integer`);
  return value;
}

function takeSeconds(args: string[], index: number, flag: string): number {
  const raw = takeValue(args, index, flag);
  if (!/^\d+$/.test(raw)) {
    usageError(`${flag} requires a whole number of seconds`);
  }
  const seconds = Number(raw);
  if (!Number.isSafeInteger(seconds) || seconds < 60 || seconds > 1800) {
    usageError(`${flag} must be between 60 and 1800 seconds`);
  }
  return seconds * 1000;
}

function takeUsd(args: string[], index: number, flag: string): number {
  const raw = takeValue(args, index, flag);
  if (!/^\d+(?:\.\d+)?$/.test(raw)) {
    usageError(`${flag} requires a decimal dollar amount`);
  }
  const amount = Number(raw);
  if (!Number.isFinite(amount)) {
    usageError(`${flag} requires a finite dollar amount`);
  }
  return amount;
}

function usageError(message: string): never {
  console.error(message);
  usage();
  process.exit(2);
}

function usage(): void {
  console.error('Usage: bun run workflows/run.ts <capability> <action> [--loop] [--max-iterations <n>] [--input <file>] [--base <ref>] [--mode mock|real] [--host mock|claude|codex] [--work-id <id> --ticket-id <id>] [--semantic-only] [--evidence-manifest <file>] [--closure-artifact <initial-review-artifact>] [--review-host-timeout-seconds <60-1800>] [--review-pass-timeout-seconds <60-1800>] [--review-claude-max-budget-usd <0.01-100.00>] [--staged|--worktree|--include-untracked|--diff-file <file>]');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
