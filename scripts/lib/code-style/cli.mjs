import { checkFiles } from './checks.mjs';
import { config, repoRoot, ToolError, UsageError } from './config.mjs';
import { listFilesForMode, uniqueFiles } from './files.mjs';
import { outputResult } from './output.mjs';

export function main(argv) {
  try {
    const args = parseArgs(argv);
    if (args.help) {
      console.log(usage());
      return 0;
    }
    validateArgs(args);

    const files = uniqueFiles(listFilesForMode(args.mode, args.files));
    const issues = checkFiles(files, args.mode);
    const result = buildResult(args.mode, files, issues);
    outputResult(result, args.format);
    return result.ok ? 0 : 1;
  } catch (error) {
    writeError(error);
    return 2;
  }
}

function parseArgs(argv) {
  const parsed = { mode: 'repo', files: [], format: 'text', help: false };
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
  if (error instanceof ToolError && error.detail) {
    process.stderr.write(`${message}\n${error.detail}\n`);
    return;
  }
  process.stderr.write(`${message}\n`);
}

function usage() {
  return [
    'Usage: node scripts/check-code-style.mjs [--staged] [--files <a> <b> ...] [--format json|text|advisory]',
    '',
    'advisory prints nothing when clean, otherwise a bounded hook summary.',
    'Exit codes: 0 no violations (advisories possible), 1 violations, 2 tool/config error.',
  ].join('\n');
}
