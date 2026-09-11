import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { stateRoot } from './evidence';
import { adapterFor, HostRunError, type HostExecutionPolicy, type HostUsage } from './host-adapter';
import { createReviewCandidateBinding, reviewLineageAuthority } from './review-evidence';
import { aggregateReviewFindings, unwrapFindings } from './review-engine';
import { reviewInputSchema, type ReviewDiffInput, type ReviewImpactContext } from './review-impact';
import { projectPriorReviewBlockers, reviewLineageScopeDigest, reviewPolicyIdentity } from './review-lineage';
import { coreReviewRules, createReviewRulesSnapshot, type RulesBundle } from './review-rules';
import { createReviewTimeBudget, type ReviewTimeoutPolicy } from './review-timeouts';
import { resolveReviewWorkspace } from './review-workspace';
import { findingsSchema } from './schema';
import type { ReviewFinding, WorkflowContext } from './types';

type SemanticReviewArtifact = {
  schemaVersion: 1;
  phase: 'semantic-only';
  evidenceStatus: 'not-declared';
  completionAuthorized: false;
  providerCallCount: 0;
  hostCallCount: 1;
  runId: string;
  binding: ReturnType<typeof createReviewCandidateBinding>;
  canonicalScopeDigest: string;
  policyIdentityDigest: string;
  identity: string;
  priorBlockers: ReturnType<typeof projectPriorReviewBlockers>;
  findings: ReviewFinding[];
};

type SemanticReviewDependencies = {
  collectDiff(ctx: WorkflowContext): ReviewDiffInput;
  buildReviewPrompt(ctx: WorkflowContext, diff: string, context: {
    rules: ReturnType<typeof coreReviewRules>; impact: ReviewImpactContext; policyText: string;
  }): string;
  buildReviewPolicyText(ctx: WorkflowContext, rules: ReturnType<typeof coreReviewRules>): string;
  hasConcreteFailurePath(finding: ReviewFinding): boolean;
  reviewHost(ctx: WorkflowContext): 'mock' | 'claude' | 'codex';
  recordReviewHostUsage(ctx: WorkflowContext, host: string, usage?: HostUsage, policy?: HostExecutionPolicy): void;
  recordReviewPromptTelemetry(ctx: WorkflowContext, host: string, prompt: string,
    bundle: RulesBundle, rules: string, diff: string, policy: ReviewTimeoutPolicy, impact: ReviewImpactContext): void;
  findingsJsonSchema: object;
};

const runs = new Map<string, SemanticReviewArtifact>();

export async function runSemanticReview(ctx: WorkflowContext, deps: SemanticReviewDependencies): Promise<ReviewFinding[]> {
  const input = reviewInputSchema.validate(ctx.input);
  if (input.impact.changedFiles.length === 0) throw new Error('semantic-only review candidate is empty');
  const cwd = resolveReviewWorkspace(ctx.cwd).repositoryRoot;
  const binding = createReviewCandidateBinding(cwd, input, ctx.options.base);
  const { rules, policyText, policyIdentityDigest } = semanticPolicy(ctx, deps, input, binding.baseRef);
  const canonicalScopeDigest = reviewLineageScopeDigest(binding.scopeDigest, { changedFiles: binding.changedFiles });
  const identity = digest({ mode: 'semantic-only', repository: binding.repository,
    baseDigest: binding.baseDigest, candidateDigest: binding.candidateDigest,
    canonicalScopeDigest, policyIdentityDigest });
  const authority = reviewLineageAuthority(ctx);
  const priorOptions = { storeRoot: authority.receiptRoot, key: authority.key, ...binding };
  projectPriorReviewBlockers(priorOptions);
  const budget = createReviewTimeBudget(ctx.options, undefined, ctx.passStartedAtMonotonicMs);
  const host = deps.reviewHost(ctx);
  const adapter = adapterFor(host);
  const prompt = deps.buildReviewPrompt(ctx, input.diff, { rules, impact: input.impact, policyText });
  deps.recordReviewPromptTelemetry(ctx, host, prompt, rules.bundle, rules.text, input.diff, budget.policy, input.impact);
  const timeoutMs = budget.nextHostTimeoutMs();
  // A durable exclusive attempt is the one-shot cost boundary, including failures
  // and concurrent processes. It is separate from acceptance lineage and receipts.
  const attempts = join(dirname(authority.receiptRoot), 'semantic-review-attempts');
  mkdirSync(attempts, { recursive: true, mode: 0o700 });
  try {
    writeFileSync(join(attempts, `${identity}.json`), JSON.stringify({ identity, runId: ctx.runId }), { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('duplicate semantic-only review identity; no new semantic host call authorized');
    throw error;
  }
  let result;
  try {
    result = await adapter.runJson(prompt, {
      type: 'object', properties: { findings: deps.findingsJsonSchema },
      required: ['findings'], additionalProperties: false,
    }, cwd, { timeoutMs, claudeMaxBudgetUsd: ctx.options.reviewClaudeMaxBudgetUsd });
  } catch (error) {
    if (error instanceof HostRunError) deps.recordReviewHostUsage(ctx, host, error.usage, error.executionPolicy);
    throw error;
  }
  deps.recordReviewHostUsage(ctx, host, result.usage, result.executionPolicy);
  const current = createReviewCandidateBinding(cwd, deps.collectDiff(ctx), ctx.options.base);
  if (digest(current) !== digest(binding) || semanticPolicy(ctx, deps, input, binding.baseRef).policyIdentityDigest !== policyIdentityDigest) {
    throw new Error('semantic-only candidate or Rules/policy changed during review');
  }
  const findings = semanticFindings(unwrapFindings(result.parsed), deps.hasConcreteFailurePath);
  runs.set(ctx.runId, {
    schemaVersion: 1, phase: 'semantic-only', evidenceStatus: 'not-declared',
    completionAuthorized: false, providerCallCount: 0, hostCallCount: 1,
    runId: ctx.runId, binding, canonicalScopeDigest, policyIdentityDigest, identity,
    priorBlockers: projectPriorReviewBlockers(priorOptions), findings,
  });
  return findings;
}

function semanticFindings(value: unknown, hasConcreteFailurePath: SemanticReviewDependencies['hasConcreteFailurePath']): ReviewFinding[] {
  const concerns: ReviewFinding[] = findingsSchema.validate(value).map((finding) => {
    // Project allowed semantic fields; model IDs and provenance never become authority.
    const { id: _id, evidenceIds: _evidenceIds, behaviorCellIds: _cells,
      blocking: _blocking, classification: _classification, ...concern } = finding;
    return { ...concern, category: concern.category === 'deterministic-evidence' ? 'semantic-review' : concern.category,
      classification: 'semantic-concern', blocking: false };
  });
  return aggregateReviewFindings(concerns).filter(hasConcreteFailurePath);
}

export function renderSemanticReport(ctx: WorkflowContext): string {
  const artifact = runs.get(ctx.runId);
  if (!artifact) throw new Error('semantic-only review result is missing');
  runs.delete(ctx.runId);
  artifact.findings = findingsSchema.validate(ctx.input);
  const lines = [
    '# review/code runtime report', '', 'Phase: semantic-only.',
    'Deterministic evidence: not-declared. Deterministic behavior completeness was not evaluated.',
    'No tests, evidence providers, or dependency preparation were executed. Completion authority: none.',
    `Candidate: ${artifact.binding.candidateDigest}.`,
    `Reading scope: ${artifact.binding.changedFiles.join(', ')} (scoped diff and necessary impact context).`,
    'Semantic host calls: 1. Evidence provider calls: 0.', '',
  ];
  if (artifact.priorBlockers.length) {
    lines.push('prior-blockers-open (read-only projection; no acceptance lineage was changed):');
    for (const blocker of artifact.priorBlockers) lines.push(`- ${blocker.lineageId}: ${blocker.findingId} — ${blocker.artifactFile ?? 'artifact unavailable'}`);
    lines.push('');
  }
  if (!artifact.findings.length) lines.push('No semantic concerns found.');
  lines.push(...semanticFindingLines(artifact.findings));
  const dir = join(stateRoot(ctx.options), 'workflow-runs', 'artifacts');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${ctx.runId}-semantic-only.json`);
  const reportFile = join(dir, `${ctx.runId}-semantic-only.md`);
  const report = `${lines.join('\n')}\n`;
  writeFileSync(file, `${JSON.stringify(artifact, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  writeFileSync(reportFile, report, { flag: 'wx', mode: 0o600 });
  ctx.artifacts.push(file, reportFile);
  return report;
}

function semanticPolicy(ctx: WorkflowContext, deps: SemanticReviewDependencies,
  input: ReturnType<typeof reviewInputSchema.validate>, baseRef: string) {
  const cwd = resolveReviewWorkspace(ctx.cwd).repositoryRoot;
  const snapshot = createReviewRulesSnapshot(cwd);
  const rules = coreReviewRules(cwd, input.diff, snapshot, input.impact.changedFiles);
  const policyText = deps.buildReviewPolicyText(ctx, rules);
  const policyIdentityDigest = digest({ policy: reviewPolicyIdentity(cwd, baseRef), policyText,
    rules: snapshot.manifest.rules.map((rule) => ({
      id: rule.id, contentHash: snapshot.rulesById[rule.id]?.contentHash,
    })),
  });
  return { rules, policyText, policyIdentityDigest };
}

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function semanticFindingLines(findings: ReviewFinding[]): string[] {
  const lines: string[] = [];
  for (const finding of findings) {
    lines.push(`- [semantic-concern] [${finding.severity}] ${finding.file}${finding.line ? `:${finding.line}` : ''}: ${finding.summary}`);
    if (finding.evidence) lines.push(`  Code observation (not execution evidence): ${finding.evidence}`);
    if (finding.failureScenario) lines.push(`  Trigger: ${finding.failureScenario}`);
    if (finding.recommendation) lines.push(`  Fix: ${finding.recommendation}`);
    if (finding.suggestedVerification) lines.push(`  Suggested verification (not executed): ${finding.suggestedVerification}`);
  }
  return lines;
}
