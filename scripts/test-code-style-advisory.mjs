import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const checker = path.join(process.cwd(), 'scripts', 'check-code-style.mjs');
const CONFLICT_TEXT = '<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> branch\n';

const tests = [
  ['advisory format is silent when clean', testSilentWhenClean],
  ['advisory format summarizes violations', testSummarizesViolations],
  ['advisory format caps issues and counts the rest', testTruncates],
  ['advisory format reports tool errors on stderr', testToolError],
  ['text and json formats are unchanged by advisory', testExistingFormats],
];

for (const [name, test] of tests) {
  test();
  console.log(`ok - ${name}`);
}

function testSilentWhenClean() {
  const dir = createRepo();
  fs.writeFileSync(path.join(dir, 'README.md'), 'clean\n');
  const result = checkFiles(dir, ['README.md'], 'advisory');
  assertEqual(result.status, 0, result.stderr);
  assertEqual(result.stdout, '');
}

function testSummarizesViolations() {
  const dir = createRepo();
  fs.writeFileSync(path.join(dir, 'README.md'), CONFLICT_TEXT);
  const result = checkFiles(dir, ['README.md'], 'advisory');
  assertEqual(result.status, 1, result.stderr);
  assertEqual(
    result.stdout,
    [
      'goldband style gate advisory:',
      '[merge-conflict] README.md:1: merge conflict marker block found',
      'These warnings are advisory here; pre-commit enforces blocking rules.',
      '',
    ].join('\n'),
  );
}

function testTruncates() {
  const dir = createRepo();
  const files = Array.from(
    { length: 10 },
    (_, index) => `conflict-${index}.md`,
  );
  for (const file of files) {
    fs.writeFileSync(path.join(dir, file), CONFLICT_TEXT);
  }
  const result = checkFiles(dir, files, 'advisory');
  assertEqual(result.status, 1, result.stderr);
  const issueLines = result.stdout
    .trimEnd()
    .split('\n')
    .filter((line) => line.startsWith('[merge-conflict]'));
  assertEqual(issueLines.length, 8);
  assertIncludes(result.stdout, '2 more issue(s) not shown.');
}

function testToolError() {
  const dir = createRepo();
  fs.writeFileSync(path.join(dir, 'README.md'), 'clean\n');
  fs.writeFileSync(path.join(dir, '.goldband-style.json'), '{bad\n');
  const result = checkFiles(dir, ['README.md'], 'advisory');
  assertEqual(result.status, 2, result.stdout);
  assertEqual(result.stdout, '');
  assertIncludes(result.stderr, 'goldband style gate error:');
}

function testExistingFormats() {
  const dir = createRepo();
  fs.writeFileSync(path.join(dir, 'README.md'), CONFLICT_TEXT);
  const text = checkFiles(dir, ['README.md'], 'text');
  assertEqual(text.status, 1, text.stderr);
  assertIncludes(text.stdout, 'Violations:');
  assertIncludes(text.stdout, '  - [merge-conflict] README.md:1:');
  const json = checkFiles(dir, ['README.md'], 'json');
  assertEqual(json.status, 1, json.stderr);
  assertEqual(JSON.parse(json.stdout).violations[0].rule, 'merge-conflict');
}

function checkFiles(cwd, files, format) {
  return spawnSync(
    process.execPath,
    [checker, '--files', ...files, '--format', format],
    { cwd, encoding: 'utf8' },
  );
}

function createRepo() {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'goldband-style-advisory-'),
  );
  spawnSync('git', ['init', '--quiet'], { cwd: dir });
  return dir;
}

function assertEqual(actual, expected, message = '') {
  if (actual === expected) return;
  throw new Error(`expected ${expected}, got ${actual}\n${message}`);
}

function assertIncludes(value, expected) {
  if (value.includes(expected)) return;
  throw new Error(`expected output to include ${expected}\n${value}`);
}
