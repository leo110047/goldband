#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

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

function buildSummary(rootDir, args) {
  const jsonChecks = [
    validateJsonFile(rootDir, path.join('hooks', 'hooks.json')),
    validateJsonFile(rootDir, path.join('skills', 'global', 'skill-rules.json')),
    validateJsonFile(rootDir, path.join('.claude-plugin', 'plugin.json'))
  ];

  const skillFiles = findFilesRecursive(path.join(rootDir, 'skills'), filePath => path.basename(filePath) === 'SKILL.md');
  const frontmatterChecks = skillFiles.map(checkSkillFrontmatter);
  const referenceChecks = skillFiles.map(checkReferenceLinks);
  const hookCheck = checkHookReferences(rootDir);
  const replay = args.routerReplay ? runRouterReplay(rootDir) : null;

  const errors = [
    ...jsonChecks.filter(item => !item.ok).map(item => `${item.file}: ${item.message}`),
    ...frontmatterChecks.flatMap(item => item.errors.map(error => `${item.file}: ${error}`)),
    ...referenceChecks.flatMap(item => item.missing.map(ref => `${item.file}: missing ${ref}`)),
    ...hookCheck.errors
  ];

  if (replay && !replay.ok) {
    errors.push('router replay failed');
  }

  const warnings = frontmatterChecks.flatMap(item => item.warnings.map(warning => `${item.file}: ${warning}`));

  return {
    ok: errors.length === 0,
    jsonChecks,
    hookCheck,
    skillCount: skillFiles.length,
    frontmatterWarnings: warnings,
    replay,
    errors
  };
}

function printHuman(summary) {
  console.log('Claude Config Verification');
  console.log('===========================');
  console.log(`Overall: ${summary.ok ? 'PASS' : 'FAIL'}`);
  console.log(`Skills:  ${summary.skillCount}`);
  console.log(`Hooks:   ${summary.hookCheck.ok ? `OK (${summary.hookCheck.checked} refs)` : 'FAIL'}`);
  console.log('');
  console.log('JSON:');
  for (const item of summary.jsonChecks) {
    console.log(`  [${item.ok ? 'OK' : 'FAIL'}] ${item.file} — ${item.message}`);
  }

  if (summary.frontmatterWarnings.length > 0) {
    console.log('');
    console.log('Warnings:');
    for (const warning of summary.frontmatterWarnings) {
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
    warningCount: summary.frontmatterWarnings.length,
    errorCount: summary.errors.length,
    replayRequested: args.routerReplay,
    replayPassed: summary.replay ? summary.replay.ok : null
  });

  if (args.json) {
    process.stdout.write(JSON.stringify(summary, null, 2));
  } else {
    printHuman(summary);
  }

  process.exit(summary.ok ? 0 : 1);
}

main();
