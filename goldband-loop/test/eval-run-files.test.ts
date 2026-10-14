import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { findPreviousRun, listEvalRunFiles } from './helpers/eval-store';

const SCRIPTS = path.join(import.meta.dir, '..', 'scripts');

// cwd without a repo-local goldband install keeps the legacy eval dir.
function runScript(home: string, script: string, timeout?: number) {
  return spawnSync('bun', ['run', path.join(SCRIPTS, script)], {
    cwd: home,
    env: { ...process.env, HOME: home },
    encoding: 'utf8',
    timeout,
  });
}

function evalRun(timestamp: string, extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    schema_version: 1,
    version: '0.0.0',
    branch: 'main',
    git_sha: 'abc1234',
    timestamp,
    hostname: 'test',
    tier: 'e2e',
    total_tests: 0,
    passed: 0,
    failed: 0,
    total_cost_usd: 1,
    total_duration_ms: 0,
    tests: [],
    ...extra,
  });
}

// An in-progress `_partial-*` snapshot duplicates the run it belongs to.
describe('eval run files', () => {
  function withEvalDir(run: (home: string, evalDir: string) => void) {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-runs-'));
    const evalDir = path.join(home, '.goldband-dev', 'evals');
    fs.mkdirSync(evalDir, { recursive: true });
    try {
      run(home, evalDir);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  }

  test('a partial snapshot is not a run or a previous run', () => {
    withEvalDir((_home, evalDir) => {
      fs.writeFileSync(path.join(evalDir, 'old.json'), evalRun('2026-10-13T00:00:00.000Z'));
      fs.writeFileSync(
        path.join(evalDir, '_partial-e2e.json'),
        evalRun('2026-10-14T00:00:00.000Z', { _partial: true }),
      );
      fs.writeFileSync(path.join(evalDir, 'new.json'), evalRun('2026-10-14T00:01:00.000Z'));
      expect(listEvalRunFiles(evalDir).sort()).toEqual(['new.json', 'old.json']);
      expect(findPreviousRun(evalDir, 'e2e', 'main', 'new.json')).toBe(
        path.join(evalDir, 'old.json'),
      );
    });
  });

  function writeRuns(evalDir: string) {
    // Final runs are named so that filename order is time order.
    fs.writeFileSync(
      path.join(evalDir, '0.0.0-main-e2e-20261013-000000.json'),
      evalRun('2026-10-13T00:00:00.000Z'),
    );
    fs.writeFileSync(
      path.join(evalDir, '0.0.0-main-e2e-20261014-000000.json'),
      evalRun('2026-10-14T00:00:00.000Z'),
    );
    fs.writeFileSync(
      path.join(evalDir, '_partial-e2e.json'),
      evalRun('2026-10-14T00:05:00.000Z', { _partial: true }),
    );
  }

  test('eval-summary and eval-list count only final runs', () => {
    withEvalDir((home, evalDir) => {
      writeRuns(evalDir);
      const summary = runScript(home, 'eval-summary.ts');
      expect(summary.status).toBe(0);
      expect(summary.stdout).toContain('Total runs:        2 (2 e2e');
      const list = runScript(home, 'eval-list.ts');
      expect(list.status).toBe(0);
      expect(list.stdout).toContain('Eval History (2 total runs)');
    });
  });

  test('eval-compare compares the two newest final runs', () => {
    withEvalDir((home, evalDir) => {
      writeRuns(evalDir);
      const compare = runScript(home, 'eval-compare.ts');
      expect(compare.status).toBe(0);
      expect(compare.stdout).toContain('(2026-10-13 00:00)');
    });
  });

  test('eval-watch reads the partial snapshot and run logs from the project dir', () => {
    withEvalDir((home) => {
      const slug = path.join(home, '.claude', 'skills', 'goldband', 'bin', 'goldband-slug');
      fs.mkdirSync(path.dirname(slug), { recursive: true });
      fs.writeFileSync(slug, '#!/bin/sh\necho SLUG=watch-test\n', { mode: 0o755 });
      const projectDir = path.join(home, '.goldband', 'projects', 'watch-test');
      // The watcher redraws until stopped; its first frame names the paths.
      const idle = runScript(home, 'eval-watch.ts', 3000);
      expect(idle.stdout).toContain(
        `Partial:   ${path.join(projectDir, 'evals', '_partial-e2e.json')}`,
      );
      // The heartbeat stays global; a live run names its project run log.
      const now = new Date().toISOString();
      fs.writeFileSync(
        path.join(home, '.goldband-dev', 'e2e-live.json'),
        JSON.stringify({
          runId: 'run-1',
          pid: process.pid,
          startedAt: now,
          currentTest: 'test',
          status: 'running',
          turn: 1,
          toolCount: 1,
          lastTool: 'Read',
          lastToolAt: now,
          elapsedSec: 1,
        }),
      );
      const live = runScript(home, 'eval-watch.ts', 3000);
      expect(live.stdout).toContain(
        `Logs: ${path.join(projectDir, 'e2e-runs', 'run-1', 'progress.log')}`,
      );
    });
  }, 15000);
});
