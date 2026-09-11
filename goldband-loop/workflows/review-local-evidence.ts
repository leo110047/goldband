import { localReviewPythonPath } from './review-python-tools';
import { REVIEW_HOST_EVIDENCE_POLICY } from '../lib/review-runtime-contract';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { superviseCommand } from '../scripts/process-supervisor.mjs';
import { isReviewCiProvider, REVIEW_CI_LANE } from './review-ci-evidence';
import type { CandidateBinding, ReviewEvidenceManifest, ReviewEvidenceRecord } from './review-evidence';

type Provider = ReviewEvidenceManifest['providers'][number];
export const REVIEW_LOCAL_LANE = REVIEW_HOST_EVIDENCE_POLICY.reviewLocalEvidenceLane;

export function isReviewLocalProvider(provider: Provider): boolean {
  return provider.kind === 'project-gate' && provider.lifecycle === 'persistent' &&
    provider.executionContext.runner === 'local-host' &&
    provider.executionContext.sandboxOwner === 'provider' &&
    provider.executionContext.lane === REVIEW_LOCAL_LANE && isReviewCiProvider(baseCiRecipe(provider)) &&
    provider.operations[0]!.network === 'host' && !provider.operations[0]!.authorizationId;
}

// The local review suite retains every CI test and may add the owner/retry regressions.
function baseCiRecipe(provider: Provider): Provider {
  const operation = provider.operations[0];
  if (provider.id !== 'review-evidence-tests' || operation?.argv.at(-1) !== 'test/review-lineage.test.ts') return provider;
  return { ...provider, operations: [{ ...operation, argv: operation.argv.slice(0, -1) }, ...provider.operations.slice(1)] };
}

export function assertLocalReviewProvider(provider: Provider): void {
  const local = provider.executionContext.runner === 'local-host' || provider.operations.some((op) => op.network === 'host');
  if (local && !isReviewLocalProvider(provider)) throw new Error('host network policy is restricted to the named local review self-tests');
}

/** Only the named Goldband self-tests may move from post-push CI to the local host. */
export function isReviewLocalMigration(before: Provider | undefined, after: Provider | undefined): boolean {
  if (!before || !after) return false;
  if (before.executionContext.runner !== 'github-actions' ||
      before.executionContext.lane !== REVIEW_CI_LANE || !isReviewCiProvider(before) ||
      before.operations[0]!.network !== 'deny' || !isReviewLocalProvider(after) ||
      after.operations[0]!.timeoutMs < before.operations[0]!.timeoutMs) return false;
  return stable(before) === stable({
    ...after, executionContext: before.executionContext,
    operations: [{ ...after.operations[0], argv: baseCiRecipe(after).operations[0]!.argv, network: 'deny', timeoutMs: before.operations[0]!.timeoutMs }],
  });
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value)
    .filter(([, entry]) => entry !== undefined).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stable(entry)}`).join(',')}}`;
  return JSON.stringify(value);
}

function hash(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

type LocalOperation = {
  provider: Provider;
  operation: Provider['operations'][number];
  snapshotRoot: string;
  runnerRoot: string;
  binding: CandidateBinding;
  dependencyDigest: string;
  executionOffset: string;
};

/** Native host self-tests own their nested Seatbelt probes; this is not a sealed runner. */
export async function runLocalReviewEvidence(options: LocalOperation, snapshotDigest: () => string): Promise<ReviewEvidenceRecord> {
  const { provider, operation, binding } = options;
  if (!isReviewLocalProvider(provider) || options.executionOffset !== '') {
    throw new Error('local review host requires a named Goldband self-test at the repository root');
  }
  const home = join(options.runnerRoot, 'home');
  const temporary = join(options.runnerRoot, 'tmp');
  mkdirSync(home, { recursive: true, mode: 0o700 });
  mkdirSync(temporary, { recursive: true, mode: 0o700 });
  const before = snapshotDigest();
  const executableDigest = hash(readFileSync(process.execPath));
  const output = createHash('sha256');
  const diagnostics = localPrerequisiteDiagnostics();
  const startedAt = new Date().toISOString();
  const tools = localPythonPrerequisites(options);
  if (tools.error) { diagnostics.write(tools.error); output.update(tools.error); }
  const result = tools.error ? { exitCode: 1, reason: 'prerequisite-unavailable', stdout: '', stderr: tools.error } : await superviseCommand(process.execPath, operation.argv.slice(1), {
    cwd: options.snapshotRoot,
    env: {
      PATH: [...tools.directories, dirname(process.execPath), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(':'),
      HOME: home, TMPDIR: temporary, TMP: temporary, TEMP: temporary,
      GOLDBAND_HOME: join(home, '.goldband'), LANG: 'C.UTF-8', CI: '1',
      GOLDBAND_REQUIRE_REVIEW_HOST_BOUNDARY: '1',
    },
    timeoutMs: operation.timeoutMs, killGraceMs: 1000, killConfirmMs: 2000,
    captureOutput: { stdoutMaxBytes: operation.maxOutputBytes, stderrMaxBytes: operation.maxOutputBytes },
    label: `local review self-test ${provider.id}`,
    stdout: { write: (chunk: string) => { output.update(chunk); diagnostics.write(chunk); } },
    stderr: { write: (chunk: string) => { output.update(chunk); diagnostics.write(chunk); } },
  });
  const after = snapshotDigest();
  const environmentUnavailable = result.exitCode !== 0 && diagnostics.unavailable();
  const complete = !environmentUnavailable && result.reason === 'exit' && before === after &&
    executableDigest === hash(readFileSync(process.execPath));
  const status = localEvidenceStatus(complete, result.exitCode);
  const summary = localEvidenceSummary(result, complete, before === after, environmentUnavailable);
  return {
    id: `${provider.id}:${operation.id}`, providerId: provider.id, operationId: operation.id,
    cellIds: [...provider.cellIds], owner: provider.owner, kind: provider.kind,
    status, evidenceLevel: operation.evidenceLevel, environment: 'local-host/macos-self-tests',
    commandDigest: hash(stable({ argv: operation.argv, cwd: '.', network: operation.network })),
    executionIdentityDigest: hash(stable({ binding, provider, executableDigest, dependencyDigest: options.dependencyDigest })),
    snapshotDigestBefore: before, snapshotDigestAfter: after, replayCommand: [...operation.argv],
    startedAt, finishedAt: new Date().toISOString(),
    exitStatus: result.reason === 'exit' ? result.exitCode : undefined,
    outputDigest: output.digest('hex'), outputSummary: new TextDecoder().decode(Buffer.from(summary).subarray(0, operation.maxOutputBytes), { stream: true }),
    candidateDigest: binding.candidateDigest, baseDigest: binding.baseDigest, scopeDigest: binding.scopeDigest,
    fresh: complete,
  };
}

function localEvidenceStatus(complete: boolean, exitCode: number): ReviewEvidenceRecord['status'] {
  if (!complete) return 'runtime-incomplete';
  return exitCode === 0 ? 'verified-pass' : 'verified-failure';
}

function localEvidenceSummary(result: { stdout?: string; stderr?: string; reason: string }, complete: boolean, unchanged: boolean, environmentUnavailable: boolean): string {
  const detail = environmentUnavailable ? 'native host self-test prerequisite unavailable' : result.reason;
  return `Native local host self-tests; writable candidate copy, host network policy, no CI requirement.\n${result.stdout ?? ''}${result.stderr ?? ''}\n${complete ? '' : `Incomplete: ${detail}; candidate unchanged=${unchanged}`}`;
}

function localPrerequisiteDiagnostics() {
  let tail = '';
  let unavailable = false;
  return {
    write(chunk: string) {
      const text = tail + chunk;
      if (text.includes('required review host boundary prerequisite is unavailable') ||
          text.includes('sandbox-exec: sandbox_apply: Operation not permitted')) unavailable = true;
      tail = text.slice(-128);
    },
    unavailable: () => unavailable,
  };
}

function localPythonPrerequisites(options: LocalOperation): { directories: string[]; error?: string } {
  if (!['review-evidence-tests', 'installed-runtime-tests'].includes(options.provider.id)) return { directories: [] };
  try {
    return { directories: localReviewPythonPath(options.binding.repository) };
  } catch (error) {
    return { directories: [], error: `required review host boundary prerequisite is unavailable: ${error instanceof Error ? error.message : String(error)}` };
  }
}
