#!/usr/bin/env node

// Skipped-test rules across languages: unconditional Python skip decorators
// block, skips that may be legitimate conditions are advisory and keep exit 0,
// and the JavaScript and TypeScript rules are unchanged.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const repoRoot = process.cwd();
const checker = path.join(repoRoot, 'scripts', 'check-code-style.mjs');
const preCommitHook = path.join(repoRoot, 'git-hooks', 'pre-commit');
const BLOCKED = '[skipped-test]';
const PY_HEADER = 'import pytest\nimport unittest\n\n';

const tests = [
  ['pytest skip marker blocks under tests/', testPytestSkipBlocks],
  ['unittest skip and skipif(True) block', testUnittestAndSkipifTrueBlock],
  [
    'bare skip and skipUnless(False) block; conditions pass',
    testBareSkipAndSkipUnlessFalseBlock,
  ],
  ['JavaScript and TypeScript rules are unchanged', testJsRulesUnchanged],
  ['*.py -diff still blocks a skip marker', testDiffAttributePython],
  ['runtime pytest.skip is advisory', testPytestSkipAdvisory],
  ['Go t.Skip is advisory', testGoSkipAdvisory],
  ['Rust #[ignore] is advisory', testRustIgnoreAdvisory],
  ['pre-commit prints advisories and allows the commit', testPreCommitAdvisory],
  ['conditional skipif is silent', testConditionalSkipifSilent],
  ['non-test Python files are silent', testNonTestFileSilent],
  ['skips already committed are silent', testExistingSkipSilent],
  ['skips named in comments and strings are silent', testMentionsSilent],
  ['an indented skip decorator blocks', testIndentedDecoratorBlocks],
];

for (const [name, test] of tests) {
  test();
  console.log(`ok - ${name}`);
}

function testPytestSkipBlocks() {
  const dir = createRepo();
  write(
    dir,
    'tests/test_api.py',
    `${PY_HEADER}@pytest.mark.skip(reason="flaky")\ndef test_a():\n    pass\n`,
  );
  const result = checkJson(dir);
  assertEqual(result.status, 1, result.stdout + result.stderr);
  assertIssue(result, 'violations', 'tests/test_api.py', 4);
}

function testUnittestAndSkipifTrueBlock() {
  const dir = createRepo();
  write(
    dir,
    'test_api.py',
    [
      PY_HEADER,
      '@unittest.skip("later")\ndef test_a():\n    pass\n\n',
      '@pytest.mark.skipif(True, reason="x")\ndef test_b():\n    pass\n',
    ].join(''),
  );
  const result = checkJson(dir);
  assertEqual(result.status, 1, result.stdout + result.stderr);
  assertIssue(result, 'violations', 'test_api.py', 4);
  assertIssue(result, 'violations', 'test_api.py', 8);
}

function testBareSkipAndSkipUnlessFalseBlock() {
  const dir = createRepo();
  write(
    dir,
    'test_api.py',
    [
      PY_HEADER,
      '@skip("later")\ndef test_a():\n    pass\n\n',
      '@unittest.skipUnless(False, "x")\ndef test_b():\n    pass\n\n',
      '@skipUnless(sys.platform == "linux", "x")\ndef test_c():\n    pass\n\n',
      '@skipper\ndef test_d():\n    pass\n',
    ].join(''),
  );
  const result = checkJson(dir);
  assertEqual(result.status, 1, result.stdout + result.stderr);
  assertEqual(
    issues(result, 'violations')
      .map((item) => item.line)
      .join(','),
    '4,8',
  );
}

function testJsRulesUnchanged() {
  const dir = createRepo();
  write(dir, 'src/a.test.js', "it.only('a', () => {});\nxit('b', () => {});\n");
  write(dir, 'src/b.spec.ts', "describe.skip('c', () => {});\n");
  write(dir, 'src/helper.js', "export const s = 'it.only( xit(';\n");
  const result = checkJson(dir);
  assertEqual(result.status, 1, result.stdout + result.stderr);
  const rules = issues(result, 'violations').map(
    (item) => `${item.rule} ${item.file}:${item.line}`,
  );
  assertEqual(
    rules.sort().join('\n'),
    [
      'focused-test src/a.test.js:1',
      'skipped-test src/a.test.js:2',
      'skipped-test src/b.spec.ts:1',
    ].join('\n'),
  );
  assertEqual(issues(result, 'advisories', 'skipped-test').length, 0);
}

function testDiffAttributePython() {
  const dir = createRepo();
  write(dir, '.gitattributes', '*.py -diff\n');
  commit(dir);
  write(
    dir,
    'tests/test_api.py',
    '@pytest.mark.skip\ndef test_a():\n    pass\n',
  );
  const result = checkJson(dir);
  assertEqual(result.status, 1, result.stdout + result.stderr);
  assertIssue(result, 'violations', 'tests/test_api.py', 1);
}

function testPytestSkipAdvisory() {
  const dir = createRepo();
  write(
    dir,
    'tests/test_docker.py',
    `${PY_HEADER}def test_a():\n    pytest.skip("needs docker")\n`,
  );
  const result = checkJson(dir);
  assertEqual(result.status, 0, result.stdout + result.stderr);
  assertIssue(result, 'advisories', 'tests/test_docker.py', 5);
  assertEqual(issues(result, 'violations').length, 0);
}

function testGoSkipAdvisory() {
  const dir = createRepo();
  write(
    dir,
    'api_test.go',
    [
      'package api\n\nimport "testing"\n\n',
      'func TestA(t *testing.T) {\n\tt.Skip("todo")\n}\n\n',
      'func FuzzB(f *testing.F) {\n\tf.Fuzz(func(t *testing.T, s string) {\n',
      '\t\tt.Skip()\n\t})\n}\n',
    ].join(''),
  );
  const result = checkJson(dir);
  assertEqual(result.status, 0, result.stdout + result.stderr);
  assertIssue(result, 'advisories', 'api_test.go', 6);
  assertIssue(result, 'advisories', 'api_test.go', 11);
}

function testRustIgnoreAdvisory() {
  const dir = createRepo();
  write(dir, 'src/lib.rs', '#[test]\n#[ignore]\nfn slow() {}\n');
  const result = checkJson(dir);
  assertEqual(result.status, 0, result.stdout + result.stderr);
  assertIssue(result, 'advisories', 'src/lib.rs', 2);
}

function testPreCommitAdvisory() {
  const dir = createRepo();
  write(
    dir,
    'api_test.go',
    'package api\n\nfunc TestA(t *T) {\n\tt.Skip("todo")\n}\n',
  );
  const env = { ...process.env, GOLDBAND_STYLE_GATE_SCRIPT: checker };
  delete env.GOLDBAND_PROJECT_HOOK_RUNNING;
  delete env.GOLDBAND_STYLE_GATE;
  const result = run('bash', [preCommitHook], { cwd: dir, env });
  assertEqual(result.status, 0, result.stdout + result.stderr);
  assertIncludes(result.stdout, 'Advisory:');
  assertIncludes(result.stdout, `${BLOCKED} api_test.go:4: test skip found`);
}

function testConditionalSkipifSilent() {
  const dir = createRepo();
  write(
    dir,
    'tests/test_posix.py',
    `import sys\n${PY_HEADER}@pytest.mark.skipif(sys.platform == "win32", reason="posix only")\ndef test_a():\n    pass\n`,
  );
  assertSilent(checkJson(dir));
}

function testNonTestFileSilent() {
  const dir = createRepo();
  write(dir, 'app.py', 'NAME = "pytest.skip"\nOTHER = "@pytest.mark.skip"\n');
  assertSilent(checkJson(dir));
}

function testExistingSkipSilent() {
  const dir = createRepo();
  const base = `${PY_HEADER}@pytest.mark.skip\ndef test_a():\n    pytest.skip("x")\n`;
  write(dir, 'tests/test_old.py', base);
  write(dir, 'old_test.go', 'package a\n\nfunc TestA(t *T) {\n\tt.Skip()\n}\n');
  commit(dir);
  write(dir, 'tests/test_old.py', `${base}\n\ndef test_b():\n    pass\n`);
  write(
    dir,
    'old_test.go',
    'package a\n\nfunc TestA(t *T) {\n\tt.Skip()\n}\n\nfunc TestB(t *T) {}\n',
  );
  assertSilent(checkJson(dir));
}

function testMentionsSilent() {
  const dir = createRepo();
  write(
    dir,
    'tests/test_x.py',
    [
      PY_HEADER,
      '# Do not use @pytest.mark.skip here\n',
      '    # @unittest.skip("later") and @pytest.mark.skipif(True)\n',
      'def test_a():\n',
      '    """Never call pytest.skip( in this suite."""\n',
      "    '@pytest.mark.skip'\n",
      '    message = "pytest.skip( is banned"  # no pytest.skip( either\n',
      '    assert message\n',
    ].join(''),
  );
  write(
    dir,
    'api_test.go',
    'package api\n\n// t.Skip("todo") is not used\nvar s = "t.Skip("\nvar r = `t.SkipNow()`\n',
  );
  write(
    dir,
    'src/lib.rs',
    '/// Avoid #[ignore] on tests.\nfn f() {} // #[ignore]\nconst S: &str = "#[ignore]";\n',
  );
  assertSilent(checkJson(dir));
}

function testIndentedDecoratorBlocks() {
  const dir = createRepo();
  write(
    dir,
    'tests/test_cls.py',
    [
      PY_HEADER,
      'class TestA(unittest.TestCase):\n',
      '    @pytest.mark.skip(reason="flaky")  # see #12\n',
      '    def test_a(self):\n        pass\n\n',
      '\t@unittest.skip("later")\n',
      '    def test_b(self):\n        pass\n\n',
      '    @skipIf( True, "x")\n',
      '    def test_c(self):\n        pass\n',
    ].join(''),
  );
  const result = checkJson(dir);
  assertEqual(result.status, 1, result.stdout + result.stderr);
  assertIssue(result, 'violations', 'tests/test_cls.py', 5);
  assertIssue(result, 'violations', 'tests/test_cls.py', 9);
  assertIssue(result, 'violations', 'tests/test_cls.py', 13);
}

function assertSilent(result) {
  assertEqual(result.status, 0, result.stdout + result.stderr);
  assertEqual(issues(result, 'violations').length, 0, result.stdout);
  assertEqual(
    issues(result, 'advisories', 'skipped-test').length,
    0,
    result.stdout,
  );
}

function assertIssue(result, kind, file, line) {
  const found = issues(result, kind, 'skipped-test').some(
    (item) => item.file === file && item.line === line,
  );
  if (!found) {
    throw new Error(
      `expected ${kind} skipped-test at ${file}:${line}\n${result.stdout}`,
    );
  }
}

function issues(result, kind, rule = null) {
  return JSON.parse(result.stdout)[kind].filter(
    (item) => rule === null || item.rule === rule,
  );
}

function checkJson(cwd) {
  return run(process.execPath, [checker, '--staged', '--format', 'json'], {
    cwd,
  });
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'goldband-skip-test-'));
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

function assertIncludes(value, expected) {
  if (value.includes(expected)) return;
  throw new Error(`expected output to include ${expected}\n${value}`);
}
