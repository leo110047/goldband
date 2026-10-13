#!/usr/bin/env node
// all-with-workflow adds the template's Playwright MCP to both hosts when
// absent, never touches an existing `playwright` entry, and honors the opt-out.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  copyInstaller,
  fixture,
  run,
  toml,
  write,
} from './lib/config-install-fixture.mjs';

// The template's output-dir placeholder resolves under the user's GOLDBAND_HOME,
// so Playwright MCP never writes snapshots into the project directory, and the
// size cap evicts old snapshots instead of letting them accumulate.
function templateArgs(context) {
  return [
    '-y',
    '@playwright/mcp@0.0.83',
    '--isolated',
    '--allowed-origins=http://localhost:*;http://127.0.0.1:*',
    `--output-dir=${context.env.GOLDBAND_HOME}/playwright-mcp`,
    '--output-max-size=5242880',
  ];
}

// Load only the installer modules the MCP step needs, then run one function.
const MODULE_PRELUDE = `
set -e
REPO_DIR="$PWD"
CODEX_CONFIG_FILE="$HOME/.codex/config.toml"
RED= GREEN= YELLOW= BLUE= CYAN= NC=
. shell/install/common.sh
. shell/install/codex.sh
. shell/install/workflow.sh
. shell/install/status.sh
`;

function setup(name, { claudeCli = true } = {}) {
  const context = fixture(name);
  copyInstaller(context);
  write(
    path.join(context.cwd, 'mcp/claude.mcp.json.template'),
    fs.readFileSync(
      new URL('../mcp/claude.mcp.json.template', import.meta.url),
    ),
  );
  const bin = path.join(path.dirname(context.home), 'bin');
  context.claudeLog = path.join(
    path.dirname(context.home),
    'claude-calls.jsonl',
  );
  if (claudeCli) {
    // Records each call and, like the real CLI, writes the user-scope entry.
    write(
      path.join(bin, 'claude'),
      `#!/usr/bin/env node
const fs = require('fs');
const argv = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(context.claudeLog)}, JSON.stringify({ argv, cwd: process.cwd() }) + '\\n');
const file = process.env.HOME + '/.claude.json';
const data = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
const split = argv.indexOf('--');
data.mcpServers = { ...data.mcpServers, [argv[split - 1]]: { command: argv[split + 1], args: argv.slice(split + 2) } };
fs.writeFileSync(file, JSON.stringify(data));
`,
    );
    fs.chmodSync(path.join(bin, 'claude'), 0o755);
  }
  const systemPath = (context.env.PATH ?? '')
    .split(path.delimiter)
    .filter((dir) => !fs.existsSync(path.join(dir, 'claude')))
    .join(path.delimiter);
  context.env.PATH = `${bin}${path.delimiter}${systemPath}`;
  context.codexConfig = path.join(context.home, '.codex/config.toml');
  context.claudeConfig = path.join(context.home, '.claude.json');
  return context;
}

function bash(context, script, env = {}) {
  return run({ ...context, env: { ...context.env, ...env } }, 'bash', [
    '-c',
    MODULE_PRELUDE + script,
  ]);
}

function claudeCalls(context) {
  if (!fs.existsSync(context.claudeLog)) return [];
  return fs
    .readFileSync(context.claudeLog, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
}

function testFreshInstall() {
  const context = setup('playwright-fresh');
  const original =
    '# personal comment\nmodel = "personal"\n\n[projects."/x"]\ntrust_level = "trusted"\n';
  write(context.codexConfig, original);
  const output = bash(context, 'install_playwright_mcp').stdout;
  assert.match(output, /\[設定\] Claude Code Playwright MCP（user scope）/);
  assert.match(output, /\[設定\] Codex Playwright MCP/);

  const calls = claudeCalls(context);
  assert.equal(calls.length, 1, output);
  assert.deepEqual(calls[0].argv, [
    'mcp',
    'add',
    '--scope',
    'user',
    'playwright',
    '--',
    'npx',
    ...templateArgs(context),
  ]);
  assert.equal(fs.realpathSync(calls[0].cwd), fs.realpathSync(context.home));

  const text = fs.readFileSync(context.codexConfig, 'utf8');
  assert.ok(
    text.startsWith(original),
    'Existing Codex text is kept byte-for-byte',
  );
  const parsed = toml(context, context.codexConfig);
  assert.deepEqual(parsed.mcp_servers.playwright, {
    command: 'npx',
    args: templateArgs(context),
  });
  assert.equal(parsed.projects['/x'].trust_level, 'trusted');
  assert.equal(fs.readFileSync(`${context.codexConfig}.bak`, 'utf8'), original);

  const status = bash(context, 'show_playwright_mcp_status').stdout;
  assert.match(status, /\[OK\] Claude Code Playwright MCP/);
  assert.match(status, /\[OK\] Codex Playwright MCP/);

  bash(context, 'install_playwright_mcp');
  assert.equal(claudeCalls(context).length, 1, 'A rerun does not add again');
  assert.equal(fs.readFileSync(context.codexConfig, 'utf8'), text);
  console.log(
    '[OK] Fresh install adds Playwright MCP to Claude Code and Codex once',
  );
}

function testExistingEntriesKept() {
  const context = setup('playwright-existing');
  const codex =
    '[mcp_servers.playwright]\ncommand = "/custom/playwright"\nargs = []\n';
  const claude = JSON.stringify({
    mcpServers: { playwright: { command: '/custom/pw' } },
  });
  write(context.codexConfig, codex);
  write(context.claudeConfig, claude);
  const output = bash(context, 'install_playwright_mcp').stdout;
  assert.equal(claudeCalls(context).length, 0);
  assert.equal(fs.readFileSync(context.codexConfig, 'utf8'), codex);
  assert.equal(fs.readFileSync(context.claudeConfig, 'utf8'), claude);
  assert.equal(fs.existsSync(`${context.codexConfig}.bak`), false);
  assert.equal((output.match(/\[保留\]/g) ?? []).length, 2, output);
  console.log('[OK] Existing playwright entries are left untouched');
}

function testOptOutAndMissingCli() {
  const skipped = setup('playwright-skip');
  write(skipped.codexConfig, 'model = "m"\n');
  const output = bash(skipped, 'install_playwright_mcp', {
    GOLDBAND_SKIP_PLAYWRIGHT_MCP: '1',
  }).stdout;
  assert.match(output, /GOLDBAND_SKIP_PLAYWRIGHT_MCP=1/);
  assert.equal(claudeCalls(skipped).length, 0);
  assert.equal(fs.readFileSync(skipped.codexConfig, 'utf8'), 'model = "m"\n');
  assert.match(
    bash(skipped, 'show_playwright_mcp_status').stdout,
    /\[未設定\] Codex Playwright MCP/,
  );

  const noCli = setup('playwright-no-cli', { claudeCli: false });
  const noCliOutput = bash(noCli, 'install_playwright_mcp').stdout;
  assert.match(noCliOutput, /找不到 claude CLI/);
  assert.deepEqual(
    toml(noCli, noCli.codexConfig).mcp_servers.playwright.args,
    templateArgs(noCli),
  );
  console.log(
    '[OK] Opt-out skips both hosts; a missing claude CLI still configures Codex',
  );
}

function testWindowsAndInvalidConfig() {
  const windows = setup('playwright-windows');
  bash(windows, 'install_playwright_mcp', { GOLDBAND_TEST_WINDOWS_HOST: '1' });
  assert.deepEqual(claudeCalls(windows)[0].argv.slice(6), [
    'cmd',
    '/c',
    'npx',
    ...templateArgs(windows),
  ]);
  assert.deepEqual(toml(windows, windows.codexConfig).mcp_servers.playwright, {
    command: 'cmd',
    args: ['/c', 'npx', ...templateArgs(windows)],
  });

  const invalid = setup('playwright-invalid');
  write(invalid.codexConfig, 'model = "unterminated\n');
  const output = bash(invalid, 'install_playwright_mcp').stdout;
  assert.match(output, /\[失敗\] Codex Playwright MCP/);
  assert.equal(
    fs.readFileSync(invalid.codexConfig, 'utf8'),
    'model = "unterminated\n',
  );
  console.log(
    '[OK] Windows wraps npx in cmd /c; invalid Codex config is not modified',
  );
}

function testAllWithWorkflowWiring() {
  const context = setup('playwright-wiring');
  const output = bash(
    context,
    `. shell/install/profiles.sh
install_all_tools() { echo tools; }
install_workflow_host() { echo "workflow $1"; }
install_playwright_mcp() { echo playwright; }
install_all_with_workflow`,
  ).stdout;
  assert.deepEqual(output.trim().split('\n'), [
    'tools',
    'workflow auto',
    'playwright',
  ]);
  console.log(
    '[OK] all-with-workflow configures Playwright MCP after the workflow runtime',
  );
}

testFreshInstall();
testExistingEntriesKept();
testOptOutAndMissingCli();
testWindowsAndInvalidConfig();
testAllWithWorkflowWiring();
