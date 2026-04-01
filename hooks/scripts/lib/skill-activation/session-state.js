const {
  getPersistentDataPath,
  readFile,
  writeFile
} = require('../utils');

function normalizeSessionId(sessionId) {
  const raw = String(sessionId || process.env.CLAUDE_SESSION_ID || 'default').trim();
  return (raw.length > 0 ? raw : 'default').replace(/[^a-zA-Z0-9._-]/g, '-');
}

function resolveStateFile(sessionId) {
  const safeSessionId = normalizeSessionId(sessionId);
  return getPersistentDataPath('skill-activation', `session-${safeSessionId}.json`);
}

function readState(sessionId) {
  const filePath = resolveStateFile(sessionId);
  const raw = readFile(filePath);
  if (!raw) {
    return {
      sessionId: normalizeSessionId(sessionId),
      lastSuggestedSkills: [],
      lastBaselineVersion: null,
      filePath
    };
  }

  try {
    const parsed = JSON.parse(raw);
    const lastSuggestedSkills = Array.isArray(parsed.lastSuggestedSkills)
      ? parsed.lastSuggestedSkills.filter(item => typeof item === 'string')
      : [];
    const lastBaselineVersion = typeof parsed.lastBaselineVersion === 'string'
      ? parsed.lastBaselineVersion
      : null;

    return {
      sessionId: normalizeSessionId(parsed.sessionId || sessionId),
      lastSuggestedSkills,
      lastBaselineVersion,
      filePath
    };
  } catch {
    return {
      sessionId: normalizeSessionId(sessionId),
      lastSuggestedSkills: [],
      lastBaselineVersion: null,
      filePath
    };
  }
}

function sameSkillList(left, right) {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function persistState(state, updates) {
  writeFile(state.filePath, JSON.stringify({
    sessionId: state.sessionId,
    updatedAt: new Date().toISOString(),
    lastSuggestedSkills: Array.isArray(updates.lastSuggestedSkills)
      ? updates.lastSuggestedSkills
      : state.lastSuggestedSkills,
    lastBaselineVersion: Object.prototype.hasOwnProperty.call(updates, 'lastBaselineVersion')
      ? updates.lastBaselineVersion
      : state.lastBaselineVersion
  }, null, 2) + '\n');
}

function shouldEmitSuggestions(sessionId, skills) {
  const state = readState(sessionId);
  const normalizedSkills = [...skills].sort();

  if (sameSkillList(state.lastSuggestedSkills, normalizedSkills)) {
    return false;
  }

  persistState(state, {
    lastSuggestedSkills: normalizedSkills
  });

  return true;
}

function shouldEmitClaimVerificationBaseline(sessionId, baselineVersion) {
  const state = readState(sessionId);

  if (state.lastBaselineVersion === baselineVersion) {
    return false;
  }

  persistState(state, {
    lastBaselineVersion: baselineVersion
  });

  return true;
}

module.exports = {
  normalizeSessionId,
  shouldEmitClaimVerificationBaseline,
  shouldEmitSuggestions
};
