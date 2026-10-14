import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  redactSecrets,
} = require('../../../hooks/scripts/lib/hook-router/secret-patterns.js');

const MAX_ADVISORY_ISSUES = 8;

// Every byte the checker prints, including errors, passes through redaction.
export function redact(text) {
  return redactSecrets(text);
}

export function outputResult(result, format) {
  if (format === 'advisory') {
    const advisory = formatAdvisory(result);
    if (advisory) process.stdout.write(`${redactSecrets(advisory)}\n`);
    return;
  }
  const content =
    format === 'json' ? JSON.stringify(result, null, 2) : formatText(result);
  process.stdout.write(`${redactSecrets(content)}\n`);
}

// Tool-availability notes describe the repository setup, not the change; the
// model cannot act on them, so live advice omits them.
const SETUP_ADVISORY_RULES = new Set([
  'biome-unconfigured',
  'biome-unavailable',
  'biome-reporter-unsupported',
]);

function formatAdvisory(result) {
  const all = [...result.violations, ...result.advisories].filter(
    (issue) => !SETUP_ADVISORY_RULES.has(issue.rule),
  );
  if (all.length === 0) return '';
  // Secret findings lead so truncation never hides them.
  const secrets = all.filter((issue) => issue.rule === 'secret-scan');
  const issues = [
    ...secrets,
    ...all.filter((issue) => !secrets.includes(issue)),
  ];
  const omitted = issues.length - MAX_ADVISORY_ISSUES;
  return [
    'goldband style gate advisory:',
    ...issues.slice(0, MAX_ADVISORY_ISSUES).map(formatIssueLine),
    ...(omitted > 0 ? [`${omitted} more issue(s) not shown.`] : []),
    ...(secrets.some((issue) => issue.kind === 'violation')
      ? [
          'A potential secret is already on disk: remove it and rotate the credential if it was exposed.',
        ]
      : []),
    'These warnings are advisory; only an installed goldband style gate blocks commits.',
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
  const line = `  - ${formatIssueLine(issue)}`;
  if (!issue.detail) return line;
  const detail = issue.detail
    .split('\n')
    .map((text) => `      ${text}`)
    .join('\n');
  return `${line}\n${detail}`;
}

function formatIssueLine(issue) {
  const location = issue.file
    ? `${issue.file}${issue.line ? `:${issue.line}` : ''}`
    : '(repo)';
  return `[${issue.rule}] ${location}: ${issue.message}`;
}
