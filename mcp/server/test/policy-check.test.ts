import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runPolicyCheck } from '../src/policy-check.js';

test('policy_check allows foreground dev servers under shared guidance', () => {
  const result = runPolicyCheck({ command: 'npm run dev' });

  assert.equal(result.structuredContent.outcome, 'allow');
  assert.deepEqual(result.structuredContent.matchedRules, []);
  assert.equal(result.structuredContent.executed, false);
});

test('policy_check allows task documentation regardless of filename', () => {
  const result = runPolicyCheck({
    command: '',
    toolName: 'Write',
    filePath: 'notes/random.md',
    content: '# random',
  });

  assert.equal(result.structuredContent.outcome, 'allow');
  assert.deepEqual(result.structuredContent.matchedRules, []);
});

test('policy_check retains secret protection in documentation and fixtures', () => {
  const result = runPolicyCheck({
    command: '',
    toolName: 'Write',
    filePath: 'fixtures/notes.md',
    content: 'sk_live_' + 'x'.repeat(24),
  });
  assert.equal(result.structuredContent.outcome, 'block');
  assert.deepEqual(result.structuredContent.matchedRules, ['secret-detector']);
  assert.equal(result.structuredContent.executed, false);
});
