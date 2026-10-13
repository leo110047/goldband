const fs = require('fs');
const path = require('path');

// Append-only JSONL logs with size rotation and age-based cleanup of rotated
// files. Shared by Claude and Codex hook telemetry; it must never block hooks.

const DAY_MS = 24 * 60 * 60 * 1000;

function parsePositiveInt(value, fallback) {
  const parsed = parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function envFlagEnabled(value) {
  const flag = String(value ?? '1').toLowerCase();
  return flag === '1' || flag === 'true' || flag === 'yes';
}

function rotateIfOversized(filePath, maxBytes) {
  if (!fs.existsSync(filePath)) return;
  if (fs.statSync(filePath).size < maxBytes) return;
  fs.renameSync(filePath, `${filePath}.${Date.now()}`);
}

function cleanupExpiredRotations(filePath, retentionDays) {
  const retentionMs = retentionDays * DAY_MS;
  const nowMs = Date.now();
  const directory = path.dirname(filePath);
  const prefix = `${path.basename(filePath)}.`;
  for (const entry of fs.readdirSync(directory)) {
    if (!entry.startsWith(prefix)) continue;
    const rotatedPath = path.join(directory, entry);
    try {
      if (nowMs - fs.statSync(rotatedPath).mtimeMs > retentionMs) {
        fs.unlinkSync(rotatedPath);
      }
    } catch {
      // Ignore one-file cleanup failures.
    }
  }
}

function appendRetainedJsonl(filePath, payload, { maxBytes, retentionDays }) {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    try {
      rotateIfOversized(filePath, maxBytes);
      cleanupExpiredRotations(filePath, retentionDays);
    } catch {
      // Retention is best effort; still record the event.
    }
    fs.appendFileSync(filePath, `${JSON.stringify(payload)}\n`, 'utf8');
  } catch {
    // Telemetry must never block hook execution.
  }
}

module.exports = {
  appendRetainedJsonl,
  envFlagEnabled,
  parsePositiveInt,
};
