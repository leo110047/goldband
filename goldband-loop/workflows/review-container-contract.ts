import type { ReviewEvidenceManifest } from './review-evidence';

export type EvidenceContainer = {
  image: string;
  user: string;
  environment: Record<string, string>;
  tmpfs: string[];
  memoryMb: number;
  cpus: number;
  workdir: string;
};

export type ContainerEvidenceContext = {
  sandboxOwner: 'review-runtime';
  runner: 'container';
  container: EvidenceContainer;
  services: Array<{ id: string; container: EvidenceContainer; argv: string[]; ready: string[] }>;
};

export function validateContainerContext(value: unknown): ContainerEvidenceContext {
  const item = object(value, ['sandboxOwner', 'runner', 'container', 'services']);
  if (item.sandboxOwner !== 'review-runtime' || item.runner !== 'container') throw new Error('container evidence must be runtime-owned');
  if (!Array.isArray(item.services) || item.services.length > 8) throw new Error('container evidence supports at most eight isolated services');
  const services = item.services.map((value) => {
    const service = object(value, ['id', 'container', 'argv', 'ready']);
    const id = string(service.id);
    if (!/^[a-z][a-z0-9-]{0,31}$/.test(id) || id === 'runner') throw new Error('invalid container service id');
    return { id, container: validateContainer(service.container), argv: command(service.argv), ready: command(service.ready) };
  });
  if (new Set(services.map((service) => service.id)).size !== services.length) throw new Error('duplicate container service id');
  return { sandboxOwner: 'review-runtime', runner: 'container', container: validateContainer(item.container), services };
}

function validateContainer(value: unknown): EvidenceContainer {
  const item = object(value, ['image', 'user', 'environment', 'tmpfs', 'memoryMb', 'cpus', 'workdir']);
  const image = string(item.image);
  if (!/^sha256:[a-f0-9]{64}$/.test(image)) throw new Error('container image must be an already installed sha256 image ID; tags and pulls are forbidden');
  const user = string(item.user);
  if (!/^[1-9][0-9]{0,8}:[1-9][0-9]{0,8}$/.test(user)) throw new Error('container user must specify non-root numeric uid:gid');
  if (!Array.isArray(item.tmpfs) || item.tmpfs.length > 8) throw new Error('container tmpfs must list at most eight private paths');
  const tmpfs = item.tmpfs.map(writablePath);
  if (new Set(tmpfs).size !== tmpfs.length) throw new Error('duplicate container tmpfs path');
  const workdir = item.workdir === undefined ? '.' : string(item.workdir);
  if (workdir !== '.' && !normalizedPath(workdir, false)) throw new Error('container workdir must be repo-relative');
  return { image, user, tmpfs, workdir, environment: environment(item.environment),
    memoryMb: integer(item.memoryMb, 128, 16384), cpus: integer(item.cpus, 1, 8) };
}

function writablePath(value: unknown): string {
  const path = string(value);
  if (!normalizedPath(path, true) || ['/workspace', '/proc', '/sys', '/dev', '/etc', '/tmp'].some((reserved) =>
    path === reserved || path.startsWith(`${reserved}/`) || reserved.startsWith(`${path}/`))) {
    throw new Error(`invalid container tmpfs path: ${path}; /tmp is provided by the runner`);
  }
  return path;
}

function normalizedPath(path: string, absolute: boolean): boolean {
  if (path.startsWith('/') !== absolute || path.includes('\\') || /[\s,:\x00]/.test(path)) return false;
  return (absolute ? path.slice(1) : path).split('/').every((part) => part !== '' && part !== '.' && part !== '..');
}

function environment(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('container environment must be an explicit object');
  const entries = Object.entries(value);
  if (entries.length > 64) throw new Error('container environment exceeds 64 variables');
  for (const [key, entry] of entries) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || key.startsWith('GOLDBAND_') || typeof entry !== 'string' || entry.includes('\0') || entry.length > 8192) {
      throw new Error(`invalid container environment variable: ${key}`);
    }
  }
  return Object.fromEntries(entries) as Record<string, string>;
}

function object(value: unknown, allowed: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('expected container evidence object');
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw new Error('container evidence contains unsupported fields');
  return value as Record<string, unknown>;
}

function string(value: unknown): string {
  if (typeof value !== 'string' || !value || value.includes('\0')) throw new Error('expected non-empty container string');
  return value;
}

function command(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 128) throw new Error('container command must be a bounded non-empty argv');
  string(value[0]);
  if (value.some((argument) => typeof argument !== 'string' || argument.includes('\0'))) throw new Error('container argv must contain strings without NUL');
  return [...value] as string[];
}

function integer(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) throw new Error(`container resource limit must be an integer from ${min} to ${max}`);
  return value;
}

export function assertContainerProvider(provider: ReviewEvidenceManifest['providers'][number]): void {
  const container = provider.executionContext.runner === 'container';
  for (const operation of provider.operations) {
    if ((operation.network === 'isolated') !== container) throw new Error('isolated network requires the container runner, and container operations require isolated network');
    if (container && (operation.pythonRuntime || operation.requiredSystemTools.length > 0)) throw new Error('container images own all language runtimes and tools; host runtime projection is forbidden');
  }
}
