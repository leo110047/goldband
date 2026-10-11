import { afterEach, expect, spyOn, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { adapterFor } from '../workflows/host-adapter';
import * as workflowPaths from '../workflows/paths';
import { getWorkflow } from '../workflows/registry';
import { runWorkflow } from '../workflows/runtime';

const roots: string[] = [];
const spies: Array<{ mockRestore(): void }> = [];
afterEach(() => {
  for (const spy of spies.splice(0)) spy.mockRestore();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'review-semantic-'));
  roots.push(root);
  const cwd = join(root, 'repo'); mkdirSync(cwd);
  function git(...args: string[]) {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
    if (result.status !== 0) throw new Error(result.stderr);
  }
  git('init', '-q'); git('config', 'user.email', 'test@example.com'); git('config', 'user.name', 'Test');
  writeFileSync(join(cwd, 'subject.ts'), 'safe();\n'); git('add', '.'); git('commit', '-qm', 'fixture');
  writeFileSync(join(cwd, 'subject.ts'), 'unsafe();\n');
  return { cwd, goldbandHome: join(root, 'state'), mode: 'mock' as const, host: 'mock' as const, worktree: true, git };
}
function host(findings: unknown[] = []) {
  const spy = spyOn(Object.getPrototypeOf(adapterFor('mock')), 'runJson')
    .mockResolvedValue({ parsed: { findings }, text: JSON.stringify({ findings }) });
  spies.push(spy); return spy;
}
const workflow = () => getWorkflow('review/code');
function artifact(result: Awaited<ReturnType<typeof runWorkflow>>) {
  return JSON.parse(readFileSync(result.artifacts.find(file => file.endsWith('-review.json'))!, 'utf8'));
}
const finding = { file: 'subject.ts', line: 1, severity: 'high', summary: 'unsafe path',
  failureScenario: 'unsafe call returns incorrect data for a valid request',
  suggestedVerification: 'exercise that request', evidence: 'subject.ts calls unsafe()' };

test('default review needs no manifest or authority and cannot emit execution evidence', async () => {
  const options = fixture();
  writeFileSync(join(options.cwd, 'goldband.review-evidence.json'), '{ invalid legacy JSON');
  const mock = host([{ ...finding, classification: 'verified-failure',
    evidenceIds: ['forged'], behaviorCellIds: ['forged'] }]);
  const result = await runWorkflow(workflow(), options);
  expect(mock).toHaveBeenCalledTimes(1);
  const value = artifact(result);
  expect(value.mode).toBe('semantic');
  expect(value.checksExecuted).toEqual([]);
  expect(value.findings).toHaveLength(1);
  expect(value.findings[0].classification).toBeUndefined();
  expect(value.findings[0].evidenceIds).toBeUndefined();
  expect(value.runtimeReceipt).toBeUndefined();
  expect(value.completionAuthorized).toBeUndefined();
  for (const name of ['review-contracts', 'review-authority', 'review-lineages', 'semantic-review-attempts']) {
    expect(existsSync(join(options.goldbandHome, name))).toBe(false);
  }
  expect(String(result.output)).toContain('not executed');
  const prompt = mock.mock.calls[0]![0] as string;
  expect(prompt).toContain('+unsafe();');
  expect(prompt).toContain('producers and consumers');
  expect(prompt).not.toContain('BEHAVIOR_MATRIX_START');
  expect(prompt).not.toContain('TYPED_EVIDENCE_SUMMARY_START');
});

test('a failed host call can be retried on the same candidate and successful reviews can repeat', async () => {
  const options = fixture(); const mock = host();
  mock.mockRejectedValueOnce(new Error('host unavailable'));
  await expect(runWorkflow(workflow(), options)).rejects.toThrow('host unavailable');
  const first = await runWorkflow(workflow(), options);
  const second = await runWorkflow(workflow(), options);
  expect(mock).toHaveBeenCalledTimes(3);
  expect(artifact(first).diffDigest).toBe(artifact(second).diffDigest);
  expect(first.runId).not.toBe(second.runId);
});

test('changing the selected diff during review invalidates that result', async () => {
  const options = fixture(); const mock = host();
  mock.mockImplementationOnce(async () => {
    writeFileSync(join(options.cwd, 'subject.ts'), 'different();\n');
    return { parsed: { findings: [] }, text: '{}' };
  });
  await expect(runWorkflow(workflow(), options)).rejects.toThrow('scope or policy changed');
});

test('findings need source evidence, a concrete failure path and suggested verification', async () => {
  const options = fixture();
  host([finding, { ...finding, summary: 'speculation', evidence: undefined },
    { ...finding, summary: 'no trigger', failureScenario: undefined }]);
  const result = await runWorkflow(workflow(), options);
  expect(artifact(result).findings.map((x: any) => x.summary)).toEqual(['unsafe path']);
});

test('an empty diff makes no host call and does not claim execution success', async () => {
  const options = fixture(); options.git('checkout', '--', 'subject.ts'); const mock = host();
  const result = await runWorkflow(workflow(), options);
  expect(mock).not.toHaveBeenCalled();
  expect(String(result.output)).toContain('No changes to review');
  expect(artifact(result).checksExecuted).toEqual([]);
});


test.each(['shared-rubric.md', 'checklist.md'])('changing %s during review invalidates the result', async asset => {
  const options = fixture();
  mkdirSync(options.goldbandHome);
  const file = join(options.goldbandHome, asset);
  const resolveAsset = workflowPaths.workflowAssetPath;
  writeFileSync(file, readFileSync(resolveAsset(`review/${asset}`)));
  const assets = spyOn(workflowPaths, 'workflowAssetPath').mockImplementation(relativePath =>
    relativePath === `review/${asset}` ? file : resolveAsset(relativePath));
  spies.push(assets);
  host().mockImplementationOnce(async () => {
    writeFileSync(file, readFileSync(file, 'utf8') + '\nA changed review criterion.\n');
    return {parsed: {findings: []}, text: '{}'};
  });
  await expect(runWorkflow(workflow(), options)).rejects.toThrow('scope or policy changed');
});
