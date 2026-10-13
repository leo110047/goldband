import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const RETIRED_ASSETS = [
  'goldband-loop/USING_GBRAIN_WITH_GOLDBAND.md',
  'goldband-loop/setup-gbrain',
  'goldband-loop/docs/gbrain-sync.md',
  'goldband-loop/docs/gbrain-sync-errors.md',
  'goldband-loop/docs/designs/SYNC_GBRAIN_BATCH_INGEST.md',
  'goldband-loop/generated/host-skills/gbrain.SKILL.md',
  'goldband-loop/hosts/gbrain.ts',
  'goldband-loop/lib/gbrain-exec.ts',
  'goldband-loop/lib/gbrain-local-status.ts',
  'goldband-loop/lib/gbrain-sources.ts',
  'goldband-loop/lib/goldband-memory-helpers.ts',
  'goldband-loop/bin/goldband-memory-ingest.ts',
  'goldband-loop/bin/goldband-brain-context-load.ts',
  'goldband-loop/bin/goldband-brain-consumer',
  'goldband-loop/bin/goldband-brain-reader',
];
const RETIRED_ASSET_PREFIXES = ['goldband-loop/bin/goldband-gbrain-'];
const RETIRED_REFERENCE_PATTERNS = [
  /\bgbrain\b/i,
  /gbrain[_-]/i,
  /\b(?:setup|sync)-gbrain\b/i,
  /\bgoldband-(?:memory-ingest|brain-context-load|brain-consumer|brain-reader)\b/i,
];
const REFERENCE_ALLOWLIST = [
  'docs/DECISIONS.md',
  'goldband-loop/lib/retired-workflow-entry-names.txt',
  'goldband-loop/test/migrations-v1.27.0.0.test.ts',
  'scripts/check-goldband-loop-inventory.mjs',
  'scripts/lib/gbrain-retirement-check.mjs',
];
const ALLOWED_REFERENCE_TOKENS = new Map([
  [
    'goldband-loop/goldband-upgrade/migrations/v1.27.0.0.sh',
    ['gbrain_sync_mode', 'gbrain_sync_mode_prompted'],
  ],
]);
const SCAN_ROOTS = [
  'goldband.manifest.json',
  'README.md',
  'README.en.md',
  'ARCHITECTURE.md',
  'docs',
  'install.sh',
  'shell/install',
  'codex',
  'plugin-assets',
  'scripts/generate-goldband-surfaces.mjs',
  'goldband-loop/README.md',
  'goldband-loop/TODOS.md',
  'goldband-loop/setup',
  'goldband-loop/bin',
  'goldband-loop/lib',
  'goldband-loop/hosts',
  'goldband-loop/workflows',
  'goldband-loop/generated',
  'goldband-loop/goldband-upgrade/migrations',
  'goldband-loop/docs',
  'goldband-loop/test',
];

export function assertGbrainRetirement(rootDir) {
  assertRetiredAssetsAbsent(rootDir);
  assertRetiredReferencesAbsent(rootDir);
  assertGateRejectsFixture();
}

function assertRetiredAssetsAbsent(rootDir) {
  const present = RETIRED_ASSETS.filter((relativePath) =>
    fs.existsSync(path.join(rootDir, relativePath)),
  );
  for (const prefix of RETIRED_ASSET_PREFIXES) {
    const parent = path.dirname(path.join(rootDir, prefix));
    const basenamePrefix = path.basename(prefix);
    if (!fs.existsSync(parent)) continue;
    for (const entry of fs.readdirSync(parent)) {
      if (entry.startsWith(basenamePrefix)) {
        present.push(path.relative(rootDir, path.join(parent, entry)));
      }
    }
  }
  assert.deepEqual(
    [...new Set(present)].sort(),
    [],
    'retired GBrain assets must not be restored',
  );
}

function assertRetiredReferencesAbsent(rootDir) {
  const violations = [];
  for (const relativeRoot of SCAN_ROOTS) {
    const scanRoot = path.join(rootDir, relativeRoot);
    if (!fs.existsSync(scanRoot)) continue;
    const entry = fs.lstatSync(scanRoot);
    if (entry.isDirectory()) {
      walkSourceTree(scanRoot, (entryPath, childEntry) =>
        collectReferenceViolations(rootDir, entryPath, childEntry, violations),
      );
    } else {
      collectReferenceViolations(rootDir, scanRoot, entry, violations);
    }
  }
  assert.deepEqual(
    violations,
    [],
    'active source contains references to the retired GBrain integration',
  );
}

function collectReferenceViolations(rootDir, entryPath, entry, violations) {
  if (!entry.isFile() && !entry.isSymbolicLink()) return;
  const relativePath = path.relative(rootDir, entryPath);
  if (isAllowlisted(relativePath)) return;
  let content;
  try {
    content = fs.readFileSync(entryPath, 'utf8');
  } catch {
    return;
  }
  for (const token of ALLOWED_REFERENCE_TOKENS.get(relativePath) ?? []) {
    content = content.replaceAll(token, 'retired_artifacts_sync_key');
  }
  for (const pattern of RETIRED_REFERENCE_PATTERNS) {
    if (pattern.test(content)) violations.push(`${relativePath}: ${pattern}`);
  }
}

function isAllowlisted(relativePath) {
  return REFERENCE_ALLOWLIST.some(
    (allowedPath) =>
      relativePath === allowedPath || relativePath.startsWith(allowedPath),
  );
}

function assertGateRejectsFixture() {
  const fixtures = [
    [
      'install.sh',
      'case "$host" in gbrain) install_gbrain ;; esac\n',
      'root installer route',
    ],
    [
      'goldband.manifest.json',
      '{"action":"knowledge/setup","trigger":"setup-gbrain"}\n',
      'workflow action and trigger',
    ],
    [
      path.join('shell', 'install', 'workflow.sh'),
      'claude mcp add gbrain --transport http\n',
      'MCP registration route',
    ],
    [
      path.join('docs', 'knowledge-system.md'),
      'Supported provider: GBrain\n',
      'active documentation reference',
    ],
  ];
  for (const [relativePath, content, label] of fixtures) {
    const fixture = fs.mkdtempSync(
      path.join(os.tmpdir(), 'goldband-retired-gbrain-gate.'),
    );
    try {
      const fixtureFile = path.join(fixture, relativePath);
      fs.mkdirSync(path.dirname(fixtureFile), { recursive: true });
      fs.writeFileSync(fixtureFile, content);
      assert.throws(
        () => assertRetiredReferencesAbsent(fixture),
        /active source contains references to the retired GBrain integration/,
        `retirement gate must reject a controlled ${label} fixture`,
      );
    } finally {
      fs.rmSync(fixture, { recursive: true, force: true });
    }
  }
}

function walkSourceTree(rootDir, visit) {
  const ignoredDirs = new Set([
    '.agents',
    '.claude',
    '.factory',
    '.git',
    '.opencode',
    'node_modules',
  ]);
  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    if (ignoredDirs.has(entry.name)) continue;
    const entryPath = path.join(rootDir, entry.name);
    visit(entryPath, entry);
    if (entry.isDirectory()) walkSourceTree(entryPath, visit);
  }
}
