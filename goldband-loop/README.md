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

Daily `review/code` needs no manifest argument: Goldband discovers the registered
project contract in `~/.goldband/review-contracts` using Git identity. Read-only
`review contract inspect` reports the expected registry entry even when missing.
Sandbox evidence-output fallback preserves this durable lookup location.

Real `review/code` runs resolve one canonical Git workspace. The repo root owns
diff, snapshot, scope, and default manifest coordinates; an invocation
subdirectory is retained only as the operation execution offset. The reviewed
base's repo-root `goldband.review-evidence.json` is authoritative. If the base
has none, use `goldband review contract import --manifest <path>` to register a
runtime-owned contract for that Git common directory. Working-tree, index, and
`--evidence-manifest` inputs are complete candidate extensions, never primary
authorities. Required coverage and execution boundaries remain enforced;
command and descriptive corrections need an explicit preservation assessment
in the same independent review. `inspect` distinguishes boundary compatibility
from changes still requiring semantic review. Unaccepted checks do not replace
the prior lineage requirements, and old findings remain open until verified.
A candidate may remove a repository manifest during migration
only if the registered contract has exactly the reviewed baseline digest. `inspect` reads back repo root, invocation offset,
base/candidate provenance, tracking state, sources, shadowing, and digests;
`remove` deletes only the runtime-store entry. Manifest schema v2 is required.
The only v1 transition is a committed v1 base paired with a v2 candidate, and
it is accepted only when changing the base version marker alone passes the
complete v2 validation. Every other v1 input is rejected with
observed/supported versions, source, and remediation; safety fields are never
inferred.

For first-time project onboarding, run `goldband review contract help` to find
the installed guide, public example, and JSON Schema. `review contract init`
creates a non-overwriting, fail-closed repo-root scaffold, while
`review contract validate --manifest <path>` invokes the production validator
without running evidence, changing the store, or granting completion authority.

The effective contract declares behavior cells and typed provider commands; the
runtime executes each operation in its own read-only,
default-deny read/write/network snapshot, verifies the pre/post tree digest, and requires reciprocal provider/cell
ownership plus an exact RED exit code before one semantic host call. After a finding is repaired, pass the initial JSON
artifact through `--closure-artifact` with the same review scope to run one
repair-delta-only closure call. Closure also accepts a repaired manifest and
reruns newly added or modified affected cells; `closed` requires fresh passing
evidence. Installed-runtime receipt plus Work Map requested-changes readback rejects
caller-edited, cross-scope, or prior-attempt initial artifacts. The same OS user remains
inside the trusted host boundary. The signed lineage and exclusive owner lock permit retries after failures while preserving
original findings; completed closure cannot replay its old artifact. Prompt-redacted untracked files remain digest-bound and executable
through a separate snapshot-only channel. Missing resolvable contracts, unsupported isolation,
candidate drift, and provenance mismatch fail closed before semantic review.
When the authoritative artifact has `hostCallCount=0` and deterministic-only
findings, the same flag routes to an explicit pre-semantic evidence repair, not
semantic closure. It keeps the original lineage, receipt, finding IDs, policy,
and provider/operation authority; reruns only affected or newly strengthened
typed cells; and invokes the lineage's first semantic host exactly once only
after evidence is eligible. A failed repair emits a successor artifact with the
blockers still open, while every repair artifact records predecessor digests and
affected cells.
On macOS, the default-deny profile imports Apple's common system process baseline
for process startup, then exactly re-denies its syslog, Mach service, and shared-memory
channels as well as broad network and system-socket access. Dynamically linked
non-system Mach-O runtimes execute from a rewritten, ad-hoc-signed, content-attested
private projection; the command cannot read the source package tree or write the
projection. Only the candidate, isolated runner state, sealed runtime projection,
and projected dependency roots are readable.

The installed runtime also persists a signed acceptance lineage. It compares
every successor manifest before evidence or host dispatch, preserves unresolved
finding IDs across restarts, and forces repaired candidates through the exact
initial artifact's state-appropriate evidence repair or scoped closure. A
`manual` or `unsupported` gap may strengthen into a typed evidence disposition;
reverse or lateral disposition changes remain blocked. Empty initial candidates fail before lineage
creation. Standalone lineages include the normalized changed-file scope, while
signed legacy records are read through only when their authoritative artifact
proves the same scope. If that artifact is unavailable, an exact signed
candidate-digest match still preserves the blocker; an unrelated candidate does
not inherit the unverifiable broad scope. A new initial candidate that overlaps
an unresolved changed-file scope must use closure, including repairs that add or
remove files. Sorted per-path authority locks make overlap detection atomic while
disjoint scopes remain independent. Optional base-committed
`goldband.review-policy.json` sets per-cell minimum evidence levels and typed,
auditable waivers. Reports keep `no-new-findings`, deterministic completeness,
runtime completeness, closure completeness, and completion authority separate.

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

Disable remote telemetry:

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
