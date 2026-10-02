import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runContainerReviewEvidence } from '../../../workflows/review-container-evidence';
import { reviewEvidenceManifestSchema } from '../../../workflows/review-evidence';
import { runLocalReviewEvidence } from '../../../workflows/review-local-evidence';

const root = process.argv[2]!;
const config = JSON.parse(readFileSync(join(root, 'operation.json'), 'utf8'));
if (process.argv[3] === 'local') {
  const id = 'review-container-lifecycle-tests';
  config.manifest.behaviorMatrix[0].providerIds = [id];
  config.manifest.providers[0] = { ...config.manifest.providers[0], id, kind: 'project-gate',
    executionContext: { sandboxOwner: 'provider', runner: 'local-host', lane: 'goldband-local-review-host' },
    operations: [{ id: 'candidate-container-lifecycle', target: 'candidate',
      argv: ['bun', 'test', '--cwd', 'goldband-loop', 'test/review-container-lifecycle.test.ts'],
      expectedExit: 'zero', timeoutMs: 30000, maxOutputBytes: 16384, network: 'host', evidenceLevel: 'local' }],
  };
  const provider = reviewEvidenceManifestSchema.validate(config.manifest).providers[0]!;
  const runnerRoot = join(root, 'local-runner'); mkdirSync(runnerRoot);
  const record = await runLocalReviewEvidence({ provider, operation: provider.operations[0]!, binding: config.binding,
    snapshotRoot: join(root, 'local-candidate'), runnerRoot, executionOffset: '', dependencyDigest: 'owned-fixture' },
    () => 'unchanged-owned-fixture');
  console.log(JSON.stringify({ status: record.status, outputSummary: record.outputSummary }));
} else {
  const provider = reviewEvidenceManifestSchema.validate(config.manifest).providers[0]!;
  const runnerRoot = join(root, `runner-${process.pid}`);
  mkdirSync(runnerRoot);
  writeFileSync(join(root, 'broker.pid'), String(process.pid));
  const digest = () => createHash('sha256').update(readFileSync(join(root, 'snapshot', 'candidate.txt'))).digest('hex');
  try {
    const record = await runContainerReviewEvidence({ provider, operation: provider.operations[0]!,
      binding: config.binding, snapshotRoot: join(root, 'snapshot'), runnerRoot, executionOffset: '' },
      digest, (value, limit) => value.slice(0, limit));
    console.log(JSON.stringify({ status: record.status, outputSummary: record.outputSummary }));
  } catch (error) {
    console.error(String(error));
    process.exitCode = 1;
  }
}
