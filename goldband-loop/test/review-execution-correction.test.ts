import { describe, expect, test } from 'bun:test';
import { isRegisteredExecutionCorrection, restoreReviewExecution } from '../workflows/review-execution-correction';
import { preserveReviewContractSemantics, reviewContractChanges, validateReviewContractAssessment } from '../workflows/review-contract-changes';
import { assertReviewContractBoundary } from '../workflows/review-lineage';
import { reviewEvidenceManifestSchema, type ReviewEvidenceManifest } from '../workflows/review-evidence';

type Provider = ReviewEvidenceManifest['providers'][number];

function fixture() {
  const before = reviewEvidenceManifestSchema.validate({
    schemaVersion: 2, authorizations: [],
    behaviorMatrix: [{ id: 'transactions', behavior: 'Transactions preserve rollback', kind: 'boundary',
      input: 'candidate', preconditions: 'isolated fixture', expected: 'rollback verified', risk: 'high',
      disposition: 'automated', providerIds: ['database'] }],
    providers: [{ id: 'database', owner: 'project', kind: 'runtime-integration', lifecycle: 'persistent',
      cellIds: ['transactions'], applicability: { kind: 'global', reason: 'Every transaction change' },
      executionContext: { sandboxOwner: 'review-runtime', runner: 'sealed' },
      operations: [{ id: 'rollback', target: 'candidate', argv: ['node', 'check.js'], expectedExit: 'zero',
        timeoutMs: 10000, maxOutputBytes: 8192, network: 'deny', evidenceLevel: 'local', requiredSystemTools: [] }] }],
  });
  const after = structuredClone(before);
  after.providers[0]!.executionContext = { sandboxOwner: 'review-runtime', runner: 'container',
    container: { image: `sha256:${'a'.repeat(64)}`, user: '1000:1000', environment: {}, tmpfs: [], memoryMb: 512, cpus: 1, workdir: '.' }, services: [] };
  Object.assign(after.providers[0]!.operations[0]!, { network: 'isolated', evidenceLevel: 'sandboxed-service' });
  return { before, after: reviewEvidenceManifestSchema.validate(after) };
}

describe('registered execution correction boundaries', () => {
  test('missing sealed system tools require exact registration and semantic assessment', () => {
    const { before } = fixture();
    const after = structuredClone(before);
    after.providers[0]!.operations[0]!.requiredSystemTools = ['mkdir'];
    expect(() => assertReviewContractBoundary(before, after)).toThrow('provider contract changed');
    expect(isRegisteredExecutionCorrection(before.providers[0], after.providers[0], undefined)).toBe(false);
    expect(isRegisteredExecutionCorrection(before.providers[0], after.providers[0], before.providers[0])).toBe(false);
    expect(isRegisteredExecutionCorrection(before.providers[0], after.providers[0], after.providers[0])).toBe(true);
    const candidate = structuredClone(after.providers[0]!);
    candidate.operations[0]!.requiredSystemTools = ['mkdir', 'curl'];
    expect(isRegisteredExecutionCorrection(before.providers[0], candidate, after.providers[0])).toBe(false);
    const changes = reviewContractChanges([before], after);
    expect(changes.map((entry) => entry.kind)).toEqual(['execution']);
    expect(() => validateReviewContractAssessment(undefined, changes)).toThrow('explicit semantic contract assessment');
    expect(preserveReviewContractSemantics(before, after)).toEqual(before);
  });

  test('requires exact registered execution and does not authorize a candidate extension', () => {
    const { before, after } = fixture();
    expect(() => assertReviewContractBoundary(before, after)).toThrow('provider contract changed');
    expect(isRegisteredExecutionCorrection(before.providers[0], after.providers[0], undefined)).toBe(false);
    expect(isRegisteredExecutionCorrection(before.providers[0], after.providers[0], before.providers[0])).toBe(false);
    expect(isRegisteredExecutionCorrection(before.providers[0], after.providers[0], after.providers[0])).toBe(true);
    const candidate = structuredClone(after.providers[0]!);
    if (candidate.executionContext.runner !== 'container') throw new Error('fixture');
    candidate.executionContext.container.image = `sha256:${'b'.repeat(64)}`;
    expect(isRegisteredExecutionCorrection(before.providers[0], candidate, after.providers[0])).toBe(false);
  });

  test.each([
    ['owner', (p: Provider) => { p.owner = 'another'; }],
    ['lifecycle', (p: Provider) => { p.lifecycle = 'transition'; }],
    ['coverage', (p: Provider) => { p.cellIds = []; }],
    ['applicability', (p: Provider) => { p.applicability = { kind: 'paths', pathPrefixes: ['other'] }; }],
    ['target', (p: Provider) => { p.operations[0]!.target = 'base'; }],
    ['expected exit', (p: Provider) => { p.operations[0]!.expectedExit = 'nonzero'; }],
    ['expected code', (p: Provider) => { p.operations[0]!.expectedExitCode = 1; }],
    ['seed', (p: Provider) => { p.operations[0]!.seed = 'different'; }],
    ['iterations', (p: Provider) => { p.operations[0]!.iterations = 1; }],
    ['timeout', (p: Provider) => { p.operations[0]!.timeoutMs = 1; }],
    ['operation removed', (p: Provider) => { p.operations = []; }],
    ['host network', (p: Provider) => { p.operations[0]!.network = 'host'; }],
    ['level downgrade', (p: Provider) => { p.operations[0]!.evidenceLevel = 'fixture'; }],
  ] as const)('registration cannot excuse changed %s', (_label, mutate) => {
    const { before, after } = fixture();
    mutate(after.providers[0]!);
    expect(isRegisteredExecutionCorrection(before.providers[0], after.providers[0], after.providers[0])).toBe(false);
  });

  test('compares each operation level even when another operation retains the maximum', () => {
    const { before, after } = fixture();
    for (const value of [before, after]) value.providers[0]!.operations.push({ ...value.providers[0]!.operations[0]!, id: 'second', evidenceLevel: 'sandboxed-service' });
    after.providers[0]!.operations[0]!.evidenceLevel = 'fixture';
    expect(isRegisteredExecutionCorrection(before.providers[0], after.providers[0], after.providers[0])).toBe(false);
  });

  test('execution and command changes require assessment and remain original until accepted', () => {
    const { before, after } = fixture();
    after.providers[0]!.operations[0]!.argv = ['node', 'corrected.js'];
    const changes = reviewContractChanges([before], after);
    expect(changes.map((entry) => entry.kind).sort()).toEqual(['command', 'execution']);
    expect(() => validateReviewContractAssessment(undefined, changes)).toThrow('explicit semantic contract assessment');
    expect(preserveReviewContractSemantics(before, after)).toEqual(before);
    expect(restoreReviewExecution(before.providers[0]!, after.providers[0]!).operations[0]!.argv).toEqual(['node', 'corrected.js']);
  });
});
