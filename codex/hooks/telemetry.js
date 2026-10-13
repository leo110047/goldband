const path = require('path');
const { requireFirst } = require('./module-loader');
const {
  appendRetainedJsonl,
  envFlagEnabled,
  parsePositiveInt,
} = require('./retained-jsonl');
const { getPersistentDataPath } = require('./utils');
const { buildWorkflowUsageEvents } = require('./workflow-telemetry');
function loadTelemetrySchema() {
  return requireFirst([
    path.resolve(
      __dirname,
      '..',
      '..',
      'scripts',
      'lib',
      'telemetry-schema.cjs',
    ),
    path.resolve(__dirname, 'telemetry-schema.cjs'),
  ]);
}

const { normalizeUsageEvent, resolveRunId } = loadTelemetrySchema();

const DEFAULT_MAX_BYTES = 1024 * 1024;
const DEFAULT_RETENTION_DAYS = 30;
const TELEMETRY_SOURCE = 'codex/hooks/hook-router.js';

function usageTelemetryEnabled() {
  return envFlagEnabled(process.env.GOLDBAND_USAGE_TELEMETRY_ENABLED);
}

function usageFile() {
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
  appendRetainedJsonl(usageFile(), payload, {
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

// Codex hooks ignore CLAUDE_SESSION_ID so a Codex run launched from a Claude
// session is attributed to its own Codex session.
function codexUsageContext(input) {
  return {
    host: 'codex',
    source: TELEMETRY_SOURCE,
    runId: resolveRunId(input, {
      GOLDBAND_RUN_ID: process.env.GOLDBAND_RUN_ID,
      GOLDBAND_RUN_ID_FILE: process.env.GOLDBAND_RUN_ID_FILE,
      CODEX_SESSION_ID: process.env.CODEX_SESSION_ID,
    }),
    sessionId:
      input.session_id ||
      input.sessionId ||
      process.env.CODEX_SESSION_ID ||
      null,
  };
}

function workflowUsageEvents(input) {
  return buildWorkflowUsageEvents(input, codexUsageContext(input));
}

function isDenyResult(result) {
  const output = result?.hookSpecificOutput || {};
  return (
    result?.decision === 'block' ||
    output.permissionDecision === 'deny' ||
    output.decision?.behavior === 'deny'
  );
}

function denyReason(result) {
  const output = result?.hookSpecificOutput || {};
  return (
    result?.reason ||
    output.permissionDecisionReason ||
    output.decision?.message ||
    result?.systemMessage ||
    ''
  );
}

function structuredTelemetryName(result) {
  const name = result?.internalTelemetry?.name;
  return typeof name === 'string' && name.trim() ? name.trim() : null;
}

function denyNameFromReason(reason, fallback) {
  const text = String(reason || '');
  if (/Recursive force deletion/i.test(text)) return 'recursive-force-delete';
  if (/git clean/i.test(text)) return 'destructive-git-clean';
  if (/secret|private key/i.test(text)) return 'secret-detector';
  if (/\.git internals/i.test(text)) return 'git-internals';
  if (/sudo commands/i.test(text)) return 'sudo-command';
  if (/downloaded code directly into a shell/i.test(text)) {
    return 'curl-pipe-shell';
  }
  if (/Disk formatting|partition/i.test(text)) return 'disk-formatting';
  if (/Destructive git history/i.test(text)) return 'destructive-git-history';
  if (/credential files/i.test(text)) return 'credential-file-read';
  if (/full environment/i.test(text)) return 'environment-dump';
  if (/keychain/i.test(text)) return 'keychain-read';
  return fallback;
}

function isAdvisoryResult(result) {
  const output = result?.hookSpecificOutput || {};
  return Boolean(result?.systemMessage || output.additionalContext);
}

function startSource(input) {
  return (
    input.start_source ||
    input.startSource ||
    input.session_start_source ||
    input.sessionStartSource ||
    input.hook_event_source ||
    input.hookEventSource ||
    null
  );
}

function hookOutcomeUsageEvents(input, result) {
  if (!result) return [];

  const context = codexUsageContext(input);
  const base = {
    run_id: context.runId,
    source: context.source,
    sessionId: context.sessionId,
    detail: {
      host: 'codex',
      hookEventName: input.hook_event_name || 'unknown',
      toolName: input.tool_name || null,
      startSource: startSource(input),
    },
  };

  if (isDenyResult(result)) {
    const fallbackName = input.hook_event_name || 'unknown';
    return [
      {
        ...base,
        category: 'hook-decision',
        name:
          structuredTelemetryName(result) ||
          denyNameFromReason(denyReason(result), fallbackName),
        action: 'deny',
      },
    ];
  }

  if (!isAdvisoryResult(result)) return [];

  return [
    {
      ...base,
      category: 'hook-advisory',
      name: input.hook_event_name || 'unknown',
      action: 'emit',
    },
  ];
}

function recordHookTelemetry(input, result) {
  for (const event of [
    ...workflowUsageEvents(input),
    ...hookOutcomeUsageEvents(input, result),
  ]) {
    appendUsageEvent(event);
  }
}

module.exports = {
  appendUsageEvent,
  hookOutcomeUsageEvents,
  recordHookTelemetry,
  usageFile,
  workflowUsageEvents,
};
