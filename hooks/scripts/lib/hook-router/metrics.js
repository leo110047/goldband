const fs = require('fs');
const path = require('path');
const { ensureDir, getTempDir } = require('../utils');

const DEFAULT_MAX_BYTES = 1024 * 1024;
const DEFAULT_RETENTION_DAYS = 7;

function parsePositiveInt(value, fallback) {
  const parsed = parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function metricsEnabled() {
  const flag = String(process.env.HOOK_ROUTER_METRICS_ENABLED || '0').toLowerCase();
  return flag === '1' || flag === 'true' || flag === 'yes';
}

function getMetricsFile() {
  return process.env.HOOK_ROUTER_METRICS_FILE || path.join(getTempDir(), 'goldband-hook-router-metrics.jsonl');
}

function rotateIfOversized(metricsFile) {
  try {
    if (!fs.existsSync(metricsFile)) return;

    const maxBytes = parsePositiveInt(process.env.HOOK_ROUTER_METRICS_MAX_BYTES, DEFAULT_MAX_BYTES);
    const stats = fs.statSync(metricsFile);
    if (stats.size < maxBytes) return;

    const rotatedFile = `${metricsFile}.${Date.now()}`;
    fs.renameSync(metricsFile, rotatedFile);
  } catch {
    // Silent fail
  }
}

function cleanupExpiredMetrics(metricsFile) {
  try {
    const retentionDays = parsePositiveInt(
      process.env.HOOK_ROUTER_METRICS_RETENTION_DAYS,
      DEFAULT_RETENTION_DAYS
    );
    const retentionMs = retentionDays * 24 * 60 * 60 * 1000;
    const nowMs = Date.now();
    const directory = path.dirname(metricsFile);
    const baseName = path.basename(metricsFile);
    const prefix = `${baseName}.`;

    const files = fs.readdirSync(directory);
    for (const file of files) {
      if (!file.startsWith(prefix)) continue;
      const fullPath = path.join(directory, file);

      try {
        const stats = fs.statSync(fullPath);
        if (nowMs - stats.mtimeMs > retentionMs) {
          fs.unlinkSync(fullPath);
        }
      } catch {
        // ignore one-file failure and continue.
      }
    }
  } catch {
    // Silent fail
  }
}

function appendMetric(entry) {
  if (!metricsEnabled()) return;

  const metricsFile = getMetricsFile();
  const payload = {
    ...entry,
    recordedAt: new Date().toISOString()
  };

  try {
    ensureDir(path.dirname(metricsFile));
    rotateIfOversized(metricsFile);
    cleanupExpiredMetrics(metricsFile);
    fs.appendFileSync(metricsFile, JSON.stringify(payload) + '\n', 'utf8');
  } catch {
    // Silent fail: metrics collection must never block hook execution.
  }
}

module.exports = {
  appendMetric,
  getMetricsFile,
  metricsEnabled
};
