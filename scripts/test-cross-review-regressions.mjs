#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const core = require('../goldband-loop/cross-review/core.cjs');
const codexGate = require('../codex/hooks/cross-review-gate.js');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  assert.equal(
    result.status,
    options.expectStatus ?? 0,
    result.stderr || result.stdout,
  );
  return result;
}

function makeRepo(withPlan = true) {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'goldband-cross-review-reg-'),
  );
  run('git', ['init'], { cwd: dir });
  run('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  run('git', ['config', 'user.name', 'Test User'], { cwd: dir });
  fs.writeFileSync(path.join(dir, 'tracked.txt'), 'base\n');
  if (withPlan) fs.writeFileSync(path.join(dir, 'PLAN.md'), '# Plan\n');
  run('git', ['add', '.'], { cwd: dir });
  run('git', ['commit', '-m', 'base'], { cwd: dir });
  return dir;
}

function envFor(stateDir) {
  return {
    ...process.env,
    GOLDBAND_CROSS_REVIEW_DIR: stateDir,
    GOLDBAND_USAGE_FILE: path.join(stateDir, 'usage.jsonl'),
  };
}

function head(cwd) {
  return run('git', ['rev-parse', 'HEAD'], { cwd }).stdout.trim();
}

function createContract(dir, env, sessionId, overrides = {}) {
  return core.createContract(
    {
      sessionId,
      implementer: 'claude',
      reviewer: 'codex',
      planFile: 'PLAN.md',
      baseCommit: head(dir),
      cwd: dir,
      ...overrides,
    },
    env,
  );
}

function testChangesRequestedNeverRewritesToApproved() {
  const normalized = core.normalizeReviewResult(
    {
      verdict: 'CHANGES_REQUESTED',
      findings: [{ severity: 'HIGH', status: 'open' }],
    },
    1,
  );
  assert.equal(normalized.verdict, 'CHANGES_REQUESTED');
  assert.equal(normalized.blockingCount, 0);
}

function testMissingFindingsLineEscalates() {
  const dir = makeRepo();
  const stateDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'goldband-cross-review-state-'),
  );
  const env = envFor(stateDir);
  const fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), 'goldband-fake-bin-'));
  fs.writeFileSync(
    path.join(fakeBin, 'codex'),
    '#!/bin/sh\ncat >/dev/null\nprintf "%s\\n" "FAKE-CODEX-RAN"\nprintf "%s\\n" "GOLDBAND-CROSS-REVIEW-VERDICT: CHANGES_REQUESTED reviewer=codex round=1 blocking=1 advisory=0 artifact=fake"\n',
  );
  fs.chmodSync(path.join(fakeBin, 'codex'), 0o755);
  createContract(dir, env, 'missing-findings-line');
  const review = core.runReviewRound(
    { sessionId: 'missing-findings-line', cwd: dir },
    { ...env, PATH: `${fakeBin}${path.delimiter}${env.PATH}` },
  );
  assert.equal(review.artifact.verdict, 'ESCALATE');
  assert.equal(review.artifact.findings[0].id, 'CR-REVIEWER-PARSE');
  assert.match(
    fs.readFileSync(review.artifact.rawOutputPath, 'utf8'),
    /FAKE-CODEX-RAN/,
  );
}

function testApprovedWithBlockingFindingEscalates() {
  const normalized = core.normalizeReviewResult(
    {
      verdict: 'APPROVED',
      findings: [
        {
          severity: 'HIGH',
          ruleId: 'correctness.contract',
          failureScenario: 'Reviewer found a blocking contract failure.',
          status: 'open',
        },
      ],
    },
    1,
  );
  assert.equal(normalized.verdict, 'ESCALATE');
  assert.equal(normalized.blockingCount, 1);
}

function testReviewerPromptIncludesSharedReviewStandard() {
  const dir = makeRepo();
  const stateDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'goldband-cross-review-state-'),
  );
  const env = envFor(stateDir);
  createContract(dir, env, 'shared-review-standard');
  const prompt = core.buildReviewerPrompt(
    core.readContract('shared-review-standard', env),
    dir,
    env,
  );

  assert.match(prompt, /## Shared Review Standard/);
  assert.match(prompt, /correctness-contract/);
  assert.match(prompt, /## Shared Finding Shape/);
  assert.match(prompt, /suggestedVerification/);
  assert.match(prompt, /GOLDBAND-CROSS-REVIEW-VERDICT/);
  assert.match(prompt, /reviewed-sha/);
}

function testNonZeroReviewerExitEscalates() {
  const dir = makeRepo();
  const stateDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'goldband-cross-review-state-'),
  );
  const env = envFor(stateDir);
  const fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), 'goldband-fake-bin-'));
  fs.writeFileSync(
    path.join(fakeBin, 'codex'),
    '#!/bin/sh\ncat >/dev/null\nprintf "%s\\n" "GOLDBAND-CROSS-REVIEW-VERDICT: APPROVED reviewer=codex round=1 blocking=0 advisory=0 artifact=fake"\nprintf "%s\\n" "GOLDBAND-CROSS-REVIEW-FINDINGS: []"\nexit 42\n',
  );
  fs.chmodSync(path.join(fakeBin, 'codex'), 0o755);
  createContract(dir, env, 'nonzero-reviewer-exit');
  const review = core.runReviewRound(
    { sessionId: 'nonzero-reviewer-exit', cwd: dir },
    { ...env, PATH: `${fakeBin}${path.delimiter}${env.PATH}` },
  );
  const planText = fs.readFileSync(path.join(dir, 'PLAN.md'), 'utf8');
  assert.equal(review.artifact.verdict, 'ESCALATE');
  assert.equal(review.artifact.reviewerExitCode, 42);
  assert.equal(review.artifact.findings[0].id, 'CR-REVIEWER-EXIT');
  assert.doesNotMatch(planText, /GOLDBAND-CROSS-REVIEW: APPROVED/);
}

function assertUntrackedPlanTextAllows(planText, suffix) {
  const dir = makeRepo(false);
  const stateDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'goldband-cross-review-state-'),
  );
  const env = envFor(stateDir);
  const sessionId = `untracked-plan-${suffix}`;
  fs.writeFileSync(path.join(dir, 'PLAN.md'), planText);
  createContract(dir, env, sessionId);
  const review = core.runReviewRound(
    { sessionId, reviewMode: 'mock', mockVerdict: 'APPROVED', cwd: dir },
    env,
  );
  const artifact = {
    ...review.artifact,
    reviewMode: 'real',
  };
  core.writeArtifact(artifact, 'real fixture output', env);
  core.writeContract(
    { ...core.readContract(sessionId, env), status: 'active' },
    env,
  );
  const gate = core.evaluateCrossReviewGate(
    { hook_event_name: 'Stop', session_id: sessionId },
    { cwd: dir, env },
  );
  assert.equal(gate.decision, 'allow', gate.logs.join('\n'));
}

function testUntrackedPlanMarkerRoundTripAllows() {
  assertUntrackedPlanTextAllows('# Plan\n', 'newline');
  assertUntrackedPlanTextAllows('# Plan', 'nonewline');
  assertUntrackedPlanTextAllows('# Plan\n\ncontent\n', 'content');
}

function testRoundTwoNewHighCanBlock() {
  const normalized = core.normalizeReviewResult(
    {
      verdict: 'CHANGES_REQUESTED',
      findings: [
        {
          id: 'CR-REG-HIGH',
          severity: 'HIGH',
          ruleId: 'correctness.contract',
          failureScenario:
            'Latest fix introduced a high-impact contract failure.',
          status: 'open',
        },
      ],
    },
    2,
    [{ findings: [] }],
  );
  assert.equal(normalized.findings[0].severity, 'HIGH');
  assert.equal(normalized.blockingCount, 1);
}

function testPromptArmDoesNotResetActiveContract() {
  const dir = makeRepo();
  const stateDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'goldband-cross-review-state-'),
  );
  const env = envFor(stateDir);
  const sessionId = 'rearm-active';
  const first = core.armFromPrompt(
    { session_id: sessionId, prompt: '/goldband-cross-review PLAN.md' },
    { cwd: dir, env, implementer: 'claude' },
  );
  core.writeContract({ ...first, roundsUsed: 2 }, env);
  const second = core.armFromPrompt(
    { session_id: sessionId, prompt: '/goldband-cross-review PLAN.md' },
    { cwd: dir, env, implementer: 'claude' },
  );
  const third = core.armFromPrompt(
    { session_id: sessionId, prompt: '/goldband-cross-review OTHER.md' },
    { cwd: dir, env, implementer: 'claude' },
  );
  const fourth = core.armFromPrompt(
    { session_id: sessionId, prompt: '/goldband-cross-review' },
    { cwd: dir, env, implementer: 'claude' },
  );
  assert.equal(second.roundsUsed, 2);
  assert.equal(third.roundsUsed, 2);
  assert.equal(fourth.roundsUsed, 2);
  assert.equal(third.planFile, 'PLAN.md');
  assert.equal(fourth.planFile, 'PLAN.md');
  assert.equal(third.baseCommit, first.baseCommit);
  assert.equal(fourth.baseCommit, first.baseCommit);
}

function testSlashCommandArmParsesPlanReviewerAndModel() {
  const dir = makeRepo();
  const stateDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'goldband-cross-review-state-'),
  );
  const env = envFor(stateDir);
  const contract = core.armFromPrompt(
    {
      session_id: 'slash-command-session',
      prompt:
        '/goldband-cross-review docs/implementation-plan.md claude --model claude-opus-4',
    },
    { cwd: dir, env, implementer: 'codex' },
  );
  assert.equal(contract.reviewer, 'claude');
  assert.equal(contract.planFile, 'docs/implementation-plan.md');
  assert.equal(contract.reviewerModel, 'claude-opus-4');

  const parsed = core.parseCrossReviewRequest(
    '/goldband-cross-review "docs/plan with spaces.md" --reviewer codex --model gpt-5.5',
  );
  assert.equal(parsed.planFile, 'docs/plan with spaces.md');
  assert.equal(parsed.reviewer, 'codex');
  assert.equal(parsed.reviewerModel, 'gpt-5.5');
}

function testSlashCommandRequiresPlanAndAvoidsInlineMentions() {
  assert.equal(
    core.promptRequestsCrossReview('可以用 /goldband-cross-review 嗎'),
    false,
  );
  assert.throws(
    () =>
      core.armFromPrompt(
        { session_id: 'missing-plan', prompt: '/goldband-cross-review' },
        {
          cwd: makeRepo(),
          env: envFor(
            fs.mkdtempSync(
              path.join(os.tmpdir(), 'goldband-cross-review-state-'),
            ),
          ),
        },
      ),
    /missing implementation plan path/,
  );
}

function testOnlySlashCommandTriggersCrossReview() {
  assert.equal(
    core.promptRequestsCrossReview('說明 `[[cross-review]]` 這個觸發詞'),
    false,
  );
  assert.equal(
    core.promptRequestsCrossReview('中文「開啟交互審查」只是文件範例'),
    false,
  );
  assert.equal(
    core.promptRequestsCrossReview(
      '說明 `/goldband-cross-review PLAN.md` 的用法',
    ),
    false,
  );
  assert.equal(
    core.promptRequestsCrossReview(
      '請做這件事 [[cross-review]] --plan PLAN.md',
    ),
    false,
  );
  assert.equal(
    core.promptRequestsCrossReview('請開啟交互審查 --plan PLAN.md'),
    false,
  );
  assert.equal(
    core.promptRequestsCrossReview('/goldband-cross-review PLAN.md'),
    true,
  );
}

function testCodexAdapterLoadsTheSharedCrossReviewCore() {
  const dir = makeRepo();
  const stateDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'goldband-cross-review-state-'),
  );
  const contract = codexGate.armFromPrompt(
    {
      session_id: 'codex-adapter-session',
      prompt: '/goldband-cross-review PLAN.md',
    },
    {
      cwd: dir,
      env: envFor(stateDir),
      implementer: 'codex',
    },
  );
  assert.equal(contract.planFile, 'PLAN.md');
  assert.equal(contract.reviewer, 'claude');
}

function testCodexOnlyInstallLoadsCrossReviewRuntime() {
  const dir = makeRepo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'goldband-codex-only-'));
  const hooksDir = path.join(home, '.codex', 'hooks');
  const runtimeDir = path.join(
    home,
    '.codex',
    'skills',
    'goldband',
    'cross-review',
  );
  fs.mkdirSync(hooksDir, { recursive: true });
  fs.mkdirSync(runtimeDir, { recursive: true });
  fs.copyFileSync(
    path.join(process.cwd(), 'codex', 'hooks', 'cross-review-gate.js'),
    path.join(hooksDir, 'cross-review-gate.js'),
  );
  for (const file of ['module-loader.js', 'cross-review-request.cjs']) {
    fs.copyFileSync(
      path.join(process.cwd(), 'codex', 'hooks', file),
      path.join(hooksDir, file),
    );
  }
  for (const file of [
    'core.cjs',
    'cross-review-request.cjs',
    'reviewer-prompt.md',
    'rubric.md',
  ]) {
    fs.copyFileSync(
      path.join(process.cwd(), 'goldband-loop', 'cross-review', file),
      path.join(runtimeDir, file),
    );
  }
  const script = [
    `const gate = require(${JSON.stringify(path.join(hooksDir, 'cross-review-gate.js'))});`,
    `const contract = gate.armFromPrompt({ session_id: 'installed-session', prompt: '/goldband-cross-review PLAN.md' }, { cwd: ${JSON.stringify(dir)}, env: process.env, implementer: 'codex' });`,
    `process.stdout.write(JSON.stringify({ planFile: contract.planFile, reviewer: contract.reviewer }));`,
  ].join('\n');
  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: dir,
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: home,
      GOLDBAND_ROOT: '',
      GOLDBAND_CROSS_REVIEW_ROOT: path.join(home, 'state'),
    },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    planFile: 'PLAN.md',
    reviewer: 'claude',
  });
}

function copyFiles(sourceDir, targetDir, files) {
  fs.mkdirSync(targetDir, { recursive: true });
  for (const file of files) {
    fs.copyFileSync(path.join(sourceDir, file), path.join(targetDir, file));
  }
}

function testClaudePluginInstallLoadsCrossReviewRuntime() {
  const dir = makeRepo();
  const home = fs.mkdtempSync(
    path.join(os.tmpdir(), 'goldband-claude-plugin-'),
  );
  const hooksDir = path.join(
    home,
    'plugin-cache/hooks/scripts/lib/hook-router',
  );
  copyFiles(
    path.join(
      process.cwd(),
      'plugin-assets/claude-code-plugin/hooks/scripts/lib/hook-router',
    ),
    hooksDir,
    ['cross-review-gate.js', 'cross-review-request.cjs', 'module-loader.js'],
  );
  copyFiles(
    path.join(process.cwd(), 'goldband-loop/cross-review'),
    path.join(home, '.claude/skills/goldband/cross-review'),
    ['core.cjs', 'cross-review-request.cjs', 'reviewer-prompt.md', 'rubric.md'],
  );
  const script = [
    `const gate = require(${JSON.stringify(path.join(hooksDir, 'cross-review-gate.js'))});`,
    `const contract = gate.armFromPrompt({ session_id: 'plugin-session', prompt: '/goldband-cross-review PLAN.md' }, { cwd: ${JSON.stringify(dir)}, env: process.env, implementer: 'claude' });`,
    `process.stdout.write(JSON.stringify({ planFile: contract.planFile, reviewer: contract.reviewer }));`,
  ].join('\n');
  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: dir,
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: home,
      GOLDBAND_ROOT: '',
      GOLDBAND_CROSS_REVIEW_ROOT: path.join(home, 'state'),
    },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    planFile: 'PLAN.md',
    reviewer: 'codex',
  });
}

function testMissingCoreFailsOnlyExplicitRequests() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'goldband-no-core-'));
  const hooksDir = path.join(
    home,
    'plugin',
    'hooks',
    'scripts',
    'lib',
    'hook-router',
  );
  fs.mkdirSync(hooksDir, { recursive: true });
  for (const file of [
    'cross-review-gate.js',
    'cross-review-request.cjs',
    'module-loader.js',
  ]) {
    fs.copyFileSync(
      path.join(process.cwd(), 'hooks', 'scripts', 'lib', 'hook-router', file),
      path.join(hooksDir, file),
    );
  }
  const script = [
    `const gate = require(${JSON.stringify(path.join(hooksDir, 'cross-review-gate.js'))});`,
    `const ordinary = gate.armFromPrompt({ prompt: 'please review this' }, {});`,
    `const bareAlias = gate.armFromPrompt({ prompt: '/cross-review notes' }, {});`,
    `const inlineCode = gate.armFromPrompt({ prompt: 'run \\x60/goldband-cross-review PLAN.md\\x60 later' }, {});`,
    `let laterLineError = null;`,
    `try { gate.armFromPrompt({ prompt: 'Context first\\n/goldband-cross-review PLAN.md' }, {}); } catch (caught) { laterLineError = caught.message; }`,
    `const decision = gate.evaluateCrossReviewGate({ hook_event_name: 'Stop' }, {}).decision;`,
    `let error = null;`,
    `try { gate.armFromPrompt({ prompt: '/goldband-cross-review PLAN.md' }, {}); } catch (caught) { error = caught.message; }`,
    `process.stdout.write(JSON.stringify({ ordinary, bareAlias, inlineCode, decision, error, laterLineError }));`,
  ].join('\n');
  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: home,
    encoding: 'utf8',
    env: { ...process.env, HOME: home, GOLDBAND_ROOT: '' },
  });
  assert.equal(result.status, 0, result.stderr);
  const observed = JSON.parse(result.stdout);
  assert.equal(observed.ordinary, null);
  assert.equal(observed.bareAlias, null);
  assert.equal(observed.inlineCode, null);
  assert.match(
    observed.laterLineError,
    /cross-review runtime is not installed/,
  );
  assert.equal(observed.decision, 'allow');
  assert.match(observed.error, /cross-review runtime is not installed/);
}

testChangesRequestedNeverRewritesToApproved();
testMissingFindingsLineEscalates();
testApprovedWithBlockingFindingEscalates();
testReviewerPromptIncludesSharedReviewStandard();
testNonZeroReviewerExitEscalates();
testUntrackedPlanMarkerRoundTripAllows();
testRoundTwoNewHighCanBlock();
testPromptArmDoesNotResetActiveContract();
testSlashCommandArmParsesPlanReviewerAndModel();
testSlashCommandRequiresPlanAndAvoidsInlineMentions();
testOnlySlashCommandTriggersCrossReview();
testCodexAdapterLoadsTheSharedCrossReviewCore();
testCodexOnlyInstallLoadsCrossReviewRuntime();
testMissingCoreFailsOnlyExplicitRequests();
testClaudePluginInstallLoadsCrossReviewRuntime();

console.log('[OK] cross-review regression tests passed');
