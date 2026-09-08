import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  assertPromptSurfaceBudget,
  PROMPT_SURFACE_BUDGETS,
} from './prompt-surface-budget.mjs';
import {
  validateSharedPromptContent,
  validateWorkflowContractContent,
} from './workflow-contracts.mjs';

export function assertInstalledWorkflowDocuments(
  label,
  runtimeRoot,
  capabilityContract,
  loopDir,
) {
  assertInstalledRootSkill(label, runtimeRoot);
  const expected = capabilityContract.actions.map(({ capability, action }) =>
    path.join(capability, `${action}.workflow.md`),
  );
  const workflowRoot = path.join(runtimeRoot, 'workflows');
  assert.deepEqual(
    workflowDocuments(workflowRoot),
    expected.sort(),
    `${label} standard workflow documents mismatch`,
  );
  for (const relativePath of expected) {
    assertInstalledWorkflowDocument({
      label,
      workflowRoot,
      relativePath,
      capabilityContract,
      loopDir,
    });
  }
  assertInstalledManuals(label, runtimeRoot, capabilityContract, loopDir);
}

function assertInstalledWorkflowDocument({
  label,
  workflowRoot,
  relativePath,
  capabilityContract,
  loopDir,
}) {
  const installedPath = path.join(workflowRoot, relativePath);
  assert.ok(
    fs.existsSync(installedPath),
    `${label} standard workflow document is broken: ${relativePath}`,
  );
  const [capability, filename] = relativePath.split(path.sep);
  const action = filename.replace(/\.workflow\.md$/, '');
  const record = capabilityContract.actions.find(
    (entry) => entry.capability === capability && entry.action === action,
  );
  assert.ok(record, `${label} workflow record missing: ${relativePath}`);
  const sourcePath = path.join(loopDir, record.contractPath);
  const installedContent = fs.readFileSync(installedPath, 'utf8');
  assert.equal(
    installedContent,
    fs.readFileSync(sourcePath, 'utf8'),
    `${label} workflow content differs from thin contract: ${relativePath}`,
  );
  validateWorkflowContractContent(
    installedContent,
    capabilityContract.promptArchitecture,
    { relativePath: `${label}:${relativePath}` },
  );
  assertPromptSurfaceBudget(
    `${label} workflow ${relativePath}`,
    installedContent,
    PROMPT_SURFACE_BUDGETS.workflowContractBytes,
  );
}

function assertInstalledRootSkill(label, runtimeRoot) {
  const rootSkillPath = path.join(runtimeRoot, 'SKILL.md');
  assert.ok(fs.existsSync(rootSkillPath), `${label} root SKILL.md missing`);
  assertPromptSurfaceBudget(
    `${label} root SKILL.md`,
    fs.readFileSync(rootSkillPath, 'utf8'),
    PROMPT_SURFACE_BUDGETS.rootRouterSkillBytes,
  );
}

function assertInstalledManuals(
  label,
  runtimeRoot,
  capabilityContract,
  loopDir,
) {
  for (const manual of capabilityContract.manuals) {
    const installedPath = path.join(runtimeRoot, 'manuals', `${manual.id}.md`);
    const sourcePath = path.join(loopDir, manual.source);
    assert.ok(
      fs.existsSync(installedPath),
      `${label} manual missing: ${manual.id}`,
    );
    const content = fs.readFileSync(installedPath, 'utf8');
    assert.equal(content, fs.readFileSync(sourcePath, 'utf8'));
    validateSharedPromptContent(
      content,
      capabilityContract.promptArchitecture,
      { relativePath: `${label}:manuals/${manual.id}.md` },
    );
    assertPromptSurfaceBudget(
      `${label} manual ${manual.id}`,
      content,
      PROMPT_SURFACE_BUDGETS.manualBytes,
    );
  }
}

function workflowDocuments(root, current = root) {
  if (!fs.existsSync(current)) return [];
  const documents = [];
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    const entryPath = path.join(current, entry.name);
    if (entry.isDirectory()) {
      documents.push(...workflowDocuments(root, entryPath));
    } else if (entry.name.endsWith('.workflow.md')) {
      documents.push(path.relative(root, entryPath));
    }
  }
  return documents.sort();
}

export function assertInstalledPythonContract(home) {
  const repo = path.join(home, 'python-contract-consumer');
  fs.mkdirSync(repo);
  assert.equal(spawnSync('git', ['init', '-q', repo]).status, 0);
  const marker = JSON.parse(
    fs.readFileSync(
      path.join(home, '.codex/skills/goldband/.workflow-launcher.json'),
      'utf8',
    ),
  );
  const launchers = [
    [path.join(home, '.claude/skills/goldband/bin/goldband')],
    marker.argvPrefix,
  ];
  for (const launcher of launchers)
    assertPythonContractLauncher(launcher, home, repo);
}

function assertPythonContractLauncher(launcher, home, repo) {
  const run = (args) =>
    spawnSync(
      launcher[0],
      [...launcher.slice(1), 'review', 'contract', ...args],
      {
        cwd: repo,
        env: { ...process.env, HOME: home },
        encoding: 'utf8',
        timeout: 30_000,
      },
    );
  const help = run(['help']);
  assert.equal(help.status, 0, help.stderr);
  const info = JSON.parse(help.stdout);
  assert.match(info.pythonRuntime, /complete offline dependencies/);
  assert.match(fs.readFileSync(info.assets.guide, 'utf8'), /Python gate 必填/);
  const manifest = JSON.parse(fs.readFileSync(info.assets.example, 'utf8'));
  const file = path.join(repo, 'python.json');
  manifest.providers[0].operations[0].argv = [
    'python3',
    '-I',
    '-S',
    '-c',
    "print('GOLDBAND_PYTHON_STARTED')",
  ];
  fs.writeFileSync(file, JSON.stringify(manifest));
  const rejected = run(['validate', '--manifest', file]);
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /pythonRuntime/);
  assert.match(rejected.stderr, /uv.lock/);
  manifest.providers[0].operations[0].argv[0] = 'python3.14';
  manifest.providers[0].operations[0].pythonRuntime = {
    interpreter: 'python3.14',
    resolver: 'uv',
    projectFile: 'pyproject.toml',
    lockFile: 'uv.lock',
  };
  fs.writeFileSync(file, JSON.stringify(manifest));
  const accepted = run(['validate', '--manifest', file]);
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.equal(JSON.parse(accepted.stdout).completionAuthorized, false);
}
