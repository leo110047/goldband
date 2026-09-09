#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  APP_SUPPORT_EXPECTED_ASSETS_PATH,
  CLAUDE_DESKTOP_EXTENSION_MANIFEST_PATH,
  CLAUDE_DESKTOP_EXTENSION_ROOT_PATH,
  CLAUDE_REMOTE_CONNECTOR_TEMPLATE_PATH,
  CODEX_MARKETPLACE_PATH,
  CODEX_PLUGIN_MANIFEST_PATH,
  CODEX_PLUGIN_ROOT_PATH,
  diffAppSupportArtifacts,
  listCodexPluginFiles,
  ROOT_CODEX_PLUGIN_MANIFEST_PATH,
  readAppSupportExpectedAssets,
} from './lib/app-support-distribution.mjs';
import { ROOT_DIR } from './lib/plugin-distribution.mjs';

function main() {
  assert.deepEqual(
    diffAppSupportArtifacts(),
    [],
    'app support generated artifacts are out of date',
  );
  const expected = readAppSupportExpectedAssets();
  assertExpectedReport(expected);
  assertCodexPluginPackage(expected);
  assertTempHomeCodexPluginInstall();
  assertClaudeAppAdapters(expected);
  assertTempHomeCodexAppStatus();
  assertFileCopyFallbackStatusHelper();
  assertDirectoryCopyFallbackStatusHelper();
  assertNoBoundaryWordingRegressions();
  console.log('[OK] app support check passed');
}

function assertExpectedReport(expected) {
  assert.equal(expected.schemaVersion, 1);
  assert.equal(expected.codex.fullSetupStillInstaller, true);
  assert.ok(fs.existsSync(APP_SUPPORT_EXPECTED_ASSETS_PATH));
}

function assertCodexPluginPackage(expected) {
  const rootManifest = readJson(ROOT_CODEX_PLUGIN_MANIFEST_PATH);
  const packageManifest = readJson(CODEX_PLUGIN_MANIFEST_PATH);
  validateRootCodexPluginManifest(rootManifest);
  validateCodexPluginManifest(packageManifest);
  assert.equal(
    /placeholder/i.test(packageManifest.description),
    false,
    'Codex plugin manifest must not be a placeholder',
  );
  assertCodexMarketplace();
  assertCodexPluginSkills(expected.codex.skills);
  assertCodexPluginMcpConfig();
  assertNoHeavyRuntime(listCodexPluginFiles(), 'Codex plugin package');
  assertMcpWrapperFailsClosed(
    path.join(CODEX_PLUGIN_ROOT_PATH, 'mcp', 'goldband-mcp-wrapper.mjs'),
  );
}

function validateCodexPluginManifest(manifest) {
  assert.equal(manifest.name, 'goldband');
  assert.match(manifest.version, /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/);
  assert.equal(manifest.skills, './skills/');
  assert.equal(manifest.mcpServers, './.mcp.json');
  assert.equal(manifest.interface.displayName, 'Goldband');
  assert.ok(Array.isArray(manifest.interface.capabilities));
  assert.ok(manifest.interface.capabilities.includes('Skills'));
  assert.ok(manifest.interface.capabilities.includes('MCP'));
}

function validateRootCodexPluginManifest(manifest) {
  assert.equal(manifest.name, 'goldband');
  assert.equal(manifest.skills, './plugin-assets/codex-plugin/skills/');
  assert.equal(manifest.mcpServers, './plugin-assets/codex-plugin/.mcp.json');
  assert.ok(fs.existsSync(path.join(ROOT_DIR, manifest.skills)));
  assert.ok(fs.existsSync(path.join(ROOT_DIR, manifest.mcpServers)));
}

function assertCodexMarketplace() {
  const marketplace = readJson(CODEX_MARKETPLACE_PATH);
  assert.equal(marketplace.name, 'goldband-local');
  assert.equal(marketplace.interface.displayName, 'Goldband Local');
  const plugin = marketplace.plugins.find((entry) => entry.name === 'goldband');
  assert.ok(plugin, 'Codex repo marketplace must include goldband');
  assert.deepEqual(plugin.source, {
    source: 'local',
    path: './plugin-assets/codex-plugin',
  });
  assert.deepEqual(plugin.policy, {
    installation: 'AVAILABLE',
    authentication: 'ON_INSTALL',
  });
  assert.equal(plugin.category, 'Productivity');
}

function assertCodexPluginSkills(expectedSkills) {
  const actualSkills = fs
    .readdirSync(path.join(CODEX_PLUGIN_ROOT_PATH, 'skills'), {
      withFileTypes: true,
    })
    .filter((entry) => entry.isDirectory())
    .filter((entry) =>
      fs.existsSync(
        path.join(CODEX_PLUGIN_ROOT_PATH, 'skills', entry.name, 'SKILL.md'),
      ),
    )
    .map((entry) => entry.name)
    .sort();
  assert.deepEqual(actualSkills, [...expectedSkills].sort());
  const catalog = fs.readFileSync(
    path.join(ROOT_DIR, 'shell/install/skill-catalog.txt'),
    'utf8',
  );
  const supported = catalog
    .trim()
    .split('\n')
    .map((line) => line.split('|'))
    .filter(([, , codexProfile]) => codexProfile)
    .map(([name]) => name)
    .sort();
  assert.deepEqual(
    actualSkills,
    supported,
    'Codex plugin must use the installer compatibility catalog',
  );
}

function assertCodexPluginMcpConfig() {
  const mcp = readJson(path.join(CODEX_PLUGIN_ROOT_PATH, '.mcp.json'));
  const server = mcp.mcpServers?.goldband;
  assert.ok(server, 'Codex plugin MCP config must include goldband');
  assert.equal(server.command, 'node');
  assert.deepEqual(server.args, ['./mcp/goldband-mcp-wrapper.mjs']);
  assert.equal(server.cwd, '.');
  assert.equal(server.enabled, false);
  assert.equal(server.env.GOLDBAND_REPO_DIR, '${GOLDBAND_REPO_DIR}');
}

function assertTempHomeCodexPluginInstall() {
  const tmpHome = fs.mkdtempSync(
    path.join(os.tmpdir(), 'goldband-codex-home-'),
  );
  try {
    const env = { ...process.env, HOME: tmpHome };
    runCodexPluginCommand(env, ['plugin', 'marketplace', 'add', './']);
    const listBefore = runCodexPluginCommand(env, ['plugin', 'list']);
    assert.match(listBefore.stdout, /goldband@goldband-local/);
    assert.match(listBefore.stdout, /not installed/);

    const add = runCodexPluginCommand(env, [
      'plugin',
      'add',
      'goldband@goldband-local',
    ]);
    assert.match(add.stdout, /Installed plugin root:/);

    const listAfter = runCodexPluginCommand(env, ['plugin', 'list']);
    assert.match(listAfter.stdout, /goldband@goldband-local/);
    assert.match(listAfter.stdout, /installed, enabled/);

    const installedRoot = readInstalledPluginRoot(add.stdout);
    assert.ok(
      fs.existsSync(path.join(installedRoot, '.codex-plugin/plugin.json')),
    );
    assertNoHeavyRuntime(
      listFiles(installedRoot).map((filePath) =>
        path.relative(installedRoot, filePath),
      ),
      'Codex installed plugin cache',
    );
  } finally {
    fs.rmSync(tmpHome, { force: true, recursive: true });
  }
}

function runCodexPluginCommand(env, args) {
  const result = spawnSync('codex', args, {
    cwd: ROOT_DIR,
    env,
    encoding: 'utf8',
  });
  assert.ifError(result.error);
  assert.equal(
    result.status,
    0,
    [result.stdout, result.stderr]
      .filter((output) => typeof output === 'string')
      .map((output) => output.trim())
      .filter(Boolean)
      .join('\n'),
  );
  return result;
}

function readInstalledPluginRoot(stdout) {
  const match = stdout.match(/Installed plugin root:\s*(.+)$/m);
  assert.ok(match, 'Codex plugin add output must include installed root');
  return match[1].trim();
}

function assertClaudeAppAdapters(expected) {
  const manifest = readJson(CLAUDE_DESKTOP_EXTENSION_MANIFEST_PATH);
  validateClaudeDesktopManifest(manifest);
  assertNoHeavyRuntime(
    listFiles(CLAUDE_DESKTOP_EXTENSION_ROOT_PATH).map((filePath) =>
      path.relative(ROOT_DIR, filePath),
    ),
    'Claude Desktop extension package',
  );
  assertMcpWrapperFailsClosed(
    path.join(CLAUDE_DESKTOP_EXTENSION_ROOT_PATH, 'server', 'index.js'),
  );
  assertClaudeDesktopPackageBuilds(expected.claudeApp.desktopPackage);
  assertRemoteConnectorTemplate();
}

function validateClaudeDesktopManifest(manifest) {
  assert.equal(manifest.manifest_version, '0.3');
  assert.equal(manifest.name, 'goldband-local-extension');
  assert.equal(manifest.server.type, 'node');
  assert.equal(manifest.server.entry_point, 'server/index.js');
  assert.deepEqual(manifest.server.mcp_config.args, [
    '${__dirname}/server/index.js',
  ]);
  assert.equal(
    manifest.server.mcp_config.env.GOLDBAND_REPO_DIR,
    '${user_config.goldband_repo_dir}',
  );
  assert.equal(manifest.user_config.goldband_repo_dir.type, 'directory');
  assert.deepEqual(
    manifest.tools.map((tool) => tool.name).sort(),
    readGoldbandMcpToolNames(),
  );
}

function assertClaudeDesktopPackageBuilds(expectedPackagePath) {
  const expectedAbsolutePackagePath = path.join(ROOT_DIR, expectedPackagePath);
  assert.ok(
    fs.existsSync(expectedAbsolutePackagePath),
    `Claude Desktop package missing: ${expectedPackagePath}`,
  );
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'goldband-mcpb-'));
  const packagePath = path.join(tmpDir, 'goldband-local-extension.mcpb');
  try {
    const result = spawnSync(
      process.execPath,
      ['scripts/build-claude-app-adapters.mjs', '--output', packagePath],
      { cwd: ROOT_DIR, encoding: 'utf8' },
    );
    assert.equal(
      result.status,
      0,
      [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join('\n'),
    );
    const entries = listZipEntries(packagePath);
    assert.ok(entries.includes('manifest.json'));
    assert.ok(entries.includes('server/index.js'));
    assert.ok(entries.includes('README.md'));
    assert.match(expectedPackagePath, /goldband-local-extension\.mcpb$/);
    assert.deepEqual(
      fs.readFileSync(packagePath),
      fs.readFileSync(expectedAbsolutePackagePath),
      'committed Claude Desktop MCPB package is stale; run npm run sync:app-support',
    );
  } finally {
    fs.rmSync(tmpDir, { force: true, recursive: true });
  }
}

function assertRemoteConnectorTemplate() {
  const template = readJson(CLAUDE_REMOTE_CONNECTOR_TEMPLATE_PATH);
  assert.equal(template.type, 'remote-mcp-registration-template');
  assert.equal(template.transport, 'streamable-http');
  assert.match(template.remoteMcpUrl, /^https:\/\//);
  assert.equal(template.security.exposeOnlyPortableSubset, true);
  assert.equal(template.security.doNotExposeClaudeCodeHooks, true);
  assert.equal(template.security.doNotExposeGoldbandLoopRuntime, true);
  assert.ok(Array.isArray(template.expectedTools));
  assert.deepEqual(
    [...template.expectedTools].sort(),
    readGoldbandMcpToolNames(),
  );
}

function assertTempHomeCodexAppStatus() {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'goldband-app-home-'));
  try {
    const env = {
      ...process.env,
      HOME: tmpHome,
      CODEX_REQUIREMENTS_FILE: path.join(
        tmpHome,
        'etc/codex/requirements.toml',
      ),
    };
    const install = spawnSync('bash', ['./install.sh', 'codex-full'], {
      cwd: ROOT_DIR,
      env,
      encoding: 'utf8',
    });
    assert.equal(
      install.status,
      0,
      [install.stdout.trim(), install.stderr.trim()].filter(Boolean).join('\n'),
    );

    const status = spawnSync('bash', ['./install.sh', 'status'], {
      cwd: ROOT_DIR,
      env,
      encoding: 'utf8',
    });
    assert.equal(
      status.status,
      0,
      [status.stdout.trim(), status.stderr.trim()].filter(Boolean).join('\n'),
    );
    const cleanStatus = stripAnsi(status.stdout);
    assert.match(cleanStatus, /\[OK\] Codex app compatible shared config/);
    assert.doesNotMatch(cleanStatus, /missing: .*~\/\.codex/);
    assert.match(cleanStatus, /\[OK\] Codex plugin package available/);
    assert.match(cleanStatus, /\[OK\] Claude Desktop local extension package/);
    assert.match(cleanStatus, /\[OK\] Claude remote MCP connector template/);
  } finally {
    fs.rmSync(tmpHome, { force: true, recursive: true });
  }
}

function assertDirectoryCopyFallbackStatusHelper() {
  const result = spawnSync(
    'bash',
    [
      '-c',
      [
        'set -euo pipefail',
        'source shell/install/common.sh',
        'tmp=$(mktemp -d)',
        'trap "rm -rf $tmp" EXIT',
        'mkdir -p "$tmp/src/nested" "$tmp/dest"',
        'printf hello > "$tmp/src/nested/file.txt"',
        'cp -R "$tmp/src/." "$tmp/dest/"',
        'repo_path_installed_from "$tmp/src" "$tmp/dest"',
      ].join('\n'),
    ],
    {
      cwd: ROOT_DIR,
      encoding: 'utf8',
    },
  );
  assert.equal(
    result.status,
    0,
    [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join('\n'),
  );
}

function assertFileCopyFallbackStatusHelper() {
  const result = spawnSync(
    'bash',
    [
      '-c',
      [
        'set -euo pipefail',
        'source shell/install/common.sh',
        'tmp=$(mktemp -d)',
        'trap "rm -rf $tmp" EXIT',
        'printf hello > "$tmp/src.txt"',
        'cp "$tmp/src.txt" "$tmp/dest.txt"',
        'repo_path_installed_from "$tmp/src.txt" "$tmp/dest.txt"',
      ].join('\n'),
    ],
    {
      cwd: ROOT_DIR,
      encoding: 'utf8',
    },
  );
  assert.equal(
    result.status,
    0,
    [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join('\n'),
  );
}

function readGoldbandMcpToolNames() {
  const source = fs.readFileSync(
    path.join(ROOT_DIR, 'mcp/server/src/server.ts'),
    'utf8',
  );
  const toolNames = [
    ...source.matchAll(/server\.registerTool\(\s*(['"])([^'"]+)\1/g),
  ]
    .map((match) => match[2])
    .sort();
  assert.notDeepEqual(
    toolNames,
    [],
    'MCP tool-name extraction found no server.registerTool calls',
  );
  return toolNames;
}

function stripAnsi(value) {
  return value.replace(/\u001b\[[0-9;]*m/g, '');
}

function assertMcpWrapperFailsClosed(wrapperPath) {
  const result = spawnSync(process.execPath, [wrapperPath], {
    cwd: ROOT_DIR,
    env: { ...process.env, GOLDBAND_REPO_DIR: '' },
    encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /GOLDBAND_REPO_DIR is required/);
}

function assertNoHeavyRuntime(files, label) {
  assert.deepEqual(
    files.filter((filePath) => filePath.includes('goldband-loop')),
    [],
    `${label} must not contain Goldband Loop runtime`,
  );
}

function assertNoBoundaryWordingRegressions() {
  const filesToScan = [
    'README.md',
    'README.en.md',
    'ARCHITECTURE.md',
    'docs/DECISIONS.md',
    'docs/reports/plugin-distribution-verification.md',
    'docs/reports/app-support-verification.md',
  ];
  const violations = [];
  for (const relativePath of filesToScan) {
    const absolutePath = path.join(ROOT_DIR, relativePath);
    if (!fs.existsSync(absolutePath)) {
      continue;
    }
    const content = fs.readFileSync(absolutePath, 'utf8');
    collectBoundaryViolations(relativePath, content, violations);
  }
  assert.deepEqual(violations, [], violations.join('\n'));
}

function collectBoundaryViolations(relativePath, content, violations) {
  const forbidden = [
    {
      pattern:
        /Claude Desktop[^.\n]*(?:uses|loads|reads|honors|configured via|is configured by)[^.\n]*(?:~\/\.claude\/settings\.json|settings\.json)/i,
      message: 'must not say Claude Desktop uses Claude Code settings.json',
    },
    {
      pattern: /Claude app parity|Claude\/Codex app parity|app parity/i,
      message: 'must not claim app parity',
    },
    {
      pattern:
        /Goldband Loop[^.\n]*(?:Codex plugin|Claude Desktop|Claude app)[^.\n]*(?:supported|packaged|included)/i,
      message: 'must not package Goldband Loop as app/plugin support',
    },
    {
      pattern: /Packaging placeholder/i,
      message: 'must not leave Codex plugin placeholder wording',
    },
  ];
  for (const rule of forbidden) {
    if (rule.pattern.test(content)) {
      violations.push(`${relativePath}: ${rule.message}`);
    }
  }
}

function listZipEntries(zipPath) {
  const buffer = fs.readFileSync(zipPath);
  const entries = [];
  let offset = 0;
  while (offset < buffer.length) {
    const signature = buffer.readUInt32LE(offset);
    if (signature === 0x02014b50) {
      const nameLength = buffer.readUInt16LE(offset + 28);
      const extraLength = buffer.readUInt16LE(offset + 30);
      const commentLength = buffer.readUInt16LE(offset + 32);
      entries.push(
        buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8'),
      );
      offset += 46 + nameLength + extraLength + commentLength;
      continue;
    }
    if (signature === 0x06054b50) {
      break;
    }
    offset += 1;
  }
  return entries.sort();
}

function listFiles(rootDir) {
  const files = [];
  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    if (entry.name === '.DS_Store') {
      continue;
    }
    const entryPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFiles(entryPath));
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }
  return files.sort();
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

main();
