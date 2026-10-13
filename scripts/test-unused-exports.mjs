#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { exportedNames, findUnusedExports } from './check-unused-exports.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'goldband-unused-exports-'));

function write(file, content) {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), content);
}

try {
  assert.equal(spawnSync('git', ['init', '-q'], { cwd: root }).status, 0);
  write(
    'hooks/scripts/lib/shared.js',
    'function used() {}\nfunction stale() {}\nmodule.exports = {\n  used,\n  stale,\n};\n',
  );
  write(
    'hooks/scripts/hooks/router.js',
    "const { used } = require('../lib/shared');\nused();\nrunExternal();\n",
  );
  write(
    'scripts/lib/table.mjs',
    'export const INTERNAL = 1;\nexport function runExternal() {\n  return INTERNAL;\n}\n',
  );
  // Generated copies and documentation never count as consumers.
  write('plugin-assets/claude-code-plugin/hooks/shared.js', 'stale();\n');
  write('docs/notes.md', 'stale INTERNAL\n');
  write('hooks/fixtures/router/sample.js', 'module.exports = { greet };\n');

  assert.deepEqual(
    findUnusedExports(root).sort((a, b) => a.name.localeCompare(b.name)),
    [
      { file: 'scripts/lib/table.mjs', name: 'INTERNAL' },
      { file: 'hooks/scripts/lib/shared.js', name: 'stale' },
    ],
  );
  assert.deepEqual(
    [
      ...exportedNames(
        'export async function a() {}\nexport { b, c as d };\nmodule.exports = { e, f: g };',
      ),
    ].sort(),
    ['a', 'b', 'd', 'e', 'f'],
  );
  console.log('[OK] unused export check flags only exports without consumers');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
