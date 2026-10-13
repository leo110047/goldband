// Workflow-entry telemetry shared by Claude and Codex hooks. Callers supply
// the host identity (host, source, runId, sessionId); this module only reads
// the hook input.

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

function buildWorkflowEntryEvent(input, context, options) {
  return {
    run_id: context.runId,
    category: 'workflow-entry',
    name: options.name,
    action: options.action,
    source: context.source,
    sessionId: context.sessionId,
    confidence: options.confidence,
    host: context.host,
    detail: {
      trigger: options.trigger,
      hookEventName: input.hook_event_name || null,
      toolName: input.tool_name || null,
    },
  };
}

function skillToolWorkflowEvents(input, context) {
  if (
    input.hook_event_name !== 'PreToolUse' ||
    !/^Skill$/i.test(input.tool_name || '')
  ) {
    return [];
  }

  return [...new Set(candidateSkillNames(input.tool_input || {}))].map((name) =>
    buildWorkflowEntryEvent(input, context, {
      name,
      action: 'invoked',
      confidence: 'confirmed',
      trigger: 'skill-tool',
    }),
  );
}

function bashWorkflowEvents(input, context) {
  if (input.hook_event_name !== 'PreToolUse' || input.tool_name !== 'Bash') {
    return [];
  }

  const name = firstWorkflowCommand(input.tool_input?.command || '');
  return name
    ? [
        buildWorkflowEntryEvent(input, context, {
          name,
          action: 'invoked',
          confidence: 'inferred',
          trigger: 'bash-command',
        }),
      ]
    : [];
}

function promptWorkflowEvents(input, context) {
  if (input.hook_event_name !== 'UserPromptSubmit') return [];
  return workflowSlashCommands(input.prompt || '').map((name) =>
    buildWorkflowEntryEvent(input, context, {
      name,
      action: 'requested',
      confidence: 'inferred',
      trigger: 'slash-command-prompt',
    }),
  );
}

function buildWorkflowUsageEvents(input, context) {
  return [
    ...skillToolWorkflowEvents(input, context),
    ...bashWorkflowEvents(input, context),
    ...promptWorkflowEvents(input, context),
  ];
}

module.exports = {
  buildWorkflowUsageEvents,
  firstWorkflowCommand,
  normalizeEntryName,
  workflowSlashCommands,
};
