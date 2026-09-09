#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateCapabilityInvocations } from './lib/capability-invocations.mjs';
import {
  collectSafetyGates,
  validateSafetyGates,
} from './lib/capability-safety-gates.mjs';
import {
  discoverLegacyEntrypoints,
  discoverRuntimeBinaries,
} from './lib/goldband-source-inventory.mjs';
import {
  assertPromptSurfaceBudget,
  PROMPT_SURFACE_BUDGETS,
} from './lib/prompt-surface-budget.mjs';
import {
  buildWorkflowContracts,
  validatePromptArchitecture,
  workflowContractPath,
} from './lib/workflow-contracts.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const loopRoot = path.join(root, 'goldband-loop');
const manifestPath = path.join(root, 'goldband.manifest.json');
const check = process.argv.includes('--check');
const ALL_HOSTS = [
  'claude',
  'codex',
  'factory',
  'kiro',
  'opencode',
  'slate',
  'cursor',
  'openclaw',
  'hermes',
];
const CAPABILITY_INVOCATION_ROOTS = [
  'README.md',
  'README.en.md',
  'examples/CLAUDE.md',
  'commands',
  'skills/global',
  'plugin-assets/claude-code-plugin/commands',
  'codex/agents',
  'codex/hooks/hook-router.js',
  'codex/prompts/goldband.md',
  'hooks/scripts/lib/skill-activation/activation-rules.js',
  'plugin-assets/claude-code-plugin/hooks/scripts/lib/skill-activation/activation-rules.js',
  'goldband-loop/CONTRIBUTING.md',
  'goldband-loop/SKILL.md',
  'goldband-loop/openclaw',
];
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

validateManifest(manifest);
const discoverableCapabilities = publicCapabilities(manifest.capabilities);
const claudeCapabilities = publicCapabilitiesForHost(
  manifest.capabilities,
  'claude',
);
const codexCapabilities = publicCapabilitiesForHost(
  manifest.capabilities,
  'codex',
);
validateCapabilityInvocations({
  root,
  invocationRoots: CAPABILITY_INVOCATION_ROOTS,
  capabilities: discoverableCapabilities,
});

const capabilityActions = manifest.capabilities.flatMap((capability) =>
  capability.actions.map((action) => ({
    capability: capability.id,
    action: action.id,
    name: `${capability.id}/${action.id}`,
    description: action.description,
    contractPath: workflowContractPath(capability.id, action.id).replace(
      /^goldband-loop\//,
      '',
    ),
    runtime: action.runtime,
    dispatch: actionDispatch(action),
    lifecycle: action.lifecycle ?? 'public',
    runtimeOwner: action.owner ?? null,
    runtimeContract: action.runtimeContract ?? null,
    safetyGates: action.safetyGates ?? [],
    riskLevel: action.risk,
    hostSupport: action.hostSupport ?? ALL_HOSTS,
  })),
);

const outputs = new Map([
  ['claude/CLAUDE.md', globalInstructions('Claude', 'claude', '/goldband')],
  ['codex/AGENTS.md', globalInstructions('Codex', 'codex', '$goldband')],
  [
    'goldband-loop/generated/capability-actions.json',
    json({
      schemaVersion: manifest.schemaVersion,
      interface: '$goldband <capability> <action>',
      promptArchitecture: manifest.promptArchitecture,
      manuals: manifest.manuals,
      actions: capabilityActions,
    }),
  ],
  [
    'goldband-loop/generated/manual-routing.md',
    generatedManualRouting(manifest.manuals),
  ],
  [
    'rules/manifest.json',
    json({
      schemaVersion: manifest.schemaVersion,
      groupSelectors: manifest.policyGroups,
      rules: manifest.policies.map(
        ({ enforcement: _enforcement, ...policy }) => policy,
      ),
    }),
  ],
  [
    'goldband-loop/inventory.json',
    json({
      schema: 2,
      runtimeRoot: manifest.distribution.runtimeRoot,
      visibleSkills: manifest.distribution.visibleSkills,
      internalClaudeSkills: manifest.distribution.internalClaudeSkills,
      capabilities: manifest.capabilities.map(
        ({
          triggers: _triggers,
          promptContract: _promptContract,
          actions: capabilityActions,
          ...capability
        }) => ({
          ...capability,
          actions: capabilityActions.map(
            ({ promptContract: _actionPromptContract, ...action }) => ({
              ...action,
              dispatch: actionDispatch(action),
            }),
          ),
        }),
      ),
      binaries: discoverRuntimeBinaries(loopRoot),
      forbiddenLegacyEntrypoints: discoverLegacyEntrypoints(loopRoot),
      forbiddenCommands: manifest.distribution.forbiddenCommands,
    }),
  ],
  [
    'goldband-loop/workflows/capability-registry.generated.ts',
    generatedRegistry(capabilityActions),
  ],
  [
    'goldband-loop/lib/trusted-launcher-actions.generated.ts',
    generatedTrustedLauncherActions(capabilityActions),
  ],
  [
    'hooks/scripts/lib/skill-activation/capability-routing.generated.json',
    json(activationRules(claudeCapabilities)),
  ],
  [
    'plugin-assets/claude-code-plugin/hooks/scripts/lib/skill-activation/capability-routing.generated.json',
    json(activationRules(claudeCapabilities)),
  ],
  [
    'codex/hooks/capability-routing.generated.json',
    json(codexHints(codexCapabilities)),
  ],
  [
    'goldband-loop/generated/capability-router.md',
    generatedRouter(discoverableCapabilities),
  ],
  [
    'goldband-loop/SKILL.md',
    generatedRootSkill(discoverableCapabilities, manifest.manuals),
  ],
  ['docs/generated/capabilities.md', generatedDocs(manifest)],
]);

function globalInstructions(hostName, hostDir, selector) {
  const content = fs
    .readFileSync(path.join(root, 'rules/global-instructions.md.tmpl'), 'utf8')
    .replaceAll('{{HOST_NAME}}', hostName)
    .replaceAll('{{HOST_DIR}}', hostDir)
    .replaceAll('{{SELECTOR}}', selector);
  assertPromptSurfaceBudget(
    `${hostName} global guidance`,
    content,
    PROMPT_SURFACE_BUDGETS.globalInstructionsBytes,
  );
  return content;
}

for (const host of ALL_HOSTS) {
  outputs.set(
    `goldband-loop/generated/host-skills/${host}.SKILL.md`,
    generatedRootSkill(
      publicCapabilitiesForHost(manifest.capabilities, host),
      manifest.manuals,
    ),
  );
}

for (const [relativePath, content] of buildWorkflowContracts(manifest)) {
  outputs.set(relativePath, content);
}

const retiredGeneratedContracts = findRetiredGeneratedContracts(outputs);
let stale = false;
for (const relativePath of retiredGeneratedContracts) {
  stale = true;
  if (check) {
    console.error(`STALE ${relativePath}`);
    continue;
  }
  fs.unlinkSync(path.join(root, relativePath));
  console.log(`REMOVED ${relativePath}`);
}
for (const [relativePath, content] of outputs) {
  const target = path.join(root, relativePath);
  const current = fs.existsSync(target)
    ? fs.readFileSync(target, 'utf8')
    : null;
  if (current === content) continue;
  stale = true;
  if (check) {
    console.error(`STALE ${relativePath}`);
    continue;
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
  console.log(`GENERATED ${relativePath}`);
}

if (check && stale) process.exit(1);
if (check) console.log('Goldband generated surfaces are current.');

function findRetiredGeneratedContracts(expectedOutputs) {
  const generatedRoot = path.join(
    root,
    'goldband-loop',
    'generated',
    'workflow-contracts',
  );
  if (!fs.existsSync(generatedRoot)) return [];
  const expected = new Set(expectedOutputs.keys());
  return fs
    .readdirSync(generatedRoot, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.workflow.md'))
    .map((entry) => {
      const absolutePath = path.join(entry.parentPath, entry.name);
      return path.relative(root, absolutePath).split(path.sep).join('/');
    })
    .filter((relativePath) => !expected.has(relativePath))
    .sort();
}

function validateManifest(value) {
  if (value.schemaVersion !== 1) throw new Error('unsupported manifest schema');
  validatePromptArchitecture(value);
  validateSafetyGates(value.capabilities ?? []);
  for (const manual of value.manuals) {
    const source = path.resolve(loopRoot, manual.source);
    if (!fs.existsSync(source)) {
      throw new Error(`missing manual source: ${manual.source}`);
    }
  }
  const seen = new Set();
  for (const capability of value.capabilities ?? []) {
    validateCapability(capability);
    for (const action of capability.actions) {
      validateAction(capability.id, action, seen);
    }
  }
}

function generatedManualRouting(manuals) {
  const lines = manuals.map(
    (manual) =>
      `- Read \`manuals/${manual.id}.md\` only for ${manual.loadFor
        .map((selector) => `\`${selector}\``)
        .join(', ')}.`,
  );
  return `<!-- AUTO-GENERATED from goldband.manifest.json. Do not edit. -->\n${lines.join('\n')}\n`;
}

function validateCapability(capability) {
  if (!/^[a-z][a-z0-9-]*$/.test(capability.id)) {
    throw new Error(`invalid capability: ${capability.id}`);
  }
  if (!Array.isArray(capability.triggers) || capability.triggers.length === 0) {
    throw new Error(`${capability.id}: triggers must be a non-empty array`);
  }
  const normalizedTriggers = capability.triggers.map((trigger) => {
    if (
      typeof trigger !== 'string' ||
      trigger.length === 0 ||
      trigger !== trigger.trim()
    ) {
      throw new Error(
        `${capability.id}: triggers must be non-empty trimmed strings`,
      );
    }
    return trigger.toLowerCase();
  });
  if (new Set(normalizedTriggers).size !== normalizedTriggers.length) {
    throw new Error(`${capability.id}: triggers must be unique`);
  }
  if (
    !capability.actions?.some(
      (action) => action.id === capability.defaultAction,
    )
  ) {
    throw new Error(`${capability.id}: defaultAction is not declared`);
  }
}

function validateAction(capabilityId, action, seen) {
  const name = `${capabilityId}/${action.id}`;
  if (seen.has(name)) throw new Error(`duplicate action: ${name}`);
  seen.add(name);
  if (!['typed', 'compatibility', 'registered-only'].includes(action.runtime)) {
    throw new Error(`${name}: invalid runtime: ${action.runtime}`);
  }
  validateActionDispatch(name, action);
  const lifecycle = action.lifecycle ?? 'public';
  if (!['public', 'experimental'].includes(lifecycle)) {
    throw new Error(`${name}: invalid lifecycle: ${lifecycle}`);
  }
  if (lifecycle === 'experimental' && action.runtime !== 'registered-only') {
    throw new Error(
      `${name}: experimental actions must remain registered-only`,
    );
  }
  if (action.runtime === 'registered-only' && action.owner !== undefined) {
    throw new Error(`${name}: registered-only actions cannot claim an owner`);
  }
  if (action.runtime !== 'registered-only' && !action.owner) {
    throw new Error(`${name}: runnable actions require an owner`);
  }
  if (action.runtimeContract !== undefined) {
    validateRuntimeContract(name, action.runtimeContract);
  }
}

function actionDispatch(action) {
  if (action.dispatch) return action.dispatch;
  if (action.runtime === 'compatibility') return 'prompt-contract';
  if (action.runtime === 'registered-only') return 'registered-only';
  return 'host-runtime';
}

function validateActionDispatch(name, action) {
  const dispatch = actionDispatch(action);
  const valid = [
    'trusted-launcher',
    'host-runtime',
    'prompt-contract',
    'registered-only',
  ];
  if (!valid.includes(dispatch)) {
    throw new Error(`${name}: invalid dispatch: ${dispatch}`);
  }
  const expectedRuntime = {
    'trusted-launcher': 'typed',
    'prompt-contract': 'compatibility',
    'registered-only': 'registered-only',
  }[dispatch];
  if (expectedRuntime && action.runtime !== expectedRuntime) {
    throw new Error(
      `${name}: ${dispatch} dispatch requires ${expectedRuntime} runtime`,
    );
  }
}

function validateRuntimeContract(name, contract) {
  if (!contract || typeof contract !== 'object') {
    throw new Error(`${name}: runtimeContract must be an object`);
  }
  validateRuntimeModes(name, contract.modes);
  if (!contract.requiredInputs || typeof contract.requiredInputs !== 'object') {
    throw new Error(`${name}: runtimeContract.requiredInputs is required`);
  }
  for (const mode of contract.modes) {
    const fields = contract.requiredInputs[mode];
    if (!Array.isArray(fields) || fields.length === 0) {
      throw new Error(
        `${name}: runtimeContract.requiredInputs.${mode} is required`,
      );
    }
  }
  if (!Array.isArray(contract.outputs) || contract.outputs.length === 0) {
    throw new Error(`${name}: runtimeContract.outputs must be non-empty`);
  }
  if (!contract.sideEffects || typeof contract.sideEffects !== 'object') {
    throw new Error(`${name}: runtimeContract.sideEffects is required`);
  }
}

function validateRuntimeModes(name, modes) {
  const valid =
    Array.isArray(modes) &&
    modes.length > 0 &&
    modes.every((mode) => /^[a-z][a-z0-9-]*$/.test(mode));
  if (!valid) {
    throw new Error(
      `${name}: runtimeContract.modes must be non-empty action names`,
    );
  }
}

function publicCapabilities(capabilities) {
  return capabilities.flatMap((capability) => {
    const actions = capability.actions.filter(
      (action) => (action.lifecycle ?? 'public') === 'public',
    );
    if (actions.length === 0) return [];
    const defaultAction = actions.some(
      (action) => action.id === capability.defaultAction,
    )
      ? capability.defaultAction
      : actions[0].id;
    return [{ ...capability, actions, defaultAction }];
  });
}

function publicCapabilitiesForHost(capabilities, host) {
  return publicCapabilities(capabilities).flatMap((capability) => {
    const actions = capability.actions.filter((action) =>
      (action.hostSupport ?? ALL_HOSTS).includes(host),
    );
    if (actions.length === 0) return [];
    const defaultAction = actions.some(
      (action) => action.id === capability.defaultAction,
    )
      ? capability.defaultAction
      : actions[0].id;
    return [{ ...capability, actions, defaultAction }];
  });
}

function generatedRegistry(entries) {
  return (
    `// AUTO-GENERATED from goldband.manifest.json. Do not edit.\n` +
    `import type { HostName, RiskLevel, RuntimeActionContract, SafetyGateContract } from './types';\n\n` +
    `export type CapabilityActionRecord = {\n  capability: string;\n  action: string;\n  name: string;\n  description: string;\n  contractPath: string;\n  runtime: 'typed' | 'compatibility' | 'registered-only';\n  dispatch: 'trusted-launcher' | 'host-runtime' | 'prompt-contract' | 'registered-only';\n  lifecycle: 'public' | 'experimental';\n  runtimeOwner: string | null;\n  runtimeContract: RuntimeActionContract | null;\n  safetyGates: SafetyGateContract[];\n  riskLevel: RiskLevel;\n  hostSupport: HostName[];\n};\n\n` +
    `export const CAPABILITY_ACTIONS: CapabilityActionRecord[] = ${JSON.stringify(
      entries,
      null,
      2,
    )};\n`
  );
}

function generatedTrustedLauncherActions(entries) {
  const trustedActions = entries
    .filter((entry) => entry.dispatch === 'trusted-launcher')
    .map((entry) => entry.name)
    .sort();
  const promptContractActions = entries
    .filter((entry) => entry.dispatch === 'prompt-contract')
    .map((entry) => entry.name)
    .sort();
  return (
    '// AUTO-GENERATED from goldband.manifest.json. Do not edit.\n' +
    `export const TRUSTED_LAUNCHER_ACTIONS = ${JSON.stringify(trustedActions, null, 2)} as const;\n` +
    `export const PROMPT_CONTRACT_ACTIONS = ${JSON.stringify(promptContractActions, null, 2)} as const;\n`
  );
}

function activationRules(capabilities) {
  return capabilities.map((capability) => ({
    skill: `goldband:${capability.id}/${capability.defaultAction}`,
    priority: ['review', 'investigate', 'qa'].includes(capability.id)
      ? 'high'
      : 'medium',
    hint: `Use $goldband ${capability.id} ${capability.defaultAction} when this capability matches the task.`,
    keywords: capability.triggers,
  }));
}

function codexHints(capabilities) {
  return capabilities.map((capability) => ({
    name: capability.id,
    triggers: capability.triggers,
    message: `Goldband capability available: $goldband ${capability.id} ${capability.defaultAction}. Use it only when it materially matches the requested outcome.`,
  }));
}

function generatedRouter(capabilities) {
  const menu = capabilities
    .map(
      (capability) =>
        `- \`$goldband ${capability.id} ${capability.defaultAction}\` — ${capability.description}`,
    )
    .join('\n');
  return `<!-- AUTO-GENERATED from goldband.manifest.json. Do not edit. -->\n${menu}\n`;
}

function generatedRootSkill(capabilities, manuals) {
  const templatePath = path.join(loopRoot, 'SKILL.md.tmpl');
  const template = fs.readFileSync(templatePath, 'utf8');
  const content = template
    .replace('{{CAPABILITY_ROUTER}}', generatedRouter(capabilities).trim())
    .replace(
      '{{INTERACTION_POLICY}}',
      generatedInteractionPolicy(
        manifest.promptArchitecture.interactionPolicy,
      ).trim(),
    )
    .replace(
      '{{CAPABILITY_MANUAL_ROUTING}}',
      generatedManualRouting(manuals).trim(),
    );
  const unresolved = [...content.matchAll(/\{\{[A-Z][A-Z0-9_]*\}\}/g)].map(
    (match) => match[0],
  );
  if (unresolved.length > 0) {
    throw new Error(
      `unresolved root skill placeholders: ${unresolved.join(', ')}`,
    );
  }
  return content.replace(
    '\n---\n\n# Goldband capability router',
    '\n---\n<!-- AUTO-GENERATED from SKILL.md.tmpl and goldband.manifest.json. Do not edit. -->\n\n# Goldband capability router',
  );
}

function generatedDocs(value) {
  const publicActions = capabilityActions.filter(
    (action) => action.lifecycle === 'public',
  );
  const experimentalActions = capabilityActions.filter(
    (action) => action.lifecycle === 'experimental',
  );
  const rows = publicActions
    .map(
      (action) =>
        `| \`${action.capability}\` | \`${action.action}\` | ${action.description} | \`${action.runtimeOwner}\` | \`${action.runtime}\` | \`${action.dispatch}\` | \`${action.riskLevel}\` |`,
    )
    .join('\n');
  const experimentalRows = experimentalActions
    .map(
      (action) =>
        `| \`${action.capability}\` | \`${action.action}\` | ${action.description} | — | \`${action.runtime}\` | \`${action.dispatch}\` | \`${action.riskLevel}\` |`,
    )
    .join('\n');
  const safetyRows = collectSafetyGates(value.capabilities)
    .map(
      (gate) =>
        `| \`${gate.operation}\` | \`${gate.action}\` | \`${gate.mode}\` | \`${gate.enforcement}\` | \`${gate.authorization}\` | ${gate.owner ? `\`${gate.owner}\`` : '—'} |`,
    )
    .join('\n');
  return `<!-- AUTO-GENERATED from goldband.manifest.json. Do not edit. -->\n# Goldband capabilities\n\nFormal interface: \`${value.capabilityInterface}\`. Old workflow names are not aliases.\n\nPublic inventory: ${publicActions.length} actions. Experimental actions are excluded from routing and activation hints.\n\n| Capability | Action | Outcome | Runtime owner | Runtime | Dispatch | Risk |\n| --- | --- | --- | --- | --- | --- | --- |\n${rows}\n\n## Experimental inventory\n\nThese actions are tracked for implementation, but are not discoverable or runnable. They cannot claim a runtime owner before integration.\n\n| Capability | Action | Outcome | Runtime owner | Runtime | Dispatch | Risk |\n| --- | --- | --- | --- | --- | --- | --- |\n${experimentalRows}\n\n## High-risk safety gates\n\nThese operation IDs are internal safety inventory, not public action aliases. \`blocked-before-runtime\` operations cannot run until a matching owner replaces the block and implements every precondition, authorization boundary, side effect, and readback requirement. \`runtime-owner\` operations record successful gate evidence only after an operation-specific verifier validates the declared contract against owner output and trusted readback; blocked or mock-only runs remain pending.\n\n| Operation | Active action | Mode | Enforcement | Authorization | Gate owner |\n| --- | --- | --- | --- | --- | --- |\n${safetyRows}\n\n## Prompt/runtime boundary\n\n- Prompt contract: ${value.promptArchitecture.contract.join(', ')}.\n- Model owns: ${value.promptArchitecture.modelOwns.join(', ')}.\n- Runtime owns: ${value.promptArchitecture.runtimeOwns.join(', ')}.\n- Installed workflow documents are thin contracts generated from manifest-owned \`promptContract\` fields. Per-workflow \`SKILL.md\` and \`SKILL.md.tmpl\` prompt surfaces are not part of the architecture.\n\n${generatedInteractionPolicy(value.promptArchitecture.interactionPolicy)}\n`;
}

function generatedInteractionPolicy(policy) {
  return `## Human decisions\n\n- ${policy.askOnlyWhen}\n- ${policy.batching}\n- ${policy.formatOwner}\n- Avoid prompt-owned formats: ${policy.avoidPromptFormats.join(', ')}.`;
}

function json(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}
