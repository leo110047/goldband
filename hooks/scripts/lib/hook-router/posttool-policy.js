const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { reviewLaunchAdvisory } = require('./review-launch-advisory');

function repoRootFromPolicy() {
  return path.resolve(__dirname, '../../../..');
}

function collectStyleGateWarnings(filePath) {
  if (!filePath) return [];

  const repoRoot = repoRootFromPolicy();
  const scriptPath = path.join(repoRoot, 'scripts', 'check-code-style.mjs');
  if (!fs.existsSync(scriptPath)) return [];

  const result = spawnSync(
    process.execPath,
    [scriptPath, '--files', filePath, '--format', 'advisory'],
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
  const advisory = result.stdout.trim();
  if (!advisory) return [];
  return [`[Hook] WARNING: ${advisory}`];
}

function evaluatePostToolUse(input) {
  const toolName = input.tool_name || '';
  const toolInput = input.tool_input || {};

  const reviewAdvice = reviewLaunchAdvisory(input);
  const filePath = toolInput.file_path || '';

  const styleWarnings =
    toolName === 'Edit' || toolName === 'Write' || toolName === 'MultiEdit'
      ? collectStyleGateWarnings(filePath)
      : [];

  return {
    decision: 'allow',
    blockedBy: null,
    logs: styleWarnings,
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
