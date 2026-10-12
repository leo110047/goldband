const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SCHEMA_VERSION = 'goldband.telemetry.v1';
const UNKNOWN_RUN_ID = 'unknown';

const ALLOWED_CATEGORIES = new Set([
  'workflow-entry',
  'hook-decision',
  'hook-advisory',
  'prompt-trigger',
  'mode',
  'mode-enforcement',
  'test',
]);

const ALLOWED_ACTIONS = new Set([
  'invoked',
  'requested',
  'deny',
  'emit',
  'record',
  'matched',
  'suggested',
  'enable',
  'disable',
  'block',
]);
const ALLOWED_CONFIDENCE = new Set(['confirmed', 'inferred']);

function safeString(value) {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null;
}

function stableIdFrom(value, prefix) {
  const hash = crypto
    .createHash('sha256')
    .update(String(value || ''))
    .digest('hex')
    .slice(0, 24);
  return `${prefix}_${hash}`;
}

function randomEventId() {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return stableIdFrom(`${Date.now()}:${Math.random()}`, 'evt');
}

function resolveRunId(input = {}, env = process.env, fallbackRunId = null) {
  return (
    safeString(input.run_id) ||
    safeString(input.runId) ||
    safeString(input.session_id) ||
    safeString(input.sessionId) ||
    safeString(fallbackRunId) ||
    safeString(env.CLAUDE_SESSION_ID) ||
    safeString(env.CODEX_SESSION_ID) ||
    safeString(env.GOLDBAND_RUN_ID) ||
    persistentRunId(env.GOLDBAND_RUN_ID_FILE) ||
    transcriptRunId(input) ||
    UNKNOWN_RUN_ID
  );
}

function persistentRunId(filePath) {
  const resolvedPath = safeString(filePath);
  if (!resolvedPath) return null;

  try {
    if (fs.existsSync(resolvedPath)) {
      return safeString(fs.readFileSync(resolvedPath, 'utf8'));
    }
    fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
    const runId = crypto.randomUUID();
    fs.writeFileSync(resolvedPath, `${runId}\n`, { flag: 'wx' });
    return runId;
  } catch {
    return null;
  }
}

function transcriptRunId(input) {
  const transcriptPath =
    safeString(input.transcript_path) ||
    safeString(input.agent_transcript_path);
  return transcriptPath ? stableIdFrom(transcriptPath, 'transcript') : null;
}

function legacySessionId(entry) {
  return (
    safeString(entry.sessionId) ||
    safeString(entry.session_id) ||
    (safeString(entry.run_id) === UNKNOWN_RUN_ID
      ? null
      : safeString(entry.run_id))
  );
}

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function resolveEventRunId(source, options) {
  return resolveRunId(source, options.env || process.env, options.run_id);
}

function resolveEventId(source, options) {
  const existingEventId = safeString(source.event_id);
  if (existingEventId) return existingEventId;
  if (options.stableEventId) return stableIdFrom(JSON.stringify(source), 'evt');
  return randomEventId();
}

function normalizeUsageEvent(entry, options = {}) {
  const source = isPlainObject(entry) ? entry : {};
  const runId = resolveEventRunId(source, options);
  const category = safeString(source.category) || 'unknown';
  const action = safeString(source.action) || 'record';
  const detail = isPlainObject(source.detail) ? source.detail : {};

  return {
    ...source,
    schema_version: safeString(source.schema_version) || SCHEMA_VERSION,
    run_id: runId,
    event_id: resolveEventId(source, options),
    parent_event_id: safeString(source.parent_event_id) || null,
    sessionId: legacySessionId({ ...source, run_id: runId }),
    category,
    name: safeString(source.name) || 'unknown',
    action,
    source: safeString(source.source) || 'unknown',
    host: safeString(source.host) || safeString(detail.host) || 'unknown',
    detail,
  };
}

function addRequiredStringErrors(entry, errors) {
  const requiredStrings = [
    'schema_version',
    'run_id',
    'event_id',
    'category',
    'name',
    'action',
    'source',
    'host',
    'recordedAt',
  ];
  for (const key of requiredStrings) {
    if (!safeString(entry[key])) {
      errors.push(`${key} must be a non-empty string`);
    }
  }
}

function addEnumErrors(entry, errors) {
  if (entry.schema_version && entry.schema_version !== SCHEMA_VERSION) {
    errors.push(`schema_version must be ${SCHEMA_VERSION}`);
  }
  if (entry.category && !ALLOWED_CATEGORIES.has(entry.category)) {
    errors.push(`category is not in the v1 allowlist: ${entry.category}`);
  }
  if (entry.action && !ALLOWED_ACTIONS.has(entry.action)) {
    errors.push(`action is not in the v1 allowlist: ${entry.action}`);
  }
  if (
    entry.confidence !== null &&
    entry.confidence !== undefined &&
    !ALLOWED_CONFIDENCE.has(entry.confidence)
  ) {
    errors.push(`confidence is not in the v1 allowlist: ${entry.confidence}`);
  }
}

function addShapeErrors(entry, errors) {
  if (
    entry.parent_event_id !== null &&
    entry.parent_event_id !== undefined &&
    !safeString(entry.parent_event_id)
  ) {
    errors.push('parent_event_id must be null or a non-empty string');
  }
  if (entry.detail && !isPlainObject(entry.detail)) {
    errors.push('detail must be an object');
  }
  if (!isPlainObject(entry.detail)) {
    errors.push('detail is required');
  }
  if (entry.recordedAt && Number.isNaN(Date.parse(entry.recordedAt))) {
    errors.push('recordedAt must be an ISO-8601 timestamp');
  }
}

function validateUsageEvent(entry) {
  const errors = [];
  if (!isPlainObject(entry)) {
    return { valid: false, errors: ['event must be an object'] };
  }

  addRequiredStringErrors(entry, errors);
  addEnumErrors(entry, errors);
  addShapeErrors(entry, errors);

  return { valid: errors.length === 0, errors };
}

module.exports = {
  SCHEMA_VERSION,
  UNKNOWN_RUN_ID,
  ALLOWED_ACTIONS,
  ALLOWED_CATEGORIES,
  ALLOWED_CONFIDENCE,
  normalizeUsageEvent,
  resolveRunId,
  stableIdFrom,
  validateUsageEvent,
};
