import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync,
  readFileSync, readSync, realpathSync, writeFileSync,
} from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { assertValidReviewExecutionOptions, MAX_REVIEW_DIFF_BYTES, MAX_REVIEW_PROMPT_OVERHEAD_BYTES } from '../lib/review-runtime-contract';
import { materializeReviewUntrackedFile } from '../lib/verification-receipt';
import { stateRoot } from './evidence';
import { adapterFor, HostRunError, type HostExecutionPolicy, type HostUsage } from './host-adapter';
import { workflowAssetPath } from './paths';
import { MAX_REVIEW_IMPROVEMENTS, organizeReviewFindings, unwrapFindings } from './review-engine';
import { collectReviewImpactContext, formatReviewImpactContext, impactTelemetry,
  type ReviewDiffInput, type ReviewImpactContext, reviewDiffSchema, reviewInputSchema } from './review-impact';
import { buildReviewPromptTelemetry, coreReviewRules, type RulesBundle } from './review-rules';
import { createReviewTimeBudget, type ReviewTimeBudget, type ReviewTimeoutPolicy } from './review-timeouts';
import { findingsSchema, reviewFindingSetSchema, textSchema } from './schema';
import type {
  EvaluationSignalSnapshot, ReviewFinding, ReviewFindingSet, SeverityCounts, WorkflowContext, WorkflowStep,
} from './types';
import { resolveReviewWorkspace } from './review-workspace';

export type UntrackedDiffState = { includedBytes: number };
const REVIEW_GIT_MAX_BUFFER_BYTES = MAX_REVIEW_DIFF_BYTES + 1024 * 1024;
const REVIEW_FILE_READ_CHUNK_BYTES = 64 * 1024;

type ReviewResult = {
  schemaVersion: 1;
  runId: string;
  mode: 'semantic';
  repository: string;
  source: string;
  changedFiles: string[];
  diffDigest: string;
  findings: ReviewFinding[];
  diagnostics: ReviewFindingSet['diagnostics'];
  omittedImprovementCount: number;
  checksExecuted: string[];
  createdAt: string;
};
const results = new Map<string, ReviewResult>();

export const reviewSteps: WorkflowStep[] = [
  { name: 'collect-diff', kind: 'typed', produces: reviewDiffSchema, run: collectDiff },
  { name: 'collect-impact-context', kind: 'typed', produces: reviewInputSchema, run: collectImpactContext },
  { name: 'run-review', kind: 'llm', produces: findingsSchema, run: runReview },
  { name: 'verify-findings', kind: 'typed', produces: reviewFindingSetSchema, run: verifyFindings },
  { name: 'render-report', kind: 'typed', produces: textSchema, run: renderReport },
];

export function reviewSignalFromOutput(
  output: unknown,
  _ctx: WorkflowContext,
  stepName: string,
): EvaluationSignalSnapshot | undefined {
  if (stepName === 'run-review') return reviewFindingsSignal(findingsSchema.validate(output));
  if (stepName === 'verify-findings') return reviewFindingsSignal(reviewFindingSetSchema.validate(output).findings);
  return undefined;
}

function collectDiff(ctx: WorkflowContext): ReviewDiffInput {
  assertValidReviewExecutionOptions(ctx.options);
  const timeBudget = createReviewTimeBudget(
    ctx.options,
    undefined,
    ctx.passStartedAtMonotonicMs,
  );
  if (ctx.options.diffFile) {
    const file = resolve(ctx.cwd, ctx.options.diffFile);
    const diff = readBoundedRegularFile(
      file,
      MAX_REVIEW_DIFF_BYTES,
      timeBudget,
      'review/code diff file',
    ).toString('utf8');
    return {
      source: `diff-file:${file}`,
      diff,
      changedFiles: changedFilesFromPatch(diff),
    };
  }
  const tracked = collectTrackedDiff(ctx, timeBudget);
  const untracked = (ctx.options.worktree || ctx.options.includeUntracked)
    ? collectUntrackedDiff(ctx, timeBudget)
    : { diff: '', files: [] };
  const diff = [tracked.diff, untracked.diff].filter(Boolean).join('\n');
  assertReviewDiffSize(diff);
  return {
    source: untracked.diff ? `${tracked.source} + untracked` : tracked.source,
    diff,
    changedFiles: normalizedChangedFiles([
      ...tracked.changedFiles,
      ...untracked.files,
    ]),
  };
}

function collectImpactContext(ctx: WorkflowContext) {
  const input = reviewDiffSchema.validate(ctx.input);
  const timeBudget = createReviewTimeBudget(
    ctx.options,
    undefined,
    ctx.passStartedAtMonotonicMs,
  );
  return collectReviewImpactContext(ctx, input, timeBudget);
}

async function runReview(ctx: WorkflowContext): Promise<ReviewFinding[]> {
  const input = reviewInputSchema.validate(ctx.input);
  const repository = resolveReviewWorkspace(ctx.cwd).repositoryRoot;
  const diffDigest = sha256(input.diff);
  const rules = coreReviewRules(ctx.cwd, input.diff, input.changedFiles);
  const budget = createReviewTimeBudget(ctx.options, undefined, ctx.passStartedAtMonotonicMs);
  let findings: ReviewFinding[] = [];
  if (input.diff.trim()) {
    const adapter = adapterFor(reviewHost(ctx));
    const prompt = buildReviewPrompt(ctx, input, rules);
    recordReviewPromptTelemetry(ctx, adapter.name, prompt, rules.bundle, rules.text, input.diff, budget.policy, input.impact);
    let result;
    try {
      result = await adapter.runJson(prompt, findingsEnvelopeJsonSchema, repository, {
        timeoutMs: budget.nextHostTimeoutMs(), claudeMaxBudgetUsd: ctx.options.reviewClaudeMaxBudgetUsd,
      });
    } catch (error) {
      if (error instanceof HostRunError) recordReviewHostUsage(ctx, adapter.name, error.usage, error.executionPolicy);
      throw error;
    }
    recordReviewHostUsage(ctx, adapter.name, result.usage, result.executionPolicy);
    const current = collectDiff(ctx);
    if (sha256(current.diff) !== diffDigest ||
        JSON.stringify(current.changedFiles) !== JSON.stringify(input.changedFiles) ||
        buildReviewPrompt(ctx, input) !== prompt) {
      throw new Error('review scope or policy changed during review; run a new review');
    }
    findings = findingsSchema.validate(unwrapFindings(result.parsed));
  }
  results.set(ctx.runId, {
    schemaVersion: 1, runId: ctx.runId, mode: 'semantic', repository,
    source: input.source, changedFiles: input.changedFiles, diffDigest,
    findings, diagnostics: [], omittedImprovementCount: 0, checksExecuted: [], createdAt: new Date().toISOString(),
  });
  return findings;
}

function verifyFindings(ctx: WorkflowContext): ReviewFindingSet {
  return organizeReviewFindings(findingsSchema.validate(ctx.input));
}

function renderReport(ctx: WorkflowContext): string {
  const result = results.get(ctx.runId);
  if (!result) throw new Error('semantic review result is missing');
  results.delete(ctx.runId);
  Object.assign(result, reviewFindingSetSchema.validate(ctx.input));
  const lines = [
    '# review/code report', '', 'Read-only semantic review: no files were modified.',
    `Scope: ${result.source}.`, `Diff digest: ${result.diffDigest}.`,
    `Changed files: ${result.changedFiles.join(', ') || '(none)'}.`,
    'Tests, builds, browser and live-provider checks were not executed by this review.',
    'Findings are code observations, not reproduced failures. No findings does not establish runtime correctness or deployment readiness.', '',
  ];
  lines.push(...renderFindingSections(result));
  const report = lines.join('\n');
  const dir = join(stateRoot(ctx.options), 'workflow-runs', 'artifacts');
  mkdirSync(dir, { recursive: true });
  const artifact = join(dir, `${ctx.runId}-review.json`);
  const file = join(dir, reportArtifactName(ctx));
  writeFileSync(artifact, `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  writeFileSync(file, `${report}\n`, { flag: 'wx', mode: 0o600 });
  ctx.artifacts.push(artifact, file);
  return report;
}

function renderFindingSections(result: ReviewResult): string[] {
  const defects = result.findings.filter((finding) => finding.kind === 'defect');
  const improvements = result.findings.filter((finding) => finding.kind === 'improvement');
  const empty = !defects.length && !improvements.length && !result.omittedImprovementCount;
  return [
    ...(empty ? [result.changedFiles.length ? 'No findings.' : 'No changes to review.'] : []),
    ...defects.flatMap(renderDefect),
    ...renderImprovements(improvements, result.omittedImprovementCount),
    ...renderDiagnostics(result.diagnostics),
  ];
}

function renderDefect(finding: ReviewFinding): string[] {
  return [
    `- [${finding.severity}] ${finding.summary} — ${findingLocation(finding)}`,
    ...(finding.evidence ? [`  Code observation: ${finding.evidence}`] : []),
    ...(finding.failureScenario ? [`  Trigger and impact: ${finding.failureScenario}`] : []),
    ...(finding.recommendation ? [`  Fix: ${finding.recommendation}`] : []),
    ...renderVerification(finding),
  ];
}

function renderVerification(finding: ReviewFinding): string[] {
  const verification = finding.reproductionStep ?? finding.suggestedVerification;
  return verification ? [`  Suggested verification (not executed): ${verification}`] : [];
}

function renderImprovements(improvements: ReviewFinding[], omitted: number): string[] {
  if (!improvements.length && !omitted) return [];
  return [
    '', '## Design improvements (non-blocking)', '',
    ...improvements.flatMap((finding) => [
      `- [${finding.severity}] ${finding.summary} — ${findingLocation(finding)}`,
      `  Code observation: ${finding.evidence}`,
      `  Recommendation: ${finding.recommendation}`,
      ...renderVerification(finding),
    ]),
    ...(omitted ? [`${omitted} more valid improvement(s) not shown (limit ${MAX_REVIEW_IMPROVEMENTS}).`] : []),
  ];
}

function renderDiagnostics(diagnostics: ReviewFindingSet['diagnostics']): string[] {
  if (!diagnostics.length) return [];
  return ['', '## Discarded findings', '', ...diagnostics.map((diagnostic) =>
    `- [${diagnostic.severity}] ${diagnostic.summary} — ${findingLocation(diagnostic)}: ${diagnostic.reason}`)];
}

function findingLocation(finding: { file: string; line?: number }): string {
  return finding.line ? `${finding.file}:${finding.line}` : finding.file;
}

function collectTrackedDiff(
  ctx: WorkflowContext,
  timeBudget: ReviewTimeBudget,
): ReviewDiffInput {
  const argSets = diffArgSets(ctx, timeBudget);
  const chunks: string[] = [];
  let collectedBytes = 0;
  for (const args of argSets) {
    const result = runReviewGit(ctx, args, timeBudget);
    if (result.status !== 0) throw new Error(result.stderr || 'git diff failed');
    if (result.stdout) {
      collectedBytes += Buffer.byteLength(result.stdout) + (chunks.length > 0 ? 1 : 0);
      if (collectedBytes > MAX_REVIEW_DIFF_BYTES) throw reviewDiffSizeError();
      chunks.push(result.stdout);
    }
  }
  return {
    source: argSets
      .map((args) => `git ${args.filter((arg) => !['--no-ext-diff', '--no-textconv'].includes(arg)).join(' ')}`)
      .join(' && '),
    diff: chunks.join('\n'),
    changedFiles: collectTrackedPaths(ctx, argSets, timeBudget),
  };
}

function collectTrackedPaths(
  ctx: WorkflowContext,
  argSets: string[][],
  timeBudget: ReviewTimeBudget,
): string[] {
  const files: string[] = [];
  for (const args of argSets) {
    const [command, ...rest] = args;
    if (command !== 'diff') throw new Error('review/code internal diff command mismatch');
    const result = runReviewGit(
      ctx,
      ['diff', '--name-only', '-z', ...rest],
      timeBudget,
    );
    if (result.status !== 0) throw new Error(result.stderr || 'git diff --name-only failed');
    files.push(...result.stdout.split('\0').filter(Boolean));
  }
  return normalizedChangedFiles(files);
}

function diffArgSets(
  ctx: WorkflowContext,
  timeBudget: ReviewTimeBudget,
): string[][] {
  if (ctx.options.staged) return [safeDiffArgs('--staged')];
  if (ctx.options.base && ctx.options.worktree) {
    return [safeDiffArgs(mergeBase(ctx, ctx.options.base, timeBudget))];
  }
  const argSets: string[][] = [];
  if (ctx.options.base) argSets.push(safeDiffArgs(`${ctx.options.base}...HEAD`));
  if (ctx.options.worktree) {
    argSets.push(
      ...(hasHead(ctx, timeBudget)
        ? [safeDiffArgs('HEAD')]
        : [safeDiffArgs('--cached'), safeDiffArgs()]),
    );
  }
  return argSets.length > 0 ? argSets : [safeDiffArgs()];
}

function mergeBase(
  ctx: WorkflowContext,
  base: string,
  timeBudget: ReviewTimeBudget,
): string {
  const result = runReviewGit(ctx, ['merge-base', base, 'HEAD'], timeBudget);
  const commit = result.stdout.trim();
  if (result.status !== 0 || !commit) {
    throw new Error(result.stderr || `git merge-base failed for ${base}`);
  }
  return commit;
}

function hasHead(ctx: WorkflowContext, timeBudget: ReviewTimeBudget): boolean {
  const result = runReviewGit(
    ctx,
    ['rev-parse', '--verify', 'HEAD'],
    timeBudget,
  );
  return result.status === 0;
}

function collectUntrackedDiff(
  ctx: WorkflowContext,
  timeBudget: ReviewTimeBudget,
): { diff: string; files: string[] } {
  const result = runReviewGit(
    ctx,
    ['ls-files', '-z', '--others', '--exclude-standard'],
    timeBudget,
  );
  if (result.status !== 0) throw new Error(result.stderr || 'git ls-files failed');
  const state: UntrackedDiffState = { includedBytes: 0 };
  const repositoryRoot = resolveReviewWorkspace(ctx.cwd).repositoryRoot;
  const realRoot = realpathSync(repositoryRoot);
  const chunks: string[] = [];
  const files: string[] = [];
  for (const file of result.stdout.split('\0').filter(Boolean)) {
    timeBudget.assertWithinDeadline();
    const output = untrackedFileDiff(repositoryRoot, realRoot, file, state);
    if (!output) continue;
    chunks.push(output);
    // Keep skipped paths visible so the report does not imply they were inspected.
    files.push(file);
  }
  return { diff: chunks.join('\n'), files: normalizedChangedFiles(files) };
}

function safeDiffArgs(...args: string[]): string[] {
  return ['diff', '--no-ext-diff', '--no-textconv', ...args];
}

function runReviewGit(
  ctx: WorkflowContext,
  args: string[],
  timeBudget: ReviewTimeBudget,
) {
  const result = spawnSync(
    'git',
    ['--no-pager', '-c', 'core.fsmonitor=false', ...args],
    {
      cwd: resolveReviewWorkspace(ctx.cwd).repositoryRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_NO_LAZY_FETCH: '1',
        GIT_OPTIONAL_LOCKS: '0',
      },
      maxBuffer: REVIEW_GIT_MAX_BUFFER_BYTES,
      timeout: timeBudget.remainingPassTimeoutMs(),
    },
  );
  if (result.error) {
    const code = (result.error as NodeJS.ErrnoException).code;
    if (code === 'ETIMEDOUT') {
      throw new Error(
        `review/code pass timed out after ${timeBudget.policy.passTimeoutMs}ms`,
      );
    }
    if (code === 'ENOBUFS') throw reviewDiffSizeError();
    throw result.error;
  }
  return result;
}

export function untrackedFileDiff(
  cwd: string,
  realRoot: string,
  file: string,
  state: UntrackedDiffState,
  beforeOpen: () => void = () => {},
  afterFirstRead: () => void = () => {},
): string {
  return materializeReviewUntrackedFile(
    cwd,
    realRoot,
    file,
    state,
    beforeOpen,
    afterFirstRead,
  );
}

function readBoundedRegularFile(
  file: string,
  maxBytes: number,
  timeBudget: ReviewTimeBudget | undefined,
  label: string,
  beforeOpen: () => void = () => {},
  expectedStat = lstatSync(file),
  afterFirstRead: () => void = () => {},
): Buffer {
  if (expectedStat.isSymbolicLink() || !expectedStat.isFile()) {
    throw new Error(`${label} must be a regular file: ${file}`);
  }
  if (expectedStat.size > maxBytes) throw reviewDiffSizeError(label, maxBytes);

  beforeOpen();
  const flags = constants.O_RDONLY |
    (constants.O_NOFOLLOW ?? 0) |
    (constants.O_NONBLOCK ?? 0);
  let fd: number | undefined;
  try {
    fd = openSync(file, flags);
    const openedStat = fstatSync(fd);
    if (!sameFileVersion(openedStat, expectedStat)) {
      throw new Error(`${label} changed while it was being opened: ${file}`);
    }
    if (openedStat.size > maxBytes) throw reviewDiffSizeError(label, maxBytes);
    const buffer = readDescriptorWithinLimit(
      fd,
      maxBytes,
      timeBudget,
      label,
      afterFirstRead,
    );
    if (!sameFileVersion(fstatSync(fd), openedStat)) {
      throw new Error(`${label} changed while it was being read: ${file}`);
    }
    return buffer;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function readDescriptorWithinLimit(
  fd: number,
  maxBytes: number,
  timeBudget: ReviewTimeBudget | undefined,
  label: string,
  afterFirstRead: () => void,
): Buffer {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  while (true) {
    timeBudget?.assertWithinDeadline();
    const remainingWithSentinel = (maxBytes + 1) - totalBytes;
    if (remainingWithSentinel <= 0) throw reviewDiffSizeError(label, maxBytes);
    const chunk = Buffer.allocUnsafe(
      Math.min(REVIEW_FILE_READ_CHUNK_BYTES, remainingWithSentinel),
    );
    const bytesRead = readSync(fd, chunk, 0, chunk.length, null);
    if (bytesRead === 0) break;
    totalBytes += bytesRead;
    if (totalBytes > maxBytes) throw reviewDiffSizeError(label, maxBytes);
    chunks.push(chunk.subarray(0, bytesRead));
    if (chunks.length === 1) afterFirstRead();
  }
  timeBudget?.assertWithinDeadline();
  return Buffer.concat(chunks, totalBytes);
}

function sameFileVersion(
  left: ReturnType<typeof fstatSync>,
  right: ReturnType<typeof fstatSync>,
): boolean {
  return left.isFile() &&
    right.isFile() &&
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs;
}

function assertReviewDiffSize(diff: string): void {
  if (Buffer.byteLength(diff) > MAX_REVIEW_DIFF_BYTES) throw reviewDiffSizeError();
}

function reviewDiffSizeError(
  label = 'review/code diff',
  maxBytes = MAX_REVIEW_DIFF_BYTES,
): Error {
  return new Error(
    `${label} exceeds ${maxBytes} byte limit; narrow the review scope with --staged, --base, or --diff-file`,
  );
}


function reviewHost(ctx: WorkflowContext): 'mock' | 'claude' | 'codex' {
  if (ctx.options.mode !== 'real') return 'mock';
  if (ctx.options.host === 'claude' || ctx.options.host === 'codex') return ctx.options.host;
  throw new Error('--mode real requires --host claude or --host codex');
}

function buildReviewPolicyText(ctx: WorkflowContext, rules: ReturnType<typeof coreReviewRules>): string {
  return [
    readReviewAsset('shared-rubric.md'),
    readReviewAsset('checklist.md'),
    'APPLICABLE_GOLDBAND_RULES_START',
    rules.text,
    'APPLICABLE_GOLDBAND_RULES_END',
    'Inspect applicable AGENTS.md and CLAUDE.md files in the repository root and touched-file ancestors as review policy.',
    'Inspect code, tests and existing verification results. Do not run candidate code, prepare dependencies, mutate the repository, or claim reproduced failures. State inaccessible context and unexecuted checks.',
    'Trace the original requirement and failure path, producers and consumers, registration, negative cases, concurrency and scaling where relevant. Require exact source locations, concrete triggers, expected versus actual results, and practical impact.',
    'Use the diff to define scope. Inspect repository context outside the diff when needed to verify wiring, authoritative ownership, consumers, registrations, and dead code.',
  ].join('\n');
}

type ReviewPromptInput = Pick<ReviewDiffInput, 'diff' | 'changedFiles'> & { impact?: ReviewImpactContext };

export function buildReviewPrompt(
  ctx: WorkflowContext,
  input: ReviewPromptInput,
  rules = coreReviewRules(ctx.cwd, input.diff, input.changedFiles),
): string {
  const { diff } = input;
  const sections = [buildReviewPolicyText(ctx, rules),
    input.impact ? formatReviewImpactContext(input.impact) : '', 'DIFF_START', diff, 'DIFF_END'];
  const prompt = sections.join('\n');
  if (Buffer.byteLength(prompt) - Buffer.byteLength(diff) > MAX_REVIEW_PROMPT_OVERHEAD_BYTES) {
    throw new Error('review prompt overhead exceeds budget');
  }
  assertReviewDiffSize(diff);
  return prompt;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function recordReviewPromptTelemetry(
  ctx: WorkflowContext,
  host: string,
  corePrompt: string,
  coreBundle: RulesBundle,
  coreRulesText: string,
  diff: string,
  timeoutPolicy: ReviewTimeoutPolicy,
  impact: ReviewImpactContext,
): void {
  const telemetry = {
    ...buildReviewPromptTelemetry({
      host,
      corePrompt,
      coreBundle,
      coreRulesText,
      diff,
    }),
    mode: 'semantic',
    hostCallBudget: 1,
    hostCallCount: 1,
    originalDiffBytesSent: Buffer.byteLength(diff),
    hostTimeoutMs: timeoutPolicy.hostTimeoutMs,
    passTimeoutMs: timeoutPolicy.passTimeoutMs,
    impactPromptBytes: Buffer.byteLength(formatReviewImpactContext(impact)),
    staticReviewCriteriaBytes: Buffer.byteLength(
      `${readReviewAsset('shared-rubric.md')}\n${readReviewAsset('checklist.md')}`,
    ),
    ...impactTelemetry(impact),
  };
  const dir = join(stateRoot(ctx.options), 'workflow-runs', 'telemetry');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${ctx.runId}-review-prompt.json`);
  writeFileSync(file, `${JSON.stringify(telemetry, null, 2)}\n`);
}

function recordReviewHostUsage(
  ctx: WorkflowContext,
  host: string,
  usage?: HostUsage,
  executionPolicy?: HostExecutionPolicy,
): void {
  const dir = join(stateRoot(ctx.options), 'workflow-runs', 'telemetry');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${ctx.runId}-review-host-usage.json`);
  writeFileSync(
    file,
    `${JSON.stringify({
      host,
      available: Boolean(usage),
      ...(executionPolicy ? { executionPolicy } : {}),
      ...usage,
    }, null, 2)}\n`,
  );
}

function readReviewAsset(name: string): string {
  return readFileSync(workflowAssetPath(`review/${name}`), 'utf8');
}

export function changedFilesFromPatch(diff: string): string[] {
  const files: string[] = [];
  let oldPath: string | undefined;
  for (const line of diff.split('\n')) {
    if (line.startsWith('--- ')) {
      oldPath = patchHeaderPath(line.slice(4));
      continue;
    }
    if (!line.startsWith('+++ ')) continue;
    const newPath = patchHeaderPath(line.slice(4));
    const file = newPath ?? oldPath;
    if (file) files.push(file);
    oldPath = undefined;
  }
  return normalizedChangedFiles(files);
}

function patchHeaderPath(raw: string): string | undefined {
  const token = raw.startsWith('"')
    ? decodeGitQuotedPath(raw)
    : raw.split('\t', 1)[0];
  if (!token || token === '/dev/null') return undefined;
  if (token.startsWith('a/') || token.startsWith('b/')) return token.slice(2);
  return token;
}

function decodeGitQuotedPath(raw: string): string {
  const bytes: number[] = [];
  for (let index = 1; index < raw.length; index += 1) {
    const char = raw[index];
    if (char === '"') break;
    if (char !== '\\') {
      bytes.push(...Buffer.from(char));
      continue;
    }
    const escape = raw[++index];
    if (escape === undefined) break;
    const simple = new Map<string, number>([
      ['a', 0x07], ['b', 0x08], ['t', 0x09], ['n', 0x0a],
      ['v', 0x0b], ['f', 0x0c], ['r', 0x0d], ['\\', 0x5c], ['"', 0x22],
    ]);
    const decoded = simple.get(escape);
    if (decoded !== undefined) {
      bytes.push(decoded);
      continue;
    }
    if (/[0-7]/.test(escape)) {
      let octal = escape;
      while (octal.length < 3 && /[0-7]/.test(raw[index + 1] ?? '')) {
        octal += raw[++index];
      }
      bytes.push(Number.parseInt(octal, 8));
      continue;
    }
    bytes.push(...Buffer.from(escape));
  }
  return Buffer.from(bytes).toString('utf8');
}

function normalizedChangedFiles(files: string[]): string[] {
  return [...new Set(files.map((file) => file.replaceAll('\\', '/')).filter(Boolean))].sort();
}

function reviewFindingsSignal(findings: ReviewFinding[]): EvaluationSignalSnapshot {
  const blockingFindings = findings.filter((finding) => finding.kind === 'defect');
  const severityCounts = emptySeverityCounts();
  for (const finding of blockingFindings) severityCounts[finding.severity] += 1;
  return {
    kind: 'review-findings',
    findingCount: blockingFindings.length,
    severityCounts,
    blockerKey: blockingFindings.length > 0 ? blockingFindings.map(findingKey).sort().join('|') : undefined,
  };
}

function emptySeverityCounts(): SeverityCounts {
  return { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
}

function findingKey(finding: ReviewFinding): string {
  return [
    finding.file,
    finding.line ?? '',
    finding.severity,
    normalizeEvidenceKey(finding.evidence),
  ].join(':');
}

function reportArtifactName(ctx: WorkflowContext): string {
  const name = basename(ctx.workflow.name);
  return `${ctx.runId}-${name}.md`;
}

function normalizeEvidenceKey(value: string | undefined): string {
  if (!value) return 'no-evidence';
  const snippets = Array.from(value.matchAll(/`([^`]+)`/g), (match) => match[1]);
  const source = snippets.length > 0 ? snippets.join(' ') : value;
  const tokens = Array.from(source.matchAll(/[A-Za-z_$][A-Za-z0-9_$-]*/g), (match) => match[0].toLowerCase())
    .filter((token) => !EVIDENCE_KEY_STOPWORDS.has(token));
  const unique = [...new Set(tokens)].sort();
  if (unique.length > 0) return unique.join(' ');
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

const EVIDENCE_KEY_STOPWORDS = new Set([
  'a',
  'add',
  'added',
  'adds',
  'and',
  'as',
  'contains',
  'declaration',
  'define',
  'definition',
  'diff',
  'export',
  'file',
  'for',
  'function',
  'import',
  'inside',
  'local',
  'no',
  'or',
  'return',
  'shown',
  'still',
  'symbol',
  'the',
  'this',
  'true',
  'updated',
  'visible',
  'with',
]);

const findingsJsonSchema = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      id: { type: ['string', 'null'] },
      kind: { enum: ['defect', 'improvement'] },
      file: { type: 'string' },
      line: { type: ['number', 'null'] },
      severity: { enum: ['critical', 'high', 'medium', 'low', 'info'] },
      summary: { type: 'string' },
      evidence: { type: ['string', 'null'] },
      recommendation: { type: ['string', 'null'] },
      category: { type: ['string', 'null'] },
      ruleId: { type: ['string', 'null'] },
      policySource: { type: ['string', 'null'] },
      failureScenario: { type: ['string', 'null'] },
      suggestedVerification: { type: ['string', 'null'] },
      blocking: { type: ['boolean', 'null'] },
      reproductionStep: { type: ['string', 'null'] },
    },
    required: [
      'id',
      'kind',
      'file',
      'line',
      'severity',
      'summary',
      'evidence',
      'recommendation',
      'category',
      'ruleId',
      'policySource',
      'failureScenario',
      'suggestedVerification',
      'blocking',
      'reproductionStep',
    ],
    additionalProperties: false,
  },
};

const findingsEnvelopeJsonSchema = {
  type: 'object', properties: { findings: findingsJsonSchema },
  required: ['findings'], additionalProperties: false,
};
