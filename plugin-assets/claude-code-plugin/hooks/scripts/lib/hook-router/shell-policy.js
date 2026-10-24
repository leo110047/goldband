const {
  shellCommands,
  commandWords,
  isShellCommand,
} = require('./shell-commands');

// These programs consume argv as data. Shell code and explicit child commands
// are inspected through the parser's execution edges, never by splitting data.
const DATA_COMMANDS = new Set([
  'echo',
  'printf',
  'rg',
  'grep',
  'egrep',
  'fgrep',
  'cat',
  'head',
  'tail',
  'less',
  'more',
  'sed',
  'awk',
  'python',
  'python3',
  'node',
  'nodejs',
  'ruby',
  'perl',
  'command',
  'git',
  'rm',
  'ssh',
]);
const MAX_CANDIDATE_WORDS = 100000;
const SHELL_ANALYSIS_FAILURE =
  'Unable to analyze this shell command safely. Simplify the command before retrying.';

// Indexes where an unknown launcher's argv names a command it may run.
// Unknown launchers do not need a wrapper entry to expose an argv signature.
// A quoted command-shaped string stays one word and cannot match a root name.
// `budget.remaining` bounds the argv words all candidates span.
function* argumentCommandIndexes(segment, words, isArgumentCommand, budget) {
  if (segment.children || isShellCommand(words) || DATA_COMMANDS.has(words[0]))
    return;
  for (let index = 1; index < words.length; index += 1) {
    if (!isArgumentCommand(words[index].split('/').pop())) continue;
    budget.remaining -= words.length - index;
    if (budget.remaining < 0)
      throw new Error('Shell analysis work limit exceeded');
    yield index;
  }
}

function* policyCandidates(segment, isArgumentCommand, budget) {
  const words = commandWords(segment.words);
  yield words;
  for (const index of argumentCommandIndexes(
    segment,
    words,
    isArgumentCommand,
    budget,
  )) {
    const candidate = words.slice(index);
    candidate[0] = candidate[0].split('/').pop();
    yield candidate;
  }
}

let lastParse = null;

// Every policy evaluating one tool call shares a single parse of its command.
// Callers read the returned commands and never modify them.
function parseShellCommand(command) {
  const text = String(command || '');
  if (lastParse?.text !== text) {
    try {
      lastParse = { text, commands: shellCommands(text) };
    } catch (error) {
      lastParse = { text, error };
    }
  }
  if (lastParse.error) throw lastParse.error;
  return lastParse.commands;
}

function inspectShellCommand(command, isArgumentCommand, inspect) {
  try {
    const budget = { remaining: MAX_CANDIDATE_WORDS };
    for (const segment of parseShellCommand(command)) {
      for (const words of policyCandidates(
        segment,
        isArgumentCommand,
        budget,
      )) {
        const risk = inspect(words, segment);
        if (risk) return { risk, failed: false };
      }
    }
    return { risk: null, failed: false };
  } catch {
    // Includes extraction, recursive input traversal, and policy evaluation.
    // Hook adapters must return their native denial protocol, not exit 1.
    return { risk: null, failed: true };
  }
}

module.exports = {
  MAX_CANDIDATE_WORDS,
  argumentCommandIndexes,
  inspectShellCommand,
  parseShellCommand,
  SHELL_ANALYSIS_FAILURE,
};
