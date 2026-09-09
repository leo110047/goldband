import { afterEach, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { resolveReviewContract } from '../workflows/review-contract-resolution';
import type { WorkflowContext } from '../workflows/types';
import { getWorkflow } from '../workflows/registry';
import { runWorkflow } from '../workflows/runtime';
import {
  importReviewContract,
  inspectReviewContractStore,
  removeReviewContract,
} from '../workflows/review-contract-store';
import type { ReviewEvidenceManifest } from '../workflows/review-evidence';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('review contract resolution and runtime store', () => {
  test('root and tracked subdirectory share authority while preserving invocation offset', () => {
    const root = temporaryRoot();
    const repo = gitRepository(root, 'repo');
    const state = join(root, 'state');
    const nested = join(repo, 'packages', 'app');
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(nested, 'marker.txt'), 'tracked\n');
    writeJson(join(repo, 'goldband.review-evidence.json'), noOpManifest());
    git(repo, ['add', 'goldband.review-evidence.json', 'packages/app/marker.txt']);
    git(repo, ['commit', '-m', 'add repository contract and nested project']);

    const rootInspection = goldband(repo, state, ['review', 'contract', 'inspect']);
    const nestedInspection = goldband(nested, state, ['review', 'contract', 'inspect']);

    expect(nestedInspection.repositoryIdentity).toEqual(rootInspection.repositoryIdentity);
    expect(nestedInspection.baseline).toEqual(rootInspection.baseline);
    expect(nestedInspection.effectiveDigest).toBe(rootInspection.effectiveDigest);
    expect(rootInspection.invocationOffset).toBe('');
    expect(nestedInspection.invocationOffset).toBe('packages/app');
  });

  test.each([
    ['default', {}],
    ['worktree', { worktree: true }],
    ['staged', { staged: true }],
    ['base', { base: 'BASE_REF' }],
  ] as const)('subdirectory %s scope materializes repo-root paths', async (_name, scope) => {
    const root = temporaryRoot();
    const repo = gitRepository(root, 'repo');
    const state = join(root, 'state');
    const nested = join(repo, 'packages', 'app');
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(nested, 'marker.txt'), 'tracked\n');
    writeJson(join(repo, 'goldband.review-evidence.json'), subdirectoryProviderManifest());
    git(repo, ['add', 'goldband.review-evidence.json', 'packages/app/marker.txt']);
    git(repo, ['commit', '-m', 'add review fixture']);
    const baseRef = git(repo, ['rev-parse', 'HEAD']).trim();
    writeFileSync(join(repo, 'a.ts'), 'changed();\n');
    if ('staged' in scope) git(repo, ['add', 'a.ts']);
    if ('base' in scope) {
      git(repo, ['add', 'a.ts']);
      git(repo, ['commit', '-m', 'commit candidate']);
    }

    const result = await runWorkflow(getWorkflow('review/code'), {
      mode: 'mock', host: 'mock', cwd: nested, goldbandHome: state,
      ...('base' in scope ? { base: baseRef } : scope),
    });
    const artifactFile = result.artifacts.find((file) => file.endsWith('-review-evidence.json'))!;
    const artifact = JSON.parse(readFileSync(artifactFile, 'utf8'));
    expect(artifact.binding.changedFiles).toContain('a.ts');
    expect(artifact.evidence.contractResolution.workspace).toMatchObject({
      repositoryRoot: realpathSync(repo),
      invocationOffset: 'packages/app',
    });
    const provenance = artifact.evidence.contractResolution.candidateProvenance;
    if (_name === 'staged') {
      expect(provenance.identity).toContain('@index:goldband.review-evidence.json');
      expect(provenance.trackingState).toBe('unchanged');
    } else if (_name === 'base') {
      expect(provenance.identity).toContain('@HEAD:goldband.review-evidence.json');
      expect(provenance.trackingState).toBe('head');
    } else {
      expect(provenance.identity).toBe(join(realpathSync(repo), 'goldband.review-evidence.json'));
      expect(provenance.trackingState).toBe('unchanged');
    }
    const record = artifact.evidence.records[0];
    expect(['verified-pass', 'runtime-incomplete']).toContain(record.status);
    if (record.status === 'runtime-incomplete') {
      expect(record.outputSummary).toContain('sandbox-exec: sandbox_apply: Operation not permitted');
    }
  });

  test.each([
    ['worktree', {}],
    ['staged', { staged: true }],
    ['base', { base: 'BASE_REF' }],
  ] as const)('a %s candidate cannot delete the authoritative manifest', async (_name, scope) => {
    const root = temporaryRoot();
    const repo = gitRepository(root, 'repo');
    const state = join(root, 'state');
    writeJson(join(repo, 'goldband.review-evidence.json'), noOpManifest());
    git(repo, ['add', 'goldband.review-evidence.json']);
    git(repo, ['commit', '-m', 'add authoritative contract']);
    const baseRef = git(repo, ['rev-parse', 'HEAD']).trim();
    rmSync(join(repo, 'goldband.review-evidence.json'));
    if (_name !== 'worktree') git(repo, ['add', '-u', 'goldband.review-evidence.json']);
    if (_name === 'base') git(repo, ['commit', '-m', 'delete contract candidate']);

    await expect(runWorkflow(getWorkflow('review/code'), {
      mode: 'mock', host: 'mock', cwd: repo, goldbandHome: state,
      ...(_name === 'base' ? { base: baseRef } : scope),
    })).rejects.toThrow('review contract laundering blocked: candidate');
  });

  test('subdirectory fresh-check keeps repo-root redacted untracked coordinates', async () => {
    const root = temporaryRoot();
    const repo = gitRepository(root, 'repo');
    const state = join(root, 'state');
    const nested = join(repo, 'packages', 'app');
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(nested, 'marker.txt'), 'tracked\n');
    writeJson(join(repo, 'goldband.review-evidence.json'), noOpManifest());
    git(repo, ['add', 'goldband.review-evidence.json', 'packages/app/marker.txt']);
    git(repo, ['commit', '-m', 'add nested review fixture']);
    const secret = ['ghp', '1234567890abcdefghijklmnopqrstuv'].join('_');
    writeFileSync(join(repo, 'secret-check.mjs'), `export const fixture=${JSON.stringify(secret)};\n`);

    const result = await runWorkflow(getWorkflow('review/code'), {
      mode: 'mock',
      host: 'mock',
      cwd: nested,
      goldbandHome: state,
      worktree: true,
      includeUntracked: true,
    });

    const artifactFile = result.artifacts.find((file) => file.endsWith('-review-evidence.json'))!;
    const artifact = JSON.parse(readFileSync(artifactFile, 'utf8'));
    expect(artifact.binding.changedFiles).toContain('secret-check.mjs');
    expect(artifact.diff).not.toContain(secret);
  });

  test('an untracked weaker candidate cannot downgrade an imported baseline', async () => {
    const root = temporaryRoot();
    const repo = gitRepository(root, 'repo');
    const state = join(root, 'state');
    const central = join(root, 'central.json');
    writeJson(central, providerManifest());
    importReviewContract(repo, state, central);
    writeJson(join(repo, 'goldband.review-evidence.json'), noOpManifest());
    writeCandidateDiff(repo);

    await expect(runWorkflow(getWorkflow('review/code'), {
      mode: 'mock', host: 'mock', cwd: repo, goldbandHome: state, diffFile: 'candidate.diff',
    })).rejects.toThrow('review contract laundering blocked: required behavior cell was removed');
  });

  test('legacy schema rejection names versions, source, and remediation', () => {
    const root = temporaryRoot();
    const repo = gitRepository(root, 'repo');
    const state = join(root, 'state');
    const legacy = { ...noOpManifest(), schemaVersion: 1 };
    writeJson(join(repo, 'goldband.review-evidence.json'), legacy);
    git(repo, ['add', 'goldband.review-evidence.json']);
    git(repo, ['commit', '-m', 'legacy contract']);

    const result = spawnSync(process.execPath, [
      join(import.meta.dir, '..', 'workflows', 'review-contract-cli.ts'), 'inspect', '--goldband-home', state,
    ], { cwd: repo, encoding: 'utf8' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('observed 1, supported 2');
    expect(result.stderr).toContain('migrate the source manifest explicitly');
  });

  test('an explicit v2 candidate exposes the one-version migration boundary', () => {
    const root = temporaryRoot();
    const repo = gitRepository(root, 'repo');
    const state = join(root, 'state');
    writeJson(join(repo, 'goldband.review-evidence.json'), { ...noOpManifest(), schemaVersion: 1 });
    git(repo, ['add', 'goldband.review-evidence.json']);
    git(repo, ['commit', '-m', 'legacy contract']);
    writeJson(join(repo, 'goldband.review-evidence.json'), noOpManifest());

    const inspection = goldband(repo, state, ['review', 'contract', 'inspect']);
    expect(inspection.schemaMigration).toMatchObject({ observedVersion: 1, supportedVersion: 2 });
    expect(inspection.candidate).toMatchObject({ trackingState: 'modified' });
    expect(inspection.candidateCompatibility).toEqual({ valid: true, requiresSemanticReview: false });
  });

  test('repository baseline rejects a weaker explicit manifest before evidence execution', async () => {
    const root = temporaryRoot();
    const repo = gitRepository(root, 'repo');
    const state = join(root, 'state');
    writeJson(join(repo, 'goldband.review-evidence.json'), providerManifest());
    writeJson(join(repo, 'weak.json'), noOpManifest());
    writeCandidateDiff(repo);

    await expect(runWorkflow(getWorkflow('review/code'), {
      mode: 'mock',
      host: 'mock',
      cwd: repo,
      goldbandHome: state,
      diffFile: 'candidate.diff',
      evidenceManifestFile: 'weak.json',
    })).rejects.toThrow('review contract laundering blocked: required behavior cell was removed');
  });

  test('runtime-store baseline runs without changing repository status and persists provenance', async () => {
    const root = temporaryRoot();
    const repo = gitRepository(root, 'repo');
    const state = join(root, 'state');
    const manifestFile = join(root, 'central.json');
    writeJson(manifestFile, noOpManifest());
    const imported = importReviewContract(repo, state, manifestFile);
    writeCandidateDiff(repo);
    const before = git(repo, ['status', '--porcelain=v1', '--untracked-files=all']);

    const result = await runWorkflow(getWorkflow('review/code'), {
      mode: 'mock',
      host: 'mock',
      cwd: repo,
      goldbandHome: state,
      diffFile: 'candidate.diff',
    });

    expect(git(repo, ['status', '--porcelain=v1', '--untracked-files=all'])).toBe(before);
    const artifactFile = result.artifacts.find((file) => file.endsWith('-review-evidence.json'))!;
    const artifact = JSON.parse(readFileSync(artifactFile, 'utf8'));
    expect(artifact.evidence.contractResolution).toMatchObject({
      compatibilityIdentity: 'review-evidence-schema-v2/runtime-contract-v2',
      baseline: {
        kind: 'runtime-store',
        identity: imported.entryFile,
        importedFrom: realpathSync(manifestFile),
      },
    });
    expect(Date.parse(artifact.evidence.contractResolution.baseline.importedAt)).not.toBeNaN();
    expect(artifact.evidence.contractResolution.effectiveDigest).toBe(
      artifact.binding.behaviorContractDigest,
    );
  });

  test('sandbox evidence fallback still discovers the durable project contract without a manifest argument', async () => {
    const root = temporaryRoot();
    const repo = gitRepository(root, 'repo');
    const durable = join(root, 'durable');
    const temporary = join(root, 'temporary');
    const manifestFile = join(root, 'central.json');
    writeJson(manifestFile, noOpManifest());
    const imported = importReviewContract(repo, durable, manifestFile);
    writeCandidateDiff(repo);
    const key = 'GOLDBAND_REVIEW_CONTRACT_ROOT';
    const previous = process.env[key];
    process.env[key] = durable;
    try {
      const result = await runWorkflow(getWorkflow('review/code'), {
        mode: 'mock', host: 'mock', cwd: repo, goldbandHome: temporary,
        diffFile: 'candidate.diff',
      });
      const artifactFile = result.artifacts.find((file) => file.endsWith('-review-evidence.json'))!;
      const artifact = JSON.parse(readFileSync(artifactFile, 'utf8'));
      expect(artifact.evidence.contractResolution.baseline).toMatchObject({
        kind: 'runtime-store', identity: imported.entryFile,
      });
      expect(artifactFile.startsWith(temporary)).toBe(true);
    } finally {
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    }
  });

  test('registry relocation preserves hard boundaries and presents changed semantics for review', async () => {
    const root = temporaryRoot();
    const repo = gitRepository(root, 'repo');
    const state = join(root, 'state');
    const file = join(repo, 'goldband.review-evidence.json');
    writeJson(file, noOpManifest());
    git(repo, ['add', 'goldband.review-evidence.json']);
    git(repo, ['commit', '-m', 'baseline contract']);
    importReviewContract(repo, state, file);
    rmSync(file);
    const result = await runWorkflow(getWorkflow('review/code'), {
      mode: 'mock', host: 'mock', cwd: repo, goldbandHome: state, worktree: true,
    });
    expect(result.artifacts.some((file) => file.endsWith('-review-evidence.json'))).toBe(true);
    const altered = noOpManifest();
    altered.behaviorMatrix[0]!.expected = 'A different contract';
    const changedFile = join(root, 'changed.json');
    writeJson(changedFile, altered);
    importReviewContract(repo, state, changedFile);
    const resolved = resolveReviewContract({ cwd: repo, options: { mode: 'real', worktree: true, goldbandHome: state } } as WorkflowContext,
      { source: 'git diff', diff: git(repo, ['diff']), changedFiles: ['goldband.review-evidence.json'] });
    expect(resolved.monotonicExtensions[0]!.baseline.behaviorMatrix[0]!.expected).toBe(noOpManifest().behaviorMatrix[0]!.expected);
    expect(resolved.manifest.behaviorMatrix[0]!.expected).toBe('A different contract');
    altered.behaviorMatrix[0]!.id = 'replacement-cell';
    writeJson(changedFile, altered);
    importReviewContract(repo, state, changedFile);
    await expect(runWorkflow(getWorkflow('review/code'), {
      mode: 'mock', host: 'mock', cwd: repo, goldbandHome: state, worktree: true,
    })).rejects.toThrow('removes the authoritative repository manifest');
  });

  test('registered pre-push migration resolves without changing or committing the candidate', () => {
    const root = temporaryRoot();
    const repo = gitRepository(root, 'repo');
    const state = join(root, 'state');
    const baseline = JSON.parse(readFileSync(join(import.meta.dir, 'fixtures/review-contracts/goldband.json'), 'utf8'));
    writeJson(join(repo, 'goldband.review-evidence.json'), baseline);
    git(repo, ['add', 'goldband.review-evidence.json']);
    git(repo, ['commit', '-m', 'legacy CI contract']);
    for (const provider of baseline.providers) if (provider.executionContext.runner === 'github-actions') {
      provider.executionContext = { sandboxOwner: 'provider', runner: 'local-host', lane: 'goldband-local-review-host' };
      provider.operations[0].network = 'host';
      provider.operations[0].timeoutMs = 600000;
    }
    const external = join(root, 'local.json'); writeJson(external, baseline);
    const registered = importReviewContract(repo, state, external);
    rmSync(join(repo, 'goldband.review-evidence.json'));
    const before = git(repo, ['status', '--porcelain']);
    const inspected = goldband(repo, state, ['review', 'contract', 'inspect']);
    expect(inspected.baseline.kind).toBe('runtime-store');
    expect(inspected.runtimeStore.shadowed).toBe(false);
    const resolved = resolveReviewContract({ cwd: repo, options: { mode: 'real', worktree: true, goldbandHome: state } } as WorkflowContext,
      { source: 'git diff', diff: git(repo, ['diff']), changedFiles: ['goldband.review-evidence.json'] });
    expect(resolved.resolution.baseline.kind).toBe('runtime-store');
    expect(resolved.resolution.effectiveDigest).toBe(registered.entry!.manifestDigest);
    expect(resolved.manifest.providers.filter((provider) => provider.executionContext.runner === 'local-host')).toHaveLength(3);
    expect(git(repo, ['status', '--porcelain'])).toBe(before);
  });

  test('additive explicit contract passes and records baseline, explicit, and effective digests', async () => {
    const root = temporaryRoot();
    const repo = gitRepository(root, 'repo');
    const state = join(root, 'state');
    const baseline = noOpManifest();
    const effective = structuredClone(baseline);
    effective.behaviorMatrix.push({
      id: 'additive-boundary',
      behavior: 'An additive boundary remains visible.',
      kind: 'boundary',
      input: 'An extended contract.',
      preconditions: 'The baseline remains intact.',
      expected: 'The added cell is evaluated.',
      risk: 'low',
      disposition: 'not-applicable',
      providerIds: [],
      reason: 'Additive resolution fixture.',
    });
    writeJson(join(repo, 'goldband.review-evidence.json'), baseline);
    git(repo, ['add', 'goldband.review-evidence.json']);
    git(repo, ['commit', '-m', 'add review contract']);
    writeJson(join(repo, 'effective.json'), effective);
    writeCandidateDiff(repo);

    const result = await runWorkflow(getWorkflow('review/code'), {
      mode: 'mock',
      host: 'mock',
      cwd: repo,
      goldbandHome: state,
      diffFile: 'candidate.diff',
      evidenceManifestFile: 'effective.json',
    });
    const artifactFile = result.artifacts.find((file) => file.endsWith('-review-evidence.json'))!;
    const artifact = JSON.parse(readFileSync(artifactFile, 'utf8'));
    expect(artifact.evidence.contractResolution).toMatchObject({
      baseline: { kind: 'repository' },
      explicit: { kind: 'explicit-extension' },
    });
    expect(artifact.evidence.contractResolution.baseline.digest).not.toBe(
      artifact.evidence.contractResolution.effectiveDigest,
    );
    expect(artifact.evidence.contractResolution.explicit.digest).toBe(
      artifact.evidence.contractResolution.effectiveDigest,
    );
  });

  test('repository manifest shadows an existing runtime-store entry with persisted provenance', async () => {
    const root = temporaryRoot();
    const repo = gitRepository(root, 'repo');
    const state = join(root, 'state');
    const central = join(root, 'central.json');
    writeJson(central, providerManifest());
    const imported = importReviewContract(repo, state, central);
    writeJson(join(repo, 'goldband.review-evidence.json'), noOpManifest());
    git(repo, ['add', 'goldband.review-evidence.json']);
    git(repo, ['commit', '-m', 'add repository contract']);
    writeCandidateDiff(repo);

    const inspection = inspectReviewContractStore(repo, state);
    expect(inspection.entry?.manifestDigest).toBeDefined();
    expect(inspection.entry?.manifestDigest).not.toBe(
      hashFromManifestFile(join(repo, 'goldband.review-evidence.json')),
    );
    const result = await runWorkflow(getWorkflow('review/code'), {
      mode: 'mock',
      host: 'mock',
      cwd: repo,
      goldbandHome: state,
      diffFile: 'candidate.diff',
    });
    const artifactFile = result.artifacts.find((file) => file.endsWith('-review-evidence.json'))!;
    const artifact = JSON.parse(readFileSync(artifactFile, 'utf8'));
    expect(artifact.evidence.contractResolution.shadowedRuntimeStore).toMatchObject({
      present: true,
      identity: imported.entryFile,
      digest: imported.entry?.manifestDigest,
      importedFrom: realpathSync(central),
    });
    expect(Date.parse(
      artifact.evidence.contractResolution.shadowedRuntimeStore.importedAt,
    )).not.toBeNaN();
  });

  test('worktrees share one entry while unrelated repositories do not', () => {
    const root = temporaryRoot();
    const repo = gitRepository(root, 'repo');
    const worktree = join(root, 'worktree');
    const unrelated = gitRepository(root, 'unrelated');
    const clone = join(root, 'clone');
    const state = join(root, 'state');
    const central = join(root, 'central.json');
    writeJson(central, noOpManifest());
    git(repo, ['worktree', 'add', '-b', 'test-worktree', worktree]);
    git(root, ['clone', repo, clone]);
    const imported = importReviewContract(repo, state, central);

    expect(inspectReviewContractStore(worktree, state).entryFile).toBe(imported.entryFile);
    expect(inspectReviewContractStore(worktree, state).entry?.manifestDigest).toBe(
      imported.entry?.manifestDigest,
    );
    expect(inspectReviewContractStore(unrelated, state).entry).toBeUndefined();
    expect(inspectReviewContractStore(clone, state).entry).toBeUndefined();
  });

  test('repository moves and remote identity changes require explicit re-import', () => {
    const root = temporaryRoot();
    const repo = gitRepository(root, 'repo');
    const moved = join(root, 'moved');
    const state = join(root, 'state');
    const central = join(root, 'central.json');
    writeJson(central, noOpManifest());
    importReviewContract(repo, state, central);

    git(repo, ['remote', 'add', 'origin', 'https://example.invalid/repository.git']);
    expect(inspectReviewContractStore(repo, state).invalidReason).toContain(
      'review contract store remote identity changed',
    );
    expect(importReviewContract(repo, state, central).entry).toBeDefined();
    git(repo, ['remote', 'remove', 'origin']);
    expect(inspectReviewContractStore(repo, state).invalidReason).toContain(
      'review contract store remote identity changed',
    );
    importReviewContract(repo, state, central);
    renameSync(repo, moved);
    expect(inspectReviewContractStore(moved, state).entry).toBeUndefined();
  });

  test('reusing a repository path cannot inherit the prior repository contract', () => {
    const root = temporaryRoot();
    const repo = gitRepository(root, 'repo');
    const moved = join(root, 'moved');
    const state = join(root, 'state');
    const central = join(root, 'central.json');
    writeJson(central, noOpManifest());
    const imported = importReviewContract(repo, state, central);

    renameSync(repo, moved);
    const replacement = gitRepository(root, 'repo');
    const replacementInspection = inspectReviewContractStore(replacement, state);

    expect(replacementInspection.entryFile).toBe(imported.entryFile);
    expect(replacementInspection.entry).toBeUndefined();
    expect(replacementInspection.invalidReason).toContain(
      'review contract store repository identity mismatch',
    );
    expect(importReviewContract(replacement, state, central).entry).toBeDefined();
  });

  test('import and remove are explicit, private, atomic store operations', () => {
    const root = temporaryRoot();
    const repo = gitRepository(root, 'repo');
    const state = join(root, 'state');
    const central = join(root, 'central.json');
    const symlink = join(root, 'central-link.json');
    writeJson(central, noOpManifest());
    symlinkSync(central, symlink);

    expect(() => importReviewContract(repo, state, symlink)).toThrow(
      'must be a regular file, not a symlink',
    );
    const unsafeState = join(root, 'unsafe-state');
    const unsafeTarget = join(root, 'unsafe-target');
    mkdirSync(unsafeState);
    mkdirSync(unsafeTarget);
    symlinkSync(unsafeTarget, join(unsafeState, 'review-contracts'));
    expect(() => importReviewContract(repo, unsafeState, central)).toThrow(
      'not a private regular directory',
    );
    const imported = importReviewContract(repo, state, central);
    expect(lstatSync(imported.entryFile).mode & 0o777).toBe(0o600);
    expect(removeReviewContract(repo, state).entry).toBeUndefined();
  });

  test('public CLI imports, inspects, and removes with before and after readback', () => {
    const root = temporaryRoot();
    const repo = gitRepository(root, 'repo');
    const state = join(root, 'state');
    const central = join(root, 'central.json');
    writeJson(central, noOpManifest());

    const imported = goldband(repo, state, [
      'review', 'contract', 'import', '--manifest', central,
    ]);
    expect(imported.operation).toBe('import');
    expect(imported.before.configured).toBe(false);
    expect(imported.after.baseline.kind).toBe('runtime-store');

    const inspected = goldband(repo, state, ['review', 'contract', 'inspect']);
    expect(inspected.runtimeStore).toMatchObject({ present: true, shadowed: false });
    expect(inspected.effectiveDigest).toBe(imported.after.effectiveDigest);

    writeJson(join(repo, 'goldband.review-evidence.json'), providerManifest());
    const shadowed = goldband(repo, state, ['review', 'contract', 'inspect']);
    expect(shadowed.baseline.kind).toBe('runtime-store');
    expect(shadowed.candidate).toMatchObject({ trackingState: 'untracked' });
    expect(shadowed.runtimeStore).toMatchObject({ present: true, shadowed: false });
    git(repo, ['add', 'goldband.review-evidence.json']);
    git(repo, ['commit', '-m', 'add repository contract']);
    const committed = goldband(repo, state, ['review', 'contract', 'inspect']);
    expect(committed.baseline.kind).toBe('repository');
    expect(committed.runtimeStore).toMatchObject({ present: true, shadowed: true });
    git(repo, ['rm', 'goldband.review-evidence.json']);
    git(repo, ['commit', '-m', 'remove repository contract']);

    const removed = goldband(repo, state, ['review', 'contract', 'remove']);
    expect(removed.before.configured).toBe(true);
    expect(removed.after.configured).toBe(false);
  });

  test('non-Git directories fail closed instead of guessing an identity', () => {
    const root = temporaryRoot();
    expect(() => inspectReviewContractStore(root, join(root, 'state'))).toThrow(
      'requires an unambiguous Git repository',
    );
  });
});

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'goldband-review-contract-'));
  roots.push(root);
  return root;
}

function gitRepository(root: string, name: string): string {
  const repo = join(root, name);
  git(root, ['init', repo]);
  git(repo, ['config', 'user.email', 'test@example.com']);
  git(repo, ['config', 'user.name', 'Goldband Test']);
  writeFileSync(join(repo, 'a.ts'), 'old();\n');
  git(repo, ['add', 'a.ts']);
  git(repo, ['commit', '-m', 'fixture']);
  return repo;
}

function writeCandidateDiff(repo: string): void {
  writeFileSync(
    join(repo, 'candidate.diff'),
    'diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old();\n+newValue();\n',
  );
}

function noOpManifest(): ReviewEvidenceManifest {
  return {
    schemaVersion: 2,
    behaviorMatrix: [{
      id: 'contract-present',
      behavior: 'The explicit repository contract is present.',
      kind: 'boundary',
      input: 'A review candidate.',
      preconditions: 'The user selected this contract.',
      expected: 'Resolution is deterministic.',
      risk: 'low',
      disposition: 'not-applicable',
      providerIds: [],
      reason: 'No executable provider is needed for the storage fixture.',
    }],
    providers: [],
    authorizations: [],
  };
}

function providerManifest(): ReviewEvidenceManifest {
  return {
    schemaVersion: 2,
    behaviorMatrix: [{
      id: 'required-provider',
      behavior: 'A required provider executes.',
      kind: 'normal',
      input: 'A review candidate.',
      preconditions: 'The repository baseline is active.',
      expected: 'The provider succeeds.',
      risk: 'high',
      disposition: 'automated',
      providerIds: ['required-provider'],
    }],
    providers: [{
      id: 'required-provider',
      owner: 'fixture',
      kind: 'static',
      lifecycle: 'persistent',
      cellIds: ['required-provider'],
      applicability: { kind: 'global', reason: 'Baseline laundering regression fixture.' },
      executionContext: { sandboxOwner: 'review-runtime', runner: 'sealed' },
      operations: [{
        id: 'pass',
        target: 'candidate',
        argv: ['true'],
        expectedExit: 'zero',
        timeoutMs: 1_000,
        maxOutputBytes: 1_024,
        network: 'deny',
        evidenceLevel: 'local',
        requiredSystemTools: [],
      }],
    }],
    authorizations: [],
  };
}

function subdirectoryProviderManifest(): ReviewEvidenceManifest {
  const value = providerManifest();
  value.providers[0]!.operations[0]!.argv = [
    'bun', '-e',
    "const fs=require('node:fs');if(!process.cwd().replaceAll('\\\\','/').endsWith('/packages/app')||fs.readFileSync('../../a.ts','utf8')!=='changed();\\n')process.exit(9)",
  ];
  return value;
}

function writeJson(file: string, value: unknown): void {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function hashFromManifestFile(file: string): string {
  const manifest = JSON.parse(readFileSync(file, 'utf8')) as ReviewEvidenceManifest;
  const stable = (value: unknown): string => {
    if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
    if (value && typeof value === 'object') {
      const item = value as Record<string, unknown>;
      return `{${Object.keys(item).sort().map((key) => `${JSON.stringify(key)}:${stable(item[key])}`).join(',')}}`;
    }
    return JSON.stringify(value) ?? 'null';
  };
  return createHash('sha256').update(stable(manifest)).digest('hex');
}

function git(cwd: string, args: string[]): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(result.stderr || `git ${args.join(' ')} failed`);
  }
  return result.stdout.trim();
}

function goldband(cwd: string, state: string, args: string[]): any {
  const bin = join(dirname(import.meta.dir), 'bin', 'goldband.ts');
  const result = spawnSync(process.execPath, [bin, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GOLDBAND_HOME: state },
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || `goldband ${args.join(' ')} failed`);
  }
  return JSON.parse(result.stdout);
}
