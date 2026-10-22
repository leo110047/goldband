const path = require('path');
const { commandLaunch, shellInvocation } = require('./shell-invocation');
const { shellCommands } = require('./shell-commands');
const {
  MAX_CANDIDATE_WORDS,
  argumentCommandIndexes,
  parseShellCommand,
} = require('./shell-policy');
const {
  expandPathWord,
  isGoldbandInstaller,
  matchProtectedTargets,
  analysisLimitExceeded,
  pathContext,
  protectionAnchors,
} = require('./protected-surfaces');
const { gateABypass, launchedEnvironment } = require('./gate-bypass-rules');
const { aliasLookups } = require('./git-aliases');
const {
  WRITER_NAMES,
  commandWriteTargets,
  redirectTargets,
} = require('./shell-write-targets');

// Host-neutral Gate A (hook bypass) and Gate G (protected configuration)
// decisions. Adapters translate the result into their native response.
// This is a static heuristic over explicit commands and tool targets, not a
// sandbox: scripts, aliases, eval, and encoded commands are out of scope.
const CLAUDE_FILE_TOOLS = new Set([
  'Write',
  'Edit',
  'MultiEdit',
  'NotebookEdit',
]);
const ANALYSIS_FAILURE =
  'Gate G could not analyze this call for protected configuration writes. Simplify the call or ask the user to make the change.';
const SHELL_ANALYSIS_FAILURE = {
  gate: 'A',
  rule: 'shell-analysis-failed',
  surface: null,
  message:
    'Gate A could not analyze this command for hook bypasses or protected configuration writes (shell-analysis-failed). Simplify the command, or stop and ask the user to take over.',
};

function gateAMessage(rule, detail) {
  return `Gate A blocked a hook bypass (${rule}): ${detail}. Fix the problem the hook reported instead of disabling it, or stop and ask the user to take over.`;
}

function gateGMessage(description, target) {
  return `Gate G protects ${description}: ${target}. Changing it requires the user's authorization; ask the user to approve or make this change.`;
}

function surfaceDecision(match) {
  const { surface } = match;
  const decision = {
    gate: surface.gate || 'G',
    rule: surface.id,
    surface: {
      id: surface.id,
      path: match.path,
      claudeBuiltin: match.claudeBuiltin,
    },
  };
  decision.message =
    decision.gate === 'A'
      ? gateAMessage(surface.id, `writes ${surface.description}`)
      : gateGMessage(surface.description, match.path);
  return decision;
}

function installerDecision(program) {
  return {
    gate: 'G',
    rule: 'goldband-installer',
    surface: {
      id: 'goldband-installer',
      path: program,
      claudeBuiltin: false,
    },
    message: gateGMessage(
      'the Goldband installer, which rewrites agent and gate configuration',
      program,
    ),
  };
}

// The raw word that names the executed program or shell script operand.
function executedProgram(launch) {
  const { words } = launch;
  if (!words.length) return null;
  if (['source', '.'].includes(words[0])) return words[1] || null;
  const shell = shellInvocation(words);
  if (shell) return shell.file;
  return launch.program.includes('/') ? launch.program : null;
}

// The directory a cd or pushd enters; null when it is not static (`cd -`,
// `pushd +N`, a pushd swap, or zsh's two-operand substitution form).
function directoryOperand(words) {
  if (!['cd', 'pushd'].includes(words[0])) return null;
  let index = 1;
  while (/^-[PLe@n]+$/.test(words[index] || '')) index += 1;
  if (words[index] === '--') index += 1;
  const operands = words.slice(index);
  if (operands.length > 1) return null;
  const [operand] = operands;
  if (operand === undefined) return words[0] === 'cd' ? '~' : null;
  return operand === '-' || /^[+-]\d+$/.test(operand) ? null : operand;
}

// Later segments may run in the old or the new directory; keep both. Past
// the budget, tracking stops and the call ends as a Gate G limit unless Gate
// A finds a bypass first, so a limit never turns a deny into an ask.
function trackDirectoryChange(words, scope, context) {
  const operand = directoryOperand(words);
  if (operand === null || context.budget.exceeded) return;
  const destination = expandPathWord(operand, context);
  const next = scope.cwds.map((cwd) => path.resolve(cwd, destination));
  const cwds = [...new Set([...scope.cwds, ...next])];
  if (cwds.length > context.budget.cwds) context.budget.exceeded = 'cwds';
  else scope.cwds = cwds;
}

// The directories a command runs in. Commands that env -C launched, directly
// or through nested shells and wrappers, inherit its directory; all others
// share the shell's root scope.
function segmentScope(segment, scopes, context) {
  for (let owner = segment.launchedBy; owner; owner = owner.launchedBy) {
    if (scopes.has(owner)) return scopes.get(owner);
  }
  return context;
}

function chdirScope(scope, chdirs, context) {
  let cwds = scope.cwds;
  for (const directory of chdirs) {
    const base = expandPathWord(directory, context);
    cwds = cwds.map((cwd) => path.resolve(cwd, base));
  }
  return { cwds: [...new Set(cwds)] };
}

// Root-scope targets resolve against the shell's directories at the end;
// targets in an env -C scope resolve now against that scope.
function scopedTargets(targets, scope, context) {
  if (scope === context) return targets;
  return targets.flatMap((target) =>
    scope.cwds.map((cwd) => ({
      ...target,
      word: path.resolve(cwd, expandPathWord(target.word, context)),
    })),
  );
}

// Relocations this segment's launchers and earlier statements pass to it.
function inheritedEnvironment(segment, found) {
  const effects = [...found.persistent];
  for (let owner = segment.launchedBy; owner; owner = owner.launchedBy)
    effects.push(...(found.environments.get(owner)?.effects || []));
  return effects;
}

function recordEnvironment(segment, found) {
  const environment = launchedEnvironment(segment.words);
  found.environments.set(segment, environment);
  if (environment.persists) found.persistent.push(...environment.effects);
}

// Programs whose argv Gate A and Gate G read when an unknown launcher runs
// them: `arch git commit -n`, `nice-wrapper tee file`.
const GATE_ROOTS = new Set([
  'git',
  'env',
  'sudo',
  'doas',
  'sh',
  'bash',
  'zsh',
  'dash',
  'ksh',
  ...WRITER_NAMES,
]);
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
const isGateRoot = (name) => GATE_ROOTS.has(name);

// The command an unknown launcher runs from words[index], with the
// commands of its shell script. Assignments just before the program are its
// environment, as with `arch -e NAME=VALUE`.
function candidateAt(segment, words, index) {
  let start = index;
  while (start > 1 && ASSIGNMENT.test(words[start - 1])) start -= 1;
  const candidate = { words: words.slice(start), launchedBy: segment };
  const script = shellInvocation(candidate.words)?.script;
  const children = script ? shellCommands(script) : [];
  return [
    candidate,
    ...children.map((child) => ({
      ...child,
      launchedBy: child.launchedBy || candidate,
    })),
  ];
}

// Commands an unknown launcher may run from its own argv.
function launcherCandidates(segment, words, found) {
  return [
    ...argumentCommandIndexes(segment, words, isGateRoot, found.candidates),
  ].flatMap((index) => candidateAt(segment, words, index));
}

function inspectSegment(segment, context, found) {
  const launch = commandLaunch(segment.words);
  const scope = segmentScope(segment, found.scopes, context);
  const child = launch.chdirs.length
    ? chdirScope(scope, launch.chdirs, context)
    : scope;
  const bypass = gateABypass(segment, launch.words, {
    env: context.env,
    inherited: inheritedEnvironment(segment, found),
    aliases: found.aliases,
    cwds: context.budget.exceeded ? null : child.cwds,
    lookups: found.lookups,
  });
  recordEnvironment(segment, found);
  if (bypass) {
    found.bypass ||= bypass;
    return;
  }
  for (const candidate of launcherCandidates(segment, launch.words, found))
    inspectSegment(candidate, context, found);
  trackDirectoryChange(launch.words, scope, context);
  if (child !== scope) found.scopes.set(segment, child);
  const program = executedProgram(launch);
  if (program) found.programs.push({ word: program, cwds: [...child.cwds] });
  // Redirections open in the shell's directory; the child's own writes and
  // nested commands run in its env -C directory.
  const writes = [
    ...commandWriteTargets(launch.words, { ...context, cwds: child.cwds }),
    ...shellPatchTargets(segment, launch.words, context),
  ];
  found.targets.push(
    ...scopedTargets(
      assignedTargets(redirectTargets(segment), found),
      scope,
      context,
    ),
    ...scopedTargets(assignedTargets(writes, found), child, context),
  );
  recordAssignments(launch, found);
}

const DECLARATIONS = new Set([
  'export',
  'declare',
  'typeset',
  'local',
  'readonly',
]);
const VARIANT_LIMIT = 64;

// Bare assignments and declarations earlier in the command, so a write
// target that names them resolves: `T=.mcp.json; echo x > $T`.
function recordAssignments(launch, found) {
  const words = DECLARATIONS.has(launch.words[0]) ? launch.words.slice(1) : [];
  const effects = launch.words.length === 0 ? launch.effects : [];
  for (const word of words) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=([\s\S]*)$/.exec(word);
    if (match) effects.push({ name: match[1], value: match[2] });
  }
  for (const { name, value } of effects) {
    if (value !== undefined)
      found.assignments.set(name, [
        ...(found.assignments.get(name) || []),
        value,
      ]);
  }
}

// A target as written and with each recorded value of the names it uses;
// over-matching is the safe direction.
function assignedTargets(targets, found) {
  return targets.flatMap((target) => {
    let words = [target.word];
    for (const [name, values] of found.assignments) {
      const reference = new RegExp(
        `\\$(?:\\{${name}\\}|${name}(?![A-Za-z0-9_]))`,
        'g',
      );
      if (!words.some((word) => reference.test(word))) continue;
      words = words.flatMap((word) => [
        word,
        ...values.map((value) => word.replace(reference, () => value)),
      ]);
      if (words.length > VARIANT_LIMIT) break;
    }
    return [...new Set(words)].map((word) => ({ ...target, word }));
  });
}

const INLINE_INPUT = new Set(['<<', '<<-', '<<<']);

// Codex applies `apply_patch` in a shell command as a patch, from its
// arguments or else standard input. Input from a here-document or
// here-string is read; input from a pipe, file, or terminal is unknown, so
// the call ends as a Gate G limit unless Gate A finds a bypass.
function shellPatchTargets(segment, words, context) {
  if (!['apply_patch', 'applypatch'].includes(words[0])) return [];
  if (words.length > 1) return patchTargets(words.slice(1).join('\n'));
  const inline = (segment.redirects || []).filter(
    (item) => INLINE_INPUT.has(item.operator) && !item.fd,
  );
  if (inline.length === 0) context.budget.exceeded ||= 'patch input';
  return patchTargets(inline.map((item) => item.content).join('\n'));
}

function inspectShell(command, context) {
  const found = {
    bypass: null,
    programs: [],
    targets: [],
    scopes: new Map(),
    environments: new Map(),
    persistent: [],
    aliases: new Map(),
    assignments: new Map(),
    lookups: aliasLookups(),
    candidates: { remaining: MAX_CANDIDATE_WORDS },
  };
  for (const segment of parseShellCommand(command))
    inspectSegment(segment, context, found);
  return found;
}

// Protected-path anchors are read only when a write target or a possible
// installer run needs them.
function shellDecision(command, context) {
  let found;
  try {
    found = inspectShell(command, context);
  } catch (error) {
    // A Gate G analysis limit keeps its own response.
    if (error.gateAnalysisLimit) throw error;
    // A command Gate A cannot read is never reported as safe.
    return SHELL_ANALYSIS_FAILURE;
  }
  if (found.bypass) {
    return {
      gate: 'A',
      rule: found.bypass.rule,
      surface: null,
      message: gateAMessage(found.bypass.rule, found.bypass.detail),
    };
  }
  if (context.budget.exceeded)
    throw analysisLimitExceeded(context.budget.exceeded);
  if (!found.targets.length && !found.programs.length) return null;
  const anchors = protectionAnchors(context);
  const match = matchProtectedTargets(found.targets, anchors);
  if (match?.surface.gate === 'A') return surfaceDecision(match);
  const installer = found.programs.find((program) =>
    isGoldbandInstaller(program.word, { ...anchors, cwds: program.cwds }),
  );
  if (installer) return installerDecision(installer.word);
  return match ? surfaceDecision(match) : null;
}

const PATCH_HEADER =
  /^\*\*\* (?:(Add|Update|Delete) File: (.+)|Move to: (.+))$/;

// Codex reads a file header with its indentation trimmed, except inside an
// update hunk, where an indented line is context.
function patchHeaders(text) {
  const headers = [];
  let updating = false;
  for (const line of String(text).split(/\r?\n/)) {
    const match =
      !(updating && /^\s/.test(line)) && PATCH_HEADER.exec(line.trim());
    if (!match) continue;
    if (!match[3]) updating = match[1] === 'Update';
    headers.push(match);
  }
  return headers;
}

function patchTargets(text) {
  const targets = [];
  for (const [, kind, file, moved] of patchHeaders(text)) {
    if (moved) {
      // The moved source no longer exists after the patch.
      if (targets.length) targets.at(-1).operation = 'remove';
      targets.push({ word: moved.trim(), operation: 'write' });
    } else {
      targets.push({
        word: file.trim(),
        operation: kind === 'Delete' ? 'remove' : 'write',
      });
    }
  }
  return targets;
}

function shellText(command) {
  if (!Array.isArray(command))
    return typeof command === 'string' ? command : '';
  const words = command.map(String);
  const script = /^(?:ba|z)?sh$/.test(path.basename(words[0] || ''))
    ? shellInvocation([path.basename(words[0]), ...words.slice(1)])?.script
    : null;
  if (typeof script === 'string') return script;
  return words.map((word) => `'${word.replaceAll("'", "'\\''")}'`).join(' ');
}

function payloadText(toolInput) {
  if (typeof toolInput === 'string') return toolInput;
  const value = toolInput?.command ?? toolInput?.patch ?? toolInput?.input;
  return typeof value === 'string' ? value : '';
}

// MCP tools whose name says they write, move, or remove files; their path
// arguments are write targets, and a move's source is removed.
const MCP_WRITE_VERBS =
  /write|edit|create|move|rename|delete|remove|append|patch|copy|upload|save|update|replace|insert/i;
const MCP_PATH_KEYS = [
  'path',
  'paths',
  'file',
  'file_path',
  'filePath',
  'filepath',
  'filename',
  'relative_path',
  'pathInProject',
  'destination',
  'target',
  'dest',
];
const MCP_SOURCE_KEYS = ['source', 'src', 'from'];

// The tool part of `mcp__<server>__<tool>`.
function mcpToolPart(toolName) {
  const parts = toolName.split('__');
  return parts[0] === 'mcp' && parts.length > 2
    ? parts.slice(2).join('__')
    : '';
}

function mcpTargets(toolName, toolInput) {
  if (!MCP_WRITE_VERBS.test(mcpToolPart(toolName)) || !toolInput) return [];
  const values = (keys) =>
    keys.flatMap((key) => [toolInput[key]].flat()).filter(Boolean);
  const moves = /move|rename/i.test(toolName);
  return [
    ...values(MCP_PATH_KEYS).map((word) => ({ word, operation: 'write' })),
    ...values(MCP_SOURCE_KEYS).map((word) => ({
      word,
      operation: moves ? 'remove' : 'write',
    })),
  ];
}

function toolTargets(toolName, toolInput) {
  if (CLAUDE_FILE_TOOLS.has(toolName)) {
    const word =
      toolName === 'NotebookEdit'
        ? toolInput?.notebook_path
        : toolInput?.file_path;
    return [{ word, operation: 'write' }];
  }
  // Codex routes unparseable JSON here as apply_patch; a payload without a
  // tool name may still carry a patch.
  if (toolName === 'apply_patch' || !toolName)
    return patchTargets(payloadText(toolInput));
  return mcpTargets(toolName, toolInput);
}

function evaluateGateProtectionUnsafe(input, env) {
  const toolName = input.tool_name || '';
  const toolInput = input.tool_input;
  if (toolName === 'Bash') {
    const command = shellText(toolInput?.command);
    return command ? shellDecision(command, pathContext(input, env)) : null;
  }
  // Most tool calls write nothing; skip filesystem lookups for them.
  const targets = toolTargets(toolName, toolInput).filter(
    (target) => typeof target.word === 'string' && target.word,
  );
  if (targets.length === 0) return null;
  const context = protectionAnchors(pathContext(input, env));
  const match = matchProtectedTargets(targets, context);
  return match ? surfaceDecision(match) : null;
}

// Never throws: an internal failure is a protected-surface analysis failure
// that each host turns into its stable explicit response.
function evaluateGateProtection(input, env = process.env) {
  try {
    return evaluateGateProtectionUnsafe(input || {}, env);
  } catch {
    return {
      gate: 'G',
      rule: 'analysis-failed',
      surface: null,
      message: ANALYSIS_FAILURE,
    };
  }
}

module.exports = {
  CLAUDE_FILE_TOOLS,
  evaluateGateProtection,
};
