import { config, run, ToolError } from './config.mjs';

// Every added-line rule reads the raw staged text: `--text` keeps `-diff`
// paths readable, and `--no-ext-diff`/`--no-textconv` keep a repository's
// diff drivers from rewriting or hiding it. A Git failure is a check failure,
// never an empty change.
const DIFF_ARGS = [
  'diff',
  '--cached',
  '--unified=0',
  '--text',
  '--no-ext-diff',
  '--no-textconv',
  '--no-color',
];

// The diff holds the removed and the added text; both are bounded by the
// largest file limit the gate reads.
const DIFF_MAX_BUFFER =
  4 *
  Math.max(
    config.maxTextBytes,
    config.maxGeneratedTextBytes,
    config.maxBinaryBytes,
  );

// The index does not change during one run; several rules read each file.
const cache = new Map();

export function getAddedLines(file) {
  if (!cache.has(file)) cache.set(file, readAddedLines(file));
  return cache.get(file);
}

function readAddedLines(file) {
  const result = run('git', [...DIFF_ARGS, '--', `:(top,literal)${file}`], {
    maxBuffer: DIFF_MAX_BUFFER,
  });
  if (result.error || result.status !== 0) {
    throw new ToolError(
      `check failed: cannot read staged added lines of ${file}`,
      result.error?.message || result.stderr?.trim(),
    );
  }
  const state = { added: [], newLine: null };
  for (const rawLine of result.stdout.split('\n')) {
    updateAddedLineState(state, rawLine);
  }
  return state.added;
}

// With `--unified=0` a hunk holds only removed lines, added lines, and
// "\ No newline" markers. File headers precede the first hunk, so an added
// line whose text starts with "++" is still an added line.
function updateAddedLineState(state, rawLine) {
  const hunk = rawLine.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
  if (hunk) {
    state.newLine = Number(hunk[1]);
    return;
  }
  if (state.newLine === null || !rawLine.startsWith('+')) return;
  state.added.push({ line: state.newLine, text: rawLine.slice(1) });
  state.newLine += 1;
}
