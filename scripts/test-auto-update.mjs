#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function run(command, args, options = {}) {
  const result = spawnSync(resolveCommand(command), args, {
    cwd: options.cwd || root,
    env: { ...process.env, ...(options.env || {}) },
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
  if (options.allowFailure) return result;
  assert.equal(
    result.status,
    0,
    [command, ...args, result.stdout, result.stderr].join('\n'),
  );
  return result;
}

function resolveCommand(command) {
  if (process.platform !== 'win32' || command !== 'bash') {
    return command;
  }
  const candidates = [
    process.env.GOLDBAND_TEST_BASH,
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) || command;
}

function makeTempDir(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${name}.`));
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function testSkillLinkStopsAfterSymlinkRemoveFailure() {
  const work = makeTempDir('goldband-skill-link-denied');
  const source = path.join(
    work,
    'repo',
    'skills',
    'global',
    'evidence-based-coding',
  );
  const targetDir = path.join(work, 'home', '.claude', 'skills');
  const dest = path.join(targetDir, 'evidence-based-coding');
  const polluted = path.join(source, 'evidence-based-coding');

  fs.mkdirSync(source, { recursive: true });
  fs.mkdirSync(targetDir, { recursive: true });
  fs.writeFileSync(
    path.join(source, 'SKILL.md'),
    'name: evidence-based-coding\n',
  );
  fs.symlinkSync(
    source,
    dest,
    process.platform === 'win32' ? 'junction' : 'dir',
  );

  const script = `
set -euo pipefail
source ${JSON.stringify(path.join(root, 'shell', 'install', 'common.sh'))}
rm() {
  if [ "$#" -eq 1 ] && [ "$1" = ${JSON.stringify(dest)} ]; then
    echo "rm denied for $1" >&2
    return 1
  fi
  command rm "$@"
}
if link_skill_entry ${JSON.stringify(source)} ${JSON.stringify(dest)}; then
  echo "link_skill_entry unexpectedly succeeded" >&2
  exit 1
fi
if [ -e ${JSON.stringify(polluted)} ] || [ -L ${JSON.stringify(polluted)} ]; then
  echo "source skill directory was polluted by a nested symlink" >&2
  exit 1
fi
`;

  run('bash', ['-lc', script]);
}

// A hook whose script an update removed is retired even though the hooks
// refresh itself is skipped.
function addRetiredHook(home) {
  const settingsFile = path.join(home, '.claude', 'settings.json');
  const settings = readJson(settingsFile);
  const installedHooks = structuredClone(settings.hooks);
  const retiredCommand = JSON.parse(
    fs.readFileSync(
      path.join(root, 'hooks', 'claude-retired-hooks.json'),
      'utf8',
    ),
  ).commands[0].replaceAll('${HOOKS_DIR}', path.join(home, '.claude', 'hooks'));
  settings.hooks.PostToolUse.push({
    matcher: 'Edit',
    hooks: [{ type: 'command', command: retiredCommand }],
  });
  fs.writeFileSync(settingsFile, JSON.stringify(settings));
  return { settingsFile, installedHooks };
}

function testInstallStateAndAutoRefresh() {
  const home = makeTempDir('goldband-auto-update-home');
  const env = {
    HOME: home,
    CODEX_REQUIREMENTS_FILE: path.join(
      home,
      'etc',
      'codex',
      'requirements.toml',
    ),
  };

  run('bash', ['./install.sh', 'codex-prompts'], { env });
  const stateFile = path.join(home, '.goldband', 'install-state.json');
  let state = readJson(stateFile);
  assert.deepEqual(state.targets, ['codex-prompts']);

  run('bash', ['./install.sh', 'pack-core'], { env });
  state = readJson(stateFile);
  for (const target of [
    'skills-core',
    'claude-guidance',
    'rules',
    'hooks',
    'launchers',
  ]) {
    assert.equal(state.targets.includes(target), true);
  }
  assert.equal(state.targets.includes('pack-core'), false);

  writeAutoRefreshTargets(stateFile, state);

  const { settingsFile, installedHooks } = addRetiredHook(home);

  run('bash', ['./install.sh', 'auto-refresh'], {
    env: {
      ...env,
      GOLDBAND_AUTO_REFRESH_OLD_HEAD: 'old123',
      GOLDBAND_AUTO_REFRESH_NEW_HEAD: 'new456',
    },
  });

  state = readJson(stateFile);
  assert.equal(state.lastAutoRefresh.status, 'success');
  assert.match(state.lastAutoRefresh.message, /refreshed: codex-prompts/);
  assert.match(
    state.lastAutoRefresh.message,
    /skipped unsafe: hooks,rules,codex-hooks,codex-rules,codex-requirements/,
  );
  assert.equal(fs.existsSync(env.CODEX_REQUIREMENTS_FILE), false);
  assert.deepEqual(readJson(settingsFile).hooks, installedHooks);
  assert.match(state.lastAutoRefresh.message, /hooks-retired/);

  const status = run('bash', ['./install.sh', 'status'], { env });
  assert.match(
    status.stdout,
    /auto-update tracked targets: codex-prompts, hooks, rules, codex-hooks, codex-rules, codex-requirements/,
  );
  assert.match(status.stdout, /last auto-refresh: success/);

  assertFailedRetireReported(env, stateFile, settingsFile);
  assertNoJqRetireReported(env, stateFile, settingsFile);
}

// Every executable on PATH except jq, so the installer takes its no-jq path.
function pathWithoutJq(home) {
  const bin = path.join(home, 'no-jq-bin');
  fs.mkdirSync(bin, { recursive: true });
  for (const dir of process.env.PATH.split(path.delimiter)) {
    let names = [];
    try {
      names = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      const link = path.join(bin, name);
      // lstat, so a dangling link already created for this name is kept.
      if (name !== 'jq' && !fs.lstatSync(link, { throwIfNoEntry: false })) {
        fs.symlinkSync(path.join(dir, name), link);
      }
    }
  }
  return bin;
}

// An opted-in hooks refresh without jq records a retired command it could
// not remove, whichever way auto-refresh was started.
function assertNoJqRetireReported(env, stateFile, settingsFile) {
  fs.writeFileSync(
    settingsFile,
    JSON.stringify({ hooks: { PostToolUse: [] } }),
  );
  addRetiredHook(env.HOME);
  const result = run('bash', ['./install.sh', 'auto-refresh'], {
    env: {
      ...env,
      PATH: pathWithoutJq(env.HOME),
      GOLDBAND_AUTO_REFRESH: '',
      GOLDBAND_AUTO_REFRESH_SECURITY_TARGETS: '1',
    },
    allowFailure: true,
  });
  assert.equal(result.status, 1, result.stderr);
  const { lastAutoRefresh } = readJson(stateFile);
  assert.equal(lastAutoRefresh.status, 'partial');
  assert.match(lastAutoRefresh.message, /failed: (?:[^;]*,)?hooks(?:,|$)/);
}

// A hook retirement that cannot run leaves the refresh partial, not success.
function assertFailedRetireReported(env, stateFile, settingsFile) {
  fs.writeFileSync(settingsFile, '{ not json');
  const result = run('bash', ['./install.sh', 'auto-refresh'], {
    env,
    allowFailure: true,
  });
  assert.equal(result.status, 1, result.stderr);
  assert.match(`${result.stdout}${result.stderr}`, /settings\.json/);
  const { lastAutoRefresh } = readJson(stateFile);
  assert.equal(lastAutoRefresh.status, 'partial');
  assert.match(lastAutoRefresh.message, /failed: hooks-retire/);
}

function testWindowsRequirementsDefaultPath() {
  const home = makeTempDir('goldband-windows-requirements-home');
  const programData = path.join(home, 'ProgramData');
  const env = {
    HOME: home,
    ProgramData: programData,
    GOLDBAND_TEST_WINDOWS_HOST: '1',
  };

  run('bash', ['./install.sh', 'codex-requirements'], { env });

  const requirements = path.join(
    programData,
    'OpenAI',
    'Codex',
    'requirements.toml',
  );
  assert.equal(fs.existsSync(requirements), true);
  assert.equal(
    fs.readFileSync(requirements, 'utf8'),
    fs.readFileSync(path.join(root, 'codex', 'requirements.toml'), 'utf8'),
  );

  const status = run('bash', ['./install.sh', 'status'], { env });
  assert.match(
    status.stdout,
    /codex requirements -> .*ProgramData.*requirements\.toml/,
  );
}

function testRetiredWindowsLauncherCleanup() {
  const home = makeTempDir('goldband-windows-launchers-home');
  const env = {
    HOME: home,
    GOLDBAND_TEST_WINDOWS_HOST: '1',
  };
  const claude = path.join(home, '.claude');
  const staleUpdate = path.join(claude, 'bin', 'goldband-self-update.ps1');
  const staleLaunchers = path.join(claude, 'shell', 'goldband-launchers.ps1');
  const staleState = path.join(claude, '.goldband-windows-state.json');
  const psProfile = path.join(
    home,
    'Documents',
    'PowerShell',
    'Microsoft.PowerShell_profile.ps1',
  );
  const windowsPsProfile = path.join(
    home,
    'Documents',
    'WindowsPowerShell',
    'Microsoft.PowerShell_profile.ps1',
  );
  const profileBlock = [
    '# >>> goldband powershell launchers >>>',
    'if (Test-Path "$HOME/.claude/shell/goldband-launchers.ps1") {',
    '    . "$HOME/.claude/shell/goldband-launchers.ps1"',
    '}',
    '# <<< goldband powershell launchers <<<',
    '',
  ].join('\n');

  fs.mkdirSync(path.dirname(staleUpdate), { recursive: true });
  fs.mkdirSync(path.dirname(staleLaunchers), { recursive: true });
  fs.mkdirSync(path.dirname(psProfile), { recursive: true });
  fs.mkdirSync(path.dirname(windowsPsProfile), { recursive: true });
  fs.writeFileSync(staleUpdate, 'old update\n');
  fs.writeFileSync(staleLaunchers, 'old launchers\n');
  fs.writeFileSync(staleState, '{}\n');
  fs.writeFileSync(psProfile, `${profileBlock}Write-Output keep\n`);
  fs.writeFileSync(windowsPsProfile, `${profileBlock}Write-Output keep\n`);

  run('bash', ['./install.sh', 'launchers'], { env });

  assertRetiredWindowsLaunchersRemoved({
    claude,
    psProfile,
    staleLaunchers,
    staleState,
    staleUpdate,
    windowsPsProfile,
  });
}

function assertRetiredWindowsLaunchersRemoved(paths) {
  const {
    claude,
    psProfile,
    staleLaunchers,
    staleState,
    staleUpdate,
    windowsPsProfile,
  } = paths;
  assert.equal(fs.existsSync(staleUpdate), false);
  assert.equal(fs.existsSync(staleLaunchers), false);
  assert.equal(fs.existsSync(staleState), false);
  assert.equal(
    fs
      .readdirSync(path.dirname(staleUpdate))
      .some((name) => name.startsWith('goldband-self-update.ps1.bak.')),
    true,
  );
  assert.equal(
    fs
      .readdirSync(path.dirname(staleLaunchers))
      .some((name) => name.startsWith('goldband-launchers.ps1.bak.')),
    true,
  );
  assert.equal(
    fs
      .readdirSync(claude)
      .some((name) => name.startsWith('.goldband-windows-state.json.bak.')),
    true,
  );
  assert.equal(
    fs.readFileSync(psProfile, 'utf8').includes('goldband-launchers.ps1'),
    false,
  );
  assert.equal(
    fs
      .readFileSync(windowsPsProfile, 'utf8')
      .includes('goldband-launchers.ps1'),
    false,
  );
}

function writeAutoRefreshTargets(stateFile, state) {
  state.targets = [
    'codex-prompts',
    'hooks',
    'rules',
    'codex-hooks',
    'codex-rules',
    'codex-requirements',
  ];
  fs.writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`);
}

function git(repo, args) {
  return run('git', args, { cwd: repo });
}

function writeExecutable(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, { mode: 0o755 });
}

function commitAll(repo, message) {
  git(repo, ['add', '.']);
  git(repo, ['commit', '-m', message]);
}

function makeSelfUpdateRepo() {
  const work = makeTempDir('goldband-self-update-work');
  const remote = path.join(work, 'origin.git');
  const repo = path.join(work, 'repo');
  const updater = fs.readFileSync(
    path.join(root, 'shell', 'goldband-self-update.sh'),
    'utf8',
  );

  run('git', ['init', '--bare', remote]);
  run('git', ['init', '-b', 'main', repo]);
  git(repo, ['config', 'user.email', 'test@example.com']);
  git(repo, ['config', 'user.name', 'Test User']);
  writeExecutable(path.join(repo, 'shell', 'goldband-self-update.sh'), updater);
  writeExecutable(
    path.join(repo, 'shell', 'goldband-sync-skills.sh'),
    '#!/usr/bin/env bash\nexit 0\n',
  );
  writeExecutable(
    path.join(repo, 'install.sh'),
    '#!/usr/bin/env bash\nset -euo pipefail\nif [ "${1:-}" = "auto-refresh" ]; then mkdir -p "$HOME/.goldband"; echo "${GOLDBAND_AUTO_REFRESH_OLD_HEAD:-}:${GOLDBAND_AUTO_REFRESH_NEW_HEAD:-}" > "$HOME/.goldband/refresh-ran"; exit 0; fi\n',
  );
  fs.writeFileSync(path.join(repo, 'tracked.txt'), 'one\n');
  commitAll(repo, 'initial');
  git(repo, ['remote', 'add', 'origin', remote]);
  git(repo, ['push', '-u', 'origin', 'main']);
  git(remote, ['symbolic-ref', 'HEAD', 'refs/heads/main']);
  return { work, remote, repo };
}

function addRemoteCommit(remote, work, options = {}) {
  const clone = path.join(work, options.cloneName || 'clone');
  run('git', ['clone', remote, clone]);
  git(clone, ['config', 'user.email', 'test@example.com']);
  git(clone, ['config', 'user.name', 'Test User']);
  fs.writeFileSync(
    path.join(clone, options.file || 'remote.txt'),
    options.content || 'remote\n',
  );
  commitAll(clone, options.message || 'remote update');
  git(clone, ['push', 'origin', 'main']);
}

function testSelfUpdateDirtyFastForward() {
  const home = makeTempDir('goldband-self-update-home');
  const { work, remote, repo } = makeSelfUpdateRepo();
  addRemoteCommit(remote, work);

  fs.writeFileSync(path.join(repo, 'dirty.txt'), 'local dirty file\n');
  const oldHead = git(repo, ['rev-parse', '--short', 'HEAD']).stdout.trim();
  run('bash', [path.join(repo, 'shell', 'goldband-self-update.sh')], {
    cwd: repo,
    env: {
      HOME: home,
      GOLDBAND_SELF_UPDATE_REPO_DIR: repo,
      GOLDBAND_SELF_UPDATE_TIMEOUT: '10',
    },
  });

  const newHead = git(repo, ['rev-parse', '--short', 'HEAD']).stdout.trim();
  assert.notEqual(newHead, oldHead);
  assert.equal(
    fs.readFileSync(path.join(repo, 'dirty.txt'), 'utf8'),
    'local dirty file\n',
  );
  assert.equal(fs.existsSync(path.join(repo, 'remote.txt')), true);
  assert.equal(
    fs.readFileSync(path.join(home, '.goldband', 'refresh-ran'), 'utf8').trim(),
    `${oldHead}:${newHead}`,
  );
}

function testSelfUpdateDirtyTrackedConflictSkipsRefresh() {
  const home = makeTempDir('goldband-self-update-conflict-home');
  const { work, remote, repo } = makeSelfUpdateRepo();
  addRemoteCommit(remote, work, {
    cloneName: 'clone-conflict',
    file: 'tracked.txt',
    content: 'remote update\n',
    message: 'remote tracked update',
  });

  fs.writeFileSync(path.join(repo, 'tracked.txt'), 'local dirty update\n');
  const oldHead = git(repo, ['rev-parse', '--short', 'HEAD']).stdout.trim();
  run('bash', [path.join(repo, 'shell', 'goldband-self-update.sh')], {
    cwd: repo,
    env: {
      HOME: home,
      GOLDBAND_SELF_UPDATE_REPO_DIR: repo,
      GOLDBAND_SELF_UPDATE_TIMEOUT: '10',
    },
  });

  const newHead = git(repo, ['rev-parse', '--short', 'HEAD']).stdout.trim();
  assert.equal(newHead, oldHead);
  assert.equal(
    fs.readFileSync(path.join(repo, 'tracked.txt'), 'utf8'),
    'local dirty update\n',
  );
  assert.equal(
    fs.existsSync(path.join(home, '.goldband', 'refresh-ran')),
    false,
  );
}

testSkillLinkStopsAfterSymlinkRemoveFailure();
testInstallStateAndAutoRefresh();
testWindowsRequirementsDefaultPath();
testRetiredWindowsLauncherCleanup();
testSelfUpdateDirtyFastForward();
testSelfUpdateDirtyTrackedConflictSkipsRefresh();
console.log('[OK] auto-update installer refresh tests passed');
