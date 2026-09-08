#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const adapterGuidance = [
  'Before adding or expanding a permanent approval, permission, state, gate,',
  'artifact, lineage, coordination workflow, external side effect, or generic',
  'mechanism, choose the smallest sufficient solution that fully covers the',
  'current requirement, root-cause class, and required safety boundary; use a',
  'heavier mechanism only when current evidence names what the smaller option',
  'cannot cover.',
].join(' ');
const legacyHealthiestDefault =
  /healthiest option now|recommend the healthy path(?: by default)?/i;

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function normalize(value) {
  return value.replace(/\s+/g, ' ').trim();
}

function assertGuidance(file, expected = adapterGuidance) {
  assert.ok(
    normalize(fs.readFileSync(file, 'utf8')).includes(expected),
    `${file} is missing proportionality guidance`,
  );
}

function assertNoLegacyHealthiestDefault(content, label) {
  assert.doesNotMatch(
    normalize(content),
    legacyHealthiestDefault,
    `${label} must not restore the legacy healthiest-path default`,
  );
}

assert.throws(
  () =>
    assertNoLegacyHealthiestDefault(
      'Recommend the healthy path by default.',
      'regression fixture',
    ),
  /legacy healthiest-path default/,
  'the negative regression must detect the removed healthiest-path default',
);

// READMEs explain the optional workflow role in their own language. They do
// not need to repeat the internal English term "workflow runtime".
function assertReadmeGuidance(content, required, label) {
  const normalized = normalize(content);
  for (const text of required) {
    assert.ok(normalized.includes(text), `${label} is missing ${text}`);
  }
}

for (const [file, role] of [
  ['README.md', '選裝 Goldband Loop'],
  ['README.en.md', 'Optionally adds Goldband Loop'],
]) {
  const content = read(file);
  const required = [role, 'goldband-loop/', 'ARCHITECTURE.md'];
  assertReadmeGuidance(content, required, file);
  for (const removed of required) {
    assert.throws(
      () =>
        assertReadmeGuidance(content.replaceAll(removed, ''), required, file),
      { name: 'AssertionError' },
      `${file} must reject removal of ${removed}`,
    );
  }
}
console.log(
  '[OK] localized README guidance and missing-content regressions passed',
);

const manifest = JSON.parse(read('goldband.manifest.json'));
const changeScope = manifest.policies.find(
  (policy) => policy.id === 'change-scope',
);
assert.ok(changeScope, 'change-scope policy is missing');
assert.deepEqual(
  changeScope.phases,
  ['plan', 'implementation', 'review'],
  'change-scope phases must express plan, implementation, and review applicability',
);

const generatedManifest = JSON.parse(read('rules/manifest.json'));
const generatedChangeScope = generatedManifest.rules.find(
  (policy) => policy.id === 'change-scope',
);
assert.deepEqual(
  generatedChangeScope?.phases,
  changeScope.phases,
  'generated Rules manifest must preserve change-scope applicability',
);

for (const relativePath of ['codex/AGENTS.md', 'claude/CLAUDE.md']) {
  const content = read(relativePath);
  assert.ok(
    normalize(content).includes(adapterGuidance),
    `${relativePath} is missing the shared concise adapter guidance`,
  );
  assertNoLegacyHealthiestDefault(content, relativePath);
}

for (const relativePath of [
  'rules/change-scope.md',
  'commands/plan.md',
  'plugin-assets/claude-code-plugin/rules/change-scope.md',
  'plugin-assets/claude-code-plugin/commands/plan.md',
  'goldband-loop/generated/workflow-contracts/plan/create.workflow.md',
  'goldband-loop/generated/workflow-contracts/plan/sync.workflow.md',
]) {
  assertNoLegacyHealthiestDefault(read(relativePath), relativePath);
}

for (const relativePath of [
  'skills/global/planning-workflow/SKILL.md',
  'skills/global/implementation-contracts/SKILL.md',
]) {
  const content = normalize(read(relativePath));
  assert.match(
    content,
    /smallest sufficient/i,
    `${relativePath} must name smallest sufficient`,
  );
  assert.match(
    content,
    /current evidence/i,
    `${relativePath} must require current evidence`,
  );
}

const tempHome = fs.mkdtempSync(
  path.join(os.tmpdir(), 'goldband-change-scope-guidance.'),
);
try {
  const install = spawnSync(
    './install.sh',
    ['claude-guidance', 'skills-full', 'codex-agents', 'codex-skills'],
    {
      cwd: root,
      env: {
        ...process.env,
        HOME: tempHome,
        CODEX_REQUIREMENTS_FILE: path.join(
          tempHome,
          'etc',
          'codex',
          'requirements.toml',
        ),
      },
      encoding: 'utf8',
    },
  );
  assert.equal(install.status, 0, install.stderr || install.stdout);

  assertGuidance(path.join(tempHome, '.claude', 'CLAUDE.md'));
  assertGuidance(path.join(tempHome, '.codex', 'AGENTS.md'));
  assertNoLegacyHealthiestDefault(
    fs.readFileSync(path.join(tempHome, '.claude', 'CLAUDE.md'), 'utf8'),
    'installed Claude adapter',
  );
  assertNoLegacyHealthiestDefault(
    fs.readFileSync(path.join(tempHome, '.codex', 'AGENTS.md'), 'utf8'),
    'installed Codex adapter',
  );
  for (const skill of ['planning-workflow', 'implementation-contracts']) {
    for (const skillRoot of [
      path.join(tempHome, '.claude', 'skills'),
      path.join(tempHome, '.agents', 'skills'),
    ]) {
      const installedSkill = path.join(skillRoot, skill, 'SKILL.md');
      const content = normalize(fs.readFileSync(installedSkill, 'utf8'));
      assert.match(content, /smallest sufficient/i);
      assert.match(content, /current evidence/i);
      assertNoLegacyHealthiestDefault(content, installedSkill);
    }
  }
} finally {
  fs.rmSync(tempHome, { recursive: true, force: true });
}

console.log('[OK] change-scope planning and implementation guidance passed');
