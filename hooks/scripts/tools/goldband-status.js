#!/usr/bin/env node

// Reports the session state the hooks enforce, through the same owners the
// hooks read: mode-state for careful and freeze mode, and the cross-review
// gate's runtime loader. Each source is reported separately so one failing
// source never reads as "inactive".

const { loadModeState } = require('../lib/hook-router/mode-state');
const {
  isCrossReviewGateActive,
} = require('../lib/hook-router/cross-review-gate');

const MODES = ['careful-mode', 'freeze-mode'];

function parseSessionId(argv) {
  const index = argv.indexOf('--session');
  const sessionId = index === -1 ? '' : argv[index + 1];
  if (!sessionId) {
    throw new Error('Usage: goldband-status.js --session <id>');
  }
  return sessionId;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function modeSources(sessionId) {
  try {
    const state = loadModeState(sessionId);
    return MODES.map((name) => ({
      name,
      available: true,
      active: Boolean(state.modes[name] && state.modes[name].active),
    }));
  } catch (error) {
    const reason = errorMessage(error);
    return MODES.map((name) => ({ name, available: false, reason }));
  }
}

function crossReviewSource(sessionId) {
  try {
    return {
      name: 'cross-review',
      available: true,
      active: isCrossReviewGateActive(sessionId),
    };
  } catch (error) {
    return {
      name: 'cross-review',
      available: false,
      reason: errorMessage(error),
    };
  }
}

function main() {
  const sessionId = parseSessionId(process.argv);
  const sources = [...modeSources(sessionId), crossReviewSource(sessionId)];
  process.stdout.write(`${JSON.stringify({ sessionId, sources })}\n`);
}

try {
  main();
} catch (error) {
  console.error(`[goldband-status] ${errorMessage(error)}`);
  process.exit(1);
}
