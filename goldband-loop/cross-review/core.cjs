const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  matchCrossReviewCommand,
  promptRequestsCrossReview,
} = require('./cross-review-request.cjs');
let normalizeUsageEvent = null;

function loadTelemetryNormalizer() {
  const candidates = [
    path.resolve(__dirname, '..', '..', 'scripts', 'lib', 'telemetry-schema.cjs'),
    path.join(os.homedir(), '.codex', 'hooks', 'telemetry-schema.cjs'),
    path.join(
      os.homedir(),
      '.claude',
      'hooks',
      'scripts',
      'lib',
      'telemetry-schema.cjs',
    ),
  ];
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        return require(candidate).normalizeUsageEvent;
      }
    } catch {
      // Usage telemetry is optional and must not disable cross-review.
    }
  }
  return null;
}

const CONTRACT_SCHEMA_VERSION = 1;
const DEFAULT_MAX_ROUNDS = 3;
const DEFAULT_TTL_HOURS = 24;
const VALID_HOSTS = new Set(['claude', 'codex']);
const VALID_STATUSES = new Set(['active', 'passed', 'overridden', 'expired']);
const VERDICTS = new Set(['APPROVED', 'CHANGES_REQUESTED', 'ESCALATE']);
const MARKER_PREFIX = 'GOLDBAND-CROSS-REVIEW';

function nowIso() {
  return new Date().toISOString();
}

function parsePositiveInt(value, fallback) {
  const parsed = parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function stateRoot(env = process.env) {
  const explicit = firstEnv(env, [
    'GOLDBAND_CROSS_REVIEW_ROOT',
    'GOLDBAND_HOME',
  ]);
  if (explicit) return explicit;
  if (env.CLAUDE_PLUGIN_DATA) return env.CLAUDE_PLUGIN_DATA;
  if (env.GOLDBAND_DATA_DIR) return env.GOLDBAND_DATA_DIR;
  return path.join(os.homedir(), '.goldband');
}

function firstEnv(env, names) {
  for (const name of names) {
    const value = env[name];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function crossReviewDir(env = process.env) {
  if (env.GOLDBAND_CROSS_REVIEW_DIR) return env.GOLDBAND_CROSS_REVIEW_DIR;
  return path.join(stateRoot(env), 'cross-review');
}

function artifactsDir(env = process.env) {
  return path.join(crossReviewDir(env), 'artifacts');
}

function responsesDir(env = process.env) {
  return path.join(crossReviewDir(env), 'responses');
}

function summariesDir(env = process.env) {
  return path.join(crossReviewDir(env), 'summaries');
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
  return dirPath;
}

function safeSegment(value) {
  return String(value || '').replace(/[^A-Za-z0-9._-]/g, '_');
}

function sessionIdFromInput(input = {}, env = process.env) {
  return (
    input.session_id ||
    input.sessionId ||
    env.CLAUDE_SESSION_ID ||
    env.CODEX_SESSION_ID ||
    null
  );
}

function detectHost(env = process.env) {
  if (env.GOLDBAND_IMPLEMENTER) return normalizeHost(env.GOLDBAND_IMPLEMENTER);
  if (env.CODEX_SESSION_ID) return 'codex';
  if (env.CLAUDE_SESSION_ID) return 'claude';
  return 'claude';
}

function oppositeHost(host) {
  const normalized = normalizeHost(host);
  return normalized === 'claude' ? 'codex' : 'claude';
}

function normalizeHost(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!VALID_HOSTS.has(normalized)) {
    throw new Error(`expected host to be claude or codex, got: ${value}`);
  }
  return normalized;
}

function normalizeOptionalText(value) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function contractPath(sessionId, env = process.env) {
  return path.join(crossReviewDir(env), `${safeSegment(sessionId)}.json`);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, payload) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function readContract(sessionId, env = process.env) {
  if (!sessionId) return null;
  const filePath = contractPath(sessionId, env);
  if (!fs.existsSync(filePath)) return null;
  return readJson(filePath);
}

function writeContract(contract, env = process.env) {
  validateContract(contract);
  writeJson(contractPath(contract.sessionId, env), contract);
  return contract;
}

function usageTelemetryEnabled(env = process.env) {
  const flag = String(env.GOLDBAND_USAGE_TELEMETRY_ENABLED ?? '1').toLowerCase();
  return flag === '1' || flag === 'true' || flag === 'yes';
}

function usageFile(env = process.env) {
  return env.GOLDBAND_USAGE_FILE || path.join(crossReviewDir(env), 'usage-events.jsonl');
}

function appendCrossReviewUsageEvent(entry, env = process.env) {
  if (!usageTelemetryEnabled(env) || !entry || typeof entry !== 'object') return;
  normalizeUsageEvent ||= loadTelemetryNormalizer();
  if (!normalizeUsageEvent) return;
  const payload = normalizeUsageEvent({
    category: 'hook-decision',
    action: 'record',
    source: 'goldband-loop/cross-review',
    host: 'goldband',
    ...entry,
    recordedAt: nowIso(),
  });
  try {
    const filePath = usageFile(env);
    ensureDir(path.dirname(filePath));
    fs.appendFileSync(filePath, `${JSON.stringify(payload)}\n`, 'utf8');
  } catch {
    // Cross-review telemetry must never block the gate or orchestrator.
  }
}

function validateContract(contract) {
  if (!contract || typeof contract !== 'object') {
    throw new Error('cross-review contract must be an object');
  }
  if (contract.schemaVersion !== CONTRACT_SCHEMA_VERSION) {
    throw new Error(`unsupported cross-review schemaVersion: ${contract.schemaVersion}`);
  }
  if (!contract.sessionId) throw new Error('contract.sessionId is required');
  normalizeHost(contract.host);
  normalizeHost(contract.implementer);
  normalizeHost(contract.reviewer);
  if (contract.reviewer === contract.implementer) {
    throw new Error('cross-review requires reviewer != implementer');
  }
  if (
    contract.reviewerModel !== undefined &&
    contract.reviewerModel !== null &&
    typeof contract.reviewerModel !== 'string'
  ) {
    throw new Error('contract.reviewerModel must be a string when provided');
  }
  if (!VALID_STATUSES.has(contract.status)) {
    throw new Error(`invalid contract.status: ${contract.status}`);
  }
  if (!contract.baseCommit) throw new Error('contract.baseCommit is required');
  if (contract.reviewScope !== 'tracked-and-untracked-vs-base') {
    throw new Error(`unsupported reviewScope: ${contract.reviewScope}`);
  }
}

function createContract(options, env = process.env) {
  const sessionId = options.sessionId || firstEnv(env, ['CLAUDE_SESSION_ID', 'CODEX_SESSION_ID']);
  if (!sessionId) throw new Error('session id is required to arm cross-review');

  const implementer = normalizeHost(options.implementer || detectHost(env));
  const reviewer = normalizeHost(options.reviewer || oppositeHost(implementer));
  if (implementer === reviewer) {
    throw new Error('cross-review requires a different reviewer model family');
  }

  const armedAt = nowIso();
  const ttlHours = parsePositiveInt(options.ttlHours, DEFAULT_TTL_HOURS);
  const expiresAt = new Date(Date.parse(armedAt) + ttlHours * 60 * 60 * 1000).toISOString();
  const contract = {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    sessionId,
    host: implementer,
    implementer,
    reviewer,
    reviewerModel: normalizeOptionalText(options.reviewerModel),
    planFile: options.planFile || null,
    baseCommit: options.baseCommit || gitHead(options.cwd || process.cwd()),
    reviewScope: 'tracked-and-untracked-vs-base',
    maxRounds: parsePositiveInt(options.maxRounds, DEFAULT_MAX_ROUNDS),
    roundsUsed: 0,
    status: 'active',
    armedAt,
    expiresAt,
  };
  const written = writeContract(contract, env);
  appendCrossReviewUsageEvent(
    {
      name: 'cross-review-armed',
      action: 'enable',
      sessionId: written.sessionId,
      run_id: written.sessionId,
      detail: {
        implementer: written.implementer,
        reviewer: written.reviewer,
        reviewerModel: written.reviewerModel,
        planFile: written.planFile,
        maxRounds: written.maxRounds,
      },
    },
    env,
  );
  return written;
}

function gitHead(cwd) {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`failed to read git HEAD: ${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}

function gitDiffBytes(cwd, baseCommit) {
  const result = spawnSync(
    'git',
    ['-c', 'core.autocrlf=false', 'diff', '--no-ext-diff', '--binary', baseCommit],
    { cwd, encoding: 'buffer', maxBuffer: 100 * 1024 * 1024 },
  );
  if (result.status !== 0) {
    throw new Error(`failed to build cross-review diff: ${result.stderr.toString('utf8')}`);
  }
  return result.stdout;
}

function gitUntrackedFiles(cwd) {
  const result = spawnSync('git', ['ls-files', '--others', '--exclude-standard', '-z'], {
    cwd,
    encoding: 'buffer',
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`failed to list untracked files: ${result.stderr.toString('utf8')}`);
  }
  return result.stdout
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
    .sort();
}

function canonicalReviewBundle(cwd, baseCommit) {
  const diffBytes = normalizeGitDiff(gitDiffBytes(cwd, baseCommit));
  const chunks = [
    Buffer.from(`GOLDBAND-CROSS-REVIEW-BUNDLE v1\0base=${baseCommit}\0`, 'utf8'),
    Buffer.from('TRACKED-DIFF\0', 'utf8'),
    diffBytes,
    Buffer.from('\0UNTRACKED-FILES\0', 'utf8'),
  ];

  for (const relPath of gitUntrackedFiles(cwd)) {
    const absPath = path.resolve(cwd, relPath);
    if (!absPath.startsWith(path.resolve(cwd) + path.sep)) continue;
    const stats = fs.statSync(absPath);
    if (!stats.isFile()) continue;
    const bytes = stripMarkerBlocks(fs.readFileSync(absPath));
    const fileSha = crypto.createHash('sha256').update(bytes).digest('hex');
    chunks.push(Buffer.from(`UNTRACKED ${relPath}\0${fileSha}\0`, 'utf8'));
    chunks.push(bytes);
    chunks.push(Buffer.from('\0', 'utf8'));
  }

  return Buffer.concat(chunks);
}

function reviewScopePromptText(cwd, baseCommit) {
  const sections = [
    'GOLDBAND-CROSS-REVIEW-BUNDLE v1',
    `base=${baseCommit}`,
    '',
    '## Tracked Diff',
    normalizeGitDiff(gitDiffBytes(cwd, baseCommit)).toString('utf8') || '(empty)',
    '',
    '## Untracked Files',
  ];

  const untracked = gitUntrackedFiles(cwd);
  if (untracked.length === 0) sections.push('(none)');
  for (const relPath of untracked) {
    const absPath = path.resolve(cwd, relPath);
    if (!absPath.startsWith(path.resolve(cwd) + path.sep)) continue;
    const stats = fs.statSync(absPath);
    if (!stats.isFile()) continue;
    const bytes = stripMarkerBlocks(fs.readFileSync(absPath));
    const fileSha = crypto.createHash('sha256').update(bytes).digest('hex');
    sections.push(`### UNTRACKED ${relPath}`);
    sections.push(`sha256=${fileSha}`);
    sections.push(bytes.includes(0) ? bytes.toString('base64') : bytes.toString('utf8'));
  }

  return sections.join('\n');
}

function normalizeGitDiff(buffer) {
  if (buffer.includes(0)) return buffer;
  const text = buffer.toString('utf8');
  if (!looksLikeGitDiff(text)) return buffer;
  const withoutMarkers = text.includes(MARKER_PREFIX)
    ? stripMarkerBlocksFromGitDiff(text)
    : text;
  return Buffer.from(withoutMarkers.replace(/^@@ .* @@.*\r?\n/gm, ''), 'utf8');
}

function stripMarkerBlocks(buffer) {
  if (buffer.includes(0)) return buffer;
  const text = buffer.toString('utf8');
  if (!text.includes(MARKER_PREFIX)) return buffer;
  const stripped = looksLikeGitDiff(text)
    ? stripMarkerBlocksFromGitDiff(text)
    : stripPlainMarkerBlocks(text);
  return Buffer.from(stripped, 'utf8');
}

function stripPlainMarkerBlocks(text) {
  return text.replace(
    /((?:\r?\n){0,2})<!-- GOLDBAND-CROSS-REVIEW:[\s\S]*?-->\r?\n?/g,
    (match, leading) => {
      if (!leading) return '';
      if (match.includes('plan-eof-newline=false')) return '';
      return leading.includes('\n\n') || leading.includes('\r\n\r\n')
        ? leading.slice(0, leading.indexOf('\n') + 1)
        : leading;
    },
  );
}

function looksLikeGitDiff(text) {
  return /^diff --git /m.test(text);
}

function stripMarkerBlocksFromGitDiff(text) {
  return text
    .split(/(?=^diff --git )/m)
    .map(stripMarkerBlocksFromGitDiffBlock)
    .filter(Boolean)
    .join('');
}

function stripMarkerBlocksFromGitDiffBlock(block) {
  const stripped = block
    .replace(
      /^\+?\r?\n?\+<!-- GOLDBAND-CROSS-REVIEW:[\s\S]*?^\+.*?-->\r?\n?/gm,
      '',
    )
    .replace(/^@@ .* @@.*\r?\n/gm, '');

  if (!hasMeaningfulDiffLine(stripped)) return '';
  return stripped;
}

function hasMeaningfulDiffLine(diffBlock) {
  return diffBlock
    .split(/\r?\n/)
    .some((line) => /^[+-]/.test(line) && !/^(?:---|\+\+\+)/.test(line));
}

function reviewedSha(cwd, baseCommit) {
  return crypto
    .createHash('sha256')
    .update(canonicalReviewBundle(cwd, baseCommit))
    .digest('hex');
}

function parseMarker(planText) {
  const markerPattern =
    /<!--\s*GOLDBAND-CROSS-REVIEW:\s+APPROVED\s+([\s\S]*?)-->/g;
  let match = markerPattern.exec(planText);
  let last = null;
  while (match) {
    last = match[1];
    match = markerPattern.exec(planText);
  }
  if (!last) return null;

  const fields = {};
  const keyValuePattern = /([A-Za-z][A-Za-z0-9-]*)=([^\s]+)/g;
  let pair = keyValuePattern.exec(last);
  while (pair) {
    fields[pair[1]] = pair[2];
    pair = keyValuePattern.exec(last);
  }
  return {
    verdict: 'APPROVED',
    reviewer: fields.reviewer || null,
    implementer: fields.implementer || null,
    reviewedSha: fields['reviewed-sha'] || null,
    rounds: parsePositiveInt(fields.rounds, 0),
    artifact: fields.artifact || null,
    at: fields.at || null,
    session: fields.session || null,
  };
}

function markerText({ artifact, contract, planHadTrailingNewline = true }) {
  return [
    `<!-- ${MARKER_PREFIX}: APPROVED reviewer=${artifact.reviewer} implementer=${artifact.implementer}`,
    `     reviewed-sha=${artifact.reviewedSha} rounds=${artifact.round}`,
    `     artifact=${artifact.artifactId} at=${artifact.createdAt} session=${contract.sessionId}`,
    `     plan-eof-newline=${planHadTrailingNewline ? 'true' : 'false'} -->`,
  ].join('\n');
}

function appendApprovalMarker(planFile, artifact, contract, cwd = process.cwd()) {
  const target = resolvePlanFile(planFile, cwd);
  const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
  const planHadTrailingNewline = current.endsWith('\n');
  const separator = current.length === 0 || planHadTrailingNewline ? '' : '\n';
  fs.writeFileSync(
    target,
    `${current}${separator}${markerText({ artifact, contract, planHadTrailingNewline })}\n`,
    'utf8',
  );
}

function resolvePlanFile(planFile, cwd) {
  if (!planFile) return null;
  return path.isAbsolute(planFile) ? planFile : path.resolve(cwd, planFile);
}

function artifactPath(artifactId, env = process.env) {
  return path.join(artifactsDir(env), `${safeSegment(artifactId)}.json`);
}

function rawOutputPath(artifactId, env = process.env) {
  return path.join(artifactsDir(env), `${safeSegment(artifactId)}.raw.txt`);
}

function escalationSummaryPath(sessionId, round, env = process.env) {
  return path.join(
    summariesDir(env),
    `${safeSegment(sessionId)}-round-${round}-escalation.md`,
  );
}

function shellQuote(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_./:=@%+-]+$/.test(text)) return text;
  return `'${text.replace(/'/g, "'\\''")}'`;
}

function crossReviewCommand(args = '') {
  const wrapperPath = path.resolve(__dirname, '..', 'bin', 'goldband-cross-review');
  const executable = fs.existsSync(wrapperPath)
    ? shellQuote(wrapperPath)
    : 'goldband-cross-review';
  return [executable, args].filter(Boolean).join(' ');
}

function writeArtifact(artifact, rawOutput, env = process.env) {
  ensureDir(artifactsDir(env));
  if (rawOutput !== undefined) {
    fs.writeFileSync(rawOutputPath(artifact.artifactId, env), String(rawOutput), 'utf8');
  }
  writeJson(artifactPath(artifact.artifactId, env), artifact);
  return artifact;
}

function writeEscalationSummary(contract, artifact, env = process.env) {
  ensureDir(summariesDir(env));
  const history = readArtifactHistory(contract.sessionId, env);
  const responses = readResponses(contract.sessionId, env);
  const summaryPath = escalationSummaryPath(
    contract.sessionId,
    artifact.round,
    env,
  );
  const openFindings = (artifact.findings || []).filter(
    (finding) => finding.status === 'open',
  );
  const lines = [
    '# Cross-Review Escalation Summary',
    '',
    `- sessionId: ${contract.sessionId}`,
    `- implementer: ${contract.implementer}`,
    `- reviewer: ${contract.reviewer}`,
    `- baseCommit: ${contract.baseCommit}`,
    `- reviewedSha: ${artifact.reviewedSha}`,
    `- round: ${artifact.round}`,
    `- verdict: ${artifact.verdict}`,
    `- maxRounds: ${contract.maxRounds}`,
    `- artifact: ${artifact.artifactId}`,
    '',
    '## Open Findings',
    openFindings.length ? JSON.stringify(openFindings, null, 2) : '[]',
    '',
    '## Implementer Responses',
    responses.length ? JSON.stringify(responses, null, 2) : '[]',
    '',
    '## Artifact History',
    history.length ? JSON.stringify(history, null, 2) : '[]',
    '',
  ];
  fs.writeFileSync(summaryPath, lines.join('\n'), 'utf8');
  return summaryPath;
}

function readArtifact(artifactId, env = process.env) {
  const filePath = artifactPath(artifactId, env);
  if (!fs.existsSync(filePath)) return null;
  return readJson(filePath);
}

function evaluateCrossReviewGate(input = {}, options = {}) {
  const env = options.env || process.env;
  const cwd = options.cwd || process.cwd();
  const sessionId = sessionIdFromInput(input, env);
  const contract = readContract(sessionId, env);
  if (!contract) return allow();

  if (contract.status === 'overridden') return allow();
  if (contract.status !== 'active') return allow();
  if (isExpired(contract)) {
    writeContract({ ...contract, status: 'expired' }, env);
    return allow();
  }
  if (input.stop_hook_active) return allow();
  if (!contract.planFile) {
    return block(
      'cross-review-plan-missing',
      `本工作已啟用 cross-review gate，但尚未綁定 plan 檔。請執行 \`${crossReviewCommand('start --plan <path>')}\` 後再收工。`,
    );
  }

  const planPath = resolvePlanFile(contract.planFile, cwd);
  if (!planPath || !fs.existsSync(planPath)) {
    return block('cross-review-plan-not-found', `交互審查 plan 檔不存在: ${contract.planFile}`);
  }

  const marker = parseMarker(fs.readFileSync(planPath, 'utf8'));
  if (!marker) {
    return blockOrEscalate(
      contract,
      `本工作在交互審查閘門下，請執行 \`${crossReviewCommand('run')}\`，由 ${contract.reviewer} 審查後才能收工。`,
    );
  }

  const artifact = marker.artifact ? readArtifact(marker.artifact, env) : null;
  if (!artifact) {
    return block(
      'cross-review-artifact-missing',
      `交互審查 marker 存在，但找不到對應 reviewer artifact。請重新執行 \`${crossReviewCommand('run')}\`。`,
    );
  }

  const artifactError = validateApprovalArtifact({ artifact, marker, contract });
  if (artifactError) return block('cross-review-artifact-invalid', artifactError);

  const currentSha = reviewedSha(cwd, contract.baseCommit);
  if (currentSha !== artifact.reviewedSha) {
    return block('cross-review-sha-mismatch', `交互審查通過後內容又變動，需重審。approved-sha=${artifact.reviewedSha} now-sha=${currentSha}`);
  }

  writeContract({ ...contract, status: 'passed' }, env);
  return allow();
}

function isExpired(contract) {
  const expiresMs = Date.parse(contract.expiresAt || '');
  return Number.isFinite(expiresMs) && Date.now() > expiresMs;
}

function blockOrEscalate(contract, message) {
  if (Number(contract.roundsUsed || 0) >= Number(contract.maxRounds || DEFAULT_MAX_ROUNDS)) {
    const summaryText = contract.escalationSummaryPath
      ? ` 摘要: ${contract.escalationSummaryPath}`
      : '';
    return block(
      'cross-review-human-escalation',
      `交互審查已達回合上限，請人類仲裁或執行 \`${crossReviewCommand('override --reason <reason>')}\`。${summaryText}`,
    );
  }
  return block('cross-review-required', message);
}

function validateApprovalArtifact({ artifact, marker, contract }) {
  if (artifact.verdict !== 'APPROVED') return 'reviewer artifact verdict 不是 APPROVED。';
  if (artifact.reviewMode !== 'real') return 'reviewer artifact 不是 real review mode。';
  if (artifact.sessionId !== contract.sessionId) return 'reviewer artifact sessionId 與契約不一致。';
  if (artifact.baseCommit !== contract.baseCommit) return 'reviewer artifact baseCommit 與契約不一致。';
  if (artifact.reviewer !== contract.reviewer) return 'reviewer artifact reviewer 與契約不一致。';
  if (artifact.implementer !== contract.implementer) return 'reviewer artifact implementer 與契約不一致。';
  if (artifact.reviewer === artifact.implementer) return 'reviewer artifact 顯示 reviewer 與 implementer 相同，交互審查無效。';
  if (marker.session !== contract.sessionId) return 'plan marker session 與契約不一致。';
  if (marker.artifact !== artifact.artifactId) return 'plan marker artifact 與 reviewer artifact 不一致。';
  if (marker.reviewedSha !== artifact.reviewedSha) return 'plan marker reviewed-sha 與 reviewer artifact 不一致。';
  return null;
}

function allow(logs = []) {
  return { decision: 'allow', blockedBy: null, logs, outputJson: null, usageEvents: [] };
}

function block(blockedBy, message) {
  return {
    decision: 'block',
    blockedBy,
    logs: [`[goldband] ${message}`],
    outputJson: null,
    usageEvents: [
      {
        category: 'hook-decision',
        name: blockedBy,
        action: 'block',
        source: 'cross-review-gate',
        detail: { message },
      },
    ],
  };
}

function buildPrompt({ contract, rubric, sharedRubric, sharedFindingShape, reviewerPrompt, diffText, planText, history, responses }) {
  return [
    reviewerPrompt,
    '',
    '## Shared Review Standard',
    sharedRubric,
    '',
    '## Shared Finding Shape',
    sharedFindingShape,
    '',
    '## Rubric',
    rubric,
    '',
    '## Contract',
    JSON.stringify(contract, null, 2),
    '',
    '## Plan',
    planText || '(no plan text)',
    '',
    '## Previous Findings',
    history.length ? JSON.stringify(history, null, 2) : '[]',
    '',
    '## Implementer Responses',
    responses.length ? JSON.stringify(responses, null, 2) : '[]',
    '',
    '## Review Scope Bundle',
    diffText || '(empty diff)',
  ].join('\n');
}

function normalizeFinding(finding, index, round) {
  const severity = String(finding.severity || 'LOW').toUpperCase();
  const hasBlockingFields = finding.ruleId && finding.failureScenario;
  const blocking = ['CRITICAL', 'HIGH'].includes(severity) && hasBlockingFields;
  return {
    id: finding.id || `CR-${String(index + 1).padStart(3, '0')}`,
    severity: blocking ? severity : severity === 'CRITICAL' || severity === 'HIGH' ? 'MEDIUM' : severity,
    ruleId: finding.ruleId || null,
    file: finding.file || null,
    line: finding.line || null,
    failureScenario: finding.failureScenario || null,
    status: finding.status || 'open',
    round,
  };
}

function normalizeReviewResult(result, round, history = []) {
  const verdict = String(result.verdict || '').toUpperCase();
  if (!VERDICTS.has(verdict)) throw new Error(`invalid reviewer verdict: ${result.verdict}`);
  const findings = Array.isArray(result.findings)
    ? result.findings.map((finding, index) => normalizeFinding(finding, index, round))
    : [];
  const boundedFindings = applyRebuttalBoundary(findings, history, round);
  const blockingCount = boundedFindings.filter((finding) => isBlockingFinding(finding)).length;
  const finalVerdict = verdict === 'APPROVED' && blockingCount > 0 ? 'ESCALATE' : verdict;
  return { verdict: finalVerdict, findings: boundedFindings, blockingCount };
}

function isBlockingFinding(finding) {
  return (
    finding.status === 'open' &&
    ['CRITICAL', 'HIGH'].includes(finding.severity) &&
    finding.ruleId &&
    finding.failureScenario
  );
}

function applyRebuttalBoundary(findings, history, round) {
  if (round <= 1) return findings;

  const acceptedRebuttals = new Set(
    history
      .flatMap((artifact) => artifact.findings || [])
      .filter((finding) => finding.status === 'rebutted-accepted')
      .map((finding) => finding.id),
  );

  return findings.map((finding) => {
    if (acceptedRebuttals.has(finding.id)) {
      return downgradeFinding(finding, 'Accepted rebuttals cannot be reopened.');
    }
    return finding;
  });
}

function downgradeFinding(finding, note) {
  return {
    ...finding,
    severity: 'MEDIUM',
    downgradeReason: note,
  };
}

function runMockReviewer(verdict, round) {
  if (verdict === 'CHANGES_REQUESTED') {
    return {
      rawOutput: `GOLDBAND-CROSS-REVIEW-VERDICT: CHANGES_REQUESTED reviewer=mock round=${round}`,
      parsed: {
        verdict: 'CHANGES_REQUESTED',
        findings: [
          {
            id: 'CR-001',
            severity: 'HIGH',
            ruleId: 'correctness.contract',
            file: 'mock.txt',
            line: 1,
            failureScenario: 'Mock reviewer requested a blocking change.',
            status: 'open',
          },
        ],
      },
      command: 'mock-reviewer',
      exitCode: 0,
    };
  }
  return {
    rawOutput: `GOLDBAND-CROSS-REVIEW-VERDICT: ${verdict} reviewer=mock round=${round}`,
    parsed: { verdict, findings: [] },
    command: 'mock-reviewer',
    exitCode: 0,
  };
}

function runCliReviewer(reviewer, prompt, cwd = process.cwd(), env = process.env, model = null) {
  const command = reviewer === 'claude' ? 'claude' : 'codex';
  const args =
    reviewer === 'claude'
      ? [
          '-p',
          ...(model ? ['--model', model] : []),
          '--output-format',
          'text',
          '--no-session-persistence',
        ]
      : [
          'exec',
          '--ephemeral',
          '--sandbox',
          'read-only',
          '--skip-git-repo-check',
          ...(model ? ['--model', model] : []),
          '-',
        ];
  const result = spawnSync(command, args, {
    cwd,
    input: prompt,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    env,
  });
  const rawOutput = [result.stdout, result.stderr].filter(Boolean).join('\n');
  const commandLabel = `${command} ${args.join(' ')}`;
  let parsed;
  try {
    parsed = parseReviewerOutput(rawOutput);
  } catch (error) {
    parsed = {
      verdict: 'ESCALATE',
      findings: [
        {
          id: 'CR-REVIEWER-PARSE',
          severity: 'HIGH',
          ruleId: 'verification.false-claim',
          failureScenario:
            error && error.message
              ? error.message
              : 'Reviewer output did not include a parseable verdict.',
          status: 'open',
        },
      ],
    };
  }
  return {
    rawOutput,
    parsed,
    command: commandLabel,
    exitCode: typeof result.status === 'number' ? result.status : 1,
  };
}

function parseReviewerOutput(output) {
  const marker = String(output || '').match(/GOLDBAND-CROSS-REVIEW-VERDICT:\s+(APPROVED|CHANGES_REQUESTED|ESCALATE)/);
  if (!marker) throw new Error('reviewer output did not include a parseable cross-review verdict');
  const jsonMatch = String(output || '').match(/GOLDBAND-CROSS-REVIEW-FINDINGS:\s*(\[[\s\S]*?\])\s*(?:\n|$)/);
  if (!jsonMatch && marker[1] !== 'APPROVED') {
    throw new Error('reviewer requested changes or escalation without a parseable findings line');
  }
  return {
    verdict: marker[1],
    findings: jsonMatch ? JSON.parse(jsonMatch[1]) : [],
  };
}

function runReviewRound(options, env = process.env) {
  const cwd = options.cwd || process.cwd();
  const sessionId = options.sessionId || firstEnv(env, ['CLAUDE_SESSION_ID', 'CODEX_SESSION_ID']);
  const contract = readContract(sessionId, env);
  if (!contract) throw new Error('no active cross-review contract found');
  if (contract.status !== 'active') throw new Error(`contract is not active: ${contract.status}`);
  if (!contract.planFile) throw new Error('contract.planFile is required before running review');
  if (contract.reviewer === contract.implementer) throw new Error('reviewer must differ from implementer');

  const currentSha = reviewedSha(cwd, contract.baseCommit);
  const round = Number(contract.roundsUsed || 0) + 1;
  const reviewMode = options.reviewMode || 'real';
  if (!['real', 'mock'].includes(reviewMode)) {
    throw new Error(`invalid reviewMode: ${reviewMode}`);
  }
  const reviewerModel = normalizeOptionalText(options.model) || contract.reviewerModel;
  const reviewerResult =
    reviewMode === 'real'
      ? runCliReviewer(
          contract.reviewer,
          buildReviewerPrompt(contract, cwd, env),
          cwd,
          env,
          reviewerModel,
        )
      : runMockReviewer(options.mockVerdict || 'APPROVED', round);
  if (reviewerResult.exitCode !== 0) {
    reviewerResult.parsed = {
      verdict: 'ESCALATE',
      findings: [
        {
          id: 'CR-REVIEWER-EXIT',
          severity: 'HIGH',
          ruleId: 'verification.false-claim',
          failureScenario: `Reviewer command exited with status ${reviewerResult.exitCode}.`,
          status: 'open',
        },
      ],
    };
  }
  const history = readArtifactHistory(contract.sessionId, env);
  const normalized = normalizeReviewResult(reviewerResult.parsed, round, history);
  const artifactId = `cr-${safeSegment(contract.sessionId)}-${round}-${Date.now()}`;
  const artifact = {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    artifactId,
    sessionId: contract.sessionId,
    reviewer: contract.reviewer,
    implementer: contract.implementer,
    baseCommit: contract.baseCommit,
    reviewedSha: currentSha,
    round,
    verdict: normalized.verdict,
    reviewMode,
    reviewerModel,
    findings: normalized.findings,
    reviewerCommand: reviewerResult.command,
    reviewerExitCode: reviewerResult.exitCode,
    rawOutputPath: rawOutputPath(artifactId, env),
    createdAt: nowIso(),
  };
  writeArtifact(artifact, reviewerResult.rawOutput, env);

  const updatedContract = { ...contract, roundsUsed: round };
  appendCrossReviewUsageEvent(
    {
      name: 'cross-review-round',
      sessionId: contract.sessionId,
      run_id: contract.sessionId,
      detail: {
        round,
        verdict: normalized.verdict,
        blockingCount: normalized.blockingCount,
        advisoryCount: normalized.findings.length - normalized.blockingCount,
        reviewMode,
        reviewer: contract.reviewer,
        implementer: contract.implementer,
        reviewerModel,
        artifactId,
      },
    },
    env,
  );

  if (normalized.verdict === 'APPROVED') {
    appendApprovalMarker(contract.planFile, artifact, contract, cwd);
    writeContract(updatedContract, env);
  } else {
    if (
      normalized.verdict === 'ESCALATE' ||
      round >= Number(contract.maxRounds || DEFAULT_MAX_ROUNDS)
    ) {
      updatedContract.escalationSummaryPath = writeEscalationSummary(
        updatedContract,
        artifact,
        env,
      );
      appendCrossReviewUsageEvent(
        {
          name: 'cross-review-escalation',
          action: 'block',
          sessionId: contract.sessionId,
          run_id: contract.sessionId,
          detail: {
            round,
            verdict: normalized.verdict,
            maxRounds: contract.maxRounds,
            summaryPath: updatedContract.escalationSummaryPath,
            artifactId,
          },
        },
        env,
      );
    }
    writeContract(updatedContract, env);
  }

  return { contract: readContract(contract.sessionId, env), artifact };
}

function buildReviewerPrompt(contract, cwd, env) {
  const runtimeDir = __dirname;
  const reviewerPrompt = fs.readFileSync(path.join(runtimeDir, 'reviewer-prompt.md'), 'utf8');
  const rubric = fs.readFileSync(path.join(runtimeDir, 'rubric.md'), 'utf8');
  const sharedRubric = fs.readFileSync(path.join(runtimeDir, '..', 'review', 'shared-rubric.md'), 'utf8');
  const sharedFindingShape = fs.readFileSync(path.join(runtimeDir, '..', 'review', 'findings-schema.md'), 'utf8');
  const planPath = resolvePlanFile(contract.planFile, cwd);
  const planText = planPath && fs.existsSync(planPath) ? fs.readFileSync(planPath, 'utf8') : '';
  const history = readArtifactHistory(contract.sessionId, env);
  const responses = readResponses(contract.sessionId, env);
  return buildPrompt({
    contract,
    rubric,
    sharedRubric,
    sharedFindingShape,
    reviewerPrompt,
    diffText: reviewScopePromptText(cwd, contract.baseCommit),
    planText,
    history,
    responses,
  });
}

function readArtifactHistory(sessionId, env = process.env) {
  if (!fs.existsSync(artifactsDir(env))) return [];
  return fs
    .readdirSync(artifactsDir(env))
    .filter((entry) => entry.endsWith('.json'))
    .map((entry) => {
      try {
        return readJson(path.join(artifactsDir(env), entry));
      } catch {
        return null;
      }
    })
    .filter((entry) => entry && entry.sessionId === sessionId)
    .sort((a, b) => Number(a.round || 0) - Number(b.round || 0));
}

function readResponses(sessionId, env = process.env) {
  const filePath = path.join(responsesDir(env), `${safeSegment(sessionId)}.jsonl`);
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

function appendResponse(sessionId, response, env = process.env) {
  ensureDir(responsesDir(env));
  const payload = {
    findingId: response.findingId,
    response: response.response,
    summary: response.summary,
    evidence: response.evidence || [],
    recordedAt: nowIso(),
  };
  fs.appendFileSync(
    path.join(responsesDir(env), `${safeSegment(sessionId)}.jsonl`),
    `${JSON.stringify(payload)}\n`,
    'utf8',
  );
  appendCrossReviewUsageEvent(
    {
      name: 'cross-review-response',
      sessionId,
      run_id: sessionId,
      detail: {
        findingId: payload.findingId,
        response: payload.response,
        evidenceCount: payload.evidence.length,
      },
    },
    env,
  );
  return payload;
}

function tokenizeRequestText(text) {
  const tokens = [];
  let token = '';
  let quote = null;
  let escaped = false;
  for (const char of String(text || '')) {
    if (escaped) {
      token += char;
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        token += char;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (token) {
        tokens.push(token);
        token = '';
      }
      continue;
    }
    token += char;
  }
  if (token) tokens.push(token);
  return tokens;
}

function optionValue(tokens, index, key) {
  const token = tokens[index];
  if (token === `--${key}`) return tokens[index + 1] || null;
  if (token.startsWith(`--${key}=`)) return token.slice(key.length + 3) || null;
  return null;
}

function parseCrossReviewArgs(tokens, options = {}) {
  const allowPositionalPlan = Boolean(options.allowPositionalPlan);
  const parsed = { planFile: null, reviewer: null, reviewerModel: null };
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const plan = optionValue(tokens, index, 'plan');
    if (plan) {
      parsed.planFile = plan;
      if (token === '--plan') index += 1;
      continue;
    }
    const reviewer = optionValue(tokens, index, 'reviewer');
    if (reviewer) {
      parsed.reviewer = normalizeHost(reviewer);
      if (token === '--reviewer') index += 1;
      continue;
    }
    const model = optionValue(tokens, index, 'model');
    if (model) {
      parsed.reviewerModel = model;
      if (token === '--model') index += 1;
      continue;
    }
    if (VALID_HOSTS.has(token.toLowerCase()) && !parsed.reviewer) {
      parsed.reviewer = normalizeHost(token);
      continue;
    }
    if (allowPositionalPlan && !token.startsWith('-') && !parsed.planFile) {
      parsed.planFile = token;
    }
  }
  return parsed;
}

function parseCrossReviewRequest(prompt) {
  const commandMatch = matchCrossReviewCommand(prompt);
  if (!commandMatch) {
    return {
      requested: false,
      source: null,
      planFile: null,
      reviewer: null,
      reviewerModel: null,
    };
  }
  const tail = commandMatch.text
    .slice(commandMatch.index + commandMatch.length)
    .trim();
  return {
    requested: true,
    source: 'command',
    ...parseCrossReviewArgs(tokenizeRequestText(tail), { allowPositionalPlan: true }),
  };
}

function armFromPrompt(input = {}, options = {}) {
  const prompt = String(input.prompt || '');
  const request = parseCrossReviewRequest(prompt);
  if (!request.requested) return null;
  const env = options.env || process.env;
  const implementer = options.implementer || detectHost(env);
  const sessionId = sessionIdFromInput(input, env);
  const existing = readContract(sessionId, env);
  const inferredPlan = request.planFile;
  const reviewer = request.reviewer || oppositeHost(implementer);
  const reviewerModel = normalizeOptionalText(request.reviewerModel);
  if (existing && existing.status === 'active') {
    const updates = {};
    if (!existing.planFile && !inferredPlan) {
      throw new Error('missing implementation plan path for /goldband-cross-review');
    }
    if (!existing.planFile && inferredPlan) updates.planFile = inferredPlan;
    if (!existing.reviewerModel && reviewerModel) updates.reviewerModel = reviewerModel;
    if (Object.keys(updates).length > 0) {
      return writeContract({ ...existing, ...updates }, env);
    }
    return existing;
  }
  if (!inferredPlan) {
    throw new Error('missing implementation plan path for /goldband-cross-review');
  }
  const contract = createContract(
    {
      sessionId,
      implementer,
      reviewer,
      reviewerModel,
      planFile: inferredPlan,
      cwd: options.cwd || process.cwd(),
    },
    env,
  );
  return contract;
}

function overrideContract(sessionId, reason, env = process.env) {
  const contract = readContract(sessionId, env);
  if (!contract) throw new Error('no cross-review contract found');
  const written = writeContract(
    {
      ...contract,
      status: 'overridden',
      overrideReason: reason || 'manual override',
      overriddenAt: nowIso(),
    },
    env,
  );
  appendCrossReviewUsageEvent(
    {
      name: 'cross-review-override',
      sessionId,
      run_id: sessionId,
      detail: {
        reason: written.overrideReason,
        roundsUsed: written.roundsUsed,
      },
    },
    env,
  );
  return written;
}

function markDone(sessionId, cwd = process.cwd(), env = process.env) {
  const result = evaluateCrossReviewGate({ hook_event_name: 'Stop', session_id: sessionId }, { cwd, env });
  if (result.decision === 'block') {
    throw new Error(result.logs.join('\n'));
  }
  const contract = readContract(sessionId, env);
  appendCrossReviewUsageEvent(
    {
      name: 'cross-review-done',
      sessionId,
      run_id: sessionId,
      detail: {
        status: contract ? contract.status : 'not-armed',
        roundsUsed: contract ? contract.roundsUsed : null,
      },
    },
    env,
  );
  return contract;
}

module.exports = {
  appendResponse,
  armFromPrompt,
  contractPath,
  createContract,
  crossReviewDir,
  evaluateCrossReviewGate,
  markDone,
  buildReviewerPrompt,
  normalizeReviewResult,
  parseCrossReviewRequest,
  promptRequestsCrossReview,
  readContract,
  reviewedSha,
  runReviewRound,
  writeArtifact,
  writeContract,
  overrideContract,
};
