// Router harness for test-gate-protection.mjs: a temporary HOME and project,
// and runners that read each native hook adapter's response. Optional
// arguments name the Claude and Codex routers, so installed copies run the
// same cases.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);
const routers = {
  claude:
    process.argv[2] || path.join(root, 'hooks/scripts/hooks/hook-router.js'),
  codex: process.argv[3] || path.join(root, 'codex/hooks/hook-router.js'),
};
export const temp = fs.realpathSync(
  fs.mkdtempSync(path.join(os.tmpdir(), 'goldband-gate-protection-')),
);
export const home = path.join(temp, 'home');
export const project = path.join(temp, 'project');
process.on('exit', () => fs.rmSync(temp, { recursive: true, force: true }));
fs.mkdirSync(home, { recursive: true });
fs.mkdirSync(project, { recursive: true });
fs.writeFileSync(path.join(project, 'notes.md'), 'a\n');
// Aliases that Gate A resolves when they are invoked with options.
fs.writeFileSync(
  path.join(home, '.gitconfig'),
  [
    '[alias]',
    '\tci = commit',
    '\tlg = log --oneline',
    // Git runs the builtin, never an alias that shares its name.
    '\tlog = commit',
    '\tshci = !git commit',
    '\tfnci = "!f() { git commit \\"$@\\"; }; f"',
    // Included files are global configuration that Gate G protects.
    '[include]',
    '\tpath = extra.gitconfig',
    '[includeIf "gitdir:~/work/"]',
    '\tpath = ~/work.gitconfig',
    '',
  ].join('\n'),
);
for (const dir of ['kit/.claude', 'docs', 'out', 'src', 'big'])
  fs.mkdirSync(path.join(project, dir), { recursive: true });
fs.writeFileSync(path.join(project, 'kit/.claude/settings.json'), '{}');
fs.writeFileSync(path.join(project, 'docs/guide.md'), 'a\n');
for (let index = 0; index <= 2000; index += 1)
  fs.writeFileSync(path.join(project, 'big', `f${index}`), '');
const modeState = path.join(temp, 'modes.json');
fs.writeFileSync(modeState, JSON.stringify({ modes: {} }));

const AMBIENT_KEYS = /^(?:GIT_CONFIG_|GOLDBAND_|XDG_CONFIG_HOME$|ZDOTDIR$)/;

function homePath(value) {
  return value.startsWith('~/') ? path.join(home, value.slice(2)) : value;
}

export function baseEnv(extra = {}) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !AMBIENT_KEYS.test(key)),
  );
  const overrides = Object.fromEntries(
    Object.entries(extra).map(([key, value]) => [key, homePath(value)]),
  );
  return {
    ...env,
    HOME: home,
    GOLDBAND_DATA_DIR: path.join(temp, 'data'),
    CLAUDE_PLUGIN_DATA: path.join(temp, 'data'),
    HOOK_ROUTER_MODE_STATE_FILE: modeState,
    GOLDBAND_STYLE_GATE_SCRIPT: path.join(temp, 'no-style-checker'),
    ...overrides,
  };
}

function spawnRouter(host, payload, options = {}) {
  const input =
    typeof payload === 'string'
      ? payload
      : JSON.stringify({ hook_event_name: 'PreToolUse', ...payload });
  return spawnSync(process.execPath, [routers[host]], {
    input,
    encoding: 'utf8',
    timeout: 10000,
    cwd: options.cwd || project,
    env: baseEnv(options.env),
  });
}

// Claude: exit 2 is deny; an `ask` permission decision on stdout is ask.
export function runClaude(payload, options) {
  const result = spawnRouter('claude', payload, options);
  assert.ok([0, 2].includes(result.status), result.stderr);
  if (result.status === 2) {
    return {
      response: 'deny',
      message: result.stderr.replace(/^\[Hook\] BLOCKED: /, '').trim(),
    };
  }
  const output = result.stdout ? JSON.parse(result.stdout) : {};
  const hook = output.hookSpecificOutput || {};
  assert.notEqual(hook.permissionDecision, 'deny', result.stdout);
  return hook.permissionDecision === 'ask'
    ? { response: 'ask', message: hook.permissionDecisionReason }
    : { response: 'none', message: '' };
}

// Codex: never exits with an error and never relies on an unsupported `ask`.
export function runCodex(payload, options) {
  const result = spawnRouter('codex', payload, options);
  assert.equal(result.status, 0, result.stderr);
  const hook = JSON.parse(result.stdout || '{}').hookSpecificOutput || {};
  assert.notEqual(hook.permissionDecision, 'ask', result.stdout);
  return hook.permissionDecision === 'deny'
    ? { response: 'deny', message: hook.permissionDecisionReason }
    : { response: 'none', message: '' };
}

export function bash(command) {
  return { tool_name: 'Bash', tool_input: { command }, cwd: project };
}

export function patch(lines) {
  return {
    tool_name: 'apply_patch',
    tool_input: {
      command: ['*** Begin Patch', ...lines, '*** End Patch'].join('\n'),
    },
    cwd: project,
  };
}

export function absoluteTarget(target) {
  return path.resolve(project, homePath(target));
}

export function check(label, actual, expected) {
  assert.equal(actual.response, expected, `${label}: ${actual.message}`);
}
