import { createRequire } from 'node:module';
import path from 'node:path';
import { runBiome } from './biome.mjs';
import { config, run, ToolError } from './config.mjs';
import {
  JS_EXTENSIONS,
  PY_EXTENSIONS,
  SHELL_EXTENSIONS,
  TEXT_SCAN_EXTENSIONS,
} from './constants.mjs';
import {
  decodeText,
  fileContent,
  fileSize,
  isBinary,
  isCodeFile,
  lineCount,
} from './files.mjs';
import {
  allowsLargeGeneratedText,
  loadLargeGeneratedTextPolicy,
} from './generated-text.mjs';
import { advisory, violation } from './issues.mjs';

const require = createRequire(import.meta.url);
const {
  detectSecrets,
  isSecretScanExcluded,
  matchSecrets,
} = require('../../../hooks/scripts/lib/hook-router/secret-patterns.js');

const TS_IGNORE = '@ts-' + 'ignore';
const TS_NOCHECK = '@ts-' + 'nocheck';
const UNKNOWN_CAST = ['as', 'unknown', 'as'].join(' ');
const BIOME_IGNORE = 'biome-' + 'ignore';
const ESLINT_DISABLE = 'eslint-' + 'disable';
const DEBUGGER_KEYWORD = 'debug' + 'ger';
const tsSuppressionPattern = new RegExp(
  `${escapeRegExp(TS_IGNORE)}\\b|${escapeRegExp(TS_NOCHECK)}\\b`,
);
const unknownCastPattern = new RegExp(
  `\\b${UNKNOWN_CAST.replaceAll(' ', '\\s+')}\\b`,
);
const biomeIgnorePattern = new RegExp(`\\b${escapeRegExp(BIOME_IGNORE)}\\b`);
const eslintDisablePattern = new RegExp(
  `${escapeRegExp(ESLINT_DISABLE)}(?!-next-line|-line)`,
);
const debuggerPattern = new RegExp(`\\b${DEBUGGER_KEYWORD}\\b`);

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Paths excluded from style checks still receive the secret scan; a write
// there reaches disk the same way. Oversized and binary files are skipped.
// Dependency and Git internals are never committed through this path and can
// hold tens of thousands of files.
const SECRET_SCAN_SKIP = /(?:^|\/)(?:node_modules|\.git)\//;

export function checkSecretsOnly(files, mode) {
  const issues = [];
  for (const file of files) {
    if (SECRET_SCAN_SKIP.test(file)) continue;
    const size = fileSize(file, mode);
    if (size === null || size > config.maxTextBytes) continue;
    const text = decodeText(fileContent(file, mode));
    if (text !== null) checkSecrets(file, text, mode, issues);
  }
  return issues;
}

export function checkFiles(files, mode, options = {}) {
  const issues = [];
  const generatedTextPolicy = loadLargeGeneratedTextPolicy(mode);
  for (const file of files) {
    checkFile(file, mode, issues, generatedTextPolicy);
  }
  runBiome(files, issues, mode, options);
  return issues;
}

function checkFile(file, mode, issues, generatedTextPolicy) {
  checkSensitivePath(file, issues);
  const size = fileSize(file, mode);
  if (size === null) return;
  const largestConfiguredLimit = Math.max(
    config.maxTextBytes,
    config.maxGeneratedTextBytes,
    config.maxBinaryBytes,
  );
  if (size > largestConfiguredLimit) {
    issues.push(
      violation(
        'file-size',
        file,
        `file has ${size} bytes, largest configured limit is ${largestConfiguredLimit}`,
      ),
    );
    return;
  }
  const buffer = fileContent(file, mode);
  if (!buffer) {
    throw new ToolError(`file disappeared while checking: ${file}`);
  }
  checkFileSize(file, buffer, issues, generatedTextPolicy);

  const text = decodeText(buffer);
  if (text === null) return;
  checkSecrets(file, text, mode, issues);
  checkLineCount(file, text, issues);
  checkFullTextRules(file, text, mode, issues);
  checkDeltaRules(file, text, mode, issues);
  checkShellFunctions(file, text, issues);
  checkPythonFunctions(file, text, issues);
}

function checkSensitivePath(file, issues) {
  const name = path.basename(file);
  if (/^\.env(?:$|\.)/.test(name) && !/\.example$/.test(name)) {
    issues.push(
      violation('sensitive-path', file, 'staged environment file is blocked'),
    );
  }
  if (/(\.pem|\.key|id_rsa|id_ed25519|\.p12|\.pfx)$/.test(name)) {
    issues.push(
      violation(
        'sensitive-path',
        file,
        'staged credential/key file is blocked',
      ),
    );
  }
  if (isGeneratedPath(file, name)) {
    issues.push(
      violation(
        'generated-path',
        file,
        'generated or OS noise file is blocked',
      ),
    );
  }
}

function isGeneratedPath(file, name) {
  return (
    name === '.DS_Store' ||
    file.includes('/node_modules/') ||
    file.startsWith('node_modules/')
  );
}

function checkFileSize(file, buffer, issues, generatedTextPolicy) {
  if (!buffer) return;
  if (isBinary(buffer) && buffer.length > config.maxBinaryBytes) {
    issues.push(
      violation(
        'binary-size',
        file,
        `binary file has ${buffer.length} bytes, max is ${config.maxBinaryBytes}`,
      ),
    );
    return;
  }
  if (
    !isBinary(buffer) &&
    buffer.length > config.maxTextBytes &&
    !allowsLargeGeneratedText(generatedTextPolicy, file, buffer.length)
  ) {
    issues.push(
      violation(
        'text-size',
        file,
        `text file has ${buffer.length} bytes, max is ${config.maxTextBytes}`,
      ),
    );
  }
}

function checkLineCount(file, text, issues) {
  if (!isCodeFile(file)) return;
  const lines = lineCount(text);
  if (lines > config.maxFileLines) {
    issues.push(
      violation(
        'file-lines',
        file,
        `file has ${lines} lines, max is ${config.maxFileLines}`,
      ),
    );
  }
}

// Path exemptions belong to the Git style gate and repository scans; live
// checks of tool and shell writes (`files`, `worktree`) never exempt a path.
const LIVE_MODES = new Set(['files', 'worktree']);

function indexedSecretValues(file) {
  try {
    const text = decodeText(fileContent(file, 'staged'));
    return new Set(matchSecrets(text).map((item) => item.value));
  } catch {
    return new Set();
  }
}

// Live checks report a signature only for values the write introduced: a value
// already in the indexed version (synthetic test data, an earlier finding) is
// not new, but a second, different value of the same signature is.
function newSecretFindings(file, text) {
  const matches = matchSecrets(text);
  if (matches.length === 0) return [];
  const known = indexedSecretValues(file);
  const findings = new Map();
  for (const match of matches) {
    if (!known.has(match.value)) findings.set(match.name, match);
  }
  return [...findings.values()];
}

function checkSecrets(file, text, mode, issues) {
  if (!LIVE_MODES.has(mode) && isSecretScanExcluded(file)) return;
  const found = LIVE_MODES.has(mode)
    ? newSecretFindings(file, text)
    : detectSecrets(text);
  for (const item of found) {
    const message = `${item.severity === 'high' ? 'potential secret' : 'credential-shaped text'} detected: ${item.name}`;
    issues.push(
      item.severity === 'high'
        ? violation('secret-scan', file, message)
        : advisory('secret-scan', file, message),
    );
  }
}

function checkFullTextRules(file, text, mode, issues) {
  const ext = path.extname(file);
  if (!TEXT_SCAN_EXTENSIONS.has(ext)) return;
  const conflictLine = findMergeConflictBlock(
    linesForFullTextRules(file, text, mode),
  );
  if (conflictLine !== null) {
    issues.push(
      violation(
        'merge-conflict',
        file,
        'merge conflict marker block found',
        conflictLine,
      ),
    );
  }
}

function linesForFullTextRules(file, text, mode) {
  return mode === 'staged' ? getAddedLines(file) : allLines(text);
}

function findMergeConflictBlock(lines) {
  const state = { separatorLine: null, startLine: null };
  for (const source of lines) {
    updateMergeConflictState(state, source);
    if (state.startLine !== null && state.separatorLine === 'complete') {
      return state.startLine;
    }
  }
  return null;
}

function updateMergeConflictState(state, source) {
  if (/^<<<<<<<(?: .*)?$/.test(source.text)) {
    state.startLine = source.line;
    state.separatorLine = null;
    return;
  }
  if (state.startLine !== null && /^=======$/.test(source.text)) {
    state.separatorLine = source.line;
    return;
  }
  if (
    state.startLine !== null &&
    state.separatorLine !== null &&
    /^>>>>>>>(?: .*)?$/.test(source.text)
  ) {
    state.separatorLine = 'complete';
  }
}

function getAddedLines(file) {
  const result = run('git', ['diff', '--cached', '--unified=0', '--', file]);
  if (result.status !== 0) return [];
  const state = { added: [], newLine: null };
  for (const rawLine of result.stdout.split('\n')) {
    updateAddedLineState(state, rawLine);
  }
  return state.added;
}

function updateAddedLineState(state, rawLine) {
  const hunk = rawLine.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
  if (hunk) {
    state.newLine = Number(hunk[1]);
    return;
  }
  if (rawLine.startsWith('+++') || rawLine.startsWith('---')) return;
  if (rawLine.startsWith('+')) {
    state.added.push({ line: state.newLine || null, text: rawLine.slice(1) });
    if (state.newLine !== null) state.newLine += 1;
  } else if (!rawLine.startsWith('-') && state.newLine !== null) {
    state.newLine += 1;
  }
}

function linesForDeltaRules(file, text, mode) {
  return mode === 'staged' ? getAddedLines(file) : allLines(text);
}

function allLines(text) {
  return text
    .split('\n')
    .map((line, index) => ({ line: index + 1, text: line }));
}

function checkDeltaRules(file, text, mode, issues) {
  const context = {
    file,
    isJs: JS_EXTENSIONS.has(path.extname(file)),
    isTs: ['.ts', '.tsx'].includes(path.extname(file)),
    isTest: isTestFile(file),
    consoleLogAllowed: isConsoleOutputFile(file, text),
  };
  for (const source of linesForDeltaRules(file, text, mode)) {
    checkDeltaLine(context, source, issues);
  }
}

function checkDeltaLine(context, source, issues) {
  checkConsoleAndDebugger(context, source, issues);
  checkEscapeHatches(context, source, issues);
  checkFocusedTests(context, source, issues);
  checkAdvisoryTypeEscapes(context, source, issues);
}

function checkConsoleAndDebugger(context, source, issues) {
  if (
    context.isJs &&
    !context.consoleLogAllowed &&
    /console\.log\s*\(/.test(source.text)
  ) {
    issues.push(
      violation(
        'console-log',
        context.file,
        'console.log is blocked',
        source.line,
      ),
    );
  }
  if (context.isJs && debuggerPattern.test(source.text)) {
    issues.push(
      violation(
        DEBUGGER_KEYWORD,
        context.file,
        `${DEBUGGER_KEYWORD} statement is blocked`,
        source.line,
      ),
    );
  }
}

function checkEscapeHatches(context, source, issues) {
  const line = source.text;
  if (context.isTs && tsSuppressionPattern.test(line)) {
    issues.push(
      violation(
        'escape-hatch',
        context.file,
        `${TS_IGNORE} and ${TS_NOCHECK} are blocked`,
        source.line,
      ),
    );
  }
  if (context.isTs && unknownCastPattern.test(line)) {
    issues.push(
      violation(
        'escape-hatch',
        context.file,
        `${UNKNOWN_CAST} is blocked`,
        source.line,
      ),
    );
  }
  if (context.isJs && biomeIgnorePattern.test(line)) {
    issues.push(
      violation(
        'escape-hatch',
        context.file,
        `${BIOME_IGNORE} is blocked`,
        source.line,
      ),
    );
  }
  if (context.isJs && eslintDisablePattern.test(line)) {
    issues.push(
      violation(
        'escape-hatch',
        context.file,
        `whole-file ${ESLINT_DISABLE} is blocked`,
        source.line,
      ),
    );
  }
}

function checkFocusedTests(context, source, issues) {
  if (!context.isJs || !context.isTest) return;
  const focusedPattern =
    /(?:\b(?:describe|it|test)\.only\s*\(|\b(?:fdescribe|fit)\s*\()/;
  if (focusedPattern.test(source.text)) {
    issues.push(
      violation(
        'focused-test',
        context.file,
        'focused test is blocked',
        source.line,
      ),
    );
  }

  const skippedPattern =
    /(?:\b(?:describe|it|test)\.skip\s*\(|\b(?:xdescribe|xit)\s*\()/;
  if (skippedPattern.test(source.text)) {
    issues.push(
      violation(
        'skipped-test',
        context.file,
        'skipped test is blocked',
        source.line,
      ),
    );
  }
}

function checkAdvisoryTypeEscapes(context, source, issues) {
  if (
    context.isJs &&
    /\bany\b/.test(source.text) &&
    /[:<,]\s*any\b|\bas\s+any\b/.test(source.text)
  ) {
    issues.push(
      advisory(
        'explicit-any',
        context.file,
        'explicit any is advisory for now',
        source.line,
      ),
    );
  }
  if (context.isTs && /@ts-expect-error\b(?!.*\S.{8,})/.test(source.text)) {
    issues.push(
      advisory(
        'ts-expect-error',
        context.file,
        '@ts-expect-error should include a reason',
        source.line,
      ),
    );
  }
}

function isTestFile(file) {
  return (
    /(^|\/)(__tests__|test|tests|spec)\//.test(file) ||
    /\.(test|spec)\.[cm]?[jt]sx?$/.test(file)
  );
}

function isConsoleOutputFile(file, text) {
  const firstLine = text.split('\n', 1)[0] || '';
  return (
    firstLine.includes('node') ||
    file.startsWith('scripts/') ||
    file.startsWith('hooks/scripts/tools/') ||
    file === 'hooks/scripts/lib/hook-router/mode-cli.js' ||
    file === 'hooks/scripts/lib/utils.js' ||
    /\/scripts\/[^/]+\.js$/.test(file)
  );
}

function checkShellFunctions(file, text, issues) {
  if (!SHELL_EXTENSIONS.has(path.extname(file))) return;
  const state = { file, functionStart: null, braceDepth: 0, issues };
  text.split('\n').forEach((line, index) => {
    updateShellFunctionState(state, line, index);
  });
}

function updateShellFunctionState(state, line, index) {
  if (state.functionStart === null && isShellFunctionStart(line)) {
    state.functionStart = index + 1;
    state.braceDepth = 0;
  }
  if (state.functionStart === null) return;
  state.braceDepth += (line.match(/\{/g) || []).length;
  state.braceDepth -= (line.match(/\}/g) || []).length;
  if (state.braceDepth <= 0) {
    reportShellFunction(state, index);
    state.functionStart = null;
  }
}

function isShellFunctionStart(line) {
  return /^\s*(?:function\s+)?[A-Za-z_][A-Za-z0-9_-]*\s*(?:\(\))?\s*\{/.test(
    line,
  );
}

function reportShellFunction(state, index) {
  const length = index + 1 - state.functionStart + 1;
  if (length <= config.maxFunctionLines) return;
  state.issues.push(
    advisory(
      'function-lines',
      state.file,
      `shell function appears to have ${length} lines, max is ${config.maxFunctionLines}`,
      state.functionStart,
    ),
  );
}

function checkPythonFunctions(file, text, issues) {
  if (!PY_EXTENSIONS.has(path.extname(file))) return;
  const lines = text.split('\n');
  let current = null;
  lines.forEach((line, index) => {
    const next = updatePythonFunction({ file, issues, current, line, index });
    current = next;
  });
  if (current) reportPythonFunction(file, current, lines.length, issues);
}

function updatePythonFunction(context) {
  const { file, issues, current, line, index } = context;
  const def = line.match(/^(\s*)def\s+[A-Za-z_][A-Za-z0-9_]*\s*\(/);
  if (def) {
    if (current) reportPythonFunction(file, current, index, issues);
    return { start: index + 1, indent: def[1].length };
  }
  if (pythonFunctionEnded(current, line)) {
    reportPythonFunction(file, current, index, issues);
    return null;
  }
  return current;
}

function pythonFunctionEnded(current, line) {
  return (
    current &&
    line.trim() &&
    !line.startsWith(' '.repeat(current.indent + 1)) &&
    !line.startsWith('\t')
  );
}

function reportPythonFunction(file, current, endExclusive, issues) {
  const length = endExclusive - current.start + 1;
  if (length <= config.maxFunctionLines) return;
  issues.push(
    advisory(
      'function-lines',
      file,
      `python function appears to have ${length} lines, max is ${config.maxFunctionLines}`,
      current.start,
    ),
  );
}
