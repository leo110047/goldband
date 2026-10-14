#!/usr/bin/env node

const MAX_STDIN_BYTES = 1024 * 1024;
const path = require('path');
const { requireFirst } = require('./module-loader');
const {
  classifyHighRiskToolUse,
  findHighRiskBash,
  findHighRiskPatch,
  secretDecisionForPatch,
} = require('./high-risk-policy');
const { recordHookTelemetry } = require('./telemetry');
const { reviewLaunchAdvisory } = require('./review-launch-advisory');
const {
  snapshotWorktreeBeforeShell,
  styleAdvisoryAfterShell,
  styleAdvisoryForFiles,
} = require('./style-gate-advisory');
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

const CODEX_STOP_BLOCK_EXIT_CODE = 2;

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

function buildPostToolUseStyleContext(input) {
  const toolName = input.tool_name || '';
  let message = null;
  if (toolName === 'apply_patch') {
    // Patch paths are relative to the session cwd, not the Git top level.
    ({ message } = styleAdvisoryForFiles(
      parseApplyPatchFiles(input.tool_input?.command || '').map((file) =>
        path.resolve(input.cwd || process.cwd(), file),
      ),
    ));
  } else if (toolName === 'Bash') {
    ({ message } = styleAdvisoryAfterShell(input));
  }
  return message ? message.split('\n').join(' ') : null;
}

// A failed shell command may still have written files, so its guidance and the
// post-command scan are reported together. A review launch failure replaces
// the generic non-zero guidance.
function evaluatePostToolUseResult(input) {
  const reviewAdvice = reviewLaunchAdvisory(input);
  const failureAdvice = reviewAdvice
    ? null
    : buildPostToolUseFailureContext(input)?.hookSpecificOutput
        ?.additionalContext;
  const context = [
    reviewAdvice,
    failureAdvice,
    buildPostToolUseStyleContext(input),
  ].filter(Boolean);
  if (context.length === 0) return null;
  return resultAdditionalContext('PostToolUse', context.join(' '));
}

// Files that exist after the patch: added, updated, and move destinations.
function parseApplyPatchFiles(command) {
  const sections = String(command || '').split(
    /^(?=\*\*\* (?:Add|Update|Delete) File: )/m,
  );
  return [...new Set(sections.map(patchSectionResultFile).filter(Boolean))];
}

function patchSectionResultFile(section) {
  const header = section.match(/^\*\*\* (Add|Update) File: (.+)$/m);
  if (!header) return null;
  const move = section.match(/^\*\*\* Move to: (.+)$/m);
  return (header[1] === 'Update' && move ? move[1] : header[2]).trim();
}

function evaluateStopResult(input) {
  const gateResult = evaluateCrossReviewGate(input);
  if (gateResult.decision === 'block') {
    return resultStopBlock(gateResult.logs.join('\n'), gateResult.blockedBy);
  }

  return null;
}

function evaluateUserPromptSubmitResult(input) {
  const crossReviewContract = armCrossReviewIfRequested(input);
  if (!crossReviewContract) return null;
  return resultAdditionalContext(
    'UserPromptSubmit',
    formatCrossReviewArmMessage(crossReviewContract),
  );
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
  if (toolName === 'apply_patch') {
    const secretDecision = secretDecisionForPatch(command);
    if (secretDecision) contexts.push(secretDecision.message);
  }

  if (isProbablyMutatingMcp(toolName)) {
    contexts.push(
      'This MCP tool name looks mutating. Verify authorization and expected side effects before proceeding.',
    );
  }

  if (toolName === 'Bash') snapshotWorktreeBeforeShell(input);

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
