import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { repoRoot, run, ToolError } from './config.mjs';
import { JS_EXTENSIONS } from './constants.mjs';
import { advisory, violation } from './issues.mjs';

// `options.detail` adds Biome's full human output (source frames and format
// diffs) for the terminal; model-facing formats use only the structured lines.
export function runBiome(files, issues, mode, options = {}) {
  const jsFiles = files.filter((file) => JS_EXTENSIONS.has(path.extname(file)));
  if (jsFiles.length === 0) return;

  const configPath = path.join(repoRoot, 'biome.json');
  if (!fs.existsSync(configPath)) {
    issues.push(
      advisory(
        'biome-unconfigured',
        null,
        'Biome config not found in target repo; JS/TS Biome checks were skipped, zero-dependency checks still ran',
      ),
    );
    return;
  }

  const biome = resolveBiomeBinary();
  if (!biome) {
    issues.push(
      advisory(
        'biome-unavailable',
        null,
        'Biome not found; JS/TS lint and formatter checks were skipped, zero-dependency checks still ran',
      ),
    );
    return;
  }

  const workspace =
    mode === 'staged' ? materializeStagedWorkspace(jsFiles, configPath) : null;
  try {
    const filesToCheck = workspace ? workspace.files : jsFiles;
    if (filesToCheck.length === 0) return;

    const invoke = (reporter) =>
      run(
        biome,
        biomeArgs(filesToCheck, workspace?.configPath ?? configPath, reporter),
        { cwd: workspace?.root ?? repoRoot, maxBuffer: 20 * 1024 * 1024 },
      );
    recordBiomeResult(invoke, issues, options);
  } finally {
    if (workspace) {
      fs.rmSync(workspace.root, { force: true, recursive: true });
    }
  }
}

function recordBiomeResult(invoke, issues, options) {
  const result = invoke('json');
  if (result.status === 0) return;
  if (result.error) {
    throw new ToolError('failed to execute Biome', result.error.message);
  }
  // The plain run serves both the reporter fallback and terminal detail.
  let plain = null;
  const plainRun = () => {
    plain ??= invoke(null);
    return plain;
  };
  const diagnostics = parseBiomeDiagnostics(result.stdout);
  // A Biome without a usable JSON reporter is judged by its plain exit code.
  if (!diagnostics && plainRun().status === 0) {
    issues.push(
      advisory(
        'biome-reporter-unsupported',
        null,
        'Biome JSON reporter unavailable; Biome passed, structured findings were skipped',
      ),
    );
    return;
  }
  const issue = violation(
    'biome',
    null,
    biomeMessage(diagnostics, options.detail),
  );
  if (options.detail) issue.detail = biomeDetail(plainRun());
  issues.push(issue);
}

// `reporter: null` keeps Biome's human output on every Biome version.
function biomeArgs(files, configPath, reporter) {
  const reporterArgs = reporter ? [`--reporter=${reporter}`] : [];
  return ['check', ...reporterArgs, '--config-path', configPath, ...files];
}

function biomeDetail(result) {
  return [result.stdout.trim(), result.stderr.trim()]
    .filter(Boolean)
    .join('\n');
}

function materializeStagedWorkspace(files, configPath) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'goldband-style-biome-'));
  const stagedFiles = [];
  const tempConfigPath = path.join(root, 'biome.json');

  fs.writeFileSync(
    tempConfigPath,
    readStagedBlob('biome.json') ?? fs.readFileSync(configPath),
  );
  for (const file of files) {
    const stagedContent = readStagedBlob(file);
    if (!stagedContent) continue;

    const destination = path.join(root, file);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, stagedContent);
    stagedFiles.push(file);
  }

  return { configPath: tempConfigPath, files: stagedFiles, root };
}

function readStagedBlob(file) {
  const result = spawnSync('git', ['show', `:${file}`], {
    cwd: repoRoot,
    encoding: 'buffer',
    maxBuffer: 20 * 1024 * 1024,
  });
  return result.status === 0 ? result.stdout : null;
}

const MAX_BIOME_DIAGNOSTICS = 20;

// Only rule, location, and message are reported: Biome's own text output quotes
// source lines, which can contain credentials.
function biomeMessage(diagnostics, withDetail) {
  if (!diagnostics) {
    return withDetail
      ? 'Biome check failed'
      : 'Biome check failed; its output is withheld because it may quote source. Run `biome check` locally for details.';
  }
  const lines = diagnostics
    .slice(0, MAX_BIOME_DIAGNOSTICS)
    .map(formatDiagnostic);
  const omitted = diagnostics.length - lines.length;
  return [
    'Biome check failed',
    ...lines,
    ...(omitted > 0 ? [`${omitted} more Biome diagnostic(s) not shown.`] : []),
  ].join('\n');
}

// Biome's JSON reporter differs by version; an unrecognized shape returns null
// so the caller withholds output instead of printing partial structures.
function parseBiomeDiagnostics(stdout) {
  let report;
  try {
    report = JSON.parse(stdout);
  } catch {
    return null;
  }
  if (!Array.isArray(report?.diagnostics)) return null;
  const diagnostics = report.diagnostics.map(normalizeDiagnostic);
  return diagnostics.every(Boolean) ? diagnostics : null;
}

// Biome 2 uses string `location.path` and `message`; Biome 1 uses
// `location.path.file` and a plain-text `description`.
function normalizeDiagnostic(diagnostic) {
  const location = diagnostic?.location || {};
  const file =
    typeof location.path === 'string' ? location.path : location.path?.file;
  const message =
    typeof diagnostic?.message === 'string'
      ? diagnostic.message
      : diagnostic?.description;
  const category = diagnostic?.category;
  if ([file, category, message].some((value) => typeof value !== 'string')) {
    return null;
  }
  const start = location.start || {};
  const line = Number.isInteger(start.line) ? start.line : 0;
  const column = Number.isInteger(start.column) ? start.column : 0;
  return { file, line, column, category, message };
}

function formatDiagnostic({ file, line, column, category, message }) {
  const position = line ? `:${line}:${column}` : '';
  const text =
    category === 'format'
      ? `not formatted; run \`biome format --write ${file}\``
      : message;
  return `${file}${position} ${category}: ${text}`;
}

function resolveBiomeBinary() {
  const local = path.join(
    repoRoot,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'biome.cmd' : 'biome',
  );
  if (fs.existsSync(local)) return local;
  const which = run(
    process.platform === 'win32' ? 'where' : 'which',
    ['biome'],
    { cwd: repoRoot },
  );
  const candidate =
    which.status === 0 ? which.stdout.split(/\r?\n/).find(Boolean) : null;
  return candidate ? candidate.trim() : null;
}
