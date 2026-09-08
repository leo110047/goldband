const REVIEW_GUIDE = 'the installed Goldband workflows/review/code.workflow.md';

function isReviewCommand(command) {
  if (typeof command !== 'string') return null;
  // Only executable positions count; quoted documentation and grep arguments
  // mentioning a review invocation are not review attempts.
  const tokens =
    command
      .replace(/\\\r?\n/g, ' ')
      .match(/"(?:\\.|[^"\\])*"|'[^']*'|&&|\|\||[;|\n]|[^\s;|]+/g) || [];
  // Heredoc bodies are data, not executable segments of this advisory's parser.
  if (tokens.some((token) => token.startsWith('<<'))) return null;
  const segments = [[]];
  for (const token of tokens) {
    if (/^(?:&&|\|\||[;|\n])$/.test(token)) {
      segments.push([]);
    } else {
      segments.at(-1).push(token.replace(/^(["'])(.*)\1$/s, '$2'));
    }
  }
  const commands = segments.filter((segment) => segment.length > 0);
  if (!commands.some(isReviewArgv)) return null;
  return commands.length === 1 ? 'single' : 'compound';
}

function isReviewArgv(argv) {
  let index = 0;
  while (/^[A-Za-z_][A-Za-z0-9_]*=/.test(argv[index] || '')) index++;
  if (['env', 'command', 'exec', 'time'].includes(argv[index])) index++;
  while (/^[A-Za-z_][A-Za-z0-9_]*=/.test(argv[index] || '')) index++;
  const name = (value) =>
    (value || '')
      .split(/[\\/]/)
      .pop()
      .replace(/\.exe$/i, '');
  if (name(argv[index]) === 'rtk' && argv[index + 1] === 'proxy') index += 2;
  if (['bun', 'node'].includes(name(argv[index]))) {
    index++;
    if (argv[index] === 'run') index++;
  }
  const entry = name(argv[index]);
  return (
    entry === 'goldband-review' ||
    (/^goldband(?:\.[cm]?[jt]s)?$/.test(entry) &&
      argv[index + 1] === 'review' &&
      argv[index + 2] !== 'contract')
  );
}

function toolResult(input) {
  const response = input.tool_response;
  const result = response && typeof response === 'object' ? response : {};
  const texts = [
    typeof response === 'string' ? response : '',
    result.stdout,
    result.stderr,
    result.output,
    input.error,
  ].filter((value) => typeof value === 'string');
  const exitCode =
    result.exit_code ??
    result.exitCode ??
    /^Exit code (\d+)\b/.exec(input.error || '')?.[1];
  // Codex can deliver only the command's text, with no exit-code field.
  // Use the CLI's error prefix or a missing-launcher diagnostic in that case.
  const launchError = texts.some(
    (text) =>
      /^goldband: .+/m.test(text) ||
      /^(?:.*: )?(?:command not found|Cannot find module|Module not found|No such file or directory)[^\n]*(?:goldband|\bbun\b)/im.test(
        text,
      ),
  );
  return {
    texts,
    launchError,
    failed:
      input.hook_event_name === 'PostToolUseFailure' ||
      (exitCode !== undefined &&
        Number.isInteger(Number(exitCode)) &&
        Number(exitCode) !== 0) ||
      (exitCode === undefined && launchError),
  };
}

function runtimeReport(text) {
  let report = text.trim();
  if (!report.startsWith('# review/code runtime report')) {
    try {
      // A host can merge launcher stderr warnings with the final JSON stdout.
      const start = report.search(/^\{/m);
      if (start < 0) return null;
      const value = JSON.parse(
        report.slice(start, report.lastIndexOf('}') + 1),
      );
      if (value?.workflow !== 'review/code' || typeof value.output !== 'string')
        return null;
      report = value.output;
    } catch {
      return null;
    }
  }
  return report.startsWith('# review/code runtime report') ? report : null;
}

function reviewLaunchAdvisory(input) {
  const command = isReviewCommand(input.tool_input?.command);
  if (
    !['PostToolUse', 'PostToolUseFailure'].includes(input.hook_event_name) ||
    input.tool_name !== 'Bash' ||
    input.is_interrupt === true ||
    !command
  )
    return null;

  const result = toolResult(input);
  const report = result.texts.map(runtimeReport).find(Boolean);
  if (report) {
    return /^- runtime-evidence-incomplete: true\s*$/m.test(report)
      ? "Goldband review started but its evidence is incomplete. Read this run's report and evidence artifact; resolve the reported environment blocker before rerunning the same candidate. This is not a successful review."
      : null;
  }
  // A compound shell's exit code can belong to another command, or the review
  // may never have run. Require a launcher diagnostic before attributing it.
  return result.failed && (command === 'single' || result.launchError)
    ? `Goldband review command failed. Read ${REVIEW_GUIDE} for the correct host launcher, then inspect the exact error before retrying. Preserve permission boundaries; no successful review has been established.`
    : null;
}

module.exports = { reviewLaunchAdvisory };
