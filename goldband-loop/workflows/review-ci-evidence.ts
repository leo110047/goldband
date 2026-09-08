import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync, readlinkSync } from 'node:fs';
import { join } from 'node:path';
import type { ReviewEvidenceManifest } from './review-evidence';

type Provider = ReviewEvidenceManifest['providers'][number];
const REPOSITORY = 'leo110047/goldband';
const WORKFLOW = '.github/workflows/validate.yml';
export const REVIEW_CI_LANE = 'goldband-macos-review-host';
// Trusted runtime policy, deliberately not loaded from the candidate manifest.
const WORKFLOW_DIGEST = 'f4fbe58bcacb001e441f6ad6427d2e7c43b48ae419b4a0657d527e62cb5a433f';
const RECIPES: Record<string, { operation: string; files: string[] }> = {
  'review-evidence-tests': { operation: 'candidate-green', files: ['test/review-evidence.test.ts', 'test/review-evidence-platform.test.ts'] },
  'work-map-review-tests': { operation: 'candidate-work-map-review', files: ['test/work-map-review.test.ts'] },
  'installed-runtime-tests': { operation: 'candidate-installed-runtime', files: ['test/codex-review-launcher-install.test.ts', 'test/review-receipt-authority-install.test.ts'] },
};

export type ReviewCiProvenance = {
  repository: string;
  workflow: string;
  workflowDigest: string;
  revision: string;
  tree: string;
  runId: number;
  attempt: number;
  jobId: number;
  step: string;
  conclusion: 'success';
};

function hash(value: string | Buffer, algorithm = 'sha256'): string {
  return createHash(algorithm).update(value).digest('hex');
}

export function isReviewCiProvider(provider: Provider): boolean {
  const recipe = Object.hasOwn(RECIPES, provider.id) ? RECIPES[provider.id] : undefined;
  const operation = provider.operations[0];
  return Boolean(recipe && provider.operations.length === 1 && operation &&
    operation.id === recipe.operation && operation.target === 'candidate' &&
    operation.expectedExit === 'zero' && operation.evidenceLevel === 'local' &&
    JSON.stringify(operation.argv) === JSON.stringify(['bun', 'test', '--cwd', 'goldband-loop', ...recipe.files]));
}

export function isReviewCiMigration(before: Provider, after: Provider): boolean {
  return before.id === after.id && isReviewCiProvider(before) && isReviewCiProvider(after) &&
    before.executionContext.runner === 'host-seatbelt' &&
    before.executionContext.sandboxOwner === 'provider' &&
    before.executionContext.lane === 'macos-review-contract-host' &&
    after.executionContext.runner === 'github-actions' &&
    after.executionContext.sandboxOwner === 'provider' && after.executionContext.lane === REVIEW_CI_LANE;
}

// Hash the materialized candidate as Git does, without invoking candidate filters,
// hooks, an index, or writing to the user's repository. Empty directories are not Git entries.
export function reviewCandidateTree(root: string): string {
  const entries = readdirSync(root).map((name) => candidateTreeEntry(root, name))
    .filter((entry) => entry !== undefined).sort((a, b) => Buffer.compare(a.sort, b.sort));
  const content = Buffer.concat(entries.map((entry) => entry.content));
  return hash(Buffer.concat([Buffer.from(`tree ${content.length}\0`), content]), 'sha1');
}

function candidateTreeEntry(root: string, name: string) {
  const path = join(root, name);
  const stat = lstatSync(path);
  const directory = stat.isDirectory();
  let mode: string;
  let digest: string;
  if (directory) {
    mode = '40000';
    digest = reviewCandidateTree(path);
    if (digest === hash('tree 0\0', 'sha1')) return undefined;
  } else {
    ({ mode, digest } = candidateBlob(path));
  }
  return { sort: Buffer.from(name + (directory ? '/' : '')), content: Buffer.concat([Buffer.from(`${mode} ${name}\0`), Buffer.from(digest, 'hex')]) };

}

function candidateBlob(path: string): { mode: string; digest: string } {
  const stat = lstatSync(path);
  if (!stat.isFile() && !stat.isSymbolicLink()) throw new Error('CI candidate contains an unsupported file type');
  const mode = stat.isSymbolicLink() ? '120000' : (stat.mode & 0o111) ? '100755' : '100644';
  const content = stat.isSymbolicLink() ? Buffer.from(readlinkSync(path)) : readFileSync(path);
  return { mode, digest: hash(Buffer.concat([Buffer.from(`blob ${content.length}\0`), content]), 'sha1') };
}

function git(cwd: string, argv: string[]): string {
  const result = spawnSync('git', argv, { cwd, encoding: 'utf8', timeout: 10_000 });
  if (result.status !== 0) throw new Error('CI evidence cannot resolve the local candidate commit');
  return result.stdout.trim();
}

type Json = Record<string, unknown>;
function object(value: unknown): Json {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid GitHub evidence response');
  return value as Json;
}
function list(value: unknown): Json[] {
  if (!Array.isArray(value)) throw new Error('Invalid GitHub evidence list');
  return value.map(object);
}
function positive(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new Error('Invalid GitHub evidence identity');
  return Number(value);
}

async function github(path: string): Promise<Json> {
  const response = await fetch(`https://api.github.com/repos/${REPOSITORY}/${path}`, {
    headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    redirect: 'error', signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`GitHub evidence read failed: HTTP ${response.status}`);
  const reader = response.body?.getReader();
  if (!reader) throw new Error('GitHub evidence response has no body');
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > 2 * 1024 * 1024) throw new Error('GitHub evidence response exceeds limit');
      chunks.push(next.value);
    }
  } finally { await reader.cancel(); }
  return object(JSON.parse(Buffer.concat(chunks).toString('utf8')));
}

function validateRun(run: Json, revision: string): void {
  if (run.head_sha !== revision || run.path !== WORKFLOW || run.event !== 'push' ||
      run.head_branch !== 'dev' || object(run.repository).full_name !== REPOSITORY ||
      object(run.head_repository).full_name !== REPOSITORY) {
    throw new Error('GitHub evidence run does not match the trusted repository, workflow, branch and candidate');
  }
  positive(run.id);
  positive(run.run_attempt);
}

// The transport seam accepts platform responses, never a caller-authored evidence file.
export async function readReviewCiResult(
  revision: string, tree: string, providerId: string,
  read: (path: string) => Promise<Json> = github,
): Promise<ReviewCiProvenance> {
  if (!/^[a-f0-9]{40}$/.test(revision) || !/^[a-f0-9]{40}$/.test(tree) || !Object.hasOwn(RECIPES, providerId)) {
    throw new Error('Unsupported CI evidence candidate or provider');
  }
  const commit = await read(`git/commits/${revision}`);
  if (commit.sha !== revision || object(commit.tree).sha !== tree) {
    throw new Error('GitHub commit tree does not match the exact materialized candidate');
  }
  const runs = list((await read(`actions/workflows/validate.yml/runs?head_sha=${revision}&event=push&branch=dev&per_page=100`)).workflow_runs);
  for (const run of runs) validateRun(run, revision);
  const run = runs.sort((a, b) => positive(b.id) - positive(a.id))[0];
  if (!run || run.status !== 'completed') throw new Error('Exact candidate CI evidence is missing or still running');
  const runId = positive(run.id);
  const attempt = positive(run.run_attempt);
  const stepName = `Review evidence - ${providerId}`;
  const jobId = await successfulReviewStep({ read, runId, attempt, revision, stepName });
  const current = await read(`actions/runs/${runId}`);
  validateRun(current, revision);
  if (current.id !== runId || current.run_attempt !== attempt || current.status !== 'completed') {
    throw new Error('CI evidence run changed while being read');
  }
  return { repository: REPOSITORY, workflow: WORKFLOW, workflowDigest: WORKFLOW_DIGEST,
    revision, tree, runId, attempt, jobId, step: stepName, conclusion: 'success' };
}

export async function collectReviewCiEvidence(
  repositoryRoot: string, candidateRoot: string, provider: Provider, executionOffset: string,
): Promise<ReviewCiProvenance> {
  if (!isReviewCiProvider(provider) || provider.executionContext.runner !== 'github-actions' ||
      provider.executionContext.lane !== REVIEW_CI_LANE || executionOffset) {
    throw new Error('Unsupported Goldband CI evidence recipe or invocation directory');
  }
  const remote = git(repositoryRoot, ['remote', 'get-url', 'origin']);
  if (![`https://github.com/${REPOSITORY}.git`, `https://github.com/${REPOSITORY}`, `git@github.com:${REPOSITORY}.git`].includes(remote)) {
    throw new Error('CI evidence requires the authoritative Goldband repository');
  }
  if (hash(readFileSync(join(candidateRoot, WORKFLOW))) !== WORKFLOW_DIGEST) {
    throw new Error('CI workflow differs from the recipe trusted by this runtime; update and review the runtime recipe explicitly');
  }
  const revision = git(repositoryRoot, ['rev-parse', 'HEAD']);
  const tree = reviewCandidateTree(candidateRoot);
  if (tree !== git(repositoryRoot, ['--no-replace-objects', 'rev-parse', `${revision}^{tree}`])) {
    throw new Error('CI evidence requires the exact candidate to be committed and tested on dev; dirty candidate has no matching CI evidence');
  }
  return readReviewCiResult(revision, tree, provider.id);
}

export function validateReviewCiProvenance(value: ReviewCiProvenance, providerId: string): void {
  if (value.repository !== REPOSITORY || value.workflow !== WORKFLOW || !/^[a-f0-9]{64}$/.test(value.workflowDigest) ||
      !/^[a-f0-9]{40}$/.test(value.revision) || !/^[a-f0-9]{40}$/.test(value.tree) ||
      !Object.hasOwn(RECIPES, providerId) || value.step !== `Review evidence - ${providerId}` || value.conclusion !== 'success') {
    throw new Error('Invalid persisted CI evidence provenance');
  }
  positive(value.runId); positive(value.attempt); positive(value.jobId);
}

async function successfulReviewStep(options: {
  read: (path: string) => Promise<Json>; runId: number; attempt: number; revision: string; stepName: string;
}): Promise<number> {
  const { read, runId, attempt, revision, stepName } = options;
  const response = await read(`actions/runs/${runId}/attempts/${attempt}/jobs?per_page=100`);
  const jobs = list(response.jobs);
  if (response.total_count !== jobs.length) throw new Error('CI job evidence is truncated');
  const matches = jobs.filter((job) => job.name === 'macOS Seatbelt review evidence contracts');
  if (matches.length !== 1) throw new Error('CI evidence job is missing or ambiguous');
  const job = matches[0]!;
  if (job.run_id !== runId || job.head_sha !== revision || job.status !== 'completed') throw new Error('CI evidence job identity is mismatched');
  const steps = list(job.steps).filter((step) => step.name === stepName);
  if (steps.length !== 1 || steps[0]!.status !== 'completed' || steps[0]!.conclusion !== 'success') {
    throw new Error(`CI step ${stepName} has no successful execution evidence; inspect the CI run`);
  }
  return positive(job.id);
}
