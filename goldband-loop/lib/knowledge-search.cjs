// Knowledge recall semantics shared by goldband-knowledge (lib/knowledge.ts)
// and the MCP knowledge-query tool. Plain CommonJS so both Bun and Node load it.
const os = require('node:os');
const path = require('node:path');

function knowledgeHome(env = process.env) {
  return env.GOLDBAND_HOME || path.join(os.homedir(), '.goldband');
}

function tokenize(query) {
  return String(query || '')
    .toLowerCase()
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function matchesFilters(row, options) {
  const status = options.status || 'active';
  const scope = options.scope || 'all';
  if (!options.includeRetired && row.status === 'retired' && status !== 'retired') {
    return false;
  }
  if (status !== 'all' && row.status !== status) return false;
  if (options.type && row.type !== options.type) return false;
  if (options.domain && !(row.domains || []).includes(options.domain)) return false;
  if (scope !== 'all' && row.scope !== scope) return false;
  if (
    options.projectSlug &&
    row.scope === 'project' &&
    row.project_slug !== options.projectSlug
  ) {
    return false;
  }
  return true;
}

function matchesQuery(row, tokens) {
  if (tokens.length === 0) return true;
  const haystack = [
    row.id,
    row.title,
    row.summary,
    row.type,
    row.scope,
    row.project_slug,
    row.canonical_remote,
    ...(row.domains || []),
  ]
    .join(' ')
    .toLowerCase();
  return tokens.some((token) => haystack.includes(token));
}

function freshness(row) {
  return row.last_verified || row.updated || '';
}

/** Filter and rank index rows: active by default, then confidence and freshness. */
function searchKnowledgeRows(rows, options = {}) {
  const tokens = tokenize(options.query);
  const limit = Math.max(1, Math.min(options.limit || 10, 50));
  return rows
    .filter((row) => matchesFilters(row, options) && matchesQuery(row, tokens))
    .sort((a, b) => {
      const confidenceDelta = (b.confidence || 0) - (a.confidence || 0);
      if (confidenceDelta !== 0) return confidenceDelta;
      return freshness(b).localeCompare(freshness(a));
    })
    .slice(0, limit);
}

module.exports = { knowledgeHome, searchKnowledgeRows };
