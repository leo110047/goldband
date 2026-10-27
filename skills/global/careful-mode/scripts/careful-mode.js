#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Plugin and copied installs place skills/<name>/ beside hooks/; the repo
// nests skills under skills/global/.
const HOOK_ROUTER_DIRS = [
  '../../../hooks/scripts/lib/hook-router',
  '../../../../hooks/scripts/lib/hook-router',
];

function resolveHookModule(relativePath) {
  for (const hookRouterDir of HOOK_ROUTER_DIRS) {
    const candidate = path.resolve(__dirname, hookRouterDir, relativePath);
    if (fs.existsSync(candidate)) {
      return require(candidate);
    }
  }

  throw new Error(
    `Unable to locate ${relativePath}. Install goldband hooks or run from the repo root.`,
  );
}

const { runModeCli } = resolveHookModule('mode-cli.js');
const { CAREFUL_MODE_GUARDS } = resolveHookModule('careful-mode-rules.js');

try {
  runModeCli({
    argv: process.argv,
    modeName: 'careful-mode',
    displayName: 'Careful Mode',
    protections: CAREFUL_MODE_GUARDS,
    source: 'skills/global/careful-mode/scripts/careful-mode.js',
  });
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[careful-mode] ${message}`);
  process.exit(1);
}
