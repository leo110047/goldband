const fs = require('fs');
const path = require('path');
const os = require('os');

function getTempDir() {
  return os.tmpdir();
}

function envPath(name) {
  const raw = process.env[name];
  return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : null;
}

/**
 * Get the plugin data directory when Claude exposes it.
 * Returns null when the runtime does not provide a stable plugin data path.
 */
function getPluginDataDir() {
  return envPath('CLAUDE_PLUGIN_DATA');
}

/** Durable data roots in precedence order; temp storage is the last resort. */
function dataRootCandidates() {
  const xdgDataHome = envPath('XDG_DATA_HOME');
  return [
    getPluginDataDir(),
    envPath('GOLDBAND_DATA_DIR'),
    xdgDataHome ? path.join(xdgDataHome, 'goldband') : null,
    path.join(os.homedir(), '.local', 'share', 'goldband'),
    path.join(getTempDir(), 'goldband'),
  ].filter(Boolean);
}

/**
 * Get a persistent data directory for this plugin namespace.
 * Uses the first data root that can be created, so an unusable configured root
 * falls through to the next durable location before temp storage.
 */
function getPersistentDataDir(namespace = 'goldband') {
  const safeNamespace = String(namespace || 'goldband')
    .split(/[\\/]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && part !== '.' && part !== '..')
    .map((part) => part.replace(/[^a-zA-Z0-9._-]/g, '-'))
    .filter(Boolean);
  const normalizedNamespace =
    safeNamespace.length > 0 ? safeNamespace : ['goldband'];

  const candidates = [
    ...new Set(
      dataRootCandidates().map((root) =>
        path.join(root, ...normalizedNamespace),
      ),
    ),
  ];
  for (const candidate of candidates) {
    try {
      return ensureDir(candidate);
    } catch {
      // Try the next candidate.
    }
  }

  return candidates.at(-1);
}

function getPersistentDataPath(namespace, ...parts) {
  const baseDir = getPersistentDataDir(namespace);
  if (parts.length === 0) {
    return baseDir;
  }

  return path.join(baseDir, ...parts);
}

/**
 * Ensure a directory exists (create if not)
 * @param {string} dirPath - Directory path to create
 * @returns {string} The directory path
 * @throws {Error} If directory cannot be created (e.g., permission denied)
 */
function ensureDir(dirPath) {
  try {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  } catch (err) {
    // EEXIST is fine (race condition with another process creating it)
    if (err.code !== 'EEXIST') {
      throw new Error(
        `Failed to create directory '${dirPath}': ${err.message}`,
      );
    }
  }
  return dirPath;
}

/**
 * Read JSON from stdin (for hook input)
 * @param {object} options - Options
 * @param {number} options.timeoutMs - Timeout in milliseconds (default: 5000).
 *   Prevents hooks from hanging indefinitely if stdin never closes.
 * @returns {Promise<object>} Parsed JSON object, or empty object if stdin is empty
 */
async function readStdinJson(options = {}) {
  const { timeoutMs = 5000, maxSize = 1024 * 1024 } = options;

  return new Promise((resolve) => {
    let data = '';
    let settled = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(parseJsonOrEmpty(data));
    };

    const timer = setTimeout(() => {
      if (settled) return;
      process.stdin.removeAllListeners('data');
      process.stdin.removeAllListeners('end');
      process.stdin.removeAllListeners('error');
      if (process.stdin.unref) process.stdin.unref();
      finish();
    }, timeoutMs);

    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      if (data.length < maxSize) {
        data += chunk;
      }
    });

    process.stdin.on('end', () => {
      finish();
    });

    process.stdin.on('error', () => {
      finish();
    });
  });
}

function parseJsonOrEmpty(data) {
  try {
    return data.trim() ? JSON.parse(data) : {};
  } catch {
    return {};
  }
}

/**
 * Read a text file safely
 */
function readFile(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Write a text file
 */
function writeFile(filePath, content) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, 'utf8');
}

module.exports = {
  getPersistentDataPath,
  getPluginDataDir,
  readFile,
  readStdinJson,
  writeFile,
};
