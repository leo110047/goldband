import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { config, cwdInGitRepo, repoRoot, run, ToolError } from './config.mjs';
import { CODE_EXTENSIONS } from './constants.mjs';

export function toRepoRelative(filePath) {
  if (!filePath) return null;
  const absolute = path.isAbsolute(filePath)
    ? path.normalize(filePath)
    : path.resolve(repoRoot, filePath);
  // Git-provided relative paths are already canonical index paths.
  const resolved = path.isAbsolute(filePath)
    ? path.join(realPathOf(path.dirname(absolute)), path.basename(absolute))
    : absolute;
  const relative = path.relative(repoRoot, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return null;
  }
  return relative.split(path.sep).join('/');
}

// `repoRoot` comes from Git with symlinks resolved, so the directories of an
// absolute path are resolved the same way before comparing. The final component
// stays as given: a staged symlink is checked as itself, not as its target.
function realPathOf(absolute) {
  try {
    return fs.realpathSync(absolute);
  } catch {
    const parent = path.dirname(absolute);
    if (parent === absolute) return absolute;
    return path.join(realPathOf(parent), path.basename(absolute));
  }
}

export function uniqueFiles(files) {
  return [...new Set(files)].filter((file) => !isIgnoredPath(file));
}

export function listFilesForMode(mode, explicitFiles) {
  if (mode === 'staged') return listStagedFiles();
  if (mode === 'files') {
    return explicitFiles.map(toRepoRelative).filter(Boolean);
  }
  if (mode === 'worktree') return listWorktreeFiles();
  return listRepoFiles();
}

// Live hook candidates: staged, unstaged, and untracked paths that still exist
// in the working tree, before style exclusions. Outside a Git repository there
// is nothing to inspect.
export function listWorktreeFiles() {
  if (!cwdInGitRepo) return [];
  // Hooks run this beside the user's own Git commands; never take index.lock.
  const result = run('git', [
    '--no-optional-locks',
    'status',
    '--porcelain=v1',
    '-z',
    '--untracked-files=all',
    '--no-renames',
  ]);
  if (result.status !== 0) {
    throw new ToolError('failed to list working-tree changes', result.stderr);
  }
  const files = result.stdout
    .split('\0')
    .filter(Boolean)
    .map((entry) => toRepoRelative(entry.slice(3)))
    .filter(Boolean);
  return [...new Set(files)].filter(
    (file) => workingTreeFileSize(file) !== null,
  );
}

// Cheap change identity for snapshot comparison; content is read only for
// files whose identity changed.
export function workingTreeFingerprint(relativePath) {
  try {
    const stats = fs.statSync(path.join(repoRoot, relativePath), {
      bigint: true,
    });
    if (!stats.isFile()) return null;
    return `${stats.size}:${stats.mtimeNs}:${stats.ctimeNs}:${stats.ino}`;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new ToolError(
      `failed to inspect working-tree file: ${relativePath}`,
      error.message,
    );
  }
}

export function fileContent(relativePath, mode) {
  return mode === 'staged'
    ? readStagedFile(relativePath)
    : readWorkingTreeFile(relativePath);
}

export function fileSize(relativePath, mode) {
  return mode === 'staged'
    ? (stagedBlobEntry(relativePath)?.size ?? null)
    : workingTreeFileSize(relativePath);
}

export function decodeText(buffer) {
  if (!buffer || isBinary(buffer)) return null;
  return buffer.toString('utf8');
}

export function isBinary(buffer) {
  if (!buffer) return false;
  const sample = buffer.subarray(0, Math.min(buffer.length, 8000));
  return sample.includes(0);
}

export function lineCount(text) {
  if (!text) return 0;
  const withoutTrailing = text.endsWith('\n') ? text.slice(0, -1) : text;
  return withoutTrailing ? withoutTrailing.split('\n').length : 0;
}

export function isCodeFile(file) {
  return CODE_EXTENSIONS.has(path.extname(file));
}

function isIgnoredPath(relativePath) {
  return (
    !relativePath ||
    relativePath.startsWith('.git/') ||
    relativePath.startsWith('node_modules/') ||
    relativePath.startsWith('vendor/') ||
    // Goldband Loop is first-party, but it owns a source-focused Bun gate.
    // CI installs its dependencies and runs `bun run check:source`.
    relativePath.startsWith('goldband-loop/') ||
    relativePath.startsWith('plugin-assets/claude-code-plugin/') ||
    relativePath.startsWith('dist/') ||
    relativePath.startsWith('build/') ||
    relativePath.endsWith('.min.js')
  );
}

function listStagedFiles() {
  const result = run('git', [
    'diff',
    '--cached',
    '--name-only',
    '--diff-filter=ACMR',
    '-z',
  ]);
  if (result.status !== 0) {
    throw new ToolError('failed to list staged files', result.stderr.trim());
  }
  return splitGitPathList(result.stdout);
}

function listRepoFiles() {
  const result = run('git', [
    'ls-files',
    '-z',
    '--cached',
    '--others',
    '--exclude-standard',
  ]);
  if (result.status !== 0) {
    throw new ToolError('failed to list tracked files', result.stderr.trim());
  }
  return splitGitPathList(result.stdout).filter((file) =>
    fs.existsSync(path.join(repoRoot, file)),
  );
}

function splitGitPathList(output) {
  return output.split('\0').filter(Boolean).map(toRepoRelative).filter(Boolean);
}

function readWorkingTreeFile(relativePath) {
  try {
    return fs.readFileSync(path.join(repoRoot, relativePath));
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw new ToolError(
        `failed to read working-tree file: ${relativePath}`,
        error.message,
      );
    }
    return null;
  }
}

function readStagedFile(relativePath) {
  const entry = stagedBlobEntry(relativePath);
  if (!entry) return null;
  const maxReadableBytes = Math.max(
    config.maxTextBytes,
    config.maxGeneratedTextBytes,
    config.maxBinaryBytes,
  );
  if (entry.size > maxReadableBytes) {
    throw new ToolError(
      `refusing to load oversized staged file: ${relativePath}`,
      `${entry.size} bytes exceeds the largest configured file limit ${maxReadableBytes}`,
    );
  }
  const result = spawnSync('git', ['cat-file', 'blob', entry.objectId], {
    cwd: repoRoot,
    encoding: 'buffer',
    maxBuffer: entry.size + 1,
  });
  if (result.error || result.status !== 0) {
    throw new ToolError(
      `failed to read staged file: ${relativePath}`,
      result.error?.message || result.stderr?.toString('utf8').trim(),
    );
  }
  if (result.stdout.length !== entry.size) {
    throw new ToolError(
      `staged file size changed while reading: ${relativePath}`,
      `expected ${entry.size} bytes, received ${result.stdout.length}`,
    );
  }
  return result.stdout;
}

function workingTreeFileSize(relativePath) {
  try {
    const stats = fs.statSync(path.join(repoRoot, relativePath));
    return stats.isFile() ? stats.size : null;
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw new ToolError(
        `failed to inspect working-tree file: ${relativePath}`,
        error.message,
      );
    }
    return null;
  }
}

function stagedBlobEntry(relativePath) {
  const result = run('git', [
    'ls-files',
    '--stage',
    '-z',
    '--',
    `:(top,literal)${relativePath}`,
  ]);
  if (result.status !== 0) {
    throw new ToolError(
      `failed to inspect staged file: ${relativePath}`,
      result.stderr.trim(),
    );
  }
  const entries = result.stdout.split('\0').filter(Boolean);
  if (entries.length === 0) return null;
  if (entries.length !== 1) {
    throw new ToolError(
      `staged file has unresolved index entries: ${relativePath}`,
    );
  }
  const match = entries[0].match(/^(\d{6}) ([0-9a-f]+) 0\t/s);
  if (!match) {
    throw new ToolError(`failed to resolve staged blob: ${relativePath}`);
  }
  if (match[1] === '160000') return null;
  if (!['100644', '100755', '120000'].includes(match[1])) {
    throw new ToolError(
      `staged file has unsupported index mode ${match[1]}: ${relativePath}`,
    );
  }
  const sizeResult = run('git', ['cat-file', '-s', match[2]]);
  const size = Number.parseInt(sizeResult.stdout.trim(), 10);
  if (sizeResult.status !== 0 || !Number.isSafeInteger(size) || size < 0) {
    throw new ToolError(
      `failed to inspect staged blob size: ${relativePath}`,
      sizeResult.stderr.trim(),
    );
  }
  return { objectId: match[2], size };
}
