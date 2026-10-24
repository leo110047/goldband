import path from 'node:path';
import { advisory, violation } from './issues.mjs';

// Only a skip that is unconditional by its syntax blocks: a decorator line. A
// skip that may be a legitimate runtime or platform condition is advisory; the
// gate does not analyse control flow.
const PYTHON_BLOCKED = [
  /^\s*@pytest\.mark\.skip\b/,
  /^\s*@(?:unittest\.)?skip\b/,
  /^\s*@(?:pytest\.mark\.skipif|(?:unittest\.)?skipIf)\(\s*True\b/,
  /^\s*@(?:unittest\.)?skipUnless\(\s*False\b/,
];
const PYTHON_ADVISORY = [/\bpytest\.skip\s*\(/];
const GO_ADVISORY = [/\bt\.(?:Skip|Skipf|SkipNow)\s*\(/];
const RUST_ADVISORY = [/#\[ignore(?:\s*=[^\]]*)?\]/];

const LANGUAGES = [
  {
    matches: isPythonTestFile,
    blocked: PYTHON_BLOCKED,
    advisory: PYTHON_ADVISORY,
    comment: '#',
    quotes: `'"`,
  },
  {
    matches: (file, name) => name.endsWith('_test.go'),
    blocked: [],
    advisory: GO_ADVISORY,
    comment: '//',
    quotes: '"`\'',
  },
  {
    matches: (file, name) => name.endsWith('.rs'),
    blocked: [],
    advisory: RUST_ADVISORY,
    comment: '//',
    quotes: '"',
  },
];

// Resolved once per file; null when no skip rule applies to the path.
export function languageSkipRules(file) {
  const name = path.basename(file);
  return LANGUAGES.find((language) => language.matches(file, name)) ?? null;
}

function isPythonTestFile(file, name) {
  if (!name.endsWith('.py')) return false;
  return (
    name.startsWith('test_') ||
    name.endsWith('_test.py') ||
    /(^|\/)tests\//.test(file)
  );
}

export function checkLanguageSkips(rules, file, source, issues) {
  const code = codeText(source.text, rules);
  if (rules.blocked.some((pattern) => pattern.test(code))) {
    issues.push(
      violation(
        'skipped-test',
        file,
        'unconditional test skip is blocked',
        source.line,
      ),
    );
    return;
  }
  if (rules.advisory.some((pattern) => pattern.test(code))) {
    issues.push(
      advisory(
        'skipped-test',
        file,
        'test skip found; confirm the condition is intended',
        source.line,
      ),
    );
  }
}

// The line without its comment and with string literal contents blanked, so a
// mention in prose or in a string never matches. Each added line is read on
// its own: an interior line of a multi-line string or docstring is code.
function codeText(text, rules) {
  let code = '';
  let index = 0;
  while (index < text.length && !text.startsWith(rules.comment, index)) {
    const char = text[index];
    if (rules.quotes.includes(char)) {
      code += char + char;
      index = stringEnd(text, index);
    } else {
      code += char;
      index += 1;
    }
  }
  return code;
}

// The index after the literal that opens at start, or past the line's end.
function stringEnd(text, start) {
  const quote = text[start];
  let index = start + 1;
  while (index < text.length && text[index] !== quote) {
    index += text[index] === '\\' ? 2 : 1;
  }
  return index + 1;
}
