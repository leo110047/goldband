import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash, createHmac } from 'node:crypto';
import { getWorkflow } from '../workflows/registry';
import { runWorkflow } from '../workflows/runtime';
import {
  finalizeClosureReviewLineage,
  finalizeInitialReviewLineage,
  assertReviewContractBoundary,
  prepareReviewLineage,
  readReviewLineageForTest,
  releaseReviewLineage,
  reviewLineageScopeDigest,
} from '../workflows/review-lineage';
import type {
  InitialReviewArtifact,
  ReviewEvidenceManifest,
} from '../workflows/review-evidence';
import { createCandidateBinding } from '../workflows/review-evidence';
import type { ReviewContractResolution } from '../workflows/review-contract-resolution';
import { adapterFor } from '../workflows/host-adapter';
import { reviewContractChanges, validateReviewContractAssessment } from '../workflows/review-contract-changes';

const roots: string[] = [];
const key = Buffer.alloc(32, 7);

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('authoritative review lineage', () => {
	test('permits wider provider applicability but rejects narrower coverage', () => {
		const baseline = manifest();
		baseline.providers[0]!.applicability = {
			kind: 'paths',
			pathPrefixes: ['workflows/review-evidence.ts'],
		};
		const wider = structuredClone(baseline);
		wider.providers[0]!.applicability = {
			kind: 'paths',
			pathPrefixes: ['workflows/review-evidence.ts', 'workflows/review.ts'],
		};
		expect(() => assertReviewContractBoundary(baseline, wider)).not.toThrow();

		const broader = structuredClone(baseline);
		broader.providers[0]!.applicability = {
			kind: 'paths',
			pathPrefixes: ['workflows'],
		};
		expect(() => assertReviewContractBoundary(baseline, broader)).not.toThrow();

		const narrower = structuredClone(baseline);
		narrower.providers[0]!.applicability = {
			kind: 'paths',
			pathPrefixes: ['test'],
		};
		expect(() => assertReviewContractBoundary(baseline, narrower))
			.toThrow('contract laundering blocked');
	});

	test('reason edits remain reviewable and cannot silently waive an unsupported boundary', () => {
		const unsupported = manifest();
		unsupported.behaviorMatrix[0] = {
			...unsupported.behaviorMatrix[0]!,
			disposition: 'unsupported',
			providerIds: [],
			reason: 'The provider is not wired.',
		};
		unsupported.providers = [];
		const rewritten = structuredClone(unsupported);
		rewritten.behaviorMatrix[0]!.reason = 'A different unsupported explanation.';
		expect(() => assertReviewContractBoundary(unsupported, rewritten)).not.toThrow();
		expect(() => validateReviewContractAssessment(undefined, reviewContractChanges([unsupported], rewritten)))
			.toThrow('explicit semantic contract assessment');
		expect(() => assertReviewContractBoundary(unsupported, manifest())).not.toThrow();
	});

  test('rejects an empty initial candidate before lineage creation and permits a later candidate', async () => {
    const fixture = repository();
    const diffFile = join(fixture.repo, 'candidate.diff');
    const evidenceFile = join(fixture.repo, 'goldband.review-evidence.json');
    writeFileSync(diffFile, '');
    writeFileSync(evidenceFile, `${JSON.stringify(dispositionManifest('unsafe deployment is rejected'))}\n`);
    git(fixture.repo, ['add', 'goldband.review-evidence.json']);
    git(fixture.repo, ['commit', '-qm', 'add review evidence']);

    await expect(runWorkflow(getWorkflow('review/code'), {
      mode: 'mock', host: 'mock', cwd: fixture.repo, goldbandHome: fixture.state,
      diffFile: 'candidate.diff', evidenceManifestFile: 'goldband.review-evidence.json',
    })).rejects.toThrow('initial candidate is empty; no authoritative lineage was created');
    expect(existsSync(join(fixture.state, 'review-lineages'))).toBe(false);

    writeFileSync(diffFile, [
      'diff --git a/unrelated.ts b/unrelated.ts',
      '--- a/unrelated.ts',
      '+++ b/unrelated.ts',
      '@@ -0,0 +1 @@',
      '+safe();',
      '',
    ].join('\n'));
    const result = await runWorkflow(getWorkflow('review/code'), {
      mode: 'mock', host: 'mock', cwd: fixture.repo, goldbandHome: fixture.state,
      diffFile: 'candidate.diff', evidenceManifestFile: 'goldband.review-evidence.json',
    });
    expect(String(result.output)).toContain('# review/code runtime report');
  });

  test('workflow rejects laundering before evidence or a second semantic host dispatch', async () => {
    const fixture = repository();
    const diffFile = join(fixture.repo, 'candidate.diff');
    const evidenceFile = join(fixture.repo, 'goldband.review-evidence.json');
    writeFileSync(diffFile, [
      'diff --git a/deploy.ts b/deploy.ts',
      '--- a/deploy.ts',
      '+++ b/deploy.ts',
      '@@ -1 +1 @@',
      '-safe();',
      '+GOLDBAND_HIGH_SEMANTIC_FIXTURE();',
      '',
    ].join('\n'));
    const original = dispositionManifest('unsafe deployment is rejected');
    writeFileSync(evidenceFile, `${JSON.stringify(original)}\n`);
    git(fixture.repo, ['add', 'goldband.review-evidence.json']);
    git(fixture.repo, ['commit', '-qm', 'add review evidence']);
    const initial = await runWorkflow(getWorkflow('review/code'), {
      mode: 'mock', host: 'mock', cwd: fixture.repo, goldbandHome: fixture.state,
      diffFile: 'candidate.diff', evidenceManifestFile: 'goldband.review-evidence.json',
    });
    expect(String(initial.output)).toContain('prior-blockers-open: true');
    expect(String(initial.output)).toContain('completion-authorized: false');

    const weakened = dispositionManifest('the unsafe graph remains installed');
    writeFileSync(evidenceFile, `${JSON.stringify(weakened)}\n`);
    await expect(runWorkflow(getWorkflow('review/code'), {
      mode: 'mock', host: 'mock', cwd: fixture.repo, goldbandHome: fixture.state,
      diffFile: 'candidate.diff', evidenceManifestFile: 'goldband.review-evidence.json',
    })).rejects.toThrow('prior findings/blockers open');
    const telemetryRoot = join(fixture.state, 'workflow-runs', 'telemetry');
    const hostTelemetry = spawnSync('find', [telemetryRoot, '-name', '*-review-host-usage.json'], { encoding: 'utf8' });
    expect(hostTelemetry.stdout.trim().split('\n').filter(Boolean)).toHaveLength(1);
  });

  test('blocks a weakened manifest before another initial review can run', () => {
    const fixture = repository();
    const first = prepare(fixture, manifest());
    const artifact = initialArtifact(manifest(), [{
      id: 'S-001',
      file: 'deploy.ts',
      severity: 'high',
      summary: 'unsafe deployment gate',
      blocking: true,
      behaviorCellIds: ['deployment-safe'],
    }]);
    finalizeInitialReviewLineage({
      handle: first,
      key,
      repository: 'repo',
      baseDigest: 'a'.repeat(64),
      scopeDigest: 'b'.repeat(64),
      artifact,
      artifactFile: join(fixture.state, 'initial.json'),
      findings: artifact.findings,
      deterministicComplete: true,
      runtimeIncomplete: false,
    });
    releaseReviewLineage(first);

    const weak = manifest();
    weak.behaviorMatrix[0]!.expected = 'the unsafe graph remains installed';
    expect(() => prepare(fixture, weak)).toThrow('prior findings/blockers open');
    const persisted = readReviewLineageForTest(first.file, key)!;
    expect(persisted.unresolvedFindings.map((item) => item.findingId)).toEqual(['S-001']);
    expect(persisted.verdict).toMatchObject({
      priorBlockersOpen: true,
      completionAuthorized: false,
    });
  });

  test('guides deterministic-only lineage into monotonic evidence repair', () => {
    const fixture = repository();
    const gap = manifest();
    gap.behaviorMatrix[0] = {
      ...gap.behaviorMatrix[0]!,
      disposition: 'unsupported',
      providerIds: [],
      reason: 'No deterministic provider is wired yet.',
    };
    gap.providers = [];
    const first = prepare(fixture, gap);
    const artifact = initialArtifact(gap, [{
      id: 'D-001',
      file: '<evidence-manifest>',
      severity: 'high',
      summary: 'deployment evidence is missing',
      blocking: true,
      classification: 'coverage-gap',
      category: 'deterministic-evidence',
      behaviorCellIds: ['deployment-safe'],
    }]);
    artifact.hostCallCount = 0;
    const artifactFile = join(fixture.state, 'deterministic-only.json');
    writeFileSync(artifactFile, `${JSON.stringify(artifact)}\n`);
    finalizeInitialReviewLineage({
      handle: first,
      key,
      repository: 'repo',
      baseDigest: 'a'.repeat(64),
      scopeDigest: 'b'.repeat(64),
      artifact,
      artifactFile,
      findings: artifact.findings,
      deterministicComplete: false,
      runtimeIncomplete: false,
    });
    releaseReviewLineage(first);

    expect(() => prepare(fixture, manifest(), undefined, {
      candidateDigest: 'f'.repeat(64),
    })).toThrow(`repair deterministic evidence with: --closure-artifact ${artifactFile}`);
    const repair = prepare(fixture, manifest(), artifact, {
      candidateDigest: 'f'.repeat(64),
      scopeDigest: '8'.repeat(64), acceptanceDigest: '9'.repeat(64),
      scopeSummary: ['deploy.ts', 'repair.ts'],
    });
    expect(repair.predecessor?.authoritativeArtifact).toMatchObject({
      runId: artifact.runId,
      receiptId: artifact.runtimeReceipt.id,
      hostCallCount: 0,
    });
    expect(repair.file).toBe(first.file);
    expect(repair.acceptanceDigest).toBe('c'.repeat(64));
    expect(repair.scopeSummary).toEqual(['deploy.ts']);
    const repairedArtifact = initialArtifact(manifest(), []);
    finalizeInitialReviewLineage({
      handle: repair, key, repository: 'repo', baseDigest: 'a'.repeat(64),
      scopeDigest: repair.predecessor!.scopeDigest, artifact: repairedArtifact,
      artifactFile: join(fixture.state, 'repaired.json'), findings: [],
      deterministicComplete: true, runtimeIncomplete: false,
    });
    releaseReviewLineage(repair);
    const next = prepare(fixture, manifest(), undefined, { candidateDigest: '7'.repeat(64) });
    releaseReviewLineage(next);
  });

  test('detects all inherited contract downgrade classes and permits additive coverage', () => {
    const fixture = repository();
    const first = prepare(fixture, manifest());
    const artifact = initialArtifact(manifest(), []);
    finalizeInitialReviewLineage({
      handle: first,
      key,
      repository: 'repo',
      baseDigest: 'a'.repeat(64),
      scopeDigest: 'b'.repeat(64),
      artifact,
      artifactFile: join(fixture.state, 'clean.json'),
      findings: [],
      deterministicComplete: true,
      runtimeIncomplete: false,
    });
    releaseReviewLineage(first);

    const mutations: Array<(value: ReviewEvidenceManifest) => void> = [
      (value) => { value.behaviorMatrix = []; },
      (value) => { value.behaviorMatrix[0]!.kind = 'normal'; },
      (value) => { value.behaviorMatrix[0]!.risk = 'low'; },
      (value) => { value.behaviorMatrix[0]!.disposition = 'manual'; value.behaviorMatrix[0]!.reason = 'skip'; },
      (value) => { value.providers[0]!.operations[0]!.network = 'authorized'; },
      (value) => { value.providers[0]!.operations[0]!.evidenceLevel = 'fixture'; },
    ];
    for (const mutate of mutations) {
      const changed = structuredClone(manifest());
      mutate(changed);
      expect(() => prepare(fixture, changed)).toThrow('contract laundering blocked');
    }
    for (const mutate of [
      (value: ReviewEvidenceManifest) => { value.behaviorMatrix[0]!.expected = 'unsafe state is accepted'; },
      (value: ReviewEvidenceManifest) => { value.providers[0]!.operations[0]!.argv = ['true']; },
    ]) {
      const changed = structuredClone(manifest());
      mutate(changed);
      const changes = reviewContractChanges([manifest()], changed);
      expect(changes).toHaveLength(1);
      expect(() => validateReviewContractAssessment(undefined, changes)).toThrow('explicit semantic contract assessment');
    }

    const additive = structuredClone(manifest());
    additive.behaviorMatrix.push({
      id: 'extra-coverage',
      behavior: 'extra invariant',
      kind: 'boundary',
      input: 'edge',
      preconditions: 'candidate exists',
      expected: 'edge remains safe',
      risk: 'medium',
      disposition: 'static',
      providerIds: ['extra-provider'],
    });
    additive.providers.push({
      id: 'extra-provider',
      owner: 'project',
      kind: 'static',
      lifecycle: 'persistent',
      cellIds: ['extra-coverage'],
      applicability: { kind: 'global', reason: 'Explicit additive lineage fixture.' },
      executionContext: { sandboxOwner: 'review-runtime', runner: 'sealed' },
      operations: [operation('extra-check', 'local')],
    });
    const next = prepare(fixture, additive);
    expect(next.appliedWaiverIds).toEqual([]);
    releaseReviewLineage(next);
  });

  test('workflow records a rejected check rewrite as a blocker despite passing evidence', async () => {
    const fixture = repository();
    const evidenceFile = join(fixture.repo, 'goldband.review-evidence.json');
    const original = dispositionManifest('unsafe deployment is rejected');
    writeFileSync(evidenceFile, JSON.stringify(original));
    git(fixture.repo, ['add', 'goldband.review-evidence.json']);
    git(fixture.repo, ['commit', '-qm', 'review contract baseline']);
    writeFileSync(evidenceFile, JSON.stringify(dispositionManifest('unsafe deployment is accepted')));
    writeFileSync(join(fixture.repo, 'candidate.diff'), 'diff --git a/deploy.ts b/deploy.ts\n--- a/deploy.ts\n+++ b/deploy.ts\n@@ -1 +1 @@\n-before();\n+after();\n');
    const prototype = Object.getPrototypeOf(adapterFor('mock'));
    const originalRun = prototype.runJson;
    let observedPrompt = '';
    const mock = spyOn(prototype, 'runJson').mockImplementation(async (prompt: string) => {
      observedPrompt = prompt;
      const result = await originalRun.call(adapterFor('mock'), prompt);
      result.parsed.contractReview = { preserved: false, summary: 'The revised expectation accepts the unsafe deployment.' };
      return result;
    });
    try {
      const result = await runWorkflow(getWorkflow('review/code'), {
        mode: 'mock', host: 'mock', cwd: fixture.repo, goldbandHome: fixture.state,
        diffFile: 'candidate.diff', evidenceManifestFile: 'goldband.review-evidence.json',
      });
      expect(observedPrompt).toContain('REVIEW_CONTRACT_CHANGES_START');
      expect(observedPrompt).toContain('unsafe deployment is rejected');
      expect(observedPrompt).toContain('unsafe deployment is accepted');
      expect(String(result.output)).toContain('completion-authorized: false');
      const artifactFile = result.artifacts.find((file: string) => file.endsWith('-review-evidence.json'))!;
      const artifact = JSON.parse(readFileSync(artifactFile, 'utf8'));
      expect(artifact.contractReview.assessment.preserved).toBe(false);
      expect(artifact.findings).toContainEqual(expect.objectContaining({ category: 'review-contract', blocking: true }));
    } finally {
      mock.mockRestore();
    }
  });

  test('unreviewed initial check corrections retain their predecessor across the next repair', () => {
    for (const outcome of ['host-incomplete', 'rejected'] as const) {
      const fixture = repository();
      const baseline = manifest();
      const changed = structuredClone(baseline);
      changed.providers[0]!.operations[0]!.argv = ['node', 'corrected-check.js'];
      changed.behaviorMatrix[0]!.expected = 'Corrected check still rejects unsafe input.';
      const first = prepare(fixture, changed, undefined, { baselineManifest: baseline });
      const artifact = initialArtifact(changed, [{
        id: 'D-001', file: '<typed-evidence>', severity: 'high', summary: 'Evidence remains incomplete.',
        blocking: true, classification: 'runtime-incomplete', category: 'deterministic-evidence',
        behaviorCellIds: ['deployment-safe'],
      }]);
      artifact.hostCallCount = outcome === 'host-incomplete' ? 0 : 1;
      artifact.contractReview = {
        changes: reviewContractChanges([baseline], changed),
        ...(outcome === 'rejected' ? { assessment: { preserved: false, summary: 'Missing rejection evidence.' } } : {}),
      };
      const artifactFile = join(fixture.state, 'unreviewed.json');
      writeFileSync(artifactFile, JSON.stringify(artifact));
      finalizeInitialReviewLineage({
        handle: first, key, repository: 'repo', baseDigest: 'a'.repeat(64), scopeDigest: 'b'.repeat(64),
        artifact, artifactFile, findings: artifact.findings, deterministicComplete: false, runtimeIncomplete: true,
      });
      releaseReviewLineage(first);
      const retained = readReviewLineageForTest(first.file, key)!;
      expect(retained.requiredManifest.providers[0]!.operations[0]!.argv).toEqual(baseline.providers[0]!.operations[0]!.argv);
      expect(retained.requiredManifest.behaviorMatrix[0]!.expected).toBe(baseline.behaviorMatrix[0]!.expected);
      const next = prepare(fixture, changed, artifact, { candidateDigest: 'f'.repeat(64) });
      expect(reviewContractChanges([next.requiredManifest], changed)).toHaveLength(2);
      expect(() => validateReviewContractAssessment(undefined, reviewContractChanges([next.requiredManifest], changed)))
        .toThrow('explicit semantic contract assessment');
      releaseReviewLineage(next);
    }
  });

  test('signed no-finding lineage records each current contract resolution', () => {
    const fixture = repository();
    const evidenceManifest = manifest();
    const first = prepare(fixture, evidenceManifest);
    const firstArtifact = initialArtifact(evidenceManifest, []);
    finalizeInitialReviewLineage({
      handle: first, key, repository: 'repo', baseDigest: 'a'.repeat(64),
      scopeDigest: 'b'.repeat(64), artifact: firstArtifact,
      artifactFile: join(fixture.state, 'first.json'), findings: [],
      deterministicComplete: true, runtimeIncomplete: false,
    });
    releaseReviewLineage(first);
    expect(readReviewLineageForTest(first.file, key)?.contractResolution)
      .toEqual(first.contractResolution);

    const effectiveDigest = first.contractResolution.effectiveDigest;
    const runtimeResolution: ReviewContractResolution = {
      ...first.contractResolution,
      baseline: {
        kind: 'runtime-store',
        identity: join(fixture.state, 'review-contracts', 'fixture.json'),
        digest: effectiveDigest,
      },
      explicit: {
        kind: 'explicit-extension',
        identity: join(fixture.repo, 'extended.json'),
        digest: effectiveDigest,
      },
    };
    const second = prepare(fixture, evidenceManifest, undefined, {
      candidateDigest: 'f'.repeat(64),
      contractResolution: runtimeResolution,
    });
    const secondArtifact = initialArtifact(evidenceManifest, []);
    secondArtifact.binding.candidateDigest = 'f'.repeat(64);
    finalizeInitialReviewLineage({
      handle: second, key, repository: 'repo', baseDigest: 'a'.repeat(64),
      scopeDigest: 'b'.repeat(64), artifact: secondArtifact,
      artifactFile: join(fixture.state, 'second.json'), findings: [],
      deterministicComplete: true, runtimeIncomplete: false,
    });
    const persisted = readReviewLineageForTest(second.file, key)!;
    expect(persisted.revision).toBe(2);
    expect(persisted.contractResolution).toEqual(runtimeResolution);
    expect(persisted.lastBehaviorContractDigest).toBe(effectiveDigest);
    releaseReviewLineage(second);
  });

  test('repository instance reuse resets clean lineage and rejects inherited findings', () => {
    const cleanFixture = repository();
    const evidenceManifest = manifest();
    const clean = prepare(cleanFixture, evidenceManifest);
    const cleanArtifact = initialArtifact(evidenceManifest, []);
    finalizeInitialReviewLineage({
      handle: clean, key, repository: 'repo', baseDigest: 'a'.repeat(64),
      scopeDigest: 'b'.repeat(64), artifact: cleanArtifact,
      artifactFile: join(cleanFixture.state, 'clean.json'), findings: [],
      deterministicComplete: true, runtimeIncomplete: false,
    });
    releaseReviewLineage(clean);

    const replacementResolution = structuredClone(clean.contractResolution);
    replacementResolution.repositoryIdentity.commonDirectoryInstanceDigest = '1'.repeat(64);
    const replacement = prepare(cleanFixture, evidenceManifest, undefined, {
      candidateDigest: 'f'.repeat(64),
      contractResolution: replacementResolution,
    });
    expect(replacement.predecessor).toBeUndefined();
    const replacementArtifact = initialArtifact(evidenceManifest, []);
    replacementArtifact.binding.candidateDigest = 'f'.repeat(64);
    finalizeInitialReviewLineage({
      handle: replacement, key, repository: 'repo', baseDigest: 'a'.repeat(64),
      scopeDigest: 'b'.repeat(64), artifact: replacementArtifact,
      artifactFile: join(cleanFixture.state, 'replacement.json'), findings: [],
      deterministicComplete: true, runtimeIncomplete: false,
    });
    const replacementLineage = readReviewLineageForTest(replacement.file, key)!;
    expect(replacementLineage.revision).toBe(1);
    expect(replacementLineage.contractResolution).toEqual(replacementResolution);
    releaseReviewLineage(replacement);

    const blockedFixture = repository();
    const blocked = prepare(blockedFixture, evidenceManifest);
    const findingArtifact = initialArtifact(evidenceManifest, [{
      id: 'S-identity', file: 'deploy.ts', severity: 'high',
      summary: 'identity-bound blocker', blocking: true,
      behaviorCellIds: ['deployment-safe'],
    }]);
    finalizeInitialReviewLineage({
      handle: blocked, key, repository: 'repo', baseDigest: 'a'.repeat(64),
      scopeDigest: 'b'.repeat(64), artifact: findingArtifact,
      artifactFile: join(blockedFixture.state, 'blocked.json'),
      findings: findingArtifact.findings,
      deterministicComplete: true, runtimeIncomplete: false,
    });
    releaseReviewLineage(blocked);
    const blockedReplacementResolution = structuredClone(blocked.contractResolution);
    blockedReplacementResolution.repositoryIdentity.commonDirectoryInstanceDigest = '2'.repeat(64);
    expect(() => prepare(blockedFixture, evidenceManifest, undefined, {
      candidateDigest: 'f'.repeat(64),
      contractResolution: blockedReplacementResolution,
    })).toThrow('review lineage repository identity changed');
  });

  test('canonicalizes replaced diff-file paths and rejects an exact duplicate initial identity', () => {
    const fixture = repository();
    const value = manifest();
    const left = createCandidateBinding(fixture.repo, {
      source: `diff-file:${join(fixture.repo, 'first.diff')}`,
      diff: 'same diff',
      changedFiles: ['deploy.ts'],
    }, value);
    const right = createCandidateBinding(fixture.repo, {
      source: `diff-file:${join(fixture.repo, 'replacement.diff')}`,
      diff: 'same diff',
      changedFiles: ['deploy.ts'],
    }, value);
    expect(left.scopeDigest).toBe(right.scopeDigest);

    const first = prepare(fixture, value);
    const artifact = initialArtifact(value, []);
    finalizeInitialReviewLineage({
      handle: first, key, repository: 'repo', baseDigest: 'a'.repeat(64), scopeDigest: 'b'.repeat(64),
      artifact, artifactFile: join(fixture.state, 'clean.json'), findings: [],
      deterministicComplete: true, runtimeIncomplete: false,
    });
    releaseReviewLineage(first);
    expect(() => prepare(fixture, value)).toThrow('duplicate initial review identity');
  });

  test('keeps distinct Work Map ticket authorities in independent lineages', () => {
    const candidateScope = 'b'.repeat(64);
    const first = reviewLineageScopeDigest(candidateScope, { workId: 'work-a', ticketId: 'ticket-a' });
    const second = reviewLineageScopeDigest(candidateScope, { workId: 'work-a', ticketId: 'ticket-b' });
    expect(first).not.toBe(second);
    expect(reviewLineageScopeDigest(candidateScope, { changedFiles: ['a.ts'] }))
      .not.toBe(reviewLineageScopeDigest(candidateScope, { changedFiles: ['b.ts'] }));
  });

  test('keeps unrelated standalone candidate scopes independent across restart', () => {
    const fixture = repository();
    const deployScope = reviewLineageScopeDigest('b'.repeat(64), { changedFiles: ['deploy.ts'] });
    const docsScope = reviewLineageScopeDigest('b'.repeat(64), { changedFiles: ['docs.ts'] });
    const first = prepare(fixture, manifest(), undefined, {
      scopeDigest: deployScope,
      legacyScopeDigest: 'b'.repeat(64),
      scopeSummary: ['deploy.ts'],
    });
    const artifact = initialArtifact(manifest(), [{
      id: 'S-001', file: 'deploy.ts', severity: 'high', summary: 'unsafe',
      blocking: true, behaviorCellIds: ['deployment-safe'],
    }]);
    const artifactFile = join(fixture.state, 'initial.json');
    writeFileSync(artifactFile, `${JSON.stringify(artifact)}\n`);
    finalizeInitialReviewLineage({
      handle: first, key, repository: 'repo', baseDigest: 'a'.repeat(64),
      scopeDigest: deployScope, artifact, artifactFile,
      findings: artifact.findings, deterministicComplete: true, runtimeIncomplete: false,
    });
    releaseReviewLineage(first);

    const unrelated = prepare(fixture, manifest(), undefined, {
      scopeDigest: docsScope,
      legacyScopeDigest: 'b'.repeat(64),
      scopeSummary: ['docs.ts'],
    });
    expect(unrelated.predecessor).toBeUndefined();
    releaseReviewLineage(unrelated);
    expect(() => prepare(fixture, manifest(), undefined, {
      scopeDigest: deployScope,
      legacyScopeDigest: 'b'.repeat(64),
      scopeSummary: ['deploy.ts'],
    })).toThrow(/authoritative run: initial-run; created: 2026-08-27T00:00:00.000Z; lineage updated: .*scope: deploy.ts; close with: --closure-artifact/);
  });

  test('blocks an overlapping repair initial and preserves closure across restart', () => {
    const fixture = repository();
    const collectionScope = 'b'.repeat(64);
    const originalScope = reviewLineageScopeDigest(collectionScope, { changedFiles: ['deploy.ts'] });
    const expandedScope = reviewLineageScopeDigest(collectionScope, {
      changedFiles: ['deploy.test.ts', 'deploy.ts'],
    });
    const first = prepare(fixture, manifest(), undefined, {
      scopeDigest: originalScope,
      legacyScopeDigest: collectionScope,
      scopeSummary: ['deploy.ts'],
    });
    expect(() => prepare(fixture, manifest(), undefined, {
      scopeDigest: expandedScope,
      legacyScopeDigest: collectionScope,
      scopeSummary: ['deploy.test.ts', 'deploy.ts'],
      candidateDigest: 'f'.repeat(64),
    })).toThrow('already owned');
    const disjoint = prepare(fixture, manifest(), undefined, {
      scopeDigest: reviewLineageScopeDigest(collectionScope, { changedFiles: ['docs.ts'] }),
      legacyScopeDigest: collectionScope,
      scopeSummary: ['docs.ts'],
      candidateDigest: 'f'.repeat(64),
    });
    expect(disjoint.predecessor).toBeUndefined();
    releaseReviewLineage(disjoint);
    const artifact = initialArtifact(manifest(), [{
      id: 'S-001', file: 'deploy.ts', severity: 'high', summary: 'unsafe',
      blocking: true, behaviorCellIds: ['deployment-safe'],
    }]);
    const artifactFile = join(fixture.state, 'overlap-initial.json');
    writeFileSync(artifactFile, `${JSON.stringify(artifact)}\n`);
    finalizeInitialReviewLineage({
      handle: first, key, repository: 'repo', baseDigest: 'a'.repeat(64),
      scopeDigest: originalScope, artifact, artifactFile, findings: artifact.findings,
      deterministicComplete: true, runtimeIncomplete: false,
    });
    releaseReviewLineage(first);

    expect(() => prepare(fixture, manifest(), undefined, {
      scopeDigest: expandedScope,
      legacyScopeDigest: collectionScope,
      scopeSummary: ['deploy.test.ts', 'deploy.ts'],
      candidateDigest: 'f'.repeat(64),
    })).toThrow(/prior findings\/blockers open \(S-001\)/);

    const closure = prepare(fixture, manifest(), artifact, {
      scopeDigest: expandedScope,
      legacyScopeDigest: collectionScope,
      scopeSummary: ['deploy.ts'],
      candidateDigest: 'f'.repeat(64),
    });
    finalizeClosureReviewLineage({
      artifact,
      handle: closure, key,
      results: [{ findingId: 'S-001', status: 'closed', summary: 'fixed', evidenceIds: ['gate:check'] }],
      deterministicComplete: true, runtimeIncomplete: false,
    });
    releaseReviewLineage(closure);
    expect(readReviewLineageForTest(closure.file, key)?.unresolvedFindings).toEqual([]);
    expect(closure.file).toBe(first.file);
    expect(readReviewLineageForTest(closure.file, key)?.scopeDigest).toBe(originalScope);

    const restarted = prepare(fixture, manifest(), undefined, {
      scopeDigest: expandedScope,
      legacyScopeDigest: collectionScope,
      scopeSummary: ['deploy.test.ts', 'deploy.ts'],
      candidateDigest: 'g'.repeat(64),
    });
    expect(restarted.predecessor).toBeUndefined();
    releaseReviewLineage(restarted);
    expect(() => prepare(fixture, manifest(), artifact, {
      scopeDigest: originalScope, legacyScopeDigest: collectionScope,
      scopeSummary: ['deploy.ts'], candidateDigest: 'f'.repeat(64),
    })).toThrow('authoritative signed lineage');
  });

  test('reads through legacy scope without letting an empty legacy candidate pollute a later candidate', () => {
    const emptyFixture = repository();
    const legacyEmpty = prepare(emptyFixture, manifest(), undefined, { scopeSummary: [] });
    const emptyArtifact = initialArtifact(manifest(), [{
      id: 'D-001', file: '<evidence-manifest>', severity: 'high', summary: 'empty audit',
      blocking: true, behaviorCellIds: ['deployment-safe'],
    }]);
    emptyArtifact.binding.changedFiles = [];
    const emptyArtifactFile = join(emptyFixture.state, 'empty-initial.json');
    writeFileSync(emptyArtifactFile, `${JSON.stringify(emptyArtifact)}\n`);
    finalizeInitialReviewLineage({
      handle: legacyEmpty, key, repository: 'repo', baseDigest: 'a'.repeat(64),
      scopeDigest: 'b'.repeat(64), artifact: emptyArtifact,
      artifactFile: emptyArtifactFile, findings: emptyArtifact.findings,
      deterministicComplete: false, runtimeIncomplete: true,
    });
    releaseReviewLineage(legacyEmpty);
    rewriteAsLegacyLineage(legacyEmpty.file);
    const scoped = reviewLineageScopeDigest('b'.repeat(64), { changedFiles: ['deploy.ts'] });
    const later = prepare(emptyFixture, manifest(), undefined, {
      scopeDigest: scoped, legacyScopeDigest: 'b'.repeat(64), scopeSummary: ['deploy.ts'],
    });
    expect(later.predecessor).toBeUndefined();
    releaseReviewLineage(later);

    const matchingFixture = repository();
    const legacyMatching = prepare(matchingFixture, manifest());
    const matchingArtifact = initialArtifact(manifest(), [{
      id: 'S-001', file: 'deploy.ts', severity: 'high', summary: 'unsafe',
      blocking: true, behaviorCellIds: ['deployment-safe'],
    }]);
    const matchingArtifactFile = join(matchingFixture.state, 'matching-initial.json');
    writeFileSync(matchingArtifactFile, `${JSON.stringify(matchingArtifact)}\n`);
    finalizeInitialReviewLineage({
      handle: legacyMatching, key, repository: 'repo', baseDigest: 'a'.repeat(64),
      scopeDigest: 'b'.repeat(64), artifact: matchingArtifact,
      artifactFile: matchingArtifactFile, findings: matchingArtifact.findings,
      deterministicComplete: true, runtimeIncomplete: false,
    });
    releaseReviewLineage(legacyMatching);
    rewriteAsLegacyLineage(legacyMatching.file);
    const expandedScoped = reviewLineageScopeDigest('b'.repeat(64), {
      changedFiles: ['deploy.test.ts', 'deploy.ts'],
    });
    expect(() => prepare(matchingFixture, manifest(), undefined, {
      scopeDigest: expandedScoped,
      legacyScopeDigest: 'b'.repeat(64),
      scopeSummary: ['deploy.test.ts', 'deploy.ts'],
      candidateDigest: 'f'.repeat(64),
    })).toThrow(/prior findings\/blockers open \(S-001\)/);
    expect(() => prepare(matchingFixture, manifest(), undefined, {
      scopeDigest: scoped, legacyScopeDigest: 'b'.repeat(64), scopeSummary: ['deploy.ts'],
    })).toThrow(/prior findings\/blockers open \(S-001\).*created: 2026-08-27T00:00:00.000Z; lineage updated: .*scope: deploy.ts/);

    const closure = prepare(matchingFixture, manifest(), matchingArtifact, {
      scopeDigest: scoped, legacyScopeDigest: 'b'.repeat(64), scopeSummary: ['deploy.ts'],
      candidateDigest: 'f'.repeat(64),
    });
    finalizeClosureReviewLineage({
      artifact: matchingArtifact,
      handle: closure, key,
      results: [{ findingId: 'S-001', status: 'closed', summary: 'fixed', evidenceIds: ['gate:check'] }],
      deterministicComplete: true, runtimeIncomplete: false,
    });
    releaseReviewLineage(closure);
    expect(readReviewLineageForTest(closure.file, key)).toMatchObject({
      id: closure.id,
      scopeDigest: 'b'.repeat(64),
      acceptanceDigest: 'c'.repeat(64),
      unresolvedFindings: [],
    });
    expect(() => prepare(matchingFixture, manifest(), undefined, {
      scopeDigest: scoped, legacyScopeDigest: 'b'.repeat(64), scopeSummary: ['deploy.ts'],
      candidateDigest: 'f'.repeat(64),
    })).toThrow('duplicate initial review identity already has an authoritative result');

    const subsetFixture = repository();
    const legacySubset = prepare(subsetFixture, manifest(), undefined, {
      scopeSummary: ['deploy.test.ts', 'deploy.ts'],
    });
    const subsetArtifact = initialArtifact(manifest(), [{
      id: 'S-002', file: 'deploy.ts', severity: 'high', summary: 'unsafe subset',
      blocking: true, behaviorCellIds: ['deployment-safe'],
    }]);
    subsetArtifact.binding.changedFiles = ['deploy.test.ts', 'deploy.ts'];
    const subsetArtifactFile = join(subsetFixture.state, 'subset-initial.json');
    writeFileSync(subsetArtifactFile, `${JSON.stringify(subsetArtifact)}\n`);
    finalizeInitialReviewLineage({
      handle: legacySubset, key, repository: 'repo', baseDigest: 'a'.repeat(64),
      scopeDigest: 'b'.repeat(64), artifact: subsetArtifact,
      artifactFile: subsetArtifactFile, findings: subsetArtifact.findings,
      deterministicComplete: true, runtimeIncomplete: false,
    });
    releaseReviewLineage(legacySubset);
    rewriteAsLegacyLineage(legacySubset.file);
    expect(() => prepare(subsetFixture, manifest(), undefined, {
      scopeDigest: reviewLineageScopeDigest('b'.repeat(64), { changedFiles: ['deploy.ts'] }),
      legacyScopeDigest: 'b'.repeat(64), scopeSummary: ['deploy.ts'],
      candidateDigest: 'f'.repeat(64),
    })).toThrow(/prior findings\/blockers open \(S-002\)/);
  });

  test('retains but does not attach an unverifiable legacy blocker to an unrelated scope', () => {
    const fixture = repository();
    const legacy = prepare(fixture, manifest());
    const artifact = initialArtifact(manifest(), [{
      id: 'S-001', file: 'deploy.ts', severity: 'high', summary: 'unsafe',
      blocking: true, behaviorCellIds: ['deployment-safe'],
    }]);
    const artifactFile = join(fixture.state, 'legacy-initial.json');
    const artifactText = `${JSON.stringify(artifact)}\n`;
    writeFileSync(artifactFile, artifactText);
    finalizeInitialReviewLineage({
      handle: legacy, key, repository: 'repo', baseDigest: 'a'.repeat(64),
      scopeDigest: 'b'.repeat(64), artifact, artifactFile, findings: artifact.findings,
      deterministicComplete: true, runtimeIncomplete: false,
    });
    releaseReviewLineage(legacy);
    rewriteAsLegacyLineage(legacy.file);
    const signedLegacy = readFileSync(legacy.file, 'utf8');
    const unrelatedScope = reviewLineageScopeDigest('b'.repeat(64), { changedFiles: ['docs.ts'] });
    const mutations = [
      () => rmSync(artifactFile, { force: true }),
      () => {
        rmSync(artifactFile, { force: true });
        symlinkSync(join(fixture.repo, 'README.md'), artifactFile);
      },
      () => {
        rmSync(artifactFile, { force: true });
        writeFileSync(artifactFile, '{not-json\n');
      },
      () => writeFileSync(artifactFile, `${JSON.stringify({ ...artifact, runId: 'replaced' })}\n`),
    ];
    for (const mutate of mutations) {
      rmSync(artifactFile, { force: true });
      writeFileSync(artifactFile, artifactText);
      mutate();
      const unrelated = prepare(fixture, manifest(), undefined, {
        scopeDigest: unrelatedScope,
        legacyScopeDigest: 'b'.repeat(64),
        scopeSummary: ['docs.ts'],
        candidateDigest: 'f'.repeat(64),
      });
      expect(unrelated.predecessor).toBeUndefined();
      releaseReviewLineage(unrelated);
      expect(readFileSync(legacy.file, 'utf8')).toBe(signedLegacy);
    }

    rmSync(artifactFile, { force: true });
    expect(() => prepare(fixture, manifest(), undefined, {
      scopeDigest: reviewLineageScopeDigest('b'.repeat(64), { changedFiles: ['deploy.ts'] }),
      legacyScopeDigest: 'b'.repeat(64),
      scopeSummary: ['deploy.ts'],
      candidateDigest: 'e'.repeat(64),
    })).toThrow(/prior findings\/blockers open \(S-001\).*created: <unavailable>; lineage updated: .*closure recovery: restore an authoritative artifact matching digest [a-f0-9]{64}, then use --closure-artifact <restored-path>/);
  });

  test('requires the authoritative artifact and closes blockers only through scoped closure', () => {
    const fixture = repository();
    const first = prepare(fixture, manifest());
    const artifact = initialArtifact(manifest(), [{
      id: 'S-001', file: 'deploy.ts', severity: 'high', summary: 'unsafe',
      blocking: true, behaviorCellIds: ['deployment-safe'],
    }]);
    expect(() => prepare(fixture, manifest(), artifact)).toThrow('authoritative signed lineage');
    const artifactFile = join(fixture.state, 'initial.json');
    finalizeInitialReviewLineage({
      handle: first, key, repository: 'repo', baseDigest: 'a'.repeat(64), scopeDigest: 'b'.repeat(64),
      artifact, artifactFile, findings: artifact.findings,
      deterministicComplete: true, runtimeIncomplete: false,
    });
    releaseReviewLineage(first);

    expect(() => prepare(fixture, manifest(), { ...artifact, runId: 'forged' })).toThrow(
      'authoritative signed lineage',
    );
    const failedAttempt = prepare(fixture, manifest(), artifact);
    expect(() => prepare(fixture, manifest(), artifact)).toThrow('already owned');
    releaseReviewLineage(failedAttempt);
    expect(() => prepare(fixture, manifest())).toThrow('prior findings/blockers open');
    const incompleteAttempt = prepare(fixture, manifest(), artifact);
    const incomplete = finalizeClosureReviewLineage({
      artifact,
      handle: incompleteAttempt, key,
      results: [{ findingId: 'S-001', status: 'evidence-incomplete', summary: 'host failed', evidenceIds: [] }],
      deterministicComplete: false, runtimeIncomplete: true,
    });
    expect(incomplete.completionAuthorized).toBe(false);
    releaseReviewLineage(incompleteAttempt);
    const closure = prepare(fixture, manifest(), artifact);
    const verdict = finalizeClosureReviewLineage({
      artifact,
      handle: closure,
      key,
      results: [{ findingId: 'S-001', status: 'closed', summary: 'fixed', evidenceIds: ['gate:check'] }],
      deterministicComplete: true,
      runtimeIncomplete: false,
    });
    expect(verdict).toMatchObject({
      priorBlockersOpen: false,
      closureComplete: true,
      completionAuthorized: true,
    });
    releaseReviewLineage(closure);
    expect(() => prepare(fixture, manifest(), artifact)).toThrow('authoritative signed lineage');
  });

  test('closure rejects duplicate signed owners instead of choosing a scope copy', () => {
    const fixture = repository();
    const artifact = initialArtifact(manifest(), [{
      id: 'S-001', file: 'deploy.ts', severity: 'high', summary: 'unsafe',
      blocking: true, behaviorCellIds: ['deployment-safe'],
    }]);
    for (const scopeDigest of ['b'.repeat(64), '8'.repeat(64)]) {
      const owner = prepare(fixture, manifest(), undefined, { scopeDigest });
      finalizeInitialReviewLineage({
        handle: owner, key, repository: 'repo', baseDigest: 'a'.repeat(64), scopeDigest,
        artifact, artifactFile: join(fixture.state, `${scopeDigest}.json`), findings: artifact.findings,
        deterministicComplete: true, runtimeIncomplete: false,
      });
      releaseReviewLineage(owner);
    }
    expect(() => prepare(fixture, manifest(), artifact)).toThrow('missing or ambiguous owner');
  });

  test('partial closure preserves remaining findings and can finish through the same authority', () => {
    const fixture = repository();
    const artifact = initialArtifact(manifest(), ['S-001', 'S-002'].map((id) => ({
      id, file: 'deploy.ts', severity: 'high' as const, summary: 'unsafe',
      blocking: true, behaviorCellIds: ['deployment-safe'],
    })));
    const first = prepare(fixture, manifest());
    finalizeInitialReviewLineage({
      handle: first, key, repository: 'repo', baseDigest: 'a'.repeat(64), scopeDigest: 'b'.repeat(64),
      artifact, artifactFile: join(fixture.state, 'initial.json'), findings: artifact.findings,
      deterministicComplete: true, runtimeIncomplete: false,
    });
    releaseReviewLineage(first);
    const partial = prepare(fixture, manifest(), artifact);
    finalizeClosureReviewLineage({
      artifact,
      handle: partial, key, deterministicComplete: true, runtimeIncomplete: false,
      results: [
        { findingId: 'S-001', status: 'closed', summary: 'fixed', evidenceIds: ['gate:check'] },
        { findingId: 'S-002', status: 'still-open', summary: 'needs repair', evidenceIds: [] },
      ],
    });
    releaseReviewLineage(partial);
    const retry = prepare(fixture, manifest(), artifact);
    expect(retry.predecessor!.unresolvedFindings.map((finding) => finding.findingId)).toEqual(['S-002']);
    expect(finalizeClosureReviewLineage({
      artifact, handle: retry, key, deterministicComplete: true, runtimeIncomplete: false,
      results: [
        { findingId: 'S-001', status: 'direct-regression', summary: 'repair reopened A', evidenceIds: [] },
        { findingId: 'S-002', status: 'closed', summary: 'fixed', evidenceIds: ['gate:check'] },
      ],
    }).completionAuthorized).toBe(false);
    releaseReviewLineage(retry);
    expect(readReviewLineageForTest(retry.file, key)!.unresolvedFindings.map((finding) => finding.findingId)).toEqual(['S-001']);
    expect(() => prepare(fixture, manifest())).toThrow('prior findings/blockers open');
    const finalAttempt = prepare(fixture, manifest(), artifact);
    expect(finalizeClosureReviewLineage({
      artifact,
      handle: finalAttempt, key, deterministicComplete: true, runtimeIncomplete: false,
      results: artifact.findings.map((finding) => ({
        findingId: finding.id!, status: 'closed', summary: 'fixed', evidenceIds: ['gate:check'],
      })),
    }).completionAuthorized).toBe(true);
    releaseReviewLineage(finalAttempt);
    expect(() => prepare(fixture, manifest(), artifact)).toThrow('authoritative signed lineage');
  });

  test('rejects concurrent owners, recovers a dead owner, and detects tampering', () => {
    const fixture = repository();
    const first = prepare(fixture, manifest());
    expect(() => prepare(fixture, manifest())).toThrow('already owned');
    const stale = new Date(Date.now() - 11 * 60 * 1000);
    utimesSync(first.lockFile, stale, stale);
    expect(() => prepare(fixture, manifest())).toThrow('already owned');
    releaseReviewLineage(first);
    writeFileSync(first.lockFile, `${JSON.stringify({ pid: 999_999_999 })}\n`, { mode: 0o600 });
    writeFileSync(`${first.lockFile}.recovery`, `${JSON.stringify({ pid: process.pid })}\n`, { mode: 0o600 });
    expect(() => prepare(fixture, manifest())).toThrow('recovery is already owned');
    writeFileSync(
      `${first.lockFile}.recovery`,
      `${JSON.stringify({ pid: 999_999_999, runId: 'crashed-recovery' })}\n`,
    );
    const recovered = prepare(fixture, manifest());
    releaseReviewLineage(first);
    expect(() => prepare(fixture, manifest())).toThrow('already owned');
    releaseReviewLineage(recovered);
    const artifact = initialArtifact(manifest(), []);
    finalizeInitialReviewLineage({
      handle: recovered, key, repository: 'repo', baseDigest: 'a'.repeat(64), scopeDigest: 'b'.repeat(64),
      artifact, artifactFile: join(fixture.state, 'clean.json'), findings: [],
      deterministicComplete: true, runtimeIncomplete: false,
    });
    const signed = JSON.parse(readFileSync(recovered.file, 'utf8'));
    signed.verdict.completionAuthorized = false;
    writeFileSync(recovered.file, `${JSON.stringify(signed)}\n`, { mode: 0o600 });
    expect(() => readReviewLineageForTest(recovered.file, key)).toThrow('tampered');
  });

  test('enforces base-owned minimum evidence and records a typed base-owned waiver', () => {
    const policy = {
      schemaVersion: 1,
      policyId: 'project-review-v1',
      minimumEvidenceLevels: [{
        id: 'deployment-live',
        cellIds: ['deployment-safe'],
        minimumLevel: 'live-provider',
        reason: 'deployment requires live provider evidence',
      }],
      waivers: [{
        id: 'approved-risk-change',
        cellId: 'deployment-safe',
        allowedChanges: ['risk'],
        reason: 'owner reclassified this scoped contract',
        approvedBy: 'project-owner',
        approvedAt: '2026-08-01T00:00:00.000Z',
        expiresAt: '2027-08-01T00:00:00.000Z',
      }],
    };
    const fixture = repository(policy);
    const insufficient = manifest();
    insufficient.providers[0]!.operations[0]!.evidenceLevel = 'local';
    expect(() => prepare(fixture, insufficient)).toThrow('requires live-provider');

    const original = manifest();
    original.providers[0]!.operations[0]!.evidenceLevel = 'live-provider';
    original.providers[0]!.operations[0]!.network = 'authorized';
    original.providers[0]!.operations[0]!.authorizationId = 'live-auth';
    original.authorizations.push({
      id: 'live-auth', operation: 'gate:check', scope: 'fixture', approvedBy: 'owner',
      approvedAt: '2026-08-01T00:00:00.000Z', expiresAt: '2027-08-01T00:00:00.000Z',
    });
    const first = prepare(fixture, original);
    const artifact = initialArtifact(original, []);
    finalizeInitialReviewLineage({
      handle: first, key, repository: 'repo', baseDigest: 'a'.repeat(64), scopeDigest: 'b'.repeat(64),
      artifact, artifactFile: join(fixture.state, 'clean.json'), findings: [],
      deterministicComplete: true, runtimeIncomplete: false,
    });
    releaseReviewLineage(first);
    const reclassified = structuredClone(original);
    reclassified.behaviorMatrix[0]!.risk = 'medium';
    const next = prepare(fixture, reclassified);
    expect(next.appliedWaiverIds).toEqual(['approved-risk-change']);
    const waivedArtifact = initialArtifact(reclassified, []);
    finalizeInitialReviewLineage({
      handle: next, key, repository: 'repo', baseDigest: 'a'.repeat(64), scopeDigest: 'b'.repeat(64),
      artifact: waivedArtifact, artifactFile: join(fixture.state, 'waived.json'), findings: [],
      deterministicComplete: true, runtimeIncomplete: false,
    });
    expect(readReviewLineageForTest(next.file, key)?.appliedWaiverIds)
      .toEqual(['approved-risk-change']);
    releaseReviewLineage(next);
  });
});

function repository(policy?: object) {
  const root = mkdtempSync(join(tmpdir(), 'review-lineage-'));
  roots.push(root);
  const repo = join(root, 'repo');
  const state = join(root, 'state');
  mkdirSync(repo);
  mkdirSync(state);
  git(repo, ['init', '-q']);
  git(repo, ['config', 'user.email', 'test@example.com']);
  git(repo, ['config', 'user.name', 'Test']);
  writeFileSync(join(repo, 'README.md'), 'fixture\n');
  if (policy) writeFileSync(join(repo, 'goldband.review-policy.json'), `${JSON.stringify(policy)}\n`);
  git(repo, ['add', '.']);
  git(repo, ['commit', '-qm', 'fixture']);
  return { repo, state };
}

function prepare(
  fixture: ReturnType<typeof repository>,
  evidenceManifest: ReviewEvidenceManifest,
  closureArtifact?: InitialReviewArtifact,
  overrides: {
    scopeDigest?: string;
    acceptanceDigest?: string;
    legacyScopeDigest?: string;
    scopeSummary?: string[];
    candidateDigest?: string;
    contractResolution?: ReviewContractResolution;
    baselineManifest?: ReviewEvidenceManifest;
  } = {},
) {
  return prepareReviewLineage({
    cwd: fixture.repo,
    storeRoot: fixture.state,
    key,
    repository: 'repo',
    baseRef: 'HEAD',
    baseDigest: 'a'.repeat(64),
    scopeDigest: overrides.scopeDigest ?? 'b'.repeat(64),
    legacyScopeDigest: overrides.legacyScopeDigest,
    scopeSummary: overrides.scopeSummary ?? ['deploy.ts'],
    acceptanceDigest: overrides.acceptanceDigest ?? 'c'.repeat(64),
    policyIdentityDigest: 'd'.repeat(64),
    candidateDigest: overrides.candidateDigest ?? 'e'.repeat(64),
    behaviorContractDigest: createHash('sha256').update(JSON.stringify(evidenceManifest)).digest('hex'),
    manifest: evidenceManifest,
    baselineManifest: overrides.baselineManifest,
    contractResolution: overrides.contractResolution ?? {
      schemaVersion: 1,
      repositoryIdentity: {
        kind: 'git-common-directory',
        commonDirectory: join(fixture.repo, '.git'),
        commonDirectoryInstanceDigest: 'f'.repeat(64),
        remoteIdentityDigest: '0'.repeat(64),
      },
      workspace: {
        repositoryRoot: fixture.repo,
        invocationDirectory: fixture.repo,
        invocationOffset: '',
      },
      compatibilityIdentity: 'review-evidence-schema-v2/runtime-contract-v2',
      baseline: {
        kind: 'repository',
        identity: join(fixture.repo, 'goldband.review-evidence.json'),
        digest: createHash('sha256').update(JSON.stringify(evidenceManifest)).digest('hex'),
      },
      candidateProvenance: {
        identity: join(fixture.repo, 'goldband.review-evidence.json'),
        trackingState: 'unchanged',
      },
      effectiveDigest: createHash('sha256').update(JSON.stringify(evidenceManifest)).digest('hex'),
    },
    closureArtifact,
    runId: crypto.randomUUID(),
  });
}

function manifest(): ReviewEvidenceManifest {
  return {
    schemaVersion: 2,
    behaviorMatrix: [{
      id: 'deployment-safe',
      behavior: 'deployment rejects an unsafe dependency graph',
      kind: 'boundary',
      input: 'candidate graph',
      preconditions: 'deployment gate is active',
      expected: 'unsafe graph is rejected',
      risk: 'high',
      disposition: 'runtime-readback',
      providerIds: ['gate'],
    }],
    providers: [{
      id: 'gate',
      owner: 'project',
      kind: 'runtime-integration',
      lifecycle: 'persistent',
      cellIds: ['deployment-safe'],
      applicability: { kind: 'global', reason: 'Explicit single-provider lineage fixture.' },
      executionContext: { sandboxOwner: 'review-runtime', runner: 'sealed' },
      operations: [operation('check', 'sandboxed-service')],
    }],
    authorizations: [],
  };
}

function dispositionManifest(expected: string): ReviewEvidenceManifest {
  return {
    schemaVersion: 2,
    behaviorMatrix: [{
      id: 'deployment-safe',
      behavior: 'deployment rejects an unsafe dependency graph',
      kind: 'boundary',
      input: 'candidate graph',
      preconditions: 'deployment gate is active',
      expected,
      risk: 'high',
      disposition: 'not-applicable',
      providerIds: [],
      reason: 'semantic-only workflow fixture',
    }],
    providers: [],
    authorizations: [],
  };
}

function operation(id: string, evidenceLevel: 'fixture' | 'local' | 'sandboxed-service' | 'live-provider') {
  return {
    id,
    target: 'candidate' as const,
    argv: ['node', '--version'],
    expectedExit: 'zero' as const,
    timeoutMs: 1000,
    maxOutputBytes: 1024,
    network: 'deny' as const,
    evidenceLevel,
    requiredSystemTools: [],
  };
}

function initialArtifact(
  evidenceManifest: ReviewEvidenceManifest,
  findings: InitialReviewArtifact['findings'],
): InitialReviewArtifact {
  const behaviorContractDigest = createHash('sha256')
    .update(JSON.stringify(evidenceManifest))
    .digest('hex');
  return {
    schemaVersion: 1,
    phase: 'initial',
    runId: 'initial-run',
    binding: {
      repository: 'repo', baseRef: 'HEAD', baseDigest: 'a'.repeat(64),
      candidateDigest: 'e'.repeat(64), scopeDigest: 'b'.repeat(64),
      behaviorContractDigest, changedFiles: ['deploy.ts'], redactedUntrackedFiles: [],
    },
    diff: 'diff',
    evidence: {
      schemaVersion: 1,
      manifest: evidenceManifest,
      binding: {} as InitialReviewArtifact['binding'],
      records: [],
      completeness: { complete: true, hostEligible: true, blockingCellIds: [], coverageGapCellIds: [], runtimeIncompleteCellIds: [] },
      manifestSource: 'fixture',
    },
    findings,
    hostCallCount: 1,
    createdAt: '2026-08-27T00:00:00.000Z',
    runtimeReceipt: {
      schemaVersion: 1, id: 'receipt-1', digest: '1'.repeat(64), signature: '2'.repeat(64), reviewScope: { kind: 'standalone' },
    },
  };
}

function git(cwd: string, args: string[]): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}

function rewriteAsLegacyLineage(file: string): void {
  const signed = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  delete signed.signature;
  delete signed.scopeSummary;
  const authoritative = signed.authoritativeArtifact as Record<string, unknown> | undefined;
  if (authoritative) delete authoritative.createdAt;
  const signature = createHmac('sha256', key)
    .update(`goldband-review-lineage-v1\0${stableJsonForTest(signed)}`)
    .digest('hex');
  writeFileSync(file, `${JSON.stringify({ ...signed, signature }, null, 2)}\n`, { mode: 0o600 });
}

function stableJsonForTest(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJsonForTest).join(',')}]`;
  if (value && typeof value === 'object') {
    const item = value as Record<string, unknown>;
    return `{${Object.keys(item).sort().map((name) =>
      `${JSON.stringify(name)}:${stableJsonForTest(item[name])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
