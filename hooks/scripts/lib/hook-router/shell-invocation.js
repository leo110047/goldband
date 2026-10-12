// Normalize explicit command launch and shell option syntax without executing it.
const WRAPPER_VALUE_OPTIONS = {
  env: ['-u', '--unset', '-C', '--chdir', '-P'],
  command: [],
  exec: ['-a'],
  nohup: [],
  time: ['-f', '--format', '-o', '--output'],
  nice: ['-n', '--adjustment'],
  timeout: ['-k', '--kill-after', '-s', '--signal'],
  caffeinate: ['-t', '-w'],
};

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

function envSplitOption(word) {
  if (word === '--split-string') return { attached: null };
  if (word.startsWith('--split-string='))
    return { attached: word.slice('--split-string='.length) };
  const short = /^-[iv0]*S([\s\S]*)$/.exec(word);
  return short ? { attached: short[1] || null } : null;
}

function replaceEnvSplit(words, index, split) {
  const consumes = split.attached === null ? 2 : 1;
  const text = split.attached ?? words[index + 1];
  if (text === undefined) throw new Error('Missing env split-string value');
  return [
    ...words.slice(0, index),
    ...splitEnvString(text),
    ...words.slice(index + consumes),
  ];
}

function expandEnvSplit(words) {
  if (words[0] !== 'env') return words;
  for (let index = 1; index < words.length; index += 1) {
    const word = words[index];
    if (!word.startsWith('-') || word === '--') break;
    const split = envSplitOption(word);
    if (split) return replaceEnvSplit(words, index, split);
    if (WRAPPER_VALUE_OPTIONS.env.includes(word)) index += 1;
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
  if (words[0] === 'timeout') next += 1;
  return next < words.length ? next : null;
}

function commandWords(words) {
  let index = 0;
  while (
    ['if', 'then', 'else', 'elif', 'while', 'until', 'do', '!', '{'].includes(
      words[index],
    )
  )
    index += 1;
  while (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[index] || '')) index += 1;
  let result = words.slice(index);
  let remaining = 100000;
  while (result.length > 0) {
    remaining -= result.length;
    if (remaining < 0)
      throw new Error('Command normalization work limit exceeded');
    result[0] = result[0].split('/').pop();
    const expanded = expandEnvSplit(result);
    if (expanded !== result) {
      result = expanded;
      continue;
    }
    const next = wrapperChildIndex(result);
    if (next === null) break; // env without a child still prints the environment.
    result = result.slice(next);
  }
  return result;
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

function shellExecution(mode, noOperand = false) {
  return {
    script: mode.noExec ? null : mode.script,
    stdin: !mode.noExec && mode.script === null && (mode.stdin || noOperand),
  };
}

function shellInvocation(rawWords) {
  const words = commandWords(rawWords);
  if (!['sh', 'bash', 'zsh', 'dash', 'ksh', 'fish'].includes(words[0]))
    return null;
  const mode = { stdin: false, noExec: false, script: null };
  let index = 1;
  while (index < words.length) {
    const word = words[index];
    applyShellFlags(mode, word);
    switch (shellOptionKind(word, words[0])) {
      case 'end':
        return shellExecution(mode, index + 1 >= words.length);
      case 'operand':
        return shellExecution(mode);
      case 'script':
        mode.script = words[index + 1] || '';
        return shellExecution(mode);
      case 'value':
        index += 2;
        break;
      default:
        index += 1;
    }
  }
  return shellExecution(mode, true);
}

function shellReadsStdin(words) {
  return shellInvocation(words)?.stdin || false;
}

function isShellCommand(words) {
  return shellInvocation(words) !== null;
}

module.exports = {
  commandWords,
  shellInvocation,
  shellReadsStdin,
  isShellCommand,
  skipCommandOptions,
};
