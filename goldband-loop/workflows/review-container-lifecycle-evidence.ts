import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, relative } from 'node:path';
import type { ReviewEvidenceManifest } from './review-evidence';

type Provider = ReviewEvidenceManifest['providers'][number];

/** One host-side broker regression recipe; never accepts arbitrary commands. */
export function isContainerLifecycleRecipe(provider: Provider): boolean {
  const op = provider.operations[0];
  return provider.id === 'review-container-lifecycle-tests' && provider.operations.length === 1 && !!op &&
    op.id === 'candidate-container-lifecycle' && op.target === 'candidate' &&
    op.expectedExit === 'zero' && op.evidenceLevel === 'local' &&
    JSON.stringify(op.argv) === JSON.stringify(['bun', 'test', '--cwd', 'goldband-loop', 'test/review-container-lifecycle.test.ts']);
}

export function containerLifecyclePrerequisites(repository: string) {
  const image = process.env.GOLDBAND_CONTAINER_TEST_IMAGE;
  if (!image || !/^sha256:[a-f0-9]{64}$/.test(image)) throw new Error('container lifecycle self-test requires GOLDBAND_CONTAINER_TEST_IMAGE with a pinned local sha256 image ID');
  const located = Bun.which('docker');
  if (!located) throw new Error('container lifecycle self-test requires Docker CLI');
  const command = realpathSync(located);
  const root = realpathSync(repository);
  if ([located, command, realpathSync(dirname(located))].some((path) => {
    const offset = relative(root, path);
    return offset !== '..' && !offset.startsWith('../');
  })) throw new Error('Docker CLI and its lookup directory must be outside the candidate repository');
  const run = (args: string[]) => {
    const result = spawnSync(command, args, { encoding: 'utf8', timeout: 10000, maxBuffer: 16384 });
    if (result.status !== 0) throw new Error(`container lifecycle prerequisite unavailable: ${result.stderr}`);
    return result.stdout.trim();
  };
  const contextEndpoint = run(['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}']);
  const endpoint = process.env.DOCKER_CONTEXT ? contextEndpoint : process.env.DOCKER_HOST ?? contextEndpoint;
  if (!/^unix:\/\/\/[^\r\n\x00]+$/.test(endpoint)) throw new Error('container lifecycle self-test requires a local Unix Docker socket');
  const prefix = ['--host', endpoint];
  const server = JSON.parse(run([...prefix, 'version', '--format', '{{json .Server}}']));
  const major = Number(String(server.Version).split('.')[0]);
  if (server.Os !== 'linux' || !Number.isInteger(major) || major < 28) throw new Error('container lifecycle self-test requires Linux Docker Engine 28 or newer');
  const localImage = JSON.parse(run([...prefix, 'image', 'inspect', '--format', '{{json .}}', image]));
  if (localImage.Id !== image || localImage.Os !== 'linux') throw new Error('container lifecycle image identity mismatch');
  const identity = createHash('sha256').update(JSON.stringify({ executable: createHash('sha256').update(readFileSync(command)).digest('hex'), endpoint, server, image })).digest('hex');
  return { directories: [dirname(located)], identity, summary: `Docker lifecycle prerequisites: image=${image}; engine=${server.Version}; local Unix socket; identity=${identity}`, env: {
    DOCKER_HOST: endpoint, GOLDBAND_CONTAINER_TEST_IMAGE: image, GOLDBAND_REQUIRE_CONTAINER_LIFECYCLE: '1',
  } };
}
