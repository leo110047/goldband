#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from './lib/code-style/config.mjs';
import { toRepoRelative } from './lib/code-style/files.mjs';

const repoRoot = findRepoRoot();

const checks = [
  {
    id: 'plugin-distribution',
    label: 'Plugin distribution artifacts',
    command: 'node',
    args: ['scripts/sync-plugin-assets.mjs', '--check'],
    matches: (file) =>
      file.startsWith('commands/') ||
      file.startsWith('rules/') ||
      file.startsWith('hooks/') ||
      file.startsWith('skills/global/') ||
      file.startsWith('scripts/lib/plugin-') ||
      file === 'scripts/sync-plugin-assets.mjs' ||
      file === 'scripts/check-plugin-distribution.mjs' ||
      file.startsWith('plugin-assets/claude-code-plugin/'),
    after: [
      {
        id: 'plugin-generated-artifacts-staged',
        label: 'Plugin generated artifacts must be staged',
        command: 'git',
        args: [
          'diff',
          '--quiet',
          '--',
          '.claude-plugin/marketplace.json',
          'docs/reports/plugin-expected-assets.json',
          'plugin-assets/claude-code-plugin',
        ],
        failureMessage:
          'plugin generated artifacts have unstaged changes; stage them or run node scripts/sync-plugin-assets.mjs',
      },
    ],
  },
  {
    id: 'hook-script-references',
    label: 'Hook config script references',
    command: 'python3',
    args: ['scripts/verify-hook-script-references.py'],
    matches: (file) =>
      file === 'hooks/hooks.json' ||
      file === 'codex/hooks.json' ||
      file.startsWith('hooks/scripts/hooks/') ||
      file === 'scripts/verify-hook-script-references.py',
  },
  {
    id: 'unused-exports',
    label: 'First-party exports have consumers',
    command: 'node',
    args: ['scripts/check-unused-exports.mjs'],
    // Removing a consumer anywhere can orphan an export, so any source runs it.
    matches: (file) =>
      /\.(?:js|cjs|mjs|ts|tsx|sh)$/.test(file) &&
      !file.startsWith('plugin-assets/'),
  },
  {
    id: 'codex-portability',
    label: 'Codex portable baseline',
    command: 'bash',
    args: ['scripts/check-codex-portability.sh'],
    matches: (file) =>
      file === 'codex/config.toml' ||
      file.startsWith('codex/rules/') ||
      file === 'scripts/check-codex-portability.sh',
  },
  {
    id: 'style-gate-self-test',
    label: 'Style gate self-test',
    command: 'node',
    args: ['scripts/test-code-style-gate.mjs'],
    after: [
      {
        id: 'project-style-gate-self-test',
        label: 'Project style gate self-test',
        command: 'node',
        args: ['scripts/test-goldband-project-style-gate.mjs'],
      },
    ],
    matches: (file) =>
      file.startsWith('git-hooks/') ||
      file === 'scripts/check-code-style.mjs' ||
      file === 'scripts/check-goldband-project-style-gate.mjs' ||
      file === 'scripts/test-code-style-gate.mjs' ||
      file === 'scripts/test-style-gate-install.mjs' ||
      file === 'scripts/test-goldband-project-style-gate.mjs' ||
      file.startsWith('scripts/lib/code-style/'),
  },
];

function main(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return 0;
  }

  const files = listFiles(args);
  const selectedChecks = selectChecks(files);
  if (args.dryRun) {
    printDryRun(files, selectedChecks, args.format);
    return 0;
  }

  if (selectedChecks.length === 0) {
    console.log('[goldband-project] no project style gate checks needed');
    return 0;
  }

  for (const check of selectedChecks) {
    runCheck(check);
  }
  console.log('[goldband-project] project style gate passed');
  return 0;
}

function parseArgs(argv) {
  const args = {
    mode: 'repo',
    files: [],
    dryRun: false,
    format: 'text',
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    index = consumeArg(args, argv, index);
  }
  if (args.format !== 'text' && args.format !== 'json') {
    throw new Error(
      `unsupported --format value: ${args.format || '(missing)'}`,
    );
  }
  return args;
}

function consumeArg(args, argv, index) {
  const arg = argv[index];
  if (arg === '--staged') {
    args.mode = 'staged';
    return index;
  }
  if (arg === '--files') return consumeFilesArg(args, argv, index);
  if (arg === '--dry-run') {
    args.dryRun = true;
    return index;
  }
  if (arg === '--format') return consumeFormatArg(args, argv, index);
  if (arg === '-h' || arg === '--help') {
    args.help = true;
    return index;
  }
  throw new Error(`unknown argument: ${arg}`);
}

function consumeFilesArg(args, argv, index) {
  args.mode = 'files';
  let current = index;
  while (argv[current + 1] && !argv[current + 1].startsWith('--')) {
    args.files.push(normalizePath(argv[current + 1]));
    current += 1;
  }
  if (args.files.length === 0) {
    throw new Error('--files requires at least one file');
  }
  return current;
}

function consumeFormatArg(args, argv, index) {
  args.format = argv[index + 1] || '';
  return index + 1;
}

function listFiles(args) {
  if (args.mode === 'files') return unique(args.files);
  if (args.mode === 'staged') {
    const result = run('git', [
      'diff',
      '--cached',
      '--name-only',
      '--diff-filter=ACMR',
      '-z',
    ]);
    if (result.status !== 0) {
      throw new Error(`failed to list staged files\n${result.stderr.trim()}`);
    }
    return unique(splitGitPathList(result.stdout));
  }
  const result = run('git', [
    'ls-files',
    '-z',
    '--cached',
    '--others',
    '--exclude-standard',
  ]);
  if (result.status !== 0) {
    throw new Error(`failed to list repo files\n${result.stderr.trim()}`);
  }
  return unique(splitGitPathList(result.stdout));
}

function selectChecks(files) {
  return checks.filter((check) => files.some((file) => check.matches(file)));
}

function runCheck(check) {
  console.log(`[goldband-project] ${check.label}`);
  runCommand(check.command, check.args, check.id);
  for (const afterCheck of check.after || []) {
    runCommand(afterCheck.command, afterCheck.args, afterCheck.id, afterCheck);
  }
}

function runCommand(command, args, id, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: 'inherit',
  });
  if (result.status === 0) return;
  const detail =
    options.failureMessage || `command failed: ${[command, ...args].join(' ')}`;
  throw new Error(`[goldband-project] ${id} failed: ${detail}`);
}

function printDryRun(files, selectedChecks, format) {
  const payload = {
    files,
    checks: selectedChecks.map((check) => check.id),
  };
  if (format === 'json') {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }
  if (payload.checks.length === 0) {
    console.log('[goldband-project] no project style gate checks needed');
    return;
  }
  for (const check of payload.checks) {
    console.log(`[goldband-project] would run ${check}`);
  }
}

function splitGitPathList(output) {
  return output.split('\0').filter(Boolean).map(normalizePath);
}

function normalizePath(file) {
  return (
    toRepoRelative(file) || file.split(path.sep).join('/').replace(/^\.\//, '')
  );
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function findRepoRoot() {
  const fallback = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
  );
  const result = spawnSync('git', ['rev-parse', '--show-toplevel'], {
    cwd: fallback,
    encoding: 'utf8',
  });
  if (result.status === 0 && result.stdout.trim()) {
    return result.stdout.trim();
  }
  return fallback;
}

function usage() {
  return [
    'Usage: node scripts/check-goldband-project-style-gate.mjs [--staged|--files <a> <b> ...] [--dry-run] [--format text|json]',
    '',
    'Runs goldband repo-specific commit checks selected by changed file paths.',
  ].join('\n');
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
