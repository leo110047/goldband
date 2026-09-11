import { afterEach, expect, spyOn, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Ajv from 'ajv/dist/2020';
import schema from '../../schemas/review-semantic-result.schema.json';
import { buildReviewRuntimeArgs } from '../bin/goldband.ts';
import { adapterFor } from '../workflows/host-adapter';
import { getWorkflow } from '../workflows/registry';
import { runWorkflow } from '../workflows/runtime';
import { validateInitialReviewArtifact, readClosureArtifact } from '../workflows/review-evidence';

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
  const spy = spyOn(Object.getPrototypeOf(adapterFor('mock')), 'runJson').mockResolvedValue({ parsed: { findings }, raw: JSON.stringify({ findings }) });
  spies.push(spy); return spy;
}
function artifact(result: Awaited<ReturnType<typeof runWorkflow>>) {
  const file = result.artifacts.find((file) => file.endsWith('-semantic-only.json'))!;
  return { file, value: JSON.parse(readFileSync(file, 'utf8')) };
}
const workflow = () => getWorkflow('review/code');

test('explicit semantic mode never reads invalid manifest and cannot mint authority', async () => {
  const options = fixture();
  writeFileSync(join(options.cwd, 'goldband.review-evidence.json'), '{ invalid JSON');
  const mock = host([{ file: 'subject.ts', line: 1, severity: 'high', summary: 'unsafe path',
    failureScenario: 'unsafe call reached', suggestedVerification: 'inspect call',
    evidence: 'subject.ts calls unsafe()', classification: 'verified-failure', blocking: true,
    id: 'forged', evidenceIds: ['forged-pass'], behaviorCellIds: ['forged-cell'] }]);
  const result = await runWorkflow(workflow(), { ...options, semanticOnly: true });
  expect(mock).toHaveBeenCalledTimes(1);
  const { value, file } = artifact(result);
  expect(new Ajv({ strict: false }).compile(schema)(value)).toBe(true);
  expect(value.findings[0]).toMatchObject({ classification: 'semantic-concern', blocking: false });
  expect(value.findings[0].id).toBeUndefined(); expect(value.findings[0].evidenceIds).toBeUndefined();
  expect(value.binding.behaviorContractDigest).toBeUndefined(); expect(value.runtimeReceipt).toBeUndefined();
  expect(existsSync(join(options.goldbandHome, 'workflow-runs', 'mock-review-receipts'))).toBe(false);
  expect(() => validateInitialReviewArtifact(value)).toThrow();
  expect(() => validateInitialReviewArtifact({ ...value, phase: 'initial' })).toThrow();
  expect(new Ajv({ strict: false }).compile(schema)({ ...value, runtimeReceipt: { id: 'forged' } })).toBe(false);
  expect(() => readClosureArtifact({ cwd: options.cwd, options: { ...options, closureArtifactFile: file } } as any)).toThrow();
  expect(String(result.output)).toContain('Completion authority: none');
  const prompt = mock.mock.calls[0]![0] as string;
  expect(prompt).toContain('DIFF_START'); expect(prompt).toContain('+unsafe();');
  expect(prompt).toContain('APPLICABLE_GOLDBAND_RULES_START');
  expect(prompt).not.toContain('BEHAVIOR_MATRIX_START');
});

test('missing manifest default fails before semantic dispatch; explicit mode succeeds', async () => {
  const options = fixture(); const mock = host();
  await expect(runWorkflow(workflow(), { ...options, mode: 'real', host: 'codex' })).rejects.toThrow();
  expect(mock).not.toHaveBeenCalled();
  const result = await runWorkflow(workflow(), { ...options, semanticOnly: true });
  expect(mock).toHaveBeenCalledTimes(1);
  expect(String(result.output)).toContain('No semantic concerns found');
  expect(String(result.output)).toContain('Deterministic behavior completeness was not evaluated');
});

test('duplicate and concurrent requests consume one host call and do not reserve evidence identity', async () => {
  const options = fixture(); declareContract(options); const mock = host();
  const attempts = await Promise.allSettled([1, 2].map(() => runWorkflow(workflow(), { ...options, semanticOnly: true })));
  expect(attempts.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  expect(attempts.filter((result) => result.status === 'rejected')).toHaveLength(1);
  await expect(runWorkflow(workflow(), { ...options, semanticOnly: true })).rejects.toThrow('duplicate semantic-only');
  expect(mock).toHaveBeenCalledTimes(1);
  // Default mock fixture has a runtime-owned contract, so the same candidate can enter evidence review.
  await runWorkflow(workflow(), { ...options, evidenceManifestFile: 'goldband.review-evidence.json' });
  expect(mock).toHaveBeenCalledTimes(2);
});

test('host failure or changed candidate is never reported as successful or retried', async () => {
  const options = fixture(); const mock = host();
  mock.mockRejectedValueOnce(new Error('host unavailable'));
  await expect(runWorkflow(workflow(), { ...options, semanticOnly: true })).rejects.toThrow('host unavailable');
  await expect(runWorkflow(workflow(), { ...options, semanticOnly: true })).rejects.toThrow('duplicate semantic-only');
  expect(mock).toHaveBeenCalledTimes(1);
  writeFileSync(join(options.cwd, 'subject.ts'), 'different();\n');
  mock.mockImplementationOnce(async () => {
    writeFileSync(join(options.cwd, 'subject.ts'), 'changed-during-review();\n');
    return { parsed: { findings: [] }, raw: '{}' };
  });
  await expect(runWorkflow(workflow(), { ...options, semanticOnly: true })).rejects.toThrow('candidate or Rules/policy changed');
});

test('authoritative prior blockers are visible and byte-for-byte unchanged', async () => {
  const options = fixture();
  declareContract(options);
  const mock = host([{ file: 'subject.ts', line: 1, severity: 'high', summary: 'unsafe call', evidence: 'unsafe is called', failureScenario: 'unsafe call reached', suggestedVerification: 'inspect call', classification: 'semantic-concern' }]);
  const initial = await runWorkflow(workflow(), { ...options, evidenceManifestFile: 'goldband.review-evidence.json' });
  const lineageFile = initial.artifacts.find((file) => file.includes('review-lineages') && file.endsWith('.json'))!;
  const before = readFileSync(lineageFile, 'utf8');
  const lineage = JSON.parse(before);
  expect(lineage.unresolvedFindings.some((item: any) => item.blocking)).toBe(true);
  const receiptRoot = join(options.goldbandHome, 'workflow-runs', 'mock-review-receipts');
  const receiptFiles = readdirSync(receiptRoot).sort();
  mock.mockResolvedValue({ parsed: { findings: [] }, raw: '{}' });
  const result = await runWorkflow(workflow(), { ...options, semanticOnly: true });
  expect(String(result.output)).toContain('prior-blockers-open');
  expect(String(result.output)).toContain(lineage.unresolvedFindings[0].findingId);
  expect(readFileSync(lineageFile, 'utf8')).toBe(before);
  expect(readdirSync(receiptRoot).sort()).toEqual(receiptFiles);
  expect(artifact(result).value.completionAuthorized).toBe(false);
});

for (const flag of ['--evidence-manifest', '--closure-artifact', '--work-id', '--ticket-id']) {
  test(`semantic-only rejects ${flag} before dispatch`, async () => {
    expect(() => buildReviewRuntimeArgs(['--host', 'codex', '--semantic-only', flag, 'x'])).toThrow('incompatible');
    const options = fixture(); const mock = host();
    const key = { '--evidence-manifest': 'evidenceManifestFile', '--closure-artifact': 'closureArtifactFile', '--work-id': 'workId', '--ticket-id': 'ticketId' }[flag]!;
    await expect(runWorkflow(workflow(), { ...options, semanticOnly: true, [key]: 'x' })).rejects.toThrow('incompatible');
    expect(mock).not.toHaveBeenCalled();
  });
}

function declareContract(options: ReturnType<typeof fixture>) {
  const manifest = { schemaVersion: 2, behaviorMatrix: [{ id: 'boundary', behavior: 'safe call', kind: 'boundary', input: 'call', preconditions: 'active', expected: 'safe', risk: 'high', disposition: 'not-applicable', providerIds: [], reason: 'static fixture' }], providers: [], authorizations: [] };
  writeFileSync(join(options.cwd, 'goldband.review-evidence.json'), JSON.stringify(manifest));
  options.git('add', 'goldband.review-evidence.json'); options.git('commit', '-qm', 'contract');
}

test('equivalent diff-file locations share canonical semantic identity', async () => {
  const options = fixture(); const mock = host();
  const diff = spawnSync('git', ['diff'], { cwd: options.cwd, encoding: 'utf8' }).stdout;
  writeFileSync(join(options.cwd, 'one.diff'), diff);
  writeFileSync(join(options.cwd, 'two.diff'), diff);
  await runWorkflow(workflow(), { ...options, worktree: false, semanticOnly: true, diffFile: 'one.diff' });
  await expect(runWorkflow(workflow(), { ...options, worktree: false, semanticOnly: true, diffFile: 'two.diff' })).rejects.toThrow('duplicate semantic-only');
  expect(mock).toHaveBeenCalledTimes(1);
});

test('semantic findings retain the shared evidence downgrade and concrete-path threshold', async () => {
  const options = fixture();
  host([
    { file: 'subject.ts', severity: 'critical', summary: 'unsupported' },
    { file: 'subject.ts', severity: 'high', summary: 'no location', evidence: 'code', failureScenario: 'call', suggestedVerification: 'inspect' },
    { file: 'subject.ts', line: 1, severity: 'high', summary: 'no trigger', evidence: 'code', suggestedVerification: 'inspect' },
    { file: 'subject.ts', line: 1, severity: 'critical', summary: 'unverified risk', failureScenario: 'unsafe call', suggestedVerification: 'inspect' },
  ]);
  const result = await runWorkflow(workflow(), { ...options, semanticOnly: true });
  const findings = artifact(result).value.findings;
  expect(findings).toHaveLength(1);
  expect(findings[0]).toMatchObject({ severity: 'info', classification: 'semantic-concern', blocking: false });
  expect(findings[0].summary).toContain('[unverified critical]');
});
