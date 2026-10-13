const {
  classifySecretContent,
  classifyShellSecretContent,
} = require('./secret-patterns');
const { isModeActive, setModeActive } = require('./mode-state');
const { matchCarefulModeRisk } = require('./careful-mode-rules');
const { matchFreezeModeBashViolation } = require('./freeze-mode-rules');
const { managedWorktreeBashViolation } = require('./managed-worktree-policy');
const {
  inspectShellCommand,
  SHELL_ANALYSIS_FAILURE,
} = require('./shell-policy');
const { snapshotWorktreeBeforeShell } = require('./style-gate-advisory');

const PRETOOL_DENY_POLICIES = [
  {
    name: 'managed-worktree-commit-guard',
    description:
      'blocks direct Git metadata writes in Goldband-managed worktrees',
  },
];

const REVIEW_READ_ONLY_MODE = 'review-read-only';
// Non-Bash tools allowed by freeze-mode and review-read-only. Bash has its own
// per-mode command policy; every other tool fails closed in those modes.
// `Agent` stays out: a subagent's tool calls are not verified to carry the
// parent session's mode state.
const READ_ONLY_TOOLS = new Set([
  'Read',
  'Glob',
  'Grep',
  'LSP',
  'WebFetch',
  'WebSearch',
  'ToolSearch',
  'TaskOutput',
  'TaskList',
  'TaskGet',
  // Task and todo tools change only the session's task list.
  'TaskCreate',
  'TaskUpdate',
  // Stopping the session's own background process changes no files.
  'TaskStop',
  'KillShell',
  'ListMcpResourcesTool',
  'ReadMcpResourceTool',
  'TodoWrite',
  'AskUserQuestion',
  'Skill',
  'EnterPlanMode',
  'ExitPlanMode',
  // Names used by earlier Claude Code versions.
  'LS',
  'NotebookRead',
  'BashOutput',
]);
const READ_ONLY_WORKFLOW_SKILL_ALIASES = new Map([
  ['goldband-review', 'goldband-review'],
  ['review', 'goldband-review'],
]);
const READ_ONLY_WORKFLOW_SKILLS = new Set(['goldband-review']);
const REVIEW_RUNTIME_WRITE_PATH =
  /(?:~\/\.goldband\b|\$GOLDBAND_[A-Z0-9_]+|\$\{GOLDBAND_[A-Z0-9_]+\}|\/tmp\/|\/private\/tmp\/|\$TMP(?:DIR|ERR|[A-Z0-9_]*)?\b|\$\{TMP(?:DIR|ERR|[A-Z0-9_]*)?\}|\/dev\/null)/;

function safeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeWorkflowSkillName(value) {
  const normalized = safeString(value).replace(/^\/+/, '').toLowerCase();
  return READ_ONLY_WORKFLOW_SKILL_ALIASES.get(normalized) || null;
}

function candidateSkillNames(toolInput) {
  if (!toolInput || typeof toolInput !== 'object') return [];
  return [
    toolInput.name,
    toolInput.skill,
    toolInput.skill_name,
    toolInput.skillName,
    toolInput.command,
  ]
    .map(normalizeWorkflowSkillName)
    .filter(Boolean);
}

function isReadOnlyWorkflowSkillInvocation(toolName, toolInput) {
  if (!/^Skill$/i.test(toolName || '')) return false;
  return candidateSkillNames(toolInput).some((name) =>
    READ_ONLY_WORKFLOW_SKILLS.has(name),
  );
}

function resolveSessionId(input) {
  return input.session_id || process.env.CLAUDE_SESSION_ID || 'default';
}

function buildModeUsageEvent(options) {
  const { modeName, sessionId, rule, toolName, command } = options;
  return {
    category: 'mode-enforcement',
    name: modeName,
    action: 'block',
    sessionId: sessionId || process.env.CLAUDE_SESSION_ID || null,
    source: 'pretool-policy',
    detail: {
      rule,
      toolName,
      commandPreview:
        typeof command === 'string' ? command.slice(0, 160) : null,
    },
  };
}

function buildModeBlock(options) {
  const { modeName, sessionId, rule, toolName, command, logs } = options;
  return {
    decision: 'block',
    blockedBy: modeName,
    logs,
    usageEvents: [
      buildModeUsageEvent({ modeName, sessionId, rule, toolName, command }),
    ],
  };
}

function isRuntimeWriteTarget(token) {
  return REVIEW_RUNTIME_WRITE_PATH.test(token);
}

function mutationTargetsAreRuntime(command, tokens) {
  if (tokens.length === 0) return false;
  // Commands whose write target is the final operand.
  if (['cp', 'mv', 'ln', 'install', 'rsync', 'truncate'].includes(command)) {
    return isRuntimeWriteTarget(tokens[tokens.length - 1]);
  }
  if (command === 'dd') {
    const output = tokens.find((token) => token.startsWith('of='));
    return !output || isRuntimeWriteTarget(output.slice(3));
  }
  if (command === 'chmod' || command === 'chown') {
    return tokens.slice(1).every(isRuntimeWriteTarget);
  }
  return tokens.every(isRuntimeWriteTarget);
}

// Commands that write their operands. `patch` writes files named inside its
// input; `--dry-run` writes nothing.
const FILE_WRITERS = new Set([
  'touch',
  'mkdir',
  'rm',
  'mv',
  'cp',
  'chmod',
  'chown',
  'tee',
  'ln',
  'install',
  'rsync',
  'truncate',
  'dd',
  'patch',
]);

function fileWriterViolation(words) {
  const name = (words[0] || '').split('/').pop();
  if (!FILE_WRITERS.has(name)) return null;
  if (name === 'patch') {
    return words.includes('--dry-run')
      ? null
      : { rule: 'no-source-mutation', detail: 'review-read-only blocks patch' };
  }
  const operands = words
    .slice(1)
    .filter((word) => word && !word.startsWith('-'));
  if (mutationTargetsAreRuntime(name, operands)) return null;
  return {
    rule: 'no-source-mutation',
    detail: `review-read-only blocks ${name} outside runtime artifact paths`,
  };
}

// The shared shell parser resolves assignments, launchers, keywords, and
// nested shells, so command extraction has one owner across policies.
function fileMutationViolation(command) {
  const result = inspectShellCommand(
    command,
    () => false,
    (words) => fileWriterViolation(words),
  );
  if (result.failed) {
    return { rule: 'shell-analysis-failed', detail: SHELL_ANALYSIS_FAILURE };
  }
  return result.risk;
}

function reviewReadOnlyBashViolation(command) {
  if (!command) return null;

  const rawCommand = String(command);
  const normalized = rawCommand.replace(/\s+/g, ' ').trim();
  const gitMutation = normalized.match(
    /\bgit\s+(add|commit|push|reset|checkout|switch|clean|merge(?!-)|rebase|cherry-pick|apply|am|restore|stash|rm|mv)\b/,
  );
  if (gitMutation) {
    return {
      rule: 'no-source-mutation',
      detail: `review-read-only blocks git ${gitMutation[1]}`,
    };
  }

  const packageMutation = normalized.match(
    /\b(npm|pnpm|yarn|bun)\s+(install|add|remove|update|upgrade)\b/,
  );
  if (packageMutation) {
    return {
      rule: 'no-source-mutation',
      detail: `review-read-only blocks ${packageMutation[1]} ${packageMutation[2]}`,
    };
  }

  // sed: GNU -i/-i.bak/--in-place, BSD -i ''/-I, and option clusters.
  // perl/ruby clusters admit only boolean switches before `i`, so `-Ilib`
  // (include path) is not mistaken for in-place editing.
  // Per line, with backslash continuations joined: a newline ends a command,
  // so flags on a later line (`rg -li`) never pair with a `sed` before it.
  const inPlaceEdit = rawCommand
    .replace(/\\\r?\n/g, ' ')
    .split('\n')
    .some(
      (line) =>
        /\bsed\s(?:[^|;&]*\s)?(?:-[A-Za-z]*[iI]|--in-place)/.test(line) ||
        /\b(?:perl|ruby)\s(?:[^|;&]*\s)?-[anpslw0-9]*i/.test(line) ||
        /\bg?awk\s(?:[^|;&]*\s)?(?:-i\s*inplace|--include=inplace)\b/.test(
          line,
        ),
    );
  if (inPlaceEdit) {
    return {
      rule: 'no-source-mutation',
      detail: 'review-read-only blocks in-place file edits',
    };
  }

  const fileMutation = fileMutationViolation(rawCommand);
  if (fileMutation) return fileMutation;

  const redirectPattern =
    /(?:^|[^0-9])(?:>{1,2})(?!\s*(?:&[0-9]|\/dev\/null\b|["']?\$TMP|["']?\$\{TMP|["']?~\/\.goldband\b|["']?\/tmp\/|["']?\/private\/tmp\/))/g;
  if (redirectPattern.test(rawCommand)) {
    return {
      rule: 'no-source-mutation',
      detail:
        'review-read-only blocks shell redirection outside runtime artifact paths',
    };
  }

  return null;
}

function evaluateReadOnlyWorkflowActivation(context) {
  const { sessionId, toolInput, toolName } = context;
  if (!isReadOnlyWorkflowSkillInvocation(toolName, toolInput)) return null;

  try {
    setModeActive(sessionId, REVIEW_READ_ONLY_MODE, true, {
      source: 'goldband-review',
      reason: 'read-only workflow skill',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      decision: 'block',
      blockedBy: REVIEW_READ_ONLY_MODE,
      logs: [
        '[Hook] BLOCKED: could not enforce read-only review mode',
        `[Hook] Reason: ${message}`,
      ],
    };
  }

  return {
    decision: 'allow',
    blockedBy: null,
    logs: [],
  };
}

function evaluateReviewReadOnlyBashPolicy(context) {
  const { command, reviewReadOnlyActive, sessionId, toolName } = context;
  const violation = reviewReadOnlyActive
    ? reviewReadOnlyBashViolation(command)
    : null;
  if (!violation) return null;

  return buildModeBlock({
    modeName: REVIEW_READ_ONLY_MODE,
    sessionId,
    rule: violation.rule,
    toolName,
    command,
    logs: [
      '[Hook] BLOCKED: review-read-only is active for this session',
      `[Hook] Reason: ${violation.detail}`,
      `[Hook] Command: ${command}`,
    ],
  });
}

function evaluateFreezeBashPolicy(context) {
  const { command, freezeModeActive, sessionId, toolName } = context;
  const violation = freezeModeActive
    ? matchFreezeModeBashViolation(command)
    : null;
  if (!violation) return null;

  return buildModeBlock({
    modeName: 'freeze-mode',
    sessionId,
    rule: violation.rule,
    toolName,
    command,
    logs: [
      '[Hook] BLOCKED: freeze-mode is active for this session',
      `[Hook] Reason: ${violation.detail}`,
      `[Hook] Command: ${command}`,
    ],
  });
}

function evaluateCarefulBashPolicy(context) {
  const { command, sessionId, toolName } = context;
  const risk = isModeActive(sessionId, 'careful-mode')
    ? matchCarefulModeRisk(command)
    : null;
  if (!risk) return null;

  return buildModeBlock({
    modeName: 'careful-mode',
    sessionId,
    rule: risk.rule,
    toolName,
    command,
    logs: [
      '[Hook] BLOCKED: careful-mode is active for this session',
      `[Hook] Risk: ${risk.detail}`,
      `[Hook] Command: ${command}`,
      '[Hook] Disable with the same careful-mode script used to enable this session.',
    ],
  });
}

function evaluateBashPolicy(context) {
  const { command } = context;
  const managedViolation = managedWorktreeBashViolation(command);
  if (managedViolation) {
    return {
      decision: 'block',
      blockedBy: 'managed-worktree-commit-guard',
      logs: [
        '[Hook] BLOCKED: Git writes are brokered in this managed worktree',
        `[Hook] Reason: ${managedViolation.detail}`,
        `[Hook] Command: ${command}`,
      ],
    };
  }
  const modeDecision =
    evaluateReviewReadOnlyBashPolicy(context) ||
    evaluateFreezeBashPolicy(context) ||
    evaluateCarefulBashPolicy(context);
  if (modeDecision) return modeDecision;

  if (/\bgit\s+push\b/.test(command)) {
    return {
      decision: 'allow',
      blockedBy: null,
      logs: ['[Hook] Reminder: review branch/commits/remote before git push'],
    };
  }

  return null;
}

function evaluateReviewReadOnlyFilePolicy(context) {
  const { reviewReadOnlyActive, sessionId, toolName } = context;
  if (
    !reviewReadOnlyActive ||
    toolName === 'Bash' ||
    READ_ONLY_TOOLS.has(toolName)
  ) {
    return null;
  }

  return buildModeBlock({
    modeName: REVIEW_READ_ONLY_MODE,
    sessionId,
    rule: 'no-file-edits',
    toolName,
    command: null,
    logs: [
      '[Hook] BLOCKED: review-read-only allows source inspection only',
      `[Hook] Tool: ${toolName}`,
      '[Hook] Finish the review turn before making file changes.',
    ],
  });
}

function evaluateFreezeFilePolicy(context) {
  const { freezeModeActive, sessionId, toolName } = context;
  if (
    !freezeModeActive ||
    toolName === 'Bash' ||
    READ_ONLY_TOOLS.has(toolName)
  ) {
    return null;
  }

  return buildModeBlock({
    modeName: 'freeze-mode',
    sessionId,
    rule: 'no-file-edits',
    toolName,
    command: null,
    logs: [
      '[Hook] BLOCKED: freeze-mode allows inspection only',
      `[Hook] Tool: ${toolName}`,
      '[Hook] Only read-only tools are allowed; disable freeze-mode before making changes.',
    ],
  });
}

function secretScanContents(toolName, toolInput) {
  if (toolName === 'Write') return [toolInput.content];
  if (toolName === 'Edit') return [toolInput.new_string];
  if (toolName === 'NotebookEdit') return [toolInput.new_source];
  if (toolName === 'MultiEdit') {
    return (toolInput.edits || []).map((edit) => edit.new_string);
  }
  if (toolName === 'Bash') return [toolInput.command];
  return null;
}

function evaluateSecretPolicy(context) {
  const { toolInput, toolName } = context;
  const contents = secretScanContents(toolName, toolInput);
  if (!contents) return null;

  const text = contents.filter((value) => typeof value === 'string').join('\n');
  const decision =
    toolName === 'Bash'
      ? classifyShellSecretContent(text)
      : classifySecretContent(text);
  if (!decision) return null;
  return {
    decision: decision.severity === 'high' ? 'block' : 'allow',
    blockedBy: decision.severity === 'high' ? 'secret-detector' : null,
    logs: [`[Hook] ${decision.message}`],
  };
}

function evaluatePreToolUse(input) {
  const toolName = input.tool_name || '';
  const toolInput = input.tool_input || {};
  const sessionId = resolveSessionId(input);
  const context = {
    toolName,
    toolInput,
    sessionId,
    command: toolInput.command || '',
    filePath: toolInput.file_path || '',
    freezeModeActive: isModeActive(sessionId, 'freeze-mode'),
    reviewReadOnlyActive: isModeActive(sessionId, REVIEW_READ_ONLY_MODE),
  };

  // A secret block precedes every allow result, including Bash advisories.
  const secretDecision = evaluateSecretPolicy(context);
  if (secretDecision?.decision === 'block') return secretDecision;

  const decision =
    evaluateReadOnlyWorkflowActivation(context) ||
    (toolName === 'Bash' ? evaluateBashPolicy(context) : null) ||
    evaluateReviewReadOnlyFilePolicy(context) ||
    evaluateFreezeFilePolicy(context) ||
    secretDecision;

  if (decision?.decision === 'block') return decision;
  const spawnedProcesses =
    toolName === 'Bash'
      ? snapshotWorktreeBeforeShell(input).spawnedProcesses
      : 0;
  return {
    decision: 'allow',
    blockedBy: null,
    logs: [],
    ...decision,
    spawnedProcesses,
  };
}

module.exports = {
  PRETOOL_DENY_POLICIES,
  evaluatePreToolUse,
};
