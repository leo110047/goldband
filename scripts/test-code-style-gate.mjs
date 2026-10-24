import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const repoRoot = process.cwd();
const checker = path.join(repoRoot, 'scripts', 'check-code-style.mjs');
const preCommitHook = path.join(repoRoot, 'git-hooks', 'pre-commit');
const commitMsgHook = path.join(repoRoot, 'git-hooks', 'commit-msg');

const tests = [
  ['markdown setext heading is not a merge conflict', testMarkdownSetext],
  ['real merge conflict block is blocked', testMergeConflictBlock],
  ['ordinary text over 1 MB is blocked', testLargeOrdinaryTextBlocked],
  ['blank lines do not count toward file length', testBlankLinesNotCounted],
  ['non-blank lines over the file limit are blocked', testFileLinesBlocked],
  [
    'tracked generated text with an exact generator contract is allowed',
    testTrackedGeneratedTextAllowed,
  ],
  [
    'generated text contract rejects an untracked generator',
    testGeneratedTextUntrackedGeneratorBlocked,
  ],
  [
    'generated text contract rejects a generator directory',
    testGeneratedTextGeneratorDirectoryBlocked,
  ],
  [
    'generated text contract cannot exceed the global generated cap',
    testGeneratedTextCapBlocked,
  ],
  [
    'generated text contract does not allow path globs',
    testGeneratedTextGlobBlocked,
  ],
  [
    'generated text remains blocked above its declared file cap',
    testGeneratedTextDeclaredCapBlocked,
  ],
  [
    'staged generated text above 10 MiB is still checked',
    testLargeStagedGeneratedTextDeclaredCapBlocked,
  ],
  [
    'staged generated text above the 16 MiB hard cap is blocked',
    testLargeStagedGeneratedTextHardCapBlocked,
  ],
  ['staged gitlinks are not read as blobs', testStagedGitlinkSkipped],
  ['commit-msg accepts scope and breaking marker', testCommitMsgScope],
  ['commit-msg accepts every conventional type', testCommitMsgTypes],
  ['commit-msg warns by default', testCommitMsgWarnsByDefault],
  [
    'commit-msg blocks when the repository or environment opts in',
    testCommitMsgOptInBlocks,
  ],
  [
    'commit-msg ignores Git and release tool subjects',
    testCommitMsgIgnoresGeneratedSubjects,
  ],
  [
    'pre-commit runs project hook after goldband',
    testPreCommitProjectHookOrder,
  ],
  [
    'pre-commit stops before project hook when goldband fails',
    testPreCommitProjectHookSkippedOnGoldbandFailure,
  ],
  [
    'pre-commit warns when project hook is not executable',
    testPreCommitWarnsWhenProjectHookNotExecutable,
  ],
  [
    'pre-commit warns when project hook path is a directory',
    testPreCommitWarnsWhenProjectHookIsDirectory,
  ],
  ['commit-msg runs project hook after goldband', testCommitMsgProjectHook],
  [
    'commit-msg leaves the format to a project hook',
    testCommitMsgDefersToProjectHook,
  ],
  ['pre-commit missing checker fails soft', testPreCommitMissingChecker],
  ['pre-commit missing node fails soft', testPreCommitMissingNode],
  [
    'pre-commit blocks managed worktrees before all style-gate bypasses',
    testPreCommitBlocksManagedWorktree,
  ],
];

for (const [name, test] of tests) {
  test();
  console.log(`ok - ${name}`);
}

function testMarkdownSetext() {
  const dir = createRepo();
  fs.writeFileSync(path.join(dir, 'README.md'), 'Title\n=======\n\nbody\n');
  run('git', ['add', 'README.md'], { cwd: dir });

  const result = checkStyle(dir);
  assertEqual(result.status, 0, result.stdout + result.stderr);
}

function testMergeConflictBlock() {
  const dir = createRepo();
  fs.writeFileSync(
    path.join(dir, 'README.md'),
    '<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> branch\n',
  );
  run('git', ['add', 'README.md'], { cwd: dir });

  const result = checkStyle(dir);
  assertEqual(result.status, 1, result.stdout + result.stderr);
  assertIncludes(result.stdout, '"rule": "merge-conflict"');
}

function testLargeOrdinaryTextBlocked() {
  const dir = createRepo();
  fs.writeFileSync(path.join(dir, 'large-contract.json'), largeText());
  run('git', ['add', 'large-contract.json'], { cwd: dir });

  const result = checkStyle(dir);
  assertEqual(result.status, 1, result.stdout + result.stderr);
  assertIncludes(result.stdout, '"rule": "text-size"');
}

function testBlankLinesNotCounted() {
  const dir = createRepo();
  fs.writeFileSync(path.join(dir, 'long.js'), codeLines(600, '\n  \n'));
  run('git', ['add', 'long.js'], { cwd: dir });

  const result = checkStyle(dir);
  assertEqual(result.status, 0, result.stdout + result.stderr);
  assertNotIncludes(result.stdout, '"rule": "file-lines"');
}

function testFileLinesBlocked() {
  const dir = createRepo();
  fs.writeFileSync(path.join(dir, 'long.js'), codeLines(601, '\n'));
  run('git', ['add', 'long.js'], { cwd: dir });

  const result = checkStyle(dir);
  assertEqual(result.status, 1, result.stdout + result.stderr);
  assertIncludes(result.stdout, '601 non-blank lines, max is 600');
}

function testTrackedGeneratedTextAllowed() {
  const dir = createRepo();
  writeGeneratedTextFixture(dir);

  const result = checkStyle(dir);
  assertEqual(result.status, 0, result.stdout + result.stderr);
}

function testGeneratedTextUntrackedGeneratorBlocked() {
  const dir = createRepo();
  writeGeneratedTextFixture(dir, { stageGenerator: false });

  const result = checkStyle(dir);
  assertEqual(result.status, 2, result.stdout + result.stderr);
  assertIncludes(result.stderr, 'generator must be one exact regular file');
}

function testGeneratedTextGeneratorDirectoryBlocked() {
  const dir = createRepo();
  writeGeneratedTextFixture(dir, { generatorPath: 'scripts' });

  const result = checkStyle(dir);
  assertEqual(result.status, 2, result.stdout + result.stderr);
  assertIncludes(result.stderr, 'generator must be one exact regular file');
}

function testGeneratedTextCapBlocked() {
  const dir = createRepo();
  writeGeneratedTextFixture(dir, { maxBytes: 32 * 1024 * 1024 });

  const result = checkStyle(dir);
  assertEqual(result.status, 2, result.stdout + result.stderr);
  assertIncludes(result.stderr, 'exceeds the generated text hard cap');
}

function testGeneratedTextGlobBlocked() {
  const dir = createRepo();
  writeGeneratedTextFixture(dir, { artifactPath: 'api/*.json' });

  const result = checkStyle(dir);
  assertEqual(result.status, 2, result.stdout + result.stderr);
  assertIncludes(result.stderr, 'globs are not allowed');
}

function testGeneratedTextDeclaredCapBlocked() {
  const dir = createRepo();
  writeGeneratedTextFixture(dir, {
    artifactBytes: 2 * 1024 * 1024,
    maxBytes: 1024 * 1024 + 1,
  });

  const result = checkStyle(dir);
  assertEqual(result.status, 1, result.stdout + result.stderr);
  assertIncludes(result.stdout, '"rule": "text-size"');
}

function testLargeStagedGeneratedTextDeclaredCapBlocked() {
  const dir = createRepo();
  writeGeneratedTextFixture(dir, {
    artifactBytes: 11 * 1024 * 1024,
    maxBytes: 10 * 1024 * 1024 + 1,
  });

  const result = checkStyle(dir);
  assertEqual(result.status, 1, result.stdout + result.stderr);
  assertIncludes(result.stdout, '"rule": "text-size"');
}

function testLargeStagedGeneratedTextHardCapBlocked() {
  const dir = createRepo();
  writeGeneratedTextFixture(dir, {
    artifactBytes: 17 * 1024 * 1024,
    maxBytes: 16 * 1024 * 1024,
  });

  const result = checkStyle(dir);
  assertEqual(result.status, 1, result.stdout + result.stderr);
  assertIncludes(result.stdout, '"rule": "file-size"');
}

function testStagedGitlinkSkipped() {
  const dir = createRepo();
  run(
    'git',
    [
      'update-index',
      '--add',
      '--cacheinfo',
      `160000,${'a'.repeat(40)},modules/example`,
    ],
    { cwd: dir },
  );

  const result = checkStyle(dir);
  assertEqual(result.status, 0, result.stdout + result.stderr);
}

function testCommitMsgScope() {
  const dir = createRepo();
  fs.writeFileSync(path.join(dir, '.goldband-git-workflow.json'), '{}\n');
  const scoped = path.join(dir, 'scoped-msg');
  const breaking = path.join(dir, 'breaking-msg');
  fs.writeFileSync(scoped, 'feat(api): add endpoint\n');
  fs.writeFileSync(breaking, 'feat!: change contract\n');

  assertEqual(run('bash', [commitMsgHook, scoped], { cwd: dir }).status, 0);
  assertEqual(run('bash', [commitMsgHook, breaking], { cwd: dir }).status, 0);
}

function testCommitMsgTypes() {
  const dir = createRepo();
  fs.writeFileSync(path.join(dir, '.goldband-git-workflow.json'), '{}\n');
  const message = path.join(dir, 'msg');
  for (const type of [
    'feat',
    'fix',
    'docs',
    'style',
    'refactor',
    'perf',
    'test',
    'build',
    'ci',
    'chore',
    'revert',
  ]) {
    fs.writeFileSync(message, `${type}: describe the change\n`);
    const result = run('bash', [commitMsgHook, message], {
      cwd: dir,
      env: hookEnv(),
    });
    assertEqual(result.status, 0, type + result.stderr);
  }
}

function testCommitMsgWarnsByDefault() {
  const dir = createRepo();
  const message = path.join(dir, 'msg');
  fs.writeFileSync(message, 'bad message\n');

  const result = run('bash', [commitMsgHook, message], {
    cwd: dir,
    env: hookEnv(),
  });
  assertEqual(result.status, 0, result.stderr);
  assertIncludes(
    result.stderr,
    'commit message must follow Conventional Commits',
  );
  assertIncludes(result.stderr, 'warning only');
}

function testCommitMsgOptInBlocks() {
  // An opted-in repository is checked even when its own hook exists.
  for (const optIn of ['marker', 'env']) {
    const dir = createRepo();
    const message = path.join(dir, 'msg');
    if (optIn === 'marker') {
      fs.writeFileSync(path.join(dir, '.goldband-git-workflow.json'), '{}\n');
    }
    const env = hookEnv(
      optIn === 'env' ? { GOLDBAND_GIT_WORKFLOW_GATE: '1' } : {},
    );
    writeProjectHook(dir, 'commit-msg', '#!/usr/bin/env bash\nexit 0\n');
    for (const subject of ['bad message', 'Merge duplicate parser helpers']) {
      fs.writeFileSync(message, `${subject}\n`);
      const result = run('bash', [commitMsgHook, message], { cwd: dir, env });
      assertEqual(result.status, 1, optIn + subject + result.stderr);
      assertIncludes(
        result.stderr,
        'commit message must follow Conventional Commits',
      );
    }
  }
}

function testCommitMsgIgnoresGeneratedSubjects() {
  const dir = createRepo();
  const message = path.join(dir, 'msg');
  fs.writeFileSync(path.join(dir, '.goldband-git-workflow.json'), '{}\n');
  for (const subject of [
    "Merge branch 'main' into topic",
    'Merge pull request #12 from org/topic',
    'Merged PR 7: topic',
    'Merge tag v1.2.0',
    'Merge remote-tracking branch origin/main',
    'Revert "feat: add endpoint"',
    'Reapply "feat: add endpoint"',
    'fixup! feat: add endpoint',
    'squash! feat: add endpoint',
    'amend! feat: add endpoint',
    'Automatic merge from release',
    'Auto-merged main into topic',
    '1.2.3',
    'v2.0.0-rc.1',
  ]) {
    fs.writeFileSync(message, `${subject}\n`);
    const result = run('bash', [commitMsgHook, message], {
      cwd: dir,
      env: hookEnv(),
    });
    assertEqual(result.status, 0, subject + result.stderr);
    assertEqual(result.stderr, '', subject);
  }
}

function testPreCommitProjectHookOrder() {
  const dir = createRepo();
  const log = path.join(dir, 'hook-order.log');
  const gate = path.join(dir, 'goldband-gate.mjs');
  fs.writeFileSync(
    gate,
    `import fs from 'node:fs'; fs.appendFileSync(${JSON.stringify(log)}, 'goldband\\n');\n`,
  );
  writeProjectHook(
    dir,
    'pre-commit',
    `#!/usr/bin/env bash\nprintf 'project\\n' >> ${shellQuote(log)}\n`,
  );

  const result = run('bash', [preCommitHook], {
    cwd: dir,
    env: hookEnv({ GOLDBAND_STYLE_GATE_SCRIPT: gate }),
  });

  assertEqual(result.status, 0, result.stdout + result.stderr);
  assertEqual(fs.readFileSync(log, 'utf8'), 'goldband\nproject\n');
}

function testPreCommitProjectHookSkippedOnGoldbandFailure() {
  const dir = createRepo();
  const log = path.join(dir, 'hook-order.log');
  const gate = path.join(dir, 'goldband-gate.mjs');
  fs.writeFileSync(
    gate,
    `import fs from 'node:fs'; fs.appendFileSync(${JSON.stringify(log)}, 'goldband\\n'); process.exit(1);\n`,
  );
  writeProjectHook(
    dir,
    'pre-commit',
    `#!/usr/bin/env bash\nprintf 'project\\n' >> ${shellQuote(log)}\n`,
  );

  const result = run('bash', [preCommitHook], {
    cwd: dir,
    env: hookEnv({ GOLDBAND_STYLE_GATE_SCRIPT: gate }),
  });

  assertEqual(result.status, 1, result.stdout + result.stderr);
  assertEqual(fs.readFileSync(log, 'utf8'), 'goldband\n');
}

function testPreCommitWarnsWhenProjectHookNotExecutable() {
  if (process.platform === 'win32') {
    return;
  }

  const dir = createRepo();
  const log = path.join(dir, 'hook-order.log');
  const gate = path.join(dir, 'goldband-gate.mjs');
  fs.writeFileSync(
    gate,
    `import fs from 'node:fs'; fs.appendFileSync(${JSON.stringify(log)}, 'goldband\\n');\n`,
  );
  writeProjectHook(
    dir,
    'pre-commit',
    `#!/usr/bin/env bash\nprintf 'project\\n' >> ${shellQuote(log)}\n`,
    0o644,
  );

  const result = run('bash', [preCommitHook], {
    cwd: dir,
    env: hookEnv({ GOLDBAND_STYLE_GATE_SCRIPT: gate }),
  });

  assertEqual(result.status, 0, result.stdout + result.stderr);
  assertEqual(fs.readFileSync(log, 'utf8'), 'goldband\n');
  assertIncludes(
    result.stderr,
    'project pre-commit hook exists but is not executable',
  );
}

function testPreCommitWarnsWhenProjectHookIsDirectory() {
  const dir = createRepo();
  const log = path.join(dir, 'hook-order.log');
  const gate = path.join(dir, 'goldband-gate.mjs');
  fs.writeFileSync(
    gate,
    `import fs from 'node:fs'; fs.appendFileSync(${JSON.stringify(log)}, 'goldband\\n');\n`,
  );
  fs.mkdirSync(path.join(dir, '.git', 'hooks', 'pre-commit'));

  const result = run('bash', [preCommitHook], {
    cwd: dir,
    env: hookEnv({ GOLDBAND_STYLE_GATE_SCRIPT: gate }),
  });

  assertEqual(result.status, 0, result.stdout + result.stderr);
  assertEqual(fs.readFileSync(log, 'utf8'), 'goldband\n');
  assertIncludes(result.stderr, 'project pre-commit hook path is a directory');
}

function testCommitMsgProjectHook() {
  const dir = createRepo();
  const log = path.join(dir, 'commit-msg-project.log');
  const message = path.join(dir, 'msg');
  fs.writeFileSync(message, 'fix: chain project hook\n');
  writeProjectHook(
    dir,
    'commit-msg',
    `#!/usr/bin/env bash\nprintf '%s\\n' "$1" > ${shellQuote(log)}\n`,
  );

  const result = run('bash', [commitMsgHook, message], {
    cwd: dir,
    env: hookEnv(),
  });

  assertEqual(result.status, 0, result.stdout + result.stderr);
  assertEqual(fs.readFileSync(log, 'utf8').trim(), message);
}

function testCommitMsgDefersToProjectHook() {
  const dir = createRepo();
  const log = path.join(dir, 'commit-msg-project.log');
  const message = path.join(dir, 'msg');
  fs.writeFileSync(message, 'project format message\n');
  writeProjectHook(
    dir,
    'commit-msg',
    `#!/usr/bin/env bash\nprintf 'project\\n' > ${shellQuote(log)}\n`,
  );

  const result = run('bash', [commitMsgHook, message], {
    cwd: dir,
    env: hookEnv(),
  });

  assertEqual(result.status, 0, result.stdout + result.stderr);
  assertEqual(fs.readFileSync(log, 'utf8'), 'project\n');
  assertEqual(result.stderr.includes('Conventional Commits'), false);
}

function testPreCommitMissingChecker() {
  const dir = createRepo();
  const result = run('bash', [preCommitHook], {
    cwd: dir,
    env: hookEnv({
      GOLDBAND_STYLE_GATE_SCRIPT: path.join(dir, 'missing-checker.mjs'),
    }),
  });

  assertEqual(result.status, 0, result.stdout + result.stderr);
  assertIncludes(result.stderr, 'style gate script missing');
}

function testPreCommitMissingNode() {
  const dir = createRepo();
  const binDir = path.join(dir, 'bin');
  let pathWithoutNode = binDir;
  if (process.platform === 'win32') {
    pathWithoutNode = [
      path.dirname(resolveCommand('git')),
      path.dirname(resolveCommand('dirname')),
    ].join(path.delimiter);
  } else {
    fs.mkdirSync(binDir);
    fs.symlinkSync(resolveCommand('git'), path.join(binDir, 'git'));
    fs.symlinkSync(resolveCommand('dirname'), path.join(binDir, 'dirname'));
  }

  const result = run('/bin/bash', [preCommitHook], {
    cwd: dir,
    env: hookEnv({
      GOLDBAND_STYLE_GATE_SCRIPT: checker,
      PATH: pathWithoutNode,
    }),
  });

  assertEqual(result.status, 0, result.stdout + result.stderr);
  assertIncludes(result.stderr, 'node not found');
}

function testPreCommitBlocksManagedWorktree() {
  const dir = createRepo();
  fs.writeFileSync(
    path.join(dir, '.git', 'goldband-managed-worktree.json'),
    '{"schemaVersion":1,"leaseId":"fixture","manifestPath":"/fixture"}\n',
  );
  const result = run('bash', [preCommitHook], {
    cwd: dir,
    env: hookEnv({ GOLDBAND_STYLE_GATE: '0' }),
  });
  assertEqual(result.status, 1);
  assertIncludes(result.stderr, 'managed worktrees cannot commit directly');
}

function checkStyle(cwd) {
  return run(process.execPath, [checker, '--staged', '--format', 'json'], {
    cwd,
  });
}

function writeGeneratedTextFixture(
  dir,
  {
    artifactBytes = 1024 * 1024,
    artifactPath = 'api/openapi.json',
    generatorPath = 'scripts/generate-openapi.mjs',
    maxBytes = 2 * 1024 * 1024,
    stageGenerator = true,
  } = {},
) {
  fs.mkdirSync(path.join(dir, 'api'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'scripts', 'generate-openapi.mjs'),
    "process.stdout.write('generated by fixture\\n');\n",
  );
  fs.writeFileSync(
    path.join(dir, 'api', 'openapi.json'),
    largeText(artifactBytes),
  );
  fs.writeFileSync(
    path.join(dir, '.goldband-style.json'),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        largeGeneratedTextFiles: [
          {
            path: artifactPath,
            generator: generatorPath,
            maxBytes,
          },
        ],
      },
      null,
      2,
    )}\n`,
  );
  const files = ['.goldband-style.json', 'api/openapi.json'];
  if (stageGenerator) files.push('scripts/generate-openapi.mjs');
  run('git', ['add', ...files], { cwd: dir });
}

function largeText(bytes = 1024 * 1024) {
  return `${'x'.repeat(bytes)}\n`;
}

function codeLines(count, separator) {
  return `${Array.from({ length: count }, (_, i) => `x${i}();`).join(separator)}\n`;
}

function createRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'goldband-style-test-'));
  run('git', ['init', '--quiet'], { cwd: dir });
  run('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  run('git', ['config', 'user.name', 'Test User'], { cwd: dir });
  return dir;
}

function writeProjectHook(repoDir, hookName, content, mode) {
  const hookPath = path.join(repoDir, '.git', 'hooks', hookName);
  fs.writeFileSync(hookPath, content);
  fs.chmodSync(hookPath, mode ?? 0o755);
  return hookPath;
}

function shellQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function hookEnv(overrides = {}) {
  const env = { ...process.env };
  delete env.GOLDBAND_PROJECT_HOOK_RUNNING;
  delete env.GOLDBAND_GIT_WORKFLOW_GATE;
  delete env.GOLDBAND_STYLE_GATE;
  return { ...env, ...overrides };
}

function run(command, args, options = {}) {
  return spawnSync(resolveSpawnCommand(command), args, {
    cwd: options.cwd ?? repoRoot,
    encoding: 'utf8',
    env: options.env ?? hookEnv(),
  });
}

function resolveSpawnCommand(command) {
  if (process.platform !== 'win32') {
    return command;
  }
  if (command !== 'bash' && command !== '/bin/bash' && command !== '/bin/sh') {
    return command;
  }
  const candidates = [
    process.env.GOLDBAND_TEST_BASH,
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) || command;
}

function resolveCommand(command) {
  const result = run('/bin/sh', ['-c', `command -v ${command}`]);
  assertEqual(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function assertEqual(actual, expected, message = '') {
  if (actual === expected) return;
  throw new Error(`expected ${expected}, got ${actual}\n${message}`);
}

function assertIncludes(value, expected) {
  if (value.includes(expected)) return;
  throw new Error(`expected output to include ${expected}\n${value}`);
}

function assertNotIncludes(value, unexpected) {
  if (!value.includes(unexpected)) return;
  throw new Error(`expected output not to include ${unexpected}\n${value}`);
}
