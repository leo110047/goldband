#!/usr/bin/env node

// Live secret advice: shell writes are scanned without path exemptions,
// high-confidence secrets in shell text are denied on both hosts, and file-tool
// writes report only secrets new to the indexed file.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  contextOf,
  createRepo,
  FAKE_TOKEN,
  git,
  routers,
  runRouter,
  runShellTool,
  tmpDir,
} from './lib/live-advisory-harness.mjs';

const tests = [
  ['shell secrets are reported without fixture exemptions', testShellSecret],
  [
    'shell secrets are reported in style-excluded paths',
    testExcludedPathSecret,
  ],
  ['high-confidence secrets in shell commands are denied', testShellDeny],
  ['NotebookEdit content is scanned and advised', testNotebookEdit],
  [
    'file-tool writes get the secret scan without path exemptions',
    testFileToolSecretPaths,
  ],
  [
    'live advice reports only secrets new to the indexed file',
    testKnownSecretNotRepeated,
  ],
];

for (const [name, test] of tests) {
  test();
  console.log(`ok - ${name}`);
}

function testShellSecret() {
  for (const host of Object.keys(routers)) {
    const dir = createRepo();
    fs.mkdirSync(path.join(dir, 'fixtures'));
    const script = path.join(tmpDir, `write-token-${host}.sh`);
    fs.writeFileSync(
      script,
      `printf 'token=%s\\n' "$(printf 'gh%s' 'p_${'A'.repeat(36)}')" > fixtures/env.txt\n`,
    );
    const context = runShellTool(host, dir, `bash ${script}`, `${host}-secret`);
    assert.match(context, /\[secret-scan\] fixtures\/env\.txt/);
    assert.match(context, /potential secret is already on disk/);
  }
}

function testExcludedPathSecret() {
  for (const host of Object.keys(routers)) {
    for (const dir of ['vendor', 'build', 'goldband-loop']) {
      const repo = createRepo();
      fs.mkdirSync(path.join(repo, dir));
      const script = path.join(tmpDir, `write-${host}-${dir}.sh`);
      fs.writeFileSync(
        script,
        `printf 'token=%s\\n' "$(printf 'gh%s' 'p_${'A'.repeat(36)}')" > ${dir}/env.txt\n`,
      );
      const context = runShellTool(
        host,
        repo,
        `bash ${script}`,
        `${host}-${dir}`,
      );
      assert.match(context, new RegExp(`\\[secret-scan\\] ${dir}/env\\.txt`));
      assert.doesNotMatch(context, new RegExp(FAKE_TOKEN));
    }
  }
}

function testShellDeny() {
  const dir = createRepo();
  const command = `echo ${FAKE_TOKEN} > token.txt`;
  const claude = runRouter(routers.claude, dir, {
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command },
  });
  assert.equal(claude.status, 2, claude.stderr);
  assert.match(claude.stderr, /Potential secrets detected/);

  const codex = runRouter(routers.codex, dir, {
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command },
  });
  const output = JSON.parse(codex.stdout).hookSpecificOutput;
  assert.equal(output.permissionDecision, 'deny');
  assert.match(output.permissionDecisionReason, /Potential secrets detected/);
}

function testNotebookEdit() {
  const dir = createRepo();
  const blocked = runRouter(routers.claude, dir, {
    hook_event_name: 'PreToolUse',
    tool_name: 'NotebookEdit',
    tool_input: { notebook_path: 'a.ipynb', new_source: `t = "${FAKE_TOKEN}"` },
  });
  assert.equal(blocked.status, 2, blocked.stderr);

  const assignment = ['pass', 'word = "hunter2hunter2"\n'].join('');
  fs.writeFileSync(path.join(dir, 'a.ipynb'), assignment);
  const advised = contextOf(
    runRouter(routers.claude, dir, {
      hook_event_name: 'PostToolUse',
      tool_name: 'NotebookEdit',
      tool_input: { notebook_path: 'a.ipynb', new_source: 'x' },
    }),
  );
  assert.match(advised, /\[secret-scan\] a\.ipynb/);
}

function testFileToolSecretPaths() {
  const assignment = ['pass', 'word = "hunter2hunter2"\n'].join('');
  for (const file of ['tests/fixtures/env.ts', 'build/env.js']) {
    const dir = createRepo();
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), assignment);
    const context = contextOf(
      runRouter(routers.claude, dir, {
        hook_event_name: 'PostToolUse',
        tool_name: 'Write',
        tool_input: { file_path: path.join(dir, file) },
      }),
    );
    assert.match(context, new RegExp(`\\[secret-scan\\] ${file}`), file);
  }
}

function testKnownSecretNotRepeated() {
  const dir = createRepo();
  const file = path.join(dir, 'auth.test.ts');
  fs.writeFileSync(file, `const sample = "${FAKE_TOKEN}";\n`);
  git(dir, ['add', 'auth.test.ts']);
  const edit = (content) => {
    fs.writeFileSync(file, content);
    return contextOf(
      runRouter(routers.claude, dir, {
        hook_event_name: 'PostToolUse',
        tool_name: 'Edit',
        tool_input: { file_path: file },
      }),
    );
  };
  const unchanged = edit(`const sample = "${FAKE_TOKEN}";\nconst x = 1;\n`);
  assert.doesNotMatch(unchanged, /secret-scan/);
  const jwt = [
    'eyJ',
    'hbGciOiJIUzI1NiJ9.eyJ',
    'zdWIiOiIxIn0.c2lnbmF0dXJl',
  ].join('');
  const added = edit(`const sample = "${FAKE_TOKEN}";\nconst t = "${jwt}";\n`);
  assert.match(
    added,
    /\[secret-scan\] auth\.test\.ts: potential secret detected: JWT Token/,
  );
  // A different value of a signature the file already held is still new.
  const second = ['gh', 'p_', 'B'.repeat(36)].join('');
  const another = edit(
    `const sample = "${FAKE_TOKEN}";\nconst real = "${second}";\n`,
  );
  assert.match(
    another,
    /\[secret-scan\] auth\.test\.ts: potential secret detected: GitHub Token \(classic\)/,
  );

  // Every PKCS#8 header is identical; a different key body is a new secret.
  const header = ['-----BEGIN PRIVATE', 'KEY-----'].join(' ');
  const footer = ['-----END PRIVATE', 'KEY-----'].join(' ');
  const keyFile = path.join(dir, 'server.key');
  fs.writeFileSync(keyFile, `${header}\n${'A'.repeat(32)}\n${footer}\n`);
  git(dir, ['add', 'server.key']);
  fs.writeFileSync(keyFile, `${header}\n${'B'.repeat(32)}\n${footer}\n`);
  const replaced = contextOf(
    runRouter(routers.claude, dir, {
      hook_event_name: 'PostToolUse',
      tool_name: 'Write',
      tool_input: { file_path: keyFile },
    }),
  );
  assert.match(
    replaced,
    /\[secret-scan\] server\.key: potential secret detected: Private Key/,
  );
}
