const { literalOutput } = require('./shell-output');
const { escapeBraceText, expandBraces } = require('./shell-braces');
const { readAnsiCQuoted, readGlobGroup } = require('./shell-word-syntax');
const {
  COMMAND_KEYWORDS,
  commandWords,
  sshInvocation,
  privilegedLaunch,
  shellInvocation,
  suScript,
  shellReadsStdin,
  isShellCommand,
  skipCommandOptions,
} = require('./shell-invocation');

// Extract statically visible shell commands without treating quoted arguments
// or heredoc data as executable commands. This is a hook heuristic, not an
// authorization boundary or an interpreter for arbitrary shell programs.
// Each invocation owns its words and redirects. Backward stdinFrom/pipeFrom
// links preserve input ownership when wrappers or pipelines introduce children;
// consumers decide whether that input is shell code, SQL, or ordinary data.
const SHELL_BLANK = /[ \t\r]/;
function readSubstitution(state) {
  if (state.text.startsWith('$((', state.index)) {
    state.index += 1;
    readArithmetic(state, true);
    return true;
  }
  if (state.text.startsWith('$(', state.index)) {
    state.index += 2;
    scanCommands(state, ')');
    return true;
  }
  if (state.text[state.index] === '`') {
    state.index += 1;
    scanCommands(state, '`');
    return true;
  }
  return false;
}

function readArithmetic(state, expansion = false) {
  const start = state.commands.length;
  let depth = 2;
  state.index += 2;
  while (state.index < state.text.length && depth > 0) {
    if (readSubstitution(state)) continue;
    const char = state.text[state.index];
    if (char === "'" || char === '"') {
      readQuoted(state, char, expansion);
      continue;
    }
    state.index += 1;
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
  }
  // Substitutions execute but their captured output is arithmetic input.
  for (const child of state.commands.slice(start)) child.embedded = true;
  return { words: [], pipe: false, children: [] };
}

// A substitution keeps its source text, so gates can tell a word whose value
// is computed when the command runs.
function readDoubleQuotedPart(state) {
  const start = state.index;
  if (readSubstitution(state)) return state.text.slice(start, state.index);
  const char = state.text[state.index++];
  if (char !== '\\') return char;
  const escaped = state.text[state.index];
  if (escaped === '\n') {
    state.index += 1;
    return '';
  }
  if (['$', '`', '"', '\\'].includes(escaped)) return state.text[state.index++];
  return '\\';
}

function readQuoted(state, quote, expandSingle = false) {
  let value = '';
  state.index += 1;
  while (state.index < state.text.length && state.text[state.index] !== quote) {
    value +=
      quote === "'" && !expandSingle
        ? state.text[state.index++]
        : readDoubleQuotedPart(state);
  }
  if (state.text[state.index] === quote) state.index += 1;
  return value;
}

// `${...}` stays one literal part, so its operators and parentheses are not
// word or glob syntax; substitutions inside it still run.
const BRACE_DEPTH = { '{': 1, '}': -1 };

// Advances past one element of a parameter expansion; returns its brace
// depth change.
function parameterStep(state) {
  if (readSubstitution(state)) return 0;
  const char = state.text[state.index];
  if (char === "'" || char === '"') {
    readQuoted(state, char);
    return 0;
  }
  state.index += char === '\\' ? 2 : 1;
  return BRACE_DEPTH[char] || 0;
}

function readParameterExpansion(state) {
  const start = state.index;
  let depth = 1;
  state.index += 2;
  while (state.index < state.text.length && depth > 0)
    depth += parameterStep(state);
  return state.text.slice(start, state.index);
}

function readDollarPart(state) {
  const next = state.text[state.index + 1];
  if (next === "'") return { value: readAnsiCQuoted(state), quoted: true };
  if (next === '"') {
    state.index += 1;
    return { value: readQuoted(state, '"'), quoted: true };
  }
  if (next === '{')
    return { value: readParameterExpansion(state), quoted: true };
  return null;
}

function readWordPart(state) {
  const char = state.text[state.index];
  if (char === "'" || char === '"') {
    return { value: readQuoted(state, char), quoted: true };
  }
  const dollar = char === '$' && readDollarPart(state);
  if (dollar) return dollar;
  if (char === '\\') {
    state.index += 1;
    const escaped = state.text[state.index++] || '';
    return { value: escaped === '\n' ? '' : escaped, quoted: true };
  }
  const start = state.index;
  if (readSubstitution(state))
    return { value: state.text.slice(start, state.index), quoted: true };
  state.index += 1;
  return { value: char, quoted: false };
}

// A zsh glob group or qualifier, or a bash extglob group, continues the word
// it follows: `name.(json|bak)`, `name(N)`, `@(a|b)`. `name()` stays a
// function definition and `name=(...)` an array or zsh process substitution.
// `state.leadingGroup` lets a group start an argument word: `(a|b)`.
function startsGlobGroup(state, word) {
  return (
    state.text[state.index] === '(' &&
    (word.value !== '' || state.leadingGroup) &&
    !word.value.endsWith('=') &&
    state.text[state.index + 1] !== ')'
  );
}

// A group that continues a word, or false. Outside `[[ ]]`, where blanks may
// sit inside regex groups, a group that does not close before a blank or
// operator is a syntax error in bash and zsh, so it is not analyzed.
function wordGroup(state, word) {
  if (!startsGlobGroup(state, word)) return false;
  const group = readGlobGroup(state, readWordPart, word.value.at(-1));
  if (group === null && !state.conditional)
    throw new Error('Unsupported glob group');
  return group;
}

// `pattern` keeps quoted characters escaped for brace expansion.
function readWord(state) {
  const word = { value: '', quoted: false, pattern: '' };
  while (state.index < state.text.length) {
    const group = wordGroup(state, word);
    if (group) {
      word.value += group;
      word.pattern += escapeBraceText(group);
      continue;
    }
    const char = state.text[state.index];
    if (
      (char === state.stop && char !== '}') ||
      SHELL_BLANK.test(char) ||
      /[\n;&|()<>]/.test(char)
    )
      break;
    const part = readWordPart(state);
    word.value += part.value;
    word.pattern += part.quoted ? escapeBraceText(part.value) : part.value;
    word.quoted ||= part.quoted;
  }
  return word;
}

// Prefix assignment values are not brace-expanded.
function expandedWords(word, command) {
  const assignment =
    /^[A-Za-z_][A-Za-z0-9_]*=/.test(word.value) &&
    command.words.every((value) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(value));
  return assignment ? [word.value] : expandBraces(word.pattern);
}

function readHeredoc(state, owner, fd) {
  state.index += 2;
  const tabs = state.text[state.index] === '-';
  if (tabs) state.index += 1;
  while (SHELL_BLANK.test(state.text[state.index] || '')) state.index += 1;
  const delimiter = readWord(state);
  const redirect = {
    fd,
    operator: tabs ? '<<-' : '<<',
    target: delimiter.value,
    content: '',
  };
  owner.redirects ||= [];
  owner.redirects.push(redirect);
  state.heredocs.push({ ...delimiter, tabs, redirect });
}

function scanExpansions(state, body) {
  const nested = {
    text: body,
    index: 0,
    commands: state.commands,
    heredocs: [],
  };
  while (nested.index < body.length) {
    if (body[nested.index] === '\\') nested.index += 2;
    else if (!readSubstitution(nested)) nested.index += 1;
  }
}

function readHeredocBody(state, doc) {
  const lines = [];
  while (state.index < state.text.length) {
    const end = state.text.indexOf('\n', state.index);
    const stop = end < 0 ? state.text.length : end;
    const raw = state.text.slice(state.index, stop);
    const line = doc.tabs ? raw.replace(/^\t+/, '') : raw;
    state.index = end < 0 ? stop : stop + 1;
    if (line === doc.value) break;
    lines.push(line);
  }
  return lines.length ? `${lines.join('\n')}\n` : '';
}

function consumeHeredocs(state) {
  for (const doc of state.heredocs.splice(0)) {
    doc.redirect.content = readHeredocBody(state, doc);
    if (!doc.quoted) scanExpansions(state, doc.redirect.content);
  }
}

function findExecCommands(words) {
  const children = [];
  for (let index = 1; index < words.length; index += 1) {
    if (!['-exec', '-execdir'].includes(words[index])) continue;
    const start = index + 1;
    index = start;
    while (index < words.length && ![';', '+'].includes(words[index]))
      index += 1;
    children.push(words.slice(start, index));
  }
  return children;
}

function wrappedCommands(words) {
  const privileged = privilegedLaunch(words);
  if (privileged) return [privileged.words];
  if (words[0] === 'xargs') {
    return [
      words.slice(
        skipCommandOptions(words, 1, [
          '-a',
          '--arg-file',
          '-d',
          '--delimiter',
          '-E',
          '-I',
          '-J',
          '-L',
          '--max-lines',
          '-n',
          '--max-args',
          '-P',
          '--max-procs',
          '-s',
          '--max-chars',
          '--eof',
          '--replace',
        ]),
      ),
    ];
  }
  return words[0] === 'find' ? findExecCommands(words) : [];
}

// `launchedBy` links each extracted command to the command that runs it, so
// launch context such as env -C reaches nested commands.
function linkLaunched(commands, owner) {
  for (const child of commands) child.launchedBy ||= owner;
}

function appendShellChildren(state, command, script, inheritStdin = true) {
  const children = shellCommands(script);
  linkLaunched(children, command);
  command.children = children.filter((child) => !child.embedded);
  if (inheritStdin) {
    for (const child of command.children) child.stdinFrom = command;
  }
  for (const child of children) child.embedded = true;
  state.commands.push(...children);
}

function expandShellArguments(state, command) {
  const words = commandWords(command.words);
  const invocation = shellInvocation(words);
  if (invocation?.script) {
    appendShellChildren(state, command, invocation.script);
  } else if (words[0] === 'eval') {
    appendShellChildren(
      state,
      command,
      words.slice(words[1] === '--' ? 2 : 1).join(' '),
    );
  } else if (words[0] === 'su' && suScript(words)) {
    appendShellChildren(state, command, suScript(words));
  } else if (words[0] === 'ssh') {
    const remote = sshInvocation(words);
    if (remote.script)
      appendShellChildren(state, command, remote.script, remote.stdin);
  }
  for (const wrapped of wrappedCommands(words)) {
    const child = {
      words: wrapped,
      pipe: false,
      embedded: true,
      launchedBy: command,
    };
    // xargs supplies arguments; its child does not consume the pipeline stdin.
    if (words[0] !== 'xargs') child.stdinFrom = command;
    command.children ||= [];
    command.children.push(child);
    flushCommand(state, child);
  }
}

function skipBlanks(state) {
  while (SHELL_BLANK.test(state.text[state.index] || '')) state.index += 1;
}

function readRedirectOperator(state) {
  const start = state.index;
  while (/[<>]/.test(state.text[state.index] || '')) state.index += 1;
  let operator = state.text.slice(start, state.index);
  // `>|` and zsh `>!`/`>>!` write despite noclobber; the character belongs
  // to the operator.
  if (operator.endsWith('>') && /[|!]/.test(state.text[state.index] || '')) {
    operator += state.text[state.index];
    state.index += 1;
  }
  skipBlanks(state);
  if (state.text[state.index] === '&') {
    operator += '&';
    state.index += 1;
    skipBlanks(state);
  }
  return operator;
}

function readRedirect(state, owner, fd = null) {
  const descriptor = fd ?? (state.text[state.index] === '<' ? 0 : 1);
  if (
    state.text.startsWith('<<', state.index) &&
    state.text[state.index + 2] !== '<'
  ) {
    readHeredoc(state, owner, descriptor);
    return;
  }
  const operator = readRedirectOperator(state);
  const word = readWord(state);
  // zsh writes every target of a brace-expanded redirection.
  const targets =
    operator === '<<<' ? [word.value] : expandBraces(word.pattern);
  owner.redirects ||= [];
  for (const target of targets)
    owner.redirects.push({
      fd: descriptor,
      operator,
      target,
      content: operator === '<<<' ? `${target}\n` : '',
    });
}

function readCommandWord(state, command) {
  // A `[[ ... =~ ... ]]` pattern is a regex, not a glob with qualifiers.
  state.conditional = command.words[0] === '[[';
  state.leadingGroup = state.text[state.index] === '(';
  const word = readWord(state);
  state.leadingGroup = false;
  if (
    !word.quoted &&
    /^\d+$/.test(word.value) &&
    /[<>]/.test(state.text[state.index] || '')
  )
    readRedirect(state, command, Number(word.value));
  else command.words.push(...expandedWords(word, command));
}

function readCommandToken(state, command) {
  const char = state.text[state.index];
  if (state.text.startsWith('\\\n', state.index)) state.index += 2;
  else if (SHELL_BLANK.test(char)) state.index += 1;
  else if (char === '#') {
    const end = state.text.indexOf('\n', state.index);
    state.index = end < 0 ? state.text.length : end;
  } else if (char === '<' || char === '>') readRedirect(state, command);
  else if (isOutputAndErrorRedirect(state)) {
    // `&>` and `&>>` redirect stdout and stderr to one target.
    state.index += 1;
    readRedirect(state, command, 1);
    command.redirects.at(-1).operator = `&${command.redirects.at(-1).operator}`;
  } else readCommandWord(state, command);
}

function isOutputAndErrorRedirect(state) {
  return state.text[state.index] === '&' && state.text[state.index + 1] === '>';
}

function isBraceToken(state, char) {
  return (
    state.text[state.index] === char &&
    /[ \t\r\n;|&]|^$/.test(state.text[state.index + 1] || '')
  );
}

function readCommandGroup(state, stop) {
  const nested = {
    ...state,
    index: state.index + 1,
    commands: [],
    heredocs: [],
  };
  scanCommands(nested, stop);
  state.index = nested.index;
  const group = {
    words: [],
    pipe: false,
    children: nested.commands.filter((child) => !child.embedded),
  };
  for (const child of group.children) child.stdinFrom = group;
  linkLaunched(nested.commands, group);
  for (const child of nested.commands) child.embedded = true;
  state.commands.push(...nested.commands);
  return group;
}

function commandBoundary(state, stop, command) {
  const char = state.text[state.index];
  const subshell = char === '(' && !startsArgumentGlob(state, command);
  const closes = char === stop && (char !== '}' || isBraceToken(state, '}'));
  return {
    arithmetic: state.text.startsWith('((', state.index),
    group: subshell ? ')' : isBraceToken(state, '{') && '}',
    closes,
    separates:
      closes || (/[;\n|&)]/.test(char) && !isOutputAndErrorRedirect(state)),
    pipe: char === '|' && state.text[state.index + 1] !== '|',
    newline: char === '\n',
  };
}

// In argument position, zsh reads `(a|b)` as a glob word; after keywords
// such as `if` or `time`, or when it is not a glob group, it is a subshell.
function startsArgumentGlob(state, command) {
  const argument = command.words.some(
    (word) => !COMMAND_KEYWORDS.has(word) && word !== 'time',
  );
  if (!argument || state.text[state.index + 1] === ')') return false;
  const probe = { ...state, commands: [], heredocs: [] };
  return readGlobGroup(probe, readWordPart, '(') !== null;
}

function scanCommands(state, stop = null) {
  const previousStop = state.stop;
  state.stop = stop;
  let command = { words: [], pipe: false };
  let previous = null;
  while (state.index < state.text.length) {
    const boundary = commandBoundary(state, stop, command);
    if (boundary.arithmetic) {
      previous = flushSequentialCommand(state, command, previous);
      command = readArithmetic(state);
      continue;
    }
    if (boundary.group) {
      previous = flushSequentialCommand(state, command, previous);
      command = readCommandGroup(state, boundary.group);
      continue;
    }
    if (!boundary.separates) {
      readCommandToken(state, command);
      continue;
    }
    command.pipe = boundary.pipe;
    previous = flushSequentialCommand(state, command, previous);
    command = { words: [], pipe: false };
    state.index += 1;
    if (boundary.newline) consumeHeredocs(state);
    if (boundary.closes) {
      state.stop = previousStop;
      return;
    }
  }
  flushSequentialCommand(state, command, previous);
  state.stop = previousStop;
}

function isEmptyCommand(command) {
  return command.words.length === 0 && !command.children && !command.redirects;
}

function flushSequentialCommand(state, command, previous) {
  if (isEmptyCommand(command)) return previous;
  if (previous?.pipe) command.pipeFrom = previous;
  flushCommand(state, command);
  return command;
}

function flushCommand(state, command) {
  if (isEmptyCommand(command)) return;
  state.commands.push(command);
  expandShellArguments(state, command);
}

function descriptorSource(target) {
  if (target === '-') return null;
  if (!/^\d+-?$/.test(target))
    throw new Error('Unsupported descriptor duplication');
  return Number(target.replace(/-$/, ''));
}

function commandDescriptor(command, fd, before = Infinity) {
  const redirects = command.redirects || [];
  for (
    let index = Math.min(before, redirects.length) - 1;
    index >= 0;
    index -= 1
  ) {
    const redirect = redirects[index];
    const duplicate = ['<&', '>&'].includes(redirect.operator);
    // Descriptor moves close the source after copying its current value.
    if (duplicate && redirect.target === `${fd}-`) return { content: '' };
    if (redirect.fd !== fd) continue;
    if (!duplicate) return redirect;
    const source = descriptorSource(redirect.target);
    return source === null
      ? { content: '' }
      : commandDescriptor(command, source, index);
  }
  return { originalFd: fd };
}

function commandInput(command) {
  const input = commandDescriptor(command, 0);
  if (input.originalFd === undefined)
    return { text: input.content || '', downloaded: false };
  if (input.originalFd !== 0)
    throw new Error('Input descriptor source is not statically available');
  if (command.pipeFrom) return commandOutput(command.pipeFrom);
  if (command.stdinFrom) return commandInput(command.stdinFrom);
  return { text: '', downloaded: false };
}

function commandOutput(command) {
  const output = commandDescriptor(command, 1);
  if (output.originalFd === undefined || output.originalFd === 2)
    return { text: '', downloaded: false };
  if (output.originalFd !== 1)
    throw new Error('Output descriptor target is not statically available');
  const words = commandWords(command.words);
  if (['curl', 'wget'].includes(words[0]))
    return { text: '', downloaded: true };
  if (
    words[0] === 'tee' ||
    (words[0] === 'cat' &&
      words.slice(1).every((word) => ['-', '--'].includes(word)))
  )
    return commandInput(command);
  if (command.children) {
    const outputs = command.children
      .filter((child) => !child.pipe)
      .map(commandOutput);
    return {
      text: outputs.map((output) => output.text).join(''),
      downloaded: outputs.some((output) => output.downloaded),
    };
  }
  return { text: literalOutput(words), downloaded: false };
}

function commandStdin(command) {
  return commandInput(command).text;
}

function expandShellStdin(state) {
  for (const command of [...state.commands]) {
    if (!shellReadsStdin(command.words)) continue;
    const input = commandStdin(command);
    if (!input) continue;
    const children = shellCommands(input);
    linkLaunched(children, command);
    state.commands.push(...children);
  }
}

// Steps that glob group reads, including probes, may take per text.
const GROUP_WORK_LIMIT = 200000;

function shellCommands(text) {
  const state = {
    text: String(text || ''),
    index: 0,
    commands: [],
    heredocs: [],
    groupWork: { remaining: GROUP_WORK_LIMIT },
  };
  scanCommands(state);
  expandShellStdin(state);
  return state.commands;
}

module.exports = {
  shellCommands,
  commandWords,
  commandStdin,
  commandInput,
  shellReadsStdin,
  isShellCommand,
};
