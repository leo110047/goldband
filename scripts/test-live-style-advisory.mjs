#!/usr/bin/env node

// Live style/secret advice must cover every write path a host exposes: file
// tools, Codex patches (including move destinations), and shell commands, in
// source, linked, and copied hook layouts.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  CONFLICT,
  contextOf,
  createRepo,
  hookEnv,
  repoDir,
  routers,
  runRouter,
  runShellTool,
  snapshotFiles,
  tmpDir,
} from './lib/live-advisory-harness.mjs';

const tests = [
  ['shell writes report only files the command changed', testShellDelta],
  ['review launch failure keeps the shell scan', testReviewFailureScan],
  ['checker failure after a shell command is explicit', testCheckerFailure],
  ['missing snapshot falls back to every candidate', testMissingSnapshot],
  ['failed shell commands are still scanned', testFailedShellScan],
  ['a changed working directory keeps the snapshot', testChangedCwd],
  ['shell hooks report the checker process', testSpawnMetrics],
  ['read-only shell commands skip the checker', testReadOnlyShellSkipped],
  [
    'shell commands outside a Git repository skip the checker',
    testNoRepositorySkipped,
  ],
  ['quoted shell commands are always scanned', testQuotedShellScanned],
  ['background shell commands are not scanned', testBackgroundShell],
  ['Codex patch advice follows move destinations', testPatchMove],
  ['Codex patch paths resolve against the session cwd', testPatchSubdir],
  ['repository opt-outs silence live advice', testOptOut],
  ['setup notes stay out of live advice', testSetupNotesOmitted],
  ['file paths through a symlinked directory are checked', testSymlinkPath],
  ['copied hooks find the checker through the style gate', testCopiedHooks],
];

for (const [name, test] of tests) {
  test();
  console.log(`ok - ${name}`);
}

function testShellDelta() {
  for (const host of Object.keys(routers)) {
    const dir = createRepo();
    const heredoc = `cat > notes.md <<'EOF'\n${CONFLICT}EOF`;
    const created = runShellTool(host, dir, heredoc, `${host}-heredoc`);
    assert.match(created, /\[merge-conflict\] notes\.md:1/);
    assert.doesNotMatch(created, /already-dirty\.md/);

    const perl = `perl -pi -e 's/export const value = 1;/console.log(1);/' app.ts`;
    const edited = runShellTool(host, dir, perl, `${host}-perl`);
    assert.match(edited, /\[console-log\] app\.ts:1/);
    assert.doesNotMatch(edited, /already-dirty\.md|notes\.md/);

    const idle = runShellTool(host, dir, 'git status --short', `${host}-idle`);
    assert.equal(idle, '', `${host} must stay silent when nothing changed`);
  }
}

function testReviewFailureScan() {
  for (const host of Object.keys(routers)) {
    const dir = createRepo();
    const input = {
      tool_name: 'Bash',
      tool_use_id: `${host}-review-failure`,
      tool_input: { command: 'printf x > notes.md && goldband review code' },
    };
    runRouter(routers[host], dir, { ...input, hook_event_name: 'PreToolUse' });
    fs.writeFileSync(path.join(dir, 'notes.md'), CONFLICT);
    const context = contextOf(
      runRouter(routers[host], dir, {
        ...input,
        hook_event_name:
          host === 'claude' ? 'PostToolUseFailure' : 'PostToolUse',
        tool_response: { exit_code: 1, stderr: 'goldband: launcher failed' },
      }),
    );
    assert.match(context, /Goldband review command failed/, host);
    assert.match(context, /\[merge-conflict\] notes\.md:1/, host);
  }
}

function testCheckerFailure() {
  for (const host of Object.keys(routers)) {
    const dir = createRepo();
    const context = runShellTool(
      host,
      dir,
      "printf '{bad\\n' > .goldband-style.json",
      `${host}-broken`,
    );
    assert.match(context, /goldband style gate advisory could not run/);
  }
}

function testFailedShellScan() {
  for (const host of Object.keys(routers)) {
    const dir = createRepo();
    const input = {
      tool_name: 'Bash',
      tool_use_id: `${host}-failed`,
      tool_input: { command: 'write notes.md; false' },
    };
    runRouter(routers[host], dir, { ...input, hook_event_name: 'PreToolUse' });
    fs.writeFileSync(path.join(dir, 'notes.md'), CONFLICT);
    const context = contextOf(
      runRouter(routers[host], dir, {
        ...input,
        hook_event_name:
          host === 'claude' ? 'PostToolUseFailure' : 'PostToolUse',
        tool_response: { exit_code: 1 },
      }),
    );
    assert.match(context, /\[merge-conflict\] notes\.md:1/, host);
    assert.doesNotMatch(context, /already-dirty\.md/, host);
    if (host === 'codex') assert.match(context, /exited non-zero/);
  }
}

function testChangedCwd() {
  for (const host of Object.keys(routers)) {
    const dir = createRepo();
    fs.mkdirSync(path.join(dir, 'sub'));
    const input = {
      tool_name: 'Bash',
      tool_use_id: `${host}-cwd`,
      tool_input: { command: 'cd sub && write notes.md' },
    };
    runRouter(routers[host], dir, { ...input, hook_event_name: 'PreToolUse' });
    fs.writeFileSync(path.join(dir, 'sub', 'notes.md'), CONFLICT);
    const context = contextOf(
      runRouter(routers[host], path.join(dir, 'sub'), {
        ...input,
        hook_event_name: 'PostToolUse',
      }),
    );
    assert.match(context, /\[merge-conflict\] sub\/notes\.md:1/, host);
    assert.doesNotMatch(context, /already-dirty\.md/, host);
  }
}

function testSpawnMetrics() {
  const dir = createRepo();
  for (const event of ['PreToolUse', 'PostToolUse']) {
    const result = runRouter(
      routers.claude,
      dir,
      {
        hook_event_name: event,
        tool_name: 'Bash',
        tool_use_id: 'metrics',
        tool_input: { command: 'true' },
      },
      { HOOK_ROUTER_DEBUG_METRICS: '1' },
    );
    const metric = JSON.parse(
      result.stderr.match(/\[HookRouterMetrics\] (.+)/)[1],
    );
    assert.equal(metric.spawnedProcesses, 1, event);
  }
}

function testReadOnlyShellSkipped() {
  const dir = createRepo();
  for (const command of ['git status --short', 'rg TODO', 'ls -la']) {
    for (const event of ['PreToolUse', 'PostToolUse']) {
      const before = snapshotFiles();
      const result = runRouter(
        routers.claude,
        dir,
        {
          hook_event_name: event,
          tool_name: 'Bash',
          tool_use_id: `readonly-${command}`,
          tool_input: { command },
        },
        { HOOK_ROUTER_DEBUG_METRICS: '1' },
      );
      const metric = JSON.parse(
        result.stderr.match(/\[HookRouterMetrics\] (.+)/)[1],
      );
      assert.equal(metric.spawnedProcesses, 0, `${event} ${command}`);
      assert.deepEqual(snapshotFiles(), before, `${event} ${command}`);
    }
  }
}

function testNoRepositorySkipped() {
  const dir = fs.mkdtempSync(path.join(tmpDir, 'no-repo-'));
  for (const event of ['PreToolUse', 'PostToolUse']) {
    const result = runRouter(
      routers.claude,
      dir,
      {
        hook_event_name: event,
        tool_name: 'Bash',
        tool_use_id: 'no-repo',
        tool_input: { command: 'touch x' },
      },
      { HOOK_ROUTER_DEBUG_METRICS: '1' },
    );
    const metric = JSON.parse(
      result.stderr.match(/\[HookRouterMetrics\] (.+)/)[1],
    );
    assert.equal(metric.spawnedProcesses, 0, event);
  }
}

// Quoting can hide a writer option from the raw-text allowlist, so a quoted
// command is scanned even when its command name is read-only.
function testQuotedShellScanned() {
  const dir = createRepo();
  const result = runRouter(
    routers.claude,
    dir,
    {
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_use_id: 'quoted-output',
      tool_input: { command: "git diff '--output=notes.md'" },
    },
    { HOOK_ROUTER_DEBUG_METRICS: '1' },
  );
  const metric = JSON.parse(
    result.stderr.match(/\[HookRouterMetrics\] (.+)/)[1],
  );
  assert.equal(metric.spawnedProcesses, 1);
}

function testBackgroundShell() {
  for (const host of Object.keys(routers)) {
    const dir = createRepo();
    const input = {
      tool_name: 'Bash',
      tool_use_id: `${host}-background`,
      tool_input: {
        command: 'sleep 1; write notes.md',
        run_in_background: true,
      },
    };
    const snapshots = path.join(tmpDir, 'snapshots');
    const before = fs.existsSync(snapshots) ? fs.readdirSync(snapshots) : [];
    runRouter(routers[host], dir, { ...input, hook_event_name: 'PreToolUse' });
    const after = fs.existsSync(snapshots) ? fs.readdirSync(snapshots) : [];
    assert.deepEqual(
      after,
      before,
      `${host} must not snapshot a background call`,
    );
    const context = contextOf(
      runRouter(routers[host], dir, {
        ...input,
        hook_event_name: 'PostToolUse',
      }),
    );
    assert.equal(context, '', `${host} must not report a background delta`);
  }
}

function testMissingSnapshot() {
  const dir = createRepo();
  const context = contextOf(
    runRouter(routers.claude, dir, {
      hook_event_name: 'PostToolUse',
      tool_name: 'Bash',
      tool_use_id: 'never-snapshotted',
      tool_input: { command: 'true' },
    }),
  );
  assert.match(context, /already-dirty\.md/);
}

function testPatchMove() {
  const dir = createRepo();
  fs.writeFileSync(path.join(dir, 'moved.md'), CONFLICT);
  const patch = [
    '*** Begin Patch',
    '*** Update File: tracked.md',
    '*** Move to: moved.md',
    '@@',
    '-clean',
    '+moved',
    '*** End Patch',
  ].join('\n');
  const context = contextOf(
    runRouter(routers.codex, dir, {
      hook_event_name: 'PostToolUse',
      tool_name: 'apply_patch',
      tool_input: { command: patch },
    }),
  );
  assert.match(context, /\[merge-conflict\] moved\.md:1/);
}

function testPatchSubdir() {
  const dir = createRepo();
  fs.mkdirSync(path.join(dir, 'sub'));
  fs.writeFileSync(path.join(dir, 'sub', 'notes.md'), CONFLICT);
  const context = contextOf(
    runRouter(routers.codex, path.join(dir, 'sub'), {
      hook_event_name: 'PostToolUse',
      tool_name: 'apply_patch',
      tool_input: { command: '*** Add File: notes.md\n+x' },
    }),
  );
  assert.match(context, /\[merge-conflict\] sub\/notes\.md:1/);
}

function assertOptedOut(host, optOut) {
  const dir = createRepo();
  const env = optOut === 'env' ? { GOLDBAND_STYLE_GATE: '0' } : {};
  if (optOut === 'file') {
    fs.writeFileSync(path.join(dir, '.goldband-no-style-gate'), '');
  }
  const input = {
    tool_name: 'Bash',
    tool_use_id: `${host}-${optOut}-optout`,
    tool_input: { command: 'write notes.md' },
  };
  const before = snapshotFiles();
  runRouter(
    routers[host],
    dir,
    { ...input, hook_event_name: 'PreToolUse' },
    env,
  );
  assert.deepEqual(
    snapshotFiles(),
    before,
    `${host} ${optOut} wrote a snapshot`,
  );
  fs.writeFileSync(path.join(dir, 'notes.md'), CONFLICT);
  const context = contextOf(
    runRouter(
      routers[host],
      dir,
      { ...input, hook_event_name: 'PostToolUse' },
      env,
    ),
  );
  assert.equal(context, '', `${host} ${optOut} opt-out still advised`);
}

function testOptOut() {
  for (const optOut of ['file', 'env']) {
    for (const host of Object.keys(routers)) assertOptedOut(host, optOut);
  }
}

function testSetupNotesOmitted() {
  const dir = createRepo();
  fs.writeFileSync(path.join(dir, 'clean.ts'), 'export const value = 1;\n');
  const context = contextOf(
    runRouter(routers.claude, dir, {
      hook_event_name: 'PostToolUse',
      tool_name: 'Edit',
      tool_input: { file_path: path.join(dir, 'clean.ts') },
    }),
  );
  assert.equal(context, '', 'a repo without biome.json must not add context');
}

function testSymlinkPath() {
  const dir = createRepo();
  const link = path.join(tmpDir, `link-${path.basename(dir)}`);
  fs.symlinkSync(dir, link);
  fs.writeFileSync(path.join(dir, 'notes.md'), CONFLICT);
  const context = contextOf(
    runRouter(routers.claude, dir, {
      hook_event_name: 'PostToolUse',
      tool_name: 'Edit',
      tool_input: { file_path: path.join(link, 'notes.md') },
    }),
  );
  assert.match(context, /\[merge-conflict\] notes\.md:1/);
}

function testCopiedHooks() {
  const layouts = {
    claude: {
      source: 'hooks/scripts',
      router: 'hooks/hook-router.js',
    },
    codex: { source: 'codex/hooks', router: 'hook-router.js' },
  };
  for (const [host, layout] of Object.entries(layouts)) {
    const copy = path.join(tmpDir, `copied-${host}`);
    fs.cpSync(path.join(repoDir, layout.source), copy, { recursive: true });
    const router = path.join(copy, layout.router);
    const dir = createRepo();
    const input = {
      hook_event_name: 'PostToolUse',
      tool_name: host === 'claude' ? 'Edit' : 'apply_patch',
      tool_input:
        host === 'claude'
          ? { file_path: 'already-dirty.md' }
          : { command: '*** Add File: already-dirty.md\n+x' },
    };
    const run = (env) =>
      contextOf(
        spawnSync(process.execPath, [router], {
          cwd: dir,
          input: JSON.stringify(input),
          encoding: 'utf8',
          env: hookEnv(env),
        }),
      );
    assert.equal(run(), '', `${host} copy without a style gate stays silent`);

    const hooksDir = path.join(tmpDir, `style-gate-${host}`);
    fs.mkdirSync(hooksDir, { recursive: true });
    fs.writeFileSync(
      path.join(hooksDir, '.goldband-source'),
      `${repoDir}\nschemaVersion=1\n`,
    );
    assert.match(
      run({ GOLDBAND_GIT_HOOKS_DIR: hooksDir }),
      /\[merge-conflict\] already-dirty\.md:1/,
    );
  }
}
