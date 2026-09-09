#!/usr/bin/env bun

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveGoldbandStateRoot } from '../lib/state-root';
import {
  evaluateEvidenceCompleteness,
  PYTHON_RUNTIME_GUIDANCE,
  reviewEvidenceManifestSchema,
  type ReviewEvidenceManifest,
} from './review-evidence';
import {
  digestManifest,
  importReviewContract,
  inspectReviewContractStore,
  readReviewContractManifest,
  removeReviewContract,
  type ReviewContractStoreInspection,
} from './review-contract-store';
import { isRegisteredReviewContractExtension } from './review-contract-resolution';
import { assertReviewContractBoundary } from './review-lineage';
import { reviewContractChanges } from './review-contract-changes';
import { resolveReviewWorkspace } from './review-workspace';

type Command = 'help' | 'init' | 'inspect' | 'import' | 'remove' | 'validate';
type AuthoringAssets = { guide: string; example: string; schema: string };
type CliSelection = {
  command: Command;
  manifestFile?: string;
  outputFile?: string;
  goldbandHome?: string;
};

const COMPATIBILITY_IDENTITY = 'review-evidence-schema-v2/runtime-contract-v2';
const DEFAULT_MANIFEST_FILE = 'goldband.review-evidence.json';
const SCAFFOLD_CELL_ID = 'project-evidence-contract';
const COMMANDS = new Set<Command>(['help', 'init', 'inspect', 'import', 'remove', 'validate']);

export function createReviewContractScaffold(): ReviewEvidenceManifest {
  return {
    schemaVersion: 2,
    behaviorMatrix: [{
      id: SCAFFOLD_CELL_ID,
      behavior: 'Project-owned behavior and verification requirements are declared before review.',
      kind: 'boundary',
      input: 'the scoped candidate',
      preconditions: 'replace this scaffold with project-specific behavior cells and evidence providers',
      expected: 'every required project behavior is covered by fresh evidence at the declared level',
      risk: 'high',
      disposition: 'unsupported',
      providerIds: [],
      reason: 'Scaffold only: the project owner must declare real behavior and evidence providers before semantic review can become eligible.',
    }],
    providers: [],
    authorizations: [],
  };
}

export function initializeReviewContract(
  cwd: string,
  outputFile?: string,
): { output: string; digest: string; blockingCellIds: string[] } {
  const workspace = resolveReviewWorkspace(cwd);
  const output = resolveReviewContractOutput(cwd, workspace.repositoryRoot, outputFile);
  if (existsSync(output)) throw new Error(`refusing to overwrite existing review contract: ${output}`);
  const manifest = reviewEvidenceManifestSchema.validate(createReviewContractScaffold());
  const completeness = evaluateEvidenceCompleteness(manifest, []);
  if (completeness.hostEligible || completeness.blockingCellIds.length === 0) {
    throw new Error('review contract scaffold must remain fail closed');
  }
  try {
    writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx', mode: 0o644 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error(`refusing to overwrite existing review contract: ${output}`);
    }
    throw error;
  }
  return {
    output: realpathSync(output),
    digest: digestManifest(manifest),
    blockingCellIds: completeness.blockingCellIds,
  };
}

function resolveReviewContractOutput(cwd: string, repositoryRoot: string, outputFile?: string): string {
  const requested = outputFile ? resolve(cwd, outputFile) : join(repositoryRoot, DEFAULT_MANIFEST_FILE);
  const output = join(realpathSync(dirname(requested)), basename(requested));
  const outputOffset = relative(realpathSync(repositoryRoot), output);
  if (isAbsolute(outputOffset) || outputOffset === '..' || outputOffset.startsWith(`..${sep}`)) {
    throw new Error('review contract output must stay inside the canonical Git repository');
  }
  return output;
}

export function validateReviewContractFile(
  manifestFile: string,
  cwd = process.cwd(),
): {
  valid: true;
  source: string;
  compatibilityIdentity: string;
  digest: string;
  behaviorCellIds: string[];
  providerIds: string[];
  authorizationIds: string[];
} {
  const { source, manifest } = readReviewContractManifest(manifestFile, cwd);
  return {
    valid: true,
    source,
    compatibilityIdentity: COMPATIBILITY_IDENTITY,
    digest: digestManifest(manifest),
    behaviorCellIds: manifest.behaviorMatrix.map((cell) => cell.id).sort(),
    providerIds: manifest.providers.map((provider) => provider.id).sort(),
    authorizationIds: manifest.authorizations.map((authorization) => authorization.id).sort(),
  };
}

export function reviewContractAuthoringAssets(
  moduleFile = fileURLToPath(import.meta.url),
): AuthoringAssets {
  const runtimeRoot = dirname(dirname(realpathSync(moduleFile)));
  return {
    guide: resolveAuthoringAsset(runtimeRoot, 'review/review-evidence-manifest.md', '../docs/review-evidence-manifest.md'),
    example: resolveAuthoringAsset(runtimeRoot, 'review/examples/minimal-local-gate.json', '../examples/review-evidence/minimal-local-gate.json'),
    schema: resolveAuthoringAsset(runtimeRoot, 'review/schemas/review-evidence-manifest.schema.json', '../schemas/review-evidence-manifest.schema.json'),
  };
}

function resolveAuthoringAsset(runtimeRoot: string, installedRelative: string, sourceRelative: string): string {
  for (const candidate of [resolve(runtimeRoot, installedRelative), resolve(runtimeRoot, sourceRelative)]) {
    if (existsSync(candidate)) return realpathSync(candidate);
  }
  throw new Error(`review contract authoring asset is missing: ${installedRelative}`);
}

export function runReviewContractCli(args: string[]): number {
  const selection = parseReviewContractArgs(args);
  const cwd = process.cwd();
  if (runAuthoringCommand(selection, cwd)) return 0;
  const stateRoot = resolveGoldbandStateRoot(selection.goldbandHome);
  const before = inspectReviewContractStore(cwd, stateRoot);
  if (selection.command === 'inspect') {
    console.log(JSON.stringify(renderInspection(before), null, 2));
    return 0;
  }
  const after = selection.command === 'import'
    ? importReviewContract(cwd, stateRoot, selection.manifestFile!)
    : removeReviewContract(cwd, stateRoot);
  console.log(JSON.stringify({
    schemaVersion: 1,
    operation: selection.command,
    before: renderInspection(before),
    after: renderInspection(after),
  }, null, 2));
  return 0;
}

function parseReviewContractArgs(input: string[]): CliSelection {
  const args = [...input];
  const selected = args.shift();
  const command = selected === '-h' || selected === '--help' ? 'help' : selected as Command | undefined;
  if (!command || !COMMANDS.has(command)) usage();
  const selection: CliSelection = { command };
  for (let index = 0; index < args.length; index += 2) {
    parseReviewContractOption(selection, args[index], args[index + 1]);
  }
  if ((command === 'import' || command === 'validate') && !selection.manifestFile) {
    throw new Error(`review contract ${command} requires --manifest <path>`);
  }
  if (selection.goldbandHome && !isAbsolute(selection.goldbandHome)) {
    throw new Error('review contract state root must be absolute');
  }
  return selection;
}

function parseReviewContractOption(selection: CliSelection, flag?: string, value?: string): void {
  const { command } = selection;
  if (flag === '--manifest' && (command === 'import' || command === 'validate') && value && !selection.manifestFile) {
    selection.manifestFile = value;
    return;
  }
  if (flag === '--output' && command === 'init' && value && !selection.outputFile) {
    selection.outputFile = value;
    return;
  }
  if (flag === '--goldband-home' && ['inspect', 'import', 'remove'].includes(command) && value && !selection.goldbandHome) {
    selection.goldbandHome = value;
    return;
  }
  throw new Error(`review contract ${command}: invalid or repeated option ${flag ?? 'option'}`);
}

function runAuthoringCommand(selection: CliSelection, cwd: string): boolean {
  const assets = reviewContractAuthoringAssets;
  if (selection.command === 'help') {
    printJson({ schemaVersion: 1, operation: 'help', commands: {
      init: 'goldband review contract init [--output <path>]',
      validate: 'goldband review contract validate --manifest <path>',
      inspect: 'goldband review contract inspect',
      import: 'goldband review contract import --manifest <path>',
      remove: 'goldband review contract remove',
    }, pythonRuntime: PYTHON_RUNTIME_GUIDANCE, assets: assets(), authority: 'validate uses the installed runtime validator; success does not mean evidence ran or review completed' });
    return true;
  }
  if (selection.command === 'init') {
    printJson({ schemaVersion: 1, operation: 'init', ...initializeReviewContract(cwd, selection.outputFile), status: 'blocking-scaffold', assets: assets(), next: 'replace the scaffold with project-owned behavior and providers, then run review contract validate' });
    return true;
  }
  if (selection.command === 'validate') {
    printJson({ schemaVersion: 1, operation: 'validate', ...validateReviewContractFile(selection.manifestFile!, cwd), evidenceExecuted: false, completionAuthorized: false, assets: assets() });
    return true;
  }
  return false;
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function renderInspection(store: ReviewContractStoreInspection) {
  const repositoryFile = join(store.workspace.repositoryRoot, 'goldband.review-evidence.json');
  const candidateManifest = existsSync(repositoryFile)
    ? readRepositoryManifest(repositoryFile)
    : undefined;
  const base = readBaseRepositoryManifest(store.workspace.repositoryRoot, candidateManifest);
  const baseManifest = base?.manifest;
  const { baseline, baselineManifest, storeShadowed } = inspectionAuthority(store, baseManifest, candidateManifest);
  let candidateCompatibility: { valid: boolean; requiresSemanticReview?: boolean; reason?: string } | null = null;
  if (candidateManifest && baselineManifest) {
    try {
      assertReviewContractBoundary(baselineManifest, candidateManifest);
      candidateCompatibility = { valid: true, requiresSemanticReview: reviewContractChanges([baselineManifest], candidateManifest).length > 0 };
    } catch (error) {
      candidateCompatibility = {
        valid: false,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }
  return {
    schemaVersion: 1,
    repositoryIdentity: store.repository,
    repositoryRoot: store.workspace.repositoryRoot,
    invocationOffset: store.workspace.invocationOffset,
    compatibilityIdentity: COMPATIBILITY_IDENTITY,
    schemaMigration: base?.migrated
      ? { observedVersion: 1, supportedVersion: 2, source: base.source }
      : null,
    configured: Boolean(baseline),
    baseline: baseline ?? null,
    candidate: candidateManifest
      ? {
        identity: realpathSync(repositoryFile),
        digest: digestManifest(candidateManifest),
        trackingState: manifestTrackingState(store.workspace.repositoryRoot),
        baseDigest: baseManifest ? digestManifest(baseManifest) : null,
      }
      : null,
    candidateCompatibility,
    effectiveDigest: candidateManifest && baseline && candidateCompatibility?.valid
      ? digestManifest(candidateManifest)
      : baseline?.digest ?? null,
    runtimeStore: store.entry
      ? {
        present: true,
        shadowed: storeShadowed,
        identity: store.entryFile,
        digest: store.entry.manifestDigest,
        importedFrom: store.entry.importedFrom,
        importedAt: store.entry.importedAt,
      }
      : store.invalidReason
        ? {
          present: true,
          shadowed: storeShadowed,
          identity: store.entryFile,
          invalidReason: store.invalidReason,
        }
        : { present: false, shadowed: false, identity: store.entryFile },
  };
}

function inspectionAuthority(store: ReviewContractStoreInspection, baseManifest?: ReviewEvidenceManifest, candidateManifest?: ReviewEvidenceManifest) {
  const registryMigration = baseManifest && !candidateManifest && store.entry &&
    isRegisteredReviewContractExtension(baseManifest, store.entry.manifest);
  const baseline = baseManifest && !registryMigration
    ? {
      kind: 'repository' as const,
      identity: `git:${store.workspace.repositoryRoot}@HEAD:goldband.review-evidence.json`,
      digest: digestManifest(baseManifest),
    }
    : store.entry
      ? {
        kind: 'runtime-store' as const,
        identity: store.entryFile,
        digest: store.entry.manifestDigest,
      }
      : undefined;
  const baselineManifest = registryMigration ? store.entry?.manifest : baseManifest ?? store.entry?.manifest;
  return { baseline, baselineManifest, storeShadowed: Boolean(baseManifest) && !registryMigration };
}

function readRepositoryManifest(file: string): ReviewEvidenceManifest {
  try {
    return reviewEvidenceManifestSchema.validate(JSON.parse(readFileSync(resolve(file), 'utf8')));
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)}; source: ${file}`);
  }
}

function readBaseRepositoryManifest(
  repositoryRoot: string,
  candidateManifest?: ReviewEvidenceManifest,
): { manifest: ReviewEvidenceManifest; migrated: boolean; source: string } | undefined {
  const result = spawnSync('git', ['show', 'HEAD:goldband.review-evidence.json'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });
  if (result.status !== 0) return undefined;
  const source = `git:${repositoryRoot}@HEAD:goldband.review-evidence.json`;
  const value = JSON.parse(result.stdout) as Record<string, unknown>;
  try {
    if (value.schemaVersion === 1 && candidateManifest?.schemaVersion === 2) {
      try {
        return {
          manifest: reviewEvidenceManifestSchema.validate({ ...value, schemaVersion: 2 }),
          migrated: true,
          source,
        };
      } catch {
        reviewEvidenceManifestSchema.validate(value);
      }
    }
    return { manifest: reviewEvidenceManifestSchema.validate(value), migrated: false, source };
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)}; source: ${source}`);
  }
}

function manifestTrackingState(repositoryRoot: string): string {
  const trackedInHead = spawnSync(
    'git', ['cat-file', '-e', 'HEAD:goldband.review-evidence.json'], { cwd: repositoryRoot },
  ).status === 0;
  const trackedInIndex = spawnSync(
    'git', ['ls-files', '--error-unmatch', '--', 'goldband.review-evidence.json'], { cwd: repositoryRoot },
  ).status === 0;
  if (!trackedInIndex) return 'untracked';
  if (!trackedInHead) return 'staged-new';
  if (spawnSync('git', ['diff', '--cached', '--quiet', '--', 'goldband.review-evidence.json'], { cwd: repositoryRoot }).status !== 0) {
    return 'staged-modified';
  }
  if (spawnSync('git', ['diff', '--quiet', '--', 'goldband.review-evidence.json'], { cwd: repositoryRoot }).status !== 0) {
    return 'modified';
  }
  return 'unchanged';
}

function usage(): never {
  throw new Error(
    'Usage: goldband review contract help | goldband review contract init [--output <path>] | goldband review contract validate --manifest <path> | goldband review contract inspect | goldband review contract import --manifest <path> | goldband review contract remove',
  );
}

if (import.meta.main) {
  try {
    process.exitCode = runReviewContractCli(process.argv.slice(2));
  } catch (error) {
    console.error(`goldband: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
