import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Fixtures for the pre-push secret gate tests: an installed goldband hook
// directory under a temporary HOME, local bare remotes, and assertions that
// fail on an unredacted key.

const repoRoot = process.cwd();
// Assembled at runtime so secret scanners do not flag this file.
export const AWS_KEY = ['AKIA', 'Z7XQ4MLP', 'W2RT6YVB'].join('');
export const NO_GITLEAKS_PATH = '/usr/bin:/bin:/usr/sbin:/sbin';

let fixture = null;

// Requires gitleaks and installs the style gate once; the other helpers use
// the installed fixture.
export function setupSecretPushFixture() {
  requireGitleaks();
  fixture = installFixture();
  return fixture;
}

function installFixture() {
  const created = createInstallerFixture();
  const install = installStyleGate(created);
  assertEqual(install.status, 0, install.stdout + install.stderr);
  assertIncludes(install.stdout, 'gitleaks 可用');
  return {
    root: created.root,
    home: fs.realpathSync(created.home),
    hooks: hooksDir(created.home),
  };
}

export function createInstallerFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'goldband-secret-src-'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'goldband-secret-home-'));
  fs.copyFileSync(
    path.join(repoRoot, 'install.sh'),
    path.join(root, 'install.sh'),
  );
  for (const dir of ['shell', 'git-hooks']) {
    fs.cpSync(path.join(repoRoot, dir), path.join(root, dir), {
      recursive: true,
    });
  }
  return { root, home };
}

export function installStyleGate(target) {
  return run('bash', [path.join(target.root, 'install.sh'), 'style-gate'], {
    cwd: target.root,
    env: baseEnv(target.home),
  });
}

export function hooksDir(home) {
  return path.join(home, '.config', 'goldband', 'git-hooks');
}

export function readText(dir, name) {
  return fs.readFileSync(path.join(dir, name), 'utf8');
}

export function assertFile(file) {
  if (fs.statSync(file).isFile()) return;
  throw new Error(`expected regular file: ${file}`);
}

export function createRepo({ rootContent = 'hello\n' } = {}) {
  const repo = fs.mkdtempSync(path.join(fixture.home, 'repo-'));
  const bare = createBare();
  git(repo, ['init', '-q', '-b', 'main']);
  configureUser(repo);
  git(repo, ['remote', 'add', 'origin', bare]);
  commitFile(repo, 'README.md', rootContent);
  return { repo, bare };
}

export function createBare() {
  const bare = fs.mkdtempSync(path.join(fixture.home, 'remote-'));
  git(bare, ['init', '-q', '--bare', '-b', 'main']);
  return bare;
}

export function configureUser(repo) {
  git(repo, ['config', 'user.email', 'test@example.com']);
  git(repo, ['config', 'user.name', 'Test User']);
}

export function commitFile(repo, name, content) {
  fs.writeFileSync(path.join(repo, name), content);
  git(repo, ['add', name]);
  git(repo, ['commit', '-q', '--no-verify', '-m', `add ${name}`]);
}

export function secretLine() {
  return `aws_access_key_id = ${AWS_KEY}\n`;
}

// Pushes from a shell with the goldband Git environment override applied, as
// the installed .zshenv block does. globalArgs go before `push`.
export function push(repo, args, extraEnv = {}, firstArgsAreGlobal = false) {
  const envFile = path.join(fixture.hooks, 'lib', 'git-config-env.sh');
  const command = firstArgsAreGlobal
    ? `git ${args.slice(0, 2).map(shellQuote).join(' ')} push ${args.slice(2).map(shellQuote).join(' ')}`
    : `git push ${args.map(shellQuote).join(' ')}`;
  return run(
    '/bin/sh',
    ['-c', `. "$1" "$2" && ${command}`, 'sh', envFile, fixture.hooks],
    {
      cwd: repo,
      env: { ...baseEnv(fixture.home), ...extraEnv },
    },
  );
}

export function remoteHas(bare, ref) {
  return (
    run('git', ['show-ref', '--verify', '-q', ref], {
      cwd: bare,
      env: baseEnv(fixture.home),
    }).status === 0
  );
}

export function git(cwd, args) {
  const result = run('git', args, { cwd, env: baseEnv(fixture.home) });
  assertEqual(result.status, 0, `git ${args.join(' ')}\n${result.stderr}`);
  return result.stdout.trim();
}

export function writeHook(dir, name, body) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  fs.writeFileSync(file, `#!/bin/sh\nset -e\n${body}\n`);
  fs.chmodSync(file, 0o755);
}

export function baseEnv(home) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) =>
        !key.startsWith('GIT_') &&
        !key.startsWith('GOLDBAND_') &&
        !key.startsWith('GITLEAKS_'),
    ),
  );
  return {
    ...env,
    HOME: home,
    ZDOTDIR: home,
    XDG_CONFIG_HOME: path.join(home, '.config'),
    XDG_STATE_HOME: path.join(home, 'state'),
    GIT_CONFIG_NOSYSTEM: '1',
  };
}

function requireGitleaks() {
  const result = run('gitleaks', ['version']);
  assertEqual(result.status, 0, 'gitleaks is required for these tests');
  console.log(`# gitleaks ${result.stdout.trim()}`);
}

export function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

export function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    encoding: 'utf8',
    env: options.env ?? process.env,
    input: options.input,
    maxBuffer: 64 * 1024 * 1024,
  });
}

export function assertBlocked(result, message, label = '') {
  const output = result.stdout + result.stderr;
  assertEqual(
    result.status === 0,
    false,
    `${label} expected push to fail\n${output}`,
  );
  assertIncludes(output, message);
  assertEqual(
    output.includes(AWS_KEY),
    false,
    `${label} unredacted key\n${output}`,
  );
}

export function assertPassed(result) {
  const output = result.stdout + result.stderr;
  assertEqual(result.status, 0, output);
  assertEqual(output.includes(AWS_KEY), false, `unredacted key\n${output}`);
}

export function assertEqual(actual, expected, message = '') {
  if (actual === expected) return;
  throw new Error(`expected ${expected}, got ${actual}\n${message}`);
}

export function assertIncludes(value, expected) {
  if (value.includes(expected)) return;
  throw new Error(`expected output to include ${expected}\n${value}`);
}

// A main branch of `count` commits on the root commit, each tagged, cloned
// into a fresh bare remote. `secret` adds a secret to the first commit.
export function createChainRepo({ count, secret = false }) {
  const { repo, bare } = createRepo();
  const blob = secret
    ? ['M 100644 inline conf.txt', dataBlock(secretLine())]
    : [];
  const root = git(repo, ['rev-parse', 'HEAD']);
  const stream = [];
  for (let index = 1; index <= count; index += 1) {
    stream.push(
      'commit refs/heads/main',
      `committer Test User <test@example.com> ${1700000000 + index} +0000`,
      dataBlock(`chain ${index}`),
      ...(index === 1 ? [`from ${root}`, ...blob] : []),
      '',
    );
  }
  const imported = run('git', ['fast-import', '--quiet'], {
    cwd: repo,
    env: baseEnv(path.dirname(repo)),
    input: stream.join('\n'),
  });
  assertEqual(imported.status, 0, imported.stderr);
  const chain = git(repo, ['rev-list', '--reverse', 'main'])
    .split('\n')
    .slice(1);
  const packed = chain.map((sha, index) => `${sha} refs/tags/t${index + 1}\n`);
  fs.appendFileSync(
    path.join(repo, '.git', 'packed-refs'),
    `# pack-refs with: peeled fully-peeled sorted\n${packed.sort(byRef).join('')}`,
  );
  fs.rmSync(bare, { recursive: true });
  git(path.dirname(bare), ['clone', '-q', '--bare', repo, bare]);
  return { repo, chain };
}

function dataBlock(text) {
  return `data ${Buffer.byteLength(text)}\n${text}`;
}

function byRef(left, right) {
  const name = (line) => line.slice(41);
  return name(left) < name(right) ? -1 : 1;
}
