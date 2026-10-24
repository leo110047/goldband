// Brace expansion of one shell word, as bash and zsh apply it before any
// other expansion. The parser passes a pattern in which quoted and escaped
// characters carry a backslash, so only unquoted braces expand.
// A word may expand to at most this many words before analysis fails closed.
const BRACE_WORD_LIMIT = 10000;
const NUMBER_SEQUENCE = /^(-?\d+)\.\.(-?\d+)(?:\.\.(-?\d+))?$/;
const LETTER_SEQUENCE = /^([A-Za-z])\.\.([A-Za-z])(?:\.\.(-?\d+))?$/;

function escapeBraceText(text) {
  return text.replace(/[\\{},]/g, '\\$&');
}

function unescapeBraceText(text) {
  return text.replace(/\\([\s\S])/g, '$1');
}

function sequenceValues(first, last, step, format) {
  const increment = Math.abs(Number(step || 1)) || 1;
  const count = Math.floor(Math.abs(last - first) / increment) + 1;
  if (count > BRACE_WORD_LIMIT) throw new Error('Brace expansion limit');
  const direction = last < first ? -1 : 1;
  return Array.from({ length: count }, (_, index) =>
    format(first + direction * index * increment),
  );
}

// The words a `{...}` body stands for, or null when it is not an expansion.
function braceAlternatives(body, commas) {
  if (commas.length) {
    const bounds = [-1, ...commas, body.length];
    return bounds
      .slice(1)
      .map((end, index) => body.slice(bounds[index] + 1, end));
  }
  const number = NUMBER_SEQUENCE.exec(body);
  if (number) {
    const width = /^-?0\d/.test(number[1]) ? number[1].length : 0;
    return sequenceValues(
      Number(number[1]),
      Number(number[2]),
      number[3],
      (n) => String(n).padStart(width, '0'),
    );
  }
  const letter = LETTER_SEQUENCE.exec(body);
  if (!letter) return null;
  return sequenceValues(
    letter[1].charCodeAt(0),
    letter[2].charCodeAt(0),
    letter[3],
    (code) => String.fromCharCode(code),
  );
}

// Every matched `{...}` by its opening offset, with the offsets of its
// top-level commas relative to the body, found in one pass.
function bracePairs(pattern) {
  const pairs = new Map();
  const open = [];
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === '\\') index += 1;
    else if (char === '{') open.push({ start: index, commas: [] });
    else if (char === '}' && open.length) {
      const group = open.pop();
      pairs.set(group.start, { end: index, commas: group.commas });
    } else if (char === ',' && open.length)
      open.at(-1).commas.push(index - open.at(-1).start - 1);
  }
  return pairs;
}

// The first expandable group: its bounds and alternatives.
function firstGroup(pattern) {
  const pairs = bracePairs(pattern);
  let parameterEnd = -1;
  for (const start of [...pairs.keys()].sort((a, b) => a - b)) {
    const close = pairs.get(start);
    if (start < parameterEnd) continue;
    // `${...}` is parameter expansion, not a brace group; nothing inside it
    // expands.
    if (pattern[start - 1] === '$') {
      parameterEnd = close.end;
      continue;
    }
    const alternatives = braceAlternatives(
      pattern.slice(start + 1, close.end),
      close.commas,
    );
    if (alternatives) return { start, end: close.end, alternatives };
  }
  return null;
}

function expandPattern(pattern, results) {
  const group = firstGroup(pattern);
  if (!group) {
    if (results.push(pattern) > BRACE_WORD_LIMIT)
      throw new Error('Brace expansion limit');
    return;
  }
  const prefix = pattern.slice(0, group.start);
  const suffix = pattern.slice(group.end + 1);
  for (const alternative of group.alternatives)
    expandPattern(prefix + alternative + suffix, results);
}

function expandBraces(pattern) {
  const results = [];
  expandPattern(pattern, results);
  return results.map(unescapeBraceText);
}

module.exports = { escapeBraceText, expandBraces };
