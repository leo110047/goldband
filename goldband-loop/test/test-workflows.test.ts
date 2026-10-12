import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { WORKFLOW_TESTS, workflowTestsForPlatform } from '../scripts/test-workflows';

test('workflow tests include portable semantic review without retired evidence suites', () => {
  const files = workflowTestsForPlatform();
  expect(files).toEqual([...WORKFLOW_TESTS]);
  for (const file of files) expect(existsSync(resolve(import.meta.dir, '..', file))).toBe(true);
  expect(files).toContain('test/review-semantic.test.ts');
  expect(files).toContain('test/codex-review-launcher-install.test.ts');
  expect(files.some(file => /review-(evidence|lineage|contract)/.test(file))).toBe(false);
});
