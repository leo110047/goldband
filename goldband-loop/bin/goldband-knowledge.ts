#!/usr/bin/env bun
import { existsSync, readFileSync, readdirSync } from "fs";
import {
  candidateAgeDays,
  createKnowledgeEntry,
  currentCanonicalRemote,
  currentProjectSlug,
  defaultTrustLevel,
  deterministicCandidateId,
  entryPath,
  KNOWLEDGE_DOMAINS,
  KNOWLEDGE_REVIEWERS,
  KNOWLEDGE_SOURCES,
  KNOWLEDGE_STATUSES,
  KNOWLEDGE_STALENESS,
  KNOWLEDGE_TRUST_LEVELS,
  KNOWLEDGE_TYPES,
  entriesDir,
  knowledgeRoot,
  parseKnowledgeFile,
  rebuildIndex,
  renderSearchRows,
  searchKnowledge,
  todayIsoDate,
  transitionKnowledgeStatus,
  writeKnowledgeCandidate,
  writeKnowledgeEntry,
  type KnowledgeDomain,
  type KnowledgeReviewer,
  type KnowledgeScope,
  type KnowledgeSource,
  type KnowledgeStatus,
  type KnowledgeStaleness,
  type KnowledgeTrustLevel,
  type KnowledgeType,
} from "../lib/knowledge";

type Args = Record<string, string | boolean>;

// Retro entries are written only by the session-retro-evidence owner, which
// binds them to a reported snapshot.
const CLI_SOURCES = KNOWLEDGE_SOURCES.filter((source) => source !== "retro");

function parseArgs(tokens: string[]): { command: string; args: Args } {
  const [command = "help", ...rest] = tokens;
  const args: Args = {};
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = rest[index + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      index += 1;
    }
  }
  return { command, args };
}

function usage(): string {
  return `Usage: goldband-knowledge <add|capture|capture-candidate|search|graduate|retire|validate|reindex|review> [options]

Commands:
  add/capture   Create one curated knowledge entry and update index.json.
  capture-candidate
                Create a deterministic status=candidate entry; duplicate ids are skipped.
  search        Print path + one-line summary for matching entries.
  graduate      Mark an entry graduated; requires --id and --to.
  retire        Mark an entry retired; requires --id.
  validate      Validate one entry with --id or all entries.
  reindex       Rebuild knowledge/index.json from entry files.
  review        Review workflow helper: list|show|promote|edit|retire|graduate.

Add options:
  --id <slug> --title <title> --type <problem-solution|decision|practice>
  --domains <qa,review,...> --summary <line> --body-file <path>
  --scope <global|project> --confidence <1-10> --source <manual|telemetry-miner|workflow-evidence|hook-advisory>
  --status <candidate|active|graduated|retired> --project-slug <slug>
  --source-evidence <sanitized pointer> --trust-level <level> --reviewed-by <user|workflow|agent>

Candidate options:
  --source-type <manual|workflow-evidence|telemetry-miner|hook-advisory>
  --source-evidence <sanitized pointer> --summary <line> --body-file <path>
  --dry-run

Search options:
  --domain <domain> --type <type> --scope <global|project|all>
  --status <status|all> --query <keywords> --limit <n> --project-slug <slug>

Knowledge root: \${GOLDBAND_HOME:-$HOME/.goldband}/knowledge
`;
}

function main(): void {
  const argv = process.argv.slice(2);
  const { command, args } = parseArgs(argv);
  if (command === "help" || command === "--help" || command === "-h") {
    process.stdout.write(usage());
    return;
  }
  if (command === "add" || command === "capture") return runAdd(args);
  if (command === "capture-candidate") return runCaptureCandidate(args);
  if (command === "search") return runSearch(args);
  if (command === "graduate") return runGraduate(args);
  if (command === "retire") return runRetire(args);
  if (command === "validate") return runValidate(args);
  if (command === "reindex") return runReindex();
  if (command === "review") return runReview(process.argv.slice(3));
  throw new Error(`Unknown command: ${command}`);
}

function runAdd(args: Args): void {
  const scope = enumArg(args, "scope", ["global", "project"], "global") as KnowledgeScope;
  const projectSlug =
    stringArg(args, "project-slug", "") ||
    (scope === "project" ? currentProjectSlug() : "");
  const body = readBody(args);
  const entry = createKnowledgeEntry({
    id: requiredString(args, "id"),
    title: requiredString(args, "title"),
    type: enumArg(args, "type", KNOWLEDGE_TYPES, undefined) as KnowledgeType,
    domains: listArg(args, "domains", KNOWLEDGE_DOMAINS) as KnowledgeDomain[],
    scope,
    project_slug: projectSlug,
    canonical_remote: stringArg(args, "canonical-remote", "") || currentCanonicalRemote(),
    status: enumArg(args, "status", KNOWLEDGE_STATUSES, "active") as KnowledgeStatus,
    confidence: intArg(args, "confidence", 5),
    created: stringArg(args, "created", todayIsoDate()),
    updated: stringArg(args, "updated", todayIsoDate()),
    source: enumArg(args, "source", CLI_SOURCES, "manual") as KnowledgeSource,
    source_evidence: stringArg(args, "source-evidence", ""),
    trust_level: enumArg(
      args,
      "trust-level",
      KNOWLEDGE_TRUST_LEVELS,
      defaultTrustLevel(stringArg(args, "source", "manual") as KnowledgeSource),
    ) as KnowledgeTrustLevel,
    reviewed_by: enumArg(args, "reviewed-by", KNOWLEDGE_REVIEWERS, "") as KnowledgeReviewer,
    last_verified: nullableDateArg(args, "last-verified"),
    staleness: enumArg(args, "staleness", KNOWLEDGE_STALENESS, "fresh") as KnowledgeStaleness,
    graduated_to: stringArg(args, "graduated-to", ""),
    links: commaList(stringArg(args, "links", "")),
    summary: requiredString(args, "summary"),
    body,
  });
  const filePath = writeKnowledgeEntry(entry);
  process.stdout.write(`WROTE ${filePath}\n`);
}

function runCaptureCandidate(args: Args): void {
  const sourceType = enumArg(
    args,
    "source-type",
    CLI_SOURCES,
    undefined,
  ) as KnowledgeSource;
  const summary = requiredString(args, "summary");
  const sourceEvidence = requiredString(args, "source-evidence");
  const id = deterministicCandidateId({
    sourceType,
    sourcePointer: sourceEvidence,
    summary,
    date: stringArg(args, "created", todayIsoDate()),
  });
  const entry = createKnowledgeEntry({
    id,
    title: stringArg(args, "title", "") || `Candidate: ${summary.slice(0, 72)}`,
    type: enumArg(args, "type", KNOWLEDGE_TYPES, "practice") as KnowledgeType,
    domains: listArg(args, "domains", KNOWLEDGE_DOMAINS) as KnowledgeDomain[],
    scope: enumArg(args, "scope", ["global", "project"], "global") as KnowledgeScope,
    project_slug: stringArg(args, "project-slug", ""),
    canonical_remote: stringArg(args, "canonical-remote", "") || currentCanonicalRemote(),
    status: "candidate",
    confidence: intArg(args, "confidence", 4),
    created: stringArg(args, "created", todayIsoDate()),
    updated: stringArg(args, "updated", todayIsoDate()),
    source: sourceType,
    source_evidence: sourceEvidence,
    trust_level: enumArg(
      args,
      "trust-level",
      KNOWLEDGE_TRUST_LEVELS,
      defaultTrustLevel(sourceType),
    ) as KnowledgeTrustLevel,
    reviewed_by: "",
    last_verified: null,
    staleness: "needs-review",
    graduated_to: "",
    links: commaList(stringArg(args, "links", "")),
    summary,
    body: readBody(args),
  });
  if (args["dry-run"]) {
    process.stdout.write(`DRY_RUN ${entryPath(entry.id)}\n`);
    return;
  }
  const result = writeKnowledgeCandidate(entry);
  process.stdout.write(`${result.skipped ? "SKIPPED duplicate" : "WROTE"} ${result.filePath}\n`);
}

function runSearch(args: Args): void {
  const projectSlug = stringArg(args, "project-slug", "") || currentProjectSlug();
  const rows = searchKnowledge({
    domain: stringArg(args, "domain", ""),
    type: stringArg(args, "type", ""),
    scope: (stringArg(args, "scope", "all") || "all") as KnowledgeScope | "all",
    status: (stringArg(args, "status", "active") || "active") as KnowledgeStatus | "all",
    query: stringArg(args, "query", ""),
    projectSlug,
    limit: intArg(args, "limit", 10),
    includeRetired: Boolean(args["include-retired"]),
  });
  const rendered = renderSearchRows(rows);
  process.stdout.write(rendered || "KNOWLEDGE: no matching entries\n");
}

function runGraduate(args: Args): void {
  const id = requiredString(args, "id");
  const to = requiredString(args, "to");
  const summary = stringArg(args, "summary", "");
  const entry = transitionKnowledgeStatus(id, "graduated", {
    graduated_to: to,
    reviewed_by: enumArg(args, "reviewed-by", KNOWLEDGE_REVIEWERS, "workflow") as KnowledgeReviewer,
    last_verified: todayIsoDate(),
    staleness: "fresh",
    ...(summary ? { summary } : {}),
  });
  process.stdout.write(`GRADUATED ${entryPath(entry.id)} -> ${to}\n`);
}

function runRetire(args: Args): void {
  const id = requiredString(args, "id");
  const summary = stringArg(args, "summary", "");
  const entry = transitionKnowledgeStatus(id, "retired", summary ? { summary } : {});
  process.stdout.write(`RETIRED ${entryPath(entry.id)}\n`);
}

function runReview(tokens: string[]): void {
  const { command = "list", args } = parseArgs(tokens);
  if (command === "list") return runReviewList(args);
  if (command === "show") return runReviewShow(args);
  if (command === "promote") return runReviewPromote(args);
  if (command === "edit") return runReviewEdit(args);
  if (command === "retire") return runRetire(args);
  if (command === "graduate") return runGraduate(args);
  throw new Error(`Unknown review command: ${command}`);
}

function runReviewList(args: Args): void {
  const overdueDays = intArg(args, "overdue-days", 30);
  const root = knowledgeRoot();
  const files = existsSync(entriesDir(root))
    ? readdirSync(entriesDir(root)).filter((name) => name.endsWith(".md"))
    : [];
  const candidates = files
    .map((name) => {
      const file = entryPath(name.replace(/\.md$/, ""), root);
      const entry = parseKnowledgeFile(file);
      return { entry, file, age: candidateAgeDays(entry, file) };
    })
    .filter(({ entry }) => entry.status === "candidate")
    .sort((a, b) => {
      const overdueDelta = Number(b.age >= overdueDays) - Number(a.age >= overdueDays);
      if (overdueDelta !== 0) return overdueDelta;
      if (b.entry.confidence !== a.entry.confidence) {
        return b.entry.confidence - a.entry.confidence;
      }
      return b.entry.updated.localeCompare(a.entry.updated);
    });
  if (candidates.length === 0) {
    process.stdout.write("CANDIDATES: none\n");
    return;
  }
  process.stdout.write(`CANDIDATES: ${candidates.length}\n`);
  for (const item of candidates) {
    const tag = item.age >= overdueDays ? "overdue" : "candidate";
    process.stdout.write(
      `- ${item.entry.id} [${tag}, age ${item.age}d, confidence ${item.entry.confidence}/10] ${item.entry.summary}\n  ${item.file}\n`,
    );
  }
}

function runReviewShow(args: Args): void {
  const id = requiredString(args, "id");
  process.stdout.write(readFileSync(entryPath(id, knowledgeRoot()), "utf8"));
}

function runReviewPromote(args: Args): void {
  const id = requiredString(args, "id");
  const reviewer = enumArg(args, "reviewed-by", KNOWLEDGE_REVIEWERS, "user") as KnowledgeReviewer;
  const entry = transitionKnowledgeStatus(id, "active", {
    reviewed_by: reviewer,
    trust_level: enumArg(args, "trust-level", KNOWLEDGE_TRUST_LEVELS, "verified") as KnowledgeTrustLevel,
    last_verified: todayIsoDate(),
    staleness: "fresh",
  });
  process.stdout.write(`PROMOTED ${entry.id} reviewed_by=${entry.reviewed_by}\n`);
}

function runReviewEdit(args: Args): void {
  const id = requiredString(args, "id");
  const root = knowledgeRoot();
  const file = entryPath(id, root);
  const current = parseKnowledgeFile(file);
  const summary = stringArg(args, "summary", current.summary);
  const bodyFile = stringArg(args, "body-file", "");
  const body = bodyFile ? readFileSync(bodyFile, "utf8") : current.body;
  const next = createKnowledgeEntry({
    ...current,
    summary,
    body,
    updated: todayIsoDate(),
  });
  writeKnowledgeEntry(next, root);
  process.stdout.write(`UPDATED ${file}\n`);
}

function runValidate(args: Args): void {
  const id = stringArg(args, "id", "");
  const root = knowledgeRoot();
  if (id) {
    parseKnowledgeFile(entryPath(id, root));
    process.stdout.write(`VALID ${entryPath(id, root)}\n`);
    return;
  }
  const index = rebuildIndex(root);
  process.stdout.write(`VALID ${index.entries.length} indexed entries\n`);
}

function runReindex(): void {
  const index = rebuildIndex();
  process.stdout.write(`REINDEXED ${index.entries.length} entries\n`);
}

function requiredString(args: Args, key: string): string {
  const value = stringArg(args, key, "");
  if (!value) throw new Error(`--${key} is required`);
  return value;
}

function stringArg(args: Args, key: string, fallback: string): string {
  const value = args[key];
  return typeof value === "string" ? value : fallback;
}

function intArg(args: Args, key: string, fallback: number): number {
  const raw = stringArg(args, key, "");
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value)) throw new Error(`--${key} must be an integer`);
  return value;
}

function enumArg<T extends readonly string[]>(
  args: Args,
  key: string,
  allowed: T,
  fallback: string | undefined,
): string {
  const value = stringArg(args, key, fallback || "");
  if (!value && fallback !== undefined) return fallback;
  if (!value) throw new Error(`--${key} is required`);
  if (!allowed.includes(value)) {
    throw new Error(`--${key} must be one of: ${allowed.join(", ")}`);
  }
  return value;
}

function listArg<T extends readonly string[]>(args: Args, key: string, allowed: T): string[] {
  const values = commaList(requiredString(args, key));
  for (const value of values) {
    if (!allowed.includes(value)) {
      throw new Error(`--${key} contains invalid value: ${value}`);
    }
  }
  return values;
}

function nullableDateArg(args: Args, key: string): string | null {
  const value = stringArg(args, key, "");
  return value || null;
}

function commaList(value: string): string[] {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function readBody(args: Args): string {
  const inline = stringArg(args, "body", "");
  if (inline) return inline;
  const bodyFile = stringArg(args, "body-file", "");
  if (!bodyFile) throw new Error("--body-file or --body is required");
  return readFileSync(bodyFile, "utf8");
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
