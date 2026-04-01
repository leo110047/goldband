const CLAIM_VERIFICATION_BASELINE_VERSION = '1';

function formatClaimVerificationBaseline() {
  return [
    'Claim verification baseline:',
    '- Repository facts: verify with files, commands, tests, or logs before stating them as facts.',
    '- Current external facts: cite a source or clearly say they are unverified.',
    '- Completion claims: do not say work is done without fresh verification evidence from this turn.',
    '- Brainstorming is allowed, but label assumptions as hypotheses instead of confirmed facts.'
  ].join('\n');
}

module.exports = {
  CLAIM_VERIFICATION_BASELINE_VERSION,
  formatClaimVerificationBaseline
};
