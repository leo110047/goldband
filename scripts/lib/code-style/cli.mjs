import { checkFiles, checkSecretsOnly } from './checks.mjs';
import { config, repoRoot, ToolError, UsageError } from './config.mjs';
import { listFilesForMode, uniqueFiles } from './files.mjs';
import { outputResult, redact } from './output.mjs';
import {
  listWorktreeFilesChangedSince,
  writeWorktreeSnapshot,
} from './worktree-snapshot.mjs';

export function main(argv) {
  try {
    const args = parseArgs(argv);
    if (args.help) {
      console.log(usage());
      return 0;
    }
    validateArgs(args);
    if (args.snapshot !== null) {
      writeWorktreeSnapshot(args.snapshot);
      return 0;
    }

    const candidates = selectFiles(args);
    const files = uniqueFiles(candidates);
    const issues = checkFiles(files, args.mode, {
      detail: args.format === 'text' && terminalAttached(),
    });
    // Style exclusions never exclude a path from the secret scan.
    const styleChecked = new Set(files);
    const styleExcluded = candidates.filter((file) => !styleChecked.has(file));
    issues.push(...checkSecretsOnly(styleExcluded, args.mode));
    const result = buildResult(args.mode, files, issues);
    outputResult(result, args.format);
    return result.ok ? 0 : 1;
  } catch (error) {
    writeError(error);
    return 2;
  }
}

// Biome's full output quotes source. It is shown only to a person: git hands a
// hook's stdout to its own stderr, a terminal for a person and a pipe when an
// agent's shell tool runs `git commit`. GOLDBAND_STYLE_GATE_DETAIL=1 opts in.
function terminalAttached() {
  return (
    process.stdout.isTTY === true ||
    process.env.GOLDBAND_STYLE_GATE_DETAIL === '1'
  );
}

function selectFiles(args) {
  return args.since !== null
    ? listWorktreeFilesChangedSince(args.since)
    : listFilesForMode(args.mode, args.files);
}

function parseArgs(argv) {
  const parsed = {
    mode: 'repo',
    files: [],
    format: 'text',
    help: false,
    snapshot: null,
    since: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    index = consumeArg(parsed, argv, index);
  }
  return parsed;
}

function consumeArg(parsed, argv, index) {
  const arg = argv[index];
  if (arg === '--staged') {
    parsed.mode = 'staged';
    return index;
  }
  if (arg === '--worktree') {
    parsed.mode = 'worktree';
    return index;
  }
  if (arg === '--snapshot' || arg === '--since') {
    parsed[arg.slice(2)] = argv[index + 1] || '';
    return index + 1;
  }
  if (arg === '--files') return consumeFilesArg(parsed, argv, index);
  if (arg === '--format') return consumeFormatArg(parsed, argv, index);
  if (arg === '-h' || arg === '--help') {
    parsed.help = true;
    return index;
  }
  throw new UsageError(`unknown argument: ${arg}`);
}

function consumeFilesArg(parsed, argv, index) {
  parsed.mode = 'files';
  let current = index;
  while (argv[current + 1] && !argv[current + 1].startsWith('--')) {
    parsed.files.push(argv[current + 1]);
    current += 1;
  }
  return current;
}

function consumeFormatArg(parsed, argv, index) {
  const format = argv[index + 1];
  if (!['json', 'text', 'advisory'].includes(format)) {
    throw new UsageError(
      `unsupported --format value: ${format || '(missing)'}`,
    );
  }
  parsed.format = format;
  return index + 1;
}

function validateArgs(args) {
  if (args.mode === 'files' && args.files.length === 0) {
    throw new UsageError('--files requires at least one file');
  }
  const usesSnapshot = args.snapshot !== null || args.since !== null;
  if (usesSnapshot && args.mode !== 'worktree') {
    throw new UsageError('--snapshot and --since require --worktree');
  }
  if (args.snapshot !== null && args.since !== null) {
    throw new UsageError('--snapshot and --since are mutually exclusive');
  }
}

function buildResult(mode, files, issues) {
  return {
    ok: issues.every((issue) => issue.kind !== 'violation'),
    mode,
    root: repoRoot,
    thresholds: {
      maxFileLines: config.maxFileLines,
      maxFunctionLines: config.maxFunctionLines,
      maxParams: config.maxParams,
      maxComplexity: config.maxComplexity,
      maxTextBytes: config.maxTextBytes,
      maxGeneratedTextBytes: config.maxGeneratedTextBytes,
    },
    files,
    violations: issues.filter((issue) => issue.kind === 'violation'),
    advisories: issues.filter((issue) => issue.kind === 'advisory'),
  };
}

function writeError(error) {
  const message =
    error instanceof UsageError
      ? usage()
      : `goldband style gate error: ${error.message}`;
  const detail =
    error instanceof ToolError && error.detail ? `\n${error.detail}` : '';
  process.stderr.write(`${redact(`${message}${detail}`)}\n`);
}

function usage() {
  return [
    'Usage: node scripts/check-code-style.mjs [--staged] [--files <a> <b> ...] [--format json|text|advisory]',
    '       node scripts/check-code-style.mjs --worktree [--snapshot <id> | --since <id>] [--format ...]',
    '',
    '--worktree checks staged, unstaged, and untracked working-tree files.',
    '--snapshot records their identity; --since checks only files changed after it.',
    'advisory prints nothing when clean, otherwise a bounded hook summary.',
    'Exit codes: 0 no violations (advisories possible), 1 violations, 2 tool/config error.',
  ].join('\n');
}
