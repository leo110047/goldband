#!/usr/bin/env node
// Fails when a first-party JavaScript module outside goldband-loop's knip
// scope exports a name that no other first-party source file mentions.
// Generated copies are neither checked nor counted as consumers.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { managedGeneratedFiles } from './lib/plugin-distribution.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const CHECKED_MODULES = [
  /^hooks\/(?!fixtures\/).+\.(?:js|cjs)$/,
  /^codex\/hooks\/[^/]+\.(?:js|cjs)$/,
  /^scripts\/(?:lib\/.+|[^/]+)\.(?:mjs|cjs|js)$/,
  /^goldband-loop\/cross-review\/[^/]+\.cjs$/,
  /^skills\/global\/[^/]+\/scripts\/[^/]+\.(?:mjs|cjs|js)$/,
  /^mcp\/server\/src\/[^/]+\.ts$/,
];
const CONSUMER_SOURCE = /\.(?:js|cjs|mjs|ts|tsx|sh)$/;

export function findUnusedExports(root = ROOT) {
  const generated = generatedFiles(root);
  const tracked = gitFiles(root).filter(
    (file) => !generated.has(file) && !file.startsWith('plugin-assets/'),
  );
  const mentions = indexIdentifiers(
    root,
    tracked.filter((file) => CONSUMER_SOURCE.test(file)),
  );
  const unused = [];
  for (const file of tracked) {
    if (!CHECKED_MODULES.some((pattern) => pattern.test(file))) continue;
    for (const name of exportedNames(read(root, file))) {
      const users = mentions.get(name);
      if (!users || [...users].every((user) => user === file)) {
        unused.push({ file, name });
      }
    }
  }
  return unused;
}

function generatedFiles(root) {
  return new Set(
    managedGeneratedFiles()
      .filter((entry) => !entry.includes('*'))
      .filter((entry) => fs.existsSync(path.join(root, entry))),
  );
}

function gitFiles(root) {
  const result = spawnSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard'],
    { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  if (result.status !== 0)
    throw new Error(result.stderr || 'git ls-files failed');
  return result.stdout
    .split('\n')
    .filter(Boolean)
    .filter((file) => fs.existsSync(path.join(root, file)));
}

function read(root, file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

function indexIdentifiers(root, files) {
  const mentions = new Map();
  for (const file of files) {
    for (const [identifier] of read(root, file).matchAll(/[A-Za-z_$][\w$]*/g)) {
      if (!mentions.has(identifier)) mentions.set(identifier, new Set());
      mentions.get(identifier).add(file);
    }
  }
  return mentions;
}

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
const ESM_DECLARATION =
  /^export\s+(?:async\s+)?(?:function\*?|const|let|class)\s+([A-Za-z_$][\w$]*)/gm;

function commonJsExportNames(source) {
  const block = source.match(/module\.exports\s*=\s*\{([\s\S]*?)\};/);
  if (!block) return [];
  return block[1].split(',').map((entry) => entry.trim().split(/[\s:(]/)[0]);
}

function esmListExportNames(source) {
  return [...source.matchAll(/^export\s*\{([^}]*)\}/gm)].flatMap(([, list]) =>
    list.split(',').map((entry) =>
      entry
        .trim()
        .split(/\s+as\s+/)
        .at(-1),
    ),
  );
}

/** Names exported through `module.exports = { ... }` or ESM `export`. */
export function exportedNames(source) {
  const candidates = [
    ...commonJsExportNames(source),
    ...[...source.matchAll(ESM_DECLARATION)].map(([, name]) => name),
    ...esmListExportNames(source),
  ];
  return new Set(candidates.filter((name) => IDENTIFIER.test(name ?? '')));
}

function main() {
  const unused = findUnusedExports();
  if (unused.length === 0) {
    console.log('[OK] every checked export has a first-party consumer');
    return 0;
  }
  console.error('Unused exports (remove the export or the dead code):');
  for (const { file, name } of unused) console.error(`  ${file}: ${name}`);
  return 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
