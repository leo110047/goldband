# goldband Operations

## Additional Install Options

Run these commands from the complete Goldband checkout. The common installation
paths are in the [README](README.md#安裝).

| Need | Entry point |
| --- | --- |
| Claude core guardrails through the installer | `./install.sh pack-quality` |
| Goldband Loop for Claude Code | `./install.sh workflow` |
| Goldband Loop for Codex | `./install.sh workflow-codex` |
| All installer options | `./install.sh help` |
| Codex portable plugin subset | [Repository marketplace](.agents/plugins/marketplace.json) |
| Claude Desktop app subset | [Local extension](app-adapters/claude-desktop/) |
| Claude web/mobile app subset | [Remote connector template](app-adapters/claude-remote/goldband-connector.template.json) |

Plugins, app adapters, and full installer setups provide different features;
see [distribution boundaries](ARCHITECTURE.md#system-shape). Avoid installing
both the Claude core plugin and installer-managed Claude core assets.

The workflow installer installs and verifies Playwright Chromium, which
`make-pdf` uses for rendering. For an offline or CI setup that does not need
PDF output, use `GOLDBAND_SKIP_PLAYWRIGHT=1` with your chosen install command.
Browser QA does not depend on this: it uses the host's browser tool or the
Playwright MCP server that `all-with-workflow` adds to Claude Code and Codex
unless `GOLDBAND_SKIP_PLAYWRIGHT_MCP=1` is set (see [mcp/README.md](mcp/README.md)).

After updating, rerun your original installation command and `./install.sh status`.
Status checks the installed source inputs, artifact integrity, and dispatch
behavior. Stale or corrupt workflow installations require reinstalling; pulling
new source alone is insufficient.

## Managed Worktrees

Use a managed worktree when an agent needs an isolated working copy. Run
`create` from a clean source worktree on a normal branch:

```bash
goldband worktree create <name>
```

This opens a managed shell in a detached worktree. Inside that shell, start one
agent without a nested OS sandbox:

```bash
claude --settings '{"sandbox":{"enabled":false}}'
# Or:
codex --sandbox danger-full-access
```

These flags are for the Goldband-managed shell only: Goldband's outer sandbox
protects Git metadata and the source worktree. Normal permission prompts and
Goldband hooks remain active. macOS uses Seatbelt; Linux uses bubblewrap.
Unavailable boundaries fail closed, and Windows has no claimed hard enforcement.

After the agent finishes, exit the managed shell, then integrate from the source
worktree:

```bash
goldband worktree finish <name> -m "<commit message>"
```

`finish` validates and integrates the candidate, creates the commit, and removes
the managed worktree only after successful completion. Validation or integration
failure preserves the worktree for investigation. See the
[managed worktree architecture](ARCHITECTURE.md#managed-worktree-runtime) for the
full isolation and commit contract. The host user remains able to manage Git
outside this boundary; these controls do not isolate a malicious same-user host
process.

## Codex Portable Baseline Check

Run this before publishing changes to tracked Codex config or rules:

```bash
bash scripts/check-codex-portability.sh
```

This verifies that tracked Codex baseline files do not contain machine-local
paths, credential-shaped values, or one-off approvals that belong in
`codex/local/`.

## Suggested Automation

The repository installs no scheduled jobs. Recurring checks run `npm test` or the
suites listed by `npm run test:repo:list` from a scheduler outside the repository.
When `codex/rules/default.rules` collects local approvals, `./install.sh
repair-codex-rules` moves them into the ignored `codex/local/` overlay.

## Codex Hooks

`./install.sh codex-core`, `./install.sh codex-full`, and `./install.sh
all-tools` install:

- `~/.codex/hooks.json`
- `~/.codex/hooks/hook-router.js`

Codex may require hook trust review after hook definitions change. Use `/hooks`
inside Codex to inspect and trust hook definitions.

## Git Style Gate

Install or refresh the global git style gate:

```bash
./install.sh style-gate
```

The installed `core.hooksPath` is `~/.config/goldband/git-hooks`. The same
command adds a marked block to `${ZDOTDIR:-$HOME}/.zshenv` that appends
`core.hooksPath=<that directory>` to Git's environment configuration
(`GIT_CONFIG_COUNT`/`GIT_CONFIG_KEY_<n>`/`GIT_CONFIG_VALUE_<n>`). Environment
configuration takes precedence over repository-local configuration, so every
Git command started from zsh runs the goldband hooks, including repositories
that set their own `core.hooksPath`. It takes effect in shells started after
installation. Git started without that environment, such as a GUI application
launched outside a shell, follows the repository-local `core.hooksPath` and
skips goldband.

Default install packs do not change global git settings; run `style-gate`
explicitly when you want the machine-wide hook. The pre-commit hook checks only
staged files. Biome checks run only when the target repo has `biome.json`;
otherwise the hook keeps the zero-dependency checks and emits an advisory. If
the recorded Goldband source script or `node` is unavailable, the hook warns
and allows the commit. The hooks are materialized outside the checkout so no
hook manager writes generated hooks into Goldband source. Re-running `./install.sh style-gate` refreshes the materialized runtime
and migrates the legacy source-checkout `core.hooksPath`. The commit-msg
gate checks for a Conventional Commits subject,
`<type>[(scope)][!]: <description>`, with type `feat`, `fix`, `docs`, `style`,
`refactor`, `perf`, `test`, `build`, `ci`, `chore`, or `revert`. A mismatch
prints a warning; it blocks the commit only when the repository has
`.goldband-git-workflow.json` or `GOLDBAND_GIT_WORKFLOW_GATE=1` is set.
Subjects that Git and release tools write pass unchecked, following
commitlint's default ignores: `Merge pull request|branch|tag|remote-tracking
branch ...`, `Merge <a> into <b>`, `Merged <a> in|into <b>`, `Merged PR <n>: `,
`Automatic merge`, `Auto-merged <a> into <b>`, `Revert ` or `Reapply ` (either
case), `amend!`, `fixup!`, `squash!`, and a bare semantic version. Without the
opt-in, the gate is skipped when the repository has its own runnable
`commit-msg` hook; with the opt-in it always runs.

Large generated text files use the exact-path contract documented in
`rules/coding-style.md`. Ordinary text remains limited to 1 MB; a tracked
`.goldband-style.json` may name a tracked generator and a per-file cap up to the
16 MB generated-text hard limit. The exception does not replace the
project-specific regeneration/drift check.

goldband installs `pre-commit`, `commit-msg`, and `pre-push`, which run the
goldband gate first, and a chain-only hook for each of `applypatch-msg`,
`pre-applypatch`, `post-applypatch`, `pre-merge-commit`, `prepare-commit-msg`,
`post-commit`, `pre-rebase`, `post-checkout`, `post-merge`, `post-rewrite`,
`pre-auto-gc`, and `sendemail-validate`. After the goldband gate passes or
soft-skips, each hook runs, in order and stopping at the first failure:

1. `<installed hook dir>/<name>.local`, when executable. Installation moves a
   non-goldband file found at `<installed hook dir>/<name>` (for example a Git
   LFS hook) to `<name>.local`; uninstall moves it back.
2. The repository's own `<name>` hook, when executable. Its directory is the
   repository- or worktree-level `core.hooksPath`, resolved against the
   working tree root, otherwise `<git common dir>/hooks`.

Chained hooks receive the original arguments; `pre-push` and `post-rewrite`
standard input is replayed to each of them. They run with the goldband
environment override removed, so `git config core.hooksPath` inside them
reports the repository's value. Other hook names, including
`push-to-checkout`, `reference-transaction`, and server-side hooks, are not
chained.

This repository's project style gate
(`scripts/check-goldband-project-style-gate.mjs --staged`) selects fast
goldband-specific checks by staged path: plugin distribution artifacts, hook
script references, Codex portability, first-party export consumers, and
style-gate self-tests. `./install.sh style-gate` installs a thin
`.git/hooks/pre-commit` shim for this checkout; the global goldband hook will
invoke that project hook after the global gate passes.

A repo opts out permanently with a `.goldband-no-style-gate` file, or for one
command with `GOLDBAND_STYLE_GATE=0`.

Temporary bypasses print a warning and write a local log under
`${XDG_STATE_HOME:-$HOME/.local/state}/goldband/style-gate-bypass.log`.

Uninstall removes the `.zshenv` block, the global `core.hooksPath`, and the
unmodified goldband-owned hook files.

### Pre-commit added-line rules

Rules that judge staged added lines read `git diff --cached --unified=0 --text
--no-ext-diff --no-textconv --no-color`, so `.gitattributes` `-diff`, external
diff drivers, and textconv cannot hide added lines. When Git cannot produce the
diff, the checker exits 2 with `check failed: cannot read staged added lines of
<file>` and the commit is blocked.

Hidden Unicode runs only at pre-commit, on the added lines of every staged text
file, including paths excluded from style checks. Files with a NUL byte in the
first 8000 bytes of the staged blob are skipped as binary whatever their diff
attributes; a failed blob read is a check failure. Files above the largest
configured size limit are not read. Each staged blob is resolved and read at
most once per run. It blocks:

- bidi embedding, override, and isolate controls (U+202A–U+202E,
  U+2066–U+2069) in any text file;
- tag characters (U+E0000–U+E007F) in any text file, except the complete
  England, Scotland, and Wales flag sequences;
- U+200B, U+200C, U+200D, U+2060, and U+FEFF other than a file-head BOM in
  agent instruction files, unless both neighbouring code points belong to Thai,
  Lao, Khmer, Myanmar, Arabic, or an Indic script, or U+200D joins emoji.

Agent instruction files are `CLAUDE.md`, `CLAUDE.local.md`, `AGENTS.md`,
`AGENTS.override.md`, `GEMINI.md`, `SKILL.md`, `.cursorrules`, and
`.windsurfrules` at any depth, `.github/copilot-instructions.md`, and files
under `.cursor/rules/`, `.github/instructions/`, `.claude/`, `.codex/`, or
`.agents/` at any depth; names and directories compare case-insensitively. Findings report `path:line:col` (1-based
code-point column), the code point, and its name. The rule guards the commit,
not what an agent reads from the working tree.

Skipped tests: in Python test files (`test_*.py`, `*_test.py`, or under a
`tests/` directory) a line that starts, after indentation, with the decorator
`@pytest.mark.skip`, `@unittest.skip`, or `@skip`,
`@pytest.mark.skipif`/`@skipIf`/`@unittest.skipIf` with literal `True` as the
first argument, or `@skipUnless`/`@unittest.skipUnless` with literal `False`
as the first argument blocks the commit.
`pytest.skip(` in Python test files, `t.Skip(`/`t.Skipf(`/`t.SkipNow()` in
`*_test.go`, and `#[ignore]` in `.rs` files print under `Advisory:` without
changing the exit code. These rules ignore a line's comment (`#` in Python,
`//` in Go and Rust) and the contents of its string literals; each added line
is read alone, so an interior line of a multi-line string is read as code.

### Pre-push secret gate

`pre-push` scans every pushed ref with gitleaks before chaining.
`./install.sh style-gate` installs the baseline rules at
`<installed hook dir>/lib/gitleaks.toml` (gitleaks defaults extended) and
reports whether `gitleaks` is on `PATH`. For each standard-input ref whose
local SHA is not all zeros, the range is:

1. `<remote>..<local>` when the remote SHA is non-zero and exists locally;
2. otherwise `<local> --not <boundary>`, where the boundary is the `-` lines of
   `git rev-list --boundary <local>` with every SHA that `git ls-remote <push
   URL>` advertises now and that exists locally excluded on standard input;
   local tracking refs are not used. The boundary excludes the same commits as
   the whole advertised set;
3. the full history reachable from `<local>` when `ls-remote` fails, or when
   the boundary exceeds 100000 bytes, the budget for the single `--log-opts`
   argument.

Resolving the advertised SHAs, `git rev-list --boundary`, and `git rev-list
--count <range>` must succeed, or the push is blocked as a scan failure. A
non-empty range runs `gitleaks git --no-banner --no-color --verbose --redact
--exit-code 3 --ignore-gitleaks-allow --config <baseline>
--log-opts="--text --no-ext-diff --no-textconv --diff-merges=remerge <range>"` with `GITLEAKS_CONFIG` and `GITLEAKS_CONFIG_TOML` unset
and `color.ui=never`, `color.diff=never`, `log.showRoot=true` forced for Git.
Every Git process of the gate, including gitleaks' `git log`, runs with
`GIT_NO_REPLACE_OBJECTS=1` and `GIT_GRAFT_FILE` set to a path that does not
exist, so replace refs and grafts do not change the scanned history. The
chained hooks receive the caller's environment.
The push is blocked when gitleaks exits 3 (secrets found), exits with another
non-zero status or logs an `ERR`/`FTL` line or a Git `fatal:` (scan failure),
is missing, or when the baseline is missing or differs from its checksum in
`.goldband-source`. Output is redacted. Only Fingerprints in the pushed
repository's `.gitleaksignore` are exceptions; a repository `.gitleaks.toml`
and inline `gitleaks:allow` have no effect. A merge commit is scanned as its
diff against the automatic merge of its parents (`--diff-merges=remerge`,
Git 2.36 or later), so content the merge adds beyond that result counts and
content its parents already brought does not. Git produces no remerge diff
for a merge with three or more parents, so pushing one is a scan failure.

The secret gate ignores `.goldband-no-style-gate` and `GOLDBAND_STYLE_GATE=0`.
`GOLDBAND_SECRET_GATE=0` skips it for one command, prints a warning, and
appends to `${XDG_STATE_HOME:-$HOME/.local/state}/goldband/secret-gate-bypass.log`.

## Agent Bypass and Configuration Gates

Gate A (bypass) and Gate G (configuration protection) run in PreToolUse in
Claude and Codex on every tool call, independent of careful mode; Codex also
applies them to PermissionRequest. Both hosts use one protected-surface list
and decision module (`hooks/scripts/lib/hook-router/protected-surfaces.js`,
`gate-bypass-rules.js`, `git-no-verify.js`, `git-aliases.js`,
`git-config-args.js`,
`gate-protection.js`, `shell-write-targets.js`, `shell-braces.js`,
`shell-word-syntax.js`, copied verbatim to `codex/hooks/`). They read static
command text: scripts, `eval` of dynamic text, and encoded commands are
outside their scope, and they do not
replace host sandboxes or permissions. Commands a person runs outside the
agent are not intercepted.

Gate A denies in both hosts and every permission mode:

- `git commit --no-verify` or `-n` (including combined short flags),
  `git am -n`, and `--no-verify` on `push`, `merge`, `rebase`, `am`, and
  `pull`, including abbreviations Git accepts (`--no-v` and longer);
- for the hook-control keys `core.hooksPath`, `include.path`,
  `includeIf.<condition>.path`, and `init.templateDir` (compared
  case-insensitively): `git -c`,
  `git --config-env`, and `git config` writes in any scope (including `set`,
  `--add`, and `--replace-all`), unsets, and section removals or renames of
  `core` or `include`;
- `GIT_CONFIG_PARAMETERS` containing a hook-control key; a
  `GIT_CONFIG_KEY_<n>` set to one; changes to
  `GIT_CONFIG_COUNT`/`GIT_CONFIG_KEY_<n>`/`GIT_CONFIG_VALUE_<n>` that remove or
  override the `core.hooksPath` entry in the hook's environment, including
  `env -i` and `exec -c`;
- `git config --edit`, `-e`, or `edit` in any scope, since the agent can
  script the editor;
- defining a Git alias whose value runs any Gate A bypass, as git arguments or
  as `!` shell code: `git -c alias.<name>=<value>`, `git config` writes
  (including `set`, `--add`, and `--replace-all`), any alias through
  `git --config-env`, `GIT_CONFIG_PARAMETERS`, or `GIT_CONFIG_KEY_<n>`;
- invoking a subcommand that is not a Git builtin with an argument that starts
  with `-`, when an alias of that name, with those arguments appended, runs a
  Gate A bypass. The alias values checked are the invocation's own
  `-c alias.<name>=`, `git config` definitions earlier in the same command,
  and `git [-C|--git-dir|--work-tree ...] config --get alias.<name>` read in
  every existing directory the command may run in, with the environment the
  launched Git gets. A builtin is matched by its exact name and is never read
  from configuration; its own `-c alias.` and earlier definitions are still
  checked, since an older Git may lack that builtin. A `!` alias that
  contains `$`, a lookup that fails other than with exit status 1, a launch
  that sets `GIT_CONFIG_SYSTEM`, and lookups beyond 32 or 2 seconds per call
  count as a bypass. An alias invoked without an option argument is judged
  only where it is defined;
- `git --git-dir`, or setting `GIT_DIR` or `GIT_COMMON_DIR` (on the command,
  a launcher, or earlier in the same command), for `commit`, `push`, `merge`,
  `rebase`, `am`, `pull`, or a subcommand that is not a builtin, because
  another repository's configuration can set `core.hooksPath`;
- `git clone` or `git init` with `--template`, with `-c`/`--config`
  setting a hook-control key (long options in any abbreviation Git accepts),
  or with `GIT_TEMPLATE_DIR` set, since the new repository's configuration
  can set `core.hooksPath`;
- relocating Git's global configuration, where Goldband installs
  `core.hooksPath`: setting `GIT_CONFIG_GLOBAL` to any value in any form, and,
  for a `git` command, setting `HOME` or `XDG_CONFIG_HOME`, unsetting `HOME`,
  or `env -i`, whether on that command, on a shell, wrapper, `xargs`, or
  `find -exec` that runs it, or earlier in the same command as a bare
  assignment, a declaration builtin, or `unset`; running a hook-running `git`
  command through `su`, `doas`, or `sudo` without `-E` or `--preserve-env`,
  which reset the environment and `HOME`; `git config` reads are exempt,
  and `GIT_CONFIG_NOSYSTEM` and `GIT_CONFIG_SYSTEM` pass because Goldband does
  not rely on system configuration;
- `GOLDBAND_STYLE_GATE=0`, `GOLDBAND_SECRET_GATE=0`,
  `GOLDBAND_PROJECT_HOOK_RUNNING=1`, any `GOLDBAND_STYLE_GATE_SCRIPT`, a
  `GOLDBAND_MAX_*` above its default or not a positive integer, `HUSKY=0`,
  non-empty `SKIP`, and `LEFTHOOK=0|false`, set as a command prefix, through
  `env` (including `env -S`/`--split-string`), `export`, `declare`, `typeset`,
  `local`, `readonly`, a `sudo` or `doas` operand, or a bare assignment, or
  removed with `unset`. `env` options parse getopt-style: clustered flags such
  as `-vi`, values attached or in the next word, any abbreviation of a long
  option (`--ig` is `--ignore-environment`), and assignments after `--`;
- creating or modifying `.goldband-no-style-gate`, in any letter case.

These apply inside `bash -c`, `sh -c` (the script is the first operand
after `-c`, past further options and `--`), `sudo`, `xargs`, `find -exec`, `if`,
`while`, `until`, and `for` bodies, and across `&&`, `;`, and `|`; after the
precommand modifiers `noglob`, `nocorrect`, `-`, `builtin`, and `coproc`; under
the wrappers `command`, `exec`, `nohup`, `time`, `nice`, `timeout`,
`caffeinate`, `stdbuf`, `xcrun`, `ionice`, `chrt`, `taskset`, and `arch`
(including `arch -e NAME=VALUE`); and when any other program that does not
take its arguments as data names `git`, `env`, `sudo`, `doas`, a shell, or a
Gate G writer in its argv, with the assignments just before that name. Words
are brace-expanded first, as the shell does, and `$'...'` is decoded as in
bash and zsh. Only literal text is judged: words computed when the command
runs, such as `$NAME`, `$(...)`, backquotes, globs, zsh `=name`, `$IFS`
splitting, and `eval`, are outside Gate A's scope, so
`git push origin "$(git branch --show-current)"` passes. Quoted text,
reads, `git push -n`, `git merge -n`, and values that tighten a gate or change
only output pass. A command the shared shell parser cannot analyze, including a word
whose brace expansion exceeds 10000 words, an unclosed zsh glob group, a zsh
glob qualifier with `e` or `+`, which runs shell code, a NUL decoded from
`$'...'`, glob group parsing beyond 200000 steps, or
whose launcher argv scan spans more than 100000 words, is denied in both hosts
and every permission mode (`shell-analysis-failed`), never reported safe.

Gate G covers writes to `.claude/settings*.json`, `.claude/hooks/`,
`~/.claude.json`, `~/.claude/plugins/` except `data/`, `.mcp.json`,
`.codex/config.toml`, `.codex/hooks.json`, `~/.codex/config.toml`,
`~/.codex/hooks.json`, `~/.codex/hooks/`, `~/.codex/rules/`,
`${XDG_CONFIG_HOME:-$HOME/.config}/goldband/`, `$GOLDBAND_GIT_HOOKS_DIR`,
`${ZDOTDIR:-$HOME}/.zshenv`, `$HOME/.zshenv`, `.codex/hooks/`, `config` and
`config.worktree` below a directory whose name ends in `.git`, a `.git` file,
`~/.gitconfig`, `${XDG_CONFIG_HOME:-$HOME/.config}/git/config`, files those
two name in `[include]` or `[includeIf]` `path` entries, including one on the
section header's line (four levels deep),
`.gitleaks.toml`, and
`.gitleaksignore`; project-level names match in any directory, and every name
and home or XDG anchor compares case-insensitively. A write is a Claude Write,
Edit, MultiEdit, or NotebookEdit call, a Codex `apply_patch` add, update,
delete, or move (a file header may be indented; after an update header, an
indented line is hunk context), the path arguments (`path`,
`paths`, `file`, `file_path`, `filepath`, `filePath`, `filename`,
`relative_path`, `pathInProject`, `destination`, `target`, `dest`, and a
move's `source`, `src`, or `from`) of an MCP tool (`mcp__<server>__<tool>`)
whose tool name contains `write`, `edit`, `create`, `move`, `rename`,
`delete`, `remove`, `append`, `patch`, `copy`, `upload`, `save`, `update`,
`replace`, or `insert`, or a shell `>`, `>>`, `>|`, `>!`, `>>!`, `>&`, `&>`,
`<>`, `tee`, `sed -i`, `cp`,
`mv`, `ln` (its sources too, since later writes go through the link),
`apply_patch` or `applypatch` with its patch as an argument, heredoc, or
here-string (patch input from a pipe or file gets the Gate G response),
`install` (including `-t` and `-d`), `dd of=`, `truncate`, `rm`,
`touch`, `chmod`, `chown`, `chgrp`, or `chflags`, including removing, replacing,
or changing the mode of a directory that contains a protected file; with `-R`
every existing entry below the operand counts. A shell target word is
brace-expanded; one with glob characters (`*`, `?`, `[`, a zsh `(...)` group
or qualifier, or a bash extglob group) counts as itself and as every existing
path it matches, with a group read as `*` and a wildcard path segment also
matching dot-prefixed names. `~`, `$HOME`, `${HOME}`, and `${HOME:-...}`-style
forms expand to the hook's home directory; `~user` expands to that directory
for the current user and to `<parent of home>/user` otherwise. `~+` and
`$PWD` expand to the working directory, `${NAME:-word}` and `${NAME:=word}`
to `word` when `NAME` has no known value, and a variable assigned literally
earlier in the same command to that value, with the names its value uses
expanded as assigned before it. Other variables are not resolved,
so a target built from one is not protected. Quoted glob characters are treated the same
way. Relative shell paths resolve
against both the starting directory and every static `cd` or `pushd` target
(options and `--` allowed; `cd -`, `pushd +N`, and `popd` are ignored); a
command run by `env -C DIR` or `env --chdir=DIR` resolves its own operands,
and every command it launches through `sh -c`, wrappers, or stdin, against
`DIR`, while its own redirections stay in the shell's directory. `mv` and recursive `cp` (`-r`,
`-R`, `-a`) check every entry of a source directory at its destination; a cp
source written `dir/` or `dir/.` merges its contents into the destination. A
recursive cp source that is missing or an unmatched glob in any working
directory the command may run in, cannot be read, or
holds more than 2000 entries, an existing `mv` source that cannot be read or
holds more than 2000 entries, and a recursive `chmod`-family operand that
cannot be read or holds more than 2000 entries, is checked as if it contained
every protected project and home name. Sources and operands are listed as
they exist before the command runs: a source the command replaces, a glob
match it creates, and a missing `mv` source or recursive `chmod`-family
operand, including one named by a variable, are not protected. Running the installer recorded on line 1 of
`<installed hook dir>/.goldband-source` (`<source>/install.sh`, resolved by real
path) is one protected operation, whether run directly, by a shell, through
`env` (including `-S` and `-C`), or a wrapper; its own file writes are not
re-checked. An `install.sh` elsewhere, `bash -n`, `bash -s`, and
`command -v` do not run the installer. Reads, `git diff`, and edits to
`CLAUDE.md` and `AGENTS.md` are not intercepted.

A tool call whose Gate G analysis visits more than 20000 directories in glob
walks, resolves more than 20000 target paths, or tracks more than 256 working
directories is not analyzed further and gets the Gate G response, after Gate
A has checked the whole call, so a bypass in it is still denied. Glob walks
run in a child process that is killed 2 seconds after the call's first walk
starts, with the same response; `GOLDBAND_GATE_GLOB_MS` may only shorten
that. Glob matching uses `fs.globSync`, so the gates require Node.js 22 or
later.

| Host | Gate G response |
| --- | --- |
| Claude | `ask`. `bypassPermissions` denies. File-tool writes to `.claude/settings*.json`, `.claude/hooks/`, `~/.claude.json`, `.mcp.json`, and `$HOME/.zshenv`, spelled in lower case, in default, acceptEdits, or plan mode get no hook response, leaving Claude's own prompt. |
| Codex | Deny, including for malformed payloads that name a protected target (read as patch text with JSON string escapes decoded) and project `.codex/` files, whose built-in read-only protection does not hold under `--sandbox danger-full-access`. |

After a deny, the user takes over through the host's own mechanism.

## Plugin and Installer Distribution

Claude Code core distribution uses the local plugin marketplace:

```bash
claude plugin marketplace add ./
claude plugin install goldband@goldband --scope user
claude plugin list --json
```

Plugin changes follow [CONTRIBUTING.md](CONTRIBUTING.md#plugin-distribution-changes).
The sync script generates `plugin-assets/claude-code-plugin/`,
`.claude-plugin/marketplace.json`, and
`docs/reports/plugin-expected-assets.json` from the source `commands/`,
`rules/`, `hooks/`, and `skills/global/` directories. Do not hand-edit generated
plugin files.

Uninstall paths are intentionally separate:

```bash
claude plugin uninstall goldband@goldband
./install.sh uninstall
```

`./install.sh status` detects when the plugin and installer-managed Claude
assets both exist. Duplicate `commands`, `rules`, `hooks`, or `skills` are not a
green state; status reports active sources, duplicate names, remediation, and
exits non-zero.

The installer is POSIX-only (`./install.sh help` lists its targets). On Windows, use Git Bash or WSL. Native PowerShell install, status, uninstall,
and self-update wrappers do not exist. `./install.sh launchers` from Git Bash
backs up stale PowerShell launcher files and removes their profile block.

`./install.sh codex-requirements` manages `/etc/codex/requirements.toml` on
POSIX hosts and `%ProgramData%\OpenAI\Codex\requirements.toml` when run from
Git Bash on Windows. Native Windows managed requirements may still require an
administrator or managed policy. goldband does not stage
`~/.codex/requirements.toml` as a Windows enforcement path.

## Goldband Telemetry

Goldband telemetry writes JSONL files on this machine and has no upload path.
The `telemetry` setting (`goldband-config get telemetry`, default `off`) only
controls whether the local usage log is written.
`scripts/export-telemetry-otlp.mjs` sends traces only when you run it against an
OTLP endpoint you choose; see [observability](docs/observability.md).

Independently of telemetry, `goldband-update-check` reads the latest version
from GitHub unless `update_check` is `false`.

### Work Map tracker configuration and sync

Work Maps are local-only unless tracker mode is explicitly configured with
`goldband plan sync configure --input <file> --host <host>`. The input file lives
outside the repository and contains `schemaVersion: 1`, `mode` (`github`,
`gitlab`, or `off`), `repository` (`owner/name`, or `null` when off),
`defaultLabels`, and `dependencyCapability`. It contains no token;
authentication stays in `gh` or `glab`.

Configuration first reads CLI, auth, and repository access. Missing access is
a blocked result and does not write config. Use `mode: "off"` with
`repository: null` to return to local-only mode.

`goldband plan sync preview --work-id <id> --host <host>` creates a local
operation plan and performs no remote writes. `inspect` reads remote state and
reports digest drift and import candidates. Remote publish is deliberately not
authorized by an input flag. Approve and run exactly the next pending step with
`goldband plan sync publish --work-id <id> --operation-digest <digest> --step <step-id> --host <host>`.
Each invocation is one native host/user approval boundary; the runtime rejects
an out-of-order step, saves the completed write before readback, and requires a
new invocation for the next outward action.

Tracker telemetry is local-only at
`workflow-runs/tracker-sync.jsonl`. It contains provider, operation, counts,
status, duration, and bounded conflict reason; it never contains issue bodies,
comments, local paths, credentials, or environment values.

Hook usage events and metrics resolve their data root in this order:

1. `CLAUDE_PLUGIN_DATA/<namespace>` when Claude exposes stable plugin data.
2. `GOLDBAND_DATA_DIR/<namespace>` when explicitly configured.
3. `${XDG_DATA_HOME}/goldband/<namespace>` when `XDG_DATA_HOME` is set.
4. `~/.local/share/goldband/<namespace>`.
5. `<system temp>/goldband/<namespace>` only if the durable paths cannot be
   created.

Each candidate is tried in order; one that cannot be created falls through to
the next. Claude and Codex hooks share this resolver
(`hooks/scripts/lib/utils.js`, generated into `codex/hooks/utils.js`).

Default files are `hook-router/usage-events.jsonl` and
`hook-router/metrics.jsonl` under that resolved data root. Usage telemetry is
enabled by default and can be disabled with
`GOLDBAND_USAGE_TELEMETRY_ENABLED=0`. Hook metrics are enabled by default and
can be disabled with `HOOK_ROUTER_METRICS_ENABLED=0`.

`node hooks/scripts/tools/report-usage-summary.js --days <n> [--json]` reports which `goldband-*` workflow
entries were used and how often, separated into `confirmed` and `inferred`
signals, plus hook deny and advisory counts. `confirmed` means a hook payload
explicitly reported a `Skill` tool invocation with a `goldband-*` skill name.
`inferred` covers slash-command prompts and `goldband-*` Bash wrapper commands
and does not establish workflow completion. Keep/delete decisions use confirmed
counts; inferred signals and hook advisories are secondary triage data.

`node scripts/mine-telemetry.mjs <summary|classify|extract-fixtures|extract-evals> --days <n>`
mines local telemetry; the extract commands also take `--out-dir`. The miner never rewrites source telemetry. It reads the usage JSONL base file
plus rotated siblings, and it reads workflow evidence from
`${GOLDBAND_HOME:-$HOME/.goldband}/workflow-runs` unless
`--workflow-runs-dir` is supplied. `extract-fixtures` runs candidate replay
checks with `GOLDBAND_HOME`, `GOLDBAND_DATA_DIR`, and `CLAUDE_PLUGIN_DATA`
pointed at a temp sandbox so hook marker files do not land in the real state
root. Replay fixture and eval outputs are review candidates only; do not append
them to `hooks/fixtures/router/replay-fixtures.json` or a formal eval dataset
until a human has reviewed the sanitized content.

OTLP trace export is opt-in and offline-first. JSONL remains the source of
truth; `scripts/export-telemetry-otlp.mjs` reads the usage file and sends a
derived traces payload to `--endpoint` only when explicitly run. It supports `--usage-file`, `--cursor-file`, `--dry-run`, and
`--limit`. `--since` is dry-run only because formal exports advance a cursor. See
[docs/observability.md](docs/observability.md) for exporter options and miner commands, and
[docs/telemetry-schema.md](docs/telemetry-schema.md) for the v1 schema.

## Regression Gates and Failure Taxonomy

Hook policy regressions are tracked by the `test:hook-router`, `test:telemetry`,
`test:hook-router:coverage`, and `test:eval-budget-cap` suites. The repository-root `Validate Config` workflow runs these commands on pushes to
`dev`. The replay dataset is `hooks/fixtures/router/replay-fixtures.json`; the
coverage checker reads that dataset plus the live hook policy modules so missing
secret-pattern, pretool-policy, careful-mode, or freeze-mode cases fail
mechanically. Main-branch merge enforcement is owned separately by the
repository ruleset and its required status checks.

Paid Goldband Loop evals are opt-in only through
`.github/workflows/goldband-loop-paid-evals.yml`. They require maintainer budget
confirmation and `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, and `GEMINI_API_KEY`
GitHub Actions secrets. If either budget or secrets are missing, the workflow
must report skipped and must not count as PR coverage.

Current hook discovery boundary:

- Claude installed hooks can observe `hook_event_name`, `tool_name`,
  `tool_input`, `tool_response`, `error`, `prompt`, `session_id`, and lifecycle
  fields exposed to the configured hook phase. Claude `UserPromptSubmit` runs
  `skill-activation-suggestions.js`; tool phases run the unified router.
- Codex installed hooks can observe the same tested fields used by
  `codex/hooks/hook-router.js`: `hook_event_name`, `tool_name`, `tool_input`,
  `tool_response`, `prompt`, `last_assistant_message`, and `session_id` when the
  runtime provides it.
- Both hosts record confirmed workflow entry usage only from `PreToolUse`
  payloads where `tool_name` is `Skill` and the tool input contains a
  `goldband-*` name. Prompt signals are recorded as inferred. Bash wrapper
  signals are inferred only when a `goldband-*` executable appears in shell
  command position, not when search, docs, or test output merely mention the
  workflow name.
- New usage events are normalized to `goldband.telemetry.v1` with `run_id`,
  `event_id`, and optional `parent_event_id`. Legacy `sessionId` remains present
  for compatibility with existing local summaries.

## MCP Templates

MCP templates live under `mcp/` and are disabled by default. Before documenting a
server as supported, run MCP Inspector and verify that the server starts and
lists the expected tools.
