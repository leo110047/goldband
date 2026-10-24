// Normalize explicit command launch and shell option syntax without executing it.
// Shell keywords and zsh precommand modifiers that may precede a simple
// command's words.
const COMMAND_KEYWORDS = new Set([
  'if',
  'then',
  'else',
  'elif',
  'while',
  'until',
  'do',
  '!',
  '{',
  'coproc',
  'builtin',
  'noglob',
  'nocorrect',
  '-',
]);
const ASSIGNMENT = /^([A-Za-z_][A-Za-z0-9_]*)=([\s\S]*)$/;
const WRAPPER_VALUE_OPTIONS = {
  command: [],
  exec: ['-a'],
  nohup: [],
  time: ['-f', '--format', '-o', '--output'],
  nice: ['-n', '--adjustment'],
  timeout: ['-k', '--kill-after', '-s', '--signal'],
  caffeinate: ['-t', '-w'],
  stdbuf: ['-i', '-o', '-e', '--input', '--output', '--error'],
  xcrun: ['-sdk', '--sdk', '-toolchain', '--toolchain'],
  ionice: ['-c', '--class', '-n', '--classdata'],
  chrt: [],
  taskset: [],
};
// Operands a wrapper reads before its child: a duration, priority, or mask.
const WRAPPER_POSITIONALS = { timeout: 1, chrt: 1, taskset: 1 };
// Launchers that accept NAME=VALUE operands for their child's environment.
const PRIVILEGE_VALUE_OPTIONS = {
  sudo: [
    '-u',
    '-g',
    '-h',
    '-p',
    '-C',
    '-R',
    '-D',
    '--user',
    '--group',
    '--host',
    '--prompt',
    '--chdir',
    '--chroot',
  ],
  doas: ['-u', '-C'],
};
// env short options that take a value (GNU and BSD), and long options with
// the short option they stand for.
const ENV_SHORT_VALUES = 'uCSPa';
const ENV_LONG_OPTIONS = {
  'ignore-environment': 'i',
  null: '0',
  debug: 'v',
  unset: 'u',
  chdir: 'C',
  'split-string': 'S',
  argv0: 'a',
  help: 'help',
  version: 'version',
  'block-signal': 'signal',
  'default-signal': 'signal',
  'ignore-signal': 'signal',
  'list-signal-handling': 'signal',
};
const ENV_LONG_VALUES = new Set(['u', 'C', 'S', 'a']);

function assignmentEffects(words) {
  return words.flatMap((word) => {
    const match = ASSIGNMENT.exec(word);
    return match ? [{ name: match[1], value: match[2] }] : [];
  });
}

// GNU accepts any unambiguous abbreviation. An ambiguous one that may mean
// --ignore-environment is read as it: env fails, or clears the environment.
function envLongName(prefix) {
  if (Object.hasOwn(ENV_LONG_OPTIONS, prefix)) return ENV_LONG_OPTIONS[prefix];
  const names = Object.keys(ENV_LONG_OPTIONS).filter((name) =>
    name.startsWith(prefix),
  );
  if (names.includes('ignore-environment')) return 'i';
  return names.length === 1 ? ENV_LONG_OPTIONS[names[0]] : null;
}

function envLongOption(words, index) {
  const word = words[index];
  const equals = word.indexOf('=');
  const name = envLongName(word.slice(2, equals === -1 ? undefined : equals));
  if (!ENV_LONG_VALUES.has(name))
    return { options: name ? [{ name }] : [], next: index + 1 };
  if (equals !== -1)
    return {
      options: [{ name, value: word.slice(equals + 1) }],
      next: index + 1,
    };
  return { options: [{ name, value: words[index + 1] }], next: index + 2 };
}

// One env option word, read getopt-style: flags cluster until a letter that
// takes a value, which is the rest of the word or the next word.
function envOptionAt(words, index) {
  const word = words[index];
  if (word === '-') return { options: [{ name: 'i' }], next: index + 1 };
  if (word.startsWith('--')) return envLongOption(words, index);
  const options = [];
  for (let at = 1; at < word.length; at += 1) {
    const name = word[at];
    if (!ENV_SHORT_VALUES.includes(name)) {
      options.push({ name });
      continue;
    }
    const attached = word.slice(at + 1);
    options.push({ name, value: attached || words[index + 1] });
    return { options, next: index + (attached ? 1 : 2) };
  }
  return { options, next: index + 1 };
}

function envOptionEffects(options, env) {
  for (const option of options) {
    if (option.name === 'i') env.effects.push({ clearAll: true });
    if (option.name === 'u')
      env.effects.push({ name: option.value, unset: true });
    if (option.name === 'C' && option.value) env.chdirs.push(option.value);
  }
}

// env's environment effects, chdir directories, and child index (null when
// env runs no child).
// Assignments from words[index] on; returns the index after them. After
// `--`, env still reads NAME=VALUE operands.
function envAssignments(words, index, env) {
  let next = index;
  while (ASSIGNMENT.test(words[next] || ''))
    env.effects.push(...assignmentEffects([words[next++]]));
  return next;
}

function envInvocation(words) {
  const env = { effects: [], chdirs: [], child: null };
  let index = 1;
  while (index < words.length) {
    const word = words[index];
    if (word === '--') {
      index = envAssignments(words, index + 1, env);
      break;
    }
    if (ASSIGNMENT.test(word)) {
      env.effects.push(...assignmentEffects([word]));
      index += 1;
    } else if (word.startsWith('-')) {
      const parsed = envOptionAt(words, index);
      if (parsed.options.some(({ name }) => ['help', 'version'].includes(name)))
        return env;
      envOptionEffects(parsed.options, env);
      index = parsed.next;
    } else break;
  }
  env.child = index < words.length ? index : null;
  return env;
}

function splitEnvString(text) {
  // env -S has argv syntax, not shell operators or command substitutions.
  // Escape and variable expansion depend on env implementations/environment.
  if (/[\\$\n\r\v\f]/.test(text))
    throw new Error('Unsupported env split-string transformation');
  const words = [];
  const pattern = /(?:[^ \t'"#]|'(?:[^']*)'|"(?:[^"]*)")+/gy;
  let index = 0;
  while (index < text.length) {
    if (/[ \t]/.test(text[index])) {
      index += 1;
      continue;
    }
    if (text[index] === '#') break;
    pattern.lastIndex = index;
    const match = pattern.exec(text);
    if (!match) throw new Error('Unsupported env split-string quoting');
    words.push(
      match[0].replace(
        /'([^']*)'|"([^"]*)"/g,
        (_match, single, double) => single ?? double,
      ),
    );
    index = pattern.lastIndex;
    // An unquoted # inside an existing word is literal.
    if (text[index] === '#')
      throw new Error('Unsupported env split-string comment position');
  }
  return words;
}

function replaceEnvSplit(words, index, parsed) {
  const split = parsed.options.at(-1);
  if (split.value === undefined)
    throw new Error('Missing env split-string value');
  // Flags clustered before S, such as the -i of -iS, still apply.
  const flags = parsed.options
    .slice(0, -1)
    .map(({ name }) => name)
    .join('');
  return [
    ...words.slice(0, index),
    ...(flags ? [`-${flags}`] : []),
    ...splitEnvString(split.value),
    ...words.slice(parsed.next),
  ];
}

function expandEnvSplit(words) {
  if (words[0] !== 'env') return words;
  let index = 1;
  while (index < words.length) {
    const word = words[index];
    if (!word.startsWith('-') || word === '--') break;
    const parsed = envOptionAt(words, index);
    if (parsed.options.at(-1)?.name === 'S')
      return replaceEnvSplit(words, index, parsed);
    index = parsed.next;
  }
  return words;
}

function skipCommandOptions(words, start, valueOptions = []) {
  let index = start;
  while (
    words[index]?.startsWith('-') ||
    /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[index] || '')
  ) {
    const option = words[index++];
    if (option === '--') break;
    if (
      valueOptions.some(
        (value) =>
          option === value ||
          (value.length === 2 &&
            /^-[^-]+$/.test(option) &&
            option.endsWith(value[1])),
      )
    )
      index += 1;
  }
  return index;
}

function wrapperChildIndex(words) {
  const valueOptions = WRAPPER_VALUE_OPTIONS[words[0]];
  if (!Array.isArray(valueOptions)) return null;
  let next = skipCommandOptions(words, 1, valueOptions);
  const options = words.slice(1, next);
  if (options.some((word) => ['--help', '--version'].includes(word)))
    return null;
  if (
    words[0] === 'command' &&
    options.some((word) => /^-[a-z]*[vV]/.test(word))
  )
    return null;
  next += WRAPPER_POSITIONALS[words[0]] || 0;
  return next < words.length ? next : null;
}

// macOS arch: -e NAME=VALUE sets and -d NAME unsets a child variable.
function archInvocation(words, launch) {
  let index = 1;
  while (words[index]?.startsWith('-')) {
    const option = words[index];
    const value = words[index + 1];
    if (option === '-e') launch.effects.push(...assignmentEffects([value]));
    if (option === '-d') launch.effects.push({ name: value, unset: true });
    index += ['-e', '-d', '-arch'].includes(option) ? 2 : 1;
  }
  return index < words.length ? index : null;
}

// Child index of an env or wrapper launcher, recording what it changes.
function launcherChild(words, launch) {
  if (words[0] === 'env') {
    const env = envInvocation(words);
    launch.effects.push(...env.effects);
    launch.chdirs.push(...env.chdirs);
    return env.child;
  }
  if (words[0] === 'arch') return archInvocation(words, launch);
  const next = wrapperChildIndex(words);
  // `time` is a shell keyword: assignments after it apply to the child.
  if (next !== null)
    launch.effects.push(...assignmentEffects(words.slice(1, next)));
  // `exec -c` runs its child with an empty environment.
  if (
    next !== null &&
    words[0] === 'exec' &&
    words.slice(1, next).some((word) => /^-[^-]*c/.test(word))
  )
    launch.effects.push({ clearAll: true });
  return next;
}

// The command a simple command's words launch through keywords, prefix
// assignments, env (including -S), and wrappers. `words` is the launched
// argv with its program basename; `program` is that program as written;
// `chdirs` are env -C directories in order; `effects` are environment
// changes: { name, value }, { name, unset }, or { clearAll }.
function commandLaunch(rawWords) {
  let start = 0;
  while (COMMAND_KEYWORDS.has(rawWords[start])) start += 1;
  let index = start;
  while (ASSIGNMENT.test(rawWords[index] || '')) index += 1;
  const launch = {
    words: rawWords.slice(index),
    program: null,
    chdirs: [],
    effects: assignmentEffects(rawWords.slice(start, index)),
  };
  let remaining = 100000;
  while (launch.words.length > 0) {
    remaining -= launch.words.length;
    if (remaining < 0)
      throw new Error('Command normalization work limit exceeded');
    const words = launch.words;
    launch.program = words[0];
    words[0] = words[0].split('/').pop();
    const expanded = expandEnvSplit(words);
    if (expanded !== words) {
      launch.words = expanded;
      continue;
    }
    const next = launcherChild(words, launch);
    if (next === null) break; // env without a child still prints the environment.
    launch.words = words.slice(next);
  }
  return launch;
}

function commandWords(words) {
  return commandLaunch(words).words;
}

function preservesEnvironment(name, options) {
  return (
    name === 'sudo' &&
    options.some(
      (option) =>
        option === '--preserve-env' ||
        option.startsWith('--preserve-env=') ||
        /^-[^-]*E/.test(option),
    )
  );
}

// sudo and doas: NAME=VALUE operands become environment effects of the
// child, after the reset of its environment unless sudo preserves it.
function privilegedLaunch(words) {
  if (!Object.hasOwn(PRIVILEGE_VALUE_OPTIONS, words[0] ?? '')) return null;
  const valueOptions = PRIVILEGE_VALUE_OPTIONS[words[0]];
  const child = skipCommandOptions(words, 1, valueOptions);
  const options = words.slice(1, child);
  return {
    effects: [
      ...assignmentEffects(options),
      ...(preservesEnvironment(words[0], options)
        ? []
        : [{ privilegedReset: true }]),
    ],
    words: words.slice(child),
  };
}

const SU_VALUE_OPTIONS = new Set([
  '-s',
  '--shell',
  '-g',
  '--group',
  '-G',
  '--supp-group',
  '-w',
  '--whitelist-environment',
]);

// The shell command `su -c COMMAND` or `su --command=COMMAND` runs.
function suScript(words) {
  for (let index = 1; index < words.length; index += 1) {
    const word = words[index];
    if (word === '-c' || word === '--command') return words[index + 1] ?? null;
    if (word.startsWith('--command=')) return word.slice('--command='.length);
    if (SU_VALUE_OPTIONS.has(word)) index += 1;
  }
  return null;
}

function shellOptionKind(word, shell) {
  if (word === '--' || (word === '-' && shell !== 'fish')) return 'end';
  if (!/^[+-]/.test(word) || word === '-') return 'operand';
  if (['-o', '+o', '-O', '+O', '--rcfile', '--init-file'].includes(word))
    return 'value';
  if (/^-[^-]*c/.test(word) || (shell === 'fish' && word === '--command'))
    return 'script';
  return 'flags';
}

function applyShellFlags(mode, word) {
  if (/^[+-][^-]*n/.test(word)) mode.noExec = word[0] === '-';
  if (/^[+-][^-]*s/.test(word)) mode.stdin = word[0] === '-';
  mode.noExec ||= ['--help', '--version'].includes(word);
}

// `file` is the script file operand the shell executes, if any.
function shellExecution(mode, noOperand = false) {
  return {
    script: mode.noExec ? null : mode.script,
    stdin: !mode.noExec && mode.script === null && (mode.stdin || noOperand),
    file: mode.noExec || mode.stdin ? null : mode.file,
  };
}

// The first operand is the script under `-c`, else the script file.
function shellOperand(mode, word) {
  if (mode.command) mode.script = word ?? '';
  else mode.file = word ?? null;
  return shellExecution(mode, !mode.command && word === undefined);
}

// fish reads the next word after -c as its command; other shells read -c as
// a flag and take the first operand, after any further options or `--`.
function shellInvocation(rawWords) {
  const words = commandWords(rawWords);
  if (!['sh', 'bash', 'zsh', 'dash', 'ksh', 'fish'].includes(words[0]))
    return null;
  const mode = { stdin: false, noExec: false, script: null, file: null };
  let index = 1;
  while (index < words.length) {
    const word = words[index];
    applyShellFlags(mode, word);
    switch (shellOptionKind(word, words[0])) {
      case 'end':
        return shellOperand(mode, words[index + 1]);
      case 'operand':
        return shellOperand(mode, word);
      case 'script':
        if (words[0] === 'fish') {
          mode.script = words[index + 1] || '';
          return shellExecution(mode);
        }
        mode.command = true;
        index += 1;
        break;
      case 'value':
        index += 2;
        break;
      default:
        index += 1;
    }
  }
  return mode.command ? shellOperand(mode, '') : shellExecution(mode, true);
}

function shellReadsStdin(words) {
  return shellInvocation(words)?.stdin || false;
}

function isShellCommand(words) {
  return shellInvocation(words) !== null;
}

function sshOption(word) {
  const result = { nextValue: false, noCommand: false, nullStdin: false };
  for (let index = 1; index < word.length; index += 1) {
    const flag = word[index];
    result.noCommand ||= 'GNQsVWOZ'.includes(flag);
    result.nullStdin ||= 'nf'.includes(flag);
    if ('BbcDEeFIiJLlmOopQRSWw'.includes(flag)) {
      result.nextValue = index === word.length - 1;
      break;
    }
  }
  return result;
}

function sshInvocation(words) {
  let host = 1;
  let noCommand = false;
  let stdin = true;
  while (words[host]?.startsWith('-') && words[host] !== '--') {
    const option = sshOption(words[host]);
    noCommand ||= option.noCommand;
    stdin &&= !option.nullStdin;
    host += option.nextValue ? 2 : 1;
  }
  if (words[host] === '--') host += 1;
  // OpenSSH joins the remote argv with spaces before sending shell code.
  // https://man.openbsd.org/ssh#DESCRIPTION
  return { script: noCommand ? '' : words.slice(host + 1).join(' '), stdin };
}

module.exports = {
  suScript,
  COMMAND_KEYWORDS,
  commandLaunch,
  commandWords,
  privilegedLaunch,
  skipCommandOptions,
  shellInvocation,
  sshInvocation,
  shellReadsStdin,
  isShellCommand,
};
