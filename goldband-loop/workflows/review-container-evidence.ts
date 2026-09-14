import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { join, relative } from 'node:path';
import { superviseCommand } from '../scripts/process-supervisor.mjs';
import { EVIDENCE_SANDBOX_ACTIVE_ENV, EVIDENCE_TEMP_ROOT_ENV } from '../lib/evidence-runtime-contract';
import type { CandidateBinding, ReviewEvidenceManifest, ReviewEvidenceRecord } from './review-evidence';
import type { ContainerEvidenceContext, EvidenceContainer } from './review-container-contract';

type Provider = ReviewEvidenceManifest['providers'][number];
type Options = {
  provider: Provider; operation: Provider['operations'][number]; binding: CandidateBinding;
  snapshotRoot: string; runnerRoot: string; executionOffset: string;
};
type Broker = { command: string; prefix: string[]; env: NodeJS.ProcessEnv; identity: string };
type Session = {
  broker: Broker; network: string; containers: string[]; deadline: number;
  snapshotRoot: string; executionOffset: string;
};
type Result = { exitCode: number; reason: string; stdout: string; stderr: string };
const POLICY = 'docker-isolated-services-v1';
const LABEL = 'dev.goldband.review-run';

/** Only the broker sees the Docker socket. Candidate commands execute inside disposable containers. */
export async function runContainerReviewEvidence(options: Options, snapshotDigest: () => string,
  redact: (value: string, limit: number) => string): Promise<ReviewEvidenceRecord> {
  const { provider, operation, binding } = options;
  if (provider.executionContext.runner !== 'container') throw new Error('expected container execution context');
  const before = snapshotDigest();
  const startedAt = new Date().toISOString();
  const diagnostics: string[] = [];
  let session: Session | undefined;
  let result: Result | undefined;
  let identity: string | undefined;
  try {
    session = prepareSession(options);
    identity = hash({ policy: POLICY, binding, provider, broker: session.broker.identity, snapshot: before });
    await startServices(session, provider.executionContext);
    const spec = provider.executionContext.container;
    const name = await createContainer(session, 'runner', { ...spec, environment: { ...spec.environment,
      GOLDBAND_EVIDENCE_SEED: operation.seed ?? '',
      GOLDBAND_EVIDENCE_ITERATIONS: operation.iterations ? String(operation.iterations) : '',
    } },
      operation.argv.map((value) => value.replaceAll('{seed}', operation.seed ?? '')));
    result = await docker(session, ['start', '--attach', name], operation.maxOutputBytes);
    const state = JSON.parse(await checked(session, ['inspect', '--format', '{{json .State}}', name]));
    assertCompletedExecution(result, state);
    await assertServicesRunning(session);
  } catch (error) {
    diagnostics.push(error instanceof Error ? error.message : String(error));
  } finally {
    if (session) diagnostics.push(...await cleanup(session));
  }
  return containerRecord({ options, before, after: snapshotDigest(), startedAt, diagnostics, result, identity }, redact);
}

function assertCompletedExecution(result: Result, state: Record<string, unknown>): void {
  const startedAt = typeof state.StartedAt === 'string' ? Date.parse(state.StartedAt) : NaN;
  const finishedAt = typeof state.FinishedAt === 'string' ? Date.parse(state.FinishedAt) : NaN;
  if (result.reason !== 'exit' || state.Status !== 'exited' || state.Running !== false
    || state.OOMKilled !== false || state.Error !== '' || !(startedAt > 0) || !(finishedAt >= startedAt)
    || !Number.isInteger(state.ExitCode) || result.exitCode !== state.ExitCode) {
    throw new Error(`container execution incomplete: ${result.reason}; status=${state.Status}; CLI=${result.exitCode}; container=${state.ExitCode}; OOMKilled=${state.OOMKilled}; ${state.Error ?? ''}`);
  }
}

function containerRecord(state: { options: Options; before: string; after: string; startedAt: string;
  diagnostics: string[]; result?: Result; identity?: string }, redact: (value: string, limit: number) => string): ReviewEvidenceRecord {
  const { options, before, after, startedAt, diagnostics, result, identity } = state;
  const { provider, operation, binding } = options;
  if (before !== after) diagnostics.push('candidate snapshot changed during container execution');
  const complete = Boolean(result && identity && diagnostics.length === 0);
  const matches = operation.expectedExit === 'zero' ? result?.exitCode === 0 : result?.exitCode === operation.expectedExitCode;
  const output = `${result?.stdout ?? ''}${result?.stderr ?? ''}\n${diagnostics.join('\n')}`;
  return {
    id: `${provider.id}:${operation.id}`, providerId: provider.id, operationId: operation.id,
    cellIds: [...provider.cellIds], owner: provider.owner, kind: provider.kind,
    status: complete ? (matches ? 'verified-pass' : 'verified-failure') : 'runtime-incomplete',
    evidenceLevel: operation.evidenceLevel, environment: 'docker/isolated-services-readonly-candidate',
    commandDigest: hash({ argv: operation.argv, network: operation.network, seed: operation.seed, iterations: operation.iterations,
      executionOffset: options.executionOffset, context: provider.executionContext }),
    executionIdentityDigest: identity, snapshotDigestBefore: before, snapshotDigestAfter: after,
    replayCommand: operation.argv.map((value) => value.replaceAll('{seed}', operation.seed ?? '')),
    seed: operation.seed, iterations: operation.iterations,
    startedAt, finishedAt: new Date().toISOString(),
    exitStatus: result?.reason === 'exit' ? result.exitCode : undefined,
    outputDigest: hash(output), outputSummary: redact(output, operation.maxOutputBytes),
    candidateDigest: binding.candidateDigest, baseDigest: binding.baseDigest, scopeDigest: binding.scopeDigest,
    fresh: complete,
  };
}

function prepareSession(options: Options): Session {
  const deadline = performance.now() + options.operation.timeoutMs;
  if (process.env[EVIDENCE_SANDBOX_ACTIVE_ENV] === '1') throw new Error('container broker cannot run inside an evidence sandbox');
  if (/[\n\r,"]/.test(options.snapshotRoot)) throw new Error('container snapshot path contains unsupported mount separators');
  return { broker: prepareBroker(options, deadline), network: `goldband-review-${randomUUID()}`, containers: [], deadline,
    snapshotRoot: realpathSync(options.snapshotRoot), executionOffset: options.executionOffset };
}

function prepareBroker(options: Options, deadline: number): Broker {
  const located = Bun.which('docker');
  if (!located) throw new Error('Docker CLI is unavailable; install Docker and prepare the declared images first');
  const command = realpathSync(located);
  const inRepo = relative(options.binding.repository, command);
  if (inRepo !== '..' && !inRepo.startsWith('../')) throw new Error('Docker broker executable cannot come from the reviewed repository');
  const lookup = spawnSync(command, ['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'], {
    encoding: 'utf8', timeout: brokerTimeout(deadline), killSignal: 'SIGKILL', maxBuffer: 8192,
  });
  if (lookup.status !== 0) throw new Error(`Docker context unavailable: ${lookup.stderr.trim()}`);
  const endpoint = process.env.DOCKER_CONTEXT ? lookup.stdout.trim() : (process.env.DOCKER_HOST ?? lookup.stdout.trim());
  if (!/^unix:\/\/\/[^\r\n\x00]+$/.test(endpoint)) throw new Error('container evidence requires a local Unix Docker socket; remote contexts are unsupported');
  const config = join(options.runnerRoot, 'docker-config');
  mkdirSync(config, { recursive: true, mode: 0o700 });
  const env = { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME: options.runnerRoot, DOCKER_CLI_HINTS: 'false' };
  const prefix = ['--config', config, '--host', endpoint];
  const probe = spawnSync(command, [...prefix, 'version', '--format', '{{json .Server}}'], {
    env, encoding: 'utf8', timeout: brokerTimeout(deadline), killSignal: 'SIGKILL', maxBuffer: 8192 });
  if (probe.status !== 0) throw new Error(`Docker daemon unavailable: ${probe.stderr.trim()}`);
  const server = JSON.parse(probe.stdout);
  if (server.Os !== 'linux' || Number(String(server.Version).split('.')[0]) < 28) throw new Error('isolated container evidence requires Linux Docker Engine 28 or newer');
  return { command, prefix, env, identity: hash({ executable: hash(readFileSync(command)), endpoint, server }) };
}

function brokerTimeout(deadline: number): number {
  const remaining = Math.ceil(deadline - performance.now());
  if (remaining <= 0) throw new Error('container evidence operation deadline exceeded during broker preparation');
  return Math.min(10000, remaining);
}

async function startServices(session: Session, context: ContainerEvidenceContext): Promise<void> {
  for (const container of [context.container, ...context.services.map((service) => service.container)]) {
    await validateImage(session, container);
  }
  await checked(session, ['network', 'create', '--driver', 'bridge', '--internal',
    '--opt', 'com.docker.network.bridge.gateway_mode_ipv4=isolated', '--opt', 'com.docker.network.bridge.gateway_mode_ipv6=isolated',
    '--label', `${LABEL}=${session.network}`, session.network]);
  const network = JSON.parse(await checked(session, ['network', 'inspect', session.network]));
  if (!network[0]?.Internal || network[0]?.Options?.['com.docker.network.bridge.gateway_mode_ipv4'] !== 'isolated') throw new Error('Docker did not create an isolated internal network');
  for (const service of context.services) {
    const name = await createContainer(session, service.id, service.container, service.argv);
    await checked(session, ['start', name]);
    await waitForService(session, name, service.ready);
  }
}

async function validateImage(session: Session, spec: EvidenceContainer): Promise<void> {
  const { image } = spec;
  const raw = await checked(session, ['image', 'inspect', '--format', '{{json .Id}} {{json .Os}} {{json .Config.Volumes}}', image]);
  const match = /^("[^"]+") ("[^"]+") (.+)$/.exec(raw);
  if (!match || JSON.parse(match[1]!) !== image || JSON.parse(match[2]!) !== 'linux') throw new Error(`local container image identity mismatch: ${image}`);
  const volumes = JSON.parse(match[3]!) ?? {};
  if (Object.keys(volumes).some((path) => path === '/' || path === '/workspace' || path.startsWith('/workspace/'))) throw new Error(`image volumes must not shadow the candidate: ${image}`);
  for (const path of Object.keys(volumes)) {
    if (path !== '/tmp' && !spec.tmpfs.includes(path)) throw new Error(`image volume requires an explicit tmpfs: ${image} ${path}`);
  }
}

async function createContainer(session: Session, id: string, spec: EvidenceContainer, argv: string[]): Promise<string> {
  const name = `${session.network}-${id}`;
  // Record the intended name first: an interrupted create may already have reached the daemon.
  session.containers.push(name);
  const args = containerArgs(session, name, spec);
  await checked(session, [...args, '--network-alias', id, '--hostname', id,
    '--entrypoint', argv[0]!, spec.image, ...argv.slice(1)]);
  return name;
}

function containerArgs(session: Session, name: string, spec: EvidenceContainer): string[] {
  const [uid, gid] = spec.user.split(':');
  const cwd = [session.executionOffset, spec.workdir === '.' ? '' : spec.workdir].filter(Boolean).join('/');
  return ['create', '--pull', 'never', '--name', name, '--label', `${LABEL}=${session.network}`,
    '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges=true', '--user', spec.user,
    '--pids-limit', '512', '--memory', `${spec.memoryMb}m`, '--memory-swap', `${spec.memoryMb}m`, '--cpus', String(spec.cpus),
    '--init', '--ipc', 'private', '--shm-size', '128m', '--restart', 'no', '--no-healthcheck',
    '--log-driver', 'local', '--log-opt', 'max-size=1m', '--log-opt', 'max-file=1', '--log-opt', 'compress=false',
    '--network', session.network, '--dns', '127.0.0.1', '--workdir', `/workspace${cwd ? `/${cwd}` : ''}`,
    '--mount', `type=bind,source=${session.snapshotRoot},target=/workspace,readonly,bind-recursive=disabled`,
    '--tmpfs', `/tmp:rw,nosuid,nodev,size=${spec.memoryMb}m,mode=1777`,
    ...spec.tmpfs.flatMap((path) => ['--tmpfs', `${path}:rw,nosuid,nodev,size=${spec.memoryMb}m,uid=${uid},gid=${gid},mode=700`]),
    ...Object.entries(spec.environment).flatMap(([key, value]) => ['--env', `${key}=${value}`]),
    '--env', `${EVIDENCE_SANDBOX_ACTIVE_ENV}=1`, '--env', `${EVIDENCE_TEMP_ROOT_ENV}=/tmp`,
    '--env', 'HOME=/tmp', '--env', 'TMPDIR=/tmp', '--env', 'CI=1'];
}

async function waitForService(session: Session, name: string, argv: string[]): Promise<void> {
  while (performance.now() < session.deadline) {
    const result = await docker(session, ['exec', name, ...argv], 4096);
    if (result.reason === 'exit' && result.exitCode === 0) return;
    const state = JSON.parse(await checked(session, ['inspect', '--format', '{{json .State}}', name]));
    if (!state.Running || state.OOMKilled) {
      const logs = await docker(session, ['logs', '--tail', '30', name], 8192);
      throw new Error(`service ${name} exited before readiness: ${logs.stdout}${logs.stderr}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`service ${name} readiness exceeded the operation deadline`);
}

async function assertServicesRunning(session: Session): Promise<void> {
  for (const name of session.containers.slice(0, -1)) {
    const state = JSON.parse(await checked(session, ['inspect', '--format', '{{json .State}}', name]));
    if (!state.Running || state.OOMKilled || state.Error) {
      const logs = await docker(session, ['logs', '--tail', '30', name], 8192);
      throw new Error(`service ${name} became unavailable during the test: ${logs.stdout}${logs.stderr}`);
    }
  }
}

async function docker(session: Session, args: string[], maxBytes = 8192): Promise<Result> {
  const remaining = Math.max(1, Math.ceil(session.deadline - performance.now()));
  const timeoutMs = Math.min(30000, remaining);
  if (session.deadline <= performance.now()) throw new Error('container evidence operation deadline exceeded');
  return await superviseCommand(session.broker.command, [...session.broker.prefix, ...args], {
    env: session.broker.env, timeoutMs: args[0] === 'start' && args.includes('--attach') ? remaining : timeoutMs,
    killGraceMs: 500, killConfirmMs: 1000,
    captureOutput: { stdoutMaxBytes: maxBytes, stderrMaxBytes: maxBytes }, stdout: { write() {} }, stderr: { write() {} },
  });
}

async function checked(session: Session, args: string[]): Promise<string> {
  const result = await docker(session, args);
  if (result.reason !== 'exit' || result.exitCode !== 0) throw new Error(`Docker ${args[0]} failed (${result.reason}): ${result.stderr || result.stdout}`);
  return result.stdout.trim();
}

async function cleanup(session: Session): Promise<string[]> {
  const failures: string[] = [];
  const cleanupSession = { ...session, deadline: performance.now() + 30000 };
  for (const name of [...session.containers].reverse()) {
    try {
      const found = await docker(cleanupSession, ['container', 'ls', '--all', '--filter', `name=^/${name}$`, '--format', '{{.Names}}']);
      if (found.exitCode !== 0 || found.reason !== 'exit') throw new Error(found.stderr);
      if (found.stdout.trim()) await checked(cleanupSession, ['rm', '--force', '--volumes', name]);
    } catch (error) { failures.push(`container cleanup failed for ${name}: ${String(error)}`); }
  }
  try {
    const found = await checked(cleanupSession, ['network', 'ls', '--filter', `name=^${session.network}$`, '--format', '{{.Name}}']);
    if (found) await checked(cleanupSession, ['network', 'rm', session.network]);
  } catch (error) { failures.push(`network cleanup failed for ${session.network}: ${String(error)}`); }
  return failures;
}

function hash(value: unknown): string {
  return createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
}
