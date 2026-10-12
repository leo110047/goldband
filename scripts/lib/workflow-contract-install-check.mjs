import assert from 'node:assert/strict';
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
