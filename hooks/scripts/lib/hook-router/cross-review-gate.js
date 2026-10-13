const os = require('os');
const path = require('path');
const { promptRequestsCrossReview } = require('./cross-review-request.cjs');
const { requireFirst } = require('./module-loader');

let core = null;
let coreLoadAttempted = false;

// Shared by Claude and Codex hooks (generated into codex/hooks). Arming a
// requested cross-review fails explicitly when no runtime core is installed.
function coreCandidates() {
  const home = os.homedir();
  return [
    process.env.GOLDBAND_ROOT
      ? path.join(process.env.GOLDBAND_ROOT, 'cross-review', 'core.cjs')
      : null,
    // Repository checkouts: codex/hooks and hooks/scripts/lib/hook-router.
    path.resolve(
      __dirname,
      '..',
      '..',
      'goldband-loop',
      'cross-review',
      'core.cjs',
    ),
    path.resolve(
      __dirname,
      '..',
      '..',
      '..',
      '..',
      'goldband-loop',
      'cross-review',
      'core.cjs',
    ),
    path.join(home, '.codex', 'skills', 'goldband', 'cross-review', 'core.cjs'),
    path.join(
      home,
      '.claude',
      'skills',
      'goldband',
      'cross-review',
      'core.cjs',
    ),
  ];
}

function loadCore() {
  if (coreLoadAttempted) return core;
  coreLoadAttempted = true;
  if (core) return core;
  try {
    core = requireFirst(coreCandidates());
  } catch (error) {
    if (error?.code !== 'GOLDBAND_RUNTIME_MODULE_MISSING') throw error;
    core = null;
  }
  return core;
}

function evaluateCrossReviewGate(input, options) {
  const loadedCore = loadCore();
  if (!loadedCore) {
    return {
      decision: 'allow',
      blockedBy: null,
      logs: [],
    };
  }
  return loadedCore.evaluateCrossReviewGate(input, options);
}

function armFromPrompt(input, options) {
  const loadedCore = loadCore();
  if (loadedCore) return loadedCore.armFromPrompt(input, options);
  if (promptRequestsCrossReview(input?.prompt)) {
    throw new Error(
      'Goldband cross-review runtime is not installed; rerun the Goldband workflow installer.',
    );
  }
  return null;
}

module.exports = {
  armFromPrompt,
  evaluateCrossReviewGate,
};
