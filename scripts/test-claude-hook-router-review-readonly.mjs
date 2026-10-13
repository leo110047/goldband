#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const routerPath = path.join(
  repoDir,
  'hooks',
  'scripts',
  'hooks',
  'hook-router.js',
);
const require = createRequire(import.meta.url);
const { writeOutput } = require(routerPath);
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'goldband-review-hook-'));

process.on('exit', () => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function runHook(sessionId, input) {
  return spawnSync(process.execPath, [routerPath], {
    cwd: repoDir,
    input: JSON.stringify({ session_id: sessionId, ...input }),
    encoding: 'utf8',
    env: {
      ...process.env,
      GOLDBAND_DATA_DIR: tmpDir,
      GOLDBAND_USAGE_FILE: path.join(tmpDir, 'usage-events.jsonl'),
      // Live style advice is out of scope; a missing checker writes no snapshots.
      GOLDBAND_STYLE_GATE_SCRIPT: path.join(tmpDir, 'no-style-checker'),
    },
  });
}

function assertReviewReadOnlyActivation(label, toolInput) {
  const sessionId = `review-readonly-regression-${label}`;
  const invokeReview = runHook(sessionId, {
    hook_event_name: 'PreToolUse',
    tool_name: 'Skill',
    tool_input: toolInput,
  });
  assert.equal(invokeReview.status, 0, invokeReview.stderr);

  assertReviewMutationsBlocked(sessionId);
  assertReviewInspectionAllowed(sessionId);
  assertStopClearsReviewReadOnly(sessionId);
}

// -i as the first option was missed before; cover GNU, BSD, and clusters.
const IN_PLACE_EDITS = [
  "sed -i 's/a/b/' package.json",
  "sed -i '' 's/a/b/' package.json",
  "sed -i.bak 's/a/b/' package.json",
  "sed --in-place 's/a/b/' package.json",
  "sed -Ei 's/a/b/' package.json",
  "sed -I '' 's/a/b/' package.json",
  "perl -pi -e 's/a/b/' package.json",
  "perl -i.bak -pe 's/a/b/' package.json",
  'ruby -pi -e \'sub(/a/, "b")\' package.json',
  "gawk -i inplace '{print}' package.json",
  "sed \\\n  -i 's/a/b/' package.json",
  "perl -0777 \\\n  -pi -e 's/a/b/' package.json",
];

const FILE_WRITERS = [
  'printf x | tee package.json',
  'patch -p1 < /tmp/fix.diff',
  'truncate -s 0 package.json',
  'dd if=/dev/zero of=package.json bs=1 count=1',
  'ln -sf other package.json',
  'install -m 644 /tmp/a package.json',
  'rsync -a /tmp/x ./',
  'find . -name x | xargs rm',
  'FOO=1 rm package.json',
  'env NODE_ENV=test rm package.json',
  'timeout 30 cp /tmp/x package.json',
  'find . -name x | xargs -n 1 rm',
  'if true; then rm package.json; fi',
  'for f in *.json; do rm "$f"; done',
  "bash -c 'rm -rf src'",
  'eval "rm package.json"',
  'echo `rm package.json`',
  'git rm package.json',
  'git mv package.json other.json',
  'printf ok\npatch -p1 < /tmp/fix.diff',
];

function assertBashBlocked(sessionId, commands, reason) {
  for (const command of commands) {
    const result = runHook(sessionId, {
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command },
    });
    assert.equal(result.status, 2, `${command}\n${result.stdout}`);
    assert.match(result.stderr, reason);
  }
}

function assertReviewMutationsBlocked(sessionId) {
  const mutatingBash = runHook(sessionId, {
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'touch review-mutates.txt' },
  });
  assert.equal(mutatingBash.status, 2, mutatingBash.stdout);
  assert.match(mutatingBash.stderr, /review-read-only is active/);
  assert.match(mutatingBash.stderr, /no-source-mutation|blocks touch/);

  const mutatingEdit = runHook(sessionId, {
    hook_event_name: 'PreToolUse',
    tool_name: 'Edit',
    tool_input: {
      file_path: 'review-mutates.txt',
      old_string: 'before',
      new_string: 'after',
    },
  });
  assert.equal(mutatingEdit.status, 2, mutatingEdit.stdout);
  assert.match(
    mutatingEdit.stderr,
    /review-read-only allows source inspection only/,
  );

  const copyFromRuntimeToSource = runHook(sessionId, {
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'cp /tmp/review-output package.json' },
  });
  assert.equal(
    copyFromRuntimeToSource.status,
    2,
    copyFromRuntimeToSource.stdout,
  );
  assert.match(copyFromRuntimeToSource.stderr, /blocks cp outside runtime/);

  assertBashBlocked(sessionId, IN_PLACE_EDITS, /blocks in-place file edits/);
  assertBashBlocked(sessionId, FILE_WRITERS, /review-read-only blocks/);
}

function assertReviewInspectionAllowed(sessionId) {
  const diffCommand = runHook(sessionId, {
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: {
      command:
        'DIFF_BASE=$(git merge-base origin/main HEAD) && git diff "$DIFF_BASE" --stat | tail -1 | grep -oE "[0-9]+ insertion" || true',
    },
  });
  assert.equal(diffCommand.status, 0, diffCommand.stderr);

  const runtimeArtifactCommand = runHook(sessionId, {
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: {
      command:
        'mkdir -p ~/.goldband/sessions && touch ~/.goldband/sessions/review',
    },
  });
  assert.equal(runtimeArtifactCommand.status, 0, runtimeArtifactCommand.stderr);

  const sedRead = runHook(sessionId, {
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command: "sed -n '1,20p' package.json" },
  });
  assert.equal(sedRead.status, 0, sedRead.stderr);

  // Runtime paths, dry runs, and words inside search arguments are not writes.
  for (const command of [
    'echo x | tee /tmp/review-notes.txt',
    'patch --dry-run -p1 < /tmp/fix.diff',
    'truncate -s 0 /tmp/review.log',
    'grep -rn "rm -rf" src',
    'rg install docs',
    'ls shell/install',
    'du -sh shell/install',
    'stat shell/install',
    'find . -name install',
    'which tee',
    "sed -n '1,5p' package.json\nrg -li foo src",
  ]) {
    const inspection = runHook(sessionId, {
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command },
    });
    assert.equal(inspection.status, 0, `${command}\n${inspection.stderr}`);
  }

  // An include path (`-Ilib`) is not an in-place flag.
  const perlInclude = runHook(sessionId, {
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command: "perl -Ilib -e 'print 1'" },
  });
  assert.equal(perlInclude.status, 0, perlInclude.stderr);
}

function assertStopClearsReviewReadOnly(sessionId) {
  const stop = runHook(sessionId, {
    hook_event_name: 'Stop',
  });
  assert.equal(stop.status, 0, stop.stderr);
  assert.equal(stop.stderr, '');

  const editAfterStop = runHook(sessionId, {
    hook_event_name: 'PreToolUse',
    tool_name: 'Edit',
    tool_input: {
      file_path: 'review-mutates.txt',
      old_string: 'before',
      new_string: 'after',
    },
  });
  assert.equal(editAfterStop.status, 0, editAfterStop.stderr);
}

function assertAllowedWriteHasNoHookOutput() {
  const allowedWrite = runHook('allow-output-regression', {
    hook_event_name: 'PreToolUse',
    tool_name: 'Write',
    tool_input: {
      file_path: 'src/allow-output-regression.ts',
      content: 'export {};\n',
    },
  });

  assert.equal(allowedWrite.status, 0, allowedWrite.stderr);
  assert.equal(
    allowedWrite.stdout,
    '',
    'An allow hook must not echo its input as Claude hook output',
  );
}

function assertSessionStartHasNoHookOutput() {
  const sessionId = 'session-start-output-regression';
  const firstSessionStart = runHook(sessionId, {
    hook_event_name: 'SessionStart',
  });
  assert.equal(firstSessionStart.status, 0, firstSessionStart.stderr);
  assert.equal(firstSessionStart.stdout, '');

  const repeatedSessionStart = runHook(sessionId, {
    hook_event_name: 'SessionStart',
  });
  assert.equal(repeatedSessionStart.status, 0, repeatedSessionStart.stderr);
  assert.equal(
    repeatedSessionStart.stdout,
    '',
    'SessionStart is passive and must emit no hook output',
  );
}

function assertInvalidHookOutputFailsLoudly() {
  for (const invalidOutput of [undefined, false, '', 1, []]) {
    assert.throws(
      () => writeOutput(invalidOutput),
      /outputJson must be a JSON object or null/,
    );
  }
}

assertReviewReadOnlyActivation('goldband-name', { name: 'goldband-review' });
assertReviewReadOnlyActivation('short-name', { name: 'review' });
assertReviewReadOnlyActivation('skill-name-field', { skill_name: '/review' });
assertReviewReadOnlyActivation('skillName-field', { skillName: 'review' });

const nonReviewSession = 'review-readonly-regression-non-review';
const invokeQa = runHook(nonReviewSession, {
  hook_event_name: 'PreToolUse',
  tool_name: 'Skill',
  tool_input: { name: 'goldband-qa' },
});
assert.equal(invokeQa.status, 0, invokeQa.stderr);
const editAfterQa = runHook(nonReviewSession, {
  hook_event_name: 'PreToolUse',
  tool_name: 'Edit',
  tool_input: {
    file_path: 'qa-mutates.txt',
    old_string: 'before',
    new_string: 'after',
  },
});
assert.equal(editAfterQa.status, 0, editAfterQa.stderr);

assertAllowedWriteHasNoHookOutput();
assertSessionStartHasNoHookOutput();
assertInvalidHookOutputFailsLoudly();

console.log('[OK] Claude /review hook read-only enforcement verified');
