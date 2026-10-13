// Recognizes an explicit /goldband-cross-review request. Owned here and
// generated into the Claude and Codex hook directories so a hook without the
// runtime core applies the same rule when it reports the missing install.

const CODE_FENCE_PATTERN = /```[\s\S]*?```/g;
const INLINE_CODE_PATTERN = /`[^`\n]*`/g;
const CROSS_REVIEW_COMMAND_PATTERN =
  /(?:^|\n)\s*\/goldband-cross-review(?:\s|$)/i;

function promptTextWithoutInlineCode(prompt) {
  return String(prompt || '')
    .replace(CODE_FENCE_PATTERN, ' ')
    .replace(INLINE_CODE_PATTERN, ' ');
}

/** Return the command match in code-stripped prompt text, or null. */
function matchCrossReviewCommand(prompt) {
  const text = promptTextWithoutInlineCode(prompt);
  const match = text.match(CROSS_REVIEW_COMMAND_PATTERN);
  return match ? { text, index: match.index, length: match[0].length } : null;
}

function promptRequestsCrossReview(prompt) {
  return matchCrossReviewCommand(prompt) !== null;
}

module.exports = {
  matchCrossReviewCommand,
  promptRequestsCrossReview,
};
