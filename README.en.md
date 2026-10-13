# goldband

Local engineering tools for Claude Code and Codex, with shared development rules, tool configuration, and workflows.

English | [中文](README.md)

Claude and Codex share secret classification. Documentation and development
servers follow operational guidance without filename or tmux hook blockers.
See [hook ownership and host differences](ARCHITECTURE.md#shared-hook-policy-and-host-adapters).

## What It Does

- Installs shared development rules, hooks, and skills to reduce repeated project setup.
- Manages local Claude Code and Codex configuration, with installation checks and uninstall commands.
- Optionally adds Goldband Loop for code review, investigation, planning, QA, and other workflows.

On review failure, Claude/Codex hooks point to the installed launch contract; incomplete environment evidence points to that run's report. Hooks do not retry automatically.

## Before Installing

- Have Git, Node.js, and the Claude Code or Codex CLI you intend to use available.
- Installer-based Claude configuration also needs `jq`; Codex configuration installation and checks require **Python 3.11 or later**.
- Use a complete Git checkout; do not download only `install.sh`.
- Goldband Loop also requires **Bun 1.3.11 or later**. `make-pdf` requires Playwright Chromium, which the installer installs and verifies. Browser QA uses the host's own browser tool; `all-with-workflow` configures Playwright MCP for both hosts, keeps any existing entry, and can be skipped with `GOLDBAND_SKIP_PLAYWRIGHT_MCP=1` (see [mcp/README.md](mcp/README.md)).
- Use Bash on macOS/Linux and Git Bash or WSL on Windows. There is no native PowerShell installer. Individual workflow limits are described below.

The installer changes tool configuration, hooks, and skills in your home directory. Choose either the Claude plugin or the installer's Claude core setup to avoid loading duplicate assets.

## Install

Clone the project:

```bash
git clone https://github.com/leo110047/goldband.git
cd goldband
```

Choose one installation path:

| Need | Installation |
| --- | --- |
| Claude Code core guardrails | Claude plugin commands below |
| Full Codex configuration | `./install.sh codex-full` |
| Full Claude Code and Codex configuration | `./install.sh all-tools` |
| Both tools plus Goldband Loop workflows | `./install.sh all-with-workflow` |

To install the Claude plugin:

```bash
claude plugin marketplace add ./
claude plugin install goldband@goldband --scope user
```

The Claude plugin does not include Goldband Loop. For workflows on a single tool, the Codex portable plugin, or Claude Desktop/web/mobile integrations, see [additional install options](OPERATIONS.md#additional-install-options).

Check installation status, then restart Claude Code/Codex:

```bash
./install.sh status
```

Your selected components should report `[OK]`. If status reports stale, corrupt, or duplicate assets, follow its remediation instructions first.

## Try a Workflow

After installing Goldband Loop, start by checking your local installation. Enter the following in the corresponding tool's conversation:

```text
Claude Code: /goldband system health
Codex:       $goldband system health
```

See the [workflow catalog](docs/generated/capabilities.md) for other actions.

`review/code` runs one independent, read-only semantic review of the current worktree. Use `--base <ref>`, `--staged`, or `--diff-file <file>` to narrow scope. Findings identify the code path, trigger, impact, and suggested verification. Repeat the same entrypoint after repairs; each run reviews the current scope.

The reviewer does not execute project tests or change ticket status. Continue running project tests, lint, type checks, CI, and relevant live checks separately; no findings does not establish runtime correctness.

## Update and Uninstall

Update the source in your original checkout:

```bash
git pull --ff-only
```

Then update using your original installation method:

- **Installer**: rerun the command you originally selected from the table above, such as `./install.sh codex-full` for Codex.
- **Claude plugin**: run `claude plugin update goldband@goldband`.

Run `./install.sh status` afterward and restart your tool.

Codex initializes defaults only when `~/.codex/config.toml` is absent. Reinstallation and updates preserve existing values, omitted keys, comments, and line endings; later template changes are not applied automatically. Claude preserves the model, permission mode, custom hooks, and status line. If config is invalid or Python 3.11+ is unavailable, `codex-core`/`codex-full` still process other components, then return nonzero and record a partial background refresh.

`shell_environment_policy` is a recommendation, not enforced policy. `status` advises manual review when it differs from the template without overwriting it. `codex-requirements` is installed separately and constrains only its declared fields, excluding environment-variable filters. Goldband hooks, the reserved `goldband.rules` baseline, and named profiles update independently; personal rules belong in `default.rules`.

Goldband status lines are optional for both hosts. These commands explicitly replace the current layout; ordinary installation and background updates preserve it:

```bash
./install.sh claude-statusline
./install.sh codex-statusline
```

Explicitly applying the Codex status line changes only the value of `tui.status_line`, without adding other defaults, but can reformat TOML and remove comments. Before changing personal settings, both hosts retain two originals: `.bak` and `.bak.previous`. No-op operations do not rotate them; older backups are not automatically deleted.

Uninstall preserves the main Codex config, personal rules, custom Claude hooks, and non-Goldband status lines. It removes identifiable Goldband links/copies and retains modified or unknown files. If Claude settings cannot be parsed or `jq` is unavailable, it retains those settings and referenced Claude assets, continues independent Codex removal, and returns nonzero. Choose the command matching your installation method:

```bash
./install.sh uninstall                       # Remove installer-managed components
claude plugin uninstall goldband@goldband    # Remove the Claude plugin
```

## Documentation and Help

- [Operations and troubleshooting](OPERATIONS.md): additional install options, managed worktrees, MCP, and maintenance.
- [Goldband Loop](goldband-loop/README.md): workflow configuration and usage.
- [Contributing](CONTRIBUTING.md): development setup, tests, and distribution updates.
- [Architecture](ARCHITECTURE.md): component ownership, isolation, and verification mechanisms.
- [Report an issue](https://github.com/leo110047/goldband/issues): include your platform, installation method, and relevant error output, with keys and other sensitive data removed.

## License

[MIT License](LICENSE).

Claude and Codex global guidance is generated from one compact policy. Full policies live in each host’s `goldband-rules/` directory for task-specific reading. Upgrades retire Goldband’s old Claude autoload link while preserving custom rules. The Codex plugin follows the installer catalog with 13 compatible skills; Claude provides 17. If Goldband Loop is installed, also rerun the original workflow install command to refresh its copied runtime and review rubric.
