const MAX_ADVISORY_ISSUES = 8;

export function outputResult(result, format) {
  if (format === 'advisory') {
    const advisory = formatAdvisory(result);
    if (advisory) process.stdout.write(`${advisory}\n`);
    return;
  }
  const content =
    format === 'json' ? JSON.stringify(result, null, 2) : formatText(result);
  process.stdout.write(`${content}\n`);
}

function formatAdvisory(result) {
  const issues = [...result.violations, ...result.advisories];
  if (issues.length === 0) return '';
  const omitted = issues.length - MAX_ADVISORY_ISSUES;
  return [
    'goldband style gate advisory:',
    ...issues.slice(0, MAX_ADVISORY_ISSUES).map(formatIssueLine),
    ...(omitted > 0 ? [`${omitted} more issue(s) not shown.`] : []),
    'These warnings are advisory here; pre-commit enforces blocking rules.',
  ].join('\n');
}

function formatText(result) {
  const lines = [];
  lines.push(`goldband style gate: checked ${result.files.length} file(s)`);

  if (result.violations.length === 0 && result.advisories.length === 0) {
    lines.push('OK: no violations');
    return lines.join('\n');
  }

  appendIssueSection(lines, 'Violations', result.violations);
  appendIssueSection(lines, 'Advisory', result.advisories);
  return lines.join('\n');
}

function appendIssueSection(lines, title, issues) {
  if (issues.length === 0) return;
  lines.push('', `${title}:`);
  for (const issue of issues) {
    lines.push(formatIssue(issue));
  }
}

function formatIssue(issue) {
  return `  - ${formatIssueLine(issue)}`;
}

function formatIssueLine(issue) {
  const location = issue.file
    ? `${issue.file}${issue.line ? `:${issue.line}` : ''}`
    : '(repo)';
  return `[${issue.rule}] ${location}: ${issue.message}`;
}
