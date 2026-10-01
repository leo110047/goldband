#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  collectSafetyGates,
  validateSafetyGates,
} from './lib/capability-safety-gates.mjs';
import {
  assertPromptSurfaceBudget,
  assertPromptSurfaceTotal,
  PROMPT_SURFACE_BUDGETS,
} from './lib/prompt-surface-budget.mjs';
import { listLegacyHostSkillArtifacts } from './lib/repo-test-environment.mjs';
import {
  buildWorkflowContracts,
  validatePromptArchitecture,
  validateSharedPromptContent,
  validateWorkflowContractContent,
} from './lib/workflow-contracts.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(
  fs.readFileSync(path.join(root, 'goldband.manifest.json'), 'utf8'),
);

const verifyConfig = fs.readFileSync(
  path.join(root, 'commands', 'verify-config.md'),
  'utf8',
);
const pluginVerifyConfig = fs.readFileSync(
  path.join(
    root,
    'plugin-assets',
    'claude-code-plugin',
    'commands',
    'verify-config.md',
  ),
  'utf8',
);
assert.equal(
  pluginVerifyConfig,
  verifyConfig,
  'plugin verify-config command is not synchronized with its source',
);
assert.doesNotMatch(
  verifyConfig,
  /(?:investigate|review|qa|careful|freeze)\/SKILL\.md/,
  'verify-config still requires retired per-workflow SKILL.md files',
);
for (const installedContract of [
  'workflows/investigate/code.workflow.md',
  'workflows/review/code.workflow.md',
  'workflows/qa/app.workflow.md',
]) {
  assert.match(
    verifyConfig,
    new RegExp(installedContract.replaceAll('.', '\\.')),
  );
}

validatePromptArchitecture(manifest);
validateSafetyGates(manifest.capabilities);

assert.throws(
  () =>
    assertPromptSurfaceBudget(
      'oversized contract fixture',
      'x'.repeat(PROMPT_SURFACE_BUDGETS.workflowContractBytes + 1),
      PROMPT_SURFACE_BUDGETS.workflowContractBytes,
    ),
  /exceeds prompt surface budget/,
);
assert.throws(
  () =>
    assertPromptSurfaceTotal(
      'oversized runtime fixture',
      [
        {
          label: 'oversized runtime fixture',
          bytes: PROMPT_SURFACE_BUDGETS.installedRuntimeMarkdownTotalBytes + 1,
        },
      ],
      PROMPT_SURFACE_BUDGETS.installedRuntimeMarkdownTotalBytes,
    ),
  /exceeds prompt surface budget/,
);

const retiredArchitecturePaths = [
  'goldband-loop/scripts/gen-skill-docs.ts',
  'goldband-loop/scripts/skill-budget.ts',
  'goldband-loop/scripts/resolvers',
  'goldband-loop/model-overlays',
  'goldband-loop/scripts/skill-check.ts',
  'goldband-loop/scripts/discover-skills.ts',
];
assert.deepEqual(
  retiredArchitecturePaths.filter((relativePath) =>
    fs.existsSync(path.join(root, relativePath)),
  ),
  [],
  'retired workflow prompt architecture was reintroduced',
);

for (const capability of manifest.capabilities) {
  for (const action of capability.actions) {
    assert.equal(
      Object.hasOwn(action, 'source'),
      false,
      `${capability.id}/${action.id} still declares legacy source`,
    );
  }
}

const legacyPromptFiles = fs
  .readdirSync(path.join(root, 'goldband-loop'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
  .flatMap((entry) =>
    ['SKILL.md', 'SKILL.md.tmpl']
      .map((name) => path.join('goldband-loop', entry.name, name))
      .filter((relativePath) => fs.existsSync(path.join(root, relativePath))),
  );
assert.deepEqual(
  legacyPromptFiles,
  [],
  `legacy per-workflow prompt files remain:\n${legacyPromptFiles.join('\n')}`,
);

const legacyGeneratedSkills = listLegacyHostSkillArtifacts(root);
assert.deepEqual(
  legacyGeneratedSkills,
  [],
  `legacy generated host skills remain:\n${legacyGeneratedSkills.join('\n')}`,
);

const missingContract = structuredClone(manifest);
delete missingContract.capabilities[0].promptContract;
assert.throws(
  () => validatePromptArchitecture(missingContract),
  /promptContract is required/,
);

const contracts = buildWorkflowContracts(manifest);
const reviewCodeContract = contracts.get(
  'goldband-loop/generated/workflow-contracts/review/code.workflow.md',
);
assert.match(
  reviewCodeContract,
  /Claude: <skill-root>\/bin\/goldband review code/,
  'review/code must launch the real typed runtime from interactive Claude invocations',
);
assert.match(
  reviewCodeContract,
  /Codex: ~\/\.codex\/goldband\/workflow-runtime\/bin\/goldband review code/,
  'review/code must use the installed executable without asking agents to assemble launcher JSON',
);
assert.doesNotMatch(
  reviewCodeContract,
  /one core reviewer|specialist|active-review marker|atomic repository-scope lease|poll|second full semantic review/,
  'review/code prompt contract must not duplicate runtime-owned execution policy',
);

const planCreateContract = contracts.get(
  'goldband-loop/generated/workflow-contracts/plan/create.workflow.md',
);
assert.ok(planCreateContract, 'plan/create contract must exist');
assert.match(
  planCreateContract,
  /bin\/goldband plan create --input <file> --host claude/,
  'plan/create must invoke the installed typed owner on Claude',
);
assert.match(
  planCreateContract,
  /bin\/goldband plan create --input <file> --host codex/,
  'plan/create must invoke the installed typed owner on Codex',
);
assert.match(
  planCreateContract,
  /prose without successful runtime output is not completion/,
  'plan/create must not allow a prose-only success path',
);
assert.match(
  planCreateContract,
  /smallest sufficient solution/,
  'plan/create must apply the canonical proportionality principle before selecting a direction',
);
assert.match(
  planCreateContract,
  /ongoing operational or maintenance cost/,
  'plan/create must surface the permanent cost of a heavier mechanism',
);
assert.match(
  planCreateContract,
  /applicability, not deterministic enforcement/,
  'plan/create must not misrepresent phase metadata as a hard gate',
);

const browserSessionContract = contracts.get(
  'goldband-loop/generated/workflow-contracts/browser/session.workflow.md',
);
assert.ok(browserSessionContract, 'browser/session contract must exist');
assert.match(
  browserSessionContract,
  /On Codex CLI, do not probe Browser or Chrome plugin bindings/,
  'browser/session must not route Codex CLI through app browser bindings',
);
assert.match(
  browserSessionContract,
  /\.workflow-launcher\.json and execute its exact argvPrefix plus browser session --host codex/,
  'browser/session must use the installed trusted Codex workflow launcher',
);
assert.match(
  browserSessionContract,
  /Missing marker, runtime, or rule is an install failure/,
  'browser/session must fail closed when its trusted runtime is incomplete',
);
assert.match(
  reviewCodeContract,
  /Missing runtime or rule is an install failure/,
  'review/code must fail closed when the installed executable or native rule is missing',
);
assert.ok(
  Buffer.byteLength(reviewCodeContract) <= 1024,
  'review/code workflow prompt contract must stay within its runtime-routing budget',
);
const actionCount = manifest.capabilities.reduce(
  (count, capability) => count + capability.actions.length,
  0,
);

const actions = manifest.capabilities.flatMap((capability) =>
  capability.actions.map((action) => ({
    name: `${capability.id}/${action.id}`,
    runtime: action.runtime,
    lifecycle: action.lifecycle ?? 'public',
    owner: action.owner ?? null,
  })),
);
assert.equal(actionCount, 22);
assert.equal(
  actions.filter((action) => action.lifecycle === 'public').length,
  20,
);
assert.equal(actions.filter((action) => action.runtime === 'typed').length, 17);
assert.equal(
  actions.filter((action) => action.runtime === 'compatibility').length,
  3,
);
assert.deepEqual(
  actions
    .filter((action) => action.lifecycle === 'experimental')
    .map((action) => action.name)
    .sort(),
  ['release/land', 'release/setup'],
);
assert.equal(
  actions
    .filter((action) => action.lifecycle === 'public')
    .every(
      (action) => typeof action.owner === 'string' && action.owner.length > 0,
    ),
  true,
  'every public action must declare a runtime owner',
);
assert.equal(
  actions
    .filter((action) => action.lifecycle === 'experimental')
    .every((action) => action.owner === null),
  true,
  'experimental actions cannot claim a runtime owner',
);
for (const retired of [
  'qa/report-only',
  'release/report',
  'plan/tune',
  'system/skill-authoring',
  'ios/fix',
]) {
  assert.equal(
    actions.some((action) => action.name === retired),
    false,
    `${retired} was reintroduced as a standalone action`,
  );
}

const safetyGates = collectSafetyGates(manifest.capabilities);
assert.deepEqual(safetyGates.map((gate) => gate.operation).sort(), [
  'browser/cookies',
  'ios/qa',
  'ios/sync',
  'plan/sync',
  'plan/sync-preview',
  'release/canary',
  'release/land',
  'release/setup',
  'system/upgrade',
]);
assert.deepEqual(
  safetyGates
    .filter((gate) => gate.enforcement === 'runtime-owner')
    .map((gate) => gate.operation)
    .sort(),
  ['ios/qa', 'plan/sync', 'plan/sync-preview', 'system/upgrade'],
);
assert.equal(
  safetyGates.filter((gate) => gate.enforcement === 'blocked-before-runtime')
    .length,
  5,
);

const missingPrimaryGate = structuredClone(manifest.capabilities);
const releaseLand = missingPrimaryGate
  .find((capability) => capability.id === 'release')
  .actions.find((action) => action.id === 'land');
releaseLand.safetyGates = releaseLand.safetyGates.filter(
  (gate) => gate.operation !== 'release/land',
);
assert.throws(
  () => validateSafetyGates(missingPrimaryGate),
  /high-risk actions require a primary safety gate/,
);

const prematureOwner = structuredClone(manifest.capabilities);
const releaseSetup = prematureOwner
  .find((capability) => capability.id === 'release')
  .actions.find((action) => action.id === 'setup');
releaseSetup.safetyGates[0].enforcement = 'runtime-owner';
releaseSetup.safetyGates[0].owner = 'unproven-owner';
assert.throws(
  () => validateSafetyGates(prematureOwner),
  /registered-only actions must remain blocked before runtime/,
);

const missingRuntimeContract = structuredClone(manifest.capabilities);
const iosQa = missingRuntimeContract
  .find((capability) => capability.id === 'ios')
  .actions.find((action) => action.id === 'qa');
delete iosQa.runtimeContract;
assert.throws(
  () => validateSafetyGates(missingRuntimeContract),
  /runtime safety gates require a runtimeContract/,
);

assert.equal(contracts.size, actionCount);

const generatedContractRoot = path.join(
  root,
  'goldband-loop',
  'generated',
  'workflow-contracts',
);
const actualContractPaths = [];
for (const capability of fs.readdirSync(generatedContractRoot, {
  withFileTypes: true,
})) {
  if (!capability.isDirectory()) continue;
  for (const entry of fs.readdirSync(
    path.join(generatedContractRoot, capability.name),
    { withFileTypes: true },
  )) {
    if (entry.isFile()) {
      actualContractPaths.push(
        path.posix.join(
          'goldband-loop/generated/workflow-contracts',
          capability.name,
          entry.name,
        ),
      );
    }
  }
}
assert.deepEqual(
  actualContractPaths.sort(),
  [...contracts.keys()].sort(),
  'generated workflow contract inventory is stale',
);

let totalBytes = 0;
const retiredQuestionFormatPattern =
  /decision brief|ELI10|completeness score|each option|40 words|ONE AT A TIME|Do NOT batch|Never batch/i;
for (const [relativePath, content] of contracts) {
  assert.match(
    relativePath,
    /^goldband-loop\/generated\/workflow-contracts\/[a-z][a-z0-9-]*\/[a-z][a-z0-9-]*\.workflow\.md$/,
  );
  validateWorkflowContractContent(content, manifest.promptArchitecture, {
    relativePath,
  });
  assert.doesNotMatch(
    content,
    /manuals\/[a-z][a-z0-9-]*\.md/,
    `${relativePath} should not duplicate manifest-owned manual routing`,
  );
  assert.doesNotMatch(
    content,
    retiredQuestionFormatPattern,
    `${relativePath} reintroduced retired question-format boilerplate`,
  );
  const bytes = assertPromptSurfaceBudget(
    relativePath,
    content,
    PROMPT_SURFACE_BUDGETS.workflowContractBytes,
  );
  totalBytes += bytes;
}

assertPromptSurfaceTotal(
  'workflow contracts',
  [{ label: 'workflow contracts', bytes: totalBytes }],
  PROMPT_SURFACE_BUDGETS.workflowContractsTotalBytes,
);

const review = contracts.get(
  'goldband-loop/generated/workflow-contracts/review/code.workflow.md',
);
assert.ok(review);
assert.doesNotMatch(
  review,
  /review\/(?:shared-rubric|findings-schema|checklist)\.md/,
  'review/code workflow prompt must leave runtime-owned assets to the runtime',
);
assert.match(review, /Review only/);

const release = contracts.get(
  'goldband-loop/generated/workflow-contracts/release/land.workflow.md',
);
assert.ok(release);
assert.match(release, /explicit approval/i);

assert.equal(
  manifest.promptArchitecture.interactionPolicy.askOnlyWhen,
  'Ask only when user authority is required, or two plausible answers would change the target, behavior, or external effect and current evidence or preferences cannot resolve intent.',
);
assert.match(
  manifest.promptArchitecture.interactionPolicy.batching,
  /Batch related decisions/,
);
assert.match(
  manifest.promptArchitecture.interactionPolicy.formatOwner,
  /Tool schemas and UI/,
);

const rootSkill = fs.readFileSync(
  path.join(root, 'goldband-loop', 'SKILL.md'),
  'utf8',
);
assertPromptSurfaceBudget(
  'goldband-loop/SKILL.md',
  rootSkill,
  PROMPT_SURFACE_BUDGETS.rootRouterSkillBytes,
);
assert.match(rootSkill, /## Human decisions/);
assert.match(rootSkill, /Ask only when user authority is required/);
assert.match(rootSkill, /Batch related decisions/);
assert.match(rootSkill, /Tool schemas and UI own question shape/);
assert.throws(
  () =>
    validateWorkflowContractContent(
      `${review}\n## Preamble (run first)\n`,
      manifest.promptArchitecture,
      { relativePath: 'fixture' },
    ),
  /universal-preamble/,
);

for (const manual of manifest.manuals) {
  const content = fs.readFileSync(
    path.join(root, 'goldband-loop', manual.source),
    'utf8',
  );
  validateSharedPromptContent(content, manifest.promptArchitecture, {
    relativePath: manual.source,
  });
  assertPromptSurfaceBudget(
    manual.source,
    content,
    PROMPT_SURFACE_BUDGETS.manualBytes,
  );
}

const runtimePromptEntries = [
  promptSurfaceEntry('goldband-loop/SKILL.md'),
  promptSurfaceEntry('goldband-loop/ETHOS.md'),
  ...markdownEntries('goldband-loop/manuals', { recursive: false }),
  ...markdownEntries('goldband-loop/review', { recursive: false }),
  ...markdownEntries('goldband-loop/cross-review', { recursive: false }),
  ...markdownEntries('goldband-loop/generated/workflow-contracts', {
    recursive: true,
  }),
];

for (const entry of runtimePromptEntries) {
  if (entry.label.includes('/generated/workflow-contracts/')) continue;
  if (entry.label === 'goldband-loop/SKILL.md') continue;
  const budget = entry.label.includes('/manuals/')
    ? PROMPT_SURFACE_BUDGETS.manualBytes
    : PROMPT_SURFACE_BUDGETS.runtimeReferenceBytes;
  assertPromptSurfaceBudget(entry.label, entry.content, budget);
}

assertPromptSurfaceTotal(
  'installed Goldband runtime markdown prompt surface',
  runtimePromptEntries,
  PROMPT_SURFACE_BUDGETS.installedRuntimeMarkdownTotalBytes,
);

for (const relativeDirectory of ['goldband-loop', 'goldband-loop/docs']) {
  const directory = path.join(root, relativeDirectory);
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    const filePath = path.join(directory, entry.name);
    const content = fs.readFileSync(filePath, 'utf8');
    for (const match of content.matchAll(/\[[^\]]+\]\(([^)]+\/SKILL\.md)\)/g)) {
      assert.ok(
        fs.existsSync(path.resolve(path.dirname(filePath), match[1])),
        `${path.relative(root, filePath)} links to missing ${match[1]}`,
      );
    }
  }
}

console.log(
  `[OK] ${contracts.size} thin workflow contracts validated (${totalBytes} bytes)`,
);

function promptSurfaceEntry(relativePath) {
  const content = fs.readFileSync(path.join(root, relativePath), 'utf8');
  return {
    label: relativePath,
    content,
    bytes: Buffer.byteLength(content, 'utf8'),
  };
}

function markdownEntries(relativeDirectory, { recursive }) {
  const directory = path.join(root, relativeDirectory);
  if (!fs.existsSync(directory)) return [];
  const entries = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const relativePath = path.posix.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) {
      if (recursive) {
        entries.push(...markdownEntries(relativePath, { recursive }));
      }
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      entries.push(promptSurfaceEntry(relativePath));
    }
  }
  return entries;
}
