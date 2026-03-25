#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

function resolveHookModule(relativePath) {
  const candidate = path.resolve(__dirname, '../../../../hooks/scripts/lib/hook-router', relativePath);
  if (!fs.existsSync(candidate)) {
    return null;
  }

  try {
    return require(candidate);
  } catch {
    return null;
  }
}

const usageTelemetry = resolveHookModule('usage-telemetry.js');

function parseArgs(argv) {
  return {
    json: argv.includes('--json'),
    routerReplay: argv.includes('--router-replay')
  };
}

function findFilesRecursive(rootDir, matcher) {
  if (!fs.existsSync(rootDir)) return [];

  const results = [];
  const stack = [rootDir];

  while (stack.length > 0) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }

      if (matcher(fullPath)) {
        results.push(fullPath);
      }
    }
  }

  results.sort();
  return results;
}

function resolveHistoryDir() {
  const pluginDataDir = typeof process.env.CLAUDE_PLUGIN_DATA === 'string'
    ? process.env.CLAUDE_PLUGIN_DATA.trim()
    : '';

  if (pluginDataDir.length > 0) {
    return {
      source: 'CLAUDE_PLUGIN_DATA',
      dir: path.join(pluginDataDir, 'claude-config-verification')
    };
  }

  return {
    source: 'temp-fallback',
    dir: path.join(os.tmpdir(), 'claude-config-verification')
  };
}

function appendHistory(summary) {
  try {
    const resolved = resolveHistoryDir();
    fs.mkdirSync(resolved.dir, { recursive: true });
    const historyFile = path.join(resolved.dir, 'history.jsonl');
    const entry = {
      ...summary,
      historySource: resolved.source,
      recordedAt: new Date().toISOString()
    };
    fs.appendFileSync(historyFile, JSON.stringify(entry) + '\n', 'utf8');
  } catch {
    // Best-effort only.
  }
}

function validateJsonFile(rootDir, relativePath) {
  const filePath = path.join(rootDir, relativePath);
  if (!fs.existsSync(filePath)) {
    return { file: relativePath, ok: false, message: 'missing' };
  }

  try {
    JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return { file: relativePath, ok: true, message: 'valid' };
  } catch (error) {
    return {
      file: relativePath,
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    };
  }
}

function validateTomlFile(rootDir, relativePath) {
  const filePath = path.join(rootDir, relativePath);
  if (!fs.existsSync(filePath)) {
    return { file: relativePath, ok: false, message: 'missing' };
  }

  const result = spawnSync('python3', [
    '-c',
    'import sys, tomllib; tomllib.load(open(sys.argv[1], "rb")); print("OK")',
    filePath
  ], {
    cwd: rootDir,
    encoding: 'utf8',
    maxBuffer: 2 * 1024 * 1024
  });

  if (result.error) {
    return {
      file: relativePath,
      ok: false,
      message: result.error.message
    };
  }

  if (result.status !== 0) {
    return {
      file: relativePath,
      ok: false,
      message: (result.stderr || result.stdout || 'invalid TOML').trim()
    };
  }

  return { file: relativePath, ok: true, message: 'valid' };
}

function validateRequiredFile(rootDir, relativePath) {
  const filePath = path.join(rootDir, relativePath);
  if (!fs.existsSync(filePath)) {
    return { file: relativePath, ok: false, message: 'missing' };
  }

  const raw = fs.readFileSync(filePath, 'utf8').trim();
  if (raw.length === 0) {
    return { file: relativePath, ok: false, message: 'empty' };
  }

  return { file: relativePath, ok: true, message: 'present' };
}

function checkSkillFrontmatter(skillPath) {
  const relativePath = path.relative(process.cwd(), skillPath);
  const raw = fs.readFileSync(skillPath, 'utf8');
  const lines = raw.split('\n');
  const warnings = [];
  const errors = [];

  if (lines[0] !== '---') {
    errors.push('missing YAML frontmatter start');
  }

  const frontmatterEnd = lines.indexOf('---', 1);
  if (frontmatterEnd === -1) {
    errors.push('missing YAML frontmatter end');
  }

  const frontmatterText = frontmatterEnd > 0 ? lines.slice(1, frontmatterEnd).join('\n') : '';
  if (!/^name:/m.test(frontmatterText)) {
    errors.push('missing name field');
  }
  if (!/^description:/m.test(frontmatterText)) {
    errors.push('missing description field');
  }
  if (lines.length > 500) {
    warnings.push(`over 500 lines (${lines.length})`);
  }

  return {
    file: relativePath,
    ok: errors.length === 0,
    warnings,
    errors,
    lineCount: lines.length
  };
}

function checkReferenceLinks(skillPath) {
  const relativePath = path.relative(process.cwd(), skillPath);
  const raw = fs.readFileSync(skillPath, 'utf8');
  const matches = raw.match(/references?\/[a-zA-Z0-9._/-]+\.md/g) || [];
  const uniqueMatches = [...new Set(matches)];
  const missing = uniqueMatches.filter(ref => !fs.existsSync(path.join(path.dirname(skillPath), ref)));

  return {
    file: relativePath,
    ok: missing.length === 0,
    checked: uniqueMatches.length,
    missing
  };
}

function checkHookReferences(rootDir) {
  const hooksPath = path.join(rootDir, 'hooks', 'hooks.json');
  if (!fs.existsSync(hooksPath)) {
    return { ok: false, errors: ['hooks/hooks.json missing'], checked: 0 };
  }

  const parsed = JSON.parse(fs.readFileSync(hooksPath, 'utf8'));
  const hooks = parsed.hooks || {};
  const errors = [];
  let checked = 0;

  for (const entries of Object.values(hooks)) {
    if (!Array.isArray(entries)) continue;

    for (const entry of entries) {
      const hookList = Array.isArray(entry.hooks) ? entry.hooks : [];
      for (const hook of hookList) {
        const command = typeof hook.command === 'string' ? hook.command : '';
        const match = command.match(/node\s+"([^"]+)"/);
        if (!match) continue;

        checked += 1;
        const scriptPath = match[1].replace('${HOOKS_DIR}', 'hooks');
        const resolvedPath = path.join(rootDir, scriptPath);
        if (!fs.existsSync(resolvedPath)) {
          errors.push(`${scriptPath} not found`);
        }
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    checked
  };
}

function readProfileFile(profilePath) {
  if (!fs.existsSync(profilePath)) return null;
  const raw = fs.readFileSync(profilePath, 'utf8');
  const fields = {};
  for (const line of raw.split('\n')) {
    const idx = line.indexOf('=');
    if (idx === -1) continue;
    fields[line.slice(0, idx)] = line.slice(idx + 1);
  }
  return fields;
}

function readWorkflowVersion(runtimeDir) {
  for (const filename of ['VERSION', '.installed-version']) {
    const versionPath = path.join(runtimeDir, filename);
    if (fs.existsSync(versionPath)) {
      return fs.readFileSync(versionPath, 'utf8').trim() || 'unknown';
    }
  }

  return 'unknown';
}

function checkWorkflowInstall(homeDir) {
  const claudeDir = path.join(homeDir, '.claude', 'skills', 'workflow');
  const codexDir = path.join(homeDir, '.codex', 'skills', 'workflow');
  const stateDir = path.join(homeDir, '.workflow');
  const result = {
    claudeInstalled: false,
    claudeVersion: null,
    claudeChecks: [],
    codexInstalled: false,
    codexVersion: null,
    codexChecks: [],
    stateInstalled: false,
    stateChecks: [],
    warnings: []
  };

  if (fs.existsSync(claudeDir)) {
    result.claudeInstalled = true;
    result.claudeVersion = readWorkflowVersion(claudeDir);

    const claudeRequired = [
      'setup',
      path.join('bin', 'workflow-repo-mode'),
      path.join('careful', 'SKILL.md'),
      path.join('freeze', 'SKILL.md'),
      path.join('review', 'SKILL.md'),
      path.join('qa', 'SKILL.md')
    ];
    result.claudeChecks = claudeRequired.map(relativePath => ({
      file: relativePath,
      ok: fs.existsSync(path.join(claudeDir, relativePath))
    }));
  }

  if (fs.existsSync(codexDir)) {
    result.codexInstalled = true;
    result.codexVersion = readWorkflowVersion(codexDir);

    const codexRequired = [
      path.join('bin', 'workflow-config'),
      path.join('review', 'checklist.md')
    ];
    result.codexChecks.push(...codexRequired.map(relativePath => ({
      file: relativePath,
      ok: fs.existsSync(path.join(codexDir, relativePath))
    })));

    const codexSkillsRoot = path.join(homeDir, '.codex', 'skills');
    const generatedSkills = fs.existsSync(codexSkillsRoot)
      ? fs.readdirSync(codexSkillsRoot).filter(name => /^goldband-/.test(name))
      : [];
    result.codexChecks.push({
      file: '~/.codex/skills/goldband-*',
      ok: generatedSkills.length > 0,
      detail: `${generatedSkills.length} generated skills`
    });
  }

  if (fs.existsSync(stateDir)) {
    result.stateInstalled = true;
    const stateRequired = [
      'projects'
    ];
    result.stateChecks = stateRequired.map(relativePath => ({
      file: relativePath,
      ok: fs.existsSync(path.join(stateDir, relativePath))
    }));
  }

  const goldbandClaudeProfile = readProfileFile(path.join(homeDir, '.claude', 'skills', '.goldband-profile'));
  if (result.claudeInstalled && goldbandClaudeProfile) {
    const installedSkills = String(goldbandClaudeProfile.skills || '')
      .split(',')
      .map(item => item.trim())
      .filter(Boolean);
    if (installedSkills.includes('careful-mode') || installedSkills.includes('freeze-mode')) {
      result.warnings.push(
        'goldband careful-mode/freeze-mode and workflow safety skills are both available; use goldband for hard global guardrails, workflow skills for task-local guardrails.'
      );
    }
  }

  return result;
}

function runRouterReplay(rootDir) {
  const replayScript = path.join(rootDir, 'hooks', 'scripts', 'tools', 'replay-hook-router.js');
  if (!fs.existsSync(replayScript)) {
    return { ok: false, message: 'hooks/scripts/tools/replay-hook-router.js missing' };
  }

  const result = spawnSync(process.execPath, [replayScript, '--iterations', '5'], {
    cwd: rootDir,
    encoding: 'utf8',
    maxBuffer: 2 * 1024 * 1024
  });

  return {
    ok: result.status === 0,
    message: result.status === 0 ? 'pass' : 'fail',
    stdout: result.stdout || '',
    stderr: result.stderr || ''
  };
}

function isCodexAvailable() {
  const result = spawnSync('codex', ['--version'], {
    encoding: 'utf8',
    maxBuffer: 2 * 1024 * 1024
  });

  return !result.error;
}

function parseCodexExecpolicyOutput(rawOutput) {
  const trimmed = (rawOutput || '').trim();
  const jsonStart = trimmed.indexOf('{');
  if (jsonStart === -1) {
    throw new Error('missing JSON payload');
  }

  return JSON.parse(trimmed.slice(jsonStart));
}

function runCodexExecpolicyCheck(rootDir, args) {
  const rulePath = path.join(rootDir, 'codex', 'rules', 'default.rules');
  const result = spawnSync('codex', ['execpolicy', 'check', '--rules', rulePath, '--pretty', '--', ...args.command], {
    cwd: rootDir,
    encoding: 'utf8',
    maxBuffer: 2 * 1024 * 1024
  });

  if (result.error) {
    return {
      label: args.label,
      ok: false,
      message: result.error.message
    };
  }

  if (result.status !== 0) {
    return {
      label: args.label,
      ok: false,
      message: (result.stderr || result.stdout || 'execpolicy check failed').trim()
    };
  }

  try {
    const parsed = parseCodexExecpolicyOutput(result.stdout || '');
    const actualDecision = parsed.decision;
    if (actualDecision !== args.expectedDecision) {
      return {
        label: args.label,
        ok: false,
        message: `expected ${args.expectedDecision}, got ${actualDecision || 'unknown'}`
      };
    }

    return {
      label: args.label,
      ok: true,
      message: actualDecision
    };
  } catch (error) {
    return {
      label: args.label,
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    };
  }
}

function buildSummary(rootDir, args) {
  const homeDir = os.homedir();
  const jsonChecks = [
    validateJsonFile(rootDir, path.join('hooks', 'hooks.json')),
    validateJsonFile(rootDir, path.join('skills', 'global', 'skill-rules.json')),
    validateJsonFile(rootDir, path.join('.claude-plugin', 'plugin.json'))
  ];
  const tomlChecks = [
    validateTomlFile(rootDir, path.join('.codex', 'config.toml')),
    validateTomlFile(rootDir, path.join('codex', 'config.toml'))
  ];
  const requiredFileChecks = [
    validateRequiredFile(rootDir, 'AGENTS.md'),
    validateRequiredFile(rootDir, path.join('codex', 'AGENTS.md')),
    validateRequiredFile(rootDir, path.join('codex', 'rules', 'default.rules'))
  ];

  const skillFiles = findFilesRecursive(path.join(rootDir, 'skills'), filePath => path.basename(filePath) === 'SKILL.md');
  const frontmatterChecks = skillFiles.map(checkSkillFrontmatter);
  const referenceChecks = skillFiles.map(checkReferenceLinks);
  const hookCheck = checkHookReferences(rootDir);
  const replay = args.routerReplay ? runRouterReplay(rootDir) : null;
  const codexRuleChecks = [];
  const additionalWarnings = [];
  const workflowInstall = checkWorkflowInstall(homeDir);
  const workflowInstallErrors = [];

  if (workflowInstall.claudeInstalled) {
    workflowInstallErrors.push(
      ...workflowInstall.claudeChecks
        .filter(item => !item.ok)
        .map(item => `workflow Claude runtime: missing ${item.file}`)
    );
  }

  if (workflowInstall.codexInstalled) {
    workflowInstallErrors.push(
      ...workflowInstall.codexChecks
        .filter(item => !item.ok)
        .map(item => `workflow Codex runtime: missing ${item.file}`)
    );
  }

  if (workflowInstall.stateInstalled) {
    workflowInstallErrors.push(
      ...workflowInstall.stateChecks
        .filter(item => !item.ok)
        .map(item => `workflow state: missing ${item.file}`)
    );
  }

  if (isCodexAvailable()) {
    codexRuleChecks.push(
      runCodexExecpolicyCheck(rootDir, {
        label: 'codex/rules/default.rules: git status --short',
        command: ['git', 'status', '--short'],
        expectedDecision: 'allow'
      }),
      runCodexExecpolicyCheck(rootDir, {
        label: 'codex/rules/default.rules: git push origin main',
        command: ['git', 'push', 'origin', 'main'],
        expectedDecision: 'prompt'
      }),
      runCodexExecpolicyCheck(rootDir, {
        label: 'codex/rules/default.rules: rm README.md',
        command: ['rm', 'README.md'],
        expectedDecision: 'prompt'
      })
    );
  } else {
    additionalWarnings.push('codex CLI not available; execpolicy checks skipped');
  }

  const errors = [
    ...jsonChecks.filter(item => !item.ok).map(item => `${item.file}: ${item.message}`),
    ...tomlChecks.filter(item => !item.ok).map(item => `${item.file}: ${item.message}`),
    ...requiredFileChecks.filter(item => !item.ok).map(item => `${item.file}: ${item.message}`),
    ...frontmatterChecks.flatMap(item => item.errors.map(error => `${item.file}: ${error}`)),
    ...referenceChecks.flatMap(item => item.missing.map(ref => `${item.file}: missing ${ref}`)),
    ...hookCheck.errors,
    ...workflowInstallErrors,
    ...codexRuleChecks.filter(item => !item.ok).map(item => `${item.label}: ${item.message}`)
  ];

  if (replay && !replay.ok) {
    errors.push('router replay failed');
  }

  const warnings = [
    ...frontmatterChecks.flatMap(item => item.warnings.map(warning => `${item.file}: ${warning}`)),
    ...additionalWarnings,
    ...workflowInstall.warnings
  ];

  return {
    ok: errors.length === 0,
    jsonChecks,
    tomlChecks,
    requiredFileChecks,
    hookCheck,
    codexRuleChecks,
    workflowInstall,
    skillCount: skillFiles.length,
    warnings,
    replay,
    errors
  };
}

function printHuman(summary) {
  console.log('goldband Config Verification');
  console.log('============================');
  console.log(`Overall: ${summary.ok ? 'PASS' : 'FAIL'}`);
  console.log(`Skills:  ${summary.skillCount}`);
  console.log(`Hooks:   ${summary.hookCheck.ok ? `OK (${summary.hookCheck.checked} refs)` : 'FAIL'}`);
  if (summary.codexRuleChecks.length > 0) {
    const passedCodexChecks = summary.codexRuleChecks.filter(item => item.ok).length;
    console.log(`Codex:   ${passedCodexChecks}/${summary.codexRuleChecks.length} execpolicy checks passed`);
  }
  if (summary.workflowInstall.claudeInstalled || summary.workflowInstall.codexInstalled) {
    console.log(
      `workflow:  Claude=${summary.workflowInstall.claudeInstalled ? 'yes' : 'no'} Codex=${summary.workflowInstall.codexInstalled ? 'yes' : 'no'} State=${summary.workflowInstall.stateInstalled ? 'yes' : 'no'}`
    );
  }
  console.log('');
  console.log('JSON:');
  for (const item of summary.jsonChecks) {
    console.log(`  [${item.ok ? 'OK' : 'FAIL'}] ${item.file} — ${item.message}`);
  }

  console.log('');
  console.log('TOML:');
  for (const item of summary.tomlChecks) {
    console.log(`  [${item.ok ? 'OK' : 'FAIL'}] ${item.file} — ${item.message}`);
  }

  console.log('');
  console.log('Repo Files:');
  for (const item of summary.requiredFileChecks) {
    console.log(`  [${item.ok ? 'OK' : 'FAIL'}] ${item.file} — ${item.message}`);
  }

  if (summary.codexRuleChecks.length > 0) {
    console.log('');
    console.log('Codex Execpolicy:');
    for (const item of summary.codexRuleChecks) {
      console.log(`  [${item.ok ? 'OK' : 'FAIL'}] ${item.label} — ${item.message}`);
    }
  }

  if (summary.workflowInstall.claudeInstalled || summary.workflowInstall.codexInstalled) {
    console.log('');
    console.log('workflow:');
    if (summary.workflowInstall.claudeInstalled) {
      console.log(`  [OK] Claude install — ${summary.workflowInstall.claudeVersion || 'unknown'}`);
      for (const item of summary.workflowInstall.claudeChecks) {
        console.log(`  [${item.ok ? 'OK' : 'FAIL'}] ${item.file}`);
      }
    } else {
      console.log('  [INFO] Claude install not present');
    }

    if (summary.workflowInstall.codexInstalled) {
      console.log(`  [OK] Codex runtime — ${summary.workflowInstall.codexVersion || 'unknown'}`);
      for (const item of summary.workflowInstall.codexChecks) {
        const suffix = item.detail ? ` — ${item.detail}` : '';
        console.log(`  [${item.ok ? 'OK' : 'FAIL'}] ${item.file}${suffix}`);
      }
    } else {
      console.log('  [INFO] Codex runtime not present');
    }
  }

  if (summary.warnings.length > 0) {
    console.log('');
    console.log('Warnings:');
    for (const warning of summary.warnings) {
      console.log(`  [WARN] ${warning}`);
    }
  }

  if (summary.replay) {
    console.log('');
    console.log(`Router Replay: ${summary.replay.ok ? 'PASS' : 'FAIL'}`);
  }

  if (summary.errors.length > 0) {
    console.log('');
    console.log('Errors:');
    for (const error of summary.errors) {
      console.log(`  [ERR] ${error}`);
    }
  }
}

function main() {
  const args = parseArgs(process.argv);
  const rootDir = process.cwd();
  const summary = buildSummary(rootDir, args);
  appendHistory({
    ok: summary.ok,
    skillCount: summary.skillCount,
    warningCount: summary.warnings.length,
    errorCount: summary.errors.length,
    replayRequested: args.routerReplay,
    replayPassed: summary.replay ? summary.replay.ok : null
  });
  try {
    usageTelemetry?.appendUsageEvent({
      category: 'skill-script',
      name: 'claude-config-verification',
      action: args.routerReplay ? 'verify-config-with-replay' : 'verify-config',
      sessionId: process.env.CLAUDE_SESSION_ID || null,
      source: 'skills/global/claude-config-verification/scripts/verify-claude-config.js',
      detail: {
        ok: summary.ok,
        skillCount: summary.skillCount,
        errorCount: summary.errors.length,
        warningCount: summary.warnings.length
      }
    });
  } catch {
    // Telemetry is best-effort only.
  }

  if (args.json) {
    process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
  } else {
    printHuman(summary);
  }

  process.exit(summary.ok ? 0 : 1);
}

main();
