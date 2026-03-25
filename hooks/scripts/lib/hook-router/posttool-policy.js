const fs = require("fs");
const { getPersistentDataPath, readFile, writeFile } = require("../utils");

const CONTEXT_NOTIFY_INTERVAL = 5;

function parseThreshold(envName, fallback) {
  const parsed = parseInt(process.env[envName] || String(fallback), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function getContextStateFile(sessionId) {
  if (process.env.HOOK_ROUTER_CONTEXT_STATE_FILE) {
    return process.env.HOOK_ROUTER_CONTEXT_STATE_FILE;
  }

  const safeSessionId = String(sessionId || "default").replace(
    /[^a-zA-Z0-9_-]/g,
    "_",
  );
  return getPersistentDataPath("hook-router", `context-${safeSessionId}.json`);
}

function loadContextState(stateFile) {
  try {
    if (!fs.existsSync(stateFile)) {
      return { count: 0, lastSeverity: "none", lastNotifyCount: 0 };
    }

    const raw = fs.readFileSync(stateFile, "utf8").trim();
    if (!raw) {
      return { count: 0, lastSeverity: "none", lastNotifyCount: 0 };
    }

    const parsed = JSON.parse(raw);
    return {
      count: Number(parsed.count || 0),
      lastSeverity: parsed.lastSeverity || "none",
      lastNotifyCount: Number(parsed.lastNotifyCount || 0),
    };
  } catch {
    return { count: 0, lastSeverity: "none", lastNotifyCount: 0 };
  }
}

function evaluateContextWarning(input) {
  const warnThreshold = parseThreshold("CONTEXT_WARN_THRESHOLD", 60);
  const criticalThreshold = parseThreshold("CONTEXT_CRIT_THRESHOLD", 85);
  const sessionId =
    input.session_id || process.env.CLAUDE_SESSION_ID || "default";

  const stateFile = getContextStateFile(sessionId);
  const state = loadContextState(stateFile);
  const count = state.count + 1;

  const severity =
    count >= criticalThreshold
      ? "CRITICAL"
      : count >= warnThreshold
        ? "WARNING"
        : "none";

  const escalated = severity !== "none" && severity !== state.lastSeverity;
  const debounced =
    severity !== "none" &&
    count - state.lastNotifyCount >= CONTEXT_NOTIFY_INTERVAL;
  const shouldNotify = escalated || debounced;

  const nextState = {
    count,
    lastSeverity: severity,
    lastNotifyCount: shouldNotify ? count : state.lastNotifyCount,
  };

  try {
    writeFile(stateFile, JSON.stringify(nextState));
  } catch {
    // Fail-open: context metrics are best-effort only.
  }

  if (!shouldNotify) {
    return null;
  }

  if (severity === "CRITICAL") {
    return `[ContextMonitor] CRITICAL: ${count} tool calls — context likely saturated. Run /compact now.`;
  }
  return `[ContextMonitor] WARNING: ${count} tool calls — consider /compact before context-heavy tasks.`;
}

function collectConsoleWarnings(filePath) {
  if (!filePath || !/\.(ts|tsx|js|jsx)$/.test(filePath)) {
    return [];
  }

  const content = readFile(filePath);
  if (!content) return [];

  const lines = content.split("\n");
  const matches = [];

  lines.forEach((line, index) => {
    if (/console\.log/.test(line)) {
      matches.push(`${index + 1}: ${line.trim()}`);
    }
  });

  if (matches.length === 0) {
    return [];
  }

  return [
    `[Hook] WARNING: console.log found in ${filePath}`,
    ...matches.slice(0, 5),
    "[Hook] Remove console.log before committing",
  ];
}

function buildAdditionalContext(message) {
  if (!message) return null;
  return {
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: message,
    },
  };
}

function evaluatePostToolUse(input) {
  const toolName = input.tool_name || "";
  const toolInput = input.tool_input || {};

  const contextMessage = evaluateContextWarning(input);
  const filePath = toolInput.file_path || "";

  const consoleLogs =
    toolName === "Edit" ? collectConsoleWarnings(filePath) : [];

  return {
    decision: "allow",
    blockedBy: null,
    logs: [...consoleLogs, ...(contextMessage ? [contextMessage] : [])],
    outputJson: null,
    spawnedProcesses: 0,
  };
}

module.exports = {
  evaluatePostToolUse,
};
