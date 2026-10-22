import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const repoRoot = process.cwd();

const tests = [
  [
    'style gate installs materialized hooks outside the source checkout',
    testMaterializedInstall,
  ],
  [
    'style gate migrates the legacy source checkout hooksPath',
    testLegacySourcePathMigration,
  ],
  [
    'uninstall removes only Goldband-owned hooks',
    testUninstallPreservesForeignHooks,
  ],
  [
    'uninstall removes owned hooks after hooksPath changes',
    testUninstallAfterHooksPathChanges,
  ],
  [
    'uninstall recognizes owned hooks after the source checkout moves',
    testUninstallAfterSourceMoves,
  ],
  [
    'uninstall preserves a modified managed hook',
    testUninstallPreservesModifiedManagedHook,
  ],
  [
    'a foreign global hook is chained as <name>.local and restored',
    testForeignChainedHookPreserved,
  ],
  [
    'the shell override chains repository-local core.hooksPath hooks',
    testOverrideChainsRepositoryHooks,
  ],
  ['chained stdin hooks give every hook the same input', testChainedStdin],
  [
    'a global core.hooksPath does not name the repository hooks',
    testGlobalHooksPathIsNotRepositoryHooks,
  ],
  [
    'a zsh repository hook does not restore the override',
    testZshHookKeepsOverrideRemoved,
  ],
  [
    'a failing chained hook stops the chain and the Git command',
    testFailingChainedHookStops,
  ],
  [
    'the shell override is appended once to existing Git env config',
    testGitConfigEnvAppendsOnce,
  ],
];

// A pushed-ref line with an all-zero local SHA, which the secret gate skips.
const DELETION_LINE = `(delete) ${'0'.repeat(40)} refs/heads/main ${'1'.repeat(40)}`;

for (const [name, test] of tests) {
  test();
  console.log(`ok - ${name}`);
}

function testMaterializedInstall() {
  const fixture = createInstallerFixture();
  const result = installStyleGate(fixture);
  assertEqual(result.status, 0, result.stdout + result.stderr);

  const installedHooks = path.join(
    fixture.home,
    '.config',
    'goldband',
    'git-hooks',
  );
  assertEqual(globalHooksPath(fixture.home), installedHooks);
  assertFile(path.join(installedHooks, 'pre-commit'));
  assertFile(path.join(installedHooks, 'commit-msg'));
  assertFile(path.join(installedHooks, 'lib', 'project-hook.sh'));
  const ownershipRecord = fs
    .readFileSync(path.join(installedHooks, '.goldband-source'), 'utf8')
    .split('\n');
  assertEqual(ownershipRecord[0], fixture.root);
  assertIncludes(ownershipRecord.join('\n'), 'file\tpre-commit\t');
  assertIncludes(ownershipRecord.join('\n'), 'file\tcommit-msg\t');
  assertIncludes(ownershipRecord.join('\n'), 'file\tlib/project-hook.sh\t');
  assertEqual(ownershipRecord[1], 'schemaVersion=2');
  for (const hook of ['post-commit', 'pre-push', 'prepare-commit-msg']) {
    assertFile(path.join(installedHooks, hook));
    assertIncludes(ownershipRecord.join('\n'), `file\t${hook}\t`);
  }
  for (const file of ['pre-push', 'lib/gitleaks.toml']) {
    assertEqual(
      readText(installedHooks, file),
      readText(path.join(fixture.root, 'git-hooks'), file),
    );
    assertIncludes(ownershipRecord.join('\n'), `file\t${file}\t`);
  }
  assertEqual(
    fs.statSync(path.join(installedHooks, 'pre-push')).mode & 0o111,
    0o111,
  );
  assertEqual(
    fs.statSync(path.join(installedHooks, 'lib', 'gitleaks.toml')).mode & 0o111,
    0,
  );
  assertIncludes(result.stdout, 'gitleaks');
  assertIncludes(
    fs.readFileSync(path.join(fixture.home, '.zshenv'), 'utf8'),
    `${installedHooks}/lib/git-config-env.sh`,
  );
  assertEqual(
    fs.existsSync(path.join(fixture.root, 'git-hooks', 'post-checkout')),
    false,
  );
}

function testLegacySourcePathMigration() {
  const fixture = createInstallerFixture();
  const legacyLfsHook = path.join(fixture.root, 'git-hooks', 'post-checkout');
  fs.writeFileSync(legacyLfsHook, '#!/bin/sh\ngit lfs post-checkout "$@"\n');
  fs.chmodSync(legacyLfsHook, 0o755);
  run(
    'git',
    [
      'config',
      '--global',
      'core.hooksPath',
      path.join(fixture.root, 'git-hooks'),
    ],
    { env: fixtureEnv(fixture.home) },
  );

  const result = installStyleGate(fixture);
  assertEqual(result.status, 0, result.stdout + result.stderr);
  assertEqual(
    globalHooksPath(fixture.home),
    path.join(fixture.home, '.config', 'goldband', 'git-hooks'),
  );
  assertIncludes(result.stdout, '遷移');
  assertEqual(
    fs.readFileSync(
      path.join(
        fixture.home,
        '.config',
        'goldband',
        'git-hooks',
        'post-checkout.local',
      ),
      'utf8',
    ),
    fs.readFileSync(legacyLfsHook, 'utf8'),
  );
}

function testUninstallPreservesForeignHooks() {
  const fixture = createInstallerFixture();
  const install = installStyleGate(fixture);
  assertEqual(install.status, 0, install.stdout + install.stderr);

  const installedHooks = path.join(
    fixture.home,
    '.config',
    'goldband',
    'git-hooks',
  );
  const foreignHook = path.join(installedHooks, 'pre-push');
  fs.writeFileSync(foreignHook, '#!/bin/sh\ngit lfs pre-push "$@"\n');
  fs.chmodSync(foreignHook, 0o755);

  const result = run(
    'bash',
    [path.join(fixture.root, 'install.sh'), 'uninstall'],
    {
      cwd: fixture.root,
      env: fixtureEnv(fixture.home),
    },
  );
  assertEqual(result.status, 0, result.stdout + result.stderr);
  assertEqual(globalHooksPath(fixture.home), '');
  assertEqual(fs.existsSync(path.join(installedHooks, 'pre-commit')), false);
  assertEqual(fs.existsSync(path.join(installedHooks, 'commit-msg')), false);
  assertFile(foreignHook);
}

function testUninstallAfterHooksPathChanges() {
  const fixture = createInstallerFixture();
  const install = installStyleGate(fixture);
  assertEqual(install.status, 0, install.stdout + install.stderr);

  const installedHooks = path.join(
    fixture.home,
    '.config',
    'goldband',
    'git-hooks',
  );
  const foreignHook = path.join(installedHooks, 'pre-push');
  const replacementHooks = path.join(fixture.home, 'replacement-hooks');
  fs.writeFileSync(foreignHook, '#!/bin/sh\ngit lfs pre-push "$@"\n');
  fs.mkdirSync(replacementHooks);
  run('git', ['config', '--global', 'core.hooksPath', replacementHooks], {
    env: fixtureEnv(fixture.home),
  });

  const result = run(
    'bash',
    [path.join(fixture.root, 'install.sh'), 'uninstall'],
    {
      cwd: fixture.root,
      env: fixtureEnv(fixture.home),
    },
  );
  assertEqual(result.status, 0, result.stdout + result.stderr);
  assertEqual(globalHooksPath(fixture.home), replacementHooks);
  assertEqual(fs.existsSync(path.join(installedHooks, 'pre-commit')), false);
  assertEqual(fs.existsSync(path.join(installedHooks, 'commit-msg')), false);
  assertFile(foreignHook);
}

function testUninstallAfterSourceMoves() {
  const fixture = createInstallerFixture();
  const install = installStyleGate(fixture);
  assertEqual(install.status, 0, install.stdout + install.stderr);

  const installedHooks = path.join(
    fixture.home,
    '.config',
    'goldband',
    'git-hooks',
  );
  const foreignHook = path.join(installedHooks, 'pre-push');
  const movedRoot = `${fixture.root}-moved`;
  fs.writeFileSync(foreignHook, '#!/bin/sh\ngit lfs pre-push "$@"\n');
  fs.renameSync(fixture.root, movedRoot);

  const result = run(
    'bash',
    [path.join(movedRoot, 'install.sh'), 'uninstall'],
    {
      cwd: movedRoot,
      env: fixtureEnv(fixture.home),
    },
  );
  assertEqual(result.status, 0, result.stdout + result.stderr);
  assertEqual(globalHooksPath(fixture.home), '');
  assertEqual(fs.existsSync(path.join(installedHooks, 'pre-commit')), false);
  assertEqual(fs.existsSync(path.join(installedHooks, 'commit-msg')), false);
  assertFile(foreignHook);
}

function testUninstallPreservesModifiedManagedHook() {
  const fixture = createInstallerFixture();
  const install = installStyleGate(fixture);
  assertEqual(install.status, 0, install.stdout + install.stderr);

  const installedHooks = path.join(
    fixture.home,
    '.config',
    'goldband',
    'git-hooks',
  );
  const modifiedHook = path.join(installedHooks, 'pre-commit');
  fs.appendFileSync(modifiedHook, '\n# locally modified\n');

  const result = run(
    'bash',
    [path.join(fixture.root, 'install.sh'), 'uninstall'],
    {
      cwd: fixture.root,
      env: fixtureEnv(fixture.home),
    },
  );
  assertEqual(result.status, 0, result.stdout + result.stderr);
  assertEqual(globalHooksPath(fixture.home), '');
  assertFile(modifiedHook);
  assertEqual(fs.existsSync(path.join(installedHooks, 'commit-msg')), false);
  assertIncludes(result.stdout, 'installed hook 已修改');
}

function testForeignChainedHookPreserved() {
  const fixture = createInstallerFixture();
  const installedHooks = hooksDir(fixture.home);
  const foreign = '#!/bin/sh\ngit lfs post-checkout "$@"\n';
  fs.mkdirSync(installedHooks, { recursive: true });
  fs.writeFileSync(path.join(installedHooks, 'post-checkout'), foreign);
  fs.chmodSync(path.join(installedHooks, 'post-checkout'), 0o755);

  const install = installStyleGate(fixture);
  assertEqual(install.status, 0, install.stdout + install.stderr);
  assertEqual(readText(installedHooks, 'post-checkout.local'), foreign);
  assertIncludes(readText(installedHooks, 'post-checkout'), 'goldband');

  const reinstall = installStyleGate(fixture);
  assertEqual(reinstall.status, 0, reinstall.stdout + reinstall.stderr);
  assertEqual(readText(installedHooks, 'post-checkout.local'), foreign);

  const result = run(
    'bash',
    [path.join(fixture.root, 'install.sh'), 'uninstall'],
    { cwd: fixture.root, env: fixtureEnv(fixture.home) },
  );
  assertEqual(result.status, 0, result.stdout + result.stderr);
  assertEqual(readText(installedHooks, 'post-checkout'), foreign);
  assertEqual(
    fs.existsSync(path.join(installedHooks, 'post-checkout.local')),
    false,
  );
  assertEqual(readText(fixture.home, '.zshenv').includes('goldband'), false);
}

function testOverrideChainsRepositoryHooks() {
  const fixture = createInstallerFixture();
  const install = installStyleGate(fixture);
  assertEqual(install.status, 0, install.stdout + install.stderr);
  const installedHooks = hooksDir(fixture.home);
  const { repo, log } = createHookedRepo(fixture.home);
  writeHook(
    installedHooks,
    'post-commit.local',
    `echo preserved-post-commit >> "${log}"`,
  );
  const gateStub = path.join(fixture.home, 'gate-stub.cjs');
  fs.writeFileSync(
    gateStub,
    `require('node:fs').appendFileSync(${JSON.stringify(log)}, 'goldband\\n');\n`,
  );

  const result = runWithOverride(fixture.home, repo, 'git commit -q -m init', {
    GOLDBAND_STYLE_GATE_SCRIPT: gateStub,
  });
  assertEqual(result.status, 0, result.stdout + result.stderr);
  assertEqual(
    fs.readFileSync(log, 'utf8'),
    [
      'goldband',
      'project-pre-commit custom-hooks',
      'project-commit-msg',
      'preserved-post-commit',
      'project-post-commit',
      '',
    ].join('\n'),
  );
}

function testChainedStdin() {
  const fixture = createInstallerFixture();
  const install = installStyleGate(fixture);
  assertEqual(install.status, 0, install.stdout + install.stderr);
  const installedHooks = hooksDir(fixture.home);
  const { repo, log } = createHookedRepo(fixture.home);
  writeHook(
    installedHooks,
    'pre-push.local',
    `sed 's/^/preserved /' >> "${log}"`,
  );
  writeHook(
    path.join(repo, 'custom-hooks'),
    'pre-push',
    `sed 's/^/project /' >> "${log}"`,
  );

  const result = run(path.join(installedHooks, 'pre-push'), ['origin', 'url'], {
    cwd: repo,
    env: fixtureEnv(fixture.home),
    input: `${DELETION_LINE}\n`,
  });
  assertEqual(result.status, 0, result.stdout + result.stderr);
  assertEqual(
    fs.readFileSync(log, 'utf8'),
    `preserved ${DELETION_LINE}\nproject ${DELETION_LINE}\n`,
  );
}

function testGlobalHooksPathIsNotRepositoryHooks() {
  const fixture = createInstallerFixture();
  const install = installStyleGate(fixture);
  assertEqual(install.status, 0, install.stdout + install.stderr);
  const { repo, log } = createHookedRepo(fixture.home);
  const env = { cwd: repo, env: fixtureEnv(fixture.home) };
  run('git', ['config', '--unset', 'core.hooksPath'], env);
  writeHook(
    path.join(repo, '.git', 'hooks'),
    'post-commit',
    `echo default-post-commit >> "${log}"`,
  );

  // A second copy runs while global core.hooksPath names the installed one.
  const otherHooks = path.join(fixture.home, 'other-hooks');
  fs.cpSync(hooksDir(fixture.home), otherHooks, { recursive: true });
  const result = run(path.join(otherHooks, 'post-commit'), [], env);
  assertEqual(result.status, 0, result.stdout + result.stderr);
  assertEqual(fs.readFileSync(log, 'utf8'), 'default-post-commit\n');
}

function testZshHookKeepsOverrideRemoved() {
  if (run('sh', ['-c', 'command -v zsh']).status !== 0) return;
  const fixture = createInstallerFixture();
  const install = installStyleGate(fixture);
  assertEqual(install.status, 0, install.stdout + install.stderr);
  const { repo, log } = createHookedRepo(fixture.home);
  const hook = path.join(repo, 'custom-hooks', 'pre-commit');
  fs.writeFileSync(
    hook,
    `#!/usr/bin/env zsh\necho "zsh $(git config core.hooksPath)" >> "${log}"\n`,
  );

  const result = runWithOverride(fixture.home, repo, 'git commit -q -m init', {
    GOLDBAND_STYLE_GATE: '0',
  });
  assertEqual(result.status, 0, result.stdout + result.stderr);
  assertIncludes(fs.readFileSync(log, 'utf8'), 'zsh custom-hooks\n');
}

function testFailingChainedHookStops() {
  const fixture = createInstallerFixture();
  const install = installStyleGate(fixture);
  assertEqual(install.status, 0, install.stdout + install.stderr);
  const installedHooks = hooksDir(fixture.home);
  const { repo, log } = createHookedRepo(fixture.home);
  writeHook(installedHooks, 'pre-push.local', `cat >/dev/null; exit 3`);
  writeHook(
    path.join(repo, 'custom-hooks'),
    'pre-push',
    `echo project-pre-push >> "${log}"`,
  );

  const push = run(path.join(installedHooks, 'pre-push'), ['origin', 'url'], {
    cwd: repo,
    env: fixtureEnv(fixture.home),
    input: `${DELETION_LINE}\n`,
  });
  assertEqual(push.status, 3, push.stdout + push.stderr);
  assertEqual(fs.existsSync(log), false);

  writeHook(path.join(repo, 'custom-hooks'), 'pre-commit', 'exit 1');
  const commit = runWithOverride(fixture.home, repo, 'git commit -q -m init', {
    GOLDBAND_STYLE_GATE: '0',
  });
  assertEqual(commit.status === 0, false, commit.stdout + commit.stderr);
  assertEqual(fs.existsSync(log), false);
  assertEqual(
    run('git', ['rev-parse', '--verify', '-q', 'HEAD'], {
      cwd: repo,
      env: fixtureEnv(fixture.home),
    }).status,
    1,
  );
}

function testGitConfigEnvAppendsOnce() {
  const envFile = path.join(repoRoot, 'git-hooks', 'lib', 'git-config-env.sh');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'goldband-env-'));
  for (const shell of ['sh', 'zsh']) {
    if (run('sh', ['-c', `command -v ${shell}`]).status !== 0) continue;
    const result = run(
      shell,
      [
        '-c',
        `f="$1"; set -- "$2"; . "$f"; . "$f"; env | grep '^GIT_CONFIG_' | sort`,
        shell,
        envFile,
        dir,
      ],
      {
        env: {
          PATH: process.env.PATH,
          HOME: dir,
          ZDOTDIR: dir,
          GIT_CONFIG_COUNT: '1',
          GIT_CONFIG_KEY_0: 'user.name',
          GIT_CONFIG_VALUE_0: 'Kept',
        },
      },
    );
    assertEqual(result.status, 0, result.stderr);
    assertEqual(
      result.stdout,
      [
        'GIT_CONFIG_COUNT=2',
        'GIT_CONFIG_KEY_0=user.name',
        'GIT_CONFIG_KEY_1=core.hooksPath',
        'GIT_CONFIG_VALUE_0=Kept',
        `GIT_CONFIG_VALUE_1=${dir}`,
        '',
      ].join('\n'),
      shell,
    );
  }
}

// A repository whose local core.hooksPath names its own hook directory. Each
// project hook appends to the returned log; pre-commit also records the
// core.hooksPath it observes.
function createHookedRepo(home) {
  const repo = fs.mkdtempSync(path.join(home, 'repo-'));
  const log = path.join(home, 'hooks.log');
  const env = { env: fixtureEnv(home), cwd: repo };
  run('git', ['init', '-q'], env);
  run('git', ['config', 'user.email', 'test@example.com'], env);
  run('git', ['config', 'user.name', 'Test User'], env);
  run('git', ['config', 'core.hooksPath', 'custom-hooks'], env);
  const projectHooks = path.join(repo, 'custom-hooks');
  fs.mkdirSync(projectHooks);
  writeHook(
    projectHooks,
    'pre-commit',
    `echo "project-pre-commit $(git config core.hooksPath)" >> "${log}"`,
  );
  writeHook(projectHooks, 'commit-msg', `echo project-commit-msg >> "${log}"`);
  writeHook(
    projectHooks,
    'post-commit',
    `echo project-post-commit >> "${log}"`,
  );
  fs.writeFileSync(path.join(repo, 'README.md'), 'hello\n');
  run('git', ['add', 'README.md'], env);
  return { repo, log };
}

function runWithOverride(home, cwd, command, extraEnv = {}) {
  const envFile = path.join(hooksDir(home), 'lib', 'git-config-env.sh');
  return run(
    'sh',
    // POSIX `.` passes no arguments; the sourced file reads the caller's $1.
    [
      '-c',
      `f="$1"; set -- "$2"; . "$f" && ${command}`,
      'sh',
      envFile,
      hooksDir(home),
    ],
    { cwd, env: { ...fixtureEnv(home), ...extraEnv } },
  );
}

function writeHook(dir, name, body) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, `#!/bin/sh\nset -e\n${body}\n`);
  fs.chmodSync(file, 0o755);
}

function hooksDir(home) {
  return path.join(home, '.config', 'goldband', 'git-hooks');
}

function readText(dir, name) {
  return fs.readFileSync(path.join(dir, name), 'utf8');
}

function createInstallerFixture() {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'goldband-style-installer-'),
  );
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'goldband-style-home-'));
  fs.copyFileSync(
    path.join(repoRoot, 'install.sh'),
    path.join(root, 'install.sh'),
  );
  fs.cpSync(path.join(repoRoot, 'shell'), path.join(root, 'shell'), {
    recursive: true,
  });
  fs.cpSync(path.join(repoRoot, 'git-hooks'), path.join(root, 'git-hooks'), {
    recursive: true,
    filter: (source) =>
      !['post-checkout', 'post-commit', 'post-merge'].includes(
        path.basename(source),
      ),
  });
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  fs.copyFileSync(
    path.join(repoRoot, 'scripts', 'check-goldband-project-style-gate.mjs'),
    path.join(root, 'scripts', 'check-goldband-project-style-gate.mjs'),
  );
  return { root, home };
}

function installStyleGate(fixture) {
  return run('bash', [path.join(fixture.root, 'install.sh'), 'style-gate'], {
    cwd: fixture.root,
    env: fixtureEnv(fixture.home),
  });
}

function globalHooksPath(home) {
  return run('git', ['config', '--global', '--get', 'core.hooksPath'], {
    env: fixtureEnv(home),
  }).stdout.trim();
}

function fixtureEnv(home) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !key.startsWith('GIT_CONFIG_') && !key.startsWith('GOLDBAND_'),
    ),
  );
  return {
    ...env,
    HOME: home,
    ZDOTDIR: home,
    XDG_CONFIG_HOME: path.join(home, '.config'),
  };
}

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    encoding: 'utf8',
    env: options.env ?? process.env,
    input: options.input,
  });
}

function assertFile(file) {
  if (fs.statSync(file).isFile()) return;
  throw new Error(`expected regular file: ${file}`);
}

function assertEqual(actual, expected, message = '') {
  if (actual === expected) return;
  throw new Error(`expected ${expected}, got ${actual}\n${message}`);
}

function assertIncludes(value, expected) {
  if (value.includes(expected)) return;
  throw new Error(`expected output to include ${expected}\n${value}`);
}
