import { describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(import.meta.dir, '..');

describe('security boundary invariants', () => {
  test('setup never executes a remote Bun installer and requires checksum verification', () => {
    const setup = fs.readFileSync(path.join(ROOT, 'setup'), 'utf8');
    const unsafe = setup
      .split('\n')
      .filter((line) => line.includes('bun.sh/install') && line.includes('| bash'));
    expect(unsafe).toEqual([]);
    expect(setup).toContain('Install with checksum verification:');
    expect(setup).toContain('shasum -a 256 $tmpfile');
  });
});
