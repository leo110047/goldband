const fs = require('fs');
const path = require('path');

const PRIORITY_ORDER = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3
};

const ARCHITECTURE_TERMS_PATTERN = /\b(design|architecture|structure|pattern)\b/i;
const PERFORMANCE_TERMS_PATTERN = /\b(slow|performance|optimi[sz]e|latency|bottleneck)\b/i;

const RULES = [
  {
    skill: 'systematic-debugging',
    priority: 'critical',
    hint: 'Use before proposing fixes for bugs, test failures, or unexpected behavior.',
    keywords: ['bug', 'debug', 'error', 'exception', 'crash', 'broken', 'regression', 'unexpected behavior', 'test fail', 'failing test'],
    patterns: [
      /\btest(s)?\b.{0,24}\b(fail|failing|broken|red)\b/i,
      /\b(stack trace|traceback|root cause)\b/i
    ]
  },
  {
    skill: 'performance-optimization',
    priority: 'high',
    hint: 'Measure and profile before changing code for speed.',
    keywords: ['slow', 'performance', 'optimize', 'optimization', 'bottleneck', 'latency', 'throughput', 'lag', 'bundle size', 'n+1'],
    patterns: [/\b(core web vitals|profil(e|ing)|render perf)\b/i]
  },
  {
    skill: 'backend-patterns',
    priority: 'medium',
    hint: 'Use for service or API architecture decisions, not active bugfixing.',
    keywords: ['backend architecture', 'service design', 'repository pattern', 'microservice', 'domain model', 'api architecture'],
    patterns: [/\b(design|architect|structure|pattern)\b.{0,24}\b(api|service|backend)\b/i]
  },
  {
    skill: 'api-design',
    priority: 'medium',
    hint: 'Use for REST semantics, pagination, error formats, and versioning.',
    keywords: ['rest', 'pagination', 'openapi', 'error format', 'http method', 'api versioning'],
    patterns: [/\b(api|endpoint)\b.{0,24}\b(design|contract|pagination|versioning)\b/i]
  },
  {
    skill: 'database-patterns',
    priority: 'medium',
    hint: 'Use for schema design, queries, indexes, migrations, and transactions.',
    keywords: ['schema', 'migration', 'index', 'sql', 'query optimization', 'orm', 'transaction'],
    patterns: [/\b(database|query|schema|migration)\b/i]
  },
  {
    skill: 'testing-strategy',
    priority: 'medium',
    hint: 'Use for coverage planning, TDD, flaky-test strategy, and test pyramid decisions.',
    keywords: ['coverage', 'tdd', 'unit test', 'integration test', 'e2e', 'flaky test', 'test strategy'],
    patterns: [/\b(write|improve|design)\b.{0,24}\btests?\b/i]
  },
  {
    skill: 'security-checklist',
    priority: 'high',
    hint: 'Use for auth, input validation, secrets handling, and OWASP-class risks.',
    keywords: ['security', 'owasp', 'xss', 'csrf', 'sql injection', 'auth', 'authorization', 'input validation', 'secret'],
    patterns: [/\b(security|vulnerability|auth|authorization|authentication)\b/i]
  },
  {
    skill: 'ci-cd-integration',
    priority: 'medium',
    hint: 'Use for GitHub Actions, pipeline design, deploy strategy, and CI caching.',
    keywords: ['github actions', 'ci/cd', 'pipeline', 'workflow yaml', 'deploy strategy', 'build cache', 'github workflow'],
    patterns: [/\b(ci|cd|pipeline|github actions|deploy)\b/i, /\bworkflow\b.{0,24}\b(yaml|github|deploy|ci|cd)\b/i]
  },
  {
    skill: 'code-review-skill',
    priority: 'medium',
    hint: 'Use for PR reviews when there is no active bug investigation blocking review.',
    keywords: ['review pr', 'code review', 'pull request', 'review this diff'],
    patterns: [/\b(review|pr|pull request)\b/i]
  },
  {
    skill: 'file-search',
    priority: 'low',
    hint: 'Use when the task is primarily to locate files, usages, or structural matches.',
    keywords: ['ripgrep', 'ast-grep', 'grep', 'search code', 'find usage', 'find file', 'where is'],
    patterns: [/\b(find|search|locate)\b.{0,24}\b(file|usage|symbol|definition|reference)\b/i]
  },
  {
    skill: 'planning-workflow',
    priority: 'medium',
    hint: 'Use for implementation plans that need small, verifiable steps.',
    keywords: ['implementation plan', '/plan', 'break down task', 'task breakdown', 'execution plan'],
    patterns: [/\b(plan|break down)\b.{0,24}\b(task|feature|implementation|work)\b/i]
  },
  {
    skill: 'subagent-development',
    priority: 'medium',
    hint: 'Use when splitting work across fresh-context subagents or reviewers.',
    keywords: ['subagent', 'parallel agent', 'fresh context', 'reviewer agent'],
    patterns: [/\b(subagent|parallelize|parallelise)\b/i]
  },
  {
    skill: 'claude-config-verification',
    priority: 'medium',
    hint: 'Use when changing hooks, skills, plugin manifests, or persistent plugin state.',
    keywords: ['hooks.json', 'skill-rules.json', 'plugin data', 'claude plugin', 'verify config', 'hook replay', 'claude_plugin_data'],
    patterns: [/\b(hook|skill|plugin|claude code config)\b.{0,24}\b(verify|validation|manifest|router)\b/i]
  },
  {
    skill: 'new-skill-scaffold',
    priority: 'low',
    hint: 'Use to scaffold a new folder-based skill with templates and config stubs.',
    keywords: ['new skill', 'create skill', 'skill scaffold', 'scaffold skill', 'skill template'],
    patterns: [/\b(create|add|scaffold)\b.{0,24}\bskill\b/i]
  },
  {
    skill: 'skill-developer',
    priority: 'low',
    hint: 'Use when editing triggers, progressive disclosure structure, or skill hooks.',
    keywords: ['skill activation', 'progressive disclosure', 'skill rules', 'skill trigger', 'skill hook'],
    patterns: [/\b(skill|skills)\b.{0,24}\b(trigger|activation|progressive disclosure|hook|rule)\b/i]
  },
  {
    skill: 'commit-conventions',
    priority: 'low',
    hint: 'Use when writing or reviewing commit messages.',
    keywords: ['commit message', 'conventional commits', 'commit format'],
    patterns: [/\b(commit|git)\b.{0,24}\b(message|convention)\b/i]
  },
  {
    skill: 'decision-log',
    priority: 'low',
    hint: 'Use when the task introduces an architectural or technology decision worth recording.',
    keywords: ['adr', 'decision log', 'architectural decision'],
    patterns: [/\b(decision|adr)\b.{0,24}\b(log|record|architecture)\b/i]
  },
  {
    skill: 'careful-mode',
    priority: 'medium',
    hint: 'Use for high-risk operations such as force-push, destroy, delete, or prod CLI work.',
    keywords: ['careful-mode', 'force-push', 'terraform destroy', 'kubectl delete', 'helm uninstall'],
    patterns: [/\b(force[- ]push|destroy|delete)\b.{0,24}\b(prod|cluster|database|main)\b/i]
  },
  {
    skill: 'freeze-mode',
    priority: 'medium',
    hint: 'Use when you want a read-only investigation window before touching sensitive systems.',
    keywords: ['freeze-mode', 'read-only session', 'incident triage', 'inspection only'],
    patterns: [/\b(read[- ]only|investigation|triage)\b.{0,24}\b(session|prod|production|system)\b/i]
  }
];

const GSTACK_RULES = [
  {
    skill: 'goldband-investigate',
    priority: 'high',
    hint: 'Use /goldband-investigate for workflow-driven root-cause debugging and scoped edit boundaries.',
    keywords: ['investigate', 'root cause', 'trace data flow', 'debug workflow'],
    patterns: [/\b(debug|bug|error|crash|500|failing test)\b/i]
  },
  {
    skill: 'goldband-review',
    priority: 'high',
    hint: 'Use /goldband-review for a staff-engineer style PR review pass.',
    keywords: ['review pr', 'review branch', 'audit this diff', 'staff engineer review'],
    patterns: [/\b(review|pr|pull request)\b/i]
  },
  {
    skill: 'goldband-qa',
    priority: 'high',
    hint: 'Use /goldband-qa for browser-based UI, staging, and E2E verification.',
    keywords: ['qa', 'browser', 'staging url', 'ui bug', 'e2e', 'playwright'],
    patterns: [/\b(browser|ui|e2e|staging|qa)\b/i]
  },
  {
    skill: 'goldband-cso',
    priority: 'high',
    hint: 'Use /cso for deeper OWASP + STRIDE security review.',
    keywords: ['cso', 'owasp', 'stride', 'security audit', 'threat model'],
    patterns: [/\b(security|owasp|stride|threat model)\b/i]
  },
  {
    skill: 'goldband-ship',
    priority: 'medium',
    hint: 'Use /goldband-ship for release workflow, PR creation, and pre-landing checks.',
    keywords: ['ship', 'release', 'open pr', 'deploy prep'],
    patterns: [/\b(ship|release|open pr|deployment)\b/i]
  },
  {
    skill: 'goldband-plan-eng-review',
    priority: 'medium',
    hint: 'Use /goldband-plan-eng-review for architecture and implementation plan review.',
    keywords: ['eng review', 'architecture review', 'implementation review'],
    patterns: [/\b(plan|architecture|design)\b.{0,24}\b(review|feature|implementation)\b/i]
  },
  {
    skill: 'goldband-guard',
    priority: 'medium',
    hint: 'Use /goldband-guard for workflow-local safety rails (careful + scoped freeze).',
    keywords: ['guard mode', 'safety net', 'be careful', 'guardrails'],
    patterns: [/\b(be careful|guard|safety net|guardrails)\b/i]
  },
  {
    skill: 'goldband-freeze',
    priority: 'medium',
    hint: 'Use /goldband-freeze when you want to restrict edits to one directory, not a fully read-only session.',
    keywords: ['restrict edits', 'only edit this folder', 'scope edits', 'lock edits to directory'],
    patterns: [/\b(restrict|scope|limit|lock)\b.{0,24}\b(edit|edits|changes)\b/i]
  }
];

function findUpward(startDir, relativePath) {
  let current = startDir;
  while (current && current !== path.dirname(current)) {
    const candidate = path.join(current, relativePath);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
    current = path.dirname(current);
  }
  return null;
}

function isWorkflowPackAvailable() {
  const cwd = process.cwd();
  const home = process.env.HOME || '';
  return Boolean(
    findUpward(cwd, path.join('.claude', 'skills', 'workflow', 'SKILL.md'))
    || (home && fs.existsSync(path.join(home, '.claude', 'skills', 'workflow', 'SKILL.md')))
  );
}

function normalizePrompt(prompt) {
  return String(prompt || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function countKeywordHits(normalizedPrompt, keywords) {
  let score = 0;
  const matched = [];

  for (const keyword of keywords || []) {
    const token = String(keyword || '').toLowerCase().trim();
    if (!token) continue;

    if (normalizedPrompt.includes(token)) {
      matched.push(token);
      score += token.includes(' ') ? 2 : 1;
    }
  }

  return { score, matched };
}

function countPatternHits(prompt, patterns) {
  let score = 0;
  const matched = [];

  for (const pattern of patterns || []) {
    if (!(pattern instanceof RegExp)) continue;
    if (pattern.test(prompt)) {
      matched.push(pattern.source);
      score += 2;
    }
  }

  return { score, matched };
}

function compareMatches(left, right) {
  const priorityDelta = (PRIORITY_ORDER[left.priority] ?? 99) - (PRIORITY_ORDER[right.priority] ?? 99);
  if (priorityDelta !== 0) return priorityDelta;
  if (right.score !== left.score) return right.score - left.score;
  return left.skill.localeCompare(right.skill);
}

function applyConflictRules(matches, normalizedPrompt) {
  const names = new Set(matches.map(match => match.skill));
  const hasBugSignal = names.has('systematic-debugging');
  const hasIntegratedInvestigate = names.has('goldband-investigate');

  if (hasIntegratedInvestigate && hasBugSignal) {
    return matches.filter(match => match.skill !== 'systematic-debugging');
  }

  if (hasBugSignal) {
    return matches.filter(match => match.skill !== 'code-review-skill');
  }

  if (names.has('performance-optimization') && names.has('backend-patterns')) {
    const architectureTerms = ARCHITECTURE_TERMS_PATTERN.test(normalizedPrompt);
    const performanceTerms = PERFORMANCE_TERMS_PATTERN.test(normalizedPrompt);

    if (architectureTerms && !performanceTerms) {
      return matches.filter(match => match.skill !== 'performance-optimization');
    }

    if (performanceTerms && !architectureTerms) {
      return matches.filter(match => match.skill !== 'backend-patterns');
    }
  }

  return matches;
}

function matchPrompt(prompt) {
  const originalPrompt = String(prompt || '');
  const normalizedPrompt = normalizePrompt(originalPrompt);
  if (!normalizedPrompt) return [];

  const activeRules = isWorkflowPackAvailable()
    ? [...RULES, ...GSTACK_RULES]
    : RULES;
  const matches = [];
  for (const rule of activeRules) {
    const keywordResult = countKeywordHits(normalizedPrompt, rule.keywords);
    const patternResult = countPatternHits(originalPrompt, rule.patterns);
    const score = keywordResult.score + patternResult.score;

    if (score <= 0) continue;

    matches.push({
      skill: rule.skill,
      priority: rule.priority,
      hint: rule.hint,
      score,
      matchedKeywords: keywordResult.matched,
      matchedPatterns: patternResult.matched
    });
  }

  return applyConflictRules(matches, normalizedPrompt)
    .sort(compareMatches);
}

function formatSuggestions(matches, limit = 3) {
  if (!Array.isArray(matches) || matches.length === 0) {
    return '';
  }

  const selected = matches.slice(0, limit);
  const lines = [
    'Relevant skills for this prompt:',
    ...selected.map(match => `- ${match.skill} — ${match.hint}`),
    'Use the skill only if it matches the task you are about to perform.'
  ];
  return lines.join('\n');
}

module.exports = {
  RULES,
  formatSuggestions,
  matchPrompt
};
