const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  configIncludes,
  isGitConfig,
  isGlobalGitConfig,
} = require('./git-config-files');
const {
  fold,
  foldedVariants,
  isWithin,
  pathVariants,
  realpathOrNull,
} = require('./path-variants');
const {
  configRole,
  isScratchPath,
  scratchAnchors,
} = require('./scratch-paths');

// One authoritative list of files that control agents and gates. Gate A owns
// the style-gate marker; Gate G owns every other surface. Host adapters map a
// match to their native response and never keep a second list.
// `claudeBuiltin`: Claude Code already asks before its file tools write it.
// `projectScoped`: a scratch copy of it configures no running session.
// Names compare case-folded: case-insensitive filesystems such as APFS treat
// `.Claude/Settings.json` as `.claude/settings.json`, and over-matching on a
// case-sensitive filesystem is the safe direction.
const NO_STYLE_GATE_MARKER = '.goldband-no-style-gate';
const PATH_VARIABLES = new Set([
  'HOME',
  'XDG_CONFIG_HOME',
  'ZDOTDIR',
  'GOLDBAND_GIT_HOOKS_DIR',
]);

function readInstallerSource(gitHooksDir) {
  try {
    const raw = fs.readFileSync(
      path.join(gitHooksDir, '.goldband-source'),
      'utf8',
    );
    const source = raw.split('\n')[0].trim();
    return source && path.isAbsolute(source) ? source : null;
  } catch {
    return null;
  }
}

// Work one call may spend resolving paths before Gate G reports an analysis
// failure: directories glob walks visit, resolved target paths, and working
// directories that static cd and pushd commands may leave.
const ANALYSIS_LIMITS = {
  visits: 20000,
  paths: 20000,
  cwds: 256,
  globMilliseconds: 2000,
};

function analysisLimitExceeded(name) {
  const error = new Error(`Gate G analysis limit exceeded: ${name}`);
  error.gateAnalysisLimit = true;
  return error;
}

function spend(budget, name, amount) {
  budget[name] -= amount;
  if (budget[name] < 0) throw analysisLimitExceeded(name);
}

// The cheap part of the context: enough to expand and resolve path words.
function pathContext(input, env = process.env) {
  const cwd =
    typeof input?.cwd === 'string' && input.cwd
      ? path.resolve(input.cwd)
      : process.cwd();
  return {
    env,
    home: env.HOME || os.homedir(),
    // The call's starting directory; `cwds` also gains static cd targets.
    workdir: cwd,
    cwds: [cwd],
    budget: {
      ...ANALYSIS_LIMITS,
      globMilliseconds: globMilliseconds(env),
      globs: new Map(),
    },
  };
}

// GOLDBAND_GATE_GLOB_MS may only shorten the glob walk deadline.
function globMilliseconds(env) {
  const value = Number(env.GOLDBAND_GATE_GLOB_MS);
  return Number.isInteger(value) && value > 0
    ? Math.min(value, ANALYSIS_LIMITS.globMilliseconds)
    : ANALYSIS_LIMITS.globMilliseconds;
}

// Adds the protected-path anchors, which read the filesystem.
function protectionAnchors(context) {
  const { env, home } = context;
  const xdg = env.XDG_CONFIG_HOME || path.join(home, '.config');
  const gitHooksDir =
    env.GOLDBAND_GIT_HOOKS_DIR || path.join(xdg, 'goldband', 'git-hooks');
  const zdotdirs = [...new Set([env.ZDOTDIR || home, home])];
  const source = readInstallerSource(gitHooksDir);
  return {
    ...context,
    // Anchors below are case-folded; compare them with fold(target).
    homes: foldedVariants(home),
    goldbandRoots: [
      ...foldedVariants(path.join(xdg, 'goldband')),
      ...foldedVariants(gitHooksDir),
    ],
    zshenvFiles: zdotdirs.flatMap((dir) =>
      foldedVariants(path.join(dir, '.zshenv')),
    ),
    gitConfigFiles: [
      path.join(xdg, 'git', 'config'),
      ...configIncludes(path.join(home, '.gitconfig'), home),
      ...configIncludes(path.join(xdg, 'git', 'config'), home),
    ].flatMap(foldedVariants),
    installer: source ? realpathOrNull(path.join(source, 'install.sh')) : null,
    ...scratchAnchors(context),
  };
}

// `~` is this user's home; `~name` is read as a sibling of it, where macOS
// and Linux keep home directories.
function expandTilde(value, context) {
  const match = /^~([A-Za-z0-9._-]*)(?=\/|$)/.exec(value);
  if (!match) return value;
  const user = match[1];
  const home =
    !user || user === os.userInfo().username
      ? context.home
      : path.join(path.dirname(context.home), user);
  return home + value.slice(match[0].length);
}

function variableValue(name, context) {
  if (name === 'HOME') return context.home;
  // Relative to the directory the word resolves in.
  if (name === 'PWD') return '.';
  return PATH_VARIABLES.has(name) ? context.env[name] || '' : null;
}

const PARAMETER =
  /\$\{([A-Za-z_][A-Za-z0-9_]*)(?:(:?[-=?+]|[%#]{1,2})([^}]*))?\}|\$([A-Za-z_][A-Za-z0-9_]*)/g;

// `${NAME:-word}` and `${NAME:=word}` read as word, expanded, when NAME is
// empty; other operator forms read as NAME's value. `~+` and `$PWD` are the
// working directory.
function expandPathWord(word, context) {
  const value = expandTilde(String(word).replace(/^~\+(?=\/|$)/, '.'), context);
  return value.replace(PARAMETER, (match, ...groups) => {
    const [braced, operator, operand, bare] = groups;
    const current = variableValue(braced || bare, context);
    if (current === null) return match;
    return /^:?[-=]$/.test(operator || '') && !current
      ? expandPathWord(operand, context)
      : current;
  });
}

// Glob characters, including the zsh `(a|b)` group and glob qualifier and the
// bash extglob `@(...)` family. The parser expands braces before this.
const GLOB_CHARACTERS = /[*?[(]/;

// A group or qualifier may match any text, so it reads as `*`, together with
// a `*` it follows so `*(D)` does not become `**`; a qualifier such as `(D)`
// may also include dot files, so every wildcard segment of a word with a
// group does. Matching more existing names than the shell would is the safe
// direction.
function globPattern(word) {
  if (!word.includes('(')) return word;
  return word
    .replace(/\*?[@!+?]?\([^()]*\)/g, '*')
    .split('/')
    .map((part) =>
      /^[*?[]/.test(part) && part !== '**' ? `{.,}${part}` : part,
    )
    .join('/');
}

// Existing paths a glob word names in cwd. A walk past the call's visit
// budget fails the analysis, so a pattern is never reported as matching
// nothing.
// Reads {jobs: [{pattern, cwd}], visits} on stdin and writes the matches of
// each job and the visits left.
const GLOB_WALKER = `
const fs = require('fs');
const { jobs, visits } = JSON.parse(fs.readFileSync(0, 'utf8'));
let left = visits;
const exclude = () => --left < 0;
const matches = jobs.map(({ pattern, cwd }) =>
  left < 0 ? [] : fs.globSync(pattern, { cwd, exclude }));
process.stdout.write(JSON.stringify({ matches, visits: left }));
`;

// Glob walks run in a child process killed at the call's deadline: a
// directory read can block, as on a macOS privacy-protected folder, where no
// in-process check interrupts it, and Codex lets a call continue when its
// hook times out.
function walkGlobs(jobs, budget) {
  budget.deadline ??= Date.now() + budget.globMilliseconds;
  const timeout = budget.deadline - Date.now();
  if (timeout <= 0) throw analysisLimitExceeded('time');
  const result = spawnSync(process.execPath, ['-e', GLOB_WALKER], {
    input: JSON.stringify({ jobs, visits: budget.visits }),
    encoding: 'utf8',
    timeout,
    killSignal: 'SIGKILL',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error?.code === 'ETIMEDOUT') throw analysisLimitExceeded('time');
  if (result.status !== 0) throw new Error('Glob walk failed');
  const output = JSON.parse(result.stdout);
  budget.visits = output.visits;
  if (budget.visits < 0) throw analysisLimitExceeded('visits');
  return output.matches;
}

function globKey(word, cwd) {
  return JSON.stringify([cwd, word]);
}

// Walks every glob the words name in each working directory in one child.
function prefetchGlobs(words, context) {
  const jobs = new Map();
  for (const word of words) {
    if (typeof word !== 'string' || !word) continue;
    const expanded = expandPathWord(word, context);
    if (!GLOB_CHARACTERS.test(expanded)) continue;
    for (const cwd of context.cwds) {
      const key = globKey(expanded, cwd);
      if (!context.budget.globs.has(key))
        jobs.set(key, { word: expanded, cwd });
    }
  }
  if (jobs.size === 0) return;
  const work = [...jobs.values()];
  const found = walkGlobs(
    work.map(({ word, cwd }) => ({ pattern: globPattern(word), cwd })),
    context.budget,
  );
  work.forEach(({ word, cwd }, index) =>
    context.budget.globs.set(globKey(word, cwd), found[index]),
  );
}

function globMatches(word, cwd, budget) {
  const suffix = word.endsWith('/') ? '/' : '';
  const key = globKey(word, cwd);
  if (!budget.globs.has(key))
    budget.globs.set(
      key,
      walkGlobs([{ pattern: globPattern(word), cwd }], budget)[0],
    );
  return budget.globs
    .get(key)
    .map((match) => path.resolve(cwd, match) + suffix);
}

// Locations an expanded shell word names in cwd: the literal word, which an
// unmatched glob leaves in place, and every existing path a glob matches.
function wordLocations(expanded, cwd, budget) {
  const literal = path.resolve(cwd, expanded);
  return GLOB_CHARACTERS.test(expanded)
    ? [literal, ...globMatches(expanded, cwd, budget)]
    : [literal];
}

// Every plausible location of a written word: lexical and symlink-resolved,
// relative to each working directory the command may run in.
function resolveTargetPaths(word, context) {
  const expanded = expandPathWord(word, context);
  const locations = context.cwds.flatMap((cwd) =>
    wordLocations(expanded, cwd, context.budget),
  );
  spend(context.budget, 'paths', locations.length);
  return [...new Set(locations.flatMap(pathVariants))];
}

function homeFiles(context, relative) {
  return context.homes.map((home) => path.join(home, relative));
}

function hasSegmentPair(target, first, second) {
  const parts = target.split(path.sep);
  return parts.some(
    (part, index) => part === first && parts[index + 1] === second,
  );
}

function parentName(target) {
  return path.basename(path.dirname(target));
}

function isCodexUserConfig(target, context) {
  return (
    ['.codex/rules', '.codex/hooks'].some((relative) =>
      homeFiles(context, relative).some((root) => isWithin(target, root)),
    ) ||
    homeFiles(context, '.codex/config.toml').includes(target) ||
    homeFiles(context, '.codex/hooks.json').includes(target)
  );
}

// Installed plugins and their manifests run as hooks; `data/` holds the
// plugins' own runtime state.
function isClaudePlugins(target, context) {
  return context.homes.some((home) => {
    const root = path.join(home, '.claude', 'plugins');
    return isWithin(target, root) && !isWithin(target, path.join(root, 'data'));
  });
}

const PROTECTED_SURFACES = [
  {
    id: 'no-style-gate-marker',
    gate: 'A',
    description: `the ${NO_STYLE_GATE_MARKER} style-gate opt-out marker`,
    // Removing the marker re-enables the gate.
    allowsRemoval: true,
    matches: (target) => path.basename(target) === NO_STYLE_GATE_MARKER,
  },
  {
    id: 'claude-user-config',
    description: 'Claude Code user configuration (~/.claude.json)',
    claudeBuiltin: true,
    matches: (target, context) =>
      homeFiles(context, '.claude.json').includes(target),
  },
  {
    id: 'claude-settings',
    description: 'Claude Code settings (.claude/settings*.json)',
    claudeBuiltin: true,
    projectScoped: true,
    matches: (target) =>
      parentName(target) === '.claude' &&
      /^settings.*\.json$/.test(path.basename(target)),
  },
  {
    id: 'claude-hooks',
    description: 'Claude Code hooks (.claude/hooks/)',
    claudeBuiltin: true,
    projectScoped: true,
    matches: (target) => hasSegmentPair(target, '.claude', 'hooks'),
  },
  {
    id: 'claude-plugins',
    description: 'Claude Code installed plugins (~/.claude/plugins/)',
    matches: isClaudePlugins,
  },
  {
    id: 'mcp-config',
    description: 'MCP server configuration (.mcp.json)',
    claudeBuiltin: true,
    projectScoped: true,
    matches: (target) => path.basename(target) === '.mcp.json',
  },
  {
    id: 'codex-user-config',
    description:
      'Codex user configuration (~/.codex config, hooks.json, hooks/, rules)',
    matches: isCodexUserConfig,
  },
  {
    id: 'codex-project-config',
    description:
      'Codex project configuration (.codex/config.toml, hooks.json, hooks/)',
    projectScoped: true,
    matches: (target) =>
      hasSegmentPair(target, '.codex', 'hooks') ||
      (parentName(target) === '.codex' &&
        ['config.toml', 'hooks.json'].includes(path.basename(target))),
  },
  {
    id: 'goldband-config',
    description: 'Goldband configuration and installed Git hooks',
    matches: (target, context) =>
      context.goldbandRoots.some((root) => isWithin(target, root)),
  },
  {
    id: 'zsh-environment',
    description: 'zsh environment startup file (.zshenv)',
    // Claude's own protection is known only for $HOME/.zshenv.
    claudeBuiltin: (target, context) =>
      homeFiles(context, '.zshenv').includes(target),
    matches: (target, context) => context.zshenvFiles.includes(target),
  },
  {
    id: 'git-config',
    description: 'Git configuration (.git/config, ~/.gitconfig)',
    projectScoped: (target, context) => !isGlobalGitConfig(target, context),
    matches: isGitConfig,
  },
  {
    id: 'gitleaks-config',
    description: 'gitleaks rules or ignore list',
    projectScoped: true,
    matches: (target) =>
      ['.gitleaks.toml', '.gitleaksignore'].includes(path.basename(target)),
  },
];

// Paths, relative to a directory that receives content this analysis cannot
// list, that would land on a Gate G surface.
const PROTECTED_RELATIVE_PROBES = [
  '.claude/settings.json',
  '.claude/hooks',
  '.claude.json',
  '.mcp.json',
  '.codex/config.toml',
  '.codex/hooks.json',
  '.codex/hooks',
  '.config/goldband',
  '.git/config',
  '.gitconfig',
  '.zshenv',
  '.gitleaks.toml',
  '.gitleaksignore',
];

const SURFACE_BY_ID = new Map(
  PROTECTED_SURFACES.map((surface) => [surface.id, surface]),
);

// Writing or removing a directory that holds protected files changes them.
function containerSurface(target, context) {
  const name = path.basename(target);
  if (name === '.claude') return SURFACE_BY_ID.get('claude-settings');
  if (name === '.codex') {
    return context.homes.includes(path.dirname(target))
      ? SURFACE_BY_ID.get('codex-user-config')
      : SURFACE_BY_ID.get('codex-project-config');
  }
  const anchors = [
    ['claude-user-config', homeFiles(context, '.claude.json')],
    ['codex-user-config', homeFiles(context, '.codex')],
    ['claude-plugins', homeFiles(context, '.claude/plugins')],
    [
      'git-config',
      [...homeFiles(context, '.gitconfig'), ...context.gitConfigFiles],
    ],
    ['goldband-config', context.goldbandRoots],
    ['zsh-environment', context.zshenvFiles],
  ];
  const anchor = anchors.find(([, roots]) =>
    roots.some((root) => root !== target && isWithin(root, target)),
  );
  return anchor ? SURFACE_BY_ID.get(anchor[0]) : null;
}

// A surface flag is a boolean or a function of the case-folded target.
function surfaceFlag(value, target, context) {
  return typeof value === 'function' ? value(target, context) : Boolean(value);
}

// `target` is case-folded.
function surfacesAt(target, context) {
  return [
    ...PROTECTED_SURFACES.filter((item) => item.matches(target, context)),
    containerSurface(target, context),
  ].filter(Boolean);
}

// Surfaces a copy source is on, in the target's role, under every spelling,
// so neither a symlink nor a renamed file lends a surface to other content.
function carriedSurfaces(source, target, context) {
  const variants = foldedVariants(source);
  const role = configRole(target);
  if (variants.some((variant) => configRole(variant) !== role)) return [];
  const [first, ...rest] = variants.map((variant) =>
    surfacesAt(variant, context),
  );
  return first.filter((item) => rest.every((list) => list.includes(item)));
}

// A scratch copy carries a project-level surface from a source in the same
// role on that same surface, whose writes Gate G already authorized. Any other
// write or removal, even in scratch, changes content no one approved.
// `sourceOf` returns the path a copy duplicates there, or null.
function surfaceForPath(target, operation, context, sourceOf) {
  const candidates = surfacesAt(target, context);
  if (!candidates.length) return null;
  const scratch = Boolean(sourceOf) && isScratchPath(target, context);
  const source = scratch ? sourceOf() : null;
  const carried = source ? carriedSurfaces(source, target, context) : [];
  const exempt = (item) =>
    carried.includes(item) && surfaceFlag(item.projectScoped, target, context);
  const surface = candidates.find((item) => !exempt(item));
  if (!surface) return null;
  if (operation === 'remove' && surface.allowsRemoval) return null;
  return surface;
}

const BUILTIN_NAMES = new Set([
  '.claude',
  '.claude.json',
  '.mcp.json',
  '.zshenv',
]);

// Claude's own prompt is known to match only the lower-case names.
function canonicalCase(target) {
  const parts = target.split(path.sep);
  const index = parts.findLastIndex((part) => BUILTIN_NAMES.has(fold(part)));
  return (
    index !== -1 &&
    parts.slice(index, index + 2).every((part) => part === fold(part))
  );
}

function matchPath(target, operation, context, sourceOf) {
  const key = fold(target);
  const surface = surfaceForPath(key, operation, context, sourceOf);
  if (!surface) return null;
  const claudeBuiltin =
    surfaceFlag(surface.claudeBuiltin, key, context) && canonicalCase(target);
  return { surface, path: target, claudeBuiltin };
}

// Returns the first protected match for written or removed words, preferring
// Gate A so a bypass is never reported as an authorizable configuration edit.
function matchProtectedTargets(targets, context) {
  prefetchGlobs(
    targets.map((target) => target.word),
    context,
  );
  const resolved = targets.flatMap((item) =>
    typeof item.word === 'string' && item.word
      ? resolveTargetPaths(item.word, context).map((target) => ({
          ...item,
          target,
          key: fold(target),
        }))
      : [],
  );
  const writers = new Map();
  for (const item of resolved.filter(({ operation }) => operation === 'write'))
    writers.set(item.key, [...(writers.get(item.key) || []), item]);
  // A copy carries its source only when each path the call writes above it is
  // a directory the same copy reproduces from a real directory; any other
  // write there may leave a link before the copy runs.
  const reproduces = (item, other) =>
    other.op === item.op && isRealDirectory(other.source);
  const relinked = (item) => {
    for (let dir = path.dirname(item.key); dir !== path.dirname(dir); ) {
      if ((writers.get(dir) || []).some((other) => !reproduces(item, other)))
        return true;
      dir = path.dirname(dir);
    }
    return false;
  };
  let found = null;
  for (const item of resolved) {
    const sourceOf =
      item.source && (() => (relinked(item) ? null : item.source));
    const match = matchPath(item.target, item.operation, context, sourceOf);
    if (match?.surface.gate === 'A') return match;
    found ||= match;
  }
  return found;
}

function isGoldbandInstaller(word, context) {
  if (!context.installer || typeof word !== 'string' || !word) return false;
  const installer = fold(context.installer);
  const expanded = expandPathWord(word, context);
  return context.cwds.some((cwd) =>
    wordLocations(expanded, cwd, context.budget).some(
      (location) => fold(realpathOrNull(location) || '') === installer,
    ),
  );
}

function isRealDirectory(location) {
  try {
    return Boolean(location) && fs.lstatSync(location).isDirectory();
  } catch {
    return false;
  }
}

function isDirectoryTarget(word, context) {
  if (word.endsWith('/')) return true;
  return resolveTargetPaths(word, context).some((target) => {
    try {
      return fs.statSync(target).isDirectory();
    } catch {
      return false;
    }
  });
}

module.exports = {
  GLOB_CHARACTERS,
  PROTECTED_RELATIVE_PROBES,
  PROTECTED_SURFACES,
  expandPathWord,
  globMatches,
  isDirectoryTarget,
  isGoldbandInstaller,
  matchProtectedTargets,
  analysisLimitExceeded,
  pathContext,
  protectionAnchors,
};
