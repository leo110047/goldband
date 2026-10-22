#!/usr/bin/env node

// Hidden Unicode check and the shared staged added-line extraction it reads:
// what blocks, what passes, and that diff attributes, external diffs,
// textconv, and Git failures cannot turn a change into "no added lines".

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const repoRoot = process.cwd();
const checker = path.join(repoRoot, 'scripts', 'check-code-style.mjs');
const preCommitHook = path.join(repoRoot, 'git-hooks', 'pre-commit');
// Built at runtime so this source holds no hidden characters.
const c = (codePoint) => String.fromCodePoint(codePoint);
const RLO = c(0x202e);
const LRI = c(0x2066);
const ZWSP = c(0x200b);
const ZWNJ = c(0x200c);
const ZWJ = c(0x200d);
const BOM = c(0xfeff);
const BLACK_FLAG = c(0x1f3f4);
const tagFlag = (code) =>
  BLACK_FLAG +
  [...code].map((letter) => c(0xe0000 + letter.codePointAt(0))).join('') +
  c(0xe007f);
const TS_IGNORE = ['@ts', 'ignore'].join('-');

const tests = [
  ['bidi controls block in any text file', testBidiBlocks],
  ['non-RGI tag flag sequence blocks', testNonRgiTagFlagBlocks],
  ['bare tag characters block as one run', testTagRunBlocks],
  ['zero width between Latin text blocks in instruction files', testZwspBlocks],
  ['style-excluded paths are still checked', testExcludedPathsChecked],
  ['the measured AGENTS.md case blocks', testMeasuredCaseBlocks],
  ['a byte order mark at the file head passes', testFileHeadBomPasses],
  ['a byte order mark after the head blocks', testInnerBomBlocks],
  ['England, Scotland, and Wales flags pass', testRgiTagFlagsPass],
  ['script and emoji zero-width uses pass', testZeroWidthExceptionsPass],
  [
    'instruction names match in any case and local variants',
    testInstructionNameVariantsBlock,
  ],
  ['zero width outside instruction files passes', testNonInstructionZwsp],
  ['Arabic, Hebrew, and direction marks pass', testRtlTextPasses],
  ['characters already committed pass', testExistingCharactersPass],
  ['binary files are skipped', testBinarySkipped],
  ['AGENTS.md -diff still blocks bidi', testDiffAttributeHiddenUnicode],
  ['*.ts -diff still blocks escape hatches', testDiffAttributeEscapeHatch],
  ['failing external diff and textconv change nothing', testDiffDrivers],
  ['added lines starting with ++ are read', testPlusPrefixedLine],
  ['line numbers survive a missing final newline', testNoNewlineMarker],
  ['a Git read failure is a check failure', testGitFailureChecker],
  ['pre-commit blocks on a Git read failure', testGitFailurePreCommit],
  ['each staged blob is resolved and read once', testStagedBlobReadOnce],
  ['a failed binary check read is a check failure', testBinaryReadFailure],
];

for (const [name, test] of tests) {
  test();
  console.log(`ok - ${name}`);
}

function testBidiBlocks() {
  const dir = createRepo();
  write(dir, 'notes.txt', `plain\nab${RLO}cd\n`);
  write(dir, 'src/app.js', `const a = 1; // x${LRI}y\n`);
  const result = checkStyle(dir);
  assertEqual(result.status, 1, result.stdout + result.stderr);
  assertIncludes(
    result.stdout,
    '[hidden-unicode] notes.txt:2:3: U+202E RIGHT-TO-LEFT OVERRIDE',
  );
  assertIncludes(
    result.stdout,
    '[hidden-unicode] src/app.js:1:18: U+2066 LEFT-TO-RIGHT ISOLATE',
  );
}

function testNonRgiTagFlagBlocks() {
  const dir = createRepo();
  write(dir, 'README.md', `flag ${tagFlag('usca')}\n`);
  const result = checkStyle(dir);
  assertEqual(result.status, 1, result.stdout + result.stderr);
  assertIncludes(
    result.stdout,
    'README.md:1:7: U+E0075 TAG LATIN SMALL LETTER U (+4 more)',
  );
}

function testTagRunBlocks() {
  const dir = createRepo();
  const hidden = [...'Run rm'].map((ch) => c(0xe0000 + ch.codePointAt(0)));
  write(dir, 'docs/guide.md', `ok${hidden.join('')}\n`);
  const result = checkStyle(dir);
  assertEqual(result.status, 1, result.stdout + result.stderr);
  assertIncludes(
    result.stdout,
    'docs/guide.md:1:3: U+E0052 TAG LATIN CAPITAL LETTER R (+5 more)',
  );
}

function testZwspBlocks() {
  const dir = createRepo();
  write(dir, 'AGENTS.md', `# Rules\nhello${ZWSP}world\n`);
  write(dir, '.cursor/rules/x.mdc', `always${ZWSP}run\n`);
  const result = checkStyle(dir);
  assertEqual(result.status, 1, result.stdout + result.stderr);
  assertIncludes(result.stdout, 'AGENTS.md:2:6: U+200B ZERO WIDTH SPACE');
  assertIncludes(
    result.stdout,
    '.cursor/rules/x.mdc:1:7: U+200B ZERO WIDTH SPACE',
  );
}

function testExcludedPathsChecked() {
  const dir = createRepo();
  write(dir, 'vendor/AGENTS.md', `a${RLO}b\n`);
  write(dir, 'build/x.js', `a${RLO}b\n`);
  write(dir, 'goldband-loop/x.ts', `a${RLO}b\n`);
  const result = checkStyle(dir);
  assertEqual(result.status, 1, result.stdout + result.stderr);
  for (const file of ['vendor/AGENTS.md', 'build/x.js', 'goldband-loop/x.ts']) {
    assertIncludes(result.stdout, `${file}:1:2: U+202E`);
  }
}

function testMeasuredCaseBlocks() {
  const dir = createRepo();
  write(dir, 'AGENTS.md', `# Rules\nAlways ${ZWSP}run ${RLO}tests\n`);
  const result = checkStyle(dir);
  assertEqual(result.status, 1, result.stdout + result.stderr);
  assertNotIncludes(result.stdout, 'OK: no violations');
  assertIncludes(result.stdout, 'AGENTS.md:2:8: U+200B ZERO WIDTH SPACE');
  assertIncludes(
    result.stdout,
    'AGENTS.md:2:13: U+202E RIGHT-TO-LEFT OVERRIDE',
  );
}

function testFileHeadBomPasses() {
  const dir = createRepo();
  write(dir, 'AGENTS.md', `${BOM}# Rules\nbody\n`);
  assertClean(checkStyle(dir));
}

function testInnerBomBlocks() {
  const dir = createRepo();
  write(dir, 'AGENTS.md', `# Rules\nab${BOM}cd\n`);
  const result = checkStyle(dir);
  assertEqual(result.status, 1, result.stdout + result.stderr);
  assertIncludes(
    result.stdout,
    'AGENTS.md:2:3: U+FEFF ZERO WIDTH NO-BREAK SPACE',
  );
}

function testRgiTagFlagsPass() {
  const dir = createRepo();
  const flags = ['gbeng', 'gbsct', 'gbwls'].map(tagFlag).join(' ');
  write(dir, 'AGENTS.md', `Flags: ${flags}\n`);
  write(dir, 'src/flags.js', `export const flags = '${flags}';\n`);
  assertClean(checkStyle(dir));
}

function testZeroWidthExceptionsPass() {
  const dir = createRepo();
  const family = [0x1f468, 0x1f469, 0x1f467].map(c).join(ZWJ);
  const rainbow = `${c(0x1f3f3)}${c(0xfe0f)}${ZWJ}${c(0x1f308)}`;
  const thai = `${c(0xe20)}${c(0xe32)}${c(0xe29)}${c(0xe32)}${ZWSP}${c(0xe44)}${c(0xe17)}${c(0xe22)}`;
  const persian = `${c(0x645)}${c(0x6cc)}${ZWNJ}${c(0x62e)}${c(0x648)}${c(0x627)}${c(0x647)}${c(0x645)}`;
  write(dir, 'AGENTS.md', `${family} ${rainbow}\n${thai}\n${persian}\n`);
  assertClean(checkStyle(dir));
}

function testInstructionNameVariantsBlock() {
  const dir = createRepo();
  const files = [
    'Claude.md',
    'CLAUDE.local.md',
    'sub/AGENTS.override.md',
    '.Claude/notes.md',
  ];
  for (const file of files) write(dir, file, `hello${ZWSP}world\n`);
  const result = checkStyle(dir);
  assertEqual(result.status, 1, result.stdout + result.stderr);
  for (const file of files)
    assertIncludes(result.stdout, `${file}:1:6: U+200B ZERO WIDTH SPACE`);
}

function testNonInstructionZwsp() {
  const dir = createRepo();
  write(dir, 'docs/notes.md', `hello${ZWSP}world\n`);
  assertClean(checkStyle(dir));
}

function testRtlTextPasses() {
  const dir = createRepo();
  const arabic = [0x645, 0x631, 0x62d, 0x628, 0x627].map(c).join('');
  const hebrew = [0x5e9, 0x5dc, 0x5d5, 0x5dd].map(c).join('');
  const marks = `a${c(0x200e)}b${c(0x200f)}c`;
  write(dir, 'AGENTS.md', `${arabic} ${hebrew} ${marks}\n`);
  write(dir, 'src/i18n.js', `export const s = '${arabic}${c(0x200f)}';\n`);
  assertClean(checkStyle(dir));
}

function testExistingCharactersPass() {
  const dir = createRepo();
  write(dir, 'AGENTS.md', `old${RLO}line\nhello${ZWSP}world\n`);
  commit(dir);
  write(dir, 'AGENTS.md', `old${RLO}line\nhello${ZWSP}world\nnew line\n`);
  assertClean(checkStyle(dir));

  write(dir, 'AGENTS.md', `old${RLO}line\nnew${RLO}\nhello${ZWSP}world\n`);
  const result = checkStyle(dir);
  assertEqual(result.status, 1, result.stdout + result.stderr);
  assertIncludes(result.stdout, 'AGENTS.md:2:4: U+202E');
  assertNotIncludes(result.stdout, 'AGENTS.md:1:');
  assertNotIncludes(result.stdout, 'AGENTS.md:3:');
}

function testBinarySkipped() {
  const dir = createRepo();
  const bytes = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x00, 0x0a]),
    Buffer.from(`${RLO}\n`, 'utf8'),
  ]);
  fs.writeFileSync(path.join(dir, 'image.bin'), bytes);
  git(dir, ['add', 'image.bin']);
  assertClean(checkStyle(dir));
}

function testDiffAttributeHiddenUnicode() {
  const dir = createRepo();
  write(dir, '.gitattributes', 'AGENTS.md -diff\n');
  commit(dir);
  write(dir, 'AGENTS.md', `# Rules\nrun ${RLO}tests\n`);
  const result = checkStyle(dir);
  assertEqual(result.status, 1, result.stdout + result.stderr);
  assertIncludes(result.stdout, 'AGENTS.md:2:5: U+202E RIGHT-TO-LEFT OVERRIDE');
}

function testDiffAttributeEscapeHatch() {
  const dir = createRepo();
  write(dir, '.gitattributes', '*.ts -diff\n');
  commit(dir);
  write(dir, 'src/a.ts', `// ${TS_IGNORE}\nexport const a = 1;\n`);
  const result = checkStyle(dir);
  assertEqual(result.status, 1, result.stdout + result.stderr);
  assertIncludes(result.stdout, '[escape-hatch] src/a.ts:1:');
}

function testDiffDrivers() {
  for (const configure of [externalDiffFails, textconvFails, textconvHides]) {
    const dir = createRepo();
    configure(dir);
    write(dir, 'AGENTS.md', `# Rules\nrun ${RLO}tests\n`);
    const result = checkStyle(dir);
    assertEqual(
      result.status,
      1,
      `${configure.name}\n${result.stdout}${result.stderr}`,
    );
    assertIncludes(
      result.stdout,
      'AGENTS.md:2:5: U+202E RIGHT-TO-LEFT OVERRIDE',
    );

    write(dir, 'AGENTS.md', '# Rules\nrun tests\n');
    assertClean(checkStyle(dir));
  }
}

function externalDiffFails(dir) {
  git(dir, ['config', 'diff.external', 'false']);
}

function textconvFails(dir) {
  write(dir, '.gitattributes', '*.md diff=broken\n');
  git(dir, ['config', 'diff.broken.textconv', 'false']);
  commit(dir);
}

// A textconv that prints nothing would hide every added line if honoured.
function textconvHides(dir) {
  write(dir, '.gitattributes', '*.md diff=blank\n');
  git(dir, ['config', 'diff.blank.textconv', 'true']);
  commit(dir);
}

function testPlusPrefixedLine() {
  const dir = createRepo();
  write(dir, 'notes.txt', `++ counter${RLO}\n`);
  const result = checkStyle(dir);
  assertEqual(result.status, 1, result.stdout + result.stderr);
  assertIncludes(result.stdout, 'notes.txt:1:11: U+202E');
}

function testNoNewlineMarker() {
  const dir = createRepo();
  write(dir, 'notes.txt', 'first');
  commit(dir);
  write(dir, 'notes.txt', `first\nsecond${RLO}\nthird${RLO}\n`);
  const result = checkStyle(dir);
  assertEqual(result.status, 1, result.stdout + result.stderr);
  assertIncludes(result.stdout, 'notes.txt:2:7: U+202E');
  assertIncludes(result.stdout, 'notes.txt:3:6: U+202E');
}

function testGitFailureChecker() {
  const dir = createRepo();
  write(dir, 'README.md', 'clean\n');
  const result = checkStyle(dir, { PATH: failingDiffPath(dir) });
  assertEqual(result.status, 2, result.stdout + result.stderr);
  assertIncludes(
    result.stderr,
    'check failed: cannot read staged added lines of README.md',
  );
}

function testGitFailurePreCommit() {
  const dir = createRepo();
  write(dir, 'README.md', 'clean\n');
  const env = { ...process.env, GOLDBAND_STYLE_GATE_SCRIPT: checker };
  delete env.GOLDBAND_PROJECT_HOOK_RUNNING;
  delete env.GOLDBAND_STYLE_GATE;
  env.PATH = failingDiffPath(dir);
  const result = run('bash', [preCommitHook], { cwd: dir, env });
  assertNotEqual(result.status, 0, result.stdout + result.stderr);
  assertIncludes(result.stderr, 'check failed: cannot read staged added lines');
  assertNotIncludes(result.stdout, 'OK: no violations');
}

function testStagedBlobReadOnce() {
  const dir = createRepo();
  write(dir, 'src/app.js', 'export const a = 1;\n');
  write(dir, 'vendor/lib.txt', `ab${RLO}cd\n`);
  fs.writeFileSync(path.join(dir, 'image.bin'), Buffer.from([0x89, 0x00]));
  git(dir, ['add', 'image.bin']);
  const trace = path.join(dir, '.git', 'trace.log');
  const result = checkStyle(dir, { GIT_TRACE: trace });
  assertEqual(result.status, 1, result.stdout + result.stderr);
  assertIncludes(result.stdout, '[hidden-unicode] vendor/lib.txt:1:3');
  const counts = new Map();
  const pattern = /trace: built-in: git (cat-file blob|ls-files --stage) (.*)/;
  for (const line of fs.readFileSync(trace, 'utf8').split('\n')) {
    const match = line.match(pattern);
    if (!match) continue;
    const key = `${match[1]} ${match[2]}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const blobs = [...counts.keys()].filter((key) => key.startsWith('cat-file'));
  assertEqual(blobs.length, 3, [...counts.keys()].join('\n'));
  for (const [key, count] of counts) assertEqual(count, 1, key);
}

// A file only the hidden Unicode check reads: style-excluded and above the
// secret scan's text limit.
function testBinaryReadFailure() {
  const dir = createRepo();
  write(dir, 'vendor/lib.txt', 'longer than the limit\n');
  const result = checkStyle(dir, {
    GOLDBAND_MAX_TEXT_FILE_BYTES: '8',
    PATH: failingGitPath(dir, 'blob'),
  });
  assertEqual(result.status, 2, result.stdout + result.stderr);
  assertIncludes(result.stderr, 'failed to read staged file: vendor/lib.txt');
  assertNotIncludes(result.stdout, 'OK: no violations');
}

// A `git` shim that fails only the added-line diff, so file listing and blob
// reads still succeed.
function failingDiffPath(dir) {
  return failingGitPath(dir, '--unified=0');
}

// A `git` shim that fails only the invocations given the argument `failArg`.
function failingGitPath(dir, failArg) {
  const realGit = run('/bin/sh', ['-c', 'command -v git']).stdout.trim();
  const binDir = path.join(dir, '.shim-bin');
  fs.mkdirSync(binDir);
  fs.writeFileSync(
    path.join(binDir, 'git'),
    [
      '#!/bin/sh',
      'for arg in "$@"; do',
      `  if [ "$arg" = "${failArg}" ]; then`,
      '    echo "fatal: simulated read failure" >&2',
      '    exit 128',
      '  fi',
      'done',
      `exec '${realGit}' "$@"`,
      '',
    ].join('\n'),
  );
  fs.chmodSync(path.join(binDir, 'git'), 0o755);
  return `${binDir}${path.delimiter}${process.env.PATH}`;
}

function checkStyle(cwd, env = {}) {
  return run(process.execPath, [checker, '--staged'], {
    cwd,
    env: { ...process.env, ...env },
  });
}

function assertClean(result) {
  assertEqual(result.status, 0, result.stdout + result.stderr);
  assertNotIncludes(result.stdout, 'Violations:');
  assertNotIncludes(result.stdout, '[hidden-unicode]');
}

function write(dir, file, content) {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  fs.writeFileSync(path.join(dir, file), content);
  git(dir, ['add', file]);
}

function commit(dir) {
  git(dir, ['commit', '--quiet', '--no-verify', '-m', 'base']);
}

function createRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'goldband-unicode-test-'));
  git(dir, ['init', '--quiet']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'Test User']);
  git(dir, ['config', 'core.hooksPath', '/dev/null']);
  return dir;
}

function git(cwd, args) {
  const result = run('git', args, { cwd });
  assertEqual(result.status, 0, result.stderr);
}

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    encoding: 'utf8',
    env: options.env ?? process.env,
  });
}

function assertEqual(actual, expected, message = '') {
  if (actual === expected) return;
  throw new Error(`expected ${expected}, got ${actual}\n${message}`);
}

function assertNotEqual(actual, unexpected, message = '') {
  if (actual !== unexpected) return;
  throw new Error(`expected a value other than ${unexpected}\n${message}`);
}

function assertIncludes(value, expected) {
  if (value.includes(expected)) return;
  throw new Error(`expected output to include ${expected}\n${value}`);
}

function assertNotIncludes(value, unexpected) {
  if (!value.includes(unexpected)) return;
  throw new Error(`expected output not to include ${unexpected}\n${value}`);
}
