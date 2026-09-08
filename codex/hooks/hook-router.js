#!/usr/bin/env node

const MAX_STDIN_BYTES = 1024 * 1024;
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { requireFirst } = require('./module-loader');
const {
  classifyHighRiskToolUse,
  findHighRiskBash,
  findHighRiskPatch,
} = require('./high-risk-policy');
const { recordHookTelemetry } = require('./telemetry');
const { reviewLaunchAdvisory } = require('./review-launch-advisory');
function loadCrossReviewGate() {
  return requireFirst([
    path.resolve(
      __dirname,
      '..',
      '..',
      'hooks',
      'scripts',
      'lib',
      'hook-router',
      'cross-review-gate.js',
    ),
    path.resolve(__dirname, 'cross-review-gate.js'),
  ]);
}

const { armFromPrompt, evaluateCrossReviewGate } = loadCrossReviewGate();

const ADVISORY_SECRET_PATTERNS = [
  /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{24,}\b/,
  /(?:api[_-]?key|api[_-]?secret|access[_-]?token|auth[_-]?token)\s*[=:]\s*['"][A-Za-z0-9_-]{20,}['"]/i,
];
const CODEX_STOP_BLOCK_EXIT_CODE = 2;

let workflowHints;

function loadWorkflowHints() {
  if (!workflowHints) {
    workflowHints = require('./capability-routing.generated.json');
  }
  return workflowHints;
}

function workflowTriggerMatches(prompt, trigger) {
  const normalizedPrompt = String(prompt || '').toLowerCase();
  const normalizedTrigger = String(trigger || '')
    .trim()
    .toLowerCase();
  if (!normalizedTrigger) return false;

  if (!/^[a-z0-9]+(?:[\s-]+[a-z0-9]+)*$/.test(normalizedTrigger)) {
    return normalizedPrompt.includes(normalizedTrigger);
  }

  const escaped = normalizedTrigger
    .split(/\s+/)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('\\s+');
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?=$|[^a-z0-9])`).test(
    normalizedPrompt,
  );
}

function hasExplicitWorkflowInvocation(prompt) {
  return (
    /\$goldband\s+[a-z][a-z0-9-]*\s+[a-z][a-z0-9-]*/i.test(prompt) ||
    /(?:^|\s)\/plan\b/i.test(prompt)
  );
}

function readStdinRaw() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
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

function writeJson(value) {
  const { internalTelemetry: _internalTelemetry, ...publicValue } = value || {};
  process.stdout.write(JSON.stringify(publicValue));
}

function buildAdditionalContextOutput(hookEventName, additionalContext) {
  return {
    hookSpecificOutput: {
      hookEventName,
      additionalContext,
    },
  };
}

function buildStopBlockOutput(
  message,
  telemetryName = 'cross-review-required',
  systemMessage = null,
) {
  return {
    hookSpecificOutput: {
      hookEventName: 'Stop',
      decision: {
        behavior: 'deny',
        message,
      },
    },
    internalTelemetry: { name: telemetryName },
    ...(systemMessage ? { systemMessage } : {}),
    codexExitCode: CODEX_STOP_BLOCK_EXIT_CODE,
    stderr: message,
  };
}

function buildPreToolUseDeny(
  reason,
  telemetryName = null,
  internalTelemetry = null,
) {
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
    internalTelemetry: {
      ...(internalTelemetry || {}),
      name: telemetryName,
    },
  };
}

function buildPermissionRequestDeny(reason, telemetryName = null) {
  return {
    hookSpecificOutput: {
      hookEventName: 'PermissionRequest',
      decision: {
        behavior: 'deny',
        message: reason,
      },
    },
    internalTelemetry: { name: telemetryName },
  };
}

function resultAdditionalContext(hookEventName, additionalContext) {
  return buildAdditionalContextOutput(hookEventName, additionalContext);
}

function resultStopBlock(message, telemetryName, systemMessage) {
  return buildStopBlockOutput(message, telemetryName, systemMessage);
}

function resultPreToolUseDeny(decision) {
  return buildPreToolUseDeny(decision.reason, decision.telemetryName);
}

function resultPermissionRequestDeny(decision) {
  return buildPermissionRequestDeny(decision.reason, decision.telemetryName);
}

function writeResult(result) {
  writeJson(result ?? {});
}

function secretWarningForPatch(command) {
  const patch = String(command || '');
  if (ADVISORY_SECRET_PATTERNS.some((pattern) => pattern.test(patch))) {
    return 'Patch content contains credential-shaped text. Verify it is a fixture/example and not a real secret before committing.';
  }
  return null;
}

function buildPostToolUseFailureContext(input) {
  const toolName = input.tool_name || 'unknown tool';
  const response = input.tool_response || {};
  const exitCode = response.exit_code ?? response.exitCode;
  if (exitCode && Number(exitCode) !== 0) {
    return resultAdditionalContext(
      'PostToolUse',
      `${toolName} exited non-zero. Capture the exact failure and follow systematic debugging before fixing.`,
    );
  }

  return null;
}

function buildPostToolUsePatchContext(input) {
  const command = input.tool_input?.command || '';
  if (input.tool_name !== 'apply_patch') return null;

  const files = parseApplyPatchFiles(command);
  if (files.length === 0) return null;

  const message = runStyleGateAdvisory(files);
  if (!message) return null;
  return resultAdditionalContext('PostToolUse', message);
}

function evaluatePostToolUseResult(input) {
  const reviewAdvice = reviewLaunchAdvisory(input);
  if (reviewAdvice) return resultAdditionalContext('PostToolUse', reviewAdvice);
  return (
    buildPostToolUseFailureContext(input) || buildPostToolUsePatchContext(input)
  );
}

function parseApplyPatchFiles(command) {
  const files = [];
  for (const line of String(command || '').split(/\r?\n/)) {
    const match = line.match(/^\*\*\* (?:Add|Update) File: (.+)$/);
    if (match) files.push(match[1].trim());
  }
  return [...new Set(files)];
}

function formatStyleGateIssue(issue) {
  const location = issue.file
    ? `${issue.file}${issue.line ? `:${issue.line}` : ''}`
    : 'repo';
  return `[${issue.rule}] ${location}: ${issue.message}`;
}

function runStyleGateAdvisory(files) {
  const repoRoot = path.resolve(__dirname, '..', '..');
  const scriptPath = path.join(repoRoot, 'scripts', 'check-code-style.mjs');
  if (!fs.existsSync(scriptPath)) return null;

  const result = spawnSync(
    process.execPath,
    [scriptPath, '--files', ...files, '--format', 'json'],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      maxBuffer: 5 * 1024 * 1024,
      env: { ...process.env, GOLDBAND_STYLE_GATE_HOST: '1' },
    },
  );

  if (result.error) {
    return `goldband style gate advisory failed: ${result.error.message}`;
  }
  if (result.status === 2) {
    return ['goldband style gate advisory could not run.', result.stderr.trim()]
      .filter(Boolean)
      .join(' ');
  }
  if (!result.stdout.trim()) return null;

  try {
    const parsed = JSON.parse(result.stdout);
    const issues = [...(parsed.violations || []), ...(parsed.advisories || [])];
    if (issues.length === 0) return null;
    return [
      'goldband style gate advisory:',
      ...issues.slice(0, 8).map(formatStyleGateIssue),
      'These warnings are advisory here; pre-commit enforces blocking rules.',
    ].join(' ');
  } catch {
    return 'goldband style gate advisory returned invalid JSON.';
  }
}

function evaluateStopResult(input) {
  const gateResult = evaluateCrossReviewGate(input);
  if (gateResult.decision === 'block') {
    return resultStopBlock(gateResult.logs.join('\n'), gateResult.blockedBy);
  }

  return null;
}

function evaluateUserPromptSubmitResult(input) {
  const prompt = input.prompt || '';
  const crossReviewContract = armCrossReviewIfRequested(input);
  const messages = [];

  if (hasExplicitWorkflowInvocation(prompt)) {
    if (crossReviewContract) {
      messages.push(formatCrossReviewArmMessage(crossReviewContract));
    }
    return messages.length > 0
      ? resultAdditionalContext('UserPromptSubmit', messages.join('\n\n'))
      : null;
  }

  messages.push(
    ...loadWorkflowHints()
      .filter((hint) =>
        hint.triggers.some((trigger) =>
          workflowTriggerMatches(prompt, trigger),
        ),
      )
      .map((hint) => hint.message),
  );

  if (crossReviewContract) {
    messages.unshift(formatCrossReviewArmMessage(crossReviewContract));
  }

  if (messages.length === 0) return null;
  return resultAdditionalContext('UserPromptSubmit', messages.join('\n\n'));
}

function armCrossReviewIfRequested(input) {
  try {
    return armFromPrompt(input, { implementer: 'codex' });
  } catch (error) {
    return {
      reviewer: 'unknown',
      planFile: null,
      error: error && error.message ? error.message : String(error),
    };
  }
}

function formatCrossReviewArmMessage(contract) {
  if (contract.error) {
    return `Cross-review gate was requested but could not be armed: ${contract.error}`;
  }
  const modelText = contract.reviewerModel
    ? ` Model: ${contract.reviewerModel}.`
    : '';
  return `Cross-review gate armed for this session. Reviewer: ${contract.reviewer}. Plan: ${contract.planFile || 'not bound yet'}.${modelText}`;
}

function evaluatePreToolUseResult(input) {
  const decision = classifyHighRiskToolUse(input);
  if (decision) {
    return resultPreToolUseDeny(decision);
  }
  const command = input.tool_input?.command || '';
  const toolName = input.tool_name || '';
  const contexts = [];
  if (toolName === 'Bash' && shouldWarnDevServer(command)) {
    contexts.push(
      'Dev server commands are allowed, but prefer a persistent terminal or tmux so logs remain available.',
    );
  }

  if (toolName === 'apply_patch') {
    const secretWarning = secretWarningForPatch(command);
    if (secretWarning) contexts.push(secretWarning);
  }

  if (isProbablyMutatingMcp(toolName)) {
    contexts.push(
      'This MCP tool name looks mutating. Verify authorization and expected side effects before proceeding.',
    );
  }

  if (contexts.length === 0) return null;
  return resultAdditionalContext('PreToolUse', contexts.join(' '));
}

function evaluatePermissionRequestResult(input) {
  const decision = classifyHighRiskToolUse(input);
  if (decision) {
    return resultPermissionRequestDeny(decision);
  }
  return null;
}

function evaluateInput(input) {
  const eventName = input.hook_event_name || '';

  if (eventName === 'UserPromptSubmit')
    return evaluateUserPromptSubmitResult(input);
  if (eventName === 'PreToolUse') return evaluatePreToolUseResult(input);
  if (eventName === 'PermissionRequest')
    return evaluatePermissionRequestResult(input);
  if (eventName === 'PostToolUse') return evaluatePostToolUseResult(input);
  if (eventName === 'Stop') return evaluateStopResult(input);
  return null;
}

function shouldWarnDevServer(command) {
  return /\b(npm run dev|pnpm( run)? dev|yarn dev|bun run dev)\b/.test(command);
}

function isProbablyMutatingMcp(toolName) {
  return (
    /^mcp__/.test(toolName) &&
    /(?:create|update|delete|remove|write|send|post|deploy|merge|close|resolve)/i.test(
      toolName,
    )
  );
}

async function main() {
  const input = parseInput(await readStdinRaw());
  const result = evaluateInput(input);
  recordHookTelemetry(input, result);
  if (result?.codexExitCode) {
    if (result.stderr) console.error(result.stderr);
    process.exit(result.codexExitCode);
  }
  writeResult(result);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[goldband] Codex hook failed: ${error?.stack || error}`);
    process.exit(1);
  });
}

module.exports = {
  evaluateInput,
  findHighRiskBash,
  findHighRiskPatch,
};
