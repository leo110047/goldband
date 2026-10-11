import { describe, test, expect } from 'bun:test';
import { spawnSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

const ROOT = path.resolve(import.meta.dir, '..');
const SETUP_SCRIPT = path.join(ROOT, 'setup');

describe('setup: Conductor worktree guard', () => {

  test('same-directory workflow docs preserve the executable source owner', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'goldband-workflow-root-'));
    try {
      const source = path.join(tmp, 'skills', 'goldband');
      const workflows = path.join(source, 'workflows');
      fs.mkdirSync(workflows, { recursive: true });
      fs.writeFileSync(path.join(workflows, 'run.ts'), '// executable owner\n');
      fs.writeFileSync(path.join(workflows, 'review.ts'), '// executable owner\n');
      const helper = path.join(ROOT, 'scripts', 'prepare-internal-workflow-root.sh');
      const sameDir = spawnSync('bash', [helper, source, source], { encoding: 'utf8' });
      expect(sameDir.status, sameDir.stderr).toBe(0);
      expect(fs.readFileSync(path.join(workflows, 'run.ts'), 'utf8')).toContain('executable owner');
      expect(fs.readFileSync(path.join(workflows, 'review.ts'), 'utf8')).toContain('executable owner');

      const installed = path.join(tmp, 'installed', 'goldband');
      fs.mkdirSync(path.join(installed, 'workflows'), { recursive: true });
      fs.writeFileSync(path.join(installed, 'workflows', 'stale.ts'), '// stale\n');
      const separate = spawnSync('bash', [helper, installed, source], { encoding: 'utf8' });
      expect(separate.status, separate.stderr).toBe(0);
      expect(fs.existsSync(path.join(installed, 'workflows', 'stale.ts'))).toBe(false);

      const installedAlias = path.join(tmp, 'installed-alias');
      fs.symlinkSync(installed, installedAlias);
      fs.writeFileSync(path.join(installed, 'workflows', 'stale-again.ts'), '// stale\n');
      const canonical = spawnSync('bash', [helper, installedAlias, source], { encoding: 'utf8' });
      expect(canonical.status, canonical.stderr).toBe(0);
      expect(fs.existsSync(path.join(installed, 'workflows', 'stale-again.ts'))).toBe(false);

      const realTemporaryRoot = fs.realpathSync(os.tmpdir());
      const traversalToRoot = `${realTemporaryRoot}/${'../'.repeat(
        realTemporaryRoot.split(path.sep).filter(Boolean).length,
      )}`;
      const rootTraversal = spawnSync('bash', [
        helper,
        traversalToRoot,
        source,
      ], { encoding: 'utf8' });
      expect(rootTraversal.status).toBe(2);
      expect(rootTraversal.stderr).toContain('canonical filesystem root');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });


  test('setup contains the real-dir guard before the symlink-or-copy into ~/.claude/skills/', () => {
    const content = fs.readFileSync(SETUP_SCRIPT, 'utf-8');
    const guardIdx = content.indexOf('_SKIP_CLAUDE_REGISTER=0');
    // Claude registration now builds a runtime root, whose asset writes route
    // through _link_or_copy for Windows fallback.
    const lnIdx = content.indexOf(
      'create_claude_runtime_root "$SOURCE_GOLDBAND_DIR" "$INSTALL_GOLDBAND_DIR"',
      guardIdx,
    );
    expect(guardIdx).toBeGreaterThan(-1);
    expect(lnIdx).toBeGreaterThan(-1);
    expect(guardIdx).toBeLessThan(lnIdx);
  });

  test('guard resolves the existing real dir with `pwd -P` and compares against source', () => {
    const content = fs.readFileSync(SETUP_SCRIPT, 'utf-8');
    expect(content).toContain('[ -d "$CLAUDE_GOLDBAND_LINK" ] && [ ! -L "$CLAUDE_GOLDBAND_LINK" ]');
    expect(content).toContain('cd "$CLAUDE_GOLDBAND_LINK" 2>/dev/null && pwd -P');
    expect(content).toContain('"$_EXISTING_REAL" != "$SOURCE_GOLDBAND_DIR"');
  });

  test('skip branch prints "registration skipped" + remediation hint', () => {
    const content = fs.readFileSync(SETUP_SCRIPT, 'utf-8');
    expect(content).toContain('Skipping Claude skill registration');
    expect(content).toContain('claude registration skipped');
    expect(content).toContain('rm -rf $CLAUDE_GOLDBAND_LINK');
  });

  // Reproduce the BSD/macOS `ln -snf` behavior that caused the bug, then
  // confirm the guard avoids it. This is a behavioral test of the guard logic
  // running in an isolated tmpdir — not the full setup script.
  test('BSD ln -snf into an existing real dir creates a child symlink (bug reproduces)', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'goldband-setup-guard-'));
    try {
      const source = path.join(tmp, 'source-worktree');
      const dest = path.join(tmp, 'dest-real-dir');
      fs.mkdirSync(source);
      fs.mkdirSync(dest);
      // The buggy invocation: target dest is an existing real dir.
      const result = spawnSync('ln', ['-snf', source, dest], { encoding: 'utf-8' });
      expect(result.status).toBe(0);
      // Child symlink leaked inside dest.
      const leaked = path.join(dest, path.basename(source));
      expect(fs.existsSync(leaked)).toBe(true);
      expect(fs.lstatSync(leaked).isSymbolicLink()).toBe(true);
      expect(fs.readlinkSync(leaked)).toBe(source);
      // dest itself stayed a real directory (not replaced).
      expect(fs.lstatSync(dest).isSymbolicLink()).toBe(false);
      expect(fs.lstatSync(dest).isDirectory()).toBe(true);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('guard logic refuses to ln when dest is a real dir pointing elsewhere', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'goldband-setup-guard-'));
    try {
      const source = path.join(tmp, 'source-worktree');
      const dest = path.join(tmp, 'dest-real-dir');
      fs.mkdirSync(source);
      fs.mkdirSync(dest);
      // Inline the guard logic from setup. If it triggers, $_SKIP=1 is echoed
      // and no ln is performed; otherwise ln runs and we'd see the leak.
      const script = `
        set -e
        SOURCE_GOLDBAND_DIR='${source}'
        CLAUDE_GOLDBAND_LINK='${dest}'
        _SKIP_CLAUDE_REGISTER=0
        if [ -d "$CLAUDE_GOLDBAND_LINK" ] && [ ! -L "$CLAUDE_GOLDBAND_LINK" ]; then
          _EXISTING_REAL=$(cd "$CLAUDE_GOLDBAND_LINK" 2>/dev/null && pwd -P || echo "")
          if [ -n "$_EXISTING_REAL" ] && [ "$_EXISTING_REAL" != "$SOURCE_GOLDBAND_DIR" ]; then
            _SKIP_CLAUDE_REGISTER=1
          fi
        fi
        if [ "$_SKIP_CLAUDE_REGISTER" -eq 1 ]; then
          echo "SKIP"
        else
          ln -snf "$SOURCE_GOLDBAND_DIR" "$CLAUDE_GOLDBAND_LINK"
          echo "LINKED"
        fi
      `;
      const result = spawnSync('bash', ['-c', script], { encoding: 'utf-8' });
      expect(result.status).toBe(0);
      expect(result.stdout.trim()).toBe('SKIP');
      // No child symlink leaked.
      const leaked = path.join(dest, path.basename(source));
      expect(fs.existsSync(leaked)).toBe(false);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('guard allows ln when dest does not exist (fresh install path)', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'goldband-setup-guard-'));
    try {
      const source = path.join(tmp, 'source-worktree');
      const dest = path.join(tmp, 'fresh-dest');
      fs.mkdirSync(source);
      const script = `
        set -e
        SOURCE_GOLDBAND_DIR='${source}'
        CLAUDE_GOLDBAND_LINK='${dest}'
        _SKIP_CLAUDE_REGISTER=0
        if [ -d "$CLAUDE_GOLDBAND_LINK" ] && [ ! -L "$CLAUDE_GOLDBAND_LINK" ]; then
          _EXISTING_REAL=$(cd "$CLAUDE_GOLDBAND_LINK" 2>/dev/null && pwd -P || echo "")
          if [ -n "$_EXISTING_REAL" ] && [ "$_EXISTING_REAL" != "$SOURCE_GOLDBAND_DIR" ]; then
            _SKIP_CLAUDE_REGISTER=1
          fi
        fi
        if [ "$_SKIP_CLAUDE_REGISTER" -eq 1 ]; then
          echo "SKIP"
        else
          ln -snf "$SOURCE_GOLDBAND_DIR" "$CLAUDE_GOLDBAND_LINK"
          echo "LINKED"
        fi
      `;
      const result = spawnSync('bash', ['-c', script], { encoding: 'utf-8' });
      expect(result.status).toBe(0);
      expect(result.stdout.trim()).toBe('LINKED');
      expect(fs.lstatSync(dest).isSymbolicLink()).toBe(true);
      expect(fs.readlinkSync(dest)).toBe(source);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('guard allows ln when dest is an existing symlink (upgrade-in-place path)', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'goldband-setup-guard-'));
    try {
      const source = path.join(tmp, 'new-source');
      const oldSource = path.join(tmp, 'old-source');
      const dest = path.join(tmp, 'dest-symlink');
      fs.mkdirSync(source);
      fs.mkdirSync(oldSource);
      fs.symlinkSync(oldSource, dest);
      // Existing symlink: -L is true, so the guard does NOT trigger. ln -snf
      // should atomically retarget the symlink to the new source.
      const script = `
        set -e
        SOURCE_GOLDBAND_DIR='${source}'
        CLAUDE_GOLDBAND_LINK='${dest}'
        _SKIP_CLAUDE_REGISTER=0
        if [ -d "$CLAUDE_GOLDBAND_LINK" ] && [ ! -L "$CLAUDE_GOLDBAND_LINK" ]; then
          _EXISTING_REAL=$(cd "$CLAUDE_GOLDBAND_LINK" 2>/dev/null && pwd -P || echo "")
          if [ -n "$_EXISTING_REAL" ] && [ "$_EXISTING_REAL" != "$SOURCE_GOLDBAND_DIR" ]; then
            _SKIP_CLAUDE_REGISTER=1
          fi
        fi
        if [ "$_SKIP_CLAUDE_REGISTER" -eq 1 ]; then
          echo "SKIP"
        else
          ln -snf "$SOURCE_GOLDBAND_DIR" "$CLAUDE_GOLDBAND_LINK"
          echo "LINKED"
        fi
      `;
      const result = spawnSync('bash', ['-c', script], { encoding: 'utf-8' });
      expect(result.status).toBe(0);
      expect(result.stdout.trim()).toBe('LINKED');
      expect(fs.readlinkSync(dest)).toBe(source);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('guard allows ln when dest is a real dir already pointing to source (self-rerun)', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'goldband-setup-guard-'));
    try {
      const source = path.join(tmp, 'source-worktree');
      fs.mkdirSync(source);
      // Mirror setup's SOURCE_GOLDBAND_DIR resolution (`pwd -P`) so the comparison
      // is fair on macOS where /tmp itself is a symlink to /private/tmp.
      const resolvedSource = fs.realpathSync(source);
      // Degenerate case: existing real dir IS the source.
      const dest = source;
      const script = `
        set -e
        SOURCE_GOLDBAND_DIR='${resolvedSource}'
        CLAUDE_GOLDBAND_LINK='${dest}'
        _SKIP_CLAUDE_REGISTER=0
        if [ -d "$CLAUDE_GOLDBAND_LINK" ] && [ ! -L "$CLAUDE_GOLDBAND_LINK" ]; then
          _EXISTING_REAL=$(cd "$CLAUDE_GOLDBAND_LINK" 2>/dev/null && pwd -P || echo "")
          if [ -n "$_EXISTING_REAL" ] && [ "$_EXISTING_REAL" != "$SOURCE_GOLDBAND_DIR" ]; then
            _SKIP_CLAUDE_REGISTER=1
          fi
        fi
        echo "skip=$_SKIP_CLAUDE_REGISTER"
      `;
      const result = spawnSync('bash', ['-c', script], { encoding: 'utf-8' });
      expect(result.status).toBe(0);
      expect(result.stdout.trim()).toBe('skip=0');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
