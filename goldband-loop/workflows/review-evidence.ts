import { spawnSync } from 'node:child_process';
import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import {
  accessSync,
  chmodSync,
  closeSync,
  constants,
  copyFileSync,
  cpSync,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  readSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
  type Dirent,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { ReviewDiffInput } from './review-impact';
import type {
  ReviewClosureResult,
  ReviewFinding,
  ReviewFindingClassification,
  SchemaValidator,
  WorkflowContext,
} from './types';
import { MAX_REVIEW_DIFF_BYTES, REVIEW_HOST_EVIDENCE_POLICY } from '../lib/review-runtime-contract';
import { SECRET_CONTENT_RULES } from '../lib/secret-content';
import {
  EVIDENCE_SANDBOX_ACTIVE_ENV,
  EVIDENCE_TEMP_ROOT_ENV,
} from '../lib/evidence-runtime-contract';
import { superviseCommand } from '../scripts/process-supervisor.mjs';
import { stateRoot } from './evidence';
import type { ReviewContractResolution } from './review-contract-resolution';
import {
  reviewContractChanges,
  reviewOperationBoundary,
  type ReviewContractAssessment,
  type ReviewContractReview,
} from './review-contract-changes';
import {
  evidenceSandboxCommand,
  isEvidenceSandboxRuntimeFailure,
  createCompilerOutputDiagnosticCapture,
  sealedEvidenceExecutionUnavailable,
} from './review-evidence-sandbox';
import { resolveReviewWorkspace, workspacePath } from './review-workspace';
import { assertLocalReviewProvider, isReviewLocalMigration, isReviewLocalProvider, REVIEW_LOCAL_LANE, runLocalReviewEvidence } from './review-local-evidence';
import { collectReviewCiEvidence, isReviewCiMigration, isReviewCiProvider, REVIEW_CI_LANE, validateReviewCiProvenance, type ReviewCiProvenance } from './review-ci-evidence';

export { isEvidenceSandboxRuntimeFailure } from './review-evidence-sandbox';

const REVIEW_EVIDENCE_SCHEMA_VERSION = 1;
const REVIEW_EVIDENCE_MANIFEST_SCHEMA_VERSION = 2;
const MAX_REVIEW_EVIDENCE_OUTPUT_BYTES = 64 * 1024;
const MAX_REVIEW_EVIDENCE_TOTAL_BYTES = 1024 * 1024;
const MAX_REVIEW_EVIDENCE_OPERATIONS = 64;
const MAX_EVIDENCE_RUNTIME_DIAGNOSTIC_CHARS = 16 * 1024;
const DEFAULT_REVIEW_EVIDENCE_MANIFEST = 'goldband.review-evidence.json';
const EVIDENCE_RUNNER_POLICY = 'per-operation-sealed-runtime-readonly-snapshot-default-deny-read-write-network-v57';
// coverage.py 7.15.4's conditional process_startup(slug="pth") hook. Review
// changed hook bytes before extending support; package ownership alone cannot
// authorize arbitrary startup code. Keep the hook for subprocess measurement.
const COVERAGE_STARTUP_PTH_SHA256 = 'ef2ed06d19867ec669c09a804060666a9cd5e383af0a9d11aa2de79b77d448e8';
const MAX_REDACTED_UNTRACKED_BYTES = 256 * 1024;
const REVIEW_RECEIPT_TRUSTED_CONFIG_ENV = 'GOLDBAND_REVIEW_RECEIPT_TRUSTED_CONFIG';
const SUPPORTED_REVIEW_HOST_EVIDENCE_LANE = REVIEW_HOST_EVIDENCE_POLICY.reviewHostEvidenceLane;
const executableDigestCache = new Map<string, string>();
const mockReviewReceiptAuthorityKey = randomBytes(32);

const DISPOSITIONS = new Set<CellDisposition>([
  'automated',
  'static',
  'runtime-readback',
  'manual',
  'not-applicable',
  'unsupported',
]);
const RISKS = new Set<BehaviorRisk>(['low', 'medium', 'high']);
const KINDS = new Set<EvidenceProviderKind>([
  'regression',
  'static',
  'project-gate',
  'property-fuzz',
  'runtime-integration',
]);
const LEVELS = new Set<EvidenceLevel>([
  'fixture',
  'local',
  'sandboxed-service',
  'live-provider',
  'device-platform',
  'production-readback',
]);
const FINDING_CLASSIFICATIONS = new Set<ReviewFindingClassification>([
  'verified-failure',
  'coverage-gap',
  'semantic-concern',
  'runtime-incomplete',
]);
const EVIDENCE_RECORD_STATUSES = new Set<EvidenceRecordStatus>([
  'verified-pass',
  'verified-failure',
  'coverage-gap',
  'runtime-incomplete',
]);
const CLOSURE_STATUSES = new Set([
  'closed',
  'still-open',
  'direct-regression',
  'evidence-incomplete',
]);

type CellDisposition =
  | 'automated'
  | 'static'
  | 'runtime-readback'
  | 'manual'
  | 'not-applicable'
  | 'unsupported';
type BehaviorRisk = 'low' | 'medium' | 'high';
type EvidenceProviderKind =
  | 'regression'
  | 'static'
  | 'project-gate'
  | 'property-fuzz'
  | 'runtime-integration';
export type EvidenceLevel =
  | 'fixture'
  | 'local'
  | 'sandboxed-service'
  | 'live-provider'
  | 'device-platform'
  | 'production-readback';

type BehaviorCell = {
  id: string;
  behavior: string;
  kind: 'normal' | 'branch' | 'exception' | 'boundary';
  input: string;
  preconditions: string;
  expected: string;
  risk: BehaviorRisk;
  disposition: CellDisposition;
  providerIds: string[];
  reason?: string;
};

type EvidenceOperation = {
  id: string;
  target: 'base' | 'candidate';
  argv: string[];
  expectedExit: 'zero' | 'nonzero';
  expectedExitCode?: number;
  timeoutMs: number;
  maxOutputBytes: number;
  network: 'deny' | 'authorized' | 'host';
  authorizationId?: string;
  evidenceLevel: EvidenceLevel;
  requiredSystemTools: string[];
  pythonRuntime?: PythonEvidenceRuntime;
  seed?: string;
  iterations?: number;
};

type PythonEvidenceRuntime = {
  interpreter: 'python3.14';
  resolver: 'uv';
  projectFile: string;
  lockFile: string;
};

type EvidenceApplicability = { kind: 'paths'; pathPrefixes: string[] } | { kind: 'global'; reason: string };

type EvidenceExecutionContext =
  | { sandboxOwner: 'review-runtime'; runner: 'sealed' }
  | { sandboxOwner: 'provider'; runner: 'host-seatbelt' | 'github-actions' | 'local-host'; lane: string };

type TransitionEvidenceBinding = {
  repository: string;
  baseDigest: string;
  candidateDigest: string;
  scopeDigest: string;
  operationContractDigest: string;
};

type EvidenceProvider = {
  id: string;
  owner: string;
  kind: EvidenceProviderKind;
  lifecycle: 'persistent' | 'transition';
  cellIds: string[];
  applicability: EvidenceApplicability;
  executionContext: EvidenceExecutionContext;
  transitionBinding?: TransitionEvidenceBinding;
  operations: EvidenceOperation[];
};

export type ReviewEvidenceManifest = {
  schemaVersion: 2;
  behaviorMatrix: BehaviorCell[];
  providers: EvidenceProvider[];
  authorizations: Array<{
    id: string;
    operation: string;
    scope: string;
    approvedBy: string;
    approvedAt: string;
    expiresAt: string;
  }>;
};

export type CandidateBinding = {
  repository: string;
  baseRef: string;
  baseDigest: string;
  candidateDigest: string;
  scopeDigest: string;
  behaviorContractDigest: string;
  changedFiles: string[];
  redactedUntrackedFiles: Array<{
    path: string;
    digest: string;
    size: number;
    mode: '100644' | '100755';
  }>;
};

type EvidenceRecordStatus =
  | 'verified-pass'
  | 'verified-failure'
  | 'coverage-gap'
  | 'runtime-incomplete';

export type ReviewEvidenceRecord = {
  id: string;
  providerId?: string;
  operationId?: string;
  cellIds: string[];
  owner: string;
  kind: EvidenceProviderKind | 'disposition';
  status: EvidenceRecordStatus;
  evidenceLevel: EvidenceLevel;
  environment: string;
  commandDigest?: string;
  executionIdentityDigest?: string;
  ciProvenance?: ReviewCiProvenance;
  snapshotDigestBefore?: string;
  snapshotDigestAfter?: string;
  replayCommand?: string[];
  seed?: string;
  iterations?: number;
  startedAt: string;
  finishedAt: string;
  exitStatus?: number;
  outputDigest: string;
  outputSummary: string;
  candidateDigest: string;
  baseDigest: string;
  scopeDigest: string;
  fresh: boolean;
};

export type EvidenceCompleteness = {
  complete: boolean;
  hostEligible: boolean;
  blockingCellIds: string[];
  coverageGapCellIds: string[];
  runtimeIncompleteCellIds: string[];
};

export type ReviewEvidenceBundle = {
  schemaVersion: 1;
  manifest: ReviewEvidenceManifest;
  binding: CandidateBinding;
  records: ReviewEvidenceRecord[];
  completeness: EvidenceCompleteness;
  manifestSource: string;
  contractResolution?: ReviewContractResolution;
};

export type InitialReviewArtifact = {
  schemaVersion: 1;
  phase: 'initial';
  runId: string;
  binding: CandidateBinding;
  diff: string;
  evidence: ReviewEvidenceBundle;
  findings: ReviewFinding[];
  contractReview?: ReviewContractReview;
  hostCallCount: 0 | 1;
  predecessor?: {
    transition: 'evidence-repair';
    artifactDigest: string;
    runId: string;
    receiptId: string;
    candidateDigest: string;
    behaviorContractDigest: string;
    findingIds: string[];
    affectedCellIds: string[];
  };
  createdAt: string;
  runtimeReceipt: {
    schemaVersion: 1;
    id: string;
    digest: string;
    signature: string;
    reviewScope: InitialReviewScope;
  };
};

type InitialReviewArtifactPayload = Omit<InitialReviewArtifact, 'runtimeReceipt'>;

type InitialReviewScope = { kind: 'standalone' } | {
  kind: 'work-map';
  workId: string;
  ticketId: string;
  mapRevision: number;
  claimAttempt: number;
  subjectDigest: string;
};

type InitialReviewRuntimeReceipt = {
  schemaVersion: 1;
  id: string;
  runId: string;
  artifactDigest: string;
  repository: string;
  candidateDigest: string;
  behaviorContractDigest: string;
  findingsDigest: string;
  evidenceDigest: string;
  reviewScope: InitialReviewScope;
  issuedAt: string;
};

export type ClosureReviewInput = {
  kind: 'semantic-closure' | 'evidence-repair';
  artifact: InitialReviewArtifact;
  repairedBinding: CandidateBinding;
  originalBehaviorContractDigest: string;
  repairedBehaviorContractDigest: string;
  repairDelta: string;
  affectedFindingIds: string[];
  affectedCellIds: string[];
};

export const reviewEvidenceManifestSchema: SchemaValidator<ReviewEvidenceManifest> = {
  name: 'review-evidence-manifest',
  validate: validateReviewEvidenceManifest,
};

export const closureResultsSchema: SchemaValidator<ReviewClosureResult[]> = {
  name: 'review-closure-results',
  validate(value) {
    if (!Array.isArray(value)) throw new Error('closure result must be an array');
    return value.map((entry) => {
      const item = asObject(entry, 'closure result');
      const status = requiredString(item.status, 'closure result.status');
      if (!CLOSURE_STATUSES.has(status)) {
        throw new Error(`invalid closure result status: ${status}`);
      }
      return {
        findingId: requiredId(item.findingId, 'closure result.findingId'),
        status: status as ReviewClosureResult['status'],
        summary: requiredString(item.summary, 'closure result.summary'),
        evidenceIds: optionalIdArray(item.evidenceIds, 'closure result.evidenceIds'),
      };
    });
  },
};

export function loadReviewEvidenceManifest(ctx: WorkflowContext, input?: ReviewDiffInput): {
  manifest: ReviewEvidenceManifest;
  source: string;
} {
  const configured = ctx.options.evidenceManifestFile;
  if (ctx.options.mode === 'mock' && !configured) {
    return { manifest: mockEvidenceManifest(), source: 'runtime:mock-evidence-manifest' };
  }
  const source = resolve(ctx.cwd, configured ?? DEFAULT_REVIEW_EVIDENCE_MANIFEST);
  if (!existsSync(source)) {
    throw new Error(
      `review/code evidence manifest is required before semantic review: ${source}`,
    );
  }
  const value = JSON.parse(readFileSync(source, 'utf8'));
  if (configured && input) {
    const provisionalBinding = createCandidateBinding(
      resolveReviewWorkspace(ctx.cwd).repositoryRoot,
      input,
      value as ReviewEvidenceManifest,
      ctx.options.base,
    );
    return {
      manifest: validateTransitionReviewEvidenceManifest(value, provisionalBinding),
      source,
    };
  }
  return { manifest: validateReviewEvidenceManifest(value), source };
}

export function createCandidateBinding(
  cwd: string,
  input: ReviewDiffInput,
  manifest: ReviewEvidenceManifest,
  requestedBase?: string,
): CandidateBinding {
  const repository = canonicalRepository(cwd);
  const baseRef = requestedBase
    ? gitOutput(cwd, ['merge-base', requestedBase, 'HEAD'], true) || requestedBase
    : 'HEAD';
  const baseIdentity = gitOutput(cwd, ['rev-parse', baseRef], true) || input.source;
  const baseDigest = sha256(baseIdentity);
  const hiddenUntracked = hiddenUntrackedCandidateProjection(cwd, input.diff);
  const candidateDigest = sha256(stableJson({ diff: input.diff, hiddenUntracked }));
  return {
    repository,
    baseRef,
    baseDigest,
    candidateDigest,
    scopeDigest: sha256(stableJson({
      kind: input.source.startsWith('diff-file:')
        ? 'diff-file'
        : input.source === 'work-map-runtime-owned-candidate'
          ? 'work-map'
          : 'git',
      source: input.source.startsWith('diff-file:')
        ? undefined
        : input.source.replace(/ \+ untracked$/, ''),
    })),
    behaviorContractDigest: sha256(stableJson(manifest)),
    changedFiles: [...input.changedFiles],
    redactedUntrackedFiles: hiddenUntracked,
  };
}

export async function executeEvidencePlan(
  ctx: WorkflowContext,
  input: ReviewDiffInput,
  manifest: ReviewEvidenceManifest,
  binding: CandidateBinding,
  onlyCellIds?: Set<string>,
  contractResolution?: ReviewContractResolution,
  manifestSource?: string,
): Promise<ReviewEvidenceBundle> {
  const tempParent = ctx.options.goldbandHome
    ? join(stateRoot(ctx.options), 'tmp')
    : tmpdir();
  mkdirSync(tempParent, { recursive: true, mode: 0o700 });
  const tempRoot = mkdtempSync(join(tempParent, 'review-evidence-'));
  const records: ReviewEvidenceRecord[] = [];
  const preparedRuntimes = new Map<string, PreparedEvidenceRuntime>();
  const workspace = verifiedReviewWorkspace(ctx.cwd, input.diff, binding.redactedUntrackedFiles);
  let outputBytes = 0;
  try {
    const selectedCells = effectiveEvidenceCells(manifest, binding.changedFiles, onlyCellIds);
    const providers = manifest.providers.filter((provider) =>
      provider.cellIds.some((cellId) => selectedCells.some((cell) => cell.id === cellId)) &&
      providerApplies(provider, binding.changedFiles));
    for (const cell of selectedCells) {
      if (cell.disposition === 'not-applicable') {
        records.push(dispositionRecord(cell, binding, 'verified-pass'));
      } else if (cell.disposition === 'unsupported' || cell.disposition === 'manual') {
        records.push(dispositionRecord(cell, binding, 'coverage-gap'));
      }
    }
    for (const provider of providers) {
      for (const operation of provider.operations) {
        if (records.length >= MAX_REVIEW_EVIDENCE_OPERATIONS) {
          throw new Error(`review evidence operation limit exceeded: ${MAX_REVIEW_EVIDENCE_OPERATIONS}`);
        }
        validateOperationAuthorization(operation, manifest);
        const unavailable = evidenceExecutionUnavailable(ctx, provider);
        if (unavailable) {
          records.push(executionContextIncompleteRecord(provider, operation, binding, unavailable));
          continue;
        }
        const operationKey = `${records.length}-${safePathSegment(provider.id)}-${safePathSegment(operation.id)}`;
        const operationRoot = join(
          tempRoot,
          'operations',
          operationKey,
        );
        const runnerRoot = join(tempRoot, 'runners', operationKey);
        materializeOperationSnapshot({ ctx: { ...ctx, cwd: workspace.repositoryRoot }, input,
          binding, operation, root: operationRoot });
        if (provider.executionContext.runner === 'github-actions') {
          records.push(await ciEvidenceRecord({ provider, operation, binding, repositoryRoot: workspace.repositoryRoot,
            candidateRoot: operationRoot, executionOffset: workspace.invocationOffset }));
          rmSync(operationRoot, { recursive: true, force: true });
          continue;
        }
        if (operationNeedsDependencies(operation)) {
          projectDependencyDirectories(workspace.repositoryRoot, operationRoot, input.changedFiles);
        }
        const dependencyDigest = dependencyProjectionDigest(operationRoot, binding.changedFiles);
        const record = await runEvidenceOperation({
          provider,
          operation,
          snapshotRoot: operationRoot,
          executionCwd: workspacePath(operationRoot, workspace.invocationOffset),
          binding,
          dependencyDigest,
          changedFiles: input.changedFiles,
          runnerRoot,
          runtimeProjectionRoot: join(tempRoot, 'runtime-projections'),
          preparedRuntimes,
          executionOffset: workspace.invocationOffset,
        });
        rmSync(operationRoot, { recursive: true, force: true });
        rmSync(runnerRoot, { recursive: true, force: true });
        outputBytes += Buffer.byteLength(record.outputSummary);
        if (outputBytes > MAX_REVIEW_EVIDENCE_TOTAL_BYTES) {
          throw new Error(`review evidence output exceeds ${MAX_REVIEW_EVIDENCE_TOTAL_BYTES} byte total limit`);
        }
        records.push(record);
      }
    }
    const completeness = evaluateEvidenceCompleteness(manifest, records, selectedCells);
    return {
      schemaVersion: REVIEW_EVIDENCE_SCHEMA_VERSION,
      manifest,
      binding,
      records,
      completeness,
      manifestSource: manifestSource ?? ctx.options.evidenceManifestFile ?? DEFAULT_REVIEW_EVIDENCE_MANIFEST,
      ...(contractResolution ? { contractResolution } : {}),
    };
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

export function evaluateEvidenceCompleteness(
  manifest: ReviewEvidenceManifest,
  records: ReviewEvidenceRecord[],
  cells = manifest.behaviorMatrix,
): EvidenceCompleteness {
  const blockingCellIds: string[] = [];
  const coverageGapCellIds: string[] = [];
  const runtimeIncompleteCellIds: string[] = [];
  for (const cell of cells) {
    const cellRecords = records.filter((record) => recordAuthorizedForCell(record, cell, manifest));
    if (cellRecords.some((record) => record.status === 'runtime-incomplete')) {
      runtimeIncompleteCellIds.push(cell.id);
      continue;
    }
    if (cell.disposition === 'unsupported' || cell.disposition === 'manual') {
      coverageGapCellIds.push(cell.id);
      if (cell.risk === 'high') blockingCellIds.push(cell.id);
      continue;
    }
    if (cell.disposition === 'not-applicable') continue;
    if (cellRecords.length === 0) {
      coverageGapCellIds.push(cell.id);
      if (cell.risk === 'high') blockingCellIds.push(cell.id);
      continue;
    }
    if (!cellRecords.every((record) => record.fresh)) {
      runtimeIncompleteCellIds.push(cell.id);
    }
  }
  return {
    complete: coverageGapCellIds.length === 0 && runtimeIncompleteCellIds.length === 0,
    hostEligible: runtimeIncompleteCellIds.length === 0 && blockingCellIds.length === 0,
    blockingCellIds: uniqueSorted(blockingCellIds),
    coverageGapCellIds: uniqueSorted(coverageGapCellIds),
    runtimeIncompleteCellIds: uniqueSorted(runtimeIncompleteCellIds),
  };
}

export function classifyReviewFindings(
  findings: ReviewFinding[],
  evidence: ReviewEvidenceBundle,
): ReviewFinding[] {
  const records = new Map(evidence.records.map((record) => [record.id, record]));
  return findings.map((finding, index) => {
    const requested = finding.classification && FINDING_CLASSIFICATIONS.has(finding.classification)
      ? finding.classification
      : 'semantic-concern';
    const requestedCellIds = new Set(finding.behaviorCellIds ?? []);
    const bound = (finding.evidenceIds ?? [])
      .map((id) => records.get(id))
      .filter((record): record is ReviewEvidenceRecord => Boolean(record))
      .filter((record) => requestedCellIds.size > 0 && record.cellIds.some((id) => requestedCellIds.has(id)));
    const validCellIds = new Set(evidence.manifest.behaviorMatrix.map((cell) => cell.id));
    const normalizedCellIds = uniqueSorted([
      ...(finding.behaviorCellIds ?? []).filter((id) => validCellIds.has(id)),
      ...bound.flatMap((record) => record.cellIds),
    ]);
    const closureCellIds = reviewFindingCellIds({
      ...finding,
      classification: 'semantic-concern',
      behaviorCellIds: normalizedCellIds,
      evidenceIds: bound.map((record) => record.id),
    }, evidence);
    // Only deterministicEvidenceFindings may mint verified-failure. Semantic
    // output can reference relevant records, but cannot promote itself by
    // selecting an unrelated failed command.
    const classification = 'semantic-concern';
    // Finding identity belongs to the runtime. Model-supplied IDs can collide
    // with deterministic findings (or with each other), making the persisted
    // initial artifact impossible to consume during closure.
    const id = `S-${String(index + 1).padStart(3, '0')}`;
    return {
      ...finding,
      id,
      classification,
      category: finding.category === 'deterministic-evidence' ? 'semantic-review' : finding.category,
      evidenceIds: bound.map((record) => record.id),
      behaviorCellIds: closureCellIds,
      // Blocking authority stays deterministic: the host supplies the
      // observation, while runtime severity policy decides ticket state.
      blocking: finding.severity === 'critical' || finding.severity === 'high',
      reproductionStep: classification === 'semantic-concern'
        ? finding.reproductionStep ?? finding.suggestedVerification
        : finding.reproductionStep,
      summary: requested !== 'semantic-concern'
        ? `[unverified concern] ${finding.summary}`
        : finding.summary,
    };
  });
}

export function validateInitialReviewArtifact(value: unknown): InitialReviewArtifact {
  const item = asObject(value, 'initial review artifact');
  if (item.schemaVersion !== 1 || item.phase !== 'initial') {
    throw new Error('invalid initial review artifact header');
  }
  const findings = validateInitialArtifactFindings(item);
  const artifact = value as InitialReviewArtifact;
  const runtimeReceipt = asObject(artifact.runtimeReceipt, 'initial review artifact.runtimeReceipt');
  if (runtimeReceipt.schemaVersion !== 1) {
    throw new Error('initial review artifact runtime receipt version is invalid');
  }
  requiredId(runtimeReceipt.id, 'initial review artifact.runtimeReceipt.id');
  assertSha256(runtimeReceipt.digest, 'initial review artifact.runtimeReceipt.digest');
  assertSha256(runtimeReceipt.signature, 'initial review artifact.runtimeReceipt.signature');
  validateInitialReviewScope(runtimeReceipt.reviewScope);
  const binding = artifact.binding;
  if (!binding || typeof binding.repository !== 'string' || typeof binding.baseRef !== 'string') {
    throw new Error('initial review artifact binding is invalid');
  }
  for (const [label, digest] of [
    ['baseDigest', binding.baseDigest],
    ['candidateDigest', binding.candidateDigest],
    ['scopeDigest', binding.scopeDigest],
    ['behaviorContractDigest', binding.behaviorContractDigest],
  ] as const) assertSha256(digest, `initial review artifact.binding.${label}`);
  const manifest = validateTransitionReviewEvidenceManifest(artifact.evidence?.manifest, binding);
  if (!Array.isArray(binding.redactedUntrackedFiles)) {
    throw new Error('initial review artifact binding redacted untracked projection is invalid');
  }
  const redactedPaths = new Set<string>();
  for (const entry of binding.redactedUntrackedFiles) {
    if (!entry || typeof entry.path !== 'string' || !entry.path ||
        isAbsolute(entry.path) || entry.path.split(/[\\/]/).includes('..') ||
        !Number.isSafeInteger(entry.size) || entry.size < 0 || entry.size > MAX_REDACTED_UNTRACKED_BYTES ||
        !['100644', '100755'].includes(entry.mode)) {
      throw new Error('initial review artifact binding redacted untracked entry is invalid');
    }
    if (redactedPaths.has(entry.path)) {
      throw new Error(`initial review artifact binding repeats redacted untracked path: ${entry.path}`);
    }
    redactedPaths.add(entry.path);
    assertSha256(entry.digest, `initial review artifact binding redacted digest: ${entry.path}`);
  }
  if (Buffer.byteLength(artifact.diff) > 256 * 1024) {
    throw new Error('initial review artifact diff is oversized');
  }
  if (binding.behaviorContractDigest !== sha256(stableJson(manifest)) ||
      stableJson(artifact.evidence.binding) !== stableJson(binding)) {
    throw new Error('initial review artifact evidence binding is mismatched');
  }
  if (artifact.evidence.contractResolution) {
    validatePersistedContractResolution(
      artifact.evidence.contractResolution,
      binding,
      manifest,
    );
  }
  if (!Array.isArray(artifact.evidence.records)) {
    throw new Error('initial review artifact evidence records are invalid');
  }
  validateEvidenceRepairPredecessor(artifact, manifest);
  const recordIds = new Set<string>();
  for (const record of artifact.evidence.records) {
    validatePersistedEvidenceRecord(record, binding, manifest);
    if (recordIds.has(record.id)) throw new Error('initial evidence record IDs must be unique');
    recordIds.add(record.id);
  }
  const recomputedCompleteness = evaluateEvidenceCompleteness(
    manifest,
    artifact.evidence.records,
    persistedArtifactEvidenceCells(artifact, manifest),
  );
  if (stableJson(recomputedCompleteness) !== stableJson(artifact.evidence.completeness)) {
    throw new Error('initial review artifact evidence completeness is not recomputable');
  }
  for (const finding of findings) {
    for (const evidenceId of finding.evidenceIds ?? []) {
      if (!recordIds.has(evidenceId)) throw new Error(`initial finding references unknown evidence: ${evidenceId}`);
    }
  }
  if (!Number.isFinite(Date.parse(artifact.createdAt))) {
    throw new Error('initial review artifact.createdAt is invalid');
  }
  return artifact;
}

function validateInitialArtifactFindings(item: Record<string, unknown>): ReviewFinding[] {
  if (item.hostCallCount !== 0 && item.hostCallCount !== 1) {
    throw new Error('initial review artifact host call count is invalid');
  }
  if (!Array.isArray(item.findings)) {
    throw new Error('initial review artifact.findings must be an array');
  }
  if (item.findings.length === 0) {
    throw new Error('closure is forbidden when initial review has no findings');
  }
  const findings = item.findings as ReviewFinding[];
  const ids = findings.map((finding) => requiredId(finding.id, 'initial finding.id'));
  if (new Set(ids).size !== ids.length) throw new Error('initial finding IDs must be unique');
  if (item.hostCallCount === 0 && findings.some((finding) =>
    finding.category !== 'deterministic-evidence' ||
    !finding.id?.startsWith('D-') ||
    !['verified-failure', 'coverage-gap', 'runtime-incomplete'].includes(finding.classification ?? ''))) {
    throw new Error('pre-semantic recovery requires deterministic-only findings');
  }
  return findings;
}

function validateEvidenceRepairPredecessor(
  artifact: InitialReviewArtifact,
  manifest: ReviewEvidenceManifest,
): void {
  const predecessor = artifact.predecessor;
  if (!predecessor) return;
  if (predecessor.transition !== 'evidence-repair') {
    throw new Error('initial review artifact predecessor transition is invalid');
  }
  assertSha256(predecessor.artifactDigest, 'initial review predecessor artifactDigest');
  assertSha256(predecessor.candidateDigest, 'initial review predecessor candidateDigest');
  assertSha256(
    predecessor.behaviorContractDigest,
    'initial review predecessor behaviorContractDigest',
  );
  requiredId(predecessor.runId, 'initial review predecessor runId');
  requiredId(predecessor.receiptId, 'initial review predecessor receiptId');
  assertUniqueIds(predecessor.findingIds, 'initial review artifact predecessor findingIds');
  assertUniqueIds(predecessor.affectedCellIds, 'initial review artifact predecessor affectedCellIds');
  const validCellIds = new Set(manifest.behaviorMatrix.map((cell) => cell.id));
  if (predecessor.affectedCellIds.some((id) => !validCellIds.has(id))) {
    throw new Error('initial review artifact predecessor affectedCellIds are invalid');
  }
}

function assertUniqueIds(value: unknown, label: string): asserts value is string[] {
  if (!Array.isArray(value) || value.length === 0 ||
      value.some((id) => typeof id !== 'string' || !id) ||
      new Set(value).size !== value.length) {
    throw new Error(`${label} are invalid`);
  }
}

function persistedArtifactEvidenceCells(
  artifact: InitialReviewArtifact,
  manifest: ReviewEvidenceManifest,
): ReviewEvidenceManifest['behaviorMatrix'] {
  return effectiveEvidenceCells(
    manifest,
    artifact.binding.changedFiles,
    artifact.predecessor ? new Set(artifact.predecessor.affectedCellIds) : undefined,
  );
}

function validatePersistedContractResolution(
  resolution: ReviewContractResolution,
  binding: CandidateBinding,
  manifest: ReviewEvidenceManifest,
): void {
  if (
    resolution.schemaVersion !== 1 ||
    resolution.compatibilityIdentity !== 'review-evidence-schema-v2/runtime-contract-v2' ||
    resolution.repositoryIdentity?.kind !== 'git-common-directory' ||
    typeof resolution.repositoryIdentity.commonDirectory !== 'string' ||
    !resolution.repositoryIdentity.commonDirectory ||
    typeof resolution.repositoryIdentity.commonDirectoryInstanceDigest !== 'string' ||
    typeof resolution.repositoryIdentity.remoteIdentityDigest !== 'string' ||
    typeof resolution.workspace?.repositoryRoot !== 'string' ||
    !resolution.workspace.repositoryRoot ||
    typeof resolution.workspace.invocationDirectory !== 'string' ||
    !resolution.workspace.invocationDirectory ||
    typeof resolution.workspace.invocationOffset !== 'string' ||
    typeof resolution.candidateProvenance?.identity !== 'string' ||
    !resolution.candidateProvenance.identity ||
    !['absent', 'unchanged', 'modified', 'staged-modified', 'staged-new', 'untracked', 'head']
      .includes(resolution.candidateProvenance.trackingState)
  ) {
    throw new Error('initial review artifact contract resolution is invalid');
  }
  assertSha256(
    resolution.repositoryIdentity.commonDirectoryInstanceDigest,
    'initial review artifact contract resolution common directory instance',
  );
  assertSha256(
    resolution.repositoryIdentity.remoteIdentityDigest,
    'initial review artifact contract resolution remote identity',
  );
  assertSha256(resolution.baseline?.digest, 'initial review artifact contract resolution baseline');
  if (resolution.baseline?.kind === 'runtime-store' && (
    typeof resolution.baseline.importedFrom !== 'string' ||
    !resolution.baseline.importedFrom ||
    typeof resolution.baseline.importedAt !== 'string' ||
    !Number.isFinite(Date.parse(resolution.baseline.importedAt))
  )) {
    throw new Error('initial review artifact runtime-store baseline provenance is invalid');
  }
  if (resolution.candidate) {
    assertSha256(resolution.candidate.digest, 'initial review artifact contract resolution candidate');
  }
  if (resolution.candidateProvenance.digest) {
    assertSha256(resolution.candidateProvenance.digest, 'initial review artifact contract resolution candidate provenance');
  }
  if (resolution.candidateProvenance.baseDigest) {
    assertSha256(resolution.candidateProvenance.baseDigest, 'initial review artifact contract resolution candidate base provenance');
  }
  if (resolution.schemaMigration && (
    resolution.schemaMigration.observedVersion !== 1 ||
    resolution.schemaMigration.supportedVersion !== 2 ||
    typeof resolution.schemaMigration.source !== 'string' ||
    !resolution.schemaMigration.source
  )) {
    throw new Error('initial review artifact contract schema migration is invalid');
  }
  if (resolution.shadowedRuntimeStore?.present) {
    if (
      typeof resolution.shadowedRuntimeStore.identity !== 'string' ||
      !resolution.shadowedRuntimeStore.identity
    ) {
      throw new Error('initial review artifact shadowed runtime store identity is invalid');
    }
    if (resolution.shadowedRuntimeStore.digest) {
      assertSha256(
        resolution.shadowedRuntimeStore.digest,
        'initial review artifact shadowed runtime store',
      );
      if (
        typeof resolution.shadowedRuntimeStore.importedFrom !== 'string' ||
        !resolution.shadowedRuntimeStore.importedFrom ||
        typeof resolution.shadowedRuntimeStore.importedAt !== 'string' ||
        !Number.isFinite(Date.parse(resolution.shadowedRuntimeStore.importedAt))
      ) {
        throw new Error('initial review artifact shadowed runtime store provenance is invalid');
      }
    } else if (
      typeof resolution.shadowedRuntimeStore.invalidReason !== 'string' ||
      !resolution.shadowedRuntimeStore.invalidReason
    ) {
      throw new Error('initial review artifact shadowed runtime store state is invalid');
    }
  }
  if (resolution.explicit) {
    assertSha256(resolution.explicit.digest, 'initial review artifact contract resolution explicit');
  }
  assertSha256(resolution.effectiveDigest, 'initial review artifact contract resolution effective');
  if (
    resolution.effectiveDigest !== binding.behaviorContractDigest ||
    resolution.effectiveDigest !== sha256(stableJson(manifest))
  ) {
    throw new Error('initial review artifact effective contract digest is mismatched');
  }
}

function validatePersistedEvidenceRecord(
  record: ReviewEvidenceRecord,
  binding: CandidateBinding,
  manifest: ReviewEvidenceManifest,
): void {
  validatePersistedRecordShape(record);
  validatePersistedRecordProvenance(record, binding);
  validatePersistedRecordAuthority(record, manifest);
  if (record.kind === 'disposition') {
    validatePersistedDispositionRecord(record, manifest);
    return;
  }
  const operation = persistedRecordOperation(record, manifest);
  const provider = manifest.providers.find((entry) => entry.id === record.providerId)!;
  if (provider.executionContext.runner === 'github-actions') {
    validatePersistedCiRecord(record, provider);
    return;
  }
  if (record.ciProvenance !== undefined) throw new Error('Local evidence cannot claim CI provenance');
  validatePersistedCommandRecord(record, operation);
}

function validatePersistedRecordShape(record: ReviewEvidenceRecord): void {
  requiredId(record.id, 'initial evidence record.id');
  if (!Array.isArray(record.cellIds) || record.cellIds.length === 0) {
    throw new Error(`initial evidence record.cellIds must be non-empty: ${record.id}`);
  }
  for (const cellId of record.cellIds) requiredId(cellId, `initial evidence record.cellIds: ${record.id}`);
  requiredString(record.owner, `initial evidence record.owner: ${record.id}`);
  requiredString(record.environment, `initial evidence record.environment: ${record.id}`);
  if (!EVIDENCE_RECORD_STATUSES.has(record.status)) {
    throw new Error(`initial evidence record.status is invalid: ${record.id}`);
  }
  if (!LEVELS.has(record.evidenceLevel)) {
    throw new Error(`initial evidence record.evidenceLevel is invalid: ${record.id}`);
  }
  if (!Number.isFinite(Date.parse(record.startedAt)) || !Number.isFinite(Date.parse(record.finishedAt))) {
    throw new Error(`initial evidence record timestamps are invalid: ${record.id}`);
  }
  assertSha256(record.outputDigest, `initial evidence record.outputDigest: ${record.id}`);
  if (typeof record.outputSummary !== 'string' || Buffer.byteLength(record.outputSummary) > MAX_REVIEW_EVIDENCE_OUTPUT_BYTES) {
    throw new Error(`initial evidence record.outputSummary is invalid: ${record.id}`);
  }
  if (typeof record.fresh !== 'boolean') throw new Error(`initial evidence record.fresh is invalid: ${record.id}`);
}

function validatePersistedRecordProvenance(
  record: ReviewEvidenceRecord,
  binding: CandidateBinding,
): void {
  if (
    record.candidateDigest !== binding.candidateDigest ||
    record.baseDigest !== binding.baseDigest ||
    record.scopeDigest !== binding.scopeDigest
  ) {
    throw new Error(`initial evidence record provenance is mismatched: ${record.id}`);
  }
}

function validatePersistedRecordAuthority(
  record: ReviewEvidenceRecord,
  manifest: ReviewEvidenceManifest,
): void {
  for (const cellId of record.cellIds) {
    const cell = manifest.behaviorMatrix.find((entry) => entry.id === cellId);
    if (!cell || !recordAuthorizedForCell(record, cell, manifest)) {
      throw new Error(`initial evidence record is not authorized for behavior cell ${cellId}: ${record.id}`);
    }
  }
}

function validatePersistedDispositionRecord(
  record: ReviewEvidenceRecord,
  manifest: ReviewEvidenceManifest,
): void {
  const cell = manifest.behaviorMatrix.find((entry) => entry.id === record.cellIds[0])!;
  const expectedSummary = cell.reason ?? cell.disposition;
  if (record.evidenceLevel !== 'fixture' ||
      record.environment !== 'deterministic-manifest-validation' ||
      record.outputSummary !== expectedSummary ||
      record.outputDigest !== sha256(expectedSummary) ||
      !record.fresh) {
    throw new Error(`initial evidence disposition record contract is invalid: ${record.id}`);
  }
}

function persistedRecordOperation(
  record: ReviewEvidenceRecord,
  manifest: ReviewEvidenceManifest,
): EvidenceOperation {
  if (!record.providerId || !record.operationId) {
    throw new Error(`initial evidence command record lacks provider identity: ${record.id}`);
  }
  const provider = manifest.providers.find((entry) => entry.id === record.providerId);
  const operation = provider?.operations.find((entry) => entry.id === record.operationId);
  if (!provider || !operation || record.id !== `${provider.id}:${operation.id}` ||
      record.owner !== provider.owner || record.kind !== provider.kind ||
      stableJson(record.cellIds) !== stableJson(provider.cellIds) ||
      record.evidenceLevel !== operation.evidenceLevel) {
    throw new Error(`initial evidence command record contract is invalid: ${record.id}`);
  }
  return operation;
}

function validatePersistedCiRecord(record: ReviewEvidenceRecord, provider: EvidenceProvider): void {
  if (!isReviewCiProvider(provider) || provider.executionContext.runner !== 'github-actions' ||
      provider.executionContext.lane !== REVIEW_CI_LANE) throw new Error('Invalid persisted CI provider');
  if (record.commandDigest !== operationCommandDigest({ operation: provider.operations[0]!, executionOffset: '' })) {
    throw new Error('CI command digest does not match the provider operation');
  }
  if (record.exitStatus !== undefined || record.snapshotDigestBefore !== undefined ||
      record.snapshotDigestAfter !== undefined) throw new Error('CI evidence cannot claim a local exit or sealed snapshot');
  if (record.status === 'runtime-incomplete' && !record.fresh && record.ciProvenance === undefined &&
      record.executionIdentityDigest === undefined) return;
  if (record.status !== 'verified-pass' || !record.fresh || !record.ciProvenance ||
      record.environment !== 'github-actions/macos-writable-checkout') throw new Error('Invalid CI evidence status');
  validateReviewCiProvenance(record.ciProvenance, provider.id);
  if (record.executionIdentityDigest !== sha256(stableJson(record.ciProvenance))) {
    throw new Error('CI execution identity does not match provenance');
  }
}

function validatePersistedCommandRecord(
  record: ReviewEvidenceRecord,
  operation: EvidenceOperation,
): void {
  if (record.status === 'coverage-gap') {
    throw new Error(`initial evidence command record cannot claim coverage-gap: ${record.id}`);
  }
  const exitMatches = operation.expectedExit === 'zero'
    ? record.exitStatus === 0
    : record.exitStatus === operation.expectedExitCode;
  if ((record.status === 'verified-pass' && !exitMatches) ||
      (record.status === 'verified-failure' && (record.exitStatus === undefined || exitMatches)) ||
      (record.status === 'runtime-incomplete' && record.fresh)) {
    throw new Error(`initial evidence command record status does not match its exit contract: ${record.id}`);
  }
  assertSha256(record.commandDigest, `initial evidence record.commandDigest: ${record.id}`);
  if (record.status === 'runtime-incomplete' && record.executionIdentityDigest === undefined) {
    validatePersistedPreExecutionIncompleteRecord(record);
    return;
  }
  assertSha256(record.executionIdentityDigest, `initial evidence record.executionIdentityDigest: ${record.id}`);
  assertSha256(record.snapshotDigestBefore, `initial evidence record.snapshotDigestBefore: ${record.id}`);
  assertSha256(record.snapshotDigestAfter, `initial evidence record.snapshotDigestAfter: ${record.id}`);
  validatePersistedReplayCommand(record);
}

function validatePersistedReplayCommand(record: ReviewEvidenceRecord): void {
  if (!Array.isArray(record.replayCommand) || record.replayCommand.length === 0 ||
      record.replayCommand.some((value) => typeof value !== 'string')) {
    throw new Error(`initial evidence record.replayCommand is invalid: ${record.id}`);
  }
  if (record.fresh && record.snapshotDigestBefore !== record.snapshotDigestAfter) {
    throw new Error(`initial evidence record changed its snapshot while marked fresh: ${record.id}`);
  }
}

function validatePersistedPreExecutionIncompleteRecord(record: ReviewEvidenceRecord): void {
  if (record.exitStatus !== undefined || record.fresh) {
    throw new Error(`initial pre-execution incomplete record has an exit result: ${record.id}`);
  }
  const snapshotDigests = [record.snapshotDigestBefore, record.snapshotDigestAfter];
  if (snapshotDigests.some((digest) => digest !== undefined)) {
    for (const digest of snapshotDigests) {
      assertSha256(digest, `initial pre-execution incomplete snapshot digest: ${record.id}`);
    }
    if (record.snapshotDigestBefore !== record.snapshotDigestAfter) {
      throw new Error(`initial pre-execution incomplete record changed its snapshot: ${record.id}`);
    }
  }
  if (record.replayCommand !== undefined && (
    !Array.isArray(record.replayCommand) || record.replayCommand.length === 0 ||
    record.replayCommand.some((value) => typeof value !== 'string')
  )) {
    throw new Error(`initial pre-execution incomplete replay command is invalid: ${record.id}`);
  }
}

export function readClosureArtifact(ctx: WorkflowContext): InitialReviewArtifact | undefined {
  if (!ctx.options.closureArtifactFile) return undefined;
  const file = resolve(ctx.cwd, ctx.options.closureArtifactFile);
  const artifact = validateInitialReviewArtifact(JSON.parse(readFileSync(file, 'utf8')));
  validateInitialReviewRuntimeReceipt(ctx, artifact);
  return artifact;
}

export function buildClosureInput(
  artifact: InitialReviewArtifact,
  repairedBinding: CandidateBinding,
  repairedDiff: string,
  repairedManifest: ReviewEvidenceManifest,
): ClosureReviewInput {
  if (artifact.binding.repository !== repairedBinding.repository ||
      artifact.binding.baseRef !== repairedBinding.baseRef ||
      artifact.binding.baseDigest !== repairedBinding.baseDigest ||
      artifact.binding.scopeDigest !== repairedBinding.scopeDigest) {
    throw new Error('closure provenance does not match repository, base, or scope');
  }
  const evidenceRefresh = permitsSameCandidateEvidenceRefresh(artifact, repairedBinding);
  if (artifact.binding.candidateDigest === repairedBinding.candidateDigest && !evidenceRefresh) {
    throw new Error('closure requires a repaired candidate with a different digest');
  }
  const patchDelta = diffPatchTexts(artifact.diff, repairedDiff);
  const redactedDelta = redactedUntrackedRepairDelta(
    artifact.binding.redactedUntrackedFiles,
    repairedBinding.redactedUntrackedFiles,
  );
  const repairDelta = [patchDelta, redactedDelta].filter(Boolean).join('\n');
  if (Buffer.byteLength(repairDelta) > MAX_REVIEW_DIFF_BYTES) {
    throw new Error(
      `review closure repair delta exceeds ${MAX_REVIEW_DIFF_BYTES} byte limit; narrow the repair scope`,
    );
  }
  const changedFiles = uniqueSorted([
    ...changedFilesBetweenPatchTexts(artifact.diff, repairedDiff),
    ...changedRedactedUntrackedPaths(
      artifact.binding.redactedUntrackedFiles,
      repairedBinding.redactedUntrackedFiles,
    ),
  ]);
  const findingCellIds = artifact.findings.flatMap((finding) =>
    reviewFindingCellIds(finding, artifact.evidence, repairedManifest)
      .filter((cellId) => evidenceRefresh || cellAffectedByPaths(cellId, repairedManifest, changedFiles)));
  const contractChangedCellIds = repairedManifest.behaviorMatrix
    .map((cell) => cell.id)
    .filter((cellId) =>
      cellContractDigest(artifact.evidence.manifest, cellId) !==
      cellContractDigest(repairedManifest, cellId));
  const affectedCellIds = uniqueSorted([
    ...findingCellIds,
    ...contractChangedCellIds,
  ]);
  assertEvidenceRepairAffectsCells(artifact, affectedCellIds);
  return {
    kind: artifact.hostCallCount === 0 ? 'evidence-repair' : 'semantic-closure',
    artifact,
    repairedBinding,
    originalBehaviorContractDigest: artifact.binding.behaviorContractDigest,
    repairedBehaviorContractDigest: repairedBinding.behaviorContractDigest,
    repairDelta,
    affectedFindingIds: artifact.findings.map((finding) => finding.id!),
    affectedCellIds,
  };
}

function permitsSameCandidateEvidenceRefresh(
  artifact: InitialReviewArtifact,
  binding: CandidateBinding,
): boolean {
  return artifact.binding.candidateDigest === binding.candidateDigest &&
    artifact.binding.behaviorContractDigest === binding.behaviorContractDigest &&
    artifact.hostCallCount === 0 &&
    artifact.findings.length > 0 &&
    artifact.findings.every((finding) => finding.classification === 'runtime-incomplete');
}

function assertEvidenceRepairAffectsCells(
  artifact: InitialReviewArtifact,
  affectedCellIds: string[],
): void {
  if (artifact.hostCallCount === 0 && affectedCellIds.length === 0) {
    throw new Error(
      'evidence repair does not affect an unresolved deterministic finding or add contract coverage',
    );
  }
}

export function initialReviewArtifactDigest(artifact: InitialReviewArtifact): string {
  return sha256(stableJson(artifact));
}

export function validateClosureResults(
  results: ReviewClosureResult[],
  input: ClosureReviewInput,
  evidence: ReviewEvidenceBundle,
  contractAssessment?: ReviewContractAssessment,
): ReviewClosureResult[] {
  const changedChecks = reviewContractChanges([input.artifact.evidence.manifest], evidence.manifest);
  if (changedChecks.length > 0 && results.some((result) => result.status === 'closed') &&
      !contractAssessment?.preserved) {
    throw new Error('closure of changed review checks requires a preserving contract assessment');
  }
  const allowed = new Set(input.affectedFindingIds);
  const evidenceById = new Map(evidence.records.map((record) => [record.id, record]));
  const originalFindingsById = new Map(
    input.artifact.findings.map((finding) => [finding.id!, finding]),
  );
  const seen = new Set<string>();
  for (const result of results) {
    if (!allowed.has(result.findingId)) {
      throw new Error(`closure returned non-original finding ID: ${result.findingId}`);
    }
    if (seen.has(result.findingId)) throw new Error(`duplicate closure finding ID: ${result.findingId}`);
    seen.add(result.findingId);
    const evidenceIds = result.evidenceIds ?? [];
    const rerunRecords = evidenceIds.map((id) => evidenceById.get(id));
    if (rerunRecords.some((record) => !record)) {
      throw new Error(`closure references unknown rerun evidence: ${result.findingId}`);
    }
    if (result.status === 'direct-regression' &&
        !rerunRecords.some((record) => record?.status === 'verified-failure')) {
      throw new Error(`closure direct-regression requires verified rerun evidence: ${result.findingId}`);
    }
    if (result.status === 'evidence-incomplete' || result.status === 'still-open') continue;
    if (rerunRecords.length === 0) {
      throw new Error(`closure ${result.status} requires fresh rerun evidence: ${result.findingId}`);
    }
    const finding = originalFindingsById.get(result.findingId)!;
    const findingCellIds = new Set(reviewFindingCellIds(
      finding, input.artifact.evidence, evidence.manifest,
    ));
    if (findingCellIds.size === 0) {
      throw new Error(`closure ${result.status} has no behavior-cell evidence binding: ${result.findingId}`);
    }
    if (rerunRecords.some((record) =>
      !record?.cellIds.some((cellId) => findingCellIds.has(cellId)))) {
      throw new Error(`closure references evidence unrelated to finding behavior cells: ${result.findingId}`);
    }
    if (result.status === 'closed') {
      if (!rerunRecords.every((record) => record?.status === 'verified-pass' && record.fresh)) {
        throw new Error(`closure closed requires passing fresh rerun evidence: ${result.findingId}`);
      }
      assertVerifiedFailureRepair(finding, input.artifact.evidence, evidence, Boolean(contractAssessment?.preserved));
    }
  }
  for (const findingId of input.affectedFindingIds) {
    if (!seen.has(findingId)) throw new Error(`closure omitted original finding ID: ${findingId}`);
  }
  return results;
}

function assertVerifiedFailureRepair(
  finding: ReviewFinding,
  originalEvidence: ReviewEvidenceBundle,
  evidence: ReviewEvidenceBundle,
  reviewedCorrection: boolean,
): void {
  if (finding.classification !== 'verified-failure') return;
  const failedRecords = originalEvidence.records.filter((record) =>
    finding.evidenceIds?.includes(record.id) && record.status === 'verified-failure');
  const repaired = failedRecords.length > 0 && failedRecords.every((original) => {
    const rerun = evidence.records.find((record) => record.id === original.id);
    return rerun?.status === 'verified-pass' && rerun.fresh && sameEvidenceOperationContract({
      original, originalManifest: originalEvidence.manifest,
      rerun, rerunManifest: evidence.manifest,
      reviewedCorrection: reviewedCorrection && sameReviewExecutionOffset(originalEvidence, evidence),
    });
  });
  if (!repaired) throw new Error(
    `closure verified failure requires the original failed operation boundary and fresh passing evidence: ${finding.id}`,
  );
}

function sameReviewExecutionOffset(original: ReviewEvidenceBundle, rerun: ReviewEvidenceBundle): boolean {
  const before = original.contractResolution?.workspace.invocationOffset;
  const after = rerun.contractResolution?.workspace.invocationOffset;
  return before !== undefined && before === after;
}

function sameEvidenceOperationContract({ original, originalManifest, rerun, rerunManifest, reviewedCorrection }: {
  original: ReviewEvidenceRecord;
  originalManifest: ReviewEvidenceManifest;
  rerun: ReviewEvidenceRecord;
  rerunManifest: ReviewEvidenceManifest;
  reviewedCorrection: boolean;
}): boolean {
  if (!original.providerId || !original.operationId ||
      original.providerId !== rerun.providerId || original.operationId !== rerun.operationId) return false;
  const originalProvider = originalManifest.providers.find((entry) => entry.id === original.providerId);
  const rerunProvider = rerunManifest.providers.find((entry) => entry.id === rerun.providerId);
  if (isReviewLocalMigration(originalProvider, rerunProvider)) return true;
  const beforeCommand = originalProvider?.operations.find((operation) => operation.id === original.operationId)?.argv;
  const afterCommand = rerunProvider?.operations.find((operation) => operation.id === rerun.operationId)?.argv;
  const commandCorrected = reviewedCorrection && stableJson(beforeCommand) !== stableJson(afterCommand);
  if (!original.commandDigest || (!commandCorrected && original.commandDigest !== rerun.commandDigest)) return false;
  const migrated = originalProvider && rerunProvider && isReviewCiMigration(originalProvider, rerunProvider);
  const contract = (manifest: ReviewEvidenceManifest, record: ReviewEvidenceRecord) => {
    const provider = manifest.providers.find((entry) => entry.id === record.providerId);
    const operation = provider?.operations.find((entry) => entry.id === record.operationId);
    return provider && operation ? stableJson({
      provider: {
        id: provider.id,
        owner: provider.owner,
        kind: provider.kind,
        lifecycle: provider.lifecycle,
        cellIds: provider.cellIds,
        applicability: provider.applicability,
        executionContext: migrated ? rerunProvider.executionContext : provider.executionContext,
      },
      operation: {
        ...reviewOperationBoundary(operation),
        argv: reviewedCorrection ? undefined : operation.argv,
      },
    }) : undefined;
  };
  return contract(originalManifest, original) === contract(rerunManifest, rerun);
}

function cellContractDigest(
  manifest: ReviewEvidenceManifest,
  cellId: string,
): string | undefined {
  const cell = manifest.behaviorMatrix.find((entry) => entry.id === cellId);
  if (!cell) return undefined;
  const providers = manifest.providers.filter((provider) => provider.cellIds.includes(cellId));
  return sha256(stableJson({ cell, providers }));
}

function validateReviewEvidenceManifest(
  value: unknown,
  storage: 'repository' | 'transition-artifact' = 'repository',
  binding?: CandidateBinding,
): ReviewEvidenceManifest {
  const item = asObject(value, 'review evidence manifest');
  assertAllowedKeys(item, ['schemaVersion', 'behaviorMatrix', 'providers', 'authorizations'], 'review evidence manifest');
  if (item.schemaVersion !== REVIEW_EVIDENCE_MANIFEST_SCHEMA_VERSION) {
    throw new Error(
      `review evidence manifest schema incompatibility: observed ${String(item.schemaVersion)}, supported ${REVIEW_EVIDENCE_MANIFEST_SCHEMA_VERSION}; migrate the source manifest explicitly and supply lifecycle, applicability, and executionContext without guessed defaults`,
    );
  }
  if (!Array.isArray(item.behaviorMatrix) || item.behaviorMatrix.length === 0) {
    throw new Error('review evidence manifest.behaviorMatrix must be non-empty');
  }
  if (!Array.isArray(item.providers)) throw new Error('review evidence manifest.providers must be an array');
  if (!Array.isArray(item.authorizations)) throw new Error('review evidence manifest.authorizations must be an array');
  const behaviorMatrix = item.behaviorMatrix.map(validateBehaviorCell);
  const providers = item.providers.map(validateEvidenceProvider);
  const authorizations = item.authorizations.map(validateEvidenceAuthorization);
  assertUnique(behaviorMatrix.map((cell) => cell.id), 'behavior cell');
  assertUnique(providers.map((provider) => provider.id), 'evidence provider');
  assertUnique(authorizations.map((authorization) => authorization.id), 'evidence authorization');
  const cellIds = new Set(behaviorMatrix.map((cell) => cell.id));
  const providerIds = new Set(providers.map((provider) => provider.id));
  assertAuthorizationReferences(authorizations, providers);
  for (const cell of behaviorMatrix) {
    for (const providerId of cell.providerIds) {
      if (!providerIds.has(providerId)) throw new Error(`behavior cell ${cell.id} references unknown provider ${providerId}`);
      const provider = providers.find((entry) => entry.id === providerId)!;
      if (!provider.cellIds.includes(cell.id)) {
        throw new Error(`behavior cell ${cell.id} and provider ${providerId} must authorize each other`);
      }
    }
  }
  for (const provider of providers) {
    assertUnique(
      provider.operations.map((operation) => operation.id),
      `evidence provider ${provider.id} operation`,
    );
    for (const cellId of provider.cellIds) {
      if (!cellIds.has(cellId)) throw new Error(`evidence provider ${provider.id} references unknown cell ${cellId}`);
      const cell = behaviorMatrix.find((entry) => entry.id === cellId)!;
      if (!cell.providerIds.includes(provider.id)) {
        throw new Error(`evidence provider ${provider.id} and behavior cell ${cellId} must authorize each other`);
      }
    }
    validateProviderContract(provider);
    if (storage === 'repository' && provider.lifecycle !== 'persistent') {
      throw new Error(
        `evidence provider ${provider.id} is transition evidence and cannot be stored in the repository-owned persistent manifest; move it to the exact review artifact`,
      );
    }
    if (storage === 'transition-artifact' && provider.lifecycle === 'transition') {
      validateTransitionProviderBinding(provider, binding);
    }
  }
  return { schemaVersion: 2, behaviorMatrix, providers, authorizations };
}

function validateEvidenceAuthorization(value: unknown): ReviewEvidenceManifest['authorizations'][number] {
  const item = asObject(value, 'evidence authorization');
  assertAllowedKeys(item, ['id', 'operation', 'scope', 'approvedBy', 'approvedAt', 'expiresAt'], 'evidence authorization');
  const authorization = {
    id: requiredId(item.id, 'authorization.id'),
    operation: requiredString(item.operation, 'authorization.operation'),
    scope: requiredString(item.scope, 'authorization.scope'),
    approvedBy: requiredString(item.approvedBy, 'authorization.approvedBy'),
    approvedAt: validDate(item.approvedAt, 'authorization.approvedAt'),
    expiresAt: validDate(item.expiresAt, 'authorization.expiresAt'),
  };
  if (Date.parse(authorization.expiresAt) <= Date.parse(authorization.approvedAt)) {
    throw new Error(`evidence authorization ${authorization.id} must expire after approval`);
  }
  return authorization;
}

function assertAuthorizationReferences(
  authorizations: ReviewEvidenceManifest['authorizations'],
  providers: EvidenceProvider[],
): void {
  const operations = providers.flatMap((provider) => provider.operations);
  for (const operation of operations.filter((entry) => entry.authorizationId)) {
    const matches = authorizations.filter((authorization) =>
      authorization.id === operation.authorizationId && authorization.operation === operation.id
    );
    if (matches.length !== 1) {
      throw new Error(`network operation ${operation.id} authorization is missing or mismatched`);
    }
  }
  for (const authorization of authorizations) {
    const matches = operations.filter((operation) =>
      operation.id === authorization.operation && operation.authorizationId === authorization.id
    );
    if (matches.length !== 1) {
      throw new Error(`evidence authorization ${authorization.id} must be referenced by exactly one operation ${authorization.operation}`);
    }
  }
}

function validateBehaviorCell(value: unknown): BehaviorCell {
  const item = asObject(value, 'behavior cell');
  assertAllowedKeys(item, ['id', 'behavior', 'kind', 'input', 'preconditions', 'expected', 'risk', 'disposition', 'providerIds', 'reason'], 'behavior cell');
  const kind = requiredString(item.kind, 'behavior cell.kind');
  if (!['normal', 'branch', 'exception', 'boundary'].includes(kind)) {
    throw new Error(`invalid behavior cell kind: ${kind}`);
  }
  const risk = requiredString(item.risk, 'behavior cell.risk') as BehaviorRisk;
  if (!RISKS.has(risk)) throw new Error(`invalid behavior cell risk: ${risk}`);
  const disposition = requiredString(item.disposition, 'behavior cell.disposition') as CellDisposition;
  if (!DISPOSITIONS.has(disposition)) throw new Error(`invalid behavior cell disposition: ${disposition}`);
  const providerIds = requiredIdList(item.providerIds, 'behavior cell.providerIds');
  assertUnique(providerIds, 'behavior cell provider');
  const reason = optionalString(item.reason);
  if (['not-applicable', 'unsupported', 'manual'].includes(disposition) && !reason) {
    throw new Error(`behavior cell ${String(item.id)} disposition ${disposition} requires a reason`);
  }
  if (!['not-applicable', 'unsupported', 'manual'].includes(disposition) && providerIds.length === 0) {
    throw new Error(`behavior cell ${String(item.id)} disposition ${disposition} requires a provider`);
  }
  return {
    id: requiredId(item.id, 'behavior cell.id'),
    behavior: requiredString(item.behavior, 'behavior cell.behavior'),
    kind: kind as BehaviorCell['kind'],
    input: requiredString(item.input, 'behavior cell.input'),
    preconditions: requiredString(item.preconditions, 'behavior cell.preconditions'),
    expected: requiredString(item.expected, 'behavior cell.expected'),
    risk,
    disposition,
    providerIds,
    ...(reason ? { reason } : {}),
  };
}

function validateEvidenceProvider(value: unknown): EvidenceProvider {
  const item = asObject(value, 'evidence provider');
  assertAllowedKeys(item, ['id', 'owner', 'kind', 'lifecycle', 'cellIds', 'applicability', 'executionContext', 'transitionBinding', 'operations'], 'evidence provider');
  const kind = requiredString(item.kind, 'evidence provider.kind') as EvidenceProviderKind;
  if (!KINDS.has(kind)) throw new Error(`invalid evidence provider kind: ${kind}`);
  if (!Array.isArray(item.operations) || item.operations.length === 0) {
    throw new Error(`evidence provider ${String(item.id)} operations must be non-empty`);
  }
  const lifecycle = requiredString(item.lifecycle, 'evidence provider.lifecycle');
  if (lifecycle !== 'persistent' && lifecycle !== 'transition') {
    throw new Error(`invalid evidence provider lifecycle: ${lifecycle}`);
  }
  const applicability = validateEvidenceApplicability(item.applicability);
  const executionContext = validateEvidenceExecutionContext(item.executionContext);
  const operations = item.operations.map(validateEvidenceOperation);
  const cellIds = requiredUniqueIdArray(item.cellIds, 'evidence provider.cellIds');
  const transitionBinding =
    item.transitionBinding === undefined ? undefined : validateTransitionEvidenceBinding(item.transitionBinding);
  if (lifecycle === 'persistent' && transitionBinding) {
    throw new Error(`persistent evidence provider ${String(item.id)} cannot declare transitionBinding`);
  }
  if (lifecycle === 'transition' && !transitionBinding) {
    throw new Error(`transition evidence provider ${String(item.id)} requires exact transitionBinding`);
  }
  return {
    id: requiredId(item.id, 'evidence provider.id'),
    owner: requiredString(item.owner, 'evidence provider.owner'),
    kind,
    lifecycle,
    cellIds,
    applicability,
    executionContext,
    transitionBinding,
    operations,
  };
}

function validateEvidenceApplicability(value: unknown): EvidenceApplicability {
  const item = asObject(value, 'evidence provider.applicability');
  assertAllowedKeys(item, ['kind', 'pathPrefixes', 'reason'], 'evidence provider.applicability');
  const kind = requiredString(item.kind, 'evidence provider.applicability.kind');
  if (kind === 'paths') {
    if (!Array.isArray(item.pathPrefixes) || item.pathPrefixes.length === 0) {
      throw new Error('evidence provider.applicability.pathPrefixes must be a non-empty string array');
    }
    const pathPrefixes = item.pathPrefixes.map(validateApplicabilityPathPrefix);
    assertUniqueValues(pathPrefixes, 'evidence applicability path prefixes');
    if (item.reason !== undefined) {
      throw new Error('path-scoped evidence provider applicability cannot declare a global reason');
    }
    return { kind, pathPrefixes: uniqueSorted(pathPrefixes) };
  }
  if (kind === 'global') {
    if (item.pathPrefixes !== undefined) {
      throw new Error('global evidence provider applicability cannot declare pathPrefixes');
    }
    return {
      kind,
      reason: requiredString(item.reason, 'evidence provider.applicability.reason'),
    };
  }
  throw new Error(`invalid evidence provider applicability kind: ${kind}`);
}

function validateApplicabilityPathPrefix(value: unknown): string {
  if (typeof value !== 'string' || value.trim() !== value || value === '') {
    throw new Error('evidence applicability path prefix must be a normalized repo-relative path');
  }
  const segments = value.split('/');
  if (value.startsWith('/') || /^[A-Za-z]:\//.test(value) || value.includes('\\') || segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error(`invalid evidence applicability path prefix: ${value}`);
  }
  return value;
}

function validateEvidenceExecutionContext(value: unknown): EvidenceExecutionContext {
  const item = asObject(value, 'evidence provider.executionContext');
  assertAllowedKeys(item, ['sandboxOwner', 'runner', 'lane'], 'evidence provider.executionContext');
  const sandboxOwner = requiredString(item.sandboxOwner, 'evidence provider.executionContext.sandboxOwner');
  const runner = requiredString(item.runner, 'evidence provider.executionContext.runner');
  if (sandboxOwner === 'review-runtime' && runner === 'sealed') {
    if (item.lane !== undefined) {
      throw new Error('sealed review-runtime execution context cannot declare a host lane');
    }
    return { sandboxOwner, runner };
  }
  if (sandboxOwner === 'provider' && (runner === 'host-seatbelt' || runner === 'github-actions' || runner === 'local-host')) {
    return {
      sandboxOwner,
      runner,
      lane: requiredString(item.lane, 'evidence provider.executionContext.lane'),
    };
  }
  throw new Error(`unsupported evidence execution context: sandboxOwner=${sandboxOwner}, runner=${runner}`);
}

function validateTransitionEvidenceBinding(value: unknown): TransitionEvidenceBinding {
  const item = asObject(value, 'evidence provider.transitionBinding');
  assertAllowedKeys(item, ['repository', 'baseDigest', 'candidateDigest', 'scopeDigest', 'operationContractDigest'], 'evidence provider.transitionBinding');
  const result = {
    repository: requiredString(item.repository, 'transitionBinding.repository'),
    baseDigest: requiredString(item.baseDigest, 'transitionBinding.baseDigest'),
    candidateDigest: requiredString(item.candidateDigest, 'transitionBinding.candidateDigest'),
    scopeDigest: requiredString(item.scopeDigest, 'transitionBinding.scopeDigest'),
    operationContractDigest: requiredString(item.operationContractDigest, 'transitionBinding.operationContractDigest'),
  };
  assertSha256(result.baseDigest, 'transitionBinding.baseDigest');
  assertSha256(result.candidateDigest, 'transitionBinding.candidateDigest');
  assertSha256(result.scopeDigest, 'transitionBinding.scopeDigest');
  assertSha256(result.operationContractDigest, 'transitionBinding.operationContractDigest');
  return result;
}

function validateEvidenceOperation(value: unknown): EvidenceOperation {
  const item = asObject(value, 'evidence operation');
  assertAllowedKeys(item, ['id', 'target', 'argv', 'expectedExit', 'expectedExitCode', 'timeoutMs', 'maxOutputBytes', 'network', 'authorizationId', 'evidenceLevel', 'requiredSystemTools', 'pythonRuntime', 'seed', 'iterations'], 'evidence operation');
  const target = requiredString(item.target, 'evidence operation.target');
  if (target !== 'base' && target !== 'candidate') throw new Error(`invalid evidence operation target: ${target}`);
  const expectedExit = requiredString(item.expectedExit, 'evidence operation.expectedExit');
  if (expectedExit !== 'zero' && expectedExit !== 'nonzero') {
    throw new Error(`invalid evidence operation.expectedExit: ${expectedExit}`);
  }
  const { network, authorizationId } = validateOperationNetwork(item);
  const evidenceLevel = requiredString(item.evidenceLevel, 'evidence operation.evidenceLevel') as EvidenceLevel;
  if (!LEVELS.has(evidenceLevel)) throw new Error(`invalid evidence level: ${evidenceLevel}`);
  if (
    ['live-provider', 'device-platform', 'production-readback'].includes(evidenceLevel) &&
    network !== 'authorized'
  ) {
    throw new Error(
      `evidence level ${evidenceLevel} requires an authorized external runner`,
    );
  }
  const argv = requiredStringArray(item.argv, 'evidence operation.argv');
  if (argv[0]!.includes('/') || argv[0]!.includes('\\')) {
    throw new Error('evidence operation executable must be a PATH-resolved command name');
  }
  const requiredSystemTools = validateRequiredSystemTools(item.requiredSystemTools);
  const pythonRuntime = optionalPythonEvidenceRuntime(item.pythonRuntime, argv, network);
  validatePythonSystemToolOwnership(pythonRuntime, requiredSystemTools);
  const timeoutMs = boundedInteger(item.timeoutMs, 'evidence operation.timeoutMs', 100, 15 * 60 * 1000);
  const maxOutputBytes = boundedInteger(item.maxOutputBytes, 'evidence operation.maxOutputBytes', 1, MAX_REVIEW_EVIDENCE_OUTPUT_BYTES);
  const expectedExitCode = item.expectedExitCode === undefined
    ? undefined
    : boundedInteger(item.expectedExitCode, 'evidence operation.expectedExitCode', 1, 255);
  if (expectedExit === 'nonzero' && expectedExitCode === undefined) {
    throw new Error(`evidence operation ${String(item.id)} expectedExit nonzero requires expectedExitCode`);
  }
  if (expectedExit === 'zero' && expectedExitCode !== undefined) {
    throw new Error(`evidence operation ${String(item.id)} expectedExit zero cannot declare expectedExitCode`);
  }
  return {
    id: requiredId(item.id, 'evidence operation.id'),
    target: target as EvidenceOperation['target'],
    argv,
    expectedExit: expectedExit as EvidenceOperation['expectedExit'],
    expectedExitCode,
    timeoutMs,
    maxOutputBytes,
    network,
    authorizationId,
    evidenceLevel,
    requiredSystemTools: uniqueSorted(requiredSystemTools),
    pythonRuntime,
    seed: optionalString(item.seed),
    iterations: item.iterations === undefined ? undefined : boundedInteger(item.iterations, 'evidence operation.iterations', 1, 1_000_000),
  };
}

// Direct interpreter names only; shell wrappers and project scripts are not parsed.
const PYTHON_COMMAND = /^python(?:[0-9]+(?:\.[0-9]+)*)?(?:[dtw])?(?:\.exe)?$/i;
export const PYTHON_RUNTIME_GUIDANCE = 'Python gates require argv[0]="python3.14", network="deny", and pythonRuntime={"interpreter":"python3.14","resolver":"uv","projectFile":"pyproject.toml","lockFile":"uv.lock"}. Requires trusted macOS Python 3.14 and uv, candidate project/lock files in the same directory, and complete offline dependencies; missing prerequisites block execution. Other Python versions are unsupported; do not guess paths or download dependencies.';

function optionalPythonEvidenceRuntime(
  value: unknown,
  argv: string[],
  network: EvidenceOperation['network'],
): PythonEvidenceRuntime | undefined {
  if (value === undefined && PYTHON_COMMAND.test(argv[0]!)) {
    throw new Error(`Missing evidence operation.pythonRuntime. ${PYTHON_RUNTIME_GUIDANCE}`);
  }
  return value === undefined ? undefined : validatePythonEvidenceRuntime(value, argv, network);
}

function validatePythonSystemToolOwnership(
  pythonRuntime: PythonEvidenceRuntime | undefined,
  requiredSystemTools: string[],
): void {
  if (requiredSystemTools.some((tool) => PYTHON_COMMAND.test(tool))) {
    throw new Error(`Python requiredSystemTools cannot use generic child runtime projection; declare a separate Python operation. ${PYTHON_RUNTIME_GUIDANCE}`);
  }
  if (pythonRuntime && requiredSystemTools.some((tool) => tool === 'python3.14' || tool === 'uv')) {
    throw new Error('Python evidence runtime owns its interpreter and resolver; do not redeclare them as system tools');
  }
}

function validatePythonEvidenceRuntime(
  value: unknown,
  argv: string[],
  network: EvidenceOperation['network'],
): PythonEvidenceRuntime {
  const item = asObject(value, 'evidence operation.pythonRuntime');
  assertAllowedKeys(
    item,
    ['interpreter', 'resolver', 'projectFile', 'lockFile'],
    'evidence operation.pythonRuntime',
  );
  const interpreter = requiredString(
    item.interpreter,
    'evidence operation.pythonRuntime.interpreter',
  );
  const resolver = requiredString(item.resolver, 'evidence operation.pythonRuntime.resolver');
  if (interpreter !== 'python3.14') {
    throw new Error(`unsupported evidence Python interpreter: ${interpreter}`);
  }
  if (resolver !== 'uv') throw new Error(`unsupported evidence Python resolver: ${resolver}`);
  if (argv[0] !== interpreter) {
    throw new Error('Python evidence operation argv must start with its declared interpreter');
  }
  if (network !== 'deny') {
    throw new Error('Python evidence runtime requires network deny');
  }
  return {
    interpreter,
    resolver,
    projectFile: validatePythonContractPath(
      item.projectFile,
      'evidence operation.pythonRuntime.projectFile',
      'pyproject.toml',
    ),
    lockFile: validatePythonContractPath(
      item.lockFile,
      'evidence operation.pythonRuntime.lockFile',
      'uv.lock',
    ),
  };
}

function validatePythonContractPath(
  value: unknown,
  field: string,
  requiredBasename: string,
): string {
  const path = requiredString(value, field);
  const segments = path.split('/');
  if (
    isAbsolute(path) ||
    /^[A-Za-z]:\//.test(path) ||
    path.includes('\\') ||
    segments.some((segment) => !segment || segment === '.' || segment === '..') ||
    basename(path) !== requiredBasename
  ) {
    throw new Error(`${field} must be a normalized repo-relative ${requiredBasename} path`);
  }
  return path;
}

function validateOperationNetwork(item: Record<string, unknown>): Pick<EvidenceOperation, 'network' | 'authorizationId'> {
  const network = requiredString(item.network, 'evidence operation.network');
  if (network !== 'deny' && network !== 'authorized' && network !== 'host') throw new Error(`invalid evidence operation.network: ${network}`);
  const authorizationId = optionalString(item.authorizationId);
  if (network === 'authorized' && !authorizationId) {
    throw new Error(`network operation ${String(item.id)} requires typed authorization`);
  }
  if (network !== 'authorized' && authorizationId) {
    throw new Error(`network-denied operation ${String(item.id)} cannot carry authorization`);
  }
  return { network, authorizationId };
}

function validateRequiredSystemTools(value: unknown): string[] {
  const tools = optionalStringArray(value, 'evidence operation.requiredSystemTools');
  assertUniqueValues(tools, 'evidence operation requiredSystemTools');
  for (const tool of tools) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/.test(tool)) {
      throw new Error(`invalid evidence system tool name: ${tool}`);
    }
  }
  return tools;
}

function validateProviderContract(provider: EvidenceProvider): void {
  assertLocalReviewProvider(provider);
  const base = provider.operations.filter((operation) => operation.target === 'base');
  const candidate = provider.operations.filter((operation) => operation.target === 'candidate');
  if (provider.kind === 'regression' &&
      !(base.some((operation) => operation.expectedExit === 'nonzero') &&
        candidate.some((operation) => operation.expectedExit === 'zero'))) {
    throw new Error(`regression provider ${provider.id} requires base/nonzero RED and candidate/zero GREEN operations`);
  }
  const staleRed = base.find((operation) => operation.expectedExit === 'nonzero');
  if (provider.lifecycle === 'persistent' && staleRed) {
    throw new Error(
      `persistent evidence provider ${provider.id} contains stale-prone operation=${staleRed.id}; actual=target:${staleRed.target},expectedExit:${staleRed.expectedExit}; expected=persistent candidate/zero or exact-bound transition RED; owner=${provider.owner}; scope=${stableJson(provider.applicability)}; executionContext=${stableJson(provider.executionContext)}; fix=move exact RED evidence to a transition artifact or replace it with a successor-safe candidate fixture`,
    );
  }
  if (provider.kind !== 'regression' && base.length > 0) {
    throw new Error(`only regression providers may execute against base: ${provider.id}`);
  }
  if (provider.kind === 'property-fuzz') {
    for (const operation of provider.operations) {
      if (!operation.seed || !operation.iterations) {
        throw new Error(`property/fuzz provider ${provider.id} requires seed and iterations`);
      }
    }
  }
  if (provider.kind === 'runtime-integration' &&
      provider.operations.some((operation) => !LEVELS.has(operation.evidenceLevel))) {
    throw new Error(`runtime integration provider ${provider.id} requires an evidence level`);
  }
}

function validateTransitionProviderBinding(provider: EvidenceProvider, binding: CandidateBinding | undefined): void {
  if (!binding) {
    throw new Error(`transition evidence provider ${provider.id} requires the current candidate binding`);
  }
  const expected = provider.transitionBinding!;
  const actual = {
    repository: binding.repository,
    baseDigest: binding.baseDigest,
    candidateDigest: binding.candidateDigest,
    scopeDigest: binding.scopeDigest,
    operationContractDigest: transitionEvidenceOperationContractDigest(provider.operations),
  };
  for (const key of Object.keys(actual) as Array<keyof typeof actual>) {
    if (expected[key] !== actual[key]) {
      throw new Error(
        `transition evidence provider ${provider.id} binding mismatch for ${key}: actual=${actual[key]} expected=${expected[key]}; owner=${provider.owner}; scope=${binding.scopeDigest}; fix=regenerate transition evidence for this exact repository/base/candidate/scope/operation`,
      );
    }
  }
}

export function validateTransitionReviewEvidenceManifest(
  value: unknown,
  binding: CandidateBinding,
): ReviewEvidenceManifest {
  return validateReviewEvidenceManifest(value, 'transition-artifact', binding);
}

export function transitionEvidenceOperationContractDigest(operations: EvidenceOperation[]): string {
  return sha256(
    stableJson(
      operations.map((operation) => ({
        id: operation.id,
        target: operation.target,
        argv: operation.argv,
        expectedExit: operation.expectedExit,
        expectedExitCode: operation.expectedExitCode ?? null,
        timeoutMs: operation.timeoutMs,
        maxOutputBytes: operation.maxOutputBytes,
        network: operation.network,
        authorizationId: operation.authorizationId ?? null,
        evidenceLevel: operation.evidenceLevel,
        requiredSystemTools: operation.requiredSystemTools ?? [],
        pythonRuntime: operation.pythonRuntime ?? null,
        seed: operation.seed ?? null,
        iterations: operation.iterations ?? null,
      })),
    ),
  );
}

function validateOperationAuthorization(
  operation: EvidenceOperation,
  manifest: ReviewEvidenceManifest,
): void {
  if (operation.network === 'deny' || operation.network === 'host') {
    if (operation.authorizationId) throw new Error(`network-denied operation ${operation.id} cannot carry authorization`);
    return;
  }
  if (!operation.authorizationId) throw new Error(`network operation ${operation.id} requires typed authorization`);
  const authorization = manifest.authorizations.find((entry) => entry.id === operation.authorizationId);
  if (!authorization || authorization.operation !== operation.id) {
    throw new Error(`network operation ${operation.id} authorization is missing or mismatched`);
  }
  const now = Date.now();
  if (Date.parse(authorization.approvedAt) > now || Date.parse(authorization.expiresAt) <= now) {
    throw new Error(`network operation ${operation.id} authorization is not currently valid`);
  }
  throw new Error(
    `network operation ${operation.id} requires an operation-specific external runner; local review runner is deny-only`,
  );
}

type PreparedEvidenceRuntime = {
  command: string;
  access: EvidenceRuntimeReadAccess;
  identityDigest: string;
  environment: Record<string, string>;
  verifyUnchanged: () => boolean;
};

function prepareEvidenceRuntime(
  command: string,
  runnerRoot: string,
  sourceAccess: EvidenceRuntimeReadAccess,
): PreparedEvidenceRuntime {
  if (process.platform !== 'darwin' || sourceAccess.links.length === 0) {
    return {
      command,
      access: sourceAccess,
      identityDigest: sourceAccess.identityDigest,
      environment: {},
      verifyUnchanged: () => true,
    };
  }
  const runtimeRoot = join(runnerRoot, 'runtime');
  const runtimeBin = join(runtimeRoot, 'bin');
  mkdirSync(runtimeBin, { recursive: true });
  const realRuntimeBin = realpathSync(runtimeBin);
  const projectedBySource = new Map<string, string>();
  const executableSource = realpathSync(command);
  const executableName = basename(executableSource);
  const sourceByProjectedName = new Map<string, string>();
  let projectedLibraryIndex = 0;
  for (const image of sourceAccess.images) {
    let name = executableName;
    if (image.sourcePath !== executableSource) {
      do {
        name = `_${projectedLibraryIndex.toString(36)}`;
        projectedLibraryIndex += 1;
      } while (name === executableName);
    }
    const existing = sourceByProjectedName.get(name);
    if (existing && existing !== image.sourcePath) {
      throw new Error(`review evidence runtime projection basename collision: ${name}`);
    }
    const destination = join(realRuntimeBin, name);
    if (!existing) {
      copyFileSync(image.sourcePath, destination, constants.COPYFILE_EXCL);
      if (runtimeImageContentDigest(destination) !== image.contentDigest) {
        throw new Error(`review evidence runtime image changed while projecting: ${image.sourcePath}`);
      }
      sourceByProjectedName.set(name, image.sourcePath);
    }
    projectedBySource.set(image.sourcePath, destination);
  }
  const changesByLoader = new Map<string, string[]>();
  for (const link of sourceAccess.links) {
    const loader = projectedBySource.get(link.loaderPath);
    if (!loader) throw new Error(`review evidence runtime projection omitted loader: ${link.loaderPath}`);
    const projectedInstallName = link.targetIsSystem
      ? link.resolvedPath
      : `@loader_path/${basename(projectedBySource.get(link.resolvedPath) ?? '')}`;
    if (projectedInstallName.endsWith('/')) {
      throw new Error(`review evidence runtime projection omitted library: ${link.resolvedPath}`);
    }
    if (projectedInstallName !== link.installName) {
      const changes = changesByLoader.get(loader) ?? [];
      changes.push('-change', link.installName, projectedInstallName);
      changesByLoader.set(loader, changes);
    }
  }
  for (const [loader, changes] of changesByLoader) {
    runRuntimeProjectionTool('/usr/bin/install_name_tool', [...changes, loader]);
  }
  const projectedCommand = projectedBySource.get(executableSource);
  if (!projectedCommand) throw new Error('review evidence runtime projection omitted executable');
  const projectedImages = uniqueSorted([...projectedBySource.values()]);
  const signingOrder = [
    ...projectedImages.filter((entry) => entry !== projectedCommand),
    projectedCommand,
  ];
  runRuntimeProjectionTool('/usr/bin/codesign', [
    '--force', '--sign', '-', '--timestamp=none', ...signingOrder,
  ]);
  for (const image of projectedImages) {
    chmodSync(image, image === projectedCommand ? 0o555 : 0o444);
  }
  const toolIdentityDigest = sha256(stableJson({
    installNameTool: runtimeImageContentDigest('/usr/bin/install_name_tool'),
    codesign: runtimeImageContentDigest('/usr/bin/codesign'),
  }));
  const projectionIdentity = () => runtimeProjectionIdentityDigest(
    realRuntimeBin,
    sourceAccess.identityDigest,
    toolIdentityDigest,
  );
  const identityDigest = projectionIdentity();
  return {
    command: projectedCommand,
    access: {
      roots: [...sourceAccess.roots, realRuntimeBin],
      literals: [],
      mapExecutableRoots: [realRuntimeBin],
      mapExecutableLiterals: [],
      images: [],
      links: [],
      missingWeakLinks: [],
      identityDigest,
    },
    identityDigest,
    environment: {
      PATH: `${realRuntimeBin}:/usr/bin:/bin`,
      OPENSSL_CONF: '/dev/null',
    },
    verifyUnchanged: () => {
      try {
        return projectionIdentity() === identityDigest;
      } catch {
        return false;
      }
    },
  };
}

function runRuntimeProjectionTool(command: string, args: string[]): void {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    timeout: 10_000,
    maxBuffer: 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`review evidence runtime projection tool failed: ${basename(command)}: ${boundText(
      `${result.stdout}\n${result.stderr}`.trim(),
      4096,
    )}`);
  }
}

function runtimeProjectionIdentityDigest(
  runtimeBin: string,
  sourceIdentityDigest: string,
  toolIdentityDigest: string,
): string {
  const entries = readdirSync(runtimeBin, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((entry) => {
      if (!entry.isFile() || entry.isSymbolicLink()) {
        throw new Error(`review evidence runtime projection contains invalid entry: ${entry.name}`);
      }
      const file = join(runtimeBin, entry.name);
      const stat = lstatSync(file);
      return {
        name: entry.name,
        mode: stat.mode & 0o777,
        size: stat.size,
        contentDigest: runtimeImageContentDigest(file),
      };
    });
  return sha256(stableJson({
    sourceIdentityDigest,
    toolIdentityDigest,
    environment: { OPENSSL_CONF: '/dev/null' },
    entries,
  }));
}

type RunEvidenceOperationOptions = {
  provider: EvidenceProvider;
  operation: EvidenceOperation;
  snapshotRoot: string;
  executionCwd: string;
  binding: CandidateBinding;
  dependencyDigest: string;
  changedFiles: string[];
  runnerRoot: string;
  runtimeProjectionRoot: string;
  preparedRuntimes: Map<string, PreparedEvidenceRuntime>;
  executionOffset: string;
};

type PreparedChildRuntime = {
  tool: string;
  command: string;
  sourceAccess: EvidenceRuntimeReadAccess;
  prepared: PreparedEvidenceRuntime;
};

type PreparedPythonEvidenceRuntime = {
  sourceCommand: string;
  sourceAccess: EvidenceRuntimeReadAccess;
  sourceRuntimeUnchanged: () => boolean;
  preparedRuntime: PreparedEvidenceRuntime;
  operationEnvironment: Record<string, string>;
  identityDigest: string;
};

class PythonRuntimePreparationError extends Error {}

type PreparedOperationRuntime = {
  replayCommand: string[];
  command: string;
  runtimeAccess: EvidenceRuntimeReadAccess;
  systemToolAccess: EvidenceSystemToolAccess;
  preparedRuntime: PreparedEvidenceRuntime;
  preparedChildRuntimes: PreparedChildRuntime[];
  sandboxRuntimeAccess: EvidenceRuntimeReadAccess;
  sourceRuntimeUnchanged: () => boolean;
  operationEnvironment: Record<string, string>;
  pythonRuntimeDigest?: string;
  executionIdentityDigest: string;
  commandDigest: string;
};

type EvidenceCommandResult = {
  reason: string;
  exitCode: number;
  stdout?: string;
  stderr?: string;
};

type EvidenceExecutionResult = {
  startedAt: string;
  finishedAt: string;
  result: EvidenceCommandResult;
  snapshotDigestBefore: string;
  snapshotDigestAfter: string;
  snapshotUnchanged: boolean;
  runtimeUnchanged: boolean;
  sandboxDenied: boolean;
  outputDigest: string;
  outputSummary: string;
};

async function runEvidenceOperation(
  options: RunEvidenceOperationOptions,
): Promise<ReviewEvidenceRecord> {
  if (options.provider.executionContext.runner === 'local-host') return runLocalReviewEvidence(options,
    () => snapshotContentDigest(options.snapshotRoot, []));
  const startedAt = new Date().toISOString();
  try {
    const runtime = await prepareOperationRuntime(options);
    const execution = await executePreparedOperation(options, runtime, startedAt);
    return evidenceRecord(options, runtime, execution);
  } catch (error) {
    if (!(error instanceof PythonRuntimePreparationError)) throw error;
    return pythonRuntimeIncompleteRecord(options, startedAt, error);
  }
}

async function prepareOperationRuntime(
  options: RunEvidenceOperationOptions,
): Promise<PreparedOperationRuntime> {
  const replayCommand = options.operation.argv.map((value) =>
    value.replaceAll('{seed}', options.operation.seed ?? ''));
  let python: PreparedPythonEvidenceRuntime | undefined;
  if (options.operation.pythonRuntime) {
    try {
      python = await preparePythonEvidenceRuntime(options);
    } catch (error) {
      throw new PythonRuntimePreparationError(errorMessage(error));
    }
  }
  const command = python?.sourceCommand ?? resolveExecutable(replayCommand[0]!);
  const runtimeAccess = python?.sourceAccess ?? evidenceRuntimeReadAccess(command);
  const systemToolAccess = evidenceSystemToolAccess(options.operation.requiredSystemTools);
  const preparedRuntime = python?.preparedRuntime ?? cachedEvidenceRuntime(options, command, runtimeAccess);
  const preparedChildRuntimes = options.operation.requiredSystemTools
    .filter((tool) => tool !== 'git')
    .map((tool) => prepareChildRuntime(options, tool));
  const sandboxRuntimeAccess = mergeEvidenceRuntimeReadAccess([
    preparedRuntime.access,
    ...preparedChildRuntimes.map((entry) => entry.prepared.access),
  ]);
  return {
    replayCommand,
    command,
    runtimeAccess,
    systemToolAccess,
    preparedRuntime,
    preparedChildRuntimes,
    sandboxRuntimeAccess,
    sourceRuntimeUnchanged: python?.sourceRuntimeUnchanged ?? (() => {
      try {
        return evidenceRuntimeReadAccess(command).identityDigest === runtimeAccess.identityDigest;
      } catch {
        return false;
      }
    }),
    operationEnvironment: python?.operationEnvironment ?? {},
    pythonRuntimeDigest: python?.identityDigest,
    executionIdentityDigest: operationExecutionIdentity(options, {
      command,
      runtimeAccess,
      systemToolAccess,
      preparedRuntime,
      preparedChildRuntimes,
      pythonRuntimeDigest: python?.identityDigest,
    }),
    commandDigest: operationCommandDigest(options),
  };
}

function cachedEvidenceRuntime(
  options: RunEvidenceOperationOptions,
  command: string,
  runtimeAccess: EvidenceRuntimeReadAccess,
): PreparedEvidenceRuntime {
  const key = sha256(stableJson({
    command,
    sourceRuntimeDigest: runtimeAccess.identityDigest,
    runnerPolicy: EVIDENCE_RUNNER_POLICY,
  }));
  const cached = options.preparedRuntimes.get(key);
  if (cached) return cached;
  const prepared = prepareEvidenceRuntime(
    command,
    join(options.runtimeProjectionRoot, key),
    runtimeAccess,
  );
  options.preparedRuntimes.set(key, prepared);
  return prepared;
}

function prepareChildRuntime(
  options: RunEvidenceOperationOptions,
  tool: string,
): PreparedChildRuntime {
  const command = resolveExecutable(tool);
  const sourceAccess = evidenceRuntimeReadAccess(command);
  return {
    tool,
    command,
    sourceAccess,
    prepared: cachedEvidenceRuntime(options, command, sourceAccess),
  };
}

async function preparePythonEvidenceRuntime(
  options: RunEvidenceOperationOptions,
): Promise<PreparedPythonEvidenceRuntime> {
  const contract = options.operation.pythonRuntime!;
  const inputs = preparePythonRuntimeInputs(options, contract);
  const environmentRoot = materializePythonEnvironment(options, inputs);
  const environmentPython = validateMaterializedPythonEnvironment(
    environmentRoot,
    inputs.sourceCommand,
    options.binding.repository,
    options.snapshotRoot,
  );
  const environmentDigest = dependencyEnvironmentDigest(environmentRoot);
  const dependencyIdentityDigest = pythonDependencyIdentityDigest(
    environmentRoot,
    options.snapshotRoot,
  );
  const offlineArtifactDigest = pythonOfflineArtifactDigest(
    environmentRoot,
    inputs.lockFile,
    options.snapshotRoot,
  );
  const environmentAccess = pythonEnvironmentReadAccess(environmentRoot, environmentDigest);
  const runtimeAccess = mergeEvidenceRuntimeReadAccess([inputs.sourceAccess, environmentAccess]);
  runPythonBootstrapPreflight({
    options,
    environmentPython,
    environmentRoot,
    projectRoot: dirname(inputs.projectFile),
    runtimeAccess,
  });
  const identityDigest = pythonExecutionIdentity(
    contract,
    inputs,
    dependencyIdentityDigest,
    offlineArtifactDigest,
  );
  return preparedPythonRuntime({
    inputs,
    environmentRoot,
    environmentPython,
    runtimeAccess,
    identityDigest,
    environmentDigest,
  });
}

type PythonRuntimeInputs = {
  projectFile: string;
  lockFile: string;
  sourceCommand: string;
  sourceAccess: EvidenceRuntimeReadAccess;
  sourceInspection: PythonRuntimeInspection;
  sourceIdentity: string;
  preparedUv: PreparedEvidenceRuntime;
  ambientCacheRoot: string;
};

function preparePythonRuntimeInputs(
  options: RunEvidenceOperationOptions,
  contract: PythonEvidenceRuntime,
): PythonRuntimeInputs {
  const projectFile = requiredSnapshotFile(options.snapshotRoot, contract.projectFile);
  const lockFile = requiredSnapshotFile(options.snapshotRoot, contract.lockFile);
  if (dirname(projectFile) !== dirname(lockFile)) {
    throw new Error('declared pyproject.toml and uv.lock must share one project directory');
  }
  const selectedPython = resolveTrustedPythonTool(
    contract.interpreter,
    options.binding.repository,
    'Python interpreter',
  );
  const sourceCommand = realpathSync(selectedPython);
  const source = inspectPythonRuntime(sourceCommand, options.snapshotRoot);
  const sourceAccess = pythonRuntimeReadAccess(sourceCommand, source);
  const sourceIdentity = sourceAccess.identityDigest;
  const uvCommand = resolveTrustedPythonTool(
    contract.resolver,
    options.binding.repository,
    'uv resolver',
  );
  const uvAccess = evidenceRuntimeReadAccess(uvCommand);
  const preparedUv = cachedEvidenceRuntime(options, uvCommand, uvAccess);
  const ambientCacheRoot = pythonLockNeedsOfflineCache(lockFile)
    ? uvCacheRoot(options, preparedUv)
    : emptyPythonUvCache(options);
  return {
    projectFile,
    lockFile,
    sourceCommand,
    sourceAccess,
    sourceInspection: source,
    sourceIdentity,
    preparedUv,
    ambientCacheRoot,
  };
}

function pythonLockNeedsOfflineCache(lockFile: string): boolean {
  return /^(?:wheels|sdist)\s*=/m.test(readFileSync(lockFile, 'utf8'));
}

function emptyPythonUvCache(options: RunEvidenceOperationOptions): string {
  const root = join(options.runnerRoot, 'python-empty-uv-cache');
  mkdirSync(root, { recursive: true, mode: 0o700 });
  return root;
}

function materializePythonEnvironment(
  options: RunEvidenceOperationOptions,
  inputs: PythonRuntimeInputs,
): string {
  const pythonRoot = join(options.runnerRoot, 'python-runtime');
  const environmentRoot = join(pythonRoot, 'environment');
  const homeRoot = join(pythonRoot, 'home');
  const tempRoot = join(pythonRoot, 'tmp');
  for (const root of [pythonRoot, homeRoot, tempRoot]) mkdirSync(root, { recursive: true, mode: 0o700 });
  const cacheRoot = join(pythonRoot, 'uv-cache');
  materializePythonUvCache(inputs.ambientCacheRoot, cacheRoot);
  const cacheAccess = ambientUvCacheReadAccess(cacheRoot);
  const preparationAccess = mergeEvidenceRuntimeReadAccess([
    inputs.preparedUv.access,
    inputs.sourceAccess,
    cacheAccess,
  ]);
  runPythonEnvironmentSync({
    options,
    projectRoot: dirname(inputs.projectFile),
    environmentRoot,
    homeRoot,
    tempRoot,
    cacheRoot,
    sourceCommand: inputs.sourceCommand,
    preparedUv: inputs.preparedUv,
    preparationAccess,
  });
  materializePythonLaunchers(environmentRoot, inputs.sourceCommand);
  removeUvVirtualenvCustomization(environmentRoot);
  return environmentRoot;
}

function pythonExecutionIdentity(
  contract: PythonEvidenceRuntime,
  inputs: PythonRuntimeInputs,
  dependencyIdentityDigest: string,
  offlineArtifactDigest: string,
): string {
  const components = {
    contract,
    projectFileDigest: sha256(readFileSync(inputs.projectFile)),
    lockFileDigest: sha256(readFileSync(inputs.lockFile)),
    interpreterIdentityDigest: inputs.sourceIdentity,
    uvIdentityDigest: inputs.preparedUv.identityDigest,
    dependencyEnvironmentDigest: dependencyIdentityDigest,
    offlineArtifactDigest,
    runnerPolicy: EVIDENCE_RUNNER_POLICY,
  };
  return sha256(stableJson(components));
}

function preparedPythonRuntime(input: {
  inputs: PythonRuntimeInputs;
  environmentRoot: string;
  environmentPython: string;
  runtimeAccess: EvidenceRuntimeReadAccess;
  identityDigest: string;
  environmentDigest: string;
}): PreparedPythonEvidenceRuntime {
  const { inputs, environmentRoot, environmentPython, runtimeAccess, identityDigest, environmentDigest } = input;
  return {
    sourceCommand: inputs.sourceCommand,
    sourceAccess: inputs.sourceAccess,
    sourceRuntimeUnchanged: () => {
      try {
        return pythonRuntimeReadAccess(
          inputs.sourceCommand,
          inputs.sourceInspection,
        ).identityDigest === inputs.sourceIdentity;
      } catch {
        return false;
      }
    },
    preparedRuntime: {
      command: environmentPython,
      access: runtimeAccess,
      identityDigest,
      environment: {},
      verifyUnchanged: () => {
        try {
          return dependencyEnvironmentDigest(environmentRoot) === environmentDigest;
        } catch {
          return false;
        }
      },
    },
    operationEnvironment: {
      PYTHONNOUSERSITE: '1',
      PYTHONDONTWRITEBYTECODE: '1',
      PYTHONHASHSEED: '0',
      PYTHONPATH: '',
      VIRTUAL_ENV: environmentRoot,
      UV_OFFLINE: '1',
      UV_PYTHON_DOWNLOADS: 'never',
    },
    identityDigest,
  };
}

function materializePythonLaunchers(environmentRoot: string, sourceCommand: string): void {
  const sourceDigest = executableContentDigest(sourceCommand);
  for (const name of ['python', 'python3', 'python3.14']) {
    const launcher = join(environmentRoot, 'bin', name);
    if (existsSync(launcher)) rmSync(launcher);
    copyFileSync(sourceCommand, launcher, constants.COPYFILE_EXCL);
    chmodSync(launcher, 0o555);
    if (executableContentDigest(launcher) !== sourceDigest) {
      throw new Error(`materialized Python launcher identity mismatch: ${name}`);
    }
  }
}

function removeUvVirtualenvCustomization(environmentRoot: string): void {
  const sitePackages = join(environmentRoot, 'lib', 'python3.14', 'site-packages');
  const pth = join(sitePackages, '_virtualenv.pth');
  const module = join(sitePackages, '_virtualenv.py');
  if (!existsSync(pth)) return;
  const stat = lstatSync(pth);
  if (!stat.isFile() || stat.isSymbolicLink() || readFileSync(pth, 'utf8').trim() !== 'import _virtualenv') {
    throw new Error('uv created an unrecognized virtualenv site customization');
  }
  rmSync(pth);
  if (existsSync(module)) {
    const moduleStat = lstatSync(module);
    if (!moduleStat.isFile() || moduleStat.isSymbolicLink()) {
      throw new Error('uv virtualenv support module is not a regular file');
    }
    rmSync(module);
  }
}

function requiredSnapshotFile(snapshotRoot: string, relativePath: string): string {
  const file = resolveWithin(snapshotRoot, relativePath);
  const stat = lstatSync(file, { throwIfNoEntry: false });
  if (!stat?.isFile() || stat.isSymbolicLink()) {
    throw new Error(`Python runtime contract file is missing or not a regular file: ${relativePath}`);
  }
  if (!realpathSync(file).startsWith(`${realpathSync(snapshotRoot)}${sep}`)) {
    throw new Error(`Python runtime contract file escapes candidate snapshot: ${relativePath}`);
  }
  return file;
}

function rejectRepositoryRuntime(command: string, repository: string, label: string): void {
  const selected = join(realpathSync(dirname(resolve(command))), basename(command));
  const executable = realpathSync(command);
  const root = realpathSync(repository);
  if (
    selected === root || selected.startsWith(`${root}${sep}`) ||
    executable === root || executable.startsWith(`${root}${sep}`)
  ) {
    throw new Error(`${label} must not come from the source checkout or its virtual environment`);
  }
}

const TRUSTED_PYTHON_TOOL_ROOTS = [
  '/opt/homebrew/bin',
  '/opt/homebrew/Cellar',
  '/usr/local/bin',
  '/usr/local/Cellar',
  '/usr/bin',
  '/bin',
  '/Library/Frameworks',
];

function resolveTrustedPythonTool(command: string, repository: string, label: string): string {
  const selected = resolveExecutable(command);
  rejectRepositoryRuntime(selected, repository, label);
  const canonical = realpathSync(selected);
  if (![selected, canonical].every(pathIsInTrustedPythonToolRoot)) {
    throw new Error(`${label} must resolve from a trusted host package root`);
  }
  return selected;
}

function pathIsInTrustedPythonToolRoot(path: string): boolean {
  const absolute = resolve(path);
  return TRUSTED_PYTHON_TOOL_ROOTS.some(
    (root) => absolute === root || absolute.startsWith(`${root}${sep}`),
  );
}

type PythonRuntimeInspection = {
  executable: string;
  version: string;
  basePrefix: string;
  stdlib: string;
};

function inspectPythonRuntime(command: string, snapshotRoot: string): PythonRuntimeInspection {
  const expectedPrefix = pythonBasePrefix(command);
  const bootstrapAccess = mergeEvidenceRuntimeReadAccess([
    evidenceRuntimeReadAccess(command),
    pythonPrefixReadAccess(expectedPrefix),
  ]);
  const script = [
    'import json,sys,sysconfig',
    'print(json.dumps({"executable":sys.executable,"version":"%d.%d"%sys.version_info[:2],"basePrefix":sys.base_prefix,"stdlib":sysconfig.get_path("stdlib")}))',
  ].join(';');
  const sandbox = evidenceSandboxCommand({
    cwd: snapshotRoot,
    writableRoots: [],
    argv: [command, '-I', '-S', '-c', script],
    runtimeAccess: bootstrapAccess,
  });
  const result = spawnSync(sandbox.command, sandbox.args, {
    cwd: snapshotRoot,
    encoding: 'utf8',
    timeout: 10_000,
    maxBuffer: 64 * 1024,
    env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8', LC_ALL: '' },
  });
  if (result.status !== 0) {
    throw new Error(`Python interpreter preflight failed: ${boundText(result.stderr || result.stdout, 4096)}`);
  }
  const value = asObject(JSON.parse(result.stdout), 'Python interpreter inspection');
  const inspection = {
    executable: requiredString(value.executable, 'Python interpreter executable'),
    version: requiredString(value.version, 'Python interpreter version'),
    basePrefix: requiredString(value.basePrefix, 'Python interpreter base prefix'),
    stdlib: requiredString(value.stdlib, 'Python interpreter stdlib'),
  };
  if (inspection.version !== '3.14') {
    throw new Error(`Python interpreter version mismatch: expected=3.14 actual=${inspection.version}`);
  }
  if (realpathSync(inspection.executable) !== realpathSync(command)) {
    throw new Error('Python interpreter reported an unexpected executable');
  }
  for (const [label, path] of [['base prefix', inspection.basePrefix], ['stdlib', inspection.stdlib]] as const) {
    if (!isAbsolute(path) || !existsSync(path)) throw new Error(`Python interpreter ${label} is unavailable`);
  }
  if (realpathSync(inspection.basePrefix) !== expectedPrefix) {
    throw new Error('Python interpreter reported an unexpected base prefix');
  }
  return inspection;
}

function pythonBasePrefix(command: string): string {
  let candidate = dirname(realpathSync(command));
  for (let depth = 0; depth < 12; depth += 1) {
    if (existsSync(join(candidate, 'lib', 'python3.14'))) return realpathSync(candidate);
    const parent = dirname(candidate);
    if (parent === candidate) break;
    candidate = parent;
  }
  throw new Error('Python 3.14 base prefix cannot be derived without executing the interpreter');
}

function pythonPrefixReadAccess(prefix: string): EvidenceRuntimeReadAccess {
  const digest = directoryContentDigest(prefix, 'Python interpreter bootstrap runtime');
  return {
    roots: [prefix],
    literals: [],
    mapExecutableRoots: [prefix],
    mapExecutableLiterals: [],
    images: [],
    links: [],
    missingWeakLinks: [],
    identityDigest: sha256(stableJson({ kind: 'python-bootstrap-prefix', prefix, digest })),
  };
}

function pythonRuntimeReadAccess(
  command: string,
  inspection: PythonRuntimeInspection,
): EvidenceRuntimeReadAccess {
  const base = evidenceRuntimeReadAccess(command);
  const prefix = realpathSync(inspection.basePrefix);
  const stdlib = realpathSync(inspection.stdlib);
  if (stdlib !== prefix && !stdlib.startsWith(`${prefix}${sep}`)) {
    throw new Error('Python stdlib resolves outside the declared interpreter prefix');
  }
  const prefixDigest = directoryContentDigest(prefix, 'Python interpreter runtime');
  return mergeEvidenceRuntimeReadAccess([
    base,
    ...pythonStdlibExtensionAccess(stdlib),
    {
      roots: [prefix],
      literals: [],
      mapExecutableRoots: [prefix],
      mapExecutableLiterals: [],
      images: [],
      links: [],
      missingWeakLinks: [],
      identityDigest: sha256(stableJson({
        executable: realpathSync(command),
        reportedExecutable: inspection.executable,
        version: inspection.version,
        prefix,
        prefixDigest,
      })),
    },
  ]);
}

function pythonStdlibExtensionAccess(stdlib: string): EvidenceRuntimeReadAccess[] {
  const extensions = join(stdlib, 'lib-dynload');
  if (!existsSync(extensions)) return [];
  if (!realpathSync(extensions).startsWith(`${stdlib}${sep}`)) {
    throw new Error('Python native stdlib directory resolves outside the declared stdlib');
  }
  // dlopen dependencies (for example _sqlite3 -> libsqlite3) are not edges of
  // the interpreter executable. Reuse exact Mach-O attestation for the native
  // stdlib modules instead of granting reads to their package directories.
  return readdirSync(extensions).filter((name) => name.endsWith('.so')).sort().map((name) => {
    const extension = join(extensions, name);
    if (!realpathSync(extension).startsWith(`${stdlib}${sep}`)) {
      throw new Error('Python native stdlib module resolves outside the declared stdlib');
    }
    return evidenceRuntimeReadAccess(extension);
  });
}

function uvCacheRoot(
  options: RunEvidenceOperationOptions,
  preparedUv: PreparedEvidenceRuntime,
): string {
  const configuredCache = process.env.UV_CACHE_DIR;
  const selected = configuredCache
    ? resolve(configuredCache)
    : sandboxedUvCacheRoot(options, preparedUv);
  if (!isAbsolute(selected) || !existsSync(selected) || !statSync(selected).isDirectory()) {
    throw new Error('uv offline cache is unavailable');
  }
  rejectRepositoryRuntime(selected, options.binding.repository, 'uv cache');
  return realpathSync(selected);
}

function sandboxedUvCacheRoot(
  options: RunEvidenceOperationOptions,
  preparedUv: PreparedEvidenceRuntime,
): string {
  const sandbox = evidenceSandboxCommand({
    cwd: options.snapshotRoot,
    writableRoots: [],
    argv: [preparedUv.command, 'cache', 'dir', '--no-config'],
    runtimeAccess: preparedUv.access,
  });
  const result = spawnSync(sandbox.command, sandbox.args, {
    cwd: options.snapshotRoot,
    encoding: 'utf8',
    timeout: 10_000,
    maxBuffer: 64 * 1024,
    env: {
      HOME: process.env.HOME ?? tmpdir(),
      PATH: '/usr/bin:/bin',
      LANG: 'C.UTF-8',
      LC_ALL: '',
      UV_PYTHON_DOWNLOADS: 'never',
    },
  });
  if (result.status !== 0) {
    throw new Error(`uv cache discovery failed: ${boundText(result.stderr || result.stdout, 4096)}`);
  }
  return result.stdout.trim();
}

export function materializePythonUvCache(source: string, target: string): void {
  materializeCandidate(source, target);
  const sourceRoot = realpathSync(source);
  const targetRoot = realpathSync(target);
  const pending = [targetRoot];
  while (pending.length > 0) {
    const directory = pending.pop()!;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const copiedPath = join(directory, entry.name);
      if (entry.isDirectory()) pending.push(copiedPath);
      if (!entry.isSymbolicLink()) continue;
      relocatePythonCacheLink(sourceRoot, targetRoot, copiedPath);
    }
  }
}

function relocatePythonCacheLink(sourceRoot: string, targetRoot: string, copiedPath: string): void {
  const sourcePath = join(sourceRoot, relative(targetRoot, copiedPath));
  let resolved: string;
  try {
    resolved = realpathSync(resolve(dirname(sourcePath), readlinkSync(copiedPath)));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (!['ENOENT', 'ENOTDIR', 'ELOOP', 'EACCES', 'EPERM'].includes(code ?? '')) throw error;
    // Unused unavailable cache entries must not block a locked offline operation.
    // If selected, uv must report the missing input rather than follow it.
    rmSync(copiedPath);
    return;
  }
  const destination = relative(sourceRoot, resolved);
  rmSync(copiedPath);
  if (destination === '..' || destination.startsWith(`..${sep}`) || isAbsolute(destination)) return;
  // Resolve against the source boundary, but only grant access to copied bytes.
  symlinkSync(relative(dirname(copiedPath), join(targetRoot, destination)) || '.', copiedPath);
}

function ambientUvCacheReadAccess(cacheRoot: string): EvidenceRuntimeReadAccess {
  return {
    roots: [cacheRoot],
    literals: [],
    mapExecutableRoots: [],
    mapExecutableLiterals: [],
    images: [],
    links: [],
    missingWeakLinks: [],
    identityDigest: sha256(stableJson({ kind: 'uv-offline-cache-read-boundary', cacheRoot })),
  };
}

function runPythonEnvironmentSync(input: {
  options: RunEvidenceOperationOptions;
  projectRoot: string;
  environmentRoot: string;
  homeRoot: string;
  tempRoot: string;
  cacheRoot: string;
  sourceCommand: string;
  preparedUv: PreparedEvidenceRuntime;
  preparationAccess: EvidenceRuntimeReadAccess;
}): void {
  runPythonUvStep(input, 'locked project check', [
    'lock',
    '--project', input.projectRoot,
    '--check',
    '--offline',
    '--python', input.sourceCommand,
    '--no-managed-python',
    '--no-python-downloads',
    '--no-config',
    '--color', 'never',
  ]);
  runPythonUvStep(input, 'frozen offline environment preparation', [
    'sync',
    '--project', input.projectRoot,
    '--frozen',
    '--offline',
    '--no-install-project',
    '--no-editable',
    '--link-mode', 'copy',
    '--python', input.sourceCommand,
    '--no-managed-python',
    '--no-python-downloads',
    '--no-config',
    '--no-progress',
    '--color', 'never',
  ]);
}

function runPythonUvStep(
  input: {
    options: RunEvidenceOperationOptions;
    projectRoot: string;
    environmentRoot: string;
    homeRoot: string;
    tempRoot: string;
    cacheRoot: string;
    sourceCommand: string;
    preparedUv: PreparedEvidenceRuntime;
    preparationAccess: EvidenceRuntimeReadAccess;
  },
  label: string,
  args: string[],
): void {
  const sandbox = evidenceSandboxCommand({
    cwd: input.options.snapshotRoot,
    writableRoots: [dirname(input.environmentRoot)],
    argv: [input.preparedUv.command, ...args],
    runtimeAccess: input.preparationAccess,
  });
  const result = spawnSync(sandbox.command, sandbox.args, {
    cwd: input.projectRoot,
    encoding: 'utf8',
    timeout: input.options.operation.timeoutMs,
    maxBuffer: input.options.operation.maxOutputBytes,
    env: {
      PATH: `${dirname(input.sourceCommand)}:/usr/bin:/bin`,
      HOME: input.homeRoot,
      TMPDIR: input.tempRoot,
      TMP: input.tempRoot,
      TEMP: input.tempRoot,
      LANG: process.env.LANG ?? 'C.UTF-8',
      LC_ALL: process.env.LC_ALL ?? '',
      UV_CACHE_DIR: input.cacheRoot,
      UV_PROJECT_ENVIRONMENT: input.environmentRoot,
      UV_OFFLINE: '1',
      UV_PYTHON_DOWNLOADS: 'never',
      UV_NO_MANAGED_PYTHON: '1',
      CI: '1',
    },
  });
  if (result.status !== 0) {
    const reason = result.error?.message ?? result.signal ?? `exit ${String(result.status)}`;
    throw new Error(`uv ${label} failed (${reason}): ${boundText(
      [result.stdout, result.stderr].filter(Boolean).join('\n'),
      4096,
    )}`);
  }
}

export function validateMaterializedPythonEnvironment(
  environmentRoot: string,
  sourceCommand: string,
  repository: string,
  candidateRoot = environmentRoot,
): string {
  const environmentPython = join(environmentRoot, 'bin', 'python3.14');
  if (!existsSync(environmentPython) || executableContentDigest(environmentPython) !== executableContentDigest(sourceCommand)) {
    throw new Error('materialized Python environment does not use the declared interpreter');
  }
  let coverageStartupHook: string | undefined;
  visitDirectory(environmentRoot, 'materialized Python environment', (absolute, relativePath, entry) => {
    if (entry.isSymbolicLink()) {
      throw new Error(`materialized Python environment contains a symlink escape: ${relativePath}`);
    }
    const lower = relativePath.toLowerCase();
    if (validatePythonSiteCustomization(absolute, relativePath, entry)) coverageStartupHook = absolute;
    if (!entry.isFile()) return;
    if (lower.endsWith('direct_url.json')) {
      validatePythonDirectUrl(absolute, [environmentRoot, candidateRoot]);
    }
    const stat = statSync(absolute);
    if (stat.size <= 1024 * 1024 && readFileSync(absolute).includes(Buffer.from(repository))) {
      throw new Error(`materialized Python environment refers to the source checkout: ${relativePath}`);
    }
  });
  // Inspect ownership only after the entire tree has passed the symlink and
  // file-type checks. The existing lock/artifact identity checks still run
  // before bootstrap or project code can execute.
  if (coverageStartupHook) validateCoverageStartupOwnership(coverageStartupHook);
  return environmentPython;
}

function validatePythonSiteCustomization(absolute: string, relativePath: string, entry: Dirent): boolean {
  const lower = relativePath.toLowerCase();
  if (!lower.endsWith('.pth') && !lower.endsWith('.egg-link') &&
    !/(^|\/)(sitecustomize|usercustomize)\.py$/.test(lower)) return false;
  if (entry.isFile() && relativePath === 'lib/python3.14/site-packages/a1_coverage.pth' &&
    sha256(readFileSync(absolute)) === COVERAGE_STARTUP_PTH_SHA256) return true;
  throw new Error(`materialized Python environment contains forbidden site customization: ${relativePath}`);
}

function validateCoverageStartupOwnership(pth: string): void {
  const sitePackages = dirname(pth);
  const distributions = readdirSync(sitePackages, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^coverage-[^/]+\.dist-info$/.test(entry.name));
  if (distributions.length !== 1) {
    throw new Error('coverage startup hook must belong to exactly one installed coverage distribution');
  }
  const distInfo = join(sitePackages, distributions[0]!.name);
  const metadata = readFileSync(join(distInfo, 'METADATA'), 'utf8');
  const version = pythonMetadataField(metadata, 'Version');
  if (pythonMetadataField(metadata, 'Name') !== 'coverage' ||
    distributions[0]!.name !== `coverage-${version}.dist-info`) {
    throw new Error('coverage startup hook distribution metadata does not match its owner');
  }
  const content = readFileSync(pth);
  const recordHash = createHash('sha256').update(content).digest('base64url');
  const records = readFileSync(join(distInfo, 'RECORD'), 'utf8').split(/\r?\n/)
    .filter((row) => row.startsWith('a1_coverage.pth,'));
  if (records.length !== 1 || records[0] !== `a1_coverage.pth,sha256=${recordHash},${content.length}`) {
    throw new Error('coverage startup hook does not match its distribution RECORD');
  }
}

function validatePythonDirectUrl(file: string, allowedRoots: string[]): void {
  const value = asObject(JSON.parse(readFileSync(file, 'utf8')), 'Python direct_url.json');
  const dirInfo = value.dir_info === undefined ? undefined : asObject(value.dir_info, 'Python direct_url dir_info');
  if (dirInfo?.editable === true) throw new Error('materialized Python environment contains an editable install');
  if (typeof value.url !== 'string' || !value.url.startsWith('file://')) return;
  const path = decodeURIComponent(value.url.slice('file://'.length));
  const roots = allowedRoots.map((root) => realpathSync(root));
  const selected = isAbsolute(path) && existsSync(path) ? realpathSync(path) : path;
  if (isAbsolute(selected) && !roots.some((root) => selected === root || selected.startsWith(`${root}${sep}`))) {
    throw new Error('materialized Python environment contains an external local install');
  }
}

function dependencyEnvironmentDigest(environmentRoot: string): string {
  return directoryContentDigest(environmentRoot, 'materialized Python environment');
}

function pythonDependencyIdentityDigest(
  environmentRoot: string,
  candidateRoot: string,
): string {
  const sitePackages = join(environmentRoot, 'lib', 'python3.14', 'site-packages');
  if (!existsSync(sitePackages)) throw new Error('materialized Python environment has no Python 3.14 site-packages');
  return stablePythonSitePackagesDigest(sitePackages, [environmentRoot, candidateRoot]);
}

function pythonOfflineArtifactDigest(
  environmentRoot: string,
  lockFile: string,
  candidateRoot: string,
): string {
  const sitePackages = join(environmentRoot, 'lib', 'python3.14', 'site-packages');
  const lockText = readFileSync(lockFile, 'utf8');
  const artifacts = readdirSync(sitePackages, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.endsWith('.dist-info'))
    .map((entry) => usedPythonArtifact(
      join(sitePackages, entry.name),
      lockText,
      candidateRoot,
      environmentRoot,
    ))
    .sort((left, right) => `${left.name}\0${left.version}`.localeCompare(`${right.name}\0${right.version}`));
  return sha256(stableJson(artifacts));
}

function usedPythonArtifact(
  distInfo: string,
  lockText: string,
  candidateRoot: string,
  environmentRoot: string,
): {
  name: string;
  version: string;
  selectedArtifact: SelectedUvLockArtifact;
  wheelDigest: string;
  recordDigest: string;
} {
  const metadata = readFileSync(join(distInfo, 'METADATA'), 'utf8');
  const name = pythonMetadataField(metadata, 'Name');
  const version = pythonMetadataField(metadata, 'Version');
  const lockPackage = matchingUvLockPackage(lockText, name, version);
  const wheelMetadata = readFileSync(join(distInfo, 'WHEEL'), 'utf8');
  const directUrl = join(distInfo, 'direct_url.json');
  return {
    name: normalizePythonPackageName(name),
    version,
    selectedArtifact: existsSync(directUrl)
      ? pythonDirectSourceArtifact(directUrl, candidateRoot, environmentRoot)
      : selectedUvLockArtifact(lockPackage, wheelMetadata),
    wheelDigest: sha256(wheelMetadata),
    recordDigest: stablePythonRecordDigest(join(distInfo, 'RECORD')),
  };
}

export type SelectedUvLockArtifact = {
  kind: 'wheel' | 'sdist' | 'direct-source';
  filename: string;
  hash: string;
};

export function selectedUvLockArtifact(
  lockPackage: string,
  wheelMetadata: string,
): SelectedUvLockArtifact {
  const tags = [...wheelMetadata.matchAll(/^Tag:\s*(\S+)\s*$/gmi)].map((match) => match[1]!.toLowerCase());
  if (tags.length === 0) throw new Error('installed Python artifact WHEEL metadata has no compatibility tag');
  const wheels = uvLockArtifactList(lockPackage, 'wheels');
  const compatible = wheels.filter((artifact) =>
    wheelFilenameTags(artifact.filename).some((tag) => tags.includes(tag)));
  if (compatible.length === 1) return { kind: 'wheel', ...compatible[0]! };
  if (compatible.length > 1) {
    throw new Error('installed Python artifact maps to multiple compatible uv.lock wheels');
  }
  if (wheels.length > 0) {
    throw new Error('installed Python artifact does not map to a compatible uv.lock wheel');
  }
  const sdists = uvLockArtifactList(lockPackage, 'sdist');
  if (sdists.length !== 1) {
    throw new Error('installed Python artifact does not map uniquely to a uv.lock source distribution');
  }
  return { kind: 'sdist', ...sdists[0]! };
}

function wheelFilenameTags(filename: string): string[] {
  const lower = filename.toLowerCase();
  if (!lower.endsWith('.whl')) throw new Error('uv.lock wheel artifact filename must end with .whl');
  const segments = lower.slice(0, -4).split('-');
  if (segments.length < 5) throw new Error('uv.lock wheel artifact filename has no compatibility tags');
  const [pythonTags, abiTags, platformTags] = segments.slice(-3).map((value) => value!.split('.'));
  const tags: string[] = [];
  for (const pythonTag of pythonTags!) {
    for (const abiTag of abiTags!) {
      for (const platformTag of platformTags!) tags.push(`${pythonTag}-${abiTag}-${platformTag}`);
    }
  }
  return tags;
}

function uvLockArtifactList(
  lockPackage: string,
  field: 'wheels' | 'sdist',
): Array<{ filename: string; hash: string }> {
  const value = field === 'wheels'
    ? lockPackage.match(/^wheels\s*=\s*\[([\s\S]*?)^\]\s*$/m)?.[1]
    : lockPackage.match(/^sdist\s*=\s*(\{[^\n]+\})\s*$/m)?.[1];
  if (!value) return [];
  return [...value.matchAll(/\{([^{}]+)\}/g)].map((match) => {
    const item = match[1]!;
    const location = item.match(/(?:url|path)\s*=\s*"([^"]+)"/)?.[1];
    const hash = item.match(/hash\s*=\s*"(sha256:[a-f0-9]{64})"/)?.[1];
    if (!location || !hash) throw new Error(`uv.lock ${field} artifact must declare a location and sha256 hash`);
    const cleanLocation = location.split(/[?#]/, 1)[0]!;
    const filename = decodeURIComponent(cleanLocation.slice(cleanLocation.lastIndexOf('/') + 1));
    if (!filename) throw new Error(`uv.lock ${field} artifact has no filename`);
    return { filename, hash };
  });
}

function pythonMetadataField(metadata: string, field: string): string {
  const match = metadata.match(new RegExp(`^${field}:\\s*(.+)$`, 'mi'));
  if (!match?.[1]) throw new Error(`installed Python artifact has no ${field}`);
  return match[1].trim();
}

function normalizePythonPackageName(value: string): string {
  return value.toLowerCase().replace(/[-_.]+/g, '-');
}

function matchingUvLockPackage(lockText: string, name: string, version: string): string {
  const matches = lockText
    .split(/(?=^\[\[package\]\]\s*$)/m)
    .filter((block) => block.startsWith('[[package]]'))
    .filter((block) => {
      const blockName = block.match(/^name\s*=\s*"([^"]+)"\s*$/m)?.[1];
      const blockVersion = block.match(/^version\s*=\s*"([^"]+)"\s*$/m)?.[1];
      return blockName && normalizePythonPackageName(blockName) === normalizePythonPackageName(name) && blockVersion === version;
    });
  if (matches.length !== 1) {
    throw new Error(`installed Python artifact does not map uniquely to uv.lock: ${name}==${version}`);
  }
  return matches[0]!.trim();
}

function pythonDirectSourceArtifact(
  directUrlFile: string,
  candidateRoot: string,
  environmentRoot: string,
): SelectedUvLockArtifact {
  const value = asObject(JSON.parse(readFileSync(directUrlFile, 'utf8')), 'Python direct_url.json');
  if (typeof value.url !== 'string' || !value.url.startsWith('file://')) {
    return {
      kind: 'direct-source',
      filename: 'direct_url.json',
      hash: `sha256:${sha256(stableJson(value))}`,
    };
  }
  const source = decodeURIComponent(value.url.slice('file://'.length));
  const candidate = realpathSync(candidateRoot);
  const selected = realpathSync(source);
  if (selected !== candidate && !selected.startsWith(`${candidate}${sep}`)) {
    throw new Error('installed Python artifact source is outside the candidate');
  }
  const digest = statSync(selected).isDirectory()
    ? directoryContentDigest(selected, 'candidate Python artifact source')
    : sha256(readFileSync(selected));
  const identity = sha256(stableJson({
    path: relative(candidate, selected),
    digest,
    directUrl: normalizedTextDigest(readFileSync(directUrlFile), [candidateRoot, environmentRoot]),
  }));
  return {
    kind: 'direct-source',
    filename: relative(candidate, selected) || '.',
    hash: `sha256:${identity}`,
  };
}

function stablePythonSitePackagesDigest(sitePackages: string, replaceRoots: string[]): string {
  const entries: Array<{ path: string; kind: string; mode?: number; digest?: string }> = [];
  visitDirectory(sitePackages, 'materialized Python site-packages', (absolute, relativePath, entry) => {
    const item = stablePythonSitePackageEntry(absolute, relativePath, entry, replaceRoots);
    if (item) entries.push(item);
  });
  return sha256(stableJson(entries.sort((left, right) => left.path.localeCompare(right.path))));
}

function stablePythonSitePackageEntry(
  absolute: string,
  relativePath: string,
  entry: Dirent,
  replaceRoots: string[],
): { path: string; kind: string; mode?: number; digest?: string } | undefined {
  if (relativePath.endsWith('.pyc') || relativePath.includes('/__pycache__/')) return undefined;
  if (relativePath.endsWith('/uv_cache.json')) return undefined;
  if (entry.isDirectory()) return { path: relativePath, kind: 'directory' };
  if (entry.isSymbolicLink()) {
    return { path: relativePath, kind: 'symlink', digest: sha256(readlinkSync(absolute)) };
  }
  if (!entry.isFile()) return undefined;
  const digest = relativePath.endsWith('/RECORD')
    ? stablePythonRecordDigest(absolute)
    : relativePath.endsWith('/direct_url.json')
      ? normalizedTextDigest(readFileSync(absolute), replaceRoots)
      : sha256(readFileSync(absolute));
  return { path: relativePath, kind: 'file', mode: statSync(absolute).mode & 0o777, digest };
}

function stablePythonRecordDigest(file: string): string {
  const rows = readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((row) => !row.includes('__pycache__/') && !row.endsWith('.pyc'))
    .map((row) => /\/(direct_url|uv_cache)\.json,/.test(row) ? `${row.split(',')[0]},<normalized>` : row)
    .sort();
  return sha256(rows.join('\n'));
}

function normalizedTextDigest(value: Buffer, roots: string[]): string {
  let text = value.toString('utf8');
  for (const root of roots) {
    text = text.replaceAll(root, '<runtime-root>');
    try {
      text = text.replaceAll(realpathSync(root), '<runtime-root>');
    } catch {
      // The lexical root remains sufficient when it no longer exists.
    }
  }
  return sha256(text);
}

function pythonEnvironmentReadAccess(
  environmentRoot: string,
  environmentDigest: string,
): EvidenceRuntimeReadAccess {
  const root = realpathSync(environmentRoot);
  return {
    roots: [root],
    literals: [],
    mapExecutableRoots: [root],
    mapExecutableLiterals: [],
    images: [],
    links: [],
    missingWeakLinks: [],
    identityDigest: environmentDigest,
  };
}

function runPythonBootstrapPreflight(input: {
  options: RunEvidenceOperationOptions;
  environmentPython: string;
  environmentRoot: string;
  projectRoot: string;
  runtimeAccess: EvidenceRuntimeReadAccess;
}): void {
  const { options, environmentPython, environmentRoot, projectRoot, runtimeAccess } = input;
  const expectedPrefix = realpathSync(environmentRoot);
  const script = [
    'import encodings,json,os,site,sys',
    'expected=os.path.realpath(sys.argv[1])',
    'assert sys.version_info[:2]==(3,14)',
    'assert os.path.realpath(sys.prefix)==expected',
    'assert os.path.realpath(sys.base_prefix)!=expected',
    'assert all(not p or os.path.realpath(p)!=os.path.realpath(os.getcwd()) for p in sys.path)',
  ].join(';');
  const sandbox = evidenceSandboxCommand({
    cwd: options.snapshotRoot,
    writableRoots: [],
    argv: [environmentPython, '-I', '-c', script, expectedPrefix],
    runtimeAccess,
  });
  const result = spawnSync(sandbox.command, sandbox.args, {
    cwd: projectRoot,
    encoding: 'utf8',
    timeout: 10_000,
    maxBuffer: 64 * 1024,
    env: {
      PATH: `${dirname(environmentPython)}:/usr/bin:/bin`,
      HOME: dirname(environmentRoot),
      LANG: 'C.UTF-8',
      LC_ALL: '',
      PYTHONNOUSERSITE: '1',
      PYTHONDONTWRITEBYTECODE: '1',
      PYTHONPATH: '',
      VIRTUAL_ENV: environmentRoot,
    },
  });
  if (result.status !== 0) {
    throw new Error(`Python bootstrap and stdlib preflight failed: ${boundText(
      [result.stdout, result.stderr, result.error?.message].filter(Boolean).join('\n'),
      4096,
    )}`);
  }
}

function directoryContentDigest(root: string, label: string): string {
  const entries: Array<{ path: string; kind: string; mode?: number; digest?: string }> = [];
  visitDirectory(root, label, (absolute, relativePath, entry) => {
    if (entry.isDirectory()) entries.push({ path: relativePath, kind: 'directory' });
    else if (entry.isSymbolicLink()) {
      entries.push({ path: relativePath, kind: 'symlink', digest: sha256(readlinkSync(absolute)) });
    } else if (entry.isFile()) {
      entries.push({
        path: relativePath,
        kind: 'file',
        mode: statSync(absolute).mode & 0o777,
        digest: sha256(readFileSync(absolute)),
      });
    }
  });
  return sha256(stableJson(entries.sort((left, right) => left.path.localeCompare(right.path))));
}

function visitDirectory(
  root: string,
  label: string,
  visitor: (absolute: string, relativePath: string, entry: Dirent) => void,
): void {
  const pending: Array<{ absolute: string; relative: string }> = [{ absolute: realpathSync(root), relative: '' }];
  let visited = 0;
  while (pending.length > 0) {
    const current = pending.pop()!;
    for (const entry of readdirSync(current.absolute, { withFileTypes: true })) {
      const relativePath = current.relative ? `${current.relative}/${entry.name}` : entry.name;
      const absolute = join(current.absolute, entry.name);
      visited += 1;
      if (visited > 200_000) throw new Error(`${label} exceeds 200000 entries`);
      visitor(absolute, relativePath, entry);
      queueDirectoryEntry({ entry, absolute, relativePath, label, pending });
    }
  }
}

function queueDirectoryEntry(input: {
  entry: Dirent;
  absolute: string;
  relativePath: string;
  label: string;
  pending: Array<{ absolute: string; relative: string }>;
}): void {
  const { entry, absolute, relativePath, label, pending } = input;
  if (entry.isDirectory()) pending.push({ absolute, relative: relativePath });
  else if (!entry.isFile() && !entry.isSymbolicLink()) {
    throw new Error(`${label} contains unsupported entry: ${relativePath}`);
  }
}

function operationExecutionIdentity(
  options: RunEvidenceOperationOptions,
  runtime: Pick<PreparedOperationRuntime,
    'command' | 'runtimeAccess' | 'systemToolAccess' | 'preparedRuntime' | 'preparedChildRuntimes' | 'pythonRuntimeDigest'>,
): string {
  const { binding, provider, operation } = options;
  return sha256(stableJson({
    repository: binding.repository,
    baseDigest: binding.baseDigest,
    candidateDigest: binding.candidateDigest,
    scopeDigest: binding.scopeDigest,
    manifestDigest: binding.behaviorContractDigest,
    providerId: provider.id,
    operationId: operation.id,
    executionContext: provider.executionContext,
    executableDigest: executableContentDigest(runtime.command),
    sourceRuntimeDigest: runtime.runtimeAccess.identityDigest,
    executionRuntimeDigest: runtime.preparedRuntime.identityDigest,
    childRuntimeDigests: runtime.preparedChildRuntimes.map((entry) => ({
      tool: entry.tool,
      source: entry.sourceAccess.identityDigest,
      execution: entry.prepared.identityDigest,
    })),
    pythonRuntimeDigest: runtime.pythonRuntimeDigest,
    dependencyProjectionDigest: options.dependencyDigest,
    systemToolDigest: runtime.systemToolAccess.identityDigest,
    runnerPolicy: EVIDENCE_RUNNER_POLICY,
    platform: process.platform,
    architecture: process.arch,
  }));
}

function operationCommandDigest(options: Pick<RunEvidenceOperationOptions, 'operation' | 'executionOffset'>): string {
  const { operation } = options;
  return sha256(stableJson({
    argv: operation.argv,
    cwd: options.executionOffset || '.',
    network: operation.network,
    target: operation.target,
    expectedExit: operation.expectedExit,
    expectedExitCode: operation.expectedExitCode,
    evidenceLevel: operation.evidenceLevel,
    pythonRuntime: operation.pythonRuntime,
    seed: operation.seed,
    iterations: operation.iterations,
  }));
}

function operationRunner(
  options: RunEvidenceOperationOptions,
  runtime: PreparedOperationRuntime,
): { sandbox: ReturnType<typeof evidenceSandboxCommand>; env: Record<string, string> } {
  const runnerTmpPath = join(options.runnerRoot, 'tmp');
  const runnerHomePath = join(options.runnerRoot, 'home');
  mkdirSync(runnerTmpPath, { recursive: true });
  mkdirSync(runnerHomePath, { recursive: true });
  const runnerTmp = realpathSync(runnerTmpPath);
  const runnerHome = realpathSync(runnerHomePath);
  const operation = options.operation;
  const env = {
    ...runtime.operationEnvironment,
    PATH: operationPath(runtime),
    HOME: runnerHome,
    TMPDIR: runnerTmp,
    TMP: runnerTmp,
    TEMP: runnerTmp,
    LANG: process.env.LANG ?? 'C.UTF-8',
    LC_ALL: process.env.LC_ALL ?? '',
    GOLDBAND_EVIDENCE_SEED: operation.seed ?? '',
    GOLDBAND_EVIDENCE_ITERATIONS: operation.iterations ? String(operation.iterations) : '',
    GOLDBAND_EVIDENCE_NETWORK: operation.network,
    [EVIDENCE_SANDBOX_ACTIVE_ENV]: '1',
    [EVIDENCE_TEMP_ROOT_ENV]: runnerTmp,
    CI: '1',
    OPENSSL_CONF: runtime.preparedRuntime.environment.OPENSSL_CONF ?? '/dev/null',
  };
  const sandbox = evidenceSandboxCommand({
    cwd: options.snapshotRoot,
    writableRoots: [runnerTmp, runnerHome],
    argv: [runtime.preparedRuntime.command, ...runtime.replayCommand.slice(1)],
    runtimeAccess: runtime.sandboxRuntimeAccess,
    systemToolRoots: runtime.systemToolAccess.roots,
    systemToolLiterals: runtime.systemToolAccess.literals,
    systemToolMapExecutableLiterals: runtime.systemToolAccess.mapExecutableLiterals,
  });
  return { sandbox, env };
}

function operationPath(runtime: PreparedOperationRuntime): string {
  return uniqueSorted([
    ...runtime.systemToolAccess.executableDirectories,
    dirname(runtime.preparedRuntime.command),
    ...runtime.preparedChildRuntimes.map((entry) => dirname(entry.prepared.command)),
  ]).join(':') + ':/usr/bin:/bin';
}

async function executePreparedOperation(
  options: RunEvidenceOperationOptions,
  runtime: PreparedOperationRuntime,
  startedAt: string,
): Promise<EvidenceExecutionResult> {
  const ignored = dependencyRelativePaths(options.changedFiles);
  const snapshotDigestBefore = snapshotContentDigest(options.snapshotRoot, ignored);
  const runner = operationRunner(options, runtime);
  const capture = await captureEvidenceCommand(options, runner);
  const finishedAt = new Date().toISOString();
  const snapshotDigestAfter = snapshotContentDigest(options.snapshotRoot, ignored);
  const snapshotUnchanged = snapshotDigestBefore === snapshotDigestAfter;
  const runtimeUnchanged = operationRuntimeUnchanged(runtime);
  const sandboxDenied = isEvidenceSandboxRuntimeFailure(
    runner.sandbox.command,
    {
      reason: capture.result.reason,
      exitCode: capture.result.exitCode,
      stderr: capture.stderrDiagnosticHead,
      compilerOutputDenied: capture.compilerOutputDenied,
    },
    runner.sandbox.brokered,
  );
  const outputSummary = summarizeEvidenceExecution(
    options.operation,
    capture.result,
    { snapshotUnchanged, runtimeUnchanged, sandboxDenied },
  );
  return {
    startedAt,
    finishedAt,
    result: capture.result,
    snapshotDigestBefore,
    snapshotDigestAfter,
    snapshotUnchanged,
    runtimeUnchanged,
    sandboxDenied,
    outputDigest: capture.outputDigest,
    outputSummary,
  };
}

async function captureEvidenceCommand(
  options: RunEvidenceOperationOptions,
  runner: ReturnType<typeof operationRunner>,
): Promise<{
  result: EvidenceCommandResult;
  outputDigest: string;
  stderrDiagnosticHead: string;
  compilerOutputDenied: boolean;
}> {
  const stdoutHash = createHash('sha256');
  const stderrHash = createHash('sha256');
  let stderrDiagnosticHead = '';
  const stdoutDiagnostics = createCompilerOutputDiagnosticCapture();
  const stderrDiagnostics = createCompilerOutputDiagnosticCapture();
  const result = await superviseCommand(runner.sandbox.command, runner.sandbox.args, {
    cwd: options.executionCwd,
    env: runner.env,
    timeoutMs: options.operation.timeoutMs,
    killGraceMs: 1000,
    killConfirmMs: 2000,
    captureOutput: {
      stdoutMaxBytes: options.operation.maxOutputBytes,
      stderrMaxBytes: options.operation.maxOutputBytes,
    },
    label: `review evidence ${options.provider.id}:${options.operation.id}`,
    stdout: {
      write(chunk: string) {
        stdoutHash.update(chunk);
        stdoutDiagnostics.write(chunk);
      },
    },
    stderr: {
      write(chunk: string) {
        stderrHash.update(chunk);
        stderrDiagnostics.write(chunk);
        const remaining = MAX_EVIDENCE_RUNTIME_DIAGNOSTIC_CHARS - stderrDiagnosticHead.length;
        if (remaining > 0) stderrDiagnosticHead += chunk.slice(0, remaining);
      },
    },
  });
  return {
    result,
    outputDigest: sha256(`${stdoutHash.digest('hex')}:${stderrHash.digest('hex')}`),
    stderrDiagnosticHead,
    compilerOutputDenied: stdoutDiagnostics.denied || stderrDiagnostics.denied,
  };
}

function operationRuntimeUnchanged(runtime: PreparedOperationRuntime): boolean {
  try {
    return runtime.sourceRuntimeUnchanged() &&
      runtime.systemToolAccess.verifyUnchanged() &&
      runtime.preparedRuntime.verifyUnchanged() &&
      runtime.preparedChildRuntimes.every((entry) =>
        evidenceRuntimeReadAccess(entry.command).identityDigest === entry.sourceAccess.identityDigest &&
        entry.prepared.verifyUnchanged());
  } catch {
    return false;
  }
}

function evidenceStatus(
  operation: EvidenceOperation,
  execution: EvidenceExecutionResult,
): EvidenceRecordStatus {
  if (execution.result.reason !== 'exit' ||
      !execution.snapshotUnchanged || !execution.runtimeUnchanged || execution.sandboxDenied) {
    return 'runtime-incomplete';
  }
  const matched = operation.expectedExit === 'zero'
    ? execution.result.exitCode === 0
    : execution.result.exitCode === operation.expectedExitCode;
  return matched ? 'verified-pass' : 'verified-failure';
}

function summarizeEvidenceExecution(
  operation: EvidenceOperation,
  result: EvidenceCommandResult,
  integrity: Pick<EvidenceExecutionResult, 'snapshotUnchanged' | 'runtimeUnchanged' | 'sandboxDenied'>,
): string {
  const output = boundText(
    [result.stdout ?? '', result.stderr ?? ''].filter(Boolean).join('\n'),
    operation.maxOutputBytes,
  );
  let error = '';
  if (result.reason !== 'exit') error = `runner incomplete: ${result.reason}`;
  else if (!integrity.snapshotUnchanged) {
    error = 'runner incomplete: evidence operation mutated its isolated candidate snapshot';
  } else if (!integrity.runtimeUnchanged) {
    error = 'runner incomplete: executable runtime libraries changed during evidence execution';
  } else if (integrity.sandboxDenied) {
    error = 'runner incomplete: operation initialization or compiler output access failed; keep the snapshot read-only and direct build caches to TMPDIR';
  }
  return boundText([output, error].filter(Boolean).join('\n'), operation.maxOutputBytes);
}

function evidenceRecord(
  options: RunEvidenceOperationOptions,
  runtime: PreparedOperationRuntime,
  execution: EvidenceExecutionResult,
): ReviewEvidenceRecord {
  const { provider, operation, binding } = options;
  const status = evidenceStatus(operation, execution);
  return {
    id: `${provider.id}:${operation.id}`,
    providerId: provider.id,
    operationId: operation.id,
    cellIds: [...provider.cellIds],
    owner: provider.owner,
    kind: provider.kind,
    status,
    evidenceLevel: operation.evidenceLevel,
    environment: provider.executionContext.runner === 'host-seatbelt'
      ? `${provider.executionContext.lane}/host-seatbelt-${process.platform}-snapshot`
      : `isolated-${process.platform}-snapshot`,
    commandDigest: runtime.commandDigest,
    executionIdentityDigest: runtime.executionIdentityDigest,
    snapshotDigestBefore: execution.snapshotDigestBefore,
    snapshotDigestAfter: execution.snapshotDigestAfter,
    replayCommand: runtime.replayCommand,
    seed: operation.seed,
    iterations: operation.iterations,
    startedAt: execution.startedAt,
    finishedAt: execution.finishedAt,
    exitStatus: execution.result.reason === 'exit' ? execution.result.exitCode : undefined,
    outputDigest: execution.outputDigest,
    outputSummary: execution.outputSummary,
    candidateDigest: binding.candidateDigest,
    baseDigest: binding.baseDigest,
    scopeDigest: binding.scopeDigest,
    fresh: execution.snapshotUnchanged && execution.runtimeUnchanged && status !== 'runtime-incomplete',
  };
}

export type EvidenceRuntimeReadAccess = {
  roots: string[];
  literals: string[];
  mapExecutableRoots: string[];
  mapExecutableLiterals: string[];
  images: Array<{ sourcePath: string; contentDigest: string }>;
  links: Array<{
    loaderPath: string;
    installName: string;
    resolvedPath: string;
    targetIsSystem: boolean;
  }>;
  missingWeakLinks: Array<{ loaderPath: string; installName: string }>;
  identityDigest: string;
};

function mergeEvidenceRuntimeReadAccess(
  accesses: EvidenceRuntimeReadAccess[],
): EvidenceRuntimeReadAccess {
  return {
    roots: uniqueSorted(accesses.flatMap((access) => access.roots)),
    literals: uniqueSorted(accesses.flatMap((access) => access.literals)),
    mapExecutableRoots: uniqueSorted(accesses.flatMap((access) => access.mapExecutableRoots)),
    mapExecutableLiterals: uniqueSorted(accesses.flatMap((access) => access.mapExecutableLiterals)),
    images: [],
    links: [],
    missingWeakLinks: [],
    identityDigest: sha256(stableJson(accesses.map((access) => access.identityDigest))),
  };
}

export function evidenceRuntimeReadAccess(executable: string): EvidenceRuntimeReadAccess {
  const roots = [
    '/System/Library',
    '/usr/lib',
    '/private/var/db/dyld',
  ].filter(existsSync);
  const executableFile = realpathSync(executable);
  const literals = uniqueSorted([
    executable,
    executableFile,
    ...pathSymlinkLiterals(executable),
  ]);
  const mapExecutableLiterals = [executableFile];
  const images = [{
    sourcePath: executableFile,
    contentDigest: runtimeImageContentDigest(executableFile),
  }];
  const links: EvidenceRuntimeReadAccess['links'] = [];
  const missingWeakLinks: EvidenceRuntimeReadAccess['missingWeakLinks'] = [];
  const attestations = [{
    installPath: executable,
    resolvedPath: executableFile,
    contentDigest: images[0]!.contentDigest,
  }];
  if (process.platform === 'darwin' && existsSync('/usr/bin/otool')) {
    const systemRoots = roots.map((root) => realpathSync(root));
    const visited = new Set<string>();
    const loadedRpathImages = new Map<string, string>();
    const visitImage = (image: string, inheritedRpaths: string[]): void => {
      if (visited.has(image)) return;
      visited.add(image);
      const { rpaths, dylibs } = machOLoadCommands(image, executableFile, inheritedRpaths);
      const dependencies: Array<{ image: string; inheritedRpaths: string[] }> = [];
      for (const edge of dylibs) {
        const { installName } = edge;
        if (isAbsolute(installName) && systemRoots.some((root) =>
          installName === root || installName.startsWith(`${root}${sep}`))) continue;
        const previouslyLoaded = installName.startsWith('@rpath/')
          ? loadedRpathImages.get(installName)
          : undefined;
        const library = previouslyLoaded ??
          resolveMachOInstallName(installName, image, executableFile, rpaths);
        if (!library) {
          if (edge.weak) {
            missingWeakLinks.push({ loaderPath: image, installName });
            continue;
          }
          throw new Error(
            `review evidence cannot resolve executable library ${installName} from ${image}`,
          );
        }
        const libraryPath = resolve(library);
        const resolvedLibrary = realpathSync(libraryPath);
        if (installName.startsWith('@rpath/') && !previouslyLoaded) {
          loadedRpathImages.set(installName, resolvedLibrary);
        }
        const resolvedLibraryIsSystem = systemRoots.some((root) =>
          resolvedLibrary === root || resolvedLibrary.startsWith(`${root}${sep}`));
        links.push({
          loaderPath: image,
          installName,
          resolvedPath: resolvedLibrary,
          targetIsSystem: resolvedLibraryIsSystem,
        });
        const contentDigest = runtimeImageContentDigest(resolvedLibrary);
        attestations.push({
          installPath: libraryPath,
          resolvedPath: resolvedLibrary,
          contentDigest,
        });
        literals.push(...runtimeLibraryLiteralPaths(libraryPath, resolvedLibrary, systemRoots));
        mapExecutableLiterals.push(
          libraryPath,
          ...(resolvedLibraryIsSystem ? [] : [resolvedLibrary]),
        );
        if (resolvedLibraryIsSystem) continue;
        if (!images.some((entry) => entry.sourcePath === resolvedLibrary)) {
          images.push({
            sourcePath: resolvedLibrary,
            contentDigest,
          });
        }
        dependencies.push({ image: resolvedLibrary, inheritedRpaths: rpaths });
      }
      for (const dependency of dependencies) {
        visitImage(dependency.image, dependency.inheritedRpaths);
      }
    };
    visitImage(executableFile, []);
  }
  return {
    roots: roots.map((root) => realpathSync(root)),
    literals: uniqueSorted(literals),
    mapExecutableRoots: [],
    mapExecutableLiterals: uniqueSorted(mapExecutableLiterals),
    images: images.sort((left, right) => left.sourcePath.localeCompare(right.sourcePath)),
    links: links.sort((left, right) =>
      `${left.loaderPath}\0${left.installName}`.localeCompare(`${right.loaderPath}\0${right.installName}`)),
    missingWeakLinks: missingWeakLinks.sort((left, right) =>
      `${left.loaderPath}\0${left.installName}`.localeCompare(`${right.loaderPath}\0${right.installName}`)),
    identityDigest: sha256(stableJson({
      attestations: attestations.sort((left, right) =>
        `${left.installPath}\0${left.resolvedPath}`.localeCompare(`${right.installPath}\0${right.resolvedPath}`)),
      links,
      missingWeakLinks,
    })),
  };
}

export function runtimeLibraryLiteralPaths(
  libraryPath: string,
  resolvedLibrary: string,
  systemRoots: string[],
): string[] {
  const targetIsSystem = systemRoots.some((root) =>
    resolvedLibrary === root || resolvedLibrary.startsWith(`${root}${sep}`));
  return uniqueSorted([
    libraryPath,
    ...pathSymlinkLiterals(libraryPath),
    ...(targetIsSystem ? [] : [resolvedLibrary]),
  ]);
}

function pathSymlinkLiterals(file: string): string[] {
  const absolute = resolve(file);
  const parts = absolute.split(sep).filter(Boolean);
  const symlinks: string[] = [];
  let current: string = sep;
  for (const part of parts) {
    current = join(current, part);
    const stat = lstatSync(current, { throwIfNoEntry: false });
    if (stat?.isSymbolicLink()) {
      // Seatbelt also checks the link's actual location after resolving parent
      // directory aliases (Homebrew opt/package -> Cellar/package/version).
      symlinks.push(current, join(realpathSync(dirname(current)), basename(current)));
    }
  }
  return symlinks;
}

export function runtimeImageContentDigest(file: string): string {
  const expected = lstatSync(file);
  if (!expected.isFile() || expected.isSymbolicLink()) {
    throw new Error(`review evidence runtime image is not a regular file: ${file}`);
  }
  const fd = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = fstatSync(fd);
    if (!sameFileSnapshot(opened, expected)) {
      throw new Error(`review evidence runtime image changed while opening: ${file}`);
    }
    const hash = createHash('sha256');
    const chunk = Buffer.allocUnsafe(64 * 1024);
    while (true) {
      const bytesRead = readSync(fd, chunk, 0, chunk.length, null);
      if (bytesRead === 0) break;
      hash.update(chunk.subarray(0, bytesRead));
    }
    if (!sameFileSnapshot(fstatSync(fd), opened)) {
      throw new Error(`review evidence runtime image changed while reading: ${file}`);
    }
    return hash.digest('hex');
  } finally {
    closeSync(fd);
  }
}

function otool(image: string, mode: '-L' | '-l'): string {
  const result = spawnSync('/usr/bin/otool', [mode, image], {
    encoding: 'utf8',
    timeout: 5000,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(
      `review evidence executable must be a Mach-O binary; invoke an interpreter explicitly instead of a script launcher: ${image}`,
    );
  }
  if (/is not an object file/i.test(`${result.stdout}\n${result.stderr}`)) {
    throw new Error(
      `review evidence executable must be a Mach-O binary; invoke an interpreter explicitly instead of a script launcher: ${image}`,
    );
  }
  return result.stdout;
}

function machOLoadCommands(image: string, executable: string, inheritedRpaths: string[]) {
  const loadCommands = otool(image, '-l').split('\n');
  return {
    rpaths: uniqueInOrder([...machORpaths(image, executable, loadCommands), ...inheritedRpaths]),
    dylibs: machOLoadedDylibs(loadCommands),
  };
}

function machORpaths(image: string, executable: string, loadCommands: string[]): string[] {
  const rpaths: string[] = [];
  for (let index = 0; index < loadCommands.length; index += 1) {
    if (loadCommands[index]?.trim() !== 'cmd LC_RPATH') continue;
    for (let cursor = index + 1; cursor < Math.min(index + 8, loadCommands.length); cursor += 1) {
      const match = loadCommands[cursor]?.trim().match(/^path (.+) \(offset \d+\)$/);
      if (!match) continue;
      const expanded = expandMachOPath(match[1]!, image, executable);
      if (expanded) rpaths.push(expanded);
      break;
    }
  }
  return uniqueInOrder(rpaths);
}

function machOLoadedDylibs(loadCommands: string[]): Array<{ installName: string; weak: boolean }> {
  const installNames: Array<{ installName: string; weak: boolean }> = [];
  const dependencyCommands = new Set([
    'LC_LOAD_DYLIB',
    'LC_LOAD_WEAK_DYLIB',
    'LC_REEXPORT_DYLIB',
    'LC_LOAD_UPWARD_DYLIB',
  ]);
  for (let index = 0; index < loadCommands.length; index += 1) {
    const command = loadCommands[index]?.trim().match(/^cmd (LC_[A-Z_]+)$/)?.[1];
    if (!command || !dependencyCommands.has(command)) continue;
    for (let cursor = index + 1; cursor < Math.min(index + 8, loadCommands.length); cursor += 1) {
      const match = loadCommands[cursor]?.trim().match(/^name (.+) \(offset \d+\)$/);
      if (!match) continue;
      installNames.push({
        installName: match[1]!,
        weak: command === 'LC_LOAD_WEAK_DYLIB',
      });
      break;
    }
  }
  return installNames;
}

function resolveMachOInstallName(
  installName: string,
  loader: string,
  executable: string,
  rpaths: string[],
): string | undefined {
  if (installName.startsWith('@rpath/')) {
    const suffix = installName.slice('@rpath/'.length);
    for (const root of rpaths) {
      const candidate = resolve(root, suffix);
      if (existsSync(candidate)) return candidate;
    }
    return undefined;
  }
  const expanded = expandMachOPath(installName, loader, executable);
  return expanded && existsSync(expanded) ? expanded : undefined;
}

function expandMachOPath(
  value: string,
  loader: string,
  executable: string,
): string | undefined {
  if (isAbsolute(value)) return value;
  if (value === '@loader_path') return dirname(loader);
  if (value.startsWith('@loader_path/')) {
    return resolve(dirname(loader), value.slice('@loader_path/'.length));
  }
  if (value === '@executable_path') return dirname(executable);
  if (value.startsWith('@executable_path/')) {
    return resolve(dirname(executable), value.slice('@executable_path/'.length));
  }
  return undefined;
}

function materializeCandidate(source: string, target: string): void {
  mkdirSync(target, { recursive: true });
  const result = process.platform === 'darwin'
    ? spawnSync('cp', ['-cR', `${source}${sep}.`, target], { encoding: 'utf8' })
    : spawnSync('cp', ['-a', '--reflink=auto', `${source}${sep}.`, target], { encoding: 'utf8' });
  if (result.status === 0) return;
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  cpSync(source, target, { recursive: true, dereference: false });
}

function materializeBase(
  repo: string,
  baseRoot: string,
  changedFiles: string[],
  baseRef: string,
): void {
  resetSnapshotToRef(repo, baseRoot, baseRef);
}

function materializeExactCandidate(
  ctx: WorkflowContext,
  input: ReviewDiffInput,
  candidateRoot: string,
  baseRef: string,
  expectedRedactedUntracked: CandidateBinding['redactedUntrackedFiles'],
): void {
  if (
    input.diff.startsWith('ANALYSIS_ARTIFACT_START ')
  ) {
    materializeCandidate(ctx.cwd, candidateRoot);
    return;
  }
  resetSnapshotToRef(ctx.cwd, candidateRoot, baseRef);
  if (!input.diff.trim()) {
    return;
  }
  const applicableDiff = input.diff
    .split(/(?=^diff --git )/m)
    .filter((section) => !isSyntheticSkippedUntrackedSection(section))
    .join('');
  if (applicableDiff.trim()) {
    const applied = spawnSync(
      'git',
      ['apply', '--whitespace=nowarn', '-'],
      {
        cwd: candidateRoot,
        input: applicableDiff,
        encoding: 'utf8',
        timeout: 30_000,
        maxBuffer: 4 * 1024 * 1024,
      },
    );
    if (applied.status !== 0) {
      throw new Error(`review evidence could not materialize the exact candidate patch: ${applied.stderr}`);
    }
  }
  materializeRedactedUntrackedFiles(
    ctx.cwd,
    candidateRoot,
    input.diff,
    expectedRedactedUntracked,
  );
}

function isSyntheticSkippedUntrackedSection(section: string): boolean {
  const lines = section.trimEnd().split('\n');
  return lines.length === 6 &&
    lines[0]!.startsWith('diff --git ') &&
    lines[1] === 'new file mode 100644' &&
    lines[2] === '--- /dev/null' &&
    lines[3]!.startsWith('+++ ') &&
    lines[4] === '@@ -0,0 +1,1 @@' &&
    /^\+\[\[review\/code skipped untracked file: .+\]\]$/.test(lines[5]!);
}

function hiddenUntrackedCandidateProjection(
  repo: string,
  diff: string,
): CandidateBinding['redactedUntrackedFiles'] {
  return skippedUntrackedSections(diff).map(({ path }) => {
    const { content, mode } = readBoundedRedactedUntrackedFile(repo, path);
    return { path, digest: sha256(content), size: content.length, mode };
  }).sort((left, right) => left.path.localeCompare(right.path));
}

function materializeRedactedUntrackedFiles(
  repo: string,
  target: string,
  diff: string,
  expected: CandidateBinding['redactedUntrackedFiles'],
): void {
  const expectedByPath = new Map(expected.map((entry) => [entry.path, entry]));
  const observedPaths = skippedUntrackedSections(diff).map((entry) => entry.path).sort();
  if (stableJson(observedPaths) !== stableJson([...expectedByPath.keys()].sort())) {
    throw new Error('review evidence redacted untracked projection does not match candidate diff');
  }
  for (const { path } of skippedUntrackedSections(diff)) {
    const { content, mode } = readBoundedRedactedUntrackedFile(repo, path);
    const observed = { path, digest: sha256(content), size: content.length, mode };
    if (stableJson(observed) !== stableJson(expectedByPath.get(path))) {
      throw new Error(`review evidence redacted untracked file changed after candidate binding: ${path}`);
    }
    const destination = resolveWithin(target, path);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, content, { mode: mode === '100755' ? 0o755 : 0o644, flag: 'wx' });
  }
}

function verifyRedactedUntrackedProjection(
  repo: string,
  diff: string,
  expected: CandidateBinding['redactedUntrackedFiles'],
): void {
  const expectedByPath = new Map(expected.map((entry) => [entry.path, entry]));
  const observedPaths = skippedUntrackedSections(diff).map((entry) => entry.path).sort();
  if (stableJson(observedPaths) !== stableJson([...expectedByPath.keys()].sort())) {
    throw new Error('review evidence redacted untracked projection does not match candidate diff');
  }
  for (const { path } of skippedUntrackedSections(diff)) {
    const { content, mode } = readBoundedRedactedUntrackedFile(repo, path);
    const observed = { path, digest: sha256(content), size: content.length, mode };
    if (stableJson(observed) !== stableJson(expectedByPath.get(path))) {
      throw new Error(`review evidence redacted untracked file changed after candidate binding: ${path}`);
    }
  }
}

function verifiedReviewWorkspace(
  cwd: string,
  diff: string,
  expected: CandidateBinding['redactedUntrackedFiles'],
): ReturnType<typeof resolveReviewWorkspace> {
  const workspace = resolveReviewWorkspace(cwd);
  verifyRedactedUntrackedProjection(workspace.repositoryRoot, diff, expected);
  return workspace;
}

function readBoundedRedactedUntrackedFile(
  repo: string,
  path: string,
): { content: Buffer; mode: '100644' | '100755' } {
  const source = resolveWithin(repo, path);
  const repositoryRoot = realpathSync(repo);
  const expected = lstatSync(source, { throwIfNoEntry: false });
  if (!expected?.isFile() || expected.isSymbolicLink() || expected.size > MAX_REDACTED_UNTRACKED_BYTES) {
    throw new Error(`review evidence cannot safely read redacted untracked file: ${path}`);
  }
  const realSource = realpathSync(source);
  if (realSource !== repositoryRoot && !realSource.startsWith(`${repositoryRoot}${sep}`)) {
    throw new Error(`review evidence redacted untracked file escapes repository: ${path}`);
  }
  const fd = openSync(source, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const opened = fstatSync(fd);
    if (!sameFileSnapshot(opened, expected)) {
      throw new Error(`review evidence redacted untracked file changed while opening: ${path}`);
    }
    const chunks: Buffer[] = [];
    let total = 0;
    while (true) {
      const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, (MAX_REDACTED_UNTRACKED_BYTES + 1) - total));
      const bytesRead = readSync(fd, chunk, 0, chunk.length, null);
      if (bytesRead === 0) break;
      total += bytesRead;
      if (total > MAX_REDACTED_UNTRACKED_BYTES) {
        throw new Error(`review evidence redacted untracked file exceeds byte limit: ${path}`);
      }
      chunks.push(chunk.subarray(0, bytesRead));
    }
    if (!sameFileSnapshot(fstatSync(fd), opened)) {
      throw new Error(`review evidence redacted untracked file changed while reading: ${path}`);
    }
    return {
      content: Buffer.concat(chunks, total),
      mode: (opened.mode & 0o111) !== 0 ? '100755' : '100644',
    };
  } finally {
    closeSync(fd);
  }
}

function sameFileSnapshot(left: ReturnType<typeof fstatSync>, right: ReturnType<typeof fstatSync>): boolean {
  return left.isFile() && right.isFile() && left.dev === right.dev && left.ino === right.ino &&
    left.size === right.size && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs;
}

function skippedUntrackedSections(diff: string): Array<{ path: string; reason: string }> {
  return diff
    .split(/(?=^diff --git )/m)
    .filter(isSyntheticSkippedUntrackedSection)
    .map((section) => {
      const lines = section.trimEnd().split('\n');
      const path = decodePatchHeaderPath(lines[3]!.slice(4));
      const match = /^\+\[\[review\/code skipped untracked file: (.+)\]\]$/.exec(lines[5]!);
      if (!path || !match) throw new Error('invalid redacted untracked diff section');
      return { path, reason: match[1]! };
    });
}

function decodePatchHeaderPath(raw: string): string | undefined {
  const token = raw.startsWith('"')
    ? decodeGitQuotedPath(raw)
    : raw.split('\t', 1)[0];
  if (!token || token === '/dev/null') return undefined;
  return token.startsWith('a/') || token.startsWith('b/') ? token.slice(2) : token;
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
      while (octal.length < 3 && /[0-7]/.test(raw[index + 1] ?? '')) octal += raw[++index];
      bytes.push(Number.parseInt(octal, 8));
      continue;
    }
    bytes.push(...Buffer.from(escape));
  }
  return Buffer.from(bytes).toString('utf8');
}

function operationNeedsDependencies(operation: EvidenceOperation): boolean {
  return !operation.pythonRuntime && !['true', 'false'].includes(operation.argv[0]!);
}

function resetSnapshotToRef(
  repo: string,
  snapshotRoot: string,
  baseRef: string,
): void {
  rmSync(snapshotRoot, { recursive: true, force: true });
  mkdirSync(snapshotRoot, { recursive: true });
  const repositoryRoot = gitOutput(repo, ['rev-parse', '--show-toplevel']);
  if (!gitOutput(repositoryRoot, ['rev-parse', '--verify', baseRef], true)) return;
  const archive = spawnSync(
    'git',
    ['archive', '--format=tar', baseRef],
    {
    cwd: repositoryRoot,
    maxBuffer: 256 * 1024 * 1024,
    },
  );
  if (archive.status !== 0 || !archive.stdout) {
    throw new Error(`review evidence could not materialize base snapshot: ${String(archive.stderr)}`);
  }
  const tar = spawnSync(
    'tar',
    ['-xf', '-', '-C', snapshotRoot],
    {
    input: archive.stdout,
    maxBuffer: 16 * 1024 * 1024,
    },
  );
  if (tar.status !== 0) throw new Error(`review evidence could not extract base snapshot: ${String(tar.stderr)}`);
}

function projectDependencyDirectories(
  repo: string,
  snapshotRoot: string,
  changedFiles: string[],
): void {
  for (const relativePath of dependencyRelativePaths(changedFiles)) {
    const source = resolveWithin(repo, relativePath);
    if (!existsSync(source)) continue;
    const target = resolveWithin(snapshotRoot, relativePath);
    mkdirSync(dirname(target), { recursive: true });
    materializeCandidate(source, target);
  }
}

function dependencyRelativePaths(changedFiles: string[]): string[] {
  const candidates = new Set<string>(['node_modules']);
  for (const file of changedFiles) {
    const parts = file.split('/').filter(Boolean);
    for (let index = 1; index < parts.length; index += 1) {
      candidates.add(`${parts.slice(0, index).join('/')}/node_modules`);
    }
  }
  return uniqueSorted([...candidates]);
}

function dispositionRecord(
  cell: BehaviorCell,
  binding: CandidateBinding,
  status: EvidenceRecordStatus,
): ReviewEvidenceRecord {
  const now = new Date().toISOString();
  return {
    id: `cell:${cell.id}:${cell.disposition}`,
    cellIds: [cell.id],
    owner: 'behavior-matrix',
    kind: 'disposition',
    status,
    evidenceLevel: 'fixture',
    environment: 'deterministic-manifest-validation',
    startedAt: now,
    finishedAt: now,
    outputDigest: sha256(cell.reason ?? cell.disposition),
    outputSummary: cell.reason ?? cell.disposition,
    candidateDigest: binding.candidateDigest,
    baseDigest: binding.baseDigest,
    scopeDigest: binding.scopeDigest,
    fresh: true,
  };
}

function providerApplies(provider: EvidenceProvider, changedFiles: string[]): boolean {
  if (provider.applicability.kind === 'global') return true;
  const pathPrefixes = provider.applicability.pathPrefixes;
  return changedFiles.some((file) => pathPrefixes.some((prefix) => file === prefix || file.startsWith(`${prefix}/`)));
}

function effectiveEvidenceCells(
  manifest: ReviewEvidenceManifest,
  changedFiles: string[],
  onlyCellIds?: Set<string>,
): BehaviorCell[] {
  const requestedCells = manifest.behaviorMatrix.filter(
    (cell) => !onlyCellIds || onlyCellIds.has(cell.id),
  );
  const applicableCellIds = new Set(
    manifest.providers
      .filter((provider) => providerApplies(provider, changedFiles))
      .flatMap((provider) => provider.cellIds),
  );
  return requestedCells.filter(
    (cell) => cell.providerIds.length === 0 || applicableCellIds.has(cell.id),
  );
}

export function selectedEvidenceProviderIds(manifest: ReviewEvidenceManifest, changedFiles: string[]): string[] {
  return manifest.providers
    .filter((provider) => providerApplies(provider, changedFiles))
    .map((provider) => provider.id)
    .sort();
}

function evidenceExecutionUnavailable(ctx: WorkflowContext, provider: EvidenceProvider) {
  if (provider.executionContext.runner === 'sealed') return sealedEvidenceExecutionUnavailable();
  if (provider.executionContext.runner === 'host-seatbelt') return hostEvidenceExecutionUnavailable(ctx, provider);
  if (provider.executionContext.runner === 'local-host') return localEvidenceExecutionUnavailable(ctx, provider);
  return undefined;
}

function materializeOperationSnapshot(options: {
  ctx: WorkflowContext; input: ReviewDiffInput; binding: CandidateBinding;
  operation: EvidenceOperation; root: string;
}): void {
  const { ctx, input, binding, operation, root } = options;
  if (operation.target === 'base') materializeBase(ctx.cwd, root, input.changedFiles, binding.baseRef);
  else materializeExactCandidate(ctx, input, root, binding.baseRef, binding.redactedUntrackedFiles);
}

async function ciEvidenceRecord(options: {
  provider: EvidenceProvider; operation: EvidenceOperation; binding: CandidateBinding;
  repositoryRoot: string; candidateRoot: string; executionOffset: string;
}): Promise<ReviewEvidenceRecord> {
  const { provider, operation, binding, repositoryRoot, candidateRoot, executionOffset } = options;
  const startedAt = new Date().toISOString();
  const record: ReviewEvidenceRecord = {
    id: `${provider.id}:${operation.id}`, providerId: provider.id, operationId: operation.id,
    cellIds: [...provider.cellIds], owner: provider.owner, kind: provider.kind,
    status: 'runtime-incomplete', evidenceLevel: operation.evidenceLevel,
    environment: 'github-actions/macos-writable-checkout',
    // CI records describe the fixed root recipe, including when the caller offset is rejected.
    commandDigest: operationCommandDigest({ operation, executionOffset: '' }),
    startedAt, finishedAt: startedAt, outputDigest: '', outputSummary: '',
    candidateDigest: binding.candidateDigest, baseDigest: binding.baseDigest,
    scopeDigest: binding.scopeDigest, fresh: false,
  };
  try {
    const provenance = await collectReviewCiEvidence(repositoryRoot, candidateRoot, provider, executionOffset);
    record.ciProvenance = provenance;
    record.executionIdentityDigest = sha256(stableJson(provenance));
    record.status = 'verified-pass';
    record.fresh = true;
    record.outputSummary = `Exact candidate CI step passed: https://github.com/${provenance.repository}/actions/runs/${provenance.runId}/attempts/${provenance.attempt}; step=${provenance.step}; revision=${provenance.revision}; writable CI checkout, not a sealed local execution`;
  } catch (error) {
    record.outputSummary = boundText(`CI evidence incomplete: ${error instanceof Error ? error.message : String(error)}`, operation.maxOutputBytes);
  }
  record.finishedAt = new Date().toISOString();
  record.outputDigest = sha256(record.outputSummary);
  return record;
}

function executionContextIncompleteRecord(
  provider: EvidenceProvider,
  operation: EvidenceOperation,
  binding: CandidateBinding,
  unavailable: { actual: string; detail: string } = {
    actual: 'sealed/review-runtime',
    detail: 'the review is already inside a sealed evidence runtime',
  },
): ReviewEvidenceRecord {
  const now = new Date().toISOString();
  const expected = `${provider.executionContext.runner}/${provider.executionContext.sandboxOwner}`;
  const actual = unavailable.actual;
  const lane = provider.executionContext.runner === 'host-seatbelt' ? provider.executionContext.lane : 'none';
  const remediation = provider.executionContext.runner === 'host-seatbelt'
    ? `run the named deterministic host lane ${lane}; do not execute this provider inside sealed review evidence`
    : 'run review/code on a supported macOS Seatbelt host; Linux and Windows do not currently execute sealed review evidence';
  const outputSummary = [
    `contract owner=${provider.owner}`,
    `actual=${actual}`,
    `expected=${expected}`,
    `scope=${binding.scopeDigest}`,
    `executionContext=${stableJson(provider.executionContext)}`,
    `detail=${unavailable.detail}`,
    `fix=${remediation}`,
  ].join('; ');
  return {
    id: `${provider.id}:${operation.id}`,
    providerId: provider.id,
    operationId: operation.id,
    cellIds: [...provider.cellIds],
    owner: provider.owner,
    kind: provider.kind,
    status: 'runtime-incomplete',
    evidenceLevel: operation.evidenceLevel,
    environment: actual,
    commandDigest: sha256(stableJson(operation.argv)),
    startedAt: now,
    finishedAt: now,
    outputDigest: sha256(outputSummary),
    outputSummary,
    candidateDigest: binding.candidateDigest,
    baseDigest: binding.baseDigest,
    scopeDigest: binding.scopeDigest,
    fresh: false,
  };
}

function pythonRuntimeIncompleteRecord(
  options: RunEvidenceOperationOptions,
  startedAt: string,
  error: PythonRuntimePreparationError,
): ReviewEvidenceRecord {
  const { provider, operation, binding } = options;
  const finishedAt = new Date().toISOString();
  const outputSummary = boundText(
    `runtime incomplete before project gate: ${error.message}`,
    operation.maxOutputBytes,
  );
  const snapshotDigest = snapshotContentDigest(
    options.snapshotRoot,
    dependencyRelativePaths(options.changedFiles),
  );
  return {
    id: `${provider.id}:${operation.id}`,
    providerId: provider.id,
    operationId: operation.id,
    cellIds: [...provider.cellIds],
    owner: provider.owner,
    kind: provider.kind,
    status: 'runtime-incomplete',
    evidenceLevel: operation.evidenceLevel,
    environment: 'python3.14-uv-frozen-offline-runtime-incomplete',
    commandDigest: operationCommandDigest(options),
    snapshotDigestBefore: snapshotDigest,
    snapshotDigestAfter: snapshotDigest,
    replayCommand: operation.argv.map((value) => value.replaceAll('{seed}', operation.seed ?? '')),
    startedAt,
    finishedAt,
    outputDigest: sha256(outputSummary),
    outputSummary,
    candidateDigest: binding.candidateDigest,
    baseDigest: binding.baseDigest,
    scopeDigest: binding.scopeDigest,
    fresh: false,
  };
}

function localEvidenceExecutionUnavailable(ctx: WorkflowContext, provider: EvidenceProvider) {
  try {
    if (process.platform !== 'darwin' || process.env[EVIDENCE_SANDBOX_ACTIVE_ENV] === '1') {
      throw new Error('local self-tests require a native macOS host outside sealed evidence');
    }
    if (!isReviewLocalProvider(provider)) throw new Error('unsupported local self-test recipe');
    reviewReceiptAuthority(ctx);
    const file = ctx.options.reviewReceiptTrustedConfig ?? process.env[REVIEW_RECEIPT_TRUSTED_CONFIG_ENV];
    if (!file) throw new Error('local self-tests require the installed launcher authority');
    const trusted = JSON.parse(readFileSync(file, 'utf8'));
    if (trusted.runtimeHost !== ctx.options.host || trusted.reviewLocalEvidenceLane !== REVIEW_LOCAL_LANE) {
      throw new Error('installed runtime does not authorize the local self-test lane');
    }
    return undefined;
  } catch (error) {
    return { actual: 'local-host/unavailable', detail: error instanceof Error ? error.message : String(error) };
  }
}

function hostEvidenceExecutionUnavailable(
  ctx: WorkflowContext,
  provider: EvidenceProvider,
): { actual: string; detail: string } | undefined {
  if (process.env[EVIDENCE_SANDBOX_ACTIVE_ENV] === '1') {
    return {
      actual: 'sealed/review-runtime',
      detail: 'nested provider Seatbelt is forbidden',
    };
  }
  if (provider.executionContext.runner !== 'host-seatbelt' ||
      provider.executionContext.lane !== SUPPORTED_REVIEW_HOST_EVIDENCE_LANE) {
    return {
      actual: 'installed/review-runtime',
      detail: `unsupported host evidence lane ${provider.executionContext.runner === 'host-seatbelt' ? provider.executionContext.lane : 'none'}`,
    };
  }
  const configuredRuntimeFile = ctx.options.reviewReceiptTrustedConfig ??
    process.env[REVIEW_RECEIPT_TRUSTED_CONFIG_ENV];
  if (!configuredRuntimeFile) {
    return {
      actual: 'source/review-runtime',
      detail: 'host evidence requires the trusted installed launcher authority',
    };
  }
  try {
    reviewReceiptAuthority(ctx);
    const trustedRuntime = JSON.parse(readFileSync(configuredRuntimeFile, 'utf8')) as {
      runtimeHost?: unknown;
      reviewHostEvidenceLane?: unknown;
    };
    if (trustedRuntime.runtimeHost !== ctx.options.host ||
        (trustedRuntime.runtimeHost !== 'codex' && trustedRuntime.runtimeHost !== 'claude') ||
        trustedRuntime.reviewHostEvidenceLane !== provider.executionContext.lane) {
      return {
        actual: 'installed/review-runtime',
        detail: 'trusted runtime does not authorize the manifest-declared host evidence lane',
      };
    }
  } catch (error) {
    return {
      actual: 'untrusted/review-runtime',
      detail: `installed review authority validation failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  if (process.platform !== 'darwin' || !existsSync('/usr/bin/sandbox-exec')) {
    return {
      actual: `${process.platform}/review-runtime`,
      detail: 'the named host lane requires macOS Seatbelt',
    };
  }
  return undefined;
}

function recordAuthorizedForCell(
  record: ReviewEvidenceRecord,
  cell: BehaviorCell,
  manifest: ReviewEvidenceManifest,
): boolean {
  if (!record.cellIds.includes(cell.id)) return false;
  if (record.kind === 'disposition') {
    const dispositionStatus = cell.disposition === 'not-applicable'
      ? 'verified-pass'
      : cell.disposition === 'unsupported' || cell.disposition === 'manual'
        ? 'coverage-gap'
        : undefined;
    return Boolean(dispositionStatus) &&
      record.id === `cell:${cell.id}:${cell.disposition}` &&
      record.owner === 'behavior-matrix' &&
      record.status === dispositionStatus &&
      record.cellIds.length === 1 &&
      !record.providerId &&
      !record.operationId &&
      !record.commandDigest;
  }
  if (!record.providerId || !cell.providerIds.includes(record.providerId)) return false;
  const provider = manifest.providers.find((entry) => entry.id === record.providerId);
  return Boolean(provider?.cellIds.includes(cell.id));
}

function safePathSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 128);
}

function evidenceCellsForFinding(
  finding: ReviewFinding,
  evidence: ReviewEvidenceBundle,
): string[] {
  const ids = new Set(finding.evidenceIds ?? []);
  return uniqueSorted(evidence.records
    .filter((record) => ids.has(record.id))
    .flatMap((record) => record.cellIds));
}

/** Resolve legacy and current findings through the same declared coverage. */
export function reviewFindingCellIds(
  finding: ReviewFinding,
  evidence: ReviewEvidenceBundle,
  manifest = evidence.manifest,
): string[] {
  const bound = uniqueSorted([
    ...(finding.behaviorCellIds ?? []),
    ...evidenceCellsForFinding(finding, evidence),
  ]);
  if (bound.length > 0) return bound;
  if (finding.classification !== 'semantic-concern' ||
      !finding.file || finding.file.startsWith('<')) return [];
  // Applicability belongs to the project contract. Do not bind every high
  // severity finding to every cell, or invent coverage for an unknown path.
  const inherited = evidence.manifest.providers.filter((provider) => providerApplies(provider, [finding.file]));
  const providers = inherited.length > 0 ? inherited : manifest.providers.filter((provider) =>
    provider.applicability.kind === 'paths' && providerApplies(provider, [finding.file]));
  return uniqueSorted(providers.flatMap((provider) => provider.cellIds));
}

function cellAffectedByPaths(
  cellId: string,
  manifest: ReviewEvidenceManifest,
  changedFiles: string[],
): boolean {
  const providers = manifest.providers.filter((provider) => provider.cellIds.includes(cellId));
  return providers.length === 0 || providers.some((provider) => providerApplies(provider, changedFiles));
}

function changedFilesBetweenPatchTexts(original: string, repaired: string): string[] {
  const originalByFile = patchSections(original);
  const repairedByFile = patchSections(repaired);
  return uniqueSorted([...new Set([...originalByFile.keys(), ...repairedByFile.keys()])]
    .filter((file) => originalByFile.get(file) !== repairedByFile.get(file)));
}

function changedRedactedUntrackedPaths(
  original: CandidateBinding['redactedUntrackedFiles'],
  repaired: CandidateBinding['redactedUntrackedFiles'],
): string[] {
  const originalByPath = new Map(original.map((entry) => [entry.path, entry]));
  const repairedByPath = new Map(repaired.map((entry) => [entry.path, entry]));
  return uniqueSorted([...new Set([...originalByPath.keys(), ...repairedByPath.keys()])]
    .filter((path) => stableJson(originalByPath.get(path)) !== stableJson(repairedByPath.get(path))));
}

function redactedUntrackedRepairDelta(
  original: CandidateBinding['redactedUntrackedFiles'],
  repaired: CandidateBinding['redactedUntrackedFiles'],
): string {
  const originalByPath = new Map(original.map((entry) => [entry.path, entry]));
  const repairedByPath = new Map(repaired.map((entry) => [entry.path, entry]));
  const lines = changedRedactedUntrackedPaths(original, repaired).flatMap((path) => {
    const before = originalByPath.get(path);
    const after = repairedByPath.get(path);
    return [
      `REDACTED_UNTRACKED_DELTA ${JSON.stringify(path)}`,
      `- ${before ? `${before.digest} ${before.size}` : 'absent'}`,
      `+ ${after ? `${after.digest} ${after.size}` : 'absent'}`,
    ];
  });
  return lines.join('\n');
}

function patchSections(diff: string): Map<string, string> {
  const sections = new Map<string, string>();
  let file = '';
  let lines: string[] = [];
  const flush = () => {
    if (!lines.length) return;
    let oldPath: string | undefined;
    let newPath: string | undefined;
    let renamedPath: string | undefined;
    for (const line of lines) {
      if (line.startsWith('@@') || line === 'GIT binary patch') break;
      if (line.startsWith('--- ')) oldPath = decodePatchHeaderPath(line.slice(4));
      if (line.startsWith('+++ ')) newPath = decodePatchHeaderPath(line.slice(4));
      if (line.startsWith('rename to ')) renamedPath = decodeGitExtendedHeaderPath(line.slice(10));
      if (line.startsWith('copy to ')) renamedPath = decodeGitExtendedHeaderPath(line.slice(8));
    }
    const authoritativePath = newPath ?? renamedPath ?? oldPath ?? file;
    if (authoritativePath) sections.set(authoritativePath, lines.join('\n'));
  };
  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git ')) {
      flush();
      file = decodeGitDiffHeaderPath(line) ?? line;
      lines = [line];
    } else {
      lines.push(line);
    }
  }
  flush();
  return sections;
}

function decodeGitDiffHeaderPath(line: string): string | undefined {
  const quoted = /^diff --git ((?:"(?:\\.|[^"])*")|\S+) ((?:"(?:\\.|[^"])*")|\S+)$/.exec(line);
  if (quoted) return decodePatchHeaderPath(quoted[2]!);
  const rest = line.slice('diff --git '.length);
  if (!rest.startsWith('a/')) return undefined;
  let offset = 0;
  while (true) {
    const boundary = rest.indexOf(' b/', offset);
    if (boundary < 0) return undefined;
    const oldPath = rest.slice(2, boundary);
    const newPath = rest.slice(boundary + 3);
    if (oldPath === newPath) return newPath;
    offset = boundary + 1;
  }
}

function decodeGitExtendedHeaderPath(raw: string): string | undefined {
  if (!raw) return undefined;
  return raw.startsWith('"') ? decodeGitQuotedPath(raw) : raw;
}

function diffPatchTexts(original: string, repaired: string): string {
  const root = mkdtempSync(join(tmpdir(), 'goldband-review-closure-delta-'));
  try {
    writeFileSync(join(root, 'original.patch'), original);
    writeFileSync(join(root, 'repaired.patch'), repaired);
    const result = spawnSync(
      'git',
      [
        '-c', 'diff.external=',
        'diff', '--no-index', '--no-ext-diff', '--no-textconv', '--unified=0',
        '--src-prefix=original/', '--dst-prefix=repaired/', '--',
        'original.patch', 'repaired.patch',
      ],
      { cwd: root, encoding: 'utf8', maxBuffer: MAX_REVIEW_DIFF_BYTES * 2 },
    );
    if (result.status !== 0 && result.status !== 1) {
      throw new Error(`review closure could not calculate repair delta: ${result.stderr}`);
    }
    return result.stdout;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function canonicalRepository(cwd: string): string {
  const root = gitOutput(cwd, ['rev-parse', '--show-toplevel'], true);
  return realpathSync(root || cwd);
}

function gitOutput(cwd: string, args: string[], allowFailure = false): string {
  const result = spawnSync('git', ['--no-pager', ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_NO_LAZY_FETCH: '1' },
    timeout: 30_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.status !== 0) {
    if (allowFailure) return '';
    throw new Error(result.stderr || `git ${args[0]} failed`);
  }
  return result.stdout.trim();
}

function resolveWithin(root: string, value: string): string {
  if (isAbsolute(value)) throw new Error(`evidence path must be relative: ${value}`);
  const target = resolve(root, value);
  const rel = relative(root, target);
  if (rel === '..' || rel.startsWith(`..${sep}`)) throw new Error(`evidence path escapes snapshot: ${value}`);
  return target;
}

function boundText(value: string, maxBytes: number): string {
  let redacted = value;
  for (const { pattern } of SECRET_CONTENT_RULES) {
    redacted = redacted.replace(
      new RegExp(pattern.source, `${pattern.flags}g`),
      '[REDACTED]',
    );
  }
  const buffer = Buffer.from(redacted);
  if (buffer.length <= maxBytes) return redacted;
  return `${buffer.subarray(0, Math.max(0, maxBytes - 32)).toString('utf8')}\n[output truncated]`;
}

function resolveExecutable(command: string): string {
  const pathValue = process.env.PATH ?? '/usr/bin:/bin';
  for (const directory of pathValue.split(':').filter(Boolean)) {
    const candidate = resolve(directory, command);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Continue through the bounded PATH list.
    }
  }
  throw new Error(`review evidence executable is unavailable: ${command}`);
}

type EvidenceSystemToolAccess = {
  roots: string[];
  literals: string[];
  mapExecutableLiterals: string[];
  executableDirectories: string[];
  identityDigest: string;
  verifyUnchanged: () => boolean;
};

function evidenceSystemToolAccess(tools: string[]): EvidenceSystemToolAccess {
  if (tools.length === 0) {
    return { roots: [], literals: [], mapExecutableLiterals: [], executableDirectories: [], identityDigest: sha256('no-system-tools'), verifyUnchanged: () => true };
  }
  if (process.platform !== 'darwin') {
    throw new Error('declared evidence system tools require a supported host adapter');
  }
  const entries = tools.filter((tool) => tool === 'git').map((tool) => {
    const selected = spawnSync('/usr/bin/xcode-select', ['-p'], {
      encoding: 'utf8',
      timeout: 10_000,
    });
    const developerRoot = selected.status === 0 ? selected.stdout.trim() : '';
    if (!isAbsolute(developerRoot) || !existsSync(developerRoot)) {
      throw new Error('declared git evidence tool requires an active Apple developer directory');
    }
    const located = spawnSync('/usr/bin/xcrun', ['--find', 'git'], {
      encoding: 'utf8',
      timeout: 10_000,
    });
    const executable = located.status === 0 ? located.stdout.trim() : '';
    const realDeveloperRoot = realpathSync(developerRoot);
    const realRoot = realDeveloperRoot.endsWith(`${sep}Contents${sep}Developer`)
      ? dirname(realDeveloperRoot)
      : realDeveloperRoot;
    const realExecutable = executable && existsSync(executable) ? realpathSync(executable) : '';
    if (!realExecutable.startsWith(`${realRoot}${sep}`)) {
      throw new Error('declared git evidence tool resolved outside the active Apple developer directory');
    }
    return {
      tool,
      root: realRoot,
      launcher: '/usr/bin/git',
      executable: realExecutable,
      executableDigest: executableContentDigest(realExecutable),
    };
  });
  const literals = uniqueSorted([
    ...entries.flatMap((entry) => [entry.launcher, entry.executable]),
    ...(entries.length > 0
      ? ['/Library/Preferences/com.apple.dt.Xcode.plist'].filter(existsSync)
      : []),
  ]);
  const literalDigests = literals.map((file) => ({ file, digest: executableContentDigest(file) }));
  const identityDigest = sha256(stableJson({ entries, literalDigests }));
  return {
    roots: uniqueSorted(entries.map((entry) => entry.root).filter(Boolean)),
    literals,
    mapExecutableLiterals: uniqueSorted(entries.map((entry) => entry.executable)),
    executableDirectories: uniqueSorted(entries.map((entry) => dirname(entry.executable))),
    identityDigest,
    verifyUnchanged: () => entries.every((entry) =>
      existsSync(entry.executable) && executableContentDigest(entry.executable) === entry.executableDigest) &&
      literalDigests.every((entry) =>
        existsSync(entry.file) && executableContentDigest(entry.file) === entry.digest),
  };
}

function executableContentDigest(executable: string): string {
  const stat = statSync(executable);
  const cacheKey = `${executable}:${stat.size}:${stat.mtimeMs}`;
  const cached = executableDigestCache.get(cacheKey);
  if (cached) return cached;
  const digest = sha256(readFileSync(executable));
  executableDigestCache.set(cacheKey, digest);
  return digest;
}

function dependencyProjectionDigest(root: string, changedFiles: string[]): string {
  const entries: Array<{ path: string; digest: string }> = [];
  const contractNames = new Set([
    'package.json',
    'bun.lock',
    'bun.lockb',
    'package-lock.json',
    'pnpm-lock.yaml',
    'yarn.lock',
  ]);
  const projectRoots = new Set<string>(['']);
  for (const file of changedFiles) {
    const parts = file.split('/').filter(Boolean);
    for (let index = 1; index < parts.length; index += 1) {
      projectRoots.add(parts.slice(0, index).join('/'));
    }
  }
  for (const projectRoot of projectRoots) {
    for (const name of contractNames) {
      const relativePath = projectRoot ? `${projectRoot}/${name}` : name;
      const file = resolveWithin(root, relativePath);
      if (existsSync(file) && statSync(file).isFile()) {
        entries.push({ path: relativePath, digest: sha256(readFileSync(file)) });
      }
    }
  }
  for (const relativePath of dependencyRelativePaths(changedFiles)) {
    collectDependencyMetadata(root, relativePath, entries);
  }
  return sha256(stableJson(entries.sort((left, right) => left.path.localeCompare(right.path))));
}

function snapshotContentDigest(root: string, ignoredRoots: string[]): string {
  const ignored = ignoredRoots.map((value) => value.replaceAll('\\', '/').replace(/\/$/, ''));
  const entries: Array<{ path: string; kind: string; mode?: number; digest?: string }> = [];
  const pending: Array<{ absolute: string; relative: string }> = [{ absolute: root, relative: '' }];
  let visited = 0;
  while (pending.length > 0) {
    const current = pending.pop()!;
    for (const entry of readdirSync(current.absolute, { withFileTypes: true })) {
      const relativePath = current.relative ? `${current.relative}/${entry.name}` : entry.name;
      if (ignored.some((prefix) => relativePath === prefix || relativePath.startsWith(`${prefix}/`))) continue;
      visited += 1;
      if (visited > 100_000) throw new Error('review candidate snapshot exceeds 100000 entries');
      const absolute = join(current.absolute, entry.name);
      if (entry.isDirectory()) {
        entries.push({ path: relativePath, kind: 'directory' });
        pending.push({ absolute, relative: relativePath });
      } else if (entry.isSymbolicLink()) {
        entries.push({ path: relativePath, kind: 'symlink', digest: sha256(readlinkSync(absolute)) });
      } else if (entry.isFile()) {
        entries.push({
          path: relativePath,
          kind: 'file',
          mode: statSync(absolute).mode & 0o777,
          digest: sha256(readFileSync(absolute)),
        });
      } else {
        throw new Error(`review candidate snapshot contains unsupported entry: ${relativePath}`);
      }
    }
  }
  return sha256(stableJson(entries.sort((left, right) => left.path.localeCompare(right.path))));
}

function collectDependencyMetadata(
  root: string,
  relativeRoot: string,
  entries: Array<{ path: string; digest: string }>,
): void {
  const start = resolveWithin(root, relativeRoot);
  if (!existsSync(start)) return;
  const pending: Array<{ absolute: string; relative: string }> = [{
    absolute: start,
    relative: relativeRoot,
  }];
  let visited = 0;
  while (pending.length > 0) {
    const current = pending.pop()!;
    visited += 1;
    if (visited > 100_000) {
      throw new Error('review dependency projection exceeds 100000 entries');
    }
    for (const entry of readdirSync(current.absolute, { withFileTypes: true })) {
      const absolute = join(current.absolute, entry.name);
      const relativePath = `${current.relative}/${entry.name}`;
      if (entry.isDirectory()) {
        pending.push({ absolute, relative: relativePath });
        continue;
      }
      if (entry.isSymbolicLink()) {
        entries.push({ path: relativePath, digest: sha256(`symlink:${readlinkSync(absolute)}`) });
        continue;
      }
      if (!entry.isFile()) {
        throw new Error(`review dependency projection contains unsupported entry: ${relativePath}`);
      }
      entries.push({ path: relativePath, digest: sha256(readFileSync(absolute)) });
    }
  }
}

function mockEvidenceManifest(): ReviewEvidenceManifest {
  return {
    schemaVersion: 2,
    behaviorMatrix: [{
      id: 'mock-review-contract',
      behavior: 'The mock candidate is exercised by the deterministic fixture gate.',
      kind: 'normal',
      input: 'fixture diff',
      preconditions: 'mock workflow mode',
      expected: 'fixture gate exits successfully',
      risk: 'low',
      disposition: 'static',
      providerIds: ['mock-static-gate'],
    }],
    providers: [{
      id: 'mock-static-gate',
      owner: 'review-runtime-test-fixture',
      kind: 'static',
      lifecycle: 'persistent',
      cellIds: ['mock-review-contract'],
      applicability: {
        kind: 'global',
        reason: 'The mock manifest is an explicit single-provider fixture.',
      },
      executionContext: { sandboxOwner: 'review-runtime', runner: 'sealed' },
      operations: [{
        id: 'mock-pass',
        target: 'candidate',
        argv: ['true'],
        expectedExit: 'zero',
        timeoutMs: 1000,
        maxOutputBytes: 1024,
        network: 'deny',
        evidenceLevel: 'fixture',
        requiredSystemTools: [],
      }],
    }],
    authorizations: [],
  };
}

function asObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function assertAllowedKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const allowedKeys = new Set(allowed);
  const unknown = Object.keys(value).filter((key) => !allowedKeys.has(key)).sort();
  if (unknown.length > 0) throw new Error(`${label} contains unknown fields: ${unknown.join(', ')}`);
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label} must be a non-empty string`);
  return value.trim();
}

function optionalString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new Error('optional value must be a string');
  return value.trim() || undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function requiredId(value: unknown, label: string): string {
  const id = requiredString(value, label);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id)) throw new Error(`${label} has invalid ID syntax`);
  return id;
}

function requiredStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${label} must be a non-empty string array`);
  return value.map((entry) => requiredString(entry, label));
}

function optionalStringArray(value: unknown, label: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`${label} must be a string array`);
  return value.map((entry) => requiredString(entry, label));
}

function requiredIdArray(value: unknown, label: string): string[] {
  return requiredStringArray(value, label).map((entry) => requiredId(entry, label));
}

function requiredUniqueIdArray(value: unknown, label: string): string[] {
  const ids = requiredIdArray(value, label);
  assertUnique(ids, label);
  return ids;
}

function requiredIdList(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an ID array`);
  return value.map((entry) => requiredId(entry, label));
}

function optionalIdArray(value: unknown, label: string): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) throw new Error(`${label} must be an ID array`);
  return value.map((entry) => requiredId(entry, label));
}

function boundedInteger(value: unknown, label: string, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) {
    throw new Error(`${label} must be an integer between ${min} and ${max}`);
  }
  return value as number;
}

function validDate(value: unknown, label: string): string {
  const text = requiredString(value, label);
  if (!Number.isFinite(Date.parse(text))) throw new Error(`${label} must be an ISO date`);
  return text;
}

function assertUnique(values: string[], label: string): void {
  if (new Set(values).size !== values.length) throw new Error(`${label} IDs must be unique`);
}

function assertUniqueValues(values: string[], label: string): void {
  if (new Set(values).size !== values.length) throw new Error(`${label} must be unique`);
}

function assertSha256(value: unknown, label: string): void {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`${label} must be a SHA-256 digest`);
  }
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function uniqueInOrder(values: string[]): string[] {
  return [...new Set(values)];
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const item = value as Record<string, unknown>;
    return `{${Object.keys(item).sort().map((key) => `${JSON.stringify(key)}:${stableJson(item[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

export function createReviewArtifactPath(root: string, runId: string): string {
  mkdirSync(root, { recursive: true });
  const suffix = randomBytes(4).toString('hex');
  return join(root, `${runId}-${suffix}-review-evidence.json`);
}

export function writeInitialReviewArtifact(
  file: string,
  artifact: InitialReviewArtifactPayload,
  ctx: WorkflowContext,
  reviewScope: InitialReviewRuntimeReceipt['reviewScope'] = { kind: 'standalone' },
): InitialReviewArtifact {
  const canonicalArtifact = JSON.parse(JSON.stringify(artifact)) as InitialReviewArtifactPayload;
  const receipt: InitialReviewRuntimeReceipt = {
    schemaVersion: 1,
    id: `${safePathSegment(artifact.runId)}-${randomBytes(16).toString('hex')}`,
    runId: canonicalArtifact.runId,
    artifactDigest: sha256(stableJson(canonicalArtifact)),
    repository: canonicalArtifact.binding.repository,
    candidateDigest: canonicalArtifact.binding.candidateDigest,
    behaviorContractDigest: canonicalArtifact.binding.behaviorContractDigest,
    findingsDigest: sha256(stableJson(canonicalArtifact.findings)),
    evidenceDigest: sha256(stableJson(canonicalArtifact.evidence)),
    reviewScope,
    issuedAt: canonicalArtifact.createdAt,
  };
  const receiptDigest = sha256(stableJson(receipt));
  const authority = reviewReceiptAuthority(ctx);
  const signature = signReviewReceipt(receiptDigest, authority.key);
  const receiptRoot = authority.receiptRoot;
  mkdirSync(receiptRoot, { recursive: true, mode: 0o700 });
  const receiptFile = join(receiptRoot, `${receipt.id}.json`);
  writeFileSync(
    receiptFile,
    `${JSON.stringify(receipt, null, 2)}\n`,
    { mode: 0o600, flag: 'wx' },
  );
  const issued: InitialReviewArtifact = {
    ...canonicalArtifact,
    runtimeReceipt: {
      schemaVersion: 1,
      id: receipt.id,
      digest: receiptDigest,
      signature,
      reviewScope: receipt.reviewScope,
    },
  };
  mkdirSync(dirname(file), { recursive: true });
  try {
    writeFileSync(file, `${JSON.stringify(issued, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  } catch (error) {
    rmSync(receiptFile, { force: true });
    throw error;
  }
  return issued;
}

function validateInitialReviewRuntimeReceipt(
  ctx: WorkflowContext,
  artifact: InitialReviewArtifact,
): void {
  const authority = reviewReceiptAuthority(ctx);
  const receiptRoot = authority.receiptRoot;
  const receiptFile = join(receiptRoot, `${artifact.runtimeReceipt.id}.json`);
  let receipt: InitialReviewRuntimeReceipt;
  try {
    const stat = lstatSync(receiptFile, { throwIfNoEntry: false });
    if (!stat?.isFile() || stat.isSymbolicLink()) throw new Error('not a regular file');
    receipt = JSON.parse(readFileSync(receiptFile, 'utf8')) as InitialReviewRuntimeReceipt;
  } catch {
    throw new Error('closure requires a runtime-owned initial review receipt');
  }
  if (
    receipt.schemaVersion !== 1 ||
    receipt.id !== artifact.runtimeReceipt.id ||
    sha256(stableJson(receipt)) !== artifact.runtimeReceipt.digest ||
    !verifyReviewReceiptSignature(
      artifact.runtimeReceipt.digest,
      artifact.runtimeReceipt.signature,
      authority.key,
    ) ||
    receipt.runId !== artifact.runId ||
    receipt.repository !== artifact.binding.repository ||
    receipt.candidateDigest !== artifact.binding.candidateDigest ||
    receipt.behaviorContractDigest !== artifact.binding.behaviorContractDigest ||
    receipt.findingsDigest !== sha256(stableJson(artifact.findings)) ||
    receipt.evidenceDigest !== sha256(stableJson(artifact.evidence)) ||
    stableJson(receipt.reviewScope) !== stableJson(artifact.runtimeReceipt.reviewScope) ||
    (ctx.options.workId
      ? receipt.reviewScope.kind !== 'work-map' ||
        receipt.reviewScope.workId !== ctx.options.workId ||
        receipt.reviewScope.ticketId !== ctx.options.ticketId
      : receipt.reviewScope.kind !== 'standalone') ||
    receipt.issuedAt !== artifact.createdAt
  ) {
    throw new Error('closure initial review receipt is stale, forged, or mismatched');
  }
  const { runtimeReceipt: _runtimeReceipt, ...payload } = artifact;
  if (receipt.artifactDigest !== sha256(stableJson(payload))) {
    throw new Error('closure initial review artifact does not match its runtime receipt');
  }
}

function validateInitialReviewScope(value: unknown): InitialReviewScope {
  const scope = asObject(value, 'initial review runtime receipt scope');
  if (scope.kind === 'standalone') return { kind: 'standalone' };
  if (scope.kind !== 'work-map') {
    throw new Error('initial review runtime receipt scope kind is invalid');
  }
  const mapRevision = boundedInteger(scope.mapRevision, 'initial review scope.mapRevision', 0, Number.MAX_SAFE_INTEGER);
  const claimAttempt = boundedInteger(scope.claimAttempt, 'initial review scope.claimAttempt', 1, Number.MAX_SAFE_INTEGER);
  assertSha256(scope.subjectDigest, 'initial review scope.subjectDigest');
  return {
    kind: 'work-map',
    workId: requiredId(scope.workId, 'initial review scope.workId'),
    ticketId: requiredId(scope.ticketId, 'initial review scope.ticketId'),
    mapRevision,
    claimAttempt,
    subjectDigest: String(scope.subjectDigest),
  };
}

function reviewReceiptAuthority(ctx: WorkflowContext): { key: Buffer; receiptRoot: string } {
  if (ctx.options.mode === 'mock') {
    return {
      key: mockReviewReceiptAuthorityKey,
      receiptRoot: join(stateRoot(ctx.options), 'workflow-runs', 'mock-review-receipts'),
    };
  }
  const configuredRuntimeFile =
    ctx.options.reviewReceiptTrustedConfig ??
    process.env[REVIEW_RECEIPT_TRUSTED_CONFIG_ENV];
  const launcherArgument = process.argv[1];
  if (!configuredRuntimeFile && !launcherArgument) {
    throw new Error('review receipt authority requires the installed launcher');
  }
  const launcher = launcherArgument ? realpathSync(launcherArgument) : undefined;
  if (!configuredRuntimeFile && (!launcher || !['run.ts', 'run.js'].includes(basename(launcher)))) {
    throw new Error('review receipt authority requires the trusted installed Goldband launcher');
  }
  const runtimeRoot = configuredRuntimeFile
    ? dirname(resolve(configuredRuntimeFile))
    : dirname(dirname(launcher!));
  const trustedRuntimeFile = configuredRuntimeFile
    ? resolve(configuredRuntimeFile)
    : join(runtimeRoot, 'trusted-runtime.json');
  if (trustedRuntimeFile !== join(runtimeRoot, 'trusted-runtime.json')) {
    throw new Error('review receipt trusted runtime config has a non-canonical path');
  }
  const trustedRuntimeStat = lstatSync(trustedRuntimeFile, { throwIfNoEntry: false });
  if (!trustedRuntimeStat?.isFile() || trustedRuntimeStat.isSymbolicLink() ||
      (trustedRuntimeStat.mode & 0o077) !== 0 ||
      (typeof process.getuid === 'function' && trustedRuntimeStat.uid !== process.getuid())) {
    throw new Error('review receipt trusted runtime config is missing or unsafe');
  }
  const trustedRuntime = JSON.parse(readFileSync(trustedRuntimeFile, 'utf8')) as {
    schemaVersion?: unknown;
    reviewReceiptAuthorityRoot?: unknown;
    reviewReceiptKeyFile?: unknown;
    reviewReceiptStore?: unknown;
  };
  if (trustedRuntime.schemaVersion !== 2 ||
      typeof trustedRuntime.reviewReceiptAuthorityRoot !== 'string' ||
      typeof trustedRuntime.reviewReceiptKeyFile !== 'string' ||
      typeof trustedRuntime.reviewReceiptStore !== 'string') {
    throw new Error('trusted runtime is missing review receipt authority paths');
  }
  const authorityRoot = resolve(trustedRuntime.reviewReceiptAuthorityRoot);
  const keyFile = resolve(trustedRuntime.reviewReceiptKeyFile);
  const receiptRoot = resolve(trustedRuntime.reviewReceiptStore);
  if (keyFile !== join(authorityRoot, 'review-receipt.key') ||
      receiptRoot !== join(authorityRoot, 'review-receipts')) {
    throw new Error('trusted runtime review receipt authority escapes its owned root');
  }
  const stat = lstatSync(keyFile, { throwIfNoEntry: false });
  if (!stat?.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) {
    throw new Error('review receipt authority key is missing or has unsafe permissions');
  }
  if (typeof process.getuid === 'function' && stat.uid !== process.getuid()) {
    throw new Error('review receipt authority key has the wrong owner');
  }
  const encoded = readFileSync(keyFile, 'utf8').trim();
  if (!/^[a-f0-9]{64}$/.test(encoded)) {
    throw new Error('review receipt authority key is invalid');
  }
  if (existsSync(receiptRoot)) {
    const receiptRootStat = lstatSync(receiptRoot);
    if (!receiptRootStat.isDirectory() || receiptRootStat.isSymbolicLink() ||
        (receiptRootStat.mode & 0o077) !== 0) {
      throw new Error('review receipt authority store has unsafe permissions');
    }
  }
  return { key: Buffer.from(encoded, 'hex'), receiptRoot };
}

/** The lineage store shares the installed review receipt authority. */
export function reviewLineageAuthority(
  ctx: WorkflowContext,
): { key: Buffer; receiptRoot: string } {
  return reviewReceiptAuthority(ctx);
}

export function removeInitialReviewRuntimeReceipt(ctx: WorkflowContext, id: string): void {
  const safeId = requiredId(id, 'initial review runtime receipt id');
  const { receiptRoot } = reviewReceiptAuthority(ctx);
  rmSync(join(receiptRoot, `${safeId}.json`), { force: true });
}

function signReviewReceipt(receiptDigest: string, key: Buffer): string {
  return createHmac('sha256', key)
    .update(`goldband-review-receipt-v1\0${receiptDigest}`)
    .digest('hex');
}

function verifyReviewReceiptSignature(
  receiptDigest: string,
  signature: string,
  key: Buffer,
): boolean {
  if (!/^[a-f0-9]{64}$/.test(signature)) return false;
  const expected = Buffer.from(signReviewReceipt(receiptDigest, key), 'hex');
  return timingSafeEqual(expected, Buffer.from(signature, 'hex'));
}
