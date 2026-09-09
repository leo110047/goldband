# goldband Architecture

This document explains the boundary between goldband shared policy and
Goldband Loop, the first-party workflow runtime in this repository.

## System Shape

goldband is a local configuration and workflow distribution for Claude Code and
Codex. It has two first-party layers:

- shared policy and host adapters, owned by the root repo
- Goldband Loop runtime, owned by `goldband-loop/`
- optional local sandbox execution, owned by `sandbox/`

The Claude Code distribution surface is the `goldband@goldband` plugin for core
commands, portable skills, rules-as-skill packaging, and hooks. Codex has a
separate portable plugin package under `plugin-assets/codex-plugin/`, exposed by
the repo marketplace at `.agents/plugins/marketplace.json`. The installer
remains the developer/full-Codex/workflow-runtime path because `codex-full`
owns host-level configuration that the portable plugin does not replace. The
Claude app surface uses separate app adapters: a Claude Desktop local MCP
extension and a remote MCP connector template. The user-facing workflow surface
is `goldband-*`. The installer installs Goldband Loop directly and verifies the
result against a machine-readable inventory.

## Responsibility Boundary

### Root goldband owns

- repository-level guidance and adapter docs:
  - `AGENTS.md`
  - `codex/AGENTS.md`
  - `README.md`
  - `README.en.md`
- installer and repo-linked setup:
  - `install.sh`
  - `shell/install/*.sh`
- Claude-side integration surfaces:
  - `commands/`
  - `rules/`
  - `hooks/`
- Claude plugin distribution:
  - `.claude-plugin/marketplace.json`
  - `plugin-assets/claude-code-plugin/`
  - `docs/reports/plugin-expected-assets.json`
  - `scripts/sync-plugin-assets.mjs`
  - `scripts/check-plugin-distribution.mjs`
- Codex plugin and app adapter distribution:
  - `.codex-plugin/plugin.json`
  - `.agents/plugins/marketplace.json`
  - `plugin-assets/codex-plugin/`
  - `app-adapters/claude-desktop/`
  - `app-adapters/claude-remote/`
  - `docs/reports/app-support-expected-assets.json`
  - `scripts/sync-app-support-assets.mjs`
  - `scripts/check-app-support.mjs`
- first-party MCP surface:
  - `mcp/server/`
  - `mcp/first-party-servers.json`
  - `mcp/*.template`
- portable shared skills:
  - `skills/global/`
- validation gates:
  - `scripts/check-goldband-loop-inventory.mjs`
  - `scripts/test-sandbox.sh`
  - `.github/workflows/validate.yml`

### goldband-loop owns

- workflow runtime source, the shared root capability router, and thin contracts
- programmatic workflow contracts under `goldband-loop/workflows/`
- workflow-native docs, build metadata, tests, browser/PDF/design/iOS tooling
- runtime binaries under `goldband-loop/bin/goldband-*`
- the Goldband Loop inventory at `goldband-loop/inventory.json`

Concrete ownership signals include:

- [goldband-loop/package.json](goldband-loop/package.json)
- [goldband-loop/bun.lock](goldband-loop/bun.lock)
- [goldband-loop/README.md](goldband-loop/README.md)
- [goldband-loop/ARCHITECTURE.md](goldband-loop/ARCHITECTURE.md)
- [goldband-loop/inventory.json](goldband-loop/inventory.json)

## Integration Contract

### Rules Review Runtime

`rules/*.md` is the policy-content source of truth.
`rules/manifest.json` provides deterministic review metadata, and
`hooks/scripts/lib/rules-resolver.js` is the provider-neutral, read-only
resolver used by both Claude and Codex review workflows.

Each review creates one immutable snapshot of the current Rule text. The single
core prompt and prompt telemetry consume that same snapshot; the next review
creates a fresh one. The `review/code` workflow does not support independent
specialist agents. Manifest-owned group selectors decide applicability, so Rule
membership is not duplicated in resolver code.
The resolver, prompt payload budget, manifest coverage, installed dependency
inventory, and generated plugin assets are deterministic gates. Codex installs
the resolver at `~/.codex/review-runtime/rules-resolver.js`, outside the hook
directory symlink.
Semantic findings are produced by independent review, not by PreToolUse, Stop,
workspace leases, shell classification, or writer self-attestation.

`review/code` is evidence-first. `workflows/review-contract-resolution.ts`
selects one authoritative baseline before evidence or host dispatch. The
reviewed base's repo-root `goldband.review-evidence.json` wins; only its absence
permits a runtime-owned per-repository store entry. Working-tree, index, HEAD,
and explicit manifests are candidate extensions and cannot remove or weaken
baseline cells, providers, applicability, risk, disposition, or evidence level.
Resolution provenance records canonical workspace coordinates, candidate
tracking and compatibility, repository/store/explicit source identities, import
provenance, and baseline/candidate/effective digests. The store binds Git
worktrees through their common directory path and filesystem instance, and also
records remote identity; moves, path reuse, clones, remote changes, and
ambiguity fail closed until explicit re-import. Review never mutates repository
manifests. An exact-digest registered copy permits removing a legacy repository
manifest during migration without reducing the baseline. The launcher retains
the durable registry root separately from sandbox-temporary evidence output;
read-only contract inspection never probes write access.

`review-lineage.ts` enforces structured coverage and execution boundaries, while
`review-contract-changes.ts` projects check-command and descriptive changes for
the existing independent semantic call. Exact string equality is not an
equivalence proof: changed checks need an explicit preservation assessment,
fresh evidence, and preserved operation/execution identity. This uses the same
review and signed artifact, without a separate approval workflow or state store.
Unaccepted descriptions and commands cannot replace the prior required contract.
`reviewFindingCellIds` is the single owner of finding-to-evidence coverage for
initial classification and closure, including legacy semantic findings that
omitted bindings. It uses declared provider applicability, never severity-wide
fallback or guessed deterministic coverage.

Goldband's three macOS sandbox self-test providers use the installed
`review-local-evidence.ts` adapter before push. It runs the fixed complete recipes
on an exact local candidate copy, with temporary HOME/state and without forwarded
credentials. These native host processes own their nested Seatbelt tests and
explicitly declare host networking; they are not an adversarial-code sandbox.
The existing signed evidence records bind the candidate, operation, dependencies,
and before/after snapshot. Only the named unchanged CI recipes can migrate to
this lane, with increased timeouts; a registered migration can replace the legacy
base manifest during its removal. The read-only GitHub adapter remains available
for post-push CI evidence, without making CI a pre-push review prerequisite.

The resolved contract declares stable behavior cells and typed providers. The
runtime validates every disposition and reciprocal provider/cell
ownership, materializes a fresh read-only candidate snapshot per operation,
executes declared argument arrays under a default-deny read/write/network OS
sandbox with the platform's common process-runtime baseline plus only the snapshot,
isolated runner state, sealed runtime projection, and projected dependencies
readable outside that baseline, verifies the
snapshot digest again after execution, isolates and removes each operation's
HOME/TMP state, bounds output and time, and binds every record to repository, base,
candidate, scope, behavior contract, owner, environment, command, and time
digests before starting the semantic host. Regression providers preserve a
base/exact-nonzero RED and candidate/zero GREEN pair; property/fuzz providers also
preserve seed, iteration budget, and replay command. Unsupported high-risk
cells, missing runners, malformed evidence, candidate drift, and provenance
mismatch fail closed before model dispatch.

Executable sealed evidence currently has one supported local adapter: macOS
Seatbelt. Linux and Windows return typed `runtime-incomplete` records before
operation materialization, semantic dispatch, or completion authority. Linux
Bubblewrap belongs to the separate managed-worktree boundary and is not a
`review/code` adapter.

The repository-owned provider store is persistent-only. Exact base-to-candidate
RED/GREEN transitions carry repository, base, candidate, scope, and operation
contract digests in the one review artifact and fail validation on a successor
binding. Applicability is an explicit union: a non-empty path-prefix set or a
global declaration with a reviewable reason. The selected provider set also
owns the effective behavior-cell set used by completeness; unrelated scoped
cells cannot become blocking coverage gaps. Explicit transition manifests and
persisted initial artifacts both pass the exact-binding validator in the
production ingestion path. Execution context names both the
sandbox owner and runner. Provider-owned Seatbelt suites are never nested inside
the sealed evidence runner; it emits a typed `runtime-incomplete` record with
owner, actual/expected context, scope, lane, and remediation. The named macOS
host lane executes those tests directly, while partial evidence never gains
completion or closure authority.
For Mach-O executables with non-system dependencies, the runtime copies all attested
images into a private projection, rewrites their load commands to projected paths,
ad-hoc signs and re-attests the transformed bytes, and keeps the original host package
tree unreadable. The macOS adapter also exactly re-denies inherited syslog, Mach service,
and shared-memory channels.
An operation may opt into the single supported Python contract: Python 3.14 with `uv`,
`pyproject.toml`, and `uv.lock`. When external artifacts are required, the runtime clones the ambient uv cache into the
operation root, then resolves frozen and offline into a non-editable, candidate-bound
environment, removes runtime-owned site customization, and performs an isolated
interpreter/stdlib/path preflight before the project gate. Interpreter, resolver,
lockfiles, installed artifact set, and environment identities are re-attested. Installed
wheel tags must uniquely select the used registry wheel filename and hash from the lockfile.
Host
tools are selected only from bounded system/Homebrew roots and inspected inside
Seatbelt; unused ambient cache entries do not participate in identity or validity. Any
pre-gate failure is `runtime-incomplete`; only a gate exit mismatch after preflight is
`verified-failure`.
Secret-like bounded regular untracked files use a separate non-prompt channel:
their paths and content digests remain in the candidate binding and their exact
bytes are copied into each isolated executable snapshot, while the semantic diff
contains only the redaction marker. Unsafe or oversized redacted files fail
closed before provider execution.

The one initial semantic host receives the immutable candidate diff once plus
bounded matrix and evidence projections. Raw logs and deterministic control
rules remain outside the prompt. Only deterministic evidence code can mint a
`verified-failure`; semantic output requesting that classification becomes a
non-blocking `semantic-concern`, and unrelated evidence IDs are discarded.
Fixture, local, sandboxed-service, live-provider,
device-platform, and production-readback evidence remain distinct in records
and reports. The local runner can attest only local levels; live, device, and
production levels require an authorized external runner.
The external-runner admission boundary is owned by the path-scoped review
evidence test provider, so its fail-closed enforcement applies when that
contract changes without turning the absence of a future external runner into
a global gap for unrelated local candidates. Providerless `manual` and
`unsupported` dispositions remain explicit global requirements.

Repair closure is a separate conditional invocation. It consumes the initial
artifact only after a canonical HMAC receipt is read back from the installed
runtime authority store. The receipt binds the complete serialized artifact,
findings, evidence, timestamps, candidate, behavior contract, and standalone or
Work Map scope including map revision, subject, and claim attempt. Work Map closure also
reads back the exact requested-changes artifact and requires the immediately following
repair attempt; caller-authored, cross-scope, or prior-attempt JSON cannot authorize closure.
The trust boundary excludes reviewed candidate code, model output, and artifact inputs, but
intentionally trusts the same-permission host user and installed Goldband runtime. Protecting
against a malicious same-user host process requires a privileged helper or OS-backed signing key. Closure then proves
repository/scope provenance and records the original and repaired
behavior-contract digests, derives a bounded multi-hunk repair delta without
unchanged middle regions. Initial and closure inputs share a 256 KiB patch budget
and 48 KiB non-patch budget; oversized inputs fail without truncation. After repaired binding and Work Map causality validate,
the signed lineage and its exclusive owner lock authorize retries while findings remain unresolved.
Failed attempts do not consume a second permanent claim. Successful closure clears its
authoritative artifact, so stale or concurrent replay is rejected. Closure locates and
locks the unique signed owner by receipt and artifact digest, preserving that owner's
file and authority coordinates even when the repair expands its candidate scope.
Missing or ambiguous owners fail closed; a receipt alone cannot recreate lineage.
Closure reruns original plus new or changed affected cells,
and permits exactly one host call returning
only `closed`, `still-open`, `direct-regression`, or `evidence-incomplete` for
original finding IDs. A zero-finding initial review cannot start closure, and
closure never receives the unchanged full original diff or opens a new findings
inventory. Closure evidence must intersect the original finding's authorized
behavior cells. Persisted evidence records and completeness are revalidated and
recomputed before reuse. Work Map review artifacts add the behavior contract, evidence
records plus their recomputable digest, completeness state, candidate digest,
phase, and host-call count to the existing receipt and tree chain.
An operation identity also binds seed/iterations, resolved executable content,
runner policy, platform, dependency contracts, package metadata, and projected
command shims; closure cannot weaken that identity behind a stable operation ID.

Cross-run acceptance is owned by a signed runtime lineage, not by the newest
caller manifest. Before evidence or semantic dispatch, the runtime compares the
current contract with inherited cells/providers, the Work Map acceptance or
standalone scope, selected Rules, minimum evidence policy, and unresolved
finding IDs. Existing requirements cannot be removed, reversed, downgraded, or
detached from blockers. Additive coverage remains valid. Open blockers force
the exact authoritative initial artifact through scoped closure. Empty initial
candidates are rejected before lineage creation. Standalone lineage identity
includes normalized changed paths, and a legacy broad-scope blocker is inherited
when its signed artifact digest proves the same scope or its signed candidate
digest exactly matches. An unrelated candidate does not inherit an unverifiable
legacy scope. A new initial candidate whose changed paths overlap any unresolved
scope under the same collection authority must use closure. Sorted per-path
locks cover overlap discovery through lineage finalization while disjoint scopes
remain independent. Optional
waivers and per-cell minimum evidence levels are accepted only from typed
`goldband.review-policy.json` in the base commit and are copied into the signed
audit record. Reports and Work Map artifacts keep no-new-findings, deterministic
completeness, runtime completeness, closure, and completion authority distinct.

Cross-review hook adapters are host-specific projections over
`goldband-loop/cross-review/core.cjs`. Minimal workflow runtime roots include
the complete `cross-review/` directory next to `bin/`; explicit module discovery
handles source checkouts and installed Codex/Claude runtime roots without
assuming one fixed relative depth.

### Managed Worktree Runtime

`goldband-loop/lib/managed-worktree.ts` owns the managed-worktree lease,
host boundary, integration transaction, and durable finish evidence. The public
surface stays limited to `goldband worktree create <name>` and
`goldband worktree finish <name> -m "<message>"`.

`create` records the source branch and commit, creates a detached worktree under
`~/.goldband/worktrees/checkouts/`, verifies an OS sandbox boundary, and opens
an interactive shell inside it. The configured state root is realpath
canonicalized before lease paths or sandbox rules are derived. The managed
checkout is writable, while its
`.git` pointer, per-worktree Git directory, common Git directory, source
worktree, lease-control state, pinned Git executable, broker runtime, installed
launchers, and Git config/hook resolution inputs are read-only. Claude Code,
Codex, shell scripts, and low-level Git commands inherit the same process
boundary. macOS Seatbelt explicitly denies writes to those inputs; Linux
bubblewrap supplies a read-only root. Both expose a distinct writable agent
scratch directory, while finish indexes, objects, and isolated broker home use
a separate broker scratch directory that stays read-only to the agent.
Unsupported or unavailable hosts fail closed before handing the worktree to an
agent. Because macOS does not support nesting another Seatbelt policy reliably,
Codex runs with
`--sandbox danger-full-access` and Claude Code receives an additional setting
with `sandbox.enabled=false` inside this shell. Their normal permission and hook
layers remain active; only their inner OS sandbox is replaced by Goldband's
already-active outer boundary.

`finish` runs outside that shell. It locks and validates the lease, source
worktree, source branch, base commit, ignored/untracked state, clean submodule
worktrees, Git lock state, broker config digest, and collisions between source
ignored content and the candidate tree. It builds the candidate tree through a
broker-owned temporary index and quarantine object directory, then sends it to
the source repository's local `receive-pack`. Every broker Git process uses the
recorded canonical executable, isolated config/home, allowlisted environment,
fixed identity, and explicit source-owned hook contract. Git promotes
quarantined objects only when the unchanged original branch can be
fast-forwarded and its clean checked-out worktree updated. The broker verifies
the resulting commit/tree and clean source worktree, then removes the managed
worktree and writes evidence under `~/.goldband/worktrees/evidence/`. Any
pre-integration failure preserves the managed worktree and discards its
quarantined candidate objects. PreToolUse and `pre-commit` checks are soft,
early diagnostics only; the OS filesystem sandbox is the enforcement boundary.

A managed worktree may also carry an exact Work Map ticket binding. Bound
leases record the Work Map ID/revision, ticket ID, and planning-contract
digest. `goldband-work-verify` executes argument arrays without a shell, stores
bounded redacted summaries plus full-output digests under the local state root,
and advances only the bound ticket after mode-specific evidence succeeds.
`review/code --work-id ... --ticket-id ...` reads that receipt and adds the
ticket intent as explicitly delimited untrusted data. Its JSON artifact binds
the map revision, ticket, receipt, reviewed diff, and candidate digest.
`finish` requires the ticket to be runtime-verified and reads every bound
artifact back before integration. Standalone managed worktrees retain the
original finish contract and cannot claim Work Map verification.

These provenance checks are an evidence gate, not a security boundary against
another process running as the same host user. The filesystem sandbox protects
Git and broker inputs; Work Map and verification state remain inspectable and
recoverable local runtime state.

### Claude Plugin Contract

The Claude plugin is a generated distribution artifact, not a second source of
truth. `scripts/sync-plugin-assets.mjs` copies the core source assets into
`plugin-assets/claude-code-plugin/`, rewrites plugin hooks to use
`${CLAUDE_PLUGIN_ROOT}`, generates the `goldband-rules` skill from `rules/`, and
updates `docs/reports/plugin-expected-assets.json`. The drift gate is
`node scripts/sync-plugin-assets.mjs --check`; the install verifier is
`node scripts/check-plugin-distribution.mjs`.

The plugin deliberately excludes `goldband-loop/`, Playwright/browser/iOS
tooling, Codex config/rules/hooks/requirements, and public marketplace
publishing.

### Codex Plugin Contract

The Codex plugin is generated from shared portable sources by
`scripts/sync-app-support-assets.mjs`. It packages `skills/global/` and an
opt-in MCP wrapper that can launch the first-party `goldband-mcp` server from a
local checkout. The repo marketplace at `.agents/plugins/marketplace.json`
exposes this package to Codex as a portable subset.

The Codex plugin must not be described as a replacement for
`install.sh codex-full`. The full Codex contract includes `codex/config.toml`,
`codex/requirements.toml`, `codex/rules/`, `codex/hooks.json`, `codex/hooks/`,
`codex/profiles/`, `codex/permission-profiles/`, `codex/agents/`, and the
Goldband Loop runtime assets installed under the Codex skill root.

Until that contract is redesigned and verified, `install.sh` is the canonical
Codex full-setup path. Do not claim Claude/Codex plugin symmetry in README,
installer status output, or verification reports.

### Claude App Adapter Contract

Claude Desktop and Claude web/mobile support are separate from Claude Code. The
Desktop path packages a local MCP extension under
`app-adapters/claude-desktop/`; the remote path provides a connector
registration template under `app-adapters/claude-remote/`. These adapters expose
the portable MCP/tooling subset and do not install Claude Code hooks,
permissions, statusline settings, or `~/.claude/settings.json` behavior.

goldband installs Goldband Loop through [shell/install/workflow.sh](shell/install/workflow.sh).
That installer is responsible for:

- locating `goldband-loop/` or an explicit `GOLDBAND_LOOP_DIR`
- installing Claude runtime assets at `~/.claude/skills/goldband`
- installing Codex runtime assets at `~/.codex/skills/goldband`
- exposing workflow skills as `goldband-*`
- cleaning legacy runtime roots and generated entries from older installs
- preserving `~/.goldband` as the runtime state directory
- migrating legacy workflow config/state into `~/.goldband` without overwriting
  newer Goldband Loop files

The inventory gate proves the contract. It runs a clean-home install, lists the
actual Claude/Codex skill entries and runtime binaries, and fails on missing
entries, extra entries, legacy commands, or old runtime prefixes.

## Programmatic Workflow Runtime

`goldband-loop/workflows/` is the runtime contract layer for workflow execution.
The registry records the executable contract: target, evaluation signal,
iteration cap, stop conditions, risk level, integration status, and evidence
policy.

The installed model prompt is a separate projection. Capability-level
`promptContract` fields in `goldband.manifest.json` plus each action description
generate
`goldband-loop/generated/workflow-contracts/<capability>/<action>.workflow.md`.
The installer uses the generated `contractPath` and fails closed when it is
missing. Legacy `.tmpl` files remain runtime-migration inputs; they are not
installed as workflow prompts.

On-demand manuals follow the same ownership rule. The manifest declares which
actions may load each manual, the root router receives generated routing text,
and the installer places the standalone manual under the runtime root. Browser
instructions therefore load only for browser-backed work.

This layer deliberately does not replace the existing inventory or usage
telemetry:

- `goldband-loop/inventory.json` remains the installed skill list.
- `hooks/scripts/lib/hook-router/workflow-telemetry.js` remains the workflow
  usage event builder.
- `goldband-loop/hosts/*.ts` remains the host generation/support source.
- `goldband-loop/workflows/registry.ts` owns runtime execution status and step
  contracts only.

Integrated runtime runs write step evidence to
`${GOLDBAND_HOME:-$HOME/.goldband}/workflow-runs/<workflow>.jsonl`. Core
workflows can run in mock mode for CI without LLM spend; real host execution is
gated behind explicit `--mode real`.

### Work Map state

`plan/create` is a typed Claude/Codex entrypoint for work that spans sessions,
has two or more dependency-linked tickets, needs parallel agents, contains
in-scope unknowns, or explicitly requires a tracked plan, roadmap, or handoff.
Single-session, low-risk work without dependencies stays in the ordinary agent
loop and does not require a Work Map.

The JSON domain contract in `goldband-loop/workflows/work-map.ts` owns schema
validation, transitions, dependency cycles, blockers, and frontier
calculation. `goldband-loop/workflows/work-map-store.ts` is the only persistence
owner. It derives repository identity, canonical worktree, branch, and base
commit from Git; model input cannot supply those fields, revisions, timestamps,
frontier, or blockers.

```text
${GOLDBAND_HOME:-$HOME/.goldband}/projects/<repository-id>/work/
├── active.json
└── <work-id>/
    ├── map.json
    ├── map.md
    └── events.jsonl
```

`map.json` is authoritative. `map.md` is regenerated deterministically, and
`events.jsonl` is append-only transition evidence. Updates use a per-map lock,
revision compare-and-swap, temporary files, and atomic rename. State paths are
canonicalized and symbolic-link or traversal writes fail closed.

Context checkpoints do not copy Work Map content. When a map is active,
`context/save` stores only its ID, revision, digest, and nullable active ticket
reference. `context/restore` compares saved/current Git state and saved/current
Work Map state, recalculates the complete frontier, and returns one explicit
next action. A stale, missing, completed, or cancelled map is never presented
as an executable current plan.

Phase 2 ticket lifecycle transitions are store-owned operations with revision
compare-and-swap: `ready -> claimed -> implemented -> verified`, plus explicit
block, requested-changes, cancellation, and integrated-commit readback.
Block, resume, and cancel are callable through the installed `goldband plan` lifecycle
surface for both Claude and Codex hosts. Frontier membership is checked at
claim time, and a code dependency does not satisfy downstream work until its
verified commit is integrated; verified analysis-only work needs no Git commit.
Code claims bind exactly one
managed lease and claim attempt; requested changes open a new attempt so prior
RED records cannot satisfy a later GREEN. Existing-test tickets bind the exact
planning command argument array. Work Map review scope is runtime-owned and the
receipt, review artifact, and finish readback share one canonical candidate-diff
digest. Canonical untracked materialization reuses the normal review secret,
file-size, aggregate-size, binary, and stable-read policy. Analysis-only tickets instead bind a named artifact copied into
broker-owned state and never create a code worktree. Prompt output cannot
directly transition a ticket.

### Work Map collaboration projections

GitHub Issues and GitLab Issues are optional collaboration surfaces. The local
`WorkMapStore` remains the only domain and transition owner; tracker issues are
deterministic projections with versioned work/ticket markers and SHA-256
digests. Provider wire shapes stay inside
`goldband-loop/workflows/tracker-adapters/`.

Tracker configuration defaults to `off` and stores only provider, repository,
labels, and dependency capability under the Goldband state root. Credentials
remain owned by `gh` or `glab`. Preview and inspect are read-only remote
operations. Publish accepts only a persisted preview digest, checks the current
local revision and remote digest, and executes exactly one explicitly named next
step per native-host-approved invocation. A successful provider write is
checkpointed before readback so a transient read failure cannot duplicate a
create. Final readback compares title, body, labels, state, markers, and
relationships rather than trusting the embedded digest alone.

External issue bodies, comments, labels, assignees, and state are untrusted.
They become typed change candidates; approved state and single-assignee claim
changes return through `WorkMapStore` operations, with claims requiring an
explicit owner and analysis binding ID. Code claims remain exclusive to the
managed-worktree broker; tracker import cannot fabricate its lease. Closing an
issue or checking an acceptance box never
supplies Phase 2 verification evidence. GitHub and GitLab do not provide a
cross-provider atomic claim lock, so concurrent claim drift stops for explicit
resolution instead of choosing a winner or applying last-write-wins.

For review workflows, untracked worktree files cross an additional trust
boundary before real host execution: only bounded text files without secret-like
content are materialized into the prompt, while skipped files are recorded as
no-content markers.
`runWorkflow` remains the single-pass compatibility entrypoint. `runWorkflowLoop`
is the convergence-loop entrypoint for workflows that expose typed evaluation
signals. Today `goldband-review` and `goldband-qa` can autonomously re-run until
their target predicate matches, the same blocker repeats, the signal stops
improving, or the registry iteration cap is reached. Loop runs add `iteration`,
`signalSnapshot`, and a `loop-summary` event to the same JSONL evidence path so
readback can reconstruct why each round continued or stopped.

## Local Knowledge Layer

The curated knowledge layer lives under
`${GOLDBAND_HOME:-$HOME/.goldband}/knowledge/`. It is local runtime state, not a
repo artifact. The repo owns only schema, CLI tooling, recall adapters, MCP
query support, and synthetic fixtures. The capability audit and lifecycle
readback live in [`docs/knowledge-system.md`](docs/knowledge-system.md).

Knowledge entries are markdown files with frontmatter, one entry per file, plus
`knowledge/index.json`. `index.json` is the low-cost recall surface: hooks,
workflow resolvers, and MCP can read path plus one-line summary without parsing
every full entry. Entry files stay authoritative; the index is rebuilt by
`goldband-knowledge reindex` or any write command.

The lifecycle is raw evidence -> candidate -> active -> graduated/retired.
Raw telemetry, workflow evidence, and session reports stay separate from
curated entries. Automatic capture writes only `status: candidate`, with a
deterministic id derived from source type, sanitized source pointer, and
summary. Duplicate candidate ids are skipped rather than overwriting a file
that may have been manually reviewed.

Knowledge frontmatter carries the trust contract used by CLI, workflow
resolver, and MCP: `source_evidence`, `trust_level`, `reviewed_by`,
`last_verified`, `staleness`, and `graduated_to`. Default recall is
`status=active` and prints only path, summary, confidence, updated date,
last-verified date, and staleness. Candidate review is explicit through
`goldband-knowledge-review`; overdue candidates are surfaced for review but are
not auto-deleted, auto-retired, or auto-promoted.

This layer does not replace existing storage:

- `learnings.jsonl` remains append-only project memory for small operational
  discoveries and visible "Prior learning applied" readback.
- context-save/context-restore remains working-session continuity.
- auto-memory stores user identity and preferences; knowledge stores verified
  problem/solution, decision, and practice records.

Recall adapters are deliberately shallow. `goldband-review` and `goldband-qa`
use a single `Prior Knowledge` resolver that queries learnings and the curated
index instead of stacking near-identical sections.
Claude `UserPromptSubmit` gets an advisory-only prompt hook that lists matching
knowledge paths with summaries and rate-limits repeats per session. Codex does
not currently have an equivalent prompt-time advisory adapter in this repo;
Codex reaches the same knowledge through generated workflow instructions and
the first-party MCP `knowledge-query` tool.

Promotion is explicit. `goldband-knowledge-review promote` records review
metadata before a candidate becomes active. `goldband-knowledge graduate --to
<skill-or-rule-path>` marks a knowledge entry as graduated while preserving the
historical record. High-frequency active entries should become skills, rules,
hooks, docs, tests, or decision records so the knowledge layer does not become a
second source of truth. When a graduated entry conflicts with its target
artifact, the artifact wins and the knowledge entry must be updated or retired.

## Cross-Review Gate

The cross-review gate is a session-scoped evidence gate for work that must be
reviewed by the other host family before the implementer can finish.
`goldband-cross-review start` writes a contract under
`${GOLDBAND_HOME:-$HOME/.goldband}/cross-review/`, and the Stop hook checks only
that contract, the plan marker, the reviewer artifact, and a deterministic
review-scope hash. The hook never starts Claude, Codex, or another LLM.

The review scope is `tracked-and-untracked-vs-base`: `git diff --binary` from
the armed base commit plus sorted untracked file bytes. The hash is drift
detection, not a security boundary against same-permission tampering. A valid
approval requires a reviewer artifact in the cross-review state directory and a
matching marker in the plan file.

When review cannot converge, the runtime writes an escalation summary under the
cross-review state directory and keeps the contract active until a human
override, expiry, or a valid approval marker. Runtime usage events record arm,
round verdict, implementer response, escalation, override, and done events using
the shared telemetry schema.

Claude Stop can block through the existing router `exit(2)` path. Codex uses
the same gate logic and blocks cross-review Stop failures by exiting the hook
process with code `2`. The 2026-07-05 local probe showed that JSON
`systemMessage` is advisory for final responses, while a non-zero Stop hook
exit makes Codex show `Stop Blocked` and prevents that turn from finishing.

## Observability Pipeline

Goldband telemetry is intentionally local-first:

```text
Claude/Codex hooks -> JSONL usage events -> optional OTLP exporter -> collector/UI
```

`hooks/scripts/lib/hook-router/usage-telemetry.js` and
`codex/hooks/telemetry.js` append JSONL events without network I/O. The shared
normalizer in `scripts/lib/telemetry-schema.cjs` adds `schema_version`,
`run_id`, and `event_id` while preserving legacy `sessionId` for existing
reports. `schemas/telemetry.v1.schema.json` documents the v1 JSON shape.

`scripts/export-telemetry-otlp.mjs` is the only OTLP bridge. It reads JSONL,
normalizes old rows in memory, maps one `run_id` to one trace, maps each event
to a span, and sends OTLP/HTTP JSON only when explicitly invoked. It is not a
hook, daemon, or installer default.

## Validation Gates

Root goldband and Goldband Loop use separate gates because they have different
toolchains and file-shape rules.

- Root policy, installer, hooks, commands, and portable skills are covered by
  `node scripts/check-code-style.mjs` and the root validation scripts.
- Claude plugin drift and clean-home install shape are covered by
  `node scripts/check-plugin-distribution.mjs`; CI runs the same structural
  check with `--skip-cli` so source drift still fails without requiring Claude
  CLI on the runner.
- Telemetry schema, legacy JSONL compatibility, and OTLP exporter behavior are
  covered by `npm run test:telemetry`.
- The first-party stdio MCP server is a separate TypeScript package under
  `mcp/server/`; it uses the official `@modelcontextprotocol/sdk`, stays
  read-only, and is opt-in in Claude/Codex MCP templates.
- `goldband-loop/` is excluded from the root code-style scanner because it owns
  a runtime-specific Bun test suite and generated skill/docs surfaces.
- CI still treats `goldband-loop/` as first-party code: it installs the runtime
  dependencies, installs the Playwright browser asset, runs
  `node scripts/check-goldband-loop-inventory.mjs`, and then runs
  `cd goldband-loop && bun run test:free`.
- `npm run check:review-contracts` is the single freshness entrypoint in the
  root test graph. It lints the real manifests, scoped provider selection,
  lifecycle/execution declarations, canonical dispatch groups, and the
  installer-owned source-input set. Temp-install inventory then verifies the
  installed artifact digest and bounded probes for every action explicitly
  declared `trusted-launcher`; compatibility actions remain workflow-document
  dispatch, and registered-only actions remain non-executable.
- The sandbox story is additive defense in depth. `sandbox/sandbox.sh` starts a
  Docker/Podman container with goldband baked into a non-writable
  `/opt/goldband`, a clean container HOME, and one target project mounted
  read-write. It does not change hook router or permission defaults.
  `scripts/test-sandbox.sh` proves the image builds, goldband installs through
  the normal clean-home path during image build, hook replay still blocks
  representative unsafe commands, CLI smoke checks run, installed Goldband Loop
  helper commands write runtime state under container HOME, `/opt/goldband` is
  not writable at runtime, the launcher happy path works, and an unmounted host
  path is not writable.
- CI runs the sandbox build as a real validation gate. Buildx cache reduces
  repeat cost on GitHub Actions, but a cold push or pull request still pays for
  a full image build and global CLI install.

## Maintenance Rules

- Treat `goldband-loop/` as first-party source.
- Do not recreate wrapper manifests or hidden-name installer behavior.
- When adding or removing a Goldband Loop entry, update `goldband-loop/inventory.json`
  and run `node scripts/check-goldband-loop-inventory.mjs`.
- Keep Claude and Codex install paths aligned before claiming dual-tool parity.
- Keep sandbox claims limited to the boundaries verified in
  [sandbox/THREAT-MODEL.md](sandbox/THREAT-MODEL.md). Do not present the
  container as host-complete security or network isolation unless a matching
  enforcement test exists.
