const fs = require('fs');
const os = require('os');
const path = require('path');
const { matchFreezeModeBashViolation } = require('./freeze-mode-rules');

// Shared by Claude and Codex hooks (copied into codex/hooks). File selection
// and checks stay in scripts/check-code-style.mjs; this adapter only finds the
// checker, runs it, and turns the outcome into one advisory message.
const CHECKER_TIMEOUT_MS = 4000;
const CHECKER_RELATIVE_PATH = path.join('scripts', 'check-code-style.mjs');
// Introduced with the --worktree/--snapshot/--since contract, so an older
// checkout without it is treated as unavailable rather than misused.
const CHECKER_MARKER = path.join(
  'scripts',
  'lib',
  'code-style',
  'worktree-snapshot.mjs',
);

function sourceRootCandidates() {
  let realDir;
  try {
    realDir = fs.realpathSync(__dirname);
  } catch {
    return [];
  }
  return [
    // Source checkout or linked install: hooks/scripts/lib/hook-router.
    path.resolve(realDir, '..', '..', '..', '..'),
    // Source checkout or linked install: codex/hooks.
    path.resolve(realDir, '..', '..'),
  ];
}

// Copied installs have no source-relative path; the installed Git style gate
// records the Goldband checkout it materialized from.
function styleGateSourceRoot() {
  const hooksDir =
    process.env.GOLDBAND_GIT_HOOKS_DIR ||
    path.join(
      process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'),
      'goldband',
      'git-hooks',
    );
  try {
    const raw = fs.readFileSync(
      path.join(hooksDir, '.goldband-source'),
      'utf8',
    );
    const root = raw.split('\n')[0].trim();
    return root && path.isAbsolute(root) ? root : null;
  } catch {
    return null;
  }
}

function resolveChecker() {
  if (process.env.GOLDBAND_STYLE_GATE_SCRIPT) {
    return fs.existsSync(process.env.GOLDBAND_STYLE_GATE_SCRIPT)
      ? process.env.GOLDBAND_STYLE_GATE_SCRIPT
      : null;
  }
  const roots = [...sourceRootCandidates(), styleGateSourceRoot()];
  for (const root of roots.filter(Boolean)) {
    if (fs.existsSync(path.join(root, CHECKER_MARKER))) {
      return path.join(root, CHECKER_RELATIVE_PATH);
    }
  }
  return null;
}

// Live advice honors the same opt-outs as the pre-commit gate. The repository
// root is found by walking up to `.git` so an opted-out repository costs no
// checker process.
function repositoryRoot() {
  let dir = process.cwd();
  for (let depth = 0; depth < 64; depth += 1) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

function optedOut() {
  if (process.env.GOLDBAND_STYLE_GATE === '0') return true;
  const root = repositoryRoot();
  return Boolean(
    root && fs.existsSync(path.join(root, '.goldband-no-style-gate')),
  );
}

function runChecker(args) {
  if (optedOut()) return null;
  const checker = resolveChecker();
  if (!checker) return null;
  // Loaded on use: hook calls for tools without live advice skip the cost.
  const { spawnSync } = require('child_process');
  return spawnSync(process.execPath, [checker, ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
    maxBuffer: 5 * 1024 * 1024,
    timeout: CHECKER_TIMEOUT_MS,
    env: { ...process.env, GOLDBAND_STYLE_GATE_HOST: '1' },
  });
}

// Every entry point returns `{ message, spawnedProcesses }` so router metrics
// count the checker process.
function advisoryFromResult(result) {
  if (!result) return { message: null, spawnedProcesses: 0 };
  return { message: advisoryMessage(result), spawnedProcesses: 1 };
}

function advisoryMessage(result) {
  if (result.error) {
    return `goldband style gate advisory failed: ${result.error.message}`;
  }
  if (result.status === 2 || result.status === null) {
    return ['goldband style gate advisory could not run.', result.stderr.trim()]
      .filter(Boolean)
      .join('\n');
  }
  return result.stdout.trim() || null;
}

// One snapshot per tool call; parallel calls in a session stay separate. The
// working directory distinguishes calls only when the host sends no id, and
// can change between PreToolUse and PostToolUse otherwise.
function snapshotIdForToolUse(input) {
  const key = [
    input.session_id || process.env.CLAUDE_SESSION_ID || 'default',
    input.tool_use_id || process.cwd(),
  ].join('\0');
  return require('crypto')
    .createHash('sha256')
    .update(key)
    .digest('hex')
    .slice(0, 40);
}

function styleAdvisoryForFiles(files) {
  const selected = files.filter(Boolean);
  if (selected.length === 0) return advisoryFromResult(null);
  return advisoryFromResult(
    runChecker(['--files', ...selected, '--format', 'advisory']),
  );
}

// No snapshot or post-command scan: a background command writes after its
// PostToolUse fires (pre-commit covers it), and a command on freeze-mode's
// read-only allowlist cannot write, so scanning it only costs two checker runs.
function skipsShellScan(input) {
  if (input.tool_input?.run_in_background === true) return true;
  // Outside a Git repository the worktree scan has no candidates.
  if (!repositoryRoot()) return true;
  const command = input.tool_input?.command || '';
  // The allowlist reads raw text; quoting or escaping can hide a writer option
  // from it (`git diff '--output=x'`), so such commands are always scanned.
  if (/['"\\]/.test(command)) return false;
  return matchFreezeModeBashViolation(command) === null;
}

// Snapshot failures stay silent: the post-command check then falls back to all
// working-tree candidates and reports any checker failure itself.
function snapshotWorktreeBeforeShell(input) {
  if (skipsShellScan(input)) return advisoryFromResult(null);
  const result = runChecker([
    '--worktree',
    '--snapshot',
    snapshotIdForToolUse(input),
  ]);
  return { message: null, spawnedProcesses: result ? 1 : 0 };
}

function styleAdvisoryAfterShell(input) {
  if (skipsShellScan(input)) return advisoryFromResult(null);
  return advisoryFromResult(
    runChecker([
      '--worktree',
      '--since',
      snapshotIdForToolUse(input),
      '--format',
      'advisory',
    ]),
  );
}

module.exports = {
  snapshotWorktreeBeforeShell,
  styleAdvisoryAfterShell,
  styleAdvisoryForFiles,
};
