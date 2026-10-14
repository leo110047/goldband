import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const defaultRoot = path.resolve(moduleDir, '../../..');

const cwdRepoRoot = findCwdRepoRoot();
export const cwdInGitRepo = cwdRepoRoot !== null;
export const repoRoot = cwdRepoRoot ?? defaultRoot;

export const config = {
  maxFileLines: parsePositiveInt('GOLDBAND_MAX_FILE_LINES', 600),
  maxFunctionLines: parsePositiveInt('GOLDBAND_MAX_FN_LINES', 50),
  maxParams: parsePositiveInt('GOLDBAND_MAX_PARAMS', 4),
  maxComplexity: parsePositiveInt('GOLDBAND_MAX_COMPLEXITY', 12),
  maxTextBytes: parsePositiveInt('GOLDBAND_MAX_TEXT_FILE_BYTES', 1024 * 1024),
  maxGeneratedTextBytes: parsePositiveInt(
    'GOLDBAND_MAX_GENERATED_TEXT_FILE_BYTES',
    16 * 1024 * 1024,
  ),
  maxBinaryBytes: parsePositiveInt(
    'GOLDBAND_MAX_BINARY_FILE_BYTES',
    512 * 1024,
  ),
};

export class UsageError extends Error {}

export class ToolError extends Error {
  constructor(message, detail = '') {
    super(message);
    this.detail = detail;
  }
}

export function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: options.cwd || repoRoot,
    encoding: options.encoding || 'utf8',
    maxBuffer: options.maxBuffer || 10 * 1024 * 1024,
    input: options.input,
  });
}

function findCwdRepoRoot() {
  const result = spawnSync('git', ['rev-parse', '--show-toplevel'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  if (result.status === 0 && result.stdout.trim()) {
    return result.stdout.trim();
  }
  return null;
}

function parsePositiveInt(name, fallback) {
  const value = Number.parseInt(process.env[name] || String(fallback), 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
