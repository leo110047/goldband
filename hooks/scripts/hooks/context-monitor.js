#!/usr/bin/env node
/**
 * Context Monitor Hook (PostToolUse)
 *
 * Cross-platform (Windows, macOS, Linux)
 *
 * Tracks total tool call count per session and warns when context usage is high.
 * Replaces suggest-compact.js with severity-based warnings and debounce logic.
 *
 * Thresholds (configurable via env vars):
 *   CONTEXT_WARN_THRESHOLD  — WARNING level (default: 60)
 *   CONTEXT_CRIT_THRESHOLD  — CRITICAL level (default: 85)
 *
 * Debounce: emits at most once per 5 tool calls, unless severity escalates.
 * Silent fail: never blocks tool execution (always exits 0).
 *
 * Output: JSON with additionalContext on stdout (so Claude receives the warning).
 *         Also logs to stderr (visible in terminal).
 */

const fs = require('fs');
const {
  getPersistentDataPath,
  writeFile,
  log,
  output
} = require('../lib/utils');

const DEBOUNCE_INTERVAL = 5;
const MAX_STDIN = 1024 * 1024;

function parseThreshold(envVar, fallback) {
  const raw = parseInt(process.env[envVar] || String(fallback), 10);
  return (Number.isFinite(raw) && raw > 0 && raw <= 10000) ? raw : fallback;
}

// Read and drain stdin (required for PostToolUse hooks)
let stdinData = '';
process.stdin.setEncoding('utf8');

process.stdin.on('data', chunk => {
  if (stdinData.length < MAX_STDIN) {
    stdinData += chunk;
  }
});

process.stdin.on('end', () => {
  try {
    run();
  } catch {
    // Silent fail — never block tool execution
    process.stdout.write(stdinData);
    process.exit(0);
  }
});

function run() {
  const warnThreshold = parseThreshold('CONTEXT_WARN_THRESHOLD', 60);
  const critThreshold = parseThreshold('CONTEXT_CRIT_THRESHOLD', 85);

  const sessionId = process.env.CLAUDE_SESSION_ID || 'default';
  const safeSessionId = String(sessionId).replace(/[^a-zA-Z0-9_-]/g, '_');
  const stateFile = getPersistentDataPath('hook-router', `context-monitor-${safeSessionId}.json`);

  // Read or initialize state
  let state = { count: 0, lastSeverity: 'none', lastNotifyCount: 0 };
  try {
    const fd = fs.openSync(stateFile, 'a+');
    try {
      const buf = Buffer.alloc(512);
      const bytesRead = fs.readSync(fd, buf, 0, 512, 0);
      if (bytesRead > 0) {
        const parsed = JSON.parse(buf.toString('utf8', 0, bytesRead).trim());
        if (parsed && typeof parsed.count === 'number' && parsed.count > 0 && parsed.count <= 1000000) {
          state = { ...state, ...parsed };
        }
      }
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    // Corrupted or missing — start fresh
  }

  // Increment
  const count = state.count + 1;

  // Determine current severity
  let severity = 'none';
  if (count >= critThreshold) {
    severity = 'CRITICAL';
  } else if (count >= warnThreshold) {
    severity = 'WARNING';
  }

  // Decide whether to emit a message
  const severityEscalated = severity !== 'none' && severity !== state.lastSeverity;
  const passedDebounce = severity !== 'none' && (count - state.lastNotifyCount) >= DEBOUNCE_INTERVAL;
  const shouldNotify = severityEscalated || passedDebounce;

  let lastNotifyCount = state.lastNotifyCount;
  let message = null;

  if (shouldNotify) {
    lastNotifyCount = count;
    if (severity === 'CRITICAL') {
      message = `[ContextMonitor] CRITICAL: ${count} tool calls — context is likely saturated. Run /compact now to free context.`;
    } else {
      message = `[ContextMonitor] WARNING: ${count} tool calls — consider /compact if transitioning phases.`;
    }
  }

  // Persist state
  const newState = JSON.stringify({ count, lastSeverity: severity, lastNotifyCount });
  try {
    writeFile(stateFile, newState);
  } catch {
    // Silent fail
  }

  // Output: stderr for terminal visibility + stdout JSON for Claude
  if (message) {
    log(message);
    output({ additionalContext: message });
  } else {
    process.stdout.write(stdinData);
  }

  process.exit(0);
}
