const { getPersistentDataPath } = require('../utils');
const {
  normalizeUsageEvent,
  resolveRunId,
} = require('../telemetry-schema.cjs');
const {
  appendRetainedJsonl,
  envFlagEnabled,
  parsePositiveInt,
} = require('./retained-jsonl');

const DEFAULT_MAX_BYTES = 1024 * 1024;
const DEFAULT_RETENTION_DAYS = 30;

function usageTelemetryEnabled() {
  return envFlagEnabled(process.env.GOLDBAND_USAGE_TELEMETRY_ENABLED);
}

function getUsageFile() {
  return (
    process.env.GOLDBAND_USAGE_FILE ||
    getPersistentDataPath('hook-router', 'usage-events.jsonl')
  );
}

function appendUsageEvent(entry) {
  if (!usageTelemetryEnabled() || !entry || typeof entry !== 'object') {
    return;
  }

  const payload = normalizeUsageEvent({
    ...entry,
    recordedAt: new Date().toISOString(),
  });
  appendRetainedJsonl(getUsageFile(), payload, {
    maxBytes: parsePositiveInt(
      process.env.GOLDBAND_USAGE_MAX_BYTES,
      DEFAULT_MAX_BYTES,
    ),
    retentionDays: parsePositiveInt(
      process.env.GOLDBAND_USAGE_RETENTION_DAYS,
      DEFAULT_RETENTION_DAYS,
    ),
  });
}

// Event identity for Claude hooks; Codex resolves its own session environment.
function claudeUsageContext(input, source) {
  return {
    host: 'claude',
    source,
    runId: resolveRunId(input),
    sessionId:
      input.session_id ||
      input.sessionId ||
      process.env.CLAUDE_SESSION_ID ||
      process.env.CODEX_SESSION_ID ||
      null,
  };
}

module.exports = {
  appendUsageEvent,
  claudeUsageContext,
  getUsageFile,
  usageTelemetryEnabled,
};
