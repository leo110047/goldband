#!/usr/bin/env node
// Gate A (hook bypass) and Gate G (protected configuration) through both
// native hook adapters with one shared case set. Optional arguments name the
// Claude and Codex routers, so installed copies run the same cases.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import {
  claudeModes,
  gateAAllowCases,
  gateAAnalysisFailureCases,
  gateABlockCases,
  gateANoOverrideCases,
  gitConfigOverrideEnv,
  protectedTargets,
  shellReadForms,
  shellResolutionCases,
  shellWriteForms,
  unprotectedTargets,
} from './fixtures/gate-protection-cases.mjs';
import { verifyAnalysisCost } from './lib/gate-analysis-cost.mjs';
import { verifyAnalysisLimits } from './lib/gate-analysis-limits.mjs';
import { verifyGitLaunches } from './lib/gate-git-launches.mjs';
import {
  absoluteTarget,
  baseEnv,
  bash,
  check,
  home,
  patch,
  project,
  root,
  runClaude,
  runCodex,
  temp,
} from './lib/gate-protection-harness.mjs';

const require = createRequire(import.meta.url);

function verifyGateA() {
  const env = gitConfigOverrideEnv;
  for (const [command, rule] of gateABlockCases) {
    const claude = runClaude(bash(command), { env });
    const codex = runCodex(bash(command), { env });
    check(`claude ${command}`, claude, 'deny');
    check(`codex ${command}`, codex, 'deny');
    assert.match(claude.message, new RegExp(`Gate A .*\\(${rule}\\)`), command);
    assert.equal(claude.message, codex.message, command);
    assert.match(codex.message, /stop and ask the user/, command);
  }
  for (const command of gateAAllowCases) {
    check(`claude ${command}`, runClaude(bash(command), { env }), 'none');
    check(`codex ${command}`, runCodex(bash(command), { env }), 'none');
  }
  // Gate A is always on: careful mode is inactive and every Claude mode denies.
  for (const mode of claudeModes) {
    const payload = { ...bash('git commit -n -m x'), permission_mode: mode };
    check(`claude ${mode}`, runClaude(payload), 'deny');
  }
  // Without a core.hooksPath entry in the hook environment, only operations
  // that set core.hooksPath, drop every entry, or drop the global config are
  // bypasses.
  for (const [command, expected] of gateANoOverrideCases) {
    check(`claude ${command}`, runClaude(bash(command)), expected);
    check(`codex ${command}`, runCodex(bash(command)), expected);
  }
  console.log(
    `[OK] Gate A: ${gateABlockCases.length} bypasses denied and ${gateAAllowCases.length} look-alikes allowed in both hosts`,
  );
}

function verifyMarkerFileTools() {
  const marker = path.join(project, '.goldband-no-style-gate');
  const write = {
    tool_name: 'Write',
    tool_input: { file_path: marker, content: '' },
    cwd: project,
  };
  check(
    'claude marker write',
    runClaude({ ...write, permission_mode: 'auto' }),
    'deny',
  );
  check(
    'codex marker add',
    runCodex(patch(['*** Add File: .goldband-no-style-gate', '+'])),
    'deny',
  );
  check(
    'codex marker delete',
    runCodex(patch(['*** Delete File: .goldband-no-style-gate'])),
    'none',
  );
  console.log(
    '[OK] Gate A: creating the style-gate marker is denied; removing it is allowed',
  );
}

// Claude file tools: built-in surfaces rely on Claude's own prompt in
// default/acceptEdits/plan; auto asks; bypassPermissions denies.
function expectedClaudeFileTool(item, mode) {
  if (mode === 'bypassPermissions') return 'deny';
  if (item.claudeBuiltin && mode !== 'auto') return 'none';
  return 'ask';
}

function verifyProtectedTarget(item) {
  const options = { env: item.env };
  const file = absoluteTarget(item.target);
  for (const mode of claudeModes) {
    const payload = {
      tool_name: mode === 'plan' ? 'Edit' : 'Write',
      tool_input: {
        file_path: file,
        content: '{}',
        old_string: 'a',
        new_string: 'b',
      },
      cwd: project,
      permission_mode: mode,
    };
    check(
      `claude ${mode} ${item.target}`,
      runClaude(payload, options),
      expectedClaudeFileTool(item, mode),
    );
  }
  const shell = `echo x > ${item.target}`;
  check(
    `claude ${shell}`,
    runClaude({ ...bash(shell), permission_mode: 'default' }, options),
    'ask',
  );
  check(
    `claude bypass ${shell}`,
    runClaude(
      { ...bash(shell), permission_mode: 'bypassPermissions' },
      options,
    ),
    'deny',
  );
  check(`codex ${shell}`, runCodex(bash(shell), options), 'deny');
  const relative = item.target.startsWith('~/') ? file : item.target;
  check(
    `codex patch ${item.target}`,
    runCodex(patch([`*** Add File: ${relative}`, '+x']), options),
    'deny',
  );
}

function verifyOtherClaudeFileTools() {
  for (const [tool_name, tool_input, mode, expected] of [
    ['MultiEdit', { file_path: '.gitleaks.toml', edits: [] }, 'default', 'ask'],
    ['MultiEdit', { file_path: '.mcp.json', edits: [] }, 'default', 'none'],
    [
      'NotebookEdit',
      { notebook_path: '~/.config/goldband/n.ipynb' },
      'plan',
      'ask',
    ],
  ]) {
    const payload = {
      tool_name,
      tool_input,
      cwd: project,
      permission_mode: mode,
    };
    check(`claude ${tool_name} ${mode}`, runClaude(payload), expected);
  }
}

function verifyGateG() {
  verifyOtherClaudeFileTools();
  for (const item of protectedTargets) verifyProtectedTarget(item);
  for (const target of unprotectedTargets) {
    const file = path.join(project, target);
    for (const mode of ['auto', 'bypassPermissions']) {
      const payload = {
        tool_name: 'Write',
        tool_input: { file_path: file, content: 'x' },
        cwd: project,
        permission_mode: mode,
      };
      check(`claude ${mode} ${target}`, runClaude(payload), 'none');
    }
    check(
      `codex ${target}`,
      runCodex(patch([`*** Add File: ${target}`, '+x'])),
      'none',
    );
    check(
      `codex shell ${target}`,
      runCodex(bash(`echo x > ${target}`)),
      'none',
    );
  }
  console.log(
    `[OK] Gate G: ${protectedTargets.length} protected targets and ${unprotectedTargets.length} ordinary files per host and mode`,
  );
}

function verifyShellForms() {
  for (const target of [
    '.mcp.json',
    '~/.config/goldband/state',
    '.gitleaksignore',
  ]) {
    for (const form of shellWriteForms) {
      const command = form.replaceAll('T', target);
      check(
        `claude ${command}`,
        runClaude({ ...bash(command), permission_mode: 'auto' }),
        'ask',
      );
      check(`codex ${command}`, runCodex(bash(command)), 'deny');
    }
    for (const form of shellReadForms) {
      const command = form.replaceAll('T', target);
      check(
        `claude ${command}`,
        runClaude({ ...bash(command), permission_mode: 'auto' }),
        'none',
      );
      check(`codex ${command}`, runCodex(bash(command)), 'none');
    }
  }
  console.log(
    `[OK] Gate G: ${shellWriteForms.length} shell write forms intercepted; reads and diffs pass`,
  );
}

// Claude auto asks and Codex denies a protected write; both stay silent
// otherwise.
function verifyShellResolution() {
  for (const [command, isProtected] of shellResolutionCases) {
    check(
      `claude ${command}`,
      runClaude({ ...bash(command), permission_mode: 'auto' }),
      isProtected ? 'ask' : 'none',
    );
    check(
      `codex ${command}`,
      runCodex(bash(command)),
      isProtected ? 'deny' : 'none',
    );
  }
  console.log(
    `[OK] Gate G: ${shellResolutionCases.length} cd, pushd, env -C, recursive copy, install, dd, and truncate cases`,
  );
}

// MCP tools named for writing take their path arguments as targets; patch
// text is read only from apply_patch, so other tools' text is never a write.
function verifyToolTargets() {
  for (const [tool_name, tool_input, expected] of [
    ['mcp__filesystem__write_file', { path: '.mcp.json', content: '{}' }, 1],
    ['mcp__fs__edit_file', { path: '~/.codex/hooks/x.js', edits: [] }, 1],
    ['mcp__fs__move_file', { source: '.gitleaks.toml', destination: 'a' }, 1],
    ['mcp__fs__create_directory', { path: '.claude/hooks' }, 1],
    // The verb may sit anywhere in the tool name, after any underscore.
    ['mcp__fs__file_write', { path: '.mcp.json', content: '{}' }, 1],
    ['mcp__github__update_file', { file: '.gitleaks.toml' }, 1],
    ['mcp__ide__replace_text', { pathInProject: '.mcp.json' }, 1],
    ['mcp__serena__insert_after', { relative_path: '.gitleaksignore' }, 1],
    ['mcp__fs__file_info', { path: '.mcp.json' }, 0],
    ['mcp__fs__write_file', { path: 'notes.md', content: 'x' }, 0],
    ['mcp__fs__read_file', { path: '.mcp.json' }, 0],
    ['mcp__x__run', { command: '*** Update File: .mcp.json' }, 0],
    ['TaskCreate', { input: '*** Update File: .gitleaks.toml' }, 0],
  ]) {
    const payload = {
      tool_name,
      tool_input: {
        ...tool_input,
        ...(tool_input.path && { path: absoluteTarget(tool_input.path) }),
      },
      cwd: project,
      permission_mode: 'auto',
    };
    check(`claude ${tool_name}`, runClaude(payload), expected ? 'ask' : 'none');
    check(`codex ${tool_name}`, runCodex(payload), expected ? 'deny' : 'none');
  }
  // A destination that is itself a protected container is the reported surface.
  const copy = runCodex(bash('cp -r missing/. ~/.codex'));
  assert.match(copy.message, /Codex user configuration/);
  console.log(
    '[OK] Gate G: MCP write tools, non-patch tool text, and copy surfaces',
  );
}

function verifyPatchForms() {
  for (const [lines, expected] of [
    [['*** Update File: .gitleaks.toml', '@@', '-a', '+b'], 'deny'],
    [['*** Delete File: .mcp.json'], 'deny'],
    [
      ['*** Update File: notes.md', '*** Move to: .mcp.json', '@@', '-a', '+b'],
      'deny',
    ],
    [['*** Update File: .gitleaksignore', '*** Move to: notes-old.md'], 'deny'],
    [['*** Update File: CLAUDE.md', '@@', '-a', '+b'], 'none'],
    // Codex trims a header line before reading it.
    [['  *** Add File: .codex/config.toml', '+x = 1'], 'deny'],
    [['\t*** Update File: .mcp.json', '@@', '-a', '+b'], 'deny'],
    // After an Update header, a line that starts with a blank is context,
    // so Codex neither moves nor updates the named file.
    [['*** Update File: notes.md', ' *** Move to: .gitleaks.toml'], 'none'],
    [
      ['*** Update File: notes.md', '@@', ' *** Update File: .mcp.json'],
      'none',
    ],
  ]) {
    check(`codex ${lines[0]}`, runCodex(patch(lines)), expected);
  }
  console.log(
    '[OK] Gate G: apply_patch updates, deletes, and move sources/destinations',
  );
}

// Truncated JSON is read with every JSON string escape decoded.
function verifyEscapedMalformedPayloads(text) {
  const truncated = (patchText) =>
    `{"tool_name":"apply_patch","tool_input":{"command":${patchText}`;
  const codexConfig = path.join(home, '.codex/config.toml');
  const escaped = [
    [
      'escaped slashes',
      JSON.stringify(text.replace('.mcp.json', codexConfig)).replaceAll(
        '/',
        '\\/',
      ),
    ],
    ['unicode escape', JSON.stringify(text).replace('.mcp', '\\u002emcp')],
    [
      'tab and backslash escapes',
      JSON.stringify(text.replace('+{}', '+\t{"a":"\\\\"}')),
    ],
    ['invalid escape', JSON.stringify(text).replace('.mcp', '.mc\\p')],
  ];
  for (const [label, patchText] of escaped) {
    const result = runCodex(truncated(patchText));
    check(`codex malformed ${label}`, result, 'deny');
    assert.match(result.message, /Gate G/, label);
  }
  check(
    'codex malformed escaped unrelated path',
    runCodex(
      truncated(
        JSON.stringify(text.replace('.mcp.json', 'docs/notes.md')).replaceAll(
          '/',
          '\\/',
        ),
      ),
    ),
    'none',
  );
  return escaped.length;
}

// Codex continues a call when its hook fails, so malformed payloads naming a
// protected target must still produce an explicit deny on stdout.
function verifyMalformedCodexPayloads() {
  const text = '*** Begin Patch\n*** Add File: .mcp.json\n+{}\n*** End Patch';
  const cases = [
    [
      'truncated JSON',
      `{"hook_event_name":"PreToolUse","tool_name":"apply_patch","tool_input":{"command":${JSON.stringify(text).slice(0, -12)}`,
    ],
    ['string tool_input', { tool_name: 'apply_patch', tool_input: text }],
    ['missing tool_name', { tool_input: { command: text } }],
    [
      'missing event',
      JSON.stringify({
        tool_name: 'apply_patch',
        tool_input: { command: text },
      }),
    ],
    [
      'missing cwd',
      { tool_name: 'Bash', tool_input: { command: 'echo {} > .mcp.json' } },
    ],
    [
      'argv command',
      {
        tool_name: 'Bash',
        tool_input: { command: ['bash', '-lc', 'echo {} > .mcp.json'] },
      },
    ],
  ];
  for (const [label, payload] of cases) {
    const result = runCodex(payload);
    check(`codex ${label}`, result, 'deny');
    assert.match(result.message, /Gate G/, label);
  }
  const escaped = verifyEscapedMalformedPayloads(text);
  check('codex non-JSON unrelated text', runCodex('not json'), 'none');
  console.log(
    `[OK] Codex emits an explicit deny for ${cases.length + escaped} malformed payloads naming a protected target`,
  );
}

// A case-insensitive filesystem reaches the installer through any case.
function verifyInstallerCase() {
  const source = path.join(temp, 'goldband-src');
  const env = { GOLDBAND_GIT_HOOKS_DIR: path.join(temp, 'git-hooks') };
  if (!fs.existsSync(path.join(source, 'INSTALL.SH'))) {
    console.log('[SKIP] installer case: the file system is case-sensitive');
    return;
  }
  const command = './INSTALL.SH style-gate';
  const result = runCodex(
    { ...bash(command), cwd: source },
    { env, cwd: source },
  );
  check(`codex ${command}`, result, 'deny');
}

function verifyInstaller() {
  const source = path.join(temp, 'goldband-src');
  const hooksDir = path.join(temp, 'git-hooks');
  const other = path.join(temp, 'other-project');
  for (const dir of [source, hooksDir, other])
    fs.mkdirSync(dir, { recursive: true });
  for (const dir of [source, other])
    fs.writeFileSync(path.join(dir, 'install.sh'), '#!/bin/sh\n', {
      mode: 0o755,
    });
  fs.writeFileSync(path.join(hooksDir, '.goldband-source'), `${source}\n`);
  const env = { GOLDBAND_GIT_HOOKS_DIR: hooksDir };
  const installer = [
    ['./install.sh style-gate', source],
    ['bash install.sh hooks', source],
    [`${source}/install.sh`, project],
    [`cd ${source} && ./install.sh codex-hooks`, project],
  ];
  for (const [command, cwd] of installer) {
    const options = { env, cwd };
    for (const [mode, expected] of [
      ['default', 'ask'],
      ['auto', 'ask'],
      ['bypassPermissions', 'deny'],
    ]) {
      const result = runClaude(
        { ...bash(command), cwd, permission_mode: mode },
        options,
      );
      check(`claude ${mode} ${command}`, result, expected);
      assert.match(result.message, /Goldband installer/, command);
    }
    check(
      `codex ${command}`,
      runCodex({ ...bash(command), cwd }, options),
      'deny',
    );
  }
  for (const command of ['./install.sh style-gate', 'bash install.sh']) {
    const options = { env, cwd: other };
    check(
      `claude other ${command}`,
      runClaude(
        { ...bash(command), cwd: other, permission_mode: 'default' },
        options,
      ),
      'none',
    );
    check(
      `codex other ${command}`,
      runCodex({ ...bash(command), cwd: other }, options),
      'none',
    );
  }
  console.log(
    '[OK] Gate G: only the recorded Goldband installer is a protected operation',
  );
}

// Gate A judges GOLDBAND_MAX_* against the style checker's own defaults.
function verifyStyleLimitDefaults() {
  const {
    STYLE_LIMIT_DEFAULTS,
  } = require('../hooks/scripts/lib/hook-router/gate-bypass-rules.js');
  const configPath = path.join(root, 'scripts/lib/code-style/config.mjs');
  const names = [
    ...fs
      .readFileSync(configPath, 'utf8')
      .matchAll(/parsePositiveInt\(\s*'(GOLDBAND_MAX_\w+)'/g),
  ].map((match) => match[1]);
  assert.deepEqual([...names].sort(), Object.keys(STYLE_LIMIT_DEFAULTS).sort());
  const printConfig = `import(${JSON.stringify(configPath)}).then((m) => process.stdout.write(JSON.stringify(m.config)))`;
  const readConfig = (extra) => {
    const result = spawnSync(
      process.execPath,
      ['--input-type=module', '-e', printConfig],
      {
        cwd: temp,
        encoding: 'utf8',
        env: { ...baseEnv(), ...extra },
      },
    );
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  const shifted = Object.fromEntries(
    Object.entries(STYLE_LIMIT_DEFAULTS).map(([name, value]) => [
      name,
      String(value + 1),
    ]),
  );
  const asDefaults = Object.fromEntries(
    Object.entries(STYLE_LIMIT_DEFAULTS).map(([name, value]) => [
      name,
      String(value),
    ]),
  );
  assert.deepEqual(readConfig(asDefaults), readConfig({}));
  assert.notDeepEqual(readConfig(shifted), readConfig({}));
  console.log(
    '[OK] Gate A style-limit defaults match scripts/lib/code-style/config.mjs',
  );
}

// A command the shared parser cannot read is denied in every mode by both
// hosts, never reported safe.
function verifyAnalysisFailures() {
  for (const command of gateAAnalysisFailureCases) {
    for (const mode of claudeModes) {
      const result = runClaude({ ...bash(command), permission_mode: mode });
      check(`claude ${mode} ${command}`, result, 'deny');
      assert.match(result.message, /\(shell-analysis-failed\)/, command);
      assert.match(result.message, /Simplify the command/, command);
    }
    check(`codex ${command}`, runCodex(bash(command)), 'deny');
  }
  console.log(
    `[OK] Gate A: ${gateAAnalysisFailureCases.length} unanalyzable commands denied in every mode of both hosts`,
  );
}

// The source `.` of another tool's install subcommand is not a write of the
// destination itself.
function verifyForeignInstall() {
  const command = 'cargo install --path . --root ~';
  const options = { cwd: home };
  const payload = { ...bash(command), cwd: home, permission_mode: 'auto' };
  check(`claude ${command}`, runClaude(payload, options), 'none');
  check(`codex ${command}`, runCodex({ ...payload }, options), 'none');
  console.log('[OK] Gate G: foreign install subcommands');
}

// Launch forms of the recorded installer, and forms that do not run it.
function verifyInstallerForms() {
  const source = path.join(temp, 'goldband-src');
  const env = { GOLDBAND_GIT_HOOKS_DIR: path.join(temp, 'git-hooks') };
  for (const [command, cwd, expected] of [
    ['env -S "bash ./install.sh"', source, 'deny'],
    [`env -C ${source} ./install.sh`, project, 'deny'],
    [`env -C ${source} sh -c ./install.sh`, project, 'deny'],
    ['timeout -k5 10 ./install.sh', source, 'deny'],
    ['stdbuf -o0 ./install.sh', source, 'deny'],
    ['chrt -f 10 ./install.sh', source, 'deny'],
    ['arch -e A=1 -arm64 ./install.sh', source, 'deny'],
    ['noglob ./install.s{h,x}', source, 'deny'],
    ['./install.s[h]', source, 'deny'],
    ['bash -n install.sh', source, 'none'],
    ['bash -s install.sh', source, 'none'],
    ['command -v ./install.sh', source, 'none'],
  ]) {
    const options = { env, cwd };
    const claude = runClaude(
      { ...bash(command), cwd, permission_mode: 'bypassPermissions' },
      options,
    );
    check(`claude ${command}`, claude, expected);
    check(
      `codex ${command}`,
      runCodex({ ...bash(command), cwd }, options),
      expected,
    );
  }
  console.log(
    '[OK] Gate G: installer launch forms resolve through env, env -C, and shells',
  );
}

verifyAnalysisCost();
verifyGateA();
verifyAnalysisFailures();
verifyGitLaunches();
verifyAnalysisLimits();
verifyForeignInstall();
verifyMarkerFileTools();
verifyGateG();
verifyShellForms();
verifyShellResolution();
verifyPatchForms();
verifyToolTargets();
verifyMalformedCodexPayloads();
verifyInstaller();
verifyInstallerForms();
verifyInstallerCase();
verifyStyleLimitDefaults();
