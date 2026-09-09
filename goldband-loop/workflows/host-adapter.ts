import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { evidenceTemporaryDirectory } from '../lib/evidence-runtime-contract';
import { superviseCommand } from '../scripts/process-supervisor.mjs';
import {
  formatClaudeReviewBudgetUsd,
  resolveClaudeReviewBudgetPolicy,
  type ClaudeAuthStatus,
  type ClaudeBillingMode,
  type ClaudeReviewBudgetPolicy,
} from './review-budgets';
import type { ReviewFinding } from './types';

type HostResult = {
  text: string;
  parsed?: unknown;
  usage?: HostUsage;
  executionPolicy?: HostExecutionPolicy;
};

export type HostExecutionPolicy = {
  billingMode?: ClaudeBillingMode;
  maxBudgetUsd?: number;
};

export type HostUsage = {
  source: 'codex-jsonl' | 'claude-json';
  inputTokens?: number;
  cachedInputTokens?: number;
  cacheCreationInputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  costUsd?: number;
  model?: string;
};

export class HostRunError extends Error {
  readonly executionPolicy?: HostExecutionPolicy;
  readonly usage?: HostUsage;

  constructor(
    message: string,
    details: {
      executionPolicy?: HostExecutionPolicy;
      usage?: HostUsage;
    } = {},
  ) {
    super(message);
    this.name = 'HostRunError';
    this.executionPolicy = details.executionPolicy;
    this.usage = details.usage;
  }
}

type HostRunOptions = {
  timeoutMs: number;
  claudeMaxBudgetUsd?: number;
};

export type RunProcessOptions = {
  timeoutMs: number;
  killGraceMs?: number;
  cwd?: string;
  input?: string;
  stdoutMaxBytes: number;
  stderrMaxBytes: number;
};

export type RunProcessResult = {
  status: number | null;
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
};

export const MAX_HOST_DIAGNOSTIC_BYTES = 256 * 1024;
export const MAX_HOST_STRUCTURED_OUTPUT_BYTES = 2 * 1024 * 1024;
const CLAUDE_AUTH_STATUS_TIMEOUT_MS = 10 * 1000;
const MAX_CLAUDE_AUTH_STATUS_BYTES = 64 * 1024;

export type HostAdapter = {
  name: 'mock' | 'claude' | 'codex';
  capabilities: {
    readOnlyEnforced: boolean;
    parallelDispatch: boolean;
  };
  runJson(
    prompt: string,
    schema: unknown,
    cwd: string,
    options: HostRunOptions,
  ): Promise<HostResult>;
};

const READ_ONLY_SINGLE_REVIEW_CAPABILITIES = {
  readOnlyEnforced: true,
  parallelDispatch: false,
};

class MockHostAdapter implements HostAdapter {
  name = 'mock' as const;
  capabilities = READ_ONLY_SINGLE_REVIEW_CAPABILITIES;

  async runJson(
    prompt = '',
    _schema?: unknown,
    _cwd?: string,
    _options?: HostRunOptions,
  ): Promise<HostResult> {
    const contractReview = prompt.includes('REVIEW_CONTRACT_CHANGES_START')
      ? { preserved: true, summary: 'Mock-only contract assessment; this is not live review evidence.' }
      : null;
    if (prompt.includes('# Scoped Closure Review')) {
      const payloadText = prompt
        .split('CLOSURE_INPUT_START\n')[1]
        ?.split('\nCLOSURE_INPUT_END')[0];
      const payload = payloadText
        ? JSON.parse(payloadText) as {
          originalFindings?: Array<{ id?: string; behaviorCellIds?: string[] }>;
          rerunEvidence?: Array<{ id?: string; cellIds?: string[] }>;
        }
        : {};
      const ids = (payload.originalFindings ?? [])
        .map((finding) => finding.id)
        .filter((id): id is string => Boolean(id));
      const parsed = {
        contractReview,
        results: [...new Set(ids)].map((findingId) => {
          const cells = new Set(
            payload.originalFindings?.find((finding) => finding.id === findingId)?.behaviorCellIds ?? [],
          );
          const evidenceIds = (payload.rerunEvidence ?? [])
            .filter((record) => record.cellIds?.some((cellId) => cells.has(cellId)))
            .map((record) => record.id)
            .filter((id): id is string => Boolean(id));
          return {
            findingId,
            status: evidenceIds.length > 0 ? 'closed' : 'evidence-incomplete',
            summary: 'Mock closure confirms the repair for the original finding.',
            evidenceIds,
          };
        }),
      };
      return { text: JSON.stringify(parsed), parsed };
    }
    const findings = mockFindingsForPrompt(prompt);
    const parsed = { findings, contractReview };
    return { text: JSON.stringify(parsed), parsed };
  }
}

function mockFindingsForPrompt(prompt: string): ReviewFinding[] {
  const behaviorCellId = /BEHAVIOR_MATRIX_START\n\[\{\"id\":\"([^\"]+)/.exec(prompt)?.[1];
  return [mockFinding(
    1,
    behaviorCellId,
    prompt.includes('GOLDBAND_HIGH_SEMANTIC_FIXTURE') ? 'high' : 'medium',
  )];
}

function mockFinding(
  index: number,
  behaviorCellId?: string,
  severity: ReviewFinding['severity'] = 'medium',
): ReviewFinding {
  return {
    file: 'src/example.ts',
    line: index + 1,
    severity,
    summary: `Mock review finding ${index} with concrete diff evidence.`,
    evidence: '+ riskyChange();',
    failureScenario: 'A valid request reaches riskyChange() and returns the wrong result.',
    recommendation: 'Add a guard and a focused regression test.',
    suggestedVerification: 'Run the focused mock review regression test.',
    classification: 'semantic-concern',
    reproductionStep: 'Run the focused mock review regression test.',
    behaviorCellIds: behaviorCellId ? [behaviorCellId] : undefined,
  };
}

class CodexHostAdapter implements HostAdapter {
  name = 'codex' as const;
  capabilities = READ_ONLY_SINGLE_REVIEW_CAPABILITIES;

  async runJson(
    prompt: string,
    schema: unknown,
    cwd: string,
    options: HostRunOptions,
  ): Promise<HostResult> {
    const dir = mkdtempSync(join(
      evidenceTemporaryDirectory(process.env) ?? tmpdir(),
      'goldband-codex-',
    ));
    const schemaFile = join(dir, 'schema.json');
    const outputFile = join(dir, 'last-message.json');
    writeFileSync(schemaFile, JSON.stringify(schema));
    try {
      const result = await runProcess(
        process.env.GOLDBAND_TRUSTED_CODEX_EXECUTABLE || 'codex',
        codexRunJsonArgs(schemaFile, outputFile),
        {
          timeoutMs: options.timeoutMs,
          killGraceMs: 2000,
          cwd,
          input: prompt,
          stdoutMaxBytes: MAX_HOST_DIAGNOSTIC_BYTES,
          stderrMaxBytes: MAX_HOST_DIAGNOSTIC_BYTES,
        },
      );
      if (result.status !== 0) throw new Error(processFailureMessage(result));
      return readStructuredResult(outputFile, parseCodexUsage(result.stdout));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}

class ClaudeHostAdapter implements HostAdapter {
  name = 'claude' as const;
  capabilities = READ_ONLY_SINGLE_REVIEW_CAPABILITIES;

  async runJson(
    prompt: string,
    schema: unknown,
    cwd: string,
    options: HostRunOptions,
  ): Promise<HostResult> {
    const startedAt = performance.now();
    const auth = await readClaudeAuthStatus(cwd, options.timeoutMs);
    const executionPolicy = resolveClaudeReviewBudgetPolicy(
      auth,
      options.claudeMaxBudgetUsd,
      process.env,
    );
    const remainingTimeoutMs = Math.floor(
      options.timeoutMs - (performance.now() - startedAt),
    );
    if (remainingTimeoutMs <= 0) {
      throw new HostRunError(
        `Claude authentication status check exhausted the ${options.timeoutMs}ms host timeout`,
        { executionPolicy },
      );
    }
    let result: RunProcessResult;
    try {
      result = await runProcess(
        'claude',
        claudeRunJsonArgs(schema, executionPolicy),
        {
          timeoutMs: remainingTimeoutMs,
          killGraceMs: 2000,
          cwd,
          input: prompt,
          stdoutMaxBytes: MAX_HOST_STRUCTURED_OUTPUT_BYTES,
          stderrMaxBytes: MAX_HOST_DIAGNOSTIC_BYTES,
        },
      );
    } catch {
      throw new HostRunError(
        'Claude review host process failed before returning structured output',
        { executionPolicy },
      );
    }
    if (result.status !== 0) {
      throw new HostRunError(
        claudeProcessFailureMessage(result, executionPolicy),
        {
          executionPolicy,
          usage: claudeFailureUsage(result.stdout, executionPolicy),
        },
      );
    }
    if (result.stdoutTruncated) {
      throw new HostRunError(
        `claude structured output exceeds ${MAX_HOST_STRUCTURED_OUTPUT_BYTES} byte limit`,
        { executionPolicy },
      );
    }
    let parsed: HostResult;
    try {
      parsed = parseClaudeJson(result.stdout);
    } catch {
      throw new HostRunError(
        'Claude review returned invalid structured JSON',
        {
          executionPolicy,
          usage: claudeFailureUsage(result.stdout, executionPolicy),
        },
      );
    }
    return {
      ...parsed,
      usage: claudeUsageForPolicy(parsed.usage, executionPolicy),
      executionPolicy,
    };
  }
}

export function adapterFor(name: string | undefined): HostAdapter {
  if (!name || name === 'mock') return new MockHostAdapter();
  if (name === 'codex') return new CodexHostAdapter();
  if (name === 'claude') return new ClaudeHostAdapter();
  throw new Error(`unsupported workflow host adapter: ${name}`);
}


export function codexRunJsonArgs(schemaFile: string, outputFile: string): string[] {
  return [
    '-c',
    'mcp_servers={}',
    '--ask-for-approval',
    'never',
    'exec',
    '--ignore-user-config',
    '--ephemeral',
    '--sandbox',
    'read-only',
    '--json',
    '--output-schema',
    schemaFile,
    '-o',
    outputFile,
    '-',
  ];
}

export function claudeRunJsonArgs(
  schema: unknown,
  policy: ClaudeReviewBudgetPolicy,
): string[] {
  const args = [
    '-p',
    '--safe-mode',
    '--output-format',
    'json',
    '--disable-slash-commands',
    '--tools',
    'Read,Glob,Grep',
    '--disallowedTools',
    'Bash,Edit,Write',
  ];
  if (policy.maxBudgetUsd !== undefined) {
    args.push(
      '--max-budget-usd',
      formatClaudeReviewBudgetUsd(policy.maxBudgetUsd),
    );
  }
  args.push('--json-schema', JSON.stringify(schema));
  return args;
}

async function readClaudeAuthStatus(
  cwd: string,
  hostTimeoutMs: number,
): Promise<ClaudeAuthStatus> {
  const result = await runProcess('claude', ['auth', 'status', '--json'], {
    timeoutMs: Math.min(CLAUDE_AUTH_STATUS_TIMEOUT_MS, hostTimeoutMs),
    killGraceMs: 2000,
    cwd,
    stdoutMaxBytes: MAX_CLAUDE_AUTH_STATUS_BYTES,
    stderrMaxBytes: MAX_HOST_DIAGNOSTIC_BYTES,
  });
  if (result.status !== 0) {
    throw new Error(
      `Claude authentication status check failed (exit status ${result.status ?? 'unknown'})`,
    );
  }
  if (result.stdoutTruncated) {
    throw new Error(
      `Claude authentication status exceeds ${MAX_CLAUDE_AUTH_STATUS_BYTES} byte limit`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    throw new Error(
      `Claude authentication status check returned invalid JSON (exit status ${result.status ?? 'unknown'})`,
    );
  }
  const record = recordValue(parsed);
  if (
    !record ||
    typeof record.loggedIn !== 'boolean' ||
    typeof record.authMethod !== 'string'
  ) {
    throw new Error('Claude authentication status returned an invalid contract');
  }
  return {
    loggedIn: record.loggedIn,
    authMethod: record.authMethod,
    apiProvider:
      typeof record.apiProvider === 'string' ? record.apiProvider : undefined,
  };
}

export function runProcess(
  command: string,
  args: string[],
  options: RunProcessOptions,
): Promise<RunProcessResult> {
  return superviseCommand(command, args, {
    cwd: options.cwd,
    timeoutMs: options.timeoutMs,
    killGraceMs: options.killGraceMs ?? 2000,
    captureOutput: {
      stdoutMaxBytes: options.stdoutMaxBytes,
      stderrMaxBytes: options.stderrMaxBytes,
    },
    label: 'goldband workflow',
    stdout: { write() {} },
    stderr: { write() {} },
    input: options.input,
  }).then((result) => {
    let stderr = result.stderr;
    let stderrTruncated = result.stderrTruncated;
    if (result.reason === 'timeout') {
      stderr += `\n${command} timed out after ${options.timeoutMs}ms`;
      if (result.forceKilled) {
        stderr += `\n${command} killed after failing to exit on SIGTERM`;
      }
      const bounded = boundedUtf8Tail(stderr, options.stderrMaxBytes);
      stderr = bounded.text;
      stderrTruncated = stderrTruncated || bounded.truncated;
    }
    return {
      status:
        result.reason === 'exit' || result.reason === 'spawn-error'
          ? result.exitCode
          : null,
      stdout: result.stdout,
      stderr,
      stdoutTruncated: result.stdoutTruncated,
      stderrTruncated,
    };
  });
}

function boundedUtf8Tail(
  value: string,
  maxBytes: number,
): { text: string; truncated: boolean } {
  const buffer = Buffer.from(value);
  if (buffer.length <= maxBytes) return { text: value, truncated: false };
  let start = buffer.length - maxBytes;
  while (start < buffer.length && (buffer[start] & 0xc0) === 0x80) start += 1;
  return { text: buffer.subarray(start).toString('utf8'), truncated: true };
}

function readStructuredResult(
  outputFile: string,
  usage?: HostUsage,
): HostResult {
  const size = statSync(outputFile).size;
  if (size > MAX_HOST_STRUCTURED_OUTPUT_BYTES) {
    throw new Error(
      `codex structured output exceeds ${MAX_HOST_STRUCTURED_OUTPUT_BYTES} byte limit`,
    );
  }
  const text = readFileSync(outputFile, 'utf8').trim();
  if (!text) throw new Error('codex structured output file is empty');
  return { text, parsed: JSON.parse(text), usage };
}

function processFailureMessage(result: RunProcessResult): string {
  const message = result.stderr || result.stdout || 'review host process failed';
  const truncated = [
    result.stderrTruncated ? 'stderr' : '',
    result.stdoutTruncated ? 'stdout' : '',
  ].filter(Boolean);
  return truncated.length > 0
    ? `${message}\n[goldband workflow] ${truncated.join(' and ')} diagnostics truncated to bounded tail`
    : message;
}

function claudeProcessFailureMessage(
  result: RunProcessResult,
  policy: ClaudeReviewBudgetPolicy,
): string {
  const parsed = parseJsonRecord(result.stdout);
  if (parsed?.subtype === 'error_max_budget_usd') {
    if (policy.billingMode === 'subscription') {
      return 'Claude unexpectedly reported a maximum-budget failure while Goldband had subscription estimated-dollar limits disabled; no structured findings were returned';
    }
    const cost = typeof parsed.total_cost_usd === 'number'
      ? ` after an estimated $${parsed.total_cost_usd.toFixed(2)}`
      : '';
    const cap = `at the metered $${formatClaudeReviewBudgetUsd(policy.maxBudgetUsd)} cap`;
    return `Claude review did not complete${cost}: maximum budget reported ${cap}; no structured findings were returned`;
  }
  return `Claude review failed (billing mode: ${policy.billingMode}, estimated-dollar cap: ${
    policy.maxBudgetUsd === undefined
      ? 'disabled'
      : `$${formatClaudeReviewBudgetUsd(policy.maxBudgetUsd)}`
  }): ${processFailureMessage(result)}`;
}

function claudeUsageForPolicy(
  usage: HostUsage | undefined,
  policy: ClaudeReviewBudgetPolicy,
): HostUsage | undefined {
  if (!usage || policy.billingMode === 'metered') return usage;
  const { costUsd: _estimatedCost, ...tokenUsage } = usage;
  return tokenUsage;
}

function claudeFailureUsage(
  stdout: string,
  policy: ClaudeReviewBudgetPolicy,
): HostUsage | undefined {
  const parsed = parseJsonRecord(stdout);
  return parsed
    ? claudeUsageForPolicy(claudeUsageFromRecord(parsed), policy)
    : undefined;
}

function parseJsonRecord(value: string): Record<string, unknown> | undefined {
  try {
    return recordValue(JSON.parse(value));
  } catch {
    return undefined;
  }
}

export function parseClaudeJson(stdout: string): HostResult {
  const parsed = JSON.parse(stdout);
  const parsedRecord = recordValue(parsed) ?? {};
  const usage = claudeUsageFromRecord(parsedRecord);
  if (typeof parsed.result === 'string') {
    return { text: parsed.result, parsed: JSON.parse(parsed.result), usage };
  }
  return { text: stdout, parsed, usage };
}

function claudeUsageFromRecord(
  parsedRecord: Record<string, unknown>,
): HostUsage | undefined {
  const baseUsage = usageFromCandidate(
    parsedRecord.usage,
    'claude-json',
    parsedRecord.model,
  );
  return baseUsage
    ? {
        ...baseUsage,
        costUsd: baseUsage.costUsd ?? numericValue(
          parsedRecord,
          'total_cost_usd',
          'cost_usd',
          'costUsd',
        ),
      }
    : undefined;
}

export function parseCodexUsage(stdout: string): HostUsage | undefined {
  const lines = stdout.split('\n').filter(Boolean).reverse();
  for (const line of lines) {
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (!event || typeof event !== 'object') continue;
    const item = event as Record<string, unknown>;
    const candidates = [
      item.usage,
      recordValue(item.data)?.usage,
      recordValue(item.turn)?.usage,
    ];
    for (const candidate of candidates) {
      const usage = usageFromCandidate(candidate, 'codex-jsonl', item.model);
      if (usage) return usage;
    }
  }
  return undefined;
}

function usageFromCandidate(
  candidate: unknown,
  source: HostUsage['source'],
  modelCandidate?: unknown,
): HostUsage | undefined {
  const usage = recordValue(candidate);
  if (!usage) return undefined;
  const result: HostUsage = {
    source,
    inputTokens: numericValue(usage, 'input_tokens', 'inputTokens'),
    cachedInputTokens: numericValue(
      usage,
      'cached_input_tokens',
      'cachedInputTokens',
      'cache_read_input_tokens',
    ),
    cacheCreationInputTokens: numericValue(
      usage,
      'cache_creation_input_tokens',
      'cacheCreationInputTokens',
    ),
    outputTokens: numericValue(usage, 'output_tokens', 'outputTokens'),
    totalTokens: numericValue(usage, 'total_tokens', 'totalTokens'),
    costUsd: numericValue(usage, 'total_cost_usd', 'cost_usd', 'costUsd'),
    model: typeof modelCandidate === 'string' ? modelCandidate : undefined,
  };
  const hasMeasurement = Object.entries(result)
    .some(([key, value]) => key !== 'source' && value !== undefined);
  return hasMeasurement ? result : undefined;
}

function numericValue(
  value: Record<string, unknown>,
  ...keys: string[]
): number | undefined {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === 'number' && Number.isFinite(candidate) && candidate >= 0) {
      return candidate;
    }
  }
  return undefined;
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object'
    ? value as Record<string, unknown>
    : undefined;
}
