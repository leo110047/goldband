import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

import { DEFAULT_DAYS } from './constants.mjs';

const require = createRequire(import.meta.url);
const { normalizeUsageEvent } = require('../telemetry-schema.cjs');
const {
  getUsageFile,
} = require('../../../hooks/scripts/lib/hook-router/usage-telemetry.js');

export function defaultWorkflowRunsDir(env = process.env) {
  const root =
    env.GOLDBAND_HOME ||
    env.GOLDBAND_STATE_DIR ||
    env.GOLDBAND_STATE_ROOT ||
    pluginDataRoot(env) ||
    path.join(os.homedir(), '.goldband');
  return path.join(root, 'workflow-runs');
}

function resolveInputs(options = {}) {
  const usageFile = path.resolve(options.usageFile || getUsageFile());
  const workflowRunsDir = path.resolve(
    options.workflowRunsDir || defaultWorkflowRunsDir(),
  );
  return {
    usageFile,
    usageFiles: usageJsonlFiles(usageFile),
    workflowRunsDir,
    workflowRunFiles: workflowJsonlFiles(workflowRunsDir),
  };
}

export function usageJsonlFiles(usageFile) {
  const directory = path.dirname(usageFile);
  const baseName = path.basename(usageFile);
  if (!fs.existsSync(directory)) return [];

  return fs
    .readdirSync(directory)
    .filter((entry) => entry === baseName || entry.startsWith(`${baseName}.`))
    .map((entry) => path.join(directory, entry))
    .filter((file) => safeStat(file)?.isFile())
    .sort((left, right) => statMs(left) - statMs(right));
}

export function workflowJsonlFiles(workflowRunsDir) {
  if (!fs.existsSync(workflowRunsDir)) return [];
  return fs
    .readdirSync(workflowRunsDir)
    .filter((entry) => entry.endsWith('.jsonl'))
    .map((entry) => path.join(workflowRunsDir, entry))
    .filter((file) => safeStat(file)?.isFile())
    .sort();
}

export function readUsageTelemetry(options = {}) {
  const inputs = resolveInputs(options);
  const all = readFiles(
    inputs.usageFiles,
    (row) => normalizeUsageEvent(row, { stableEventId: true }),
    usageFromFile,
  );
  return {
    events: sortByTimestamp(all.rows, 'recordedAt'),
    badLineCount: all.badLineCount,
    files: inputs.usageFiles,
    requestedFile: inputs.usageFile,
  };
}

export function readWorkflowEvidence(options = {}) {
  const inputs = resolveInputs(options);
  const all = readFiles(inputs.workflowRunFiles, null, workflowFromFile);
  return {
    events: sortByTimestamp(all.rows, 'startedAt'),
    badLineCount: all.badLineCount,
    files: inputs.workflowRunFiles,
    requestedDir: inputs.workflowRunsDir,
  };
}

export function scopedRows(rows, days = DEFAULT_DAYS, key = 'recordedAt') {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return rows.filter((row) => {
    const parsed = Date.parse(
      row[key] || row.recordedAt || row.startedAt || '',
    );
    return Number.isFinite(parsed) && parsed >= cutoff;
  });
}

export function dataWindow(rows) {
  const timestamps = rows
    .map((row) => Date.parse(row.recordedAt || row.startedAt || ''))
    .filter(Number.isFinite)
    .sort((left, right) => left - right);
  if (timestamps.length === 0) {
    return { firstRecordedAt: null, lastRecordedAt: null };
  }
  return {
    firstRecordedAt: new Date(timestamps[0]).toISOString(),
    lastRecordedAt: new Date(timestamps[timestamps.length - 1]).toISOString(),
  };
}

export function increment(map, key, fields = {}) {
  const current = map.get(key) || { ...fields, count: 0 };
  current.count += 1;
  map.set(key, current);
}

export function sortedCounts(map, limit) {
  return [...map.values()]
    .sort((left, right) => {
      const countOrder = right.count - left.count;
      if (countOrder !== 0) return countOrder;
      return String(left.name || '').localeCompare(String(right.name || ''));
    })
    .slice(0, limit);
}

function dateStamp(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

export function defaultReviewDir() {
  return path.join(os.tmpdir(), `goldband-telemetry-mining-${dateStamp()}`);
}

function readFiles(files, normalize, enrich) {
  const all = { rows: [], badLineCount: 0 };
  for (const file of files) {
    const read = readJsonlFile(file, normalize);
    all.rows.push(
      ...read.rows.map((row) => (enrich ? enrich(row, file) : row)),
    );
    all.badLineCount += read.badLineCount;
  }
  return all;
}

function readJsonlFile(file, normalize) {
  if (!fs.existsSync(file)) return { rows: [], badLineCount: 0 };
  const rows = [];
  let badLineCount = 0;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      rows.push(normalize ? normalize(parsed) : parsed);
    } catch {
      badLineCount += 1;
    }
  }
  return { rows, badLineCount };
}

function workflowFromFile(row, file) {
  return {
    ...row,
    workflow: row.workflow || path.basename(file, '.jsonl'),
    __sourceFile: file,
  };
}

function usageFromFile(row, file) {
  return {
    ...row,
    __sourceFile: file,
  };
}

function sortByTimestamp(rows, key) {
  return [...rows].sort(
    (left, right) => timestamp(left, key) - timestamp(right, key),
  );
}

function timestamp(row, key) {
  const parsed = Date.parse(row[key] || row.recordedAt || row.startedAt || '');
  return Number.isFinite(parsed) ? parsed : 0;
}

function statMs(file) {
  return safeStat(file)?.mtimeMs || 0;
}

function safeStat(file) {
  try {
    return fs.statSync(file);
  } catch {
    return null;
  }
}

function pluginDataRoot(env) {
  const pluginData = env.CLAUDE_PLUGIN_DATA;
  const pluginRoot = env.CLAUDE_PLUGIN_ROOT;
  if (typeof pluginData !== 'string' || pluginData.trim().length === 0) {
    return null;
  }
  if (
    typeof pluginRoot === 'string' &&
    pluginRoot.toLowerCase().includes('goldband')
  ) {
    return pluginData;
  }
  return null;
}
