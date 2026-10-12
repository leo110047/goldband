import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const DISTRIBUTION_MANIFEST_FILE = 'distribution-manifest.json';
const MAX_SIDE_ARTIFACT_BYTES = 1024 * 1024;
const OPTIONAL_GENERATED_SOURCE_INPUTS = new Set([
  'goldband-loop/browse/dist',
  'goldband-loop/design/dist',
  'goldband-loop/make-pdf/dist',
]);

export const SOURCE_INPUTS = [
  'goldband.manifest.json',
  'hooks/scripts/lib/rules-resolver.js',
  'rules',
  'shell/install',
  'scripts/generate-goldband-surfaces.mjs',
  'scripts/lib/workflow-distribution-contract.mjs',
  'goldband-loop/ETHOS.md',
  'goldband-loop/VERSION',
  'goldband-loop/bin',
  'goldband-loop/biome.json',
  'goldband-loop/browse/bin',
  'goldband-loop/browse/dist',
  'goldband-loop/browse/src',
  'goldband-loop/bunfig.toml',
  'goldband-loop/bun.lock',
  'goldband-loop/cross-review',
  'goldband-loop/design/dist',
  'goldband-loop/generated',
  'goldband-loop/goldband-upgrade',
  'goldband-loop/knip.json',
  'goldband-loop/lib',
  'goldband-loop/make-pdf/dist',
  'goldband-loop/manuals',
  'goldband-loop/package.json',
  'goldband-loop/plan-devex-review',
  'goldband-loop/qa/references',
  'goldband-loop/qa/templates',
  'goldband-loop/review',
  'goldband-loop/scripts',
  'goldband-loop/setup',
  'goldband-loop/tsconfig.json',
  'goldband-loop/workflows',
];

export function workflowSourceInputManifest(
  sourceRoot,
  sourceInputs = SOURCE_INPUTS,
) {
  const repoRoot = path.resolve(sourceRoot, '..');
  const entries = collectEntries(repoRoot, sourceInputs);
  return {
    schemaVersion: 1,
    owner: 'goldband workflow installer',
    inputs: entries,
    digest: digestJson(entries),
  };
}

export function installedArtifactManifest(runtimeRoot) {
  const entries = collectEntries(
    runtimeRoot,
    ['.'],
    new Set([DISTRIBUTION_MANIFEST_FILE]),
  );
  return {
    schemaVersion: 1,
    owner: 'goldband trusted workflow runtime',
    artifacts: entries,
    digest: digestJson(entries),
  };
}

export function declaredDispatchContract(sourceRoot) {
  const contractFile = path.join(
    sourceRoot,
    'generated',
    'capability-actions.json',
  );
  const contract = JSON.parse(fs.readFileSync(contractFile, 'utf8'));
  const groups = {
    trustedLauncher: [],
    hostRuntime: [],
    promptContract: [],
    registeredOnly: [],
  };
  for (const action of contract.actions ?? []) {
    const destination = {
      'trusted-launcher': groups.trustedLauncher,
      'host-runtime': groups.hostRuntime,
      'prompt-contract': groups.promptContract,
      'registered-only': groups.registeredOnly,
    }[action.dispatch];
    if (!destination) {
      throw new Error(
        `capability action ${String(action.name)} has invalid dispatch`,
      );
    }
    destination.push(action.name);
  }
  for (const values of Object.values(groups)) values.sort();
  return { schemaVersion: 1, ...groups };
}

export function writeDistributionManifest(
  runtimeRoot,
  sourceRoot,
  sideArtifacts = [],
) {
  const source = workflowSourceInputManifest(sourceRoot);
  const installed = installedArtifactManifest(runtimeRoot);
  const dispatch = declaredDispatchContract(sourceRoot);
  const installedSideArtifacts = sideArtifacts.map(sideArtifactRecord);
  const manifest = {
    schemaVersion: 1,
    sourceDigest: source.digest,
    installedDigest: installed.digest,
    artifacts: installed.artifacts,
    sideArtifacts: installedSideArtifacts,
    dispatch,
  };
  fs.writeFileSync(
    path.join(runtimeRoot, DISTRIBUTION_MANIFEST_FILE),
    `${JSON.stringify(manifest, null, 2)}\n`,
    { mode: 0o600 },
  );
  return manifest;
}

export function inspectDistribution(
  runtimeRoot,
  sourceRoot,
  expectedSideArtifacts = [],
) {
  const loaded = readDistributionManifest(runtimeRoot);
  if (!loaded.ok) return loaded;
  const recorded = loaded.manifest;
  let source;
  try {
    source = workflowSourceInputManifest(sourceRoot);
  } catch (error) {
    return failure('source-unverifiable', error.message);
  }
  if (recorded.sourceDigest !== source.digest) {
    return failure(
      'source-stale',
      `source inputs changed: actual=${source.digest} expected=${String(recorded.sourceDigest)}`,
    );
  }
  let installed;
  try {
    installed = installedArtifactManifest(runtimeRoot);
  } catch (error) {
    return failure('installed-corrupt', error.message);
  }
  if (recorded.installedDigest !== installed.digest) {
    return failure(
      'installed-corrupt',
      `installed artifact bytes or inventory changed: actual=${installed.digest} expected=${String(recorded.installedDigest)}`,
    );
  }
  const sideArtifactFailure = inspectSideArtifacts(
    recorded.sideArtifacts,
    expectedSideArtifacts,
  );
  if (sideArtifactFailure) return sideArtifactFailure;
  const dispatch = declaredDispatchContract(sourceRoot);
  if (digestJson(recorded.dispatch) !== digestJson(dispatch)) {
    return failure(
      'dispatch-stale',
      'declared dispatch contract differs from installed manifest',
    );
  }
  return {
    ok: true,
    status: 'ok',
    sourceDigest: source.digest,
    installedDigest: installed.digest,
    dispatch,
  };
}

function readDistributionManifest(runtimeRoot) {
  const manifestFile = path.join(runtimeRoot, DISTRIBUTION_MANIFEST_FILE);
  if (!fs.existsSync(manifestFile)) {
    return failure(
      'installed-corrupt',
      `missing ${DISTRIBUTION_MANIFEST_FILE}`,
    );
  }
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    return manifest.schemaVersion === 1
      ? { ok: true, manifest }
      : failure(
          'installed-corrupt',
          'unsupported distribution manifest schema',
        );
  } catch (error) {
    return failure(
      'installed-corrupt',
      `invalid distribution manifest: ${error.message}`,
    );
  }
}

function inspectSideArtifacts(sideArtifacts, expectedSideArtifacts) {
  if (!Array.isArray(sideArtifacts)) {
    return failure(
      'installed-corrupt',
      'installed side artifact inventory is missing',
    );
  }
  const expectedByRole = new Map(
    expectedSideArtifacts.map((artifact) => [artifact.role, artifact]),
  );
  const recordedRoles = new Set(
    sideArtifacts.map((artifact) => artifact?.role),
  );
  if (
    expectedByRole.size !== expectedSideArtifacts.length ||
    recordedRoles.size !== sideArtifacts.length ||
    [...expectedByRole.keys()].some((role) => !recordedRoles.has(role)) ||
    sideArtifacts.length !== expectedSideArtifacts.length
  ) {
    return failure(
      'installed-corrupt',
      'installed side artifact identity differs',
    );
  }
  for (const expected of sideArtifacts) {
    const trusted = expectedByRole.get(expected.role);
    if (
      !trusted ||
      path.resolve(String(expected.path)) !== path.resolve(trusted.path)
    ) {
      return failure(
        'installed-corrupt',
        'installed side artifact identity differs',
      );
    }
    try {
      const actual = sideArtifactRecord(trusted);
      if (digestJson(actual) !== digestJson(expected)) {
        return failure(
          'installed-corrupt',
          `installed side artifact changed: role=${String(expected.role)} path=${String(expected.path)}`,
        );
      }
    } catch (error) {
      return failure('installed-corrupt', error.message);
    }
  }
  return undefined;
}

function sideArtifactRecord(artifact) {
  if (!artifact || typeof artifact.role !== 'string' || !artifact.role.trim()) {
    throw new Error('installed side artifact role is invalid');
  }
  if (typeof artifact.path !== 'string' || !path.isAbsolute(artifact.path)) {
    throw new Error(
      `installed side artifact path is invalid: ${String(artifact.path)}`,
    );
  }
  const expectedUid =
    typeof process.getuid === 'function' ? process.getuid() : null;
  const material =
    artifact.contents === undefined
      ? readBoundedSideArtifact(artifact.path, artifact.role, expectedUid)
      : {
          bytes: Buffer.from(artifact.contents),
          mode: artifact.mode ?? 0o600,
          uid: expectedUid,
        };
  const { bytes, mode, uid } = material;
  if (bytes.length > MAX_SIDE_ARTIFACT_BYTES) {
    throw new Error(`installed side artifact is oversized: ${artifact.role}`);
  }
  return {
    role: artifact.role,
    path: path.resolve(artifact.path),
    size: bytes.length,
    mode,
    uid,
    digest: crypto.createHash('sha256').update(bytes).digest('hex'),
  };
}

function readBoundedSideArtifact(file, role, expectedUid) {
  const noFollow = fs.constants.O_NOFOLLOW;
  if (typeof noFollow !== 'number') {
    throw new Error('host does not support no-follow side artifact reads');
  }
  const descriptor = fs.openSync(file, fs.constants.O_RDONLY | noFollow);
  try {
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile() || stat.size > MAX_SIDE_ARTIFACT_BYTES) {
      throw new Error(
        `installed side artifact is not a bounded regular file: ${role}`,
      );
    }
    return {
      bytes: fs.readFileSync(descriptor),
      mode: stat.mode & 0o777,
      uid: expectedUid === null ? null : stat.uid,
    };
  } finally {
    fs.closeSync(descriptor);
  }
}

function failure(status, detail) {
  return { ok: false, status, detail };
}

function collectEntries(root, relativeRoots, excluded = new Set()) {
  const entries = [];
  for (const relativeRoot of relativeRoots) {
    const absolute = path.resolve(root, relativeRoot);
    if (!pathWithin(root, absolute)) {
      throw new Error(`distribution source input is missing: ${relativeRoot}`);
    }
    if (!fs.existsSync(absolute)) {
      // Build outputs are ignored by Git and therefore absent from an
      // unbuilt candidate snapshot. Hash them whenever they exist so an
      // installed build still becomes stale if its bundle changes or vanishes.
      if (OPTIONAL_GENERATED_SOURCE_INPUTS.has(relativeRoot)) continue;
      throw new Error(`distribution source input is missing: ${relativeRoot}`);
    }
    visit(root, absolute, excluded, entries);
  }
  return entries.sort((left, right) => left.path.localeCompare(right.path));
}

function visit(root, absolute, excluded, entries) {
  const relative = path.relative(root, absolute) || '.';
  if (excluded.has(relative) || excluded.has(path.basename(relative))) return;
  const stat = fs.lstatSync(absolute);
  if (stat.isSymbolicLink()) {
    entries.push({
      path: relative,
      kind: 'symlink',
      target: fs.readlinkSync(absolute),
    });
    return;
  }
  if (stat.isDirectory()) {
    for (const name of fs.readdirSync(absolute).sort()) {
      visit(root, path.join(absolute, name), excluded, entries);
    }
    return;
  }
  if (!stat.isFile())
    throw new Error(`unsupported distribution input: ${relative}`);
  const bytes = fs.readFileSync(absolute);
  entries.push({
    path: relative,
    kind: 'file',
    size: bytes.length,
    mode: stat.mode & 0o777,
    digest: crypto.createHash('sha256').update(bytes).digest('hex'),
  });
}

function pathWithin(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return (
    relative === '' ||
    (relative !== '..' && !relative.startsWith(`..${path.sep}`))
  );
}

function digestJson(value) {
  return crypto.createHash('sha256').update(stableJson(value)).digest('hex');
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}
