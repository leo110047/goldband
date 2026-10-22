#!/usr/bin/env node

import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const ROOT_DIR = path.resolve(path.dirname(__filename), '..');
const FIXTURES_PATH = path.join(
  ROOT_DIR,
  'hooks',
  'fixtures',
  'router',
  'replay-fixtures.json',
);
const PRETOOL_POLICY_PATH = path.join(
  ROOT_DIR,
  'hooks',
  'scripts',
  'lib',
  'hook-router',
  'pretool-policy.js',
);

const {
  SECRET_PATTERNS,
} = require('../hooks/scripts/lib/hook-router/secret-patterns');
const {
  CAREFUL_MODE_GUARDS,
} = require('../hooks/scripts/lib/hook-router/careful-mode-rules');
const {
  FREEZE_MODE_PROTECTIONS,
} = require('../hooks/scripts/lib/hook-router/freeze-mode-rules');
const {
  PRETOOL_DENY_POLICIES,
} = require('../hooks/scripts/lib/hook-router/pretool-policy');
const {
  GATE_A_RULES,
} = require('../hooks/scripts/lib/hook-router/gate-bypass-rules');
const {
  PROTECTED_SURFACES,
} = require('../hooks/scripts/lib/hook-router/protected-surfaces');

const REQUIRED_FIELDS = [
  'category',
  'policy',
  'expectedDecision',
  'variant',
  'regressionSource',
];
const VALID_DECISIONS = new Set(['allow', 'block']);
const VALID_VARIANTS = new Set(['positive', 'negative']);
const NON_PRETOOL_DENY_BLOCKERS = new Set([
  'careful-mode',
  'freeze-mode',
  'secret-detector',
]);

function main() {
  const fixtures = readFixtures();
  const failures = [
    ...validateFixtureShape(fixtures),
    ...validateCoverageMatrix(fixtures),
    ...validatePretoolPolicyMetadata(),
    ...validateSecretAdvisoryAssertions(fixtures),
    ...validateGateAssertions(fixtures),
    ...validateCarefulModeDescription(),
  ];

  if (failures.length > 0) {
    console.error('Hook router coverage check failed:');
    for (const failure of failures) {
      console.error(`  - ${failure}`);
    }
    process.exit(1);
  }

  const summary = summarize(fixtures);
  console.log('Hook router coverage check passed');
  console.log(`  fixtures: ${fixtures.length}`);
  for (const [category, count] of summary) {
    console.log(`  ${category}: ${count}`);
  }
}

// The careful-mode skill description is what users see when choosing the
// mode, so it must name every guard the hook enforces.
function validateCarefulModeDescription() {
  const skill = fs.readFileSync(
    path.join(ROOT_DIR, 'skills/global/careful-mode/SKILL.md'),
    'utf8',
  );
  const description = skill.split(/^allowed-tools:/m)[0].replace(/\s+/g, ' ');
  return CAREFUL_MODE_GUARDS.filter(
    (guard) => !guard.summary || !description.includes(guard.summary),
  ).map(
    (guard) =>
      `careful-mode description does not name guard ${guard.rule} (${guard.summary || 'no summary'})`,
  );
}

function readFixtures() {
  const parsed = JSON.parse(fs.readFileSync(FIXTURES_PATH, 'utf8'));
  if (!Array.isArray(parsed)) {
    throw new Error('Router replay fixtures must be a JSON array');
  }
  return parsed;
}

function validateFixtureShape(fixtures) {
  const failures = [];
  const seenIds = new Set();

  for (const fixture of fixtures) {
    const itemFailures = validateFixtureEntry(fixture, seenIds);
    failures.push(...itemFailures);
  }

  return failures;
}

function validateFixtureEntry(fixture, seenIds) {
  if (!fixture || typeof fixture !== 'object') {
    return ['fixture entry must be an object'];
  }

  const failures = [];
  const id = fixture.id || '<missing id>';
  failures.push(...validateFixtureId(fixture, seenIds));

  const coverage = fixture.coverage;
  if (!coverage || typeof coverage !== 'object') {
    failures.push(`${id}: missing coverage metadata`);
    return failures;
  }

  failures.push(...validateCoverageFields(id, coverage));
  failures.push(...validateDecisionParity(id, fixture, coverage));
  return failures;
}

function validateFixtureId(fixture, seenIds) {
  if (!fixture.id || typeof fixture.id !== 'string') {
    return ['fixture is missing string id'];
  }

  if (seenIds.has(fixture.id)) {
    return [`duplicate fixture id: ${fixture.id}`];
  }

  seenIds.add(fixture.id);
  return [];
}

function validateCoverageFields(id, coverage) {
  const failures = [];

  for (const field of REQUIRED_FIELDS) {
    if (!coverage[field] || typeof coverage[field] !== 'string') {
      failures.push(`${id}: coverage.${field} must be a non-empty string`);
    }
  }

  if (!VALID_DECISIONS.has(coverage.expectedDecision)) {
    failures.push(`${id}: coverage.expectedDecision must be allow or block`);
  }

  if (!VALID_VARIANTS.has(coverage.variant)) {
    failures.push(`${id}: coverage.variant must be positive or negative`);
  }

  return failures;
}

function validateDecisionParity(id, fixture, coverage) {
  const replayExpectedDecision = expectedDecisionFor(fixture.expect || {});
  if (coverage.expectedDecision === replayExpectedDecision) {
    return [];
  }

  return [
    `${id}: coverage.expectedDecision=${coverage.expectedDecision} does not match replay expectation=${replayExpectedDecision}`,
  ];
}

function validateCoverageMatrix(fixtures) {
  const failures = [];
  const index = buildCoverageIndex(fixtures);

  for (const item of expectedCoverage()) {
    if (!hasCoverage(index, item)) {
      failures.push(
        `missing ${item.category}/${item.policy}/${item.variant}/${item.expectedDecision}`,
      );
    }
  }

  return failures;
}

function validatePretoolPolicyMetadata() {
  const failures = [];
  const source = fs.readFileSync(PRETOOL_POLICY_PATH, 'utf8');
  const actualBlockers = new Set();
  const blockedByPattern = /blockedBy:\s*['"]([^'"]+)['"]/g;

  for (const match of source.matchAll(blockedByPattern)) {
    const blocker = match[1];
    if (!NON_PRETOOL_DENY_BLOCKERS.has(blocker)) {
      actualBlockers.add(blocker);
    }
  }

  const expectedBlockers = new Set(
    PRETOOL_DENY_POLICIES.map((policy) => policy.name),
  );

  for (const blocker of actualBlockers) {
    if (!expectedBlockers.has(blocker)) {
      failures.push(
        `pretool-policy blockedBy=${blocker} is missing from PRETOOL_DENY_POLICIES`,
      );
    }
  }

  for (const blocker of expectedBlockers) {
    if (!actualBlockers.has(blocker)) {
      failures.push(
        `PRETOOL_DENY_POLICIES includes ${blocker}, but pretool-policy never emits blockedBy=${blocker}`,
      );
    }
  }

  return failures;
}

function validateSecretAdvisoryAssertions(fixtures) {
  const failures = [];

  for (const pattern of SECRET_PATTERNS) {
    if (pattern.severity === 'high') continue;

    const fixture = fixtures.find(
      (item) =>
        item.coverage?.category === 'secret-patterns' &&
        item.coverage?.policy === pattern.name &&
        item.coverage?.variant === 'positive',
    );
    const stderrIncludes = fixture?.expect?.stderrIncludes || [];
    if (!stderrIncludes.includes('WARNING')) {
      failures.push(
        `${fixture?.id || pattern.name}: warn-level secret positive case must assert WARNING advisory output`,
      );
    }
    if (!stderrIncludes.includes(pattern.name)) {
      failures.push(
        `${fixture?.id || pattern.name}: warn-level secret positive case must assert advisory pattern name`,
      );
    }
  }

  return failures;
}

// Gate G asks are exit-0 outcomes, so the replay decision alone cannot tell
// an ask from silence: positives assert the ask and negatives exclude it.
function validateGateAssertions(fixtures) {
  const failures = [];
  for (const fixture of fixtures) {
    const { category, variant } = fixture.coverage || {};
    if (!['gate-a', 'gate-g'].includes(category)) continue;
    const expect = fixture.expect || {};
    if (
      variant === 'negative' &&
      !includesFragment(expect.stdoutExcludes, 'permissionDecision')
    ) {
      failures.push(
        `${fixture.id}: ${category} negative case must exclude permissionDecision output`,
      );
    }
    if (
      category === 'gate-g' &&
      variant === 'positive' &&
      !includesFragment(expect.stdoutIncludes, '"permissionDecision":"ask"')
    ) {
      failures.push(
        `${fixture.id}: gate-g positive case must assert the ask response`,
      );
    }
  }
  return failures;
}

function includesFragment(list, fragment) {
  return Array.isArray(list) && list.includes(fragment);
}

function gateCoverage() {
  const items = [];
  for (const { rule } of GATE_A_RULES) {
    items.push(
      {
        category: 'gate-a',
        policy: rule,
        variant: 'positive',
        expectedDecision: 'block',
      },
      {
        category: 'gate-a',
        policy: rule,
        variant: 'negative',
        expectedDecision: 'allow',
      },
    );
  }
  for (const surface of PROTECTED_SURFACES.filter(
    (item) => item.gate !== 'A',
  )) {
    for (const variant of ['positive', 'negative']) {
      items.push({
        category: 'gate-g',
        policy: surface.id,
        variant,
        expectedDecision: 'allow',
      });
    }
  }
  return items;
}

function buildCoverageIndex(fixtures) {
  const index = new Set();
  for (const fixture of fixtures) {
    const coverage = fixture.coverage || {};
    if (
      coverage.category &&
      coverage.policy &&
      coverage.variant &&
      coverage.expectedDecision
    ) {
      index.add(coverageKey(coverage));
    }
  }
  return index;
}

function expectedCoverage() {
  const items = [];

  for (const pattern of SECRET_PATTERNS) {
    items.push({
      category: 'secret-patterns',
      policy: pattern.name,
      variant: 'positive',
      expectedDecision: pattern.severity === 'high' ? 'block' : 'allow',
    });
    items.push({
      category: 'secret-patterns',
      policy: pattern.name,
      variant: 'negative',
      expectedDecision: 'allow',
    });
  }

  for (const policy of PRETOOL_DENY_POLICIES) {
    items.push({
      category: 'pretool-policy',
      policy: policy.name,
      variant: 'positive',
      expectedDecision: 'block',
    });
    items.push({
      category: 'pretool-policy',
      policy: policy.name,
      variant: 'negative',
      expectedDecision: 'allow',
    });
  }

  for (const guard of CAREFUL_MODE_GUARDS) {
    items.push({
      category: 'careful-mode',
      policy: guard.rule,
      variant: 'positive',
      expectedDecision: 'block',
    });
    items.push({
      category: 'careful-mode',
      policy: guard.rule,
      variant: 'negative',
      expectedDecision: 'allow',
    });
  }

  for (const protection of FREEZE_MODE_PROTECTIONS) {
    items.push({
      category: 'freeze-mode',
      policy: protection.rule,
      variant: 'positive',
      expectedDecision: 'block',
    });
    items.push({
      category: 'freeze-mode',
      policy: protection.rule,
      variant: 'negative',
      expectedDecision: 'allow',
    });
  }

  return [...items, ...gateCoverage()];
}

function hasCoverage(index, item) {
  return index.has(coverageKey(item));
}

function coverageKey(item) {
  return [item.category, item.policy, item.variant, item.expectedDecision].join(
    '\u0000',
  );
}

function expectedDecisionFor(expect) {
  if (expect.decision) {
    return expect.decision;
  }
  return expect.exitCode === 2 ? 'block' : 'allow';
}

function summarize(fixtures) {
  const counts = new Map();
  for (const fixture of fixtures) {
    const category = fixture.coverage?.category || '<missing>';
    counts.set(category, (counts.get(category) || 0) + 1);
  }
  return [...counts.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  );
}

main();
