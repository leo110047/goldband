#!/usr/bin/env node

const { readStdinJson } = require('../lib/utils');
const {
  appendUsageEvent,
  claudeUsageContext,
} = require('../lib/hook-router/usage-telemetry');
const { armFromPrompt } = require('../lib/hook-router/cross-review-gate');
const {
  buildWorkflowUsageEvents,
} = require('../lib/hook-router/workflow-telemetry');
const {
  buildKnowledgeAdvisory,
} = require('../lib/skill-activation/knowledge-advisory');
const {
  shouldEmitKnowledgeAdvisory,
} = require('../lib/skill-activation/session-state');

async function main() {
  const input = await readStdinJson();
  const prompt = String(input.prompt || '');
  const sessionId = input.session_id || process.env.CLAUDE_SESSION_ID || null;
  const crossReviewContract = armCrossReviewIfRequested(input);
  const knowledgeAdvisory = buildKnowledgeAdvisory(prompt);

  for (const event of buildWorkflowUsageEvents(
    input,
    claudeUsageContext(
      input,
      'hooks/scripts/hooks/skill-activation-suggestions.js',
    ),
  )) {
    appendUsageEvent(event);
  }

  const promptContext = buildPromptContext({
    crossReviewContract,
    knowledgeAdvisory,
    sessionId,
    cwd: input.cwd || process.cwd(),
  });

  if (!promptContext.shouldEmit) {
    process.stdout.write('{}');
    return;
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
  sessionId,
  cwd,
}) {
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
    shouldEmit: shouldEmitCrossReview || shouldEmitKnowledgeForPrompt,
    additionalContext: [
      shouldEmitCrossReview ? crossReviewMessage : null,
      shouldEmitKnowledgeForPrompt ? knowledgeAdvisory.text : null,
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
