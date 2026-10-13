import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

type RuleRecord = {
  id: string;
  sourceFile: string;
  content: string;
  contentHash: string;
};

export type RulesBundle = {
  repoRoot: string;
  rules: RuleRecord[];
  ruleIds: string[];
  contentHash: string;
};

export type RulesSnapshot = {
  repoRoot: string;
  rulesDir: string;
  manifest: {
    rules: Array<{
      id: string;
      reviewCriteria?: string[];
    }>;
  };
  rulesById: Readonly<Record<string, RuleRecord>>;
};

type RulesResolver = {
  createRulesSnapshot(options: Record<string, unknown>): RulesSnapshot;
  resolveRules(options: Record<string, unknown>): RulesBundle;
  formatRulesBundle(bundle: RulesBundle): string;
};

export type ReviewPromptTelemetry = {
  host: string;
  rulesCount: number;
  rulesBytes: number;
  diffBytes: number;
  promptBytes: number;
  promptOverheadBytes: number;
  aggregateRulesBytes: number;
};

export const MAX_REVIEW_RULES_BYTES = 16 * 1024;
const MAX_REVIEW_CRITERIA_BYTES_PER_RULE = 1024;

const require = createRequire(import.meta.url);

type TrustedRulesRuntime = {
  resolverScript: string;
  rulesDirectory: string;
};

function loadTrustedRulesRuntime(): TrustedRulesRuntime | undefined {
  const runtimeRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const configFile = join(runtimeRoot, 'trusted-runtime.json');
  if (!existsSync(configFile)) return undefined;

  let config: Record<string, unknown>;
  try {
    config = JSON.parse(readFileSync(configFile, 'utf8')) as Record<string, unknown>;
  } catch (error) {
    throw new Error(
      `trusted review Rules configuration is invalid: ${configFile}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (config.schemaVersion !== 2) {
    throw new Error(`trusted review Rules configuration has an unsupported schema: ${configFile}`);
  }

  const requirePath = (field: string, kind: 'file' | 'directory'): string => {
    const value = config[field];
    if (typeof value !== 'string' || !isAbsolute(value) || !existsSync(value)) {
      throw new Error(`trusted review Rules configuration field ${field} is invalid: ${configFile}`);
    }
    const resolved = realpathSync(value);
    const stats = statSync(resolved);
    if ((kind === 'file' && !stats.isFile()) || (kind === 'directory' && !stats.isDirectory())) {
      throw new Error(`trusted review Rules configuration field ${field} is not a ${kind}: ${configFile}`);
    }
    return resolved;
  };

  return {
    resolverScript: requirePath('rulesResolverScript', 'file'),
    rulesDirectory: requirePath('rulesDirectory', 'directory'),
  };
}

const trustedRulesRuntime = loadTrustedRulesRuntime();

function loadRulesResolver(): RulesResolver {
  const candidates: string[] = [
    trustedRulesRuntime?.resolverScript,
    '../../hooks/scripts/lib/rules-resolver',
  ].filter((candidate): candidate is string => Boolean(candidate));
  const fallbackHome = process.env.HOME;
  if (fallbackHome) {
    candidates.push(
      join(fallbackHome, '.codex', 'review-runtime', 'rules-resolver.js'),
      join(fallbackHome, '.codex', 'hooks', 'shared', 'rules-resolver.js'),
      join(fallbackHome, '.claude', 'hooks', 'scripts', 'lib', 'rules-resolver.js'),
    );
  }
  const failures: string[] = [];
  for (const candidate of candidates) {
    try {
      return require(candidate) as RulesResolver;
    } catch (error) {
      failures.push(`${candidate}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(`Goldband review Rules resolver unavailable: ${failures.join(' | ')}`);
}

const rulesResolver = loadRulesResolver();

function withTrustedRulesDirectory(
  options: Record<string, unknown>,
): Record<string, unknown> {
  return trustedRulesRuntime
    ? { ...options, rulesDir: trustedRulesRuntime.rulesDirectory }
    : options;
}

export function assertRulesPayloadBudget(
  bundle: RulesBundle,
  label: string,
  snapshot?: RulesSnapshot,
): string {
  const projectedBundle = snapshot
    ? projectRulesForReview(bundle, snapshot)
    : bundle;
  const text = rulesResolver.formatRulesBundle(projectedBundle);
  const actualBytes = Buffer.byteLength(text);
  if (actualBytes > MAX_REVIEW_RULES_BYTES) {
    throw new Error(
      `review Rules payload exceeds budget for ${label}: selected=${bundle.ruleIds.join(',')} actualBytes=${actualBytes} limit=${MAX_REVIEW_RULES_BYTES}`,
    );
  }
  return text;
}

export function coreReviewRules(
  repoRoot: string,
  diff: string,
  paths: string[],
  snapshot?: RulesSnapshot,
) {
  const activeSnapshot = snapshot ?? createReviewRulesSnapshot(repoRoot);
  const bundle = rulesResolver.resolveRules(withTrustedRulesDirectory({
    repoRoot,
    phase: 'review',
    scope: diff,
    paths,
    snapshot: activeSnapshot,
  }));
  return {
    bundle,
    text: assertRulesPayloadBudget(bundle, 'core', activeSnapshot),
  };
}

function createReviewRulesSnapshot(repoRoot: string): RulesSnapshot {
  return rulesResolver.createRulesSnapshot(
    withTrustedRulesDirectory({ repoRoot }),
  );
}

export function buildReviewPromptTelemetry(options: {
  host: string;
  corePrompt: string;
  coreBundle: RulesBundle;
  coreRulesText: string;
  diff: string;
}): ReviewPromptTelemetry {
  const coreRulesBytes = Buffer.byteLength(options.coreRulesText);
  const diffBytes = Buffer.byteLength(options.diff);
  const promptBytes = Buffer.byteLength(options.corePrompt);
  return {
    host: options.host,
    rulesCount: options.coreBundle.rules.length,
    rulesBytes: coreRulesBytes,
    diffBytes,
    promptBytes,
    promptOverheadBytes: promptBytes - diffBytes,
    aggregateRulesBytes: coreRulesBytes,
  };
}

function projectRulesForReview(
  bundle: RulesBundle,
  snapshot: RulesSnapshot,
): RulesBundle {
  const criteriaById = new Map(
    snapshot.manifest.rules.map((rule) => [rule.id, rule.reviewCriteria]),
  );
  const rules = bundle.rules.map((rule) => {
    const criteria = criteriaById.get(rule.id);
    if (!criteria || criteria.length === 0 || criteria.some((item) => !item.trim())) {
      throw new Error(`review Criteria missing for Rule ${rule.id}`);
    }
    const content = [
      '# Review Criteria',
      ...criteria.map((criterion) => `- ${criterion.trim()}`),
      '',
      `Read the full policy at ${rule.sourceFile} only when a finding depends on details not represented here.`,
    ].join('\n');
    const bytes = Buffer.byteLength(content);
    if (bytes > MAX_REVIEW_CRITERIA_BYTES_PER_RULE) {
      throw new Error(
        `review Criteria exceeds budget for Rule ${rule.id}: actualBytes=${bytes} limit=${MAX_REVIEW_CRITERIA_BYTES_PER_RULE}`,
      );
    }
    return { ...rule, content };
  });
  return { ...bundle, rules };
}
