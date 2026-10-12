import { describe, expect, test } from 'bun:test';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { defineWorkflow } from '../workflows/definition';
import {
  CORE_WORKFLOWS,
  WORKFLOW_REGISTRY,
  experimentalWorkflows,
  publicWorkflows,
  registeredOnlyWorkflows,
} from '../workflows/registry';

const ROOT = resolve(import.meta.dir, '..');
const INACTIVE_DOC_DIRECTORIES = new Set([
  'archive',
  'designs',
  'plans',
  'reports',
]);

function activeDocumentationFiles(relativeDirectory: string): string[] {
  return readdirSync(resolve(ROOT, relativeDirectory), { withFileTypes: true })
    .flatMap((entry) => {
      const relativePath = `${relativeDirectory}/${entry.name}`;
      if (entry.isDirectory()) {
        return INACTIVE_DOC_DIRECTORIES.has(entry.name)
          ? []
          : activeDocumentationFiles(relativePath);
      }
      return entry.isFile() && entry.name.endsWith('.md') ? [relativePath] : [];
    });
}

describe('workflow registry', () => {
  test('covers every manifest capability action', () => {
    const inventory = JSON.parse(
      readFileSync(resolve(ROOT, 'inventory.json'), 'utf8'),
    );
    const registryNames = new Set(WORKFLOW_REGISTRY.map((entry) => entry.name));
    const names = inventory.capabilities.flatMap((capability: { id: string; actions: Array<{ id: string }> }) =>
      capability.actions.map((action) => `${capability.id}/${action.id}`),
    );
    for (const name of names) {
      expect(registryNames.has(name)).toBe(true);
    }
    expect(registryNames.size).toBe(names.length);
  });

  test('all entries have loop fields and valid thin contract pointers', () => {
    for (const entry of WORKFLOW_REGISTRY) {
      expect(entry.target.length).toBeGreaterThan(0);
      expect(entry.evaluationSignal.length).toBeGreaterThan(0);
      expect(entry.iterationCap).toBeGreaterThan(0);
      expect(entry.stopConditions.length).toBeGreaterThan(0);
      expect(entry.hostSupport.length).toBeGreaterThan(0);
      expect(entry.evidencePolicy).toContain('JSONL');
      if (entry.integrationStatus === 'integrated') {
        expect(entry.runtimeOwner).not.toBeNull();
      } else {
        expect(entry.runtimeOwner).toBeNull();
      }
      expect(existsSync(resolve(ROOT, entry.contractPath))).toBe(true);
    }
  });

  test('public runtime and experimental lifecycle stay separate', () => {
    const core = new Set<string>(CORE_WORKFLOWS);
    for (const entry of WORKFLOW_REGISTRY) {
      const expected = core.has(entry.name) ? 'integrated' : 'registered-only';
      expect(entry.integrationStatus).toBe(expected);
    }
    expect(publicWorkflows()).toHaveLength(20);
    expect(experimentalWorkflows().map((entry) => entry.name).sort()).toEqual([
      'release/land',
      'release/setup',
    ]);
    expect(registeredOnlyWorkflows()).toHaveLength(2);
    expect(registeredOnlyWorkflows().every((entry) => entry.lifecycle === 'experimental')).toBe(true);
  });

  test('nine high-risk operations have fail-closed safety contracts', () => {
    const gates = WORKFLOW_REGISTRY.flatMap((entry) =>
      entry.safetyGates.map((gate) => ({ ...gate, action: entry.name })),
    );
    expect(gates.map((gate) => gate.operation).sort()).toEqual([
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
    expect(
      gates
        .filter((gate) => gate.enforcement === 'runtime-owner')
        .map((gate) => gate.operation)
        .sort(),
	).toEqual(['ios/qa', 'plan/sync', 'plan/sync-preview', 'system/upgrade']);
    expect(
      gates.filter((gate) => gate.enforcement === 'blocked-before-runtime'),
    ).toHaveLength(5);
    for (const entry of WORKFLOW_REGISTRY.filter(
      (workflow) => workflow.riskLevel === 'high',
    )) {
      expect(
        entry.safetyGates.some((gate) => gate.operation === entry.name),
      ).toBe(true);
    }
    expect(WORKFLOW_REGISTRY.some((entry) => entry.name === 'release/canary'))
      .toBe(false);
    expect(WORKFLOW_REGISTRY.some((entry) => entry.name === 'browser/cookies'))
      .toBe(false);
    expect(WORKFLOW_REGISTRY.some((entry) => entry.name === 'ios/sync'))
      .toBe(false);
  });

  test('runtime gate verifiers must cover the exact declared contract', () => {
    const ios = WORKFLOW_REGISTRY.find((entry) => entry.name === 'ios/qa');
    expect(ios).toBeDefined();
    if (!ios) return;
    expect(() => defineWorkflow({
      ...ios,
      safetyGates: ios.safetyGates.map((gate) => gate.operation === 'ios/qa'
        ? { ...gate, readback: [...gate.readback, 'undeclared-readback'] }
        : gate),
    })).toThrow('ios/qa: verifier readback contract mismatch');
  });

  test('integrated workflows expose only the thin prompt contract', () => {
    for (const name of CORE_WORKFLOWS) {
      const entry = WORKFLOW_REGISTRY.find((item) => item.name === name);
      expect(entry).toBeDefined();
      if (!entry) continue;
      const contract = readFileSync(resolve(ROOT, entry.contractPath), 'utf8');
      expect(contract).toContain(`# $goldband ${entry.capability} ${entry.action}`);
      expect(contract).toContain('## Goal');
      expect(contract).toContain('## Relevant context');
      expect(contract).toContain('## Hard boundaries');
      expect(contract).toContain('## Verification');
    }
  });

  test('coverage report table matches registry contract fields', () => {
    const report = readFileSync(resolve(ROOT, '../docs/generated/capabilities.md'), 'utf8');
    const tableRows = new Map<string, string[]>();
    for (const line of report.split('\n')) {
      const cells = line.split('|').map((cell) => cell.trim()).filter(Boolean);
      const [capability, action] = cells;
      if (!capability || !action || capability === 'Capability' || capability.startsWith('---')) continue;
      const normalizedName = `${capability.replaceAll('`', '')}/${action.replaceAll('`', '')}`;
      if (WORKFLOW_REGISTRY.some((entry) => entry.name === normalizedName)) {
        tableRows.set(normalizedName, cells);
      }
    }

    expect(tableRows.size).toBe(WORKFLOW_REGISTRY.length);
    for (const entry of WORKFLOW_REGISTRY) {
      const cells = tableRows.get(entry.name);
      expect(cells).toBeDefined();
      if (!cells) continue;
      expect(cells[0].replaceAll('`', '')).toBe(entry.capability);
      expect(cells[1].replaceAll('`', '')).toBe(entry.action);
      expect(cells[3].replaceAll('`', '')).toBe(entry.runtimeOwner ?? '—');
      expect(cells[4].replaceAll('`', '')).toBe(entry.integrationStatus === 'integrated' ? entry.entrypointType : 'registered-only');
      expect(cells[5].replaceAll('`', '')).toBe(entry.dispatch);
      expect(cells[6].replaceAll('`', '')).toBe(entry.riskLevel);
    }
  });

  test('generated host menus and routing hints expose only supported actions', () => {
    const hosts = [
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
    for (const host of hosts) {
      const menu = readFileSync(
        resolve(ROOT, `generated/host-skills/${host}.SKILL.md`),
        'utf8',
      );
      for (const match of menu.matchAll(/\$goldband ([a-z][a-z0-9-]*) ([a-z][a-z0-9-]*)/g)) {
        const workflow = WORKFLOW_REGISTRY.find(
          (entry) => entry.name === `${match[1]}/${match[2]}`,
        );
        expect(workflow).toBeDefined();
        expect(workflow?.hostSupport).toContain(host);
      }
    }

    const codexMenu = readFileSync(
      resolve(ROOT, 'generated/host-skills/codex.SKILL.md'),
      'utf8',
    );
    const claudeMenu = readFileSync(
      resolve(ROOT, 'generated/host-skills/claude.SKILL.md'),
      'utf8',
    );
    expect(codexMenu).toContain('$goldband plan create');
    expect(claudeMenu).toContain('$goldband plan create');
  });

  test('active documentation exposes only the capability interface', () => {
    expect(existsSync(resolve(ROOT, 'docs/skills.md'))).toBe(false);
    expect(activeDocumentationFiles('docs')).not.toContain(
      'docs/archive/TODOS_COMPLETED.md',
    );

    const activeDocs = [
      '../README.md',
      '../README.en.md',
      '../CONTRIBUTING.md',
      '../ARCHITECTURE.md',
      '../OPERATIONS.md',
      '../DESIGN.md',
      '../AGENTS.md',
      '../CLAUDE.md',
      'README.md',
      'CONTRIBUTING.md',
      'ARCHITECTURE.md',
      'BROWSER.md',
      'DESIGN.md',
      'ETHOS.md',
      'AGENTS.md',
      'CLAUDE.md',
      ...activeDocumentationFiles('../docs'),
      ...activeDocumentationFiles('docs'),
    ];
    const manifest = JSON.parse(
      readFileSync(resolve(ROOT, '../goldband.manifest.json'), 'utf8'),
    ) as {
      capabilities: Array<{
        id: string;
        actions: Array<{ id: string; lifecycle?: "public" | "experimental" }>;
      }>;
    };
    const validActions = new Set(
      manifest.capabilities.flatMap((capability) =>
        capability.actions
          .filter((action) => (action.lifecycle ?? "public") === "public")
          .map((action) => `${capability.id}/${action.id}`),
      ),
    );
    const retiredFlatCommands = new Set(['automate', 'ship']);
    const staleReferences: string[] = [];
    const brokenMarkdownLinks: string[] = [];

    for (const relativePath of activeDocs) {
      const content = readFileSync(resolve(ROOT, relativePath), 'utf8');
      for (const legacyInterface of [
        '$goldband <workflow>',
        '/goldband <workflow>',
      ]) {
        if (content.includes(legacyInterface)) {
          const line = content.slice(0, content.indexOf(legacyInterface)).split('\n').length;
          staleReferences.push(`${relativePath}:${line}: ${legacyInterface}`);
        }
      }
      const invocationPattern =
        /(?:\$|\/)goldband(?:[ \t]+([a-z][a-z0-9-]*))?(?:[ \t]+([a-z][a-z0-9-]*))?/gi;
      for (const match of content.matchAll(invocationPattern)) {
        if (!match[1]) continue;
        const action = match[2]
          ? `${match[1].toLowerCase()}/${match[2].toLowerCase()}`
          : '';
        if (validActions.has(action)) continue;
        const line = content.slice(0, match.index).split('\n').length;
        staleReferences.push(`${relativePath}:${line}: ${match[0]}`);
      }
      for (const command of retiredFlatCommands) {
        const escaped = command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const pattern = new RegExp(`(?<![\\w-])/${escaped}(?![\\w/-])`, 'g');
        for (const match of content.matchAll(pattern)) {
          const prefix = content.slice(Math.max(0, (match.index ?? 0) - 8), match.index);
          if (/(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s$/.test(prefix)) continue;
          const line = content.slice(0, match.index).split('\n').length;
          staleReferences.push(`${relativePath}:${line}: ${match[0]}`);
        }
      }
      for (const match of content.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
        const rawTarget = match[1].trim().split(/\s+/)[0].replace(/^<|>$/g, '');
        const target = rawTarget.split('#')[0];
        if (!target || /^(?:https?:|mailto:|#)/i.test(rawTarget)) continue;
        if (!target.endsWith('.md')) continue;
        const source = resolve(ROOT, relativePath);
        if (existsSync(resolve(dirname(source), target))) continue;
        const line = content.slice(0, match.index).split('\n').length;
        brokenMarkdownLinks.push(`${relativePath}:${line}: ${rawTarget}`);
      }
    }
    expect(staleReferences).toEqual([]);
    expect(brokenMarkdownLinks).toEqual([]);

    for (const relativePath of ['README.md', 'AGENTS.md', 'CLAUDE.md']) {
      const content = readFileSync(resolve(ROOT, relativePath), 'utf8');
      expect(content).toContain('../docs/generated/capabilities.md');
      expect(content).toContain('$goldband <capability> <action>');
      expect(content).toContain('/goldband <capability> <action>');
      expect(content).not.toMatch(
        /(?<![\w-])goldband-(?:review|qa|ship)(?![\w-])/,
      );
    }

    for (const adapter of ['AGENTS.md', 'CLAUDE.md']) {
      const lineCount = readFileSync(resolve(ROOT, adapter), 'utf8').split('\n').length;
      expect(lineCount).toBeLessThanOrEqual(60);
    }
  });

  test('missing loop contract fields fail at definition time', () => {
    expect(() => defineWorkflow({
      capability: 'broken',
      action: 'test',
      name: 'broken',
      target: 'x',
      evaluationSignal: 'x',
      iterationCap: 0,
      stopConditions: ['target-met'],
      contractPath: 'README.md',
      entrypointType: 'legacy-thin',
      integrationStatus: 'registered-only',
      lifecycle: 'public',
      runtimeOwner: null,
      hostSupport: ['claude'],
      riskLevel: 'low',
      evidencePolicy: 'x',
      migrationNotes: 'x',
      nextStep: 'x',
    })).toThrow('iterationCap');

    expect(() => defineWorkflow({
      capability: 'broken',
      action: 'test',
      name: 'broken',
      target: 'x',
      evaluationSignal: 'x',
      iterationCap: 1,
      stopConditions: [],
      contractPath: 'README.md',
      entrypointType: 'legacy-thin',
      integrationStatus: 'registered-only',
      lifecycle: 'public',
      runtimeOwner: null,
      hostSupport: ['claude'],
      riskLevel: 'low',
      evidencePolicy: 'x',
      migrationNotes: 'x',
      nextStep: 'x',
    })).toThrow('stopConditions');

    expect(() => defineWorkflow({
      capability: 'broken',
      action: 'dangerous',
      name: 'broken/dangerous',
      target: 'x',
      evaluationSignal: 'x',
      iterationCap: 1,
      stopConditions: ['target-met'],
      contractPath: 'README.md',
      entrypointType: 'typed',
      integrationStatus: 'integrated',
      lifecycle: 'public',
      runtimeOwner: 'test-owner',
      hostSupport: ['claude'],
      riskLevel: 'high',
      evidencePolicy: 'x',
      migrationNotes: 'x',
      nextStep: 'x',
    })).toThrow('high-risk workflow has no primary safety gate');
  });
});
