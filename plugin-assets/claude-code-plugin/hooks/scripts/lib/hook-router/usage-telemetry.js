const fs = require('fs');
const path = require('path');
const { ensureDir, getPersistentDataPath } = require('../utils');
const { normalizeUsageEvent } = require('../telemetry-schema.cjs');

const DEFAULT_MAX_BYTES = 1024 * 1024;
const DEFAULT_RETENTION_DAYS = 30;

function parsePositiveInt(value, fallback) {
  const parsed = parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function usageTelemetryEnabled() {
  const flag = String(
    process.env.GOLDBAND_USAGE_TELEMETRY_ENABLED ?? '1',
  ).toLowerCase();
  return flag === '1' || flag === 'true' || flag === 'yes';
}

function getUsageFile() {
  return (
    process.env.GOLDBAND_USAGE_FILE ||
    getPersistentDataPath('hook-router', 'usage-events.jsonl')
  );
}

function rotateIfOversized(usageFile) {
  try {
    if (!fs.existsSync(usageFile)) return;

    const maxBytes = parsePositiveInt(
      process.env.GOLDBAND_USAGE_MAX_BYTES,
      DEFAULT_MAX_BYTES,
    );
    const stats = fs.statSync(usageFile);
    if (stats.size < maxBytes) return;

    fs.renameSync(usageFile, `${usageFile}.${Date.now()}`);
  } catch {
    // Silent fail.
  }
}

function cleanupExpiredUsageFiles(usageFile) {
  try {
    const retentionDays = parsePositiveInt(
      process.env.GOLDBAND_USAGE_RETENTION_DAYS,
      DEFAULT_RETENTION_DAYS,
    );
    const retentionMs = retentionDays * 24 * 60 * 60 * 1000;
    const nowMs = Date.now();
    const directory = path.dirname(usageFile);
    const baseName = path.basename(usageFile);
    const prefix = `${baseName}.`;

    for (const entry of fs.readdirSync(directory)) {
      if (!entry.startsWith(prefix)) continue;

      const fullPath = path.join(directory, entry);
      try {
        const stats = fs.statSync(fullPath);
        if (nowMs - stats.mtimeMs > retentionMs) {
          fs.unlinkSync(fullPath);
        }
      } catch {
        // Ignore one-file failure.
      }
    }
  } catch {
    // Silent fail.
  }
}

function appendUsageEvent(entry) {
  if (!usageTelemetryEnabled() || !entry || typeof entry !== 'object') {
    return;
  }

  const usageFile = getUsageFile();
  const payload = normalizeUsageEvent({
    ...entry,
    recordedAt: new Date().toISOString(),
  });

  try {
    ensureDir(path.dirname(usageFile));
    rotateIfOversized(usageFile);
    cleanupExpiredUsageFiles(usageFile);
    fs.appendFileSync(usageFile, JSON.stringify(payload) + '\n', 'utf8');
  } catch {
    // Telemetry must never block the main workflow.
  }
}

module.exports = {
  appendUsageEvent,
  getUsageFile,
  usageTelemetryEnabled,
};
