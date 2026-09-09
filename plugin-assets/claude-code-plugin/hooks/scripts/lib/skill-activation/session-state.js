const fs = require('fs');
const os = require('os');
const path = require('path');
const { createHash } = require('crypto');

// Advisory state only: never use this cache to suppress an approval or a gate.
function stateFile(sessionId, { host = 'claude', cwd = process.cwd() } = {}) {
  if (typeof sessionId !== 'string' || !sessionId.trim()) return null;
  const identity = JSON.stringify([host, sessionId, path.resolve(cwd)]);
  const key = createHash('sha256').update(identity).digest('hex');
  const root =
    process.env.CLAUDE_PLUGIN_DATA ||
    process.env.GOLDBAND_DATA_DIR ||
    path.join(
      process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'),
      'goldband',
    );
  return path.join(root, 'skill-activation', `session-${key}.json`);
}

function shouldEmit(sessionId, field, value, scope) {
  const file = stateFile(sessionId, scope);
  if (!file) return true;
  let state = {};
  try {
    if (fs.statSync(file).size <= 16384) {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
        state = parsed;
    }
  } catch {
    // Missing or invalid advisory state means emit the useful hint again.
  }
  if (JSON.stringify(state[field]) === JSON.stringify(value)) return false;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      JSON.stringify({
        lastSuggestedSkills: state.lastSuggestedSkills,
        lastKnowledgeAdvisoryKey: state.lastKnowledgeAdvisoryKey,
        [field]: value,
      }),
      { mode: 0o600 },
    );
  } catch {
    // Cache failure must not interrupt the task or change permission authority.
  }
  return true;
}

function shouldEmitSuggestions(sessionId, skills, scope) {
  return shouldEmit(
    sessionId,
    'lastSuggestedSkills',
    [...skills].sort(),
    scope,
  );
}

function shouldEmitKnowledgeAdvisory(sessionId, advisoryKey, scope) {
  const key = String(advisoryKey || '').trim();
  return (
    Boolean(key) &&
    shouldEmit(sessionId, 'lastKnowledgeAdvisoryKey', key, scope)
  );
}

module.exports = { shouldEmitKnowledgeAdvisory, shouldEmitSuggestions };
