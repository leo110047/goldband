# Goldband Loop

Goldband Loop is goldband's first-party workflow runtime for AI coding agents.
It implements the public capability actions used for planning, review,
investigation, QA, documentation, and system maintenance.
Unfinished high-risk release and knowledge operations remain hidden
experimental inventory until they have runtime owners.

This directory is maintained as first-party source inside the goldband
repository.

## What It Provides

- Capability routing and workflow execution behind one public selector.
- Runtime binaries under [bin/](bin/) for config, telemetry, memory sync, review
  logs, relinking, and setup helpers.
- PDF, design, iOS QA, benchmark, eval, and documentation tooling. Browser work
  uses the host's browser tool; Goldband Loop does not ship a browser.
- Host adapters for Claude Code, Codex, and other supported coding-agent hosts.
- A machine-readable install inventory in [inventory.json](inventory.json).

Root goldband owns shared policy, installer behavior, hooks, rules, commands,
and portable skills. Goldband Loop owns the runtime surface installed by the
`workflow`, `workflow-codex`, and `all-with-workflow` install profiles.

## Public Interface

Use `/goldband <capability> <action>` in Claude Code or
`$goldband <capability> <action>` in Codex. Historical flat workflow names are
not aliases.

The generated [capability catalog](../docs/generated/capabilities.md) is the
authoritative list of supported capability/action pairs and runtime status.

`review/code` runs one independent, read-only semantic review; see
[workflows/README.md](workflows/README.md) for its contract.

Managed parallel work uses `goldband worktree create` and `goldband worktree
finish`; see [managed worktrees](../OPERATIONS.md#managed-worktrees).

## Install

Install from the root repository: `./install.sh workflow` for Claude Code,
`./install.sh workflow-codex` for Codex, or `./install.sh all-with-workflow` for
both, then `./install.sh status`. `GOLDBAND_LOOP_DIR` selects a local runtime
checkout.

Direct setup is for runtime development and host-adapter testing: run
`./setup --host <claude|codex>` from `goldband-loop/` after `bun install`. The
only workflow discovery profile, `standard`, keeps the `goldband` selector
visible and installs workflow documents under `workflows/*.workflow.md` in the
runtime root.

## Requirements

- Git
- Bun v1.3.11+
- Node.js where required by the host or platform
- Playwright Chromium for `make-pdf` rendering

The root installer verifies Playwright Chromium for workflow installs. In
offline or CI environments, set `GOLDBAND_SKIP_PLAYWRIGHT=1` to skip Chromium
setup, or set `GOLDBAND_CHROMIUM_PATH` to a compatible Chromium binary.

## Runtime State

Runtime state lives under `~/.goldband`, and `goldband-config` reads and writes
its settings. `goldband-config set telemetry` takes `off` (default), `anonymous`,
or `community`; `goldband-config set goldband_language` takes the language used
for workflow questions and explanations. Legacy runtime state is a migration
input only.

## Development

Development setup, workflow changes, and installer verification are defined in
[CONTRIBUTING.md](../CONTRIBUTING.md#goldband-loop-runtime).

## Documentation

| Doc | What it covers |
| --- | --- |
| [Capability catalog](../docs/generated/capabilities.md) | Supported public capability/action pairs and runtime status |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Goldband Loop internals and runtime structure |
| [workflows/README.md](workflows/README.md) | Runtime CLI, owner input contracts, and review runtime |
| [ios-qa/README.md](ios-qa/README.md) | iOS QA requirements, components, and security boundaries |
| [CONTRIBUTING.md](../CONTRIBUTING.md#goldband-loop-runtime) | Runtime development workflow |

## Privacy And Telemetry

Telemetry is opt-in and stays on this machine;
Goldband Loop has no upload path. When enabled, it records skill name, duration,
outcome, version, and OS in a local JSONL log, which `goldband-analytics`
summarizes.

## Troubleshooting

`./install.sh status` reports stale or incomplete runtimes; reinstall with the
original workflow target. Compiled CLIs (`design`, `make-pdf`) need
`bun run build` in `goldband-loop/` after source changes.
