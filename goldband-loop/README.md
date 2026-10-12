# Goldband Loop

Goldband Loop is goldband's first-party workflow runtime for AI coding agents.
It implements the public capability actions used for planning, review,
investigation, QA, browser automation, documentation, and system maintenance.
Unfinished high-risk release and knowledge operations remain hidden
experimental inventory until they have runtime owners.

This directory is maintained as first-party source inside the goldband
repository.

## What It Provides

- Capability routing and workflow execution behind one public selector.
- Runtime binaries under [bin/](bin/) for config, telemetry, browser control,
  memory sync, review logs, relinking, and setup helpers.
- Browser, PDF, design, iOS QA, benchmark, eval, and documentation tooling.
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

`review/code` collects a bounded diff and related code context, loads the shared
review rules, and calls one independent reviewer using the host's native read-only
permissions. Findings must name an exact location, concrete code observation,
trigger and impact, and suggested verification. The runtime validates and
normalizes findings, rejects scope or policy drift, and writes a plain JSON result
and Markdown report. It does not execute project checks or mutate Work Map state.

The default scope is the current worktree. `--base`, `--staged`, and `--diff-file`
select explicit scopes. After repairs, rerun the same entrypoint to inspect the
current scope; failures and unchanged candidates do not create retry locks.
Project tests, lint, typecheck, CI, and live checks remain separate responsibilities.
No findings means only that this semantic pass reported no concrete concerns.

Review manifests, providers, contract registries, acceptance lineage, signed
review receipts, evidence repair, closure, and completion authorization are
retired. The installer replaces obsolete runtime assets but preserves historical
reports and external state. Retired CLI flags fail explicitly. Existing managed
worktree project verification and Git integration safeguards remain in place.

Managed parallel work uses two host commands:

```bash
goldband worktree create task-name
# Inside the managed shell, start one agent without a nested OS sandbox:
claude --settings '{"sandbox":{"enabled":false}}'
codex --sandbox danger-full-access
# Exit the shell, then broker the durable commit from the source repository:
goldband worktree finish task-name -m "feat: integrate task"
```

The outer Goldband sandbox, normal agent permissions, and Goldband hooks remain
active. `finish` fails closed and preserves the detached worktree unless the
recorded source branch is unchanged, clean, safely fast-forwardable, and has no
ignored-content collision with the candidate tree. Broker Git runs with a
pinned executable, isolated config environment, and the source-owned hook
contract recorded by `create`.

## Install

Most users should install from the root goldband repository, not from this
directory directly:

```bash
git clone https://github.com/leo110047/goldband.git
cd goldband
./install.sh all-with-workflow
./install.sh status
```

Install just the Claude Code runtime:

```bash
./install.sh workflow
```

Install just the Codex runtime:

```bash
./install.sh workflow-codex
```

Use a local runtime checkout explicitly:

```bash
GOLDBAND_LOOP_DIR=./goldband-loop ./install.sh all-with-workflow
```

## Direct Runtime Setup

Direct setup is mainly for runtime development or host-adapter testing:

```bash
cd goldband-loop
bun install
./setup --host claude
./setup --host codex
./setup --host claude --profile standard
./setup --host codex --profile standard
```

`--profile standard` is the default and the only workflow discovery profile. It
keeps only the `goldband` selector visible, then installs host-specific workflow
documents under `workflows/*.workflow.md` inside the runtime root. The removed
fully expanded profile is intentionally unavailable because it overloaded host
skill discovery.

## Requirements

- Git
- Bun v1.3.11+
- Node.js where required by the host or platform
- Playwright Chromium for browser-backed workflows

The root installer verifies Playwright Chromium for workflow installs. In
offline or CI environments, set `GOLDBAND_SKIP_PLAYWRIGHT=1` to skip browser
workflow setup, or set `GOLDBAND_CHROMIUM_PATH` to a compatible Chromium binary.

## Runtime State

Goldband Loop stores local runtime state under `~/.goldband` by default.

Useful config commands:

```bash
goldband-config get telemetry
goldband-config set telemetry off
goldband-config get goldband_language
goldband-config set goldband_language zh-TW
```

Legacy pre-absorption runtime state is a migration input only. New runtime state
should live under `.goldband`.

## Development

From the repository root:

```bash
cd goldband-loop
bun install
bun run build
bun run test:free
```

Before changing installed workflow entries, update [inventory.json](inventory.json)
and run the root inventory gate:

```bash
node scripts/check-goldband-loop-inventory.mjs
```

The root repository also validates installer and integration behavior:

```bash
bash scripts/test-workflow-integration.sh
node scripts/test-windows-platform-integration.mjs
bash scripts/verify-decision-guidance.sh
```

## Documentation

| Doc | What it covers |
| --- | --- |
| [Capability catalog](../docs/generated/capabilities.md) | Supported public capability/action pairs and runtime status |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Goldband Loop internals and runtime structure |
| [BROWSER.md](BROWSER.md) | Browser command reference |
| [docs/domain-skills.md](docs/domain-skills.md) | Domain skill packaging |
| [docs/tutorial-document-generate.md](docs/tutorial-document-generate.md) | Documentation-generation tutorial |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Runtime development workflow |
| [CHANGELOG.md](CHANGELOG.md) | Runtime history |

## Privacy And Telemetry

Telemetry is opt-in. When enabled, Goldband Loop sends usage metadata such as
skill name, duration, success or failure, version, and OS. It does not send
source code, prompts, file contents, repository names, branch names, or arbitrary
user artifacts.

Local analytics are available without remote telemetry:

```bash
goldband-analytics
```

Disable the local usage log:

```bash
goldband-config set telemetry off
```

## Troubleshooting

Check install status from the root repository:

```bash
./install.sh status
```

Reinstall the runtime:

```bash
./install.sh workflow
./install.sh workflow-codex
```

Rebuild browser tooling:

```bash
cd goldband-loop
bun run build
```

Run the runtime test suite:

```bash
cd goldband-loop
bun run test:free
```

Goldband's pre-push review runs its three macOS self-test recipes locally on the
current candidate. It does not require committing or pushing that candidate to
obtain CI evidence. CI still runs after push. The fixed local self-test runner
uses native host permissions (not the general sealed evidence runner).
