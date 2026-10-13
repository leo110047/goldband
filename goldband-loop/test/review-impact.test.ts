import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getWorkflow } from '../workflows/registry';
import {
  collectReviewImpactContext,
  formatReviewImpactContext,
  reviewInputSchema,
  WIDE_IMPACT_FILE_THRESHOLD,
} from '../workflows/review-impact';
import type { ReviewImpactContext } from '../workflows/review-impact';
import { createReviewTimeBudget } from '../workflows/review-timeouts';
import type { WorkflowContext } from '../workflows/types';

describe('review impact graph', () => {
  test('skips repository indexing for a single changed file', () => {
    withRepository(({ repo, goldbandHome }) => {
      writeTracked(repo, 'src/only.ts', 'export const only = true;\n');

      const result = collectReviewImpactContext(
        workflowContext(repo, goldbandHome, 'single-file'),
        { source: 'fixture', diff: '+single file', changedFiles: ['src/only.ts'] },
        createReviewTimeBudget({}),
      );

      expect(result.impact).toMatchObject({
        status: 'skipped',
        reason: 'single-file',
        changedFiles: ['src/only.ts'],
        indexedFiles: 0,
        parsedFiles: 0,
        reusedFiles: 0,
      });
      expect(existsSync(join(goldbandHome, 'review-impact'))).toBe(false);
      expect(existsSync(join(
        goldbandHome,
        'workflow-runs',
        'artifacts',
        'single-file-review-impact.json',
      ))).toBe(true);
    });
  });

  test('finds reverse dependencies and observed tests for multi-file changes', () => {
    withRepository(({ repo, goldbandHome }) => {
      writeTracked(repo, 'src/core.ts', 'export const core = true;\n');
      writeTracked(repo, 'src/consumer.ts', "import { core } from './core';\nexport const consumer = core;\n");
      writeTracked(repo, 'tests/consumer.test.ts', "import { consumer } from '../src/consumer';\nvoid consumer;\n");
      writeTracked(repo, 'src/other.ts', 'export const other = true;\n');

      const first = collectReviewImpactContext(
        workflowContext(repo, goldbandHome, 'first-pass'),
        {
          source: 'fixture',
          diff: '+core\n+other',
          changedFiles: ['src/core.ts', 'src/other.ts'],
        },
        createReviewTimeBudget({}),
      );

      expect(first.impact.status).toBe('analyzed');
      expect(first.impact.parsedFiles).toBe(4);
      expect(first.impact.impactedFiles).toEqual([
        {
          file: 'src/consumer.ts',
          distance: 1,
          changedFiles: ['src/core.ts'],
          test: false,
        },
        {
          file: 'tests/consumer.test.ts',
          distance: 2,
          changedFiles: ['src/core.ts'],
          test: true,
        },
      ]);
      expect(first.impact.observedTestFiles).toEqual(['tests/consumer.test.ts']);
      expect(first.impact.filesWithoutObservedTests).toEqual(['src/other.ts']);
      expect(formatReviewImpactContext(first.impact))
        .toContain('"filesWithoutObservedTests":["src/other.ts"]');

      const second = collectReviewImpactContext(
        workflowContext(repo, goldbandHome, 'second-pass'),
        {
          source: 'fixture',
          diff: '+core\n+other',
          changedFiles: ['src/core.ts', 'src/other.ts'],
        },
        createReviewTimeBudget({}),
      );

      expect(second.impact.parsedFiles).toBe(0);
      expect(second.impact.reusedFiles).toBe(4);
      expect(second.impact.observedTestFiles).toEqual(['tests/consumer.test.ts']);
      expect(existsSync(join(goldbandHome, 'review-impact'))).toBe(true);
    });
  });

  test('skips a source file that changes while the index reads it', () => {
    withRepository(({ repo, goldbandHome }) => {
      writeTracked(repo, 'src/core.ts', 'export const core = true;\n');
      writeTracked(repo, 'src/other.ts', 'export const other = true;\n');
      writeTracked(repo, 'src/consumer.ts', "import { core } from './core';\nexport const consumer = core;\n");
      const changing = join(repo, 'src', 'changing.ts');
      writeTracked(
        repo,
        'src/changing.ts',
        `import { core } from './core';\n${'// padding\n'.repeat(15_000)}`,
      );
      const budget = createReviewTimeBudget({});
      const timeBudget = {
        ...budget,
        assertWithinDeadline: () => {
          // Every deadline checkpoint, including those inside a file read,
          // grows the file after the index validated its metadata.
          appendFileSync(changing, '// grown\n');
          budget.assertWithinDeadline();
        },
      };

      const result = collectReviewImpactContext(
        workflowContext(repo, goldbandHome, 'changing-source'),
        { source: 'fixture', diff: '+core\n+other', changedFiles: ['src/core.ts', 'src/other.ts'] },
        timeBudget,
      );

      expect(result.impact.diagnostics.some((line) =>
        line.startsWith('source file changed or was unreadable: src/changing.ts'))).toBe(true);
      expect(result.impact.impactedFiles.map((item) => item.file)).toEqual(['src/consumer.ts']);
    });
  });

  test('labels graph output as hints and preserves diagnostic text in validation', () => {
    const impact = impactFixture({
      diagnostics: ['source file changed or was unreadable: ../literal message'],
    });
    const validated = reviewInputSchema.validate({
      source: 'fixture',
      diff: '+change',
      changedFiles: ['src/a.ts', 'src/b.ts'],
      impact,
    });

    expect(validated.impact.diagnostics).toEqual(impact.diagnostics);
    const formatted = formatReviewImpactContext(validated.impact);
    expect(formatted).toContain('structural hints only');
    expect(formatted).toContain('not proof of a defect');
    expect(formatted).toContain('permission to omit any diff path');
  });

  test('keeps wide graph impact visible to the core reviewer', () => {
    const impactedFiles = Array.from({ length: WIDE_IMPACT_FILE_THRESHOLD }, (_, index) => ({
      file: `src/dependent-${index}.ts`,
      distance: 1,
      changedFiles: ['src/a.ts'],
      test: false,
    }));
    const formatted = formatReviewImpactContext(impactFixture({ impactedFiles }));
    expect(formatted).toContain(`src/dependent-${WIDE_IMPACT_FILE_THRESHOLD - 1}.ts`);
  });

  test('bounds prompt graph bytes and rejects paths outside the repository', () => {
    const longSegment = 'x'.repeat(500);
    const impactedFiles = Array.from({ length: 80 }, (_, index) => ({
      file: `src/${index}-${longSegment}.ts`,
      distance: 1,
      changedFiles: [`src/${longSegment}.ts`],
      test: false,
    }));
    const formatted = formatReviewImpactContext(impactFixture({ impactedFiles }));

    expect(Buffer.byteLength(formatted)).toBeLessThan(9 * 1024);
    expect(formatted).toContain('"bounded":true');
    expect(() => reviewInputSchema.validate({
      source: 'fixture',
      diff: '+change',
      changedFiles: ['src/a.ts', 'src/b.ts'],
      impact: impactFixture({
        impactedFiles: [{
          file: '../outside.ts',
          distance: 1,
          changedFiles: ['src/a.ts'],
          test: false,
        }],
      }),
    })).toThrow('must remain inside the repository');
  });

  test('degrades explicitly when a file exceeds the dependency edge bound', () => {
    withRepository(({ repo, goldbandHome }) => {
      const imports = Array.from(
        { length: 129 },
        (_, index) => `import './dependency-${index}';`,
      ).join('\n');
      writeTracked(repo, 'src/many-imports.ts', `${imports}\n`);
      writeTracked(repo, 'src/other.ts', 'export const other = true;\n');

      const result = collectReviewImpactContext(
        workflowContext(repo, goldbandHome, 'bounded-edges'),
        {
          source: 'fixture',
          diff: '+many imports\n+other',
          changedFiles: ['src/many-imports.ts', 'src/other.ts'],
        },
        createReviewTimeBudget({}),
      );

      expect(result.impact.status).toBe('degraded');
      expect(result.impact.diagnostics).toContain(
        'dependency extraction truncated: src/many-imports.ts',
      );
    });
  });

  test('ignores a corrupt persistent cache with explicit degraded evidence', () => {
    withRepository(({ repo, goldbandHome }) => {
      writeTracked(repo, 'src/a.ts', 'export const a = true;\n');
      writeTracked(repo, 'src/b.ts', "import { a } from './a';\nvoid a;\n");
      const input = {
        source: 'fixture',
        diff: '+a\n+b',
        changedFiles: ['src/a.ts', 'src/b.ts'],
      };
      collectReviewImpactContext(
        workflowContext(repo, goldbandHome, 'cache-primer'),
        input,
        createReviewTimeBudget({}),
      );
      const cacheDirectory = join(goldbandHome, 'review-impact');
      const cacheFile = join(cacheDirectory, readdirSync(cacheDirectory)[0] as string);
      writeFileSync(cacheFile, '{not-json}\n');

      const result = collectReviewImpactContext(
        workflowContext(repo, goldbandHome, 'corrupt-cache'),
        input,
        createReviewTimeBudget({}),
      );

      expect(result.impact.status).toBe('degraded');
      expect(result.impact.parsedFiles).toBe(2);
      expect(result.impact.diagnostics[0]).toStartWith('impact cache ignored:');
    });
  });
});

function withRepository(run: (fixture: { repo: string; goldbandHome: string }) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'goldband-review-impact-'));
  const repo = join(root, 'repo');
  const goldbandHome = join(root, 'state');
  mkdirSync(repo);
  const initialized = spawnSync('git', ['init', '--quiet'], { cwd: repo, encoding: 'utf8' });
  if (initialized.status !== 0) throw new Error(initialized.stderr || 'git init failed');
  try {
    run({ repo, goldbandHome });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function writeTracked(repo: string, relativePath: string, content: string): void {
  const file = join(repo, relativePath);
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, content);
  const added = spawnSync('git', ['add', '--', relativePath], { cwd: repo, encoding: 'utf8' });
  if (added.status !== 0) throw new Error(added.stderr || `git add failed for ${relativePath}`);
}

function workflowContext(
  cwd: string,
  goldbandHome: string,
  runId: string,
): WorkflowContext {
  return {
    runId,
    workflow: getWorkflow('review/code'),
    cwd,
    options: { goldbandHome },
    artifacts: [],
  };
}

function impactFixture(overrides: Partial<ReviewImpactContext> = {}): ReviewImpactContext {
  return {
    status: 'analyzed',
    changedFiles: ['src/a.ts', 'src/b.ts'],
    indexedFiles: 2,
    parsedFiles: 2,
    reusedFiles: 0,
    dependencyEdges: 0,
    directDependencies: [],
    impactedFiles: [],
    observedTestFiles: [],
    filesWithoutObservedTests: [],
    truncated: false,
    diagnostics: [],
    ...overrides,
  };
}
