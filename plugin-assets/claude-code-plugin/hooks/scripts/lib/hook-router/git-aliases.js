const { execFileSync } = require('node:child_process');
const fs = require('node:fs');

// Git runs a builtin ahead of an alias with the same name
// (`git --list-cmds=builtins`, Git 2.50).
const GIT_BUILTINS = new Set(
  `add am annotate apply archive backfill bisect blame branch bugreport bundle
  cat-file check-attr check-ignore check-mailmap check-ref-format checkout
  checkout--worker checkout-index cherry cherry-pick clean clone column commit
  commit-graph commit-tree config count-objects credential credential-cache
  credential-cache--daemon credential-store describe diagnose diff diff-files
  diff-index diff-pairs diff-tree difftool fast-export fast-import fetch
  fetch-pack fmt-merge-msg for-each-ref for-each-repo format-patch fsck
  fsck-objects fsmonitor--daemon gc get-tar-commit-id grep hash-object help
  hook index-pack init init-db interpret-trailers log ls-files ls-remote
  ls-tree mailinfo mailsplit maintenance merge merge-base merge-file
  merge-index merge-ours merge-recursive merge-recursive-ours
  merge-recursive-theirs merge-subtree merge-tree mktag mktree
  multi-pack-index mv name-rev notes pack-objects pack-redundant pack-refs
  patch-id pickaxe prune prune-packed pull push range-diff read-tree rebase
  receive-pack reflog refs remote remote-ext remote-fd repack replace replay
  rerere reset restore rev-list rev-parse revert rm send-pack shortlog show
  show-branch show-index show-ref sparse-checkout stage stash status stripspace
  submodule--helper switch symbolic-ref tag unpack-file unpack-objects
  update-index update-ref update-server-info upload-archive
  upload-archive--writer upload-pack var verify-commit verify-pack verify-tag
  version whatchanged worktree write-tree`.split(/\s+/),
);
const ALIAS_LOOKUP_TIMEOUT_MS = 1000;
// Lookups and time one tool call may spend, well inside the Codex hook
// timeout; past either, the caller fails closed.
const ALIAS_LOOKUP_LIMITS = { count: 32, milliseconds: 2000 };
// `git config --get` exits 1 when the key is not set.
const KEY_NOT_SET = 1;

function aliasLookups() {
  return {
    cache: new Map(),
    remaining: ALIAS_LOOKUP_LIMITS.count,
    deadline: Date.now() + ALIAS_LOOKUP_LIMITS.milliseconds,
  };
}

// alias.NAME as git reads it in cwd, or null when it is not set.
function lookupAlias(args, cwd, options) {
  const lookups = options.lookups;
  const key = JSON.stringify([cwd, ...args]);
  if (lookups.cache.has(key)) return lookups.cache.get(key);
  const timeout = Math.min(
    ALIAS_LOOKUP_TIMEOUT_MS,
    lookups.deadline - Date.now(),
  );
  lookups.remaining -= 1;
  if (lookups.remaining < 0 || timeout <= 0)
    throw new Error('Alias lookup limit exceeded');
  let value = null;
  try {
    value = execFileSync('git', args, {
      cwd,
      env: options.env,
      encoding: 'utf8',
      timeout,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).replace(/\n$/, '');
  } catch (error) {
    if (error.status !== KEY_NOT_SET) throw error;
  }
  lookups.cache.set(key, value);
  return value;
}

// The values of alias.NAME that git reads in each existing directory, with
// the command's own -C, --git-dir, and --work-tree options. A lookup that
// cannot run, or directories that are not all known, throw so the caller
// fails closed.
function configuredAliases(name, git, options) {
  if (!options.cwds) throw new Error('Working directories unknown');
  const args = [...git.locators, 'config', '--get', `alias.${name}`];
  return options.cwds
    .filter((cwd) => fs.existsSync(cwd))
    .map((cwd) => lookupAlias(args, cwd, options))
    .filter((value) => value !== null);
}

// Every value the alias a git invocation names may have: its own -c
// definitions, definitions earlier in the same command, and configuration.
// Git matches builtin names exactly and alias keys case-insensitively, so
// `git LOG` runs alias.log. Definitions in the command count even for a
// builtin name, which an older Git may not have; configuration is read only
// for names this Git does not run as builtins.
function aliasValues(git, options) {
  const name = git.subcommand.toLowerCase();
  const own = git.configs
    .map((option) => String(option.value || ''))
    .filter((text) => text.toLowerCase().startsWith(`alias.${name}=`))
    .map((text) => text.slice(text.indexOf('=') + 1));
  const defined = [...own, ...(options.aliases?.get(name) || [])];
  if (GIT_BUILTINS.has(git.subcommand)) return defined;
  return [...defined, ...configuredAliases(name, git, options)];
}

// Records a definition so later statements of the same command see it.
function recordAlias(aliases, key, value) {
  if (!aliases) return;
  const name = key.slice('alias.'.length).toLowerCase();
  aliases.set(name, [...(aliases.get(name) || []), value]);
}

module.exports = { GIT_BUILTINS, aliasLookups, aliasValues, recordAlias };
