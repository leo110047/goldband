# goldband

> Shared engineering guardrails for Claude Code and Codex.

English | [中文](README.md)

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## What Is goldband

goldband is a shared set of engineering guardrails for Claude Code and Codex. Its goal is to make AI coding workflows more stable, verifiable, and maintainable.

This repo does three main things:

- owns the shared policy surface: commands, hooks, rules, contexts, and portable skills
- owns install and update behavior: it connects local Claude Code / Codex config back to this repo, then runs safe self-update and skill sync before startup
- bundles the `workflow` runtime and exposes it through `goldband-*` entry points

## goldband vs workflow

This repo contains both goldband itself and a vendored `workflow` runtime source tree, but they are not the same responsibility boundary:

- goldband owns shared policy, installer behavior, Claude/Codex adapters, repo-linked hooks/commands/contexts/rules, and portable skills
- `vendor/workflow/` is the bundled upstream runtime source, with its own packaging, changelog, architecture, and runtime docs
- install-time integration happens through [`shell/install/workflow.sh`](shell/install/workflow.sh), which turns workflow runtime content into `goldband-*` user-facing entry points and host-specific install layouts

For the explicit boundary and maintenance rules, read [ARCHITECTURE.md](ARCHITECTURE.md). For runtime-specific product and internals documentation, read [vendor/workflow/README.md](vendor/workflow/README.md) and [vendor/workflow/ARCHITECTURE.md](vendor/workflow/ARCHITECTURE.md).

## Installation

### Supported platforms

Officially supported today:

- macOS / other POSIX shell environments: `install.sh`
- Windows PowerShell: `install.ps1`

The Windows path uses PowerShell launcher integration by default. Workflow installation additionally requires a working `bash` (Git for Windows / Git Bash is the recommended setup).

### Quick start

Clone the full repo with `git clone`:

```bash
git clone https://github.com/leo110047/goldband.git
cd goldband
```

Do not copy `install.sh` by itself, and do not use a download method that strips `.git`. goldband uses a repo-linked install model, and startup self-update also depends on git metadata.

macOS / POSIX shell:

```bash
./install.sh pack-quality      # Recommended for Claude Code
./install.sh all-tools         # Claude Code + Codex
./install.sh all-with-workflow # Claude Code + Codex + bundled workflow
```

Windows PowerShell:

```powershell
pwsh -File .\install.ps1 all-tools         # Claude Code + Codex
pwsh -File .\install.ps1 all-with-workflow # Claude Code + Codex + bundled workflow
pwsh -File .\install.ps1 status            # Check install status
```

### Advanced install options

If you only want to install specific parts, you can also run:

```bash
./install.sh codex-full     # Install Codex only
./install.sh workflow       # Install Claude-side workflow only
./install.sh workflow-codex # Install Codex-side workflow only
./install.sh launchers      # Reinstall claude/codex launchers
./install.sh status         # Check install status
./install.sh uninstall      # Remove install
```

Dependency notes:

- `hooks` merging requires `jq`. On macOS, install it with `brew install jq`
- On Windows, the workflow path additionally requires `bash`; Git for Windows is the intended setup

## Updates

The normal update flow is:

```bash
cd /path/to/goldband
git pull --ff-only
```

After that, rerun the same install combination you originally used. For example, rerun `./install.sh pack-quality` if you only installed Claude Code, `./install.sh all-tools` if you installed Codex too, and `./install.sh all-with-workflow` if you also installed workflow.

If you normally launch with `claude` or `codex`, goldband will also do a safe self-update check before startup. macOS / POSIX uses the shell launcher path; Windows uses the PowerShell launcher path. It only auto-fast-forwards when the repo is clean, the branch is `main`, the repo tracks `origin/main`, and `git pull --ff-only` is safe. Otherwise it skips the update.

## Language

goldband wrappers support `zh-TW` and `en`. The default is `zh-TW`.

In Claude Code, the simplest way is:

```text
/goldband-language
```

If you already know the target language, you can also run:

```text
/goldband-language zh-TW
/goldband-language en
```

If you are in Codex or want to set it directly, you can run:

```bash
~/.codex/skills/workflow/bin/workflow-config set goldband_language zh-TW
~/.codex/skills/workflow/bin/workflow-config set goldband_language en
```

If the current session does not pick up the new setting immediately, restart Claude Code or Codex once.

## Common Entry Points

The most common entry points are `/plan`, `/verify`, `/goldband-investigate`, `/goldband-review`, and `/goldband-qa`. For stronger safety protection, use `careful-mode`. For read-only investigation, use `freeze-mode`.

## `workflow`

`workflow` is the bundled high-level runtime used by goldband. Install it with `./install.sh workflow`, `./install.sh workflow-codex`, or `./install.sh all-with-workflow`.

After installation, the Claude runtime lives at `~/.claude/skills/workflow`, the Codex runtime lives at `~/.codex/skills/workflow`, shared state lives at `~/.workflow/`, and the user-facing entry points are `goldband-*`. If you want to test a different runtime checkout, use `WORKFLOW_REPO_DIR=/path/to/runtime ./install.sh all-with-workflow`.

## When Not to Use goldband

goldband is usually not a good fit when:

- you do not use Claude Code or Codex and just want a generic project template
- you are doing a one-off solo prototype and do not want the overhead of hooks, wrappers, and repo-linked install management
- your team does not want custom hooks, repo-linked user config, or `goldband-*` command entry points
- you only want the bundled runtime itself and do not need goldband's shared policy, adapters, installer, or dual-tool alignment

If you only want the runtime, start with [vendor/workflow/README.md](vendor/workflow/README.md).

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Hooks are not running | Run `./install.sh hooks` and make sure `jq` is installed |
| The install looks incomplete | Check `./install.sh status` first |
| `/verify-config` reports errors | Rerun `./install.sh all-tools` or `./install.sh all-with-workflow` |
| Language changes do not show up | Restart Claude Code or Codex once |
| Startup self-update does not run | Verify that this repo was cloned with `git clone`, that it is on `main`, that the working tree is clean, and that it tracks `origin/main` |

## License

MIT License.
