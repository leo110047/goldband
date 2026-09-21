import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020';
import { createCandidateBinding, executeEvidencePlan, reviewEvidenceManifestSchema } from '../workflows/review-evidence';
import { getWorkflow } from '../workflows/registry';
import { assertReviewContractBoundary } from '../workflows/review-lineage';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture(image = `sha256:${'a'.repeat(64)}`) {
  return {
    schemaVersion: 2, authorizations: [],
    behaviorMatrix: [{ id: 'database-browser', behavior: 'Migrated data survives concurrent writes and browser readback',
      kind: 'boundary', input: 'candidate', preconditions: 'isolated services', expected: 'real assertions pass',
      risk: 'high', disposition: 'automated', providerIds: ['integration'] }],
    providers: [{ id: 'integration', owner: 'verify.py', kind: 'runtime-integration', lifecycle: 'persistent',
      cellIds: ['database-browser'], applicability: { kind: 'global', reason: 'test fixture' },
      executionContext: { sandboxOwner: 'review-runtime', runner: 'container',
        container: { image, user: '1000:1000', environment: {}, tmpfs: [], memoryMb: 512, cpus: 1 }, services: [] as unknown[] },
      operations: [{ id: 'verify', target: 'candidate', argv: ['python3', 'verify.py'], expectedExit: 'zero',
        timeoutMs: 10000, maxOutputBytes: 8192, network: 'isolated', evidenceLevel: 'sandboxed-service' }] }],
  };
}

describe('project-neutral container evidence contract', () => {
  test('accepts image-owned language runtimes and project-defined services in both validators', () => {
    const value = fixture();
    value.providers[0]!.executionContext.services.push({ id: 'database',
      container: { ...value.providers[0]!.executionContext.container, user: '999:999', tmpfs: ['/var/lib/postgresql/data'] },
      argv: ['docker-entrypoint.sh', 'postgres'], ready: ['pg_isready'] });
    value.providers[0]!.executionContext.services.push({ id: 'cache', container: value.providers[0]!.executionContext.container,
      argv: ['redis-server', '--save', ''], ready: ['redis-cli', 'ping'] });
    const validated = reviewEvidenceManifestSchema.validate(value);
    expect(validated.providers[0]!.operations[0]!.pythonRuntime).toBeUndefined();
    const ajv = new Ajv2020({ strict: false });
    ajv.addSchema(JSON.parse(readFileSync(join(import.meta.dir, '../../schemas/review-behavior-matrix.schema.json'), 'utf8')));
    ajv.addFormat('date-time', { type: 'string', validate: (input: string) => Number.isFinite(Date.parse(input)) });
    const validate = ajv.compile(JSON.parse(readFileSync(join(import.meta.dir, '../../schemas/review-evidence-manifest.schema.json'), 'utf8')));
    expect(validate(value), JSON.stringify(validate.errors)).toBe(true);
  });

  test('rejects host authority, unpinned images, unsafe mounts and mixed runtime ownership', () => {
    const mutations = [
      (p: any) => { p.executionContext.container.image = 'postgres:latest'; },
      (p: any) => { p.executionContext.container.user = '0:0'; },
      (p: any) => { p.executionContext.container.mounts = ['/var/run/docker.sock']; },
      (p: any) => { p.executionContext.container.tmpfs = ['/workspace']; },
      (p: any) => { p.executionContext.container.tmpfs = ['/proc']; },
      (p: any) => { p.executionContext.container.environment = { GOLDBAND_EVIDENCE_SANDBOX_ACTIVE: '0' }; },
      (p: any) => { p.operations[0].network = 'host'; },
      (p: any) => { p.operations[0].network = 'deny'; },
      (p: any) => { p.operations[0].evidenceLevel = 'production-readback'; },
      (p: any) => { p.operations[0].pythonRuntime = { interpreter: 'python3.14', resolver: 'uv', projectFile: 'pyproject.toml', lockFile: 'uv.lock' }; },
      (p: any) => { p.operations[0].requiredSystemTools = ['docker']; },
      (p: any) => { p.executionContext = { sandboxOwner: 'review-runtime', runner: 'sealed' }; p.operations[0].argv = ['node', 'test.js']; },
    ];
    for (const mutate of mutations) {
      const value = fixture(); mutate(value.providers[0]);
      expect(() => reviewEvidenceManifestSchema.validate(value)).toThrow();
    }
  });

  test('adding actual service coverage preserves unsupported requirements and binds image changes', () => {
    const after = reviewEvidenceManifestSchema.validate(fixture());
    const before = structuredClone(after);
    before.providers = [];
    before.behaviorMatrix[0]!.disposition = 'unsupported';
    before.behaviorMatrix[0]!.providerIds = [];
    before.behaviorMatrix[0]!.reason = 'No service runner available';
    expect(() => assertReviewContractBoundary(before, after)).not.toThrow();
    const changed = structuredClone(after);
    if (changed.providers[0]!.executionContext.runner !== 'container') throw new Error('fixture');
    changed.providers[0]!.executionContext.container.image = `sha256:${'b'.repeat(64)}`;
    expect(() => assertReviewContractBoundary(after, changed)).toThrow('laundering blocked');
  });

  test('broker preparation consumes the operation deadline before any daemon mutation', async () => {
    const root = mkdtempSync(join(tmpdir(), 'review-container-deadline-')); roots.push(root);
    const tools = join(root, 'tools'); mkdirSync(tools);
    const calls = join(root, 'calls');
    const fakeDocker = join(tools, 'docker');
    writeFileSync(fakeDocker, `#!/bin/sh\nprintf '%s\\n' "$*" >> '${calls}'\ncase "$*" in\n  'context inspect'*) /bin/sleep 3; printf 'unix:///tmp/fixture-docker.sock\\n';;\n  *version*) printf '{"Os":"linux","Version":"28.0.1"}\\n';;\n  *) exit 1;;\nesac\n`);
    chmodSync(fakeDocker, 0o755);
    const originalWhich = Bun.which.bind(Bun);
    const lookup = spyOn(Bun, 'which').mockImplementation((command, options) => command === 'docker' ? fakeDocker : originalWhich(command, options));
    try {
      const value = fixture(); value.providers[0]!.operations[0]!.timeoutMs = 1000;
      const evidence = await execute(project(root, 'deadline-project'), value);
      expect(evidence.records[0]!.status).toBe('runtime-incomplete');
      expect(existsSync(calls), evidence.records[0]!.outputSummary).toBe(true);
      expect(readFileSync(calls, 'utf8').trim().split('\n')).toEqual(['context inspect --format {{.Endpoints.docker.Host}}']);
    } finally { lookup.mockRestore(); }
  });

  test('never credits an unstarted container or a failed start transport as executed evidence', async () => {
    const root = mkdtempSync(join(tmpdir(), 'review-container-start-')); roots.push(root);
    const fakeDocker = join(root, 'docker');
    const originalWhich = Bun.which.bind(Bun);
    const lookup = spyOn(Bun, 'which').mockImplementation((command, options) => command === 'docker' ? fakeDocker : originalWhich(command, options));
    try {
      for (const [status, startedAt, cliExit] of [
        ['created', '0001-01-01T00:00:00Z', 1],
        ['exited', '2026-01-01T00:00:00Z', 1],
        ['exited', '0001-01-01T00:00:00Z', 0],
      ] as const) {
        const state = { Status: status, StartedAt: startedAt, FinishedAt: '2026-01-01T00:00:01Z',
          Running: false, OOMKilled: false, Error: '', ExitCode: 0 };
        writeFileSync(fakeDocker, `#!/bin/sh
case "$*" in
  'context inspect'*) printf 'unix:///tmp/fixture-docker.sock\\n';;
  *' version '*) printf '{"Os":"linux","Version":"28.0.1"}\\n';;
  *' image inspect '*) printf '\"sha256:${'a'.repeat(64)}\" \"linux\" null\\n';;
  *' network inspect '*) printf '[{"Internal":true,"Options":{"com.docker.network.bridge.gateway_mode_ipv4":"isolated"}}]\\n';;
  *' start --attach '*) exit ${cliExit};;
  *' inspect --format '*) printf '%s\\n' '${JSON.stringify(state)}';;
esac
`);
        chmodSync(fakeDocker, 0o755);
        const evidence = await execute(project(root, `${status}-${cliExit}`), fixture());
        expect(evidence.records[0]!.status).toBe('runtime-incomplete');
        expect(evidence.records[0]!.fresh).toBe(false);
        expect(evidence.completeness.complete).toBe(false);
      }
    } finally { lookup.mockRestore(); }
  });
});

function project(root: string, name: string) {
  const repo = join(root, name);
  mkdirSync(repo, { recursive: true });
  for (const file of ['api.py', 'verify.py']) writeFileSync(join(repo, file), readFileSync(join(import.meta.dir, 'fixtures/review-containers', file)));
  writeFileSync(join(repo, 'candidate.txt'), 'base\n');
  for (const args of [['init', '-q'], ['add', '.'], ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'base']]) {
    expect(spawnSync('git', args, { cwd: repo }).status).toBe(0);
  }
  writeFileSync(join(repo, 'candidate.txt'), 'candidate\n');
  return repo;
}

async function execute(repo: string, value: ReturnType<typeof fixture>) {
  const manifest = reviewEvidenceManifestSchema.validate(value);
  const input = { source: 'git diff', diff: spawnSync('git', ['diff', 'HEAD'], { cwd: repo, encoding: 'utf8' }).stdout,
    changedFiles: ['candidate.txt'] };
  const ctx = { cwd: repo, runId: 'container-integration', workflow: getWorkflow('review/code'),
    options: { mode: 'mock' as const, goldbandHome: join(repo, 'state') }, artifacts: [] };
  return executeEvidencePlan(ctx, input, manifest, createCandidateBinding(repo, input, manifest));
}

const integrationImage = process.env.GOLDBAND_CONTAINER_TEST_IMAGE;
const postgresImage = process.env.GOLDBAND_CONTAINER_TEST_POSTGRES_IMAGE;
if (process.env.GOLDBAND_REQUIRE_CONTAINER_EVIDENCE === '1' && (!integrationImage || !postgresImage)) {
  throw new Error('required container evidence prerequisites are missing: provide prepared test and PostgreSQL image IDs');
}

describe.skipIf(!integrationImage || !postgresImage)('real Docker service evidence', () => {
  test('rejects image-owned disk volumes before the candidate can write to them', async () => {
    const root = mkdtempSync(join(tmpdir(), 'review-container-volume-')); roots.push(root);
    const value = fixture(postgresImage!);
    value.providers[0]!.executionContext.container.user = '999:999';
    value.providers[0]!.operations[0]!.argv = ['sh', '-c', 'touch /var/lib/postgresql/data/unbounded-write'];
    const result = (await execute(project(root, 'volume-project'), value)).records[0]!;
    expect(result.status, result.outputSummary).toBe('runtime-incomplete');
    expect(result.outputSummary).toContain('volume requires an explicit tmpfs');
  }, 30000);

  test('passes declared fuzz seed and iteration count to the actual container and record', async () => {
    const root = mkdtempSync(join(tmpdir(), 'review-container-fuzz-')); roots.push(root);
    const value = fixture(integrationImage!);
    value.providers[0]!.kind = 'property-fuzz';
    Object.assign(value.providers[0]!.operations[0], { seed: 'seed-17', iterations: 13,
      argv: ['python3', '-c', "import os; assert os.environ['GOLDBAND_EVIDENCE_SEED']=='seed-17'; assert os.environ['GOLDBAND_EVIDENCE_ITERATIONS']=='13'"] });
    const result = (await execute(project(root, 'fuzz-project'), value)).records[0]!;
    expect(result.status, result.outputSummary).toBe('verified-pass');
    expect(result).toMatchObject({ seed: 'seed-17', iterations: 13 });
  }, 30000);

  test('runs migration, concurrent transactions and Chromium in two independently configured projects', async () => {
    const root = mkdtempSync(join(tmpdir(), 'review-container-integration-')); roots.push(root);
    const sentinel = Bun.serve({ hostname: '0.0.0.0', port: 0, fetch: () => new Response('host-sentinel') });
    try {
    const reachable = Bun.spawn(['docker', 'run', '--rm', '--pull', 'never', '--read-only', '--cap-drop', 'ALL', '--user', '1000:1000',
      '--entrypoint', 'python3', integrationImage!, '-c', `import urllib.request;print(urllib.request.urlopen('http://host.docker.internal:${sentinel.port}', timeout=3).read().decode())`],
      { stdout: 'pipe', stderr: 'pipe' });
    expect(await reachable.exited, await new Response(reachable.stderr).text()).toBe(0);
    expect(await new Response(reachable.stdout).text()).toContain('host-sentinel');
    for (const [projectName, database, api] of [['clinic-demo', 'database', 'api'], ['warehouse-demo', 'inventory-db', 'inventory-http']]) {
      const value = fixture(integrationImage!);
      const context = value.providers[0]!.executionContext;
      const environment = { PGHOST: database!, PGUSER: 'fixture', PGPASSWORD: 'fixture', PGDATABASE: 'fixture', TEST_API: `http://${api}:8080`, TEST_HOST_PORT: String(sentinel.port) };
      context.container = { ...context.container, environment, memoryMb: 1024 };
      context.services = [
        { id: database, container: { ...context.container, image: postgresImage!, user: '999:999',
          environment: { POSTGRES_USER: 'fixture', POSTGRES_PASSWORD: 'fixture', POSTGRES_DB: 'fixture', PGDATA: '/var/lib/postgresql/data' },
          tmpfs: ['/var/lib/postgresql/data', '/var/run/postgresql'] }, argv: ['docker-entrypoint.sh', 'postgres'], ready: ['pg_isready', '-h', '127.0.0.1', '-U', 'fixture'] },
        { id: api, container: { ...context.container }, argv: ['python3', 'api.py'],
          ready: ['python3', '-c', "import urllib.request;urllib.request.urlopen('http://127.0.0.1:8080/health')"] },
      ];
      value.providers[0]!.operations[0]!.timeoutMs = 90000;
      const evidence = await execute(project(root, projectName!), value);
      const record = evidence.records[0]!;
      expect(record.status, record.outputSummary).toBe('verified-pass');
      expect(record).toMatchObject({ fresh: true, exitStatus: 0, environment: 'docker/isolated-services-readonly-candidate' });
      expect(record.snapshotDigestBefore).toBe(record.snapshotDigestAfter);
      expect(record.outputSummary).toContain('PASS eight committed transactions');
      expect(record.outputSummary).toContain('PASS Chromium JavaScript');
      expect(evidence.completeness.complete).toBe(true);
    }
    } finally { sentinel.stop(true); }
  }, 210000);

  test('preserves actual command failure and cleans up timed-out operations', async () => {
    const root = mkdtempSync(join(tmpdir(), 'review-container-failures-')); roots.push(root);
    const repo = project(root, 'failure-demo');
    const value = fixture(integrationImage!);
    value.providers[0]!.operations[0]!.argv = ['python3', '-c', 'import sys;print("candidate assertion failed");sys.exit(17)'];
    const failed = (await execute(repo, value)).records[0]!;
    expect(failed.status, failed.outputSummary).toBe('verified-failure');
    expect(failed.exitStatus).toBe(17);
    value.providers[0]!.operations[0]!.argv = ['python3', '-c', 'import time;time.sleep(60)'];
    value.providers[0]!.operations[0]!.timeoutMs = 5000;
    const timedOut = (await execute(repo, value)).records[0]!;
    expect(timedOut.status, timedOut.outputSummary).toBe('runtime-incomplete');
    expect(timedOut.fresh).toBe(false);
    const leftovers = spawnSync('docker', ['ps', '-a', '--filter', 'label=dev.goldband.review-run', '--format', '{{.Names}}'], { encoding: 'utf8' });
    expect(leftovers.status).toBe(0);
    expect(leftovers.stdout.trim()).toBe('');
  }, 60000);
});
