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

goldband installs `pre-commit` and `commit-msg`, which run the goldband gate
first, and a chain-only hook for each of `applypatch-msg`, `pre-applypatch`,
`post-applypatch`, `pre-merge-commit`, `prepare-commit-msg`, `post-commit`,
`pre-rebase`, `post-checkout`, `post-merge`, `pre-push`, `post-rewrite`,
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
