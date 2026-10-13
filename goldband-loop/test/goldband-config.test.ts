/**
 * Tests for bin/goldband-config bash script.
 *
 * Uses Bun.spawnSync to invoke the script with temp dirs and
 * GOLDBAND_STATE_DIR env override for full isolation.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const SCRIPT = join(import.meta.dir, '..', 'bin', 'goldband-config');

let stateDir: string;

function run(args: string[] = [], extraEnv: Record<string, string> = {}) {
  const result = Bun.spawnSync(['bash', SCRIPT, ...args], {
    env: {
      ...process.env,
      GOLDBAND_HOME: stateDir,
      GOLDBAND_STATE_DIR: stateDir,
      ...extraEnv,
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString().trim(),
    stderr: result.stderr.toString().trim(),
  };
}

beforeEach(() => {
  stateDir = mkdtempSync(join(tmpdir(), 'goldband-config-test-'));
});

afterEach(() => {
  rmSync(stateDir, { recursive: true, force: true });
});

describe('goldband-config', () => {
  // ─── get ──────────────────────────────────────────────────
  test('get on missing file returns default for known key, exit 0', () => {
    const { exitCode, stdout } = run(['get', 'auto_upgrade']);
    expect(exitCode).toBe(0);
    expect(stdout).toBe('false');
  });

  test('get existing key returns value', () => {
    writeFileSync(join(stateDir, 'config.yaml'), 'auto_upgrade: true\n');
    const { exitCode, stdout } = run(['get', 'auto_upgrade']);
    expect(exitCode).toBe(0);
    expect(stdout).toBe('true');
  });

  test('get missing key returns empty', () => {
    writeFileSync(join(stateDir, 'config.yaml'), 'auto_upgrade: true\n');
    const { exitCode, stdout } = run(['get', 'nonexistent']);
    expect(exitCode).toBe(0);
    expect(stdout).toBe('');
  });

  test('get returns last value when key appears multiple times', () => {
    writeFileSync(join(stateDir, 'config.yaml'), 'foo: bar\nfoo: baz\n');
    const { exitCode, stdout } = run(['get', 'foo']);
    expect(exitCode).toBe(0);
    expect(stdout).toBe('baz');
  });

  // ─── set ──────────────────────────────────────────────────
  test('set creates file and writes key on missing file', () => {
    const { exitCode } = run(['set', 'auto_upgrade', 'true']);
    expect(exitCode).toBe(0);
    const content = readFileSync(join(stateDir, 'config.yaml'), 'utf-8');
    expect(content).toContain('auto_upgrade: true');
  });

  test('set appends new key to existing file', () => {
    writeFileSync(join(stateDir, 'config.yaml'), 'foo: bar\n');
    const { exitCode } = run(['set', 'auto_upgrade', 'true']);
    expect(exitCode).toBe(0);
    const content = readFileSync(join(stateDir, 'config.yaml'), 'utf-8');
    expect(content).toContain('foo: bar');
    expect(content).toContain('auto_upgrade: true');
  });

  test('set replaces existing key in-place', () => {
    writeFileSync(join(stateDir, 'config.yaml'), 'auto_upgrade: false\n');
    const { exitCode } = run(['set', 'auto_upgrade', 'true']);
    expect(exitCode).toBe(0);
    const content = readFileSync(join(stateDir, 'config.yaml'), 'utf-8');
    expect(content).toContain('auto_upgrade: true');
    expect(content).not.toContain('auto_upgrade: false');
  });

  test('set creates state dir if missing', () => {
    const nestedDir = join(stateDir, 'nested', 'dir');
    const { exitCode } = run(['set', 'foo', 'bar'], { GOLDBAND_HOME: nestedDir });
    expect(exitCode).toBe(0);
    expect(existsSync(join(nestedDir, 'config.yaml'))).toBe(true);
  });

  test('set still accepts legacy GOLDBAND_STATE_DIR alias when GOLDBAND_HOME is unset', () => {
    const nestedDir = join(stateDir, 'legacy-alias', 'dir');
    const { exitCode } = run(['set', 'foo', 'bar'], {
      GOLDBAND_HOME: '',
      GOLDBAND_STATE_DIR: nestedDir,
    });
    expect(exitCode).toBe(0);
    expect(existsSync(join(nestedDir, 'config.yaml'))).toBe(true);
  });

  // ─── list ─────────────────────────────────────────────────
  test('list shows all keys', () => {
    writeFileSync(join(stateDir, 'config.yaml'), 'auto_upgrade: true\nupdate_check: false\n');
    const { exitCode, stdout } = run(['list']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('auto_upgrade: true');
    expect(stdout).toContain('update_check: false');
  });

  test('list on missing file returns active defaults, exit 0', () => {
    const { exitCode, stdout } = run(['list']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Active values (including defaults for unset keys)');
    expect(stdout).toContain('auto_upgrade:');
    expect(stdout).toContain('false (default)');
    expect(stdout).toContain('update_check:');
    expect(stdout).toContain('true (default)');
  });

  // ─── usage ────────────────────────────────────────────────
  test('no args shows usage and exits 1', () => {
    const { exitCode, stdout } = run([]);
    expect(exitCode).toBe(1);
    expect(stdout).toContain('Usage');
  });

  // ─── security: input validation ─────────────────────────
  test('set rejects key with regex metacharacters', () => {
    const { exitCode, stderr } = run(['set', '.*', 'value']);
    expect(exitCode).toBe(1);
    expect(stderr).toContain('alphanumeric');
  });

  test('set preserves value with sed special chars', () => {
    run(['set', 'test_special', 'a/b&c\\d']);
    const { stdout } = run(['get', 'test_special']);
    expect(stdout).toBe('a/b&c\\d');
  });

  // ─── annotated header ──────────────────────────────────────
  test('first set writes annotated header with docs', () => {
    run(['set', 'telemetry', 'off']);
    const content = readFileSync(join(stateDir, 'config.yaml'), 'utf-8');
    expect(content).toContain('# goldband configuration');
    expect(content).toContain('edit freely');
    expect(content).toContain('proactive:');
    expect(content).toContain('telemetry:');
    expect(content).toContain('auto_upgrade:');
    expect(content).toContain('routing_declined:');
    expect(content).toContain('codex_reviews:');
    expect(content).toContain('skip_eng_review:');
  });

  test('header written only once, not duplicated on second set', () => {
    run(['set', 'foo', 'bar']);
    run(['set', 'baz', 'qux']);
    const content = readFileSync(join(stateDir, 'config.yaml'), 'utf-8');
    const headerCount = (content.match(/# goldband configuration/g) || []).length;
    expect(headerCount).toBe(1);
  });

  test('header does not break get on commented-out keys', () => {
    run(['set', 'telemetry', 'community']);
    // Header contains "# telemetry: anonymous" as a comment example.
    // get should return the real value, not the comment.
    const { stdout } = run(['get', 'telemetry']);
    expect(stdout).toBe('community');
  });

  test('existing config file is not overwritten with header', () => {
    writeFileSync(join(stateDir, 'config.yaml'), 'existing: value\n');
    run(['set', 'new_key', 'new_value']);
    const content = readFileSync(join(stateDir, 'config.yaml'), 'utf-8');
    expect(content).toContain('existing: value');
    expect(content).not.toContain('# goldband configuration');
  });

  // ─── routing_declined ──────────────────────────────────────
  test('routing_declined defaults to false', () => {
    const { stdout } = run(['get', 'routing_declined']);
    expect(stdout).toBe('false');
  });

  test('routing_declined can be set and read', () => {
    run(['set', 'routing_declined', 'true']);
    const { stdout } = run(['get', 'routing_declined']);
    expect(stdout).toBe('true');
  });

  test('routing_declined can be reset to false', () => {
    run(['set', 'routing_declined', 'true']);
    run(['set', 'routing_declined', 'false']);
    const { stdout } = run(['get', 'routing_declined']);
    expect(stdout).toBe('false');
  });

  // ─── legacy migration ──────────────────────────────────────
  test('default home migrates legacy workflow config and state once', () => {
    const homeDir = join(stateDir, 'home');
    const legacyDir = join(homeDir, '.workflow');
    mkdirSync(legacyDir, { recursive: true });
    writeFileSync(join(legacyDir, 'config.yaml'), 'telemetry: community\nskill_prefix: true\n', {
      flag: 'w',
    });
    mkdirSync(join(legacyDir, 'projects', 'demo'), { recursive: true });
    writeFileSync(join(legacyDir, 'projects', 'demo', 'learnings.jsonl'), '{"key":"old"}\n');
    mkdirSync(join(legacyDir, 'analytics'), { recursive: true });
    writeFileSync(join(legacyDir, 'analytics', 'skill-usage.jsonl'), '{"skill":"old"}\n');

    const { exitCode, stdout } = run(['get', 'telemetry'], {
      HOME: homeDir,
      GOLDBAND_HOME: '',
      GOLDBAND_STATE_DIR: '',
    });

    expect(exitCode).toBe(0);
    expect(stdout).toBe('community');
    expect(readFileSync(join(homeDir, '.goldband', 'config.yaml'), 'utf-8')).toContain(
      'telemetry: community',
    );
    expect(
      readFileSync(join(homeDir, '.goldband', 'projects', 'demo', 'learnings.jsonl'), 'utf-8'),
    ).toBe('{"key":"old"}\n');
    expect(
      readFileSync(join(homeDir, '.goldband', 'analytics', 'skill-usage.jsonl'), 'utf-8'),
    ).toBe('{"skill":"old"}\n');
    expect(existsSync(join(homeDir, '.goldband', '.legacy-migrated'))).toBe(true);

    writeFileSync(join(legacyDir, 'projects', 'demo', 'late.jsonl'), '{"key":"late"}\n');
    const second = run(['get', 'telemetry'], {
      HOME: homeDir,
      GOLDBAND_HOME: '',
      GOLDBAND_STATE_DIR: '',
    });
    expect(second.exitCode).toBe(0);
    expect(second.stdout).toBe('community');
    expect(existsSync(join(homeDir, '.goldband', 'projects', 'demo', 'late.jsonl'))).toBe(false);
  });

});
