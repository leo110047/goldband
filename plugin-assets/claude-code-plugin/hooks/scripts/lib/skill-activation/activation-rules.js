const fs = require('fs');
const path = require('path');

const PRIORITY_ORDER = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

const RULES = [
  {
    skill: 'systematic-debugging',
    priority: 'critical',
    hint: 'Use before proposing fixes for bugs, test failures, or unexpected behavior.',
    keywords: [
      'bug',
      'debug',
      'error',
      'exception',
      'crash',
      'broken',
      'regression',
      'unexpected behavior',
      'test fail',
      'failing test',
    ],
    patterns: [
      /\btest(s)?\b.{0,24}\b(fail|failing|broken|red)\b/i,
      /\b(stack trace|traceback|root cause)\b/i,
    ],
  },
  {
    skill: 'performance-optimization',
    priority: 'high',
    hint: 'Check the changed code path and workload; measure the metric claimed before reporting an improvement.',
    keywords: [
      'slow',
      'bottleneck',
      'latency',
      'throughput',
      'lag',
      'bundle size',
      'n+1',
    ],
    patterns: [
      /\b(core web vitals|render perf|memory allocations?)\b/i,
      /\b(performance|optimiz\w*|profil\w*)\b.{0,80}\b(code|function|query|database|api|memory|cpu|bundle|render|loop|cache)\b/i,
      /\b(code|function|query|database|api|memory|cpu|bundle|render|loop|cache)\b.{0,80}\b(performance|optimiz\w*|profil\w*)\b/i,
      /(?:程式|函式|查詢|資料庫|API|記憶體|CPU).{0,40}(?:效能|優化|很慢)/i,
    ],
  },
  {
    skill: 'testing-strategy',
    priority: 'medium',
    hint: 'Use for coverage planning, TDD, flaky-test strategy, and test pyramid decisions.',
    keywords: [
      'coverage',
      'tdd',
      'unit test',
      'integration test',
      'e2e',
      'flaky test',
      'test strategy',
    ],
    patterns: [/\b(write|improve|design)\b.{0,24}\btests?\b/i],
  },
  {
    skill: 'security-checklist',
    priority: 'high',
    hint: 'Use for auth, input validation, secrets handling, and OWASP-class risks.',
    keywords: [
      'security',
      'owasp',
      'xss',
      'csrf',
      'sql injection',
      'auth',
      'authorization',
      'input validation',
      'secret',
    ],
    patterns: [
      /\b(security|vulnerability|auth|authorization|authentication)\b/i,
    ],
  },
  {
    skill: 'ci-cd-integration',
    priority: 'medium',
    hint: 'Use for GitHub Actions, pipeline design, deploy strategy, and CI caching.',
    keywords: [
      'github actions',
      'ci/cd',
      'pipeline',
      'workflow yaml',
      'deploy strategy',
      'build cache',
      'github workflow',
    ],
    patterns: [
      /\b(ci|cd|pipeline|github actions|deploy)\b/i,
      /\bworkflow\b.{0,24}\b(yaml|github|deploy|ci|cd)\b/i,
    ],
  },
  {
    skill: 'file-search',
    priority: 'low',
    hint: 'Use when the task is primarily to locate files, usages, or structural matches.',
    keywords: [
      'ripgrep',
      'ast-grep',
      'grep',
      'search code',
      'find usage',
      'find file',
      'where is',
    ],
    patterns: [
      /\b(find|search|locate)\b.{0,24}\b(file|usage|symbol|definition|reference)\b/i,
    ],
  },
  {
    skill: 'planning-workflow',
    priority: 'medium',
    hint: 'Use for implementation plans that need small, verifiable steps.',
    keywords: [
      'implementation plan',
      '/plan',
      'break down task',
      'task breakdown',
      'execution plan',
    ],
    patterns: [
      /\b(plan|break down)\b.{0,24}\b(task|feature|implementation|work)\b/i,
    ],
  },
  {
    skill: 'subagent-development',
    priority: 'medium',
    hint: 'Use when splitting work across fresh-context subagents or reviewers.',
    keywords: ['subagent', 'parallel agent', 'fresh context', 'reviewer agent'],
    patterns: [/\b(subagent|parallelize|parallelise)\b/i],
  },
  {
    skill: 'claude-config-verification',
    priority: 'medium',
    hint: 'Use when changing hooks, skills, plugin manifests, or persistent plugin state.',
    keywords: [
      'hooks.json',
      'skill-rules.json',
      'plugin data',
      'claude plugin',
      'verify config',
      'hook replay',
      'claude_plugin_data',
    ],
    patterns: [
      /\b(hook|skill|plugin|claude code config)\b.{0,24}\b(verify|validation|manifest|router)\b/i,
    ],
  },
  {
    skill: 'skill-developer',
    priority: 'low',
    hint: 'Use for skill trigger, structure, scaffold, or extraction work; use the installed skill-authoring tool for a full workflow.',
    keywords: [
      'new skill',
      'create skill',
      'skill scaffold',
      'skill activation',
      'progressive disclosure',
      'skill rules',
      'skill trigger',
      'skill hook',
    ],
    patterns: [
      /\b(create|add|scaffold)\b.{0,24}\bskill\b/i,
      /\b(skill|skills)\b.{0,24}\b(trigger|activation|progressive disclosure|hook|rule)\b/i,
    ],
  },
  {
    skill: 'decision-log',
    priority: 'low',
    hint: 'Use when the task introduces an architectural or technology decision worth recording.',
    keywords: ['adr', 'decision log', 'architectural decision'],
    patterns: [/\b(decision|adr)\b.{0,24}\b(log|record|architecture)\b/i],
  },
  {
    skill: 'careful-mode',
    priority: 'medium',
    hint: 'Use for high-risk operations such as force-push, destroy, delete, or prod CLI work.',
    keywords: [
      'careful-mode',
      'force-push',
      'terraform destroy',
      'kubectl delete',
      'helm uninstall',
    ],
    patterns: [
      /\b(force[- ]push|destroy|delete)\b.{0,24}\b(prod|cluster|database|main)\b/i,
    ],
  },
  {
    skill: 'freeze-mode',
    priority: 'medium',
    hint: 'Use when you want a read-only investigation window before touching sensitive systems.',
    keywords: [
      'freeze-mode',
      'read-only session',
      'incident triage',
      'inspection only',
    ],
    patterns: [
      /\b(read[- ]only|investigation|triage)\b.{0,24}\b(session|prod|production|system)\b/i,
    ],
  },
];

const GOLDBAND_LOOP_RULES = require('./capability-routing.generated.json');

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
    findUpward(cwd, path.join('.claude', 'skills', 'goldband', 'SKILL.md')) ||
      (home &&
        fs.existsSync(
          path.join(home, '.claude', 'skills', 'goldband', 'SKILL.md'),
        )),
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
    const token = String(keyword || '')
      .toLowerCase()
      .trim();
    if (!token) continue;

    if (keywordMatches(normalizedPrompt, token)) {
      matched.push(token);
      score += token.includes(' ') ? 2 : 1;
    }
  }

  return { score, matched };
}

function keywordMatches(normalizedPrompt, token) {
  if (!/^[a-z0-9]+(?:[\s-]+[a-z0-9]+)*$/.test(token)) {
    return normalizedPrompt.includes(token);
  }

  const escaped = token
    .split(/\s+/)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('\\s+');
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?=$|[^a-z0-9])`).test(
    normalizedPrompt,
  );
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
  const priorityDelta =
    (PRIORITY_ORDER[left.priority] ?? 99) -
    (PRIORITY_ORDER[right.priority] ?? 99);
  if (priorityDelta !== 0) return priorityDelta;
  if (right.score !== left.score) return right.score - left.score;
  return left.skill.localeCompare(right.skill);
}

function applyConflictRules(matches) {
  const names = new Set(matches.map((match) => match.skill));
  const hasBugSignal = names.has('systematic-debugging');
  const hasIntegratedInvestigate = names.has('goldband-investigate');

  if (hasIntegratedInvestigate && hasBugSignal) {
    return matches.filter((match) => match.skill !== 'systematic-debugging');
  }

  return matches;
}

function matchPrompt(prompt) {
  const originalPrompt = String(prompt || '');
  const normalizedPrompt = normalizePrompt(originalPrompt);
  if (!normalizedPrompt) return [];

  const activeRules = isWorkflowPackAvailable()
    ? [...RULES, ...GOLDBAND_LOOP_RULES]
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
      matchedPatterns: patternResult.matched,
    });
  }

  return applyConflictRules(matches).sort(compareMatches);
}

function formatSuggestions(matches, limit = 3) {
  if (!Array.isArray(matches) || matches.length === 0) {
    return '';
  }

  const selected = matches.slice(0, limit);
  const lines = [
    'Relevant skills for this prompt:',
    ...selected.map((match) => `- ${match.skill} — ${match.hint}`),
    'Use the skill only if it matches the task you are about to perform.',
  ];
  return lines.join('\n');
}

module.exports = {
  RULES,
  formatSuggestions,
  matchPrompt,
};
