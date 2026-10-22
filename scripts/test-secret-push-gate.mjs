import fs from 'node:fs';
import path from 'node:path';
import {
  AWS_KEY,
  assertBlocked,
  assertEqual,
  assertFile,
  assertIncludes,
  assertPassed,
  baseEnv,
  commitFile,
  configureUser,
  createBare,
  createChainRepo,
  createInstallerFixture,
  createRepo,
  git,
  hooksDir,
  installStyleGate,
  NO_GITLEAKS_PATH,
  push,
  readText,
  remoteHas,
  run,
  secretLine,
  setupSecretPushFixture,
  shellQuote,
  writeHook,
} from './lib/secret-push-fixture.mjs';
import {
  testEvilMergeBlocks,
  testIgnoredMergedFindingPasses,
  testOctopusMergeBlocks,
} from './lib/secret-push-merges.mjs';

// Exercises the installed pre-push secret gate with real gitleaks, real pushes,
// and local bare remotes.

const ZERO = '0'.repeat(40);

const tests = [
  ['a pushed AWS key blocks with redacted output', testSecretBlocks],
  ['a clean push passes', testCleanPushPasses],
  [
    'a commit another remote tracks is scanned for a new branch',
    testOtherRemoteTrackingRefIgnored,
  ],
  [
    'a stale tracking ref of an emptied destination is ignored',
    testStaleTrackingRefIgnored,
  ],
  ['an unknown remote SHA scans the advertised difference', testUnknownRemote],
  ['a failing ls-remote scans the full history', testLsRemoteFailure],
  [
    'a destination advertising 50,000 refs scans only the new commits',
    testManyAdvertisedRefs,
  ],
  [
    'a boundary too large for one argument scans the full history',
    testBoundaryFallback,
  ],
  [
    'repository and environment gitleaks configs are ignored',
    testRepositoryConfigIgnored,
  ],
  ['a -diff attribute does not hide the secret', testDiffAttribute],
  ['inline gitleaks:allow does not apply', testInlineAllowIgnored],
  [
    'git config that changes log output does not hide the secret',
    testLogConfigNeutralized,
  ],
  ['a replace ref does not hide the secret commit', testReplaceRefIgnored],
  ['grafts do not hide the secret commit', testGraftsIgnored],
  ['a secret a merge commit introduces blocks', testEvilMergeBlocks],
  [
    'a merge of an ignored side-branch finding passes',
    testIgnoredMergedFindingPasses,
  ],
  ['an octopus merge is a scan failure', testOctopusMergeBlocks],
  ['a missing blob is a scan failure', testMissingBlob],
  ['a missing or modified baseline is a scan failure', testBaselineIntegrity],
  ['a .gitleaksignore fingerprint passes', testGitleaksIgnore],
  ['style gate opt-outs do not disable the secret gate', testStyleOptOuts],
  ['a deletion push is not scanned', testDeletionNotScanned],
  ['missing gitleaks blocks', testMissingGitleaks],
  ['GOLDBAND_SECRET_GATE=0 bypasses with a log entry', testBypassLogged],
  [
    'the preserved and project pre-push hooks receive the full stdin',
    testProjectHookStdin,
  ],
  [
    'the chained pre-push hook keeps the caller environment',
    testChainedHookEnvironment,
  ],
  [
    'a chain-only pre-push install upgrades to the secret gate hook',
    testChainOnlyPrePushUpgrade,
  ],
  [
    'a foreign global pre-push is chained as pre-push.local and restored',
    testForeignPrePushPreserved,
  ],
  ['install warns when gitleaks is missing', testMissingGitleaksWarning],
];

const fixture = setupSecretPushFixture();
for (const [name, test] of tests) {
  test();
  console.log(`ok - ${name}`);
}

function testSecretBlocks() {
  const { repo, bare } = createRepo();
  commitFile(repo, 'conf.txt', secretLine());
  const result = push(repo, ['origin', 'main']);
  assertBlocked(result, 'gitleaks found secrets');
  assertIncludes(result.stderr, 'aws-access-token');
  assertIncludes(result.stderr, 'REDACTED');
  assertEqual(remoteHas(bare, 'refs/heads/main'), false);
}

function testCleanPushPasses() {
  const { repo, bare } = createRepo();
  commitFile(repo, 'notes.txt', 'nothing to see\n');
  const result = push(repo, ['origin', 'main']);
  assertPassed(result);
  assertEqual(remoteHas(bare, 'refs/heads/main'), true);
}

function testOtherRemoteTrackingRefIgnored() {
  const { repo } = createRepo();
  const other = createBare();
  git(repo, ['remote', 'add', 'other', other]);
  assertPassed(push(repo, ['origin', 'main']));
  assertPassed(push(repo, ['other', 'main']));
  commitFile(repo, 'conf.txt', secretLine());
  assertPassed(push(repo, ['other', 'main'], { GOLDBAND_SECRET_GATE: '0' }));
  git(repo, ['fetch', '-q', 'other']);
  assertEqual(
    git(repo, ['rev-parse', 'refs/remotes/other/main']),
    git(repo, ['rev-parse', 'HEAD']),
  );

  commitFile(repo, 'notes.txt', 'clean follow-up\n');
  const result = push(repo, ['origin', 'HEAD:refs/heads/feature']);
  assertBlocked(result, 'gitleaks found secrets');
}

function testStaleTrackingRefIgnored() {
  const { repo, bare } = createRepo();
  commitFile(repo, 'conf.txt', secretLine());
  assertPassed(push(repo, ['origin', 'main'], { GOLDBAND_SECRET_GATE: '0' }));
  git(bare, ['update-ref', '-d', 'refs/heads/main']);
  assertEqual(git(bare, ['for-each-ref']), '');
  assertEqual(
    git(repo, ['rev-parse', 'refs/remotes/origin/main']),
    git(repo, ['rev-parse', 'HEAD']),
  );

  commitFile(repo, 'notes.txt', 'clean follow-up\n');
  const result = push(repo, ['origin', 'HEAD:refs/heads/feature']);
  assertBlocked(result, 'gitleaks found secrets');
}

function testUnknownRemote() {
  const { repo, bare } = createRepo();
  assertPassed(push(repo, ['origin', 'main']));
  const clone = fs.mkdtempSync(path.join(fixture.home, 'clone-'));
  git(fixture.home, ['clone', '-q', bare, clone]);
  configureUser(clone);
  commitFile(clone, 'remote-only.txt', 'pushed elsewhere\n');
  assertPassed(push(clone, ['origin', 'main']));

  commitFile(repo, 'conf.txt', secretLine());
  const result = push(repo, ['--force', 'origin', 'main']);
  assertBlocked(result, 'gitleaks found secrets');
}

function testLsRemoteFailure() {
  const { repo, bare } = createRepo();
  commitFile(repo, 'conf.txt', secretLine());
  assertPassed(push(repo, ['origin', 'main'], { GOLDBAND_SECRET_GATE: '0' }));

  // Pushes reach the bare repository while ls-remote on the URL fails.
  const unreachable = path.join(fixture.home, 'missing', 'remote.git');
  git(repo, ['remote', 'add', 'broken', unreachable]);
  git(repo, [
    'config',
    'remote.broken.receivepack',
    `sh -c 'exec git receive-pack "$1"' receive-pack ${shellQuote(bare)}`,
  ]);
  commitFile(repo, 'notes.txt', 'clean follow-up\n');
  const result = push(repo, ['broken', 'HEAD:refs/heads/feature']);
  assertIncludes(result.stderr, 'ls-remote broken failed');
  assertBlocked(result, 'gitleaks found secrets');

  // Control: the same push through a reachable URL sends only the clean commit.
  assertPassed(push(repo, ['origin', 'HEAD:refs/heads/feature']));
}

// Passing every advertised commit as an argument exceeds ARG_MAX here.
function testManyAdvertisedRefs() {
  const { repo, chain } = createChainRepo({ count: 50000 });
  const copy = push(repo, ['origin', 'main:refs/heads/copy']);
  assertPassed(copy);
  assertEqual(copy.stderr.includes('commits scanned'), false, copy.stderr);
  commitFile(repo, 'notes.txt', 'clean on top\n');
  assertPassed(push(repo, ['origin', 'HEAD:refs/heads/feature']));

  commitFile(repo, 'conf.txt', secretLine());
  const result = push(repo, ['origin', `HEAD:refs/heads/t${chain.length}`]);
  assertBlocked(result, 'gitleaks found secrets in 1 commit(s)');
}

// Each parent of an octopus merge is a boundary commit; 2,500 of them exceed
// the hook's exclusion limit. The secret is in history the destination has,
// so only a full history scan finds it.
function testBoundaryFallback() {
  const { repo, chain } = createChainRepo({ count: 2600, secret: true });
  const tree = git(repo, ['rev-parse', 'HEAD^{tree}']);
  // Two-parent merges, since the gate refuses octopus merges; each brings in
  // one more boundary commit.
  const merge = (parents) =>
    parents
      .slice(1)
      .reduce(
        (tip, sha) =>
          git(repo, ['commit-tree', tree, '-m', 'merge', '-p', tip, '-p', sha]),
        parents[0],
      );

  const small = push(repo, [
    'origin',
    `${merge(chain.slice(0, 100))}:refs/heads/small`,
  ]);
  assertPassed(small);
  assertEqual(small.stderr.includes('too many boundary commits'), false);

  const tip = merge(chain.slice(0, 2500));
  const reachable = git(repo, ['rev-list', '--count', tip]);
  const large = push(repo, ['origin', `${tip}:refs/heads/large`]);
  assertIncludes(large.stderr, 'too many boundary commits to exclude');
  assertBlocked(large, `gitleaks found secrets in ${reachable} commit(s)`);
}

// A linear history of `count` commits, each tagged, that the destination
// already has; the first commit holds a secret when `secret` is set. Refs go
// into packed-refs directly: a loose ref per commit is slow to create.
function testRepositoryConfigIgnored() {
  const { repo } = createRepo();
  const permissive =
    '[[rules]]\nid = "unrelated"\nregex = "zzzz"\n[allowlist]\npaths = [".*"]\n';
  fs.writeFileSync(path.join(repo, '.gitleaks.toml'), permissive);
  git(repo, ['add', '.gitleaks.toml']);
  commitFile(repo, 'conf.txt', secretLine());
  const result = push(repo, ['origin', 'main'], {
    GITLEAKS_CONFIG: path.join(repo, '.gitleaks.toml'),
    GITLEAKS_CONFIG_TOML: permissive,
  });
  assertBlocked(result, 'gitleaks found secrets');
}

function testDiffAttribute() {
  const { repo } = createRepo();
  fs.writeFileSync(path.join(repo, '.gitattributes'), 'conf.txt -diff\n');
  git(repo, ['add', '.gitattributes']);
  commitFile(repo, 'conf.txt', secretLine());
  assertIncludes(
    git(repo, ['show', '--format=', 'HEAD', '--', 'conf.txt']),
    'Binary files',
  );
  assertBlocked(push(repo, ['origin', 'main']), 'gitleaks found secrets');
}

function testInlineAllowIgnored() {
  const { repo } = createRepo();
  commitFile(
    repo,
    'conf.txt',
    `aws_access_key_id = ${AWS_KEY} # gitleaks:allow\n`,
  );
  assertBlocked(push(repo, ['origin', 'main']), 'gitleaks found secrets');
}

function testLogConfigNeutralized() {
  // A secret in the root commit, hidden from git log -p by log.showRoot=false.
  const { repo } = createRepo({ rootContent: secretLine() });
  git(repo, ['config', 'color.ui', 'always']);
  git(repo, ['config', 'color.diff', 'always']);
  git(repo, ['config', 'log.showRoot', 'false']);
  assertBlocked(push(repo, ['origin', 'main']), 'gitleaks found secrets');

  const second = createRepo();
  commitFile(second.repo, 'conf.txt', secretLine());
  assertBlocked(
    push(second.repo, ['-c', 'color.ui=always', 'origin', 'main'], {}, true),
    'gitleaks found secrets',
  );
}

function testReplaceRefIgnored() {
  const { repo, bare } = createRepo();
  commitFile(repo, 'conf.txt', secretLine());
  const secret = git(repo, ['rev-parse', 'HEAD']);
  const clean = git(repo, [
    'commit-tree',
    'HEAD~1^{tree}',
    '-p',
    'HEAD~1',
    '-m',
    'clean',
  ]);
  git(repo, ['replace', secret, clean]);
  assertEqual(git(repo, ['log', '-p', 'main']).includes(AWS_KEY), false);
  assertBlocked(push(repo, ['origin', 'main']), 'gitleaks found secrets');
  assertEqual(remoteHas(bare, 'refs/heads/main'), false);
}

function testGraftsIgnored() {
  // Grafting the removal commit onto the root hides the commit that adds the
  // secret from git log.
  const { repo, bare } = createRepo();
  const root = git(repo, ['rev-parse', 'HEAD']);
  commitFile(repo, 'conf.txt', secretLine());
  git(repo, ['rm', '-q', 'conf.txt']);
  git(repo, ['commit', '-q', '--no-verify', '-m', 'remove conf.txt']);
  const removal = git(repo, ['rev-parse', 'HEAD']);
  git(repo, ['config', 'advice.graftFileDeprecated', 'false']);
  fs.writeFileSync(
    path.join(repo, '.git', 'info', 'grafts'),
    `${removal} ${root}\n`,
  );
  assertEqual(git(repo, ['rev-list', '--count', 'main']), '2');
  assertBlocked(push(repo, ['origin', 'main']), 'gitleaks found secrets');
  assertEqual(remoteHas(bare, 'refs/heads/main'), false);
}

// git log omits merge diffs unless asked; content only the merge adds counts.
function testMissingBlob() {
  const { repo } = createRepo();
  commitFile(repo, 'notes.txt', 'clean but unreadable\n');
  const blob = git(repo, ['rev-parse', 'HEAD:notes.txt']);
  fs.rmSync(
    path.join(repo, '.git', 'objects', blob.slice(0, 2), blob.slice(2)),
  );
  assertEqual(git(repo, ['rev-list', '--count', 'HEAD']), '2');
  const result = push(repo, ['origin', 'main']);
  assertBlocked(result, 'secret scan failed');
  assertIncludes(result.stderr, 'gitleaks reported errors');
}

function testBaselineIntegrity() {
  const baseline = path.join(fixture.hooks, 'lib', 'gitleaks.toml');
  const original = fs.readFileSync(baseline, 'utf8');
  const variants = [
    ['missing', null],
    ['unparsable', '[extend\nuseDefault = tru\n'],
    ['without rules', 'title = "no rules"\n'],
  ];
  try {
    for (const [label, content] of variants) {
      if (content === null) fs.rmSync(baseline);
      else fs.writeFileSync(baseline, content);
      const { repo } = createRepo();
      commitFile(repo, 'notes.txt', 'clean\n');
      const result = push(repo, ['origin', 'main']);
      assertBlocked(result, 'secret scan failed', label);
      assertIncludes(result.stderr, 'baseline rules missing or modified');
    }
  } finally {
    fs.writeFileSync(baseline, original);
  }
}

function testGitleaksIgnore() {
  const { repo, bare } = createRepo();
  commitFile(repo, 'conf.txt', secretLine());
  const head = git(repo, ['rev-parse', 'HEAD']);
  assertBlocked(push(repo, ['origin', 'main']), 'gitleaks found secrets');
  fs.writeFileSync(
    path.join(repo, '.gitleaksignore'),
    `${head}:conf.txt:aws-access-token:1\n`,
  );
  assertPassed(push(repo, ['origin', 'main']));
  assertEqual(remoteHas(bare, 'refs/heads/main'), true);
}

function testStyleOptOuts() {
  const { repo } = createRepo();
  fs.writeFileSync(path.join(repo, '.goldband-no-style-gate'), '');
  commitFile(repo, 'conf.txt', secretLine());
  const result = push(repo, ['origin', 'main'], { GOLDBAND_STYLE_GATE: '0' });
  assertBlocked(result, 'gitleaks found secrets');
}

function testDeletionNotScanned() {
  const { repo, bare } = createRepo();
  commitFile(repo, 'conf.txt', secretLine());
  assertPassed(push(repo, ['origin', 'main'], { GOLDBAND_SECRET_GATE: '0' }));
  assertPassed(push(repo, ['origin', 'main:refs/heads/old']));
  assertEqual(remoteHas(bare, 'refs/heads/old'), true);
  // Without gitleaks on PATH any attempted scan would block.
  const result = push(repo, ['origin', ':refs/heads/old'], {
    PATH: NO_GITLEAKS_PATH,
  });
  assertPassed(result);
  assertEqual(remoteHas(bare, 'refs/heads/old'), false);
}

function testMissingGitleaks() {
  const { repo } = createRepo();
  commitFile(repo, 'notes.txt', 'clean\n');
  const result = push(repo, ['origin', 'main'], { PATH: NO_GITLEAKS_PATH });
  assertBlocked(result, 'gitleaks not found');
}

function testBypassLogged() {
  const { repo, bare } = createRepo();
  const log = path.join(
    fixture.home,
    'state',
    'goldband',
    'secret-gate-bypass.log',
  );
  fs.rmSync(log, { force: true });
  commitFile(repo, 'conf.txt', secretLine());
  const result = push(repo, ['origin', 'main'], { GOLDBAND_SECRET_GATE: '0' });
  assertPassed(result);
  assertIncludes(
    result.stderr,
    'secret gate bypassed with GOLDBAND_SECRET_GATE=0',
  );
  assertEqual(remoteHas(bare, 'refs/heads/main'), true);
  const entry = fs.readFileSync(log, 'utf8').trim().split('\t');
  assertEqual(entry.length, 3);
  assertEqual(entry[1], fs.realpathSync(repo));
  assertEqual(entry[2], 'GOLDBAND_SECRET_GATE=0');
}

function testProjectHookStdin() {
  const { repo, bare } = createRepo();
  const log = path.join(fixture.home, `pre-push-${path.basename(repo)}.log`);
  git(repo, ['config', 'core.hooksPath', 'custom-hooks']);
  writeHook(
    path.join(repo, 'custom-hooks'),
    'pre-push',
    `{ echo "project $1 $2"; cat; } >> "${log}"`,
  );
  writeHook(
    fixture.hooks,
    'pre-push.local',
    `{ echo "preserved $1 $2"; cat; } >> "${log}"`,
  );
  try {
    assertPassed(push(repo, ['origin', 'main', 'main:refs/heads/old']));
    git(repo, ['branch', 'second']);
    commitFile(repo, 'notes.txt', 'clean\n');
    fs.rmSync(log);
    assertPassed(push(repo, ['origin', 'main', 'second', ':refs/heads/old']));
    const main = git(repo, ['rev-parse', 'main']);
    const second = git(repo, ['rev-parse', 'second']);
    const previous = git(repo, ['rev-parse', 'main~1']);
    const stdin = [
      `refs/heads/main ${main} refs/heads/main ${previous}`,
      `refs/heads/second ${second} refs/heads/second ${ZERO}`,
      `(delete) ${ZERO} refs/heads/old ${previous}`,
    ];
    const lines = fs.readFileSync(log, 'utf8').trim().split('\n');
    assertEqual(lines[0], `preserved origin ${bare}`);
    const preservedInput = lines.slice(
      1,
      lines.indexOf(`project origin ${bare}`),
    );
    const projectInput = lines.slice(
      lines.indexOf(`project origin ${bare}`) + 1,
    );
    assertEqual(preservedInput.sort().join('\n'), stdin.sort().join('\n'));
    assertEqual(projectInput.sort().join('\n'), stdin.sort().join('\n'));
  } finally {
    fs.rmSync(path.join(fixture.hooks, 'pre-push.local'), { force: true });
  }
}

function testChainedHookEnvironment() {
  const { repo } = createRepo();
  const log = path.join(fixture.home, `env-${path.basename(repo)}.log`);
  const graftFile = path.join(fixture.home, `grafts-${path.basename(repo)}`);
  fs.writeFileSync(graftFile, '');
  writeHook(
    path.join(repo, '.git', 'hooks'),
    'pre-push',
    `echo "\${GIT_NO_REPLACE_OBJECTS-unset} \${GIT_GRAFT_FILE-unset}" > "${log}"`,
  );
  assertPassed(push(repo, ['origin', 'main'], { GIT_GRAFT_FILE: graftFile }));
  assertEqual(fs.readFileSync(log, 'utf8'), `unset ${graftFile}\n`);
}

// --- installer ---

function testChainOnlyPrePushUpgrade() {
  const fixture = createInstallerFixture();
  const install = installStyleGate(fixture);
  assertEqual(install.status, 0, install.stdout + install.stderr);
  const installedHooks = hooksDir(fixture.home);

  // Rewrite the runtime into the earlier layout: pre-push is a recorded copy of
  // the chain-only hook and no baseline rules exist.
  const chainHook = path.join(fixture.root, 'git-hooks', 'lib', 'chain-hook');
  fs.copyFileSync(chainHook, path.join(installedHooks, 'pre-push'));
  fs.rmSync(path.join(installedHooks, 'lib', 'gitleaks.toml'));
  const [checksum, bytes] = run('cksum', [chainHook]).stdout.trim().split(' ');
  const markerPath = path.join(installedHooks, '.goldband-source');
  const marker = fs
    .readFileSync(markerPath, 'utf8')
    .split('\n')
    .filter((line) => !line.startsWith('file\tlib/gitleaks.toml\t'))
    .map((line) =>
      line.startsWith('file\tpre-push\t')
        ? `file\tpre-push\t${checksum}\t${bytes}`
        : line,
    );
  fs.writeFileSync(markerPath, marker.join('\n'));
  assertIncludes(
    statusOutput(fixture),
    'Git style gate runtime 與目前 repo 不一致',
  );

  const reinstall = installStyleGate(fixture);
  assertEqual(reinstall.status, 0, reinstall.stdout + reinstall.stderr);
  assertEqual(
    readText(installedHooks, 'pre-push'),
    readText(path.join(fixture.root, 'git-hooks'), 'pre-push'),
  );
  assertEqual(
    fs.existsSync(path.join(installedHooks, 'pre-push.local')),
    false,
  );
  assertFile(path.join(installedHooks, 'lib', 'gitleaks.toml'));
  assertStatusCurrent(fixture);
}

function testForeignPrePushPreserved() {
  const fixture = createInstallerFixture();
  const installedHooks = hooksDir(fixture.home);
  const foreign = '#!/bin/sh\ngit lfs pre-push "$@"\n';
  fs.mkdirSync(installedHooks, { recursive: true });
  fs.writeFileSync(path.join(installedHooks, 'pre-push'), foreign);
  fs.chmodSync(path.join(installedHooks, 'pre-push'), 0o755);

  const install = installStyleGate(fixture);
  assertEqual(install.status, 0, install.stdout + install.stderr);
  assertEqual(readText(installedHooks, 'pre-push.local'), foreign);
  assertEqual(
    readText(installedHooks, 'pre-push'),
    readText(path.join(fixture.root, 'git-hooks'), 'pre-push'),
  );
  assertIncludes(assertStatusCurrent(fixture), 'pre-push.local');

  const reinstall = installStyleGate(fixture);
  assertEqual(reinstall.status, 0, reinstall.stdout + reinstall.stderr);
  assertEqual(readText(installedHooks, 'pre-push.local'), foreign);

  const result = run(
    'bash',
    [path.join(fixture.root, 'install.sh'), 'uninstall'],
    { cwd: fixture.root, env: baseEnv(fixture.home) },
  );
  assertEqual(result.status, 0, result.stdout + result.stderr);
  assertEqual(readText(installedHooks, 'pre-push'), foreign);
  assertEqual(
    fs.existsSync(path.join(installedHooks, 'pre-push.local')),
    false,
  );
  assertEqual(
    fs.existsSync(path.join(installedHooks, 'lib', 'gitleaks.toml')),
    false,
  );
}

function testMissingGitleaksWarning() {
  const fixture = createInstallerFixture();
  const result = run(
    'bash',
    [path.join(fixture.root, 'install.sh'), 'style-gate'],
    {
      cwd: fixture.root,
      env: {
        ...baseEnv(fixture.home),
        PATH: NO_GITLEAKS_PATH,
      },
    },
  );
  assertEqual(result.status, 0, result.stdout + result.stderr);
  assertIncludes(result.stdout, '找不到 gitleaks');
  assertFile(path.join(hooksDir(fixture.home), 'pre-push'));
}

function statusOutput(fixture) {
  return run('bash', [path.join(fixture.root, 'install.sh'), 'status'], {
    cwd: fixture.root,
    env: baseEnv(fixture.home),
  }).stdout;
}

function assertStatusCurrent(fixture) {
  const output = statusOutput(fixture);
  const line = output
    .split('\n')
    .find((entry) => entry.includes('global core.hooksPath'));
  assertIncludes(line ?? output, '[OK]');
  return output;
}
