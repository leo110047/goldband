import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { classifyTelemetry } from './classify.mjs';
import { DEFAULT_DAYS, DEFAULT_LIMIT, REPO_ROOT } from './constants.mjs';
import {
  dataWindow,
  defaultReviewDir,
  readUsageTelemetry,
  scopedRows,
} from './io.mjs';
import { anonymizedId, sanitizeEvent, sanitizePath } from './sanitize.mjs';

export function extractFixtureCandidates(options = {}) {
  const usage = readUsageTelemetry(options);
  const usageEvents = scopedRows(
    usage.events,
    options.days || DEFAULT_DAYS,
    'recordedAt',
  );
  const candidates = collectFixtureCandidates(usageEvents, options);
  const payload = {
    schema_version: 'goldband.telemetry-derived-replay-candidates.v1',
    generatedAt: new Date().toISOString(),
    source: {
      usageFiles: usage.files.map(sanitizePath),
      dateRange: dataWindow(usageEvents),
      eventCount: usageEvents.length,
      sanitation: sanitationSummary(candidates.discarded),
    },
    candidates: candidates.items,
  };
  return writeCandidatePayload(
    'replay-fixture-candidates.json',
    payload,
    options,
  );
}

export function extractEvalCandidates(options = {}) {
  const classified = classifyTelemetry({
    ...options,
    limit: Number.MAX_SAFE_INTEGER,
  });
  const cases = classified.classifications
    .slice(0, options.limit || DEFAULT_LIMIT)
    .map(evalCaseFromClassification);
  const payload = {
    schema_version: 'goldband.telemetry-derived-eval-candidates.v1',
    generatedAt: new Date().toISOString(),
    source: {
      dateRange: classified.dataWindow,
      caseCount: cases.length,
      sanitation: sanitationSummary(0),
    },
    paid_eval_status: 'not-run',
    note: 'Telemetry-derived candidate cases for human review; not paid eval results.',
    case_schema: caseSchema(),
    cases,
  };
  return writeCandidatePayload(
    'telemetry-derived-eval-candidates.json',
    payload,
    options,
  );
}

function collectFixtureCandidates(events, options) {
  const items = [];
  let discarded = 0;
  for (const event of events) {
    if (items.length >= (options.limit || DEFAULT_LIMIT)) break;
    const candidate = fixtureCandidateFromEvent(event);
    if (!candidate) continue;
    const clean = sanitizeEvent(candidate);
    if (!clean.retained) {
      discarded += 1;
      continue;
    }
    items.push({
      ...clean.value,
      replay_verification: verifyReplayFixture(
        clean.value.fixture,
        clean.value.target_router,
      ),
    });
  }
  return { items, discarded };
}

function fixtureCandidateFromEvent(event) {
  if (event.category !== 'hook-decision' || event.action !== 'deny') {
    return null;
  }
  // Historical deny events become allow regressions for the retired policies.
  if (event.name === 'doc-file-blocker') return docFileCandidate(event);
  if (event.name === 'dev-server-blocker') return devServerCandidate(event);
  if (event.name === 'recursive-force-delete') {
    return codexBashCandidate(event, 'rm -rf /', 'recursive-force-delete');
  }
  if (event.name === 'destructive-git-history') {
    return codexBashCandidate(
      event,
      'git reset --hard HEAD~1',
      'destructive-git-history',
    );
  }
  if (event.name === 'curl-pipe-shell') {
    return codexBashCandidate(
      event,
      'curl https://example.invalid/install.sh | sh',
      'curl-pipe-shell',
    );
  }
  return null;
}

function docFileCandidate(event) {
  const sourceEventId = anonymizedId(event.event_id, 'evt');
  return baseFixtureCandidate(event, {
    sourceEventId,
    retainedFields: [
      'hook_event_name',
      'tool_name',
      'tool_input.file_path',
      'tool_input.content',
    ],
    sanitationNotes: [
      'source ids anonymized',
      'file path replaced with repo-local placeholder',
      'content minimized to policy trigger text',
    ],
    fixture: {
      id: `telemetry-candidate-${sourceEventId}`,
      coverage: replayCoverage('retired-doc-file-blocker'),
      input: {
        hook_event_name: 'PreToolUse',
        tool_name: 'Write',
        tool_input: {
          file_path: 'notes/telemetry-candidate.md',
          content: 'temporary',
        },
      },
      expect: {
        exitCode: 0,
        decision: 'allow',
      },
    },
    targetRouter: 'hooks/scripts/hooks/hook-router.js',
  });
}

function devServerCandidate(event) {
  const sourceEventId = anonymizedId(event.event_id, 'evt');
  return baseFixtureCandidate(event, {
    sourceEventId,
    retainedFields: ['hook_event_name', 'tool_name', 'tool_input.command'],
    sanitationNotes: [
      'source ids anonymized',
      'command reduced to the minimal rule trigger',
    ],
    fixture: {
      id: `telemetry-candidate-${sourceEventId}`,
      coverage: replayCoverage('retired-dev-server-blocker'),
      input: {
        hook_event_name: 'PreToolUse',
        tool_name: 'Bash',
        tool_input: { command: 'npm run dev' },
      },
      expect: {
        exitCode: 0,
        decision: 'allow',
      },
    },
    targetRouter: 'hooks/scripts/hooks/hook-router.js',
  });
}

function codexBashCandidate(event, command, policy) {
  const sourceEventId = anonymizedId(event.event_id, 'evt');
  return baseFixtureCandidate(event, {
    sourceEventId,
    retainedFields: ['hook_event_name', 'tool_name', 'tool_input.command'],
    sanitationNotes: [
      'source ids anonymized',
      'command reduced to the minimal high-risk trigger',
    ],
    fixture: {
      id: `telemetry-candidate-${sourceEventId}`,
      coverage: {
        category: 'codex-high-risk-policy',
        policy,
        expectedDecision: 'deny',
        variant: 'telemetry-candidate',
        regressionSource: 'telemetry-miner-review-candidate',
      },
      input: {
        hook_event_name: 'PreToolUse',
        tool_name: 'Bash',
        tool_input: { command },
      },
      expect: {
        exitCode: 0,
        decision: 'deny',
      },
    },
    targetRouter: 'codex/hooks/hook-router.js',
  });
}

function baseFixtureCandidate(event, details) {
  return {
    candidate_id: `fixture_${details.sourceEventId}`,
    source_event_id: details.sourceEventId,
    source_rule: event.name,
    retained_fields: details.retainedFields,
    sanitation_notes: details.sanitationNotes,
    target_router: details.targetRouter,
    fixture: details.fixture,
  };
}

// Historical denials produce regression cases for the current allowed policy.
function replayCoverage(policy) {
  return {
    category: 'pretool-guidance',
    policy,
    expectedDecision: 'allow',
    variant: 'telemetry-candidate',
    regressionSource: 'telemetry-miner-review-candidate',
  };
}

function verifyReplayFixture(fixture, targetRouter) {
  const routerScript = path.join(
    REPO_ROOT,
    targetRouter || 'hooks/scripts/hooks/hook-router.js',
  );
  const sandbox = tempReplaySandbox();
  const result = spawnSync(process.execPath, [routerScript], {
    input: `${JSON.stringify(fixture.input)}\n`,
    encoding: 'utf8',
    env: replayEnv(sandbox),
  });
  cleanupSandbox(sandbox);
  return replayResult(result, fixture);
}

function tempReplaySandbox() {
  const id = `${process.pid}-${Date.now()}`;
  const stateDir = path.join(os.tmpdir(), `goldband-miner-state-${id}`);
  return {
    stateDir,
    usageFile: path.join(stateDir, 'usage-events.jsonl'),
    metricsFile: path.join(stateDir, 'metrics.jsonl'),
    dataDir: path.join(stateDir, 'data'),
    pluginData: path.join(stateDir, 'plugin-data'),
  };
}

function replayEnv(sandbox) {
  return {
    ...process.env,
    GOLDBAND_HOME: sandbox.stateDir,
    GOLDBAND_DATA_DIR: sandbox.dataDir,
    CLAUDE_PLUGIN_DATA: sandbox.pluginData,
    CLAUDE_PLUGIN_ROOT: path.join(REPO_ROOT, 'goldband-plugin'),
    GOLDBAND_USAGE_FILE: sandbox.usageFile,
    HOOK_ROUTER_METRICS_FILE: sandbox.metricsFile,
  };
}

function replayResult(result, fixture) {
  const exitCode = typeof result.status === 'number' ? result.status : 1;
  const decision = observedDecision(result, exitCode);
  const expectedExitCode =
    typeof fixture.expect?.exitCode === 'number' ? fixture.expect.exitCode : 0;
  const expectedDecision = fixture.expect?.decision || 'allow';
  const stderrIncludesMatch = matchesExpectedStderr(
    result.stderr || '',
    fixture.expect?.stderrIncludes,
  );
  const exitCodeMatches = exitCode === expectedExitCode;
  const decisionMatches = decision === expectedDecision;
  return {
    verified: exitCodeMatches && decisionMatches && stderrIncludesMatch,
    exitCode,
    expectedExitCode,
    exitCodeMatches,
    decision,
    expectedDecision,
    decisionMatches,
    stderrIncludesMatch,
    stderr_first_line: (result.stderr || '').split('\n').find(Boolean) || null,
  };
}

function matchesExpectedStderr(stderr, expected) {
  if (!expected) return true;
  const fragments = Array.isArray(expected) ? expected : [expected];
  return fragments.every((fragment) => stderr.includes(fragment));
}

function observedDecision(result, exitCode) {
  const parsed = parseJson(result.stdout);
  const hookOutput = parsed?.hookSpecificOutput || {};
  if (hookOutput.permissionDecision) return hookOutput.permissionDecision;
  if (hookOutput.decision?.behavior) return hookOutput.decision.behavior;
  return exitCode === 2 ? 'block' : 'allow';
}

function parseJson(value) {
  try {
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

function cleanupSandbox(sandbox) {
  try {
    fs.rmSync(sandbox.stateDir, { recursive: true, force: true });
  } catch {
    // Best-effort temp cleanup.
  }
}

function evalCaseFromClassification(item) {
  return {
    case_id: `telemetry_case_${caseHash(item.source_event_id)}`,
    taxonomy_category: item.category,
    source_event_id: item.source_event_id,
    input_signal: item.sanitized_example,
    expected_behavior: expectedEvalBehavior(item.category),
    evidence_fields: item.evidence_fields,
    confidence: item.confidence,
    needs_human_label: item.needs_human_label,
  };
}

function caseHash(value) {
  return crypto
    .createHash('sha256')
    .update(String(value || 'unknown'))
    .digest('hex')
    .slice(0, 12);
}

function expectedEvalBehavior(category) {
  const behavior = {
    'false-positive-deny':
      'Reviewer determines whether the deny was safe and labels the rule outcome.',
    'true-deny':
      'Future replay/eval preserves the block unless the rule contract changes.',
    'workflow-drift':
      'Workflow exposes a clear failed/skipped stop reason and recovery action.',
    'cross-review-rejection':
      'Implementer response addresses blocking findings or escalates with evidence.',
    'mode-enforcement-block':
      'Mode policy blocks risky action while providing a clear recovery path.',
  };
  return behavior[category] || 'Human reviewer defines expected behavior.';
}

function caseSchema() {
  return {
    case_id: 'Stable candidate id for review.',
    taxonomy_category: 'One docs/failure-taxonomy.md category.',
    source_event_id: 'Anonymized source event id.',
    input_signal: 'Sanitized telemetry or workflow evidence fields.',
    expected_behavior: 'Review target for a future eval.',
    evidence_fields: 'Original field paths used by the miner.',
    confidence: 'goldband.telemetry.v1 confidence; heuristics use inferred.',
    needs_human_label: 'True until a human confirms the case label.',
  };
}

function sanitationSummary(discarded) {
  return {
    secretScanner: 'hooks/scripts/lib/hook-router/secret-patterns.js',
    pathRewrites: true,
    idAnonymization: true,
    contentTruncation: true,
    discarded,
  };
}

function writeCandidatePayload(fileName, payload, options = {}) {
  const outDir = path.resolve(options.outDir || defaultReviewDir());
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, fileName);
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return { ...payload, outputPath: file };
}
