#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function usage() {
  console.error(
    'Usage: node scripts/check-eval-budget-cap.mjs --max-cost-usd <amount> [--root <dir> ...]',
  );
}

function parseArgs(argv) {
  const roots = [];
  let maxCostUsd = process.env.MAX_COST_USD || '';

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--max-cost-usd') {
      maxCostUsd = argv[i + 1] || '';
      i += 1;
      continue;
    }
    if (arg === '--root') {
      roots.push(argv[i + 1] || '');
      i += 1;
      continue;
    }
    usage();
    process.exit(2);
  }

  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(maxCostUsd)) {
    console.error(
      `max_cost_usd must be a non-negative decimal, got: ${maxCostUsd}`,
    );
    process.exit(2);
  }

  return {
    max: Number(maxCostUsd),
    roots: roots.length > 0 ? roots : defaultRoots(),
  };
}

function defaultRoots() {
  const home = os.homedir();
  const roots = [path.join(home, '.goldband-dev', 'evals')];
  const projectsDir = path.join(home, '.goldband', 'projects');
  if (!fs.existsSync(projectsDir)) return roots;

  for (const entry of fs.readdirSync(projectsDir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      roots.push(path.join(projectsDir, entry.name, 'evals'));
    }
  }
  return roots;
}

function collectJsonFiles(dir) {
  if (!dir || !fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectJsonFiles(full));
    if (entry.isFile() && entry.name.endsWith('.json')) out.push(full);
  }
  return out;
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function testNames(run) {
  return Array.isArray(run?.tests) ? run.tests.map((test) => test?.name) : [];
}

// A `_partial-*` snapshot repeats its run's cost once that run's final file is
// written, but it is the only cost record of a run that never finalized. It is
// skipped only when a final run in the same directory is that run: the same
// tier, at or after the snapshot, containing every test the snapshot recorded.
function coveredPartial(file, files) {
  if (!path.basename(file).startsWith('_partial')) return false;
  const partial = readJson(file);
  const recorded = testNames(partial);
  if (!partial?.timestamp || recorded.length === 0) return false;
  return files.some((other) => {
    if (path.dirname(other) !== path.dirname(file)) return false;
    if (path.basename(other).startsWith('_partial')) return false;
    const run = readJson(other);
    const finished = new Set(testNames(run));
    return (
      run?.tier === partial.tier &&
      run.timestamp >= partial.timestamp &&
      recorded.every((name) => finished.has(name))
    );
  });
}

function readCost(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    const cost = Number(data.total_cost_usd || 0);
    return Number.isFinite(cost) ? cost : 0;
  } catch (error) {
    console.warn(`Skipping unreadable eval JSON: ${file} (${error.message})`);
    return 0;
  }
}

const { max, roots } = parseArgs(process.argv.slice(2));
const candidates = roots.flatMap(collectJsonFiles);
const files = candidates.filter((file) => !coveredPartial(file, candidates));
const total = files.reduce((sum, file) => sum + readCost(file), 0);

console.log(
  `Eval cost: $${total.toFixed(4)} / cap $${max.toFixed(4)} (${files.length} files)`,
);
if (total > max) {
  console.error(
    `Eval cost exceeded max_cost_usd by $${(total - max).toFixed(4)}`,
  );
  process.exit(1);
}
