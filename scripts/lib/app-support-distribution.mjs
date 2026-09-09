import fs from 'node:fs';
import path from 'node:path';
import { ROOT_DIR } from './plugin-distribution.mjs';

export const CODEX_PLUGIN_ROOT_PATH = path.join(
  ROOT_DIR,
  'plugin-assets',
  'codex-plugin',
);
export const ROOT_CODEX_PLUGIN_MANIFEST_PATH = path.join(
  ROOT_DIR,
  '.codex-plugin',
  'plugin.json',
);
export const CODEX_PLUGIN_MANIFEST_PATH = path.join(
  CODEX_PLUGIN_ROOT_PATH,
  '.codex-plugin',
  'plugin.json',
);
export const CODEX_MARKETPLACE_PATH = path.join(
  ROOT_DIR,
  '.agents',
  'plugins',
  'marketplace.json',
);
export const CLAUDE_DESKTOP_EXTENSION_ROOT_PATH = path.join(
  ROOT_DIR,
  'app-adapters',
  'claude-desktop',
  'goldband-local-extension',
);
export const CLAUDE_DESKTOP_EXTENSION_MANIFEST_PATH = path.join(
  CLAUDE_DESKTOP_EXTENSION_ROOT_PATH,
  'manifest.json',
);
export const CLAUDE_DESKTOP_EXTENSION_PACKAGE_PATH = path.join(
  ROOT_DIR,
  'app-adapters',
  'claude-desktop',
  'dist',
  'goldband-local-extension.mcpb',
);
export const CLAUDE_REMOTE_CONNECTOR_TEMPLATE_PATH = path.join(
  ROOT_DIR,
  'app-adapters',
  'claude-remote',
  'goldband-connector.template.json',
);
export const APP_SUPPORT_EXPECTED_ASSETS_PATH = path.join(
  ROOT_DIR,
  'docs',
  'reports',
  'app-support-expected-assets.json',
);

const GENERATED_ROOTS = [
  CODEX_PLUGIN_ROOT_PATH,
  CLAUDE_DESKTOP_EXTENSION_ROOT_PATH,
];

export function buildAppSupportArtifacts() {
  const packageJson = readJson(path.join(ROOT_DIR, 'package.json'));
  const skills = codexSkills();
  const codexManifest = buildCodexManifest(packageJson);
  const rootCodexManifest = buildRootCodexManifest(packageJson);
  const codexMarketplace = buildCodexMarketplace();
  const claudeDesktopManifest = buildClaudeDesktopManifest(packageJson);
  const expectedAssets = buildExpectedAssets({
    packageJson,
    skills,
  });

  const artifacts = new Map([
    [ROOT_CODEX_PLUGIN_MANIFEST_PATH, stableJson(rootCodexManifest)],
    [CODEX_PLUGIN_MANIFEST_PATH, stableJson(codexManifest)],
    [CODEX_MARKETPLACE_PATH, stableJson(codexMarketplace)],
    [
      path.join(CODEX_PLUGIN_ROOT_PATH, '.mcp.json'),
      stableJson(buildCodexPluginMcpConfig()),
    ],
    [
      path.join(CODEX_PLUGIN_ROOT_PATH, 'mcp', 'goldband-mcp-wrapper.mjs'),
      buildMcpWrapper('Codex plugin'),
    ],
    [CLAUDE_DESKTOP_EXTENSION_MANIFEST_PATH, stableJson(claudeDesktopManifest)],
    [
      path.join(CLAUDE_DESKTOP_EXTENSION_ROOT_PATH, 'server', 'index.js'),
      buildMcpWrapper('Claude Desktop extension'),
    ],
    [
      path.join(CLAUDE_DESKTOP_EXTENSION_ROOT_PATH, 'README.md'),
      buildClaudeDesktopExtensionReadme(),
    ],
    [CLAUDE_REMOTE_CONNECTOR_TEMPLATE_PATH, stableJson(buildRemoteConnector())],
    [APP_SUPPORT_EXPECTED_ASSETS_PATH, stableJson(expectedAssets)],
  ]);

  for (const skill of skills) {
    addDirectoryArtifacts(
      artifacts,
      `skills/global/${skill}`,
      path.join(CODEX_PLUGIN_ROOT_PATH, 'skills', skill),
    );
  }
  for (const entry of fs.readdirSync(path.join(ROOT_DIR, 'skills/global'), {
    withFileTypes: true,
  })) {
    if (!entry.isFile()) continue;
    artifacts.set(
      path.join(CODEX_PLUGIN_ROOT_PATH, 'skills', entry.name),
      fs.readFileSync(path.join(ROOT_DIR, 'skills/global', entry.name), 'utf8'),
    );
  }
  return artifacts;
}

export function writeAppSupportArtifacts(
  artifacts = buildAppSupportArtifacts(),
) {
  for (const root of GENERATED_ROOTS) {
    fs.rmSync(root, { force: true, recursive: true });
  }
  for (const [filePath, content] of artifacts) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
  }
}

export function diffAppSupportArtifacts(
  artifacts = buildAppSupportArtifacts(),
) {
  const diffs = [];
  for (const [filePath, expected] of artifacts) {
    const actual = fs.existsSync(filePath)
      ? fs.readFileSync(filePath, 'utf8')
      : null;
    if (actual !== expected) {
      diffs.push(relativePath(filePath));
    }
  }
  for (const extraFile of generatedExtras(artifacts)) {
    diffs.push(extraFile);
  }
  return diffs;
}

export function readAppSupportExpectedAssets() {
  return JSON.parse(fs.readFileSync(APP_SUPPORT_EXPECTED_ASSETS_PATH, 'utf8'));
}

export function listCodexPluginFiles() {
  return listFiles(CODEX_PLUGIN_ROOT_PATH).map(relativePath);
}

function buildCodexManifest(packageJson) {
  return {
    name: 'goldband',
    version: packageJson.version,
    description:
      'Goldband portable Codex plugin with shared engineering skills and opt-in MCP configuration. Full Codex setup remains install.sh codex-full.',
    author: {
      name: 'Leo',
      url: 'https://github.com/leo110047',
    },
    homepage: 'https://github.com/leo110047/goldband',
    repository: 'https://github.com/leo110047/goldband',
    license: 'MIT',
    keywords: ['codex', 'skills', 'mcp', 'guardrails', 'review', 'workflow'],
    skills: './skills/',
    mcpServers: './.mcp.json',
    interface: {
      displayName: 'Goldband',
      shortDescription:
        'Portable engineering skills and optional Goldband MCP readbacks for Codex.',
      longDescription:
        'Installs the portable Goldband skills for Codex app, CLI, and IDE extension. The plugin includes an opt-in MCP wrapper for a local goldband checkout, but does not replace install.sh codex-full or package Goldband Loop.',
      developerName: 'Leo',
      category: 'Productivity',
      capabilities: ['Skills', 'MCP'],
      websiteURL: 'https://github.com/leo110047/goldband',
      defaultPrompt: [
        'Use Goldband skills to review this change.',
        'Check this repo with evidence-based coding.',
        'Plan a safe implementation with Goldband.',
      ],
      brandColor: '#1F8A70',
    },
  };
}

function buildRootCodexManifest(packageJson) {
  return {
    ...buildCodexManifest(packageJson),
    description:
      'Repo-root compatibility manifest for the Goldband portable Codex plugin package. Marketplace installs use plugin-assets/codex-plugin.',
    skills: './plugin-assets/codex-plugin/skills/',
    mcpServers: './plugin-assets/codex-plugin/.mcp.json',
    interface: {
      ...buildCodexManifest(packageJson).interface,
      longDescription:
        'Compatibility manifest at the repository root. It resolves to the generated portable Codex package under plugin-assets/codex-plugin and does not package Goldband Loop or replace install.sh codex-full.',
    },
  };
}

function buildCodexMarketplace() {
  return {
    name: 'goldband-local',
    interface: {
      displayName: 'Goldband Local',
    },
    plugins: [
      {
        name: 'goldband',
        source: {
          source: 'local',
          path: './plugin-assets/codex-plugin',
        },
        policy: {
          installation: 'AVAILABLE',
          authentication: 'ON_INSTALL',
        },
        category: 'Productivity',
      },
    ],
  };
}

function buildCodexPluginMcpConfig() {
  return {
    mcpServers: {
      goldband: {
        command: 'node',
        args: ['./mcp/goldband-mcp-wrapper.mjs'],
        cwd: '.',
        env: {
          GOLDBAND_REPO_DIR: '${GOLDBAND_REPO_DIR}',
        },
        enabled: false,
      },
    },
  };
}

function buildClaudeDesktopManifest(packageJson) {
  return {
    manifest_version: '0.3',
    name: 'goldband-local-extension',
    display_name: 'Goldband Local MCP',
    version: packageJson.version,
    description:
      'Claude Desktop extension for the local goldband first-party MCP server.',
    long_description:
      'Connects Claude Desktop to a local goldband checkout through the first-party read-only goldband MCP server. This is a Claude app adapter and does not install Claude Code hooks or settings.',
    author: {
      name: 'Leo',
      url: 'https://github.com/leo110047',
    },
    repository: {
      type: 'git',
      url: 'https://github.com/leo110047/goldband.git',
    },
    homepage: 'https://github.com/leo110047/goldband',
    documentation:
      'https://github.com/leo110047/goldband/blob/main/mcp/README.md',
    license: 'MIT',
    server: {
      type: 'node',
      entry_point: 'server/index.js',
      mcp_config: {
        command: 'node',
        args: ['${__dirname}/server/index.js'],
        env: {
          GOLDBAND_REPO_DIR: '${user_config.goldband_repo_dir}',
        },
      },
    },
    tools: buildGoldbandMcpToolMetadata(),
    keywords: ['goldband', 'mcp', 'claude-desktop', 'local'],
    compatibility: {
      platforms: ['darwin', 'win32', 'linux'],
      runtimes: {
        node: '>=18.0.0',
      },
    },
    user_config: buildClaudeDesktopUserConfig(),
  };
}

function buildGoldbandMcpToolMetadata() {
  return [
    {
      name: 'goldband_policy_check',
      description: 'Dry-run goldband policy checks without executing commands.',
    },
    {
      name: 'goldband_telemetry_query',
      description: 'Read local goldband telemetry summaries.',
    },
    {
      name: 'knowledge-query',
      description: 'Query the local goldband knowledge index.',
    },
    {
      name: 'goldband_health_check',
      description: 'Run fixed read-only goldband health checks.',
    },
  ];
}

function buildClaudeDesktopUserConfig() {
  return {
    goldband_repo_dir: {
      type: 'directory',
      title: 'Goldband checkout',
      description:
        'Select the local goldband repository that contains mcp/server/dist/index.js.',
      required: true,
      default: '${HOME}/goldband',
    },
  };
}

function buildRemoteConnector() {
  return {
    name: 'goldband-remote-connector',
    displayName: 'Goldband Remote MCP',
    type: 'remote-mcp-registration-template',
    transport: 'streamable-http',
    remoteMcpUrl: 'https://YOUR_GOLDBAND_MCP_HOST.example.com/mcp',
    oauth: {
      clientId: 'YOUR_OAUTH_CLIENT_ID',
      clientSecret: 'YOUR_OAUTH_CLIENT_SECRET',
      scopes: ['goldband.read'],
    },
    claudeSetup: {
      teamEnterpriseOwner:
        'Organization settings > Connectors > Add > Custom > Web',
      proMaxUser: 'Customize > Connectors > + > Add custom connector',
      conversationEnablement:
        'Use the + button in the chat composer, choose Connectors, and enable Goldband Remote MCP for that conversation.',
    },
    security: {
      exposeOnlyPortableSubset: true,
      requireAuthentication: true,
      doNotExposeClaudeCodeHooks: true,
      doNotExposeGoldbandLoopRuntime: true,
    },
    expectedTools: [
      'goldband_policy_check',
      'goldband_telemetry_query',
      'knowledge-query',
      'goldband_health_check',
    ],
  };
}

function buildExpectedAssets({ packageJson, skills }) {
  return {
    schemaVersion: 1,
    generatedBy: 'scripts/sync-app-support-assets.mjs',
    codex: {
      pluginRoot: relativePath(CODEX_PLUGIN_ROOT_PATH),
      rootManifest: relativePath(ROOT_CODEX_PLUGIN_MANIFEST_PATH),
      manifest: relativePath(CODEX_PLUGIN_MANIFEST_PATH),
      marketplace: relativePath(CODEX_MARKETPLACE_PATH),
      skills,
      mcpConfig: 'plugin-assets/codex-plugin/.mcp.json',
      mcpWrapper: 'plugin-assets/codex-plugin/mcp/goldband-mcp-wrapper.mjs',
      fullSetupStillInstaller: true,
    },
    claudeApp: {
      desktopExtensionRoot: relativePath(CLAUDE_DESKTOP_EXTENSION_ROOT_PATH),
      desktopManifest: relativePath(CLAUDE_DESKTOP_EXTENSION_MANIFEST_PATH),
      desktopPackage: relativePath(CLAUDE_DESKTOP_EXTENSION_PACKAGE_PATH),
      remoteConnectorTemplate: relativePath(
        CLAUDE_REMOTE_CONNECTOR_TEMPLATE_PATH,
      ),
      packageVersion: packageJson.version,
    },
    outOfScope: [
      'Claude Code hooks/settings as Claude app support',
      'Goldband Loop full runtime inside app/plugin packages',
      'Codex plugin as a replacement for install.sh codex-full',
    ],
  };
}

function buildMcpWrapper(label) {
  return `#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const repoDir = process.env.GOLDBAND_REPO_DIR;
if (!repoDir) {
  console.error('${label}: GOLDBAND_REPO_DIR is required.');
  process.exit(1);
}

const serverPath = path.resolve(repoDir, 'mcp/server/dist/index.js');
if (!fs.existsSync(serverPath)) {
  const serverError = [
    '${label}: expected built goldband MCP server at ',
    serverPath,
  ].join('');
  console.error(serverError);
  console.error(
    'Run npm --prefix mcp/server run build in the goldband checkout.',
  );
  process.exit(1);
}

const child = spawn(process.execPath, [serverPath], {
  cwd: repoDir,
  env: process.env,
  stdio: ['inherit', 'inherit', 'inherit'],
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
`;
}

function buildClaudeDesktopExtensionReadme() {
  return `# Goldband Local MCP Claude Desktop Extension

This is the Claude Desktop app adapter for goldband's first-party MCP server.
It is not a Claude Code settings or hooks package.

Install the generated \`.mcpb\` file from Claude Desktop:

1. Open Settings > Extensions.
2. Open Advanced settings.
3. Choose Install Extension.
4. Select the generated \`goldband-local-extension.mcpb\`.
5. Set the Goldband checkout directory to the repo containing \`mcp/server/dist/index.js\`.

Build the MCP server before using the extension:

\`\`\`bash
npm --prefix mcp/server run build
\`\`\`
`;
}

function addDirectoryArtifacts(artifacts, sourceDir, destinationDir) {
  const sourceRoot = path.join(ROOT_DIR, sourceDir);
  for (const sourceFile of listFiles(sourceRoot)) {
    const relative = path.relative(sourceRoot, sourceFile);
    const destination = path.join(destinationDir, relative);
    artifacts.set(destination, fs.readFileSync(sourceFile, 'utf8'));
  }
}

function generatedExtras(artifacts) {
  const expected = new Set(
    [...artifacts.keys()]
      .filter((filePath) =>
        GENERATED_ROOTS.some((root) => filePath.startsWith(root)),
      )
      .map(relativePath),
  );
  const extras = [];
  for (const root of GENERATED_ROOTS) {
    if (!fs.existsSync(root)) {
      continue;
    }
    extras.push(
      ...listFiles(root)
        .map(relativePath)
        .filter((filePath) => !expected.has(filePath)),
    );
  }
  return extras;
}

function listFiles(rootDir) {
  const files = [];
  if (!fs.existsSync(rootDir)) {
    return files;
  }
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

function codexSkills() {
  return fs
    .readFileSync(
      path.join(ROOT_DIR, 'shell/install/skill-catalog.txt'),
      'utf8',
    )
    .trim()
    .split('\n')
    .map((line) => line.split('|'))
    .filter(([, , profile]) => profile)
    .map(([name]) => name)
    .sort();
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
