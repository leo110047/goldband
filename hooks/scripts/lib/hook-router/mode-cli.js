const {
  activeModeNames,
  normalizeSessionId,
  loadModeState,
  setModeActiveStrict,
} = require('./mode-state');
const { appendUsageEvent } = require('./usage-telemetry');

function parseArgs(argv) {
  const options = {
    action: 'status',
    // Without --session, mode-state resolves the host's session.
    sessionId: undefined,
    json: false,
  };

  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === '--session') {
      const next = argv[index + 1];
      if (!next) {
        throw new Error('Missing value for --session');
      }
      options.sessionId = next;
      index += 1;
      continue;
    }

    if (token === '--json') {
      options.json = true;
      continue;
    }

    if (!token.startsWith('-') && options.action === 'status') {
      options.action = token;
      continue;
    }

    throw new Error(`Unknown argument: ${token}`);
  }

  return options;
}

function buildSummary(options) {
  const { action, modeName, displayName, sessionId, protections } = options;
  const state = loadModeState(sessionId);
  const activeModes = activeModeNames(state);
  const modeState =
    state.modes[modeName] && typeof state.modes[modeName] === 'object'
      ? state.modes[modeName]
      : null;

  return {
    action,
    modeName,
    displayName,
    sessionId: state.sessionId,
    active: Boolean(modeState && modeState.active),
    activeModes,
    storageSource: state.storageSource,
    stateFile: state.filePath,
    updatedAt: modeState
      ? modeState.updatedAt || state.updatedAt
      : state.updatedAt,
    protections: protections.map((item) => ({
      rule: item.rule,
      detail: item.detail,
    })),
  };
}

function printHuman(summary) {
  console.log(
    `${summary.displayName}: ${summary.active ? 'ENABLED' : 'DISABLED'}`,
  );
  console.log(`Session: ${summary.sessionId}`);
  console.log(`Storage: ${summary.storageSource}`);
  console.log(`State File: ${summary.stateFile}`);
  if (summary.updatedAt) {
    console.log(`Updated At: ${summary.updatedAt}`);
  }

  console.log('');
  console.log('Protections:');
  for (const protection of summary.protections) {
    console.log(`- ${protection.detail}`);
  }

  console.log('');
  console.log(
    `Usage: CLAUDE_PLUGIN_DATA=<plugin data dir> node scripts/${summary.modeName}.js <enable|disable|status> [--session <id>] [--json]`,
  );
}

function emitUsageEvent(options) {
  const { modeName, action, sessionId, source, protections } = options;
  if (action !== 'enable' && action !== 'disable') {
    return;
  }

  appendUsageEvent({
    category: 'mode',
    name: modeName,
    action,
    sessionId,
    source,
    detail: {
      protectionCount: protections.length,
    },
  });
}

function runModeCli(config) {
  const { argv, modeName, displayName, protections, source } = config;
  const options = parseArgs(argv);
  const sessionId = normalizeSessionId(options.sessionId);

  if (options.action === 'enable') {
    setModeActiveStrict(sessionId, modeName, true, { updatedBy: source });
  } else if (options.action === 'disable') {
    setModeActiveStrict(sessionId, modeName, false, { updatedBy: source });
  } else if (options.action !== 'status') {
    throw new Error(`Unknown action: ${options.action}`);
  }

  emitUsageEvent({
    modeName,
    action: options.action,
    sessionId,
    source,
    protections,
  });
  const summary = buildSummary({
    action: options.action,
    modeName,
    displayName,
    sessionId,
    protections,
  });

  if (options.json) {
    process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
    return;
  }

  printHuman(summary);
}

module.exports = {
  runModeCli,
};
