import path from 'node:path';
import { getAddedLines } from './added-lines.mjs';
import { config } from './config.mjs';
import { fileSize, isStagedBinary } from './files.mjs';
import { violation } from './issues.mjs';

// Characters a reader cannot see but a model or compiler reads (Trojan Source,
// Rules File Backdoor). Only staged added lines are checked, so characters
// already committed pass; the gate guards the commit, not what an agent reads
// from the working tree before it.

const BIDI_NAMES = new Map([
  [0x202a, 'LEFT-TO-RIGHT EMBEDDING'],
  [0x202b, 'RIGHT-TO-LEFT EMBEDDING'],
  [0x202c, 'POP DIRECTIONAL FORMATTING'],
  [0x202d, 'LEFT-TO-RIGHT OVERRIDE'],
  [0x202e, 'RIGHT-TO-LEFT OVERRIDE'],
  [0x2066, 'LEFT-TO-RIGHT ISOLATE'],
  [0x2067, 'RIGHT-TO-LEFT ISOLATE'],
  [0x2068, 'FIRST STRONG ISOLATE'],
  [0x2069, 'POP DIRECTIONAL ISOLATE'],
]);

const ZERO_WIDTH_NAMES = new Map([
  [0x200b, 'ZERO WIDTH SPACE'],
  [0x200c, 'ZERO WIDTH NON-JOINER'],
  [0x200d, 'ZERO WIDTH JOINER'],
  [0x2060, 'WORD JOINER'],
  [0xfeff, 'ZERO WIDTH NO-BREAK SPACE'],
]);

const BOM = 0xfeff;
const ZWJ = 0x200d;
const WAVING_BLACK_FLAG = 0x1f3f4;
const CANCEL_TAG = 0xe007f;
const DIGIT_NAMES = 'ZERO ONE TWO THREE FOUR FIVE SIX SEVEN EIGHT NINE'.split(
  ' ',
);

// The only RGI emoji that use tag characters: England, Scotland, Wales.
const RGI_TAG_FLAGS = ['gbeng', 'gbsct', 'gbwls'].map((code) => [
  ...[...code].map((letter) => 0xe0000 + letter.codePointAt(0)),
  CANCEL_TAG,
]);

// Scripts whose ordinary text uses zero-width characters: Thai, Lao, Khmer,
// Myanmar, Arabic (including Persian), and the Indic scripts.
const ZERO_WIDTH_SCRIPT =
  /^[\p{scx=Thai}\p{scx=Lao}\p{scx=Khmer}\p{scx=Myanmar}\p{scx=Arabic}\p{scx=Devanagari}\p{scx=Bengali}\p{scx=Gurmukhi}\p{scx=Gujarati}\p{scx=Oriya}\p{scx=Tamil}\p{scx=Telugu}\p{scx=Kannada}\p{scx=Malayalam}\p{scx=Sinhala}]$/u;
const EMOJI_BEFORE_ZWJ =
  /^[\p{Extended_Pictographic}\p{Emoji_Modifier}\u{FE0F}]$/u;
const EMOJI_AFTER_ZWJ = /^\p{Extended_Pictographic}$/u;

// Names compare case-insensitively: a case-insensitive file system serves
// `Claude.md` as CLAUDE.md.
const INSTRUCTION_NAMES = new Set([
  'claude.md',
  'claude.local.md',
  'agents.md',
  'agents.override.md',
  'gemini.md',
  'skill.md',
  '.cursorrules',
  '.windsurfrules',
]);
const INSTRUCTION_PATH =
  /(?:^|\/)(?:(?:\.cursor\/rules|\.github\/instructions|\.claude|\.codex|\.agents)\/|\.github\/copilot-instructions\.md$)/i;

// Candidates are every staged path before style exclusions: a vendored or
// build path reaches the commit the same way.
export function checkHiddenUnicode(candidates, mode) {
  if (mode !== 'staged') return [];
  const issues = [];
  for (const file of new Set(candidates)) {
    if (!isStagedText(file)) continue;
    const instruction = isAgentInstructionFile(file);
    for (const source of getAddedLines(file)) {
      for (const found of findHiddenCharacters(source, instruction)) {
        issues.push(hiddenCharacterIssue(file, source.line, found));
      }
    }
  }
  return issues;
}

// Binary files (a NUL in the first 8000 bytes, regardless of diff attributes)
// are skipped; a file above every configured limit is reported by the size
// rules and never read. The size and the binary verdict reuse the style
// checks' reads of the same staged blob.
function isStagedText(file) {
  const size = fileSize(file, 'staged');
  const largest = Math.max(
    config.maxTextBytes,
    config.maxGeneratedTextBytes,
    config.maxBinaryBytes,
  );
  if (size === null || size > largest) return false;
  return isStagedBinary(file) === false;
}

function isAgentInstructionFile(file) {
  return (
    INSTRUCTION_NAMES.has(path.basename(file).toLowerCase()) ||
    INSTRUCTION_PATH.test(file)
  );
}

function hiddenCharacterIssue(file, line, found) {
  const code = `U+${found.codePoint.toString(16).toUpperCase().padStart(4, '0')}`;
  const extra = found.count > 1 ? ` (+${found.count - 1} more)` : '';
  const issue = violation(
    'hidden-unicode',
    file,
    `${code} ${found.name}${extra}`,
    line,
  );
  issue.column = found.column;
  return issue;
}

// Columns are 1-based Unicode code points of the added line.
function findHiddenCharacters(source, instruction) {
  const points = [...source.text].map((char) => char.codePointAt(0));
  const found = [];
  let index = 0;
  while (index < points.length) {
    index = scanAt({ points, index, found, instruction, line: source.line });
  }
  return found;
}

function scanAt(state) {
  const { points, index, found } = state;
  const codePoint = points[index];
  if (BIDI_NAMES.has(codePoint)) {
    found.push(hit(codePoint, BIDI_NAMES.get(codePoint), index));
    return index + 1;
  }
  if (codePoint === WAVING_BLACK_FLAG) return skipRgiTagFlag(points, index);
  if (isTag(codePoint)) return reportTagRun(points, index, found);
  if (ZERO_WIDTH_NAMES.has(codePoint) && state.instruction) {
    if (!zeroWidthAllowed(points, index, state.line)) {
      found.push(hit(codePoint, ZERO_WIDTH_NAMES.get(codePoint), index));
    }
  }
  return index + 1;
}

function hit(codePoint, name, index, count = 1) {
  return { codePoint, name, column: index + 1, count };
}

function isTag(codePoint) {
  return codePoint >= 0xe0000 && codePoint <= CANCEL_TAG;
}

function skipRgiTagFlag(points, index) {
  const flag = RGI_TAG_FLAGS.find((sequence) =>
    sequence.every(
      (codePoint, offset) => points[index + 1 + offset] === codePoint,
    ),
  );
  return index + 1 + (flag ? flag.length : 0);
}

// A run of tag characters is one finding; tag smuggling encodes whole
// sentences.
function reportTagRun(points, index, found) {
  let end = index;
  while (end < points.length && isTag(points[end])) end += 1;
  found.push(hit(points[index], tagName(points[index]), index, end - index));
  return end;
}

function tagName(codePoint) {
  const ascii = codePoint - 0xe0000;
  if (codePoint === 0xe0001) return 'LANGUAGE TAG';
  if (codePoint === CANCEL_TAG) return 'CANCEL TAG';
  if (ascii === 0x20) return 'TAG SPACE';
  const char = String.fromCodePoint(ascii);
  if (/[A-Z]/.test(char)) return `TAG LATIN CAPITAL LETTER ${char}`;
  if (/[a-z]/.test(char)) {
    return `TAG LATIN SMALL LETTER ${char.toUpperCase()}`;
  }
  if (/[0-9]/.test(char)) return `TAG DIGIT ${DIGIT_NAMES[ascii - 0x30]}`;
  return 'TAG CHARACTER';
}

function zeroWidthAllowed(points, index, line) {
  if (points[index] === BOM && index === 0 && line === 1) return true;
  const before = neighbor(points, index - 1);
  const after = neighbor(points, index + 1);
  if (ZERO_WIDTH_SCRIPT.test(before) && ZERO_WIDTH_SCRIPT.test(after)) {
    return true;
  }
  return (
    points[index] === ZWJ &&
    EMOJI_BEFORE_ZWJ.test(before) &&
    EMOJI_AFTER_ZWJ.test(after)
  );
}

function neighbor(points, index) {
  const codePoint = points[index];
  return codePoint === undefined ? '' : String.fromCodePoint(codePoint);
}
