import { afterEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import {
  buildClosureInput,
  claimInitialReviewClosure,
  classifyReviewFindings,
  createCandidateBinding,
  evaluateEvidenceCompleteness,
  executeEvidencePlan,
  evidenceRuntimeReadAccess,
  isEvidenceSandboxRuntimeFailure,
  loadReviewEvidenceManifest,
  readClosureArtifact,
  reviewEvidenceManifestSchema,
  runtimeImageContentDigest,
  runtimeLibraryLiteralPaths,
  selectedUvLockArtifact,
  selectedEvidenceProviderIds,
  transitionEvidenceOperationContractDigest,
  validateMaterializedPythonEnvironment,
  validateClosureResults,
  validateInitialReviewArtifact,
  validateTransitionReviewEvidenceManifest,
  writeInitialReviewArtifact,
  type InitialReviewArtifact,
  type ReviewEvidenceBundle,
  type ReviewEvidenceManifest,
} from '../workflows/review-evidence';
import { getWorkflow } from '../workflows/registry';
import { readReviewCiResult, reviewCandidateTree, collectReviewCiEvidence, validateReviewCiProvenance } from '../workflows/review-ci-evidence';
import { assertReviewContractNotWeaker } from '../workflows/review-lineage';
import { runWorkflow } from '../workflows/runtime';
import {
  buildClosureReviewPrompt,
  buildReviewPrompt,
  hasConcreteFailurePath,
  untrackedFileDiff,
} from '../workflows/review';

const roots: string[] = [];
const requireReviewHostBoundary = process.env.GOLDBAND_REQUIRE_REVIEW_HOST_BOUNDARY === '1';

function hostBoundaryPrerequisite(available: boolean, detail: string): boolean {
  if (!available && requireReviewHostBoundary) {
    throw new Error(`required review host boundary prerequisite is unavailable: ${detail}`);
  }
  return available;
}

// Sealed Mach-O projection rewrites, signs, and re-attests a complete runtime
// before the supervised operation timeout begins.
setDefaultTimeout(20_000);

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('review evidence contracts', () => {
  test('manifest schema, repository manifests, and runtime validator share version 2', () => {
    const jsonSchema = JSON.parse(readFileSync(
      join(import.meta.dir, '../../schemas/review-evidence-manifest.schema.json'),
      'utf8',
    ));
    expect(jsonSchema.properties.schemaVersion.const).toBe(2);
    for (const file of [
      join(import.meta.dir, '../../goldband.review-evidence.json'),
      join(import.meta.dir, '../goldband.review-evidence.json'),
      join(import.meta.dir, 'fixtures/workflows/review-evidence-pass.json'),
    ]) {
      const value = JSON.parse(readFileSync(file, 'utf8'));
      expect(value.schemaVersion).toBe(2);
      expect(reviewEvidenceManifestSchema.validate(value).schemaVersion).toBe(2);
    }
  });

  test('attests Homebrew-style Mach-O rpath dependencies without widening directory reads', () => {
    if (!hostBoundaryPrerequisite(process.platform === 'darwin', 'platform=darwin')) return;
    const node = spawnSync('/usr/bin/which', ['node'], { encoding: 'utf8' }).stdout.trim();
    if (!hostBoundaryPrerequisite(Boolean(node), 'node executable')) return;
    const access = evidenceRuntimeReadAccess(node);
    expect(access.literals).toContain(realpathSync(node));
    expect(access.identityDigest).toMatch(/^[a-f0-9]{64}$/);
    const linked = spawnSync('/usr/bin/otool', ['-L', node], { encoding: 'utf8' }).stdout;
    if (linked.includes('@rpath/libnode')) {
      expect(access.literals.some((file) => /\/libnode[^/]*\.dylib$/.test(file))).toBe(true);
      expect(access.mapExecutableLiterals.some((file) => /\/libnode[^/]*\.dylib$/.test(file))).toBe(true);
    }
    for (const line of linked.split('\n').slice(1)) {
      const installName = line.trim().split(/\s+\(/, 1)[0];
      if (installName?.startsWith('/opt/homebrew/')) {
        expect(access.literals).toContain(installName);
        expect(access.mapExecutableLiterals).toContain(installName);
      }
    }
    if (linked.includes('/opt/homebrew/opt/libuv/lib/libuv.1.dylib')) {
      expect(access.literals).toContain('/opt/homebrew/opt/libuv');
      expect(access.literals).toContain('/opt/homebrew/opt/libuv/lib/libuv.1.dylib');
    }
    expect(access.roots.some((root) => root.startsWith('/opt/homebrew'))).toBe(false);
  });

  test('preserves native LC_RPATH declaration and loader-chain precedence in projections', async () => {
    if (!hostBoundaryPrerequisite(process.platform === 'darwin', 'platform=darwin')) return;
    const clang = spawnSync('/usr/bin/xcrun', ['--find', 'clang'], { encoding: 'utf8' });
    if (!hostBoundaryPrerequisite(clang.status === 0, 'xcrun clang')) return;
    const root = mkdtempSync(join(tmpdir(), 'review-runtime-rpath-'));
    roots.push(root);

    const directVendor = join(root, 'direct', 'z-vendor');
    const directFallback = join(root, 'direct', 'a-fallback');
    mkdirSync(directVendor, { recursive: true });
    mkdirSync(directFallback, { recursive: true });
    const directVendorLibrary = buildChoiceDylib(directVendor, 7);
    const directFallbackLibrary = buildChoiceDylib(directFallback, 42);
    const directMain = join(root, 'rpath-order-app');
    const directMainSource = join(root, 'rpath-order-main.c');
    writeFileSync(
      directMainSource,
      'extern int choice(void); int main(void) { return choice() == 7 ? 0 : 42; }\n',
    );
    compileMachO([
      directMainSource,
      '-L', directVendor,
      '-lchoice',
      '-Wl,-rpath,@loader_path/direct/z-vendor',
      '-Wl,-rpath,@loader_path/direct/a-fallback',
      '-o', directMain,
    ]);

    const chainVendor = join(root, 'chain', 'libA', 'z-vendor');
    const chainFallback = join(root, 'chain', 'a-fallback');
    mkdirSync(chainVendor, { recursive: true });
    mkdirSync(chainFallback, { recursive: true });
    const chainVendorLibrary = buildChoiceDylib(chainVendor, 7);
    const chainFallbackLibrary = buildChoiceDylib(chainFallback, 42);
    const chainLibrarySource = join(root, 'chain-library.c');
    const chainLibrary = join(root, 'chain', 'libA', 'libA.dylib');
    writeFileSync(
      chainLibrarySource,
      'extern int choice(void); int selected(void) { return choice(); }\n',
    );
    compileMachO([
      '-dynamiclib', chainLibrarySource,
      '-L', chainVendor,
      '-lchoice',
      '-install_name', '@rpath/libA.dylib',
      '-Wl,-rpath,@loader_path/z-vendor',
      '-o', chainLibrary,
    ]);
    const chainMain = join(root, 'rpath-chain-app');
    const chainMainSource = join(root, 'rpath-chain-main.c');
    writeFileSync(
      chainMainSource,
      'extern int selected(void); int main(void) { return selected() == 7 ? 0 : 42; }\n',
    );
    compileMachO([
      chainMainSource,
      '-L', join(root, 'chain', 'libA'),
      '-lA',
      '-Wl,-rpath,@loader_path/chain/libA',
      '-Wl,-rpath,@loader_path/chain/a-fallback',
      '-o', chainMain,
    ]);

    const diamondVendor = join(root, 'diamond', 'vendor');
    const diamondFallback = join(root, 'diamond', 'fallback');
    const diamondA = join(root, 'diamond', 'libA');
    const diamondB = join(root, 'diamond', 'libB');
    const diamondD = join(root, 'diamond', 'libD');
    for (const directory of [diamondVendor, diamondFallback, diamondA, diamondB, diamondD]) {
      mkdirSync(directory, { recursive: true });
    }
    const diamondVendorLibrary = buildChoiceDylib(diamondVendor, 7);
    const diamondFallbackLibrary = buildChoiceDylib(diamondFallback, 42);
    const diamondDSource = join(root, 'diamond-d.c');
    const diamondDLibrary = join(diamondD, 'libD.dylib');
    writeFileSync(
      diamondDSource,
      'extern int choice(void); int selected_d(void) { return choice(); }\n',
    );
    compileMachO([
      '-dynamiclib', diamondDSource,
      '-L', diamondVendor,
      '-lchoice',
      '-install_name', '@rpath/libD.dylib',
      '-Wl,-rpath,@loader_path/../vendor',
      '-o', diamondDLibrary,
    ]);
    const diamondASource = join(root, 'diamond-a.c');
    const diamondALibrary = join(diamondA, 'libA.dylib');
    writeFileSync(
      diamondASource,
      'extern int selected_d(void); int selected_a(void) { return selected_d(); }\n',
    );
    compileMachO([
      '-dynamiclib', diamondASource,
      '-L', diamondD,
      '-lD',
      '-install_name', '@rpath/libA.dylib',
      '-Wl,-rpath,@loader_path/../libD',
      '-o', diamondALibrary,
    ]);
    const diamondBSource = join(root, 'diamond-b.c');
    const diamondBLibrary = join(diamondB, 'libB.dylib');
    writeFileSync(
      diamondBSource,
      'extern int choice(void); int selected_b(void) { return choice(); }\n',
    );
    compileMachO([
      '-dynamiclib', diamondBSource,
      '-L', diamondFallback,
      '-lchoice',
      '-install_name', '@rpath/libB.dylib',
      '-Wl,-rpath,@loader_path/../fallback',
      '-o', diamondBLibrary,
    ]);
    const diamondMain = join(root, 'rpath-diamond-app');
    const diamondMainSource = join(root, 'rpath-diamond-main.c');
    writeFileSync(
      diamondMainSource,
      'extern int selected_a(void); extern int selected_b(void); ' +
        'int main(void) { return selected_a() == 7 && selected_b() == 7 ? 0 : 42; }\n',
    );
    compileMachO([
      diamondMainSource,
      '-L', diamondA,
      '-L', diamondB,
      '-lA',
      '-lB',
      '-Wl,-rpath,@loader_path/diamond/libA',
      '-Wl,-rpath,@loader_path/diamond/libB',
      '-o', diamondMain,
    ]);

    const absoluteIdDirectory = join(root, 'absolute-id');
    mkdirSync(absoluteIdDirectory, { recursive: true });
    const absoluteIdLibrary = join(absoluteIdDirectory, 'libAbsoluteA.dylib');
    const absoluteIdLibrarySource = join(root, 'absolute-id-library.c');
    writeFileSync(absoluteIdLibrarySource, 'int absolute_selected(void) { return 7; }\n');
    compileMachO([
      '-dynamiclib', absoluteIdLibrarySource,
      '-install_name', absoluteIdLibrary,
      '-o', absoluteIdLibrary,
    ]);
    const absoluteIdMain = join(root, 'absolute-id-app');
    const absoluteIdMainSource = join(root, 'absolute-id-main.c');
    writeFileSync(
      absoluteIdMainSource,
      'extern int absolute_selected(void); int main(void) { return absolute_selected() == 7 ? 0 : 42; }\n',
    );
    compileMachO([
      absoluteIdMainSource,
      '-L', absoluteIdDirectory,
      '-lAbsoluteA',
      '-o', absoluteIdMain,
    ]);
    const changedId = spawnSync(
      '/usr/bin/install_name_tool',
      ['-id', '@rpath/libAbsoluteA.dylib', absoluteIdLibrary],
      { encoding: 'utf8' },
    );
    expect(changedId.status).toBe(0);
    const signedLibrary = spawnSync(
      '/usr/bin/codesign',
      ['--force', '--sign', '-', '--timestamp=none', absoluteIdLibrary],
      { encoding: 'utf8' },
    );
    expect(signedLibrary.status).toBe(0);
    expect(spawnSync(absoluteIdMain, [], { encoding: 'utf8' }).status).toBe(0);
    const absoluteIdAccess = evidenceRuntimeReadAccess(absoluteIdMain);
    expect(absoluteIdAccess.images.map((image) => image.sourcePath))
      .toContain(realpathSync(absoluteIdLibrary));
    expect(absoluteIdAccess.links.some((link) => link.loaderPath === link.resolvedPath)).toBe(false);

    const weakRequiredDirectory = join(root, 'weak', 'required');
    const weakOptionalDirectory = join(root, 'weak', 'optional');
    mkdirSync(weakRequiredDirectory, { recursive: true });
    mkdirSync(weakOptionalDirectory, { recursive: true });
    const weakRequiredSource = join(root, 'weak-required.c');
    const weakRequiredLibrary = join(weakRequiredDirectory, 'libRequired.dylib');
    writeFileSync(weakRequiredSource, 'int required_choice(void) { return 7; }\n');
    compileMachO([
      '-dynamiclib', weakRequiredSource,
      '-install_name', weakRequiredLibrary,
      '-o', weakRequiredLibrary,
    ]);
    const weakOptionalSource = join(root, 'weak-optional.c');
    const weakOptionalLibrary = join(weakOptionalDirectory, 'libOptional.dylib');
    writeFileSync(weakOptionalSource, 'int optional_choice(void) { return 42; }\n');
    compileMachO([
      '-dynamiclib', weakOptionalSource,
      '-install_name', '@rpath/libOptional.dylib',
      '-o', weakOptionalLibrary,
    ]);
    const weakMain = join(root, 'missing-weak-app');
    const weakMainSource = join(root, 'missing-weak-main.c');
    writeFileSync(
      weakMainSource,
      'extern int required_choice(void); ' +
        'extern int optional_choice(void) __attribute__((weak_import)); ' +
        'int main(void) { return required_choice() == 7 && optional_choice == 0 ? 0 : 42; }\n',
    );
    compileMachO([
      weakMainSource,
      '-L', weakRequiredDirectory,
      '-lRequired',
      '-weak_library', weakOptionalLibrary,
      '-Wl,-rpath,@loader_path/weak/optional',
      '-o', weakMain,
    ]);
    const heldOptionalLibrary = join(root, 'held-libOptional.dylib');
    renameSync(weakOptionalLibrary, heldOptionalLibrary);

    const systemLeafCollisionDirectory = join(root, 'system-leaf-collision');
    mkdirSync(systemLeafCollisionDirectory, { recursive: true });
    const systemLeafVendor = join(systemLeafCollisionDirectory, 'libSystem.B.dylib');
    const systemLeafVendorSource = join(root, 'system-leaf-vendor.c');
    writeFileSync(systemLeafVendorSource, 'int vendor_choice(void) { return 7; }\n');
    compileMachO([
      '-dynamiclib', systemLeafVendorSource,
      '-install_name', systemLeafVendor,
      '-o', systemLeafVendor,
    ]);
    const systemLeafMain = join(root, 'system-leaf-collision-app');
    const systemLeafMainSource = join(root, 'system-leaf-main.c');
    writeFileSync(
      systemLeafMainSource,
      '#include <stdlib.h>\nextern int vendor_choice(void);\n' +
        'int main(void) { void *p = malloc(1); free(p); return vendor_choice() == 7 ? 0 : 42; }\n',
    );
    compileMachO([systemLeafMainSource, systemLeafVendor, '-o', systemLeafMain]);
    expect(spawnSync(systemLeafMain, [], { encoding: 'utf8' }).status).toBe(0);
    expect(evidenceRuntimeReadAccess(systemLeafMain).images.map((image) => image.sourcePath))
      .toContain(realpathSync(systemLeafVendor));

    const duplicateLeafA = join(root, 'duplicate-leaf', 'a');
    const duplicateLeafB = join(root, 'duplicate-leaf', 'b');
    mkdirSync(duplicateLeafA, { recursive: true });
    mkdirSync(duplicateLeafB, { recursive: true });
    const duplicateLibraryA = join(duplicateLeafA, 'libDuplicate.dylib');
    const duplicateLibraryB = join(duplicateLeafB, 'libDuplicate.dylib');
    const duplicateSourceA = join(root, 'duplicate-a.c');
    const duplicateSourceB = join(root, 'duplicate-b.c');
    writeFileSync(duplicateSourceA, 'int duplicate_a(void) { return 7; }\n');
    writeFileSync(duplicateSourceB, 'int duplicate_b(void) { return 42; }\n');
    compileMachO([
      '-dynamiclib', duplicateSourceA,
      '-install_name', duplicateLibraryA,
      '-o', duplicateLibraryA,
    ]);
    compileMachO([
      '-dynamiclib', duplicateSourceB,
      '-install_name', duplicateLibraryB,
      '-o', duplicateLibraryB,
    ]);
    const duplicateLeafMain = join(root, '_0');
    const duplicateLeafMainSource = join(root, 'duplicate-leaf-main.c');
    writeFileSync(
      duplicateLeafMainSource,
      'extern int duplicate_a(void); extern int duplicate_b(void); ' +
        'int main(void) { return duplicate_a() == 7 && duplicate_b() == 42 ? 0 : 99; }\n',
    );
    compileMachO([
      duplicateLeafMainSource,
      duplicateLibraryA,
      duplicateLibraryB,
      '-o', duplicateLeafMain,
    ]);
    expect(spawnSync(duplicateLeafMain, [], { encoding: 'utf8' }).status).toBe(0);
    const duplicateImages = evidenceRuntimeReadAccess(duplicateLeafMain)
      .images.map((image) => image.sourcePath);
    expect(duplicateImages).toContain(realpathSync(duplicateLibraryA));
    expect(duplicateImages).toContain(realpathSync(duplicateLibraryB));
    expect(spawnSync(weakMain, [], { encoding: 'utf8' }).status).toBe(0);
    const missingWeakAccess = evidenceRuntimeReadAccess(weakMain);
    expect(missingWeakAccess.missingWeakLinks).toContainEqual({
      loaderPath: realpathSync(weakMain),
      installName: '@rpath/libOptional.dylib',
    });
    renameSync(heldOptionalLibrary, weakOptionalLibrary);
    expect(evidenceRuntimeReadAccess(weakMain).identityDigest)
      .not.toBe(missingWeakAccess.identityDigest);
    renameSync(weakOptionalLibrary, heldOptionalLibrary);

    for (const [app, selectedLibrary, rejectedLibrary] of [
      [directMain, directVendorLibrary, directFallbackLibrary],
      [chainMain, chainVendorLibrary, chainFallbackLibrary],
      [diamondMain, diamondVendorLibrary, diamondFallbackLibrary],
    ]) {
      expect(spawnSync(app, [], { encoding: 'utf8' }).status).toBe(0);
      const images = evidenceRuntimeReadAccess(app).images.map((image) => image.sourcePath);
      expect(images).toContain(realpathSync(selectedLibrary));
      expect(images).not.toContain(realpathSync(rejectedLibrary));
    }

    const previousPath = process.env.PATH;
    process.env.PATH = `${root}:${previousPath ?? '/usr/bin:/bin'}`;
    try {
      for (const app of [
        directMain,
        chainMain,
        diamondMain,
        absoluteIdMain,
        weakMain,
        systemLeafMain,
        duplicateLeafMain,
      ]) {
        const repo = gitFixture();
        const value = manifest();
        value.providers[0]!.operations[0]!.argv = [basename(app)];
        const validated = reviewEvidenceManifestSchema.validate(value);
        const input = { source: 'git diff', diff: '', changedFiles: [] };
        const evidence = await executeEvidencePlan(
          context(repo), input, validated, createCandidateBinding(repo, input, validated),
        );
        expect(evidence.records[0]).toMatchObject({ status: 'verified-pass', fresh: true });
      }
    } finally {
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
    }
  });

  test('rejects PATH script launchers and requires an explicit interpreter', () => {
    if (!hostBoundaryPrerequisite(process.platform === 'darwin', 'platform=darwin')) return;
    const npm = spawnSync('/usr/bin/which', ['npm'], { encoding: 'utf8' }).stdout.trim();
    if (!hostBoundaryPrerequisite(Boolean(npm), 'npm executable')) return;
    expect(() => evidenceRuntimeReadAccess(npm)).toThrow('invoke an interpreter explicitly');
  });

  test('pre-main dyld load failure cannot satisfy an exact RED exit', async () => {
    if (!hostBoundaryPrerequisite(process.platform === 'darwin', 'platform=darwin')) return;
    const clang = spawnSync('/usr/bin/xcrun', ['--find', 'clang'], { encoding: 'utf8' });
    if (!hostBoundaryPrerequisite(clang.status === 0, 'xcrun clang')) return;
    const root = mkdtempSync(join(tmpdir(), 'review-runtime-missing-required-'));
    roots.push(root);
    const library = join(root, 'libRequired.dylib');
    const librarySource = join(root, 'required.c');
    writeFileSync(librarySource, 'int required_value(void) { return 7; }\n');
    compileMachO([
      '-dynamiclib', librarySource,
      '-install_name', library,
      '-o', library,
    ]);
    const app = join(root, 'missing-required-app');
    const appSource = join(root, 'missing-required-main.c');
    writeFileSync(
      appSource,
      'extern int required_value(void); int main(void) { return required_value() == 7 ? 0 : 42; }\n',
    );
    compileMachO([appSource, '-L', root, '-lRequired', '-o', app]);
    const missingInstallName = '/usr/lib/goldband-required-does-not-exist.dylib';
    expect(spawnSync(
      '/usr/bin/install_name_tool',
      ['-change', library, missingInstallName, app],
      { encoding: 'utf8' },
    ).status).toBe(0);
    expect(spawnSync(
      '/usr/bin/codesign',
      ['--force', '--sign', '-', '--timestamp=none', app],
      { encoding: 'utf8' },
    ).status).toBe(0);

    const repo = gitFixture();
    const value = manifest();
    value.providers[0] = {
      ...value.providers[0]!,
      kind: 'regression',
      operations: [
        {
          ...operation('red', [basename(app)], 'base', 'nonzero'),
          expectedExitCode: 1,
        },
        operation('green', ['true'], 'candidate', 'zero'),
      ],
    };
    const input = { source: 'git diff', diff: '', changedFiles: [] };
    const validated = validateTransitionManifest(value, repo, input);
    const previousPath = process.env.PATH;
    process.env.PATH = `${root}:${previousPath ?? '/usr/bin:/bin'}`;
    try {
      const evidence = await executeEvidencePlan(
        context(repo), input, validated, createCandidateBinding(repo, input, validated),
      );
      expect(evidence.records[0]).toMatchObject({
        status: 'runtime-incomplete',
        exitStatus: 1,
        fresh: false,
      });
    } finally {
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
    }
  });

  test('pre-main dyld symbol failure cannot satisfy an exact RED exit', async () => {
    if (!hostBoundaryPrerequisite(process.platform === 'darwin', 'platform=darwin')) return;
    const clang = spawnSync('/usr/bin/xcrun', ['--find', 'clang'], { encoding: 'utf8' });
    if (!hostBoundaryPrerequisite(clang.status === 0, 'xcrun clang')) return;
    const root = mkdtempSync(join(tmpdir(), 'review-runtime-missing-symbol-'));
    roots.push(root);
    const library = join(root, 'libSymbol.dylib');
    const librarySource = join(root, 'symbol.c');
    writeFileSync(librarySource, 'int required_symbol(void) { return 7; }\n');
    compileMachO([
      '-dynamiclib', librarySource,
      '-install_name', library,
      '-o', library,
    ]);
    const app = join(root, 'missing-symbol-app');
    const appSource = join(root, 'missing-symbol-main.c');
    writeFileSync(
      appSource,
      'extern int required_symbol(void); int main(void) { return required_symbol() == 7 ? 0 : 42; }\n',
    );
    compileMachO([appSource, '-L', root, '-lSymbol', '-o', app]);
    writeFileSync(librarySource, 'int replacement_symbol(void) { return 42; }\n');
    compileMachO([
      '-dynamiclib', librarySource,
      '-install_name', library,
      '-o', library,
    ]);
    const native = spawnSync(app, [], { encoding: 'utf8' });
    expect(native.signal).toBe('SIGABRT');
    expect(native.stderr).toMatch(/^dyld\[\d+\]: Symbol not found:/m);

    const repo = gitFixture();
    const value = manifest();
    value.providers[0] = {
      ...value.providers[0]!,
      kind: 'regression',
      operations: [
        {
          ...operation('red', [basename(app)], 'base', 'nonzero'),
          expectedExitCode: 1,
        },
        operation('green', ['true'], 'candidate', 'zero'),
      ],
    };
    const input = { source: 'git diff', diff: '', changedFiles: [] };
    const validated = validateTransitionManifest(value, repo, input);
    const previousPath = process.env.PATH;
    process.env.PATH = `${root}:${previousPath ?? '/usr/bin:/bin'}`;
    try {
      const evidence = await executeEvidencePlan(
        context(repo), input, validated, createCandidateBinding(repo, input, validated),
      );
      expect(evidence.records[0]).toMatchObject({
        status: 'runtime-incomplete',
        exitStatus: 1,
        fresh: false,
      });
    } finally {
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
    }
  });

  test('runtime image attestation does not reuse a same-size same-mtime digest', () => {
    const root = mkdtempSync(join(tmpdir(), 'review-runtime-image-'));
    roots.push(root);
    const file = join(root, 'image.dylib');
    const timestamp = new Date('2026-01-01T00:00:00.000Z');
    writeFileSync(file, 'first-runtime');
    utimesSync(file, timestamp, timestamp);
    const before = runtimeImageContentDigest(file);
    writeFileSync(file, 'other-runtime');
    utimesSync(file, timestamp, timestamp);
    expect(runtimeImageContentDigest(file)).not.toBe(before);
  });

  test('runtime library literals retain a lexical alias whose target is a system library', () => {
    const root = mkdtempSync(join(tmpdir(), 'review-runtime-alias-'));
    roots.push(root);
    const alias = join(root, 'libz-alias.dylib');
    symlinkSync('/usr/lib/libz.1.dylib', alias);
    const literals = runtimeLibraryLiteralPaths(alias, '/usr/lib/libz.1.dylib', ['/usr/lib']);
    expect(literals).toContain(alias);
    expect(literals).not.toContain('/usr/lib/libz.1.dylib');
  });

  test('classifies a dyld sandbox denial as an incomplete runner instead of a RED result', () => {
    expect(isEvidenceSandboxRuntimeFailure('/usr/bin/sandbox-exec', {
      reason: 'exit',
      exitCode: 1,
      stderr: [
        'dyld[123]: Library not loaded: /opt/homebrew/opt/libuv/lib/libuv.1.dylib',
        '  Referenced from: /opt/homebrew/Cellar/node@24/24.16.0/bin/node',
        "  Reason: tried: '/opt/homebrew/opt/libuv/lib/libuv.1.dylib' (file system sandbox blocked open())",
      ].join('\n'),
    })).toBe(true);
    expect(isEvidenceSandboxRuntimeFailure('/usr/bin/sandbox-exec', {
      reason: 'exit',
      exitCode: 134,
      stderr: [
        'dyld[123]: Library not loaded: /usr/lib/goldband-required-does-not-exist.dylib',
        '  Referenced from: /tmp/missing-required-app',
        "  Reason: tried: '/usr/lib/goldband-required-does-not-exist.dylib' (no such file)",
      ].join('\n'),
    })).toBe(true);
    expect(isEvidenceSandboxRuntimeFailure('/usr/bin/sandbox-exec', {
      reason: 'exit',
      exitCode: 1,
      stderr: 'ordinary assertion failure mentioning sandbox',
    })).toBe(false);
  });

  test('matrix completeness rejects missing dispositions, providers, and fuzz replay data', () => {
    const invalid = manifest();
    (invalid.behaviorMatrix[0] as { disposition?: string }).disposition = '';
    expect(() => reviewEvidenceManifestSchema.validate(invalid))
      .toThrow('behavior cell.disposition must be a non-empty string');

    const unknown = manifest();
    unknown.behaviorMatrix[0]!.providerIds = ['missing'];
    expect(() => reviewEvidenceManifestSchema.validate(unknown))
      .toThrow('references unknown provider missing');

    const fuzz = manifest();
    fuzz.providers[0]!.kind = 'property-fuzz';
    expect(() => reviewEvidenceManifestSchema.validate(fuzz))
      .toThrow('requires seed and iterations');

    const duplicateOperations = manifest();
    duplicateOperations.providers[0]!.operations.push(
      { ...duplicateOperations.providers[0]!.operations[0]! },
    );
    expect(() => reviewEvidenceManifestSchema.validate(duplicateOperations))
      .toThrow('operation IDs must be unique');

    const overstatedLevel = manifest();
    overstatedLevel.providers[0]!.operations[0]!.evidenceLevel = 'production-readback';
    expect(() => reviewEvidenceManifestSchema.validate(overstatedLevel))
      .toThrow('requires an authorized external runner');

    const oneWayCell = manifest();
    oneWayCell.behaviorMatrix[0]!.providerIds = [];
    oneWayCell.behaviorMatrix[0]!.disposition = 'not-applicable';
    oneWayCell.behaviorMatrix[0]!.reason = 'fixture';
    expect(() => reviewEvidenceManifestSchema.validate(oneWayCell))
      .toThrow('must authorize each other');

    const oneWayProvider = manifest();
    oneWayProvider.providers.push({
      ...oneWayProvider.providers[0]!,
      id: 'provider-b',
    });
    expect(() => reviewEvidenceManifestSchema.validate(oneWayProvider))
      .toThrow('must authorize each other');

    const ambiguousRed = manifest();
    ambiguousRed.providers[0]!.kind = 'regression';
    ambiguousRed.providers[0]!.operations = [
      { ...operation('red', ['false'], 'base', 'nonzero'), expectedExitCode: undefined },
      operation('green', ['true'], 'candidate', 'zero'),
    ];
    expect(() => reviewEvidenceManifestSchema.validate(ambiguousRed))
      .toThrow('requires expectedExitCode');
  });

  test('persistent manifests require explicit lifecycle, applicability, and execution context', () => {
    const missingLifecycle = structuredClone(manifest()) as unknown as {
      providers: Array<Record<string, unknown>>;
    };
    delete missingLifecycle.providers[0]!.lifecycle;
    expect(() => reviewEvidenceManifestSchema.validate(missingLifecycle))
      .toThrow('evidence provider.lifecycle must be a non-empty string');

    const emptyPaths = structuredClone(manifest());
    emptyPaths.providers[0]!.applicability = { kind: 'paths', pathPrefixes: [] };
    expect(() => reviewEvidenceManifestSchema.validate(emptyPaths))
      .toThrow('evidence provider.applicability.pathPrefixes must be a non-empty string array');

    const missingGlobalReason = structuredClone(manifest()) as unknown as {
      providers: Array<Record<string, unknown>>;
    };
    missingGlobalReason.providers[0]!.applicability = { kind: 'global' };
    expect(() => reviewEvidenceManifestSchema.validate(missingGlobalReason))
      .toThrow('evidence provider.applicability.reason must be a non-empty string');
  });

  test('transition evidence is exact-bound and cannot pollute a successor repository manifest', () => {
    const repo = gitFixture();
    const value = manifest();
    value.providers[0] = {
      ...value.providers[0]!,
      kind: 'regression',
      operations: [
        operation('red', ['node', 'check.mjs'], 'base', 'nonzero'),
        operation('green', ['true'], 'candidate', 'zero'),
      ],
    };
    expect(() => reviewEvidenceManifestSchema.validate(value)).toThrow(
      /provider-a.*operation=red.*actual=target:base,expectedExit:nonzero.*expected=persistent candidate\/zero.*owner=test.*scope=.*executionContext=.*fix=move exact RED evidence/,
    );
    const input = { source: 'git diff', diff: git(repo, ['diff']), changedFiles: ['a.ts'] };
    const transition = validateTransitionManifest(value, repo, input);
    expect(() => reviewEvidenceManifestSchema.validate(transition))
      .toThrow('cannot be stored in the repository-owned persistent manifest');
    const binding = createCandidateBinding(repo, input, transition);
    expect(() => validateTransitionReviewEvidenceManifest(transition, {
      ...binding,
      candidateDigest: 'f'.repeat(64),
    })).toThrow(/binding mismatch for candidateDigest.*owner=test.*fix=regenerate transition evidence/);

    const transitionFile = join(repo, 'transition-evidence.json');
    writeFileSync(transitionFile, `${JSON.stringify(transition)}\n`);
    const loaded = loadReviewEvidenceManifest(
      {
        ...context(repo),
        options: { mode: 'real' as const, evidenceManifestFile: transitionFile },
      },
      input,
    );
    expect(loaded.manifest.providers[0]!.lifecycle).toBe('transition');

    const reusableTransition = validateTransitionManifest(manifest(), repo, input);
    const reusableBinding = createCandidateBinding(repo, input, reusableTransition);
    const artifact = initialArtifact();
    artifact.binding = reusableBinding;
    artifact.evidence.binding = reusableBinding;
    artifact.evidence.manifest = reusableTransition;
    artifact.evidence.records[0] = {
      ...artifact.evidence.records[0]!,
      id: 'provider-a:pass',
      candidateDigest: reusableBinding.candidateDigest,
      baseDigest: reusableBinding.baseDigest,
      scopeDigest: reusableBinding.scopeDigest,
    };
    artifact.evidence.completeness = evaluateEvidenceCompleteness(
      reusableTransition,
      artifact.evidence.records,
    );
    artifact.findings[0]!.evidenceIds = ['provider-a:pass'];
    artifact.diff = input.diff;
    expect(validateInitialReviewArtifact(artifact).evidence.manifest.providers[0]!.lifecycle)
      .toBe('transition');
  });

  test('applicability selects only scoped providers and excludes unrelated cells from completeness', async () => {
    const value = manifest();
    value.providers[0]!.applicability = { kind: 'paths', pathPrefixes: ['src'] };
    const second = structuredClone(value.providers[0]!);
    second.id = 'global-provider';
    second.cellIds = ['behavior-b'];
    second.applicability = { kind: 'paths', pathPrefixes: ['docs'] };
    value.behaviorMatrix.push({
      ...value.behaviorMatrix[0]!,
      id: 'behavior-b',
      providerIds: ['global-provider'],
    });
    value.providers.push(second);
    expect(selectedEvidenceProviderIds(value, ['docs/readme.md'])).toEqual(['global-provider']);
    expect(selectedEvidenceProviderIds(value, ['src/owner.ts'])).toEqual(['provider-a']);
    const repo = gitFixture();
    const input = { source: 'git diff', diff: '', changedFiles: ['docs/readme.md'] };
    const validated = reviewEvidenceManifestSchema.validate(value);
    const evidence = await executeEvidencePlan(
      context(repo),
      input,
      validated,
      createCandidateBinding(repo, input, validated),
    );
    expect(evidence.records.map((record) => record.providerId)).toEqual(['global-provider']);
    expect(evidence.completeness.coverageGapCellIds).toEqual([]);
    expect(evidence.completeness.blockingCellIds).toEqual([]);
    expect(evidence.completeness.runtimeIncompleteCellIds).not.toContain('behavior-a');
    const passingRecords = evidence.records.map((record) => ({
      ...record,
      status: 'verified-pass' as const,
      fresh: true,
      exitStatus: 0,
    }));
    expect(evaluateEvidenceCompleteness(
      validated,
      passingRecords,
      validated.behaviorMatrix.filter((cell) => cell.id === 'behavior-b'),
    )).toMatchObject({
      complete: true,
      hostEligible: true,
      blockingCellIds: [],
      coverageGapCellIds: [],
    });

    const persisted = initialArtifact();
    persisted.binding = evidence.binding;
    persisted.evidence = evidence;
    persisted.diff = input.diff;
    persisted.findings[0]!.evidenceIds = [evidence.records[0]!.id];
    expect(validateInitialReviewArtifact(persisted).evidence.completeness)
      .toEqual(evidence.completeness);
  });

  test('source runtime cannot claim the installed host evidence lane', async () => {
    const repo = gitFixture();
    const value = manifest();
    value.providers[0]!.executionContext = {
      sandboxOwner: 'provider',
      runner: 'host-seatbelt',
      lane: 'macos-review-contract-host',
    };
    const validated = reviewEvidenceManifestSchema.validate(value);
    const input = { source: 'git diff', diff: '', changedFiles: [] };
    const evidence = await executeEvidencePlan(
      context(repo),
      input,
      validated,
      createCandidateBinding(repo, input, validated),
    );
    expect(evidence.records[0]).toMatchObject({
      status: 'runtime-incomplete',
      fresh: false,
      environment: 'source/review-runtime',
    });
    expect(evidence.records[0]!.exitStatus).toBeUndefined();
    expect(evidence.records[0]!.outputSummary).toContain('actual=source/review-runtime');
    expect(evidence.records[0]!.outputSummary).toContain('fix=run the named deterministic host lane');
    expect(evidence.completeness).toMatchObject({ complete: false, hostEligible: false });
  });

  test('persisted validation accepts a typed pre-execution runtime-incomplete record', () => {
    const repo = gitFixture();
    const input = { source: 'git diff', diff: '', changedFiles: [] };
    const value = validateTransitionManifest(manifest(), repo, input);
    const binding = createCandidateBinding(repo, input, value);
    const artifact = initialArtifact();
    artifact.binding = binding;
    artifact.evidence.binding = binding;
    artifact.evidence.manifest = value;
    artifact.diff = input.diff;
    const incomplete = {
      ...record(),
      id: 'provider-a:pass',
      status: 'runtime-incomplete' as const,
      fresh: false,
      exitStatus: undefined,
      executionIdentityDigest: undefined,
      candidateDigest: binding.candidateDigest,
      baseDigest: binding.baseDigest,
      scopeDigest: binding.scopeDigest,
    };
    artifact.evidence.records = [incomplete];
    artifact.evidence.completeness = evaluateEvidenceCompleteness(value, [incomplete]);
    artifact.findings[0]!.evidenceIds = [incomplete.id];

    expect(validateInitialReviewArtifact(artifact).evidence.records[0]).toMatchObject({
      status: 'runtime-incomplete',
      fresh: false,
    });
  });

  test('high-risk unsupported cells fail closed before a semantic host is eligible', () => {
    const value = manifest();
    value.behaviorMatrix[0] = {
      ...value.behaviorMatrix[0]!,
      disposition: 'unsupported',
      providerIds: [],
      reason: 'No device runner is available.',
    };
    value.providers = [];
    const validated = reviewEvidenceManifestSchema.validate(value);
    const completeness = evaluateEvidenceCompleteness(validated, [], validated.behaviorMatrix);
    expect(completeness).toEqual({
      complete: false,
      hostEligible: false,
      blockingCellIds: ['behavior-a'],
      coverageGapCellIds: ['behavior-a'],
      runtimeIncompleteCellIds: [],
    });
  });

  test('providerless manual and unsupported dispositions remain globally effective', async () => {
    const repo = gitFixture();
    const value = manifest();
    value.behaviorMatrix = [
      {
        ...value.behaviorMatrix[0]!,
        id: 'global-manual',
        risk: 'medium',
        disposition: 'manual',
        providerIds: [],
        reason: 'Owner readback is required.',
      },
      {
        ...value.behaviorMatrix[0]!,
        id: 'global-unsupported',
        disposition: 'unsupported',
        providerIds: [],
        reason: 'No approved device runner exists.',
      },
    ];
    value.providers = [];
    const validated = reviewEvidenceManifestSchema.validate(value);
    const input = {
      source: 'git diff',
      diff: 'diff --git a/unrelated.ts b/unrelated.ts',
      changedFiles: ['unrelated.ts'],
    };
    const evidence = await executeEvidencePlan(
      context(repo),
      input,
      validated,
      createCandidateBinding(repo, input, validated),
    );

    expect(evidence.records.map((record) => [record.id, record.status])).toEqual([
      ['cell:global-manual:manual', 'coverage-gap'],
      ['cell:global-unsupported:unsupported', 'coverage-gap'],
    ]);
    expect(evidence.completeness.coverageGapCellIds).toEqual([
      'global-manual',
      'global-unsupported',
    ]);
  });

  test('completeness rejects a record from a provider not authorized by the behavior cell', () => {
    const value = manifest();
    const forged = {
      ...record(),
      id: 'forged:pass',
      providerId: 'forged-provider',
      cellIds: ['behavior-a'],
    };
    expect(evaluateEvidenceCompleteness(value, [forged], value.behaviorMatrix)).toMatchObject({
      complete: false,
      hostEligible: false,
      blockingCellIds: ['behavior-a'],
      coverageGapCellIds: ['behavior-a'],
    });
  });

  test('high-risk unsupported evidence produces a blocker with zero host calls', async () => {
    const repo = gitFixture();
    const state = join(repo, '.state');
    const diffFile = join(repo, 'candidate.diff');
    const evidenceFile = join(repo, 'evidence.json');
    const value = manifest();
    value.behaviorMatrix[0] = {
      ...value.behaviorMatrix[0]!,
      disposition: 'unsupported',
      providerIds: [],
      reason: 'No approved device runner exists.',
    };
    value.providers = [];
    writeFileSync(evidenceFile, `${JSON.stringify(value)}\n`);
    writeFileSync(diffFile, 'diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old();\n+bad();\n');
    const result = await runWorkflow(getWorkflow('review/code'), {
      mode: 'mock',
      host: 'mock',
      cwd: repo,
      goldbandHome: state,
      diffFile: 'candidate.diff',
      evidenceManifestFile: 'evidence.json',
    });
    expect(String(result.output)).toContain('[coverage-gap]');
    expect(String(result.output)).toContain('Semantic host calls: 0.');
    expect(() => readFileSync(
      join(state, 'workflow-runs', 'telemetry', `${result.runId}-review-prompt.json`),
      'utf8',
    )).toThrow();
  });

  test('repairs deterministic-only lineage before the first semantic host call', async () => {
    if (!hostBoundaryPrerequisite(process.platform === 'darwin', 'platform=darwin')) return;
    const repo = gitFixture();
    const state = mkdtempSync(join(tmpdir(), 'review-repair-state-'));
    roots.push(state);
    const diffFile = join(repo, 'candidate.diff');
    const evidenceFile = join(repo, 'evidence.json');
    const unsupported = manifest();
    unsupported.behaviorMatrix[0] = {
      ...unsupported.behaviorMatrix[0]!,
      disposition: 'unsupported',
      providerIds: [],
      reason: 'The deterministic provider is not wired yet.',
    };
    unsupported.behaviorMatrix.push({
      ...unsupported.behaviorMatrix[0]!,
      id: 'unrelated-manual',
      behavior: 'The unrelated manual boundary is checked.',
      disposition: 'manual',
      reason: 'The unrelated path needs its existing provider binding.',
    });
    unsupported.providers = [{
      ...manifest().providers[0]!,
      id: 'unrelated-provider',
      cellIds: ['unrelated-static'],
      applicability: { kind: 'paths', pathPrefixes: ['unrelated'] },
    }];
    unsupported.behaviorMatrix.push({
      ...manifest().behaviorMatrix[0]!,
      id: 'unrelated-static',
      behavior: 'The unrelated static boundary is checked.',
      providerIds: ['unrelated-provider'],
    });
    writeFileSync(evidenceFile, `${JSON.stringify(unsupported)}\n`);
    writeFileSync(diffFile, 'diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old();\n+bad();\n');

    const initial = await runWorkflow(getWorkflow('review/code'), {
      mode: 'mock',
      host: 'mock',
      cwd: repo,
      goldbandHome: state,
      diffFile: 'candidate.diff',
      evidenceManifestFile: 'evidence.json',
    });
    const initialArtifactFile = initial.artifacts.find((file) =>
      file.endsWith('-review-evidence.json'))!;
    const initialArtifact = JSON.parse(readFileSync(initialArtifactFile, 'utf8')) as InitialReviewArtifact;
    expect(initialArtifact.hostCallCount).toBe(0);
    expect(initialArtifact.findings.map((finding) => finding.id), JSON.stringify(initialArtifact.findings)).toEqual(['D-001', 'D-002']);

    writeFileSync(diffFile, 'diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old();\n+still-bad();\n');
    const incompleteRecovery = await runWorkflow(getWorkflow('review/code'), {
      mode: 'mock',
      host: 'mock',
      cwd: repo,
      goldbandHome: state,
      diffFile: 'candidate.diff',
      evidenceManifestFile: 'evidence.json',
      closureArtifactFile: initialArtifactFile,
    });
    expect(String(incompleteRecovery.output)).toContain('Phase: evidence-repair.');
    expect(String(incompleteRecovery.output)).toContain('Semantic host calls: 0.');
    expect(String(incompleteRecovery.output)).toContain('completion-authorized: false');
    const incompleteArtifactFile = incompleteRecovery.artifacts.find((file) =>
      file.endsWith('-review-evidence.json'))!;
    const incompleteArtifact = JSON.parse(
      readFileSync(incompleteArtifactFile, 'utf8'),
    ) as InitialReviewArtifact;
    expect(incompleteArtifact.findings.map((finding) => finding.id)).toEqual(['D-001', 'D-002']);

    const repaired = manifest();
    repaired.providers[0]!.operations[0] = {
      ...operation('pass', ['node', '-e',
        "process.exit(require('node:fs').readFileSync('a.ts', 'utf8').includes('fixed') ? 0 : 1)",
      ], 'candidate', 'zero'),
      requiredSystemTools: ['node'],
    };
    repaired.behaviorMatrix.push(
      { ...unsupported.behaviorMatrix[1]!, providerIds: ['unrelated-provider'] },
      unsupported.behaviorMatrix[2]!,
    );
    repaired.providers.push({
      ...unsupported.providers[0]!,
      cellIds: ['unrelated-static', 'unrelated-manual'],
    });
    reviewEvidenceManifestSchema.validate(repaired);
    writeFileSync(evidenceFile, `${JSON.stringify(repaired)}\n`);
    writeFileSync(diffFile, 'diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old();\n+good();\n');
    const recovery = await runWorkflow(getWorkflow('review/code'), {
      mode: 'mock',
      host: 'mock',
      cwd: repo,
      goldbandHome: state,
      diffFile: 'candidate.diff',
      evidenceManifestFile: 'evidence.json',
      closureArtifactFile: incompleteArtifactFile,
    });

    expect(String(recovery.output)).toContain('Phase: evidence-repair.');
    expect(String(recovery.output)).toContain('Semantic host calls: 1.');
    expect(String(recovery.output)).toContain('completion-authorized: false');
    const recoveredArtifactFile = recovery.artifacts.find((file) =>
      file.endsWith('-review-evidence.json'))!;
    const recoveredArtifact = validateInitialReviewArtifact(
      JSON.parse(readFileSync(recoveredArtifactFile, 'utf8')),
    );
    expect(recoveredArtifact.evidence.completeness.complete).toBe(true);
    expect(recoveredArtifact.findings).toMatchObject([
      { classification: 'verified-failure', blocking: true },
      { classification: 'semantic-concern' },
    ]);
    expect(recoveredArtifact.evidence.records.map((entry) => entry.id)).toEqual(['provider-a:pass']);
    expect(recoveredArtifact).toMatchObject({
      phase: 'initial',
      hostCallCount: 1,
      predecessor: {
        transition: 'evidence-repair',
        runId: incompleteArtifact.runId,
        receiptId: incompleteArtifact.runtimeReceipt.id,
        findingIds: ['D-001', 'D-002'],
        affectedCellIds: ['behavior-a', 'unrelated-manual', 'unrelated-static'],
      },
    });
    const closureContext = {
      ...context(repo),
      options: { mode: 'mock' as const, goldbandHome: state, closureArtifactFile: recoveredArtifactFile },
    };
    expect(readClosureArtifact(closureContext)).toEqual(recoveredArtifact);
    const corruptFile = join(repo, 'corrupt.json');
    for (const corrupt of [
      (value: InitialReviewArtifact) => { value.evidence.records = []; },
      (value: InitialReviewArtifact) => { value.evidence.records[0]!.fresh = false; },
      (value: InitialReviewArtifact) => { value.evidence.records[0]!.cellIds = ['unrelated-static']; },
      (value: InitialReviewArtifact) => { value.findings[0]!.summary = 'forged'; },
      (value: InitialReviewArtifact) => { value.runtimeReceipt.signature = '0'.repeat(64); },
    ]) {
      const value = structuredClone(recoveredArtifact);
      corrupt(value);
      writeFileSync(corruptFile, JSON.stringify(value));
      expect(() => readClosureArtifact({
        ...closureContext,
        options: { ...closureContext.options, closureArtifactFile: corruptFile },
      })).toThrow();
    }
    writeFileSync(diffFile, 'diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old();\n+fixed();\n');
    const closure = await runWorkflow(getWorkflow('review/code'), {
      mode: 'mock', host: 'mock', cwd: repo, goldbandHome: state,
      diffFile: 'candidate.diff', evidenceManifestFile: 'evidence.json',
      closureArtifactFile: recoveredArtifactFile,
    });
    expect(String(closure.output)).toContain('Phase: closure.');
    expect(String(closure.output)).toContain('completion-authorized: true');
    const closureArtifact = JSON.parse(readFileSync(closure.artifacts.find((file) =>
      file.endsWith('-review-closure.json'))!, 'utf8'));
    expect(closureArtifact.affectedCellIds).toEqual(['behavior-a', 'unrelated-manual', 'unrelated-static']);
    expect(closureArtifact.evidence.records.map((entry) => entry.id)).toEqual(['provider-a:pass']);
    expect(closureArtifact.results.map((entry) => entry.status)).toEqual(['closed', 'closed']);
  });

  test('partial evidence repair preserves unresolved deterministic finding identity', async () => {
    if (!hostBoundaryPrerequisite(process.platform === 'darwin', 'platform=darwin')) return;
    const repo = gitFixture();
    const state = join(repo, '.state');
    const diffFile = join(repo, 'candidate.diff');
    const evidenceFile = join(repo, 'evidence.json');
    const unsupported = manifest();
    unsupported.behaviorMatrix = [
      {
        ...unsupported.behaviorMatrix[0]!,
        disposition: 'unsupported',
        providerIds: [],
        reason: 'Behavior A evidence is not wired yet.',
      },
      {
        ...unsupported.behaviorMatrix[0]!,
        id: 'behavior-b',
        behavior: 'The second invariant has deterministic evidence.',
        disposition: 'unsupported',
        providerIds: [],
        reason: 'Behavior B evidence is not wired yet.',
      },
    ];
    unsupported.providers = [];
    writeFileSync(evidenceFile, `${JSON.stringify(unsupported)}\n`);
    writeFileSync(
      diffFile,
      'diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old();\n+bad();\n',
    );

    const initial = await runWorkflow(getWorkflow('review/code'), {
      mode: 'mock', host: 'mock', cwd: repo, goldbandHome: state,
      diffFile: 'candidate.diff', evidenceManifestFile: 'evidence.json',
    });
    const initialArtifactFile = initial.artifacts.find((file) =>
      file.endsWith('-review-evidence.json'))!;
    const initialArtifact = JSON.parse(
      readFileSync(initialArtifactFile, 'utf8'),
    ) as InitialReviewArtifact;
    expect(initialArtifact.findings.map((finding) => ({
      id: finding.id,
      behaviorCellIds: finding.behaviorCellIds,
    }))).toEqual([
      { id: 'D-001', behaviorCellIds: ['behavior-a'] },
      { id: 'D-002', behaviorCellIds: ['behavior-b'] },
    ]);

    const partial = structuredClone(unsupported);
    partial.behaviorMatrix[0] = {
      ...partial.behaviorMatrix[0]!,
      disposition: 'static',
      providerIds: ['provider-a'],
      reason: undefined,
    };
    partial.providers = manifest().providers;
    writeFileSync(evidenceFile, `${JSON.stringify(partial)}\n`);
    writeFileSync(
      diffFile,
      'diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old();\n+partly-fixed();\n',
    );
    const recovery = await runWorkflow(getWorkflow('review/code'), {
      mode: 'mock', host: 'mock', cwd: repo, goldbandHome: state,
      diffFile: 'candidate.diff', evidenceManifestFile: 'evidence.json',
      closureArtifactFile: initialArtifactFile,
    });
    const recoveryArtifactFile = recovery.artifacts.find((file) =>
      file.endsWith('-review-evidence.json'))!;
    const recoveryArtifact = JSON.parse(
      readFileSync(recoveryArtifactFile, 'utf8'),
    ) as InitialReviewArtifact;
    expect(recoveryArtifact.hostCallCount).toBe(0);
    expect(recoveryArtifact.findings.map((finding) => ({
      id: finding.id,
      behaviorCellIds: finding.behaviorCellIds,
    }))).toEqual([{ id: 'D-002', behaviorCellIds: ['behavior-b'] }]);
  });

  test('semantic host cannot mint verified failure from deterministic evidence IDs', () => {
    const evidence = bundle([{
      ...record(),
      id: 'gate:failure',
      status: 'verified-failure',
      replayCommand: ['bun', 'test'],
    }]);
    const verified = classifyReviewFindings([finding({
      id: 'D-001',
      classification: 'verified-failure',
      evidenceIds: ['gate:failure'],
      behaviorCellIds: ['behavior-a'],
    })], evidence);
    expect(verified[0]).toMatchObject({
      id: 'S-001',
      classification: 'semantic-concern',
      blocking: true,
    });

    const concern = classifyReviewFindings([finding({
      classification: 'verified-failure',
      evidenceIds: ['missing'],
    })], evidence);
    expect(concern[0]).toMatchObject({
      classification: 'semantic-concern',
      blocking: true,
    });
    expect(concern[0]!.summary).toStartWith('[unverified concern]');

    const unrelated = classifyReviewFindings([finding({
      classification: 'verified-failure',
      evidenceIds: ['gate:failure'],
      behaviorCellIds: ['different-cell'],
    })], evidence);
    expect(unrelated[0]).toMatchObject({
      classification: 'semantic-concern',
      evidenceIds: [],
      behaviorCellIds: ['behavior-a'],
      blocking: true,
    });

    const medium = classifyReviewFindings([finding({ severity: 'medium' })], evidence);
    expect(medium[0]).toMatchObject({
      classification: 'semantic-concern',
      blocking: false,
    });
  });

  test('semantic finding validation uses the normalized classification', () => {
    const evidence = bundle([]);
    const hostFinding = finding({
      classification: 'coverage-gap',
      line: undefined,
      failureScenario: 'a contract is missing',
      evidence: 'host assertion',
      reproductionStep: 'inspect the contract',
    });
    expect(hasConcreteFailurePath(hostFinding)).toBe(true);
    const normalized = classifyReviewFindings([hostFinding], evidence)[0]!;
    expect(normalized.classification).toBe('semantic-concern');
    expect(hasConcreteFailurePath(normalized)).toBe(false);
  });

  test('semantic prompt receives bounded typed projections but not raw logs or runner policy', () => {
    const evidence = bundle([{ ...record(), outputSummary: 'RAW_LOG_SENTINEL' }]);
    const prompt = buildReviewPrompt(
      context('/repo'),
      'diff --git a/a.ts b/a.ts\n+changed();',
      { bundle: { selected: [], snapshot: [] }, text: '' },
      undefined,
      undefined,
      evidence,
    );
    expect(prompt).toContain('BEHAVIOR_MATRIX_START');
    expect(prompt).toContain('TYPED_EVIDENCE_SUMMARY_START');
    expect(prompt).not.toContain('RAW_LOG_SENTINEL');
    expect(prompt).not.toContain('sandbox-exec');
    expect(prompt).not.toContain('host-call budget');
  });

  test('regression and property providers preserve RED/GREEN and replay metadata', async () => {
    const repo = gitFixture();
    writeFileSync(join(repo, 'check.mjs'), 'process.exit(0);\n');
    const diff = git(repo, ['diff']);
    const value = manifest();
    value.providers[0] = {
      ...value.providers[0]!,
      kind: 'regression',
      operations: [
        operation('red', ['node', 'check.mjs'], 'base', 'nonzero'),
        operation('green', ['node', 'check.mjs'], 'candidate', 'zero'),
      ],
    };
    const propertyCell = {
      id: 'property-a',
      behavior: 'Seeded inputs preserve the invariant.',
      kind: 'boundary' as const,
      input: 'seeded fixture',
      preconditions: 'seed is fixed',
      expected: 'the property command exits successfully',
      risk: 'medium' as const,
      disposition: 'automated' as const,
      providerIds: ['property-provider'],
    };
    value.behaviorMatrix.push(propertyCell);
    value.providers.push({
      id: 'property-provider',
      owner: 'test',
      kind: 'property-fuzz',
      lifecycle: 'persistent',
      cellIds: ['property-a'],
      applicability: { kind: 'global', reason: 'Explicit property fixture.' },
      executionContext: { sandboxOwner: 'review-runtime', runner: 'sealed' },
      operations: [{
        ...operation('property', ['true'], 'candidate', 'zero'),
        seed: 'seed-42',
        iterations: 25,
      }],
    });
    const input = { source: 'git diff', diff, changedFiles: ['check.mjs'] };
    const validated = validateTransitionManifest(value, repo, input);
    const binding = createCandidateBinding(repo, input, validated);
    const evidence = await executeEvidencePlan(context(repo), input, validated, binding);
    expect(evidence.records.map((entry) => [entry.id, entry.status])).toEqual([
      ['provider-a:red', 'verified-pass'],
      ['provider-a:green', 'verified-pass'],
      ['property-provider:property', 'verified-pass'],
    ]);
    expect(evidence.records[0]!.executionIdentityDigest)
      .not.toBe(evidence.records[1]!.executionIdentityDigest);
    expect(evidence.records[2]).toMatchObject({
      seed: 'seed-42',
      iterations: 25,
      replayCommand: ['true'],
      evidenceLevel: 'fixture',
    });
    const changedSeed = structuredClone(validated);
    changedSeed.providers[1]!.operations[0]!.seed = 'seed-43';
    const changedSeedEvidence = await executeEvidencePlan(
      context(repo),
      input,
      changedSeed,
      createCandidateBinding(repo, input, changedSeed),
    );
    expect(changedSeedEvidence.records[2]!.commandDigest)
      .not.toBe(evidence.records[2]!.commandDigest);
    expect(evidence.completeness.complete).toBe(true);
  });

  test('each operation receives an independent read-only snapshot', async () => {
    const repo = gitFixture();
    const value = manifest();
    value.providers[0]!.operations = [
      operation(
        'mutates',
        ['node', '-e', "require('node:fs').writeFileSync('a.ts','mutated();\\n')"],
        'candidate',
        'zero',
      ),
      operation(
        'observes-original',
        ['node', '-e', "const fs=require('node:fs');process.exit(fs.readFileSync('a.ts','utf8')==='old();\\n'?0:9)"],
        'candidate',
        'zero',
      ),
    ];
    const input = { source: 'git diff', diff: git(repo, ['diff']), changedFiles: ['a.ts'] };
    const validated = reviewEvidenceManifestSchema.validate(value);
    const evidence = await executeEvidencePlan(
      context(repo),
      input,
      validated,
      createCandidateBinding(repo, input, validated),
    );
    expect(evidence.records[0]).toMatchObject({ status: 'verified-failure', fresh: true });
    expect(evidence.records[0]!.snapshotDigestBefore)
      .toBe(evidence.records[0]!.snapshotDigestAfter);
    expect(evidence.records[1]).toMatchObject({ status: 'verified-pass', fresh: true });
    expect(evidence.records[1]!.snapshotDigestBefore)
      .toBe(evidence.records[1]!.snapshotDigestAfter);
  });

  test('each operation receives an independent HOME and TMPDIR', async () => {
    const repo = gitFixture();
    const value = manifest();
    value.providers[0]!.operations = [
      operation(
        'writes-home',
        ['node', '-e', "const fs=require('node:fs');const p=require('node:path');fs.writeFileSync(p.join(process.env.HOME,'sentinel'),'x');fs.writeFileSync(p.join(process.env.TMPDIR,'sentinel'),'x')"],
        'candidate',
        'zero',
      ),
      operation(
        'checks-home',
        ['node', '-e', "const fs=require('node:fs');const p=require('node:path');process.exit(fs.existsSync(p.join(process.env.HOME,'sentinel'))||fs.existsSync(p.join(process.env.TMPDIR,'sentinel'))?9:0)"],
        'candidate',
        'zero',
      ),
    ];
    const validated = reviewEvidenceManifestSchema.validate(value);
    const input = { source: 'git diff', diff: git(repo, ['diff']), changedFiles: ['a.ts'] };
    const evidence = await executeEvidencePlan(
      context(repo), input, validated, createCandidateBinding(repo, input, validated),
    );
    expect(evidence.records.map((record) => record.status)).toEqual([
      'verified-pass',
      'verified-pass',
    ]);
  });

  test('materializes and executes an explicit Python 3.14 uv runtime against the candidate', async () => {
    if (!hostBoundaryPrerequisite(process.platform === 'darwin', 'platform=darwin')) return;
    const python = spawnSync('/usr/bin/which', ['python3.14'], { encoding: 'utf8' }).stdout.trim();
    const uv = spawnSync('/usr/bin/which', ['uv'], { encoding: 'utf8' }).stdout.trim();
    if (!hostBoundaryPrerequisite(Boolean(python), 'python3.14 executable')) return;
    if (!hostBoundaryPrerequisite(Boolean(uv), 'uv executable')) return;
    const repo = gitFixture();
    const wheel = join(repo, 'vendor', 'fixture_dep-1.0.0-py3-none-any.whl');
    mkdirSync(dirname(wheel), { recursive: true });
    writeFixtureWheel(python, wheel);
    writeFileSync(join(repo, 'pyproject.toml'), [
      '[project]',
      'name = "python-evidence-fixture"',
      'version = "0.1.0"',
      'requires-python = ">=3.14,<3.15"',
      'dependencies = ["fixture-dep"]',
      '[tool.uv.sources]',
      'fixture-dep = { path = "vendor/fixture_dep-1.0.0-py3-none-any.whl" }',
      '',
    ].join('\n'));
    writeFileSync(join(repo, 'app.py'), 'VALUE = "base"\n');
    const locked = spawnSync(uv, ['lock', '--project', repo, '--python', python, '--offline', '--no-cache'], {
      encoding: 'utf8',
    });
    if (locked.status !== 0) throw new Error(locked.stderr);
    git(repo, ['add', 'pyproject.toml', 'uv.lock', 'app.py', 'vendor']);
    git(repo, ['commit', '-m', 'add Python fixture']);
    writeFileSync(join(repo, 'app.py'), 'VALUE = "candidate"\n');
    const value = manifest();
    value.providers[0]!.operations[0] = {
      ...operation(
        'python-gate',
        ['python3.14', '-c', 'import app,fixture_dep; assert app.VALUE == "candidate" and fixture_dep.VALUE == 42; print(app.__file__); print(fixture_dep.__file__)'],
        'candidate',
        'zero',
      ),
      pythonRuntime: {
        interpreter: 'python3.14',
        resolver: 'uv',
        projectFile: 'pyproject.toml',
        lockFile: 'uv.lock',
      },
    };
    const validated = reviewEvidenceManifestSchema.validate(value);
    const input = { source: 'git diff', diff: git(repo, ['diff']), changedFiles: ['app.py'] };
    const cache = mkdtempSync(join(tmpdir(), 'python-evidence-cache-'));
    roots.push(cache);
    mkdirSync(join(cache, 'unused'), { recursive: true });
    symlinkSync(tmpdir(), join(cache, 'unused', 'escape'));
    const previousCache = process.env.UV_CACHE_DIR;
    process.env.UV_CACHE_DIR = cache;
    let evidence: Awaited<ReturnType<typeof executeEvidencePlan>>;
    let repeated: Awaited<ReturnType<typeof executeEvidencePlan>>;
    try {
      evidence = await executeEvidencePlan(
        context(repo), input, validated, createCandidateBinding(repo, input, validated),
      );
      writeFileSync(join(cache, 'unused', 'changed-after-first-run'), 'not selected\n');
      repeated = await executeEvidencePlan(
        context(repo), input, validated, createCandidateBinding(repo, input, validated),
      );
    } finally {
      if (previousCache === undefined) delete process.env.UV_CACHE_DIR;
      else process.env.UV_CACHE_DIR = previousCache;
    }

    expect(evidence.records[0]).toMatchObject({
      status: 'verified-pass',
      exitStatus: 0,
      fresh: true,
      environment: 'isolated-darwin-snapshot',
    });
    expect(evidence.records[0]!.outputSummary).toContain('/operations/');
    expect(evidence.records[0]!.outputSummary).toContain('/python-runtime/environment/');
    expect(evidence.records[0]!.outputSummary).not.toContain(repo);
    expect(evidence.records[0]!.executionIdentityDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(repeated.records[0]).toMatchObject({ status: 'verified-pass', fresh: true });
    expect(repeated.records[0]!.executionIdentityDigest)
      .toBe(evidence.records[0]!.executionIdentityDigest);
  });

  test('binds the one lock wheel selected by installed compatibility tags', () => {
    const selectedHash = `sha256:${'a'.repeat(64)}`;
    const unselectedHash = `sha256:${'b'.repeat(64)}`;
    const lockPackage = [
      '[[package]]',
      'name = "fixture-dep"',
      'version = "1.0.0"',
      'source = { registry = "https://pypi.org/simple" }',
      'wheels = [',
      `  { url = "https://files.example/fixture_dep-1.0.0-cp314-cp314-macosx_14_0_arm64.whl", hash = "${selectedHash}" },`,
      `  { url = "https://files.example/fixture_dep-1.0.0-cp314-cp314-manylinux_2_39_x86_64.whl", hash = "${unselectedHash}" },`,
      ']',
    ].join('\n');
    const wheelMetadata = [
      'Wheel-Version: 1.0',
      'Tag: cp314-cp314-macosx_14_0_arm64',
      '',
    ].join('\n');

    expect(selectedUvLockArtifact(lockPackage, wheelMetadata)).toEqual({
      kind: 'wheel',
      filename: 'fixture_dep-1.0.0-cp314-cp314-macosx_14_0_arm64.whl',
      hash: selectedHash,
    });
    expect(selectedUvLockArtifact(
      lockPackage.replace(unselectedHash, `sha256:${'c'.repeat(64)}`),
      wheelMetadata,
    ).hash).toBe(selectedHash);
    expect(selectedUvLockArtifact(
      lockPackage.replace(selectedHash, `sha256:${'d'.repeat(64)}`),
      wheelMetadata,
    ).hash).toBe(`sha256:${'d'.repeat(64)}`);
    expect(() => selectedUvLockArtifact(
      lockPackage.replace('manylinux_2_39_x86_64', 'macosx_14_0_arm64'),
      wheelMetadata,
    )).toThrow('multiple compatible uv.lock wheels');
    expect(selectedUvLockArtifact(
      lockPackage.replace(
        'fixture_dep-1.0.0-cp314-cp314-macosx_14_0_arm64.whl',
        'fixture_dep-1.0.0-py2.py3-none-any.whl',
      ),
      'Wheel-Version: 1.0\nTag: py2-none-any\nTag: py3-none-any\n',
    ).filename).toBe('fixture_dep-1.0.0-py2.py3-none-any.whl');
  });

  test('repository Python provider produces fresh evidence through its declared operation', async () => {
    if (!hostBoundaryPrerequisite(process.platform === 'darwin', 'platform=darwin')) return;
    const python = spawnSync('/usr/bin/which', ['python3.14'], { encoding: 'utf8' }).stdout.trim();
    const uv = spawnSync('/usr/bin/which', ['uv'], { encoding: 'utf8' }).stdout.trim();
    if (!hostBoundaryPrerequisite(Boolean(python), 'python3.14 executable')) return;
    if (!hostBoundaryPrerequisite(Boolean(uv), 'uv executable')) return;
    const repo = gitFixture();
    const fixtureRoot = join(repo, 'goldband-loop', 'test', 'fixtures', 'python-runtime');
    mkdirSync(fixtureRoot, { recursive: true });
    for (const file of ['pyproject.toml', 'uv.lock']) {
      copyFileSync(join(import.meta.dir, 'fixtures', 'python-runtime', file), join(fixtureRoot, file));
    }
    writeFileSync(join(fixtureRoot, 'probe.txt'), 'base\n');
    git(repo, ['add', '.']);
    git(repo, ['commit', '-m', 'add repository Python provider fixture']);
    writeFileSync(join(fixtureRoot, 'probe.txt'), 'candidate\n');

    const rootManifest = JSON.parse(readFileSync(
      join(import.meta.dir, '..', '..', 'goldband.review-evidence.json'),
      'utf8',
    ));
    const value = {
      schemaVersion: rootManifest.schemaVersion,
      behaviorMatrix: rootManifest.behaviorMatrix.filter(
        (cell: { id: string }) => cell.id === 'python-candidate-runtime',
      ),
      providers: rootManifest.providers.filter(
        (provider: { id: string }) => provider.id === 'python-runtime-tests',
      ),
      authorizations: [],
    };
    const validated = reviewEvidenceManifestSchema.validate(value);
    const input = {
      source: 'git diff',
      diff: git(repo, ['diff']),
      changedFiles: ['goldband-loop/test/fixtures/python-runtime/probe.txt'],
    };
    const evidence = await executeEvidencePlan(
      context(repo), input, validated, createCandidateBinding(repo, input, validated),
    );

    expect(evidence.records).toHaveLength(1);
    expect(evidence.records[0]).toMatchObject({
      providerId: 'python-runtime-tests',
      operationId: 'candidate-python-runtime',
      status: 'verified-pass',
      fresh: true,
      exitStatus: 0,
    });
  });

  test('does not execute a Python interpreter selected from an untrusted PATH directory', async () => {
    const repo = gitFixture();
    writeFileSync(join(repo, 'pyproject.toml'), '[project]\nname="untrusted-python"\nversion="0.1.0"\nrequires-python=">=3.14,<3.15"\n');
    writeFileSync(join(repo, 'uv.lock'), 'version = 1\nrevision = 1\nrequires-python = ">=3.14,<3.15"\n');
    git(repo, ['add', 'pyproject.toml', 'uv.lock']);
    git(repo, ['commit', '-m', 'add Python fixture']);
    const toolRoot = mkdtempSync(join(tmpdir(), 'untrusted-python-path-'));
    roots.push(toolRoot);
    const sentinel = join(toolRoot, 'executed');
    const bin = join(toolRoot, 'bin');
    mkdirSync(bin);
    writeFileSync(join(bin, 'python3.14'), `#!/bin/sh\n: > '${sentinel}'\nexit 1\n`);
    chmodSync(join(bin, 'python3.14'), 0o755);
    const value = manifest();
    value.providers[0]!.operations[0] = {
      ...operation('untrusted-python', ['python3.14', '-c', 'raise SystemExit(23)'], 'candidate', 'zero'),
      pythonRuntime: {
        interpreter: 'python3.14',
        resolver: 'uv',
        projectFile: 'pyproject.toml',
        lockFile: 'uv.lock',
      },
    };
    const validated = reviewEvidenceManifestSchema.validate(value);
    const input = { source: 'git diff', diff: '', changedFiles: [] };
    const previousPath = process.env.PATH;
    process.env.PATH = `${bin}:${previousPath ?? '/usr/bin:/bin'}`;
    try {
      const evidence = await executeEvidencePlan(
        context(repo), input, validated, createCandidateBinding(repo, input, validated),
      );
      expect(evidence.records[0]).toMatchObject({ status: 'runtime-incomplete', fresh: false });
      expect(existsSync(sentinel)).toBe(false);
    } finally {
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
    }
  });

  test('classifies Python runtime preparation failure before the project gate', async () => {
    if (!hostBoundaryPrerequisite(process.platform === 'darwin', 'platform=darwin')) return;
    const repo = gitFixture();
    writeFileSync(join(repo, 'pyproject.toml'), '[project]\nname="missing-lock"\nversion="0.1.0"\nrequires-python=">=3.14,<3.15"\n');
    git(repo, ['add', 'pyproject.toml']);
    git(repo, ['commit', '-m', 'add incomplete Python fixture']);
    const value = manifest();
    value.providers[0]!.operations[0] = {
      ...operation(
        'python-missing-lock',
        ['python3.14', '-c', 'raise SystemExit(23)'],
        'candidate',
        'zero',
      ),
      pythonRuntime: {
        interpreter: 'python3.14',
        resolver: 'uv',
        projectFile: 'pyproject.toml',
        lockFile: 'uv.lock',
      },
    };
    const validated = reviewEvidenceManifestSchema.validate(value);
    const input = { source: 'git diff', diff: '', changedFiles: [] };
    const evidence = await executeEvidencePlan(
      context(repo), input, validated, createCandidateBinding(repo, input, validated),
    );

    expect(evidence.records[0]).toMatchObject({
      status: 'runtime-incomplete',
      fresh: false,
    });
    expect(evidence.records[0]!.exitStatus).toBeUndefined();
    expect(evidence.records[0]!.outputSummary).toContain('before project gate');
    expect(evidence.records[0]!.outputSummary).toContain('uv.lock');
    expect(evidence.completeness).toMatchObject({
      complete: false,
      hostEligible: false,
      runtimeIncompleteCellIds: ['behavior-a'],
    });
  });

  test('Python preparation failure blocks semantic dispatch and completion in the full workflow', async () => {
    if (!hostBoundaryPrerequisite(process.platform === 'darwin', 'platform=darwin')) return;
    const repo = gitFixture();
    const value = manifest();
    value.providers[0]!.operations[0] = {
      ...operation('missing-python-project', ['python3.14', '-c', 'raise SystemExit(23)'], 'candidate', 'zero'),
      pythonRuntime: { interpreter: 'python3.14', resolver: 'uv', projectFile: 'pyproject.toml', lockFile: 'uv.lock' },
    };
    writeFileSync(join(repo, 'evidence.json'), JSON.stringify(value));
    writeFileSync(join(repo, 'candidate.diff'), 'diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old();\n+newValue();\n');
    const state = mkdtempSync(join(tmpdir(), 'python-workflow-'));
    roots.push(state);
    const result = await runWorkflow(getWorkflow('review/code'), {
      mode: 'mock', host: 'mock', cwd: repo, goldbandHome: state,
      diffFile: 'candidate.diff', evidenceManifestFile: 'evidence.json',
    });
    const artifact = JSON.parse(readFileSync(result.artifacts.find((file) => file.endsWith('-review-evidence.json'))!, 'utf8')) as InitialReviewArtifact;
    expect(artifact.hostCallCount).toBe(0);
    expect(artifact.evidence.records[0]).toMatchObject({ status: 'runtime-incomplete', fresh: false });
    expect(artifact.evidence.completeness.hostEligible).toBe(false);
    expect(artifact.evidence.completeness.complete).toBe(false);
    expect(artifact.findings).toContainEqual(expect.objectContaining({ classification: 'runtime-incomplete', blocking: true }));
    expect(String(result.output)).toContain('completion-authorized: false');
  });

  test('rejects a Python interpreter selected through the source checkout venv', async () => {
    if (!hostBoundaryPrerequisite(process.platform === 'darwin', 'platform=darwin')) return;
    const python = spawnSync('/usr/bin/which', ['python3.14'], { encoding: 'utf8' }).stdout.trim();
    const uv = spawnSync('/usr/bin/which', ['uv'], { encoding: 'utf8' }).stdout.trim();
    if (!python || !uv) return;
    const repo = gitFixture();
    writeFileSync(join(repo, 'pyproject.toml'), '[project]\nname="source-venv"\nversion="0.1.0"\nrequires-python=">=3.14,<3.15"\n');
    const locked = spawnSync(uv, ['lock', '--project', repo, '--python', python, '--offline', '--no-cache'], { encoding: 'utf8' });
    if (locked.status !== 0) throw new Error(locked.stderr);
    git(repo, ['add', 'pyproject.toml', 'uv.lock']);
    git(repo, ['commit', '-m', 'add source venv fixture']);
    mkdirSync(join(repo, '.venv', 'bin'), { recursive: true });
    symlinkSync(realpathSync(python), join(repo, '.venv', 'bin', 'python3.14'));
    const value = manifest();
    value.providers[0]!.operations[0] = {
      ...operation('source-venv', ['python3.14', '-c', 'raise SystemExit(23)'], 'candidate', 'zero'),
      pythonRuntime: {
        interpreter: 'python3.14',
        resolver: 'uv',
        projectFile: 'pyproject.toml',
        lockFile: 'uv.lock',
      },
    };
    const validated = reviewEvidenceManifestSchema.validate(value);
    const input = { source: 'git diff', diff: '', changedFiles: [] };
    const previousPath = process.env.PATH;
    process.env.PATH = `${join(repo, '.venv', 'bin')}:${previousPath ?? '/usr/bin:/bin'}`;
    try {
      const evidence = await executeEvidencePlan(
        context(repo), input, validated, createCandidateBinding(repo, input, validated),
      );
      expect(evidence.records[0]).toMatchObject({ status: 'runtime-incomplete', fresh: false });
      expect(evidence.records[0]!.outputSummary).toContain('source checkout');
      expect(evidence.records[0]!.exitStatus).toBeUndefined();
    } finally {
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
    }
  });

  test('rejects a stale uv lock before executing the Python project gate', async () => {
    if (!hostBoundaryPrerequisite(process.platform === 'darwin', 'platform=darwin')) return;
    const python = spawnSync('/usr/bin/which', ['python3.14'], { encoding: 'utf8' }).stdout.trim();
    const uv = spawnSync('/usr/bin/which', ['uv'], { encoding: 'utf8' }).stdout.trim();
    if (!python || !uv) return;
    const repo = gitFixture();
    writeFileSync(join(repo, 'pyproject.toml'), '[project]\nname="stale-lock"\nversion="0.1.0"\nrequires-python=">=3.14,<3.15"\ndependencies=[]\n');
    const locked = spawnSync(uv, ['lock', '--project', repo, '--python', python, '--offline', '--no-cache'], { encoding: 'utf8' });
    if (locked.status !== 0) throw new Error(locked.stderr);
    git(repo, ['add', 'pyproject.toml', 'uv.lock']);
    git(repo, ['commit', '-m', 'add stale lock fixture']);
    writeFileSync(join(repo, 'pyproject.toml'), '[project]\nname="stale-lock-renamed"\nversion="0.1.0"\nrequires-python=">=3.14,<3.15"\ndependencies=[]\n');
    const value = manifest();
    value.providers[0]!.operations[0] = {
      ...operation('stale-lock', ['python3.14', '-c', 'raise SystemExit(23)'], 'candidate', 'zero'),
      pythonRuntime: {
        interpreter: 'python3.14',
        resolver: 'uv',
        projectFile: 'pyproject.toml',
        lockFile: 'uv.lock',
      },
    };
    const validated = reviewEvidenceManifestSchema.validate(value);
    const input = { source: 'git diff', diff: git(repo, ['diff']), changedFiles: ['pyproject.toml'] };
    const evidence = await executeEvidencePlan(
      context(repo), input, validated, createCandidateBinding(repo, input, validated),
    );

    expect(evidence.records[0]).toMatchObject({ status: 'runtime-incomplete', fresh: false });
    expect(evidence.records[0]!.exitStatus).toBeUndefined();
    expect(evidence.records[0]!.outputSummary).toContain('locked project check failed');
  });

  test('keeps a Python project gate mismatch as verified-failure after runtime preflight', async () => {
    if (!hostBoundaryPrerequisite(process.platform === 'darwin', 'platform=darwin')) return;
    const python = spawnSync('/usr/bin/which', ['python3.14'], { encoding: 'utf8' }).stdout.trim();
    const uv = spawnSync('/usr/bin/which', ['uv'], { encoding: 'utf8' }).stdout.trim();
    if (!hostBoundaryPrerequisite(Boolean(python) && Boolean(uv), 'Python 3.14 and uv executables')) return;
    const repo = gitFixture();
    writeFileSync(join(repo, 'pyproject.toml'), '[project]\nname="failing-gate"\nversion="0.1.0"\nrequires-python=">=3.14,<3.15"\n');
    const locked = spawnSync(uv, ['lock', '--project', repo, '--python', python, '--offline', '--no-cache'], { encoding: 'utf8' });
    if (locked.status !== 0) throw new Error(locked.stderr);
    git(repo, ['add', 'pyproject.toml', 'uv.lock']);
    git(repo, ['commit', '-m', 'add failing Python fixture']);
    const value = manifest();
    value.providers[0]!.operations[0] = {
      ...operation('python-failure', ['python3.14', '-c', 'raise SystemExit(23)'], 'candidate', 'zero'),
      pythonRuntime: {
        interpreter: 'python3.14',
        resolver: 'uv',
        projectFile: 'pyproject.toml',
        lockFile: 'uv.lock',
      },
    };
    const validated = reviewEvidenceManifestSchema.validate(value);
    const input = { source: 'git diff', diff: '', changedFiles: [] };
    const evidence = await executeEvidencePlan(
      context(repo), input, validated, createCandidateBinding(repo, input, validated),
    );

    expect(evidence.records[0]).toMatchObject({
      status: 'verified-failure',
      exitStatus: 23,
      fresh: true,
    });
  });

  test('rejects Python environment symlinks, pth files, editable installs, and source-checkout references', () => {
    const python = spawnSync('/usr/bin/which', ['python3.14'], { encoding: 'utf8' }).stdout.trim();
    if (!python) return;
    const repo = gitFixture();
    const root = mkdtempSync(join(tmpdir(), 'python-environment-validation-'));
    roots.push(root);
    const environment = join(root, 'environment');
    const sitePackages = join(environment, 'lib', 'python3.14', 'site-packages');
    mkdirSync(join(environment, 'bin'), { recursive: true });
    mkdirSync(sitePackages, { recursive: true });
    copyFileSync(realpathSync(python), join(environment, 'bin', 'python3.14'));
    chmodSync(join(environment, 'bin', 'python3.14'), 0o555);

    const pth = join(sitePackages, 'ambient.pth');
    writeFileSync(pth, '/outside\n');
    expect(() => validateMaterializedPythonEnvironment(environment, realpathSync(python), repo))
      .toThrow('forbidden site customization');
    rmSync(pth);

    const directUrl = join(sitePackages, 'package-1.0.dist-info', 'direct_url.json');
    mkdirSync(dirname(directUrl), { recursive: true });
    writeFileSync(directUrl, JSON.stringify({ url: `file://${repo}`, dir_info: { editable: true } }));
    expect(() => validateMaterializedPythonEnvironment(environment, realpathSync(python), repo))
      .toThrow('editable install');
    rmSync(dirname(directUrl), { recursive: true, force: true });

    writeFileSync(join(sitePackages, 'source-reference.txt'), repo);
    expect(() => validateMaterializedPythonEnvironment(environment, realpathSync(python), repo))
      .toThrow('refers to the source checkout');
    rmSync(join(sitePackages, 'source-reference.txt'));

    symlinkSync(repo, join(sitePackages, 'escape'));
    expect(() => validateMaterializedPythonEnvironment(environment, realpathSync(python), repo))
      .toThrow('symlink escape');
  });

  test('sealed Bun runtime can resolve the candidate cwd and a declared --cwd', async () => {
    if (!hostBoundaryPrerequisite(process.platform === 'darwin', 'platform=darwin')) return;
    const repo = gitFixture();
    mkdirSync(join(repo, 'nested'));
    writeFileSync(
      join(repo, 'nested', 'fixture.test.ts'),
      "import { spawnSync } from 'node:child_process'; import { expect, test } from 'bun:test'; test('fixture', () => { for (const [tool,args] of [['git',['--version']],['node',['--version']],['tar',['--version']]] as const) { const result=spawnSync(tool,args,{encoding:'utf8'}); expect(result.status,`${tool}: ${result.error?.message ?? ''} ${result.stderr ?? ''}`).toBe(0); } }, 15000);\n",
    );
    git(repo, ['add', 'nested/fixture.test.ts']);
    git(repo, ['commit', '-m', 'add nested fixture']);
    const value = manifest();
    value.providers[0]!.operations[0] = operation(
      'bun-cwd',
      ['bun', 'test', '--cwd', 'nested', 'fixture.test.ts'],
      'candidate',
      'zero',
    );
    value.providers[0]!.operations[0]!.requiredSystemTools = ['git', 'node', 'tar'];
    const input = { source: 'git diff', diff: '', changedFiles: [] };
    const validated = reviewEvidenceManifestSchema.validate(value);
    const evidence = await executeEvidencePlan(
      context(repo), input, validated, createCandidateBinding(repo, input, validated),
    );
    expect(evidence.records[0]).toMatchObject({
      status: 'verified-pass',
      exitStatus: 0,
      fresh: true,
    });
  });

  test('successful output containing sandbox is not treated as launcher failure', async () => {
    const repo = gitFixture();
    const value = manifest();
    value.providers[0]!.operations = [operation(
      'sandbox-word',
      ['node', '-e', "process.stdout.write('sandbox healthy')"],
      'candidate',
      'zero',
    )];
    const validated = reviewEvidenceManifestSchema.validate(value);
    const input = { source: 'git diff', diff: '', changedFiles: [] };
    const evidence = await executeEvidencePlan(
      context(repo), input, validated, createCandidateBinding(repo, input, validated),
    );
    expect(evidence.records[0]).toMatchObject({
      status: 'verified-pass',
      outputSummary: 'sandbox healthy',
      fresh: true,
    });
  });

  test('evidence sandbox denies reads outside declared runtime and candidate roots', async () => {
    const repo = gitFixture();
    const outside = join(tmpdir(), `goldband-private-${Date.now()}`);
    writeFileSync(outside, 'sensitive-outside-candidate\n');
    roots.push(outside);
    const value = manifest();
    value.providers[0]!.operations[0]!.argv = [
      'node',
      '-e',
      `const fs=require('node:fs');try{fs.readFileSync(${JSON.stringify(outside)});process.exit(9)}catch(error){if(!['EPERM','EACCES'].includes(error.code))throw error}`,
    ];
    const validated = reviewEvidenceManifestSchema.validate(value);
    const input = { source: 'git diff', diff: '', changedFiles: [] };
    const evidence = await executeEvidencePlan(
      context(repo), input, validated, createCandidateBinding(repo, input, validated),
    );
    expect(evidence.records[0]).toMatchObject({ status: 'verified-pass', fresh: true });
  });

  test('sealed child process inherits the sandbox without broker credentials', async () => {
    if (!hostBoundaryPrerequisite(process.platform === 'darwin', 'platform=darwin')) return;
    const repo = gitFixture();
    writeFileSync(join(repo, 'module.cjs'), 'module.exports = 42;\n');
    git(repo, ['add', 'module.cjs']);
    git(repo, ['commit', '-m', 'add child module']);
    const launcherSource = [
      'if (process.cwd() !== process.env.GOLDBAND_EXPECTED_CWD) process.exit(9);',
      'if (Object.keys(process.env).some((key) => key.startsWith("GOLDBAND_EVIDENCE_BROKER_"))) process.exit(8);',
      'if (require("../lib/module.cjs") !== 42) process.exit(6);',
    ].join('\n');
    const value = manifest();
    value.providers[0]!.operations[0]!.argv = [
      'node',
      '-e',
      [
        'const cp=require("node:child_process"),fs=require("node:fs"),path=require("node:path")',
        'if(Object.keys(process.env).some(k=>k.startsWith("GOLDBAND_EVIDENCE_BROKER_")))process.exit(7)',
        'const runtime=path.join(process.env.TMPDIR,"installed-runtime")',
        'const cwd=path.join(runtime,"bin")',
        'fs.mkdirSync(cwd,{recursive:true})',
        'fs.symlinkSync(process.cwd(),path.join(runtime,"lib"),"dir")',
        'const launcher=path.join(cwd,"launcher.cjs")',
        `fs.writeFileSync(launcher,Buffer.from(${JSON.stringify(Buffer.from(launcherSource).toString('base64'))},"base64"))`,
        'const expectedCwd=fs.realpathSync(cwd)',
        'const result=cp.spawnSync(process.execPath,[launcher],{cwd,encoding:"utf8",env:{...process.env,GOLDBAND_EXPECTED_CWD:expectedCwd}})',
        'if(result.status!==0){process.stderr.write(result.stderr||"");process.exit(result.status||8)}',
      ].join(';'),
    ];
    const validated = reviewEvidenceManifestSchema.validate(value);
    const input = { source: 'git diff', diff: '', changedFiles: [] };
    const evidence = await executeEvidencePlan(
      context(repo),
      input,
      validated,
      createCandidateBinding(repo, input, validated),
    );
    expect(evidence.records[0]).toMatchObject({ status: 'verified-pass', exitStatus: 0 });
  });

  test('sealed runtime projection cannot read source images or mutate projected images', async () => {
    if (!hostBoundaryPrerequisite(process.platform === 'darwin', 'platform=darwin')) return;
    const clang = spawnSync('/usr/bin/xcrun', ['--find', 'clang'], { encoding: 'utf8' });
    if (!hostBoundaryPrerequisite(clang.status === 0, 'xcrun clang')) return;
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'review-runtime-source-denial-'));
    roots.push(fixtureRoot);
    const library = join(fixtureRoot, 'libProjectionFixture.dylib');
    const librarySource = join(fixtureRoot, 'projection-fixture.c');
    writeFileSync(librarySource, 'int projection_fixture(void) { return 7; }\n');
    compileMachO([
      '-dynamiclib', librarySource,
      '-install_name', library,
      '-o', library,
    ]);
    const probe = join(fixtureRoot, 'projection-denial-probe');
    const probeSource = join(fixtureRoot, 'projection-denial-probe.c');
    writeFileSync(
      probeSource,
      [
        '#include <errno.h>',
        '#include <fcntl.h>',
        '#include <unistd.h>',
        'extern int projection_fixture(void);',
        'static int denied(const char *path, int flags) {',
        '  int fd = open(path, flags, 0);',
        '  if (fd >= 0) { close(fd); return 0; }',
        '  return errno == EPERM || errno == EACCES;',
        '}',
        'int main(int argc, char **argv) {',
        '  if (argc < 1 || projection_fixture() != 7) return 8;',
        `  if (!denied(${JSON.stringify(library)}, O_RDONLY)) return 9;`,
        '  if (!denied(argv[0], O_WRONLY | O_APPEND)) return 10;',
        '  return 0;',
        '}',
      ].join('\n'),
    );
    compileMachO([probeSource, '-L', fixtureRoot, '-lProjectionFixture', '-o', probe]);
    expect(evidenceRuntimeReadAccess(probe).images.map((image) => image.sourcePath))
      .toContain(realpathSync(library));
    const repo = gitFixture();
    const value = manifest();
    value.providers[0]!.operations[0]!.argv = [basename(probe)];
    const validated = reviewEvidenceManifestSchema.validate(value);
    const input = { source: 'git diff', diff: '', changedFiles: [] };
    const previousPath = process.env.PATH;
    process.env.PATH = `${fixtureRoot}:${previousPath ?? '/usr/bin:/bin'}`;
    try {
      const evidence = await executeEvidencePlan(
        context(repo), input, validated, createCandidateBinding(repo, input, validated),
      );
      expect(evidence.records[0]).toMatchObject({ status: 'verified-pass', fresh: true });
    } finally {
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
    }
  });

  test('sealed runtime projection identity is stable across separate evidence plans', async () => {
    if (!hostBoundaryPrerequisite(process.platform === 'darwin', 'platform=darwin')) return;
    const repo = gitFixture();
    const value = manifest();
    value.providers[0]!.operations[0]!.argv = [
      'node',
      '-e',
      "process.stdout.write('stable-runtime')",
    ];
    const validated = reviewEvidenceManifestSchema.validate(value);
    const input = { source: 'git diff', diff: '', changedFiles: [] };
    const binding = createCandidateBinding(repo, input, validated);
    const first = await executeEvidencePlan(context(repo), input, validated, binding);
    const second = await executeEvidencePlan(context(repo), input, validated, binding);
    expect(first.records[0]).toMatchObject({ status: 'verified-pass', fresh: true });
    expect(second.records[0]).toMatchObject({ status: 'verified-pass', fresh: true });
    expect(second.records[0]!.executionIdentityDigest)
      .toBe(first.records[0]!.executionIdentityDigest);
    expect(second.records[0]!.commandDigest).toBe(first.records[0]!.commandDigest);
  });

  test('evidence sandbox denies the system log socket inherited from the macOS process baseline', async () => {
    if (!hostBoundaryPrerequisite(process.platform === 'darwin', 'platform=darwin')) return;
    const clang = spawnSync('/usr/bin/xcrun', ['--find', 'clang'], { encoding: 'utf8' });
    if (!hostBoundaryPrerequisite(clang.status === 0, 'xcrun clang')) return;
    const probeRoot = mkdtempSync(join(tmpdir(), 'review-syslog-socket-'));
    roots.push(probeRoot);
    const probeSource = join(probeRoot, 'syslog-socket.c');
    const probe = join(probeRoot, 'syslog-socket');
    writeFileSync(
      probeSource,
      [
        '#include <errno.h>',
        '#include <stddef.h>',
        '#include <string.h>',
        '#include <sys/socket.h>',
        '#include <sys/un.h>',
        'int main(void) {',
        '  int descriptor = socket(AF_UNIX, SOCK_DGRAM, 0);',
        '  if (descriptor < 0) return 8;',
        '  struct sockaddr_un address = {0};',
        '  address.sun_family = AF_UNIX;',
        '  strcpy(address.sun_path, "/private/var/run/syslog");',
        '  if (connect(descriptor, (struct sockaddr *)&address, sizeof(address)) == 0) return 9;',
        '  return errno == EPERM || errno == EACCES ? 0 : 8;',
        '}',
      ].join('\n'),
    );
    compileMachO([probeSource, '-o', probe]);
    const repo = gitFixture();
    const value = manifest();
    value.providers[0]!.operations[0]!.argv = [basename(probe)];
    const validated = reviewEvidenceManifestSchema.validate(value);
    const input = { source: 'git diff', diff: '', changedFiles: [] };
    const previousPath = process.env.PATH;
    process.env.PATH = `${probeRoot}:${previousPath ?? '/usr/bin:/bin'}`;
    try {
      const evidence = await executeEvidencePlan(
        context(repo), input, validated, createCandidateBinding(repo, input, validated),
      );
      expect(evidence.records[0]).toMatchObject({ status: 'verified-pass', fresh: true });
    } finally {
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
    }
  });

  test('evidence sandbox denies Mach service lookup inherited from the macOS process baseline', async () => {
    if (!hostBoundaryPrerequisite(process.platform === 'darwin', 'platform=darwin')) return;
    const clang = spawnSync('/usr/bin/xcrun', ['--find', 'clang'], { encoding: 'utf8' });
    if (!hostBoundaryPrerequisite(clang.status === 0, 'xcrun clang')) return;
    const probeRoot = mkdtempSync(join(tmpdir(), 'review-mach-lookup-'));
    roots.push(probeRoot);
    const probeSource = join(probeRoot, 'mach-lookup.c');
    const probe = join(probeRoot, 'mach-lookup');
    writeFileSync(
      probeSource,
      [
        '#include <mach/mach.h>',
        '#include <servers/bootstrap.h>',
        'int main(void) {',
        '  mach_port_t service = MACH_PORT_NULL;',
        '  kern_return_t result = bootstrap_look_up(bootstrap_port, "com.apple.logd", &service);',
        '  if (result != KERN_SUCCESS) return 0;',
        '  mach_port_deallocate(mach_task_self(), service);',
        '  return 9;',
        '}',
      ].join('\n'),
    );
    compileMachO([probeSource, '-o', probe]);
    const nativeLookup = spawnSync(probe, [], { encoding: 'utf8' });
    if (!hostBoundaryPrerequisite(
      nativeLookup.status === 9,
      'native com.apple.logd Mach lookup',
    )) return;
    const repo = gitFixture();
    const value = manifest();
    value.providers[0]!.operations[0]!.argv = [basename(probe)];
    const validated = reviewEvidenceManifestSchema.validate(value);
    const input = { source: 'git diff', diff: '', changedFiles: [] };
    const previousPath = process.env.PATH;
    process.env.PATH = `${probeRoot}:${previousPath ?? '/usr/bin:/bin'}`;
    try {
      const evidence = await executeEvidencePlan(
        context(repo), input, validated, createCandidateBinding(repo, input, validated),
      );
      expect(evidence.records[0]).toMatchObject({ status: 'verified-pass', fresh: true });
    } finally {
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
    }
  });

  test('regression RED requires the declared exact exit code', async () => {
    const repo = gitFixture();
    const value = manifest();
    value.providers[0] = {
      ...value.providers[0]!,
      kind: 'regression',
      operations: [
        { ...operation('red', ['node', '-e', 'process.exit(9)'], 'base', 'nonzero'), expectedExitCode: 42 },
        operation('green', ['true'], 'candidate', 'zero'),
      ],
    };
    const input = { source: 'git diff', diff: git(repo, ['diff']), changedFiles: ['a.ts'] };
    const validated = validateTransitionManifest(value, repo, input);
    const evidence = await executeEvidencePlan(
      context(repo),
      input,
      validated,
      createCandidateBinding(repo, input, validated),
    );
    expect(evidence.records[0]).toMatchObject({ status: 'verified-failure', exitStatus: 9 });
  });

  test('dyld sandbox denial cannot satisfy RED when caller output retention is one byte', async () => {
    const repo = gitFixture();
    const value = manifest();
    value.providers[0] = {
      ...value.providers[0]!,
      kind: 'regression',
      operations: [
        {
          ...operation('red', [
            'node',
            '-e',
            "process.stderr.write('dyld[123]: Library not loaded: /opt/homebrew/opt/libuv/lib/libuv.1.dylib\\n  Referenced from: /opt/homebrew/bin/node\\n  Reason: tried: libuv (file system sandbox blocked open())');process.exit(1)",
          ], 'base', 'nonzero'),
          expectedExitCode: 1,
          maxOutputBytes: 1,
        },
        operation('green', ['true'], 'candidate', 'zero'),
      ],
    };
    const input = { source: 'git diff', diff: '', changedFiles: [] };
    const validated = validateTransitionManifest(value, repo, input);
    const evidence = await executeEvidencePlan(
      context(repo), input, validated, createCandidateBinding(repo, input, validated),
    );
    expect(evidence.records[0]).toMatchObject({
      status: 'runtime-incomplete',
      exitStatus: 1,
      fresh: false,
    });
  });

  test('network evidence is rejected without an external authorized runner', async () => {
    const repo = gitFixture();
    const value = manifest();
    value.providers[0]!.operations[0] = {
      ...value.providers[0]!.operations[0]!,
      network: 'authorized',
      authorizationId: 'auth-a',
    };
    value.authorizations = [{
      id: 'auth-a',
      operation: 'pass',
      scope: 'fixture service',
      approvedBy: 'test-owner',
      approvedAt: new Date(Date.now() - 1000).toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    }];
    const validated = reviewEvidenceManifestSchema.validate(value);
    const input = { source: 'git diff', diff: '', changedFiles: [] };
    await expect(executeEvidencePlan(
      context(repo),
      input,
      validated,
      createCandidateBinding(repo, input, validated),
    )).rejects.toThrow('requires an operation-specific external runner');
  });

  test('root external-runner enforcement does not apply to a local-only dependency candidate', async () => {
    const repo = gitFixture();
    const rootManifest = reviewEvidenceManifestSchema.validate(
      JSON.parse(readFileSync(join(import.meta.dir, '../../goldband.review-evidence.json'), 'utf8')),
    );
    const input = {
      source: 'git diff',
      diff: [
        'diff --git a/goldband-loop/bun.lock b/goldband-loop/bun.lock',
        'diff --git a/goldband-loop/package.json b/goldband-loop/package.json',
      ].join('\n'),
      changedFiles: ['goldband-loop/bun.lock', 'goldband-loop/package.json'],
    };
    const evidence = await executeEvidencePlan(
      context(repo),
      input,
      rootManifest,
      createCandidateBinding(repo, input, rootManifest),
      new Set(['external-authorized-runner']),
    );

    expect(evidence.records).toEqual([]);
    expect(evidence.completeness).toEqual({
      complete: true,
      hostEligible: true,
      blockingCellIds: [],
      coverageGapCellIds: [],
      runtimeIncompleteCellIds: [],
    });
  });

  test('root external-runner enforcement remains fail closed when its provider applies', async () => {
    const repo = gitFixture();
    mkdirSync(join(repo, 'goldband-loop/workflows'), { recursive: true });
    writeFileSync(join(repo, 'goldband-loop/workflows/review-evidence.ts'), 'old();\n');
    git(repo, ['add', '.']); git(repo, ['commit', '-m', 'provider scope']);
    writeFileSync(join(repo, 'goldband-loop/workflows/review-evidence.ts'), 'fixed();\n');
    const rootManifest = reviewEvidenceManifestSchema.validate(
      JSON.parse(readFileSync(join(import.meta.dir, '../../goldband.review-evidence.json'), 'utf8')),
    );
    const input = {
      source: 'git diff',
      diff: git(repo, ['diff', '--binary']),
      changedFiles: ['goldband-loop/workflows/review-evidence.ts'],
    };
    const evidence = await executeEvidencePlan(
      context(repo),
      input,
      rootManifest,
      createCandidateBinding(repo, input, rootManifest),
      new Set(['external-authorized-runner']),
    );

    expect(evidence.records).toHaveLength(1);
    expect(evidence.records[0]).toMatchObject({
      id: 'review-evidence-tests:candidate-green',
      cellIds: expect.arrayContaining(['external-authorized-runner']),
      status: 'runtime-incomplete',
      fresh: false,
    });
    expect(evidence.completeness).toMatchObject({
      complete: false,
      hostEligible: false,
      runtimeIncompleteCellIds: ['external-authorized-runner'],
    });
  });

  test('runtime integration evidence preserves its declared verification level', async () => {
    const repo = gitFixture();
    const value = manifest();
    value.providers[0]!.kind = 'runtime-integration';
    value.providers[0]!.operations[0]!.evidenceLevel = 'sandboxed-service';
    const validated = reviewEvidenceManifestSchema.validate(value);
    const input = { source: 'git diff', diff: '', changedFiles: [] };
    const evidence = await executeEvidencePlan(
      context(repo),
      input,
      validated,
      createCandidateBinding(repo, input, validated),
    );
    expect(evidence.records[0]).toMatchObject({
      kind: 'runtime-integration',
      evidenceLevel: 'sandboxed-service',
      status: 'verified-pass',
    });
  });

  test('diff-scoped evidence excludes out-of-scope dirty and untracked files', async () => {
    const repo = gitFixture();
    writeFileSync(join(repo, 'poison.mjs'), 'throw new Error("out-of-scope");\n');
    writeFileSync(join(repo, 'untracked-sentinel'), 'must not reach the snapshot\n');
    mkdirSync(join(repo, 'node_modules', 'fixture-package'), { recursive: true });
    writeFileSync(
      join(repo, 'node_modules', 'fixture-package', 'package.json'),
      '{"name":"fixture-package","version":"1.0.0"}\n',
    );
    writeFileSync(
      join(repo, 'node_modules', 'fixture-package', 'index.js'),
      'module.exports = false;\n',
    );
    const value = manifest();
    value.providers[0]!.operations[0]!.argv = [
      'node',
      '-e',
      'const fs=require("node:fs"); if(fs.existsSync("untracked-sentinel")) process.exit(9)',
    ];
    const validated = reviewEvidenceManifestSchema.validate(value);
    const diff = 'diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old();\n+fixed();\n';
    const input = { source: 'diff file', diff, changedFiles: ['a.ts'] };
    const evidence = await executeEvidencePlan(
      context(repo),
      input,
      validated,
      createCandidateBinding(repo, input, validated),
    );
    expect(evidence.records[0]!.status).toBe('verified-pass');

    writeFileSync(
      join(repo, 'node_modules', 'fixture-package', 'index.js'),
      'module.exports = true;\n',
    );
    const worktreeEvidence = await executeEvidencePlan(
      { ...context(repo), options: { mode: 'mock' as const, worktree: true } },
      { ...input, source: 'git diff HEAD + untracked' },
      validated,
      createCandidateBinding(
        repo,
        { ...input, source: 'git diff HEAD + untracked' },
        validated,
      ),
    );
    expect(worktreeEvidence.records[0]!.status).toBe('verified-pass');
    expect(worktreeEvidence.records[0]!.commandDigest)
      .toBe(evidence.records[0]!.commandDigest);
    expect(worktreeEvidence.records[0]!.executionIdentityDigest)
      .not.toBe(evidence.records[0]!.executionIdentityDigest);
  });

  test('exact candidate retains tracked content resembling a skipped-file diagnostic', async () => {
    const repo = gitFixture();
    writeFileSync(
      join(repo, 'a.ts'),
      'old();\n[[review/code skipped untracked file: fixture literal]]\n',
    );
    const value = manifest();
    value.providers[0]!.operations[0]!.argv = [
      'node',
      '-e',
      'const fs=require("node:fs"); if(!fs.readFileSync("a.ts","utf8").includes("fixture literal")) process.exit(7)',
    ];
    const validated = reviewEvidenceManifestSchema.validate(value);
    const diff = git(repo, ['diff']);
    const input = { source: 'git diff', diff, changedFiles: ['a.ts'] };
    const evidence = await executeEvidencePlan(
      context(repo),
      input,
      validated,
      createCandidateBinding(repo, input, validated),
    );
    expect(evidence.records[0]!.status).toBe('verified-pass');
  });

  test('secret-like untracked code stays out of the prompt diff but executes in the bound candidate', async () => {
    const repo = gitFixture();
    const state = mkdtempSync(join(tmpdir(), 'review-evidence-state-'));
    roots.push(state);
    const secret = ['ghp', '1234567890abcdefghijklmnopqrstuv'].join('_');
    writeFileSync(
      join(repo, 'secret-check.mjs'),
      `const fixture=${JSON.stringify(secret)};if(!fixture.startsWith('ghp_'))process.exit(7);\n`,
    );
    const value = manifest();
    value.providers[0]!.operations[0]!.argv = ['node', 'secret-check.mjs'];
    writeFileSync(join(repo, 'goldband.review-evidence.json'), `${JSON.stringify(value)}\n`);
    const result = await runWorkflow(getWorkflow('review/code'), {
      mode: 'mock',
      host: 'mock',
      cwd: repo,
      goldbandHome: state,
      worktree: true,
      includeUntracked: true,
    });
    expect(String(result.output)).toContain('1 verified pass');
    const artifactFile = result.artifacts.find((file) => file.endsWith('-review-evidence.json'))!;
    const artifact = JSON.parse(readFileSync(artifactFile, 'utf8')) as InitialReviewArtifact;
    expect(artifact.diff).toContain('skipped untracked file: secret-like content');
    expect(artifact.diff).not.toContain(secret);
    expect(artifact.binding.changedFiles).toContain('secret-check.mjs');
  });

  test('redacted untracked bytes change the candidate binding without entering the diff', () => {
    const repo = gitFixture();
    const file = 'secret-check.mjs';
    const first = ['ghp', '1234567890abcdefghijklmnopqrstuv'].join('_');
    writeFileSync(join(repo, file), `const fixture=${JSON.stringify(first)};\n`);
    const firstDiff = untrackedFileDiff(repo, realpathSync(repo), file, { includedBytes: 0 });
    const value = reviewEvidenceManifestSchema.validate(manifest());
    const firstBinding = createCandidateBinding(repo, {
      source: 'git diff HEAD + untracked', diff: firstDiff, changedFiles: [file],
    }, value);
    const second = ['ghp', 'zyxwvutsrqponmlkjihgfedcba098765'].join('_');
    writeFileSync(join(repo, file), `const fixture=${JSON.stringify(second)};\n`);
    const secondDiff = untrackedFileDiff(repo, realpathSync(repo), file, { includedBytes: 0 });
    const secondBinding = createCandidateBinding(repo, {
      source: 'git diff HEAD + untracked', diff: secondDiff, changedFiles: [file],
    }, value);
    expect(firstDiff).toBe(secondDiff);
    expect(firstDiff).not.toContain(first);
    expect(firstBinding.candidateDigest).not.toBe(secondBinding.candidateDigest);
    expect(firstBinding.redactedUntrackedFiles).toEqual([{
      path: file,
      digest: digest(`const fixture=${JSON.stringify(first)};\n`),
      size: Buffer.byteLength(`const fixture=${JSON.stringify(first)};\n`),
      mode: '100644',
    }]);
  });

  test('redacted untracked materialization must match the bytes captured by candidate binding', async () => {
    const repo = gitFixture();
    const file = 'secret-check.mjs';
    const first = ['ghp', '1234567890abcdefghijklmnopqrstuv'].join('_');
    writeFileSync(join(repo, file), `const fixture=${JSON.stringify(first)};\n`);
    const diff = untrackedFileDiff(repo, realpathSync(repo), file, { includedBytes: 0 });
    const value = reviewEvidenceManifestSchema.validate(manifest());
    const input = { source: 'git diff HEAD + untracked', diff, changedFiles: [file] };
    const binding = createCandidateBinding(repo, input, value);
    const second = ['ghp', 'zyxwvutsrqponmlkjihgfedcba098765'].join('_');
    writeFileSync(join(repo, file), `const fixture=${JSON.stringify(second)};\n`);
    await expect(executeEvidencePlan(context(repo), input, value, binding))
      .rejects.toThrow('changed after candidate binding');
  });

  test('a failed deterministic gate is rendered as a verified blocker even if semantic review is separate', async () => {
    const repo = gitFixture();
    const state = join(repo, '.state');
    const diffFile = join(repo, 'candidate.diff');
    const evidenceFile = join(repo, 'evidence.json');
    const value = manifest();
    value.providers[0]!.operations[0]!.argv = ['false'];
    writeFileSync(evidenceFile, `${JSON.stringify(value)}\n`);
    writeFileSync(diffFile, 'diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old();\n+bad();\n');
    const result = await runWorkflow(getWorkflow('review/code'), {
      mode: 'mock',
      host: 'mock',
      cwd: repo,
      goldbandHome: state,
      diffFile: 'candidate.diff',
      evidenceManifestFile: 'evidence.json',
    });
    expect(String(result.output)).toContain('[verified-failure]');
    expect(String(result.output)).toContain('provider-a:pass');
    expect(String(result.output)).not.toContain('No findings.');
    const artifactFile = result.artifacts.find((file) => file.endsWith('-review-evidence.json'))!;
    const artifact = validateInitialReviewArtifact(JSON.parse(readFileSync(artifactFile, 'utf8')));
    const findingIds = artifact.findings.map((item) => item.id!);
    expect(new Set(findingIds).size).toBe(findingIds.length);
    expect(artifact.findings.some((item) => item.id?.startsWith('D-'))).toBe(true);
  });

  test('runner summaries redact secret-like output while retaining the full output digest', async () => {
    const repo = gitFixture();
    const value = manifest();
    value.providers[0]!.operations[0]!.argv = [
      'node',
      '-e',
      'process.stdout.write("api_key=fixture-secret-value")',
    ];
    const validated = reviewEvidenceManifestSchema.validate(value);
    const input = { source: 'git diff', diff: '', changedFiles: [] };
    const evidence = await executeEvidencePlan(
      context(repo),
      input,
      validated,
      createCandidateBinding(repo, input, validated),
    );
    expect(evidence.records[0]!.outputSummary).toBe('[REDACTED]');
    expect(evidence.records[0]!.outputDigest).toMatch(/^[a-f0-9]{64}$/);
  });

  test('runner terminates descendants that outlive their root command', async () => {
    if (process.platform === 'win32') return;
    const repo = gitFixture();
    const value = manifest();
    value.providers[0]!.operations[0]!.argv = [
      'node',
      '-e',
      'const {spawn}=require("node:child_process"); const child=spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"ignore"}); process.stdout.write(String(child.pid));',
    ];
    const validated = reviewEvidenceManifestSchema.validate(value);
    const input = { source: 'git diff', diff: '', changedFiles: [] };
    const evidence = await executeEvidencePlan(
      context(repo),
      input,
      validated,
      createCandidateBinding(repo, input, validated),
    );
    const pid = Number.parseInt(evidence.records[0]!.outputSummary, 10);
    let alive = true;
    try {
      process.kill(pid, 0);
    } catch {
      alive = false;
    }
    if (alive) process.kill(pid, 'SIGKILL');
    expect(alive).toBe(false);
  });

  test('pre-semantic artifacts cannot contain semantic findings', () => {
    const forged = initialArtifact();
    forged.hostCallCount = 0;
    forged.findings[0] = {
      ...forged.findings[0]!,
      id: 'D-001',
      category: 'deterministic-evidence',
      classification: 'semantic-concern',
    };
    expect(() => validateInitialReviewArtifact(forged))
      .toThrow('pre-semantic recovery requires deterministic-only findings');
  });

  test('closure accepts only original finding IDs and evidence-backed direct regressions', () => {
    const original = initialArtifact();
    const repairedBinding = {
      ...original.binding,
      candidateDigest: 'd'.repeat(64),
    };
    const closure = buildClosureInput(
      original,
      repairedBinding,
      'diff --git a/a.ts b/a.ts\n+fixed();',
      original.evidence.manifest,
    );
    expect(closure.affectedFindingIds).toEqual(['F-001']);
    expect(closure.repairDelta).not.toContain(original.diff);
    expect(() => validateClosureResults([{
      findingId: 'F-999',
      status: 'closed',
      summary: 'wrong scope',
    }], closure, original.evidence)).toThrow('non-original finding ID');
    expect(() => validateClosureResults([{
      findingId: 'F-001',
      status: 'direct-regression',
      summary: 'new failure',
      evidenceIds: ['gate:pass'],
    }], closure, original.evidence)).toThrow('requires verified rerun evidence');
    expect(() => validateClosureResults([{
      findingId: 'F-001',
      status: 'closed',
      summary: 'unsupported assertion',
    }], closure, original.evidence)).toThrow('requires fresh rerun evidence');
  });

  test('closure cannot use a passing record from an unrelated behavior cell', () => {
    const original = initialArtifact();
    const repairedManifest = structuredClone(original.evidence.manifest);
    repairedManifest.behaviorMatrix.push({
      ...repairedManifest.behaviorMatrix[0]!,
      id: 'behavior-b',
      providerIds: ['provider-b'],
    });
    repairedManifest.providers.push({
      ...repairedManifest.providers[0]!,
      id: 'provider-b',
      cellIds: ['behavior-b'],
    });
    const repairedBinding = {
      ...original.binding,
      candidateDigest: 'd'.repeat(64),
      behaviorContractDigest: digest(JSON.stringify(repairedManifest)),
    };
    const closure = buildClosureInput(
      original,
      repairedBinding,
      'diff --git a/a.ts b/a.ts\n+fixed();',
      repairedManifest,
    );
    const unrelated = bundle([{
      ...record(),
      id: 'provider-b:pass',
      providerId: 'provider-b',
      cellIds: ['behavior-b'],
    }]);
    unrelated.manifest = repairedManifest;
    expect(() => validateClosureResults([{
      findingId: 'F-001',
      status: 'closed',
      summary: 'wrong evidence',
      evidenceIds: ['provider-b:pass'],
    }], closure, unrelated)).toThrow('unrelated to finding behavior cells');
  });

  test('initial artifact rejects a forged disposition record for an automated cell', () => {
    const repo = gitFixture();
    const artifact = initialArtifact();
    artifact.evidence.manifest = reviewEvidenceManifestSchema.validate(artifact.evidence.manifest);
    const binding = createCandidateBinding(repo, {
      source: 'git diff',
      diff: artifact.diff,
      changedFiles: ['a.ts'],
    }, artifact.evidence.manifest);
    artifact.binding = binding;
    artifact.evidence.binding = binding;
    artifact.evidence.records = [{
      ...artifact.evidence.records[0]!,
      id: 'cell:behavior-a:not-applicable',
      providerId: undefined,
      operationId: undefined,
      kind: 'disposition',
      owner: 'behavior-matrix',
      commandDigest: undefined,
      executionIdentityDigest: undefined,
      snapshotDigestBefore: undefined,
      snapshotDigestAfter: undefined,
      replayCommand: undefined,
      candidateDigest: binding.candidateDigest,
      baseDigest: binding.baseDigest,
      scopeDigest: binding.scopeDigest,
    }];
    expect(() => validateInitialReviewArtifact(artifact))
      .toThrow('not authorized for behavior cell');
  });

  test('closure rejects caller-forged initial artifacts and atomically rejects double use', () => {
    const repo = gitFixture();
    const state = join(repo, '.state');
    const file = join(repo, 'initial-review.json');
    const { runtimeReceipt: _fixtureReceipt, ...payload } = initialArtifact();
    payload.evidence.manifest = reviewEvidenceManifestSchema.validate(payload.evidence.manifest);
    const binding = createCandidateBinding(repo, {
      source: 'git diff',
      diff: payload.diff,
      changedFiles: ['a.ts'],
    }, payload.evidence.manifest);
    payload.binding = binding;
    payload.evidence.binding = binding;
    payload.evidence.records = payload.evidence.records.map((record) => ({
      ...record,
      id: 'provider-a:pass',
      candidateDigest: binding.candidateDigest,
      baseDigest: binding.baseDigest,
      scopeDigest: binding.scopeDigest,
    }));
    payload.findings[0]!.evidenceIds = ['provider-a:pass'];
    const receiptContext = {
      ...context(repo),
      options: { mode: 'mock' as const, goldbandHome: state },
    };
    const issued = writeInitialReviewArtifact(file, payload, receiptContext);
    const forged = {
      ...issued,
      hostCallCount: 1,
      findings: [{ ...issued.findings[0]!, summary: 'forged closure authority' }],
      createdAt: new Date(Date.parse(issued.createdAt) + 1000).toISOString(),
    };
    writeFileSync(file, `${JSON.stringify(forged)}\n`);
    expect(() => readClosureArtifact({
      ...context(repo),
      options: {
        mode: 'mock' as const,
        goldbandHome: state,
        closureArtifactFile: file,
      },
    })).toThrow(/receipt|artifact/);

    writeFileSync(file, `${JSON.stringify(issued)}\n`);
    expect(readClosureArtifact({
      ...context(repo),
      options: {
        mode: 'mock' as const,
        goldbandHome: state,
        closureArtifactFile: file,
      },
    })).toEqual(issued);
    const closureContext = {
      ...context(repo),
      runId: 'closure-run-a',
      options: {
        mode: 'mock' as const,
        goldbandHome: state,
        closureArtifactFile: file,
      },
    };
    expect(claimInitialReviewClosure(closureContext, issued, 'f'.repeat(64)))
      .toContain('closure-claims');
    expect(() => claimInitialReviewClosure({
      ...closureContext,
      runId: 'closure-run-b',
    }, issued, 'e'.repeat(64))).toThrow('already been claimed');
    expect(() => readClosureArtifact({
      ...context(repo),
      options: {
        mode: 'mock' as const,
        goldbandHome: state,
        closureArtifactFile: file,
        workId: 'work-a',
        ticketId: 'ticket-a',
      },
    })).toThrow('receipt');
  });

  test('real runtime accepts a Claude-installed trusted authority config', () => {
    const repo = gitFixture();
    const runtimeRoot = join(repo, '.claude-runtime');
    const authorityRoot = join(repo, '.authority');
    const provision = spawnSync(process.execPath, [
      join(import.meta.dir, '..', 'scripts', 'provision-review-receipt-authority.ts'),
      '--runtime-root', runtimeRoot,
      '--authority-root', authorityRoot,
    ], { encoding: 'utf8' });
    expect(provision.status, provision.stderr).toBe(0);
    const { runtimeReceipt: _fixtureReceipt, ...payload } = initialArtifact();
    payload.evidence.manifest = reviewEvidenceManifestSchema.validate(payload.evidence.manifest);
    const binding = createCandidateBinding(repo, {
      source: 'git diff',
      diff: payload.diff,
      changedFiles: ['a.ts'],
    }, payload.evidence.manifest);
    payload.binding = binding;
    payload.evidence.binding = binding;
    payload.evidence.records = payload.evidence.records.map((record) => ({
      ...record,
      id: 'provider-a:pass',
      candidateDigest: binding.candidateDigest,
      baseDigest: binding.baseDigest,
      scopeDigest: binding.scopeDigest,
    }));
    payload.findings[0]!.evidenceIds = ['provider-a:pass'];
    const configEnv = 'GOLDBAND_REVIEW_RECEIPT_TRUSTED_CONFIG';
    const previous = process.env[configEnv];
    process.env[configEnv] = join(runtimeRoot, 'trusted-runtime.json');
    try {
      const file = join(repo, 'claude-initial-review.json');
      const ctx = {
        ...context(repo),
        options: { mode: 'real' as const, closureArtifactFile: file },
      };
      const issued = writeInitialReviewArtifact(file, payload, ctx);
      expect(readClosureArtifact(ctx)).toEqual(issued);
    } finally {
      if (previous === undefined) delete process.env[configEnv];
      else process.env[configEnv] = previous;
    }
  });

  test('closure reruns newly added or changed behavior contracts', () => {
    const original = initialArtifact();
    const repairedManifest = structuredClone(original.evidence.manifest);
    repairedManifest.behaviorMatrix.push({
      id: 'behavior-b',
      behavior: 'The omitted boundary is verified.',
      kind: 'boundary',
      input: 'boundary fixture',
      preconditions: 'repair is present',
      expected: 'command exits successfully',
      risk: 'high',
      disposition: 'static',
      providerIds: ['provider-b'],
    });
    repairedManifest.providers.push({
      id: 'provider-b',
      owner: 'test',
      kind: 'static',
      lifecycle: 'persistent',
      cellIds: ['behavior-b'],
      applicability: { kind: 'global', reason: 'Explicit closure fixture.' },
      executionContext: { sandboxOwner: 'review-runtime', runner: 'sealed' },
      operations: [operation('pass-b', ['true'], 'candidate', 'zero')],
    });
    const repairedBinding = {
      ...original.binding,
      candidateDigest: 'd'.repeat(64),
      behaviorContractDigest: 'f'.repeat(64),
    };
    const closure = buildClosureInput(
      original,
      repairedBinding,
      'diff --git a/a.ts b/a.ts\n+fixed();',
      repairedManifest,
    );
    expect(closure.affectedCellIds).toContain('behavior-b');
    expect(closure.originalBehaviorContractDigest)
      .not.toBe(closure.repairedBehaviorContractDigest);
  });

  test('closure decodes Git-quoted paths before selecting scoped providers', () => {
    const original = initialArtifact();
    const path = 'odd\tline\nslash\\quote".ts';
    const header = `diff --git ${JSON.stringify(`a/${path}`)} ${JSON.stringify(`b/${path}`)}`;
    original.diff = `${header}\n--- ${JSON.stringify(`a/${path}`)}\n+++ ${JSON.stringify(`b/${path}`)}\n@@ -1 +1 @@\n-old();\n+bad();\n`;
    original.binding.candidateDigest = digest(original.diff);
    original.evidence.binding = original.binding;
    original.evidence.manifest.providers[0]!.applicability = { kind: 'paths', pathPrefixes: [path] };
    const repairedDiff = original.diff.replace('+bad();', '+fixed();');
    const closure = buildClosureInput(
      original,
      { ...original.binding, candidateDigest: digest(repairedDiff) },
      repairedDiff,
      original.evidence.manifest,
    );
    expect(closure.affectedCellIds).toContain('behavior-a');
  });

  test('closure uses patch path headers for Git output with an unquoted space', () => {
    const repo = gitFixture();
    const path = 'space name.ts';
    writeFileSync(join(repo, path), 'old();\n');
    git(repo, ['add', path]);
    git(repo, ['commit', '-m', 'add spaced path']);
    writeFileSync(join(repo, path), 'bad();\n');
    const originalDiff = git(repo, ['diff', '--', path]);
    expect(originalDiff).toContain(`diff --git a/${path} b/${path}`);
    const original = initialArtifact();
    original.diff = originalDiff;
    original.binding.candidateDigest = digest(originalDiff);
    original.evidence.binding = original.binding;
    original.evidence.manifest.providers[0]!.applicability = { kind: 'paths', pathPrefixes: [path] };
    const repairedDiff = originalDiff.replace('+bad();', '+fixed();');
    const closure = buildClosureInput(
      original,
      { ...original.binding, candidateDigest: digest(repairedDiff) },
      repairedDiff,
      original.evidence.manifest,
    );
    expect(closure.affectedCellIds).toContain('behavior-a');
  });

  test('closure ignores patch-looking candidate lines after the hunk header', () => {
    const original = initialArtifact();
    original.diff = 'diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1,2 @@\n-old();\n+bad();\n+++ b/spoofed.ts\n';
    original.binding.candidateDigest = digest(original.diff);
    original.evidence.binding = original.binding;
    original.evidence.manifest.providers[0]!.applicability = { kind: 'paths', pathPrefixes: ['a.ts'] };
    const repairedDiff = original.diff.replace('+bad();', '+fixed();');
    const closure = buildClosureInput(
      original,
      { ...original.binding, candidateDigest: digest(repairedDiff) },
      repairedDiff,
      original.evidence.manifest,
    );
    expect(closure.affectedCellIds).toContain('behavior-a');
  });

  test('closure parses a headerless binary patch for an unquoted space path', () => {
    const repo = gitFixture();
    const path = 'space name.bin';
    writeFileSync(join(repo, path), Buffer.from([0, 1, 2, 3]));
    git(repo, ['add', path]);
    git(repo, ['commit', '-m', 'add spaced binary']);
    writeFileSync(join(repo, path), Buffer.from([0, 9, 8, 7]));
    const originalDiff = git(repo, ['diff', '--binary', '--', path]);
    expect(originalDiff).toContain(`diff --git a/${path} b/${path}`);
    expect(originalDiff).not.toContain('+++ ');
    const original = initialArtifact();
    original.diff = originalDiff;
    original.binding.candidateDigest = digest(originalDiff);
    original.evidence.binding = original.binding;
    original.evidence.manifest.providers[0]!.applicability = { kind: 'paths', pathPrefixes: [path] };
    const repairedDiff = originalDiff.replace('literal 4', 'literal 5');
    const closure = buildClosureInput(
      original,
      { ...original.binding, candidateDigest: digest(repairedDiff) },
      repairedDiff,
      original.evidence.manifest,
    );
    expect(closure.affectedCellIds).toContain('behavior-a');
  });

  test('closure uses rename-to for a headerless spaced rename', () => {
    const repo = gitFixture();
    writeFileSync(join(repo, 'rename-source.ts'), 'value();\n');
    git(repo, ['add', 'rename-source.ts']);
    git(repo, ['commit', '-m', 'add rename source']);
    git(repo, ['mv', 'rename-source.ts', 'bad name.ts']);
    const originalDiff = git(repo, ['diff', '--cached', '--find-renames']);
    git(repo, ['mv', 'bad name.ts', 'fixed name.ts']);
    const repairedDiff = git(repo, ['diff', '--cached', '--find-renames']);
    expect(repairedDiff).toContain('rename to fixed name.ts');
    expect(repairedDiff).not.toContain('+++ ');
    const original = initialArtifact();
    original.diff = originalDiff;
    original.binding.candidateDigest = digest(originalDiff);
    original.evidence.binding = original.binding;
    original.evidence.manifest.providers[0]!.applicability = { kind: 'paths', pathPrefixes: ['fixed name.ts'] };
    const closure = buildClosureInput(
      original,
      { ...original.binding, candidateDigest: digest(repairedDiff) },
      repairedDiff,
      original.evidence.manifest,
    );
    expect(closure.affectedCellIds).toContain('behavior-a');
  });

  test('closure repair delta emits separated compact hunks without the unchanged middle', () => {
    const original = initialArtifact();
    const middle = Array.from({ length: 80 }, (_, index) => ` context-${index}`).join('\n');
    original.diff = `diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1,82 +1,82 @@\n-old-start\n+bad-start\n${middle}\n-old-end\n+bad-end\n`;
    original.binding.candidateDigest = digest(original.diff);
    original.evidence.binding = original.binding;
    const repairedDiff = original.diff
      .replace('+bad-start', '+fixed-start')
      .replace('+bad-end', '+fixed-end');
    const repairedBinding = {
      ...original.binding,
      candidateDigest: digest(repairedDiff),
    };
    const closure = buildClosureInput(original, repairedBinding, repairedDiff, original.evidence.manifest);
    expect(closure.repairDelta).toContain('+fixed-start');
    expect(closure.repairDelta).toContain('+fixed-end');
    expect(closure.repairDelta).not.toContain('context-40');
    expect(closure.repairDelta.match(/^@@/gm)?.length).toBe(2);
  });

  test('closure represents redacted untracked repairs by safe path and digest metadata', () => {
    const original = initialArtifact();
    original.binding.redactedUntrackedFiles = [{
      path: 'secret-check.mjs', digest: '1'.repeat(64), size: 48, mode: '100644',
    }];
    original.evidence.binding = original.binding;
    const repairedBinding = {
      ...original.binding,
      candidateDigest: 'd'.repeat(64),
      redactedUntrackedFiles: [{
        path: 'secret-check.mjs', digest: '2'.repeat(64), size: 52, mode: '100644',
      }],
    };
    const closure = buildClosureInput(
      original,
      repairedBinding,
      original.diff,
      original.evidence.manifest,
    );
    expect(closure.repairDelta).toContain('REDACTED_UNTRACKED_DELTA "secret-check.mjs"');
    expect(closure.repairDelta).toContain('1'.repeat(64));
    expect(closure.repairDelta).toContain('2'.repeat(64));
    expect(closure.affectedCellIds).toContain('behavior-a');
  });

  test('closure scope identity permits repair-added files but not a different scope kind', () => {
    const repo = gitFixture();
    const value = reviewEvidenceManifestSchema.validate(manifest());
    const original = createCandidateBinding(repo, {
      source: 'git diff HEAD',
      diff: 'diff --git a/a.ts b/a.ts\n+bad();',
      changedFiles: ['a.ts'],
    }, value);
    const expanded = createCandidateBinding(repo, {
      source: 'git diff HEAD + untracked',
      diff: 'diff --git a/a.ts b/a.ts\n+fixed();\ndiff --git a/a.test.ts b/a.test.ts\n+test();',
      changedFiles: ['a.test.ts', 'a.ts'],
    }, value);
    const different = createCandidateBinding(repo, {
      source: 'diff-file:repair.diff',
      diff: expanded.candidateDigest,
      changedFiles: ['a.ts'],
    }, value);
    expect(expanded.scopeDigest).toBe(original.scopeDigest);
    expect(different.scopeDigest).not.toBe(original.scopeDigest);
    const artifact = initialArtifact();
    expect(() => buildClosureInput(
      artifact,
      { ...artifact.binding, candidateDigest: 'd'.repeat(64), baseDigest: 'f'.repeat(64) },
      'diff --git a/a.ts b/a.ts\n+fixed();',
      artifact.evidence.manifest,
    )).toThrow('does not match repository, base, or scope');
  });

  test('verified-failure closure cannot replace a failing command behind the same ID', () => {
    const original = initialArtifact();
    original.findings[0] = {
      ...original.findings[0]!,
      classification: 'verified-failure',
      evidenceIds: ['gate:pass'],
    };
    original.evidence.records[0] = {
      ...original.evidence.records[0]!,
      status: 'verified-failure',
      commandDigest: '1'.repeat(64),
      replayCommand: ['false'],
    };
    original.evidence.manifest.providers[0]!.operations[0] =
      operation('pass', ['false'], 'candidate', 'zero');
    const closure = buildClosureInput(
      original,
      { ...original.binding, candidateDigest: 'd'.repeat(64) },
      'diff --git a/a.ts b/a.ts\n+fixed();',
      original.evidence.manifest,
    );
    const rerun = bundle([{
      ...original.evidence.records[0]!,
      status: 'verified-pass',
      commandDigest: '2'.repeat(64),
      replayCommand: ['true'],
    }]);
    expect(() => validateClosureResults([{
      findingId: 'F-001',
      status: 'closed',
      summary: 'command was weakened',
      evidenceIds: ['gate:pass'],
    }], closure, rerun)).toThrow('unchanged original failed operation');
  });

  test('verified-failure closure permits a fresh execution identity for the same operation contract', () => {
    const original = initialArtifact();
    original.evidence.manifest = JSON.parse(JSON.stringify(original.evidence.manifest));
    original.findings[0] = {
      ...original.findings[0]!,
      classification: 'verified-failure',
      evidenceIds: ['gate:pass'],
    };
    original.evidence.records[0] = {
      ...original.evidence.records[0]!,
      status: 'verified-failure',
      commandDigest: '1'.repeat(64),
      executionIdentityDigest: '2'.repeat(64),
    };
    const closure = buildClosureInput(
      original,
      { ...original.binding, candidateDigest: 'd'.repeat(64) },
      'diff --git a/a.ts b/a.ts\n+fixed();',
      original.evidence.manifest,
    );
    const rerun = bundle([{
      ...original.evidence.records[0]!,
      status: 'verified-pass',
      commandDigest: '1'.repeat(64),
      executionIdentityDigest: '3'.repeat(64),
      candidateDigest: 'd'.repeat(64),
    }]);
    expect(validateClosureResults([{
      findingId: 'F-001',
      status: 'closed',
      summary: 'same operation passes under the repaired runtime',
      evidenceIds: ['gate:pass'],
    }], closure, rerun)[0]).toMatchObject({ status: 'closed' });
  });

  test('verified-failure closure cannot change the invocation offset of the failed operation', () => {
    const original = initialArtifact();
    original.findings[0] = {
      ...original.findings[0]!,
      classification: 'verified-failure',
      evidenceIds: ['gate:pass'],
    };
    original.evidence.records[0] = {
      ...original.evidence.records[0]!,
      status: 'verified-failure',
      commandDigest: '1'.repeat(64),
    };
    const closure = buildClosureInput(
      original,
      { ...original.binding, candidateDigest: 'd'.repeat(64) },
      'diff --git a/a.ts b/a.ts\n+fixed();',
      original.evidence.manifest,
    );
    const rerun = bundle([{
      ...original.evidence.records[0]!,
      status: 'verified-pass',
      commandDigest: '2'.repeat(64),
      candidateDigest: 'd'.repeat(64),
    }]);

    expect(() => validateClosureResults([{
      findingId: 'F-001',
      status: 'closed',
      summary: 'same argv passed from a different invocation directory',
      evidenceIds: ['gate:pass'],
    }], closure, rerun)).toThrow('unchanged original failed operation');
  });

  test('closure is forbidden after an initial zero-finding review', () => {
    const artifact = { ...initialArtifact(), findings: [] };
    expect(() => validateInitialReviewArtifact(artifact))
      .toThrow('closure is forbidden when initial review has no findings');
  });

  test('closure prompt omits verbose initial narratives and stays bounded', () => {
    const artifact = initialArtifact();
    artifact.findings[0]!.failureScenario = 'verbose-initial-scenario-'.repeat(1000);
    artifact.findings[0]!.behaviorCellIds = ['behavior-a'];
    const repairedBinding = {
      ...artifact.binding,
      candidateDigest: '9'.repeat(64),
    };
    const rerun = bundle([{ ...record(), candidateDigest: repairedBinding.candidateDigest }]);
    rerun.binding = repairedBinding;
    const prompt = buildClosureReviewPrompt(
      context('/repo'),
      {
        artifact,
        repairedBinding,
        originalBehaviorContractDigest: artifact.binding.behaviorContractDigest,
        repairedBehaviorContractDigest: repairedBinding.behaviorContractDigest,
        repairDelta: `diff --git a/a.ts b/a.ts\n${'+repair();\n'.repeat(1200)}`,
        affectedFindingIds: ['F-001'],
        affectedCellIds: ['behavior-a'],
      },
      rerun,
      { bundle: { selected: [], snapshot: [] }, text: 'closure rule' },
    );
    expect(Buffer.byteLength(prompt)).toBeLessThanOrEqual(32 * 1024);
    expect(prompt).not.toContain('verbose-initial-scenario');
    expect(prompt).toContain('F-001');
    expect(prompt).toContain('gate:pass');
  });

  test('mock runtime performs one initial host call and one separately scoped closure call', async () => {
    const repo = gitFixture();
    const state = join(repo, '.state');
    const originalDiff = join(repo, 'candidate.diff');
    const evidenceFile = join(repo, 'goldband.review-evidence.json');
    writeFileSync(evidenceFile, `${JSON.stringify(manifest())}\n`);
    writeFileSync(originalDiff, 'diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old();\n+bad();\n');
    const initial = await runWorkflow(getWorkflow('review/code'), {
      mode: 'mock',
      host: 'mock',
      cwd: repo,
      goldbandHome: state,
      diffFile: 'candidate.diff',
      evidenceManifestFile: 'goldband.review-evidence.json',
    });
    const artifact = initial.artifacts.find((file) => file.endsWith('-review-evidence.json'))!;
    expect(artifact).toBeDefined();
    writeFileSync(originalDiff, 'diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old();\n+fixed();\n');
    const repairedManifest = manifest();
    repairedManifest.behaviorMatrix.push({
      id: 'behavior-b',
      behavior: 'A newly disclosed repair boundary passes.',
      kind: 'boundary',
      input: 'repair boundary',
      preconditions: 'the repair is applied',
      expected: 'the new provider exits successfully',
      risk: 'high',
      disposition: 'static',
      providerIds: ['provider-b'],
    });
    repairedManifest.providers.push({
      id: 'provider-b',
      owner: 'test',
      kind: 'static',
      lifecycle: 'persistent',
      cellIds: ['behavior-b'],
      applicability: { kind: 'global', reason: 'Explicit closure fixture.' },
      executionContext: { sandboxOwner: 'review-runtime', runner: 'sealed' },
      operations: [operation('pass-b', ['true'], 'candidate', 'zero')],
    });
    writeFileSync(evidenceFile, `${JSON.stringify(repairedManifest)}\n`);
    const closure = await runWorkflow(getWorkflow('review/code'), {
      mode: 'mock',
      host: 'mock',
      cwd: repo,
      goldbandHome: state,
      diffFile: 'candidate.diff',
      evidenceManifestFile: 'goldband.review-evidence.json',
      closureArtifactFile: artifact,
    });
    expect(String(closure.output)).toContain('Phase: closure.');
    expect(String(closure.output)).toContain('[closed] S-001');
    expect(String(closure.output)).toContain('provider-b:pass-b');
    expect(closure.artifacts.some((file) => file.endsWith('-review-closure.json'))).toBe(true);
    const telemetry = JSON.parse(readFileSync(
      join(state, 'workflow-runs', 'telemetry', `${closure.runId}-review-prompt.json`),
      'utf8',
    ));
    expect(telemetry).toMatchObject({
      phase: 'closure',
      hostCallCount: 1,
      originalDiffBytesSent: 0,
    });
    expect(telemetry.repairDeltaBytes).toBeGreaterThan(0);
  });

  test('closure cannot inherit transition evidence bound to the original candidate', async () => {
    const repo = gitFixture();
    const state = join(repo, '.state');
    const diffFile = join(repo, 'candidate.diff');
    const transitionFile = join(repo, 'transition.json');
    const originalDiff = 'diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old();\n+bad();\n';
    writeFileSync(diffFile, originalDiff);
    const input = {
      source: `diff-file:${diffFile}`,
      diff: originalDiff,
      changedFiles: ['a.ts'],
    };
    writeFileSync(
      transitionFile,
      `${JSON.stringify(validateTransitionManifest(manifest(), repo, input))}\n`,
    );
    const transition = validateTransitionReviewEvidenceManifest(
      JSON.parse(readFileSync(transitionFile, 'utf8')),
      createCandidateBinding(repo, input, JSON.parse(readFileSync(transitionFile, 'utf8'))),
    );
    const binding = createCandidateBinding(repo, input, transition);
    const { runtimeReceipt: _fixtureReceipt, ...payload } = initialArtifact();
    payload.binding = binding;
    payload.diff = originalDiff;
    payload.evidence.manifest = transition;
    payload.evidence.binding = binding;
    payload.evidence.records[0] = {
      ...payload.evidence.records[0]!,
      id: 'provider-a:pass',
      candidateDigest: binding.candidateDigest,
      baseDigest: binding.baseDigest,
      scopeDigest: binding.scopeDigest,
    };
    payload.findings[0]!.evidenceIds = ['provider-a:pass'];
    const artifact = join(repo, 'initial-transition-review.json');
    writeInitialReviewArtifact(artifact, payload, {
      ...context(repo),
      options: { mode: 'mock' as const, goldbandHome: state },
    });
    writeFileSync(
      diffFile,
      'diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old();\n+fixed();\n',
    );
    expect(runWorkflow(getWorkflow('review/code'), {
      mode: 'mock',
      host: 'mock',
      cwd: repo,
      goldbandHome: state,
      diffFile: 'candidate.diff',
      closureArtifactFile: artifact,
    })).rejects.toThrow(/transition evidence provider provider-a binding mismatch for candidateDigest/);
  });
});

function buildChoiceDylib(directory: string, value: number): string {
  const source = join(directory, 'choice.c');
  const library = join(directory, 'libchoice.dylib');
  writeFileSync(source, `int choice(void) { return ${value}; }\n`);
  compileMachO([
    '-dynamiclib', source,
    '-install_name', '@rpath/libchoice.dylib',
    '-o', library,
  ]);
  return library;
}

function compileMachO(args: string[]): void {
  const result = spawnSync('/usr/bin/xcrun', ['--sdk', 'macosx', 'clang', ...args], {
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`Mach-O fixture compilation failed: ${result.stderr}`);
  }
}

function writeFixtureWheel(python: string, output: string): void {
  const script = [
    'import sys,zipfile',
    'p=sys.argv[1]',
    'z=zipfile.ZipFile(p,"w",compression=zipfile.ZIP_DEFLATED)',
    'z.writestr("fixture_dep/__init__.py","VALUE = 42\\n")',
    'z.writestr("fixture_dep-1.0.0.dist-info/METADATA","Metadata-Version: 2.1\\nName: fixture-dep\\nVersion: 1.0.0\\n")',
    'z.writestr("fixture_dep-1.0.0.dist-info/WHEEL","Wheel-Version: 1.0\\nGenerator: goldband-test\\nRoot-Is-Purelib: true\\nTag: py3-none-any\\n")',
    'z.writestr("fixture_dep-1.0.0.dist-info/RECORD","")',
    'z.close()',
  ].join(';');
  const result = spawnSync(python, ['-I', '-S', '-c', script, output], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr);
}

function manifest(): ReviewEvidenceManifest {
  return {
    schemaVersion: 2,
    behaviorMatrix: [{
      id: 'behavior-a',
      behavior: 'The candidate passes the fixture gate.',
      kind: 'normal',
      input: 'fixture input',
      preconditions: 'isolated runner exists',
      expected: 'command exits successfully',
      risk: 'high',
      disposition: 'static',
      providerIds: ['provider-a'],
    }],
    providers: [{
      id: 'provider-a',
      owner: 'test',
      kind: 'static',
      lifecycle: 'persistent',
      cellIds: ['behavior-a'],
      applicability: { kind: 'global', reason: 'Explicit single-provider test fixture.' },
      executionContext: { sandboxOwner: 'review-runtime', runner: 'sealed' },
      operations: [operation('pass', ['true'], 'candidate', 'zero')],
    }],
    authorizations: [],
  };
}

function validateTransitionManifest(
  value: ReviewEvidenceManifest,
  repo: string,
  input: { source: string; diff: string; changedFiles: string[] },
): ReviewEvidenceManifest {
  const provider = value.providers[0]!;
  provider.lifecycle = 'transition';
  const preliminaryBinding = createCandidateBinding(repo, input, value);
  provider.transitionBinding = {
    repository: preliminaryBinding.repository,
    baseDigest: preliminaryBinding.baseDigest,
    candidateDigest: preliminaryBinding.candidateDigest,
    scopeDigest: preliminaryBinding.scopeDigest,
    operationContractDigest: transitionEvidenceOperationContractDigest(provider.operations),
  };
  return validateTransitionReviewEvidenceManifest(value, preliminaryBinding);
}

function operation(
  id: string,
  argv: string[],
  target: 'base' | 'candidate',
  expectedExit: 'zero' | 'nonzero',
) {
  return {
    id,
    target,
    argv,
    expectedExit,
    ...(expectedExit === 'nonzero' ? { expectedExitCode: 42 } : {}),
    timeoutMs: 10_000,
    maxOutputBytes: 4096,
    network: 'deny' as const,
    evidenceLevel: 'fixture' as const,
  };
}

function gitFixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'review-evidence-test-'));
  roots.push(root);
  git(root, ['init']);
  git(root, ['config', 'user.name', 'Test']);
  git(root, ['config', 'user.email', 'test@example.com']);
  writeFileSync(join(root, 'check.mjs'), 'process.exit(42);\n');
  writeFileSync(join(root, 'a.ts'), 'old();\n');
  git(root, ['add', 'check.mjs', 'a.ts']);
  git(root, ['commit', '-m', 'base']);
  return root;
}

function git(cwd: string, args: string[]): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout;
}

function context(cwd: string) {
  return {
    runId: 'test-run',
    workflow: getWorkflow('review/code'),
    cwd,
    options: { mode: 'mock' as const },
    artifacts: [],
  };
}

function record() {
  const now = new Date().toISOString();
  return {
    id: 'gate:pass',
    providerId: 'provider-a',
    operationId: 'pass',
    cellIds: ['behavior-a'],
    owner: 'test',
    kind: 'static' as const,
    status: 'verified-pass' as const,
    evidenceLevel: 'fixture' as const,
    environment: 'fixture',
    commandDigest: 'e'.repeat(64),
    executionIdentityDigest: 'f'.repeat(64),
    snapshotDigestBefore: '0'.repeat(64),
    snapshotDigestAfter: '0'.repeat(64),
    replayCommand: ['true'],
    exitStatus: 0,
    startedAt: now,
    finishedAt: now,
    outputDigest: 'a'.repeat(64),
    outputSummary: 'pass',
    candidateDigest: 'b'.repeat(64),
    baseDigest: 'c'.repeat(64),
    scopeDigest: 'd'.repeat(64),
    fresh: true,
  };
}

function bundle(records = [record()]): ReviewEvidenceBundle {
  return {
    schemaVersion: 1,
    manifest: manifest(),
    binding: {
      repository: '/repo',
      baseRef: 'HEAD',
      baseDigest: 'c'.repeat(64),
      candidateDigest: 'b'.repeat(64),
      scopeDigest: 'd'.repeat(64),
      behaviorContractDigest: 'e'.repeat(64),
      changedFiles: ['a.ts'],
      redactedUntrackedFiles: [],
    },
    records,
    completeness: {
      complete: true,
      hostEligible: true,
      blockingCellIds: [],
      coverageGapCellIds: [],
      runtimeIncompleteCellIds: [],
    },
    manifestSource: 'fixture',
  };
}

function finding(overrides = {}) {
  return {
    file: 'a.ts',
    line: 1,
    severity: 'high' as const,
    summary: 'Reachable failure.',
    evidence: 'Observed mismatch.',
    failureScenario: 'A request reaches the invalid branch.',
    suggestedVerification: 'Replay the focused command.',
    ...overrides,
  };
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function initialArtifact(): InitialReviewArtifact {
  const evidence = bundle();
  return {
    schemaVersion: 1,
    phase: 'initial',
    runId: 'initial-run',
    binding: evidence.binding,
    diff: 'diff --git a/a.ts b/a.ts\n+bad();',
    evidence,
    findings: [{
      ...finding(),
      id: 'F-001',
      classification: 'semantic-concern',
      evidenceIds: ['gate:pass'],
    }],
    hostCallCount: 1,
    createdAt: new Date().toISOString(),
    runtimeReceipt: {
      schemaVersion: 1,
      id: 'fixture-receipt',
      digest: '1'.repeat(64),
      signature: '2'.repeat(64),
      reviewScope: { kind: 'standalone' },
    },
  };
}


describe('candidate-bound GitHub review evidence', () => {
  const revision = 'a'.repeat(40);
  const tree = 'b'.repeat(40);
  const providerId = 'review-evidence-tests';
  function apiFixture(revisionValue = revision, treeValue = tree) {
    const revision = revisionValue; const tree = treeValue;
    const run = { id: 10, run_attempt: 2, head_sha: revision, path: '.github/workflows/validate.yml',
      event: 'push', head_branch: 'dev', repository: { full_name: 'leo110047/goldband' },
      head_repository: { full_name: 'leo110047/goldband' }, status: 'completed' };
    const step = { name: `Review evidence - ${providerId}`, status: 'completed', conclusion: 'success' };
    const job = { id: 20, run_id: 10, head_sha: revision, name: 'macOS Seatbelt review evidence contracts',
      status: 'completed', conclusion: 'failure', steps: [step] };
    const replies: Record<string, any> = {
      [`git/commits/${revision}`]: { sha: revision, tree: { sha: tree } },
      [`actions/workflows/validate.yml/runs?head_sha=${revision}&event=push&branch=dev&per_page=100`]: { workflow_runs: [run] },
      'actions/runs/10/attempts/2/jobs?per_page=100': { total_count: 1, jobs: [job] },
      'actions/runs/10': structuredClone(run),
    };
    const calls: string[] = [];
    const read = async (path: string) => { calls.push(path); if (!(path in replies)) throw new Error(`unexpected API ${path}`); return replies[path]; };
    return { run, step, job, replies, calls, read };
  }
  test('accepts only the exact step and attempt, independently of a later unrelated job failure', async () => {
    const api = apiFixture();
    const proof = await readReviewCiResult(revision, tree, providerId, api.read);
    expect(proof).toMatchObject({ revision, tree, runId: 10, attempt: 2, jobId: 20, conclusion: 'success' });
    expect(api.calls).toEqual(Object.keys(api.replies));
    expect(() => validateReviewCiProvenance(proof, providerId)).not.toThrow();
    expect(() => validateReviewCiProvenance({ ...proof, runId: -1 }, providerId)).toThrow();
  });
  test('rejects a replacement tree even when the local commit identity has a green run', async () => {
    const api = apiFixture();
    await expect(readReviewCiResult(revision, 'c'.repeat(40), providerId, api.read)).rejects.toThrow('commit tree');
    expect(api.calls).toHaveLength(1);
  });
  test('does not reuse an older green run when the newest attempt is pending', async () => {
    const api = apiFixture();
    api.replies[Object.keys(api.replies)[1]!].workflow_runs.push({ ...api.run, id: 11, status: 'in_progress' });
    await expect(readReviewCiResult(revision, tree, providerId, api.read)).rejects.toThrow('still running');
  });
  for (const conclusion of ['failure', 'cancelled', 'skipped', 'timed_out', 'neutral']) {
    test(`does not promote CI ${conclusion} to verified execution`, async () => {
      const api = apiFixture(); api.step.conclusion = conclusion;
      await expect(readReviewCiResult(revision, tree, providerId, api.read)).rejects.toThrow('no successful execution');
    });
  }
  test('rejects wrong run provenance, ambiguous steps, truncated jobs, and concurrent reruns', async () => {
    for (const field of ['event', 'head_branch', 'path', 'head_sha']) {
      const api = apiFixture(); (api.run as any)[field] = 'wrong';
      await expect(readReviewCiResult(revision, tree, providerId, api.read)).rejects.toThrow('does not match');
    }
    let api = apiFixture(); api.job.steps.push({ ...api.step });
    await expect(readReviewCiResult(revision, tree, providerId, api.read)).rejects.toThrow('no successful execution');
    api = apiFixture(); api.replies['actions/runs/10/attempts/2/jobs?per_page=100'].total_count = 101;
    await expect(readReviewCiResult(revision, tree, providerId, api.read)).rejects.toThrow('truncated');
    api = apiFixture(); api.replies['actions/runs/10'].run_attempt = 3;
    await expect(readReviewCiResult(revision, tree, providerId, api.read)).rejects.toThrow('changed while');
  });
  test('materialized tree matches native Git with modes, symlinks, sorting and empty directories', () => {
    const repo = gitFixture();
    mkdirSync(join(repo, 'a-dir')); mkdirSync(join(repo, 'a-dir', 'empty'));
    writeFileSync(join(repo, 'a-dir', 'unicode-中'), 'content');
    writeFileSync(join(repo, 'a-dir.txt'), 'prefix ordering');
    chmodSync(join(repo, 'check.mjs'), 0o755); symlinkSync('a.ts', join(repo, 'link'));
    git(repo, ['add', '.']); git(repo, ['commit', '-m', 'tree']);
    const snapshot = mkdtempSync(join(tmpdir(), 'review-ci-tree-')); roots.push(snapshot);
    const archive = spawnSync('git', ['archive', 'HEAD'], { cwd: repo });
    expect(spawnSync('tar', ['-xf', '-', '-C', snapshot], { input: archive.stdout }).status).toBe(0);
    expect(reviewCandidateTree(snapshot)).toBe(git(repo, ['rev-parse', 'HEAD^{tree}']).trim());
    writeFileSync(join(snapshot, 'a.ts'), 'different');
    expect(reviewCandidateTree(snapshot)).not.toBe(git(repo, ['rev-parse', 'HEAD^{tree}']).trim());
  });
  test('only permits the three named one-way runner migrations while preserving the operation contract', () => {
    const after = reviewEvidenceManifestSchema.validate(JSON.parse(readFileSync(join(import.meta.dir, '../../goldband.review-evidence.json'), 'utf8')));
    const before = structuredClone(after);
    const providers = before.providers.filter((provider) => provider.executionContext.runner === 'github-actions');
    expect(providers).toHaveLength(3);
    for (const provider of providers) provider.executionContext = { sandboxOwner: 'provider', runner: 'host-seatbelt', lane: 'macos-review-contract-host' };
    expect(() => assertReviewContractNotWeaker(before, after)).not.toThrow();
    expect(() => assertReviewContractNotWeaker(after, before)).toThrow('contract laundering blocked');
    for (const mutate of [
      (p: any) => { p.executionContext.lane = 'other'; },
      (p: any) => { p.operations[0].argv = ['true']; },
      (p: any) => { p.operations[0].expectedExit = 'nonzero'; },
      (p: any) => { p.operations[0].evidenceLevel = 'fixture'; },
      (p: any) => { p.operations[0].network = 'authorized'; },
    ]) {
      const changed = structuredClone(after); mutate(changed.providers.find((p) => p.id === providerId));
      expect(() => assertReviewContractNotWeaker(before, changed)).toThrow('contract laundering blocked');
    }
  });
  test('producer signs CI provenance, rejects tampering, and closes only the original matching failure', async () => {
    const repo = gitFixture();
    git(repo, ['remote', 'add', 'origin', 'https://github.com/leo110047/goldband.git']);
    mkdirSync(join(repo, '.github/workflows'), { recursive: true });
    copyFileSync(join(import.meta.dir, '../../.github/workflows/validate.yml'), join(repo, '.github/workflows/validate.yml'));
    git(repo, ['add', '.']); git(repo, ['commit', '-m', 'CI recipe']);
    let value = manifest();
    const rootManifest = JSON.parse(readFileSync(join(import.meta.dir, '../../goldband.review-evidence.json'), 'utf8'));
    const provider = rootManifest.providers.find((p: any) => p.id === providerId);
    provider.cellIds = ['behavior-a']; provider.applicability = { kind: 'global', reason: 'CI producer fixture' };
    value.providers = [provider]; value.behaviorMatrix[0]!.providerIds = [providerId];
    value = reviewEvidenceManifestSchema.validate(value);
    const input = { source: 'git diff', diff: '', changedFiles: [] };
    const binding = createCandidateBinding(repo, input, value);
    const api = apiFixture(git(repo, ['rev-parse', 'HEAD']).trim(), git(repo, ['rev-parse', 'HEAD^{tree}']).trim());
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string, options: RequestInit) => {
      expect(String(url)).toStartWith('https://api.github.com/repos/leo110047/goldband/');
      expect(options.redirect).toBe('error');
      expect(options.headers).not.toHaveProperty('Authorization');
      return Response.json(await api.read(String(url).split('/goldband/')[1]!));
    }) as typeof fetch;
    const state = mkdtempSync(join(tmpdir(), 'review-ci-state-')); roots.push(state);
    const ctx = { ...context(repo), options: { mode: 'mock' as const, goldbandHome: state } };
    try {
      const evidence = await executeEvidencePlan(ctx, input, value, binding);
      expect(evidence.completeness).toMatchObject({ complete: true, hostEligible: true });
      expect(evidence.records[0]).toMatchObject({ status: 'verified-pass', fresh: true });
      expect(evidence.records[0]!.exitStatus).toBeUndefined();
      expect(evidence.records[0]!.snapshotDigestBefore).toBeUndefined();
      const artifact = initialArtifact(); artifact.evidence = evidence; artifact.binding = binding; artifact.diff = '';
      artifact.findings[0]!.evidenceIds = [evidence.records[0]!.id];
      expect(validateInitialReviewArtifact(artifact)).toBe(artifact);
      const { runtimeReceipt: _receipt, ...payload } = artifact;
      const file = join(state, 'ci-artifact.json');
      writeInitialReviewArtifact(file, payload, ctx);
      const readCtx = { ...ctx, options: { ...ctx.options, closureArtifactFile: file } };
      expect(readClosureArtifact(readCtx)!.evidence.records[0]!.ciProvenance).toEqual(evidence.records[0]!.ciProvenance);
      const corrupt = JSON.parse(readFileSync(file, 'utf8'));
      corrupt.evidence.records[0].ciProvenance.runId += 1;
      writeFileSync(file, JSON.stringify(corrupt));
      expect(() => readClosureArtifact(readCtx)).toThrow();
      const fabricated = structuredClone(artifact); fabricated.evidence.records[0]!.exitStatus = 0;
      expect(() => validateInitialReviewArtifact(fabricated)).toThrow('cannot claim a local exit');

      const original = structuredClone(artifact);
      original.evidence.manifest.providers[0]!.executionContext = { sandboxOwner: 'provider', runner: 'host-seatbelt', lane: 'macos-review-contract-host' };
      original.binding = { ...createCandidateBinding(repo, input, original.evidence.manifest), candidateDigest: 'e'.repeat(64) };
      original.evidence.binding = original.binding;
      original.findings[0]!.classification = 'verified-failure';
      original.evidence.records[0] = { ...original.evidence.records[0]!, status: 'verified-failure', exitStatus: 1,
        ciProvenance: undefined, candidateDigest: original.binding.candidateDigest, environment: 'host-seatbelt-darwin-snapshot', snapshotDigestBefore: 'f'.repeat(64), snapshotDigestAfter: 'f'.repeat(64), replayCommand: provider.operations[0].argv };
      const closure = buildClosureInput(original, binding, '', value);
      const result = [{ findingId: 'F-001', status: 'closed' as const, summary: 'same operation passed on its CI host', evidenceIds: [evidence.records[0]!.id] }];
      expect(validateClosureResults(result, closure, evidence)[0]).toMatchObject({ findingId: 'F-001', status: 'closed' });
      const missing = structuredClone(evidence); missing.records[0]!.status = 'runtime-incomplete'; missing.records[0]!.fresh = false;
      expect(() => validateClosureResults(result, closure, missing)).toThrow();
      const weaker = structuredClone(evidence); weaker.manifest.providers[0]!.operations[0]!.argv = ['true'];
      expect(() => validateClosureResults(result, closure, weaker)).toThrow('unchanged original failed operation');
    } finally { globalThis.fetch = originalFetch; }
  });
  test('subdirectory CI incomplete evidence survives signed artifact readback', async () => {
    const repo = gitFixture(); const cwd = join(repo, 'goldband-loop');
    mkdirSync(cwd); writeFileSync(join(cwd, 'tracked.ts'), 'tracked();');
    git(repo, ['add', '.']); git(repo, ['commit', '-m', 'subdirectory']);
    const value = manifest();
    const rootManifest = JSON.parse(readFileSync(join(import.meta.dir, '../../goldband.review-evidence.json'), 'utf8'));
    const provider = rootManifest.providers.find((p: any) => p.id === providerId);
    provider.cellIds = ['behavior-a']; provider.applicability = { kind: 'global', reason: 'CI producer fixture' };
    value.providers = [provider]; value.behaviorMatrix[0]!.providerIds = [providerId];
    const validated = reviewEvidenceManifestSchema.validate(value);
    const input = { source: 'git diff', diff: '', changedFiles: [] };
    const binding = createCandidateBinding(cwd, input, validated);
    const state = mkdtempSync(join(tmpdir(), 'review-ci-subdir-state-')); roots.push(state);
    const ctx = { ...context(cwd), options: { mode: 'mock' as const, goldbandHome: state } };
    const evidence = await executeEvidencePlan(ctx, input, validated, binding);
    expect(evidence.completeness.hostEligible).toBe(false);
    expect(evidence.records[0]!.outputSummary).toContain('invocation directory');
    expect(evidence.records[0]!.ciProvenance).toBeUndefined();
    const artifact = initialArtifact(); artifact.binding = binding; artifact.evidence = evidence; artifact.diff = '';
    artifact.findings = [{ ...artifact.findings[0]!, id: 'D-001', category: 'deterministic-evidence',
      classification: 'runtime-incomplete', evidenceIds: [evidence.records[0]!.id] }]; artifact.hostCallCount = 0;
    const { runtimeReceipt: _receipt, ...payload } = artifact;
    const file = join(state, 'subdir-artifact.json'); writeInitialReviewArtifact(file, payload, ctx);
    const restored = readClosureArtifact({ ...ctx, options: { ...ctx.options, closureArtifactFile: file } })!;
    expect(restored.evidence.completeness.hostEligible).toBe(false);
    expect(restored.findings[0]).toMatchObject({ id: artifact.findings[0]!.id, classification: 'runtime-incomplete' });
  });
  test('producer reports absent candidate CI as incomplete, without a nested sandbox or fabricated exit', async () => {
    const repo = gitFixture();
    let value = manifest();
    const rootManifest = JSON.parse(readFileSync(join(import.meta.dir, '../../goldband.review-evidence.json'), 'utf8'));
    const provider = rootManifest.providers.find((p: any) => p.id === providerId);
    provider.cellIds = ['behavior-a']; provider.applicability = { kind: 'global', reason: 'CI producer fixture' };
    value.providers = [provider]; value.behaviorMatrix[0]!.providerIds = [providerId];
    value = reviewEvidenceManifestSchema.validate(value);
    const input = { source: 'git diff', diff: '', changedFiles: [] };
    const evidence = await executeEvidencePlan(context(repo), input, value, createCandidateBinding(repo, input, value));
    expect(evidence.completeness).toMatchObject({ complete: false, hostEligible: false });
    expect(evidence.records[0]).toMatchObject({ status: 'runtime-incomplete', fresh: false, environment: 'github-actions/macos-writable-checkout' });
    expect(evidence.records[0]!.exitStatus).toBeUndefined();
    expect(evidence.records[0]!.snapshotDigestBefore).toBeUndefined();
    expect(evidence.records[0]!.ciProvenance).toBeUndefined();
    expect(evidence.records[0]!.outputSummary).toContain('CI evidence incomplete');
    await expect(collectReviewCiEvidence(repo, repo, provider, 'goldband-loop')).rejects.toThrow('invocation directory');
  });
});
