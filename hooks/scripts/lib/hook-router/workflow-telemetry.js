const { resolveRunId } = require('../telemetry-schema.cjs');

function safeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeEntryName(value) {
  const raw = safeString(value).replace(/^\/+/, '');
  if (!/^goldband-[a-z0-9][a-z0-9-]*$/i.test(raw)) {
    return null;
  }
  return raw.toLowerCase();
}

function resolveSessionId(input) {
  return (
    input.session_id ||
    input.sessionId ||
    process.env.CLAUDE_SESSION_ID ||
    process.env.CODEX_SESSION_ID ||
    null
  );
}

function baseTelemetryFields(input) {
  return {
    run_id: resolveRunId(input),
  };
}

function firstWorkflowCommand(text) {
  for (const segment of shellCommandSegments(text)) {
    const executable = firstExecutableToken(segment);
    const name = normalizeEntryName(executable);
    if (name) return name;
  }
  return null;
}

function shellCommandSegments(text) {
  return safeString(text)
    .split(/(?:&&|\|\||[;|\n])/)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function shellTokens(segment) {
  return String(segment || '').match(/"[^"]*"|'[^']*'|[^\s]+/g) || [];
}

function stripTokenQuotes(value) {
  return String(value || '').replace(/^["']|["']$/g, '');
}

function isAssignmentToken(token) {
  return /^[A-Za-z_][A-Za-z0-9_]*=/.test(token);
}

function firstExecutableToken(segment) {
  const tokens = shellTokens(segment).map(stripTokenQuotes);
  let index = 0;
  while (index < tokens.length && isAssignmentToken(tokens[index])) index += 1;

  const prefix = tokens[index];
  if (prefix === 'command' || prefix === 'exec' || prefix === 'time') {
    index += 1;
  } else if (prefix === 'env') {
    index += 1;
    while (index < tokens.length && isAssignmentToken(tokens[index])) {
      index += 1;
    }
  }

  return tokens[index] || '';
}

function workflowSlashCommands(prompt) {
  const text = String(prompt || '');
  const names = new Set();
  const pattern = /(?:^|[\s([{])\/(goldband-[a-z0-9][a-z0-9-]*)\b/gi;
  let match = pattern.exec(text);
  while (match) {
    const name = normalizeEntryName(match[1]);
    if (name) names.add(name);
    match = pattern.exec(text);
  }
  return [...names];
}

function candidateSkillNames(toolInput) {
  if (!toolInput || typeof toolInput !== 'object') return [];

  const candidates = [
    toolInput.name,
    toolInput.skill,
    toolInput.skill_name,
    toolInput.skillName,
    toolInput.command,
  ];

  return candidates.map(normalizeEntryName).filter(Boolean);
}

function buildWorkflowEntryEvent(input, options) {
  return {
    ...baseTelemetryFields(input),
    category: 'workflow-entry',
    name: options.name,
    action: options.action,
    source: options.source,
    sessionId: resolveSessionId(input),
    confidence: options.confidence,
    host: options.host,
    detail: {
      trigger: options.trigger,
      hookEventName: input.hook_event_name || null,
      toolName: input.tool_name || null,
    },
  };
}

function skillToolWorkflowEvents(input, host, source) {
  if (
    input.hook_event_name !== 'PreToolUse' ||
    !/^Skill$/i.test(input.tool_name || '')
  ) {
    return [];
  }

  return [...new Set(candidateSkillNames(input.tool_input || {}))].map((name) =>
    buildWorkflowEntryEvent(input, {
      name,
      action: 'invoked',
      source,
      confidence: 'confirmed',
      host,
      trigger: 'skill-tool',
    }),
  );
}

function bashWorkflowEvents(input, host, source) {
  if (input.hook_event_name !== 'PreToolUse' || input.tool_name !== 'Bash') {
    return [];
  }

  const name = firstWorkflowCommand(input.tool_input?.command || '');
  return name
    ? [
        buildWorkflowEntryEvent(input, {
          name,
          action: 'invoked',
          source,
          confidence: 'inferred',
          host,
          trigger: 'bash-command',
        }),
      ]
    : [];
}

function promptWorkflowEvents(input, host, source) {
  if (input.hook_event_name !== 'UserPromptSubmit') return [];
  return workflowSlashCommands(input.prompt || '').map((name) =>
    buildWorkflowEntryEvent(input, {
      name,
      action: 'requested',
      source,
      confidence: 'inferred',
      host,
      trigger: 'slash-command-prompt',
    }),
  );
}

function buildWorkflowUsageEvents(input, host, source) {
  return [
    ...skillToolWorkflowEvents(input, host, source),
    ...bashWorkflowEvents(input, host, source),
    ...promptWorkflowEvents(input, host, source),
  ];
}

function hasAdditionalContext(outputJson) {
  return Boolean(
    outputJson?.systemMessage ||
      outputJson?.hookSpecificOutput?.additionalContext,
  );
}

function buildHookOutcomeUsageEvents(input, outcome, host, source) {
  const events = [];
  const sessionId = resolveSessionId(input);
  const hookEventName = input.hook_event_name || 'unknown';
  const toolName = input.tool_name || null;

  if (outcome?.decision === 'block') {
    events.push({
      ...baseTelemetryFields(input),
      category: 'hook-decision',
      name: outcome.blockedBy || hookEventName,
      action: 'deny',
      source,
      sessionId,
      detail: { host, hookEventName, toolName },
    });
  }

  const logCount = Array.isArray(outcome?.logs)
    ? outcome.logs.filter(Boolean).length
    : 0;
  if (
    outcome?.decision !== 'block' &&
    (logCount > 0 || hasAdditionalContext(outcome?.outputJson))
  ) {
    events.push({
      ...baseTelemetryFields(input),
      category: 'hook-advisory',
      name: hookEventName,
      action: 'emit',
      source,
      sessionId,
      detail: { host, hookEventName, toolName, logCount },
    });
  }

  return events;
}

module.exports = {
  buildHookOutcomeUsageEvents,
  buildWorkflowUsageEvents,
  firstWorkflowCommand,
  normalizeEntryName,
  workflowSlashCommands,
};
