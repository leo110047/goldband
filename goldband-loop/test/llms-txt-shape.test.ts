import { describe, test, expect, beforeAll } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { generateLlmsTxt } from '../scripts/gen-llms-txt';

const ROOT = path.resolve(import.meta.dir, '..');

let generated: Awaited<ReturnType<typeof generateLlmsTxt>>;

beforeAll(async () => {
  generated = await generateLlmsTxt({ root: ROOT });
});

describe('gen-llms-txt — shape', () => {
  test('emits required top-level sections', () => {
    expect(generated.content).toContain('# goldband');
    expect(generated.content).toContain('## Capability actions');
    expect(generated.content).not.toContain('## Browse Commands');
    // Convention block
    expect(generated.content).toContain('Capabilities use');
    // Footer
    expect(generated.content).toContain('## More');
    expect(generated.content).toContain('auto-generated');
  });

  test('only public generated capability actions appear in the index', () => {
    const contract = JSON.parse(
      fs.readFileSync(
        path.join(ROOT, 'generated', 'capability-actions.json'),
        'utf8',
      ),
    ) as {
      actions: Array<{
        name: string;
        lifecycle?: 'public' | 'experimental';
      }>;
    };
    const publicActions = contract.actions.filter(
      (action) => (action.lifecycle ?? 'public') === 'public',
    );
    const experimentalActions = contract.actions.filter(
      (action) => action.lifecycle === 'experimental',
    );
    expect(generated.skills.length).toBeGreaterThan(0);
    expect(generated.skills).toHaveLength(publicActions.length);

    for (const action of publicActions) {
      expect(generated.content).toContain(
        `$goldband ${action.name.replace('/', ' ')}`,
      );
    }
    for (const action of experimentalActions) {
      expect(generated.content).not.toContain(
        `$goldband ${action.name.replace('/', ' ')}`,
      );
    }
  });

  test('skills are sorted alphabetically', () => {
    const names = generated.skills.map((s) => s.name);
    const sorted = [...names].sort((a, b) => a.localeCompare(b));
    expect(names).toEqual(sorted);
  });

  test('description is collapsed to a single line per entry', () => {
    // Find the Skills section and assert no entry contains a literal newline
    // mid-bullet (descriptions can be multi-paragraph in frontmatter; oneLine
    // collapses them).
    const skillsSection = generated.content
      .split('## Capability actions')[1]
      .split('\n## ')[0];
    const bullets = skillsSection
      .split('\n')
      .filter((line) => line.startsWith('- `'));
    for (const b of bullets) {
      // No mid-bullet newline inside the bullet.
      expect(b).not.toMatch(/\n/);
    }
  });
});

describe('gen-llms-txt — strict mode', () => {
  test('does NOT throw on the live skill set (every goldband skill has name + description)', async () => {
    // The point of strict mode: catch missing-frontmatter skills before they
    // bypass the manifest surface generator. The current repo should pass strict.
    await expect(generateLlmsTxt({ root: ROOT, strict: true })).resolves.toBeDefined();
  });

  test('throws on a generated action missing description', async () => {
    const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'llms-txt-strict-'));
    try {
      fs.mkdirSync(path.join(tmp, 'generated'));
      fs.writeFileSync(
        path.join(tmp, 'generated', 'capability-actions.json'),
        JSON.stringify({ actions: [{ name: 'review/code' }] }),
      );
      await expect(generateLlmsTxt({ root: tmp, strict: true })).rejects.toThrow(/missing name or description/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('gen-llms-txt — generated file is fresh', () => {
  test('committed goldband/llms.txt matches what the generator produces now', () => {
    const committed = fs.readFileSync(path.join(ROOT, 'goldband', 'llms.txt'), 'utf-8');
    expect(committed).toBe(generated.content);
  });
});
