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

The workflow installer installs and verifies Playwright Chromium. For an offline
or CI setup that does not need browser workflows, use
`GOLDBAND_SKIP_PLAYWRIGHT=1` with your chosen install command. This explicitly
skips browser setup; it does not provide a working browser workflow.

After updating, rerun your original installation command and `./install.sh status`.
Status checks the installed source inputs, artifact integrity, and dispatch
behavior. Stale or corrupt workflow installations require reinstalling; pulling
new source alone is insufficient.

## Managed Worktrees

Use a managed worktree when an agent needs an isolated working copy. Run
`create` from a clean source worktree on a normal branch:

```bash
goldband worktree create task-name
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
goldband worktree finish task-name -m "feat: integrate task"
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

Use a local scheduled task outside this repo when you want recurring checks. The
repo does not install scheduled jobs by default.

Weekly check:

```bash
cd /path/to/goldband
bash scripts/check-codex-portability.sh
./scripts/check-skills.sh
python3 scripts/verify-hook-script-references.py
node scripts/check-code-style.mjs
npm run test:hook-router
npm run test:hook-router:coverage
npm run test:eval-budget-cap
```

If `codex/rules/default.rules` becomes dirty with local approvals, run:

```bash
./install.sh repair-codex-rules
```

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
git config --global --get core.hooksPath
```

Expected goldband value:

```text
~/.config/goldband/git-hooks
```

Default install packs do not change global git settings; run `style-gate`
explicitly when you want the machine-wide hook. The pre-commit hook checks only
staged files. Biome checks run only when the target repo has `biome.json`;
otherwise the hook keeps the zero-dependency checks and emits an advisory. If
the recorded Goldband source script or `node` is unavailable, the hook warns
and allows the commit so one broken goldband checkout does not block every repo
on the machine. The hooks themselves are materialized outside the checkout so
Git LFS or another hook manager cannot write generated hooks into Goldband
source. Re-running `./install.sh style-gate` refreshes the materialized runtime
and migrates the legacy source-checkout `core.hooksPath`. The commit-msg
Conventional Commits gate is installed but enforced only when the repo has
`.goldband-git-workflow.json` or `GOLDBAND_GIT_WORKFLOW_GATE=1`.

Large generated text files use the exact-path contract documented in
`rules/coding-style.md`. Ordinary text remains limited to 1 MB; a tracked
`.goldband-style.json` may name a tracked generator and a per-file cap up to the
16 MB generated-text hard limit. The exception does not replace the
project-specific regeneration/drift check.

When the global hook is active, goldband runs first. After the goldband
pre-commit or commit-msg gate passes or soft-skips, it looks for an executable
project hook in the repo's default git hook directory:

- `.git/hooks/pre-commit`
- `.git/hooks/commit-msg`

If that project hook exists, goldband runs it next. If it does not exist, the
hook chain ends without requiring any project configuration. There is no order
setting; goldband-first is the default contract.

This repository also has a project style gate script:

```bash
node scripts/check-goldband-project-style-gate.mjs --staged
```

It selects fast goldband-specific checks by staged path: selector parity,
plugin distribution artifacts, hook script references, Codex portability, and
style-gate self-tests. `./install.sh style-gate` installs a thin
`.git/hooks/pre-commit` shim for this checkout; the global goldband hook will
invoke that project hook after the global gate passes.

A repo can opt out permanently by adding `.goldband-no-style-gate`, or
temporarily with:

```bash
GOLDBAND_STYLE_GATE=0 git commit
```

Temporary bypasses print a warning and write a local log under
`${XDG_STATE_HOME:-$HOME/.local/state}/goldband/style-gate-bypass.log`.

If a repo uses Husky or another local `core.hooksPath`, git uses the local value
instead of the global goldband hook. That is expected; in that setup, the
project hook owns the chain and must invoke goldband explicitly if it wants both
checks.

## Plugin and Installer Distribution

Claude Code core distribution uses the local plugin marketplace:

```bash
claude plugin marketplace add ./
claude plugin install goldband@goldband --scope user
claude plugin list --json
```

Before releasing plugin changes:

```bash
node scripts/sync-plugin-assets.mjs --check
npm run test:plugin-distribution
claude plugin validate plugin-assets/claude-code-plugin
```

The sync script generates `plugin-assets/claude-code-plugin/`,
`.claude-plugin/marketplace.json`, and
`docs/reports/plugin-expected-assets.json` from the source `commands/`,
`rules/`, `hooks/`, and `skills/global/` directories. Do not hand-edit generated
plugin files.

CI installs Claude Code with `npm install -g @anthropic-ai/claude-code` and runs
the full `npm run test:plugin-distribution` gate. Local contributors should run
the same command before committing plugin-affecting changes; the `--skip-cli`
mode is only a structural/runtime-smoke fallback and does not validate Claude
plugin manifest schema or installation behavior.

Uninstall paths are intentionally separate:

```bash
claude plugin uninstall goldband@goldband
./install.sh uninstall
```

`./install.sh status` detects when the plugin and installer-managed Claude
assets both exist. Duplicate `commands`, `rules`, `hooks`, or `skills` are not a
green state; status reports active sources, duplicate names, remediation, and
exits non-zero.

goldband's active installer path is the POSIX installer:

```bash
./install.sh all-tools
./install.sh all-with-workflow
./install.sh status
./install.sh uninstall
```

On Windows, use Git Bash or WSL. Native PowerShell install, status, uninstall,
and self-update wrappers are retired. If an older install left
`~/.claude/bin/goldband-self-update.ps1`,
`~/.claude/shell/goldband-launchers.ps1`, or
`~/.claude/.goldband-windows-state.json`, rerun `./install.sh launchers` from
Git Bash to back up the stale files and remove the old PowerShell profile block.

`./install.sh codex-requirements` manages `/etc/codex/requirements.toml` on
POSIX hosts and `%ProgramData%\OpenAI\Codex\requirements.toml` when run from
Git Bash on Windows. Native Windows managed requirements may still require an
administrator or managed policy. goldband does not stage
`~/.codex/requirements.toml` as a Windows enforcement path.

## Goldband Telemetry

Goldband telemetry is local-only. It writes JSONL files on this machine and does
not upload to an external service.

### Work Map tracker configuration and sync

Work Maps are local-only unless tracker mode is explicitly configured. A
configuration file contains no token; authentication stays in `gh` or `glab`.
For example, save this request outside the repository and run the matching host
launcher with `goldband plan sync configure --input <file> --host <host>`:

```json
{
  "schemaVersion": 1,
  "mode": "github",
  "repository": "owner/repository",
  "defaultLabels": ["goldband"],
  "dependencyCapability": "body-links"
}
```

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

Usage events:

```bash
node -e 'const t = require("./hooks/scripts/lib/hook-router/usage-telemetry"); console.log(t.getUsageFile())'
```

Metrics events:

```bash
node -e 'const m = require("./hooks/scripts/lib/hook-router/metrics"); console.log(m.getMetricsFile())'
```

Path resolution order:

1. `CLAUDE_PLUGIN_DATA/<namespace>` when Claude exposes stable plugin data.
2. `GOLDBAND_DATA_DIR/<namespace>` when explicitly configured.
3. `${XDG_DATA_HOME}/goldband/<namespace>` when `XDG_DATA_HOME` is set.
4. `~/.local/share/goldband/<namespace>`.
5. System temp only if the durable paths cannot be created.

Default files are `hook-router/usage-events.jsonl` and
`hook-router/metrics.jsonl` under that resolved data root. Usage telemetry is
enabled by default and can be disabled with
`GOLDBAND_USAGE_TELEMETRY_ENABLED=0`. Hook metrics are enabled by default and
can be disabled with `HOOK_ROUTER_METRICS_ENABLED=0`.

Weekly usage and hook report:

```bash
node hooks/scripts/tools/report-usage-summary.js --days 7
node hooks/scripts/tools/report-usage-summary.js --days 7 --json
```

The human report answers, in the first screen, which `goldband-*` workflow
entries were used and how often, separated into `confirmed` and `inferred`
signals, plus hook deny and advisory counts. `confirmed` means a hook payload
explicitly reported a `Skill` tool invocation with a `goldband-*` skill name.
`inferred` is used for slash-command prompts and Bash wrapper commands such as
`goldband-review`; do not treat inferred signals as real workflow completion.
Future keep/delete decisions should use confirmed workflow counts as the primary
signal. Inferred workflow signals and hook advisories are secondary triage data
and can be noisy.

Weekly telemetry mining:

```bash
node scripts/mine-telemetry.mjs summary --days 7
node scripts/mine-telemetry.mjs classify --days 7
node scripts/mine-telemetry.mjs extract-fixtures --days 7 --out-dir /tmp/goldband-telemetry-review
node scripts/mine-telemetry.mjs extract-evals --days 7 --out-dir /tmp/goldband-telemetry-review
```

The miner never rewrites source telemetry. It reads the usage JSONL base file
plus rotated siblings, and it reads workflow evidence from
`${GOLDBAND_HOME:-$HOME/.goldband}/workflow-runs` unless
`--workflow-runs-dir` is supplied. `extract-fixtures` runs candidate replay
checks with `GOLDBAND_HOME`, `GOLDBAND_DATA_DIR`, and `CLAUDE_PLUGIN_DATA`
pointed at a temp sandbox so hook marker files do not land in the real state
root. Replay fixture and eval outputs are review candidates only; do not append
them to `hooks/fixtures/router/replay-fixtures.json` or a formal eval dataset
until a human has reviewed the sanitized content.

OTLP trace export is opt-in and offline-first. JSONL remains the source of
truth; the exporter only reads the usage file and sends a derived traces payload
when explicitly run:

```bash
node scripts/export-telemetry-otlp.mjs --dry-run
node scripts/export-telemetry-otlp.mjs --endpoint http://localhost:4318
```

The exporter supports `--usage-file`, `--cursor-file`, `--dry-run`, and
`--limit`. `--since` is dry-run only because formal exports advance a cursor. See
[docs/observability.md](docs/observability.md) for the local Jaeger demo and
[docs/telemetry-schema.md](docs/telemetry-schema.md) for the v1 schema.

## Regression Gates and Failure Taxonomy

Hook policy regressions are tracked through the required/free replay gate:

```bash
npm run test:hook-router
npm run test:telemetry
npm run test:hook-router:coverage
npm run test:eval-budget-cap
```

The repository-root `Validate Config` workflow runs these commands on pushes to
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
