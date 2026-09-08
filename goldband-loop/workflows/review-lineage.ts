import { spawnSync } from 'node:child_process';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import {
  lstatSync,
  mkdirSync,
  openSync,
  closeSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  type Stats,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import type {
  EvidenceLevel,
  InitialReviewArtifact,
  ReviewEvidenceManifest,
} from './review-evidence';
import { initialReviewArtifactDigest } from './review-evidence';
import { isReviewCiMigration } from './review-ci-evidence';
import type { ReviewContractResolution } from './review-contract-resolution';
import type { ReviewClosureResult, ReviewFinding } from './types';

const LINEAGE_SCHEMA_VERSION = 1;
const LOCK_STALE_MS = 10 * 60 * 1000;
const LEVEL_ORDER: EvidenceLevel[] = [
  'fixture',
  'local',
  'sandboxed-service',
  'live-provider',
  'device-platform',
  'production-readback',
];

type ReviewPolicy = {
  schemaVersion: 1;
  policyId: string;
  minimumEvidenceLevels: Array<{
    id: string;
    cellIds: string[];
    minimumLevel: EvidenceLevel;
    reason: string;
  }>;
  waivers: Array<{
    id: string;
    cellId: string;
    allowedChanges: ContractChangeKind[];
    reason: string;
    approvedBy: string;
    approvedAt: string;
    expiresAt?: string;
  }>;
};

type ContractChangeKind =
  | 'cell-contract'
  | 'risk'
  | 'disposition'
  | 'provider-contract'
  | 'evidence-level'
  | 'finding-detachment';

type UnresolvedFinding = {
  findingId: string;
  behaviorCellIds: string[];
  artifactRunId: string;
  artifactReceiptId: string;
  blocking: boolean;
};

type ReviewLineagePayload = {
  schemaVersion: 1;
  id: string;
  revision: number;
  repository: string;
  baseDigest: string;
  scopeDigest: string;
  scopeSummary?: string[];
  collectionScopeDigest?: string;
  acceptanceDigest: string;
  policyDigest: string;
  policy: ReviewPolicy;
  requiredManifest: ReviewEvidenceManifest;
  contractResolution?: ReviewContractResolution;
  unresolvedFindings: UnresolvedFinding[];
  authoritativeArtifact?: {
    file: string;
    digest: string;
    runId: string;
    receiptId: string;
    createdAt?: string;
    hostCallCount?: 0 | 1;
  };
  verdict: ReviewVerdict;
  appliedWaiverIds: string[];
  updatedAt: string;
  lastCandidateDigest: string;
  lastBehaviorContractDigest: string;
};

export type ReviewVerdict = {
  noNewFindings: boolean;
  priorBlockersOpen: boolean;
  deterministicContractComplete: boolean;
  runtimeEvidenceIncomplete: boolean;
  closureComplete: boolean;
  completionAuthorized: boolean;
};

type SignedLineage = ReviewLineagePayload & { signature: string };

export type ReviewLineageHandle = {
  id: string;
  file: string;
  lockFile: string;
  ownerToken: string;
  scopeLocks: Array<{ lockFile: string; ownerToken: string }>;
  predecessor?: ReviewLineagePayload;
  manifest: ReviewEvidenceManifest;
  contractResolution: ReviewContractResolution;
  policy: ReviewPolicy;
  policyDigest: string;
  acceptanceDigest: string;
  scopeSummary: string[];
  collectionScopeDigest?: string;
  candidateDigest: string;
  behaviorContractDigest: string;
  appliedWaiverIds: string[];
};

export function reviewLineageScopeDigest(
  candidateScopeDigest: string,
  authority: { workId: string; ticketId: string } | { changedFiles: string[] },
): string {
  return 'workId' in authority
    ? sha256(stableJson({ candidateScopeDigest, workMap: authority }))
    : sha256(stableJson({
      candidateScopeDigest,
      changedFiles: [...new Set(authority.changedFiles)].sort(),
    }));
}

export function prepareReviewLineage(options: {
  cwd: string;
  storeRoot: string;
  key: Buffer;
  repository: string;
  baseRef: string;
  baseDigest: string;
  scopeDigest: string;
  legacyScopeDigest?: string;
  scopeSummary: string[];
  acceptanceDigest: string;
  policyIdentityDigest: string;
  candidateDigest: string;
  behaviorContractDigest: string;
  manifest: ReviewEvidenceManifest;
  contractResolution: ReviewContractResolution;
  closureArtifact?: InitialReviewArtifact;
  runId: string;
}): ReviewLineageHandle {
  const policy = readBaseReviewPolicy(options.cwd, options.baseRef);
  const policyDigest = sha256(stableJson({ policy, safetyPolicy: options.policyIdentityDigest }));
  const id = lineageId(options.repository, options.baseDigest, options.scopeDigest);
  const root = join(options.storeRoot, 'review-lineages');
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const file = join(root, `${id}.json`);
  const lockFile = join(root, `${id}.lock`);
  const scopeLocks = acquireScopeLocks({
    root,
    repository: options.repository,
    baseDigest: options.baseDigest,
    collectionScopeDigest: options.legacyScopeDigest,
    scopeSummary: options.scopeSummary,
    runId: options.runId,
  });
  try {
    acquireLineageLock(lockFile, options.runId);
  } catch (error) {
    releaseScopeLocks(scopeLocks);
    throw error;
  }
  try {
    let predecessor = readSignedLineage(file, options.key);
    let migratedLegacy = false;
    if (predecessor && repositoryInstanceChanged(predecessor, options.contractResolution)) {
      if (predecessor.unresolvedFindings.length > 0 || options.closureArtifact) {
        throw new Error(
          'review lineage repository identity changed while authoritative findings or closure remain',
        );
      }
      predecessor = undefined;
    }
    if (!predecessor && options.legacyScopeDigest && options.legacyScopeDigest !== options.scopeDigest) {
      const legacyId = lineageId(options.repository, options.baseDigest, options.legacyScopeDigest);
      const legacyFile = join(root, `${legacyId}.json`);
      const legacyLock = join(root, `${legacyId}.lock`);
      acquireLineageLock(legacyLock, `${options.runId}-legacy-read`);
      try {
        const legacy = readSignedLineage(legacyFile, options.key);
        if (legacy?.unresolvedFindings.length) {
          if (repositoryInstanceChanged(legacy, options.contractResolution)) {
            throw new Error(
              'review lineage repository identity changed while authoritative findings remain',
            );
          }
          const verifiedArtifact = legacy.scopeSummary && legacy.authoritativeArtifact?.createdAt
            ? undefined
            : closureArtifactScope(legacy, options.closureArtifact) ?? verifiedArtifactScope(legacy);
          const legacySummary = legacy.scopeSummary ?? verifiedArtifact?.changedFiles;
          const exactCandidate = legacy.lastCandidateDigest === options.candidateDigest;
          if ((legacySummary && scopesOverlap(legacySummary, options.scopeSummary)) ||
              (!legacySummary && exactCandidate)) {
            predecessor = {
              ...legacy,
              id,
              scopeDigest: options.scopeDigest,
              scopeSummary: legacySummary ?? [...options.scopeSummary],
              collectionScopeDigest: options.legacyScopeDigest,
              acceptanceDigest: options.acceptanceDigest,
              ...(legacy.authoritativeArtifact ? {
                authoritativeArtifact: {
                  ...legacy.authoritativeArtifact,
                  ...(legacy.authoritativeArtifact.createdAt || !verifiedArtifact?.createdAt
                    ? {}
                    : { createdAt: verifiedArtifact.createdAt }),
                },
              } : {}),
            };
            migratedLegacy = true;
          }
        }
      } finally {
        releaseReviewLineage({ lockFile: legacyLock, ownerToken: `${options.runId}-legacy-read` });
      }
    }
    let inheritedOverlap = false;
    if (!predecessor && options.legacyScopeDigest) {
      predecessor = findOverlappingScopedLineage({
        root,
        currentFile: file,
        key: options.key,
        repository: options.repository,
        baseDigest: options.baseDigest,
        collectionScopeDigest: options.legacyScopeDigest,
        scopeSummary: options.scopeSummary,
        contractResolution: options.contractResolution,
      });
      inheritedOverlap = Boolean(predecessor);
    }
    if (predecessor) {
      if (!migratedLegacy && !inheritedOverlap &&
          predecessor.acceptanceDigest !== options.acceptanceDigest) {
        throw new Error('review acceptance lineage changed without a new authoritative scope');
      }
      if (predecessor.policyDigest !== policyDigest) {
        throw new Error('review safety policy identity changed inside an existing lineage');
      }
      if (predecessor.unresolvedFindings.length > 0 && !options.closureArtifact) {
        throw new Error(openFindingsMessage(predecessor));
      }
      if (!options.closureArtifact &&
          predecessor.lastCandidateDigest === options.candidateDigest &&
          predecessor.lastBehaviorContractDigest === options.behaviorContractDigest) {
        throw new Error('duplicate initial review identity already has an authoritative result');
      }
      if (options.closureArtifact) {
        assertAuthoritativeClosureArtifact(predecessor, options.closureArtifact);
      }
      const appliedWaiverIds = assertMonotonicContract(
        predecessor.requiredManifest,
        options.manifest,
        predecessor.unresolvedFindings,
        policy,
      );
      enforceMinimumEvidenceLevels(options.manifest, policy);
      return {
        id, file, lockFile, ownerToken: options.runId, scopeLocks,
        predecessor, manifest: options.manifest, contractResolution: options.contractResolution, policy,
        policyDigest, acceptanceDigest: options.acceptanceDigest,
        scopeSummary: [...options.scopeSummary],
        collectionScopeDigest: options.legacyScopeDigest,
        candidateDigest: options.candidateDigest,
        behaviorContractDigest: options.behaviorContractDigest,
        appliedWaiverIds,
      };
    }
    if (options.closureArtifact) {
      const predecessor = bootstrapLineageFromArtifact({
        id,
        artifact: options.closureArtifact,
        scopeDigest: options.scopeDigest,
        collectionScopeDigest: options.legacyScopeDigest,
        acceptanceDigest: options.acceptanceDigest,
        policy,
        policyDigest,
      });
      assertAuthoritativeClosureArtifact(predecessor, options.closureArtifact);
      const appliedWaiverIds = assertMonotonicContract(
        predecessor.requiredManifest,
        options.manifest,
        predecessor.unresolvedFindings,
        policy,
      );
      enforceMinimumEvidenceLevels(options.manifest, policy);
      return {
        id, file, lockFile, ownerToken: options.runId, scopeLocks,
        predecessor, manifest: options.manifest, contractResolution: options.contractResolution, policy,
        policyDigest, acceptanceDigest: options.acceptanceDigest,
        scopeSummary: [...options.scopeSummary],
        collectionScopeDigest: options.legacyScopeDigest,
        candidateDigest: options.candidateDigest,
        behaviorContractDigest: options.behaviorContractDigest,
        appliedWaiverIds,
      };
    }
    enforceMinimumEvidenceLevels(options.manifest, policy);
    return {
      id, file, lockFile, ownerToken: options.runId, scopeLocks,
      manifest: options.manifest, contractResolution: options.contractResolution, policy,
      policyDigest, acceptanceDigest: options.acceptanceDigest,
      scopeSummary: [...options.scopeSummary],
      collectionScopeDigest: options.legacyScopeDigest,
      candidateDigest: options.candidateDigest,
      behaviorContractDigest: options.behaviorContractDigest,
      appliedWaiverIds: [],
    };
  } catch (error) {
    releaseReviewLineage({ lockFile, ownerToken: options.runId, scopeLocks });
    throw error;
  }
}

function bootstrapLineageFromArtifact(options: {
  id: string;
  artifact: InitialReviewArtifact;
  scopeDigest: string;
  collectionScopeDigest?: string;
  acceptanceDigest: string;
  policy: ReviewPolicy;
  policyDigest: string;
}): ReviewLineagePayload {
  const unresolvedFindings = options.artifact.findings.map((finding) => ({
    findingId: finding.id!,
    behaviorCellIds: [...new Set(finding.behaviorCellIds ?? [])].sort(),
    artifactRunId: options.artifact.runId,
    artifactReceiptId: options.artifact.runtimeReceipt.id,
    blocking: Boolean(finding.blocking),
  }));
  return {
    schemaVersion: 1,
    id: options.id,
    revision: 0,
    repository: options.artifact.binding.repository,
    baseDigest: options.artifact.binding.baseDigest,
    scopeDigest: options.scopeDigest,
    scopeSummary: [...options.artifact.binding.changedFiles].sort(),
    collectionScopeDigest: options.collectionScopeDigest,
    acceptanceDigest: options.acceptanceDigest,
    policyDigest: options.policyDigest,
    policy: options.policy,
    requiredManifest: options.artifact.evidence.manifest,
    ...(options.artifact.evidence.contractResolution
      ? { contractResolution: options.artifact.evidence.contractResolution }
      : {}),
    unresolvedFindings,
    authoritativeArtifact: {
      file: '<migrated-runtime-receipt>',
      digest: initialReviewArtifactDigest(options.artifact),
      runId: options.artifact.runId,
      receiptId: options.artifact.runtimeReceipt.id,
      createdAt: options.artifact.createdAt,
      hostCallCount: options.artifact.hostCallCount,
    },
    verdict: verdictFor({
      noNewFindings: options.artifact.findings.length === 0,
      unresolvedCount: unresolvedFindings.length,
      blockerCount: unresolvedFindings.filter((finding) => finding.blocking).length,
      deterministicComplete: options.artifact.evidence.completeness.complete,
      runtimeIncomplete: options.artifact.evidence.completeness.runtimeIncompleteCellIds.length > 0,
      closureComplete: false,
      initialReview: true,
    }),
    appliedWaiverIds: [],
    updatedAt: options.artifact.createdAt,
    lastCandidateDigest: options.artifact.binding.candidateDigest,
    lastBehaviorContractDigest: options.artifact.binding.behaviorContractDigest,
  };
}

export function finalizeInitialReviewLineage(options: {
  handle: ReviewLineageHandle;
  key: Buffer;
  repository: string;
  baseDigest: string;
  scopeDigest: string;
  artifact: InitialReviewArtifact;
  artifactFile: string;
  findings: ReviewFinding[];
  deterministicComplete: boolean;
  runtimeIncomplete: boolean;
}): ReviewVerdict {
  const unresolvedFindings = options.findings.map((finding) => ({
      findingId: finding.id!,
      behaviorCellIds: [...new Set(finding.behaviorCellIds ?? [])].sort(),
      artifactRunId: options.artifact.runId,
      artifactReceiptId: options.artifact.runtimeReceipt.id,
      blocking: Boolean(finding.blocking),
    }));
  const verdict = verdictFor({
    noNewFindings: options.findings.length === 0,
    unresolvedCount: unresolvedFindings.length,
    blockerCount: unresolvedFindings.filter((finding) => finding.blocking).length,
    deterministicComplete: options.deterministicComplete,
    runtimeIncomplete: options.runtimeIncomplete,
    closureComplete: false,
    initialReview: true,
  });
  writeSignedLineage(options.handle.file, {
    schemaVersion: LINEAGE_SCHEMA_VERSION,
    id: options.handle.id,
    revision: (options.handle.predecessor?.revision ?? 0) + 1,
    repository: options.repository,
    baseDigest: options.baseDigest,
    scopeDigest: options.scopeDigest,
    scopeSummary: [...options.handle.scopeSummary],
    collectionScopeDigest: options.handle.collectionScopeDigest,
    acceptanceDigest: options.handle.acceptanceDigest,
    policyDigest: options.handle.policyDigest,
    policy: options.handle.policy,
    requiredManifest: mergedRequiredManifest(
      options.handle.predecessor?.requiredManifest,
      options.handle.manifest,
    ),
    contractResolution: options.handle.contractResolution,
    unresolvedFindings,
    ...(options.findings.length > 0 ? {
      authoritativeArtifact: {
        file: options.artifactFile,
        digest: initialReviewArtifactDigest(options.artifact),
        runId: options.artifact.runId,
        receiptId: options.artifact.runtimeReceipt.id,
        createdAt: options.artifact.createdAt,
        hostCallCount: options.artifact.hostCallCount,
      },
    } : {}),
    verdict,
    appliedWaiverIds: options.handle.appliedWaiverIds,
    updatedAt: new Date().toISOString(),
    lastCandidateDigest: options.artifact.binding.candidateDigest,
    lastBehaviorContractDigest: options.artifact.binding.behaviorContractDigest,
  }, options.key);
  return verdict;
}

export function finalizeClosureReviewLineage(options: {
  handle: ReviewLineageHandle;
  key: Buffer;
  results: ReviewClosureResult[];
  deterministicComplete: boolean;
  runtimeIncomplete: boolean;
}): ReviewVerdict {
  const predecessor = options.handle.predecessor;
  if (!predecessor) throw new Error('closure lineage predecessor is missing');
  const resultById = new Map(options.results.map((result) => [result.findingId, result]));
  const unresolvedFindings = predecessor.unresolvedFindings.filter(
    (finding) => resultById.get(finding.findingId)?.status !== 'closed',
  );
  const closureComplete =
    options.results.length === predecessor.unresolvedFindings.length &&
    options.results.every((result) => result.status === 'closed');
  const verdict = verdictFor({
    noNewFindings: false,
    unresolvedCount: unresolvedFindings.length,
    blockerCount: unresolvedFindings.filter((finding) => finding.blocking).length,
    deterministicComplete: options.deterministicComplete,
    runtimeIncomplete: options.runtimeIncomplete,
    closureComplete,
    initialReview: false,
  });
  writeSignedLineage(options.handle.file, {
    ...predecessor,
    revision: predecessor.revision + 1,
    requiredManifest: mergedRequiredManifest(predecessor.requiredManifest, options.handle.manifest),
    contractResolution: options.handle.contractResolution,
    unresolvedFindings,
    ...(unresolvedFindings.length > 0 && predecessor.authoritativeArtifact
      ? { authoritativeArtifact: predecessor.authoritativeArtifact }
      : { authoritativeArtifact: undefined }),
    verdict,
    appliedWaiverIds: [...new Set([
      ...predecessor.appliedWaiverIds,
      ...options.handle.appliedWaiverIds,
    ])],
    updatedAt: new Date().toISOString(),
    lastCandidateDigest: options.handle.candidateDigest,
    lastBehaviorContractDigest: options.handle.behaviorContractDigest,
  }, options.key);
  return verdict;
}

export function releaseReviewLineage(
  handle?: Pick<ReviewLineageHandle, 'lockFile' | 'ownerToken'> & {
    scopeLocks?: Array<{ lockFile: string; ownerToken: string }>;
  },
): void {
  if (!handle) return;
  releaseOwnedLock(handle.lockFile, handle.ownerToken);
  releaseScopeLocks(handle.scopeLocks ?? []);
}

function releaseOwnedLock(lockFile: string, ownerToken: string): void {
  let owner: { runId?: string } = {};
  try { owner = JSON.parse(readFileSync(lockFile, 'utf8')); } catch { return; }
  if (owner.runId === ownerToken) rmSync(lockFile, { force: true });
}

export function readReviewLineageForTest(
  file: string,
  key: Buffer,
): ReviewLineagePayload | undefined {
  return readSignedLineage(file, key);
}

function assertMonotonicContract(
  predecessor: ReviewEvidenceManifest,
  current: ReviewEvidenceManifest,
  unresolved: UnresolvedFinding[],
  policy: ReviewPolicy,
): string[] {
  const applied = new Set<string>();
  const currentCells = new Map(current.behaviorMatrix.map((cell) => [cell.id, cell]));
  const predecessorProviders = new Map(predecessor.providers.map((provider) => [provider.id, provider]));
  const currentProviders = new Map(current.providers.map((provider) => [provider.id, provider]));
  for (const cell of predecessor.behaviorMatrix) {
    const next = currentCells.get(cell.id);
    if (!next) authorizeOrThrow(policy, cell.id, 'cell-contract', applied, 'required behavior cell was removed');
    else assertBehaviorCellNotWeaker(cell, next, policy, applied);
    for (const providerId of cell.providerIds) {
      const before = predecessorProviders.get(providerId);
      const after = currentProviders.get(providerId);
      if (providerContractWeakened(before, after)) {
        authorizeOrThrow(policy, cell.id, 'provider-contract', applied, 'required provider contract changed');
      }
    }
    if (maximumEvidenceLevel(current, cell.id) < maximumEvidenceLevel(predecessor, cell.id)) {
      authorizeOrThrow(policy, cell.id, 'evidence-level', applied, 'required evidence level was downgraded');
    }
  }
  for (const finding of unresolved) {
    for (const cellId of finding.behaviorCellIds) {
      if (!currentCells.has(cellId)) {
        authorizeOrThrow(policy, cellId, 'finding-detachment', applied, `finding ${finding.findingId} was detached`);
      }
    }
  }
  return [...applied].sort();
}

function assertBehaviorCellNotWeaker(
  before: ReviewEvidenceManifest['behaviorMatrix'][number],
  after: ReviewEvidenceManifest['behaviorMatrix'][number],
  policy: ReviewPolicy,
  applied: Set<string>,
): void {
  const semantics = (cell: typeof before) => stableJson({
    ...cell,
    risk: undefined,
    disposition: undefined,
    providerIds: undefined,
    reason: undefined,
  });
  if (semantics(before) !== semantics(after)) {
    authorizeOrThrow(policy, before.id, 'cell-contract', applied, 'required behavior semantics changed');
  }
  if (!isDispositionStrengthening(before.disposition, after.disposition) &&
      before.reason !== after.reason) {
    authorizeOrThrow(policy, before.id, 'cell-contract', applied, 'required behavior reason changed');
  }
  if (riskRank(after.risk) < riskRank(before.risk)) {
    authorizeOrThrow(policy, before.id, 'risk', applied, 'required behavior risk was downgraded');
  }
  if (!dispositionPreservedOrStrengthened(before.disposition, after.disposition)) {
    authorizeOrThrow(policy, before.id, 'disposition', applied, 'required behavior disposition changed');
  }
  if (before.providerIds.some((providerId) => !after.providerIds.includes(providerId))) {
    authorizeOrThrow(policy, before.id, 'provider-contract', applied, 'required provider was detached');
  }
}

function providerContractWeakened(
  before: ReviewEvidenceManifest['providers'][number] | undefined,
  after: ReviewEvidenceManifest['providers'][number] | undefined,
): boolean {
  if (!before || !after) return true;
  return before.owner !== after.owner ||
    before.kind !== after.kind ||
    before.lifecycle !== after.lifecycle ||
    !applicabilityPreservedOrStrengthened(before.applicability, after.applicability) ||
    (stableJson(before.executionContext) !== stableJson(after.executionContext) && !isReviewCiMigration(before, after)) ||
    before.cellIds.some((cellId) => !after.cellIds.includes(cellId)) ||
    before.operations.some((operation) => {
      const successor = after.operations.find((item) => item.id === operation.id);
      return !successor || stableJson(normalizeOperation(operation)) !== stableJson(normalizeOperation(successor));
    });
}

function isDispositionStrengthening(
  before: string,
  after: string,
): boolean {
  return ['manual', 'unsupported'].includes(before) &&
    ['automated', 'static', 'runtime-readback'].includes(after);
}

function dispositionPreservedOrStrengthened(before: string, after: string): boolean {
  return before === after || isDispositionStrengthening(before, after);
}

function applicabilityPreservedOrStrengthened(
  before: ReviewEvidenceManifest['providers'][number]['applicability'],
  after: ReviewEvidenceManifest['providers'][number]['applicability'],
): boolean {
  if (after.kind === 'global') return true;
  if (before.kind === 'global') return false;
  return before.pathPrefixes.every((beforePrefix) =>
    after.pathPrefixes.some((afterPrefix) =>
      beforePrefix === afterPrefix || beforePrefix.startsWith(`${afterPrefix}/`)));
}

export function assertReviewContractNotWeaker(
  baseline: ReviewEvidenceManifest,
  effective: ReviewEvidenceManifest,
): void {
  assertMonotonicContract(baseline, effective, [], emptyPolicy());
}

function authorizeOrThrow(
  policy: ReviewPolicy,
  cellId: string,
  change: ContractChangeKind,
  applied: Set<string>,
  message: string,
): void {
  const now = Date.now();
  const waiver = policy.waivers.find((item) =>
    item.cellId === cellId &&
    item.allowedChanges.includes(change) &&
    (!item.expiresAt || Date.parse(item.expiresAt) > now));
  if (!waiver) throw new Error(`review contract laundering blocked: ${message}: ${cellId}`);
  applied.add(waiver.id);
}

function enforceMinimumEvidenceLevels(
  manifest: ReviewEvidenceManifest,
  policy: ReviewPolicy,
): void {
  for (const requirement of policy.minimumEvidenceLevels) {
    for (const cellId of requirement.cellIds) {
      if (!manifest.behaviorMatrix.some((cell) => cell.id === cellId)) {
        throw new Error(`review policy minimum evidence references missing cell: ${cellId}`);
      }
      if (maximumEvidenceLevel(manifest, cellId) < LEVEL_ORDER.indexOf(requirement.minimumLevel)) {
        throw new Error(
          `review policy minimum evidence is unmet: ${cellId} requires ${requirement.minimumLevel}`,
        );
      }
    }
  }
}

function maximumEvidenceLevel(manifest: ReviewEvidenceManifest, cellId: string): number {
  return Math.max(-1, ...manifest.providers
    .filter((provider) => provider.cellIds.includes(cellId))
    .flatMap((provider) => provider.operations)
    .map((operation) => LEVEL_ORDER.indexOf(operation.evidenceLevel)));
}

function readBaseReviewPolicy(cwd: string, baseRef: string): ReviewPolicy {
  const result = spawnSync('git', ['show', `${baseRef}:goldband.review-policy.json`], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_NO_LAZY_FETCH: '1', GIT_OPTIONAL_LOCKS: '0' },
  });
  if (result.status !== 0) return emptyPolicy();
  return validateReviewPolicy(JSON.parse(result.stdout));
}

function validateReviewPolicy(value: unknown): ReviewPolicy {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('review policy must be an object');
  }
  const item = value as Record<string, unknown>;
  if (item.schemaVersion !== 1 || typeof item.policyId !== 'string' || !item.policyId) {
    throw new Error('review policy header is invalid');
  }
  if (!Array.isArray(item.minimumEvidenceLevels) || !Array.isArray(item.waivers)) {
    throw new Error('review policy lists are invalid');
  }
  const minimumEvidenceLevels = item.minimumEvidenceLevels.map((entry) => {
    const rule = requiredObject(entry, 'minimum evidence rule');
    if (!LEVEL_ORDER.includes(rule.minimumLevel as EvidenceLevel)) {
      throw new Error('review policy minimum evidence level is invalid');
    }
    return {
      id: requiredText(rule.id, 'minimum evidence id'),
      cellIds: requiredStringArray(rule.cellIds, 'minimum evidence cellIds'),
      minimumLevel: rule.minimumLevel as EvidenceLevel,
      reason: requiredText(rule.reason, 'minimum evidence reason'),
    };
  });
  const waivers = item.waivers.map((entry) => {
    const waiver = requiredObject(entry, 'review waiver');
    const allowedChanges = requiredStringArray(waiver.allowedChanges, 'waiver allowedChanges') as ContractChangeKind[];
    if (allowedChanges.some((change) => ![
      'cell-contract', 'risk', 'disposition', 'provider-contract', 'evidence-level', 'finding-detachment',
    ].includes(change))) throw new Error('review waiver change kind is invalid');
    const approvedAt = requiredDate(waiver.approvedAt, 'waiver approvedAt');
    const expiresAt = waiver.expiresAt === undefined
      ? undefined
      : requiredDate(waiver.expiresAt, 'waiver expiresAt');
    return {
      id: requiredText(waiver.id, 'waiver id'),
      cellId: requiredText(waiver.cellId, 'waiver cellId'),
      allowedChanges,
      reason: requiredText(waiver.reason, 'waiver reason'),
      approvedBy: requiredText(waiver.approvedBy, 'waiver approvedBy'),
      approvedAt,
      ...(expiresAt ? { expiresAt } : {}),
    };
  });
  return { schemaVersion: 1, policyId: item.policyId, minimumEvidenceLevels, waivers };
}

function emptyPolicy(): ReviewPolicy {
  return {
    schemaVersion: 1,
    policyId: 'runtime-default-v1',
    minimumEvidenceLevels: [],
    waivers: [],
  };
}

function mergedRequiredManifest(
  _predecessor: ReviewEvidenceManifest | undefined,
  current: ReviewEvidenceManifest,
): ReviewEvidenceManifest {
  // Monotonic comparison (and any typed waiver) has already authorized this
  // successor. It becomes the next authoritative predecessor.
  return current;
}

function assertAuthoritativeClosureArtifact(
  lineage: ReviewLineagePayload,
  artifact: InitialReviewArtifact,
): void {
  const expected = lineage.authoritativeArtifact;
  if (!expected ||
      expected.runId !== artifact.runId ||
      expected.receiptId !== artifact.runtimeReceipt.id ||
      expected.digest !== initialReviewArtifactDigest(artifact) ||
      lineage.unresolvedFindings.some((finding) =>
        !artifact.findings.some((item) => item.id === finding.findingId))) {
    throw new Error('closure artifact is not the authoritative unresolved finding lineage');
  }
}

function verifiedArtifactScope(
  lineage: ReviewLineagePayload,
): { changedFiles: string[]; createdAt: string; hostCallCount?: 0 | 1 } | undefined {
  const artifactFile = lineage.authoritativeArtifact?.file;
  if (!artifactFile) return undefined;
  const stat = lstatSync(artifactFile, { throwIfNoEntry: false });
  if (!stat?.isFile() || stat.isSymbolicLink()) return undefined;
  try {
    const artifact = JSON.parse(readFileSync(artifactFile, 'utf8')) as InitialReviewArtifact;
    if (initialReviewArtifactDigest(artifact) !== lineage.authoritativeArtifact?.digest ||
        !Array.isArray(artifact.binding?.changedFiles) ||
        artifact.binding.changedFiles.some((item) => typeof item !== 'string')) {
      return undefined;
    }
    if (typeof artifact.createdAt !== 'string' || !Number.isFinite(Date.parse(artifact.createdAt))) {
      return undefined;
    }
    return {
      changedFiles: [...new Set(artifact.binding.changedFiles)].sort(),
      createdAt: artifact.createdAt,
      ...(artifact.hostCallCount === 0 || artifact.hostCallCount === 1
        ? { hostCallCount: artifact.hostCallCount }
        : {}),
    };
  } catch {
    return undefined;
  }
}

function findOverlappingScopedLineage(options: {
  root: string;
  currentFile: string;
  key: Buffer;
  repository: string;
  baseDigest: string;
  collectionScopeDigest: string;
  scopeSummary: string[];
  contractResolution: ReviewContractResolution;
}): ReviewLineagePayload | undefined {
  const candidates = readdirSync(options.root)
    .filter((name) => name.endsWith('.json'))
    .sort();
  for (const name of candidates) {
    const file = join(options.root, name);
    if (file === options.currentFile) continue;
    const lineage = readSignedLineage(file, options.key);
    if (!lineage || lineage.repository !== options.repository ||
        lineage.baseDigest !== options.baseDigest ||
        lineage.collectionScopeDigest !== options.collectionScopeDigest ||
        lineage.unresolvedFindings.length === 0 ||
        !lineage.scopeSummary || !scopesOverlap(lineage.scopeSummary, options.scopeSummary)) {
      continue;
    }
    if (repositoryInstanceChanged(lineage, options.contractResolution)) {
      throw new Error(
        'review lineage repository identity changed while overlapping authoritative findings remain',
      );
    }
    return lineage;
  }
  return undefined;
}

function repositoryInstanceChanged(
  lineage: ReviewLineagePayload,
  current: ReviewContractResolution,
): boolean {
  const predecessorDigest =
    lineage.contractResolution?.repositoryIdentity.commonDirectoryInstanceDigest;
  return Boolean(
    predecessorDigest &&
    predecessorDigest !== current.repositoryIdentity.commonDirectoryInstanceDigest,
  );
}

function closureArtifactScope(
  lineage: ReviewLineagePayload,
  artifact?: InitialReviewArtifact,
): { changedFiles: string[]; createdAt: string } | undefined {
  if (!artifact || initialReviewArtifactDigest(artifact) !== lineage.authoritativeArtifact?.digest) {
    return undefined;
  }
  return {
    changedFiles: [...new Set(artifact.binding.changedFiles)].sort(),
    createdAt: artifact.createdAt,
  };
}

function openFindingsMessage(lineage: ReviewLineagePayload): string {
  const artifact = lineage.authoritativeArtifact;
  const verifiedArtifact = verifiedArtifactScope(lineage);
  const findings = lineage.unresolvedFindings.map((item) => item.findingId).join(', ');
  const scope = lineage.scopeSummary?.length
    ? lineage.scopeSummary.join(', ')
    : '<legacy scope unavailable>';
  const runId = artifact?.runId ?? lineage.unresolvedFindings[0]?.artifactRunId ?? '<unknown>';
  const createdAt = artifact?.createdAt ?? verifiedArtifact?.createdAt ?? '<unavailable>';
  const hostCallCount = artifact?.hostCallCount ?? verifiedArtifact?.hostCallCount;
  const closureInstruction = reviewTransitionInstruction(
    artifact,
    Boolean(verifiedArtifact),
    hostCallCount,
  );
  return [
    `review lineage has prior findings/blockers open (${findings})`,
    `authoritative run: ${runId}`,
    `created: ${createdAt}`,
    `lineage updated: ${lineage.updatedAt}`,
    `scope: ${scope}`,
    closureInstruction,
  ].join('; ');
}

function reviewTransitionInstruction(
  artifact: ReviewLineagePayload['authoritativeArtifact'],
  artifactVerified: boolean,
  hostCallCount?: 0 | 1,
): string {
  if (!artifact) return 'closure recovery: authoritative artifact reference is unavailable';
  if (artifactVerified) {
    return hostCallCount === 0
      ? `repair deterministic evidence with: --closure-artifact ${artifact.file}`
      : `close with: --closure-artifact ${artifact.file}`;
  }
  return hostCallCount === 0
    ? `evidence repair recovery: restore an authoritative artifact matching digest ${artifact.digest}, then use --closure-artifact <restored-path>`
    : `closure recovery: restore an authoritative artifact matching digest ${artifact.digest}, then use --closure-artifact <restored-path>`;
}

function verdictFor(input: {
  noNewFindings: boolean;
  unresolvedCount: number;
  blockerCount: number;
  deterministicComplete: boolean;
  runtimeIncomplete: boolean;
  closureComplete: boolean;
  initialReview: boolean;
}): ReviewVerdict {
  return {
    noNewFindings: input.noNewFindings,
    priorBlockersOpen: input.blockerCount > 0,
    deterministicContractComplete: input.deterministicComplete,
    runtimeEvidenceIncomplete: input.runtimeIncomplete,
    closureComplete: input.closureComplete,
    completionAuthorized:
      input.deterministicComplete &&
      !input.runtimeIncomplete &&
      input.blockerCount === 0 &&
      (input.initialReview || input.closureComplete),
  };
}

function normalizeOperation<T extends { requiredSystemTools?: string[] }>(operation: T): T & { requiredSystemTools: string[] } {
  return {
    ...(JSON.parse(JSON.stringify(operation)) as T),
    requiredSystemTools: operation.requiredSystemTools ?? [],
  };
}

function acquireScopeLocks(options: {
  root: string;
  repository: string;
  baseDigest: string;
  collectionScopeDigest?: string;
  scopeSummary: string[];
  runId: string;
}): Array<{ lockFile: string; ownerToken: string }> {
  if (!options.collectionScopeDigest || options.scopeSummary.length === 0) return [];
  const lockRoot = join(options.root, 'scope-path-locks');
  mkdirSync(lockRoot, { recursive: true, mode: 0o700 });
  const acquired: Array<{ lockFile: string; ownerToken: string }> = [];
  try {
    for (const path of [...new Set(options.scopeSummary)].sort()) {
      const lockId = sha256(stableJson({
        repository: options.repository,
        baseDigest: options.baseDigest,
        collectionScopeDigest: options.collectionScopeDigest,
        path,
      }));
      const lock = { lockFile: join(lockRoot, `${lockId}.lock`), ownerToken: options.runId };
      acquireLineageLock(lock.lockFile, lock.ownerToken);
      acquired.push(lock);
    }
    return acquired;
  } catch (error) {
    releaseScopeLocks(acquired);
    throw error;
  }
}

function releaseScopeLocks(
  locks: Array<{ lockFile: string; ownerToken: string }>,
): void {
  for (const lock of [...locks].reverse()) {
    releaseOwnedLock(lock.lockFile, lock.ownerToken);
  }
}

function acquireLineageLock(lockFile: string, runId: string): void {
  try {
    const fd = openSync(lockFile, 'wx', 0o600);
    try {
      writeFileSync(fd, `${JSON.stringify({ pid: process.pid, runId, acquiredAt: new Date().toISOString() })}\n`);
    } finally {
      closeSync(fd);
    }
    return;
  } catch (error) {
    if (!isCode(error, 'EEXIST')) throw error;
  }
  const { owner, stat } = readLockOwner(lockFile);
  if (owner.pid && processAlive(owner.pid)) {
    throw new Error('equivalent review lineage is already owned by another live process');
  }
  if (stat && !owner.pid && Date.now() - stat.mtimeMs <= LOCK_STALE_MS) {
    throw new Error('equivalent review lineage has a fresh malformed lock');
  }

  // Serialize stale-owner recovery separately. Without this guard, two
  // contenders can each unlink the other's newly created owner file and both
  // return as the winner.
  const recoveryFile = `${lockFile}.recovery`;
  acquireRecoveryGuard(recoveryFile, runId);
  try {
    // A contender may have completed recovery between our first stale-owner
    // read and this guard acquisition. Never unlink its new live owner.
    assertRecoveryGuard(recoveryFile, runId);
    const current = readLockOwner(lockFile);
    if (current.owner.pid && processAlive(current.owner.pid)) {
      throw new Error('equivalent review lineage is already owned by another live process');
    }
    if (current.stat && !current.owner.pid && Date.now() - current.stat.mtimeMs <= LOCK_STALE_MS) {
      throw new Error('equivalent review lineage has a fresh malformed lock');
    }
    assertRecoveryGuard(recoveryFile, runId);
    rmSync(lockFile, { force: true });
    assertRecoveryGuard(recoveryFile, runId);
    const fd = openSync(lockFile, 'wx', 0o600);
    try {
      writeFileSync(fd, `${JSON.stringify({ pid: process.pid, runId, recoveredAt: new Date().toISOString() })}\n`);
    } finally {
      closeSync(fd);
    }
    assertRecoveryGuard(recoveryFile, runId);
  } finally {
    releaseRecoveryGuard(recoveryFile, runId);
  }
}

function acquireRecoveryGuard(recoveryFile: string, runId: string): void {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const fd = openSync(recoveryFile, 'wx', 0o600);
      try {
        writeFileSync(fd, `${JSON.stringify({ pid: process.pid, runId })}\n`);
      } finally {
        closeSync(fd);
      }
      return;
    } catch (error) {
      if (!isCode(error, 'EEXIST')) throw error;
    }
    const { owner, stat } = readLockOwner(recoveryFile);
    if (owner.pid && processAlive(owner.pid)) {
      throw new Error('equivalent review lineage recovery is already owned by another live process');
    }
    if (stat && !owner.pid && Date.now() - stat.mtimeMs <= LOCK_STALE_MS) {
      throw new Error('equivalent review lineage has a fresh malformed recovery lock');
    }
    // Any contender that replaces this guard must prove its token again before
    // touching the owner lock, so a late stale read cannot create two winners.
    rmSync(recoveryFile, { force: true });
  }
  throw new Error('equivalent review lineage recovery could not acquire an exclusive owner');
}

function assertRecoveryGuard(recoveryFile: string, runId: string): void {
  const { owner } = readLockOwner(recoveryFile);
  if (owner.pid !== process.pid || owner.runId !== runId) {
    throw new Error('equivalent review lineage recovery ownership changed during recovery');
  }
}

function releaseRecoveryGuard(recoveryFile: string, runId: string): void {
  const { owner } = readLockOwner(recoveryFile);
  if (owner.pid === process.pid && owner.runId === runId) {
    rmSync(recoveryFile, { force: true });
  }
}

function readLockOwner(file: string): {
  owner: { pid?: number; runId?: string };
  stat: Stats | undefined;
} {
  const stat = lstatSync(file, { throwIfNoEntry: false });
  let owner: { pid?: number; runId?: string } = {};
  try { owner = JSON.parse(readFileSync(file, 'utf8')); } catch { /* absent or malformed lock */ }
  return { owner, stat };
}

function processAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function writeSignedLineage(file: string, payload: ReviewLineagePayload, key: Buffer): void {
  const canonical = JSON.parse(JSON.stringify(payload)) as ReviewLineagePayload;
  const signature = sign(canonical, key);
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify({ ...canonical, signature }, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  renameSync(temporary, file);
}

function readSignedLineage(file: string, key: Buffer): ReviewLineagePayload | undefined {
  const stat = lstatSync(file, { throwIfNoEntry: false });
  if (!stat) return undefined;
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) {
    throw new Error('review lineage store is unsafe');
  }
  const signed = JSON.parse(readFileSync(file, 'utf8')) as SignedLineage;
  const { signature, ...payload } = signed;
  if (payload.schemaVersion !== 1 || payload.id !== file.split('/').pop()?.replace(/\.json$/, '') ||
      typeof signature !== 'string' || !verify(payload, signature, key)) {
    throw new Error('review lineage record is tampered or invalid');
  }
  return payload;
}

function sign(payload: ReviewLineagePayload, key: Buffer): string {
  return createHmac('sha256', key)
    .update(`goldband-review-lineage-v1\0${stableJson(payload)}`)
    .digest('hex');
}

function verify(payload: ReviewLineagePayload, signature: string, key: Buffer): boolean {
  if (!/^[a-f0-9]{64}$/.test(signature)) return false;
  return timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(sign(payload, key), 'hex'));
}

function riskRank(risk: string): number {
  return ['low', 'medium', 'high'].indexOf(risk);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const item = value as Record<string, unknown>;
    return `{${Object.keys(item).sort().map((key) => `${JSON.stringify(key)}:${stableJson(item[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function lineageId(repository: string, baseDigest: string, scopeDigest: string): string {
  return sha256(stableJson({ repository, baseDigest, scopeDigest }));
}

function scopesOverlap(left: string[], right: string[]): boolean {
  const rightPaths = new Set(right);
  return left.some((path) => rightPaths.has(path));
}

function requiredObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  return value;
}

function requiredStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== 'string' || !item)) {
    throw new Error(`${label} must be a non-empty string array`);
  }
  return value as string[];
}

function requiredDate(value: unknown, label: string): string {
  const text = requiredText(value, label);
  if (!Number.isFinite(Date.parse(text))) throw new Error(`${label} must be an ISO date`);
  return text;
}

function isCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === code);
}
