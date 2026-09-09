#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateCapabilityInvocations } from './lib/capability-invocations.mjs';

const capabilities = [
  {
    id: 'review',
    actions: [{ id: 'code' }],
  },
];

withFixture('$goldband review code\n', (root) => {
  assert.doesNotThrow(() => validate(root, ['docs']));
});

withFixture('$goldband review missing\n', (root) => {
  assert.throws(
    () => validate(root, ['docs']),
    /invalid Goldband capability invocation/,
  );
});

for (const retired of [
  'Goldband cso workflow',
  'Goldband skillify workflow',
  'Goldband plan-eng-review workflow',
  '/craft',
  '/why',
  '/next',
]) {
  withFixture(retired, (root) => {
    assert.throws(() => validate(root, ['docs']), /retired guidance/);
  });
}

withFixture('$goldband review code\n', (root) => {
  assert.throws(
    () => validate(root, ['docs', 'missing.md']),
    /missing Goldband capability invocation root: missing\.md/,
  );
});

console.log('[OK] capability invocation validation verified');

function validate(root, invocationRoots) {
  validateCapabilityInvocations({ root, invocationRoots, capabilities });
}

function withFixture(content, test) {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'capability-invocations-'),
  );
  try {
    const docs = path.join(root, 'docs');
    fs.mkdirSync(docs);
    fs.writeFileSync(path.join(docs, 'invocations.md'), content, 'utf8');
    test(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}
