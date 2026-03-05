#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

function parseArgs(argv) {
  const options = {
    iterations: 1,
    fixtures: path.join(__dirname, '..', '..', 'fixtures', 'router', 'replay-fixtures.json')
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
  return list.every(fragment => stderr.includes(fragment));
}

function loadMetrics(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(line => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function formatRatio(numerator, denominator) {
  if (denominator === 0) return '0.00%';
  return `${((numerator / denominator) * 100).toFixed(2)}%`;
}

function run() {
  const options = parseArgs(process.argv);
  const fixtures = loadFixtures(options.fixtures);
  const routerScript = path.join(__dirname, '..', 'hooks', 'hook-router.js');

  const runId = `${Date.now()}-${process.pid}`;
  const metricsFile = path.join(os.tmpdir(), `goldband-router-metrics-${runId}.jsonl`);
  const contextStateFile = path.join(os.tmpdir(), `goldband-router-context-${runId}.json`);
  const debounceFile = path.join(os.tmpdir(), `goldband-router-debounce-${runId}.json`);

  const tempFiles = [metricsFile, contextStateFile, debounceFile];

  try {
    const invocationResults = [];

    for (let iteration = 1; iteration <= options.iterations; iteration += 1) {
      for (const fixture of fixtures) {
        const stdinPayload = JSON.stringify(fixture.input || {});
        const startNs = process.hrtime.bigint();

        const result = spawnSync(process.execPath, [routerScript], {
          input: stdinPayload,
          encoding: 'utf8',
          maxBuffer: 2 * 1024 * 1024,
          env: {
            ...process.env,
            HOOK_ROUTER_METRICS_ENABLED: '1',
            HOOK_ROUTER_METRICS_FILE: metricsFile,
            HOOK_ROUTER_CONTEXT_STATE_FILE: contextStateFile,
            HOOK_ROUTER_DEBOUNCE_FILE: debounceFile
          }
        });

        const endNs = process.hrtime.bigint();
        const durationMs = Number(endNs - startNs) / 1e6;
        const exitCode = typeof result.status === 'number' ? result.status : 1;
        const decision = exitCode === 2 ? 'block' : 'allow';

        const expected = fixture.expect || {};
        const expectedExitCode = typeof expected.exitCode === 'number' ? expected.exitCode : 0;
        const expectedDecision = expected.decision || (expectedExitCode === 2 ? 'block' : 'allow');

        const pass = (
          exitCode === expectedExitCode
          && decision === expectedDecision
          && matchesExpected(result.stderr || '', expected.stderrIncludes)
        );

        invocationResults.push({
          id: fixture.id,
          iteration,
          input: fixture.input || {},
          expected,
          pass,
          exitCode,
          decision,
          stderr: result.stderr || '',
          stdout: result.stdout || '',
          durationMs
        });
      }
    }

    const metricRows = loadMetrics(metricsFile);
    const mergedResults = invocationResults.map((item, index) => ({
      ...item,
      metric: metricRows[index] || null
    }));

    const failures = mergedResults.filter(item => !item.pass);
    const latencies = mergedResults.map(item => item.durationMs);

    const total = mergedResults.length;
    const blocked = mergedResults.filter(item => item.decision === 'block').length;
    const allowed = total - blocked;

    const expectedAllowCases = mergedResults.filter(item => {
      const expectedDecision = item.expected.decision || (item.expected.exitCode === 2 ? 'block' : 'allow');
      return expectedDecision === 'allow';
    });
    const falseIntercepts = expectedAllowCases.filter(item => item.decision === 'block');

    const editMetrics = mergedResults
      .filter(item => item.input.tool_name === 'Edit')
      .map(item => Number(item.metric?.totalProcesses || 1));

    const p50 = percentile(latencies, 50);
    const p95 = percentile(latencies, 95);
    const editAvg = avg(editMetrics);
    const editP95 = percentile(editMetrics, 95);

    console.log('╔════════════════════════════════════════╗');
    console.log('║  Hook Router Replay Report            ║');
    console.log('╚════════════════════════════════════════╝');
    console.log('');
    console.log(`Fixtures: ${fixtures.length}  Iterations: ${options.iterations}  Invocations: ${total}`);
    console.log(`Pass: ${total - failures.length}  Fail: ${failures.length}`);
    console.log('');
    console.log('Latency:');
    console.log(`  p50: ${p50.toFixed(2)} ms`);
    console.log(`  p95: ${p95.toFixed(2)} ms`);
    console.log('');
    console.log('Process Cost (Edit):');
    console.log(`  avg processes/call: ${editAvg.toFixed(2)}`);
    console.log(`  p95 processes/call: ${editP95.toFixed(2)}`);
    console.log('');
    console.log('Policy Ratios:');
    console.log(`  block: ${blocked} (${formatRatio(blocked, total)})`);
    console.log(`  allow: ${allowed} (${formatRatio(allowed, total)})`);
    console.log(`  false intercept rate: ${formatRatio(falseIntercepts.length, expectedAllowCases.length)}`);

    if (failures.length > 0) {
      console.log('');
      console.log('Failures:');
      for (const fail of failures) {
        const expectedDecision = fail.expected.decision || (fail.expected.exitCode === 2 ? 'block' : 'allow');
        console.log(`  - ${fail.id} (iter ${fail.iteration})`);
        console.log(`    expected exit=${fail.expected.exitCode ?? 0}, decision=${expectedDecision}`);
        console.log(`    actual   exit=${fail.exitCode}, decision=${fail.decision}`);
        if (fail.stderr) {
          const firstLine = fail.stderr.split('\n').find(Boolean) || '';
          if (firstLine) {
            console.log(`    stderr: ${firstLine}`);
          }
        }
      }
    }

    process.exit(failures.length > 0 ? 1 : 0);
  } finally {
    for (const file of tempFiles) {
      try {
        if (fs.existsSync(file)) {
          fs.unlinkSync(file);
        }
      } catch {
        // Ignore temp cleanup failures.
      }
    }
  }
}

run();
