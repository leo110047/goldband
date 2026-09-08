# goldband

Local engineering tools for Claude Code and Codex, with shared development rules, tool configuration, and workflows.

English | [中文](README.md)

## What It Does

- Installs shared development rules, hooks, and skills to reduce repeated project setup.
- Manages local Claude Code and Codex configuration, with installation checks and uninstall commands.
- Optionally adds Goldband Loop for code review, investigation, planning, QA, and other workflows.

## Before Installing

- Have Git, Node.js, and the Claude Code or Codex CLI you intend to use available.
- Installer-based Claude configuration also needs `jq`; Codex configuration checks require **Python 3.11 or later**.
- Use a complete Git checkout; do not download only `install.sh`.
- Goldband Loop also requires **Bun 1.3.11 or later**. Browser workflows require Playwright Chromium, which the installer installs and verifies.
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

Code review requires a verification contract for the target project; begin with the [review quick start](docs/review-evidence-manifest.md#quick-start). Formal review requiring locally sandboxed test execution currently supports macOS only; Linux/Windows report incomplete when this evidence is unavailable. Successful installation or tests do not imply that review or deployment is complete.

## Update and Uninstall

Update the source in your original checkout:

```bash
git pull --ff-only
```

Then update using your original installation method:

- **Installer**: rerun the command you originally selected from the table above, such as `./install.sh codex-full` for Codex.
- **Claude plugin**: run `claude plugin update goldband@goldband`.

Run `./install.sh status` afterward and restart your tool.

To uninstall, choose the command matching your installation method:

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
