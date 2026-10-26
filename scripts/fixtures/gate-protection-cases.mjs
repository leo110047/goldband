// Shared Gate A and Gate G cases replayed through both native hook adapters.
// Expectations restate the contract table, independent of the module flags.
import os from 'node:os';
import { assignmentResolutionCases } from './gate-assignment-cases.mjs';
import { copySourceCases } from './gate-copy-source-cases.mjs';

// The hook process environment carries a core.hooksPath override at index 0.
export const gitConfigOverrideEnv = {
  GIT_CONFIG_COUNT: '1',
  GIT_CONFIG_KEY_0: 'core.hooksPath',
  GIT_CONFIG_VALUE_0: '/goldband/git-hooks',
};

// [command, Gate A rule named in the message]. Both hosts deny.
export const gateABlockCases = [
  ['git commit --no-verify', 'git-no-verify'],
  ['git commit -n', 'git-no-verify'],
  ['git commit -anm "feat: x"', 'git-no-verify'],
  ['git commit --no-veri -m x', 'git-no-verify'],
  ['git push --no-verify', 'git-no-verify'],
  ['git merge --no-verify topic', 'git-no-verify'],
  ['git rebase --no-verify main', 'git-no-verify'],
  ['git am --no-verify < patch.mbox', 'git-no-verify'],
  ['git -c core.hooksPath=/dev/null commit -m x', 'git-hookspath-override'],
  ['git -c core.hookspath= push', 'git-hookspath-override'],
  ['git --config-env=core.hooksPath=VAR commit', 'git-hookspath-override'],
  ['git --config-env core.hooksPath=VAR commit', 'git-hookspath-override'],
  [
    `GIT_CONFIG_PARAMETERS="'core.hooksPath'='/tmp'" git commit`,
    'git-config-env-override',
  ],
  ['GIT_CONFIG_COUNT=0 git commit -m x', 'git-config-env-override'],
  ['env -u GIT_CONFIG_COUNT git commit -m x', 'git-config-env-override'],
  ['unset GIT_CONFIG_KEY_0', 'git-config-env-override'],
  ['GIT_CONFIG_KEY_0=user.name git commit', 'git-config-env-override'],
  ['export GIT_CONFIG_VALUE_0=/tmp/hooks', 'git-config-env-override'],
  [
    'GIT_CONFIG_COUNT=2 GIT_CONFIG_KEY_1=core.hooksPath GIT_CONFIG_VALUE_1=/tmp git commit',
    'git-config-env-override',
  ],
  ['GOLDBAND_STYLE_GATE=0 git commit -m x', 'goldband-gate-disabled'],
  ['export GOLDBAND_SECRET_GATE=0', 'goldband-gate-disabled'],
  ['env GOLDBAND_SECRET_GATE=0 git push', 'goldband-gate-disabled'],
  ['GOLDBAND_PROJECT_HOOK_RUNNING=1 git commit', 'goldband-gate-disabled'],
  ['GOLDBAND_STYLE_GATE_SCRIPT=/bin/true git commit', 'goldband-gate-disabled'],
  ['GOLDBAND_MAX_FILE_LINES=900 git commit', 'style-limit-relaxed'],
  ['GOLDBAND_MAX_COMPLEXITY=abc git commit', 'style-limit-relaxed'],
  ['export GOLDBAND_MAX_PARAMS=0', 'style-limit-relaxed'],
  ['HUSKY=0 git commit -m x', 'project-hooks-disabled'],
  ['SKIP=eslint git commit -m x', 'project-hooks-disabled'],
  ['LEFTHOOK=0 git commit -m x', 'project-hooks-disabled'],
  ['git config core.hooksPath /tmp/hooks', 'git-hookspath-config'],
  ['git config --global core.hooksPath /tmp/hooks', 'git-hookspath-config'],
  ['git config --local --unset core.hooksPath', 'git-hookspath-config'],
  ['git config --unset-all core.hooksPath', 'git-hookspath-config'],
  ['touch .goldband-no-style-gate', 'no-style-gate-marker'],
  ['echo off > .goldband-no-style-gate', 'no-style-gate-marker'],
  // Config includes can set core.hooksPath; keys compare case-insensitively.
  ['git -c include.path=/tmp/h.cfg commit -m x', 'git-hookspath-override'],
  [
    'git -c includeIf.gitdir:/repo/.path=/tmp/h.cfg commit',
    'git-hookspath-override',
  ],
  ['git --config-env=Include.Path=VAR commit', 'git-hookspath-override'],
  [
    `GIT_CONFIG_PARAMETERS="'include.path'='/tmp/h.cfg'" git commit`,
    'git-config-env-override',
  ],
  [
    'GIT_CONFIG_COUNT=2 GIT_CONFIG_KEY_1=include.path GIT_CONFIG_VALUE_1=/tmp/h.cfg git commit',
    'git-config-env-override',
  ],
  ['git config --global include.path /tmp/h.cfg', 'git-hookspath-config'],
  ['git config --add include.path /tmp/h.cfg', 'git-hookspath-config'],
  [
    'git config --replace-all includeIf.onbranch:main.path /tmp/h.cfg',
    'git-hookspath-config',
  ],
  ['git config set --global Include.Path /tmp/h.cfg', 'git-hookspath-config'],
  ['git config --rename-section old include', 'git-hookspath-config'],
  // env -S splits its string into assignments and the command.
  ['env -S "GOLDBAND_STYLE_GATE=0 git commit -m x"', 'goldband-gate-disabled'],
  ['env --split-string="HUSKY=0 git commit -m x"', 'project-hooks-disabled'],
  ["env -S'GOLDBAND_SECRET_GATE=0 git push'", 'goldband-gate-disabled'],
  ['env -iS "git commit -m x"', 'git-config-env-override'],
  ['touch .GOLDBAND-NO-STYLE-GATE', 'no-style-gate-marker'],
  ['dd if=/dev/null of=.goldband-no-style-gate', 'no-style-gate-marker'],
  ["bash -c 'git commit --no-verify'", 'git-no-verify'],
  ['sh -c "HUSKY=0 git commit"', 'project-hooks-disabled'],
  ['npm test && git commit -n -m x', 'git-no-verify'],
  ['npm test; git push --no-verify', 'git-no-verify'],
  ['printf x | git commit -n -F -', 'git-no-verify'],
  // env option clusters and long-option abbreviations parse getopt-style.
  ['env -vi git commit -m x', 'git-config-env-override'],
  ['env -iv git commit -m x', 'git-config-env-override'],
  ['env -vi0 git commit -m x', 'git-config-env-override'],
  ['env -v0i git commit -m x', 'git-config-env-override'],
  ['env --i git commit -m x', 'git-config-env-override'],
  ['env --ig git commit -m x', 'git-config-env-override'],
  ['env --ignore-env git commit -m x', 'git-config-env-override'],
  ['env -vuGIT_CONFIG_COUNT git commit', 'git-config-env-override'],
  ['env --uns GIT_CONFIG_COUNT git commit', 'git-config-env-override'],
  // Loop bodies, like if/while bodies, run their commands.
  ['for i in 1; do HUSKY=0 git commit -m x; done', 'project-hooks-disabled'],
  ['until false; do SKIP=eslint git commit; done', 'project-hooks-disabled'],
  [
    'while true; do GOLDBAND_STYLE_GATE=0 git commit; done',
    'goldband-gate-disabled',
  ],
  // Relocating Git's global configuration drops Goldband's core.hooksPath.
  [
    'GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null git commit',
    'git-global-config-relocated',
  ],
  ['export GIT_CONFIG_GLOBAL=/tmp/empty', 'git-global-config-relocated'],
  ['GIT_CONFIG_GLOBAL= npm test', 'git-global-config-relocated'],
  ['HOME=/tmp git commit -m x', 'git-global-config-relocated'],
  ['XDG_CONFIG_HOME=/tmp git push', 'git-global-config-relocated'],
  ['env -u HOME git commit -m x', 'git-global-config-relocated'],
  // Wrapper options with attached or clustered values use the shared parser.
  [
    'time -ao out.txt env -u GIT_CONFIG_COUNT git commit -m x',
    'git-config-env-override',
  ],
  ['nice -n5 git commit --no-verify', 'git-no-verify'],
  // zsh precommand modifiers, more launchers, and unknown launchers.
  ['noglob git commit --no-verify -m x', 'git-no-verify'],
  ['nocorrect git commit -n -m x', 'git-no-verify'],
  ['coproc git commit --no-verify -m x', 'git-no-verify'],
  ['- git commit -n -m x', 'git-no-verify'],
  ['arch -arm64 git commit --no-verify -m x', 'git-no-verify'],
  ['stdbuf -o0 git commit -n -m x', 'git-no-verify'],
  ['xcrun git commit -n -m x', 'git-no-verify'],
  ['chrt -f 10 git commit -n', 'git-no-verify'],
  ['taskset -c 0 git commit -n', 'git-no-verify'],
  ['ionice -c 3 git commit -n', 'git-no-verify'],
  ['arch -e GOLDBAND_STYLE_GATE=0 git commit -m x', 'goldband-gate-disabled'],
  ['arch -arm64 env HUSKY=0 git commit -m x', 'project-hooks-disabled'],
  ['vendor-run git commit --no-verify', 'git-no-verify'],
  ['vendor-run SKIP=lint git commit', 'project-hooks-disabled'],
  ['vendor-run bash -c "git commit -n"', 'git-no-verify'],
  // A relocation reaches git through launchers and earlier statements.
  ["HOME=/tmp/h sh -c 'git commit -m x'", 'git-global-config-relocated'],
  ['echo | HOME=/tmp/h xargs git commit -m x', 'git-global-config-relocated'],
  [
    'HOME=/tmp/h find . -maxdepth 0 -exec git commit -m x \\;',
    'git-global-config-relocated',
  ],
  ['export HOME=/tmp/h; git commit -m x', 'git-global-config-relocated'],
  ['unset HOME; git commit -m x', 'git-global-config-relocated'],
  ['HOME=/tmp/h; git commit -m x', 'git-global-config-relocated'],
  ["XDG_CONFIG_HOME=/tmp/x sh -c 'git commit'", 'git-global-config-relocated'],
  // Aliases that run a bypass, wherever they are defined.
  ['git -c alias.c="commit --no-verify" c', 'git-alias-bypass'],
  ["git -c alias.c='!HUSKY=0 git commit' c", 'git-alias-bypass'],
  ['git --config-env=alias.c=VAR c', 'git-alias-bypass'],
  ["git config alias.c 'commit -n'", 'git-alias-bypass'],
  ["git config set alias.c 'commit -n'", 'git-alias-bypass'],
  ["git config --global alias.p '!git push --no-verify'", 'git-alias-bypass'],
  [
    `GIT_CONFIG_PARAMETERS="'alias.c'='commit -n'" git c`,
    'git-config-env-override',
  ],
  [
    'GIT_CONFIG_COUNT=2 GIT_CONFIG_KEY_1=alias.c GIT_CONFIG_VALUE_1=x git c',
    'git-config-env-override',
  ],
  // An editor the agent scripts can rewrite any configuration.
  ['git config --global --edit', 'git-hookspath-config'],
  ["GIT_EDITOR='sed -i s/a/b/' git config -e", 'git-hookspath-config'],
  ['git config edit', 'git-hookspath-config'],
  // Brace expansion reaches the marker.
  ['touch .goldband-no-style-{gate,x}', 'no-style-gate-marker'],
  // ANSI-C and locale quoting are decoded.
  ["git commit $'--no-verify' -m x", 'git-no-verify'],
  [String.raw`git commit $'-\x6e' -m x`, 'git-no-verify'],
  ['git commit $"--no-verify" -m x', 'git-no-verify'],
  // Aliases invoked with options; the test HOME's ~/.gitconfig defines ci,
  // shci, and fnci.
  ['git ci -n -m x', 'git-alias-bypass'],
  ['git ci --no-verify', 'git-alias-bypass'],
  ['git CI -n', 'git-alias-bypass'],
  ['git shci -n', 'git-alias-bypass'],
  ['git fnci -m x', 'git-alias-bypass'],
  ['git config alias.zz commit && git zz -n', 'git-alias-bypass'],
  ['git config alias.zz commit && git ZZ -n', 'git-alias-bypass'],
  // Only the exact builtin name runs the builtin; alias.log is commit.
  ['git LOG -n 5', 'git-alias-bypass'],
  ['git -c alias.yy=commit yy -n', 'git-alias-bypass'],
  // A lookup that fails is not reported as safe.
  ['git -C missing-dir ci -n', 'git-alias-bypass'],
  ['git --attr-source HEAD commit --no-verify -m x', 'git-no-verify'],
  // Another repository's configuration for a hook-running subcommand.
  ['git --git-dir=/tmp/other.git commit -m x', 'git-dir-relocated'],
  ['git --git-dir /tmp/other.git push', 'git-dir-relocated'],
  ['GIT_DIR=/tmp/other.git git commit -m x', 'git-dir-relocated'],
  ['export GIT_DIR=/tmp/other.git; git push', 'git-dir-relocated'],
  ['env GIT_COMMON_DIR=/tmp/other git merge topic', 'git-dir-relocated'],
  ['git --git-dir=/tmp/other.git ci -m x', 'git-dir-relocated'],
  // Builtins that a Git version may lack still run as aliases there.
  ['git -c alias.refs=commit refs -n', 'git-alias-bypass'],
  ['git am -n x.patch', 'git-no-verify'],
  ['git am --no-v x.patch', 'git-no-verify'],
  ['git -c core.hooksPath=$P commit -m x', 'git-hookspath-override'],
  ['env -- HUSKY=0 git commit -m x', 'project-hooks-disabled'],
  ['env -u X -- SKIP=x git commit -m x', 'project-hooks-disabled'],
  ['env -- HOME=/x git commit -m x', 'git-global-config-relocated'],
  ['exec -c git commit -m x', 'git-config-env-override'],
  ['bash -c "exec -c git commit -m x"', 'git-config-env-override'],
  // su resets HOME to the target user's, and with it the global config.
  ["su -c 'git commit -m x'", 'git-global-config-relocated'],
  ["su root --command='git push'", 'git-global-config-relocated'],
  ['git clone -c core.hooksPath=/dev/null u d', 'git-hookspath-config'],
  ['git clone --config=core.hooksPath=/dev/null u d', 'git-hookspath-config'],
  ['git init --template=/tmp/t', 'git-hookspath-config'],
  // Abbreviated long options, the template configuration key, and
  // GIT_TEMPLATE_DIR supply the new repository's configuration too.
  ['git init --temp=/tmp/t', 'git-hookspath-config'],
  ['git clone --conf=core.hooksPath=/dev/null u d', 'git-hookspath-config'],
  ['git -c init.templateDir=/tmp/t init', 'git-hookspath-override'],
  ['git config --global init.templateDir /tmp/t', 'git-hookspath-config'],
  ['GIT_TEMPLATE_DIR=/tmp/t git clone u d', 'git-hookspath-config'],
  ['export GIT_TEMPLATE_DIR=/tmp/t; git init r', 'git-hookspath-config'],
  // A POSIX shell takes the script from the first operand after -c, past
  // other options and `--`.
  ["bash -c -- 'git commit -n -m x'", 'git-no-verify'],
  ["bash -c -e 'git commit -n -m x'", 'git-no-verify'],
  ["zsh -c -o errexit 'HUSKY=0 git commit -m x'", 'project-hooks-disabled'],
];

// Both hosts allow these commands without any Gate A or Gate G response.
export const gateAAllowCases = [
  'git commit -m "docs: explain --no-verify"',
  'git commit -m -n',
  'git push -n origin main',
  'git merge -n topic',
  'git merge --no-verify-signatures topic',
  'git -c user.name=x commit -m x',
  `GIT_CONFIG_PARAMETERS="'color.ui'='always'" git status`,
  'SKIP= git commit -m x',
  'GOLDBAND_STYLE_GATE=1 git commit -m x',
  'GOLDBAND_GIT_WORKFLOW_GATE=1 git commit -m x',
  'GOLDBAND_STYLE_GATE_DETAIL=1 git commit -m x',
  'GOLDBAND_PROJECT_HOOK_RUNNING=0 git commit -m x',
  'GOLDBAND_MAX_FILE_LINES=500 git commit -m x',
  'git config --get core.hooksPath',
  'git config --get include.path',
  'git config include.path',
  'git -c include.ui=x status',
  'env -S "GOLDBAND_STYLE_GATE=1 git commit -m x"',
  'git config core.hooksPath',
  'git config --global user.name x',
  'rg no-verify',
  'echo "git commit --no-verify"',
  'npm run test:style-gate',
  'rm .goldband-no-style-gate',
  'GIT_CONFIG_COUNT=2 GIT_CONFIG_KEY_1=user.name GIT_CONFIG_VALUE_1=x git commit',
  'for f in *.md; do echo "$f"; done',
  'until git diff --quiet; do sleep 1; done',
  'env -v true',
  'env -0 true',
  'env -u FOO git commit -m x',
  'env --chdir=src git status',
  'git config --get-all include.path',
  'GIT_CONFIG_GLOBAL=~/.gitconfig git config --get user.name',
  'HOME=/tmp git config --list',
  'GIT_CONFIG_NOSYSTEM=1 git commit -m x',
  'unset GIT_CONFIG_GLOBAL',
  'XDG_CONFIG_HOME=/tmp npm test',
  'env -u XDG_CONFIG_HOME git commit -m x',
  'git config alias.st status',
  'git -c alias.st=status st',
  'git config --get alias.c',
  'git config --unset alias.c',
  'HOME=/tmp npm test; git commit -m x',
  'export HOME=/tmp; npm test',
  'brew install git',
  'docker run img git status',
  'echo {a,b} git commit -n',
  'f() { git status; }; f',
  'git ci -m x',
  'git lg -n 5',
  'git log -n 5',
  'git nope -n',
  // A directory that does not exist yet holds no repository configuration.
  'cd not-yet && git ci -m x',
  'git config alias.zz log && git zz -n 3',
  'git --attr-source HEAD status',
  'git --git-dir=/tmp/other.git log',
  'GIT_DIR=/tmp/other.git git status',
  'unset GIT_DIR; git commit -m x',
  // Groups inside parameter expansions and [[ ]] may hold blanks.
  'echo ${x:-(none given)}',
  'echo ${(s: :)line}',
  '[[ $x =~ ^(a|b c)$ ]]',
  'f () { echo; }',
  'ls *(.om[1,3])',
  'git commit -m "$msg"',
  'HUSKY=1 git commit -m x',
  'su root -c "git status"',
  'git clone u d',
  'git config -f/home/a/x --get user.name',
  // Arguments computed when the command runs are outside Gate A's scope.
  'git push origin "$(git branch --show-current)"',
  'git push -u origin "$(git branch --show-current)"',
  'B=main; git push origin "$B"',
  'git merge "$branch"',
  'git commit --message="$M"',
  'git config --get init.templateDir',
  'GIT_TEMPLATE_DIR=/tmp/t git status',
  'bash -c -- echo ok',
];

// sudo and doas: Claude denies with the Gate A rule; Codex denies every sudo
// as high-risk, so only the Claude message names the rule.
export const gateAPrivilegedCases = [
  ['sudo HUSKY=0 git commit -m x', 'project-hooks-disabled'],
  ['sudo GOLDBAND_SECRET_GATE=0 git push', 'goldband-gate-disabled'],
  ['sudo -u dev SKIP=lint git commit', 'project-hooks-disabled'],
  ['doas HOME=/tmp git commit -m x', 'git-global-config-relocated'],
  // env_reset drops GIT_CONFIG_* and changes HOME unless -E keeps them.
  ['sudo git commit -m x', 'git-global-config-relocated'],
  ['sudo -u dev git push', 'git-global-config-relocated'],
];
export const privilegedAllowCases = [
  'sudo -u x git status',
  'doas git log',
  'sudo -E git commit -m x',
  'sudo --preserve-env git commit -m x',
];

// Commands the shared shell parser cannot analyze. Both hosts deny them in
// every mode instead of reporting them safe.
export const gateAAnalysisFailureCases = [
  "git commit --no-verify -m x; env -S 'echo $HOME' true",
  String.raw`HUSKY=0 git commit -m x; env -S "printf a\nb"`,
  'echo x > .claude/settings.json; bash 0<&5',
  // More words than brace expansion produces before failing closed.
  'touch f{1..10001}',
  'echo x > .claude/settings.(json|bak',
  'echo a(b c)',
  // zsh glob qualifiers that run shell code.
  "ls *(e:'echo x > .claude/settings.json':)",
  'ls *(+run)',
  // A NUL ends a C string, so the shell would see a different word.
  "echo x > $'.mcp.json\\0x'",
  "git commit $'-\\0n' -m x",
];

// Gate A without a core.hooksPath entry in the hook environment.
export const gateANoOverrideCases = [
  ['GIT_CONFIG_COUNT=0 git commit', 'deny'],
  ['GIT_CONFIG_KEY_0=core.hooksPath git commit', 'deny'],
  ['unset GIT_CONFIG_KEY_0', 'none'],
  ['GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=user.name git commit', 'none'],
  // env -i also drops HOME, and with it Git's global configuration.
  ['env -i git commit -m x', 'deny'],
  ['env -i PATH=/usr/bin true', 'none'],
  ["env -i sh -c 'git commit -m x'", 'deny'],
];

// Protected targets. `~/` is the test HOME; other paths are project-relative.
// claudeBuiltin: Claude Code asks before its own file tools write the path.
export const protectedTargets = [
  { target: '.claude/settings.json', claudeBuiltin: true },
  { target: '.claude/settings.local.json', claudeBuiltin: true },
  { target: '~/.claude/settings.json', claudeBuiltin: true },
  { target: '.claude/hooks/pre.sh', claudeBuiltin: true },
  { target: '~/.claude.json', claudeBuiltin: true },
  { target: '.mcp.json', claudeBuiltin: true },
  { target: '.codex/config.toml' },
  { target: '.codex/hooks.json' },
  { target: '~/.codex/config.toml' },
  { target: '~/.codex/hooks.json' },
  { target: '~/.codex/rules/default.rules' },
  { target: '~/.config/goldband/x' },
  { target: '~/.config/goldband/git-hooks/lib/gitleaks.toml' },
  { target: '~/.zshenv', claudeBuiltin: true },
  { target: '.gitleaks.toml' },
  { target: '.gitleaksignore' },
  // Claude's own protection covers only $HOME/.zshenv, not $ZDOTDIR/.zshenv.
  { target: '~/zdot/.zshenv', env: { ZDOTDIR: '~/zdot' } },
  { target: '~/.zshenv', claudeBuiltin: true, env: { ZDOTDIR: '~/zdot' } },
  // Case-insensitive filesystems resolve these to protected files. Claude's
  // own prompt is not relied on for names outside their canonical case.
  { target: '.Claude/Settings.json' },
  { target: '.CLAUDE/hooks/pre.sh' },
  { target: '.MCP.json' },
  { target: '.GITLEAKSIGNORE' },
  { target: '.Codex/Config.toml' },
  { target: '~/.CODEX/config.toml' },
  { target: '~/.CONFIG/goldband/x' },
  { target: '~/.ZSHENV' },
  { target: '~/xdg/goldband/config', env: { XDG_CONFIG_HOME: '~/xdg' } },
  {
    target: '~/hooks-override/lib/gitleaks.toml',
    env: { GOLDBAND_GIT_HOOKS_DIR: '~/hooks-override' },
  },
  { target: '~/.codex/hooks/hook-router.js' },
  { target: '~/.claude/plugins/installed_plugins.json' },
  { target: '~/.claude/plugins/cache/m/p/1.0.0/hooks/hooks.json' },
  { target: '.git/config' },
  { target: 'sub/.git/worktrees/w/config.worktree' },
  { target: '~/.gitconfig' },
  { target: '~/.config/git/config' },
  { target: '.codex/hooks/notes.md' },
  { target: '.git' },
  { target: 'repo.git/config' },
  { target: '~/.config/git' },
  // Files named by [include] and [includeIf] in the global configuration.
  { target: '~/extra.gitconfig' },
  { target: '~/work.gitconfig' },
  { target: '~/inline.gitconfig' },
  { target: '~/quoted.gitconfig' },
];

export const unprotectedTargets = [
  'CLAUDE.md',
  'AGENTS.md',
  'src/app.js',
  '.claude/agents/reviewer.md',
  '.codex/notes.md',
  'docs/mcp.json',
  '.claude-notes.md',
  '.Claude/agents/reviewer.md',
  '.MCP.json.md',
  '.Codex/notes.md',
  'src/config',
  'git/config',
  '.gitconfig.md',
];

// Shell write forms; T is replaced with the target.
export const shellWriteForms = [
  'echo x > T',
  'echo x >> T',
  'echo x >| T',
  'echo x >! T',
  'echo x >>! T',
  'echo x >& T',
  'echo x &> T',
  'echo x | tee T',
  "sed -i 's/a/b/' T",
  "sed -i '' 's/a/b/' T",
  'cp notes.md T',
  'mv notes.md T',
  'rm -f T',
  'ln -sf notes.md T',
  'bash -c "echo x > T"',
  'install -m 644 notes.md T',
  'install -d T',
  'dd if=notes.md of=T',
  'truncate -s 0 T',
  'truncate --size=0 notes.md T',
  'cat <> T',
  'chmod 000 T',
  'chmod -x T',
  'chown nobody T',
  'chgrp staff T',
  'chflags uchg T',
  'chmod --reference=notes.md T',
];

// Reads and diffs of protected files are never intercepted.
export const shellReadForms = [
  'cat T',
  'git diff -- T',
  'grep -n x T',
  'cp T backup.txt',
  'sed -n 1p T',
];

export const claudeModes = [
  'default',
  'acceptEdits',
  'plan',
  'auto',
  'bypassPermissions',
];

// Shell writes resolved through directory changes, recursive copies, and
// further writers: [command, protected]. Run from a project holding
// kit/.claude/settings.json, docs/guide.md, an empty out/, and big/ with more
// entries than a recursive copy lists.
export const shellResolutionCases = [
  // The link a later write goes through is the protected source.
  ['ln -s ~/.gitconfig link && echo x >> link', true],
  ['ln -s .git g; echo x > g/config', true],
  // Defaults, the working directory, and same-command assignments expand.
  ['echo x > ${XDG_CONFIG_HOME:-$HOME/.config}/git/config', true],
  ['cd ~ && echo {} > ~+/.claude.json', true],
  ['cd ~ && echo {} > $PWD/.claude.json', true],
  ['T=.mcp.json; echo {} > $T', true],
  ['export T=.mcp.json; echo {} > "$T"', true],
  ['T=notes.md; echo x > $T', false],
  // A path key outside an include section includes nothing.
  ['echo x > ~/core.gitconfig', false],
  // An assignment expands the names assigned before it.
  ['A=.claude; B=$A/settings.json; echo {} > $B', true],
  ['A=.git; B=$A; C=$B/config; echo x > $C', true],
  ['A=docs; B=$A/notes.md; echo x > $B', false],
  ...assignmentResolutionCases,
  ['echo x > "$LOG"', false],
  ["sh -c -- 'echo x > .mcp.json'", true],
  // apply_patch run from the shell, by argument or heredoc.
  [
    "apply_patch $'*** Begin Patch\\n*** Update File: .git/config\\n@@\\n-a\\n+b\\n*** End Patch'",
    true,
  ],
  [
    "apply_patch <<'EOF'\n*** Begin Patch\n*** Add File: .mcp.json\n+{}\n*** End Patch\nEOF",
    true,
  ],
  [
    "applypatch <<'EOF'\n*** Begin Patch\n*** Add File: out/a.md\n+{}\n*** End Patch\nEOF",
    false,
  ],
  ['cd -P .claude && echo {} > settings.json', true],
  ['cd -L -- .claude && echo {} > settings.json', true],
  ['pushd .claude && echo {} > settings.json', true],
  ['pushd -- .claude >/dev/null; touch settings.local.json', true],
  ['env -C .claude touch settings.json', true],
  ['env --chdir=.claude cp ../notes.md settings.json', true],
  ['env -C.claude tee hooks/x.sh', true],
  ['cd -P src && echo x > notes.txt', false],
  ['pushd src && echo x > notes.txt && popd', false],
  ['cd - && echo x > notes.txt', false],
  ['env -C src touch notes.txt', false],
  // A redirection opens its file in the shell's directory, not env's.
  ['env -C .claude echo x > settings.json', false],
  ['cp -R kit/ out/', true],
  ['cp -R kit/. out', true],
  ['cp -a kit/ out/', true],
  ['cp -r kit out/', true],
  ['cp -r kit out/new', true],
  ['mv kit out/', true],
  ['cp -R missing/ out/', true],
  ...copySourceCases,
  ['cp -R big/ out/', true],
  ['cp -R docs/ out/', false],
  ['cp -r docs out/', false],
  ['cp -a docs/. out', false],
  ['cp kit/ out/', false],
  ['mv docs out/', false],
  ['install -t .claude/hooks notes.md', true],
  ['install -D notes.md .claude/settings.json', true],
  ['install -m 644 notes.md out/notes.md', false],
  ['install -d out/bin', false],
  ['dd if=notes.md of=out.bin', false],
  ['truncate -s 0 log.txt', false],
  ['truncate -r notes.md log.txt', false],
  // chmod-family operands, and every entry below a recursive operand.
  ['chmod 000 ~/.config/goldband/git-hooks/pre-push', true],
  ['chmod -x ~/.config/goldband/git-hooks/pre-commit', true],
  ['chmod -R 700 kit', true],
  ['chown -R nobody kit/', true],
  ['chmod -R u+w big', true],
  ['chmod 700 ~/.config', true],
  ['chmod +x scripts/foo.sh', false],
  ['chmod 644 notes.md', false],
  ['chmod -R 755 docs', false],
  ['chmod -R 755 missing', false],
  ['chown -R nobody src', false],
  // env -C applies to nested shells, wrappers, and stdin scripts it runs.
  ['env -C ~ sh -c "echo x > .claude.json"', true],
  ['env -C .claude bash -c "echo {} > settings.json"', true],
  ['env -C .claude bash -c "cd hooks && touch x.sh"', true],
  ['env -C .claude xargs touch settings.json', true],
  ['env -C .claude bash <<EOF\necho {} > settings.json\nEOF', true],
  ['env -C src sh -c "echo x > notes.txt"', false],
  ['env -C src sh -c "echo x > settings.json"', false],
  // A precommand modifier keeps the directory change visible.
  ['noglob cd .claude && echo {} > settings.json', true],
  ['builtin cd .claude && echo {} > settings.json', true],
  // Brace and glob expansion of written words: bash, zsh groups and
  // qualifiers, and bash extglob.
  ['echo {} | tee .claude/settings.{json,bak}', true],
  ['touch .claude/hooks/{a,b}.sh', true],
  ['echo x > .claude/settings.jso{m..o}', true],
  ['echo x > kit/.claude/settings.jso[n]', true],
  ['echo x > kit/.claude/settings.js?n', true],
  ['echo x > kit/.claude/s*.json', true],
  ['echo x > kit/.claude/settings.(json|bak)', true],
  ['echo x > kit/.claude/settings.json(N)', true],
  ['echo x > kit/.claude/settings.@(json|bak)', true],
  ["sed -i '' s/a/b/ kit/.claude/settings.js[o]n", true],
  ['rm -f kit/.claude/*', true],
  ['cp notes.md kit/.cl?ude/settings.json', true],
  ['echo x > docs/*.md', false],
  ['echo x > notes.{md,txt}', false],
  ['touch "kit/.claude/{a,b}"', false],
  // Quoted glob characters also expand here; over-matching is the safe side.
  ["echo x > 'kit/.claude/settings.jso[n]'", true],
  ['echo x > kit/.claude/missing.jso[n]', false],
  ['cat kit/.claude/*.json', false],
  // zsh dot qualifiers, and a group that starts an argument.
  ['rm -rf kit/*(D)', true],
  ['rm -rf (x|kit)/.claude', true],
  ['rm -rf (docs|src)/guide.md', false],
  // Home directory spellings.
  ['echo x > ${HOME:-/x}/.claude.json', true],
  ['echo x > ${HOME}/.claude.json', true],
  [`echo x > ~${os.userInfo().username}/.claude.json`, true],
  ['echo x > ~nobody-else/.claude.json', false],
  // An mv source that cannot be listed counts as holding protected names.
  ['mv big moved', true],
  ['mv missing moved', false],
  // The whole .git directory and Git's XDG directory are containers.
  ['rm -rf .git', true],
  ['ln -sfn /tmp/evil .git', true],
  ['rm -rf ~/.config/git', true],
];
