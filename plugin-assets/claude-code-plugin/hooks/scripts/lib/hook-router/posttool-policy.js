const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { getPersistentDataPath, writeFile } = require('../utils');
const { reviewLaunchAdvisory } = require('./review-launch-advisory');

function parseThreshold(envName, fallback) {
  const parsed = parseInt(process.env[envName] || String(fallback), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function getContextStateFile(sessionId) {
  if (process.env.HOOK_ROUTER_CONTEXT_STATE_FILE) {
    return process.env.HOOK_ROUTER_CONTEXT_STATE_FILE;
  }

  const safeSessionId = String(sessionId || 'default').replace(
    /[^a-zA-Z0-9_-]/g,
    '_',
  );
  return getPersistentDataPath('hook-router', `context-${safeSessionId}.json`);
}

function loadContextState(stateFile) {
  try {
    if (!fs.existsSync(stateFile)) {
      return { count: 0, lastSeverity: 'none' };
    }

    const raw = fs.readFileSync(stateFile, 'utf8').trim();
    if (!raw) {
      return { count: 0, lastSeverity: 'none' };
    }

    const parsed = JSON.parse(raw);
    return {
      count: Number(parsed.count || 0),
      lastSeverity: parsed.lastSeverity || 'none',
    };
  } catch {
    return { count: 0, lastSeverity: 'none' };
  }
}

function evaluateContextWarning(input) {
  const warnThreshold = parseThreshold('CONTEXT_WARN_THRESHOLD', 60);
  const criticalThreshold = parseThreshold('CONTEXT_CRIT_THRESHOLD', 85);
  const sessionId =
    input.session_id || process.env.CLAUDE_SESSION_ID || 'default';

  const stateFile = getContextStateFile(sessionId);
  const state = loadContextState(stateFile);
  const count = state.count + 1;

  const severity =
    count >= criticalThreshold
      ? 'CRITICAL'
      : count >= warnThreshold
        ? 'WARNING'
        : 'none';

  const shouldNotify = severity !== 'none' && severity !== state.lastSeverity;

  const nextState = {
    count,
    lastSeverity: severity,
  };

  try {
    writeFile(stateFile, JSON.stringify(nextState));
  } catch {
    // Fail-open: context metrics are best-effort only.
  }

  if (!shouldNotify) {
    return null;
  }

  if (severity === 'CRITICAL') {
    return `[ContextMonitor] CRITICAL: ${count} tool calls — context likely saturated. Run /compact now.`;
  }
  return `[ContextMonitor] WARNING: ${count} tool calls — consider /compact before context-heavy tasks.`;
}

function repoRootFromPolicy() {
  return path.resolve(__dirname, '../../../..');
}

function formatStyleGateIssue(issue) {
  const location = issue.file
    ? `${issue.file}${issue.line ? `:${issue.line}` : ''}`
    : 'repo';
  return `[${issue.rule}] ${location}: ${issue.message}`;
}

function collectStyleGateWarnings(filePath) {
  if (!filePath) return [];

  const repoRoot = repoRootFromPolicy();
  const scriptPath = path.join(repoRoot, 'scripts', 'check-code-style.mjs');
  if (!fs.existsSync(scriptPath)) return [];

  const result = spawnSync(
    process.execPath,
    [scriptPath, '--files', filePath, '--format', 'json'],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      maxBuffer: 5 * 1024 * 1024,
      env: { ...process.env, GOLDBAND_STYLE_GATE_HOST: '1' },
    },
  );

  if (result.error) {
    return [
      `[Hook] WARNING: style gate advisory failed: ${result.error.message}`,
    ];
  }
  if (result.status === 2) {
    return [
      '[Hook] WARNING: style gate advisory could not run',
      result.stderr.trim(),
    ].filter(Boolean);
  }
  if (!result.stdout.trim()) return [];

  try {
    const parsed = JSON.parse(result.stdout);
    const issues = [...(parsed.violations || []), ...(parsed.advisories || [])];
    if (issues.length === 0) return [];
    return [
      `[Hook] WARNING: goldband style gate advisory for ${filePath}`,
      ...issues.slice(0, 8).map(formatStyleGateIssue),
      '[Hook] These warnings are advisory here; pre-commit enforces blocking rules.',
    ];
  } catch {
    return ['[Hook] WARNING: style gate advisory returned invalid JSON'];
  }
}

function evaluatePostToolUse(input) {
  const toolName = input.tool_name || '';
  const toolInput = input.tool_input || {};

  const reviewAdvice = reviewLaunchAdvisory(input);
  const contextMessage =
    input.hook_event_name === 'PostToolUseFailure'
      ? null
      : evaluateContextWarning(input);
  const filePath = toolInput.file_path || '';

  const styleWarnings =
    toolName === 'Edit' || toolName === 'Write' || toolName === 'MultiEdit'
      ? collectStyleGateWarnings(filePath)
      : [];

  return {
    decision: 'allow',
    blockedBy: null,
    logs: [...styleWarnings, ...(contextMessage ? [contextMessage] : [])],
    outputJson: reviewAdvice
      ? {
          hookSpecificOutput: {
            hookEventName: input.hook_event_name,
            additionalContext: reviewAdvice,
          },
        }
      : null,
    spawnedProcesses: 0,
  };
}

module.exports = {
  evaluatePostToolUse,
};
