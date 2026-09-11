import { spawnSync } from 'node:child_process';
import { accessSync, closeSync, constants, openSync, readSync, realpathSync, statSync } from 'node:fs';
import { userInfo } from 'node:os';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';

const SYSTEM_TOOL_ROOTS = [
  '/opt/homebrew/bin', '/opt/homebrew/Cellar', '/opt/homebrew/opt',
  '/usr/local/bin', '/usr/local/Cellar', '/usr/local/opt',
  '/usr/bin', '/bin', '/Library/Frameworks',
  '/opt/local/bin', '/opt/local/Library/Frameworks',
];

// Host identity, not HOME (which is replaced for local self-tests). No manifest
// or environment override may add trusted roots. The explicit home is a test seam.
type HostToolEnvironment = { path: string; home: string };
function hostEnvironment(): HostToolEnvironment {
  return { path: process.env.PATH ?? '/usr/bin:/bin', home: hostAccountHome() };
}

let accountHome: string | undefined;
function hostAccountHome(): string {
  if (accountHome) return accountHome;
  if (process.platform !== 'darwin') return userInfo().homedir;
  // Bun's os.userInfo().homedir follows HOME, unlike Node. Query the OS account
  // by uid so a caller/isolated HOME cannot grant trust to another directory.
  const uid = String(process.getuid!());
  const result = spawnSync('/usr/bin/dscacheutil', ['-q', 'user', '-a', 'uid', uid], {
    encoding: 'utf8', timeout: 10_000, maxBuffer: 16 * 1024,
    env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' },
  });
  const home = /^dir: (.+)$/m.exec(result.stdout ?? '')?.[1];
  if (result.status !== 0 || /^uid: (.+)$/m.exec(result.stdout ?? '')?.[1] !== uid || !home || !isAbsolute(home)) {
    throw new Error('Python host tool discovery cannot resolve the macOS account home by uid');
  }
  accountHome = home;
  return accountHome;
}

function within(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}${sep}`);
}

function toolRoots(home: string, command: string): string[] {
  const homes = [...new Set([resolve(home), realpathSync(home)])];
  return [...SYSTEM_TOOL_ROOTS, ...homes.flatMap((root) => [
    join(root, '.local/bin'),
    ...(command === 'python3.14' ? [join(root, '.local/share/uv/python'), join(root, '.pyenv/versions')] : []),
  ])];
}

export function isHostPythonToolPath(path: string, command: 'python3.14' | 'uv', home: string): boolean {
  return toolRoots(home, command).some((root) => within(resolve(path), root));
}

function selectedTool(command: string, path: string): string | undefined {
  for (const directory of path.split(':').filter(Boolean)) {
    const candidate = resolve(directory, command);
    try {
      accessSync(candidate, constants.X_OK);
      if (statSync(candidate).isFile()) return candidate;
    } catch { /* Continue only when the executable is absent or inaccessible. */ }
  }
  return undefined;
}

/** Resolve only the first PATH match; never silently substitute another tool. */
export function resolveHostPythonTool(
  command: 'python3.14' | 'uv', repository: string, environment = hostEnvironment(),
): string {
  const selected = selectedTool(command, environment.path);
  if (!selected) throw new Error(`review evidence executable is unavailable: ${command}`);
  const canonical = realpathSync(selected);
  const label = command === 'uv' ? 'uv resolver' : 'Python interpreter';
  const detail = `${label}: selected=${selected}; resolved=${canonical}`;
  const repositoryRoot = realpathSync(repository);
  const selectedParent = join(realpathSync(dirname(selected)), command);
  if ([selected, selectedParent, canonical].some((path) => within(path, repositoryRoot))) {
    throw new Error(`${detail}; must not come from the source checkout or its virtual environment`);
  }
  if (![selected, selectedParent, canonical].every((path) => isHostPythonToolPath(path, command, environment.home))) {
    throw new Error(`${detail}; must resolve from a trusted host package root; use a supported host installation's native executable, not a shim (see docs/review-evidence-manifest.md)`);
  }
  assertNativeTool(canonical, detail);
  return canonical;
}

function assertNativeTool(path: string, detail: string): void {
  const descriptor = openSync(path, 'r');
  const magic = Buffer.alloc(4);
  try { readSync(descriptor, magic, 0, magic.length, 0); } finally { closeSync(descriptor); }
  // Mach-O and universal Mach-O. Reject scripts/shims before interpreter inspection.
  if (!['feedface', 'cefaedfe', 'feedfacf', 'cffaedfe', 'cafebabe', 'bebafeca', 'cafebabf', 'bfbafeca'].includes(magic.toString('hex'))) {
    throw new Error(`${detail}; requires a native macOS executable; scripts and version-manager shims are unsupported`);
  }
}

/** Keep local host tests' tool selection consistent with sealed Python evidence. */
export function localReviewPythonPath(repository: string, environment = hostEnvironment()): string[] {
  const directories: string[] = [];
  for (const command of ['python3.14', 'uv'] as const) {
    // Missing prerequisites are reported by the relevant self-test. A found but
    // rejected executable must fail here, rather than falling back to Homebrew.
    if (!selectedTool(command, environment.path)) continue;
    resolveHostPythonTool(command, repository, environment);
    const directory = dirname(selectedTool(command, environment.path)!);
    if (!directories.includes(directory)) directories.push(directory);
  }
  return [...new Set(environment.path.split(':').filter(Boolean).map((directory) => resolve(directory)))]
    .filter((directory) => directories.includes(directory));
}
