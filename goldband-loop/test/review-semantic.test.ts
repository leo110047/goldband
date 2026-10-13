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
const finding = { kind: 'defect', file: 'subject.ts', line: 1, severity: 'high', summary: 'unsafe path',
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
  expect(prompt).toContain('Report every valid finding');
  expect(prompt).toContain('Report each instance of a recurring failure as its own finding');
  expect(prompt).not.toContain('BEHAVIOR_MATRIX_START');
  expect(prompt).not.toContain('TYPED_EVIDENCE_SUMMARY_START');
});

test('rule selection uses the collected path of a Git-quoted file name', async () => {
  const options = fixture();
  options.git('config', 'core.quotePath', 'true');
  mkdirSync(join(options.cwd, 'goldband-loop'));
  writeFileSync(join(options.cwd, 'goldband-loop', 'café.ts'), 'safe();\n');
  options.git('add', '.'); options.git('commit', '-qm', 'quoted path');
  writeFileSync(join(options.cwd, 'goldband-loop', 'café.ts'), 'unsafe();\n');
  const mock = host();
  const result = await runWorkflow(workflow(), options);
  const prompt = mock.mock.calls[0]![0] as string;
  expect(prompt).toContain('"a/goldband-loop/caf\\303\\251.ts"');
  expect(artifact(result).changedFiles).toContain('goldband-loop/café.ts');
  expect(prompt).toContain('RULE_ID: loop-engineering');
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

const improvement = { kind: 'improvement', file: 'subject.ts', line: 1, severity: 'low',
  summary: 'scope parsing is duplicated', evidence: 'subject.ts re-parses the collected diff',
  recommendation: 'pass the collected paths to the consumer',
  suggestedVerification: 'route a Git-quoted path through review' };

test('mixed findings keep valid defects and blocking improvements and report discarded improvements', async () => {
  const options = fixture();
  host([finding, improvement,
    { ...improvement, summary: 'missing support', evidence: null, recommendation: null },
    { ...improvement, summary: 'inflated high', severity: 'high' },
    { ...improvement, summary: 'inflated critical', severity: 'critical' }]);
  const result = await runWorkflow(workflow(), options);
  const value = artifact(result);
  expect(value.findings.map((x: any) => `${x.kind}:${x.summary}:${x.blocking}`))
    .toEqual(['defect:unsafe path:false', 'improvement:scope parsing is duplicated:true']);
  expect(value.diagnostics.map((x: any) => x.summary)).toEqual(['missing support', 'inflated high', 'inflated critical']);
  expect(result.signalSnapshot).toMatchObject({ kind: 'review-findings', findingCount: 2,
    severityCounts: { critical: 0, high: 1, medium: 0, low: 1, info: 0 } });
  const report = String(result.output);
  expect(report.indexOf('unsafe path')).toBeLessThan(report.indexOf('## Design improvements (blocking until fixed)'));
  expect(report).toContain([
    '  Recommendation: pass the collected paths to the consumer',
    '  Suggested verification (not executed): route a Git-quoted path through review',
  ].join('\n'));
  expect(report).toContain('## Discarded findings');
  expect(report).toContain('[low] missing support — subject.ts:1: improvement evidence is missing; improvement recommendation is missing');
  expect(report).toContain('[critical] inflated critical — subject.ts:1: improvement severity cannot be critical');
});

test('every valid improvement is reported once and blocks alongside defects', async () => {
  const options = fixture();
  const defects = [1, 2, 3, 4].map(line => ({ ...finding, line, summary: `defect ${line}` }));
  const improvements = [1, 2, 3, 4, 5].map(line => ({ ...improvement, line, summary: `improvement ${line}` }));
  host([...defects, ...improvements, { ...improvements[4], evidence: 'duplicate of the fifth improvement' }]);
  const result = await runWorkflow(workflow(), options);
  const value = artifact(result);
  expect(value.findings.filter((x: any) => x.kind === 'defect')).toHaveLength(4);
  expect(value.findings.filter((x: any) => x.kind === 'improvement').map((x: any) => x.line)).toEqual([1, 2, 3, 4, 5]);
  expect(value).not.toHaveProperty('omittedImprovementCount');
  expect(result.signalSnapshot).toMatchObject({ findingCount: 9 });
  expect(String(result.output)).toContain('improvement 5');
  expect(String(result.output)).not.toContain('not shown');
});

test.each([
  [{ findings: [{ ...improvement, kind: 'suggestion' }] }, 'invalid finding kind: suggestion'],
  [{ findings: [{ ...improvement, line: 'one' }] }, 'finding.line must be a positive integer'],
  [{ results: [] }, 'review output must be an array or { findings: [...] }'],
])('core finding contract errors still fail the review', async (parsed, message) => {
  const options = fixture();
  host().mockResolvedValueOnce({ parsed, text: JSON.stringify(parsed) });
  await expect(runWorkflow(workflow(), options)).rejects.toThrow(message);
});

test('the host wire schema requires a finding kind', async () => {
  const options = fixture(); const mock = host();
  await runWorkflow(workflow(), options);
  const schema = mock.mock.calls[0]![1] as any;
  expect(schema.properties.findings.items.properties.kind).toEqual({ enum: ['defect', 'improvement'] });
  expect(schema.properties.findings.items.required).toContain('kind');
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
