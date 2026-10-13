import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fromRepo } from './repo.js';
import { jsonToolResult } from './types.js';

const require = createRequire(import.meta.url);
const { knowledgeHome, searchKnowledgeRows } = require(
  fromRepo('goldband-loop/lib/knowledge-search.cjs'),
) as {
  knowledgeHome: () => string;
  searchKnowledgeRows: (
    rows: KnowledgeIndexRow[],
    options: Record<string, unknown>,
  ) => KnowledgeIndexRow[];
};

export type KnowledgeQueryInput = {
  domain?: string;
  type?: string;
  keyword?: string;
  status?: 'active' | 'candidate' | 'graduated' | 'retired' | 'all';
  limit?: number;
  knowledgeHome?: string;
};

type KnowledgeIndexRow = {
  id?: string;
  title?: string;
  type?: string;
  domains?: string[];
  scope?: string;
  status?: string;
  confidence?: number;
  updated?: string;
  last_verified?: string | null;
  source_evidence?: string;
  trust_level?: string;
  reviewed_by?: string;
  staleness?: string;
  summary?: string;
  path?: string;
};

export function runKnowledgeQuery(input: KnowledgeQueryInput) {
  const indexPath = path.join(
    resolveKnowledgeHome(input),
    'knowledge',
    'index.json',
  );
  const rows = readRows(indexPath);
  const results = searchKnowledgeRows(rows, {
    domain: input.domain,
    type: input.type,
    status: input.status,
    query: input.keyword,
    limit: input.limit,
  }).map(resultFromRow);

  return jsonToolResult({
    indexPath,
    count: results.length,
    results,
  });
}

function resultFromRow(row: KnowledgeIndexRow) {
  return {
    id: text(row.id),
    path: text(row.path),
    summary: text(row.summary || row.title),
    type: text(row.type),
    domains: row.domains || [],
    status: text(row.status),
    confidence: row.confidence ?? null,
    updated: text(row.updated),
    last_verified: row.last_verified || null,
    source_evidence: text(row.source_evidence),
    trust_level: text(row.trust_level),
    reviewed_by: text(row.reviewed_by),
    staleness: text(row.staleness),
  };
}

function text(value: string | null | undefined): string {
  return value || '';
}

function resolveKnowledgeHome(input: KnowledgeQueryInput): string {
  return input.knowledgeHome || knowledgeHome();
}

function readRows(indexPath: string): KnowledgeIndexRow[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    return Array.isArray(parsed.entries) ? parsed.entries : [];
  } catch {
    return [];
  }
}
