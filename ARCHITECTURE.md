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

The Codex installer materializes the launcher, shared rules, and runtime outside
the writable repository, pins the host executable, and installs exact execpolicy
prefixes. Claude uses its installed entrypoint and native read-only tool policy.
Neither host adapter grants general shell or repository-write authority.

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

### Shared Hook Policy and Host Adapters

`hooks/scripts/lib/hook-router/secret-patterns.js` owns secret signatures,
severity, and safe diagnostic messages. Claude translates Write/Edit/MultiEdit
content; Codex translates added patch lines, leaving removed/context lines out.
High-confidence matches block writes in every path, including fixtures and
`.env.example`; generic signatures advise. Synthetic tests assemble token-shaped
strings at runtime or decode escaped JSON fixtures. The optional Git style gate
retains its separate file-scope exclusions; they do not exempt tool writes.

`shell-commands.js` owns lexical and explicit execution structure, including
shell/SSH command strings, command groups, redirects, and pipeline
input/output relationships. `shell-invocation.js` owns wrapper/shell option
handling and static `env -S` argv splitting; env-specific escapes and variable
expansion deny analysis. `shell-policy.js` owns safe evaluation. Beyond
explicit child commands, it scans unknown launchers only for signatures that
require a command name and specific arguments, such as `git reset --hard` or
`dd of=/dev/...`; it does not need to enumerate every launcher. Name-only rules
such as `env`, `printenv`, and `sudo` apply only at actual command positions,
including extracted child commands. Codex recognizes `mkfs` and `mkfs.*` as one
command family. A separate `/dev/...` argument is sufficient to block; at an
actual command position, any argument containing `$` also blocks because its
target is unresolved. Unknown-launcher candidates still require the literal
device argument. This deliberately includes literal dollar signs in actual
formatter arguments; it does not expand variables or infer their values.
Codex also covers `mke2fs`, `newfs_apfs` (including `diskNsM` device names), and
destructive `wipefs -a`/`-o` operations, including unambiguous long-option
abbreviations. Known `wipefs` listing/no-act modes and `fdisk -l`/`--list` remain
allowed. The fdisk exception accounts for both Linux and macOS option meanings;
a list-shaped option value cannot exempt a macOS write. Literal image-file
targets remain allowed.
The host policy owns command names, option meanings, and required option values;
shell parsing is unchanged. Known data consumers and script operands retain
their argument boundaries. Ordinary quoted command-shaped data
is not split, while explicit SSH remote commands are interpreted in both hosts.
Ambiguous unquoted signatures in unknown programs are conservatively blocked;
this heuristic does not prove that those arguments would execute.

Extraction or evaluation errors produce a native hook denial, including stack
overflow. Candidate scanning and command normalization each have a
100,000-word work limit to bound repeated inspection; exhausting either also
denies analysis. Known input flow follows descriptor copies/moves in redirect
order and `cat`/`tee` pipelines. `shell-output.js` handles explicit literal
`echo`/`printf` output and supported backslash escapes, preserving actual
newlines so group output can be concatenated without changing its bytes.
Unknown descriptors, ambiguous echo modes, and unsupported output formats deny
analysis when a shell or SQL consumer needs that input. Arbitrary program
bodies, dynamic values, remote configuration, and unsupported syntax are not
interpreted. Parser capabilities are fixed at this scope; broader shell
interpretation is not part of the hook contract. Native host permissions remain
execution authority.
`sync-plugin-assets.mjs` produces both the Claude plugin and Codex's local
copies of these shared modules; the distribution check rejects stale copies.
The installer carries the complete hook directory in both link and copy modes.

| Surface | Shared policy or deliberate host difference |
| --- | --- |
| Documentation and dev servers | Allowed by both hooks; project conventions and accessible logs are guidance in `rules/coding-style.md`. |
| Secrets in tool writes | Same signatures, severity and messages; adapters select newly written content. |
| Shell high-risk guard | Codex has an always-on heuristic; Claude's broader careful mode is opt-in. Both use the same command extraction. |
| Careful/freeze and interactive review read-only | Claude session modes; Codex has no matching mode hook. Native permissions are independently enforced. |
| Managed worktree Git writes | Shared native isolation and broker; Claude adds an early hook diagnostic. |
| Post-edit automation | Claude asynchronous format/typecheck; Codex style advice. Both are host-specific automation, not proof that checks passed. |
| Subagent completion | Claude prompt hook; no corresponding Codex hook. |
| Knowledge hints, tool-count advice, notifications | Claude convenience features; Codex uses explicit workflows. |
| Push, tool-failure and mutating-MCP reminders | Host-specific advice; they do not authorize side effects. |

`test-hook-policy-parity.mjs` replays shared secret fixtures and guidance cases
through both native hook output contracts. `test-hook-policy-install.mjs`
repeats that check under temporary homes for linked and copied installations.
The existing coverage check requires positive/negative cases for each secret
signature; neither the test matrix nor this inventory claims full host parity.
Coverage names prefixed with `retired-` are allow regressions for removed
policies. Historical telemetry keeps its original names; the miner labels its
new replay candidates with the retired names and current allow expectation.

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

`codex/config.toml` supplies defaults for the user's shared config, not enforced
values. Installation merges portable and local defaults only when the main file
is absent; existing files and omitted preferences remain unchanged. Config errors
do not prevent independent bundle components from updating, but the bundle returns
nonzero. `shell_environment_policy` remains a recommendation with status advice,
not a managed requirement. Explicitly installed requirements enforce only their
declared keys. Rules, hooks, and Goldband profile files have separate ownership. Host status lines are
explicit installer options (`claude-statusline`, `codex-statusline`), and refresh
does not reapply their presets over later user choices.

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

Ticket lifecycle transitions remain store-owned and use revision compare-and-swap.
Code follows `ready -> claimed -> implemented -> verified`: project verification
records the implementation, and an explicit successful worktree finish records
the integrated commit and final status. Dependencies advance only after code
integration. Analysis-only work reaches its final status when its declared
artifact is recorded. These statuses track delivery, not reviewer approval.
Block, resume, and cancel remain available through the installed lifecycle CLI.

Review reports are independent of Work Map transitions. Historical review
references remain readable for compatibility but never authorize integration.
The managed-worktree owner still checks the current project-verification receipt,
ticket contract, lease, candidate tree, and safe Git integration conditions.

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
- Manifest, workflow-contract, distribution, and temporary-install checks verify
  generated actions, dispatch owners, installed artifacts, and native launcher rules.
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
