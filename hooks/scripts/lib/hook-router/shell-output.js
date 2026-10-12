// Interpret only explicit literal echo/printf output used by a downstream consumer.
// Unknown transformations must not become empty, apparently safe shell or SQL input.
const OUTPUT_ESCAPES = {
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
};

function expandedOutput(text, stopAtC = false) {
  let result = '';
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== '\\' || index + 1 === text.length) {
      result += text[index];
      continue;
    }
    const escaped = text[++index];
    if (stopAtC && escaped === 'c') return { text: result, stopped: true };
    if (!Object.prototype.hasOwnProperty.call(OUTPUT_ESCAPES, escaped))
      throw new Error('Unsupported literal output escape');
    result += OUTPUT_ESCAPES[escaped];
  }
  return { text: result, stopped: false };
}

function echoOutput(words) {
  let start = 1;
  let escapes = null;
  let newline = true;
  while (/^-[neE]+$/.test(words[start] || '')) {
    const option = words[start++];
    if (option.includes('n')) newline = false;
    const flags = option.match(/[eE]/g) || [];
    if (flags.length) escapes = flags[flags.length - 1] === 'e';
  }
  const text = words.slice(start).join(' ');
  // Without -e/-E, escape handling depends on the host shell and its options.
  if (escapes === null && text.includes('\\'))
    throw new Error('Ambiguous echo escape mode');
  const output = escapes
    ? expandedOutput(text, true)
    : { text, stopped: false };
  return output.text + (newline && !output.stopped ? '\n' : '');
}

function literalOutput(words) {
  if (words[0] === 'echo') return echoOutput(words);
  if (words[0] !== 'printf') return '';
  const args = words.slice(words[1] === '--' ? 2 : 1);
  const format = args.shift() || '';
  if (!format.includes('%')) return expandedOutput(format).text;
  if (format === '%s') return args.join('');
  if (format === '%s\\n')
    return (args.length ? args : ['']).map((arg) => `${arg}\n`).join('');
  throw new Error('Unsupported printf format');
}

module.exports = { literalOutput };
