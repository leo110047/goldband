const fs = require('fs');
const path = require('path');

const { getPersistentDataPath, getPluginDataDir } = require('../utils');

const DEFAULT_SESSION_ID = 'default';

function normalizeSessionId(sessionId) {
  const raw = String(
    sessionId ||
      process.env.CLAUDE_CODE_SESSION_ID ||
      process.env.CLAUDE_SESSION_ID ||
      DEFAULT_SESSION_ID,
  ).trim();
  const normalized = raw.length > 0 ? raw : DEFAULT_SESSION_ID;
  return normalized.replace(/[^a-zA-Z0-9._-]/g, '-');
}

function resolveModeStateFile(sessionId) {
  const override =
    typeof process.env.HOOK_ROUTER_MODE_STATE_FILE === 'string'
      ? process.env.HOOK_ROUTER_MODE_STATE_FILE.trim()
      : '';

  if (override.length > 0) {
    return override;
  }

  const safeSessionId = normalizeSessionId(sessionId);
  return getPersistentDataPath(
    'hook-router',
    'modes',
    `session-${safeSessionId}.json`,
  );
}

function detectStorageSource(filePath) {
  const pluginDataDir = getPluginDataDir();
  if (!pluginDataDir) {
    return 'temp-fallback';
  }

  const resolvedFilePath = path.resolve(filePath);
  const resolvedPluginDataDir = path.resolve(pluginDataDir);
  return resolvedFilePath === resolvedPluginDataDir ||
    resolvedFilePath.startsWith(`${resolvedPluginDataDir}${path.sep}`)
    ? 'CLAUDE_PLUGIN_DATA'
    : 'temp-fallback';
}

function buildEmptyState(sessionId, filePath) {
  return {
    sessionId: normalizeSessionId(sessionId),
    updatedAt: null,
    modes: {},
    filePath,
    storageSource: detectStorageSource(filePath),
  };
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

const RESET_HINT = "delete it to reset this session's modes";

function readModeStateFile(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return null;
    }
    throw new Error(
      `Unable to read mode state file ${filePath}: ${error.message}; ${RESET_HINT}`,
    );
  }
}

function parseModeState(raw, sessionId, filePath) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Mode state file ${filePath} is not valid JSON: ${error.message}; ${RESET_HINT}`,
    );
  }
  if (!isPlainObject(parsed) || !isPlainObject(parsed.modes)) {
    throw new Error(
      `Mode state file ${filePath} has no modes object; ${RESET_HINT}`,
    );
  }

  return {
    sessionId: normalizeSessionId(parsed.sessionId || sessionId),
    updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : null,
    modes: parsed.modes,
    filePath,
    storageSource: detectStorageSource(filePath),
  };
}

/** Reads mode state; throws when the file exists but is unreadable or corrupt. */
function loadModeState(sessionId) {
  const normalizedSessionId = normalizeSessionId(sessionId);
  const filePath = resolveModeStateFile(normalizedSessionId);
  const raw = readModeStateFile(filePath);
  return raw === null
    ? buildEmptyState(normalizedSessionId, filePath)
    : parseModeState(raw, normalizedSessionId, filePath);
}

// Hook policy reads treat unreadable or corrupt state as no active modes;
// hooks are not an authorization boundary (docs/DECISIONS.md).
function readModeState(sessionId) {
  try {
    return loadModeState(sessionId);
  } catch {
    const normalizedSessionId = normalizeSessionId(sessionId);
    return buildEmptyState(
      normalizedSessionId,
      resolveModeStateFile(normalizedSessionId),
    );
  }
}

// Written whole through a rename, so a concurrent strict read never sees a
// partial file.
function writeModeState(current, modes) {
  const nextState = {
    sessionId: current.sessionId,
    updatedAt: new Date().toISOString(),
    modes,
  };

  fs.mkdirSync(path.dirname(current.filePath), { recursive: true });
  const tempPath = `${current.filePath}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(
      tempPath,
      JSON.stringify(nextState, null, 2) + '\n',
      'utf8',
    );
    fs.renameSync(tempPath, current.filePath);
  } catch (error) {
    fs.rmSync(tempPath, { force: true });
    throw error;
  }

  return {
    ...nextState,
    filePath: current.filePath,
    storageSource: current.storageSource,
  };
}

function applyMode(current, modeName, active, metadata) {
  const existingMode =
    current.modes[modeName] && typeof current.modes[modeName] === 'object'
      ? current.modes[modeName]
      : {};
  const now = new Date().toISOString();

  const nextMode = active
    ? {
        ...existingMode,
        ...metadata,
        active: true,
        enabledAt: existingMode.enabledAt || now,
        disabledAt: null,
        updatedAt: now,
      }
    : {
        ...existingMode,
        ...metadata,
        active: false,
        disabledAt: now,
        updatedAt: now,
      };

  return writeModeState(current, {
    ...current.modes,
    [modeName]: nextMode,
  });
}

function setModeActive(sessionId, modeName, active, metadata = {}) {
  return applyMode(readModeState(sessionId), modeName, active, metadata);
}

// For explicit mode changes: refuses to replace a file that exists but cannot
// be read. Hook callers use setModeActive, whose reads treat that file as no
// active mode.
function setModeActiveStrict(sessionId, modeName, active, metadata = {}) {
  return applyMode(loadModeState(sessionId), modeName, active, metadata);
}

function isModeActive(sessionId, modeName) {
  const state = readModeState(sessionId);
  return Boolean(state.modes[modeName] && state.modes[modeName].active);
}

function activeModeNames(state) {
  return Object.entries(state.modes)
    .filter(([, value]) => value && value.active)
    .map(([name]) => name)
    .sort();
}

module.exports = {
  activeModeNames,
  normalizeSessionId,
  loadModeState,
  setModeActive,
  setModeActiveStrict,
  isModeActive,
};
