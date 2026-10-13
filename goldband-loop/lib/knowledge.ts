import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from "fs";
import { createHash } from "crypto";
import { basename, dirname, join, resolve } from "path";
import { execFileSync } from "child_process";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { canonicalizeRemote } from "./remote-identity";

export const KNOWLEDGE_TYPES = [
  "problem-solution",
  "decision",
  "practice",
] as const;
export const KNOWLEDGE_DOMAINS = [
  "qa",
  "review",
  "security",
  "design",
  "planning",
  "docs",
  "ios",
  "browser",
  "general",
] as const;
export const KNOWLEDGE_STATUSES = [
  "candidate",
  "active",
  "graduated",
  "retired",
] as const;
export const KNOWLEDGE_SOURCES = [
  "manual",
  "telemetry-miner",
  "workflow-evidence",
  "hook-advisory",
] as const;
export const KNOWLEDGE_TRUST_LEVELS = [
  "user-stated",
  "verified",
  "observed",
  "inferred",
  "telemetry-derived",
] as const;
export const KNOWLEDGE_REVIEWERS = ["user", "workflow", "agent", ""] as const;
export const KNOWLEDGE_STALENESS = ["fresh", "needs-review", "stale"] as const;

export type KnowledgeType = (typeof KNOWLEDGE_TYPES)[number];
export type KnowledgeDomain = (typeof KNOWLEDGE_DOMAINS)[number];
export type KnowledgeStatus = (typeof KNOWLEDGE_STATUSES)[number];
export type KnowledgeSource = (typeof KNOWLEDGE_SOURCES)[number];
export type KnowledgeTrustLevel = (typeof KNOWLEDGE_TRUST_LEVELS)[number];
export type KnowledgeReviewer = (typeof KNOWLEDGE_REVIEWERS)[number];
export type KnowledgeStaleness = (typeof KNOWLEDGE_STALENESS)[number];
export type KnowledgeScope = "global" | "project";

export interface KnowledgeEntry {
  id: string;
  title: string;
  type: KnowledgeType;
  domains: KnowledgeDomain[];
  scope: KnowledgeScope;
  project_slug: string;
  canonical_remote: string;
  status: KnowledgeStatus;
  confidence: number;
  created: string;
  updated: string;
  source: KnowledgeSource;
  source_evidence: string;
  trust_level: KnowledgeTrustLevel;
  reviewed_by: KnowledgeReviewer;
  last_verified: string | null;
  staleness: KnowledgeStaleness;
  graduated_to: string;
  links: string[];
  summary: string;
  body: string;
}

export interface KnowledgeIndexRow {
  id: string;
  title: string;
  type: KnowledgeType;
  domains: KnowledgeDomain[];
  scope: KnowledgeScope;
  project_slug: string;
  canonical_remote: string;
  status: KnowledgeStatus;
  confidence: number;
  updated: string;
  last_verified: string | null;
  source_evidence: string;
  trust_level: KnowledgeTrustLevel;
  reviewed_by: KnowledgeReviewer;
  staleness: KnowledgeStaleness;
  summary: string;
  path: string;
}

export interface KnowledgeIndex {
  schema_version: 1;
  generated_at: string;
  entries: KnowledgeIndexRow[];
}

export interface KnowledgeSearchOptions {
  domain?: string;
  type?: string;
  scope?: KnowledgeScope | "all";
  status?: KnowledgeStatus | "all";
  query?: string;
  projectSlug?: string;
  limit?: number;
  includeRetired?: boolean;
}

const ID_RE = /^[a-z0-9][a-z0-9-]{1,80}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const require = createRequire(import.meta.url);
// Generated from hooks/scripts/lib/hook-router/secret-patterns.js by
// scripts/sync-plugin-assets.mjs so linked and copied runtimes carry the rules.
const { detectSecrets } = require("./secret-patterns.cjs") as {
  detectSecrets: (value: string) => Array<{ name: string }>;
};
const { knowledgeHome, searchKnowledgeRows } = require("./knowledge-search.cjs") as {
  knowledgeHome: () => string;
  searchKnowledgeRows: (
    rows: KnowledgeIndexRow[],
    options: KnowledgeSearchOptions,
  ) => KnowledgeIndexRow[];
};

export function knowledgeRoot(home = knowledgeHome()): string {
  return join(home, "knowledge");
}

export function entriesDir(root = knowledgeRoot()): string {
  return join(root, "entries");
}

function indexPath(root = knowledgeRoot()): string {
  return join(root, "index.json");
}

export function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export function deterministicCandidateId(input: {
  sourceType: string;
  sourcePointer: string;
  summary: string;
  date?: string;
}): string {
  const sourceType = slugPart(input.sourceType || "candidate");
  const date = (input.date || todayIsoDate()).replaceAll("-", "");
  const normalized = [
    sourceType,
    normalizePointer(input.sourcePointer),
    normalizeSummary(input.summary),
  ].join("\n");
  const hash = createHash("sha256").update(normalized).digest("hex").slice(0, 8);
  return `${sourceType}-${date}-${hash}`;
}

export function currentProjectSlug(cwd = process.cwd()): string {
  const script = join(dirname(fileURLToPath(import.meta.url)), "..", "bin", "goldband-slug");
  try {
    const out = execFileSync(script, [], {
      cwd,
      env: process.env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const match = out.match(/^SLUG=(.+)$/m);
    if (match) return match[1].trim();
  } catch {
    // Fall through to the same no-remote basename behavior goldband-slug uses.
  }
  return basename(resolve(cwd)).replace(/[^a-zA-Z0-9._-]/g, "") || "unknown";
}

export function currentCanonicalRemote(cwd = process.cwd()): string {
  try {
    const remote = execFileSync("git", ["config", "--get", "remote.origin.url"], {
      cwd,
      env: process.env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return canonicalizeRemote(remote);
  } catch {
    return "";
  }
}

function ensureKnowledgeDirs(root = knowledgeRoot()): void {
  mkdirSync(entriesDir(root), { recursive: true });
}

export function entryPath(id: string, root = knowledgeRoot()): string {
  return join(entriesDir(root), `${id}.md`);
}

export function parseKnowledgeFile(filePath: string): KnowledgeEntry {
  const raw = readFileSync(filePath, "utf8");
  const { frontmatter, body } = splitFrontmatter(raw, filePath);
  const entry = frontmatterToEntry(frontmatter, body.trim());
  validateEntry(entry);
  return entry;
}

export function writeKnowledgeEntry(entry: KnowledgeEntry, root = knowledgeRoot()): string {
  validateEntry(entry);
  ensureKnowledgeDirs(root);
  const filePath = entryPath(entry.id, root);
  const tmpPath = `${filePath}.tmp-${process.pid}`;
  writeFileSync(tmpPath, renderKnowledgeEntry(entry), "utf8");
  renameSync(tmpPath, filePath);
  rebuildIndex(root);
  return filePath;
}

export function writeKnowledgeCandidate(
  entry: KnowledgeEntry,
  root = knowledgeRoot(),
): { filePath: string; skipped: boolean } {
  if (entry.status !== "candidate") {
    throw new Error("candidate capture must write status=candidate");
  }
  ensureKnowledgeDirs(root);
  const filePath = entryPath(entry.id, root);
  if (existsSync(filePath)) {
    rebuildIndex(root);
    return { filePath, skipped: true };
  }
  writeKnowledgeEntry(entry, root);
  return { filePath, skipped: false };
}

function readIndex(root = knowledgeRoot()): KnowledgeIndex {
  const file = indexPath(root);
  if (!existsSync(file)) {
    return rebuildIndex(root);
  }
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    if (parsed?.schema_version === 1 && Array.isArray(parsed.entries)) {
      return parsed as KnowledgeIndex;
    }
  } catch {
    // Corrupt index is recoverable because entries are authoritative.
  }
  return rebuildIndex(root);
}

export function rebuildIndex(root = knowledgeRoot()): KnowledgeIndex {
  ensureKnowledgeDirs(root);
  const rows: KnowledgeIndexRow[] = [];
  for (const file of readdirSync(entriesDir(root)).filter((name) => name.endsWith(".md")).sort()) {
    const filePath = join(entriesDir(root), file);
    try {
      rows.push(indexRowFromEntry(parseKnowledgeFile(filePath), filePath));
    } catch {
      // Invalid entries stay on disk but are omitted from recall until fixed.
    }
  }
  const index: KnowledgeIndex = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    entries: rows.sort((a, b) => b.updated.localeCompare(a.updated) || a.id.localeCompare(b.id)),
  };
  writeJsonAtomic(indexPath(root), index);
  return index;
}

export function searchKnowledge(
  options: KnowledgeSearchOptions = {},
  root = knowledgeRoot(),
): KnowledgeIndexRow[] {
  return searchKnowledgeRows(readIndex(root).entries, options);
}

export function transitionKnowledgeStatus(
  id: string,
  status: KnowledgeStatus,
  updates: Partial<KnowledgeEntry> = {},
  root = knowledgeRoot(),
): KnowledgeEntry {
  const file = entryPath(id, root);
  if (!existsSync(file)) throw new Error(`knowledge entry not found: ${id}`);
  const entry = parseKnowledgeFile(file);
  const next: KnowledgeEntry = {
    ...entry,
    ...updates,
    status,
    updated: todayIsoDate(),
  };
  if (status === "active") {
    next.last_verified = updates.last_verified ?? todayIsoDate();
    next.staleness = "fresh";
  }
  if (status === "graduated" && !next.graduated_to) {
    throw new Error("graduate requires --to <skill-or-rule-path>");
  }
  writeKnowledgeEntry(next, root);
  return next;
}

export function createKnowledgeEntry(input: Partial<KnowledgeEntry>): KnowledgeEntry {
  const today = todayIsoDate();
  const entry: KnowledgeEntry = {
    id: input.id || "",
    title: input.title || "",
    type: input.type || "practice",
    domains: input.domains || ["general"],
    scope: input.scope || "global",
    project_slug: input.project_slug || "",
    canonical_remote: input.canonical_remote || "",
    status: input.status || "active",
    confidence: input.confidence ?? 5,
    created: input.created || today,
    updated: input.updated || today,
    source: input.source || "manual",
    source_evidence: input.source_evidence || "",
    trust_level: input.trust_level || defaultTrustLevel(input.source || "manual"),
    reviewed_by: input.reviewed_by || "",
    last_verified:
      input.last_verified === undefined ? null : input.last_verified,
    staleness: input.staleness || "fresh",
    graduated_to: input.graduated_to || "",
    links: input.links || [],
    summary: input.summary || "",
    body: input.body || "",
  };
  validateEntry(entry);
  return entry;
}

function validateEntry(entry: KnowledgeEntry): void {
  if (!ID_RE.test(entry.id)) {
    throw new Error("id must be a short kebab slug: lowercase letters, numbers, hyphens");
  }
  if (!entry.title.trim()) throw new Error("title is required");
  if (!KNOWLEDGE_TYPES.includes(entry.type)) throw new Error(`invalid type: ${entry.type}`);
  if (!Array.isArray(entry.domains) || entry.domains.length === 0) {
    throw new Error("domains must include at least one domain");
  }
  for (const domain of entry.domains) {
    if (!KNOWLEDGE_DOMAINS.includes(domain)) throw new Error(`invalid domain: ${domain}`);
  }
  if (entry.scope !== "global" && entry.scope !== "project") {
    throw new Error("scope must be global or project");
  }
  if (entry.scope === "project" && !entry.project_slug) {
    throw new Error("project_slug is required when scope=project");
  }
  if (!KNOWLEDGE_STATUSES.includes(entry.status)) {
    throw new Error(`invalid status: ${entry.status}`);
  }
  if (!Number.isInteger(entry.confidence) || entry.confidence < 1 || entry.confidence > 10) {
    throw new Error("confidence must be an integer from 1 to 10");
  }
  if (!DATE_RE.test(entry.created) || !DATE_RE.test(entry.updated)) {
    throw new Error("created and updated must be YYYY-MM-DD");
  }
  if (entry.last_verified !== null && !DATE_RE.test(entry.last_verified)) {
    throw new Error("last_verified must be YYYY-MM-DD or null");
  }
  if (!KNOWLEDGE_SOURCES.includes(entry.source)) {
    throw new Error(`invalid source: ${entry.source}`);
  }
  if (!KNOWLEDGE_TRUST_LEVELS.includes(entry.trust_level)) {
    throw new Error(`invalid trust_level: ${entry.trust_level}`);
  }
  if (!KNOWLEDGE_REVIEWERS.includes(entry.reviewed_by)) {
    throw new Error(`invalid reviewed_by: ${entry.reviewed_by}`);
  }
  if (!KNOWLEDGE_STALENESS.includes(entry.staleness)) {
    throw new Error(`invalid staleness: ${entry.staleness}`);
  }
  validateFrontmatterRoundTrip(entry);
  if (entry.status === "graduated" && !entry.graduated_to) {
    throw new Error("graduated entries require graduated_to");
  }
  if (!entry.summary.trim()) throw new Error("summary is required");
  if (!entry.body.trim()) throw new Error("body is required");
  validateSafeKnowledgeText("summary", entry.summary);
  validateSafeKnowledgeText("body", entry.body);
  validateBodyShape(entry);
}

export function renderSearchRows(rows: KnowledgeIndexRow[]): string {
  if (rows.length === 0) return "";
  const lines = [`KNOWLEDGE: ${rows.length} related entries`];
  for (const row of rows) {
    const freshness = row.last_verified || row.updated;
    lines.push(
      `- ${row.path} :: [${row.id}] ${row.summary} ` +
        `(confidence ${row.confidence}/10, updated ${row.updated}, ` +
        `last_verified ${freshness || "unknown"}, staleness ${row.staleness})`,
    );
  }
  return `${lines.join("\n")}\n`;
}

function splitFrontmatter(raw: string, filePath: string): { frontmatter: string; body: string } {
  if (!raw.startsWith("---\n")) throw new Error(`missing frontmatter: ${filePath}`);
  const end = raw.indexOf("\n---\n", 4);
  if (end === -1) throw new Error(`unterminated frontmatter: ${filePath}`);
  return {
    frontmatter: raw.slice(4, end),
    body: raw.slice(end + 5),
  };
}

function frontmatterToEntry(frontmatter: string, body: string): KnowledgeEntry {
  const data = parseSimpleFrontmatter(frontmatter);
  return {
    id: stringField(data, "id"),
    title: stringField(data, "title"),
    type: stringField(data, "type") as KnowledgeType,
    domains: arrayField(data, "domains") as KnowledgeDomain[],
    scope: stringField(data, "scope") as KnowledgeScope,
    project_slug: stringField(data, "project_slug"),
    canonical_remote: stringField(data, "canonical_remote"),
    status: stringField(data, "status") as KnowledgeStatus,
    confidence: Number(data.confidence),
    created: stringField(data, "created"),
    updated: stringField(data, "updated"),
    source: stringField(data, "source") as KnowledgeSource,
    source_evidence: stringField(data, "source_evidence"),
    trust_level: trustField(data),
    reviewed_by: reviewerField(data),
    last_verified: data.last_verified === null ? null : stringField(data, "last_verified"),
    staleness: stalenessField(data),
    graduated_to: stringField(data, "graduated_to"),
    links: arrayField(data, "links"),
    summary: stringField(data, "summary"),
    body,
  };
}

function parseSimpleFrontmatter(frontmatter: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const line of frontmatter.split("\n")) {
    const match = line.match(/^([a-z_]+):\s*(.*)$/);
    if (!match) continue;
    const key = match[1];
    const raw = match[2].trim();
    if (raw === "null") out[key] = null;
    else if (/^\d+$/.test(raw)) out[key] = Number(raw);
    else if (raw.startsWith("[") && raw.endsWith("]")) out[key] = parseInlineArray(raw);
    else out[key] = unquote(raw);
  }
  return out;
}

function parseInlineArray(raw: string): string[] {
  const inner = raw.slice(1, -1).trim();
  if (!inner) return [];
  return inner.split(",").map((item) => unquote(item.trim())).filter(Boolean);
}

function unquote(raw: string): string {
  if (
    (raw.startsWith('"') && raw.endsWith('"')) ||
    (raw.startsWith("'") && raw.endsWith("'"))
  ) {
    return raw.slice(1, -1);
  }
  return raw;
}

function stringField(data: Record<string, unknown>, key: string): string {
  const value = data[key];
  return typeof value === "string" ? value : "";
}

function arrayField(data: Record<string, unknown>, key: string): string[] {
  return Array.isArray(data[key]) ? (data[key] as unknown[]).map(String) : [];
}

function renderKnowledgeEntry(entry: KnowledgeEntry): string {
  const frontmatter = [
    "---",
    `id: ${entry.id}`,
    `title: ${yamlString(entry.title)}`,
    `type: ${entry.type}`,
    `domains: [${entry.domains.join(", ")}]`,
    `scope: ${entry.scope}`,
    `project_slug: ${entry.project_slug}`,
    `canonical_remote: ${entry.canonical_remote}`,
    `status: ${entry.status}`,
    `confidence: ${entry.confidence}`,
    `created: ${entry.created}`,
    `updated: ${entry.updated}`,
    `source: ${entry.source}`,
    `source_evidence: ${yamlString(entry.source_evidence)}`,
    `trust_level: ${entry.trust_level}`,
    `reviewed_by: ${entry.reviewed_by}`,
    `last_verified: ${entry.last_verified === null ? "null" : entry.last_verified}`,
    `staleness: ${entry.staleness}`,
    `graduated_to: ${entry.graduated_to}`,
    `links: [${entry.links.join(", ")}]`,
    `summary: ${yamlString(entry.summary)}`,
    "---",
    "",
  ].join("\n");
  return `${frontmatter}${entry.body.trim()}\n`;
}

function yamlString(value: string): string {
  if (/^[a-zA-Z0-9._/ -]*$/.test(value) && value.trim() === value) return value;
  return JSON.stringify(value);
}

function indexRowFromEntry(entry: KnowledgeEntry, filePath: string): KnowledgeIndexRow {
  const staleness = effectiveStaleness(entry);
  return {
    id: entry.id,
    title: entry.title,
    type: entry.type,
    domains: entry.domains,
    scope: entry.scope,
    project_slug: entry.project_slug,
    canonical_remote: entry.canonical_remote,
    status: entry.status,
    confidence: entry.confidence,
    updated: entry.updated,
    last_verified: entry.last_verified,
    source_evidence: entry.source_evidence,
    trust_level: entry.trust_level,
    reviewed_by: entry.reviewed_by,
    staleness,
    summary: entry.summary,
    path: filePath,
  };
}

function validateBodyShape(entry: KnowledgeEntry): void {
  const required: Record<KnowledgeType, string[]> = {
    "problem-solution": ["情境", "症狀", "根因", "解法", "驗證方式"],
    decision: ["決定", "理由", "捨棄的替代方案"],
    practice: ["做法", "適用情境", "驗證證據"],
  };
  const missing = required[entry.type].filter((heading) => !entry.body.includes(heading));
  if (missing.length > 0) {
    throw new Error(`${entry.type} body missing required sections: ${missing.join(", ")}`);
  }
}

function validateFrontmatterRoundTrip(entry: KnowledgeEntry): void {
  const fields: [string, string][] = [
    ["title", entry.title],
    ["project_slug", entry.project_slug],
    ["canonical_remote", entry.canonical_remote],
    ["source_evidence", entry.source_evidence],
    ["graduated_to", entry.graduated_to],
    ["summary", entry.summary],
    ...entry.links.map((link, index) => [`links[${index}]`, link] as [string, string]),
  ];
  for (const [field, value] of fields) {
    if (/["\\\n\r]/.test(value)) {
      throw new Error(`${field} contains unsupported frontmatter characters: double quote, backslash, or newline`);
    }
  }
}

function trustField(data: Record<string, unknown>): KnowledgeTrustLevel {
  const explicit = stringField(data, "trust_level");
  if (explicit) return explicit as KnowledgeTrustLevel;
  return defaultTrustLevel(stringField(data, "source") as KnowledgeSource);
}

function reviewerField(data: Record<string, unknown>): KnowledgeReviewer {
  return stringField(data, "reviewed_by") as KnowledgeReviewer;
}

function stalenessField(data: Record<string, unknown>): KnowledgeStaleness {
  return (stringField(data, "staleness") || "fresh") as KnowledgeStaleness;
}

function defaultTrustLevel(source: KnowledgeSource): KnowledgeTrustLevel {
  if (source === "telemetry-miner") return "telemetry-derived";
  if (source === "workflow-evidence") return "verified";
  if (source === "hook-advisory") return "observed";
  return "user-stated";
}

function effectiveStaleness(entry: KnowledgeEntry): KnowledgeStaleness {
  if (entry.status === "candidate") return "needs-review";
  if (entry.staleness === "stale") return "stale";
  if (entry.source_evidence && sourceEvidencePathMissing(entry.source_evidence)) {
    return "needs-review";
  }
  if (entry.last_verified && daysSince(entry.last_verified) > 180) return "needs-review";
  return entry.staleness || "fresh";
}

function sourceEvidencePathMissing(sourceEvidence: string): boolean {
  if (!sourceEvidence) return false;
  if (/^[a-z]+:/i.test(sourceEvidence)) return false;
  if (/^[a-z0-9_.-]+$/i.test(sourceEvidence)) return false;
  const candidates = [
    sourceEvidence,
    resolve(process.cwd(), sourceEvidence),
  ];
  return candidates.every((candidate) => !existsSync(candidate));
}

function daysSince(date: string): number {
  const parsed = Date.parse(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(parsed)) return 0;
  return Math.floor((Date.now() - parsed) / 86_400_000);
}

export function candidateAgeDays(entry: KnowledgeEntry, filePath = entryPath(entry.id)): number {
  const date = entry.last_verified || entry.created || entry.updated;
  if (DATE_RE.test(date)) return daysSince(date);
  try {
    return Math.floor((Date.now() - statSync(filePath).mtimeMs) / 86_400_000);
  } catch {
    return 0;
  }
}

function validateSafeKnowledgeText(field: string, value: string): void {
  const secretFindings = detectSecretLikeContent(value);
  if (secretFindings.length > 0) {
    throw new Error(
      `${field} contains secret-shaped content: ${secretFindings.join(", ")}`,
    );
  }

  const patterns = [
    /ignore\s+(all\s+)?previous\s+(instructions|context|rules)/i,
    /you\s+are\s+now\s+/i,
    /always\s+output\s+no\s+findings/i,
    /skip\s+(all\s+)?(security|review|checks)/i,
    /override[:\s]/i,
    /\bsystem\s*:/i,
    /\bassistant\s*:/i,
    /\buser\s*:/i,
    /do\s+not\s+(report|flag|mention)/i,
    /approve\s+(all|every|this)/i,
  ];
  for (const pattern of patterns) {
    if (pattern.test(value)) {
      throw new Error(`${field} contains suspicious instruction-like content`);
    }
  }
}

function detectSecretLikeContent(value: string): string[] {
  return detectSecrets(value).map((finding) => finding.name);
}

function slugPart(value: string): string {
  return String(value || "candidate")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 32) || "candidate";
}

function normalizePointer(value: string): string {
  return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function normalizeSummary(value: string): string {
  return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function writeJsonAtomic(filePath: string, payload: unknown): void {
  const tmpPath = `${filePath}.tmp-${process.pid}`;
  writeFileSync(tmpPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  renameSync(tmpPath, filePath);
}
