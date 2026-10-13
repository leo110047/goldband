const { getPersistentDataPath } = require('../utils');
const {
  appendRetainedJsonl,
  envFlagEnabled,
  parsePositiveInt,
} = require('./retained-jsonl');

const DEFAULT_MAX_BYTES = 1024 * 1024;
const DEFAULT_RETENTION_DAYS = 7;

function metricsEnabled() {
  return envFlagEnabled(process.env.HOOK_ROUTER_METRICS_ENABLED);
}

function getMetricsFile() {
  return (
    process.env.HOOK_ROUTER_METRICS_FILE ||
    getPersistentDataPath('hook-router', 'metrics.jsonl')
  );
}

function appendMetric(entry) {
  if (!metricsEnabled()) return;

  appendRetainedJsonl(
    getMetricsFile(),
    { ...entry, recordedAt: new Date().toISOString() },
    {
      maxBytes: parsePositiveInt(
        process.env.HOOK_ROUTER_METRICS_MAX_BYTES,
        DEFAULT_MAX_BYTES,
      ),
      retentionDays: parsePositiveInt(
        process.env.HOOK_ROUTER_METRICS_RETENTION_DAYS,
        DEFAULT_RETENTION_DAYS,
      ),
    },
  );
}

module.exports = {
  appendMetric,
  getMetricsFile,
  metricsEnabled,
};
