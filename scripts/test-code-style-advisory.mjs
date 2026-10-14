import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

const checker = path.join(process.cwd(), 'scripts', 'check-code-style.mjs');
// Assembled at runtime so the style gate's keyword scan ignores this source.
const DEBUGGER = ['debug', 'ger'].join('');
// Assembled at runtime so this source never contains a token-shaped literal.
const FAKE_TOKEN = ['gh', 'p_', 'D'.repeat(36)].join('');
// Terminal detail stands in for a person's TTY; piped runs omit it.
const TERMINAL = { GOLDBAND_STYLE_GATE_DETAIL: '1' };
const CONFLICT_TEXT = '<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> branch\n';

const tests = [
  ['advisory format is silent when clean', testSilentWhenClean],
  ['advisory format summarizes violations', testSummarizesViolations],
  ['advisory format caps issues and counts the rest', testTruncates],
  ['advisory format reports tool errors on stderr', testToolError],
  ['text and json formats are unchanged by advisory', testExistingFormats],
  ['model-facing Biome output omits source', testBiomeModelOutput],
  [
    'terminal Biome output keeps source with redaction',
    testBiomeTerminalOutput,
  ],
  ['checker output redacts secret signatures', testRedactSecrets],
  ['Biome 1.x diagnostics stay readable', testBiomeV1Shape],
  ['unknown Biome diagnostics are withheld', testBiomeUnknownShape],
  [
    'a Biome without the JSON reporter passes on its exit code',
    testBiomeReporterUnsupported,
  ],
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
      'These warnings are advisory; only an installed goldband style gate blocks commits.',
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

function checkFiles(cwd, files, format, env = {}) {
  return spawnSync(
    process.execPath,
    [checker, '--files', ...files, '--format', format],
    { cwd, encoding: 'utf8', env: { ...process.env, ...env } },
  );
}

function biomeRepo() {
  const biome = path.join(process.cwd(), 'node_modules', '.bin', 'biome');
  if (!fs.existsSync(biome)) throw new Error(`Biome is required: ${biome}`);
  const dir = createRepo();
  fs.writeFileSync(path.join(dir, 'biome.json'), '{}\n');
  fs.mkdirSync(path.join(dir, 'node_modules', '.bin'), { recursive: true });
  fs.symlinkSync(biome, path.join(dir, 'node_modules', '.bin', 'biome'));
  fs.writeFileSync(
    path.join(dir, 'app.js'),
    `const   unused = "${FAKE_TOKEN}"\nconst   other = "source-marker-${'q'.repeat(8)}"\n`,
  );
  return dir;
}

// Model-facing formats carry only rule, location, and message; a credential
// matching no signature is protected only by omitting source.
function testBiomeModelOutput() {
  const dir = biomeRepo();
  for (const format of ['advisory', 'json']) {
    const result = checkFiles(dir, ['app.js'], format);
    assertEqual(result.status, 1, result.stderr);
    assertIncludes(result.stdout, 'lint/correctness/noUnusedVariables');
    assertIncludes(result.stdout, 'biome format --write app.js');
    for (const leaked of [FAKE_TOKEN, 'source-marker-']) {
      if (result.stdout.includes(leaked)) {
        throw new Error(`${format} output quoted source: ${leaked}`);
      }
    }
  }
}

// The terminal format keeps Biome's source frames for the person fixing the
// commit, with signature-matching credentials redacted.
function testBiomeTerminalOutput() {
  const dir = biomeRepo();
  const result = checkFiles(dir, ['app.js'], 'text', TERMINAL);
  assertEqual(result.status, 1, result.stderr);
  assertIncludes(result.stdout, 'source-marker-');
  assertIncludes(result.stdout, '[REDACTED GitHub Token (classic)]');
  assertIncludes(result.stdout, 'biome format --write app.js');
  if (result.stdout.includes(FAKE_TOKEN)) {
    throw new Error('text output leaked the credential');
  }
  // An agent's shell tool receives the hook output through a pipe.
  const piped = checkFiles(dir, ['app.js'], 'text', {
    GOLDBAND_STYLE_GATE_DETAIL: '',
  });
  assertEqual(piped.status, 1, piped.stderr);
  if (piped.stdout.includes('source-marker-')) {
    throw new Error('piped text output quoted source');
  }
}

// A stand-in Biome emits a fixed JSON report and records its arguments, so
// reporter-schema handling is tested without a second Biome version.
function fakeBiomeRepo(report, plainExit = 1) {
  const dir = createRepo();
  fs.writeFileSync(path.join(dir, 'biome.json'), '{}\n');
  fs.writeFileSync(path.join(dir, 'app.js'), 'const value = 1;\n');
  const bin = path.join(dir, 'node_modules', '.bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify(report));
  fs.writeFileSync(
    path.join(bin, 'biome'),
    [
      '#!/bin/sh',
      'echo "$*" >> "$(dirname "$0")/../../biome-args.log"',
      'case "$*" in *--reporter=json*) cat "$(dirname "$0")/../../report.json"; exit 1;; esac',
      'echo "human output"',
      `exit ${plainExit}`,
      '',
    ].join('\n'),
    { mode: 0o755 },
  );
  return dir;
}

function testBiomeV1Shape() {
  const dir = fakeBiomeRepo({
    diagnostics: [
      {
        category: 'lint/suspicious/noDebugger',
        description: `This is an unexpected use of the ${DEBUGGER} statement.`,
        message: [{ elements: [], content: 'markup' }],
        location: { path: { file: 'app.js' }, span: [0, 1] },
      },
    ],
  });
  const advisory = checkFiles(dir, ['app.js'], 'advisory');
  assertIncludes(
    advisory.stdout,
    `app.js lint/suspicious/noDebugger: This is an unexpected use of the ${DEBUGGER} statement.`,
  );
  if (advisory.stdout.includes('[object Object]')) {
    throw new Error('Biome 1.x diagnostic rendered as an object');
  }
  fs.rmSync(path.join(dir, 'biome-args.log'));
  const text = checkFiles(dir, ['app.js'], 'text', TERMINAL);
  assertIncludes(text.stdout, 'human output');
  const args = fs.readFileSync(path.join(dir, 'biome-args.log'), 'utf8');
  const humanRun = args.trim().split('\n').at(-1);
  if (humanRun.includes('--reporter')) {
    throw new Error(`terminal Biome run passed a reporter: ${humanRun}`);
  }
}

function testBiomeUnknownShape() {
  const dir = fakeBiomeRepo({ diagnostics: [{ unexpected: true }] });
  const result = checkFiles(dir, ['app.js'], 'advisory');
  assertIncludes(result.stdout, 'its output is withheld');
  // The terminal shows Biome's own output, so it claims nothing is withheld,
  // and the plain run happens once.
  fs.rmSync(path.join(dir, 'biome-args.log'));
  const text = checkFiles(dir, ['app.js'], 'text', TERMINAL);
  assertIncludes(text.stdout, 'human output');
  if (text.stdout.includes('withheld')) {
    throw new Error('text output claims withheld output it prints');
  }
  const plainRuns = fs
    .readFileSync(path.join(dir, 'biome-args.log'), 'utf8')
    .trim()
    .split('\n')
    .filter((line) => !line.includes('--reporter'));
  assertEqual(plainRuns.length, 1, plainRuns.join('\n'));
}

function testBiomeReporterUnsupported() {
  const dir = fakeBiomeRepo('not json', 0);
  const advisory = checkFiles(dir, ['app.js'], 'advisory');
  assertEqual(advisory.status, 0, advisory.stdout);
  assertEqual(advisory.stdout, '');
  const text = checkFiles(dir, ['app.js'], 'text');
  assertEqual(text.status, 0, text.stdout);
  assertIncludes(text.stdout, 'biome-reporter-unsupported');
}

function testRedactSecrets() {
  const require = createRequire(import.meta.url);
  const {
    redactSecrets,
  } = require('../hooks/scripts/lib/hook-router/secret-patterns.js');
  const header = ['-----BEGIN RSA PRIVATE', 'KEY-----'].join(' ');
  const footer = ['-----END RSA PRIVATE', 'KEY-----'].join(' ');
  const body = 'MIIEvQIBADANBgkqhkiG9w0BAQEFAASC';
  const block = redactSecrets(`x\n${header}\n${body}\n${body}\n${footer}\ny`);
  assertEqual(block, 'x\n[REDACTED Private Key]\ny');
  // A source frame quotes part of the block: the quoted body goes, later
  // diagnostics stay.
  const framed = redactSecrets(
    `  > 3 | ${header}\n    4 | ${body}\n\nnext issue`,
  );
  assertEqual(framed, '  > 3 | [REDACTED Private Key]\n\nnext issue');
  const inline = redactSecrets(
    `k = "${header}\\n${body}\\n${footer}\\n"; next`,
  );
  assertEqual(inline, 'k = "[REDACTED Private Key]\\n"; next');
  const redacted = redactSecrets(`a ${FAKE_TOKEN} b ${FAKE_TOKEN}`);
  assertEqual(
    redacted,
    'a [REDACTED GitHub Token (classic)] b [REDACTED GitHub Token (classic)]',
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
