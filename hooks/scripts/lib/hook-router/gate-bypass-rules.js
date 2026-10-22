const { commandLaunch, privilegedLaunch } = require('./shell-invocation');
const { shellCommands } = require('./shell-commands');
const {
  configAliasDefinition,
  configEdits,
  configReads,
  configWritesHooksPath,
  isHookControlKey,
  isHooksPathAssignment,
  newRepositoryConfig,
} = require('./git-config-args');
const { GIT_BUILTINS, aliasValues, recordAlias } = require('./git-aliases');
const { NO_VERIFY_SPECS, noVerifyArgument } = require('./git-no-verify');

// Gate A: explicit shell operations that disable or relax a Git or Goldband
// gate. Rules judge the effect of a value, not the variable name alone.

// Defaults of scripts/lib/code-style/config.mjs; raising one relaxes the gate.
// test-gate-protection.mjs asserts these stay equal to the checker's defaults.
const STYLE_LIMIT_DEFAULTS = {
  GOLDBAND_MAX_FILE_LINES: 600,
  GOLDBAND_MAX_FN_LINES: 50,
  GOLDBAND_MAX_PARAMS: 4,
  GOLDBAND_MAX_COMPLEXITY: 12,
  GOLDBAND_MAX_TEXT_FILE_BYTES: 1024 * 1024,
  GOLDBAND_MAX_GENERATED_TEXT_FILE_BYTES: 16 * 1024 * 1024,
  GOLDBAND_MAX_BINARY_FILE_BYTES: 512 * 1024,
};

const GATE_A_RULES = [
  { rule: 'git-no-verify', summary: 'git --no-verify or commit -n' },
  {
    rule: 'git-hookspath-override',
    summary: 'core.hooksPath or include override',
  },
  {
    rule: 'git-hookspath-config',
    summary: 'git config core.hooksPath or include write, or --edit',
  },
  { rule: 'git-alias-bypass', summary: 'git alias that bypasses a hook' },
  {
    rule: 'git-dir-relocated',
    summary: 'git --git-dir, GIT_DIR, or GIT_COMMON_DIR for a hook command',
  },
  { rule: 'git-config-env-override', summary: 'GIT_CONFIG_* tampering' },
  { rule: 'goldband-gate-disabled', summary: 'Goldband gate variables' },
  { rule: 'style-limit-relaxed', summary: 'GOLDBAND_MAX_* above default' },
  { rule: 'project-hooks-disabled', summary: 'HUSKY, SKIP, LEFTHOOK' },
  { rule: 'no-style-gate-marker', summary: '.goldband-no-style-gate' },
  {
    rule: 'git-global-config-relocated',
    summary: 'GIT_CONFIG_GLOBAL, or HOME/XDG_CONFIG_HOME for git',
  },
  { rule: 'shell-analysis-failed', summary: 'command could not be analyzed' },
];

const DECLARATION_BUILTINS = new Set([
  'export',
  'declare',
  'typeset',
  'local',
  'readonly',
]);
const ASSIGNMENT = /^([A-Za-z_][A-Za-z0-9_]*)=([\s\S]*)$/;
const HOOKS_PATH = 'core.hookspath';
// Text that may set a hook-control key or define an alias.
const HOOK_CONTROL_TEXT =
  /core\.hookspath|include\.path|includeif\..*\.path|alias\./s;
const ALIAS_KEY = /^alias\./i;

function declarationEffects(words) {
  const unexport = words[0] === 'export' && words.includes('-n');
  return words.slice(1).flatMap((word) => {
    if (word.startsWith('-')) return [];
    const match = ASSIGNMENT.exec(word);
    if (unexport) return [{ name: match?.[1] || word, unset: true }];
    return match ? [{ name: match[1], value: match[2] }] : [];
  });
}

function builtinEffects(words) {
  if (DECLARATION_BUILTINS.has(words[0])) return declarationEffects(words);
  if (words[0] !== 'unset') return [];
  return words
    .slice(1)
    .filter((word) => !word.startsWith('-'))
    .map((word) => ({ name: word, unset: true }));
}

// Environment changes made by one invocation: prefix assignments, env and
// wrapper launchers, sudo/doas operands, declaration builtins, unset, and bare
// assignment statements; `words` is the command they apply to.
function invocationEffects(rawWords) {
  const launch = commandLaunch(rawWords.map(String));
  if (launch.words[0] === 'su')
    return {
      effects: [...launch.effects, { privilegedReset: true }],
      words: launch.words,
    };
  const privileged = privilegedLaunch(launch.words);
  if (!privileged)
    return {
      effects: [...launch.effects, ...builtinEffects(launch.words)],
      words: launch.words,
    };
  const child = invocationEffects(privileged.words);
  return {
    effects: [...launch.effects, ...privileged.effects, ...child.effects],
    words: child.words,
  };
}

function goldbandOverrideIndex(env) {
  const count = Number.parseInt(env.GIT_CONFIG_COUNT || '', 10);
  if (!(count > 0)) return null;
  // Git applies entries in order; the last core.hooksPath entry wins.
  for (let index = count - 1; index >= 0; index -= 1) {
    if (
      String(env[`GIT_CONFIG_KEY_${index}`] || '').toLowerCase() === HOOKS_PATH
    )
      return index;
  }
  return null;
}

function configCountRelaxes(effect, overrideIndex) {
  if (effect.unset) return true;
  if (!/^\d+$/.test(effect.value)) return overrideIndex !== null;
  const count = Number(effect.value);
  return count === 0 || (overrideIndex !== null && count <= overrideIndex);
}

function configEntryRelaxes(effect, effects, env, overrideIndex) {
  const entry = /^GIT_CONFIG_(KEY|VALUE)_(\d+)$/.exec(effect.name);
  if (!entry) return false;
  const index = Number(entry[2]);
  if (index === overrideIndex) {
    if (effect.unset) return true;
    const current = String(env[effect.name] ?? '');
    return entry[1] === 'KEY'
      ? effect.value.toLowerCase() !== current.toLowerCase()
      : effect.value !== current;
  }
  if (effect.unset) return false;
  if (entry[1] === 'KEY') return isEnvControlKey(effect.value);
  const key = effects.find((item) => item.name === `GIT_CONFIG_KEY_${index}`);
  return isEnvControlKey(key ? key.value : env[`GIT_CONFIG_KEY_${index}`]);
}

function isEnvControlKey(key) {
  return isHookControlKey(key) || ALIAS_KEY.test(String(key || ''));
}

function gitConfigEnvRule(effect, effects, env) {
  const overrideIndex = goldbandOverrideIndex(env);
  if (effect.clearAll) return overrideIndex !== null;
  if (effect.name === 'GIT_CONFIG_COUNT')
    return configCountRelaxes(effect, overrideIndex);
  if (effect.name === 'GIT_CONFIG_PARAMETERS')
    return !effect.unset && HOOK_CONTROL_TEXT.test(effect.value.toLowerCase());
  return configEntryRelaxes(effect, effects, env, overrideIndex);
}

function styleLimitRelaxed(effect) {
  const fallback = STYLE_LIMIT_DEFAULTS[effect.name];
  if (fallback === undefined || effect.unset) return false;
  return (
    !/^\d+$/.test(effect.value) ||
    !(Number(effect.value) > 0) ||
    Number(effect.value) > fallback
  );
}

const VALUE_RULES = [
  ['goldband-gate-disabled', 'GOLDBAND_STYLE_GATE', (value) => value === '0'],
  ['goldband-gate-disabled', 'GOLDBAND_SECRET_GATE', (value) => value === '0'],
  [
    'goldband-gate-disabled',
    'GOLDBAND_PROJECT_HOOK_RUNNING',
    (value) => value === '1',
  ],
  ['goldband-gate-disabled', 'GOLDBAND_STYLE_GATE_SCRIPT', () => true],
  ['project-hooks-disabled', 'HUSKY', (value) => value === '0'],
  [
    'project-hooks-disabled',
    'LEFTHOOK',
    (value) => ['0', 'false'].includes(value),
  ],
  ['project-hooks-disabled', 'SKIP', (value) => value !== ''],
];

function environmentRule(effect, effects, env) {
  if (!effect.clearAll && !effect.unset) {
    const valueRule = VALUE_RULES.find(
      ([, name, relaxes]) => name === effect.name && relaxes(effect.value),
    );
    if (valueRule) return valueRule[0];
    if (styleLimitRelaxed(effect)) return 'style-limit-relaxed';
  }
  return gitConfigEnvRule(effect, effects, env)
    ? 'git-config-env-override'
    : null;
}

// Goldband installs core.hooksPath in Git's global configuration, which Git
// reads from $HOME and $XDG_CONFIG_HOME unless GIT_CONFIG_GLOBAL names another
// file. System configuration is not relied on, so GIT_CONFIG_NOSYSTEM passes.
// `git config` reads run no hooks.
function relocatesGlobalConfig(effect, words) {
  const git = words[0] === 'git';
  if (git && gitSubcommandReadsConfig(words)) return false;
  if (effect.name === 'GIT_CONFIG_GLOBAL') return !effect.unset;
  if (!git) return false;
  if (effect.clearAll || effect.name === 'HOME') return true;
  return effect.name === 'XDG_CONFIG_HOME' && !effect.unset;
}

const GIT_DIR_NAMES = new Set(['GIT_DIR', 'GIT_COMMON_DIR']);

// Another repository's configuration can set core.hooksPath for a command
// that runs commit or push hooks.
// A subcommand that runs commit or push hooks, or an alias that may.
function runsHooksOrAlias(subcommand) {
  if (!subcommand) return false;
  return (
    Object.hasOwn(NO_VERIFY_SPECS, subcommand) || !GIT_BUILTINS.has(subcommand)
  );
}

function runsGitHooks(words, withAliases = false) {
  if (words[0] !== 'git') return false;
  const { subcommand } = gitGlobalOptions(words);
  return withAliases
    ? runsHooksOrAlias(subcommand)
    : Object.hasOwn(NO_VERIFY_SPECS, subcommand || '');
}

function relocatesGitDir(effect, words) {
  return (
    GIT_DIR_NAMES.has(effect.name) && !effect.unset && runsGitHooks(words, true)
  );
}

// A template directory supplies the new repository's configuration.
function createsRepository(words) {
  if (words[0] !== 'git') return false;
  return ['clone', 'init'].includes(gitGlobalOptions(words).subcommand);
}

// sudo, doas, and su reset the environment, dropping the core.hooksPath
// entry, and switch HOME; that matters for commands that run hooks.
function relocationRule(effect, words) {
  if (effect.name === 'GIT_TEMPLATE_DIR' && !effect.unset)
    return createsRepository(words) && 'git-hookspath-config';
  if (effect.privilegedReset)
    return runsGitHooks(words) && 'git-global-config-relocated';
  if (relocatesGlobalConfig(effect, words))
    return 'git-global-config-relocated';
  return relocatesGitDir(effect, words) && 'git-dir-relocated';
}

function effectChange(effect) {
  if (effect.privilegedReset) return 'resets it as another user';
  if (effect.clearAll) return 'clears the environment';
  return effect.unset
    ? `unsets ${effect.name}`
    : `sets ${effect.name}=${effect.value}`;
}

function environmentBypass(rawWords, env) {
  const { effects, words } = invocationEffects(rawWords);
  for (const effect of effects) {
    const rule =
      environmentRule(effect, effects, env) || relocationRule(effect, words);
    if (rule) return { rule, detail: `the command ${effectChange(effect)}` };
  }
  return null;
}

// GIT_CONFIG_SYSTEM is passed on because an alias lookup must see it.
const RELOCATING_NAMES = new Set([
  'GIT_TEMPLATE_DIR',
  'HOME',
  'XDG_CONFIG_HOME',
  'GIT_CONFIG_GLOBAL',
  'GIT_CONFIG_SYSTEM',
  ...GIT_DIR_NAMES,
]);

// The configuration relocations one invocation passes to the commands it
// launches, and whether they persist for later commands in the same shell:
// a bare assignment, a declaration builtin, or unset.
function launchedEnvironment(rawWords) {
  const { effects, words } = invocationEffects(rawWords);
  return {
    effects: effects.filter(
      (effect) =>
        effect.clearAll ||
        effect.privilegedReset ||
        RELOCATING_NAMES.has(effect.name),
    ),
    persists:
      words.length === 0 ||
      DECLARATION_BUILTINS.has(words[0]) ||
      words[0] === 'unset',
  };
}

// A relocation made by a launcher, an earlier export, or unset applies to the
// git command that runs in that environment.
function inheritedRelocation(effects, words) {
  for (const effect of effects) {
    const rule = relocationRule(effect, words);
    if (rule)
      return {
        rule,
        detail: `git runs in an environment that ${effectChange(effect)}`,
      };
  }
  return null;
}

const GIT_GLOBAL_VALUE_OPTIONS = new Set([
  '-c',
  '--config-env',
  '-C',
  '--git-dir',
  '--work-tree',
  '--namespace',
  '--attr-source',
]);
// Options that select the repository an alias lookup reads.
const GIT_LOCATOR_OPTIONS = new Set(['-C', '--git-dir', '--work-tree']);

function configOptionValue(words, index) {
  const word = words[index];
  if (word === '-c') return { value: words[index + 1], fromEnv: false };
  if (word === '--config-env')
    return { value: words[index + 1], fromEnv: true };
  if (word.startsWith('--config-env='))
    return { value: word.slice('--config-env='.length), fromEnv: true };
  return null;
}

// A `-c` or `--config-env` alias definition that bypasses a hook. An alias
// value read from the environment is not visible, so it counts.
function configOptionAlias(option, options, depth) {
  const text = String(option.value || '');
  const equals = text.indexOf('=');
  if (equals === -1 || !ALIAS_KEY.test(text)) return null;
  if (option.fromEnv)
    return {
      rule: 'git-alias-bypass',
      detail: 'git --config-env defines an alias from the environment',
    };
  return aliasBypass(
    { key: text.slice(0, equals), value: text.slice(equals + 1) },
    options,
    depth,
  );
}

function gitGlobalOptions(words) {
  const git = { configs: [], locators: [], gitDir: false };
  let index = 1;
  while (words[index]?.startsWith('-')) {
    const word = words[index];
    const name = word.split('=')[0];
    const option = configOptionValue(words, index);
    if (option) git.configs.push(option);
    if (name === '--git-dir') git.gitDir = true;
    const step = GIT_GLOBAL_VALUE_OPTIONS.has(word) ? 2 : 1;
    if (GIT_LOCATOR_OPTIONS.has(name))
      git.locators.push(...words.slice(index, index + step));
    index += step;
  }
  return { ...git, subcommand: words[index], args: words.slice(index + 1) };
}

// An alias set by `git config [set|--add|--replace-all] alias.NAME VALUE`,
// recorded for later statements of the same command.
function gitConfigAlias(args, options, depth) {
  const alias = configAliasDefinition(args);
  if (!alias) return null;
  recordAlias(options.aliases, alias.key, alias.value);
  return aliasBypass(alias, options, depth);
}

function gitSubcommandReadsConfig(words) {
  const git = gitGlobalOptions(words);
  return git.subcommand === 'config' && configReads(git.args);
}

// The shortest alias chain that may need following; deeper fails closed.
const ALIAS_DEPTH_LIMIT = 4;

const shellQuote = (word) => `'${String(word).replaceAll("'", "'\\''")}'`;

// Git runs an alias value as git arguments, or as shell code after `!`, with
// the invocation's arguments appended. Shell code that reads its arguments
// through `$` is not followed.
function aliasBypass(alias, options, depth) {
  const { value, args = [] } = alias;
  const name = alias.key.slice('alias.'.length);
  const failure = {
    rule: 'git-alias-bypass',
    detail: `git alias ${name} could not be analyzed`,
  };
  const shell = value.startsWith('!');
  if (
    depth >= ALIAS_DEPTH_LIMIT ||
    (shell && args.length && value.includes('$'))
  )
    return failure;
  const text = [
    shell ? value.slice(1) : `git ${value}`,
    ...args.map(shellQuote),
  ].join(' ');
  let commands;
  try {
    commands = shellCommands(text);
  } catch {
    return failure;
  }
  for (const command of commands) {
    const words = commandLaunch(command.words.map(String)).words;
    const bypass =
      environmentBypass(command.words.map(String), options.env) ||
      gitBypass(words, options, depth + 1);
    if (bypass)
      return {
        rule: 'git-alias-bypass',
        detail: `git alias ${name} runs a hook bypass (${bypass.rule})`,
      };
  }
  return null;
}

// An alias invoked with options, judged with them: `git ci -n` where
// alias.ci is `commit`.
function aliasInvocationBypass(git, options, depth) {
  if (!git.subcommand || !git.args.some((word) => word.startsWith('-')))
    return null;
  // The lookup reads the hook's configuration, not one the command selects.
  if (options.effects?.some((e) => e.name === 'GIT_CONFIG_SYSTEM' && !e.unset))
    return {
      rule: 'git-alias-bypass',
      detail: `git alias ${git.subcommand} may come from GIT_CONFIG_SYSTEM`,
    };
  let values;
  try {
    values = aliasValues(git, options);
  } catch {
    return {
      rule: 'git-alias-bypass',
      detail: `git alias ${git.subcommand} could not be read`,
    };
  }
  for (const value of values) {
    const bypass = aliasBypass(
      { key: `alias.${git.subcommand}`, value, args: git.args },
      options,
      depth,
    );
    if (bypass) return bypass;
  }
  return null;
}

function gitConfigBypass(args, options, depth) {
  if (configWritesHooksPath(args))
    return {
      rule: 'git-hookspath-config',
      detail: 'git config changes core.hooksPath or a config include',
    };
  if (configEdits(args))
    return {
      rule: 'git-hookspath-config',
      detail: 'git config --edit can change core.hooksPath',
    };
  return gitConfigAlias(args, options, depth);
}

function gitOptionBypass(git, options, depth) {
  for (const option of git.configs) {
    if (isHooksPathAssignment(option.value))
      return {
        rule: 'git-hookspath-override',
        detail:
          'git overrides core.hooksPath or a config include for this command',
      };
    const alias = configOptionAlias(option, options, depth);
    if (alias) return alias;
  }
  return null;
}

// A hook-running subcommand or alias in another repository, or
// configuration for a new repository.
function gitSubcommandBypass(git) {
  if (git.gitDir && runsHooksOrAlias(git.subcommand))
    return {
      rule: 'git-dir-relocated',
      detail: `git ${git.subcommand} reads another repository's hooks setting`,
    };
  const source = ['clone', 'init'].includes(git.subcommand)
    ? newRepositoryConfig(git.args)
    : null;
  return source
    ? {
        rule: 'git-hookspath-config',
        detail: `git ${git.subcommand} can set core.hooksPath through ${source}`,
      }
    : null;
}

function gitBypass(words, options, depth = 0) {
  if (words[0] !== 'git') return null;
  const git = gitGlobalOptions(words);
  const bypass =
    gitOptionBypass(git, options, depth) || gitSubcommandBypass(git);
  if (bypass) return bypass;
  const spec = NO_VERIFY_SPECS[git.subcommand];
  if (spec && noVerifyArgument(git.args, spec))
    return {
      rule: 'git-no-verify',
      detail: `git ${git.subcommand} skips Git hooks`,
    };
  if (git.subcommand === 'config')
    return gitConfigBypass(git.args, options, depth);
  return spec ? null : aliasInvocationBypass(git, options, depth);
}

// options: env, the relocations launchers and earlier statements pass
// (inherited), aliases defined earlier in the command, the directories the
// command may run in (cwds, null when they are not all known), and the alias
// lookup budget and cache (lookups).
function gateABypass(segment, words, options) {
  const inherited = options.inherited || [];
  const own = invocationEffects(segment.words || []).effects;
  return (
    environmentBypass(segment.words || [], options.env) ||
    inheritedRelocation(inherited, words) ||
    gitBypass(words, { ...options, effects: [...own, ...inherited] })
  );
}

module.exports = {
  GATE_A_RULES,
  STYLE_LIMIT_DEFAULTS,
  gateABypass,
  launchedEnvironment,
};
