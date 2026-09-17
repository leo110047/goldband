import type { ReviewEvidenceManifest } from './review-evidence';
import { restoreReviewExecution, reviewExecutionBoundary } from './review-execution-correction';

type Cell = ReviewEvidenceManifest['behaviorMatrix'][number];
type Operation = ReviewEvidenceManifest['providers'][number]['operations'][number];

export function reviewOperationBoundary(operation: Operation) {
  return {
    ...JSON.parse(JSON.stringify(operation)) as Operation,
    argv: undefined,
    requiredSystemTools: operation.requiredSystemTools ?? [],
  };
}

export type ReviewContractChange = {
  kind: 'behavior' | 'command' | 'execution';
  id: string;
  cellIds: string[];
  before: Record<string, unknown> | string[];
  after: Record<string, unknown> | string[];
};

export type ReviewContractAssessment = {
  preserved: boolean;
  summary: string;
};

export type ReviewContractReview = {
  changes: ReviewContractChange[];
  assessment?: ReviewContractAssessment;
};

// These fields describe semantics. String equality cannot prove that a check
// preserves its purpose, just as an unchanged argv cannot prove unchanged code.
// Structured coverage and execution boundaries remain enforced by lineage.
function behaviorDescription(cell: Cell): Record<string, string | undefined> {
  return {
    behavior: cell.behavior,
    input: cell.input,
    preconditions: cell.preconditions,
    expected: cell.expected,
    reason: cell.reason,
  };
}

/** Keep additions and hard boundaries, but do not accept unreviewed check semantics. */
export function preserveReviewContractSemantics(
  baseline: ReviewEvidenceManifest,
  current: ReviewEvidenceManifest,
): ReviewEvidenceManifest {
  const required = structuredClone(current);
  const cells = new Map(required.behaviorMatrix.map((cell) => [cell.id, cell]));
  const operations = new Map<string, Operation>(required.providers.flatMap((provider) => provider.operations
    .map((operation) => [`${provider.id}:${operation.id}`, operation] as const)));
  for (const change of reviewContractChanges([baseline], current)) {
    if (change.kind === 'behavior') Object.assign(cells.get(change.id)!, change.before);
    else if (change.kind === 'command') operations.get(change.id)!.argv = [...change.before as string[]];
    else {
      const index = required.providers.findIndex((provider) => provider.id === change.id);
      required.providers[index] = restoreReviewExecution(baseline.providers.find((provider) => provider.id === change.id)!, required.providers[index]!);
    }
  }
  return required;
}

export function reviewContractChanges(
  baselines: ReviewEvidenceManifest[],
  current: ReviewEvidenceManifest,
): ReviewContractChange[] {
  const changes = new Map<string, ReviewContractChange>();
  const successors = new Map(contractEntries(current).map((entry) => [`${entry.kind}:${entry.id}`, entry]));
  for (const baseline of baselines) {
    for (const { value: before, ...identity } of contractEntries(baseline)) {
      const after = successors.get(`${identity.kind}:${identity.id}`)?.value;
      if (!after || JSON.stringify(before) === JSON.stringify(after)) continue;
      const change = { ...identity, before, after };
      changes.set(JSON.stringify(change), change);
    }
  }
  return [...changes.values()];
}

function contractEntries(manifest: ReviewEvidenceManifest) {
  return [
    ...manifest.behaviorMatrix.map((cell) => ({
      kind: 'behavior' as const, id: cell.id, cellIds: [cell.id], value: behaviorDescription(cell),
    })),
    ...manifest.providers.flatMap((provider) => provider.operations.map((operation) => ({
      kind: 'command' as const, id: `${provider.id}:${operation.id}`,
      cellIds: provider.cellIds, value: operation.argv,
    }))),
    ...manifest.providers.filter((provider) => provider.executionContext.sandboxOwner === 'review-runtime').map((provider) => ({
      kind: 'execution' as const, id: provider.id, cellIds: provider.cellIds, value: reviewExecutionBoundary(provider),
    })),
  ];
}

export const reviewContractAssessmentJsonSchema = {
  type: ['object', 'null'],
  properties: {
    preserved: { type: 'boolean' },
    summary: { type: 'string' },
  },
  required: ['preserved', 'summary'],
  additionalProperties: false,
};

export function validateReviewContractAssessment(
  value: unknown,
  changes: ReviewContractChange[],
): ReviewContractAssessment | undefined {
  if (changes.length === 0) return undefined;
  const item = value as Partial<ReviewContractAssessment> | null;
  if (!item || typeof item.preserved !== 'boolean' ||
      typeof item.summary !== 'string' || !item.summary.trim()) {
    throw new Error('changed review checks require an explicit semantic contract assessment');
  }
  return { preserved: item.preserved, summary: item.summary };
}

export function reviewContractChangesPrompt(changes: ReviewContractChange[]): string {
  if (changes.length === 0) return '';
  return [
    'REVIEW_CONTRACT_CHANGES_START',
    JSON.stringify(changes),
    'REVIEW_CONTRACT_CHANGES_END',
    'Assess every changed check, behavior description, and execution environment in contractReview. For execution corrections, verify that the replacement runtime exercises the original operation and preserves its isolation and dependency requirements; registered settings alone do not prove this. Set preserved=true only when the original safety and acceptance requirements remain covered. Explain the evidence, including why a corrected check accepts valid input and still rejects invalid input. A passing replacement command alone is insufficient. Inspect the check implementation and its regression tests; reject weakened assertions, skipped paths, unconditional success, or unsupported equivalence. If preservation cannot be established, set preserved=false and explain what remains unverified. This is a semantic assessment, not proof that two command digests are identical.',
  ].join('\n');
}
