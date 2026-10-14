const fs = require('node:fs');
const path = require('node:path');

const MANAGED_MARKER = 'goldband-managed-worktree.json';
const GIT_WRITE_COMMAND =
  /(?:^|[\s;&|()])(?:\/usr\/bin\/|\/usr\/local\/bin\/|\/opt\/homebrew\/bin\/)?git(?:\s+-C\s+(?:"[^"]+"|'[^']+'|\S+))*\s+(?:add|am|checkout|checkout-index|cherry-pick|commit|commit-tree|fetch|gc|merge|mv|pack-refs|pull|push|read-tree|rebase|reset|restore|revert|rm|stash|switch|update-index|update-ref|write-tree)(?:\s|$)/i;

function resolveManagedWorktreeMarker(cwd = process.cwd()) {
  // Loaded on use: most hook calls never reach a Git write command.
  const { spawnSync } = require('node:child_process');
  const result = spawnSync('git', ['rev-parse', '--git-dir'], {
    cwd,
    encoding: 'utf8',
    timeout: 2000,
  });
  if (result.status !== 0) return null;
  const gitDir = path.resolve(cwd, result.stdout.trim());
  const markerPath = path.join(gitDir, MANAGED_MARKER);
  if (!fs.existsSync(markerPath)) return null;
  try {
    const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
    if (
      marker?.schemaVersion !== 1 ||
      typeof marker.leaseId !== 'string' ||
      typeof marker.manifestPath !== 'string'
    ) {
      return null;
    }
    return { ...marker, markerPath };
  } catch {
    return null;
  }
}

function managedWorktreeBashViolation(command, cwd = process.cwd()) {
  if (!GIT_WRITE_COMMAND.test(String(command || ''))) return null;
  const marker = resolveManagedWorktreeMarker(cwd);
  if (!marker) return null;
  return {
    marker,
    rule: 'finish-only-git-writes',
    detail:
      'managed worktrees keep Git metadata read-only; exit the managed shell and use goldband worktree finish',
  };
}

module.exports = {
  managedWorktreeBashViolation,
};
