import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { repoRoot, UsageError } from './config.mjs';
import { listWorktreeFiles, workingTreeFingerprint } from './files.mjs';

// Live hooks snapshot working-tree candidates before a shell command and check
// only paths whose identity changed afterwards, so one command never repeats
// advice for files that were already dirty.
const SNAPSHOT_ID = /^[A-Za-z0-9._-]{1,128}$/;
const SNAPSHOT_TTL_MS = 24 * 60 * 60 * 1000;

export function writeWorktreeSnapshot(id) {
  const target = snapshotPath(id);
  const files = Object.fromEntries(
    listWorktreeFiles().map((file) => [file, workingTreeFingerprint(file)]),
  );
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  pruneExpiredSnapshots(path.dirname(target));
  const temporary = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify({ root: repoRoot, files }), {
    mode: 0o600,
  });
  fs.renameSync(temporary, target);
}

// A missing or foreign snapshot means the pre-command hook did not run for this
// repository; every current candidate is then reported rather than none.
export function listWorktreeFilesChangedSince(id) {
  const target = snapshotPath(id);
  const snapshot = readSnapshot(target);
  fs.rmSync(target, { force: true });
  const files = listWorktreeFiles();
  if (!snapshot || snapshot.root !== repoRoot) return files;
  return files.filter(
    (file) => snapshot.files[file] !== workingTreeFingerprint(file),
  );
}

function snapshotPath(id) {
  if (!SNAPSHOT_ID.test(id || '')) {
    throw new UsageError(`invalid snapshot id: ${id || '(missing)'}`);
  }
  return path.join(snapshotDir(), `style-snapshot-${id}.json`);
}

function snapshotDir() {
  if (process.env.GOLDBAND_STYLE_SNAPSHOT_DIR) {
    return process.env.GOLDBAND_STYLE_SNAPSHOT_DIR;
  }
  const stateHome =
    process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state');
  return path.join(stateHome, 'goldband', 'style-snapshots');
}

function readSnapshot(target) {
  let raw;
  try {
    raw = fs.readFileSync(target, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  const parsed = JSON.parse(raw);
  const valid =
    parsed &&
    typeof parsed.root === 'string' &&
    parsed.files &&
    typeof parsed.files === 'object';
  return valid ? parsed : null;
}

// Only names this module writes are pruned; the directory may be shared.
const SNAPSHOT_FILE =
  /^style-snapshot-[A-Za-z0-9._-]{1,128}\.json(?:\.\d+\.tmp)?$/;

function pruneExpiredSnapshots(dir) {
  const cutoff = Date.now() - SNAPSHOT_TTL_MS;
  for (const name of fs.readdirSync(dir)) {
    if (!SNAPSHOT_FILE.test(name)) continue;
    const file = path.join(dir, name);
    try {
      if (fs.statSync(file).mtimeMs < cutoff) fs.rmSync(file, { force: true });
    } catch {
      // A concurrent hook may already have consumed the snapshot.
    }
  }
}
