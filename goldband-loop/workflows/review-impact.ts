import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import type { Stats } from 'node:fs';
import { lstatSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, posix, relative, resolve, sep } from 'node:path';
import { readStableRegularFile } from '../lib/stable-file-read';
import { stateRoot } from './evidence';
import type { ReviewTimeBudget } from './review-timeouts';
import type { SchemaValidator, WorkflowContext } from './types';
import { resolveReviewWorkspace } from './review-workspace';

export type ReviewDiffInput = {
  source: string;
  diff: string;
  changedFiles: string[];
};

type ReviewImpactFile = {
  file: string;
  distance: number;
  changedFiles: string[];
  test: boolean;
};

export type ReviewImpactContext = {
  status: 'analyzed' | 'degraded' | 'skipped';
  reason?: 'no-changes' | 'single-file' | 'no-indexable-files';
  changedFiles: string[];
  indexedFiles: number;
  parsedFiles: number;
  reusedFiles: number;
  dependencyEdges: number;
  directDependencies: Array<{ from: string; to: string }>;
  impactedFiles: ReviewImpactFile[];
  observedTestFiles: string[];
  filesWithoutObservedTests: string[];
  truncated: boolean;
  diagnostics: string[];
};

export type ReviewInput = ReviewDiffInput & {
  impact: ReviewImpactContext;
};

type CachedFile = {
  signature: string;
  specifiers: string[];
  test: boolean;
  truncated: boolean;
};

type ImpactCache = {
  schemaVersion: 1;
  repoRoot: string;
  files: Record<string, CachedFile>;
};

type CacheLoadResult = {
  cache?: ImpactCache;
  diagnostic?: string;
};

type FileIndex = {
  files: Map<string, CachedFile>;
  parsedFiles: number;
  reusedFiles: number;
  truncated: boolean;
  diagnostics: string[];
};

const IMPACT_CACHE_SCHEMA_VERSION = 1;
const MAX_INDEX_FILES = 20_000;
const MAX_SOURCE_FILE_BYTES = 256 * 1024;
const MAX_TOTAL_SOURCE_BYTES = 48 * 1024 * 1024;
const MAX_CACHE_FILE_BYTES = 64 * 1024 * 1024;
const MAX_SPECIFIERS_PER_FILE = 128;
const MAX_SPECIFIER_BYTES = 4 * 1024;
const MAX_IMPACT_FILES = 80;
const MAX_DIRECT_DEPENDENCIES = 120;
const MAX_DIAGNOSTICS = 20;
const IMPACT_DEPTH = 2;
const MAX_PROMPT_IMPACT_BYTES = 8 * 1024;
export const WIDE_IMPACT_FILE_THRESHOLD = 8;

const RESOLUTION_EXTENSIONS = [
  '.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs',
  '.vue', '.svelte', '.astro', '.json', '.py', '.rs',
  '.sh', '.bash', '.zsh', '.rb', '.c', '.cc', '.cpp', '.h', '.hpp',
] as const;

const PARSED_EXTENSIONS = new Set<string>(
  RESOLUTION_EXTENSIONS.filter((extension) => extension !== '.json'),
);

export const reviewDiffSchema: SchemaValidator<ReviewDiffInput> = {
  name: 'review-diff',
  validate(value) {
    const item = requiredRecord(value, 'expected diff object');
    if (typeof item.source !== 'string') throw new Error('diff.source required');
    if (typeof item.diff !== 'string') throw new Error('diff.diff required');
    return {
      source: item.source,
      diff: item.diff,
      changedFiles: stringArray(item.changedFiles, 'diff.changedFiles'),
    };
  },
};

export const reviewInputSchema: SchemaValidator<ReviewInput> = {
  name: 'review-input',
  validate(value) {
    const diff = reviewDiffSchema.validate(value);
    const item = value as Record<string, unknown>;
    return { ...diff, impact: validateImpactContext(item.impact) };
  },
};

function skippedImpactContext(
  changedFiles: string[],
  reason: ReviewImpactContext['reason'],
): ReviewImpactContext {
  return {
    status: 'skipped',
    reason,
    changedFiles: normalizedPaths(changedFiles),
    indexedFiles: 0,
    parsedFiles: 0,
    reusedFiles: 0,
    dependencyEdges: 0,
    directDependencies: [],
    impactedFiles: [],
    observedTestFiles: [],
    filesWithoutObservedTests: [],
    truncated: false,
    diagnostics: [],
  };
}

export function collectReviewImpactContext(
  ctx: WorkflowContext,
  input: ReviewDiffInput,
  timeBudget: ReviewTimeBudget,
): ReviewInput {
  const changedFiles = normalizedPaths(input.changedFiles);
  if (changedFiles.length === 0) {
    return persistImpactArtifact(ctx, input, skippedImpactContext([], 'no-changes'));
  }
  if (changedFiles.length === 1) {
    return persistImpactArtifact(
      ctx,
      input,
      skippedImpactContext(changedFiles, 'single-file'),
    );
  }

  const impact = buildImpactContext(ctx, changedFiles, timeBudget);
  return persistImpactArtifact(ctx, input, impact);
}

export function formatReviewImpactContext(impact: ReviewImpactContext): string {
  if (impact.status === 'skipped') {
    return `Review impact graph skipped: ${impact.reason ?? 'unknown'} (${impact.changedFiles.length} changed file(s)).`;
  }
  const promptImpact = promptImpactProjection(impact);
  return [
    'GOLDBAND_REVIEW_IMPACT_CONTEXT_START',
    'Runtime-owned structural hints only. They prioritize inspection; they are not proof of a defect, complete coverage, or permission to omit any diff path.',
    'Validate every graph-suggested path against current source. Absence from this graph never proves absence of impact or tests.',
    JSON.stringify(promptImpact),
    'GOLDBAND_REVIEW_IMPACT_CONTEXT_END',
  ].join('\n');
}

function promptImpactProjection(impact: ReviewImpactContext): Record<string, unknown> {
  const projection: Record<string, unknown> = {
    status: impact.status,
    directDependencies: [...impact.directDependencies],
    impactedFiles: [...impact.impactedFiles],
    observedTestFiles: [...impact.observedTestFiles],
    filesWithoutObservedTests: [...impact.filesWithoutObservedTests],
    diagnostics: [...impact.diagnostics],
    promptProjection: {
      changedFiles: impact.changedFiles.length,
      directDependencies: impact.directDependencies.length,
      impactedFiles: impact.impactedFiles.length,
      observedTestFiles: impact.observedTestFiles.length,
      filesWithoutObservedTests: impact.filesWithoutObservedTests.length,
      bounded: impact.truncated,
    },
  };
  const arrayFields = [
    'directDependencies',
    'impactedFiles',
    'observedTestFiles',
    'filesWithoutObservedTests',
    'diagnostics',
  ];
  while (Buffer.byteLength(JSON.stringify(projection)) > MAX_PROMPT_IMPACT_BYTES) {
    let reduced = false;
    for (const field of arrayFields) {
      const values = projection[field] as unknown[];
      if (values.length === 0) continue;
      projection[field] = values.slice(0, Math.floor(values.length / 2));
      reduced = true;
    }
    if (!reduced) break;
    (projection.promptProjection as Record<string, unknown>).bounded = true;
  }
  return projection;
}

export function impactTelemetry(impact: ReviewImpactContext) {
  return {
    impactStatus: impact.status,
    impactReason: impact.reason ?? null,
    impactChangedFiles: impact.changedFiles.length,
    impactIndexedFiles: impact.indexedFiles,
    impactParsedFiles: impact.parsedFiles,
    impactReusedFiles: impact.reusedFiles,
    impactDependencyEdges: impact.dependencyEdges,
    impactAffectedFiles: impact.impactedFiles.length,
    impactObservedTestFiles: impact.observedTestFiles.length,
    impactFilesWithoutObservedTests: impact.filesWithoutObservedTests.length,
    impactTruncated: impact.truncated,
    impactDiagnostics: impact.diagnostics,
  };
}

function buildImpactContext(
  ctx: WorkflowContext,
  changedFiles: string[],
  timeBudget: ReviewTimeBudget,
): ReviewImpactContext {
  const realRoot = resolveReviewWorkspace(ctx.cwd).repositoryRoot;
  const inventory = listRepositoryFiles(ctx, changedFiles, timeBudget);
  const indexableChanged = changedFiles.filter((file) => isParsedFile(file));
  if (indexableChanged.length === 0) {
    return {
      ...skippedImpactContext(changedFiles, 'no-indexable-files'),
      diagnostics: inventory.diagnostics,
    };
  }

  const indexed = buildFileIndex(
    realRoot,
    inventory.files,
    cachePath(ctx, realRoot),
    timeBudget,
  );
  const diagnostics = boundedDiagnostics([
    ...inventory.diagnostics,
    ...indexed.diagnostics,
  ]);
  const candidateSet = new Set(inventory.files);
  const outgoing = new Map<string, string[]>();
  for (const [file, record] of indexed.files) {
    timeBudget.assertWithinDeadline();
    const resolved = record.specifiers
      .map((specifier) => resolveSpecifier(file, specifier, candidateSet))
      .filter((value): value is string => Boolean(value));
    outgoing.set(file, [...new Set(resolved)].sort());
  }

  const reverse = reverseEdges(outgoing);
  const impactedByFile = new Map<string, ReviewImpactFile>();
  const observedTests = new Set<string>();
  const filesWithoutObservedTests: string[] = [];
  let impactTruncated = false;

  for (const changedFile of indexableChanged) {
    const result = reverseImpact(changedFile, reverse, indexed.files, timeBudget);
    if (!result.hasObservedTest && !isTestPath(changedFile)) {
      filesWithoutObservedTests.push(changedFile);
    }
    impactTruncated ||= result.truncated;
    for (const item of result.files) {
      if (item.test) observedTests.add(item.file);
      const existing = impactedByFile.get(item.file);
      if (!existing) {
        impactedByFile.set(item.file, item);
        continue;
      }
      existing.distance = Math.min(existing.distance, item.distance);
      existing.changedFiles = normalizedPaths([
        ...existing.changedFiles,
        ...item.changedFiles,
      ]);
      existing.test ||= item.test;
    }
  }

  const impactedFiles = [...impactedByFile.values()]
    .sort((left, right) =>
      left.distance - right.distance || left.file.localeCompare(right.file))
    .slice(0, MAX_IMPACT_FILES);
  impactTruncated ||= impactedByFile.size > MAX_IMPACT_FILES;

  const directDependencies = indexableChanged
    .flatMap((file) => (outgoing.get(file) ?? []).map((to) => ({ from: file, to })))
    .sort((left, right) =>
      left.from.localeCompare(right.from) || left.to.localeCompare(right.to))
    .slice(0, MAX_DIRECT_DEPENDENCIES);
  const dependencyEdges = [...outgoing.values()]
    .reduce((total, dependencies) => total + dependencies.length, 0);
  const truncated = inventory.truncated || indexed.truncated || impactTruncated;
  if (truncated) diagnostics.push('impact graph output was bounded; treat coverage as incomplete');

  return {
    status: diagnostics.length > 0 || truncated ? 'degraded' : 'analyzed',
    changedFiles,
    indexedFiles: indexed.files.size,
    parsedFiles: indexed.parsedFiles,
    reusedFiles: indexed.reusedFiles,
    dependencyEdges,
    directDependencies,
    impactedFiles,
    observedTestFiles: [...observedTests].sort(),
    filesWithoutObservedTests: normalizedPaths(filesWithoutObservedTests),
    truncated,
    diagnostics: boundedDiagnostics(diagnostics),
  };
}

function listRepositoryFiles(
  ctx: WorkflowContext,
  changedFiles: string[],
  timeBudget: ReviewTimeBudget,
): { files: string[]; truncated: boolean; diagnostics: string[] } {
  const result = spawnSync(
    'git',
    ['--no-pager', '-c', 'core.fsmonitor=false', 'ls-files', '-z', '--cached'],
    {
      cwd: resolveReviewWorkspace(ctx.cwd).repositoryRoot,
      encoding: 'buffer',
      env: {
        ...process.env,
        GIT_NO_LAZY_FETCH: '1',
        GIT_OPTIONAL_LOCKS: '0',
      },
      maxBuffer: 16 * 1024 * 1024,
      timeout: timeBudget.remainingPassTimeoutMs(),
    },
  );
  if (result.error) {
    return {
      files: changedFiles,
      truncated: false,
      diagnostics: [`tracked file inventory unavailable: ${result.error.message}`],
    };
  }
  if (result.status !== 0) {
    return {
      files: changedFiles,
      truncated: false,
      diagnostics: ['tracked file inventory unavailable: git ls-files failed'],
    };
  }
  const tracked = Buffer.from(result.stdout ?? Buffer.alloc(0))
    .toString('utf8')
    .split('\0')
    .filter(Boolean);
  const all = normalizedPaths([...changedFiles, ...tracked]);
  if (all.length <= MAX_INDEX_FILES) {
    return { files: all, truncated: false, diagnostics: [] };
  }
  const changedSet = new Set(changedFiles);
  const bounded = [
    ...changedFiles,
    ...all.filter((file) => !changedSet.has(file)),
  ].slice(0, MAX_INDEX_FILES);
  return {
    files: bounded,
    truncated: true,
    diagnostics: [`repository inventory exceeded ${MAX_INDEX_FILES} files`],
  };
}

function buildFileIndex(
  realRoot: string,
  inventory: string[],
  file: string,
  timeBudget: ReviewTimeBudget,
): FileIndex {
  const cacheLoad = loadCache(file, realRoot);
  const cached = cacheLoad.cache;
  const nextFiles = new Map<string, CachedFile>();
  const diagnostics: string[] = cacheLoad.diagnostic ? [cacheLoad.diagnostic] : [];
  let parsedFiles = 0;
  let reusedFiles = 0;
  let totalBytes = 0;
  let truncated = false;

  for (const relativePath of inventory) {
    timeBudget.assertWithinDeadline();
    if (!isParsedFile(relativePath)) continue;
    const absolutePath = resolve(realRoot, relativePath);
    if (!insideRoot(realRoot, absolutePath)) {
      diagnostics.push(`skipped path outside repository: ${relativePath}`);
      continue;
    }
    let stat: Stats;
    try {
      stat = lstatSync(absolutePath);
    } catch {
      continue;
    }
    if (stat.isSymbolicLink() || !stat.isFile()) {
      diagnostics.push(`skipped non-regular source file: ${relativePath}`);
      continue;
    }
    if (stat.size > MAX_SOURCE_FILE_BYTES) {
      diagnostics.push(`skipped oversized source file: ${relativePath}`);
      continue;
    }
    const signature = fileSignature(stat);
    const previous = cached?.files[relativePath];
    if (previous?.signature === signature) {
      nextFiles.set(relativePath, previous);
      reusedFiles += 1;
      if (previous.truncated) {
        diagnostics.push(`dependency extraction truncated: ${relativePath}`);
      }
      continue;
    }
    if (totalBytes + stat.size > MAX_TOTAL_SOURCE_BYTES) {
      truncated = true;
      continue;
    }
    try {
      const content = readSourceFile(absolutePath, stat, timeBudget);
      totalBytes += content.length;
      const extracted = extractSpecifiers(relativePath, content.toString('utf8'));
      nextFiles.set(relativePath, {
        signature,
        ...extracted,
        test: isTestPath(relativePath),
      });
      if (extracted.truncated) {
        diagnostics.push(`dependency extraction truncated: ${relativePath}`);
      }
      parsedFiles += 1;
    } catch (error) {
      diagnostics.push(
        `source file changed or was unreadable: ${relativePath} (${error instanceof Error ? error.message : String(error)})`,
      );
    }
  }

  const cache: ImpactCache = {
    schemaVersion: IMPACT_CACHE_SCHEMA_VERSION,
    repoRoot: realRoot,
    files: Object.fromEntries([...nextFiles.entries()].sort(([left], [right]) => left.localeCompare(right))),
  };
  try {
    writeCache(file, cache);
  } catch (error) {
    diagnostics.push(`impact cache write failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  return {
    files: nextFiles,
    parsedFiles,
    reusedFiles,
    truncated,
    diagnostics: boundedDiagnostics(diagnostics),
  };
}

function reverseImpact(
  changedFile: string,
  reverse: Map<string, string[]>,
  indexed: Map<string, CachedFile>,
  timeBudget: ReviewTimeBudget,
): { files: ReviewImpactFile[]; hasObservedTest: boolean; truncated: boolean } {
  const seen = new Set([changedFile]);
  const queue: Array<{ file: string; distance: number }> = [
    { file: changedFile, distance: 0 },
  ];
  const files: ReviewImpactFile[] = [];
  let hasObservedTest = false;
  let truncated = false;
  while (queue.length > 0) {
    timeBudget.assertWithinDeadline();
    const current = queue.shift() as { file: string; distance: number };
    if (current.distance >= IMPACT_DEPTH) continue;
    for (const dependent of reverse.get(current.file) ?? []) {
      if (seen.has(dependent)) continue;
      seen.add(dependent);
      const distance = current.distance + 1;
      const test = indexed.get(dependent)?.test ?? isTestPath(dependent);
      files.push({ file: dependent, distance, changedFiles: [changedFile], test });
      hasObservedTest ||= test;
      if (files.length >= MAX_IMPACT_FILES) {
        truncated = true;
        return { files, hasObservedTest, truncated };
      }
      queue.push({ file: dependent, distance });
    }
  }
  return { files, hasObservedTest, truncated };
}

function reverseEdges(outgoing: Map<string, string[]>): Map<string, string[]> {
  const reverse = new Map<string, string[]>();
  for (const [source, targets] of outgoing) {
    for (const target of targets) {
      const existing = reverse.get(target) ?? [];
      existing.push(source);
      reverse.set(target, existing);
    }
  }
  for (const [target, sources] of reverse) {
    reverse.set(target, [...new Set(sources)].sort());
  }
  return reverse;
}

function extractSpecifiers(
  file: string,
  source: string,
): { specifiers: string[]; truncated: boolean } {
  const extension = extensionOf(file);
  const specifiers: string[] = [];
  const collect = (pattern: RegExp) => {
    for (const match of source.matchAll(pattern)) {
      if (match[1]) specifiers.push(match[1]);
    }
  };

  if (['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.svelte', '.astro'].includes(extension)) {
    collect(/\b(?:import|export)\s+(?:[^'"\n]+?\s+from\s+)?['"]([^'"]+)['"]/g);
    collect(/\b(?:require|import)\s*\(\s*['"]([^'"]+)['"]\s*\)/g);
  } else if (extension === '.py') {
    collect(/^\s*from\s+(\.+[A-Za-z0-9_.]*)\s+import\s+/gm);
  } else if (['.sh', '.bash', '.zsh'].includes(extension)) {
    collect(/^\s*(?:source|\.)\s+["']?([^\s"']+)/gm);
  } else if (extension === '.rb') {
    collect(/\brequire_relative\s*[('" ]+([^)'"\s]+)/g);
  } else if (['.c', '.cc', '.cpp', '.h', '.hpp'].includes(extension)) {
    collect(/^\s*#\s*include\s*"([^"]+)"/gm);
  } else if (extension === '.rs') {
    collect(/^\s*mod\s+([A-Za-z_][A-Za-z0-9_]*)\s*;/gm);
  }

  const unique = [...new Set(specifiers.map((value) => value.trim()).filter(Boolean))]
    .sort();
  const bounded = unique.filter((value) => Buffer.byteLength(value) <= MAX_SPECIFIER_BYTES);
  return {
    specifiers: bounded.slice(0, MAX_SPECIFIERS_PER_FILE),
    truncated: bounded.length !== unique.length || bounded.length > MAX_SPECIFIERS_PER_FILE,
  };
}

function resolveSpecifier(
  fromFile: string,
  rawSpecifier: string,
  candidates: Set<string>,
): string | undefined {
  const extension = extensionOf(fromFile);
  let specifier = rawSpecifier.replace(/[?#].*$/, '');
  if (extension === '.py' && specifier.startsWith('.')) {
    const dots = specifier.match(/^\.+/)?.[0].length ?? 1;
    const module = specifier.slice(dots).replaceAll('.', '/');
    let base = posix.dirname(fromFile);
    for (let index = 1; index < dots; index += 1) base = posix.dirname(base);
    specifier = `./${posix.join(posix.relative(posix.dirname(fromFile), base), module)}`;
  } else if (extension === '.rs' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(specifier)) {
    specifier = `./${specifier}`;
  }
  if (!specifier.startsWith('.')) return undefined;
  const base = posix.normalize(posix.join(posix.dirname(fromFile), specifier));
  if (base === '..' || base.startsWith('../') || isAbsolute(base)) return undefined;
  const variants = [
    base,
    ...RESOLUTION_EXTENSIONS.map((suffix) => `${base}${suffix}`),
    ...RESOLUTION_EXTENSIONS.map((suffix) => `${base}/index${suffix}`),
    `${base}.py`,
    `${base}/__init__.py`,
    `${base}.rs`,
    `${base}/mod.rs`,
  ];
  return variants.find((candidate) => candidate !== fromFile && candidates.has(candidate));
}

function persistImpactArtifact(
  ctx: WorkflowContext,
  input: ReviewDiffInput,
  impact: ReviewImpactContext,
): ReviewInput {
  const dir = join(stateRoot(ctx.options), 'workflow-runs', 'artifacts');
  mkdirSync(dir, { recursive: true });
  const iteration = ctx.iterationContext?.iteration;
  const suffix = iteration ? `-iteration-${iteration}` : '';
  const file = join(dir, `${ctx.runId}-review-impact${suffix}.json`);
  writeFileSync(file, `${JSON.stringify(impact, null, 2)}\n`, { mode: 0o600 });
  ctx.artifacts.push(file);
  return { ...input, changedFiles: impact.changedFiles, impact };
}

function cachePath(ctx: WorkflowContext, realRoot: string): string {
  const repoId = createHash('sha256').update(realRoot).digest('hex').slice(0, 24);
  return join(stateRoot(ctx.options), 'review-impact', `${repoId}.json`);
}

function loadCache(file: string, realRoot: string): CacheLoadResult {
  try {
    const value = JSON.parse(
      readStableRegularFile(file, { label: 'impact cache', maxBytes: MAX_CACHE_FILE_BYTES }).toString('utf8'),
    ) as unknown;
    const item = requiredRecord(value, 'invalid impact cache');
    if (item.schemaVersion !== IMPACT_CACHE_SCHEMA_VERSION) return {};
    if (item.repoRoot !== realRoot) throw new Error('impact cache repository mismatch');
    const files = requiredRecord(item.files, 'invalid impact cache files');
    const normalized: Record<string, CachedFile> = {};
    for (const [path, record] of Object.entries(files)) {
      const normalizedPath = normalizeRepoPath(path);
      if (!normalizedPath || normalizedPath !== path.replaceAll('\\', '/')) {
        throw new Error('impact cache contains an invalid path');
      }
      const cached = requiredRecord(record, 'invalid impact cache record');
      if (
        typeof cached.signature !== 'string' ||
        typeof cached.test !== 'boolean' ||
        typeof cached.truncated !== 'boolean'
      ) {
        throw new Error('impact cache contains an invalid file record');
      }
      const specifiers = plainStringArray(cached.specifiers, 'impact cache specifiers');
      if (
        specifiers.length > MAX_SPECIFIERS_PER_FILE ||
        specifiers.some((specifier) => Buffer.byteLength(specifier) > MAX_SPECIFIER_BYTES)
      ) throw new Error('impact cache specifiers exceed bounds');
      normalized[normalizedPath] = {
        signature: cached.signature,
        specifiers,
        test: cached.test,
        truncated: cached.truncated,
      };
    }
    return { cache: { schemaVersion: 1, repoRoot: realRoot, files: normalized } };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    return {
      diagnostic: `impact cache ignored: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function writeCache(file: string, cache: ImpactCache): void {
  mkdirSync(dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  try {
    const serialized = `${JSON.stringify(cache)}\n`;
    if (Buffer.byteLength(serialized) > MAX_CACHE_FILE_BYTES) {
      throw new Error(`impact cache exceeds ${MAX_CACHE_FILE_BYTES} bytes`);
    }
    writeFileSync(temporary, serialized, { mode: 0o600 });
    renameSync(temporary, file);
  } catch (error) {
    try {
      unlinkSync(temporary);
    } catch {
      // The temporary file may not have been created.
    }
    throw error;
  }
}

function readSourceFile(file: string, expected: Stats, timeBudget: ReviewTimeBudget): Buffer {
  return readStableRegularFile(file, {
    label: 'source file',
    maxBytes: MAX_SOURCE_FILE_BYTES,
    expected,
    checkpoint: () => timeBudget.assertWithinDeadline(),
  });
}

function fileSignature(stat: Stats): string {
  return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
}

function insideRoot(root: string, file: string): boolean {
  const rel = relative(root, file);
  return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

function isParsedFile(file: string): boolean {
  return PARSED_EXTENSIONS.has(extensionOf(file));
}

function extensionOf(file: string): string {
  const name = basename(file).toLowerCase();
  return RESOLUTION_EXTENSIONS.find((extension) => name.endsWith(extension)) ?? '';
}

function isTestPath(file: string): boolean {
  const normalized = file.toLowerCase();
  return /(^|\/)(__tests__|tests?|spec)(\/|$)/.test(normalized) ||
    /(?:^|[._-])(test|spec)\.[^/]+$/.test(normalized) ||
    /(^|\/)test_[^/]+\.py$/.test(normalized) ||
    /_test\.go$/.test(normalized);
}

function normalizedPaths(paths: string[]): string[] {
  return [...new Set(paths.map(normalizeRepoPath).filter(Boolean))].sort();
}

function normalizeRepoPath(value: string): string {
  const normalized = posix.normalize(value.replaceAll('\\', '/').replace(/^\.\//, ''));
  if (!normalized || normalized === '.' || normalized === '..' || normalized.startsWith('../')) {
    return '';
  }
  return normalized;
}

function boundedDiagnostics(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].slice(0, MAX_DIAGNOSTICS);
}

function requiredRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(message);
  return value as Record<string, unknown>;
}

function stringArray(value: unknown, field: string): string[] {
  return normalizedPaths(plainStringArray(value, field));
}

function plainStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`${field} must be a string array`);
  }
  return [...new Set(value as string[])];
}

function validateImpactContext(value: unknown): ReviewImpactContext {
  const item = requiredRecord(value, 'review impact context required');
  if (!['analyzed', 'degraded', 'skipped'].includes(String(item.status))) {
    throw new Error('invalid review impact status');
  }
  const reason = item.reason;
  if (reason !== undefined && !['no-changes', 'single-file', 'no-indexable-files'].includes(String(reason))) {
    throw new Error('invalid review impact reason');
  }
  const number = (field: string) => {
    const result = item[field];
    if (!Number.isInteger(result) || Number(result) < 0) throw new Error(`impact.${field} must be a non-negative integer`);
    return Number(result);
  };
  const directDependencies = Array.isArray(item.directDependencies)
    ? item.directDependencies.map((value) => {
      const edge = requiredRecord(value, 'invalid direct dependency');
      if (typeof edge.from !== 'string' || typeof edge.to !== 'string') throw new Error('invalid direct dependency');
      return {
        from: requiredRepoPath(edge.from, 'impact.directDependencies.from'),
        to: requiredRepoPath(edge.to, 'impact.directDependencies.to'),
      };
    })
    : (() => { throw new Error('impact.directDependencies must be an array'); })();
  const impactedFiles = Array.isArray(item.impactedFiles)
    ? item.impactedFiles.map((value) => {
      const impacted = requiredRecord(value, 'invalid impacted file');
      if (
        typeof impacted.file !== 'string' ||
        !Number.isInteger(impacted.distance) ||
        Number(impacted.distance) < 1 ||
        Number(impacted.distance) > IMPACT_DEPTH ||
        typeof impacted.test !== 'boolean'
      ) {
        throw new Error('invalid impacted file');
      }
      return {
        file: requiredRepoPath(impacted.file, 'impact.impactedFiles.file'),
        distance: Number(impacted.distance),
        changedFiles: stringArray(impacted.changedFiles, 'impact.changedFiles'),
        test: impacted.test,
      };
    })
    : (() => { throw new Error('impact.impactedFiles must be an array'); })();
  if (typeof item.truncated !== 'boolean') throw new Error('impact.truncated must be boolean');
  return {
    status: item.status as ReviewImpactContext['status'],
    ...(reason ? { reason: reason as ReviewImpactContext['reason'] } : {}),
    changedFiles: stringArray(item.changedFiles, 'impact.changedFiles'),
    indexedFiles: number('indexedFiles'),
    parsedFiles: number('parsedFiles'),
    reusedFiles: number('reusedFiles'),
    dependencyEdges: number('dependencyEdges'),
    directDependencies,
    impactedFiles,
    observedTestFiles: stringArray(item.observedTestFiles, 'impact.observedTestFiles'),
    filesWithoutObservedTests: stringArray(item.filesWithoutObservedTests, 'impact.filesWithoutObservedTests'),
    truncated: item.truncated,
    diagnostics: plainStringArray(item.diagnostics, 'impact.diagnostics'),
  };
}

function requiredRepoPath(value: string, field: string): string {
  const normalized = normalizeRepoPath(value);
  if (!normalized) throw new Error(`${field} must remain inside the repository`);
  return normalized;
}
