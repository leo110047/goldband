# Programmatic Workflows

`goldband-loop/workflows/` is the executable workflow runtime. The public
interface and prompt contracts are owned by `../goldband.manifest.json`.

## Ownership

- Manifest: capability/action identity, goal, relevant context, hard boundaries,
  verification, manual routing, and runtime metadata.
- Generated registry: typed projection of manifest runtime fields.
- Runtime: decomposition support, validated steps, convergence, host adapters,
  safety gates, and JSONL evidence.
- Model: task decomposition, tool selection, and adaptation within the contract.

Every registry entry has `contractPath`, target, evaluation signal, iteration
cap, stop conditions, host support, risk level, lifecycle, integration status,
entrypoint type, runtime owner, and evidence policy. `defineWorkflow()` fails
when required fields are missing or a runnable action has no owner.

## Runtime CLI

```bash
bun run workflows/run.ts <capability> <action> \
  [--loop] [--max-iterations <n>] \
  [--mode mock|real] [--host mock|claude|codex] \
  [--review-host-timeout-seconds <60-1800>] \
  [--review-pass-timeout-seconds <60-1800>] \
  [--review-claude-max-budget-usd <0.01-100.00>] \
  [--input <file>] [--base <ref>] \
  [--staged|--worktree|--include-untracked|--diff-file <file>]
```

Public actions are discoverable. Experimental actions stay in the generated
inventory for engineering tracking, but are excluded from routing and
activation hints and are not runnable. They cannot claim a runtime owner.
Compatibility workflows read their thin contract in mock mode and fail closed
in real mode. Typed workflows may use real owner adapters when their contract
explicitly supports it.

The loop controller evaluates structured signals after each iteration and stops
when the target is met, the same blocker repeats, the signal stops improving,
or the registry iteration cap is reached. A CLI cap may lower but never raise
the registry cap.

`review/code` supports one typed diff-collection and model-review pass with
validated findings. It rejects `--loop`; `qa/app` currently provides a typed mock adapter;
real browser QA remains unsupported until its checks consume the typed
`browser/session` evidence contract.

Interactive Codex and Claude `$goldband review code` invocations must enter this
runtime. Claude uses `<installed-skill-root>/bin/goldband review code`. Codex uses
`~/.codex/goldband/workflow-runtime/bin/goldband review code`. The installed
executable pins Bun and the Codex review host; agents do not assemble commands
from `.workflow-launcher.json`. That marker remains installer-owned metadata for
distribution checks and other launcher consumers. The installed
launcher is a materialized snapshot outside the reviewed workspace, and its
machine-local rule allows the exact installed review entrypoint and legacy pinned
Codex review prefix. The caller must
not substitute a workspace path or request sandbox escalation. A missing
marker, runtime, or rule is an installation failure and requires reinstall.
The trusted snapshot also pins the installed Codex CLI by absolute path, so a
reviewed repository cannot replace the nested reviewer through `PATH`.

The launcher forces real mode. Without an explicit scope, it resolves the current
valid managed lease's Work Map IDs, or reviews the whole current worktree.
Explicit scopes and semantic-only mode do not inherit a managed task. Invalid
existing managed markers fail rather than silently becoming standalone reviews.
The installed configuration supplies the host; explicit host flags remain
available to advanced callers of the underlying launcher. The Codex executable
pins its host and rejects an additional caller-supplied host.
Real review finds a unique signed unresolved lineage for the same repository,
base, collection scope and overlapping files, or the same managed task. It then
validates the authoritative artifact and receipt through the existing closure
path. Repaired candidates automatically enter evidence repair or closure;
ambiguous records require an explicit selection. Unchanged candidate and
contract pairs stop before providers or host dispatch. Deliberate retries after
an environment correction can still supply `--closure-artifact` explicitly.
Newly changed files outside the original review block automatic closure before
execution; closure only reassesses the original findings. Those additional
changes need separate review, or an explicit artifact selection for a deliberate
review limited to the original findings.
The launcher rejects specialist fan-out and
`--loop`, marks the child environment as an active review, and atomically leases
the canonical repository plus normalized scope before starting the single host
call. Child prompts contain semantic judgment inputs; read-only tools, approval,
output schema, timeout, and non-recursion are runtime-owned. Launcher or runtime
failure is terminal.

Codex CLI browser work uses the same trusted launcher followed by
`browser session --host codex <command> [args...]`. It does not depend on the
Codex App's Browser or Chrome plugin bindings. The installed snapshot carries a
materialized browser client and bundled server, so neither the launcher nor the
daemon is resolved from the writable workspace. Exact rules auto-admit only
inspection commands. Navigation (`goto`, `back`, `forward`, `reload`) and
`wait` remain on Codex's native approval path so repository instructions cannot
silently use the trusted launcher to reach localhost or private-network
services. The runtime still rejects commands with outward effects.
Claude uses `bin/goldband browser session --host claude` and the source-owned
browser runtime.

Review input has a 2 MiB limit. Larger Git diffs fail with an explicit request
to narrow scope instead of a host-specific buffer error. `--diff-file` accepts
only a stable regular file; untracked files are opened without following
symbolic links, checked again after opening, and read from that same descriptor.
The descriptor is checked again after reading, so an in-place write during
collection fails closed instead of producing mixed input.
Scope flags fail before host dispatch when they conflict; `--base --worktree`
is the only combined primary scope, and `--include-untracked` cannot modify a
supplied `--diff-file`. Untracked path discovery is NUL-delimited so filenames
containing tabs, newlines, quotes, or backslashes are not silently omitted.

The launcher probes the evidence root before starting. If the default
`~/.goldband` root is blocked by the caller's filesystem sandbox, review runs
with a private temporary state root and reports that evidence as ephemeral.
Durable and ephemeral evidence both use a separate owner-only coordination root
under the canonical OS temp directory. An explicitly configured state root still
fails closed when it is not writable.
For Codex, the installer-owned exact `allow` rule admits the trusted launcher
outside the parent command sandbox without a prompt, so nested `codex exec` can
initialize Codex state and app-server resources. The non-interactive child
reviewer remains `read-only` with approval set to `never`.
Every `review/code` run launches exactly one core reviewer. The public launcher
does not expose specialist fan-out, the shared runtime contract rejects
`--specialists auto|all` before host launch, and the production review owner has
no parallel specialist dispatch path. `--specialists off` is accepted only as a
backwards-compatible no-op by the internal CLI.

Before host dispatch, `review/code` collects changed paths with the diff; Git
scopes use NUL-delimited path output, while a supplied patch derives paths from
its file headers.
When two or more paths changed, the runtime builds a bounded repository-local
dependency view from Git-tracked source files and the reviewed untracked paths.
It follows common static import/source forms, walks reverse dependencies to
depth two, identifies observed test dependents, and passes missing-test or
wide-impact signals to the core reviewer. The persistent
index lives under `${GOLDBAND_HOME:-$HOME/.goldband}/review-impact/`; it is
Goldband runtime state and is not installed into, or supplied by, the child
reviewer. A one-file review skips inventory and index work entirely.

The graph is deliberately advisory. Its paths prioritize source inspection but
cannot narrow the diff, prove coverage, or support a blocking finding without
current file evidence. File, byte, traversal-depth, and output limits produce
an explicit `degraded` status and diagnostics. Every pass records a JSON graph
artifact plus graph telemetry so stale, skipped, and bounded coverage remain
visible.

Codex review subprocesses run with `--ask-for-approval never` and a read-only
sandbox. Commands that require writes or approval are unavailable by runtime
capability rather than prompt instruction.
They also use `--ignore-user-config`, an empty `mcp_servers` override, and
`--ephemeral`: authentication remains available from `CODEX_HOME`, while user
customizations, external MCP tools, and persistent reviewer sessions do not.

Claude review subprocesses run with `--safe-mode` and only `Read`, `Glob`, and
`Grep`. This disables hooks, plugins, MCP servers, and other executable
customizations. Because safe mode also disables automatic project instructions,
the review prompt requires the child to inspect applicable `AGENTS.md` and
`CLAUDE.md` files explicitly with those read-only tools.

Before a Claude review starts, the adapter applies Claude's documented
environment credential precedence, reads `claude auth status --json`, and
resolves one billing policy from the CLI's active credential. Claude.ai
login and setup-token OAuth are subscription modes and never receive
`--max-budget-usd`, because the reported dollar value is not the subscription
quota authority. API keys, API-key helpers, and third-party providers are
metered modes; higher-precedence cloud-provider, bearer-token, and API-key
environment credentials remain metered even when a lower-precedence OAuth token
is also present. Metered runs receive a `$3.00` default safety cap that can be overridden
for one run with `--review-claude-max-budget-usd`. Unknown, unavailable, or
inconsistent auth state fails before model dispatch instead of guessing whether
an unbounded paid call is safe. Host telemetry records the resolved policy but
does not retain auth-status identity fields. Subscription telemetry retains
token/cache/output usage but drops the API-equivalent `costUsd` estimate;
metered telemetry retains it for paid-run attribution.

Both host adapters receive the complete review prompt over stdin rather than a
command argument, so the 2 MiB review-input contract does not exceed the host
operating system's `ARG_MAX` limit.

The single real host call and complete `run-review` pass each have a
twelve-minute default timeout. The timeout flags override one pass, must remain
between 60 and 1800 seconds, and the host timeout cannot exceed the pass
timeout. Evidence telemetry records the fixed `off` compatibility mode and both
timeout budgets so latency can be tuned from real runs.
Pass elapsed time uses a monotonic clock; wall-clock changes affect evidence
timestamps but cannot extend the configured deadline.

## Owner input contracts

Real mode reads structured JSON from `--input`. Required semantic content is
produced by the model; runtime owners validate, gate, persist, and read it back.

| Action | Runtime owner | Real-mode input |
| --- | --- | --- |
| `plan/create` | `work-map-store` | `mode`, concrete `destination`, included/excluded `scope`, decision references, fog, and dependency-ordered tickets. Runtime derives Git identity, revision, frontier, blockers, and state paths. Use only for cross-session, dependency-linked, parallel, unknown-bearing, or explicitly tracked work; small ordinary tasks bypass Work Maps. |
| `browser/session` | `browse` | Optional `command` and `args`; only non-outward-effect navigation and inspection commands are delegated. Mutations use the browser tool's native approval path. |
| `design/consult` | `design-decision-store` | `brief` and `decisions` with typography, color, spacing, layout, and motion. |
| `safety/guard` | `workflow-safety-state` | Optional `scope`. |
| `safety/freeze` / `safety/unfreeze` | `freeze-hook-state` | Optional freeze `scope`; unfreeze reads the same state owner. |
| `context/save` / `context/restore` | `context-checkpoint-store` | Save requires `summary` and stores only the active Work Map ID/revision/digest reference when present. Restore compares Git and Work Map freshness and returns the complete calculated frontier plus one next action. |
| `knowledge/recall` | `goldband-knowledge` | Optional `query`, `domain`, and `limit`. |
| `benchmark/workflow` | `benchmark-evidence-aggregator` | `label`, `metric`, `conditions`, `sourceEvidence`, and at least two numeric `samples`. |
| `system/health` | `goldband-installation` | None; inspection is read-only. |
| `system/upgrade` | `goldband-setup-gate` | Preflight persists an ID and emits command arrays for native host approval. Readback requires the preflight ID, old/new versions, and `setupVerified=true`; runtime never hides `git pull` inside a child process. |
| `ios/qa` | `ios-qa-evidence` | User-visible `checks`; macOS real mode also verifies available simulator inventory. |

## Evidence

Each step appends a JSONL event containing workflow, run id, step, status,
duration, output digest, iteration, signal snapshot, and artifacts. Loop runs
also append a `loop-summary` with the signal trail and stop reason.

```text
${GOLDBAND_HOME:-$HOME/.goldband}/workflow-runs/<workflow>.jsonl
${GOLDBAND_HOME:-$HOME/.goldband}/workflow-runs/artifacts/
```

Untracked diff materialization is a trust boundary. The runtime skips binary,
oversized, non-UTF-8, or secret-like content and records a no-content marker.
Unsupported high-severity findings are downgraded instead of presented as
verified blockers.

Review prompts keep the complete scoped diff, capped at 256 KiB so oversized
changes fail explicitly instead of consuming unbounded quota. Runtime-selected
Rules use compact review criteria with links to their full policy sources, the
impact projection is bounded to 8 KiB, and all non-diff prompt material must
remain within a 20 KiB overhead budget. Prompt telemetry records component
bytes; host telemetry records numeric token/cache/output/cost fields when the
selected CLI exposes them, without retaining model event payloads.

## Verification

```bash
node ../scripts/test-workflow-contracts.mjs
bun run typecheck
bun run test:workflows
```

See `COVERAGE.md` for typed, compatibility, experimental, and owner status.
