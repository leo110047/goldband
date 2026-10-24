#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

function parseArgs(argv) {
  const options = {
    iterations: 1,
    fixtures: path.join(
      __dirname,
      '..',
      '..',
      'fixtures',
      'router',
      'replay-fixtures.json',
    ),
  };

  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--iterations') {
      const next = parseInt(argv[index + 1], 10);
      if (Number.isFinite(next) && next > 0) {
        options.iterations = next;
      }
      index += 1;
      continue;
    }

    if (token === '--fixtures') {
      const next = argv[index + 1];
      if (next) {
        options.fixtures = path.resolve(next);
      }
      index += 1;
    }
  }

  return options;
}

function loadFixtures(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error('Fixture file must be a JSON array');
  }
  return parsed;
}

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length) - 1;
  const index = Math.max(0, Math.min(sorted.length - 1, rank));
  return sorted[index];
}

function avg(values) {
  if (values.length === 0) return 0;
  const total = values.reduce((sum, value) => sum + value, 0);
  return total / values.length;
}

function matchesExpected(stderr, expected) {
  if (!expected) return true;
  const list = Array.isArray(expected) ? expected : [expected];
  return list.every((fragment) => stderr.includes(fragment));
}

function stdoutMatchesExpected(stdout, expected) {
  if (!expected) return true;
  const list = Array.isArray(expected) ? expected : [expected];
  return list.every((fragment) => stdout.includes(fragment));
}

function stdoutExcludesExpected(stdout, excluded) {
  if (!excluded) return true;
  const list = Array.isArray(excluded) ? excluded : [excluded];
  return list.every((fragment) => !stdout.includes(fragment));
}

function loadMetrics(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs
    .readFileSync(filePath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function prepareModeStateFixture(fixture, modeStateFile) {
  try {
    if (fs.existsSync(modeStateFile)) {
      fs.unlinkSync(modeStateFile);
    }
  } catch {
    // Ignore cleanup failures before the next fixture.
  }

  const modeState = fixture.setup && fixture.setup.modeState;
  if (!modeState || typeof modeState !== 'object') {
    return;
  }

  const payload = {
    sessionId:
      typeof modeState.sessionId === 'string' ? modeState.sessionId : 'default',
    updatedAt: new Date().toISOString(),
    modes:
      modeState.modes && typeof modeState.modes === 'object'
        ? modeState.modes
        : {},
  };

  fs.writeFileSync(
    modeStateFile,
    JSON.stringify(payload, null, 2) + '\n',
    'utf8',
  );
}

function formatRatio(numerator, denominator) {
  if (denominator === 0) return '0.00%';
  return `${((numerator / denominator) * 100).toFixed(2)}%`;
}

function buildTempPaths() {
  const runId = `${Date.now()}-${process.pid}`;
  const runDir = path.join(os.tmpdir(), `goldband-router-${runId}`);
  fs.mkdirSync(runDir, { recursive: true });
  const makePath = (name, ext) => path.join(runDir, `${name}.${ext}`);
  return {
    runDir,
    metricsFile: makePath('metrics', 'jsonl'),
    modeStateFile: makePath('mode', 'json'),
    usageFile: makePath('usage', 'jsonl'),
  };
}

function tempFileList(paths) {
  return [
    paths.runDir,
    paths.metricsFile,
    paths.modeStateFile,
    paths.usageFile,
  ];
}

function scriptForFixture(fixture, routerScript) {
  if (fixture.script === 'skill-activation-suggestions') {
    return path.join(
      __dirname,
      '..',
      'hooks',
      'skill-activation-suggestions.js',
    );
  }
  return routerScript;
}

function buildFixtureEnv(fixture, paths, fixtureDir) {
  const env = {
    ...process.env,
    HOOK_ROUTER_METRICS_ENABLED: '1',
    HOOK_ROUTER_METRICS_FILE: paths.metricsFile,
    HOOK_ROUTER_MODE_STATE_FILE: paths.modeStateFile,
    GOLDBAND_USAGE_FILE: paths.usageFile,
    // Live style advice is outside replay scope; a missing checker keeps
    // fixtures independent of checkout state and writes no snapshots.
    GOLDBAND_STYLE_GATE_SCRIPT: path.join(paths.runDir, 'no-style-checker'),
    ...(fixture.env || {}),
  };
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string') {
      env[key] = value
        .replaceAll('__FIXTURE_DIR__', fixtureDir)
        .replaceAll('__RUN_TMP__', paths.runDir);
    }
  }
  return env;
}

function prepareGitWorktreeFixture(fixture, paths) {
  const kind = fixture.setup && fixture.setup.gitWorktree;
  if (kind !== 'managed' && kind !== 'plain') return undefined;
  const cwd = path.join(paths.runDir, `git-worktree-${kind}`);
  if (!fs.existsSync(path.join(cwd, '.git'))) {
    fs.mkdirSync(cwd, { recursive: true });
    const initialized = spawnSync('git', ['init', '-q'], {
      cwd,
      encoding: 'utf8',
    });
    if (initialized.status !== 0) {
      throw new Error(
        `could not create ${kind} Git fixture: ${initialized.stderr}`,
      );
    }
  }
  const marker = path.join(cwd, '.git', 'goldband-managed-worktree.json');
  if (kind === 'managed') {
    fs.writeFileSync(
      marker,
      '{"schemaVersion":1,"leaseId":"replay","manifestPath":"/fixture"}\n',
    );
  } else if (fs.existsSync(marker)) {
    fs.unlinkSync(marker);
  }
  return cwd;
}

function invokeScript(scriptPath, stdinPayload, env, cwd) {
  return spawnSync(process.execPath, [scriptPath], {
    input: stdinPayload,
    encoding: 'utf8',
    maxBuffer: 2 * 1024 * 1024,
    env,
    cwd,
  });
}

function invokeFixture({
  fixture,
  iteration,
  routerScript,
  paths,
  fixtureDir,
}) {
  const stdinPayload = JSON.stringify(fixture.input || {}).replaceAll(
    '__ITERATION__',
    String(iteration),
  );
  const startNs = process.hrtime.bigint();
  prepareModeStateFixture(fixture, paths.modeStateFile);
  const cwd = prepareGitWorktreeFixture(fixture, paths);
  const result = invokeScript(
    scriptForFixture(fixture, routerScript),
    stdinPayload,
    buildFixtureEnv(fixture, paths, fixtureDir),
    cwd,
  );

  return buildInvocationResult(fixture, iteration, result, startNs);
}

function outputMatchesExpected(result, expected) {
  return (
    matchesExpected(result.stderr || '', expected.stderrIncludes) &&
    stdoutMatchesExpected(result.stdout || '', expected.stdoutIncludes) &&
    stdoutExcludesExpected(result.stdout || '', expected.stdoutExcludes)
  );
}

function buildInvocationResult(fixture, iteration, result, startNs) {
  const durationMs = Number(process.hrtime.bigint() - startNs) / 1e6;
  const exitCode = typeof result.status === 'number' ? result.status : 1;
  const decision = exitCode === 2 ? 'block' : 'allow';
  const expected = fixture.expect || {};
  const expectedExitCode =
    typeof expected.exitCode === 'number' ? expected.exitCode : 0;
  const expectedDecision =
    expected.decision || (expectedExitCode === 2 ? 'block' : 'allow');
  const pass =
    exitCode === expectedExitCode &&
    decision === expectedDecision &&
    outputMatchesExpected(result, expected);

  return {
    id: fixture.id,
    iteration,
    input: fixture.input || {},
    expected,
    pass,
    exitCode,
    decision,
    stderr: result.stderr || '',
    stdout: result.stdout || '',
    durationMs,
  };
}

function replayFixtures(fixtures, options, routerScript, paths) {
  const invocationResults = [];
  const fixtureDir = path.dirname(options.fixtures);
  for (let iteration = 1; iteration <= options.iterations; iteration += 1) {
    for (const fixture of fixtures) {
      invocationResults.push(
        invokeFixture({ fixture, iteration, routerScript, paths, fixtureDir }),
      );
    }
  }
  return invocationResults;
}

function mergeMetrics(invocationResults, metricsFile) {
  const metricRows = loadMetrics(metricsFile);
  return invocationResults.map((item, index) => ({
    ...item,
    metric: metricRows[index] || null,
  }));
}

function summarizeReplay(mergedResults) {
  const failures = mergedResults.filter((item) => !item.pass);
  const latencies = mergedResults.map((item) => item.durationMs);
  const total = mergedResults.length;
  const blocked = mergedResults.filter(
    (item) => item.decision === 'block',
  ).length;
  const expectedAllowCases = mergedResults.filter(hasExpectedAllowDecision);
  const falseIntercepts = expectedAllowCases.filter(
    (item) => item.decision === 'block',
  );
  const editMetrics = mergedResults
    .filter((item) => item.input.tool_name === 'Edit')
    .map((item) => Number(item.metric?.totalProcesses || 1));

  return {
    total,
    failures,
    blocked,
    allowed: total - blocked,
    expectedAllowCases,
    falseIntercepts,
    p50: percentile(latencies, 50),
    p95: percentile(latencies, 95),
    editAvg: avg(editMetrics),
    editP95: percentile(editMetrics, 95),
  };
}

function hasExpectedAllowDecision(item) {
  const expectedDecision =
    item.expected.decision ||
    (item.expected.exitCode === 2 ? 'block' : 'allow');
  return expectedDecision === 'allow';
}

function printReplayReport(fixtures, options, summary) {
  console.log('╔════════════════════════════════════════╗');
  console.log('║  Hook Router Replay Report            ║');
  console.log('╚════════════════════════════════════════╝');
  console.log('');
  console.log(
    `Fixtures: ${fixtures.length}  Iterations: ${options.iterations}  Invocations: ${summary.total}`,
  );
  console.log(
    `Pass: ${summary.total - summary.failures.length}  Fail: ${summary.failures.length}`,
  );
  console.log('');
  console.log('Latency:');
  console.log(`  p50: ${summary.p50.toFixed(2)} ms`);
  console.log(`  p95: ${summary.p95.toFixed(2)} ms`);
  console.log('');
  console.log('Process Cost (Edit):');
  console.log(`  avg processes/call: ${summary.editAvg.toFixed(2)}`);
  console.log(`  p95 processes/call: ${summary.editP95.toFixed(2)}`);
  console.log('');
  console.log('Policy Ratios:');
  console.log(
    `  block: ${summary.blocked} (${formatRatio(summary.blocked, summary.total)})`,
  );
  console.log(
    `  allow: ${summary.allowed} (${formatRatio(summary.allowed, summary.total)})`,
  );
  console.log(
    `  false intercept rate: ${formatRatio(summary.falseIntercepts.length, summary.expectedAllowCases.length)}`,
  );
  printFailures(summary.failures);
}

function printFailures(failures) {
  if (failures.length === 0) return;
  console.log('');
  console.log('Failures:');
  for (const fail of failures) {
    printFailure(fail);
  }
}

function printFailure(fail) {
  const expectedDecision =
    fail.expected.decision ||
    (fail.expected.exitCode === 2 ? 'block' : 'allow');
  console.log(`  - ${fail.id} (iter ${fail.iteration})`);
  console.log(
    `    expected exit=${fail.expected.exitCode ?? 0}, decision=${expectedDecision}`,
  );
  console.log(`    actual   exit=${fail.exitCode}, decision=${fail.decision}`);
  const firstLine = fail.stderr ? fail.stderr.split('\n').find(Boolean) : '';
  if (firstLine) console.log(`    stderr: ${firstLine}`);
}

function cleanupTempFiles(files) {
  for (const file of files) {
    try {
      if (!fs.existsSync(file)) continue;
      if (fs.statSync(file).isDirectory()) {
        fs.rmSync(file, { recursive: true, force: true });
      } else {
        fs.unlinkSync(file);
      }
    } catch {
      // Ignore temp cleanup failures.
    }
  }
}

function run() {
  const options = parseArgs(process.argv);
  const fixtures = loadFixtures(options.fixtures);
  const routerScript = path.join(__dirname, '..', 'hooks', 'hook-router.js');
  const paths = buildTempPaths();

  try {
    const invocations = replayFixtures(fixtures, options, routerScript, paths);
    const mergedResults = mergeMetrics(invocations, paths.metricsFile);
    const summary = summarizeReplay(mergedResults);
    printReplayReport(fixtures, options, summary);
    process.exit(summary.failures.length > 0 ? 1 : 0);
  } finally {
    cleanupTempFiles(tempFileList(paths));
  }
}

run();
