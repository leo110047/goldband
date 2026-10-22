// Word syntax the shared parser reads without the shell: ANSI-C `$'...'`
// quoting, and zsh glob groups and qualifiers or bash extglob groups that
// continue a word.
const SIMPLE_ESCAPES = {
  a: '\x07',
  b: '\b',
  e: '\x1b',
  E: '\x1b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
  v: '\v',
  '\\': '\\',
  "'": "'",
  '"': '"',
  '?': '?',
};
const NUMERIC_ESCAPES = [
  [/^[0-7]{1,3}/, 8],
  [/^x([0-9A-Fa-f]{1,2})/, 16],
  [/^u([0-9A-Fa-f]{1,4})/, 16],
  [/^U([0-9A-Fa-f]{1,8})/, 16],
];

// One escape after a backslash: [decoded text, characters consumed].
function ansiEscape(rest) {
  if (Object.hasOwn(SIMPLE_ESCAPES, rest[0]))
    return [SIMPLE_ESCAPES[rest[0]], 1];
  if (rest[0] === 'c' && rest.length > 1)
    return [String.fromCharCode(rest.charCodeAt(1) & 0x1f), 2];
  for (const [pattern, base] of NUMERIC_ESCAPES) {
    const match = pattern.exec(rest);
    if (!match) continue;
    const code = Number.parseInt(match[1] ?? match[0], base);
    if (code > 0x10ffff) throw new Error('Unsupported ANSI-C escape');
    return [String.fromCodePoint(code), match[0].length];
  }
  return [`\\${rest[0] ?? ''}`, rest.length ? 1 : 0];
}

// Reads `$'...'` at state.index and returns its decoded text, as bash and
// zsh do.
function readAnsiCQuoted(state) {
  state.index += 2;
  let value = '';
  while (state.index < state.text.length && state.text[state.index] !== "'") {
    if (state.text[state.index] !== '\\') {
      value += state.text[state.index++];
      continue;
    }
    const [text, used] = ansiEscape(state.text.slice(state.index + 1));
    // The shell passes words as C strings, so a NUL ends the argument.
    if (text === '\0') throw new Error('NUL in ANSI-C quoting');
    value += text;
    state.index += 1 + used;
  }
  state.index += 1;
  return value;
}

// zsh qualifiers `e` and `+` run shell code for each matched file.
function qualifierRunsCode(raw, previous) {
  const inner = raw.slice(1, -1);
  if (inner.includes('|') || '@!+'.includes(previous || ' ')) return false;
  return /[e+]/.test(inner);
}

// The text one step of a group adds and its depth change, or null at a blank
// or operator.
function groupStep(state, readWordPart) {
  const char = state.text[state.index];
  if (char === undefined || /[ \t\r\n;&<>]/.test(char)) return null;
  if (char !== '(' && char !== ')')
    return { text: readWordPart(state).value, depth: 0 };
  state.index += 1;
  return { text: char, depth: char === '(' ? 1 : -1 };
}

// The group that continues a word at state.index, or null when the text is
// not one: blanks and operators end it, leaving `(` to the caller.
function readGlobGroup(state, readWordPart, previous) {
  const start = state.index;
  let value = '';
  let depth = 0;
  do {
    // Probes of unclosed groups may rescan the rest of the text; their total
    // work is bounded so analysis ends well inside a hook timeout.
    if (--state.groupWork.remaining < 0)
      throw new Error('Glob group work limit exceeded');
    const step = groupStep(state, readWordPart);
    if (!step) {
      state.index = start;
      return null;
    }
    value += step.text;
    depth += step.depth;
  } while (depth > 0);
  if (!state.conditional && qualifierRunsCode(value, previous))
    throw new Error('zsh glob qualifier may run code');
  return value;
}

module.exports = { readAnsiCQuoted, readGlobGroup };
