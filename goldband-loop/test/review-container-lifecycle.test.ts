import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createCandidateBinding, reviewEvidenceManifestSchema } from '../workflows/review-evidence';

const image = process.env.GOLDBAND_CONTAINER_TEST_IMAGE;
if (process.env.GOLDBAND_REQUIRE_CONTAINER_LIFECYCLE === '1' && !/^sha256:[a-f0-9]{64}$/.test(image ?? '')) {
  throw new Error('required review host boundary prerequisite is unavailable: container lifecycle requires a pinned local image ID');
}
const source = resolve(import.meta.dir, '..');
const broker = join(import.meta.dir, 'fixtures/review-containers/lifecycle.ts');
const label = 'dev.goldband.review-scope';

function docker(args: string[]) {
  const result = spawnSync('docker', args, { encoding: 'utf8', timeout: 8000 });
  if (result.status !== 0) throw new Error(`Docker ${args[0]}: ${result.stderr}`);
  return result.stdout.trim();
}

function fixture(root: string, command = 'import time; time.sleep(25)', timeoutMs = 30000) {
  const repo = join(root, 'repo');
  const snapshot = join(root, 'snapshot');
  mkdirSync(repo); mkdirSync(snapshot);
  writeFileSync(join(snapshot, 'candidate.txt'), 'synthetic fixture\n');
  const spec = { image, user: '1000:1000', environment: {}, tmpfs: [], memoryMb: 128, cpus: 1 };
  const manifest = reviewEvidenceManifestSchema.validate({ schemaVersion: 2, authorizations: [],
    behaviorMatrix: [{ id: 'cleanup', behavior: 'Retain isolated resource ownership through cancellation.', kind: 'boundary',
      input: 'synthetic candidate', preconditions: 'isolated service', expected: 'bounded cleanup or explicit retry refusal',
      risk: 'high', disposition: 'automated', providerIds: ['cleanup-provider'] }],
    providers: [{ id: 'cleanup-provider', owner: 'candidate.txt', kind: 'runtime-integration', lifecycle: 'persistent',
      cellIds: ['cleanup'], applicability: { kind: 'global', reason: 'Synthetic lifecycle test' },
      executionContext: { sandboxOwner: 'review-runtime', runner: 'container', container: spec,
        services: [{ id: 'service', container: spec, argv: ['python3', '-c', 'import time; time.sleep(40)'], ready: ['python3', '-c', 'print(1)'] }] },
      operations: [{ id: 'probe', target: 'candidate', argv: ['python3', '-c', command], expectedExit: 'zero',
        timeoutMs, maxOutputBytes: 4096, network: 'isolated', evidenceLevel: 'sandboxed-service' }] }],
  });
  writeFileSync(join(repo, 'goldband.review-evidence.json'), JSON.stringify(manifest));
  writeFileSync(join(repo, 'candidate.txt'), 'base\n');
  for (const args of [['init', '-q'], ['add', '.'], ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'fixture']]) {
    expect(spawnSync('git', args, { cwd: repo }).status).toBe(0);
  }
  writeFileSync(join(repo, 'candidate.txt'), 'candidate\n');
  const input = { source: 'git diff HEAD', diff: spawnSync('git', ['diff', 'HEAD'], { cwd: repo, encoding: 'utf8' }).stdout, changedFiles: ['candidate.txt'] };
  const binding = createCandidateBinding(repo, input, manifest);
  const scope = createHash('sha256').update(JSON.stringify({ repository: realpathSync(repo), scope: binding.scopeDigest })).digest('hex');
  writeFileSync(join(root, 'operation.json'), JSON.stringify({ manifest, binding }));
  return { repo, scope, manifest };
}

function inventory(scope: string) {
  const filter = ['--filter', `label=${label}=${scope}`];
  const names = docker(['container', 'ls', '--all', ...filter, '--format', '{{.Names}}']).split('\n').filter(Boolean);
  const networks = docker(['network', 'ls', ...filter, '--format', '{{.Name}}']).split('\n').filter(Boolean);
  return { names, networks };
}

async function waitFor<T>(read: () => T | undefined, timeoutMs = 15000): Promise<T> {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    const result = read();
    if (result !== undefined) return result;
    await Bun.sleep(25);
  }
  throw new Error('lifecycle observation deadline exceeded');
}

async function running(scope: string) {
  return waitFor(() => {
    const current = inventory(scope);
    if (current.names.length !== 2) return undefined;
    const states = JSON.parse(docker(['inspect', ...current.names]));
    if (!states.every((state: any) => state.State.Running && !state.State.OOMKilled)) return undefined;
    return { ...current, pid: Number(states[0].Config.Labels['dev.goldband.review-owner-pid']) };
  });
}

function cleanup(scope: string) {
  const owned = inventory(scope);
  for (const name of owned.names) docker(['rm', '--force', '--volumes', name]);
  for (const network of owned.networks) docker(['network', 'rm', network]);
  expect(inventory(scope)).toEqual({ names: [], networks: [] });
}

function startBroker(root: string, env = process.env) {
  return Bun.spawn([process.execPath, broker, root], { env, stdout: 'pipe', stderr: 'pipe' });
}

describe.skipIf(!image)('real Docker cancellation and scoped retry', () => {
  test('production local lane allows broker cleanup that takes more than one second', async () => {
    const root = mkdtempSync(join(tmpdir(), 'review-local-cleanup-'));
    const value = fixture(root);
    const tools = join(root, 'tools'); mkdirSync(tools);
    const wrapper = join(tools, 'docker'), actualDocker = realpathSync(Bun.which('docker')!);
    writeFileSync(wrapper, `#!${process.execPath}
import { spawnSync } from 'node:child_process';
const args = process.argv.slice(2);
if (args.includes('rm') && args.includes('--force')) await Bun.sleep(2000);
const result = spawnSync(${JSON.stringify(actualDocker)}, args, { env: process.env, encoding: 'utf8' });
process.stdout.write(result.stdout); process.stderr.write(result.stderr); process.exit(result.status ?? 1);
`); chmodSync(wrapper, 0o755);
    const miniTest = join(root, 'local-candidate/goldband-loop/test'); mkdirSync(miniTest, { recursive: true });
    // Run the actual broker as the fixed recipe's synthetic test input; avoid recursive suite execution.
    writeFileSync(join(miniTest, 'review-container-lifecycle.test.ts'),
      `process.argv[2] = ${JSON.stringify(root)}; await import(${JSON.stringify(broker)});\n`);
    const child = Bun.spawn([process.execPath, broker, root, 'local'],
      { env: { ...process.env, PATH: `${tools}:${process.env.PATH}` }, stdout: 'pipe', stderr: 'pipe' });
    try {
      await running(value.scope);
      child.kill('SIGTERM');
      expect(await child.exited).toBe(0);
      expect(await new Response(child.stdout).text()).toContain('runtime-incomplete');
      expect(inventory(value.scope)).toEqual({ names: [], networks: [] });
    } finally {
      child.kill('SIGTERM'); await child.exited;
      cleanup(value.scope); rmSync(root, { recursive: true, force: true });
    }
  }, 45000);

  test('atomic first-container reservation survives two empty inventory reads', async () => {
    const root = mkdtempSync(join(tmpdir(), 'review-container-race-'));
    const value = fixture(root);
    const tools = join(root, 'tools'), barrier = join(root, 'barrier');
    mkdirSync(tools); mkdirSync(barrier);
    const actualDocker = realpathSync(Bun.which('docker')!);
    const wrapper = join(tools, 'docker');
    writeFileSync(wrapper, `#!${process.execPath}
import { spawnSync } from 'node:child_process';
import { readdirSync, writeFileSync } from 'node:fs';
const args = process.argv.slice(2);
const result = spawnSync(${JSON.stringify(actualDocker)}, args, { env: process.env, encoding: 'utf8' });
if (args.includes('network') && args.includes('ls') && args.includes('label=${label}=${value.scope}')) {
  if (result.stdout.trim()) throw new Error('race fixture did not read empty inventory');
  writeFileSync(${JSON.stringify(barrier)} + '/' + process.pid, 'empty');
  const deadline = performance.now() + 10000;
  while (readdirSync(${JSON.stringify(barrier)}).length < 2) {
    if (performance.now() > deadline) throw new Error('race barrier timed out');
    await Bun.sleep(10);
  }
}
process.stdout.write(result.stdout); process.stderr.write(result.stderr);
process.exit(result.status ?? 1);
`);
    chmodSync(wrapper, 0o755);
    const env = { ...process.env, PATH: `${tools}:${process.env.PATH}` };
    const children = [startBroker(root, env), startBroker(root, env)];
    try {
      const loser = await Promise.race(children.map(async (child) => ({ child, code: await child.exited })));
      expect(loser.code).toBe(0);
      const output = await new Response(loser.child.stdout).text();
      expect(output).toContain('runtime-incomplete');
      expect(output).toContain('Conflict');
      const winner = children.find((child) => child !== loser.child)!;
      const owned = await running(value.scope);
      expect(owned.names).toHaveLength(2);
      expect(owned.networks).toHaveLength(1);
      expect(owned.names).toContain(`goldband-review-${value.scope}-owner`);
      winner.kill('SIGTERM');
      expect(await winner.exited).toBe(1);
      expect(inventory(value.scope)).toEqual({ names: [], networks: [] });
    } finally {
      for (const child of children) child.kill('SIGTERM');
      await Promise.all(children.map((child) => child.exited));
      cleanup(value.scope); rmSync(root, { recursive: true, force: true });
    }
  }, 45000);

  for (const [command, timeoutMs, status] of [['print(1)', 30000, 'verified-pass'], ['raise SystemExit(3)', 30000, 'verified-failure'], ['import time; time.sleep(25)', 4500, 'runtime-incomplete']] as const) {
    test(`preserves ${status} and removes exactly its session`, async () => {
      const root = mkdtempSync(join(tmpdir(), 'review-container-lifecycle-'));
      const value = fixture(root, command, timeoutMs);
      try {
        const child = startBroker(root);
        expect(await child.exited).toBe(0);
        expect(await new Response(child.stdout).text()).toContain(status);
        expect(inventory(value.scope)).toEqual({ names: [], networks: [] });
      } finally { cleanup(value.scope); rmSync(root, { recursive: true, force: true }); }
    }, 30000);
  }

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    test(`broker ${signal} aborts after bounded cleanup`, async () => {
      const root = mkdtempSync(join(tmpdir(), 'review-container-cancel-'));
      const value = fixture(root);
      const child = startBroker(root);
      try {
        await running(value.scope);
        child.kill(signal);
        expect(await child.exited).toBe(1);
        expect(await new Response(child.stderr).text()).toContain(`cancelled by ${signal}`);
        expect(inventory(value.scope)).toEqual({ names: [], networks: [] });
      } finally { child.kill(); cleanup(value.scope); rmSync(root, { recursive: true, force: true }); }
    }, 30000);
  }

  for (const ownerAlive of [true, false]) {
    test(`refuses retry while the previous owner is ${ownerAlive ? 'live' : 'hard-killed'}`, async () => {
      const root = mkdtempSync(join(tmpdir(), 'review-container-retry-'));
      const value = fixture(root);
      const child = startBroker(root);
      try {
        const previous = await running(value.scope);
        if (!ownerAlive) { child.kill('SIGKILL'); await child.exited; }
        const retry = startBroker(root);
        expect(await retry.exited).toBe(0);
        const output = await new Response(retry.stdout).text();
        expect(output).toContain('runtime-incomplete');
        expect(output).toContain('refusing to start another session');
        expect(inventory(value.scope)).toEqual({ names: previous.names, networks: previous.networks });
        if (ownerAlive) { child.kill('SIGTERM'); await child.exited; }
      } finally { child.kill(); cleanup(value.scope); rmSync(root, { recursive: true, force: true }); }
    }, 30000);
  }

  for (const signal of ['SIGINT', 'SIGTERM', 'SIGKILL'] as const) {
    test(`public launcher ${signal} cleans up or prevents an overlapping retry`, async () => {
      const root = mkdtempSync(join(tmpdir(), 'review-launcher-cancel-'));
      const value = fixture(root);
      const state = join(root, 'state');
      const trustedRuntime = join(root, 'trusted-runtime');
      const provision = spawnSync(process.execPath, [join(source, 'scripts/provision-review-receipt-authority.ts'),
        '--runtime-root', trustedRuntime, '--authority-root', join(root, 'authority')], { encoding: 'utf8' });
      expect(provision.status, provision.stderr).toBe(0);
      const child = Bun.spawn([join(source, 'bin/goldband'), 'review', 'code', '--host', 'codex'], { cwd: value.repo,
        env: { ...process.env, GOLDBAND_HOME: state, GOLDBAND_REVIEW_RECEIPT_TRUSTED_CONFIG: join(trustedRuntime, 'trusted-runtime.json') }, stdout: 'pipe', stderr: 'pipe' });
      let pid: number | undefined;
      try {
        const previous = await running(value.scope); pid = previous.pid;
        child.kill(signal);
        await child.exited;
        if (signal === 'SIGKILL') {
          expect(inventory(value.scope)).toEqual({ names: previous.names, networks: previous.networks });
          const retry = startBroker(root);
          expect(await retry.exited).toBe(0);
          expect(await new Response(retry.stdout).text()).toContain('refusing to start another session');
          expect(inventory(value.scope)).toEqual({ names: previous.names, networks: previous.networks });
          process.kill(pid, 'SIGTERM');
          await waitFor(() => inventory(value.scope).names.length === 0 ? true : undefined);
        } else {
          expect(inventory(value.scope)).toEqual({ names: [], networks: [] });
          expect(await new Response(child.stderr).text()).toContain('received ' + signal);
        }
      } catch (error) {
        child.kill('SIGTERM');
        await child.exited;
        throw new Error(`${String(error)}; launcher stderr: ${await new Response(child.stderr).text()}`);
      } finally {
        child.kill();
        if (pid) { try { process.kill(pid, 'SIGTERM'); } catch {} }
        cleanup(value.scope); rmSync(root, { recursive: true, force: true });
      }
    }, 45000);
  }

  test('an unrelated live session is neither blocked nor removed', async () => {
    const firstRoot = mkdtempSync(join(tmpdir(), 'review-container-unrelated-'));
    const secondRoot = mkdtempSync(join(tmpdir(), 'review-container-independent-'));
    const first = fixture(firstRoot), second = fixture(secondRoot, 'print(1)');
    const owner = startBroker(firstRoot);
    try {
      const previous = await running(first.scope);
      const independent = startBroker(secondRoot);
      expect(await independent.exited).toBe(0);
      expect(await new Response(independent.stdout).text()).toContain('verified-pass');
      expect(inventory(first.scope)).toEqual({ names: previous.names, networks: previous.networks });
      owner.kill('SIGTERM'); await owner.exited;
    } finally {
      owner.kill(); cleanup(first.scope); cleanup(second.scope);
      rmSync(firstRoot, { recursive: true, force: true }); rmSync(secondRoot, { recursive: true, force: true });
    }
  }, 30000);
});
