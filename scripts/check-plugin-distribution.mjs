#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import {
  diffArtifacts,
  EXPECTED_ASSETS_PATH,
  MOD_SOURCE_PATH,
  MOD_TESTS_DIR,
  PLUGIN_HOOKS_PATH,
  PLUGIN_ROOT_PATH,
  ROOT_DIR,
  readExpectedAssets,
} from './lib/plugin-distribution.mjs';
import { summarizeHooks } from './lib/plugin-hook-summary.mjs';

const require = createRequire(import.meta.url);

function main() {
  const skipCli = process.argv.includes('--skip-cli');
  assert.deepEqual(
    diffArtifacts(),
    [],
    'plugin generated artifacts are out of date',
  );
  const expected = readExpectedAssets();
  assertExpectedFilesExist(expected);
  assertCodexRuntimeDependencyClosure(expected);
  assertPluginHookCommandsArePortable();
  assertPluginPackageShape(PLUGIN_ROOT_PATH, expected);
  if (!skipCli) {
    assertTempHomePluginInstall(expected);
    assertModTestsPass();
    assertPluginDataDirsMatchHost();
  }
  console.log('[OK] plugin distribution check passed');
}

function localRequirePaths(file) {
  const content = fs.readFileSync(file, 'utf8');
  return [...content.matchAll(/require\(['"](\.\/[^'"]+)['"]\)/g)].map(
    (match) => match[1],
  );
}

function resolveLocalModule(fromFile, request) {
  const candidate = path.resolve(path.dirname(fromFile), request);
  return [
    candidate,
    `${candidate}.js`,
    `${candidate}.cjs`,
    `${candidate}.json`,
  ].find((file) => fs.existsSync(file));
}

function assertCodexRuntimeDependencyClosure(expected) {
  const root = path.join(ROOT_DIR, 'codex', 'hooks');
  const pending = [path.join(root, 'hook-router.js')];
  const visited = new Set();
  const dependencies = new Set();
  while (pending.length > 0) {
    const file = pending.pop();
    if (visited.has(file)) continue;
    visited.add(file);
    for (const request of localRequirePaths(file)) {
      const dependency = resolveLocalModule(file, request);
      if (!dependency || !dependency.startsWith(`${root}${path.sep}`)) continue;
      dependencies.add(
        path.relative(ROOT_DIR, dependency).split(path.sep).join('/'),
      );
      pending.push(dependency);
    }
  }
  const inventory = new Set(expected.codex.hookRuntimeDependencies);
  assert.deepEqual(
    [...dependencies].filter((file) => !inventory.has(file)),
    [],
    'Codex hook dependency closure is missing from plugin inventory',
  );
}

function assertExpectedFilesExist(expected) {
  assert.equal(expected.schemaVersion, 1);
  const requiredPaths = [
    expected.plugin.manifest,
    expected.plugin.marketplaceManifest,
    expected.claude.generatedRuleSkill,
    expected.claude.rulesManifest,
    ...expected.claude.commands,
    ...expected.claude.rules,
    ...expected.claude.hookScripts,
    ...expected.claude.modules,
    ...expected.claude.runtimeDependencies,
    ...expected.codex.reviewRuntimeDependencies,
    ...expected.codex.hookRuntimeDependencies,
  ];
  for (const relative of requiredPaths) {
    assert.ok(
      fs.existsSync(path.join(ROOT_DIR, relative)),
      `missing expected asset: ${relative}`,
    );
  }
  assert.ok(
    fs.existsSync(EXPECTED_ASSETS_PATH),
    'expected asset list is missing',
  );
}

function assertPluginHookCommandsArePortable() {
  const content = fs.readFileSync(PLUGIN_HOOKS_PATH, 'utf8');
  assert.ok(
    content.includes('${CLAUDE_PLUGIN_ROOT}/hooks'),
    'plugin hooks must resolve bundled hook scripts via CLAUDE_PLUGIN_ROOT',
  );
  assert.equal(
    content.includes('${HOOKS_DIR}'),
    false,
    'plugin hooks still contain HOOKS_DIR',
  );
  assert.equal(
    content.includes('${CLAUDE_DIR}'),
    false,
    'plugin hooks still contain CLAUDE_DIR',
  );
}

function assertTempHomePluginInstall(expected) {
  const tmpHome = fs.mkdtempSync(
    path.join(os.tmpdir(), 'goldband-plugin-home.'),
  );
  try {
    runClaude(tmpHome, ['plugin', 'validate', '.']);
    runClaude(tmpHome, ['plugin', 'marketplace', 'add', './']);
    runClaude(tmpHome, [
      'plugin',
      'install',
      `${expected.plugin.name}@${expected.plugin.marketplace}`,
      '--scope',
      'user',
    ]);
    const list = runClaude(tmpHome, ['plugin', 'list', '--json']);
    const installed = findInstalledPlugin(JSON.parse(list.stdout), expected);
    assert.equal(
      installed.errors,
      undefined,
      `installed plugin reported errors: ${JSON.stringify(installed.errors)}`,
    );
    assertInstalledAssets(installed.installPath, expected);
    assertPluginPackageShape(installed.installPath, expected);
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
}

// Mod tests are not shipped, so they run against a copy of the plugin.
function assertModTestsPass() {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'goldband-mod.'));
  const tmpHome = path.join(tmpRoot, 'home');
  const tmpPlugin = path.join(tmpRoot, 'plugin');
  try {
    fs.mkdirSync(tmpHome);
    fs.cpSync(PLUGIN_ROOT_PATH, tmpPlugin, { recursive: true });
    fs.cpSync(
      path.join(MOD_SOURCE_PATH, MOD_TESTS_DIR),
      path.join(tmpPlugin, 'hooks', 'mod', MOD_TESTS_DIR),
      { recursive: true },
    );
    runClaude(tmpHome, ['plugin', 'validate', tmpPlugin]);
    runClaude(tmpHome, ['plugin', 'test', tmpPlugin]);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

// The mod derives CLAUDE_PLUGIN_DATA because its child processes do not get
// it. A probe plugin pairs a command hook, which records the value the host
// passes, with a mod that runs the goldband mod's own resolver against the
// host's real `$.plugin.root` and `claude plugin list`, and records the result
// through a child process given only an extra variable (so HOME and PATH must
// still arrive). The marketplace name holds a `.` so the character
// replacement is exercised.
// The hooks' CLAUDE_PLUGIN_DATA is the truth; the mod derives the same
// directory, and skill text receives it by substitution.
function assertPluginDataDirsMatchHost() {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'goldband-data-dir.'));
  const tmpHome = path.join(tmpRoot, 'home');
  try {
    const marketplace = writeProbeMarketplace(path.join(tmpRoot, 'market'));
    fs.mkdirSync(tmpHome);
    runClaude(tmpHome, ['plugin', 'marketplace', 'add', marketplace]);
    runClaude(tmpHome, ['plugin', 'install', 'probe@probe.market']);
    // A slash command ends the session before any model call; a skill's
    // injected command runs as the skill text loads.
    const sessions = ['/probe-session-start', '/probe:probe-skill'].map(
      (prompt) =>
        spawnSync('claude', ['-p', prompt], {
          cwd: tmpHome,
          env: tempHomeEnv(tmpHome),
          input: '',
          encoding: 'utf8',
          timeout: 120_000,
        }),
    );
    const read = (name) => {
      const file = path.join(tmpHome, name);
      assert.ok(
        fs.existsSync(file),
        `probe session wrote no ${name}: ${JSON.stringify(
          sessions.map((session) => ({
            status: session.status,
            error: session.error?.message,
            stderr: session.stderr,
          })),
        )}`,
      );
      return fs.readFileSync(file, 'utf8');
    };
    assert.equal(
      read('probe-mod-data-dir'),
      `ok ${read('probe-data-dir')}`,
      'mod plugin data dir matches the host',
    );
    assert.equal(
      read('probe-skill-data-dir'),
      read('probe-data-dir'),
      'skill text receives the hooks plugin data dir',
    );
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

const PROBE_MOD = `import type { Register } from 'claude-code';
import { resolvePluginDataDir } from './install-paths';

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    let line: string;
    try {
      line = \`ok \${await resolvePluginDataDir($)}\`;
    } catch (error) {
      line = \`error \${String(error)}\`;
    }
    await $.process.run(
      ['node', '-e', 'require("fs").writeFileSync(process.env.HOME + "/probe-mod-data-dir", process.env.PROBE_LINE)'],
      { env: { PROBE_LINE: line } },
    );
    return next(e);
  });
};
`;

// Single quotes keep the shell out: only the host's substitution can fill it.
const PROBE_SKILL = `---
name: probe-skill
description: Records the plugin data dir substituted into skill text.
allowed-tools: Bash
---
!\`printf '%s' '\${CLAUDE_PLUGIN_DATA}' > "$HOME/probe-skill-data-dir"\`
`;

function writeProbeMarketplace(dir) {
  const files = {
    '.claude-plugin/marketplace.json': JSON.stringify({
      name: 'probe.market',
      owner: { name: 'goldband' },
      plugins: [{ name: 'probe', source: './probe' }],
    }),
    'probe/.claude-plugin/plugin.json': JSON.stringify({
      name: 'probe',
      version: '0.1.0',
    }),
    'probe/hooks/hooks.json': JSON.stringify({
      hooks: {
        SessionStart: [
          {
            hooks: [
              {
                type: 'command',
                command:
                  'printf \'%s\' "$CLAUDE_PLUGIN_DATA" > "$HOME/probe-data-dir"',
              },
            ],
          },
        ],
      },
      modules: ['./mod/register.ts'],
    }),
    'probe/hooks/mod/register.ts': PROBE_MOD,
    'probe/skills/probe-skill/SKILL.md': PROBE_SKILL,
    'probe/hooks/mod/install-paths.ts': fs.readFileSync(
      path.join(MOD_SOURCE_PATH, 'install-paths.ts'),
      'utf8',
    ),
  };
  for (const [file, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), content);
  }
  return dir;
}

// Claude Code under a temp HOME, never the developer's own config directory,
// and without credentials: a probe session must end before any model call.
function tempHomeEnv(home) {
  const env = { ...process.env, HOME: home };
  for (const name of [
    'CLAUDE_CONFIG_DIR',
    'ANTHROPIC_API_KEY',
    'ANTHROPIC_AUTH_TOKEN',
    'CLAUDE_CODE_OAUTH_TOKEN',
    'CLAUDE_CODE_USE_BEDROCK',
    'CLAUDE_CODE_USE_VERTEX',
    'CLAUDE_CODE_USE_FOUNDRY',
  ]) {
    delete env[name];
  }
  return env;
}

function assertPluginPackageShape(pluginRootPath, expected) {
  assertInstalledAssets(pluginRootPath, expected);
  assertInstalledRuntimeExecutes(pluginRootPath);
  assertNoHeavyRuntime(pluginRootPath);
}

function runClaude(tmpHome, args) {
  const result = spawnSync('claude', args, {
    cwd: ROOT_DIR,
    env: tempHomeEnv(tmpHome),
    encoding: 'utf8',
  });
  if (result.status === 0) {
    return result;
  }
  throw new Error(
    [
      `claude ${args.join(' ')} failed in temp HOME`,
      result.stdout.trim(),
      result.stderr.trim(),
    ]
      .filter(Boolean)
      .join('\n'),
  );
}

function findInstalledPlugin(installedPlugins, expected) {
  const pluginId = `${expected.plugin.name}@${expected.plugin.marketplace}`;
  const installed = installedPlugins.find((plugin) => plugin.id === pluginId);
  assert.ok(installed, `plugin not installed: ${pluginId}`);
  assert.ok(installed.installPath, `plugin installPath missing: ${pluginId}`);
  return installed;
}

function assertInstalledAssets(installPath, expected) {
  assertCommandAssets(installPath, expected);
  assertSkillAssets(installPath, expected);
  assertHookAssets(installPath, expected);
  assertRuntimeDependencies(installPath, expected);
  assertRulesAssets(installPath, expected);
  assertGeneratedRuleSkillIndexPathsResolve(installPath);
  assertModAssets(installPath, expected);
}

function assertRulesAssets(installPath, expected) {
  for (const rulePath of [
    expected.claude.rulesManifest,
    ...expected.claude.rules,
  ]) {
    assert.ok(
      fs.existsSync(path.join(installPath, rulePath)),
      `installed Rule asset missing: ${rulePath}`,
    );
  }
}

function assertGeneratedRuleSkillIndexPathsResolve(installPath) {
  const ruleSkillPath = path.join(
    installPath,
    'skills',
    'goldband-rules',
    'SKILL.md',
  );
  const ruleSkill = fs.readFileSync(ruleSkillPath, 'utf8');
  const indexedRulePaths = [...ruleSkill.matchAll(/^- `([^`]+)` - /gm)].map(
    (match) => match[1],
  );

  assert.ok(
    indexedRulePaths.length > 0,
    'generated goldband-rules skill did not list any rule paths',
  );
  for (const relativeRulePath of indexedRulePaths) {
    assert.ok(
      fs.existsSync(
        path.resolve(path.dirname(ruleSkillPath), relativeRulePath),
      ),
      `generated goldband-rules index path does not resolve from skill directory: ${relativeRulePath}`,
    );
  }
}

function assertCommandAssets(installPath, expected) {
  for (const commandPath of expected.claude.commands) {
    assert.ok(
      fs.existsSync(path.join(installPath, commandPath)),
      `installed command missing: ${commandPath}`,
    );
  }
}

function assertSkillAssets(installPath, expected) {
  const actualSkills = fs
    .readdirSync(path.join(installPath, 'skills'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .filter((entry) =>
      fs.existsSync(path.join(installPath, 'skills', entry.name, 'SKILL.md')),
    )
    .map((entry) => entry.name)
    .sort();
  assert.deepEqual(actualSkills, [...expected.claude.skills].sort());
}

function assertHookAssets(installPath, expected) {
  const hooksFile = path.join(installPath, 'hooks', 'hooks.json');
  assert.ok(fs.existsSync(hooksFile), 'installed plugin hooks file missing');
  const hooks = JSON.parse(fs.readFileSync(hooksFile, 'utf8')).hooks;
  assert.deepEqual(summarizeHooks(hooks), expected.claude.hooks);
  for (const hookScript of expected.claude.hookScripts) {
    assert.ok(
      fs.existsSync(path.join(installPath, hookScript)),
      `installed hook script missing: ${hookScript}`,
    );
  }
}

function assertRuntimeDependencies(installPath, expected) {
  for (const runtimeDependency of expected.claude.runtimeDependencies) {
    assert.ok(
      fs.existsSync(path.join(installPath, runtimeDependency)),
      `installed runtime dependency missing: ${runtimeDependency}`,
    );
  }
}

function assertModAssets(installPath, expected) {
  const hooks = JSON.parse(
    fs.readFileSync(path.join(installPath, 'hooks', 'hooks.json'), 'utf8'),
  );
  assert.deepEqual(
    hooks.modules.map((module) => path.posix.join('hooks', module)),
    expected.claude.modules,
  );
  for (const modulePath of expected.claude.modules) {
    assert.ok(
      fs.existsSync(path.join(installPath, modulePath)),
      `installed mod module missing: ${modulePath}`,
    );
  }
  for (const commandPath of expected.claude.modReplacedCommands) {
    assert.equal(
      fs.existsSync(path.join(installPath, commandPath)),
      false,
      `plugin must not ship ${commandPath}; the mod serves that command`,
    );
  }
  assert.ok(
    fs.existsSync(
      path.join(installPath, 'commands/scripts/set-goldband-language.sh'),
    ),
    'plugin must ship the language helper the mod runs',
  );
}

function assertNoHeavyRuntime(installPath) {
  const matches = findNamedDirectories(installPath, 'goldband-loop');
  assert.deepEqual(matches, [], 'plugin cache must not contain goldband-loop');
}

function assertInstalledRuntimeExecutes(installPath) {
  runNodeHook(installPath, 'hooks/scripts/hooks/hook-router.js', {});
  runNodeHook(installPath, 'hooks/scripts/hooks/hook-router.js', {
    hook_event_name: 'Stop',
    session_id: 'plugin-runtime-test',
  });
  assertPackagedRulesResolver(installPath);
  assertPackagedModeScriptsExecute(installPath);
  assertPackagedStatusScriptExecutes(installPath);
  const suggestions = runNodeHook(
    installPath,
    'hooks/scripts/hooks/skill-activation-suggestions.js',
    {
      hook_event_name: 'UserPromptSubmit',
      prompt: 'hello',
      session_id: 'plugin-runtime-test',
    },
  );
  assert.doesNotThrow(() => JSON.parse(suggestions.stdout || '{}'));
  assert.equal(
    suggestions.stdout.includes('Cross-review gate armed'),
    false,
    'skill activation hook must not report cross-review armed when runtime is absent',
  );
}

function assertPackagedRulesResolver(installPath) {
  const packagedResolver = require(
    path.join(installPath, 'hooks/scripts/lib/rules-resolver.js'),
  );
  const bundle = packagedResolver.resolveRules({
    repoRoot: ROOT_DIR,
    rulesDir: path.join(installPath, 'rules'),
    phase: 'review',
    paths: ['src/app.ts'],
  });
  assert.ok(
    bundle.rules.some((rule) => rule.id === 'semantic-review-criteria'),
    'packaged review Rules must include semantic-review-criteria',
  );
  assert.match(
    packagedResolver.formatRulesBundle(bundle),
    /Architecture and Integration Boundaries/,
  );
}

function assertPackagedModeScriptsExecute(installPath) {
  for (const modeName of ['careful-mode', 'freeze-mode']) {
    const result = runNodeHook(
      installPath,
      `skills/${modeName}/scripts/${modeName}.js`,
      {},
      ['status', '--session', 'plugin-runtime-test', '--json'],
    );
    assert.equal(JSON.parse(result.stdout).modeName, modeName);
    assertModeCommandsPassPluginData(installPath, modeName);
  }
}

// The model's shell has no CLAUDE_PLUGIN_DATA; the host substitutes it into
// skill text, so every documented command must carry it to the script.
function assertModeCommandsPassPluginData(installPath, modeName) {
  const skill = fs.readFileSync(
    path.join(installPath, `skills/${modeName}/SKILL.md`),
    'utf8',
  );
  const commands = skill.match(/`[^`]*node scripts\/[^`]*`/g) ?? [];
  assert.ok(commands.length > 0, `${modeName} documents no commands`);
  for (const command of commands) {
    assert.ok(
      command.startsWith('`CLAUDE_PLUGIN_DATA="${CLAUDE_PLUGIN_DATA}" node '),
      `${modeName} command must pass the plugin data dir: ${command}`,
    );
  }
}

function assertPackagedStatusScriptExecutes(installPath) {
  const result = runNodeHook(
    installPath,
    'hooks/scripts/tools/goldband-status.js',
    {},
    ['--session', 'plugin-runtime-test'],
  );
  assert.deepEqual(
    JSON.parse(result.stdout).sources.map((source) => source.name),
    ['careful-mode', 'freeze-mode', 'cross-review'],
  );
}

function runNodeHook(installPath, relativeScriptPath, input, args = []) {
  const dataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'goldband-plugin-runtime-data.'),
  );
  try {
    const result = spawnSync(
      process.execPath,
      [path.join(installPath, relativeScriptPath), ...args],
      {
        cwd: installPath,
        env: {
          ...process.env,
          CLAUDE_PLUGIN_ROOT: installPath,
          GOLDBAND_DATA_DIR: dataDir,
        },
        input: `${JSON.stringify(input)}\n`,
        encoding: 'utf8',
      },
    );
    assert.equal(
      result.status,
      0,
      [
        `plugin runtime failed: ${relativeScriptPath}`,
        result.stdout.trim(),
        result.stderr.trim(),
      ]
        .filter(Boolean)
        .join('\n'),
    );
    return result;
  } finally {
    fs.rmSync(dataDir, { force: true, recursive: true });
  }
}

function findNamedDirectories(rootDir, name) {
  const matches = [];
  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    const entryPath = path.join(rootDir, entry.name);
    if (!entry.isDirectory()) {
      continue;
    }
    if (entry.name === name) {
      matches.push(entryPath);
    }
    matches.push(...findNamedDirectories(entryPath, name));
  }
  return matches;
}

main();
