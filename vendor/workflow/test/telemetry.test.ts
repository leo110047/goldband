import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const ROOT = path.resolve(import.meta.dir, '..');
const BIN = path.join(ROOT, 'bin');

// Each test gets a fresh temp directory for WORKFLOW_STATE_DIR
let tmpDir: string;

function run(cmd: string, env: Record<string, string> = {}): string {
  return execSync(cmd, {
    cwd: ROOT,
    env: { ...process.env, WORKFLOW_STATE_DIR: tmpDir, WORKFLOW_DIR: ROOT, ...env },
    encoding: 'utf-8',
    timeout: 10000,
  }).trim();
}

function readJsonl(): string[] {
  const file = path.join(tmpDir, 'analytics', 'skill-usage.jsonl');
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf-8').trim().split('\n').filter(Boolean);
}

function parseJsonl(): any[] {
  return readJsonl().map(line => JSON.parse(line));
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-tel-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('workflow-telemetry-log', () => {
  test('appends valid JSONL locally', () => {
    run(`${BIN}/workflow-telemetry-log --skill qa --duration 142 --outcome success --session-id test-123`);

    const events = parseJsonl();
    expect(events).toHaveLength(1);
    expect(events[0].v).toBe(1);
    expect(events[0].skill).toBe('qa');
    expect(events[0].duration_s).toBe(142);
    expect(events[0].outcome).toBe('success');
    expect(events[0].session_id).toBe('test-123');
    expect(events[0].event_type).toBe('skill_run');
    expect(events[0].os).toBeTruthy();
    expect(events[0].workflow_version).toBeTruthy();
  });

  test('does not include installation identifiers', () => {
    run(`${BIN}/workflow-telemetry-log --skill qa --duration 50 --outcome success --session-id anon-123`);

    const events = parseJsonl();
    expect(events[0]).not.toHaveProperty('installation_id');
  });

  test('includes error_class when provided', () => {
    run(`${BIN}/workflow-telemetry-log --skill browse --duration 10 --outcome error --error-class timeout --session-id err-123`);

    const events = parseJsonl();
    expect(events[0].error_class).toBe('timeout');
    expect(events[0].outcome).toBe('error');
  });

  test('handles missing duration gracefully', () => {
    run(`${BIN}/workflow-telemetry-log --skill qa --outcome success --session-id nodur-123`);

    const events = parseJsonl();
    expect(events[0].duration_s).toBeNull();
  });

  test('supports event_type flag', () => {
    run(`${BIN}/workflow-telemetry-log --event-type upgrade_prompted --skill "" --outcome success --session-id up-123`);

    const events = parseJsonl();
    expect(events[0].event_type).toBe('upgrade_prompted');
  });

  test('includes local-only fields (_repo_slug, _branch)', () => {
    run(`${BIN}/workflow-telemetry-log --skill qa --duration 50 --outcome success --session-id local-123`);

    const events = parseJsonl();
    // These should be present in local JSONL
    expect(events[0]).toHaveProperty('_repo_slug');
    expect(events[0]).toHaveProperty('_branch');
  });

  test('creates analytics directory if missing', () => {
    // Remove analytics dir
    const analyticsDir = path.join(tmpDir, 'analytics');
    if (fs.existsSync(analyticsDir)) fs.rmSync(analyticsDir, { recursive: true });

    run(`${BIN}/workflow-telemetry-log --skill qa --duration 50 --outcome success --session-id mkdir-123`);

    expect(fs.existsSync(analyticsDir)).toBe(true);
    expect(readJsonl()).toHaveLength(1);
  });
});

describe('.pending marker', () => {
  test('finalizes stale .pending from another session as outcome:unknown', () => {
    // Write a fake .pending marker from a different session
    const analyticsDir = path.join(tmpDir, 'analytics');
    fs.mkdirSync(analyticsDir, { recursive: true });
    fs.writeFileSync(
      path.join(analyticsDir, '.pending-old-123'),
      '{"skill":"old-skill","ts":"2026-03-18T00:00:00Z","session_id":"old-123","workflow_version":"0.6.4"}'
    );

    // Run telemetry-log with a DIFFERENT session — should finalize the old pending marker
    run(`${BIN}/workflow-telemetry-log --skill qa --duration 50 --outcome success --session-id new-456`);

    const events = parseJsonl();
    expect(events).toHaveLength(2);

    // First event: finalized pending
    expect(events[0].skill).toBe('old-skill');
    expect(events[0].outcome).toBe('unknown');
    expect(events[0].session_id).toBe('old-123');

    // Second event: new event
    expect(events[1].skill).toBe('qa');
    expect(events[1].outcome).toBe('success');
  });

  test('.pending-SESSION file is removed after finalization', () => {
    const analyticsDir = path.join(tmpDir, 'analytics');
    fs.mkdirSync(analyticsDir, { recursive: true });
    const pendingPath = path.join(analyticsDir, '.pending-stale-session');
    fs.writeFileSync(pendingPath, '{"skill":"stale","ts":"2026-03-18T00:00:00Z","session_id":"stale-session","workflow_version":"v"}');

    run(`${BIN}/workflow-telemetry-log --skill qa --duration 50 --outcome success --session-id new-456`);

    expect(fs.existsSync(pendingPath)).toBe(false);
  });

  test('does not finalize own session pending marker', () => {
    const analyticsDir = path.join(tmpDir, 'analytics');
    fs.mkdirSync(analyticsDir, { recursive: true });
    // Create pending for same session ID we'll use
    const pendingPath = path.join(analyticsDir, '.pending-same-session');
    fs.writeFileSync(pendingPath, '{"skill":"in-flight","ts":"2026-03-18T00:00:00Z","session_id":"same-session","workflow_version":"v"}');

    run(`${BIN}/workflow-telemetry-log --skill qa --duration 50 --outcome success --session-id same-session`);

    // Should only have 1 event (the new one), not finalize own pending
    const events = parseJsonl();
    expect(events).toHaveLength(1);
    expect(events[0].skill).toBe('qa');
  });

  test('clears own session pending marker and still records the event', () => {
    const analyticsDir = path.join(tmpDir, 'analytics');
    fs.mkdirSync(analyticsDir, { recursive: true });
    const pendingPath = path.join(analyticsDir, '.pending-off-123');
    fs.writeFileSync(pendingPath, '{"skill":"stale","ts":"2026-03-18T00:00:00Z","session_id":"off-123","workflow_version":"v"}');

    run(`${BIN}/workflow-telemetry-log --skill qa --duration 50 --outcome success --session-id off-123`);

    expect(fs.existsSync(pendingPath)).toBe(false);
    expect(readJsonl()).toHaveLength(1);
  });
});

describe('workflow-analytics', () => {
  test('shows "no data" for empty JSONL', () => {
    const output = run(`${BIN}/workflow-analytics`);
    expect(output).toContain('no data');
  });

  test('renders usage dashboard with events', () => {
    run(`${BIN}/workflow-telemetry-log --skill qa --duration 120 --outcome success --session-id a-1`);
    run(`${BIN}/workflow-telemetry-log --skill qa --duration 60 --outcome success --session-id a-2`);
    run(`${BIN}/workflow-telemetry-log --skill ship --duration 30 --outcome error --error-class timeout --session-id a-3`);

    const output = run(`${BIN}/workflow-analytics all`);
    expect(output).toContain('/qa');
    expect(output).toContain('/ship');
    expect(output).toContain('2 runs');
    expect(output).toContain('1 runs');
    expect(output).toContain('Success rate: 66%');
    expect(output).toContain('Errors: 1');
  });

  test('filters by time window', () => {
    run(`${BIN}/workflow-telemetry-log --skill qa --duration 60 --outcome success --session-id t-1`);

    const output7d = run(`${BIN}/workflow-analytics 7d`);
    expect(output7d).toContain('/qa');
    expect(output7d).toContain('last 7 days');
  });
});

describe('workflow-telemetry-sync', () => {
  test('is a no-op', () => {
    const result = run(`${BIN}/workflow-telemetry-sync`);
    expect(result).toBe('');
  });
});

describe('workflow-community-dashboard', () => {
  test('points users to local analytics', () => {
    const output = run(`${BIN}/workflow-community-dashboard`);
    expect(output).toContain('workflow community dashboard');
    expect(output).toContain('Community telemetry has been removed');
    expect(output).toContain('workflow-analytics');
  });
});
