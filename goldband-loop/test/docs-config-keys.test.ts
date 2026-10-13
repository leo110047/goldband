import { describe, test, expect } from 'bun:test';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(import.meta.dir, '..');
const CONFIG_BIN = path.join(ROOT, 'bin', 'goldband-config');

function scanDocsForConfigKeys(): { docPath: string; key: string; line: number }[] {
  const hits: { docPath: string; key: string; line: number }[] = [];
  // Recurse docs/ (skipping dotfiles) plus the top-level README, which documents
  // the user-facing config commands. TODOS.md stays excluded.
  const stack = [path.join(ROOT, 'docs'), path.join(ROOT, 'README.md')];
  while (stack.length) {
    const cur = stack.pop()!;
    if (fs.statSync(cur).isFile()) {
      collectConfigKeys(cur, hits);
      continue;
    }
    for (const ent of fs.readdirSync(cur, { withFileTypes: true })) {
      if (ent.name.startsWith('.')) continue;
      const full = path.join(cur, ent.name);
      if (ent.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!ent.name.endsWith('.md')) continue;
      collectConfigKeys(full, hits);
    }
  }
  return hits;
}

function collectConfigKeys(
  docPath: string,
  hits: { docPath: string; key: string; line: number }[],
): void {
  const lines = fs.readFileSync(docPath, 'utf-8').split('\n');
  lines.forEach((line, idx) => {
    // Match `goldband-config set <key>` or `goldband-config get <key>`.
    for (const m of line.matchAll(/goldband-config\s+(?:set|get)\s+([a-z][a-z0-9_]*)/g)) {
      hits.push({ docPath, key: m[1], line: idx + 1 });
    }
  });
}

function runConfig(args: string[], tmpHome: string) {
  return spawnSync(CONFIG_BIN, args, {
    encoding: 'utf-8',
    env: { ...process.env, HOME: tmpHome, GOLDBAND_HOME: tmpHome },
    timeout: 5000,
  });
}

describe('docs ↔ goldband-config key drift guard', () => {
  test('docs reference at least one config key (smoke)', () => {
    const hits = scanDocsForConfigKeys();
    expect(hits.length).toBeGreaterThan(0);
  });

  // goldband-config is a bash script; Windows can't exec it via spawnSync
  // without a Git Bash interpreter shim.
  test.skipIf(process.platform === 'win32')('`explain_level` is exposed as a documented default', () => {
    const tmpHome = fs.mkdtempSync(path.join(require('os').tmpdir(), 'goldband-cfg-'));
    try {
      const get = runConfig(['get', 'explain_level'], tmpHome);
      expect(get.status).toBe(0);
      expect(get.stdout.trim()).toBe('default');

      const defaults = runConfig(['defaults'], tmpHome);
      expect(defaults.status).toBe(0);
      expect(defaults.stdout).toContain('explain_level:');
      expect(defaults.stdout).toContain('default');

      const list = runConfig(['list'], tmpHome);
      expect(list.status).toBe(0);
      expect(list.stdout).toContain('explain_level:');
      expect(list.stdout).toContain('default');
    } finally {
      fs.rmSync(tmpHome, { recursive: true, force: true });
    }
  });

  test.skipIf(process.platform === 'win32')('`goldband-config get artifacts_sync_mode` returns a value (the rename landed)', () => {
    // Run from a clean HOME so the user's local config doesn't pollute.
    const tmpHome = fs.mkdtempSync(path.join(require('os').tmpdir(), 'goldband-cfg-'));
    try {
      const result = runConfig(['get', 'artifacts_sync_mode'], tmpHome);
      expect(result.status).toBe(0);
      // A known key returns its default value, not the "unknown key" error string.
      expect(result.stderr).not.toContain('not recognized');
      expect(result.stdout.trim().length).toBeGreaterThan(0);
    } finally {
      fs.rmSync(tmpHome, { recursive: true, force: true });
    }
  });
});
