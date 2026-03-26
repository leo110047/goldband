# goldband

> Shared engineering guardrails for Claude Code and Codex.

[中文](README.md)

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## What Is goldband

goldband is a shared set of engineering guardrails for Claude Code and Codex. Its goal is to make AI coding workflows more stable, verifiable, and maintainable.

goldband mainly provides:
- commands, hooks, rules, and contexts to keep day-to-day planning, verification, review, and debugging flows consistent
- shared skills such as evidence-based coding, systematic debugging, security review, and testing strategy
- a vendored `workflow` runtime that goldband exposes through `goldband-*` entry points for higher-level flows like review, QA, investigation, and ship

## Installation

Clone the full repo with `git clone`:

```bash
git clone https://github.com/leo110047/goldband.git
cd goldband
```

Do not copy `install.sh` by itself, and do not use a download method that strips `.git`. goldband uses a repo-linked install model, and startup self-update also depends on git metadata.

The most common install options are:

```bash
./install.sh pack-quality      # Recommended for Claude Code
./install.sh all-tools         # Claude Code + Codex
./install.sh all-with-workflow # Claude Code + Codex + bundled workflow
```

If you only want to install specific parts, you can also run:

```bash
./install.sh codex-full     # Install Codex only
./install.sh workflow       # Install Claude-side workflow only
./install.sh workflow-codex # Install Codex-side workflow only
./install.sh launchers      # Reinstall claude/codex launchers
./install.sh status         # Check install status
./install.sh uninstall      # Remove install
```

`hooks` merging requires `jq`. On macOS, you can install it with `brew install jq`.

## Updates

The normal update flow is:

```bash
cd /path/to/goldband
git pull --ff-only
```

After that, rerun the same install combination you originally used. For example, rerun `./install.sh pack-quality` if you only installed Claude Code, `./install.sh all-tools` if you installed Codex too, and `./install.sh all-with-workflow` if you also installed workflow.

If you normally launch with `claude` or `codex`, goldband will also do a safe self-update check before startup. It only auto-fast-forwards when the repo is clean, the branch is `main`, the repo tracks `origin/main`, and `git pull --ff-only` is safe. Otherwise it skips the update.

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
