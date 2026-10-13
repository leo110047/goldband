const path = require('path');

const {
  getPersistentDataPath,
  getPluginDataDir,
  readFile,
  writeFile,
} = require('../utils');

const DEFAULT_SESSION_ID = 'default';

function normalizeSessionId(sessionId) {
  const raw = String(
    sessionId || process.env.CLAUDE_SESSION_ID || DEFAULT_SESSION_ID,
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

function parseModeState(raw, sessionId, filePath) {
  if (!raw) {
    return buildEmptyState(sessionId, filePath);
  }

  try {
    const parsed = JSON.parse(raw);
    const parsedModes =
      parsed && typeof parsed.modes === 'object' && !Array.isArray(parsed.modes)
        ? parsed.modes
        : {};

    return {
      sessionId: normalizeSessionId(parsed.sessionId || sessionId),
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : null,
      modes: parsedModes,
      filePath,
      storageSource: detectStorageSource(filePath),
    };
  } catch {
    return buildEmptyState(sessionId, filePath);
  }
}

function readModeState(sessionId) {
  const normalizedSessionId = normalizeSessionId(sessionId);
  const filePath = resolveModeStateFile(normalizedSessionId);
  const raw = readFile(filePath);
  return parseModeState(raw, normalizedSessionId, filePath);
}

function writeModeState(sessionId, modes) {
  const current = readModeState(sessionId);
  const nextState = {
    sessionId: current.sessionId,
    updatedAt: new Date().toISOString(),
    modes,
  };

  writeFile(current.filePath, JSON.stringify(nextState, null, 2) + '\n');

  return {
    ...nextState,
    filePath: current.filePath,
    storageSource: current.storageSource,
  };
}

function setModeActive(sessionId, modeName, active, metadata = {}) {
  const current = readModeState(sessionId);
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

  return writeModeState(current.sessionId, {
    ...current.modes,
    [modeName]: nextMode,
  });
}

function isModeActive(sessionId, modeName) {
  const state = readModeState(sessionId);
  return Boolean(state.modes[modeName] && state.modes[modeName].active);
}

function getActiveModes(sessionId) {
  const state = readModeState(sessionId);
  return Object.entries(state.modes)
    .filter(([, value]) => value && value.active)
    .map(([name]) => name)
    .sort();
}

module.exports = {
  normalizeSessionId,
  readModeState,
  setModeActive,
  isModeActive,
  getActiveModes,
};
