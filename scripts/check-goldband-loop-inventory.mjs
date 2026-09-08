#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertGbrainRetirement } from './lib/gbrain-retirement-check.mjs';
import { assertInstalledGbrainRetirement } from './lib/gbrain-retirement-install-check.mjs';
import {
  discoverLegacyEntrypoints,
  discoverRuntimeBinaries,
  GENERATED_RUNTIME_BINARY_SOURCES,
} from './lib/goldband-source-inventory.mjs';
import { assertInstalledTaskEmissionCliRuns } from './lib/goldband-task-emission-smoke.mjs';
import { assertInstalledManagedWorktreeSurface } from './lib/managed-worktree-install-check.mjs';
import * as installedContracts from './lib/workflow-contract-install-check.mjs';
import { assertInstalledWorkflowDistribution } from './lib/workflow-distribution-install-check.mjs';

const ROOT_DIR = fileURLToPath(new URL('../', import.meta.url));
const LOOP_DIR = path.join(ROOT_DIR, 'goldband-loop');
const INVENTORY_PATH = path.join(LOOP_DIR, 'inventory.json');
const CAPABILITY_CONTRACT_PATH = path.join(
  LOOP_DIR,
  'generated',
  'capability-actions.json',
);
const RETIRED_SHIP_ASSETS = [
  'ship',
  'review/ship-fix-first.md',
  'scripts/resolvers/preamble/generate-test-failure-triage.ts',
  'test/ship-version-sync.test.ts',
  'test/skill-e2e-ship-idempotency.test.ts',
  'test/skill-e2e-ship-triage.test.ts',
  'docs/designs/SLOP_SCAN_FOR_REVIEW_SHIP.md',
];
const RETIRED_SHIP_REFERENCE_PATTERNS = [
  /\bship\//,
  /(?:^|\s)\/ship\b/,
  /\bgoldband-ship\b/,
  /(?:\bctx\.skillName\s*={2,3}\s*['"]ship['"]|['"]ship['"]\s*={2,3}\s*ctx\.skillName\b)/,
  /\bship-(?:prosons|plan|coverage|triage|idempotency|local|base)-?/,
  /TEST_FAILURE_TRIAGE/,
];
const RETIRED_SHIP_REFERENCE_ALLOWLIST = [
  'goldband-loop/CHANGELOG.md',
  'goldband-loop/docs/designs/',
  'goldband-loop/docs/prompts/',
  'goldband-loop/test/uninstall.test.ts',
  'scripts/check-goldband-loop-inventory.mjs',
  'scripts/test-workflow-integration.sh',
  'scripts/test-workflow-integration-fixture.sh',
];
const RETIRED_LOOP_CI_ASSETS = [
  '.github/actionlint.yaml',
  '.github/docker/Dockerfile.ci',
  '.gitlab-ci.yml',
  'scripts/compare-pr-version.ts',
  'scripts/detect-bump.ts',
];
const REQUIRED_ROOT_CI_WORKFLOWS = [
  '.github/workflows/actionlint.yml',
  '.github/workflows/goldband-loop-windows.yml',
];
function main() {
  const inventory = readJson(INVENTORY_PATH);
  const capabilityContract = readJson(CAPABILITY_CONTRACT_PATH);
  assert.equal(inventory.schema, 2);
  assertGeneratedRuntimeDiscoveryDoesNotRequireBuildOutput();
  assertSourceSymlinksResolve(LOOP_DIR);
  assertLegacyConfigMigration();
  assertRetiredShipAssetsAbsent();
  assertRetiredShipReferencesAbsent();
  assertGbrainRetirement(ROOT_DIR);
  assertCiWorkflowOwnership();
  assertSourceInventory(inventory);
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'goldband-loop-home.'));
  try {
    runInstall(tmpHome, 'workflow');
    runInstall(tmpHome, 'workflow-codex');
    assertInstalledStandardInventory(tmpHome, inventory, capabilityContract);
    installedContracts.assertInstalledPythonContract(tmpHome);
    assertInstalledManagedWorktreeSurface(tmpHome);
    assertInstalledWorkflowDistribution(tmpHome, LOOP_DIR);
    assertInstalledGbrainRetirement({
      home: tmpHome,
      rootDir: ROOT_DIR,
      reinstall: (target) => runInstall(tmpHome, target),
    });
    console.log('[OK] Goldband Loop inventory matches clean install');
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }

  const copyHome = fs.mkdtempSync(
    path.join(os.tmpdir(), 'goldband-loop-copy-home.'),
  );
  try {
    runInstall(copyHome, 'workflow', { GOLDBAND_FORCE_COPY: '1' });
    runInstall(copyHome, 'workflow-codex', { GOLDBAND_FORCE_COPY: '1' });
    assertInstalledGbrainRetirement({
      home: copyHome,
      rootDir: ROOT_DIR,
      reinstall: (target) =>
        runInstall(copyHome, target, { GOLDBAND_FORCE_COPY: '1' }),
    });
    installedContracts.assertInstalledPythonContract(copyHome);
    assertInstalledKnowledgeCliRuns(copyHome);
    assertInstalledCrossReviewCliRuns(copyHome);
    assertInstalledTaskEmissionCliRuns(copyHome);
    console.log('[OK] Goldband Loop copy fallback runtime CLI works');
  } finally {
    fs.rmSync(copyHome, { recursive: true, force: true });
  }
}

function assertCiWorkflowOwnership() {
  assertRetiredLoopCiAbsent();
  assertRequiredRootCiWorkflows();
}

function assertRetiredLoopCiAbsent() {
  const retiredPresent = RETIRED_LOOP_CI_ASSETS.filter((relativePath) =>
    fs.existsSync(path.join(LOOP_DIR, relativePath)),
  );
  const nestedWorkflowDir = path.join(LOOP_DIR, '.github', 'workflows');
  if (fs.existsSync(nestedWorkflowDir)) {
    for (const entry of fs.readdirSync(nestedWorkflowDir, {
      withFileTypes: true,
    })) {
      if (entry.isFile() && /\.ya?ml$/i.test(entry.name)) {
        retiredPresent.push(`.github/workflows/${entry.name}`);
      }
    }
  }
  assert.deepEqual(
    retiredPresent,
    [],
    'Goldband Loop CI must be owned by repository-root workflows',
  );
}

function assertRequiredRootCiWorkflows() {
  const missingRootWorkflows = REQUIRED_ROOT_CI_WORKFLOWS.filter(
    (relativePath) => !fs.existsSync(path.join(ROOT_DIR, relativePath)),
  );
  assert.deepEqual(
    missingRootWorkflows,
    [],
    'required repository-root CI workflows are missing',
  );
  if (missingRootWorkflows.length > 0) return;
  assertActionlintWorkflowContract();
  assertWindowsWorkflowContract();
}

function assertActionlintWorkflowContract() {
  const actionlint = fs.readFileSync(
    path.join(ROOT_DIR, '.github', 'workflows', 'actionlint.yml'),
    'utf8',
  );
  assert.match(
    actionlint,
    /rhysd\/actionlint@v1\.7\.12/,
    'root workflow lint must use the validated actionlint release',
  );
  assert.doesNotMatch(
    actionlint,
    /^\s+paths:/m,
    'required workflow lint must emit a status on every dev commit',
  );
}

function assertWindowsWorkflowContract() {
  const windows = fs.readFileSync(
    path.join(ROOT_DIR, '.github', 'workflows', 'goldband-loop-windows.yml'),
    'utf8',
  );
  assert.equal(
    windows.match(/runs-on: windows-latest/g)?.length,
    2,
    'Windows CI must retain unit and setup E2E jobs',
  );
  assert.equal(
    windows.match(/working-directory: goldband-loop/g)?.length,
    2,
    'Windows jobs must execute from the monorepo Goldband Loop directory',
  );
  assert.doesNotMatch(
    windows,
    /^\s+paths:/m,
    'required Windows CI must emit statuses on every dev commit',
  );
}

function assertRetiredShipAssetsAbsent() {
  const present = RETIRED_SHIP_ASSETS.filter((relativePath) =>
    fs.existsSync(path.join(LOOP_DIR, relativePath)),
  );
  assert.deepEqual(
    present,
    [],
    'retired ship workflow assets must not be restored',
  );
}

function assertRetiredShipReferencesAbsent() {
  const violations = [];
  for (const scanRoot of [LOOP_DIR, path.join(ROOT_DIR, 'scripts')]) {
    walkSourceTree(scanRoot, (entryPath, entry) =>
      collectRetiredShipReferenceViolations(entryPath, entry, violations),
    );
  }
  assert.deepEqual(
    violations,
    [],
    'active source contains references to the retired ship workflow',
  );
}

function collectRetiredShipReferenceViolations(entryPath, entry, violations) {
  if (!entry.isFile()) {
    return;
  }
  const relativePath = path.relative(ROOT_DIR, entryPath);
  if (isRetiredShipReferenceAllowlisted(relativePath)) {
    return;
  }
  const content = fs.readFileSync(entryPath, 'utf8');
  for (const pattern of RETIRED_SHIP_REFERENCE_PATTERNS) {
    if (pattern.test(content)) {
      violations.push(`${relativePath}: ${pattern}`);
    }
  }
}

function isRetiredShipReferenceAllowlisted(relativePath) {
  return RETIRED_SHIP_REFERENCE_ALLOWLIST.some(
    (allowedPath) =>
      relativePath === allowedPath || relativePath.startsWith(allowedPath),
  );
}

function assertGeneratedRuntimeDiscoveryDoesNotRequireBuildOutput() {
  const sourceOnlyLoop = fs.mkdtempSync(
    path.join(os.tmpdir(), 'goldband-source-inventory.'),
  );
  try {
    fs.mkdirSync(path.join(sourceOnlyLoop, 'bin'));
    fs.writeFileSync(
      path.join(sourceOnlyLoop, 'bin', 'goldband-global-discover.ts'),
      'export {};\n',
    );
    assert.ok(
      discoverRuntimeBinaries(sourceOnlyLoop).includes(
        'goldband-global-discover',
      ),
      'generated runtime binary discovery must be reproducible from tracked source',
    );
  } finally {
    fs.rmSync(sourceOnlyLoop, { recursive: true, force: true });
  }
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function runInstall(home, target, extraEnv = {}) {
  const result = spawnSync(
    'bash',
    [path.join(ROOT_DIR, 'install.sh'), target],
    {
      cwd: ROOT_DIR,
      env: {
        ...process.env,
        HOME: home,
        GOLDBAND_LOOP_DIR: LOOP_DIR,
        GOLDBAND_SKIP_GENERATE: '1',
        GOLDBAND_SKIP_PLAYWRIGHT: '1',
        GOLDBAND_SKIP_COREUTILS: '1',
        ...extraEnv,
      },
      encoding: 'utf8',
    },
  );
  if (result.status !== 0) {
    throw new Error(
      [`install failed: ${target}`, result.stdout.trim(), result.stderr.trim()]
        .filter(Boolean)
        .join('\n'),
    );
  }
}

function assertSourceInventory(inventory) {
  assertDeepSetEqual(
    'legacy source contracts tracked for cleanup',
    discoverLegacyEntrypoints(LOOP_DIR),
    inventory.forbiddenLegacyEntrypoints,
  );

  assertGeneratedRuntimeSources(inventory);
  assertDeepSetEqual(
    'source runtime binaries',
    discoverRuntimeBinaries(LOOP_DIR),
    inventory.binaries,
  );
}

function assertGeneratedRuntimeSources(inventory) {
  for (const [binary, sourcePath] of GENERATED_RUNTIME_BINARY_SOURCES) {
    assert.ok(
      inventory.binaries.includes(binary),
      `generated runtime binary missing from inventory: ${binary}`,
    );
    assert.ok(
      fs.existsSync(path.join(LOOP_DIR, sourcePath)),
      `generated runtime binary source missing: ${sourcePath}`,
    );
  }
}

function assertSourceSymlinksResolve(rootDir) {
  const broken = [];
  walkSourceTree(rootDir, (entryPath, entry) => {
    if (!entry.isSymbolicLink()) {
      return;
    }
    if (!fs.existsSync(entryPath)) {
      broken.push(
        `${path.relative(ROOT_DIR, entryPath)} -> ${fs.readlinkSync(entryPath)}`,
      );
    }
  });
  assert.deepEqual(broken, [], 'source tree contains broken symlinks');
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
    if (ignoredDirs.has(entry.name)) {
      continue;
    }
    const entryPath = path.join(rootDir, entry.name);
    visit(entryPath, entry);
    if (entry.isDirectory()) {
      walkSourceTree(entryPath, visit);
    }
  }
}

function runGoldbandConfigInHome(tmpHome, args) {
  return spawnSync(path.join(LOOP_DIR, 'bin', 'goldband-config'), args, {
    env: { ...process.env, HOME: tmpHome },
    encoding: 'utf8',
  });
}

function writeLegacyMigrationFixture(tmpHome) {
  const legacyDir = path.join(tmpHome, '.workflow');
  fs.mkdirSync(legacyDir, { recursive: true });
  fs.writeFileSync(
    path.join(legacyDir, 'config.yaml'),
    'skill_prefix: true\ntelemetry: anonymous\n',
  );
  fs.mkdirSync(path.join(legacyDir, 'projects', 'demo'), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(legacyDir, 'projects', 'demo', 'learnings.jsonl'),
    '{"key":"old"}\n',
  );
  fs.mkdirSync(path.join(legacyDir, 'analytics'), { recursive: true });
  fs.writeFileSync(
    path.join(legacyDir, 'analytics', 'skill-usage.jsonl'),
    '{"skill":"old"}\n',
  );
  return legacyDir;
}

function assertLegacyMigrationResult(tmpHome, result) {
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'anonymous');
  assert.equal(
    fs.readFileSync(path.join(tmpHome, '.goldband', 'config.yaml'), 'utf8'),
    'skill_prefix: true\ntelemetry: anonymous\n',
  );
  assert.equal(
    fs.readFileSync(
      path.join(tmpHome, '.goldband', 'projects', 'demo', 'learnings.jsonl'),
      'utf8',
    ),
    '{"key":"old"}\n',
  );
  assert.equal(
    fs.readFileSync(
      path.join(tmpHome, '.goldband', 'analytics', 'skill-usage.jsonl'),
      'utf8',
    ),
    '{"skill":"old"}\n',
  );
}

function assertLegacyMigrationSentinel(tmpHome, legacyDir) {
  assert.equal(
    fs.existsSync(path.join(tmpHome, '.goldband', '.legacy-migrated')),
    true,
    'legacy migration should write a sentinel',
  );
  fs.writeFileSync(
    path.join(legacyDir, 'projects', 'demo', 'late.jsonl'),
    '{"key":"late"}\n',
  );
  const second = runGoldbandConfigInHome(tmpHome, ['get', 'telemetry']);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(second.stdout, 'anonymous');
  assert.equal(
    fs.existsSync(
      path.join(tmpHome, '.goldband', 'projects', 'demo', 'late.jsonl'),
    ),
    false,
    'legacy migration should not rescan after sentinel exists',
  );
}

function assertLegacyConfigMigration() {
  const tmpHome = fs.mkdtempSync(
    path.join(os.tmpdir(), 'goldband-config-home.'),
  );
  try {
    const legacyDir = writeLegacyMigrationFixture(tmpHome);
    const result = runGoldbandConfigInHome(tmpHome, ['get', 'telemetry']);
    assertLegacyMigrationResult(tmpHome, result);
    assertLegacyMigrationSentinel(tmpHome, legacyDir);
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
}

function assertInstalledStandardInventory(home, inventory, capabilityContract) {
  const claudeSkillsDir = path.join(home, '.claude', 'skills');
  const codexSkillsDir = path.join(home, '.codex', 'skills');
  const claudeRuntime = path.join(claudeSkillsDir, 'goldband');
  const codexRuntime = path.join(codexSkillsDir, 'goldband');

  assertDeepSetEqual(
    'Claude standard visible skills',
    skillDirectories(claudeSkillsDir),
    ['goldband'],
  );
  assertDeepSetEqual(
    'Codex standard visible skills',
    skillDirectories(codexSkillsDir),
    ['goldband'],
  );
  installedContracts.assertInstalledWorkflowDocuments(
    'Claude',
    claudeRuntime,
    capabilityContract,
    LOOP_DIR,
  );
  installedContracts.assertInstalledWorkflowDocuments(
    'Codex',
    codexRuntime,
    capabilityContract,
    LOOP_DIR,
  );
  assert.equal(
    fs
      .readFileSync(
        path.join(home, '.goldband', 'state', 'workflow-profile-claude'),
        'utf8',
      )
      .trim(),
    'standard',
  );
  assert.equal(
    fs
      .readFileSync(
        path.join(home, '.goldband', 'state', 'workflow-profile-codex'),
        'utf8',
      )
      .trim(),
    'standard',
  );
  assertInstalledRuntimeSupportFiles(claudeRuntime, codexRuntime);
  assertNoLegacyCommands(home, inventory);
}

function assertInstalledRuntimeSupportFiles(...runtimeRoots) {
  const requiredFiles = [
    path.join('lib', 'knowledge.ts'),
    path.join('review', 'shared-rubric.md'),
    path.join('review', 'findings-schema.md'),
    path.join('review', 'checklist.md'),
    path.join('review', 'greptile-triage.md'),
    path.join('review', 'review-evidence-manifest.md'),
    path.join('review', 'examples', 'minimal-local-gate.json'),
    path.join('review', 'schemas', 'review-evidence-manifest.schema.json'),
    path.join('review', 'schemas', 'review-behavior-matrix.schema.json'),
    path.join('cross-review', 'core.cjs'),
    path.join('cross-review', 'cli.cjs'),
  ];
  for (const runtimeRoot of runtimeRoots) {
    for (const relPath of requiredFiles) {
      assert.ok(
        fs.existsSync(path.join(runtimeRoot, relPath)),
        `installed runtime support file missing: ${path.join(runtimeRoot, relPath)}`,
      );
    }
  }
}

function assertInstalledCrossReviewCliRuns(home) {
  const result = spawnSync(
    path.join(
      home,
      '.claude',
      'skills',
      'goldband',
      'bin',
      'goldband-cross-review',
    ),
    ['help'],
    { encoding: 'utf8', env: { ...process.env, HOME: home } },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /goldband-cross-review start --plan/);
}

function assertInstalledKnowledgeCliRuns(home) {
  const result = spawnSync(
    path.join(
      home,
      '.claude',
      'skills',
      'goldband',
      'bin',
      'goldband-knowledge',
    ),
    ['search', '--domain', 'qa', '--query', 'fixture'],
    {
      cwd: home,
      env: {
        ...process.env,
        HOME: home,
        GOLDBAND_HOME: path.join(home, '.goldband'),
      },
      encoding: 'utf8',
    },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /KNOWLEDGE:/);
}

function skillDirectories(parent) {
  if (!fs.existsSync(parent)) {
    return [];
  }
  return fs
    .readdirSync(parent, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
    .filter((entry) => fs.existsSync(path.join(parent, entry.name, 'SKILL.md')))
    .map((entry) => entry.name)
    .sort();
}

function assertNoLegacyCommands(home, inventory) {
  const commandDir = path.join(home, '.claude', 'commands');
  if (!fs.existsSync(commandDir)) {
    return;
  }
  const installed = fs
    .readdirSync(commandDir)
    .filter((entry) => entry.endsWith('.md'))
    .map((entry) => entry.replace(/\.md$/, ''));
  const legacy = installed.filter((entry) =>
    inventory.forbiddenCommands.includes(entry),
  );
  assert.deepEqual(legacy, [], 'legacy commands should not be installed');
}

function assertDeepSetEqual(label, actual, expected) {
  assert.deepEqual(
    [...actual].sort(),
    [...expected].sort(),
    `${label} mismatch`,
  );
}

main();
