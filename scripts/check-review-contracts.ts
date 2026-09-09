#!/usr/bin/env bun

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  reviewEvidenceManifestSchema,
  selectedEvidenceProviderIds,
} from '../goldband-loop/workflows/review-evidence';
import {
  declaredDispatchContract,
  workflowSourceInputManifest,
} from './lib/workflow-distribution-contract.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

try {
  const rootManifest = reviewEvidenceManifestSchema.validate(
    readJson(
      join(root, 'goldband-loop/test/fixtures/review-contracts/goldband.json'),
    ),
  );
  reviewEvidenceManifestSchema.validate(
    readJson(
      join(root, 'goldband-loop/test/fixtures/review-contracts/loop.json'),
    ),
  );
  assert.deepEqual(
    selectedEvidenceProviderIds(rootManifest, [
      'goldband-loop/test/codex-review-launcher-install.test.ts',
    ]),
    ['installed-runtime-tests', 'python-runtime-tests', 'workflow-typecheck'],
    'single installed-runtime test change selected unrelated review providers',
  );
  assert.deepEqual(
    selectedEvidenceProviderIds(rootManifest, [
      'goldband-loop/lib/evidence-runtime-contract.ts',
    ]),
    ['installed-runtime-tests', 'workflow-typecheck'],
    'evidence runtime contract change omitted installed runtime verification',
  );
  assert.deepEqual(
    selectedEvidenceProviderIds(rootManifest, [
      'goldband-loop/test/work-map-review.test.ts',
    ]),
    ['work-map-review-tests', 'workflow-typecheck'],
    'single Work Map test change selected unrelated review providers',
  );
  const dispatch = declaredDispatchContract(join(root, 'goldband-loop'));
  assert.deepEqual(dispatch.trustedLauncher, [
    'browser/session',
    'plan/create',
    'plan/sync',
    'review/code',
  ]);
  assert.ok(dispatch.promptContract.includes('investigate/code'));
  assert.ok(dispatch.registeredOnly.length > 0);
  const source = workflowSourceInputManifest(join(root, 'goldband-loop'));
  assert.match(source.digest, /^[a-f0-9]{64}$/);
  const sourcePaths = new Set(
    source.inputs.map((entry: { path?: string }) => entry.path),
  );
  for (const required of [
    'docs/review-evidence-manifest.md',
    'examples/review-evidence/minimal-local-gate.json',
    'goldband-loop/bin/goldband.ts',
    'goldband-loop/bunfig.toml',
    'goldband-loop/design/dist/design',
    'goldband-loop/goldband-upgrade/migrations/v1.27.0.0.sh',
    'goldband-loop/plan-devex-review/dx-hall-of-fame.md',
    'goldband-loop/qa/references/issue-taxonomy.md',
    'goldband-loop/qa/templates/qa-report-template.md',
    'goldband-loop/scripts/prepare-internal-workflow-root.sh',
    'goldband-loop/tsconfig.json',
    'goldband-loop/VERSION',
    'goldband-loop/workflows/review-evidence.ts',
    'goldband-loop/review/shared-rubric.md',
    'hooks/scripts/lib/rules-resolver.js',
    'rules/manifest.json',
    'schemas/review-behavior-matrix.schema.json',
    'schemas/review-evidence-manifest.schema.json',
  ]) {
    assert.ok(
      sourcePaths.has(required),
      `installer-owned source digest omitted ${required}`,
    );
  }
  console.log(
    '[OK] review contract lifecycle, applicability, execution context, and distribution inputs are fresh',
  );
} catch (error) {
  console.error('[review-contract freshness failure]');
  console.error(error instanceof Error ? error.message : String(error));
  console.error(
    'fix: update the owning manifest/provider, its explicit scope and execution context, or rebuild the installer-owned runtime contract',
  );
  process.exitCode = 1;
}

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(file, 'utf8'));
}
