#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  copyInstaller,
  fixture,
  install,
  python,
  run,
  temp,
  toml,
  write,
} from './lib/config-install-fixture.mjs';

function testCodexPersonalSettings() {
  const context = fixture('codex-personal');
  copyInstaller(context);
  const config = path.join(context.home, '.codex/config.toml');
  const original =
    'model = "personal-model"\nmodel_reasoning_effort = "low"\n' +
    'sandbox_mode = "read-only"\n\n[mcp_servers.personal]\ncommand = "/fixture/server"\n' +
    '[desktop]\nfollowUpQueueMode = "queue"\n';
  write(config, original);
  install(context, 'codex-config');
  const parsed = toml(context, config);
  assert.equal(parsed.model, 'personal-model');
  assert.equal(parsed.model_reasoning_effort, 'low');
  assert.equal(parsed.sandbox_mode, 'read-only');
  assert.equal(parsed.mcp_servers.personal.command, '/fixture/server');
  assert.equal(parsed.desktop.followUpQueueMode, 'queue');
  assert.equal(parsed.tui, undefined, 'Existing files do not acquire defaults');
  assert.equal(parsed.project_doc_max_bytes, undefined);
  assert.equal(fs.readFileSync(config, 'utf8'), original);
  assert.equal(fs.existsSync(`${config}.bak`), false);
  const installed = fs.readFileSync(config, 'utf8');
  install(context, 'auto-refresh');
  assert.equal(
    fs.readFileSync(config, 'utf8'),
    installed,
    'Unchanged preferences and comments remain byte-identical',
  );
  console.log('[OK] Codex install and refresh preserve personal settings');
}

function testCodexInvalidInput() {
  const context = fixture('codex-invalid');
  copyInstaller(context);
  const config = path.join(context.home, '.codex/config.toml');
  install(context, 'codex-config');
  write(config, 'model = "unterminated\n');
  const result = run(context, 'bash', ['./install.sh', 'auto-refresh'], false);
  assert.notEqual(
    result.status,
    0,
    'Invalid config must fail the real refresh',
  );
  assert.equal(fs.readFileSync(config, 'utf8'), 'model = "unterminated\n');
  const state = JSON.parse(
    fs.readFileSync(path.join(context.home, '.goldband/install-state.json')),
  );
  assert.equal(state.lastAutoRefresh.status, 'partial');
  assert.match(state.lastAutoRefresh.message, /failed: codex-config/);
  for (const target of ['codex-core', 'codex-full']) {
    state.targets = [target];
    write(
      path.join(context.home, '.goldband/install-state.json'),
      JSON.stringify(state),
    );
    assert.notEqual(
      run(context, 'bash', ['./install.sh', 'auto-refresh'], false).status,
      0,
    );
    assert.equal(fs.readFileSync(config, 'utf8'), 'model = "unterminated\n');
  }
  console.log(
    '[OK] Invalid Codex config is preserved and refresh fails explicitly',
  );
}

function testCodexCrlf() {
  const context = fixture('codex-crlf');
  copyInstaller(context);
  const config = path.join(context.home, '.codex/config.toml');
  install(context, 'codex-config');
  const original = Buffer.from(
    fs.readFileSync(config, 'utf8').replace(/\n/g, '\r\n'),
  );
  write(config, original);
  for (const target of ['codex-config', 'auto-refresh']) {
    install(context, target);
    assert.deepEqual(
      fs.readFileSync(config),
      original,
      `${target} must preserve CRLF bytes when defaults are complete`,
    );
    assert.deepEqual(
      fs
        .readdirSync(path.dirname(config))
        .filter((name) => name.startsWith('config.toml.bak.')),
      [],
      'An unchanged CRLF config must not produce a backup',
    );
  }
  const status = install(context, 'status').stdout.replace(
    /\u001b\[[0-9;]*m/g,
    '',
  );
  assert.match(
    status,
    /\[OK\] codex-config \(valid user settings; defaults are not enforced\)/,
  );
  console.log(
    '[OK] CRLF config stays byte-identical and current after install and refresh',
  );
}

function testCodexOverlay() {
  const context = fixture('codex-overlay');
  copyInstaller(context);
  write(
    path.join(context.cwd, 'codex/local/config.toml'),
    'model = "local-default"\n[features]\nmemories = false\nextra = true\n',
  );
  const config = path.join(context.home, '.codex/config.toml');
  install(context, 'codex-config');
  assert.equal(toml(context, config).model, 'local-default');
  assert.equal(toml(context, config).features.memories, false);
  const custom = fs
    .readFileSync(config, 'utf8')
    .replace('local-default', 'user-choice');
  write(config, custom);
  install(context, 'codex-config');
  assert.equal(toml(context, config).model, 'user-choice');
  write(path.join(context.cwd, 'codex/local/config.toml'), 'model = [\n');
  const before = fs.readFileSync(config, 'utf8');
  install(context, 'codex-config');
  assert.equal(fs.readFileSync(config, 'utf8'), before);
  fs.unlinkSync(config);
  assert.notEqual(
    run(context, 'bash', ['./install.sh', 'codex-config'], false).status,
    0,
  );
  assert.equal(fs.existsSync(config), false);
  console.log(
    '[OK] Local defaults merge without duplicate TOML keys or overriding later choices',
  );
}

function testCodexStatusLine() {
  const context = fixture('codex-statusline');
  copyInstaller(context);
  const config = path.join(context.home, '.codex/config.toml');
  install(context, 'codex-config', 'codex-statusline');
  assert.deepEqual(toml(context, config).tui.status_line, [
    'model-with-reasoning',
    'project-root',
    'git-branch',
    'context-remaining',
    'five-hour-limit',
    'weekly-limit',
  ]);
  write(
    config,
    fs
      .readFileSync(config, 'utf8')
      .replace(/^status_line = .*$/m, 'status_line = []'),
  );
  install(context, 'auto-refresh');
  assert.deepEqual(toml(context, config).tui.status_line, []);
  install(context, 'codex-statusline');
  assert.equal(toml(context, config).tui.status_line.length, 6);
  console.log(
    '[OK] Codex status line is explicit opt-in and refresh preserves later customization',
  );
}

function testCodexRichToml() {
  const context = fixture('codex-rich-toml');
  copyInstaller(context);
  const config = path.join(context.home, '.codex/config.toml');
  const original = path.join(context.home, 'original.toml');
  const contents = `model = 'personal-model'
personal_note = """First line
Second line 😺"""
empty = {}
[custom."a.b"]
quoted = 'keep "quotes" and \\slashes'
delete_character = "\\u007f"
date = 2026-10-12
time = 03:45:12.123456
timestamp = 2026-10-12T03:45:12+08:00
values = [true, false, -0.0, inf, -inf, nan, [{a = 1, nested = {b = "c"}}]]
[[custom.entries]]
name = "first"
[[custom.entries]]
name = "second"
`;
  write(config, contents);
  write(original, contents);
  install(context, 'codex-config');
  run(context, python[0], [
    ...python.slice(1),
    '-c',
    `
import math, sys, tomllib
def preserved(expected, actual):
    assert type(expected) is type(actual)
    if isinstance(expected, dict):
        for key, value in expected.items(): preserved(value, actual[key])
    elif isinstance(expected, list):
        assert len(expected) == len(actual)
        for left, right in zip(expected, actual): preserved(left, right)
    elif isinstance(expected, float) and math.isnan(expected): assert math.isnan(actual)
    else: assert str(expected) == str(actual)
preserved(tomllib.load(open(sys.argv[1], "rb")), tomllib.load(open(sys.argv[2], "rb")))
`,
    original,
    config,
  ]);
  console.log(
    '[OK] TOML multiline strings, quoted keys, arrays, dates, and numeric types survive merging',
  );
}

function testCodexRealUpdater() {
  const context = fixture('codex-updater');
  copyInstaller(context);
  run(context, 'git', ['init', '-b', 'main']);
  run(context, 'git', ['add', '.']);
  run(context, 'git', ['commit', '-m', 'fixture baseline']);
  const producer = context.cwd;
  context.cwd = path.join(path.dirname(context.home), 'consumer');
  run({ ...context, cwd: producer }, 'git', ['clone', producer, context.cwd]);
  install(context, 'codex-config');
  const config = path.join(context.home, '.codex/config.toml');
  const before =
    fs.readFileSync(config, 'utf8').replace('gpt-5.6-sol', 'personal-model') +
    '\n# Keep my comment.\n';
  write(config, before);
  const update = advanceUpstream(
    context,
    producer,
    'unrelated.md',
    'unrelated change\n',
  );
  assert.match(update.stderr, /updated .* -> .*installed settings refreshed/);
  assert.equal(fs.readFileSync(config, 'utf8'), before);
  const state = JSON.parse(
    fs.readFileSync(path.join(context.home, '.goldband/install-state.json')),
  );
  assert.equal(state.lastAutoRefresh.status, 'success');
  const defaults =
    fs
      .readFileSync(path.join(producer, 'codex/config.toml'), 'utf8')
      .replace('gpt-5.6-sol', 'new-portable-model') +
    '\n[upgrade_fixture]\nenabled = true\n';
  advanceUpstream(context, producer, 'codex/config.toml', defaults);
  const updated = toml(context, config);
  assert.equal(updated.model, 'personal-model');
  assert.equal(updated.upgrade_fixture, undefined);
  assert.equal(fs.readFileSync(config, 'utf8'), before);
  assert.equal(fs.existsSync(`${config}.bak`), false);
  console.log(
    '[OK] Actual local Git fast-forward updater preserves Codex choices',
  );
}

function advanceUpstream(context, producer, file, contents) {
  write(path.join(producer, file), contents);
  run({ ...context, cwd: producer }, 'git', ['add', file]);
  run({ ...context, cwd: producer }, 'git', ['commit', '-m', 'fixture update']);
  return run(context, 'bash', ['shell/goldband-self-update.sh']);
}

function testClaudeSettings() {
  const context = fixture('claude-personal');
  const config = path.join(context.home, '.claude/settings.json');
  const personal = {
    model: 'personal-model',
    env: { PERSONAL_FIXTURE: 'keep' },
    statusLine: { type: 'command', command: '/fixture/statusline' },
    permissions: { defaultMode: 'plan', deny: ['Read(/fixture/private/**)'] },
    hooks: {
      PreToolUse: [
        {
          matcher: 'Read',
          hooks: [{ type: 'command', command: '/fixture/hook' }],
        },
      ],
    },
  };
  write(config, `${JSON.stringify(personal)}\n`);
  install(context, 'hooks');
  context.env.GOLDBAND_AUTO_REFRESH_SECURITY_TARGETS = '1';
  install(context, 'auto-refresh');
  const installed = JSON.parse(fs.readFileSync(config));
  assert.equal(installed.model, personal.model);
  assert.deepEqual(installed.env, personal.env);
  assert.deepEqual(installed.statusLine, personal.statusLine);
  assert.equal(installed.permissions.defaultMode, 'plan');
  assert.ok(installed.permissions.deny.includes('Read(/fixture/private/**)'));
  assert.ok(
    installed.hooks.PreToolUse.some((group) =>
      group.hooks.some((hook) => hook.command === '/fixture/hook'),
    ),
  );
  console.log(
    '[OK] Claude install and opted-in hook refresh preserve personal settings',
  );
}

function testClaudeStatusLine() {
  const context = fixture('claude-statusline');
  const config = path.join(context.home, '.claude/settings.json');
  install(context, 'hooks');
  assert.equal(JSON.parse(fs.readFileSync(config)).statusLine, undefined);
  install(context, 'claude-statusline');
  const installed = JSON.parse(fs.readFileSync(config));
  assert.match(installed.statusLine.command, /statusline-command\.sh/);
  installed.statusLine = {
    type: 'command',
    command: '/fixture/custom-statusline',
  };
  write(config, JSON.stringify(installed));
  install(context, 'auto-refresh');
  assert.deepEqual(
    JSON.parse(fs.readFileSync(config)).statusLine,
    installed.statusLine,
  );
  install(context, 'claude-statusline');
  assert.match(
    JSON.parse(fs.readFileSync(config)).statusLine.command,
    /statusline-command\.sh/,
  );
  console.log(
    '[OK] Claude status line is explicit opt-in and refresh preserves later customization',
  );
}

try {
  testCodexPersonalSettings();
  testCodexInvalidInput();
  testCodexCrlf();
  testCodexOverlay();
  testCodexStatusLine();
  testCodexRichToml();
  testCodexRealUpdater();
  testClaudeSettings();
  testClaudeStatusLine();
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
