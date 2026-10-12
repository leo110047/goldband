import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);
export const temp = fs.mkdtempSync(
  path.join(os.tmpdir(), 'goldband-config-preservation-'),
);
export const python = findPython();

function findPython() {
  for (const command of [['python3'], ['python'], ['py', '-3']]) {
    const result = spawnSync(command[0], [
      ...command.slice(1),
      '-c',
      'import tomllib',
    ]);
    if (result.status === 0) return command;
  }
  throw new Error('Config preservation tests require Python 3.11+ tomllib');
}

export function fixture(name) {
  const home = path.join(temp, name, 'home');
  fs.mkdirSync(home, { recursive: true });
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) =>
        !key.startsWith('GOLDBAND_') &&
        !key.startsWith('GIT_') &&
        !key.startsWith('CODEX_') &&
        !['ZDOTDIR', 'XDG_CONFIG_HOME'].includes(key),
    ),
  );
  Object.assign(env, {
    HOME: home,
    GOLDBAND_HOME: path.join(home, '.goldband'),
    CODEX_REQUIREMENTS_FILE: path.join(home, 'etc/codex/requirements.toml'),
    GIT_CONFIG_GLOBAL: os.devNull,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'Fixture',
    GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
    GIT_COMMITTER_NAME: 'Fixture',
    GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
  });
  return { home, env, cwd: root };
}

export function run(context, command, args, success = true) {
  const result = spawnSync(command, args, {
    cwd: context.cwd,
    env: context.env,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
  if (success) assert.equal(result.status, 0, result.stdout + result.stderr);
  return result;
}

export function install(context, ...targets) {
  return run(context, 'bash', ['./install.sh', ...targets]);
}

export function write(file, contents) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
}

export function toml(context, file) {
  return JSON.parse(
    run(context, python[0], [
      ...python.slice(1),
      '-c',
      'import json,sys,tomllib; print(json.dumps(tomllib.load(open(sys.argv[1], "rb")), default=str))',
      file,
    ]).stdout,
  );
}

export function copyInstaller(context) {
  context.cwd = path.join(path.dirname(context.home), 'repo');
  fs.mkdirSync(context.cwd, { recursive: true });
  for (const relative of [
    'install.sh',
    'shell/install',
    'shell/goldband-self-update.sh',
    'codex/config.toml',
    'codex/profiles',
    'codex/statusline.toml',
    'codex/requirements.toml',
    'codex/AGENTS.md',
    'codex/agents',
    'codex/prompts',
    'codex/hooks.json',
    'codex/hooks',
    'codex/rules',
    'hooks',
    'rules',
    'skills/global',
    'shell/goldband-launchers.sh',
  ]) {
    const source = path.join(root, relative);
    if (fs.existsSync(source))
      fs.cpSync(source, path.join(context.cwd, relative), { recursive: true });
  }
}
