const { reviewLaunchAdvisory } = require('./review-launch-advisory');
const {
  styleAdvisoryAfterShell,
  styleAdvisoryForFiles,
} = require('./style-gate-advisory');

const FILE_WRITE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit']);
const NO_ADVISORY = { message: null, spawnedProcesses: 0 };

function styleAdvisory(toolName, toolInput, input) {
  if (FILE_WRITE_TOOLS.has(toolName)) {
    return styleAdvisoryForFiles([toolInput.file_path]);
  }
  if (toolName === 'NotebookEdit') {
    return styleAdvisoryForFiles([toolInput.notebook_path]);
  }
  if (toolName === 'Bash') return styleAdvisoryAfterShell(input);
  return NO_ADVISORY;
}

function evaluatePostToolUse(input) {
  const toolName = input.tool_name || '';
  const toolInput = input.tool_input || {};

  // Exit-0 hook stderr is not model context, so advice travels as context.
  const style = styleAdvisory(toolName, toolInput, input);
  const context = [reviewLaunchAdvisory(input), style.message].filter(Boolean);

  return {
    decision: 'allow',
    blockedBy: null,
    logs: [],
    outputJson:
      context.length > 0
        ? {
            hookSpecificOutput: {
              hookEventName: input.hook_event_name,
              additionalContext: context.join('\n\n'),
            },
          }
        : null,
    spawnedProcesses: style.spawnedProcesses,
  };
}

module.exports = {
  evaluatePostToolUse,
};
