#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  copyInstaller,
  fixture,
  install,
  run,
  temp,
  toml,
  write,
} from './lib/config-install-fixture.mjs';

function copyMode(context, withoutParser = false) {
  const bin = path.join(context.home, 'test-bin');
  write(path.join(bin, 'ln'), '#!/bin/sh\nexit 1\n');
  fs.chmodSync(path.join(bin, 'ln'), 0o755);
  if (withoutParser) {
    for (const name of ['python3', 'python', 'py']) {
      write(path.join(bin, name), '#!/bin/sh\nexit 1\n');
      fs.chmodSync(path.join(bin, name), 0o755);
    }
  }
  context.env.PATH = `${bin}${path.delimiter}${context.env.PATH}`;
}

function assertBundleInstalled(context) {
  for (const file of [
    '.codex/AGENTS.md',
    '.codex/agents/reviewer.toml',
    '.codex/hooks.json',
    '.codex/hooks/hook-router.js',
    '.codex/rules/goldband.rules',
    '.codex/review-runtime/rules-resolver.js',
    '.codex/auto_review_experiment.config.toml',
    '.agents/skills/.goldband-profile',
    '.claude/bin/goldband-self-update',
  ]) {
    assert.ok(fs.existsSync(path.join(context.home, file)), `${file} missing`);
  }
}

function testBundleFailure(target, withoutParser) {
  const context = fixture(
    `${target}-${withoutParser ? 'no-parser' : 'invalid'}`,
  );
  copyInstaller(context);
  copyMode(context, withoutParser);
  const config = path.join(context.home, '.codex/config.toml');
  const original = withoutParser
    ? 'model = "mine"\n'
    : 'model = "unterminated\n';
  write(config, original);
  const result = run(context, 'bash', ['./install.sh', target], false);
  assert.notEqual(
    result.status,
    0,
    'A failed config cannot report full success',
  );
  assert.equal(fs.readFileSync(config, 'utf8'), original);
  assertBundleInstalled(context);
  assertBundleRefresh(context, target, original);
  console.log(
    `[OK] ${target} installs and refreshes other components after config failure (${withoutParser ? 'parser unavailable' : 'invalid TOML'})`,
  );
}

function assertBundleRefresh(context, target, original) {
  const config = path.join(context.home, '.codex/config.toml');
  const runtime = path.join(
    context.home,
    '.codex/review-runtime/rules-resolver.js',
  );
  const hook = path.join(context.home, '.codex/hooks/hook-router.js');
  const rule = path.join(context.home, '.codex/rules/goldband.rules');
  const personalRule = path.join(context.home, '.codex/rules/default.rules');
  write(personalRule, '# Personal rule must not be replaced\n');
  for (const file of [runtime, hook, rule]) write(file, 'stale fixture\n');
  write(
    path.join(context.home, '.goldband/install-state.json'),
    JSON.stringify({ targets: [target] }),
  );
  const refresh = run(context, 'bash', ['./install.sh', 'auto-refresh'], false);
  assert.notEqual(refresh.status, 0);
  for (const file of [runtime, hook, rule]) {
    assert.notEqual(
      fs.readFileSync(file, 'utf8'),
      'stale fixture\n',
      `${file}\n${refresh.stdout}\n${refresh.stderr}`,
    );
  }
  assert.equal(fs.readFileSync(config, 'utf8'), original);
  assert.equal(
    fs.readFileSync(personalRule, 'utf8'),
    '# Personal rule must not be replaced\n',
  );
  assertBundleInstalled(context);
  const state = JSON.parse(
    fs.readFileSync(path.join(context.home, '.goldband/install-state.json')),
  );
  assert.equal(state.lastAutoRefresh.status, 'partial');
}

function testOtherComponentFailure() {
  const context = fixture('hook-component-failure');
  copyInstaller(context);
  write(
    path.join(context.home, '.codex/review-runtime'),
    'block directory creation',
  );
  const result = run(context, 'bash', ['./install.sh', 'codex-core'], false);
  assert.notEqual(
    result.status,
    0,
    'A hook component error must not report bundle success',
  );
  assert.ok(
    fs.existsSync(path.join(context.home, '.codex/rules/goldband.rules')),
  );
  assert.ok(
    fs.existsSync(path.join(context.home, '.agents/skills/.goldband-profile')),
  );
  console.log(
    '[OK] A non-config component error remains a bundle failure while later components install',
  );
}

function testOmissionAndSecurityAdvice() {
  const context = fixture('omission-and-advice');
  copyInstaller(context);
  install(context, 'codex-config');
  const config = path.join(context.home, '.codex/config.toml');
  const original =
    fs.readFileSync(config, 'utf8').replace(/^model = .*\n/m, '') +
    '\n# Personal comment\n';
  write(config, original);
  const source = path.join(context.cwd, 'codex/config.toml');
  write(
    source,
    fs
      .readFileSync(source, 'utf8')
      .replace('"*_CREDENTIAL"]', '"*_CREDENTIAL", "*_PRIVATE"]') +
      '\n[new_default]\nenabled = true\n',
  );
  install(context, 'codex-config');
  install(context, 'auto-refresh');
  assert.equal(fs.readFileSync(config, 'utf8'), original);
  assert.equal(toml(context, config).model, undefined);
  assert.equal(toml(context, config).new_default, undefined);
  assert.equal(fs.existsSync(`${config}.bak`), false);
  const status = install(context, 'status').stdout;
  assert.match(
    status,
    /shell_environment_policy differs from the recommended defaults/,
  );
  assert.match(status, /valid user settings; defaults are not enforced/);
  console.log(
    '[OK] Omitted preferences and comments survive upstream changes; security defaults produce advice',
  );
}

function testStatusLineScope() {
  const context = fixture('statusline-scope');
  copyInstaller(context);
  const config = path.join(context.home, '.codex/config.toml');
  write(config, 'model = "mine"\n');
  install(context, 'codex-statusline');
  const data = toml(context, config);
  assert.deepEqual(Object.keys(data).sort(), ['model', 'tui']);
  assert.equal(data.model, 'mine');
  assert.equal(data.tui.status_line.length, 6);
  assert.equal(fs.readFileSync(`${config}.bak`, 'utf8'), 'model = "mine"\n');
  fs.unlinkSync(config);
  install(context, 'codex-statusline');
  assert.deepEqual(Object.keys(toml(context, config)), ['tui']);
  write(config, 'model = "mine"\ntui = "invalid shape"\n');
  assert.notEqual(
    run(context, 'bash', ['./install.sh', 'codex-statusline'], false).status,
    0,
  );
  assert.equal(
    fs.readFileSync(config, 'utf8'),
    'model = "mine"\ntui = "invalid shape"\n',
  );
  console.log(
    '[OK] The optional Codex status line changes no unrelated settings',
  );
}

function testUninstallPreservesUserSettings() {
  const context = fixture('uninstall-personal');
  copyInstaller(context);
  copyMode(context);
  const settings = path.join(context.home, '.claude/settings.json');
  const config = path.join(context.home, '.codex/config.toml');
  const personal = {
    model: 'mine',
    statusLine: { command: '/my/own/statusline-command.sh' },
    hooks: {
      PreToolUse: [
        {
          matcher: 'Read',
          hooks: [{ type: 'command', command: '/my/own-hook' }],
        },
      ],
    },
  };
  write(settings, JSON.stringify(personal));
  write(config, '# Keep my whole file\nmodel = "mine"\n');
  install(context, 'hooks', 'codex-hooks', 'codex-rules');
  const rule = path.join(context.home, '.codex/rules/personal.rules');
  const hook = path.join(context.home, '.codex/hooks/personal.js');
  write(rule, '# Personal rule\n');
  write(hook, '// Personal hook\n');
  install(context, 'uninstall');
  const after = JSON.parse(fs.readFileSync(settings));
  assert.deepEqual(after.hooks, personal.hooks);
  assert.deepEqual(after.statusLine, personal.statusLine);
  assert.equal(after.model, 'mine');
  assert.equal(
    fs.readFileSync(config, 'utf8'),
    '# Keep my whole file\nmodel = "mine"\n',
  );
  assert.equal(fs.readFileSync(rule, 'utf8'), '# Personal rule\n');
  assert.equal(fs.readFileSync(hook, 'utf8'), '// Personal hook\n');
  assert.equal(
    fs.existsSync(path.join(context.home, '.codex/hooks/hook-router.js')),
    false,
  );
  assert.equal(
    fs.existsSync(path.join(context.home, '.codex/rules/goldband.rules')),
    false,
  );
  console.log(
    '[OK] Uninstall removes owned hooks/rules and preserves personal settings and files',
  );
}

function testUninstallStatusLine() {
  for (const legacy of [false, true]) {
    const context = fixture(`uninstall-statusline-${legacy}`);
    copyInstaller(context);
    install(context, 'claude-statusline');
    const settings = path.join(context.home, '.claude/settings.json');
    if (legacy) {
      write(
        settings,
        JSON.stringify({
          statusLine: {
            type: 'command',
            command: `bash ${context.home}/.claude/statusline-command.sh`,
          },
        }),
      );
    }
    install(context, 'uninstall');
    assert.equal(JSON.parse(fs.readFileSync(settings)).statusLine, undefined);
    assert.equal(
      fs.existsSync(path.join(context.home, '.claude/statusline-command.sh')),
      false,
    );
  }
  console.log(
    '[OK] Uninstall recognizes both current and legacy Goldband status lines',
  );
}

function withoutJq(context) {
  const bin = path.join(context.home, 'without-jq');
  fs.mkdirSync(bin);
  for (const name of [
    'bash',
    'dirname',
    'uname',
    'rm',
    'readlink',
    'ls',
    'rmdir',
    'cmp',
    'basename',
    'head',
    'grep',
    'sed',
    'awk',
    'cat',
    'cp',
    'mv',
    'mktemp',
    'git',
    'python3',
    'node',
    'date',
    'mkdir',
  ]) {
    const source = run(context, 'bash', [
      '-c',
      'command -v "$1"',
      'find-command',
      name,
    ]).stdout.trim();
    fs.symlinkSync(source, path.join(bin, name));
  }
  context.env.PATH = bin;
  assert.notEqual(
    run(context, 'bash', ['-c', 'command -v jq'], false).status,
    0,
  );
}

function testUninstallSettingsFailure(invalidJson) {
  const context = fixture(`uninstall-settings-failure-${invalidJson}`);
  copyInstaller(context);
  install(context, 'hooks', 'codex-hooks', 'codex-rules');
  const settings = path.join(context.home, '.claude/settings.json');
  if (invalidJson) write(settings, '{broken json\n');
  const original = fs.readFileSync(settings);
  if (!invalidJson) withoutJq(context);
  const result = run(context, 'bash', ['./install.sh', 'uninstall'], false);
  assert.notEqual(result.status, 0);
  assert.deepEqual(fs.readFileSync(settings), original);
  assert.ok(
    fs.existsSync(
      path.join(context.home, '.claude/hooks/scripts/hooks/hook-router.js'),
    ),
  );
  assert.equal(
    fs.existsSync(path.join(context.home, '.codex/hooks.json')),
    false,
  );
  assert.equal(fs.existsSync(path.join(context.home, '.codex/hooks')), false);
  assert.equal(
    fs.existsSync(path.join(context.home, '.codex/rules/goldband.rules')),
    false,
  );
  console.log(
    `[OK] Claude ${invalidJson ? 'invalid settings' : 'missing jq'} does not block Codex uninstall`,
  );
}

function testProfileUninstall() {
  const context = fixture('profile-uninstall');
  copyInstaller(context);
  install(context, 'codex-config');
  const owned = path.join(
    context.home,
    '.codex/auto_review_experiment.config.toml',
  );
  const custom = path.join(context.home, '.codex/dangerous-local.config.toml');
  fs.appendFileSync(
    owned,
    '\n[hooks.state.fixture]\ntrusted_hash = "fixture"\n[tui.model_availability_nux]\nfixture = 4\n',
  );
  write(custom, 'model = "my-custom-profile"\n');
  install(context, 'uninstall');
  assert.equal(fs.existsSync(owned), false);
  assert.equal(
    fs.readFileSync(custom, 'utf8'),
    'model = "my-custom-profile"\n',
  );
  console.log(
    '[OK] Profile uninstall ignores host runtime state but preserves custom preferences',
  );
}

// codex/local holds user-owned approvals that uninstall keeps.
function isOwnedRepoLink(file) {
  const target = path.resolve(path.dirname(file), fs.readlinkSync(file));
  const userOverlay = path.join(process.cwd(), 'codex', 'local', path.sep);
  return (
    target.startsWith(`${process.cwd()}${path.sep}`) &&
    !target.startsWith(userOverlay)
  );
}

function repoLinks(directory) {
  const links = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      if (isOwnedRepoLink(full)) links.push(full);
    } else if (entry.isDirectory()) {
      links.push(...repoLinks(full));
    }
  }
  return links;
}

function testInstallUninstallRoundTrip() {
  const context = fixture('install-uninstall-roundtrip');
  install(context, 'all-tools');
  assertBundleInstalled(context);
  assert.ok(repoLinks(context.home).length > 0, 'all-tools links repo assets');
  install(context, 'uninstall');
  assert.deepEqual(repoLinks(context.home), []);
  for (const file of [
    '.codex/AGENTS.md',
    '.codex/hooks.json',
    '.codex/hooks',
    '.codex/rules/goldband.rules',
    '.codex/review-runtime/rules-resolver.js',
    '.claude/hooks/scripts',
    '.claude/commands',
    '.claude/rules',
    '.claude/goldband-rules',
  ]) {
    assert.equal(
      fs.existsSync(path.join(context.home, file)),
      false,
      `${file} remains after uninstall`,
    );
  }
  console.log(
    '[OK] Uninstall removes every component that all-tools installed',
  );
}

function testBoundedBackups(host) {
  const context = fixture(`backups-${host}`);
  copyInstaller(context);
  const isCodex = host === 'codex';
  const config = path.join(
    context.home,
    isCodex ? '.codex/config.toml' : '.claude/settings.json',
  );
  const target = `${host}-statusline`;
  const originals = [];
  for (let i = 0; i < 3; i++) {
    const content = isCodex
      ? `model = "mine-${i}"\n`
      : JSON.stringify({
          model: `mine-${i}`,
          statusLine: { command: '/my/own' },
        });
    originals.push(content);
    write(config, content);
    install(context, target);
  }
  assert.equal(fs.readFileSync(`${config}.bak`, 'utf8'), originals[2]);
  assert.equal(fs.readFileSync(`${config}.bak.previous`, 'utf8'), originals[1]);
  const before = fs.readFileSync(config);
  install(context, target);
  assert.deepEqual(fs.readFileSync(config), before);
  assert.equal(fs.readFileSync(`${config}.bak`, 'utf8'), originals[2]);
  assert.equal(fs.readFileSync(`${config}.bak.previous`, 'utf8'), originals[1]);
  assert.equal(
    fs.readdirSync(path.dirname(config)).filter((name) => name.includes('.bak'))
      .length,
    2,
  );
  console.log(
    `[OK] ${host} retains two backups and no-op installs do not rotate them`,
  );
}

function testClaudeInvalidAndNoop() {
  const context = fixture('claude-invalid-noop');
  copyInstaller(context);
  const config = path.join(context.home, '.claude/settings.json');
  write(config, '{bad json\n');
  assert.notEqual(
    run(context, 'bash', ['./install.sh', 'hooks'], false).status,
    0,
  );
  assert.equal(fs.readFileSync(config, 'utf8'), '{bad json\n');
  write(config, '{"model":"mine"}\n');
  install(context, 'hooks');
  const backup = fs.readFileSync(`${config}.bak`);
  install(context, 'hooks');
  assert.deepEqual(fs.readFileSync(`${config}.bak`), backup);
  assert.equal(fs.existsSync(`${config}.bak.previous`), false);
  console.log(
    '[OK] Claude rejects invalid JSON and unchanged hooks do not rotate backups',
  );
}

try {
  for (const target of ['codex-core', 'codex-full']) {
    for (const withoutParser of [false, true])
      testBundleFailure(target, withoutParser);
  }
  testOmissionAndSecurityAdvice();
  testOtherComponentFailure();
  testStatusLineScope();
  testUninstallPreservesUserSettings();
  testUninstallStatusLine();
  testUninstallSettingsFailure(false);
  testUninstallSettingsFailure(true);
  testProfileUninstall();
  testInstallUninstallRoundTrip();
  testBoundedBackups('codex');
  testBoundedBackups('claude');
  testClaudeInvalidAndNoop();
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
