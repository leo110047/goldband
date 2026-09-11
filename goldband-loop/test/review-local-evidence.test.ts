import { spawnSync } from 'node:child_process';
import { getWorkflow } from '../workflows/registry';
import Ajv2020 from 'ajv/dist/2020';
import { afterEach, describe, expect, test } from 'bun:test';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createCandidateBinding, executeEvidencePlan, reviewEvidenceManifestSchema, type CandidateBinding } from '../workflows/review-evidence';
import { assertReviewContractBoundary } from '../workflows/review-lineage';
import { reviewCandidateTree } from '../workflows/review-ci-evidence';
import { isRegisteredReviewContractExtension } from '../workflows/review-contract-resolution';
import { REVIEW_LOCAL_LANE, runLocalReviewEvidence } from '../workflows/review-local-evidence';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function manifests() {
  const before = reviewEvidenceManifestSchema.validate(JSON.parse(readFileSync(join(import.meta.dir, 'fixtures/review-contracts/goldband.json'), 'utf8')));
  const after = structuredClone(before);
  for (const provider of after.providers) if (provider.executionContext.runner === 'github-actions') {
    provider.executionContext = { sandboxOwner: 'provider', runner: 'local-host', lane: REVIEW_LOCAL_LANE };
    provider.operations[0]!.network = 'host';
    provider.operations[0]!.timeoutMs = 600_000;
  }
  return { before, after: reviewEvidenceManifestSchema.validate(after) };
}

describe('pre-push local self-test evidence', () => {
  test('moves only the existing full recipes from CI to local execution', () => {
    const { before, after } = manifests();
    const schema = JSON.parse(readFileSync(join(import.meta.dir, '../../schemas/review-evidence-manifest.schema.json'), 'utf8'));
    const ajv = new Ajv2020({ strict: false });
    ajv.addSchema(JSON.parse(readFileSync(join(import.meta.dir, '../../schemas/review-behavior-matrix.schema.json'), 'utf8')));
    ajv.addFormat('date-time', { type: 'string', validate: (value: string) => Number.isFinite(Date.parse(value)) });
    const validate = ajv.compile(schema);
    expect(validate(after), JSON.stringify(validate.errors)).toBe(true);
    expect(isRegisteredReviewContractExtension(before, after)).toBe(true);
    expect(() => assertReviewContractBoundary(before, after)).not.toThrow();
    const withLineage = structuredClone(after);
    withLineage.providers.find((p) => p.id === 'review-evidence-tests')!.operations[0]!.argv.push('test/review-lineage.test.ts');
    expect(() => reviewEvidenceManifestSchema.validate(withLineage)).not.toThrow();
    expect(() => assertReviewContractBoundary(before, withLineage)).not.toThrow();
    withLineage.providers.find((p) => p.id === 'review-evidence-tests')!.operations[0]!.argv.push('test/arbitrary.test.ts');
    expect(() => reviewEvidenceManifestSchema.validate(withLineage)).toThrow('named local review self-tests');
    for (const mutate of [
      (manifest: typeof after) => { manifest.behaviorMatrix.pop(); },
      (manifest: typeof after) => { manifest.providers.find((p) => p.id === 'review-evidence-tests')!.operations[0]!.argv.pop(); },
      (manifest: typeof after) => { manifest.providers.find((p) => p.id === 'work-map-review-tests')!.operations[0]!.expectedExit = 'nonzero'; },
      (manifest: typeof after) => { manifest.providers.find((p) => p.id === 'installed-runtime-tests')!.operations[0]!.timeoutMs = 100; },
    ]) {
      const changed = structuredClone(after); mutate(changed);
      expect(isRegisteredReviewContractExtension(before, changed)).toBe(false);
      expect(() => assertReviewContractBoundary(before, changed)).toThrow('laundering blocked');
    }
  });

  test('host execution is not available to arbitrary provider commands', () => {
    const { after } = manifests();
    const provider = after.providers.find((p) => p.id === 'work-map-review-tests')!;
    provider.operations[0]!.argv = ['bun', '-e', 'process.exit(0)'];
    expect(() => reviewEvidenceManifestSchema.validate(after)).toThrow('named local review self-tests');
    provider.executionContext = { sandboxOwner: 'review-runtime', runner: 'sealed' };
    expect(() => reviewEvidenceManifestSchema.validate(after)).toThrow('named local review self-tests');
  });

  test('production evidence path rejects mutation of a copied dependency', async () => {
    const root = mkdtempSync(join(tmpdir(), 'review-local-dependency-')); roots.push(root);
    const repo = join(root, 'repo');
    mkdirSync(join(repo, 'goldband-loop/test'), { recursive: true });
    mkdirSync(join(repo, 'goldband-loop/node_modules/probe'), { recursive: true });
    writeFileSync(join(repo, 'goldband-loop/node_modules/probe/index.js'), 'before');
    writeFileSync(join(repo, 'goldband-loop/test/work-map-review.test.ts'), "import { test, expect } from 'bun:test'; import { writeFileSync } from 'node:fs'; test('mutates dependency', () => { writeFileSync('node_modules/probe/index.js', 'after'); expect(true).toBe(true); });");
    for (const args of [['init', '-q'], ['add', 'goldband-loop/test'], ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'fixture']]) {
      expect(spawnSync('git', args, { cwd: repo }).status).toBe(0);
    }
    const provider = manifests().after.providers.find((p) => p.id === 'work-map-review-tests')!;
    provider.cellIds = ['local-check'];
    provider.applicability = { kind: 'global', reason: 'local runner integration' };
    const manifest = reviewEvidenceManifestSchema.validate({ schemaVersion: 2, providers: [provider], authorizations: [],
      behaviorMatrix: [{ id: 'local-check', behavior: 'Dependencies stay unchanged', kind: 'boundary', input: 'candidate',
        preconditions: 'local runner', expected: 'unchanged dependencies', risk: 'high', disposition: 'static', providerIds: [provider.id] }],
    });
    const trusted = join(root, 'trusted-runtime.json');
    writeFileSync(trusted, JSON.stringify({ runtimeHost: 'codex', reviewLocalEvidenceLane: REVIEW_LOCAL_LANE }));
    const input = { source: 'git diff', diff: '', changedFiles: ['goldband-loop/test/work-map-review.test.ts'] };
    const ctx = { cwd: repo, runId: 'dependency-mutation', workflow: getWorkflow('review/code'), options: {
      mode: 'mock' as const, host: 'codex' as const, reviewReceiptTrustedConfig: trusted, goldbandHome: join(root, 'state'),
    }, input: undefined };
    const evidence = await executeEvidencePlan(ctx, input, manifest, createCandidateBinding(repo, input, manifest));
    expect(evidence.records[0]).toMatchObject({ status: 'runtime-incomplete', fresh: false });
    if (process.platform === 'darwin') {
      expect(evidence.records[0]!.snapshotDigestBefore).not.toBe(evidence.records[0]!.snapshotDigestAfter);
    } else {
      expect(evidence.records[0]!.environment).toBe('local-host/unavailable');
      expect(evidence.records[0]!.snapshotDigestBefore).toBeUndefined();
      expect(evidence.records[0]!.snapshotDigestAfter).toBeUndefined();
    }
    expect(readFileSync(join(repo, 'goldband-loop/node_modules/probe/index.js'), 'utf8')).toBe('before');
  });

  test.each(['pass', 'fail', 'mutate', 'timeout', 'missing-prerequisite'] as const)('native candidate copy records %s without a commit or CI', async (scenario) => {
    const root = mkdtempSync(join(tmpdir(), 'review-local-host-')); roots.push(root);
    const candidate = join(root, 'candidate');
    mkdirSync(join(candidate, 'goldband-loop/test'), { recursive: true });
    const source = scenario === 'missing-prerequisite' ? `if (process.env.GOLDBAND_REQUIRE_REVIEW_HOST_BOUNDARY === '1' && !Bun.which('goldband-nonexistent-prerequisite')) throw new Error('required review host boundary prerequisite is unavailable');` : scenario === 'timeout' ? 'await Bun.sleep(2000);' : scenario === 'mutate'
      ? "await Bun.write('changed.txt', 'changed');" : '';
    writeFileSync(join(candidate, 'goldband-loop/test/work-map-review.test.ts'), `import { test, expect } from 'bun:test';\n${source}\ntest('candidate check', () => { expect(process.env.GOLDBAND_REQUIRE_REVIEW_HOST_BOUNDARY).toBe('1'); expect(process.env.GITHUB_TOKEN).toBeUndefined(); expect(process.env.GOLDBAND_REVIEW_RECEIPT_TRUSTED_CONFIG).toBeUndefined(); expect(${scenario !== 'fail'}).toBe(true); });\n`);
    const provider = manifests().after.providers.find((p) => p.id === 'work-map-review-tests')!;
    provider.operations[0]!.timeoutMs = scenario === 'timeout' ? 100 : 5000;
    const binding = { candidateDigest: 'a'.repeat(64), baseDigest: 'b'.repeat(64), scopeDigest: 'c'.repeat(64) } as CandidateBinding;
    const record = await runLocalReviewEvidence({ provider, operation: provider.operations[0]!, snapshotRoot: candidate,
      runnerRoot: join(root, 'runner'), binding, dependencyDigest: 'd'.repeat(64), executionOffset: '',
    }, () => reviewCandidateTree(candidate));
    expect(record.status).toBe(scenario === 'pass' ? 'verified-pass' : scenario === 'fail' ? 'verified-failure' : 'runtime-incomplete');
    expect(record.fresh).toBe(scenario === 'pass' || scenario === 'fail');
    expect(record.candidateDigest).toBe(binding.candidateDigest);
    expect(record.environment).toBe('local-host/macos-self-tests');
    expect(record.ciProvenance).toBeUndefined();
  });
});


describe('local Python self-test tool selection', () => {
  test.each(['supported', 'rejected'] as const)('records %s host tools before starting the self-test', async (scenario) => {
    if (process.platform !== 'darwin') return;
    const root = mkdtempSync(join(tmpdir(), 'review-local-python-')); roots.push(root);
    const candidate = join(root, 'candidate');
    mkdirSync(join(candidate, 'goldband-loop/test'), { recursive: true });
    const provider = manifests().after.providers.find((p) => p.id === 'review-evidence-tests')!;
    const previousPath = process.env.PATH;
    const python = Bun.which('python3.14');
    if (!python) {
      if (process.env.GOLDBAND_REQUIRE_REVIEW_HOST_BOUNDARY === '1') throw new Error('required review host boundary prerequisite is unavailable: Python 3.14 executable');
      return;
    }
    const selected = dirname(python);
    const poison = join(root, 'poison'); mkdirSync(poison);
    writeFileSync(join(poison, 'python3.14'), '#!/bin/sh\nexit 99\n'); chmodSync(join(poison, 'python3.14'), 0o755);
    const source = `import { test, expect } from 'bun:test'; test('selected tool', () => { expect(Bun.which('python3.14')).toBe(${JSON.stringify(join(selected, 'python3.14'))}); expect(process.env.HOME).not.toBe(${JSON.stringify(process.env.HOME)}); });`;
    for (const file of ['review-evidence.test.ts', 'review-evidence-platform.test.ts']) writeFileSync(join(candidate, 'goldband-loop/test', file), source);
    process.env.PATH = `${scenario === 'supported' ? selected : poison}:${previousPath ?? ''}`;
    try {
      const binding = { repository: candidate, candidateDigest: 'a'.repeat(64), baseDigest: 'b'.repeat(64), scopeDigest: 'c'.repeat(64) } as CandidateBinding;
      const record = await runLocalReviewEvidence({ provider, operation: provider.operations[0]!, snapshotRoot: candidate,
        runnerRoot: join(root, 'runner'), binding, dependencyDigest: 'd'.repeat(64), executionOffset: '',
      }, () => reviewCandidateTree(candidate));
      expect(record.status, record.outputSummary).toBe(scenario === 'supported' ? 'verified-pass' : 'runtime-incomplete');
      expect(record.fresh).toBe(scenario === 'supported');
      if (scenario === 'rejected') {
        expect(record.exitStatus).toBeUndefined();
        expect(record.outputSummary).toContain(`selected=${poison}/python3.14`);
        expect(record.outputSummary).toContain('trusted host package root');
      }
    } finally { if (previousPath === undefined) delete process.env.PATH; else process.env.PATH = previousPath; }
  });
});
