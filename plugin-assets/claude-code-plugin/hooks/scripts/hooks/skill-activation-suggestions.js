#!/usr/bin/env node

const { readStdinJson } = require('../lib/utils');
const { appendUsageEvent } = require('../lib/hook-router/usage-telemetry');
const { armFromPrompt } = require('../lib/hook-router/cross-review-gate');
const {
  buildWorkflowUsageEvents,
} = require('../lib/hook-router/workflow-telemetry');
const {
  formatSuggestions,
  matchPrompt,
} = require('../lib/skill-activation/activation-rules');
const {
  buildKnowledgeAdvisory,
} = require('../lib/skill-activation/knowledge-advisory');
const {
  shouldEmitKnowledgeAdvisory,
  shouldEmitSuggestions,
} = require('../lib/skill-activation/session-state');

function buildMatchUsageEvents(matches, sessionId, prompt) {
  return matches.map((match) => ({
    category: 'prompt-trigger',
    name: match.skill,
    action: 'matched',
    sessionId,
    source: 'skill-activation-suggestions',
    detail: {
      priority: match.priority,
      score: match.score,
      matchedKeywords: match.matchedKeywords,
      matchedPatterns: match.matchedPatterns,
      promptPreview: String(prompt || '').slice(0, 160),
    },
  }));
}

function buildSuggestionUsageEvent(matches, sessionId) {
  return {
    category: 'prompt-trigger',
    name: 'skill-activation-suggestions',
    action: 'suggested',
    sessionId,
    source: 'skill-activation-suggestions',
    detail: {
      skills: matches.map((match) => match.skill),
    },
  };
}

async function main() {
  const input = await readStdinJson();
  const prompt = String(input.prompt || '');
  const sessionId = input.session_id || process.env.CLAUDE_SESSION_ID || null;
  const crossReviewContract = armCrossReviewIfRequested(input);
  const matches = matchPrompt(prompt);
  const knowledgeAdvisory = buildKnowledgeAdvisory(prompt);

  for (const event of buildWorkflowUsageEvents(
    input,
    'claude',
    'hooks/scripts/hooks/skill-activation-suggestions.js',
  )) {
    appendUsageEvent(event);
  }

  for (const event of buildMatchUsageEvents(matches, sessionId, prompt)) {
    appendUsageEvent(event);
  }

  const promptContext = buildPromptContext({
    crossReviewContract,
    knowledgeAdvisory,
    matches,
    sessionId,
    cwd: input.cwd || process.cwd(),
  });

  if (!promptContext.shouldEmit) {
    process.stdout.write('{}');
    return;
  }

  if (promptContext.shouldEmitSuggestions) {
    appendUsageEvent(buildSuggestionUsageEvent(matches.slice(0, 3), sessionId));
  }

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: promptContext.additionalContext,
      },
    }),
  );
}

function buildPromptContext({
  crossReviewContract,
  knowledgeAdvisory,
  matches,
  sessionId,
  cwd,
}) {
  const suggestedSkills = matches.slice(0, 3).map((match) => match.skill);
  const shouldEmitSuggestionsForPrompt =
    suggestedSkills.length > 0 &&
    shouldEmitSuggestions(sessionId, suggestedSkills, { host: 'claude', cwd });
  const shouldEmitKnowledgeForPrompt = Boolean(
    knowledgeAdvisory &&
      shouldEmitKnowledgeAdvisory(sessionId, knowledgeAdvisory.key, {
        host: 'claude',
        cwd,
      }),
  );
  const crossReviewMessage = crossReviewContract
    ? formatCrossReviewArmMessage(crossReviewContract)
    : null;
  const shouldEmitCrossReview = Boolean(crossReviewMessage);

  return {
    shouldEmit:
      shouldEmitCrossReview ||
      shouldEmitSuggestionsForPrompt ||
      shouldEmitKnowledgeForPrompt,
    shouldEmitSuggestions: shouldEmitSuggestionsForPrompt,
    additionalContext: [
      shouldEmitCrossReview ? crossReviewMessage : null,
      shouldEmitKnowledgeForPrompt ? knowledgeAdvisory.text : null,
      shouldEmitSuggestionsForPrompt ? formatSuggestions(matches, 3) : null,
    ]
      .filter(Boolean)
      .join('\n\n'),
  };
}

function formatCrossReviewArmMessage(contract) {
  if (contract.error) {
    return `Cross-review gate was requested but could not be armed: ${contract.error}`;
  }
  const modelText = contract.reviewerModel
    ? ` Model: ${contract.reviewerModel}.`
    : '';
  return `Cross-review gate armed for this session. Reviewer: ${contract.reviewer}. Plan: ${contract.planFile || 'not bound yet'}.${modelText}`;
}

function armCrossReviewIfRequested(input) {
  try {
    return armFromPrompt(input, { implementer: 'claude' });
  } catch (error) {
    return {
      reviewer: 'unknown',
      planFile: null,
      error: error && error.message ? error.message : String(error),
    };
  }
}

main().catch(() => {
  process.stdout.write('{}');
});
