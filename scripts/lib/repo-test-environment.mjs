import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const LEGACY_HOST_SKILL_ROOTS = [
  'goldband-loop/.agents/skills',
  'goldband-loop/.factory/skills',
  'goldband-loop/.opencode/skills',
];

const RETIRED_WORKFLOW_ENTRY_INVENTORY =
  'goldband-loop/lib/retired-workflow-entry-names.txt';

const DEPENDENCY_MARKERS = [
  {
    code: 'root-dependencies-missing',
    relativePath: 'node_modules/.bin/biome',
    message: 'root Node dependencies are missing',
  },
  {
    code: 'mcp-dependencies-missing',
    relativePath: 'mcp/server/node_modules/.bin/tsc',
    message: 'MCP server dependencies are missing',
  },
  {
    code: 'goldband-loop-dependencies-missing',
    relativePath: 'goldband-loop/node_modules/.bin/tsc',
    message: 'Goldband Loop dependencies are missing',
  },
];

function parseNumericVersion(value) {
  const match = String(value)
    .trim()
    .match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return match.slice(1).map(Number);
}

export function versionAtLeast(current, minimum) {
  const currentParts = parseNumericVersion(current);
  const minimumParts = parseNumericVersion(minimum);
  if (!currentParts || !minimumParts) return false;
  for (let index = 0; index < minimumParts.length; index += 1) {
    if (currentParts[index] > minimumParts[index]) return true;
    if (currentParts[index] < minimumParts[index]) return false;
  }
  return true;
}

export function minimumBunVersion(root) {
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(root, 'goldband-loop', 'package.json'), 'utf8'),
  );
  const match = String(packageJson.engines?.bun ?? '').match(
    /^>=(\d+\.\d+\.\d+)$/,
  );
  if (!match) {
    throw new Error(
      'goldband-loop/package.json engines.bun must be an exact >=x.y.z contract',
    );
  }
  return match[1];
}

export function listLegacyHostSkillArtifacts(root) {
  const artifacts = [];
  const retiredBasenames = retiredHostSkillBasenames(root);
  for (const relativeRoot of LEGACY_HOST_SKILL_ROOTS) {
    const skillsRoot = path.join(root, relativeRoot);
    if (!fs.existsSync(skillsRoot)) continue;
    for (const entry of fs.readdirSync(skillsRoot, { withFileTypes: true })) {
      if (isRetiredManagedHostSkill(skillsRoot, entry, retiredBasenames)) {
        artifacts.push(path.posix.join(relativeRoot, entry.name));
      }
    }
  }
  return artifacts.sort();
}

function retiredHostSkillBasenames(root) {
  const inventoryPath = path.join(root, RETIRED_WORKFLOW_ENTRY_INVENTORY);
  const names = parseRetiredWorkflowEntryInventory(
    fs.readFileSync(inventoryPath, 'utf8'),
  );
  const basenames = new Set();
  for (const name of names) {
    basenames.add(name);
    basenames.add(`goldband-${name}`);
  }
  return basenames;
}

export function parseRetiredWorkflowEntryInventory(contents) {
  const names = String(contents)
    .split(/\r?\n/)
    .map((name) => name.trim())
    .filter(Boolean);
  const seen = new Set();
  for (const name of names) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
      throw new Error(`invalid retired workflow entry name: ${name}`);
    }
    if (seen.has(name)) {
      throw new Error(`duplicate retired workflow entry name: ${name}`);
    }
    seen.add(name);
  }
  return names;
}

function isRetiredManagedHostSkill(skillsRoot, entry, retiredBasenames) {
  if (!entry.name.startsWith('goldband-')) return false;
  if (!(entry.isDirectory() || entry.isSymbolicLink())) return false;
  if (retiredBasenames.has(entry.name)) return true;
  if (entry.isSymbolicLink()) return false;
  return fs.existsSync(
    path.join(skillsRoot, entry.name, '.goldband-managed-skill'),
  );
}

export function removeLegacyHostSkillArtifacts(root) {
  const artifacts = listLegacyHostSkillArtifacts(root);
  for (const relativePath of artifacts) {
    fs.rmSync(path.join(root, relativePath), { recursive: true, force: true });
  }
  return artifacts;
}

export function inspectRepoTestEnvironment(root, { bunVersion } = {}) {
  const problems = [];
  const executableSuffix = process.platform === 'win32' ? '.cmd' : '';
  for (const marker of DEPENDENCY_MARKERS) {
    const markerPath = `${marker.relativePath}${executableSuffix}`;
    if (!fs.existsSync(path.join(root, markerPath))) {
      problems.push({ code: marker.code, message: marker.message });
    }
  }

  const minimum = minimumBunVersion(root);
  const detected = bunVersion ?? detectBunVersion();
  if (!detected) {
    problems.push({
      code: 'bun-missing',
      message: `Bun >=${minimum} is required`,
    });
  } else if (!versionAtLeast(detected, minimum)) {
    problems.push({
      code: 'bun-too-old',
      message: `Bun >=${minimum} is required; found ${detected}`,
    });
  }

  const legacyArtifacts = listLegacyHostSkillArtifacts(root);
  if (legacyArtifacts.length > 0) {
    problems.push({
      code: 'legacy-host-artifacts',
      message: `retired generated host skills remain: ${legacyArtifacts.join(', ')}`,
    });
  }
  return problems;
}

export function formatRepoTestPreflightFailure(problems) {
  return [
    '[test:repo] repository test environment is not ready:',
    ...problems.map((problem) => `  - ${problem.message}`),
    '',
    'Run: npm run bootstrap:test',
    'This installs declared test dependencies and removes only host skills proven managed by the retired inventory or marker.',
  ].join('\n');
}

function detectBunVersion() {
  const result = spawnSync(
    process.platform === 'win32' ? 'bun.exe' : 'bun',
    ['--version'],
    {
      encoding: 'utf8',
    },
  );
  if (result.status !== 0) return null;
  return result.stdout.trim();
}
