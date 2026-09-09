import fs from 'node:fs';
import path from 'node:path';
import { summarizeHooks } from './plugin-hook-summary.mjs';

export const ROOT_DIR = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  '../..',
);
export const PLUGIN_ROOT_PATH = path.join(
  ROOT_DIR,
  'plugin-assets',
  'claude-code-plugin',
);
export const ROOT_PLUGIN_MANIFEST_PATH = path.join(
  ROOT_DIR,
  '.claude-plugin',
  'plugin.json',
);
export const MARKETPLACE_PATH = path.join(
  ROOT_DIR,
  '.claude-plugin',
  'marketplace.json',
);
export const PLUGIN_HOOKS_PATH = path.join(
  PLUGIN_ROOT_PATH,
  'hooks',
  'hooks.json',
);
export const PLUGIN_MANIFEST_PATH = path.join(
  PLUGIN_ROOT_PATH,
  '.claude-plugin',
  'plugin.json',
);
export const ROOT_PLUGIN_HOOKS_PATH = path.join(
  ROOT_DIR,
  'hooks',
  'plugin-hooks.json',
);
export const EXPECTED_ASSETS_PATH = path.join(
  ROOT_DIR,
  'docs',
  'reports',
  'plugin-expected-assets.json',
);
export const GENERATED_RULE_SKILL_PATH = path.join(
  PLUGIN_ROOT_PATH,
  'skills',
  'goldband-rules',
  'SKILL.md',
);

const MANAGED_COMMANDS = [
  '.claude-plugin/plugin.json',
  '.claude-plugin/marketplace.json',
  'hooks/plugin-hooks.json',
  'docs/reports/plugin-expected-assets.json',
  'plugin-assets/claude-code-plugin/**',
  'codex/hooks/cross-review-gate.js',
  'codex/hooks/module-loader.js',
  'codex/hooks/telemetry-schema.cjs',
  'codex/hooks/review-launch-advisory.js',
  'codex/hooks/session-state.js',
];

export function buildPluginArtifacts() {
  const commands = markdownFiles('commands');
  const sourceSkills = skillDirs('skills/global');
  const rules = markdownFiles('rules');
  const hookConfig = buildPluginHooks();
  const manifest = buildManifest();
  const marketplace = buildMarketplace(manifest);
  const expectedAssets = buildExpectedAssets({
    commands,
    hookConfig,
    rules,
    sourceSkills,
  });
  const artifacts = new Map([
    [ROOT_PLUGIN_MANIFEST_PATH, stableJson(manifest)],
    [PLUGIN_MANIFEST_PATH, stableJson(manifest)],
    [MARKETPLACE_PATH, stableJson(marketplace)],
    [PLUGIN_HOOKS_PATH, stableJson(hookConfig)],
    [ROOT_PLUGIN_HOOKS_PATH, stableJson(hookConfig.hooks)],
    [EXPECTED_ASSETS_PATH, stableJson(expectedAssets)],
    [GENERATED_RULE_SKILL_PATH, buildRuleSkill(rules)],
  ]);

  addDirectoryArtifacts(
    artifacts,
    'commands',
    path.join(PLUGIN_ROOT_PATH, 'commands'),
  );
  addDirectoryArtifacts(
    artifacts,
    'skills/global',
    path.join(PLUGIN_ROOT_PATH, 'skills'),
  );
  addDirectoryArtifacts(
    artifacts,
    'hooks/scripts',
    path.join(PLUGIN_ROOT_PATH, 'hooks', 'scripts'),
  );
  addDirectoryArtifacts(
    artifacts,
    'rules',
    path.join(PLUGIN_ROOT_PATH, 'rules'),
  );
  addFileArtifact(
    artifacts,
    'scripts/lib/telemetry-schema.cjs',
    path.join(PLUGIN_ROOT_PATH, 'scripts', 'lib', 'telemetry-schema.cjs'),
  );
  addSharedAdapterArtifacts(artifacts);
  return artifacts;
}

function addSharedAdapterArtifacts(artifacts) {
  addFileArtifact(
    artifacts,
    'hooks/scripts/lib/skill-activation/session-state.js',
    path.join(ROOT_DIR, 'codex', 'hooks', 'session-state.js'),
  );
  addFileArtifact(
    artifacts,
    'hooks/scripts/lib/hook-router/review-launch-advisory.js',
    path.join(ROOT_DIR, 'codex', 'hooks', 'review-launch-advisory.js'),
  );
  addFileArtifact(
    artifacts,
    'scripts/lib/telemetry-schema.cjs',
    path.join(ROOT_DIR, 'codex', 'hooks', 'telemetry-schema.cjs'),
  );
}

function buildManifest() {
  const packageJson = readJson(path.join(ROOT_DIR, 'package.json'));
  return {
    name: 'goldband',
    displayName: 'Goldband',
    version: packageJson.version,
    description:
      'Production-focused Claude Code config with portable skills, commands, and hook guardrails.',
    author: {
      name: 'Leo',
    },
    license: 'MIT',
    homepage: 'https://github.com/leo110047/goldband',
    repository: 'https://github.com/leo110047/goldband',
    keywords: [
      'claude-code',
      'hooks',
      'skills',
      'guardrails',
      'operations',
      'security',
      'telemetry',
    ],
    commands: './commands/',
    skills: './skills/',
  };
}

function buildMarketplace(manifest) {
  return {
    name: 'goldband',
    description:
      'Goldband Claude Code plugin marketplace for local distribution.',
    owner: {
      name: 'Leo',
    },
    plugins: [
      {
        name: 'goldband',
        source: './plugin-assets/claude-code-plugin',
        description: manifest.description,
        version: manifest.version,
        author: manifest.author,
      },
    ],
  };
}

const REVIEW_RULE_RUNTIME_FILES = ['rules-resolver.js'];

function runtimeDependencyPaths(prefix) {
  return REVIEW_RULE_RUNTIME_FILES.map((file) => `${prefix}/${file}`);
}

function buildExpectedAssets({ commands, hookConfig, rules, sourceSkills }) {
  return {
    schemaVersion: 1,
    generatedBy: 'scripts/sync-plugin-assets.mjs',
    plugin: {
      name: 'goldband',
      marketplace: 'goldband',
      root: 'plugin-assets/claude-code-plugin',
      manifest: relativePath(PLUGIN_MANIFEST_PATH),
      rootCompatibilityManifest: relativePath(ROOT_PLUGIN_MANIFEST_PATH),
      marketplaceManifest: relativePath(MARKETPLACE_PATH),
    },
    claude: {
      commands,
      skills: [...sourceSkills, 'goldband-rules'],
      hooks: summarizeHooks(hookConfig.hooks),
      runtimeDependencies: [
        'scripts/lib/telemetry-schema.cjs',
        ...runtimeDependencyPaths('hooks/scripts/lib'),
      ],
      hookScripts: [
        'hooks/scripts/hooks/hook-router.js',
        'hooks/scripts/hooks/post-edit-worker.js',
        'hooks/scripts/hooks/skill-activation-suggestions.js',
      ],
      rules,
      rulesManifest: 'rules/manifest.json',
      generatedRuleSkill: relativePath(GENERATED_RULE_SKILL_PATH),
    },
    codex: {
      distribution: 'installer',
      reviewRuntimeDependencies: runtimeDependencyPaths('hooks/scripts/lib'),
      hookRuntimeDependencies: [
        'codex/hooks/capability-routing.generated.json',
        'codex/hooks/cross-review-gate.js',
        'codex/hooks/high-risk-policy.js',
        'codex/hooks/module-loader.js',
        'codex/hooks/telemetry.js',
        'codex/hooks/telemetry-schema.cjs',
        'codex/hooks/review-launch-advisory.js',
        'codex/hooks/session-state.js',
      ],
      reason:
        'Codex plugins exist but package Codex skills/apps/MCP, not Claude Code settings. Root Codex install remains install.sh.',
    },
    outOfScope: [
      'goldband-loop workflow runtime',
      'Playwright/browser/iOS toolchains',
      'public marketplace submission',
    ],
  };
}

export function writeArtifacts(artifacts = buildPluginArtifacts()) {
  fs.rmSync(PLUGIN_ROOT_PATH, { force: true, recursive: true });
  for (const [filePath, content] of artifacts) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
  }
}

export function diffArtifacts(artifacts = buildPluginArtifacts()) {
  const diffs = [];
  for (const [filePath, expected] of artifacts) {
    const actual = fs.existsSync(filePath)
      ? fs.readFileSync(filePath, 'utf8')
      : null;
    if (actual !== expected) {
      diffs.push(relativePath(filePath));
    }
  }
  for (const extraFile of generatedPluginExtras(artifacts)) {
    diffs.push(extraFile);
  }
  return diffs;
}

export function readExpectedAssets() {
  return JSON.parse(fs.readFileSync(EXPECTED_ASSETS_PATH, 'utf8'));
}

export function managedGeneratedFiles() {
  return MANAGED_COMMANDS;
}

function buildPluginHooks() {
  const source = JSON.parse(
    fs.readFileSync(path.join(ROOT_DIR, 'hooks', 'hooks.json'), 'utf8'),
  );
  const hooks = JSON.parse(JSON.stringify(source.hooks || {}));
  rewriteHookCommands(hooks);
  return { hooks };
}

function rewriteHookCommands(node) {
  if (Array.isArray(node)) {
    node.forEach(rewriteHookCommands);
    return;
  }
  if (!node || typeof node !== 'object') {
    return;
  }
  if (typeof node.command === 'string') {
    node.command = node.command
      .replaceAll('${HOOKS_DIR}', '${CLAUDE_PLUGIN_ROOT}/hooks')
      .replaceAll('${CLAUDE_DIR}', '${CLAUDE_PLUGIN_ROOT}/hooks');
  }
  for (const value of Object.values(node)) {
    rewriteHookCommands(value);
  }
}

function buildRuleSkill(rules) {
  const entries = rules.map((rulePath) => {
    const skillRelativeRulePath = path
      .relative(
        path.dirname(GENERATED_RULE_SKILL_PATH),
        path.join(PLUGIN_ROOT_PATH, rulePath),
      )
      .split(path.sep)
      .join('/');
    const content = fs
      .readFileSync(path.join(ROOT_DIR, rulePath), 'utf8')
      .trim();
    const title = content.match(/^#\s+(.+)$/m)?.[1] || rulePath;
    const scope =
      content
        .match(/## Scope\s+([\s\S]*?)(?:\n## |\n# |$)/)?.[1]
        ?.trim()
        .replace(/\s+/g, ' ') ||
      'Load this rule when the task matches its filename and title.';
    return `- \`${skillRelativeRulePath}\` - ${title}. ${scope}`;
  });
  return [
    '---',
    'description: Load goldband shared engineering rules packaged for Claude Code plugin installs.',
    '---',
    '',
    '# Goldband Rules',
    '',
    'This generated skill is an index for the packaged `rules/` directory. Do not edit this file directly; run `node scripts/sync-plugin-assets.mjs` instead.',
    '',
    'Load only the specific rule file needed for the current task. Do not read every rule as startup context.',
    '',
    '## Rule Index',
    '',
    ...entries,
    '',
  ].join('\n');
}

function markdownFiles(dir) {
  return fs
    .readdirSync(path.join(ROOT_DIR, dir), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => `${dir}/${entry.name}`)
    .sort();
}

function skillDirs(dir) {
  return fs
    .readdirSync(path.join(ROOT_DIR, dir), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .filter((entry) =>
      fs.existsSync(path.join(ROOT_DIR, dir, entry.name, 'SKILL.md')),
    )
    .map((entry) => entry.name)
    .sort();
}

function addDirectoryArtifacts(artifacts, sourceDir, destinationDir) {
  const sourceRoot = path.join(ROOT_DIR, sourceDir);
  for (const sourceFile of listFiles(sourceRoot)) {
    const relative = path.relative(sourceRoot, sourceFile);
    const destination = path.join(destinationDir, relative);
    artifacts.set(destination, fs.readFileSync(sourceFile, 'utf8'));
  }
}

function addFileArtifact(artifacts, sourceFile, destinationFile) {
  artifacts.set(
    destinationFile,
    fs.readFileSync(path.join(ROOT_DIR, sourceFile), 'utf8'),
  );
}

function generatedPluginExtras(artifacts) {
  if (!fs.existsSync(PLUGIN_ROOT_PATH)) {
    return [];
  }
  const expected = new Set(
    [...artifacts.keys()]
      .filter((filePath) => filePath.startsWith(PLUGIN_ROOT_PATH))
      .map(relativePath),
  );
  return listFiles(PLUGIN_ROOT_PATH)
    .map(relativePath)
    .filter((filePath) => !expected.has(filePath));
}

function listFiles(rootDir) {
  const files = [];
  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    if (shouldIgnoreGeneratedAsset(entry.name)) {
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

function shouldIgnoreGeneratedAsset(name) {
  return name === '.DS_Store';
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function relativePath(filePath) {
  return path.relative(ROOT_DIR, filePath);
}
