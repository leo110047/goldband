// Gate G cases for scratch copies: below $TMPDIR, a recursive copy may
// duplicate project-level surfaces from a source in the same role on the same
// surface, while removals, direct writes, copies of other content, homes,
// relocated user configuration, global Git configuration, and configuration
// the call's session reads stay protected. Run by test-gate-protection.mjs
// through both native hook adapters.
import fs from 'node:fs';
import path from 'node:path';
import {
  bash,
  check,
  home,
  patch,
  project,
  runClaude,
  runCodex,
  temp,
} from './gate-protection-harness.mjs';

const scratch = path.join(temp, 'scratch');
const src = path.join(temp, 'src');
const scratchHome = path.join(scratch, 'home');
const xdg = path.join(temp, 'scratch-xdg');
const include = path.join(scratch, 'inc.gitconfig');
const worktree = path.join(temp, 'worktree');
const repoGit = path.join(scratch, 'repo/.git');
const subGit = path.join(scratch, 'super/.git/modules/sub');
const subWorktree = path.join(temp, 'sub-worktree');
const sepGit = path.join(scratch, 'sep.git');
const sepWorktree = path.join(temp, 'sep-worktree');
const env = { TMPDIR: `${scratch}/`, XDG_CONFIG_HOME: xdg };

function write(file, content = '{}') {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function setUp() {
  for (const file of [
    '.claude/settings.json',
    '.codex/config.toml',
    '.mcp.json',
    '.git/config',
    '.gitleaks.toml',
    '.git/worktrees/wt/config.worktree',
    '.git/modules/sub/config',
  ])
    write(path.join(src, file));
  write(path.join(scratch, 'old/.claude/settings.json'));
  write(path.join(scratch, 'evil/config'), '[core]\n\thooksPath = /dev/null\n');
  fs.mkdirSync(path.join(scratch, 'proj/sub'), { recursive: true });
  fs.mkdirSync(path.join(scratch, 'q'), { recursive: true });
  write(path.join(scratch, 'proj/.claude/hooks/notify.git'), '');
  write(path.join(scratch, 'proj/.claude/settings.json'));
  fs.mkdirSync(path.join(scratch, 'proj/.git'), { recursive: true });
  write(path.join(xdg, 'git/config'), `[include]\n\tpath = ${include}\n`);
  fs.symlinkSync(project, path.join(scratch, 'link'));
  fs.mkdirSync(path.join(temp, 'linksrc'));
  fs.symlinkSync(project, path.join(temp, 'linksrc/lnk'));
  // One copy whose first source is a link to the project and whose second
  // brings settings below the same name.
  fs.mkdirSync(path.join(temp, 'ma'));
  fs.symlinkSync(project, path.join(temp, 'ma/k'));
  write(path.join(temp, 'mb/k/.claude/settings.json'));
  fs.mkdirSync(path.join(scratch, 'd'));
  // A worktree outside scratch whose Git directories are in scratch.
  write(path.join(repoGit, 'worktrees/wt/commondir'), '../..\n');
  write(path.join(worktree, '.git'), `gitdir: ${repoGit}/worktrees/wt\n`);
  write(path.join(subGit, 'worktrees/wt/commondir'), '../..\n');
  write(path.join(subWorktree, '.git'), `gitdir: ${subGit}/worktrees/wt\n`);
  // A --separate-git-dir layout: a `gitdir:` with no `commondir`.
  fs.mkdirSync(sepGit, { recursive: true });
  write(path.join(sepWorktree, '.git'), `gitdir: ${sepGit}\n`);
  // A bare-repository name lent by a symlink to content written elsewhere.
  fs.symlinkSync(path.join(scratch, 'evil'), path.join(scratch, 'fake.git'));
}

// [command, cwd, extra env] whose scratch targets need no authorization.
function allowedCases() {
  return [
    [`cp -R ${project} ${scratch}/snap`, project, {}],
    [`cp -R ${src} ${scratch}/clone`, project, {}],
    [`cp -R ${scratch}/old ${scratch}/old2`, project, {}],
    [`cp -R ${src}/.claude ${scratch}/k/.claude`, project, {}],
    [`cp -R ${src}/.git/config ${repoGit}/config`, project, {}],
    [`rm -r ${scratch}/snap2; cp -R ${project} ${scratch}/snap2`, project, {}],
  ];
}

// [command, cwd, extra env]: direct writes and foreign content still need
// the user's authorization in scratch.
function directCases() {
  const proj = path.join(scratch, 'proj');
  return [
    [`echo {} > ${scratch}/x/.claude/settings.json`, project, {}],
    [`touch ${scratch}/x/.claude/hooks/pre.sh`, project, {}],
    [`echo {} > ${scratch}/x/.mcp.json`, project, {}],
    [`echo x > ${scratch}/x/.codex/config.toml`, project, {}],
    [`echo x >> ${scratch}/x/.git/config`, project, {}],
    [`echo x > ${scratch}/x/.gitleaksignore`, project, {}],
    [`cp ${src}/.git/config ${scratch}/y/.git/config`, project, {}],
    [`cp -R ${scratch}/evil ${scratch}/clone2/.git`, project, {}],
    [
      `cp -R ${scratch}/fake.git/config ${scratch}/clone3/.git/config`,
      project,
      {},
    ],
    [`cp -R ${scratch}/new ${scratch}/copy`, project, {}],
    ['printf x > t && mv t .claude/settings.json', project, {}],
    ['printf x > c && mv c .git/config', project, {}],
    ['mv missing .mcp.json', project, {}],
    [`rm -r ${scratch}/old/.claude`, project, {}],
    [`rm ${scratch}/old/.claude/settings.json`, project, {}],
    [
      `ln -s ${project} ${scratch}/l && cp -R ${src}/.claude ${scratch}/l/`,
      project,
      {},
    ],
    [
      `cp -R ${temp}/linksrc ${scratch}/lc && cp -R ${src}/.claude ${scratch}/lc/lnk/`,
      project,
      {},
    ],
    [`cp -R ${temp}/ma/k ${temp}/mb/k ${scratch}/d/`, project, {}],
    [
      `cp -R ${src}/.claude/settings.json ${scratch}/r/.claude/settings.local.json`,
      project,
      {},
    ],
    [
      `cp -R ${src}/.codex/config.toml ${scratch}/r/.codex/hooks.json`,
      project,
      {},
    ],
    ['ln -s ../.claude/settings.local.json sub/l && echo {} > sub/l', proj, {}],
  ];
}

// [command, cwd, extra env]: configuration a session reads, and paths
// outside scratch, stay protected for copies too.
function liveCases() {
  const proj = path.join(scratch, 'proj');
  const sub = path.join(proj, 'sub');
  const homeEnv = { HOME: scratchHome };
  return [
    [`cp -R ${src}/.claude .`, proj, {}],
    [`cp -R ${src}/.claude ..`, sub, {}],
    [`cp -R ${src}/.codex ..`, sub, {}],
    [`cp -R ${src}/.mcp.json ..`, sub, {}],
    [`cp -R ${src}/.git ..`, sub, {}],
    ['rm -r ../.claude', sub, {}],
    ['rm ../.claude/hooks/notify.git', sub, {}],
    [
      `rm ${proj}/.claude/settings.json`,
      `${scratch}/q`,
      { CLAUDE_PROJECT_DIR: proj },
    ],
    [`cp -R ${src}/.git/config ${repoGit}/config`, worktree, {}],
    [
      `cp -R ${src}/.git/worktrees/wt/config.worktree ${repoGit}/worktrees/wt/config.worktree`,
      worktree,
      {},
    ],
    [`cp -R ${src}/.git/modules/sub/config ${subGit}/config`, subWorktree, {}],
    [`cp -R ${src}/.git/config ${sepGit}/config`, sepWorktree, {}],
    [`cp -R ${src}/.git/config ${include}`, project, {}],
    [`cp -R ${src}/.claude ${scratchHome}/`, project, homeEnv],
    [`cp -R ${src}/.codex ${scratchHome}/`, project, homeEnv],
    [
      `cp -R ${src}/.claude ${scratch}/cfg/`,
      project,
      { CLAUDE_CONFIG_DIR: `${scratch}/cfg/.claude` },
    ],
    [
      `cp -R ${src}/.codex ${scratch}/cfg/`,
      project,
      { CODEX_HOME: `${scratch}/cfg/.codex` },
    ],
    [`cp -R ${src}/.claude ${scratch}/link/kit/`, home, {}],
    [`cp -R ${src}/.claude ${temp}/outside/`, project, {}],
    [`cp -R ${src}/.claude ${scratch}/z/`, project, { TMPDIR: '/' }],
  ];
}

function verifyShellCases(cases, exempt) {
  for (const [command, cwd, extra] of cases) {
    const options = { cwd, env: { ...env, ...extra } };
    const payload = { ...bash(command), cwd, permission_mode: 'auto' };
    const label = `${command} (cwd ${cwd})`;
    const claude = runClaude(payload, options);
    check(`claude ${label}`, claude, exempt ? 'none' : 'ask');
    check(
      `codex ${label}`,
      runCodex(payload, options),
      exempt ? 'none' : 'deny',
    );
  }
}

// File tools write content directly, so scratch does not exempt them.
function verifyFileTools() {
  const file = `${scratch}/w/.claude/settings.json`;
  const writeCall = {
    tool_name: 'Write',
    tool_input: { file_path: file, content: '{}' },
    cwd: project,
    permission_mode: 'auto',
  };
  check('claude scratch Write', runClaude(writeCall, { env }), 'ask');
  const added = patch([`*** Add File: ${scratch}/p/.mcp.json`, '+{}']);
  check('codex scratch apply_patch', runCodex(added, { env }), 'deny');
}

// Gate A owns the style-gate marker, including a move onto it.
function verifyMarkerMove() {
  const payload = bash('touch m && mv m .goldband-no-style-gate');
  check(
    'claude marker move',
    runClaude({ ...payload, permission_mode: 'auto' }),
    'deny',
  );
  check('codex marker move', runCodex(payload), 'deny');
}

export function verifyScratchCopies() {
  setUp();
  const allowed = allowedCases();
  const kept = [...directCases(), ...liveCases()];
  verifyShellCases(allowed, true);
  verifyShellCases(kept, false);
  verifyFileTools();
  verifyMarkerMove();
  console.log(
    `[OK] Gate G: ${allowed.length} scratch copies pass; ${kept.length + 3} removals and direct, foreign, relinked, or live writes stay protected`,
  );
}
