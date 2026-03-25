#!/usr/bin/env node
/**
 * Unified hook router.
 *
 * Routes PreToolUse/PostToolUse/Stop/Notification through one command,
 * reducing process spawn and repeated JSON parsing.
 */

const { evaluatePreToolUse } = require('../lib/hook-router/pretool-policy');
const { evaluatePostToolUse } = require('../lib/hook-router/posttool-policy');
const { evaluateStop, evaluateNotification } = require('../lib/hook-router/stop-policy');
const { appendMetric } = require('../lib/hook-router/metrics');
const { appendUsageEvent } = require('../lib/hook-router/usage-telemetry');

const MAX_STDIN_BYTES = 1024 * 1024;

function readStdinRaw() {
  return new Promise(resolve => {
    let data = '';

    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => {
      if (data.length < MAX_STDIN_BYTES) {
        data += chunk;
      }
    });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', () => resolve(data));
  });
}

function parseInput(raw) {
  try {
    return raw.trim() ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function defaultOutcome() {
  return {
    decision: 'allow',
    blockedBy: null,
    logs: [],
    outputJson: null,
    spawnedProcesses: 0,
    usageEvents: []
  };
}

function dispatchByEvent(input) {
  const hookEventName = input.hook_event_name || '';

  if (hookEventName === 'PreToolUse') {
    return evaluatePreToolUse(input);
  }

  if (hookEventName === 'PostToolUse') {
    return evaluatePostToolUse(input);
  }

  if (hookEventName === 'Stop') {
    return evaluateStop(input);
  }

  if (hookEventName === 'Notification') {
    return evaluateNotification(input);
  }

  return defaultOutcome();
}

function writeLogs(lines) {
  for (const line of lines || []) {
    if (line) {
      console.error(line);
    }
  }
}

function writeOutput(rawInput, outputJson) {
  if (outputJson && typeof outputJson === 'object') {
    process.stdout.write(JSON.stringify(outputJson));
    return;
  }
  process.stdout.write(rawInput);
}

function buildMetric(input, outcome, durationMs) {
  const spawnedProcesses = Number(outcome.spawnedProcesses || 0);
  return {
    phase: input.hook_event_name || 'unknown',
    toolName: input.tool_name || null,
    decision: outcome.decision || 'allow',
    blockedBy: outcome.blockedBy || null,
    durationMs: Number(durationMs.toFixed(3)),
    spawnedProcesses,
    totalProcesses: 1 + spawnedProcesses,
    sessionId: input.session_id || process.env.CLAUDE_SESSION_ID || null
  };
}

async function main() {
  const rawInput = await readStdinRaw();
  const input = parseInput(rawInput);

  const startNs = process.hrtime.bigint();
  const rawOutcome = dispatchByEvent(input);
  const outcome = {
    ...defaultOutcome(),
    ...rawOutcome
  };
  const endNs = process.hrtime.bigint();

  const durationMs = Number(endNs - startNs) / 1e6;
  const metric = buildMetric(input, outcome, durationMs);

  writeLogs(outcome.logs);
  appendMetric(metric);
  for (const usageEvent of outcome.usageEvents || []) {
    appendUsageEvent(usageEvent);
  }

  if (process.env.HOOK_ROUTER_DEBUG_METRICS === '1') {
    console.error(`[HookRouterMetrics] ${JSON.stringify(metric)}`);
  }

  writeOutput(rawInput, outcome.outputJson);

  if (outcome.decision === 'block') {
    process.exit(2);
    return;
  }

  process.exit(0);
}

main().catch(error => {
  const message = error && error.stack ? error.stack : String(error || 'Unknown hook router error');
  console.error(`[HookRouterError] ${message}`);
  process.exit(1);
});
