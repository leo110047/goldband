import { expect, spyOn, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { containerLifecyclePrerequisites, isContainerLifecycleRecipe } from '../workflows/review-container-lifecycle-evidence';
import { isReviewLocalProvider, runLocalReviewEvidence } from '../workflows/review-local-evidence';
import { reviewEvidenceManifestSchema } from '../workflows/review-evidence';

function provider() {
  return reviewEvidenceManifestSchema.validate({ schemaVersion: 2, authorizations: [],
    behaviorMatrix: [{ id: 'lifecycle', behavior: 'Real broker ownership survives cancellation and concurrent starts.',
      kind: 'boundary', input: 'candidate broker', preconditions: 'prepared local image and Docker',
      expected: 'one session and exact cleanup', risk: 'high', disposition: 'automated', providerIds: ['review-container-lifecycle-tests'] }],
    providers: [{ id: 'review-container-lifecycle-tests', kind: 'project-gate', lifecycle: 'persistent',
      owner: 'test/review-container-lifecycle.test.ts', cellIds: ['lifecycle'], applicability: { kind: 'global', reason: 'broker regression' },
      executionContext: { sandboxOwner: 'provider', runner: 'local-host', lane: 'goldband-local-review-host' },
      operations: [{ id: 'candidate-container-lifecycle', target: 'candidate', expectedExit: 'zero',
        argv: ['bun', 'test', '--cwd', 'goldband-loop', 'test/review-container-lifecycle.test.ts'],
        timeoutMs: 120000, maxOutputBytes: 16384, network: 'host', evidenceLevel: 'local' }] }],
  }).providers[0]!;
}

test('the lifecycle lane permits only its fixed host recipe', () => {
  expect(isReviewLocalProvider(provider())).toBe(true);
  for (const mutate of [
    (p: any) => { p.operations[0].argv.push('other.test.ts'); },
    (p: any) => { p.operations[0].argv[1] = 'run'; },
    (p: any) => { p.operations.push(p.operations[0]); },
    (p: any) => { p.operations[0].target = 'base'; },
    (p: any) => { p.operations[0].expectedExit = 'nonzero'; },
    (p: any) => { p.id = 'arbitrary'; },
  ]) {
    const changed = provider(); mutate(changed);
    expect(isContainerLifecycleRecipe(changed)).toBe(false);
    expect(isReviewLocalProvider(changed)).toBe(false);
  }
  const changed = provider(); changed.operations[0]!.network = 'deny';
  expect(isReviewLocalProvider(changed)).toBe(false);
});

test('required lifecycle execution rejects a missing image instead of skipping', () => {
  const result = spawnSync(process.execPath, ['test', 'test/review-container-lifecycle.test.ts'], {
    cwd: `${import.meta.dir}/..`, encoding: 'utf8',
    env: { ...process.env, GOLDBAND_REQUIRE_CONTAINER_LIFECYCLE: '1', GOLDBAND_CONTAINER_TEST_IMAGE: '' },
  });
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('required review host boundary prerequisite is unavailable');
  expect(result.stderr).not.toMatch(/\d+ skip/);
});

test('the production local owner classifies missing image prerequisites as incomplete evidence', async () => {
  const root = mkdtempSync(join(tmpdir(), 'lifecycle-missing-image-'));
  const previous = process.env.GOLDBAND_CONTAINER_TEST_IMAGE;
  delete process.env.GOLDBAND_CONTAINER_TEST_IMAGE;
  const value = provider();
  try {
    const record = await runLocalReviewEvidence({ provider: value, operation: value.operations[0]!,
      snapshotRoot: root, runnerRoot: root, executionOffset: '', dependencyDigest: 'dependency-fixture',
      binding: { repository: root, baseRef: 'HEAD', baseDigest: 'base-fixture', candidateDigest: 'candidate-fixture',
        scopeDigest: 'scope-fixture', behaviorContractDigest: 'contract-fixture', changedFiles: [], redactedUntrackedFiles: [] },
    }, () => 'unchanged-snapshot');
    expect(record.status).toBe('runtime-incomplete');
    expect(record.fresh).toBe(false);
    expect(record.exitStatus).toBeUndefined();
    expect(record.outputSummary).toContain('requires GOLDBAND_CONTAINER_TEST_IMAGE');
    expect(record.candidateDigest).toBe('candidate-fixture');
  } finally {
    if (previous === undefined) delete process.env.GOLDBAND_CONTAINER_TEST_IMAGE;
    else process.env.GOLDBAND_CONTAINER_TEST_IMAGE = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test('isolated transport retains the Docker executable chosen from caller-only PATH', () => {
  const root = mkdtempSync(join(tmpdir(), 'lifecycle-docker-path-'));
  const cli = join(root, 'docker'), repository = join(root, 'repository');
  mkdirSync(repository);
  const image = `sha256:${'a'.repeat(64)}`;
  writeFileSync(cli, `#!/bin/sh
case "$*" in
  'context inspect'*) printf 'unix:///tmp/test-docker.sock\\n';;
  *'version'*) printf '{"Os":"linux","Version":"28.0.1"}\\n';;
  *'image inspect'*) printf '{"Id":"${image}","Os":"linux"}\\n';;
esac
`); chmodSync(cli, 0o755);
  const previous = process.env.GOLDBAND_CONTAINER_TEST_IMAGE;
  process.env.GOLDBAND_CONTAINER_TEST_IMAGE = image;
  const nativeWhich = Bun.which.bind(Bun);
  const lookup = spyOn(Bun, 'which').mockImplementation((name, options) => name === 'docker' && !options ? cli : nativeWhich(name, options));
  try {
    const facts = containerLifecyclePrerequisites(repository);
    lookup.mockRestore();
    const resolved = Bun.which('docker', { PATH: `${facts.directories.join(':')}:/usr/bin:/bin` });
    expect(realpathSync(resolved!)).toBe(realpathSync(cli));
    expect(facts.env.GOLDBAND_REQUIRE_CONTAINER_LIFECYCLE).toBe('1');
    expect(facts.identity).toMatch(/^[a-f0-9]{64}$/);
    const alias = join(repository, 'docker'); symlinkSync(cli, alias);
    const candidateLookup = spyOn(Bun, 'which').mockImplementation((name, options) => name === 'docker' ? alias : nativeWhich(name, options));
    try {
      expect(() => containerLifecyclePrerequisites(repository)).toThrow('lookup directory must be outside the candidate repository');
    } finally { candidateLookup.mockRestore(); }
  } finally {
    lookup.mockRestore();
    if (previous === undefined) delete process.env.GOLDBAND_CONTAINER_TEST_IMAGE;
    else process.env.GOLDBAND_CONTAINER_TEST_IMAGE = previous;
    rmSync(root, { recursive: true, force: true });
  }
});
