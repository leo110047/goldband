import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const {
  reviewLaunchAdvisory,
} = require('../hooks/scripts/lib/hook-router/review-launch-advisory.js');
const root = path.resolve(import.meta.dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'review-advisory-'));
const report =
  '# review/code runtime report\n\n- runtime-evidence-incomplete: true\n- completion-authorized: false\n';
const output = JSON.stringify({ workflow: 'review/code', output: report });
const input = (command, tool_response) => ({
  hook_event_name: 'PostToolUse',
  tool_name: 'Bash',
  tool_input: { command },
  tool_response,
});

try {
  for (const command of [
    'goldband review code',
    'goldband-review',
    'cd /repo && goldband review code --host claude',
    'env LANG=C /usr/local/bin/goldband review code',
    'rtk proxy goldband review code',
    '/Users/example/.bun/bin/bun "/path with spaces/goldband.js" review code',
    'bun.exe C:\\tools\\goldband.js review code',
    'bun /tmp/goldband.js \\\n review code',
  ]) {
    const message = reviewLaunchAdvisory(
      input(command, {
        exit_code: 1,
        stderr: 'goldband: review code requires --host claude or --host codex',
      }),
    );
    assert.match(
      message,
      /installed Goldband workflows\/review\/code.workflow.md/,
    );
    assert.match(message, /Preserve permission boundaries/);
  }
  for (const command of [
    'npm test',
    'goldband review contract validate',
    "echo 'goldband review code'",
    "rg 'goldband review code' README.md",
    'cat /path/goldband.js',
    'goldband plan create',
    "cat <<'EOF'\ngoldband review code\nEOF",
    'echo x; false && goldband review code',
    'goldband review code; false',
  ]) {
    assert.equal(
      reviewLaunchAdvisory(input(command, { exit_code: 1 })),
      null,
      command,
    );
  }
  for (const response of [
    {
      exit_code: 0,
      stdout: output,
      stderr: 'Goldband review: temporary state root warning',
    },
    { exitCode: 0, output },
    output,
    { stdout: report },
    `Goldband review: durable state root is not writable in this sandbox; evidence will use sandbox-safe temporary root /tmp/review.\n${output}`,
    `${output}\nGoldband review: temporary state root warning\n`,
  ]) {
    const message = reviewLaunchAdvisory(
      input('goldband review code --host codex', response),
    );
    assert.match(message, /started but its evidence is incomplete/);
    assert.doesNotMatch(message, /correct host launcher/);
  }
  assert.equal(
    reviewLaunchAdvisory(input('goldband review code', { exit_code: 0 })),
    null,
  );
  assert.equal(
    reviewLaunchAdvisory(
      input('goldband review code', {
        exit_code: 1,
        stdout: output.replace('incomplete: true', 'incomplete: false'),
      }),
    ),
    null,
    'actual review findings are not launcher errors',
  );
  assert.equal(
    reviewLaunchAdvisory({
      ...input('goldband review code', { exit_code: 1 }),
      is_interrupt: true,
    }),
    null,
  );
  assert.equal(
    reviewLaunchAdvisory({
      ...input('goldband review code', { exit_code: 1 }),
      hook_event_name: 'PreToolUse',
    }),
    null,
  );

  const failed = spawnSync(
    'bun',
    ['goldband-loop/bin/goldband.ts', 'review', 'code'],
    {
      cwd: root,
      encoding: 'utf8',
    },
  );
  assert.equal(failed.status, 1, failed.stderr);
  assert.match(failed.stderr, /requires --host/);
  assert.match(
    reviewLaunchAdvisory(
      input('bun goldband-loop/bin/goldband.ts review code', failed.stderr),
    ),
    /correct host launcher/,
    'live Codex PostToolUse delivers plain text without an exit code',
  );
  const codexEvent = input('bun goldband-loop/bin/goldband.ts review code', {
    exit_code: failed.status,
    stdout: failed.stdout,
    stderr: failed.stderr,
  });
  const claudeEvent = {
    ...codexEvent,
    hook_event_name: 'PostToolUseFailure',
    tool_response: undefined,
    error: `Exit code ${failed.status}\n${failed.stderr}`,
    is_interrupt: false,
  };

  const copiedHooks = path.join(temp, 'codex-hooks');
  fs.cpSync(path.join(root, 'codex/hooks'), copiedHooks, { recursive: true });
  for (const [router, event] of [
    ['codex/hooks/hook-router.js', codexEvent],
    [
      'codex/hooks/hook-router.js',
      { ...codexEvent, tool_response: failed.stderr },
    ],
    [path.join(copiedHooks, 'hook-router.js'), codexEvent],
    ['hooks/scripts/hooks/hook-router.js', claudeEvent],
    [
      'plugin-assets/claude-code-plugin/hooks/scripts/hooks/hook-router.js',
      claudeEvent,
    ],
  ]) {
    const run = (payload) =>
      spawnSync(process.execPath, [router], {
        cwd: root,
        input: JSON.stringify(payload),
        encoding: 'utf8',
        env: {
          ...process.env,
          GOLDBAND_DATA_DIR: temp,
          CLAUDE_PLUGIN_DATA: temp,
          HOOK_ROUTER_METRICS_DISABLED: '1',
        },
      });
    const launched = run(event);
    assert.equal(launched.status, 0, launched.stderr);
    const advice = JSON.parse(launched.stdout).hookSpecificOutput;
    assert.equal(advice.hookEventName, event.hook_event_name);
    assert.match(advice.additionalContext, /correct host launcher/);
    const incomplete = run(
      input('goldband review code --host codex', {
        exit_code: 0,
        stdout: output,
      }),
    );
    assert.equal(incomplete.status, 0, incomplete.stderr);
    assert.match(
      JSON.parse(incomplete.stdout).hookSpecificOutput.additionalContext,
      /evidence is incomplete/,
    );
  }
  console.log(
    'ok - review launch advice, incomplete reports, silent unrelated commands, and isolated host adapters',
  );
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
