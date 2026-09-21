import type { EvidenceLevel, ReviewEvidenceManifest } from './review-evidence';

type Provider = ReviewEvidenceManifest['providers'][number];
type Operation = Provider['operations'][number];
const LEVELS: EvidenceLevel[] = ['fixture', 'local', 'sandboxed-service', 'live-provider', 'device-platform', 'production-readback'];

function operationExecution(operation: Operation) {
  return {
    network: operation.network,
    pythonRuntime: operation.pythonRuntime,
    requiredSystemTools: operation.requiredSystemTools,
    evidenceLevel: operation.evidenceLevel,
  };
}

export function reviewExecutionBoundary(provider: Provider) {
  return {
    executionContext: provider.executionContext,
    operations: provider.operations.map((operation) => ({ id: operation.id, ...operationExecution(operation), requiredSystemTools: operation.requiredSystemTools ?? [] })),
  };
}

/** Restore only execution fields; keep candidate commands and structural coverage. */
export function restoreReviewExecution(before: Provider, after: Provider): Provider {
  return {
    ...after,
    executionContext: structuredClone(before.executionContext),
    operations: after.operations.map((operation) => {
      const original = before.operations.find((entry) => entry.id === operation.id);
      return original ? { ...operation, ...structuredClone(operationExecution(original)) } : operation;
    }),
  };
}

/** The caller supplies the actual runtime-store baseline, never a candidate extension. */
export function isRegisteredExecutionCorrection(
  before: Provider | undefined,
  after: Provider | undefined,
  registered: Provider | undefined,
): boolean {
  if (!before || !after || !registered || before.id !== after.id || after.id !== registered.id) return false;
  if (!runtimeOwned(before) || !runtimeOwned(after)) return false;
  if (stable(reviewExecutionBoundary(before)) === stable(reviewExecutionBoundary(after))) return false;
  if (stable(reviewExecutionBoundary(after)) !== stable(reviewExecutionBoundary(registered))) return false;
  if (stable(withoutCommands(before)) !== stable(withoutCommands(restoreReviewExecution(before, after)))) return false;
  return before.operations.every((operation) => {
    const successor = after.operations.find((entry) => entry.id === operation.id)!;
    return LEVELS.indexOf(successor.evidenceLevel) >= LEVELS.indexOf(operation.evidenceLevel);
  });
}

function runtimeOwned(provider: Provider): boolean {
  return provider.executionContext.sandboxOwner === 'review-runtime' &&
    ['sealed', 'container'].includes(provider.executionContext.runner) &&
    provider.operations.every((operation) => ['deny', 'isolated'].includes(operation.network));
}

function withoutCommands(provider: Provider) {
  return { ...provider, operations: provider.operations.map((operation) => ({ ...operation, argv: undefined })) };
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value)
    .filter(([, entry]) => entry !== undefined).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stable(entry)}`).join(',')}}`;
  return JSON.stringify(value);
}
