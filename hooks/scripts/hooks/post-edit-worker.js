#!/usr/bin/env node
/**
 * Async worker for post-edit quality tasks.
 * Non-blocking by design (format/typecheck).
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { getPersistentDataPath } = require('../lib/utils');

const DEFAULT_DEBOUNCE_WINDOWS = {
  format: 2000,
  typecheck: 12000
};

const DEFAULT_STATE_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_LOCK_STALE_MS = 30 * 1000;

function parseArgs(argv) {
  const parsed = {};
  for (let index = 2; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key || !key.startsWith('--') || value === undefined) continue;
    parsed[key.slice(2)] = value;
  }
  return parsed;
}

function getNpxBinary() {
  return process.platform === 'win32' ? 'npx.cmd' : 'npx';
}

function parsePositiveInt(value, fallback) {
  const parsed = parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function getDebounceStateFile() {
  return process.env.HOOK_ROUTER_DEBOUNCE_FILE || getPersistentDataPath('hook-router', 'worker-debounce.json');
}

function getDebounceWindowMs(task) {
  if (task === 'format') {
    return parsePositiveInt(process.env.HOOK_DEBOUNCE_FORMAT_MS, DEFAULT_DEBOUNCE_WINDOWS.format);
  }
  if (task === 'typecheck') {
    return parsePositiveInt(process.env.HOOK_DEBOUNCE_TYPECHECK_MS, DEFAULT_DEBOUNCE_WINDOWS.typecheck);
  }
  return 0;
}

function getStateTtlMs() {
  return parsePositiveInt(process.env.HOOK_DEBOUNCE_STATE_TTL_MS, DEFAULT_STATE_TTL_MS);
}

function getLockStaleMs() {
  return parsePositiveInt(process.env.HOOK_DEBOUNCE_LOCK_STALE_MS, DEFAULT_LOCK_STALE_MS);
}

function readHookInputFromStdin() {
  try {
    const raw = fs.readFileSync(0, 'utf8');
    if (!raw.trim()) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function resolveTaskTarget(args) {
  const task = args.task;
  const hookInput = readHookInputFromStdin();
  const toolInput = hookInput.tool_input || {};

  const candidatePath = args.file || toolInput.file_path || '';
  const cwd = args.cwd || hookInput.cwd || process.cwd();
  const absolutePath = candidatePath
    ? path.resolve(cwd, candidatePath)
    : '';

  return {
    task,
    cwd,
    filePath: absolutePath
  };
}

function loadState(filePath) {
  try {
    if (!fs.existsSync(filePath)) return {};
    const raw = fs.readFileSync(filePath, 'utf8').trim();
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function saveState(filePath, state) {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(state), 'utf8');
  } catch {
    // Silent fail for non-critical state persistence.
  }
}

function pruneState(state, nowMs, ttlMs) {
  const result = {};
  for (const [key, value] of Object.entries(state)) {
    if (!Number.isFinite(value)) continue;
    if (nowMs - value <= ttlMs) {
      result[key] = value;
    }
  }
  return result;
}

function acquireLock(lockFilePath) {
  try {
    const fd = fs.openSync(lockFilePath, 'wx');
    return fd;
  } catch (err) {
    if (!err || err.code !== 'EEXIST') return null;

    try {
      const stats = fs.statSync(lockFilePath);
      const ageMs = Date.now() - stats.mtimeMs;
      if (ageMs > getLockStaleMs()) {
        fs.unlinkSync(lockFilePath);
        const fd = fs.openSync(lockFilePath, 'wx');
        return fd;
      }
    } catch {
      // Ignore stale-lock cleanup failures.
    }

    return null;
  }
}

function releaseLock(fd, lockFilePath) {
  try {
    if (typeof fd === 'number') {
      fs.closeSync(fd);
    }
  } catch {
    // ignore
  }

  try {
    if (fs.existsSync(lockFilePath)) {
      fs.unlinkSync(lockFilePath);
    }
  } catch {
    // ignore
  }
}

function shouldRunTask(task, absoluteFilePath) {
  if (!task || !absoluteFilePath) return false;

  const stateFile = getDebounceStateFile();
  const lockFile = `${stateFile}.lock`;
  const lockFd = acquireLock(lockFile);

  // Another process is updating the state; skip this run to avoid duplicate work.
  if (lockFd === null) {
    return false;
  }

  try {
    const nowMs = Date.now();
    const state = loadState(stateFile);
    const cleanState = pruneState(state, nowMs, getStateTtlMs());

    const key = `${task}:${absoluteFilePath}`;
    const debounceWindowMs = getDebounceWindowMs(task);
    const lastRunAt = Number(cleanState[key] || 0);

    if (lastRunAt > 0 && nowMs - lastRunAt < debounceWindowMs) {
      saveState(stateFile, cleanState);
      return false;
    }

    const nextState = {
      ...cleanState,
      [key]: nowMs
    };
    saveState(stateFile, nextState);
    return true;
  } finally {
    releaseLock(lockFd, lockFile);
  }
}

function runPrettier(filePath, cwd) {
  if (!/\.(ts|tsx|js|jsx)$/.test(filePath)) {
    return;
  }

  execFileSync(getNpxBinary(), ['prettier', '--write', filePath], {
    cwd,
    stdio: ['ignore', 'ignore', 'ignore'],
    timeout: 15000
  });
}

function findNearestTsconfig(startFilePath) {
  let currentDir = path.dirname(startFilePath);
  const root = path.parse(currentDir).root;
  let depth = 0;

  while (depth < 20) {
    if (fs.existsSync(path.join(currentDir, 'tsconfig.json'))) {
      return currentDir;
    }

    if (currentDir === root) {
      break;
    }

    currentDir = path.dirname(currentDir);
    depth += 1;
  }

  return null;
}

function runTypecheck(filePath) {
  if (!/\.(ts|tsx)$/.test(filePath)) {
    return;
  }

  const tsconfigDir = findNearestTsconfig(filePath);
  if (!tsconfigDir) {
    return;
  }

  execFileSync(getNpxBinary(), ['tsc', '--noEmit', '--pretty', 'false'], {
    cwd: tsconfigDir,
    stdio: ['ignore', 'ignore', 'ignore'],
    timeout: 45000
  });
}

function runTask(task, filePath, cwd) {
  if (task === 'format') {
    runPrettier(filePath, cwd);
    return;
  }

  if (task === 'typecheck') {
    runTypecheck(filePath);
  }
}

function shouldHandleFile(task, filePath) {
  if (task === 'format') {
    return /\.(ts|tsx|js|jsx)$/.test(filePath);
  }
  if (task === 'typecheck') {
    return /\.(ts|tsx)$/.test(filePath);
  }
  return false;
}

function main() {
  const args = parseArgs(process.argv);
  const target = resolveTaskTarget(args);
  const task = target.task;
  const filePath = target.filePath;
  const cwd = target.cwd;

  if (!task || !filePath) {
    process.exit(0);
    return;
  }

  if (!fs.existsSync(filePath)) {
    process.exit(0);
    return;
  }

  if (!shouldHandleFile(task, filePath)) {
    process.exit(0);
    return;
  }

  if (!shouldRunTask(task, filePath)) {
    process.exit(0);
    return;
  }

  try {
    runTask(task, filePath, cwd);
  } catch {
    // Async worker must fail silently.
  }

  process.exit(0);
}

main();
