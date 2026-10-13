import { describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(import.meta.dir, '..');

describe('shipped skill safety contracts', () => {
  test('skill surfaces do not contain maintainer-private paths', () => {
    const forbidden = [
      /coordination-board\.md/i,
      /SEEKING_LOG\.md/,
      /RATIONAL_SUBJECT\.md/,
      /VALUE_SIGNAL_LOOP\.md/,
      /C:\\\\LLM Playground\\\\go/i,
    ];
    const leaks: string[] = [];

    for (const filePath of discoverSkillSurface(ROOT)) {
      const content = fs.readFileSync(filePath, 'utf8');
      if (forbidden.some((pattern) => pattern.test(content))) {
        leaks.push(path.relative(ROOT, filePath));
      }
    }

    expect(leaks).toEqual([]);
  });

  test('goldband-slug emits shell-safe project identity', () => {
    const binary = path.join(ROOT, 'bin', 'goldband-slug');
    const result = Bun.spawnSync([binary], {
      cwd: ROOT,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    expect(result.exitCode).toBe(0);
    const values = Object.fromEntries(
      result.stdout
        .toString()
        .trim()
        .split('\n')
        .map((line) => line.split('=', 2)),
    );
    expect(values.SLUG).toMatch(/^[a-zA-Z0-9._-]+$/);
    expect(values.BRANCH).toMatch(/^[a-zA-Z0-9._-]+$/);
  });
});

describe('eval fixture contracts', () => {
  for (const fixture of [
    'qa-eval-ground-truth.json',
    'qa-eval-spa-ground-truth.json',
    'qa-eval-checkout-ground-truth.json',
  ]) {
    test(`${fixture} has internally consistent bug counts`, () => {
      const value = JSON.parse(
        fs.readFileSync(path.join(ROOT, 'test', 'fixtures', fixture), 'utf8'),
      );
      expect(value.bugs.length).toBeGreaterThan(0);
      expect(value.total_bugs).toBe(value.bugs.length);
    });
  }
});

function discoverSkillSurface(root: string): string[] {
  const results: string[] = [];
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) continue;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      if (entry.name.startsWith('.') && entry.name !== '.agents') continue;
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(target);
      if (
        entry.isFile() &&
        (entry.name === 'SKILL.md' || entry.name === 'SKILL.md.tmpl')
      ) {
        results.push(target);
      }
    }
  }
  return results;
}
